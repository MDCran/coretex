// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { StatementsClient } from './statements-client';

export default function StatementsPage({ client }) {
    const [data, setData] = useState(null);
    useEffect(() => {
        const handleMsg = (msg) => { if (msg.type === 'financial:getStatements' && msg.result) setData(msg.result); };
        client.onMessage(handleMsg);
        client.send({ type: 'financial:getStatements' });
        return () => client.offMessage(handleMsg);
    }, [client]);
    if (!data) return <div className="p-8 text-center text-[var(--c-text-tertiary)]">Loading statements...</div>;
    return <StatementsClient {...data} />;
}