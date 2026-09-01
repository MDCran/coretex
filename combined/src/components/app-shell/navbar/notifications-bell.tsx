"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell01, CheckDone01, Inbox01 } from "@untitledui/icons";
import { Button as AriaButton, Dialog as AriaDialog, DialogTrigger as AriaDialogTrigger, Popover as AriaPopover } from "react-aria-components";
import { formatDistanceToNow } from "date-fns";
import { getRecentNotifications, markAllRead, markNotificationReadById, type RecentNotification } from "@/lib/actions/notifications";
import { cx } from "@/utils/cx";

const DOT: Record<RecentNotification["severity"], string> = {
    INFO: "bg-utility-blue-500",
    SUCCESS: "bg-utility-green-500",
    WARN: "bg-utility-yellow-500",
    DANGER: "bg-error-solid",
};

/** Top-navbar notifications bell: unread badge + dropdown of recent items, with a link to the full page. */
export function NotificationsBell({ count = 0, className }: { count?: number; className?: string }) {
    const router = useRouter();
    const [unread, setUnread] = useState(count);
    const [items, setItems] = useState<RecentNotification[] | null>(null);
    const [loading, setLoading] = useState(false);
    const display = unread > 99 ? "99+" : String(unread);

    async function load() {
        setLoading(true);
        try {
            const res = await getRecentNotifications(8);
            setItems(res.items);
            setUnread(res.unread);
        } catch {
            setItems([]);
        } finally {
            setLoading(false);
        }
    }

    async function onOpen(open: boolean) {
        if (open) void load();
    }

    async function openItem(n: RecentNotification) {
        if (!n.read) {
            setItems((prev) => prev?.map((i) => (i.id === n.id ? { ...i, read: true } : i)) ?? prev);
            setUnread((u) => Math.max(0, u - 1));
            void markNotificationReadById(n.id);
        }
        router.push(n.href ?? "/notifications");
    }

    async function onMarkAll() {
        setItems((prev) => prev?.map((i) => ({ ...i, read: true })) ?? prev);
        setUnread(0);
        await markAllRead();
        router.refresh();
    }

    return (
        <AriaDialogTrigger onOpenChange={onOpen}>
            <AriaButton
                aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
                className={cx(
                    "relative flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-fg-quaternary outline-focus-ring transition duration-100 ease-linear hover:bg-primary_hover hover:text-fg-secondary focus-visible:outline-2 focus-visible:outline-offset-2",
                    className,
                )}
            >
                <Bell01 className="size-5" aria-hidden="true" />
                {unread > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-error-solid px-1 text-[10px] font-semibold text-white ring-2 ring-[color:var(--color-bg-primary)]">
                        {display}
                    </span>
                )}
            </AriaButton>

            <AriaPopover
                placement="bottom end"
                offset={8}
                className="w-[min(22rem,calc(100vw-1.5rem))] origin-top-right rounded-xl bg-primary shadow-xl ring-1 ring-secondary outline-hidden entering:animate-in entering:fade-in entering:zoom-in-95 exiting:animate-out exiting:fade-out exiting:zoom-out-95 motion-reduce:animate-none motion-reduce:duration-0"
            >
                <AriaDialog aria-label="Notifications" className="flex max-h-[min(28rem,80vh)] flex-col outline-hidden">
                    <div className="flex items-center justify-between gap-2 border-b border-secondary px-4 py-3">
                        <p className="text-sm font-semibold text-primary">
                            Notifications{unread > 0 && <span className="ml-1.5 text-tertiary">({unread})</span>}
                        </p>
                        {unread > 0 && (
                            <button
                                type="button"
                                onClick={() => void onMarkAll()}
                                className="inline-flex items-center gap-1 text-xs font-medium text-brand-secondary transition hover:text-brand-secondary_hover"
                            >
                                <CheckDone01 className="size-3.5" aria-hidden="true" /> Mark all read
                            </button>
                        )}
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto">
                        {loading && items === null ? (
                            <p className="px-4 py-8 text-center text-sm text-tertiary">Loading…</p>
                        ) : !items || items.length === 0 ? (
                            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                                <Inbox01 className="size-6 text-fg-quaternary" aria-hidden="true" />
                                <p className="text-sm text-tertiary">You're all caught up.</p>
                            </div>
                        ) : (
                            <ul className="flex flex-col">
                                {items.map((n) => (
                                    <li key={n.id}>
                                        <button
                                            type="button"
                                            onClick={() => void openItem(n)}
                                            className={cx(
                                                "flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-secondary_hover",
                                                !n.read && "bg-secondary_subtle",
                                            )}
                                        >
                                            <span className={cx("mt-1.5 size-2 shrink-0 rounded-full", n.read ? "bg-transparent ring-1 ring-secondary" : DOT[n.severity])} aria-hidden="true" />
                                            <span className="min-w-0 flex-1">
                                                <span className={cx("block truncate text-sm", n.read ? "font-medium text-secondary" : "font-semibold text-primary")}>{n.title}</span>
                                                {n.body && <span className="mt-0.5 block line-clamp-2 text-xs text-tertiary">{n.body}</span>}
                                                <span className="mt-0.5 block text-xs text-quaternary">{formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}</span>
                                            </span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    <div className="border-t border-secondary p-2">
                        <Link
                            href="/notifications"
                            className="flex items-center justify-center rounded-lg px-3 py-2 text-sm font-semibold text-brand-secondary transition hover:bg-secondary_hover"
                        >
                            View all notifications
                        </Link>
                    </div>
                </AriaDialog>
            </AriaPopover>
        </AriaDialogTrigger>
    );
}
