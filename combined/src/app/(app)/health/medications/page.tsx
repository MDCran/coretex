import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getAdherence, materializeUpcomingDoses } from "@/lib/actions/therapeutics";
import { MedicationsClient } from "@/components/application/peptides/medications-client";
import { LiveRefresh } from "@/components/app-shell/live-refresh";

export default async function MedicationsPage() {
    const user = await requireUser();

    // Materialize scheduled doses for adherence + calendar (30-day window).
    await materializeUpcomingDoses(30);

    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const horizon = new Date(today);
    horizon.setUTCDate(horizon.getUTCDate() + 8);
    const since30 = new Date(today);
    since30.setUTCDate(since30.getUTCDate() - 30);

    const [medications, supplements, schedules, doses, doseHistory30, logs, adherence] = await Promise.all([
        db.medication.findMany({ where: { userId: user.id }, orderBy: [{ active: "desc" }, { name: "asc" }] }),
        db.supplement.findMany({ where: { userId: user.id }, orderBy: [{ active: "desc" }, { name: "asc" }] }),
        db.therapeuticSchedule.findMany({ where: { userId: user.id, archived: false }, orderBy: { createdAt: "desc" } }),
        db.therapeuticDose.findMany({
            where: { userId: user.id, scheduledAt: { gte: today, lt: horizon } },
            orderBy: { scheduledAt: "asc" },
            include: { schedule: true },
        }),
        db.therapeuticDose.findMany({
            where: { userId: user.id, scheduledAt: { gte: since30 } },
            orderBy: { scheduledAt: "desc" },
            include: { schedule: true },
        }),
        db.therapeuticLog.findMany({ where: { userId: user.id, loggedAt: { gte: since30 } }, orderBy: { loggedAt: "desc" } }),
        getAdherence(30),
    ]);

    return (
        <>
            <LiveRefresh intervalMs={600000} />
            <MedicationsClient
            medications={medications.map((m) => ({ ...m, createdAt: m.createdAt.toISOString(), updatedAt: m.updatedAt.toISOString() }))}
            supplements={supplements.map((s) => ({ ...s, createdAt: s.createdAt.toISOString(), updatedAt: s.updatedAt.toISOString() }))}
            schedules={schedules.map((s) => ({
                id: s.id,
                kind: s.kind,
                name: s.name,
                dosage: s.dosage,
                notes: s.notes,
                pattern: s.pattern,
                everyN: s.everyN,
                daysOfWeek: s.daysOfWeek,
                timesOfDay: s.timesOfDay,
                startDate: s.startDate ? s.startDate.toISOString().slice(0, 10) : null,
                endDate: s.endDate ? s.endDate.toISOString().slice(0, 10) : null,
            }))}
            doses={doses.map((d) => ({
                id: d.id,
                scheduleName: d.schedule?.name ?? "Dose",
                scheduleKind: d.schedule?.kind ?? "OTHER",
                dosage: d.schedule?.dosage ?? null,
                scheduledAt: d.scheduledAt.toISOString(),
                loggedAt: d.loggedAt ? d.loggedAt.toISOString() : null,
                skippedAt: d.skippedAt ? d.skippedAt.toISOString() : null,
            }))}
            logs={logs.map((l) => ({
                id: l.id,
                therapeuticKind: l.therapeuticKind,
                name: l.name,
                doseAmount: l.doseAmount,
                doseUnit: l.doseUnit,
                notes: l.notes,
                loggedAt: l.loggedAt.toISOString(),
            }))}
            doseHistory30={doseHistory30.map((d) => ({
                id: d.id,
                scheduleName: d.schedule?.name ?? "Dose",
                scheduleKind: d.schedule?.kind ?? "OTHER",
                dosage: d.schedule?.dosage ?? null,
                scheduledAt: d.scheduledAt.toISOString(),
                loggedAt: d.loggedAt ? d.loggedAt.toISOString() : null,
                skippedAt: d.skippedAt ? d.skippedAt.toISOString() : null,
            }))}
            adherence={adherence}
            />
        </>
    );
}
