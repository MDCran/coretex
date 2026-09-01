/**
 * Tax-deduction tagging without a schema change: a transaction is marked deductible by
 * embedding a `[[deductible]]` or `[[deductible:Category]]` marker in its notes — the
 * same notes-marker convention the subscription detector uses for dismissals. Pure +
 * client-safe.
 */

const MARKER_RE = /\[\[deductible(?::([^\]]+))?\]\]/i;

/** Suggested deduction buckets (Schedule C / itemized-style). */
export const DEDUCTION_CATEGORIES = [
    "Business",
    "Home office",
    "Travel",
    "Meals",
    "Software & subscriptions",
    "Equipment",
    "Education",
    "Medical",
    "Charitable",
    "Other",
];

export function parseDeductible(notes: string | null | undefined): { deductible: boolean; category: string | null } {
    if (!notes) return { deductible: false, category: null };
    const m = notes.match(MARKER_RE);
    if (!m) return { deductible: false, category: null };
    return { deductible: true, category: m[1]?.trim() || null };
}

/** Return notes with the deductible marker added/updated/removed, preserving other text. */
export function setDeductibleMarker(notes: string | null | undefined, deductible: boolean, category: string | null): string | null {
    const base = (notes ?? "").replace(MARKER_RE, "").trim();
    if (!deductible) return base || null;
    const marker = category ? `[[deductible:${category}]]` : "[[deductible]]";
    return base ? `${marker} ${base}` : marker;
}

/** Strip the marker so the user never sees the raw token in the UI. */
export function cleanNotes(notes: string | null | undefined): string | null {
    const base = (notes ?? "").replace(MARKER_RE, "").trim();
    return base || null;
}
