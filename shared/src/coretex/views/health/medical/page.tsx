// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { MedicalClient } from './medical-client';

export default function MedicalPage({ client }) {
    const [data, setData] = useState(null);
    useEffect(() => {
        const handleMsg = (msg) => { if (msg.type === 'health:getMedical' && msg.result) setData(msg.result); };
        client.onMessage(handleMsg);
        client.send({ type: 'health:getMedical' });
        return () => client.offMessage(handleMsg);
    }, [client]);
    if (!data) return <div className="p-8 text-center text-[var(--c-text-tertiary)]">Loading medical...</div>;
    return <MedicalClient {...data} />;
}