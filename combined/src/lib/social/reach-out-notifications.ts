import "server-only";

import { db } from "@/lib/db";
import { isReachOutDue } from "@/lib/social/format";

/** Stable href used both as the link and the dedupe key for a contact's reach-out alert. */
export function reachOutHref(contactId: string): string {
    return `/social/contacts/${contactId}`;
}

/**
 * Idempotently ensure reach-out notifications exist for every overdue
 * stay-in-touch contact, and clear stale ones.
 *
 * Dedupe strategy (no schema changes): there is at most ONE unread
 * AI_SUGGESTION notification per contact, keyed by href = /social/contacts/{id}.
 * - Overdue + no unread alert  → create one.
 * - Not overdue + unread alert → mark it read (resolved), so logging a
 *   reach-out (which clears overdue) auto-resolves the nudge.
 *
 * Safe to call on every /social load.
 */
export async function syncReachOutNotifications(userId: string): Promise<void> {
    const contacts = await db.socialContact.findMany({
        where: { userId, active: true, stayInTouch: true },
        select: { id: true, displayName: true, lastContactAt: true, stayInTouchDays: true },
    });

    // Existing reach-out notifications for this user, keyed by href.
    const hrefs = contacts.map((c) => reachOutHref(c.id));
    const existing = await db.notification.findMany({
        where: { userId, kind: "AI_SUGGESTION", href: { in: hrefs } },
        select: { id: true, href: true, readAt: true },
    });
    const openByHref = new Map(existing.filter((n) => n.readAt === null).map((n) => [n.href, n.id]));

    const toCreate: { userId: string; kind: "AI_SUGGESTION"; severity: "WARN"; title: string; body: string; href: string }[] = [];
    const toResolve: string[] = [];

    for (const c of contacts) {
        const href = reachOutHref(c.id);
        const overdue = isReachOutDue(c.lastContactAt, c.stayInTouchDays);
        const hasOpen = openByHref.has(href);
        if (overdue && !hasOpen) {
            toCreate.push({
                userId,
                kind: "AI_SUGGESTION",
                severity: "WARN",
                title: `Reach out to ${c.displayName}`,
                body: `It's been a while — your stay-in-touch cadence is every ${c.stayInTouchDays ?? 30} days.`,
                href,
            });
        } else if (!overdue && hasOpen) {
            toResolve.push(openByHref.get(href)!);
        }
    }

    if (toCreate.length) await db.notification.createMany({ data: toCreate });
    if (toResolve.length) {
        await db.notification.updateMany({ where: { id: { in: toResolve } }, data: { readAt: new Date() } });
    }
}

/** Resolve (mark read) any open reach-out alert for a single contact. */
export async function resolveReachOutNotification(userId: string, contactId: string): Promise<void> {
    await db.notification.updateMany({
        where: { userId, kind: "AI_SUGGESTION", href: reachOutHref(contactId), readAt: null },
        data: { readAt: new Date() },
    });
}
