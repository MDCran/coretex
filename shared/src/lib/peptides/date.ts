// Date helpers operating on ISO 'YYYY-MM-DD' strings. All arithmetic is done at
// noon UTC to stay clear of DST / timezone edge cases.

export function parseISO(iso: string): Date {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1, 12));
}

export function toISODate(d: Date): string {
    return d.toISOString().slice(0, 10);
}

export function todayISO(): string {
    return toISODate(new Date());
}

export function addDays(iso: string, days: number): string {
    const d = parseISO(iso);
    d.setUTCDate(d.getUTCDate() + days);
    return toISODate(d);
}

export function addMonths(iso: string, n: number): string {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1 + n, 1, 12));
    const lastDay = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0, 12)).getUTCDate();
    dt.setUTCDate(Math.min(d, lastDay));
    return toISODate(dt);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(iso: string): number {
    return parseISO(iso).getUTCDay();
}

export function startOfWeek(iso: string, weekStartsOn = 0): string {
    const diff = (weekday(iso) - weekStartsOn + 7) % 7;
    return addDays(iso, -diff);
}

export function startOfMonth(iso: string): string {
    const [y, m] = iso.split("-").map(Number);
    return toISODate(new Date(Date.UTC(y, m - 1, 1, 12)));
}

export function daysInMonth(iso: string): number {
    const [y, m] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m, 0, 12)).getUTCDate();
}

export function isSameMonth(a: string, b: string): boolean {
    return a.slice(0, 7) === b.slice(0, 7);
}

export function dayOfMonth(iso: string): number {
    return parseISO(iso).getUTCDate();
}

const MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

export function monthLabel(iso: string): string {
    const [y, m] = iso.split("-").map(Number);
    return `${MONTHS[m - 1]} ${y}`;
}

export function rangeLabel(startIso: string, endIso: string): string {
    const s = parseISO(startIso);
    const e = parseISO(endIso);
    const sM = MONTHS[s.getUTCMonth()].slice(0, 3);
    const eM = MONTHS[e.getUTCMonth()].slice(0, 3);
    if (startIso.slice(0, 7) === endIso.slice(0, 7)) {
        return `${sM} ${s.getUTCDate()}–${e.getUTCDate()}, ${e.getUTCFullYear()}`;
    }
    return `${sM} ${s.getUTCDate()} – ${eM} ${e.getUTCDate()}, ${e.getUTCFullYear()}`;
}

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
