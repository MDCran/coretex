// @ts-nocheck
import React, { Activity, useEffect, useState } from 'react';
import { CheckCircle, AlertCircle, AlertTriangle, InfoCircle, Plus, LayoutAlt01, Clock, Calendar } from '@untitledui/icons';
import { Badge } from "@/components/base/badges/badges";
import { Button } from "react-aria-components";
import { PageHeader, EmptyState } from "../_components/workouts-ui";
import { GenerateTemplateButton } from "./_components/generate-template-button";

const FeaturedIcon = (p:any)=><div {...p}/>; const BloomCard = (p:any)=><div {...p}/>; const Card = (p:any)=><div {...p}/>; const SectionHeader = (p:any)=><div {...p}/>;

const severityIcon = { error: AlertCircle, warning: AlertTriangle, info: InfoCircle };
const severityColor = { error: "error", warning: "warning", info: "brand" };

export default function TemplatesPage({ client }) {
    const [data, setData] = useState(null);
    useEffect(() => {
        const handleMsg = (msg) => { if (msg.type === 'workouts:getTemplates' && msg.result) setData(msg.result); };
        client.onMessage(handleMsg);
        client.send({ type: 'workouts:getTemplates' });
        return () => client.offMessage(handleMsg);
    }, [client]);
    if (!data) return <div className="p-8 text-center text-[var(--c-text-tertiary)]">Loading templates...</div>;
    const {  } = data;
    
    return (
        <div className="flex flex-col gap-6">
            <PageHeader
                title="Templates"
                description="Build reusable workout blueprints with set targets and progression so every session starts in one tap."
                actions={
                    <div className="flex items-center gap-2">
                        <GenerateTemplateButton size="md" />
                        <Button size="md" color="primary" iconLeading={<Plus data-icon className="size-4" />} href="/workouts/templates/new">
                            New template
                        </Button>
                    </div>
                }
            />

            {templates.length === 0 ? (
                <Card>
                    <EmptyState
                        icon={LayoutAlt01}
                        title="Create your first template"
                        description="Save your go-to routines once — pre-loaded exercises, target sets and progression — and start them with a single tap."
                        action={
                            <Button size="md" color="primary" iconLeading={<Plus data-icon className="size-4" />} href="/workouts/templates/new">
                                New template
                            </Button>
                        }
                    />
                </Card>
            ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {templates.map((t) => {
                        const minutes = estimateTemplateMinutes(
                            t.exercises.map((te) => ({ targetSets: te.targetSets, restSec: te.restSec, perSetMode: te.perSetMode, setCount: te._count.sets })),
                        );
                        const lastUsed = t.workouts[0]?.date ?? null;
                        return (
                            <a href="#">
                                <Card className="flex h-full flex-col transition duration-100 ease-linear hover:bg-secondary_hover">
                                    <div className="flex items-start justify-between gap-2">
                                        <p className="text-sm font-semibold text-primary">{t.name}</p>
                                        <Badge color={t.progression === "NONE" ? "gray" : "brand"} size="sm">
                                            {SCHEME_LABEL[t.progression]}
                                        </Badge>
                                    </div>
                                    {t.note && <p className="mt-1 line-clamp-2 text-xs text-tertiary">{t.note}</p>}
                                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-tertiary">
                                        <span className="inline-flex items-center gap-1">
                                            <Activity className="size-3.5" aria-hidden="true" /> {t._count.exercises} exercises
                                        </span>
                                        {minutes > 0 && (
                                            <span className="inline-flex items-center gap-1">
                                                <Clock className="size-3.5" aria-hidden="true" /> ~{minutes} min
                                            </span>
                                        )}
                                        {t.progression === "FIVETHREEONE" && t.cycleWeek ? <span>week {t.cycleWeek}</span> : null}
                                    </div>
                                    <div className="mt-2 inline-flex items-center gap-1 text-xs text-quaternary">
                                        <Calendar className="size-3.5" aria-hidden="true" />
                                        {lastUsed ? `Last used ${timeAgo(lastUsed)}` : "Never used"}
                                    </div>
                                </Card>
                            </a>
                        );
                    })}
                </div>
            )}
        </div>
    );

}