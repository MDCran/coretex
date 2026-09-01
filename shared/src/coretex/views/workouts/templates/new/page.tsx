// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { CheckCircle, AlertCircle, AlertTriangle, InfoCircle } from '@untitledui/icons';
import { mapExerciseLibrary } from "../../exercises/_components/map-exercise-library";
import { TemplateEditor } from "../_components/template-editor";

const FeaturedIcon = (p:any)=><div {...p}/>; const BloomCard = (p:any)=><div {...p}/>; const Card = (p:any)=><div {...p}/>; const SectionHeader = (p:any)=><div {...p}/>;

const severityIcon = { error: AlertCircle, warning: AlertTriangle, info: InfoCircle };
const severityColor = { error: "error", warning: "warning", info: "brand" };

export default function TemplatesNewPage({ client }) {
    const [data, setData] = useState(null);
    useEffect(() => {
        const handleMsg = (msg) => { if (msg.type === 'workouts:getTemplatesNew' && msg.result) setData(msg.result); };
        client.onMessage(handleMsg);
        client.send({ type: 'workouts:getTemplatesNew' });
        return () => client.offMessage(handleMsg);
    }, [client]);
    if (!data) return <div className="p-8 text-center text-[var(--c-text-tertiary)]">Loading new...</div>;
    const {  } = data;
    
    return (
        <div className="flex flex-col gap-6">
<TemplateEditor library={mapExerciseLibrary(library, user.id)} unitSystem={settings?.unitSystem ?? "IMPERIAL"} />
        </div>
    );

}