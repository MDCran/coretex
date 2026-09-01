"use server";

import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export interface RecentNotification {
    id: string;
    kind: string;
    severity: "INFO" | "WARN" | "DANGER" | "SUCCESS";
    title: string;
    body: string | null;
    href: string | null;
    read: boolean;
    createdAt: string;
}

/** Latest notifications for the bell dropdown (most recent first). */
export async function getRecentNotifications(limit = 8): Promise<{ items: RecentNotification[]; unread: number }> {
    const user = await requireUser();
    const [rows, unread] = await Promise.all([
        db.notification.findMany({
            where: { userId: user.id },
            orderBy: { createdAt: "desc" },
            take: Math.min(limit, 20),
            select: { id: true, kind: true, severity: true, title: true, body: true, href: true, readAt: true, createdAt: true },
        }),
        db.notification.count({ where: { userId: user.id, readAt: null } }),
    ]);
    return {
        unread,
        items: rows.map((n) => ({
            id: n.id,
            kind: n.kind,
            severity: n.severity,
            title: n.title,
            body: n.body,
            href: n.href,
            read: n.readAt != null,
            createdAt: n.createdAt.toISOString(),
        })),
    };
}

/** Mark a single notification as read (used when opening it from the bell). */
export async function markNotificationReadById(id: string): Promise<void> {
    const user = await requireUser();
    await db.notification.updateMany({ where: { id, userId: user.id, readAt: null }, data: { readAt: new Date() } });
}

/** Mark every unread notification as read. */
export async function markAllRead(): Promise<void> {
    const user = await requireUser();
    await db.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
}
