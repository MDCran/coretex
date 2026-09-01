// @ts-nocheck
import { useState, useTransition } from "react";
const useRouter = () => ({ push: () => {}, replace: () => {} }); const useSearchParams = () => ({ get: () => null });
import {
    BatteryFull,
    Calendar,
    MessageTextSquare02,
    Plus,
    UserPlus01,
    X,
} from "@untitledui/icons";
import { toast } from "sonner";
import { Button } from "@/components/base/buttons/button";
import { FormModal, Field, NativeInput, NativeTextarea, NativeSelect, runAction } from "@/components/life/life-ui";
import { FormDateInput } from "@/components/base/input/form-date-input";
import { saveBattery } from "@/lib/actions/social-battery";
import { createDraft } from "@/lib/actions/social-drafts";
import { createSocialEvent } from "@/lib/actions/calendar";

export interface ContactOption {
    id: string;
    displayName: string;
}

/** Quick-action buttons shown in the social page header. */
export function SocialQuickActions({ contacts }: { contacts: ContactOption[] }) {
    const router = useRouter();
    const [, startTransition] = useTransition();

    const [batteryOpen, setBatteryOpen] = useState(false);
    const [draftOpen, setDraftOpen] = useState(false);
    const [eventOpen, setEventOpen] = useState(false);

    function refresh() {
        startTransition(() => router.refresh());
    }

    return (
        <>
            <div className="flex flex-wrap items-center gap-2">
                <Button
                    size="sm"
                    color="secondary"
                    iconLeading={BatteryFull}
                    onClick={() => setBatteryOpen(true)}
                >
                    Log battery
                </Button>
                <Button
                    size="sm"
                    color="secondary"
                    iconLeading={UserPlus01}
                    href="/social/contacts/new"
                >
                    Add contact
                </Button>
                <Button
                    size="sm"
                    color="secondary"
                    iconLeading={MessageTextSquare02}
                    onClick={() => setDraftOpen(true)}
                >
                    New draft
                </Button>
                <Button
                    size="sm"
                    color="primary"
                    iconLeading={Calendar}
                    onClick={() => setEventOpen(true)}
                >
                    Add event
                </Button>
            </div>

            {/* Battery log modal */}
            <BatteryLogModal
                isOpen={batteryOpen}
                onOpenChange={setBatteryOpen}
                onDone={refresh}
            />

            {/* Draft modal */}
            <QuickDraftModal
                isOpen={draftOpen}
                onOpenChange={setDraftOpen}
                contacts={contacts}
                onDone={refresh}
            />

            {/* Social event → CalendarEvent modal */}
            <SocialEventModal
                isOpen={eventOpen}
                onOpenChange={setEventOpen}
                contacts={contacts}
                onDone={refresh}
            />
        </>
    );
}

// ── Battery log modal ────────────────────────────────────────

function BatteryLogModal({
    isOpen,
    onOpenChange,
    onDone,
}: {
    isOpen: boolean;
    onOpenChange: (o: boolean) => void;
    onDone: () => void;
}) {
    const [level, setLevel] = useState(5);
    const today = new Date().toISOString().slice(0, 10);

    return (
        <FormModal isOpen={isOpen} onOpenChange={onOpenChange} title="Log social battery">
            <form
                action={async (fd) => {
                    fd.set("energyLevel", String(level));
                    const ok = await runAction(saveBattery, fd, toast, "Battery logged");
                    if (ok) {
                        onOpenChange(false);
                        onDone();
                    }
                }}
                className="flex flex-col gap-4"
            >
                <FormDateInput name="date" label="Date" isRequired defaultValue={today} />
                <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-sm">
                        <span className="font-medium text-secondary">Energy level</span>
                        <span className="font-semibold text-primary">{level}/10</span>
                    </div>
                    <input
                        type="range"
                        min={1}
                        max={10}
                        value={level}
                        onChange={(e) => setLevel(Number(e.target.value))}
                        className="w-full accent-brand-solid"
                        aria-label="Energy level"
                    />
                </div>
                <Field label="Notes" htmlFor="notes">
                    <NativeTextarea id="notes" name="notes" placeholder="Optional" />
                </Field>
                <div className="flex justify-end gap-2 pt-2">
                    <Button color="secondary" type="button" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button type="submit">Log</Button>
                </div>
            </form>
        </FormModal>
    );
}

// ── Quick draft modal ────────────────────────────────────────

