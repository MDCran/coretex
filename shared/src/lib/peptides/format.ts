/** Trim a number to at most `max` decimals, dropping trailing zeros. */
export function fmt(n: number, max = 3): string {
    if (!isFinite(n)) return "—";
    const r = Number(n.toFixed(max));
    return String(r);
}

/** Format a unit count (syringe units) — typically 1–2 decimals. */
export function fmtUnits(n: number): string {
    if (!isFinite(n)) return "—";
    return fmt(n, 2);
}

/** Syringe scale label, e.g. "U-100". */
export function syringeLabel(unitsPerMl: number): string {
    return `U-${unitsPerMl}`;
}
