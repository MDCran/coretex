// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { SocialCalendarClient } from '@/components/social/social-calendar-client';

export default function CalendarPage({ client }) {
    const [data, setData] = useState(null);
    useEffect(() => {
        const handleMsg = (msg) => { if (msg.type === 'social:getCalendar' && msg.result) setData(msg.result); };
        client.onMessage(handleMsg);
        client.send({ type: 'social:getCalendar' });
        return () => client.offMessage(handleMsg);
    }, [client]);
    if (!data) return <div className="p-8 text-center text-[var(--c-text-tertiary)]">Loading calendar...</div>;
    return <SocialCalendarClient {...data} />;
}