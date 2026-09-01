// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { SubscriptionsClient } from './subscriptions-client';

export default function SubscriptionsPage({ client }) {
    const [data, setData] = useState(null);
    useEffect(() => {
        const handleMsg = (msg) => { if (msg.type === 'financial:getSubscriptions' && msg.result) setData(msg.result); };
        client.onMessage(handleMsg);
        client.send({ type: 'financial:getSubscriptions' });
        return () => client.offMessage(handleMsg);
    }, [client]);
    if (!data) return <div className="p-8 text-center text-[var(--c-text-tertiary)]">Loading subscriptions...</div>;
    return <SubscriptionsClient {...data} />;
}