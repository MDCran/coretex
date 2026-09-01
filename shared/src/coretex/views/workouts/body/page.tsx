// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { BodyMetricsClient } from './_components/body-metrics-client';

export default function BodyPage({ client }) {
    const [data, setData] = useState(null);
    useEffect(() => {
        const handleMsg = (msg) => { if (msg.type === 'workouts:getBody' && msg.result) setData(msg.result); };
        client.onMessage(handleMsg);
        client.send({ type: 'workouts:getBody' });
        return () => client.offMessage(handleMsg);
    }, [client]);
    if (!data) return <div className="p-8 text-center text-[var(--c-text-tertiary)]">Loading body...</div>;
    return <BodyMetricsClient {...data} />;
}