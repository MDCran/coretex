// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { AnalyticsClient } from './analytics-client';

export default function AnalyticsPage({ client }) {
    const [data, setData] = useState(null);
    useEffect(() => {
        const handleMsg = (msg) => { if (msg.type === 'tasks:getAnalytics' && msg.result) setData(msg.result); };
        client.onMessage(handleMsg);
        client.send({ type: 'tasks:getAnalytics' });
        return () => client.offMessage(handleMsg);
    }, [client]);
    if (!data) return <div className="p-8 text-center text-[var(--c-text-tertiary)]">Loading analytics...</div>;
    return <AnalyticsClient {...data} />;
}