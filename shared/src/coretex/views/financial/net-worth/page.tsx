// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { NetWorthClient } from './net-worth-client';

export default function NetWorthPage({ client }) {
    const [data, setData] = useState(null);
    useEffect(() => {
        const handleMsg = (msg) => { if (msg.type === 'financial:getNetWorth' && msg.result) setData(msg.result); };
        client.onMessage(handleMsg);
        client.send({ type: 'financial:getNetWorth' });
        return () => client.offMessage(handleMsg);
    }, [client]);
    if (!data) return <div className="p-8 text-center text-[var(--c-text-tertiary)]">Loading net-worth...</div>;
    return <NetWorthClient {...data} />;
}