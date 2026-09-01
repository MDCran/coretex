"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { MarkerPin01, SearchLg, Trash01 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Toggle } from "@/components/base/toggle/toggle";
import { cx } from "@/utils/cx";
import { addSearchLocation, deleteSearchLocation, updateSearchLocation } from "@/lib/actions/job-search";

interface PlaceSuggestion {
    label: string;
    shortLabel: string;
    lat: number;
    lon: number;
    placeType: string | null;
    countryCode: string | null;
}

export interface SavedLocation {
    id: string;
    label: string;
    shortLabel: string | null;
    enabled: boolean;
    placeType: string | null;
}

/** Type-ahead box (OSM Nominatim) that adds a saved job-search location on pick. */
function LocationAutocomplete({ disabled }: { disabled?: boolean }) {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<PlaceSuggestion[]>([]);
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [pending, start] = useTransition();
    const boxRef = useRef<HTMLDivElement>(null);

    // Debounced lookups against our /api/geocode proxy.
    useEffect(() => {
        const q = query.trim();
        if (q.length < 2) {
            setResults([]);
            return;
        }
        setLoading(true);
        const ctrl = new AbortController();
        const t = setTimeout(async () => {
            try {
                const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
                const data = (await res.json()) as { results?: PlaceSuggestion[] };
                setResults(data.results ?? []);
                setOpen(true);
            } catch {
                /* aborted or failed — ignore */
            } finally {
                setLoading(false);
            }
        }, 350);
        return () => {
            clearTimeout(t);
            ctrl.abort();
        };
    }, [query]);

    // Close the dropdown on outside click.
    useEffect(() => {
        function onDoc(e: MouseEvent) {
            if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
        }
        document.addEventListener("mousedown", onDoc);
        return () => document.removeEventListener("mousedown", onDoc);
    }, []);

    function pick(p: PlaceSuggestion) {
        setOpen(false);
        setQuery("");
        setResults([]);
        start(async () => {
            try {
                const fd = new FormData();
                fd.set("label", p.label);
                fd.set("shortLabel", p.shortLabel);
                fd.set("lat", String(p.lat));
                fd.set("lon", String(p.lon));
                if (p.placeType) fd.set("placeType", p.placeType);
                if (p.countryCode) fd.set("countryCode", p.countryCode);
                await addSearchLocation(fd);
                toast.success(`Added ${p.shortLabel || p.label}`);
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Couldn't add location.");
            }
        });
    }

    return (
        <div ref={boxRef} className="relative">
            <div className={cx("flex items-center gap-2 rounded-lg bg-primary px-3 shadow-xs ring-1 ring-primary ring-inset focus-within:ring-2 focus-within:ring-brand", disabled && "opacity-50")}>
                <SearchLg className="size-4 shrink-0 text-fg-quaternary" />
                <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onFocus={() => results.length && setOpen(true)}
                    placeholder="Add a city, region or ZIP code…"
                    disabled={disabled}
                    className="w-full bg-transparent py-2.5 text-sm text-primary outline-hidden placeholder:text-placeholder disabled:cursor-not-allowed"
                />
                {(loading || pending) && <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-fg-quaternary border-t-transparent motion-reduce:animate-none" />}
            </div>

            {open && results.length > 0 && (
                <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg bg-primary py-1 shadow-lg ring-1 ring-secondary_alt">
                    {results.map((p, i) => (
                        <li key={`${p.lat},${p.lon},${i}`}>
                            <button
                                type="button"
                                onClick={() => pick(p)}
                                className="flex w-full items-start gap-2.5 px-3 py-2 text-left transition hover:bg-primary_hover"
                            >
                                <MarkerPin01 className="mt-0.5 size-4 shrink-0 text-fg-quaternary" />
                                <span className="min-w-0">
                                    <span className="block truncate text-sm font-medium text-primary">{p.shortLabel || p.label}</span>
                                    <span className="block truncate text-xs text-tertiary">{p.label}</span>
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

/** A saved location row: enable toggle + delete. (Result count is driven by the run's target/budget.) */
function LocationRow({ loc, disabled }: { loc: SavedLocation; disabled?: boolean }) {
    const [pending, start] = useTransition();

    function update(fields: Record<string, string>) {
        start(async () => {
            try {
                const fd = new FormData();
                fd.set("id", loc.id);
                for (const [k, v] of Object.entries(fields)) fd.set(k, v);
                await updateSearchLocation(fd);
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Update failed.");
            }
        });
    }

    function remove() {
        start(async () => {
            try {
                const fd = new FormData();
                fd.set("id", loc.id);
                await deleteSearchLocation(fd);
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Delete failed.");
            }
        });
    }

    return (
        <div className={cx("flex flex-wrap items-center justify-between gap-3 py-3", pending && "opacity-60")}>
            <div className="flex min-w-0 items-center gap-2.5">
                <MarkerPin01 className="size-4 shrink-0 text-fg-quaternary" />
                <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-primary">{loc.shortLabel || loc.label}</div>
                    <div className="truncate text-xs text-tertiary">{loc.label}</div>
                </div>
            </div>
            <div className="flex items-center gap-4">
                <Toggle size="sm" isSelected={loc.enabled} isDisabled={disabled} onChange={(v) => update({ enabled: v ? "on" : "" })} aria-label="Enabled in search" />
                <Button color="tertiary-destructive" size="sm" iconLeading={Trash01} aria-label="Remove location" onClick={remove} isDisabled={pending || disabled} />
            </div>
        </div>
    );
}

export function LocationManager({ locations, disabled }: { locations: SavedLocation[]; disabled?: boolean }) {
    return (
        <div className="flex flex-col gap-2">
            <LocationAutocomplete disabled={disabled} />
            {locations.length === 0 ? (
                <p className="px-1 py-4 text-sm text-tertiary">No locations yet. Search above to add the cities, regions or ZIP codes you want jobs near.</p>
            ) : (
                <div className="divide-y divide-secondary">
                    {locations.map((loc) => (
                        <LocationRow key={loc.id} loc={loc} disabled={disabled} />
                    ))}
                </div>
            )}
        </div>
    );
}
