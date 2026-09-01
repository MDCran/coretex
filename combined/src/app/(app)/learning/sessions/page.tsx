import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { SessionsClient } from "./sessions-client";

export default async function SessionsPage() {
    const user = await requireUser();
    const sessions = await db.learningSession.findMany({ where: { userId: user.id }, orderBy: { sessionDate: "desc" }, take: 400 });

    return (
        <SessionsClient
            sessions={sessions.map((s) => ({
                id: s.id,
                sessionDate: s.sessionDate.toISOString(),
                durationMinutes: s.durationMinutes,
                notes: s.notes,
                subject: s.subject,
                energy: s.energy,
                pomodoro: s.pomodoro,
            }))}
        />
    );
}
