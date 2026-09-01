// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { CheckCircle, AlertCircle, AlertTriangle, InfoCircle, Plus } from '@untitledui/icons';
import { Button } from "react-aria-components";
import { PageHeader } from "../_components/workouts-ui";
import { ExerciseAttemptProvider } from "./_components/exercise-attempt-provider";
import { mapExerciseLibrary } from "./_components/map-exercise-library";

const FeaturedIcon = (p:any)=><div {...p}/>; const BloomCard = (p:any)=><div {...p}/>; const Card = (p:any)=><div {...p}/>; const SectionHeader = (p:any)=><div {...p}/>;

const severityIcon = { error: AlertCircle, warning: AlertTriangle, info: InfoCircle };
const severityColor = { error: "error", warning: "warning", info: "brand" };

export default function ExercisesPage({ client }) {
    const [data, setData] = useState(null);
    useEffect(() => {
        const handleMsg = (msg) => { if (msg.type === 'workouts:getExercises' && msg.result) setData(msg.result); };
        client.onMessage(handleMsg);
        client.send({ type: 'workouts:getExercises' });
        return () => client.offMessage(handleMsg);
    }, [client]);
    if (!data) return <div className="p-8 text-center text-[var(--c-text-tertiary)]">Loading exercises...</div>;
    const {  } = data;
    
    return (
        <div className="flex flex-col gap-6">
            <PageHeader
                title="Exercise library"
                description="Browse hundreds of built-in movements, log a quick attempt, or add your own custom exercises."
                actions={
                    <Button size="md" color="primary" iconLeading={<Plus data-icon className="size-4" />} href="/workouts/exercises/new">
                        New exercise
                    </Button>
                }
            />

            <ExerciseAttemptProvider exercises={mapExerciseLibrary(exercises, user.id)} unitSystem={unitSystem} />
        </div>
    );

}