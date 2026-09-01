// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { MedicationsClient } from '@/components/application/peptides/medications-client';

export default function MedicationsPage({ client }) {
    const [data, setData] = useState(null);
    useEffect(() => {
        const handleMsg = (msg) => { if (msg.type === 'health:getMedications' && msg.result) setData(msg.result); };
        client.onMessage(handleMsg);
        client.send({ type: 'health:getMedications' });
        return () => client.offMessage(handleMsg);
    }, [client]);
    if (!data) return <div className="p-8 text-center text-[var(--c-text-tertiary)]">Loading medications...</div>;
    return <MedicationsClient {...data} />;
}