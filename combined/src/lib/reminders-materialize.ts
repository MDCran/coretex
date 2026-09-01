import "server-only";

import { db } from "@/lib/db";

/**
 * Deterministic, human-readable `body` for a materialized reminder notification.
 * It doubles as the idempotency key: at most one notification per (reminder,
 * due date). The due date is encoded so a *new* occurrence (after the user
 * advances the reminder) materializes its own notification. Exact-match
 * deduping via this string keeps the helper a single bulk query.
 */
function reminderBody(reminderId: string, dueAt: Date): string {
    return `Reminder due ${dueAt.toISOString()} · ref:${reminderId}`;
}

/**
 * On-load reminder materializer (no background worker).
 *
 * For each non-archived RecurringReminder whose `nextDueAt <= now`, ensure a
 * Notification exists so it surfaces in the bell/notifications without a cron.
 * Idempotent: we dedupe by a deterministic marker on the notification body, so
 * calling this repeatedly (on /notifications, /calendar, dashboard load) will
 * not create duplicates for the same reminder + due date.
 *
 * Does NOT advance `nextDueAt` — the user completes/snoozes the reminder, which
 * is what moves it forward. Cheap: one indexed query + a single bulk existence
 * check; only inserts when something is genuinely new.
 */
export async function materializeDueReminders(userId: string): Promise<number> {
    const now = new Date();

    const due = await db.recurringReminder.findMany({
        where: { userId, archived: false, nextDueAt: { lte: now } },
        select: { id: true, title: true, nextDueAt: true },
    });
    if (due.length === 0) return 0;

    // Build the set of bodies we'd want to exist, then fetch which already do
    // (we never want a second copy per occurrence).
    const wanted = new Map<string, (typeof due)[number]>();
    for (const r of due) wanted.set(reminderBody(r.id, r.nextDueAt), r);

    const existing = await db.notification.findMany({
        where: { userId, kind: "TODO_DUE", body: { in: [...wanted.keys()] } },
        select: { body: true },
    });
    for (const e of existing) {
        if (e.body) wanted.delete(e.body);
    }
    if (wanted.size === 0) return 0;

    await db.notification.createMany({
        data: [...wanted.entries()].map(([body, r]) => ({
            userId,
            kind: "TODO_DUE" as const,
            severity: "INFO" as const,
            title: r.title,
            // Body doubles as the dedupe key (stable per reminder + due date).
            body,
            href: "/calendar/reminders",
        })),
    });

    return wanted.size;
}
