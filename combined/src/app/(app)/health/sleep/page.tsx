import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { SleepClient, type SleepRow } from "./sleep-client";

export default async function SleepPage() {
    const user = await requireUser();
    const entries = await db.sleepEntry.findMany({
        where: { userId: user.id },
        orderBy: { date: "desc" },
        take: 180,
        include: { interruptions: true },
    });

    const rows: SleepRow[] = entries.map((e) => ({
        id: e.id,
        date: e.date.toISOString().slice(0, 10),
        bedtime: e.bedtime?.toISOString() ?? null,
        wakeTime: e.wakeTime?.toISOString() ?? null,
        totalMinutes: e.totalMinutes,
        sleepQuality: e.sleepQuality,
        feelRested: e.feelRested,
        sleepLatencyMin: e.sleepLatencyMin,
        restingHrBpm: e.restingHrBpm,
        hrvMs: e.hrvMs,
        notes: e.notes,
        interruptions: e.interruptions.map((i) => ({
            time: i.time?.toISOString() ?? null,
            durationMinutes: i.durationMinutes,
            reason: i.reason,
            notes: i.notes,
        })),
    }));

    return <SleepClient entries={rows} />;
}
