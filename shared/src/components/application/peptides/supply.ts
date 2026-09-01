import type { Peptide } from "@/lib/peptides/types";
import type { Occurrence } from "@/lib/peptides/schedule";
import { generateSchedule } from "@/lib/peptides/schedule";
import { deriveCycle } from "@/lib/peptides/dosing";
import { dryVialsRemaining, isOccurrenceTaken } from "@/lib/peptides/admin";
import { todayISO } from "@/lib/peptides/date";

export interface PeptideSnapshot {
    schedule: Occurrence[];
    /** Total ml of supply still available (active vial + unopened vials). */
    remainingMl: number;
    /** ml the remaining scheduled doses will consume. */
    upcomingMl: number;
    /** Fraction of supply that will be consumed by the rest of the cycle (0..1+). */
    supplyPct: number;
    /** Whether remaining supply covers the rest of the cycle. */
    supplyShort: boolean;
    /** Estimated number of future scheduled doses the supply can still cover. */
    dosesCovered: number;
    /** ISO date of the next scheduled (untaken) dose, or null. */
    nextDoseDate: string | null;
    /** The next untaken occurrence on or after today, or null. */
    todayOccurrence: Occurrence | null;
    nextOccurrence: Occurrence | null;
    /** Current cycle week number (1-based), or null when no start date. */
    currentWeek: number | null;
    totalWeeks: number;
    overBudget: boolean;
}

export function snapshot(p: Peptide): PeptideSnapshot {
    const today = todayISO();
    const schedule = generateSchedule(p);
    const cycle = deriveCycle(p);

    const future = schedule.filter((o) => o.date >= today && !isOccurrenceTaken(p, o));
    const upcomingMl = future.reduce((sum, o) => sum + o.mlPerAdmin, 0);

    const dryMl = dryVialsRemaining(p) * (p.waterMl > 0 ? p.waterMl : 0);
    const remainingMl = p.activeVialRemainingMl + dryMl;

    const supplyPct = upcomingMl > 0 ? remainingMl / upcomingMl : remainingMl > 0 ? 1 : 0;

    // How many future doses the current supply can cover, in order.
    let acc = remainingMl;
    let dosesCovered = 0;
    for (const o of future) {
        if (acc + 1e-9 >= o.mlPerAdmin) {
            acc -= o.mlPerAdmin;
            dosesCovered++;
        } else {
            break;
        }
    }

    const todayOcc = schedule.find((o) => o.date === today && !isOccurrenceTaken(p, o)) ?? null;
    const nextOcc = future[0] ?? null;

    // Current cycle week: pick the week of the first scheduled day spanning today,
    // else the latest past week, else the first upcoming week.
    let currentWeek: number | null = null;
    let totalWeeks = 0;
    if (p.cycleStartDate && schedule.length > 0) {
        const maxWeek = Math.max(...p.blocks.map((b) => b.endWeek), 0);
        totalWeeks = maxWeek;
        const todayOccAny = schedule.find((o) => o.date === today);
        if (todayOccAny) currentWeek = todayOccAny.weekNumber;
        else {
            const past = schedule.filter((o) => o.date < today);
            if (past.length > 0) currentWeek = past[past.length - 1].weekNumber;
            else currentWeek = schedule[0].weekNumber;
        }
    }

    return {
        schedule,
        remainingMl,
        upcomingMl,
        supplyPct,
        supplyShort: upcomingMl > 0 && remainingMl < upcomingMl,
        dosesCovered,
        nextDoseDate: nextOcc?.date ?? null,
        todayOccurrence: todayOcc,
        nextOccurrence: nextOcc,
        currentWeek,
        totalWeeks,
        overBudget: cycle.overBudget,
    };
}
