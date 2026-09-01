// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { VitalsClient } from './vitals-client';

export default function VitalsPage({ client }) {
    const [data, setData] = useState(null);
    useEffect(() => {
        const handleMsg = (msg) => { if (msg.type === 'health:getVitals' && msg.result) setData(msg.result); };
        client.onMessage(handleMsg);
        client.send({ type: 'health:getVitals' });
        return () => client.offMessage(handleMsg);
    }, [client]);
    if (!data) return <div className="p-8 text-center text-[var(--c-text-tertiary)]">Loading vitals...</div>;
    return <VitalsClient {...data} />;
}