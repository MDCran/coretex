/** Target-date countdown helpers shared by the goals list and detail views. */

export interface Countdown {
    label: string;
    tone: "tertiary" | "warning" | "error" | "success";
}

/** Whole-day difference (target − today), at local midnight. */
function daysUntil(iso: string): number {
    const target = new Date(iso);
    const t = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
    const now = new Date();
    const n = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return Math.round((t - n) / 86_400_000);
}

/** "N days left" / "Due today" / "Overdue by N days" with a semantic tone. */
export function countdown(iso: string | null): Countdown | null {
    if (!iso) return null;
    const d = daysUntil(iso);
    if (d === 0) return { label: "Due today", tone: "warning" };
    if (d < 0) return { label: d === -1 ? "Overdue by 1 day" : `Overdue by ${Math.abs(d)} days`, tone: "error" };
    if (d === 1) return { label: "1 day left", tone: "warning" };
    if (d <= 7) return { label: `${d} days left`, tone: "warning" };
    return { label: `${d} days left`, tone: "tertiary" };
}

const TONE_CLASS: Record<Countdown["tone"], string> = {
    tertiary: "text-tertiary",
    warning: "text-warning-primary",
    error: "text-error-primary",
    success: "text-success-primary",
};

export function countdownClass(tone: Countdown["tone"]): string {
    return TONE_CLASS[tone];
}
