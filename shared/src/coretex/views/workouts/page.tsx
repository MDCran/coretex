// @ts-nocheck
import React, { Activity, useEffect, useState } from 'react';
import { CheckCircle, AlertCircle, AlertTriangle, InfoCircle, TrendUp02, Plus, Lightning01, Calendar, Award01 } from '@untitledui/icons';
import { AiSuggestionCard } from "@/components/app-shell/ai-suggestion-card";
import { Badge } from "@/components/base/badges/badges";
import { DeltaBadge } from "@/components/foundations/delta-badge";
import { titleCase } from "@/coretex/labels";
import { Button } from "react-aria-components";
import { AdherenceCard } from "./_components/adherence-card";
import { PlanSummaryCard } from "./_components/plan-summary-card";
import { WorkoutsHero } from "./_components/workouts-hero";
import { WorkoutsOverviewCharts } from "./_components/workouts-overview-charts";
import { Stat } from "./_components/workouts-ui";

const FeaturedIcon = (p:any)=><div {...p}/>; const BloomCard = (p:any)=><div {...p}/>; const Card = (p:any)=><div {...p}/>; const SectionHeader = (p:any)=><div {...p}/>;

const severityIcon = { error: AlertCircle, warning: AlertTriangle, info: InfoCircle };
const severityColor = { error: "error", warning: "warning", info: "brand" };

export default function OverviewPage({ client }) {
    const [data, setData] = useState(null);
    useEffect(() => {
        const handleMsg = (msg) => { if (msg.type === 'workouts:getOverview' && msg.result) setData(msg.result); };
        client.onMessage(handleMsg);
        client.send({ type: 'workouts:getOverview' });
        return () => client.offMessage(handleMsg);
    }, [client]);
    if (!data) return <div className="p-8 text-center text-[var(--c-text-tertiary)]">Loading ....</div>;
    const {  } = data;
    
    return (
        <div className="flex flex-col gap-6">
            <WorkoutsHero templates={templates.map((t) => ({ id: t.id, name: t.name }))} />

            {activeCycle && (
                <Card className="flex flex-wrap items-center justify-between gap-3 bg-secondary_subtle">
                    <div className="flex items-center gap-3">
                        <Badge color={PHASE_COLOR[activeCycle.phase]} size="lg">
                            {PHASE_LABEL[activeCycle.phase]}
                        </Badge>
                        <div>
                            <p className="text-sm font-semibold text-primary">Active training cycle</p>
                            <p className="text-xs text-tertiary">
                                Day {cycleDays + 1} · started {activeCycle.startDate.toLocaleDateString()}
                                {activeCycle.endDate ? ` · ends ${activeCycle.endDate.toLocaleDateString()}` : ""}
                            </p>
                        </div>
                    </div>
                    <Button size="sm" color="secondary" href="/workouts/body">
                        Manage cycles
                    </Button>
                </Card>
            )}

            <PlanSummaryCard plans={summaryPlans} />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Stat
                    label="Workouts this week"
                    value={weekWorkouts.length}
                    sub={
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                            <span>since Monday</span>
                            <DeltaBadge delta={workoutsWowDelta} tone="directional" hideWhenEven />
                        </span>
                    }
                />
                <Stat
                    label="Volume this week"
                    value={`${Math.round(weightToDisplay(weekVol, unitSystem)).toLocaleString()} ${wU}`}
                    sub={
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                            <span>vs last week</span>
                            <DeltaBadge delta={volumeWowDelta} unit={wU} tone="directional" hideWhenEven />
                        </span>
                    }
                />
                <Stat label="Recent PRs" value={recentPRs.length} sub="latest achievements" />
            </div>

            {weekWorkouts.length === 0 && (
                <AiSuggestionCard
                    tone="rose"
                    icon={Lightning01}
                    confidence="medium"
                    title="No workouts logged this week"
                    body="You haven't trained since Monday. A single session keeps your momentum and adherence on track — even a short one counts."
                    href="/workouts/log"
                    ctaLabel="Start a session"
                />
            )}

            <WorkoutsOverviewCharts volumeData={volumeData} muscleData={muscleData} volumeUnit={wU} />

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                    <SectionHeader
                        title="Recent workouts"
                        action={
                            <Button size="sm" color="link-color" href="/workouts/log">
                                View log
                            </Button>
                        }
                    />
                    <div className="mt-4 flex flex-col gap-2">
                        {recentWorkouts.length === 0 ? (
                            <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
                                <FeaturedIcon icon={Activity} color="brand" theme="light" size="lg" />
                                <div className="flex flex-col gap-1">
                                    <p className="text-sm font-semibold text-primary">No workouts yet</p>
                                    <p className="text-sm text-tertiary">Start your first workout to see it here.</p>
                                </div>
                            </div>
                        ) : (
                            recentWorkouts.map((w) => {
                                const completedSets = w.exercises.reduce((s, we) => s + we.sets.filter((x) => x.completed).length, 0);
                                const vol = w.exercises.reduce((s, we) => s + we.sets.filter((x) => x.completed).reduce((v, x) => v + setVolume(x), 0), 0);
                                return (
                                    <a href="#">
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-semibold text-primary">{w.name ?? "Workout"}</p>
                                            <p className="truncate text-xs text-tertiary">
                                                {w.date.toLocaleDateString()} · {w.exercises.length} exercises · {completedSets} sets
                                                {!w.endedAt && <span className="ml-1 text-warning-primary">· in progress</span>}
                                            </p>
                                        </div>
                                        <span className="shrink-0 text-xs font-medium text-tertiary">{Math.round(weightToDisplay(vol, unitSystem)).toLocaleString()} {wU}</span>
                                    </a>
                                );
                            })
                        )}
                    </div>
                </Card>

                <Card>
                    <SectionHeader title="Recent PRs" action={<Award01 className="size-5 text-fg-quaternary" />} />
                    <div className="mt-4 flex flex-col gap-2">
                        {recentPRs.length === 0 ? (
                            <p className="text-sm text-tertiary">No personal records yet. Finish a workout to start tracking.</p>
                        ) : (
                            recentPRs.map((pr) => (
                                <div key={pr.id} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 ring-1 ring-secondary ring-inset">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-medium text-primary">{pr.exercise.name}</p>
                                        <p className="text-xs text-tertiary">
                                            {titleCase(pr.recordType)} · {pr.achievedOn.toLocaleDateString()}
                                        </p>
                                    </div>
                                    <span className="shrink-0 text-sm font-semibold text-brand-secondary">
                                        {pr.recordType === "reps"
                                            ? `${pr.value} reps`
                                            : pr.recordType === "time"
                                              ? formatSeconds(pr.value)
                                              : pr.recordType === "distance"
                                                ? formatMeters(pr.value)
                                                : formatWeight(pr.value, unitSystem)}
                                    </span>
                                </div>
                            ))
                        )}
                    </div>
                </Card>
            </div>

            <AdherenceCard plans={adherencePlans} />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <a href="#">
                    <Plus className="size-5 text-fg-brand-primary" />
                    <span className="text-sm font-semibold text-primary">Start a workout</span>
                </a>
                <a href="#">
                    <Calendar className="size-5 text-fg-brand-primary" />
                    <span className="text-sm font-semibold text-primary">Manage templates</span>
                </a>
                <a href="#">
                    <TrendUp02 className="size-5 text-fg-brand-primary" />
                    <span className="text-sm font-semibold text-primary">Body & metrics</span>
                </a>
            </div>
        </div>
    );

}