// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { CheckCircle, AlertCircle, AlertTriangle, InfoCircle } from '@untitledui/icons';
import { CreditSection } from "../_components/credit-section";

const FeaturedIcon = (p:any)=><div {...p}/>; const BloomCard = (p:any)=><div {...p}/>; const Card = (p:any)=><div {...p}/>; const SectionHeader = (p:any)=><div {...p}/>;

const severityIcon = { error: AlertCircle, warning: AlertTriangle, info: InfoCircle };
const severityColor = { error: "error", warning: "warning", info: "brand" };

export default function CreditPage({ client }) {
    const [data, setData] = useState(null);
    useEffect(() => {
        const handleMsg = (msg) => { if (msg.type === 'financial:getCredit' && msg.result) setData(msg.result); };
        client.onMessage(handleMsg);
        client.send({ type: 'financial:getCredit' });
        return () => client.offMessage(handleMsg);
    }, [client]);
    if (!data) return <div className="p-8 text-center text-[var(--c-text-tertiary)]">Loading credit...</div>;
    const { scores } = data;
    
    return (
        <div className="flex flex-col gap-6">
            <SectionHeader title="Credit scores" description="Track your score from each bureau over time." />
            <CreditSection scores={creditScores} />
        </div>
    );

}