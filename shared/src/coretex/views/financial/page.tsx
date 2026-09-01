// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { OverviewClient } from './overview-client';

export default function OverviewPage({ client }) {
    const [data, setData] = useState(null);
    useEffect(() => {
        const handleMsg = (msg) => { if (msg.type === 'financial:getOverview' && msg.result) setData(msg.result); };
        client.onMessage(handleMsg);
        client.send({ type: 'financial:getOverview' });
        return () => client.offMessage(handleMsg);
    }, [client]);
    if (!data) return <div className="p-8 text-center text-[var(--c-text-tertiary)]">Loading ....</div>;
    return <OverviewClient {...data} />;
}