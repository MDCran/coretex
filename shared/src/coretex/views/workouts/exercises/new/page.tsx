// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { CheckCircle, AlertCircle, AlertTriangle, InfoCircle } from '@untitledui/icons';
import { PageHeader } from "../../_components/workouts-ui";
import { ExerciseForm } from "../_components/exercise-form";

const FeaturedIcon = (p:any)=><div {...p}/>; const BloomCard = (p:any)=><div {...p}/>; const Card = (p:any)=><div {...p}/>; const SectionHeader = (p:any)=><div {...p}/>;

const severityIcon = { error: AlertCircle, warning: AlertTriangle, info: InfoCircle };
const severityColor = { error: "error", warning: "warning", info: "brand" };

export default function ExercisesNewPage({ client }) {
    const [data, setData] = useState(null);
    useEffect(() => {
        const handleMsg = (msg) => { if (msg.type === 'workouts:getExercisesNew' && msg.result) setData(msg.result); };
        client.onMessage(handleMsg);
        client.send({ type: 'workouts:getExercisesNew' });
        return () => client.offMessage(handleMsg);
    }, [client]);
    if (!data) return <div className="p-8 text-center text-[var(--c-text-tertiary)]">Loading new...</div>;
    const {  } = data;
    
    return (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
            <PageHeader
                title="New exercise"
                description="Add a custom movement to your library and choose what you want to track for it."
            />
            <ExerciseForm parents={parents} />
        </div>
    );

}