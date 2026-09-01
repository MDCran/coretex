"use client";

import { useState } from "react";
import { AlertCircle, AlertTriangle, Bell01, CheckCircle, CheckDone01, InfoCircle, LinkExternal01, Trash02 } from "@untitledui/icons";
import { toast } from "sonner";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { cx } from "@/utils/cx";
import { formatDateTime } from "@/lib/dates";
import { Card, SectionHeader } from "@/components/life/life-ui";
import { deleteNotification, markAllNotificationsRead, markNotificationRead, markNotificationUnread } from "@/lib/actions/focus";

type Severity = "INFO" | "WARN" | "DANGER" | "SUCCESS";

interface NotificationRow {
    id: string;
    kind: string;
    severity: Severity;
    title: string;
    body: string | null;
    href: string | null;
    readAt: string | null;
    createdAt: string;
}

const SEVERITY: Record<Severity, { badge: "gray" | "warning" | "error" | "success"; label: string; icon: typeof InfoCircle; tone: string }> = {
    INFO: { badge: "gray", label: "Info", icon: InfoCircle, tone: "text-fg-quaternary" },
    WARN: { badge: "warning", label: "Warning", icon: AlertTriangle, tone: "text-warning-primary" },
    DANGER: { badge: "error", label: "Danger", icon: AlertCircle, tone: "text-error-primary" },
    SUCCESS: { badge: "success", label: "Success", icon: CheckCircle, tone: "text-success-primary" },
};

/** Hide the internal dedupe marker that reminder-materialization stores in `body`. */
function displayBody(body: string | null): string | null {
    if (!body) return body;
    return body.replace(/\s*·\s*ref:[^\s]+$/, "").replace(/^Reminder due .+/, "Due now");
}

async function run(action: (fd: FormData) => Promise<void>, fd: FormData, ok = "Done") {
    try {
        await action(fd);
        toast.success(ok);
    } catch (e) {
        toast.error(e instanceof Error ? e.message : "Something went wrong");
    }
}

type TabKey = "unread" | "read" | "all";

const TABS: { key: TabKey; label: string }[] = [
    { key: "unread", label: "Unread" },
    { key: "read", label: "Read" },
    { key: "all", label: "All" },
];

export function NotificationsClient({ notifications }: { notifications: NotificationRow[] }) {
    // Default view shows ONLY unread.
    const [filter, setFilter] = useState<TabKey>("unread");
    const unread = notifications.filter((n) => !n.readAt);
    const read = notifications.filter((n) => n.readAt);
    const list = filter === "unread" ? unread : filter === "read" ? read : notifications;

    const counts: Record<TabKey, number> = { unread: unread.length, read: read.length, all: notifications.length };
    const emptyCopy: Record<TabKey, string> = {
        unread: "You're all caught up.",
        read: "No read notifications.",
        all: "No notifications yet.",
    };

    return (
        <div className="page-shell">
            <div className="mb-6 flex flex-col gap-0.5 sm:gap-1">
                <h1 className="module-title">Notifications</h1>
                <p className="text-sm text-tertiary sm:text-md">Alerts, reminders and suggestions from across LifeOS.</p>
            </div>

            <div className="flex flex-col gap-6">
                <SectionHeader
                    title={`${unread.length} unread`}
                    action={
                        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                            <div className="flex w-full overflow-x-auto rounded-lg p-0.5 ring-1 ring-secondary ring-inset scrollbar-hide sm:w-auto" role="tablist" aria-label="Filter notifications">
                                {TABS.map((t) => (
                                    <button
                                        key={t.key}
                                        type="button"
                                        role="tab"
                                        aria-selected={filter === t.key}
                                        onClick={() => setFilter(t.key)}
                                        className={cx(
                                            "flex items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium transition",
                                            filter === t.key ? "bg-secondary text-primary" : "text-tertiary hover:text-secondary",
                                        )}
                                    >
                                        {t.label}
                                        <span className="tabular-nums text-tertiary">{counts[t.key]}</span>
                                    </button>
                                ))}
                            </div>
                            <Button size="sm" color="secondary" iconLeading={CheckDone01} isDisabled={unread.length === 0} onClick={() => run(markAllNotificationsRead as unknown as (fd: FormData) => Promise<void>, new FormData(), "All marked read")}>
                                Mark all read
                            </Button>
                        </div>
                    }
                />

                {list.length === 0 ? (
                    <Card>
                        <div className="flex flex-col items-center gap-2 py-8 text-center">
                            <Bell01 className="size-8 text-fg-quaternary" aria-hidden="true" />
                            <p className="text-sm text-tertiary">{emptyCopy[filter]}</p>
                        </div>
                    </Card>
                ) : (
                    <div className="flex flex-col gap-2">
                        {list.map((n) => {
                            const s = SEVERITY[n.severity];
                            const Icon = s.icon;
                            const isUnread = !n.readAt;
                            return (
                                <div key={n.id} className={cx("flex items-start gap-3 rounded-xl p-4 ring-1 ring-inset transition", isUnread ? "bg-secondary_subtle ring-secondary" : "bg-primary ring-secondary")}>
                                    <Icon className={cx("mt-0.5 size-5 shrink-0", s.tone)} aria-hidden="true" />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className={cx("text-sm", isUnread ? "font-semibold text-primary" : "text-secondary")}>{n.title}</span>
                                            <Badge color={s.badge} size="sm">{s.label}</Badge>
                                            {isUnread && <span className="size-2 rounded-full bg-brand-solid" aria-label="Unread" />}
                                        </div>
                                        {displayBody(n.body) && <p className="mt-0.5 text-sm text-tertiary">{displayBody(n.body)}</p>}
                                        <p className="mt-1 text-xs text-quaternary">{formatDateTime(n.createdAt)}</p>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1">
                                        {n.href && <Button size="sm" color="tertiary" iconLeading={LinkExternal01} href={n.href} aria-label="Open" />}
                                        {isUnread ? (
                                            <Button size="sm" color="tertiary" iconLeading={CheckCircle} aria-label="Mark read" onClick={() => { const fd = new FormData(); fd.set("id", n.id); run(markNotificationRead, fd, "Marked read"); }} />
                                        ) : (
                                            <Button size="sm" color="tertiary" iconLeading={Bell01} aria-label="Mark unread" onClick={() => { const fd = new FormData(); fd.set("id", n.id); run(markNotificationUnread, fd, "Marked unread"); }} />
                                        )}
                                        <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} aria-label="Delete" onClick={() => { const fd = new FormData(); fd.set("id", n.id); run(deleteNotification, fd, "Deleted"); }} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
