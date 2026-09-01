import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { searchPlaces } from "@/lib/jobs/geocode";

/**
 * Location autocomplete for the job-search settings. Proxies OpenStreetMap
 * Nominatim (so the browser never calls it directly, and we attach the required
 * User-Agent + throttle server-side). Auth-gated to logged-in users.
 *
 * GET /api/geocode?q=chicago  ->  { results: PlaceSuggestion[] }
 */
export async function GET(request: NextRequest) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
    if (q.length < 2) return NextResponse.json({ results: [] });

    try {
        const results = await searchPlaces(q);
        return NextResponse.json({ results });
    } catch {
        return NextResponse.json({ results: [], error: "Lookup failed" }, { status: 502 });
    }
}
