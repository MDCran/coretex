// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { HabitsClient } from './habits-client';

export default function HabitsPage({ client }) {
    const [data, setData] = useState(null);
    useEffect(() => {
        const handleMsg = (msg) => { if (msg.type === 'health:getHabits' && msg.result) setData(msg.result); };
        client.onMessage(handleMsg);
        client.send({ type: 'health:getHabits' });
        return () => client.offMessage(handleMsg);
    }, [client]);
    if (!data) return <div className="p-8 text-center text-[var(--c-text-tertiary)]">Loading habits...</div>;
    return <HabitsClient {...data} />;
}