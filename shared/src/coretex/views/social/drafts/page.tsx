// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { CheckCircle, AlertCircle, AlertTriangle, InfoCircle } from '@untitledui/icons';
import { PageHeader } from "../../workouts/_components/workouts-ui";
import { DraftsManager } from "../drafts-manager";

const FeaturedIcon = (p:any)=><div {...p}/>; const BloomCard = (p:any)=><div {...p}/>; const Card = (p:any)=><div {...p}/>; const SectionHeader = (p:any)=><div {...p}/>;

const severityIcon = { error: AlertCircle, warning: AlertTriangle, info: InfoCircle };
const severityColor = { error: "error", warning: "warning", info: "brand" };

export default function DraftsPage({ client }) {
    const [data, setData] = useState(null);
    useEffect(() => {
        const handleMsg = (msg) => { if (msg.type === 'social:getDrafts' && msg.result) setData(msg.result); };
        client.onMessage(handleMsg);
        client.send({ type: 'social:getDrafts' });
        return () => client.offMessage(handleMsg);
    }, [client]);
    if (!data) return <div className="p-8 text-center text-[var(--c-text-tertiary)]">Loading drafts...</div>;
    const {  } = data;
    
    return (
        <div>
            <PageHeader title="Reach outs" description="Write outreach ahead of time, set a deadline, and never miss the moment to reach out." />
            <DraftsManager
                drafts={items}
                contacts={contacts}
                actions={{
                    createAction: createDraft,
                    updateAction: updateDraft,
                    markSentAction: markDraftSent,
                    archiveAction: archiveDraft,
                    deleteAction: deleteDraft,
                }}
            />
        </div>
    );

}