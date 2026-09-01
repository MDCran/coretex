// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { CheckCircle, AlertCircle, AlertTriangle, InfoCircle, Plus } from '@untitledui/icons';
import { Button } from "react-aria-components";
import { PageHeader } from "../../workouts/_components/workouts-ui";
import { ContactsDirectory } from "../contacts-directory";

const FeaturedIcon = (p:any)=><div {...p}/>; const BloomCard = (p:any)=><div {...p}/>; const Card = (p:any)=><div {...p}/>; const SectionHeader = (p:any)=><div {...p}/>;

const severityIcon = { error: AlertCircle, warning: AlertTriangle, info: InfoCircle };
const severityColor = { error: "error", warning: "warning", info: "brand" };

export default function ContactsPage({ client }) {
    const [data, setData] = useState(null);
    useEffect(() => {
        const handleMsg = (msg) => { if (msg.type === 'social:getContacts' && msg.result) setData(msg.result); };
        client.onMessage(handleMsg);
        client.send({ type: 'social:getContacts' });
        return () => client.offMessage(handleMsg);
    }, [client]);
    if (!data) return <div className="p-8 text-center text-[var(--c-text-tertiary)]">Loading contacts...</div>;
    const {  } = data;
    
    return (
        <div>
            <PageHeader title="Contacts" description={`${contacts.length} ${contacts.length === 1 ? "person" : "people"} in your network`}>
                <Button href="/social/contacts/new" color="primary" iconLeading={<Plus data-icon className="size-4" />}>
                    Add contact
                </Button>
            </PageHeader>
            <ContactsDirectory contacts={data} tags={tagRows} createTagAction={createTag} updateTagAction={updateTag} deleteTagAction={deleteTag} />
        </div>
    );

}