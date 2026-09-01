import { notFound } from "next/navigation";
import { Edit01, Star01, Activity, TrendUp01 } from "@untitledui/icons";
import { subDays } from "date-fns";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { fileUrl } from "@/lib/files";
import { Button } from "@/components/base/buttons/button";
import { Avatar } from "@/components/base/avatar/avatar";
import { Badge } from "@/components/base/badges/badges";
import { Card, CardBody, CardHeader, DetailRow, EmptyHint } from "@/components/social/ui";
import { ContactTabs } from "@/components/social/contact-tabs";
import { ReachOutActions } from "@/components/social/reach-out-actions";
import { RecordDialog, InlineDelete } from "@/components/social/record-dialog";
import { LocalTime } from "@/components/social/local-time";
import { ScoreSliders } from "@/components/social/score-sliders";
import { Sparkline } from "@/components/social/sparkline";
import { LabelCombobox } from "@/components/social/label-combobox";
import { MemoriesManager, type Memory } from "@/components/social/memories-manager";
import { SocialsManager, type Social } from "@/components/social/socials-manager";
import { AddToCalendarButton } from "@/components/social/add-to-calendar-button";
import { DeleteButton } from "@/components/jobs/delete-button";
import { TextInput, SelectInput, TextareaInput, DateInput } from "@/components/jobs/fields";
import {
    RELATIONSHIP_LABELS,
    RELATIONSHIP_COLORS,
    CONTACT_METHOD_LABELS,
    COMMUNICATION_FREQUENCY_LABELS,
    INTERACTION_TYPE_LABELS,
    CHANNEL_LABELS,
    SENTIMENT_LABELS,
    SENTIMENT_COLORS,
    NOTE_TYPE_LABELS,
    REMINDER_TYPE_LABELS,
    EMAIL_LABELS,
    PHONE_LABELS,
    ADDRESS_TYPES,
    DATE_TYPES,
    GIFT_DIRECTIONS,
    OCCASIONS,
    toOptions,
    listOptions,
    labelOf,
} from "@/lib/social/enums";
import { fmtDate, fmtRelative, toDateInput, toDateTimeInput, initialsOf, connectionHealth, activitySparkline } from "@/lib/social/format";
import { deleteContact, scheduleReachOut, markReachedOut } from "@/lib/actions/social-contacts";
import {
    addEmail, updateEmail, deleteEmail, addPhone, updatePhone, deletePhone, addHandle, updateHandle, deleteHandle,
    addAddress, updateAddress, deleteAddress,
    addDate, updateDate, deleteDate, addDateToCalendar, addNote, updateNote, deleteNote,
    addReminder, updateReminder, toggleReminder, deleteReminder,
    addInteraction, updateInteraction, deleteInteraction, addCommunication, updateCommunication, deleteCommunication,
    addMemory, updateMemory, deleteMemory, addGift, updateGift, deleteGift, addConflict, updateConflict, deleteConflict,
    updateScores,
} from "@/lib/actions/social-records";

import type { BadgeColors } from "@/components/base/badges/badge-types";

export const dynamic = "force-dynamic";

