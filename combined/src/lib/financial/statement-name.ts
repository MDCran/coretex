/** Statement naming helpers. Client-safe (no server-only imports). */

/**
 * Build the normalized statement name used as both display label and download
 * filename: `{institution_or_nickname}_{YYYY_MM}` lowercased, non-alphanumerics
 * collapsed to single underscores. e.g. "Chase Checking" + 2026-05 → "chase_checking_2026_05".
 */
export function normalizedStatementName(entityLabel: string | null | undefined, periodEnd: string | Date | null | undefined): string {
    const base = (entityLabel ?? "statement")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
    let ym = "";
    if (periodEnd) {
        const d = typeof periodEnd === "string" ? new Date(periodEnd) : periodEnd;
        if (!Number.isNaN(d.getTime())) {
            ym = `_${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
        }
    }
    return `${base || "statement"}${ym}`;
}

/** Normalize an arbitrary token to lowercase + single underscores. */
function slug(s: string | null | undefined): string {
    return (s ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

/** YYYY_MM_DD for a date, or "" when missing/invalid. */
function ymd(d: string | Date | null | undefined): string {
    if (!d) return "";
    const date = typeof d === "string" ? new Date(d) : d;
    if (Number.isNaN(date.getTime())) return "";
    return `${date.getUTCFullYear()}_${String(date.getUTCMonth() + 1).padStart(2, "0")}_${String(date.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Full normalized statement filename:
 *   `{nickname-or-institution}_{last4}_{periodStart}_{periodEnd}` lowercased with
 *   underscores, e.g. "chase_checking_4821_2026_04_01_2026_04_30". Missing parts are
 *   dropped. A file extension (e.g. ".pdf") is appended when provided.
 */
export function fullStatementFileName(opts: {
    entityLabel: string | null | undefined;
    last4?: string | null;
    periodStart?: string | Date | null;
    periodEnd?: string | Date | null;
    extension?: string | null;
}): string {
    const parts = [slug(opts.entityLabel) || "statement", slug(opts.last4), ymd(opts.periodStart), ymd(opts.periodEnd)].filter(Boolean);
    const base = parts.join("_") || "statement";
    const ext = (opts.extension ?? "").replace(/^\.+/, "");
    return ext ? `${base}.${ext}` : base;
}

/** Extract a lowercase file extension (without dot) from a filename, or null. */
export function fileExtension(fileName: string | null | undefined): string | null {
    if (!fileName) return null;
    const m = fileName.match(/\.([a-z0-9]+)$/i);
    return m ? m[1].toLowerCase() : null;
}

/** Month bucket key (YYYY-MM) from a date for grouping statements by month. */
export function monthKey(periodEnd: string | Date | null | undefined): string {
    if (!periodEnd) return "0000-00";
    const d = typeof periodEnd === "string" ? new Date(periodEnd) : periodEnd;
    if (Number.isNaN(d.getTime())) return "0000-00";
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Human month label, e.g. "May 2026". */
export function monthLabel(key: string): string {
    if (key === "0000-00") return "Undated";
    const [y, m] = key.split("-").map(Number);
    if (!y || !m) return "Undated";
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
