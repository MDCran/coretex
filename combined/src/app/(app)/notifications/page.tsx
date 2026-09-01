import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { materializeDueReminders } from "@/lib/reminders-materialize";
import { NotificationsClient } from "./notifications-client";

export default async function NotificationsPage() {
    const user = await requireUser();

    // Surface any due/overdue recurring reminders before listing (no worker).
    await materializeDueReminders(user.id);

    const notifications = await db.notification.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 200,
    });

    return (
        <NotificationsClient
            notifications={notifications.map((n) => ({
                id: n.id,
                kind: n.kind,
                severity: n.severity,
                title: n.title,
                body: n.body,
                href: n.href,
                readAt: n.readAt?.toISOString() ?? null,
                createdAt: n.createdAt.toISOString(),
            }))}
        />
    );
}
