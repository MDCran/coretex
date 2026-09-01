// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { PhotosClient } from './photos-client';

export default function PhotosPage({ client }) {
    const [data, setData] = useState(null);
    useEffect(() => {
        const handleMsg = (msg) => { if (msg.type === 'health:getPhotos' && msg.result) setData(msg.result); };
        client.onMessage(handleMsg);
        client.send({ type: 'health:getPhotos' });
        return () => client.offMessage(handleMsg);
    }, [client]);
    if (!data) return <div className="p-8 text-center text-[var(--c-text-tertiary)]">Loading photos...</div>;
    return <PhotosClient {...data} />;
}