export default async function ContactProfilePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const user = await requireUser();

    const contact = await db.socialContact.findFirst({
        where: { id, userId: user.id },
        include: {
            emails: true,
            phones: true,
            handles: true,
            addresses: true,
            dates: { orderBy: { dateValue: "asc" } },
            contactNotes: { orderBy: { createdAt: "desc" } },
            reminders: { orderBy: { scheduledFor: "asc" } },
            interactions: { orderBy: { date: "desc" } },
            communications: { orderBy: { date: "desc" } },
            memories: { orderBy: [{ memoryDate: "desc" }, { createdAt: "desc" }], include: { media: { orderBy: { createdAt: "asc" } } } },
            gifts: { orderBy: { givenDate: "desc" } },
            conflicts: { orderBy: { date: "desc" } },
            tags: true,
        },
    });
    if (!contact) notFound();

    // Connection health "monitor" — computed from real interaction signals.
    const activityDates = [...contact.interactions.map((i) => i.date), ...contact.communications.map((c) => c.date)];
    const recentActivity = activityDates.filter((d) => d >= subDays(new Date(), 90));
    const health = connectionHealth(activityDates, contact.lastContactAt, contact.stayInTouchDays);
    const spark = activitySparkline(activityDates, 12);

    const memories: Memory[] = contact.memories.map((m) => ({
        id: m.id,
        title: m.title,
        description: m.description,
        memoryDate: m.memoryDate ? m.memoryDate.toISOString() : null,
        location: m.location,
        media: m.media.map((md) => ({ id: md.id, key: md.key, fileName: md.fileName, mimeType: md.mimeType, sizeBytes: md.sizeBytes })),
        legacyKeys: m.mediaKeys,
    }));

    const socials: Social[] = contact.handles.map((h) => ({ id: h.id, platform: h.platform, handle: h.handle }));

    // ---- Details tab ----
    const detailsTab = (
        <div className="grid gap-6 lg:grid-cols-2">
            <MultiValueCard
                title="Emails"
                items={contact.emails}
                primary={(e) => e.email}
                secondary={(e) => `${e.label}${e.isPrimary ? " · primary" : ""}`}
                deleteAction={deleteEmail}
                dialog={
                    <RecordDialog title="Add email" triggerLabel="Add" action={addEmail.bind(null, contact.id)} successMessage="Email added">
                        <TextInput name="email" label="Email" type="email" isRequired />
                        <LabelCombobox name="label" label="Label" presets={EMAIL_LABELS} defaultValue="Personal" />
                        <Checkbox name="isPrimary" label="Primary" />
                    </RecordDialog>
                }
                editDialog={(e) => (
                    <RecordDialog variant="edit" title="Edit email" triggerLabel="Edit email" action={updateEmail} successMessage="Email updated">
                        <input type="hidden" name="id" value={e.id} />
                        <TextInput name="email" label="Email" type="email" isRequired defaultValue={e.email} />
                        <LabelCombobox name="label" label="Label" presets={EMAIL_LABELS} defaultValue={e.label} />
                        <Checkbox name="isPrimary" label="Primary" defaultChecked={e.isPrimary} />
                    </RecordDialog>
                )}
            />
            <MultiValueCard
                title="Phones"
                items={contact.phones}
                primary={(p) => p.phone}
                secondary={(p) => `${p.label}${p.isPrimary ? " · primary" : ""}`}
                deleteAction={deletePhone}
                dialog={
                    <RecordDialog title="Add phone" triggerLabel="Add" action={addPhone.bind(null, contact.id)} successMessage="Phone added">
                        <TextInput name="phone" label="Phone" isRequired />
                        <LabelCombobox name="label" label="Label" presets={PHONE_LABELS} defaultValue="Mobile" />
                        <Checkbox name="isPrimary" label="Primary" />
                    </RecordDialog>
                }
                editDialog={(p) => (
                    <RecordDialog variant="edit" title="Edit phone" triggerLabel="Edit phone" action={updatePhone} successMessage="Phone updated">
                        <input type="hidden" name="id" value={p.id} />
                        <TextInput name="phone" label="Phone" isRequired defaultValue={p.phone} />
                        <LabelCombobox name="label" label="Label" presets={PHONE_LABELS} defaultValue={p.label} />
                        <Checkbox name="isPrimary" label="Primary" defaultChecked={p.isPrimary} />
                    </RecordDialog>
                )}
            />
            <Card>
                <CardHeader
                    title="Important dates"
                    action={
                        <RecordDialog title="Add date" triggerLabel="Add" action={addDate.bind(null, contact.id)} successMessage="Date added">
                            <SelectInput name="dateType" label="Type" options={listOptions(DATE_TYPES)} isRequired placeholder="—" />
                            <DateInput name="dateValue" label="Date" isRequired />
                        </RecordDialog>
                    }
                />
                <CardBody>
                    {contact.dates.length === 0 ? (
                        <EmptyHint>No important dates.</EmptyHint>
                    ) : (
                        <ul className="flex flex-col divide-y divide-secondary">
                            {contact.dates.map((d) => (
                                <li key={d.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                                    <div className="min-w-0">
                                        <div className="truncate text-sm font-medium text-primary">{fmtDate(d.dateValue)}</div>
                                        <div className="truncate text-xs text-tertiary">{d.dateType}</div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1">
                                        <AddToCalendarButton id={d.id} action={addDateToCalendar} />
                                        <RecordDialog variant="edit" title="Edit date" triggerLabel="Edit date" action={updateDate} successMessage="Date updated">
                                            <input type="hidden" name="id" value={d.id} />
                                            <SelectInput name="dateType" label="Type" options={listOptions(DATE_TYPES.includes(d.dateType) ? DATE_TYPES : [...DATE_TYPES, d.dateType])} defaultValue={d.dateType} isRequired placeholder="—" />
                                            <DateInput name="dateValue" label="Date" isRequired defaultValue={toDateInput(d.dateValue)} />
                                        </RecordDialog>
                                        <InlineDelete action={deleteDate} id={d.id} />
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </CardBody>
            </Card>
            <SocialsManager socials={socials} addAction={addHandle.bind(null, contact.id)} updateAction={updateHandle} deleteAction={deleteHandle} />
            <Card className="lg:col-span-2">
                <CardHeader
                    title="Addresses"
                    action={
                        <RecordDialog title="Add address" triggerLabel="Add" action={addAddress.bind(null, contact.id)} successMessage="Address added">
                            <SelectInput name="addressType" label="Type" options={listOptions(ADDRESS_TYPES)} placeholder="—" />
                            <TextInput name="addressLine1" label="Address line 1" />
                            <TextInput name="addressLine2" label="Address line 2" />
                            <div className="grid grid-cols-2 gap-4">
                                <TextInput name="city" label="City" />
                                <TextInput name="state" label="State / region" />
                                <TextInput name="postalCode" label="Postal code" />
                                <TextInput name="country" label="Country" />
                            </div>
                        </RecordDialog>
                    }
                />
                <CardBody>
                    {contact.addresses.length === 0 ? (
                        <EmptyHint>No addresses.</EmptyHint>
                    ) : (
                        <ul className="flex flex-col divide-y divide-secondary">
                            {contact.addresses.map((a) => (
                                <li key={a.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                                    <div className="text-sm">
                                        <div className="font-medium text-primary">{a.addressType ?? "Address"}</div>
                                        <div className="text-tertiary">
                                            {[a.addressLine1, a.addressLine2, [a.city, a.state, a.postalCode].filter(Boolean).join(", "), a.country].filter(Boolean).join(" · ")}
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-0.5">
                                        <RecordDialog variant="edit" title="Edit address" triggerLabel="Edit address" action={updateAddress} successMessage="Address updated">
                                            <input type="hidden" name="id" value={a.id} />
                                            <SelectInput name="addressType" label="Type" options={listOptions(ADDRESS_TYPES)} defaultValue={a.addressType ?? ""} placeholder="—" />
                                            <TextInput name="addressLine1" label="Address line 1" defaultValue={a.addressLine1 ?? ""} />
                                            <TextInput name="addressLine2" label="Address line 2" defaultValue={a.addressLine2 ?? ""} />
                                            <div className="grid grid-cols-2 gap-4">
                                                <TextInput name="city" label="City" defaultValue={a.city ?? ""} />
                                                <TextInput name="state" label="State / region" defaultValue={a.state ?? ""} />
                                                <TextInput name="postalCode" label="Postal code" defaultValue={a.postalCode ?? ""} />
                                                <TextInput name="country" label="Country" defaultValue={a.country ?? ""} />
                                            </div>
                                        </RecordDialog>
                                        <InlineDelete action={deleteAddress} id={a.id} />
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </CardBody>
            </Card>
            <Card className="lg:col-span-2">
                <CardHeader
                    title="Notes"
                    action={
                        <RecordDialog title="Add note" triggerLabel="Add" action={addNote.bind(null, contact.id)} successMessage="Note added">
                            <SelectInput name="noteType" label="Type" options={toOptions(NOTE_TYPE_LABELS)} defaultValue="GENERAL" placeholder="—" />
                            <TextareaInput name="noteText" label="Note" rows={3} isRequired />
                        </RecordDialog>
                    }
                />
                <CardBody>
                    {contact.contactNotes.length === 0 ? (
                        <EmptyHint>No notes yet.</EmptyHint>
                    ) : (
                        <ul className="flex flex-col divide-y divide-secondary">
                            {contact.contactNotes.map((n) => (
                                <li key={n.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                                    <div className="min-w-0">
                                        {n.noteType && <Badge size="sm" color="gray">{labelOf(NOTE_TYPE_LABELS, n.noteType)}</Badge>}
                                        <p className="mt-1 text-sm whitespace-pre-wrap text-primary">{n.noteText}</p>
                                        <p className="mt-1 text-xs text-tertiary">{fmtRelative(n.createdAt)}</p>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-0.5">
                                        <RecordDialog variant="edit" title="Edit note" triggerLabel="Edit note" action={updateNote} successMessage="Note updated">
                                            <input type="hidden" name="id" value={n.id} />
                                            <SelectInput name="noteType" label="Type" options={toOptions(NOTE_TYPE_LABELS)} defaultValue={n.noteType ?? "GENERAL"} placeholder="—" />
                                            <TextareaInput name="noteText" label="Note" rows={3} isRequired defaultValue={n.noteText} />
                                        </RecordDialog>
                                        <InlineDelete action={deleteNote} id={n.id} />
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </CardBody>
            </Card>
        </div>
    );

    // ---- Timeline tab ----
    const timelineTab = (
        <div className="grid gap-6 lg:grid-cols-2">
            <Card>
                <CardHeader
                    title="Interactions"
                    action={
                        <RecordDialog title="Log interaction" triggerLabel="Log" action={addInteraction.bind(null, contact.id)} successMessage="Interaction logged" submitLabel="Log">
                            <div className="grid grid-cols-2 gap-4">
                                <DateInput name="date" label="Date" defaultValue={toDateInput(new Date())} />
                                <SelectInput name="interactionType" label="Type" options={toOptions(INTERACTION_TYPE_LABELS)} placeholder="—" />
                            </div>
                            <TextareaInput name="notes" label="Notes" rows={3} />
                        </RecordDialog>
                    }
                />
                <CardBody>
                    {contact.interactions.length === 0 ? (
                        <EmptyHint>No interactions logged.</EmptyHint>
                    ) : (
                        <ul className="flex flex-col divide-y divide-secondary">
                            {contact.interactions.map((it) => (
                                <li key={it.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            {it.interactionType && <Badge size="sm" color="brand">{labelOf(INTERACTION_TYPE_LABELS, it.interactionType)}</Badge>}
                                            <span className="text-xs text-tertiary">{fmtDate(it.date)}</span>
                                        </div>
                                        {it.notes && <p className="mt-1 text-sm whitespace-pre-wrap text-primary">{it.notes}</p>}
                                    </div>
                                    <div className="flex shrink-0 items-center gap-0.5">
                                        <RecordDialog variant="edit" title="Edit interaction" triggerLabel="Edit interaction" action={updateInteraction} successMessage="Interaction updated">
                                            <input type="hidden" name="id" value={it.id} />
                                            <div className="grid grid-cols-2 gap-4">
                                                <DateInput name="date" label="Date" defaultValue={toDateInput(it.date)} />
                                                <SelectInput name="interactionType" label="Type" options={toOptions(INTERACTION_TYPE_LABELS)} defaultValue={it.interactionType ?? ""} placeholder="—" />
                                            </div>
                                            <TextareaInput name="notes" label="Notes" rows={3} defaultValue={it.notes ?? ""} />
                                        </RecordDialog>
                                        <InlineDelete action={deleteInteraction} id={it.id} />
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </CardBody>
            </Card>
            <Card>
                <CardHeader
                    title="Communications"
                    action={
                        <RecordDialog title="Log communication" triggerLabel="Log" action={addCommunication.bind(null, contact.id)} successMessage="Communication logged" submitLabel="Log">
                            <div className="grid grid-cols-2 gap-4">
                                <DateInput name="date" label="Date" defaultValue={toDateInput(new Date())} />
                                <SelectInput name="channel" label="Channel" options={toOptions(CHANNEL_LABELS)} placeholder="—" />
                            </div>
                            <SelectInput name="sentiment" label="Sentiment" options={toOptions(SENTIMENT_LABELS)} placeholder="—" />
                            <TextareaInput name="notes" label="Notes" rows={3} />
                        </RecordDialog>
                    }
                />
                <CardBody>
                    {contact.communications.length === 0 ? (
                        <EmptyHint>No communications logged.</EmptyHint>
                    ) : (
                        <ul className="flex flex-col divide-y divide-secondary">
                            {contact.communications.map((cm) => (
                                <li key={cm.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            {cm.channel && <Badge size="sm" color="gray">{labelOf(CHANNEL_LABELS, cm.channel)}</Badge>}
                                            {cm.sentiment && (
                                                <Badge size="sm" color={(SENTIMENT_COLORS[cm.sentiment] as BadgeColors) ?? "gray"}>
                                                    {labelOf(SENTIMENT_LABELS, cm.sentiment)}
                                                </Badge>
                                            )}
                                            <span className="text-xs text-tertiary">{fmtDate(cm.date)}</span>
                                        </div>
                                        {cm.notes && <p className="mt-1 text-sm whitespace-pre-wrap text-primary">{cm.notes}</p>}
                                    </div>
                                    <div className="flex shrink-0 items-center gap-0.5">
                                        <RecordDialog variant="edit" title="Edit communication" triggerLabel="Edit communication" action={updateCommunication} successMessage="Communication updated">
                                            <input type="hidden" name="id" value={cm.id} />
                                            <div className="grid grid-cols-2 gap-4">
                                                <DateInput name="date" label="Date" defaultValue={toDateInput(cm.date)} />
                                                <SelectInput name="channel" label="Channel" options={toOptions(CHANNEL_LABELS)} defaultValue={cm.channel ?? ""} placeholder="—" />
                                            </div>
                                            <SelectInput name="sentiment" label="Sentiment" options={toOptions(SENTIMENT_LABELS)} defaultValue={cm.sentiment ?? ""} placeholder="—" />
                                            <TextareaInput name="notes" label="Notes" rows={3} defaultValue={cm.notes ?? ""} />
                                        </RecordDialog>
                                        <InlineDelete action={deleteCommunication} id={cm.id} />
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </CardBody>
            </Card>
        </div>
    );

    // ---- Memories & gifts tab ----
    const memoriesTab = (
        <div className="grid gap-6 lg:grid-cols-2">
            <MemoriesManager memories={memories} addAction={addMemory.bind(null, contact.id)} updateAction={updateMemory} deleteAction={deleteMemory} />
            <Card>
                <CardHeader
                    title="Gifts"
                    action={
                        <RecordDialog title="Add gift" triggerLabel="Add" action={addGift.bind(null, contact.id)} successMessage="Gift saved">
                            <TextInput name="giftDescription" label="Description" isRequired />
                            <div className="grid grid-cols-2 gap-4">
                                <DateInput name="givenDate" label="Date" />
                                <SelectInput name="direction" label="Direction" options={toOptions(GIFT_DIRECTIONS)} defaultValue="given" />
                            </div>
                            <SelectInput name="occasion" label="Occasion" options={listOptions(OCCASIONS)} placeholder="—" />
                        </RecordDialog>
                    }
                />
                <CardBody>
                    {contact.gifts.length === 0 ? (
                        <EmptyHint>No gifts logged.</EmptyHint>
                    ) : (
                        <ul className="flex flex-col divide-y divide-secondary">
                            {contact.gifts.map((g) => (
                                <li key={g.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <Badge size="sm" color={g.direction === "received" ? "success" : "brand"}>
                                                {labelOf(GIFT_DIRECTIONS, g.direction)}
                                            </Badge>
                                            <span className="text-xs text-tertiary">{fmtDate(g.givenDate)}</span>
                                        </div>
                                        <p className="mt-1 text-sm text-primary">{g.giftDescription}</p>
                                        {g.occasion && <p className="text-xs text-tertiary">{g.occasion}</p>}
                                    </div>
                                    <div className="flex shrink-0 items-center gap-0.5">
                                        <RecordDialog variant="edit" title="Edit gift" triggerLabel="Edit gift" action={updateGift} successMessage="Gift updated">
                                            <input type="hidden" name="id" value={g.id} />
                                            <TextInput name="giftDescription" label="Description" isRequired defaultValue={g.giftDescription} />
                                            <div className="grid grid-cols-2 gap-4">
                                                <DateInput name="givenDate" label="Date" defaultValue={toDateInput(g.givenDate)} />
                                                <SelectInput name="direction" label="Direction" options={toOptions(GIFT_DIRECTIONS)} defaultValue={g.direction ?? "given"} />
                                            </div>
                                            <SelectInput name="occasion" label="Occasion" options={listOptions(g.occasion && !OCCASIONS.includes(g.occasion) ? [...OCCASIONS, g.occasion] : OCCASIONS)} defaultValue={g.occasion ?? ""} placeholder="—" />
                                        </RecordDialog>
                                        <InlineDelete action={deleteGift} id={g.id} />
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </CardBody>
            </Card>
        </div>
    );

    // ---- Conflicts tab ----
    const conflictsTab = (
        <Card>
            <CardHeader
                title="Conflicts"
                action={
                    <RecordDialog title="Log conflict" triggerLabel="Add" action={addConflict.bind(null, contact.id)} successMessage="Conflict logged">
                        <DateInput name="date" label="Date" />
                        <TextareaInput name="description" label="What happened" rows={3} isRequired />
                        <TextareaInput name="resolution" label="Resolution (optional)" rows={2} />
                    </RecordDialog>
                }
            />
            <CardBody>
                {contact.conflicts.length === 0 ? (
                    <EmptyHint>No conflicts logged. Hopefully it stays that way.</EmptyHint>
                ) : (
                    <ul className="flex flex-col gap-4">
                        {contact.conflicts.map((cf) => (
                            <li key={cf.id} className="flex flex-col gap-2 border-b border-secondary pb-4 last:border-0 last:pb-0">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="text-xs text-tertiary">{fmtDate(cf.date)}</p>
                                        <p className="mt-1 text-sm whitespace-pre-wrap text-primary">{cf.description}</p>
                                        {cf.resolution ? (
                                            <p className="mt-2 rounded-lg bg-success-primary px-3 py-2 text-sm text-success-primary">Resolved: {cf.resolution}</p>
                                        ) : null}
                                    </div>
                                    <InlineDelete action={deleteConflict} id={cf.id} />
                                </div>
                                {!cf.resolution && (
                                    <RecordDialog title="Resolve conflict" triggerLabel="Add resolution" action={updateConflict} successMessage="Resolution saved" submitLabel="Save">
                                        <input type="hidden" name="id" value={cf.id} />
                                        <TextareaInput name="resolution" label="Resolution" rows={3} isRequired />
                                    </RecordDialog>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </CardBody>
        </Card>
    );

    // ---- Reminders tab ----
    const remindersTab = (
        <Card>
            <CardHeader
                title="Reminders"
                action={
                    <RecordDialog title="Add reminder" triggerLabel="Add" action={addReminder.bind(null, contact.id)} successMessage="Reminder added">
                        <SelectInput name="reminderType" label="Type" options={toOptions(REMINDER_TYPE_LABELS)} placeholder="—" />
                        <DateInput name="scheduledFor" label="When" variant="datetime" isRequired defaultValue={toDateTimeInput(new Date())} />
                    </RecordDialog>
                }
            />
            <CardBody>
                {contact.reminders.length === 0 ? (
                    <EmptyHint>No reminders set.</EmptyHint>
                ) : (
                    <ul className="flex flex-col divide-y divide-secondary">
                        {contact.reminders.map((r) => (
                            <li key={r.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                                <div className="flex items-center gap-3">
                                    <form action={toggleReminder}>
                                        <input type="hidden" name="id" value={r.id} />
                                        <button type="submit" className="size-5 rounded-md ring-1 ring-primary ring-inset transition hover:bg-secondary_hover" aria-label="Toggle complete">
                                            {r.completed && <span className="block size-full rounded-md bg-brand-solid" />}
                                        </button>
                                    </form>
                                    <div className={r.completed ? "line-through opacity-60" : ""}>
                                        <div className="text-sm font-medium text-primary">{labelOf(REMINDER_TYPE_LABELS, r.reminderType)}</div>
                                        <div className="text-xs text-tertiary">{fmtDate(r.scheduledFor)}</div>
                                    </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-0.5">
                                    <RecordDialog variant="edit" title="Edit reminder" triggerLabel="Edit reminder" action={updateReminder} successMessage="Reminder updated">
                                        <input type="hidden" name="id" value={r.id} />
                                        <SelectInput name="reminderType" label="Type" options={toOptions(REMINDER_TYPE_LABELS)} defaultValue={r.reminderType ?? ""} placeholder="—" />
                                        <DateInput name="scheduledFor" label="When" variant="datetime" isRequired defaultValue={toDateTimeInput(r.scheduledFor)} />
                                    </RecordDialog>
                                    <InlineDelete action={deleteReminder} id={r.id} />
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </CardBody>
        </Card>
    );

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
                <Button href="/social/contacts" color="link-gray" size="sm">
                    ← Back to contacts
                </Button>
                <div className="flex items-center gap-2">
                    <Button href={`/social/contacts/${contact.id}/edit`} color="secondary" size="sm" iconLeading={<Edit01 data-icon className="size-4" />}>
                        Edit
                    </Button>
                    <DeleteButton action={deleteContact} id={contact.id} label="Delete" title={`Delete ${contact.displayName}?`} description="This permanently removes the contact and all their records." />
                </div>
            </div>

            <Card>
                <CardBody className="flex flex-col gap-5 sm:flex-row sm:items-start">
                    <Avatar size="2xl" src={contact.avatarKey ? fileUrl(contact.avatarKey) : undefined} initials={initialsOf(contact.displayName)} alt={contact.displayName} />
                    <div className="flex flex-1 flex-col gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-display-xs font-semibold text-primary">{contact.displayName}</h2>
                            {contact.nickname && <span className="text-md text-tertiary">“{contact.nickname}”</span>}
                            {contact.innerCircle && (
                                <Badge size="sm" color="warning">
                                    <Star01 className="mr-1 size-3" aria-hidden="true" /> Inner circle
                                </Badge>
                            )}
                            {!contact.active && <Badge size="sm" color="gray">Archived</Badge>}
                            {contact.timezone && <LocalTime timezone={contact.timezone} variant="header" />}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            {contact.relationshipType && (
                                <Badge size="sm" color={(RELATIONSHIP_COLORS[contact.relationshipType] as BadgeColors) ?? "gray"}>
                                    {labelOf(RELATIONSHIP_LABELS, contact.relationshipType)}
                                </Badge>
                            )}
                            {contact.pronouns && <span className="text-sm text-tertiary">{contact.pronouns}</span>}
                            {contact.tags.map((t) => (
                                <Badge key={t.id} size="sm" color="gray">{t.name}</Badge>
                            ))}
                        </div>
                        {contact.energyTags.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                                {contact.energyTags.map((t) => (
                                    <span key={t} className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary">{t}</span>
                                ))}
                            </div>
                        )}
                        <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
                            <DetailRow label="Occupation">{contact.occupation ?? "—"}</DetailRow>
                            <DetailRow label="Company / school">{contact.companyOrSchool ?? "—"}</DetailRow>
                            <DetailRow label="Birthday">{fmtDate(contact.birthday)}</DetailRow>
                            <DetailRow label="Hometown">{contact.hometown ?? "—"}</DetailRow>
                            <DetailRow label="How we met">{contact.howWeMet ?? "—"}</DetailRow>
                            <DetailRow label="Timezone">{contact.timezone ?? "—"}</DetailRow>
                            <DetailRow label="Preferred contact">{labelOf(CONTACT_METHOD_LABELS, contact.preferredContactMethod)}</DetailRow>
                            <DetailRow label="Frequency">{labelOf(COMMUNICATION_FREQUENCY_LABELS, contact.communicationFrequency)}</DetailRow>
                            <DetailRow label="Last contact">{fmtRelative(contact.lastContactAt)}</DetailRow>
                            <DetailRow label="Stay in touch">{contact.stayInTouch ? `Every ${contact.stayInTouchDays ?? 30} days` : "Off"}</DetailRow>
                        </div>
                        {contact.interests && <p className="text-sm text-tertiary"><span className="font-medium text-secondary">Interests: </span>{contact.interests}</p>}
                        {contact.notes && <p className="text-sm whitespace-pre-wrap text-primary">{contact.notes}</p>}
                    </div>
                    <div className="flex w-full shrink-0 flex-col gap-4 sm:w-60">
                        {/* Connection health monitor — derived from real interaction signals. */}
                        <div className="rounded-xl bg-secondary p-3">
                            <div className="flex items-center justify-between">
                                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-secondary">
                                    <Activity className="size-3.5" aria-hidden="true" /> Connection health
                                </span>
                                <Badge size="sm" color={health.color as BadgeColors}>{health.label}</Badge>
                            </div>
                            <div className="mt-1 flex items-baseline gap-1.5">
                                <span className="text-display-xs font-semibold text-primary">{health.score}</span>
                                <span className="text-xs text-tertiary">/100</span>
                            </div>
                            <Sparkline data={spark} className="mt-2" />
                            <p className="mt-2 flex items-center gap-1 text-xs text-tertiary">
                                <TrendUp01 className="size-3" aria-hidden="true" />
                                {recentActivity.length} interaction{recentActivity.length === 1 ? "" : "s"} in 90d
                                {health.daysSince != null ? ` · ${health.daysSince}d since last` : ""}
                            </p>
                        </div>

                        {/* User-set scores — editable, saved immediately. */}
                        <div className="flex flex-col gap-3 rounded-xl ring-1 ring-secondary ring-inset p-3">
                            <ScoreSliders contactId={contact.id} closeness={contact.closenessScore} trust={contact.trustScore} saveAction={updateScores} />
                        </div>

                        <div className="flex flex-col gap-2 border-t border-secondary pt-4">
                            <span className="text-xs font-medium text-tertiary">Schedule reach-out</span>
                            <ReachOutActions contactId={contact.id} scheduleAction={scheduleReachOut} markAction={markReachedOut} layout="stacked" />
                        </div>
                    </div>
                </CardBody>
            </Card>

            <ContactTabs
                tabs={[
                    { id: "details", label: "Details", content: detailsTab },
                    { id: "timeline", label: "Timeline", content: timelineTab },
                    { id: "memories", label: "Memories & gifts", content: memoriesTab },
                    { id: "conflicts", label: "Conflicts", content: conflictsTab },
                    { id: "reminders", label: "Reminders", content: remindersTab },
                ]}
            />
        </div>
    );
}

function MultiValueCard<T extends { id: string }>({
    title,
    items,
    primary,
    secondary,
    deleteAction,
    dialog,
    editDialog,
}: {
    title: string;
    items: T[];
    primary: (item: T) => string;
    secondary: (item: T) => string;
    deleteAction: (formData: FormData) => void | Promise<void>;
    dialog: React.ReactNode;
    /** Pre-filled edit dialog for a given row. */
    editDialog?: (item: T) => React.ReactNode;
}) {
    return (
        <Card>
            <CardHeader title={title} action={dialog} />
            <CardBody>
                {items.length === 0 ? (
                    <EmptyHint>None added.</EmptyHint>
                ) : (
                    <ul className="flex flex-col divide-y divide-secondary">
                        {items.map((item) => (
                            <li key={item.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                                <div className="min-w-0">
                                    <div className="truncate text-sm font-medium text-primary">{primary(item)}</div>
                                    <div className="truncate text-xs text-tertiary">{secondary(item)}</div>
                                </div>
                                <div className="flex shrink-0 items-center gap-0.5">
                                    {editDialog?.(item)}
                                    <InlineDelete action={deleteAction} id={item.id} />
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </CardBody>
        </Card>
    );
}

/** Native checkbox for use inside record dialogs. */
function Checkbox({ name, label, defaultChecked }: { name: string; label: string; defaultChecked?: boolean }) {
    return (
        <label className="flex items-center gap-2 text-sm text-secondary">
            <input type="checkbox" name={name} defaultChecked={defaultChecked} className="size-4 accent-brand-solid" />
            {label}
        </label>
    );
}
