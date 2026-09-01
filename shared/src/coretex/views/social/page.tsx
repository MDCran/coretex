// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { CheckCircle, AlertCircle, AlertTriangle, InfoCircle, Zap, Users01, Star01, MessageTextSquare01, HeartHand, Gift01, ArrowRight } from '@untitledui/icons';
import { AiSuggestionCard } from "@/components/app-shell/ai-suggestion-card";
import { GradientCtaBanner } from "@/components/app-shell/gradient-cta-banner";
import { Avatar } from "@/components/base/avatar/avatar";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "react-aria-components";
import { AddToCalendarButton } from "./add-to-calendar-button";
import { BatteryManager } from "./battery-manager";
import { labelOf, CHANNEL_LABELS, INTERACTION_TYPE_LABELS } from "./enums";
import { initialsOf, reachOutOverdueDays, fmtRelative, fmtDate, fmtMonthDay } from "./format";
import { ReachOutActions } from "./reach-out-actions";
import { ReconnectList } from "./reconnect-list";
import { CardBody, CardHeader, EmptyHint, EmptyState } from "./ui";

const FeaturedIcon = (p:any)=><div {...p}/>; const BloomCard = (p:any)=><div {...p}/>; const Card = (p:any)=><div {...p}/>; const SectionHeader = (p:any)=><div {...p}/>;

const severityIcon = { error: AlertCircle, warning: AlertTriangle, info: InfoCircle };
const severityColor = { error: "error", warning: "warning", info: "brand" };

export default function OverviewPage({ client }) {
    const [data, setData] = useState(null);
    useEffect(() => {
        const handleMsg = (msg) => { if (msg.type === 'social:getOverview' && msg.result) setData(msg.result); };
        client.onMessage(handleMsg);
        client.send({ type: 'social:getOverview' });
        return () => client.offMessage(handleMsg);
    }, [client]);
    if (!data) return <div className="p-8 text-center text-[var(--c-text-tertiary)]">Loading ....</div>;
    const {  } = data;
    
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
                    <a href="#">
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
                    </a>
                ))}
            </div>

            {aiSocial && (
                <AiSuggestionCard
                    tone="rose"
                    icon={HeartHand}
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
                                    <a href="#">
                                        <span className="relative">
                                            <Avatar size="lg" src={c.avatarKey ? fileUrl(c.avatarKey) : undefined} initials={initialsOf(c.displayName)} alt={c.displayName} />
                                            <Star01 className="absolute -right-0.5 -top-0.5 size-4 text-fg-warning-primary" aria-hidden="true" />
                                        </span>
                                        <span className="max-w-[4.5rem] truncate text-xs font-medium text-primary">{c.displayName}</span>
                                    </a>
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
                                                    <a href="#">
                                                        <Avatar size="sm" src={c.avatarKey ? fileUrl(c.avatarKey) : undefined} initials={initialsOf(c.displayName)} alt={c.displayName} />
                                                        <div>
                                                            <div className="text-sm font-medium text-primary">{c.displayName}</div>
                                                            <div className="text-xs text-tertiary">Last contact {fmtRelative(c.lastContactAt)}</div>
                                                        </div>
                                                    </a>
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
                            title="Reach outs due"
                            action={<Button href="/social/drafts" color="link-color" size="sm" iconTrailing={<ArrowRight data-icon className="size-4" />}>All reach outs</Button>}
                        />
                        <CardBody>
                            {dueDrafts.length === 0 ? (
                                <EmptyHint>No reach outs due this week.</EmptyHint>
                            ) : (
                                <ul className="flex flex-col divide-y divide-secondary">
                                    {dueDrafts.map((d) => {
                                        const overdueDraft = d.dueAt ? d.dueAt.getTime() < now.getTime() : false;
                                        return (
                                            <li key={d.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                                                <a href="#">
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
                                                </a>
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
                                            <a href="#">
                                                <Avatar size="sm" src={it.contact.avatarKey ? fileUrl(it.contact.avatarKey) : undefined} initials={initialsOf(it.contact.displayName)} alt={it.contact.displayName} />
                                                <div>
                                                    <div className="text-sm font-medium text-primary">{it.contact.displayName}</div>
                                                    <div className="text-xs text-tertiary">
                                                        {it.interactionType ? labelOf(INTERACTION_TYPE_LABELS, it.interactionType) : "Interaction"} · {fmtDate(it.date)}
                                                    </div>
                                                </div>
                                            </a>
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
                                            <a href="#">
                                                <Avatar size="sm" src={u.avatarKey ? fileUrl(u.avatarKey) : undefined} initials={initialsOf(u.name)} alt={u.name} />
                                                <div className="min-w-0">
                                                    <div className="truncate text-sm font-medium text-primary">{u.name}</div>
                                                    <div className="flex items-center gap-1 text-xs text-tertiary">
                                                        <Gift01 className="size-3" aria-hidden="true" /> {u.label} · {fmtMonthDay(u.date)}
                                                    </div>
                                                </div>
                                            </a>
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