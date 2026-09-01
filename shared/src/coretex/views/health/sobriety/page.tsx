// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { SobrietyClient } from './sobriety-client';

export default function SobrietyPage({ client }) {
    const [data, setData] = useState(null);
    useEffect(() => {
        const handleMsg = (msg) => { if (msg.type === 'health:getSobriety' && msg.result) setData(msg.result); };
        client.onMessage(handleMsg);
        client.send({ type: 'health:getSobriety' });
        return () => client.offMessage(handleMsg);
    }, [client]);
    if (!data) return <div className="p-8 text-center text-[var(--c-text-tertiary)]">Loading sobriety...</div>;
    return <SobrietyClient {...data} />;
}