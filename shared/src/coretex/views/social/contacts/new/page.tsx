// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { CheckCircle, AlertCircle, AlertTriangle, InfoCircle } from '@untitledui/icons';
import { PageHeader } from "@/coretex/views/workouts/_components/workouts-ui";
import { ContactForm } from "../../contact-form";

const FeaturedIcon = (p:any)=><div {...p}/>; const BloomCard = (p:any)=><div {...p}/>; const Card = (p:any)=><div {...p}/>; const SectionHeader = (p:any)=><div {...p}/>;

const severityIcon = { error: AlertCircle, warning: AlertTriangle, info: InfoCircle };
const severityColor = { error: "error", warning: "warning", info: "brand" };

export default function ContactsNewPage({ client }) {
    const [data, setData] = useState(null);
    useEffect(() => {
        const handleMsg = (msg) => { if (msg.type === 'social:getContactsNew' && msg.result) setData(msg.result); };
        client.onMessage(handleMsg);
        client.send({ type: 'social:getContactsNew' });
        return () => client.offMessage(handleMsg);
    }, [client]);
    if (!data) return <div className="p-8 text-center text-[var(--c-text-tertiary)]">Loading new...</div>;
    const {  } = data;
    
    return (
        <div className="mx-auto max-w-3xl">
            <PageHeader title="Add contact" description="Add someone to your network." />
            <ContactForm action={createContact} submitLabel="Create contact" cancelHref="/social/contacts" tags={tags} createTagAction={createTagReturning} />
        </div>
    );

}