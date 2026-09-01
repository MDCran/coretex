// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { IncomeClient } from './income-client';

export default function IncomePage({ client }) {
    const [data, setData] = useState(null);
    useEffect(() => {
        const handleMsg = (msg) => { if (msg.type === 'financial:getIncome' && msg.result) setData(msg.result); };
        client.onMessage(handleMsg);
        client.send({ type: 'financial:getIncome' });
        return () => client.offMessage(handleMsg);
    }, [client]);
    if (!data) return <div className="p-8 text-center text-[var(--c-text-tertiary)]">Loading income...</div>;
    return <IncomeClient {...data} />;
}