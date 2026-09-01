// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { MetricsClient } from './metrics-client';

export default function MetricsPage({ client }) {
    const [data, setData] = useState(null);
    useEffect(() => {
        const handleMsg = (msg) => { if (msg.type === 'health:getMetrics' && msg.result) setData(msg.result); };
        client.onMessage(handleMsg);
        client.send({ type: 'health:getMetrics' });
        return () => client.offMessage(handleMsg);
    }, [client]);
    if (!data) return <div className="p-8 text-center text-[var(--c-text-tertiary)]">Loading metrics...</div>;
    return <MetricsClient {...data} />;
}