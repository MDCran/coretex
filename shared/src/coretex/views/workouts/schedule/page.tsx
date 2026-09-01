// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { CheckCircle, AlertCircle, AlertTriangle, InfoCircle } from '@untitledui/icons';
import { PageHeader } from "../_components/workouts-ui";
import { AdherenceStats } from "./_components/adherence-stats";
import { ScheduleManager } from "./_components/schedule-manager";

const FeaturedIcon = (p:any)=><div {...p}/>; const BloomCard = (p:any)=><div {...p}/>; const Card = (p:any)=><div {...p}/>; const SectionHeader = (p:any)=><div {...p}/>;

const severityIcon = { error: AlertCircle, warning: AlertTriangle, info: InfoCircle };
const severityColor = { error: "error", warning: "warning", info: "brand" };

export default function SchedulePage({ client }) {
    const [data, setData] = useState(null);
    useEffect(() => {
        const handleMsg = (msg) => { if (msg.type === 'workouts:getSchedule' && msg.result) setData(msg.result); };
        client.onMessage(handleMsg);
        client.send({ type: 'workouts:getSchedule' });
        return () => client.offMessage(handleMsg);
    }, [client]);
    if (!data) return <div className="p-8 text-center text-[var(--c-text-tertiary)]">Loading schedule...</div>;
    const {  } = data;
    
    return (
        <div className="flex flex-col gap-6">
            <PageHeader
                title="Training schedule"
                description="Plan your week ahead, build an unbroken streak, and keep your adherence honest. The button lives in the planner below."
            />

            <AdherenceStats plans={statsPlans} />

            <ScheduleManager plans={plans} templates={templates} showHeaderButton />
        </div>
    );

}