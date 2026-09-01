// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { InstitutionsClient } from './institutions-client';

export default function InstitutionsPage({ client }) {
    const [data, setData] = useState(null);
    useEffect(() => {
        const handleMsg = (msg) => { if (msg.type === 'financial:getInstitutions' && msg.result) setData(msg.result); };
        client.onMessage(handleMsg);
        client.send({ type: 'financial:getInstitutions' });
        return () => client.offMessage(handleMsg);
    }, [client]);
    if (!data) return <div className="p-8 text-center text-[var(--c-text-tertiary)]">Loading institutions...</div>;
    return <InstitutionsClient {...data} />;
}