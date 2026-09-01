import Link from "next/link";
import { Users01, Star01, CalendarHeart01, Bell01, Gift01, ArrowRight, MessageTextSquare01, Zap, HeartHand } from "@untitledui/icons";
import { eachDayOfInterval, startOfDay, subDays, endOfWeek, differenceInCalendarDays } from "date-fns";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { fileUrl } from "@/lib/files";
import { Avatar } from "@/components/base/avatar/avatar";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Card, CardBody, CardHeader, EmptyHint, EmptyState } from "@/components/social/ui";
import { GradientCtaBanner } from "@/components/app-shell/gradient-cta-banner";
import { AiSuggestionCard } from "@/components/app-shell/ai-suggestion-card";
import { BatteryManager } from "@/components/social/battery-manager";
import { ReachOutActions } from "@/components/social/reach-out-actions";
import { ReconnectList, type ReconnectItem } from "@/components/social/reconnect-list";
import { AddToCalendarButton } from "@/components/social/add-to-calendar-button";
import { saveBattery, deleteBattery } from "@/lib/actions/social-battery";
import { addDateToCalendar } from "@/lib/actions/social-records";
import { scheduleReachOut, markReachedOut } from "@/lib/actions/social-contacts";
import { syncReachOutNotifications } from "@/lib/social/reach-out-notifications";
import { INTERACTION_TYPE_LABELS, CHANNEL_LABELS, labelOf } from "@/lib/social/enums";
import { fmtDate, fmtRelative, initialsOf, isReachOutDue, reachOutOverdueDays, daysUntilAnnual, fmtMonthDay } from "@/lib/social/format";

export const dynamic = "force-dynamic";

