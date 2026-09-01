// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { JournalClient } from './journal-client';

export default function JournalPage({ client }) {
    const [data, setData] = useState(null);
    useEffect(() => {
        const handleMsg = (msg) => { if (msg.type === 'health:getJournal' && msg.result) setData(msg.result); };
        client.onMessage(handleMsg);
        client.send({ type: 'health:getJournal' });
        return () => client.offMessage(handleMsg);
    }, [client]);
    if (!data) return <div className="p-8 text-center text-[var(--c-text-tertiary)]">Loading journal...</div>;
    return <JournalClient {...data} />;
}