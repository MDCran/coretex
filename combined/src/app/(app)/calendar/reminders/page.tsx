import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fileUrl } from "@/lib/files";
import { RemindersClient, type ReminderRow } from "./reminders-client";

export const dynamic = "force-dynamic";

export default async function RemindersPage() {
    const user = await requireUser();

    const [reminders, contacts] = await Promise.all([
        db.recurringReminder.findMany({
            where: { userId: user.id },
            include: { contact: { select: { id: true, displayName: true, avatarKey: true } } },
            orderBy: [{ archived: "asc" }, { nextDueAt: "asc" }],
        }),
        db.socialContact.findMany({
            where: { userId: user.id, active: true },
            select: { id: true, displayName: true },
            orderBy: { displayName: "asc" },
        }),
    ]);

    const rows: ReminderRow[] = reminders.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        location: r.location,
        icon: r.icon,
        cadence: r.cadence,
        intervalN: r.intervalN,
        dayOfMonth: r.dayOfMonth,
        nextDueAt: r.nextDueAt.toISOString(),
        lastCompletedAt: r.lastCompletedAt?.toISOString() ?? null,
        archived: r.archived,
        link: r.link,
        phone: r.phone,
        contact: r.contact
            ? {
                  id: r.contact.id,
                  displayName: r.contact.displayName,
                  avatarUrl: r.contact.avatarKey ? fileUrl(r.contact.avatarKey) : null,
              }
            : null,
    }));

    return <RemindersClient reminders={rows} contacts={contacts} />;
}