export default async function SocialDashboardPage() {
    const user = await requireUser();
    const now = new Date();

    // Stay-in-touch auto-remind: idempotently ensure/clear reach-out notifications.
    await syncReachOutNotifications(user.id);

    const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
    const [contacts, innerCircle, innerCircleCount, eventCount, dueReminders, batteryRows, recentInteractions, contactDates, dueDrafts] = await Promise.all([
        db.socialContact.findMany({
            where: { userId: user.id, active: true },
            select: { id: true, displayName: true, avatarKey: true, stayInTouch: true, stayInTouchDays: true, lastContactAt: true, birthday: true, innerCircle: true, closenessScore: true },
        }),
        db.socialContact.findMany({
            where: { userId: user.id, active: true, innerCircle: true },
            select: { id: true, displayName: true, avatarKey: true },
            orderBy: { displayName: "asc" },
            take: 12,
        }),
        db.socialContact.count({ where: { userId: user.id, active: true, innerCircle: true } }),
        db.socialEvent.count({ where: { userId: user.id } }),
        db.contactReminder.count({ where: { contact: { userId: user.id }, completed: false, scheduledFor: { lte: now } } }),
        db.socialBattery.findMany({
            where: { userId: user.id, date: { gte: startOfDay(subDays(now, 29)) } },
            orderBy: { date: "asc" },
        }),
        db.socialInteraction.findMany({
            where: { contact: { userId: user.id } },
            orderBy: { date: "desc" },
            take: 8,
            include: { contact: { select: { id: true, displayName: true, avatarKey: true } } },
        }),
        db.contactDate.findMany({
            where: { contact: { userId: user.id, active: true } },
            include: { contact: { select: { id: true, displayName: true, avatarKey: true } } },
        }),
        db.outreachDraft.findMany({
            where: { userId: user.id, archived: false, sentAt: null, dueAt: { not: null, lte: weekEnd } },
            orderBy: { dueAt: "asc" },
            take: 6,
            include: { contact: { select: { id: true, displayName: true, avatarKey: true } } },
        }),
    ]);

    // Reach-out list: stayInTouch contacts overdue, soonest-overdue first.
    const reachOut = contacts
        .filter((c) => c.stayInTouch && isReachOutDue(c.lastContactAt, c.stayInTouchDays))
        .sort((a, b) => (a.lastContactAt?.getTime() ?? 0) - (b.lastContactAt?.getTime() ?? 0))
        .slice(0, 8);

    // Reconnect priority (relationship intelligence): rank ALL active contacts by
    // staleness (days since last interaction) blended with closeness, so the people
    // who matter most and have gone quietest surface first. This is broader than the
    // stay-in-touch "Reach out" list above — it catches drifting relationships even
    // when no cadence is set.
    const reconnect: ReconnectItem[] = contacts
        .map((c) => {
            const daysSince = c.lastContactAt ? Math.max(0, differenceInCalendarDays(now, c.lastContactAt)) : null;
            const closeness = c.closenessScore;
            // Staleness: never-contacted (180d-equivalent baseline) ranks high; cap at 365.
            const staleness = daysSince == null ? 180 : Math.min(daysSince, 365);
            // Weight by closeness (0–10 → 1.0–2.0 multiplier) plus an inner-circle nudge.
            const closenessWeight = 1 + (closeness ?? 0) / 10;
            const innerNudge = c.innerCircle ? 1.25 : 1;
            const priority = staleness * closenessWeight * innerNudge;

            let tier = "Drifting";
            let tierColor: ReconnectItem["tierColor"] = "warning";
            const threshold = daysSince == null ? Infinity : daysSince;
            if (daysSince == null) {
                tier = "No contact yet";
                tierColor = "gray";
            } else if (threshold >= 120) {
                tier = "Dormant";
                tierColor = "error";
            } else if (threshold >= 45) {
                tier = "Fading";
                tierColor = "warning";
            } else {
                tier = "Drifting";
                tierColor = "warning";
            }

            return {
                priority,
                item: {
                    id: c.id,
                    displayName: c.displayName,
                    avatarUrl: c.avatarKey ? fileUrl(c.avatarKey) : null,
                    initials: initialsOf(c.displayName),
                    closeness,
                    daysSince,
                    lastLabel: fmtRelative(c.lastContactAt),
                    tier,
                    tierColor,
                } satisfies ReconnectItem,
            };
        })
        // Only surface people who have genuinely gone quiet (3+ weeks) or were never logged.
        .filter((r) => r.item.daysSince == null || r.item.daysSince >= 21)
        .sort((a, b) => b.priority - a.priority)
        .slice(0, 6)
        .map((r) => r.item);

    // Battery series for last 30 days (null-filled).
    const byDate = new Map(batteryRows.map((r) => [startOfDay(r.date).getTime(), r.energyLevel]));
    const series = eachDayOfInterval({ start: subDays(startOfDay(now), 29), end: startOfDay(now) }).map((d) => ({
        date: d.toISOString(),
        energy: byDate.get(d.getTime()) ?? null,
    }));
    const todayEnergy = byDate.get(startOfDay(now).getTime()) ?? null;
    const batteryLogs = [...batteryRows]
        .sort((a, b) => b.date.getTime() - a.date.getTime())
        .slice(0, 14)
        .map((r) => ({ id: r.id, date: r.date.toISOString(), energyLevel: r.energyLevel, notes: r.notes }));

    // Upcoming birthdays/dates within 60 days.
    type UpcomingItem = { key: string; contactId: string; dateId: string | null; name: string; avatarKey: string | null; label: string; date: Date; days: number };
    const upcoming: UpcomingItem[] = [];
    for (const c of contacts) {
        if (c.birthday) upcoming.push({ key: `b-${c.id}`, contactId: c.id, dateId: null, name: c.displayName, avatarKey: c.avatarKey, label: "Birthday", date: c.birthday, days: daysUntilAnnual(c.birthday) });
    }
    for (const d of contactDates) {
        upcoming.push({ key: `d-${d.id}`, contactId: d.contact.id, dateId: d.id, name: d.contact.displayName, avatarKey: d.contact.avatarKey, label: d.dateType, date: d.dateValue, days: daysUntilAnnual(d.dateValue) });
    }
    const upcomingSorted = upcoming.filter((u) => u.days <= 60).sort((a, b) => a.days - b.days).slice(0, 8);

    // Rule-based relationship nudge: if anyone is overdue for a reach-out, surface the
    // most-overdue person; otherwise fall back to the top reconnect candidate.
    const topReachOut = reachOut[0] ?? null;
    const topReachOutOverdue = topReachOut ? reachOutOverdueDays(topReachOut.lastContactAt, topReachOut.stayInTouchDays) : null;
    const topReconnect = reconnect[0] ?? null;
    const aiSocial =
        topReachOut && topReachOutOverdue && topReachOutOverdue > 0
            ? {
                  title: `Reach out to ${topReachOut.displayName}`,
                  body: `${topReachOut.displayName} is ${topReachOutOverdue} day${topReachOutOverdue === 1 ? "" : "s"} past your stay-in-touch cadence${reachOut.length > 1 ? `, and ${reachOut.length - 1} other${reachOut.length - 1 === 1 ? " is" : "s are"} overdue too` : ""}. A quick message goes a long way.`,
                  href: `/social/contacts/${topReachOut.id}`,
              }
            : topReconnect && topReconnect.daysSince != null
              ? {
                    title: `Reconnect with ${topReconnect.displayName}`,
                    body: `It's been ${topReconnect.daysSince} days since you last connected with ${topReconnect.displayName}. They're drifting — now's a good moment to check in.`,
                    href: `/social/contacts/${topReconnect.id}`,
                }
              : null;

    const stats = [
        { label: "Contacts", value: contacts.length, icon: Users01, href: "/social/contacts" },
        { label: "Inner circle", value: innerCircleCount, icon: Star01, href: "/social/contacts" },
        { label: "Events", value: eventCount, icon: CalendarHeart01, href: "/social/events" },
        { label: "Reminders due", value: dueReminders, icon: Bell01, href: "/social/contacts" },
    ];

    return (
        <div className="flex flex-col gap-6">
            <GradientCtaBanner
                tone="rose"
                icon={Users01}
                eyebrow="Stay connected"
                title="Nurture your relationships"
                description="Reach out, remember the moments that matter, and keep the people you care about close."
                primary={{ label: "Add a contact", href: "/social/contacts/new" }}
                secondary={{ label: "View all contacts", href: "/social/contacts" }}
            />

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {stats.map((s) => (
                    <Link key={s.label} href={s.href}>
                        <Card className="h-full transition duration-100 ease-linear hover:bg-secondary_hover hover:ring-brand">
                            <CardBody className="flex items-center gap-4">
                                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-secondary text-brand-secondary">
                                    <s.icon className="size-5" strokeWidth={2} aria-hidden="true" />
                                </div>
                                <div>
                                    <div className="text-display-xs font-semibold text-primary">{s.value}</div>
                                    <div className="text-sm text-tertiary">{s.label}</div>
                                </div>
                            </CardBody>
                        </Card>
                    </Link>
                ))}
            </div>

            {aiSocial && (
                <AiSuggestionCard
                    tone="rose"
                    iconName="heart-hand"
                    confidence="high"
                    title={aiSocial.title}
                    body={aiSocial.body}
                    href={aiSocial.href}
                    ctaLabel="Open contact"
                />
            )}

            {innerCircle.length > 0 && (
                <Card>
                    <CardHeader
                        title="Inner circle"
                        action={
                            <Button href="/social/contacts" color="link-color" size="sm" iconTrailing={<ArrowRight data-icon className="size-4" />}>
                                All contacts
                            </Button>
                        }
                    />
                    <CardBody>
                        <ul className="flex flex-wrap gap-4">
                            {innerCircle.map((c) => (
                                <li key={c.id}>
                                    <Link href={`/social/contacts/${c.id}`} className="flex flex-col items-center gap-1.5 text-center">
                                        <span className="relative">
                                            <Avatar size="lg" src={c.avatarKey ? fileUrl(c.avatarKey) : undefined} initials={initialsOf(c.displayName)} alt={c.displayName} />
                                            <Star01 className="absolute -right-0.5 -top-0.5 size-4 text-fg-warning-primary" aria-hidden="true" />
                                        </span>
                                        <span className="max-w-[4.5rem] truncate text-xs font-medium text-primary">{c.displayName}</span>
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </CardBody>
                </Card>
            )}

            <div className="grid gap-6 lg:grid-cols-3 lg:items-start">
                <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
                    <Card>
                        <CardHeader title="Reach out" action={<Button href="/social/contacts" color="link-color" size="sm" iconTrailing={<ArrowRight data-icon className="size-4" />}>All contacts</Button>} />
                        <CardBody>
                            {reachOut.length === 0 ? (
                                <EmptyHint>You're all caught up — no one is overdue.</EmptyHint>
                            ) : (
                                <ul className="flex flex-col divide-y divide-secondary">
                                    {reachOut.map((c) => {
                                        const overdue = reachOutOverdueDays(c.lastContactAt, c.stayInTouchDays);
                                        return (
                                            <li key={c.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                                                <div className="flex items-center justify-between gap-3 sm:justify-start">
                                                    <Link href={`/social/contacts/${c.id}`} className="flex items-center gap-3">
                                                        <Avatar size="sm" src={c.avatarKey ? fileUrl(c.avatarKey) : undefined} initials={initialsOf(c.displayName)} alt={c.displayName} />
                                                        <div>
                                                            <div className="text-sm font-medium text-primary">{c.displayName}</div>
                                                            <div className="text-xs text-tertiary">Last contact {fmtRelative(c.lastContactAt)}</div>
                                                        </div>
                                                    </Link>
                                                    {overdue && overdue > 0 ? (
                                                        <Badge size="sm" color="error">{overdue}d overdue</Badge>
                                                    ) : (
                                                        <Badge size="sm" color="warning">Due</Badge>
                                                    )}
                                                </div>
                                                <ReachOutActions contactId={c.id} scheduleAction={scheduleReachOut} markAction={markReachedOut} />
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </CardBody>
                    </Card>

                    <Card>
                        <CardHeader
                            title={
                                <span className="inline-flex items-center gap-2">
                                    <Zap className="size-4 text-fg-warning-primary" aria-hidden="true" /> Reconnect priority
                                </span>
                            }
                            action={<Button href="/social/contacts" color="link-color" size="sm" iconTrailing={<ArrowRight data-icon className="size-4" />}>All contacts</Button>}
                        />
                        <CardBody>
                            <ReconnectList items={reconnect} logAction={markReachedOut} />
                        </CardBody>
                    </Card>

                    <Card>
                        <CardHeader
                            title="Drafts due"
                            action={<Button href="/social/drafts" color="link-color" size="sm" iconTrailing={<ArrowRight data-icon className="size-4" />}>All drafts</Button>}
                        />
                        <CardBody>
                            {dueDrafts.length === 0 ? (
                                <EmptyHint>No drafts due this week.</EmptyHint>
                            ) : (
                                <ul className="flex flex-col divide-y divide-secondary">
                                    {dueDrafts.map((d) => {
                                        const overdueDraft = d.dueAt ? d.dueAt.getTime() < now.getTime() : false;
                                        return (
                                            <li key={d.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                                                <Link href="/social/drafts" className="flex min-w-0 items-center gap-3">
                                                    {d.contact ? (
                                                        <Avatar size="sm" src={d.contact.avatarKey ? fileUrl(d.contact.avatarKey) : undefined} initials={initialsOf(d.contact.displayName)} alt={d.contact.displayName} />
                                                    ) : (
                                                        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-tertiary">
                                                            <MessageTextSquare01 className="size-4" aria-hidden="true" />
                                                        </span>
                                                    )}
                                                    <div className="min-w-0">
                                                        <div className="text-sm font-medium text-primary">{d.contact?.displayName ?? "No contact"}</div>
                                                        <div className="truncate text-xs text-tertiary">
                                                            {d.channel ? `${labelOf(CHANNEL_LABELS, d.channel)} · ` : ""}{d.body}
                                                        </div>
                                                    </div>
                                                </Link>
                                                <Badge size="sm" color={overdueDraft ? "error" : "warning"}>{overdueDraft ? "Overdue" : fmtDate(d.dueAt)}</Badge>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </CardBody>
                    </Card>

                    <Card>
                        <CardHeader title="Recent interactions" />
                        <CardBody>
                            {recentInteractions.length === 0 ? (
                                contacts.length === 0 ? (
                                    <EmptyState
                                        icon={Users01}
                                        title="Start building your network"
                                        description="Add the people who matter, then log calls, coffees, and messages to see your relationships come to life here."
                                        action={{ label: "Add your first contact", href: "/social/contacts/new" }}
                                    />
                                ) : (
                                    <EmptyHint>No interactions logged yet — open a contact to log your first.</EmptyHint>
                                )
                            ) : (
                                <ul className="flex flex-col divide-y divide-secondary">
                                    {recentInteractions.map((it) => (
                                        <li key={it.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                                            <Link href={`/social/contacts/${it.contact.id}`} className="flex items-center gap-3">
                                                <Avatar size="sm" src={it.contact.avatarKey ? fileUrl(it.contact.avatarKey) : undefined} initials={initialsOf(it.contact.displayName)} alt={it.contact.displayName} />
                                                <div>
                                                    <div className="text-sm font-medium text-primary">{it.contact.displayName}</div>
                                                    <div className="text-xs text-tertiary">
                                                        {it.interactionType ? labelOf(INTERACTION_TYPE_LABELS, it.interactionType) : "Interaction"} · {fmtDate(it.date)}
                                                    </div>
                                                </div>
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </CardBody>
                    </Card>
                </div>

                <div className="flex flex-col gap-6 lg:sticky lg:top-8">
                    <BatteryManager today={todayEnergy} series={series} logs={batteryLogs} saveAction={saveBattery} deleteAction={deleteBattery} />

                    <Card className="flex flex-col">
                        <CardHeader
                            title="Upcoming birthdays & dates"
                            action={
                                <Button href="/social/calendar" color="link-color" size="sm" iconTrailing={<ArrowRight data-icon className="size-4" />}>
                                    Calendar
                                </Button>
                            }
                        />
                        <CardBody>
                            {upcomingSorted.length === 0 ? (
                                <EmptyHint>Nothing in the next 60 days.</EmptyHint>
                            ) : (
                                <ul className="flex flex-col divide-y divide-secondary">
                                    {upcomingSorted.map((u) => (
                                        <li key={u.key} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                                            <Link href={`/social/contacts/${u.contactId}`} className="flex min-w-0 items-center gap-3">
                                                <Avatar size="sm" src={u.avatarKey ? fileUrl(u.avatarKey) : undefined} initials={initialsOf(u.name)} alt={u.name} />
                                                <div className="min-w-0">
                                                    <div className="truncate text-sm font-medium text-primary">{u.name}</div>
                                                    <div className="flex items-center gap-1 text-xs text-tertiary">
                                                        <Gift01 className="size-3" aria-hidden="true" /> {u.label} · {fmtMonthDay(u.date)}
                                                    </div>
                                                </div>
                                            </Link>
                                            <div className="flex shrink-0 items-center gap-2">
                                                {u.dateId && <AddToCalendarButton id={u.dateId} action={addDateToCalendar} />}
                                                <Badge size="sm" color={u.days === 0 ? "success" : "gray"}>{u.days === 0 ? "Today" : `${u.days}d`}</Badge>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </CardBody>
                    </Card>
                </div>
            </div>
        </div>
    );
}
