import "server-only";

import { db } from "@/lib/db";

/**
 * OpenStreetMap Nominatim geocoding — free, no API key. Used for two things:
 *   1. Autocompleting saved job-search locations (cities, towns, US zip codes).
 *   2. Geocoding each distinct role city returned by the AI so we can compute
 *      how far it is from the user's saved locations (haversine).
 *
 * Nominatim's usage policy requires a descriptive User-Agent and at most ~1
 * request/second. We throttle network calls and cache every geocode in
 * `GeocodeCache` so each place string is only ever looked up once.
 */

const NOMINATIM = "https://nominatim.openstreetmap.org";
const USER_AGENT = "LifeOS-JobSearch/1.0 (self-hosted personal life tracker)";

export interface PlaceSuggestion {
    label: string; // full display name, e.g. "Chicago, Illinois, United States"
    shortLabel: string; // compact, e.g. "Chicago, IL"
    lat: number;
    lon: number;
    placeType: string | null;
    countryCode: string | null;
}

interface NominatimResult {
    lat: string;
    lon: string;
    display_name: string;
    type?: string;
    addresstype?: string;
    address?: {
        city?: string;
        town?: string;
        village?: string;
        hamlet?: string;
        municipality?: string;
        county?: string;
        state?: string;
        postcode?: string;
        country?: string;
        country_code?: string;
        [k: string]: string | undefined;
    };
}

// US state name -> USPS abbreviation, for building compact "Chicago, IL" labels.
const US_STATE_ABBR: Record<string, string> = {
    alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
    connecticut: "CT", delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA",
    hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY",
    louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
    mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH",
    "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
    ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
    "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA",
    washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};

function placeName(a: NominatimResult["address"]): string | null {
    if (!a) return null;
    return a.city ?? a.town ?? a.village ?? a.hamlet ?? a.municipality ?? a.county ?? null;
}

function toSuggestion(r: NominatimResult): PlaceSuggestion {
    const a = r.address ?? {};
    const cc = a.country_code ? a.country_code.toUpperCase() : null;
    const name = placeName(a);
    const isUS = cc === "US";

    // Compact label: "<place>, <state-abbr>" for the US, otherwise "<place>, <country>".
    let shortLabel = "";
    if (a.postcode && r.addresstype === "postcode") {
        const st = isUS && a.state ? US_STATE_ABBR[a.state.toLowerCase()] ?? a.state : a.state;
        shortLabel = [a.postcode, name, st].filter(Boolean).join(", ");
    } else if (name) {
        if (isUS && a.state) shortLabel = `${name}, ${US_STATE_ABBR[a.state.toLowerCase()] ?? a.state}`;
        else shortLabel = [name, a.country].filter(Boolean).join(", ");
    } else {
        shortLabel = r.display_name.split(",").slice(0, 2).join(",").trim();
    }

    return {
        label: r.display_name,
        shortLabel,
        lat: parseFloat(r.lat),
        lon: parseFloat(r.lon),
        placeType: r.addresstype ?? r.type ?? null,
        countryCode: cc,
    };
}

// ------------------------------------------------------------------
// Polite throttle: keep >= 1.1s between actual Nominatim network calls.
// ------------------------------------------------------------------
let lastCallAt = 0;
let queue: Promise<unknown> = Promise.resolve();

async function throttled<T>(fn: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
        const wait = 1100 - (Date.now() - lastCallAt);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        try {
            return await fn();
        } finally {
            lastCallAt = Date.now();
        }
    };
    const result = queue.then(run, run);
    // Keep the chain alive regardless of individual failures.
    queue = result.then(
        () => undefined,
        () => undefined,
    );
    return result;
}

async function nominatim(path: string, params: Record<string, string>): Promise<NominatimResult[]> {
    const qs = new URLSearchParams({ format: "jsonv2", addressdetails: "1", ...params });
    const res = await throttled(() =>
        fetch(`${NOMINATIM}${path}?${qs.toString()}`, {
            headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
            // Geocoding results are stable; let the platform cache for a day.
            next: { revalidate: 86400 },
        }),
    );
    if (!res.ok) throw new Error(`Nominatim ${res.status}`);
    return (await res.json()) as NominatimResult[];
}

/** Autocomplete: free-text place / zip → ranked suggestions. */
export async function searchPlaces(query: string, limit = 6): Promise<PlaceSuggestion[]> {
    const q = query.trim();
    if (q.length < 2) return [];
    const results = await nominatim("/search", { q, limit: String(limit) });
    return results.map(toSuggestion);
}

export interface GeoPoint {
    lat: number;
    lon: number;
}

/**
 * Geocode an arbitrary place string to a single best point, caching the result
 * (including misses) in `GeocodeCache` so we never re-query the same city.
 */
export async function geocodeQuery(query: string): Promise<(GeoPoint & { displayName: string }) | null> {
    const q = query.trim();
    if (!q) return null;

    const key = q.toLowerCase();
    const cached = await db.geocodeCache.findUnique({ where: { query: key } });
    if (cached) {
        return cached.lat != null && cached.lon != null
            ? { lat: cached.lat, lon: cached.lon, displayName: cached.displayName ?? q }
            : null;
    }

    let point: (GeoPoint & { displayName: string }) | null = null;
    try {
        const results = await nominatim("/search", { q, limit: "1" });
        const r = results[0];
        if (r) point = { lat: parseFloat(r.lat), lon: parseFloat(r.lon), displayName: r.display_name };
    } catch {
        // Network/parse failure: fall through and cache a miss so we back off.
        point = null;
    }

    await db.geocodeCache
        .create({
            data: { query: key, lat: point?.lat ?? null, lon: point?.lon ?? null, displayName: point?.displayName ?? null },
        })
        .catch(() => undefined); // tolerate a concurrent insert of the same key

    return point;
}

const EARTH_RADIUS_MI = 3958.8;

/** Great-circle distance between two points, in miles. */
export function haversineMiles(a: GeoPoint, b: GeoPoint): number {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface LocatedPlace extends GeoPoint {
    id: string;
}

/** Nearest saved location to a point, with the distance in miles. */
export function nearestLocation<T extends LocatedPlace>(point: GeoPoint, locations: T[]): { location: T; miles: number } | null {
    let best: { location: T; miles: number } | null = null;
    for (const loc of locations) {
        const miles = haversineMiles(point, loc);
        if (!best || miles < best.miles) best = { location: loc, miles };
    }
    return best;
}
