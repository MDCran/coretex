import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { SobrietyClient, type CounterRow, type CustomType, type SubstanceRow } from "./sobriety-client";

/**
 * Best streak = the longest contiguous sober period across the counter's
 * history. Boundaries are: the original sober start (earlier of createdAt /
 * the first streak start), each relapse moment, and "now" for the current
 * streak. The longest gap between consecutive boundaries is the record.
 */
function bestStreakMs(createdAt: Date, currentStart: Date, relapses: Date[]): number {
    const sorted = [...relapses].sort((a, b) => a.getTime() - b.getTime());
    // The very first sober period started no later than the current streak
    // start and no later than the earliest relapse; anchor to the earliest
    // known boundary so the first gap is measured correctly.
    const earliest = sorted.length ? Math.min(createdAt.getTime(), currentStart.getTime(), sorted[0].getTime()) : Math.min(createdAt.getTime(), currentStart.getTime());

    const boundaries = [earliest, ...sorted.map((d) => d.getTime()), Date.now()];
    let best = 0;
    for (let i = 1; i < boundaries.length; i++) {
        best = Math.max(best, boundaries[i] - boundaries[i - 1]);
    }
    return Math.max(0, best);
}

export default async function SobrietyPage() {
    const user = await requireUser();
    const [counters, substanceLogs, customTypes] = await Promise.all([
        db.sobrietyCounter.findMany({
            where: { userId: user.id },
            orderBy: [{ archived: "asc" }, { createdAt: "asc" }],
            include: { relapses: { orderBy: { relapsedAt: "desc" } } },
        }),
        db.substanceLog.findMany({ where: { userId: user.id }, orderBy: { loggedAt: "desc" }, take: 500 }),
        db.customSubstanceType.findMany({ where: { userId: user.id }, orderBy: { name: "asc" } }),
    ]);

    const rows: CounterRow[] = counters.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        color: c.color,
        icon: c.icon,
        startedAt: c.startedAt.toISOString(),
        archived: c.archived,
        createdAt: c.createdAt.toISOString(),
        bestStreakMs: bestStreakMs(
            c.createdAt,
            c.startedAt,
            c.relapses.map((r) => r.relapsedAt),
        ),
        relapses: c.relapses.map((r) => ({
            id: r.id,
            relapsedAt: r.relapsedAt.toISOString(),
            notes: r.notes,
        })),
    }));

    const logRows: SubstanceRow[] = substanceLogs.map((l) => ({
        id: l.id,
        substanceType: l.substanceType,
        amount: l.amount,
        unit: l.unit,
        loggedAt: l.loggedAt.toISOString(),
        notes: l.notes,
    }));
    const typeRows: CustomType[] = customTypes.map((c) => ({ id: c.id, name: c.name }));

    return <SobrietyClient counters={rows} substanceLogs={logRows} customTypes={typeRows} />;
}
