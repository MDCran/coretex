// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { DebtClient } from './debt-client';

export default function DebtPage({ client }) {
    const [data, setData] = useState(null);
    useEffect(() => {
        const handleMsg = (msg) => { if (msg.type === 'financial:getDebt' && msg.result) setData(msg.result); };
        client.onMessage(handleMsg);
        client.send({ type: 'financial:getDebt' });
        return () => client.offMessage(handleMsg);
    }, [client]);
    if (!data) return <div className="p-8 text-center text-[var(--c-text-tertiary)]">Loading debt...</div>;
    return <DebtClient {...data} />;
}