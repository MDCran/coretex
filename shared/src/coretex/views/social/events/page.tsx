// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { CheckCircle, AlertCircle, AlertTriangle, InfoCircle, Users01, MarkerPin01, CalendarHeart01 } from '@untitledui/icons';
import { PageHeader } from "../../workouts/_components/workouts-ui";
import { EventDialog } from "../event-dialog";
import { fmtDate } from "../format";
import { EmptyState, CardBody } from "../ui";

const FeaturedIcon = (p:any)=><div {...p}/>; const BloomCard = (p:any)=><div {...p}/>; const Card = (p:any)=><div {...p}/>; const SectionHeader = (p:any)=><div {...p}/>;

const severityIcon = { error: AlertCircle, warning: AlertTriangle, info: InfoCircle };
const severityColor = { error: "error", warning: "warning", info: "brand" };

export default function EventsPage({ client }) {
    const [data, setData] = useState(null);
    useEffect(() => {
        const handleMsg = (msg) => { if (msg.type === 'social:getEvents' && msg.result) setData(msg.result); };
        client.onMessage(handleMsg);
        client.send({ type: 'social:getEvents' });
        return () => client.offMessage(handleMsg);
    }, [client]);
    if (!data) return <div className="p-8 text-center text-[var(--c-text-tertiary)]">Loading events...</div>;
    const {  } = data;
    
    return (
        <div>
            <PageHeader
                title="Events"
                description={events.length === 0 ? "Remember the gatherings that brought everyone together." : `${events.length} ${events.length === 1 ? "event" : "events"} tracked`}
            >
                <EventDialog action={createEvent} />
            </PageHeader>

            {events.length === 0 ? (
                <Card>
                    <div className="flex flex-col items-center gap-1 px-6 py-12 text-center">
                        <EmptyState
                            icon={CalendarHeart01}
                            title="No events yet"
                            description="Keep every gathering, party, and meetup in one place — who came, where it was, and the photos to remember it by."
                            className="p-0"
                        />
                        <EventDialog action={createEvent} />
                    </div>
                </Card>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {events.map((e) => {
                        const names = attendeeNames(e.attendees);
                        return (
                            <Card key={e.id} className="flex flex-col overflow-hidden">
                                <div className="relative aspect-video w-full bg-secondary">
                                    {e.coverImageKey ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={fileUrl(e.coverImageKey)} alt={e.name} className="size-full object-cover" loading="lazy" />
                                    ) : (
                                        <div className="flex size-full items-center justify-center">
                                            <CalendarHeart01 className="size-8 text-fg-quaternary" aria-hidden="true" />
                                        </div>
                                    )}
                                </div>
                                <CardBody className="flex flex-1 flex-col gap-2">
                                    <div className="flex items-start justify-between gap-2">
                                        <h3 className="font-semibold text-primary">{e.name}</h3>
                                        <div className="flex shrink-0 items-center gap-1">
                                            <EventDialog
                                                mode="edit"
                                                action={updateEvent.bind(null, e.id)}
                                                defaults={{
                                                    name: e.name,
                                                    eventDate: e.eventDate,
                                                    location: e.location,
                                                    attendees: names,
                                                    notes: e.notes,
                                                    coverUrl: e.coverImageKey ? fileUrl(e.coverImageKey) : null,
                                                }}
                                            />
                                            <DeleteButton action={deleteEvent} id={e.id} iconOnly label="Delete" title={`Delete ${e.name}?`} />
                                        </div>
                                    </div>
                                    <div className="flex flex-col gap-1 text-sm text-tertiary">
                                        <span className="flex items-center gap-1.5">
                                            <CalendarHeart01 className="size-4" aria-hidden="true" /> {fmtDate(e.eventDate)}
                                        </span>
                                        {e.location && (
                                            <span className="flex items-center gap-1.5">
                                                <MarkerPin01 className="size-4" aria-hidden="true" /> {e.location}
                                            </span>
                                        )}
                                        {names.length > 0 && (
                                            <span className="flex items-center gap-1.5">
                                                <Users01 className="size-4" aria-hidden="true" /> {names.length} attendee{names.length === 1 ? "" : "s"}
                                            </span>
                                        )}
                                    </div>
                                    {names.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5">
                                            {names.slice(0, 6).map((n, i) => (
                                                <span key={i} className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary">{n}</span>
                                            ))}
                                            {names.length > 6 && <span className="text-xs text-tertiary">+{names.length - 6}</span>}
                                        </div>
                                    )}
                                    {e.notes && <p className="text-sm whitespace-pre-wrap text-tertiary">{e.notes}</p>}
                                </CardBody>
                            </Card>
                        );
                    })}
                </div>
            )}
        </div>
    );

}