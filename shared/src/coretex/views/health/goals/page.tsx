// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { GoalsClient } from './goals-client';

export default function GoalsPage({ client }) {
    const [data, setData] = useState(null);
    useEffect(() => {
        const handleMsg = (msg) => { if (msg.type === 'health:getGoals' && msg.result) setData(msg.result); };
        client.onMessage(handleMsg);
        client.send({ type: 'health:getGoals' });
        return () => client.offMessage(handleMsg);
    }, [client]);
    if (!data) return <div className="p-8 text-center text-[var(--c-text-tertiary)]">Loading goals...</div>;
    return <GoalsClient {...data} />;
}