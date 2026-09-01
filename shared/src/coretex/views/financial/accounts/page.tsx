// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { AccountsClient } from './accounts-client';

export default function AccountsPage({ client }) {
    const [data, setData] = useState(null);
    useEffect(() => {
        const handleMsg = (msg) => { if (msg.type === 'financial:getAccounts' && msg.result) setData(msg.result); };
        client.onMessage(handleMsg);
        client.send({ type: 'financial:getAccounts' });
        return () => client.offMessage(handleMsg);
    }, [client]);
    if (!data) return <div className="p-8 text-center text-[var(--c-text-tertiary)]">Loading accounts...</div>;
    return <AccountsClient accounts={data.accounts} client={client} />;
}