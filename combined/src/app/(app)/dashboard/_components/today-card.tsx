"use client";

import { useState, useTransition } from "react";
import { Calendar, Check, ChevronRight, Clock, ClockSnooze } from "@untitledui/icons";
import { toast } from "sonner";
import { Button } from "@/components/base/buttons/button";
import { Card } from "@/components/life/life-ui";
import { reminderIcon } from "@/components/application/reminders/icon-registry";
import { completeReminder, snoozeReminder } from "@/lib/actions/reminders";
import { formatTime } from "@/lib/dates";
import { cx } from "@/utils/cx";

export interface EventItem {
    id: string;
    title: string;
    allDay: boolean;
    /** ISO datetime. */
    startsAt: string;
}

export interface ReminderItem {
    id: string;
    title: string;
    /** Icon component NAME string from the registry. */
    icon: string | null;
    /** ISO datetime. */
    nextDueAt: string;
    overdue: boolean;
}

interface TodayCardProps {
    events: EventItem[];
    reminders: ReminderItem[];
    tomorrowCount: number;
}

function timeLabel(iso: string): string {
    return formatTime(iso);
}

export function TodayCard({ events, reminders, tomorrowCount }: TodayCardProps) {
    const [isPending, startTransition] = useTransition();
    const [busyId, setBusyId] = useState<string | null>(null);

    function run(id: string, action: (fd: FormData) => Promise<void>, extra: Record<string, string>, ok: string) {
        setBusyId(id);
        startTransition(async () => {
            const fd = new FormData();
            fd.set("id", id);
            for (const [k, v] of Object.entries(extra)) fd.set(k, v);
            try {
                await action(fd);
                toast.success(ok);
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Couldn't update reminder.");
            } finally {
                setBusyId(null);
            }
        });
    }

    const isEmpty = events.length === 0 && reminders.length === 0;

    return (
        <Card className="flex h-full flex-col gap-4">
            <div className="flex items-center gap-2">
                <Calendar className="size-5 text-brand-secondary" aria-hidden="true" />
                <h2 className="text-md font-semibold text-primary">Today's schedule</h2>
            </div>

            {isEmpty ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
                    <Calendar className="size-8 text-fg-quaternary" aria-hidden="true" />
                    <p className="text-sm text-tertiary">No events or reminders today.</p>
                </div>
            ) : (
                <ul className="flex flex-col divide-y divide-border-secondary">
                    {events.map((e) => (
                        <li key={`ev-${e.id}`} className="flex items-center gap-3 py-2.5">
                            <Clock className="size-4 shrink-0 text-fg-quaternary" aria-hidden="true" />
                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-secondary">{e.title}</span>
                            <span className="shrink-0 text-sm text-tertiary">{e.allDay ? "All day" : timeLabel(e.startsAt)}</span>
                        </li>
                    ))}
                    {reminders.map((r) => {
                        const Icon = reminderIcon(r.icon);
                        const busy = isPending && busyId === r.id;
                        return (
                            <li key={`rm-${r.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
                                <Icon className={cx("size-4 shrink-0", r.overdue ? "text-error-primary" : "text-fg-quaternary")} aria-hidden="true" />
                                <span className="min-w-0 flex-1 truncate text-sm font-medium text-secondary">{r.title}</span>
                                {r.overdue && <span className="shrink-0 text-xs font-medium text-error-primary">Overdue</span>}
                                <div className="flex shrink-0 items-center gap-1">
                                    <Button
                                        size="sm"
                                        color="tertiary"
                                        iconLeading={Check}
                                        aria-label={`Mark ${r.title} done`}
                                        isLoading={busy}
                                        isDisabled={isPending}
                                        onClick={() => run(r.id, completeReminder, {}, "Reminder done.")}
                                    >
                                        Done
                                    </Button>
                                    <Button
                                        size="sm"
                                        color="tertiary"
                                        iconLeading={ClockSnooze}
                                        aria-label={`Snooze ${r.title} 1 day`}
                                        isDisabled={isPending}
                                        onClick={() => run(r.id, snoozeReminder, { days: "1" }, "Snoozed 1 day.")}
                                    >
                                        1d
                                    </Button>
                                    <Button
                                        size="sm"
                                        color="tertiary"
                                        aria-label={`Snooze ${r.title} 7 days`}
                                        isDisabled={isPending}
                                        onClick={() => run(r.id, snoozeReminder, { days: "7" }, "Snoozed 7 days.")}
                                    >
                                        7d
                                    </Button>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}

            {tomorrowCount > 0 && (
                <p className="text-xs text-tertiary">
                    Tomorrow: {tomorrowCount} {tomorrowCount === 1 ? "item" : "items"} scheduled.
                </p>
            )}

            <div className="mt-auto flex items-center gap-4">
                <Button href="/calendar" color="link-color" size="sm" iconTrailing={ChevronRight}>
                    Calendar
                </Button>
                <Button href="/calendar/reminders" color="link-gray" size="sm">
                    Reminders
                </Button>
            </div>
        </Card>
    );
}
