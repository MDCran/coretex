// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { PeptidesOverviewClient } from '@/components/application/peptides/overview-client';

export default function PeptidesPage({ client }) {
    const [data, setData] = useState(null);
    useEffect(() => {
        const handleMsg = (msg) => { if (msg.type === 'health:getPeptides' && msg.result) setData(msg.result); };
        client.onMessage(handleMsg);
        client.send({ type: 'health:getPeptides' });
        return () => client.offMessage(handleMsg);
    }, [client]);
    if (!data) return <div className="p-8 text-center text-[var(--c-text-tertiary)]">Loading peptides...</div>;
    return <PeptidesOverviewClient {...data} />;
}