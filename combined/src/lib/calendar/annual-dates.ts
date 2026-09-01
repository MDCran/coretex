/** Expand a recurring annual date (birthday, anniversary) into occurrences inside a window. */
export function annualOccurrencesInWindow(sourceDate: Date, windowStart: Date, windowEnd: Date): Date[] {
    const out: Date[] = [];
    const month = sourceDate.getUTCMonth();
    const day = sourceDate.getUTCDate();
    for (let y = windowStart.getUTCFullYear(); y <= windowEnd.getUTCFullYear(); y++) {
        const occ = new Date(Date.UTC(y, month, day, 12, 0, 0));
        if (occ >= windowStart && occ <= windowEnd) out.push(occ);
    }
    return out;
}
