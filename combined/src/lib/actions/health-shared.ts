import "server-only";

/** Parses a YYYY-MM-DD string into a UTC midnight Date (for @db.Date columns). */
export function parseDateOnly(value: string | null | undefined): Date {
    const s = (value ?? "").trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
}

/** Parses a datetime-local string into a Date, defaulting to now. */
export function parseDateTime(value: string | null | undefined): Date {
    const s = (value ?? "").trim();
    if (!s) return new Date();
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? new Date() : d;
}

/** Optional datetime parse — returns null for empty input. */
export function parseOptionalDateTime(value: string | null | undefined): Date | null {
    const s = (value ?? "").trim();
    if (!s) return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
}

/** Reads a FormData string value, returning null when empty. */
export function str(fd: FormData, key: string): string | null {
    const v = fd.get(key);
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t.length ? t : null;
}

/** Reads a FormData numeric value, returning null when empty/invalid. */
export function num(fd: FormData, key: string): number | null {
    const v = fd.get(key);
    if (typeof v !== "string" || !v.trim()) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/** Reads a FormData integer value, returning null when empty/invalid. */
export function int(fd: FormData, key: string): number | null {
    const n = num(fd, key);
    return n === null ? null : Math.round(n);
}

/** Reads a FormData boolean (checkbox/"true"/"on"). */
export function bool(fd: FormData, key: string): boolean {
    const v = fd.get(key);
    return v === "true" || v === "on" || v === "1";
}

/** Format a Date as YYYY-MM-DD (UTC). */
export function ymd(d: Date): string {
    return d.toISOString().slice(0, 10);
}