function QuickDraftModal({
    isOpen,
    onOpenChange,
    contacts,
    onDone,
}: {
    isOpen: boolean;
    onOpenChange: (o: boolean) => void;
    contacts: ContactOption[];
    onDone: () => void;
}) {
    return (
        <FormModal isOpen={isOpen} onOpenChange={onOpenChange} title="New outreach draft">
            <form
                action={async (fd) => {
                    const ok = await runAction(createDraft, fd, toast, "Draft created");
                    if (ok) {
                        onOpenChange(false);
                        onDone();
                    }
                }}
                className="flex flex-col gap-4"
            >
                <Field label="Contact" htmlFor="contactId">
                    <NativeSelect id="contactId" name="contactId">
                        <option value="">— No contact —</option>
                        {contacts.map((c) => (
                            <option key={c.id} value={c.id}>
                                {c.displayName}
                            </option>
                        ))}
                    </NativeSelect>
                </Field>
                <Field label="Channel" htmlFor="channel">
                    <NativeSelect id="channel" name="channel">
                        <option value="">— Choose channel —</option>
                        <option value="EMAIL">Email</option>
                        <option value="SMS">SMS</option>
                        <option value="PHONE">Phone</option>
                        <option value="IN_PERSON">In person</option>
                        <option value="SOCIAL_MEDIA">Social media</option>
                    </NativeSelect>
                </Field>
                <Field label="Message" htmlFor="body" required>
                    <NativeTextarea id="body" name="body" required placeholder="Draft your message…" />
                </Field>
                <FormDateInput name="dueAt" label="Due date" variant="date" hint="Optional send deadline." />
                <div className="flex justify-end gap-2 pt-2">
                    <Button color="secondary" type="button" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button type="submit">Create draft</Button>
                </div>
            </form>
        </FormModal>
    );
}

// ── Social event modal ───────────────────────────────────────

function SocialEventModal({
    isOpen,
    onOpenChange,
    contacts,
    onDone,
}: {
    isOpen: boolean;
    onOpenChange: (o: boolean) => void;
    contacts: ContactOption[];
    onDone: () => void;
}) {
    const [contactId, setContactId] = useState("");
    const [allDay, setAllDay] = useState(false);

    const selectedContact = contacts.find((c) => c.id === contactId);

    return (
        <FormModal isOpen={isOpen} onOpenChange={onOpenChange} title="Add social event to calendar">
            <form
                action={async (fd) => {
                    const titleInput = fd.get("title") as string;
                    const contactName = selectedContact?.displayName;
                    const title = titleInput?.trim() || (contactName ? `Event with ${contactName}` : "Social event");
                    const startsAt = fd.get("startsAt") as string;
                    const endsAt = (fd.get("endsAt") as string) || null;
                    const description = (fd.get("description") as string) || null;
                    const location = (fd.get("location") as string) || null;

                    // For all-day events the picker only gives a date — coerce to ISO.
                    const startsAtFull = startsAt.length === 10 ? `${startsAt}T00:00` : startsAt;
                    const endsAtFull = endsAt && endsAt.length === 10 ? `${endsAt}T23:59` : endsAt;

                    try {
                        await createSocialEvent(contactId || null, {
                            title,
                            startsAt: startsAtFull,
                            endsAt: endsAtFull,
                            allDay,
                            description,
                            location,
                        });
                        toast.success("Event added to calendar");
                        onOpenChange(false);
                        setContactId("");
                        setAllDay(false);
                        onDone();
                    } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Something went wrong");
                    }
                }}
                className="flex flex-col gap-4"
            >
                <Field label="Contact" htmlFor="eventContactId" hint="The event title will include their name.">
                    <NativeSelect
                        id="eventContactId"
                        value={contactId}
                        onChange={(e) => setContactId(e.target.value)}
                    >
                        <option value="">— No contact —</option>
                        {contacts.map((c) => (
                            <option key={c.id} value={c.id}>
                                {c.displayName}
                            </option>
                        ))}
                    </NativeSelect>
                </Field>
                <Field label="Event title" htmlFor="eventTitle" hint={selectedContact ? `Leave blank for "Event with ${selectedContact.displayName}"` : undefined}>
                    <NativeInput
                        id="eventTitle"
                        name="title"
                        placeholder={selectedContact ? `Event with ${selectedContact.displayName}` : "e.g. Coffee meetup"}
                    />
                </Field>
                <div className="flex items-center gap-2">
                    <input
                        type="checkbox"
                        id="allDay"
                        checked={allDay}
                        onChange={(e) => setAllDay(e.target.checked)}
                        className="rounded accent-brand-solid"
                    />
                    <label htmlFor="allDay" className="text-sm font-medium text-secondary">
                        All day
                    </label>
                </div>
                {allDay ? (
                    <FormDateInput name="startsAt" label="Date" isRequired variant="date" />
                ) : (
                    <div className="grid grid-cols-2 gap-3">
                        <FormDateInput name="startsAt" label="Starts" isRequired variant="datetime" />
                        <FormDateInput name="endsAt" label="Ends" variant="datetime" />
                    </div>
                )}
                <Field label="Location" htmlFor="eventLocation">
                    <NativeInput id="eventLocation" name="location" placeholder="Optional" />
                </Field>
                <Field label="Description" htmlFor="eventDescription">
                    <NativeTextarea id="eventDescription" name="description" placeholder="Optional notes" />
                </Field>
                <div className="flex justify-end gap-2 pt-2">
                    <Button color="secondary" type="button" onClick={() => { onOpenChange(false); setContactId(""); setAllDay(false); }}>
                        Cancel
                    </Button>
                    <Button type="submit">Add to calendar</Button>
                </div>
            </form>
        </FormModal>
    );
}
