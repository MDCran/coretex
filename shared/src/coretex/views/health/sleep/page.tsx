// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { SleepClient } from './sleep-client';

export default function SleepPage({ client }) {
    const [data, setData] = useState(null);
    useEffect(() => {
        const handleMsg = (msg) => { if (msg.type === 'health:getSleep' && msg.result) setData(msg.result); };
        client.onMessage(handleMsg);
        client.send({ type: 'health:getSleep' });
        return () => client.offMessage(handleMsg);
    }, [client]);
    if (!data) return <div className="p-8 text-center text-[var(--c-text-tertiary)]">Loading sleep...</div>;
    return <SleepClient {...data} />;
}