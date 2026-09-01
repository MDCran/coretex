// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { CheckCircle, AlertCircle, AlertTriangle, InfoCircle, Target04, Scales01, Heart, Droplets01, CheckDone01 } from '@untitledui/icons';
import { AiSuggestionCard } from "@/components/app-shell/ai-suggestion-card";
import { ModuleHero } from "@/components/app-shell/module-hero";
import { volumeToDisplay, volumeUnit } from "@/lib/units";
import { formatDate } from "../personal/personal-ui";
import { ProgressBar, Button } from "react-aria-components";
import { OverviewActionCard } from "./_components/overview-action-card";
import { StatWithUnit } from "./_components/stat-with-unit";
import { OverviewCharts } from "./overview-client";

const FeaturedIcon = (p:any)=><div {...p}/>; const BloomCard = (p:any)=><div {...p}/>; const Card = (p:any)=><div {...p}/>; const SectionHeader = (p:any)=><div {...p}/>;

const severityIcon = { error: AlertCircle, warning: AlertTriangle, info: InfoCircle };
const severityColor = { error: "error", warning: "warning", info: "brand" };

export default function OverviewPage({ client }) {
    const [data, setData] = useState(null);
    useEffect(() => {
        const handleMsg = (msg) => { if (msg.type === 'health:getOverview' && msg.result) setData(msg.result); };
        client.onMessage(handleMsg);
        client.send({ type: 'health:getOverview' });
        return () => client.offMessage(handleMsg);
    }, [client]);
    if (!data) return <div className="p-8 text-center text-[var(--c-text-tertiary)]">Loading ....</div>;
    const {  } = data;
    
    return (
        <div className="flex flex-col gap-6">
            <ModuleHero
                theme="emerald"
                icon={Heart}
                eyebrow="How are you feeling?"
                title="Stay on top of your health"
                description="Log your metrics, vitals, sleep and habits — then watch the trends move in the right direction."
                actions={[
                    { label: "Log a metric", href: "/health/metrics", icon: Scales01 },
                    { label: "Track nutrition", href: "/nutrition", icon: Target04, color: "secondary" },
                ]}
            />

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <StatWithUnit
                    label="Latest weight"
                    value={latestWeight ? `${weightToDisplay(latestWeight.value, unitSystem)} ${wUnit}` : "—"}
                    sub={latestWeight ? formatDate(latestWeight.measuredAt) : "Log your first"}
                    unitHint={wUnit}
                />
                <StatWithUnit label="Last sleep" value={fmtHours(lastSleep?.totalMinutes)} sub={lastSleep ? formatDate(lastSleep.date) : "Log your first"} />
                <StatWithUnit label="Calories today" value={String(Math.round(caloriesToday))} sub={goal?.calories ? `of ${Math.round(goal.calories)} kcal` : "No goal set"} unitHint="kcal" />
                <StatWithUnit label="Habits done" value={`${habitsDone}/${habits.length}`} sub="today" />
            </div>

            {habits.length > 0 && habitsDone < habits.length && (
                <AiSuggestionCard
                    tone="brand"
                    icon={CheckDone01}
                    confidence="medium"
                    title={`${habits.length - habitsDone} habit${habits.length - habitsDone === 1 ? "" : "s"} still open today`}
                    body={`You've checked off ${habitsDone} of ${habits.length} active habits. Knock out the rest before the day ends to keep your streaks alive.`}
                    href="/health/habits"
                    ctaLabel="Open habits"
                />
            )}

            <div className="grid gap-6 lg:grid-cols-3">
                <OverviewActionCard icon={Droplets01} title="Water today" actionLabel="Log water" actionHref="/nutrition" actionIcon={Droplets01}>
                    <p className="mb-3 text-sm text-tertiary">
                        {volumeToDisplay(waterMl, unitSystem)} / {volumeToDisplay(waterGoal, unitSystem)} {volumeUnit(unitSystem)}
                    </p>
                    <ProgressBar value={waterMl} max={waterGoal} />
                </OverviewActionCard>

                <OverviewActionCard icon={Heart} title="Longest sober streak" actionLabel="Open sobriety" actionHref="/health/sobriety" actionIcon={Heart}>
                    {longestSoberCounter ? (
                        <>
                            <p className="text-display-xs font-semibold text-primary">
                                {longestSoberDays} <span className="text-sm font-medium text-tertiary">day{longestSoberDays === 1 ? "" : "s"}</span>
                            </p>
                            <p className="mt-1 text-sm text-tertiary">{longestSoberCounter.name}</p>
                        </>
                    ) : (
                        <p className="text-sm text-tertiary">Start a counter and watch the days add up.</p>
                    )}
                </OverviewActionCard>

                <OverviewActionCard icon={CheckDone01} title="Habits due today" actionLabel="Open habits" actionHref="/health/habits" actionIcon={CheckDone01}>
                    {habits.length === 0 ? (
                        <p className="text-sm text-tertiary">Build a daily habit and check it off here.</p>
                    ) : (
                        <ul className="flex flex-col gap-1.5">
                            {habits.slice(0, 5).map((h) => (
                                <li key={h.id} className="flex items-center gap-2 text-sm">
                                    <span className={h.logs.length > 0 ? "text-success-primary" : "text-tertiary"}>{h.logs.length > 0 ? "✓" : "○"}</span>
                                    <span className={h.logs.length > 0 ? "text-tertiary line-through" : "text-secondary"}>{h.name}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </OverviewActionCard>
            </div>

            <OverviewCharts weight={weightData} sleep={sleepData} />

            <Card>
                <h3 className="mb-3 text-md font-semibold text-primary">Quick log</h3>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                    {QUICK_LINKS.map((q) => {
                        const Icon = q.icon;
                        return (
                            <Button
                                key={q.href}
                                href={q.href}
                                size="sm"
                                color="secondary"
                                iconLeading={<Icon data-icon className="size-4" />}
                                className="justify-start"
                            >
                                {q.label}
                            </Button>
                        );
                    })}
                </div>
            </Card>
        </div>
    );

}