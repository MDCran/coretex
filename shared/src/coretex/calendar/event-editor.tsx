"use client";

import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import {
    AlertCircle,
    BellRinging01,
    Calendar as CalendarIcon,
    CheckCircle,
    Clock,
    Copy01,
    Eye,
    Flag01,
    Globe01,
    Link01,
    MarkerPin01,
    Plus,
    RefreshCw01,
    Tag01,
    Trash01,
    Users01,
    XClose,
} from "@untitledui/icons";
import type { CalendarCategory, CalendarEvent } from "@repo/coretex/types";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { NativeSelect } from "@/components/base/select/select-native";
import { Toggle } from "@/components/base/toggle/toggle";
import { SlideoutMenu } from "@/components/application/slideout-menus/slideout-menu";
import { TextArea } from "@/components/base/textarea/textarea";
import { cx } from "@/utils/cx";
import { ColorPicker } from "../ui/color-picker";
import { IconPicker } from "../ui/icon-picker";
import { IdentityAvatar } from "../ui/identity-avatar";
import { ProjectIcon } from "../ui/project-icon";
import { CALENDAR_CATEGORIES, REMINDER_OPTIONS, categoryById, reminderLabel } from "./categories";
import {
    buildCalendarEvent,
    combineLocalDateTime,
    createCalendarDraft,
    dateInputValue,
    hydrateCalendarDraft,
    isEventEditable,
    isValidTimezone,
    type CalendarAttendee,
    type CalendarEventDraft,
    type CalendarRecurrence,
    type RichCalendarEvent,
} from "./event-draft";

interface Props {
    event: CalendarEvent | null;
    defaultDate: string;
    isOpen: boolean;
    categories?: CalendarCategory[];
    onClose: () => void;
    onSave: (event: CalendarEvent) => boolean | void;
    onDelete: (id: string) => boolean | void;
}

const inputClass = "w-full rounded-lg bg-primary px-3 py-2 text-sm text-primary shadow-xs ring-1 ring-primary outline-none ring-inset [color-scheme:dark] focus:ring-2 focus:ring-brand";
const DAYS = ["S", "M", "T", "W", "T", "F", "S"];
const TIMEZONES = ["UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Toronto", "Europe/London", "Europe/Paris", "Europe/Berlin", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney"];

function uid(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function parseAttendee(value: string): CalendarAttendee | null {
    const clean = value.trim();
    if (!clean) return null;
    const named = clean.match(/^(.+?)\s*<([^>]+)>$/);
    const name = named?.[1]?.trim();
    const email = (named?.[2] ?? (clean.includes("@") ? clean : "")).trim();
    return { id: uid("attendee"), ...(name || !email ? { name: name || clean } : {}), email, response: "needsAction", optional: false };
}

function recurrenceSummary(recurrence: CalendarRecurrence | null): string {
    if (!recurrence) return "Does not repeat";
    const interval = Math.max(1, recurrence.interval || 1);
    const unit = { daily: "day", weekly: "week", monthly: "month", yearly: "year" }[recurrence.frequency];
    const cadence = interval === 1 ? recurrence.frequency : `every ${interval} ${unit}s`;
    if (recurrence.end?.type === "count") return `${cadence} · ${recurrence.end.count ?? 1} times`;
    if (recurrence.end?.type === "date" && recurrence.end.date) return `${cadence} · until ${new Date(recurrence.end.date).toLocaleDateString()}`;
    return cadence;
}

export const CalendarEventEditor = ({ event, defaultDate, isOpen, categories, onClose, onSave, onDelete }: Props) => {
    const categoryList = categories?.length ? categories : CALENDAR_CATEGORIES;
    const initialCategory = categoryList[0] ?? categoryById("work");
    const [draft, setDraft] = useState<CalendarEventDraft>(() => createCalendarDraft(defaultDate, initialCategory.id, initialCategory.color, initialCategory.icon ?? "Calendar"));
    const [showIcons, setShowIcons] = useState(false);
    const [reminderAmount, setReminderAmount] = useState("15");
    const [reminderUnit, setReminderUnit] = useState("minutes");
    const [attendeeInput, setAttendeeInput] = useState("");
    const [tagInput, setTagInput] = useState("");
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [attemptedSave, setAttemptedSave] = useState(false);
    const richEvent = event as RichCalendarEvent | null;
    const occurrenceEditing = Boolean(richEvent?.seriesId);

    useEffect(() => {
        if (!isOpen) return;
        const current = event as RichCalendarEvent | null;
        const eventCategory = categoryList.find((item) => item.id === current?.category) ?? initialCategory;
        setDraft(current ? hydrateCalendarDraft(current) : createCalendarDraft(defaultDate, eventCategory.id, eventCategory.color, eventCategory.icon ?? "Calendar"));
        setShowIcons(false);
        setReminderAmount("15");
        setReminderUnit("minutes");
        setAttendeeInput("");
        setTagInput("");
        setConfirmDelete(false);
        setError(null);
        setAttemptedSave(false);
    }, [event, defaultDate, isOpen]);

    const update = <K extends keyof CalendarEventDraft>(key: K, value: CalendarEventDraft[K]) => {
        setDraft((current) => ({ ...current, [key]: value }));
        setError(null);
    };

    const category = categoryList.find((item) => item.id === draft.category) ?? categoryById(draft.category);
    const recurrenceEndType = draft.recurrence?.end?.type ?? "never";
    const recurrenceEndDate = draft.recurrence?.end?.type === "date" && draft.recurrence.end.date ? dateInputValue(draft.recurrence.end.date, draft.timezone) : draft.endDate;
    const recurrenceCount = draft.recurrence?.end?.type === "count" ? draft.recurrence.end.count ?? 10 : 10;

    const problems = useMemo(() => {
        const next: string[] = [];
        if (!draft.title.trim()) next.push("Add an event title.");
        if (!draft.startDate || !draft.endDate) next.push("Choose a start and end date.");
        if (draft.endDate < draft.startDate) next.push("The end date cannot be before the start date.");
        if (!isValidTimezone(draft.timezone)) next.push("Enter a valid IANA timezone, such as America/New_York.");
        for (const [label, value] of [["Related link", draft.url], ["Conference link", draft.conferenceUrl]] as const) if (value && !/^https?:\/\//i.test(value)) next.push(`${label} must begin with http:// or https://.`);
        if (draft.recurrence?.frequency === "weekly" && !draft.recurrence.weekDays?.length) next.push("Choose at least one weekday for a weekly event.");
        if (draft.recurrence?.end?.type === "date" && (!draft.recurrence.end.date || draft.recurrence.end.date < combineLocalDateTime(draft.startDate, "00:00", draft.timezone))) next.push("The recurrence end date must be on or after the event date.");
        return next;
    }, [draft]);

    const chooseCategory = (id: string) => {
        const next = categoryList.find((item) => item.id === id) ?? categoryById(id);
        setDraft((current) => ({ ...current, category: id, color: next.color, icon: next.icon ?? current.icon }));
    };

    const addReminder = () => {
        const amount = Math.max(0, Number(reminderAmount) || 0);
        const multiplier = reminderUnit === "weeks" ? 10_080 : reminderUnit === "days" ? 1_440 : reminderUnit === "hours" ? 60 : 1;
        update("reminders", [...new Set([...draft.reminders, amount * multiplier])].sort((a, b) => a - b));
    };

    const addAttendee = () => {
        const attendee = parseAttendee(attendeeInput);
        if (!attendee) return;
        const key = (attendee.email || attendee.name || "").toLocaleLowerCase();
        if (!draft.attendees.some((item) => (item.email || item.name || "").toLocaleLowerCase() === key)) update("attendees", [...draft.attendees, attendee]);
        setAttendeeInput("");
    };

    const addTag = () => {
        const tag = tagInput.trim();
        if (tag && !draft.tags.some((item) => item.toLocaleLowerCase() === tag.toLocaleLowerCase())) update("tags", [...draft.tags, tag]);
        setTagInput("");
    };

    const setRecurrence = (frequency: string) => {
        if (frequency === "none") return update("recurrence", null);
        const day = new Date(`${draft.startDate}T12:00:00`).getDay();
        update("recurrence", { frequency: frequency as CalendarRecurrence["frequency"], interval: draft.recurrence?.interval ?? 1, ...(frequency === "weekly" ? { weekDays: draft.recurrence?.weekDays?.length ? draft.recurrence.weekDays : [day] } : {}), end: draft.recurrence?.end ?? { type: "never" } });
    };

    const save = (duplicate = false) => {
        setAttemptedSave(true);
        if (problems.length) return setError(problems[0]);
        const next = buildCalendarEvent(draft, duplicate ? null : richEvent);
        if (duplicate) next.title = `${next.title} (copy)`;
        if (onSave(next) === false) return setError("Coretex could not save this event. Check the connection and try again.");
        onClose();
    };

    const remove = () => {
        if (!event || !isEventEditable(event as RichCalendarEvent)) return;
        if (onDelete((event as RichCalendarEvent).seriesId ?? event.id) === false) return setError("Coretex could not delete this event. Try again.");
        onClose();
    };

    return (
        <SlideoutMenu isOpen={isOpen} onOpenChange={(open) => !open && onClose()} isDismissable dialogClassName="gap-0">
            <SlideoutMenu.Header onClose={onClose} className="flex w-full items-center gap-3 pb-4">
                <IdentityAvatar identity={{ icon: { kind: "untitled-ui", name: draft.icon }, themeColor: draft.color }} name={draft.title || "New event"} size={40} />
                <div className="min-w-0 pr-8"><h1 className="truncate text-md font-semibold text-primary md:text-lg">{event ? "Edit event" : "New event"}</h1><p className="truncate text-xs text-tertiary">{category.label} · {recurrenceSummary(draft.recurrence)}</p></div>
            </SlideoutMenu.Header>

            <SlideoutMenu.Content className="gap-4 border-t border-secondary py-5">
                {occurrenceEditing && <Notice icon={RefreshCw01} tone="brand" title="Editing the recurring series">Changes apply to every occurrence. Individual occurrence editing is not enabled yet.</Notice>}
                <Field label="Event title" required><Input value={draft.title} placeholder="What is happening?" onChange={(value) => update("title", value)} isInvalid={Boolean(error && !draft.title.trim())} /></Field>

                <Section icon={CalendarIcon} title="Appearance" description="Make this event easy to scan across every calendar view.">
                    <Field label="Calendar"><NativeSelect options={categoryList.map((item) => ({ label: item.label, value: item.id }))} value={draft.category} onChange={(e) => chooseCategory(e.target.value)} /></Field>
                    <div className="grid grid-cols-[1fr_auto] items-end gap-3"><Field label="Color"><ColorPicker value={draft.color} onChange={(value) => update("color", value || category.color)} allowCustom /></Field><button type="button" onClick={() => setShowIcons((open) => !open)} className="mb-0.5 inline-flex h-10 items-center gap-2 rounded-lg border border-secondary px-3 text-sm font-semibold text-secondary transition hover:bg-secondary"><ProjectIcon icon={draft.icon} color={draft.color} size={24} />Icon</button></div>
                    {showIcons && <div className="rounded-xl border border-secondary bg-secondary p-3"><IconPicker value={draft.icon} onChange={(value) => update("icon", value)} color={draft.color} /></div>}
                </Section>

                <Section icon={Clock} title="Schedule" description="Set exact dates, wall time, timezone, and availability.">
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-secondary bg-secondary px-3 py-2.5"><div><p className="text-sm font-medium text-primary">All-day event</p><p className="text-xs text-tertiary">Hide start and finish times</p></div><Toggle isSelected={draft.allDay} onChange={(value) => update("allDay", value)} /></div>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Starts"><input type="date" value={draft.startDate} onChange={(e) => { const value = e.target.value; setDraft((current) => ({ ...current, startDate: value, endDate: current.endDate < value ? value : current.endDate })); }} className={inputClass} /></Field>
                        {!draft.allDay && <Field label="Time"><input type="time" value={draft.startTime} onChange={(e) => update("startTime", e.target.value)} className={inputClass} /></Field>}
                        <Field label="Ends"><input type="date" value={draft.endDate} min={draft.startDate} onChange={(e) => update("endDate", e.target.value)} className={inputClass} /></Field>
                        {!draft.allDay && <Field label="Time"><input type="time" value={draft.endTime} onChange={(e) => update("endTime", e.target.value)} className={inputClass} /></Field>}
                    </div>
                    <Field label="Timezone" hint="Times stay fixed in this timezone, including daylight-saving changes."><input list="calendar-timezones" value={draft.timezone} onChange={(e) => update("timezone", e.target.value)} className={inputClass} placeholder="America/New_York" /><datalist id="calendar-timezones">{TIMEZONES.map((timezone) => <option key={timezone} value={timezone} />)}</datalist></Field>
                    <div className="grid grid-cols-2 gap-3"><Field label="Show as"><NativeSelect value={draft.availability} onChange={(e) => update("availability", e.target.value as CalendarEventDraft["availability"])} options={[{ value: "busy", label: "Busy" }, { value: "free", label: "Free" }]} /></Field><Field label="Status"><NativeSelect value={draft.status} onChange={(e) => update("status", e.target.value as CalendarEventDraft["status"])} options={[{ value: "confirmed", label: "Confirmed" }, { value: "tentative", label: "Tentative" }, { value: "cancelled", label: "Cancelled" }]} /></Field></div>
                </Section>

                <Section icon={RefreshCw01} title="Repeat" description="Create a series without duplicating events by hand.">
                    <Field label="Frequency"><NativeSelect value={draft.recurrence?.frequency ?? "none"} onChange={(e) => setRecurrence(e.target.value)} options={[{ value: "none", label: "Does not repeat" }, { value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }, { value: "yearly", label: "Yearly" }]} /></Field>
                    {draft.recurrence && <>
                        <div className="grid grid-cols-[88px_1fr] items-end gap-3"><Field label="Every"><input type="number" min={1} max={365} value={draft.recurrence.interval} onChange={(e) => update("recurrence", { ...draft.recurrence!, interval: Math.max(1, Number(e.target.value) || 1) })} className={inputClass} /></Field><p className="pb-2 text-sm text-secondary">{{ daily: "day", weekly: "week", monthly: "month", yearly: "year" }[draft.recurrence.frequency]}{draft.recurrence.interval === 1 ? "" : "s"}</p></div>
                        {draft.recurrence.frequency === "weekly" && <Field label="On days"><div className="grid grid-cols-7 gap-1.5">{DAYS.map((day, index) => { const active = draft.recurrence?.weekDays?.includes(index) ?? false; return <button key={`${day}-${index}`} type="button" aria-pressed={active} onClick={() => update("recurrence", { ...draft.recurrence!, weekDays: active ? draft.recurrence!.weekDays?.filter((value) => value !== index) : [...(draft.recurrence!.weekDays ?? []), index].sort() })} className={cx("flex aspect-square items-center justify-center rounded-lg border text-xs font-semibold transition", active ? "border-brand bg-brand-primary text-brand-secondary" : "border-secondary text-tertiary hover:bg-secondary")}>{day}</button>; })}</div></Field>}
                        <Field label="Ends"><NativeSelect value={recurrenceEndType} onChange={(e) => update("recurrence", { ...draft.recurrence!, end: e.target.value === "date" ? { type: "date", date: combineLocalDateTime(draft.endDate, "23:59", draft.timezone) } : e.target.value === "count" ? { type: "count", count: 10 } : { type: "never" } })} options={[{ value: "never", label: "Never" }, { value: "date", label: "On a date" }, { value: "count", label: "After a number of events" }]} /></Field>
                        {recurrenceEndType === "date" && <Field label="Last date"><input type="date" min={draft.startDate} value={recurrenceEndDate} onChange={(e) => update("recurrence", { ...draft.recurrence!, end: { type: "date", date: combineLocalDateTime(e.target.value, "23:59", draft.timezone) } })} className={inputClass} /></Field>}
                        {recurrenceEndType === "count" && <Field label="Number of events"><input type="number" min={1} max={999} value={recurrenceCount} onChange={(e) => update("recurrence", { ...draft.recurrence!, end: { type: "count", count: Math.max(1, Number(e.target.value) || 1) } })} className={inputClass} /></Field>}
                    </>}
                </Section>

                <Section icon={BellRinging01} title="Reminders" description="Add as many alerts as you need.">
                    {draft.reminders.length > 0 ? <div className="flex flex-wrap gap-1.5">{draft.reminders.map((minutes) => <Chip key={minutes} onRemove={() => update("reminders", draft.reminders.filter((value) => value !== minutes))}>{reminderLabel(minutes)}</Chip>)}</div> : <p className="text-xs text-tertiary">No reminders set.</p>}
                    <div className="grid grid-cols-[72px_1fr_auto] gap-2"><input type="number" min={0} value={reminderAmount} onChange={(e) => setReminderAmount(e.target.value)} className={inputClass} aria-label="Reminder amount" /><NativeSelect value={reminderUnit} onChange={(e) => setReminderUnit(e.target.value)} options={[{ value: "minutes", label: "minutes before" }, { value: "hours", label: "hours before" }, { value: "days", label: "days before" }, { value: "weeks", label: "weeks before" }]} /><Button size="sm" color="secondary" iconLeading={Plus} onClick={addReminder}>Add</Button></div>
                    <div className="flex flex-wrap gap-1.5">{REMINDER_OPTIONS.slice(0, 6).map((preset) => <button key={preset.value} type="button" onClick={() => update("reminders", [...new Set([...draft.reminders, preset.value])].sort((a, b) => a - b))} className="rounded-full border border-secondary px-2 py-1 text-[11px] font-medium text-tertiary hover:bg-secondary">{preset.label}</button>)}</div>
                </Section>

                <Section icon={MarkerPin01} title="Place & links" description="Keep the physical location and joining details together.">
                    <Field label="Location"><Input value={draft.location} icon={MarkerPin01} placeholder="Office, address, or room" onChange={(value) => update("location", value)} /></Field>
                    <Field label="Related link"><Input value={draft.url} icon={Link01} type="url" placeholder="https://…" onChange={(value) => update("url", value)} /></Field>
                    <Field label="Conference link"><Input value={draft.conferenceUrl} icon={Globe01} type="url" placeholder="Meet, Zoom, Teams…" onChange={(value) => update("conferenceUrl", value)} /></Field>
                </Section>

                <Section icon={Users01} title="People" description="Track guests, responses, and optional attendees.">
                    <div className="flex gap-2"><div className="min-w-0 flex-1"><Input value={attendeeInput} placeholder="Name or Name <email>" onChange={setAttendeeInput} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addAttendee(); } }} /></div><Button size="sm" color="secondary" iconLeading={Plus} onClick={addAttendee}>Add</Button></div>
                    {draft.attendees.length === 0 ? <p className="text-xs text-tertiary">No attendees yet.</p> : <div className="flex flex-col gap-2">{draft.attendees.map((attendee) => <div key={attendee.id} className="rounded-lg border border-secondary bg-secondary p-2.5"><div className="flex items-start gap-2"><IdentityAvatar name={attendee.name || attendee.email || "Guest"} size={28} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-primary">{attendee.name || attendee.email}</p>{attendee.name && attendee.email && <p className="truncate text-xs text-tertiary">{attendee.email}</p>}</div><button type="button" aria-label="Remove attendee" onClick={() => update("attendees", draft.attendees.filter((item) => item.id !== attendee.id))} className="rounded p-1 text-quaternary hover:bg-primary hover:text-secondary"><XClose className="size-3.5" /></button></div><div className="mt-2 grid grid-cols-[1fr_auto] items-center gap-2"><NativeSelect size="sm" value={attendee.response ?? "needsAction"} onChange={(e) => update("attendees", draft.attendees.map((item) => item.id === attendee.id ? { ...item, response: e.target.value as CalendarAttendee["response"] } : item))} options={[{ value: "needsAction", label: "Awaiting response" }, { value: "accepted", label: "Accepted" }, { value: "tentative", label: "Tentative" }, { value: "declined", label: "Declined" }]} /><label className="flex items-center gap-1.5 text-xs text-secondary"><input type="checkbox" checked={attendee.optional ?? false} onChange={(e) => update("attendees", draft.attendees.map((item) => item.id === attendee.id ? { ...item, optional: e.target.checked } : item))} className="size-4 rounded border-secondary accent-[var(--brand)]" />Optional</label></div></div>)}</div>}
                </Section>

                <Section icon={Flag01} title="Organization" description="Control priority, visibility, tags, and custom metadata.">
                    <div className="grid grid-cols-2 gap-3"><Field label="Priority"><NativeSelect value={draft.priority} onChange={(e) => update("priority", e.target.value as CalendarEventDraft["priority"])} options={[{ value: "none", label: "No priority" }, { value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }, { value: "urgent", label: "Urgent" }]} /></Field><Field label="Visibility"><NativeSelect value={draft.visibility} onChange={(e) => update("visibility", e.target.value as CalendarEventDraft["visibility"])} options={[{ value: "default", label: "Default" }, { value: "public", label: "Public" }, { value: "private", label: "Private" }]} /></Field></div>
                    <Field label="Tags"><div className="flex gap-2"><div className="min-w-0 flex-1"><Input value={tagInput} icon={Tag01} placeholder="Add a tag" onChange={setTagInput} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }} /></div><Button size="sm" color="secondary" onClick={addTag}>Add</Button></div>{draft.tags.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{draft.tags.map((tag) => <Chip key={tag} onRemove={() => update("tags", draft.tags.filter((item) => item !== tag))}>{tag}</Chip>)}</div>}</Field>
                    <Field label="Custom fields"><div className="flex flex-col gap-2">{draft.customFields.map((field) => <div key={field.id} className="grid grid-cols-[1fr_1fr_auto] gap-2"><input value={field.label} onChange={(e) => update("customFields", draft.customFields.map((item) => item.id === field.id ? { ...item, label: e.target.value } : item))} className={inputClass} placeholder="Label" /><input value={field.value} onChange={(e) => update("customFields", draft.customFields.map((item) => item.id === field.id ? { ...item, value: e.target.value } : item))} className={inputClass} placeholder="Value" /><button type="button" aria-label="Remove custom field" onClick={() => update("customFields", draft.customFields.filter((item) => item.id !== field.id))} className="rounded-lg border border-secondary p-2 text-quaternary hover:bg-secondary hover:text-error-primary"><XClose className="size-4" /></button></div>)}</div><Button size="sm" color="link-gray" iconLeading={Plus} onClick={() => update("customFields", [...draft.customFields, { id: uid("field"), label: "", value: "" }])}>Add field</Button></Field>
                </Section>

                <Section icon={Eye} title="Notes" description="Add an agenda, preparation notes, or useful context."><TextArea value={draft.description} placeholder="Agenda, notes, instructions…" onChange={(value) => update("description", value)} rows={5} /></Section>
                {(error || (attemptedSave && problems.length > 0)) && <Notice icon={AlertCircle} tone="error" title={error ?? "Review this event"}>{error ? "Your draft is still here." : `${problems.length} detail${problems.length === 1 ? "" : "s"} need attention before saving.`}</Notice>}
            </SlideoutMenu.Content>

            <SlideoutMenu.Footer className="flex w-full flex-col gap-3">
                {confirmDelete && <div className="flex items-center justify-between gap-3 rounded-lg bg-error-primary px-3 py-2"><p className="text-xs text-error-primary">Delete this {draft.recurrence ? "entire series" : "event"}?</p><div className="flex gap-1"><Button size="sm" color="secondary" onClick={() => setConfirmDelete(false)}>Keep</Button><Button size="sm" color="primary-destructive" onClick={remove}>Delete</Button></div></div>}
                <div className="flex items-center justify-between gap-2"><div className="flex gap-1">{event && <Button size="sm" color="tertiary-destructive" iconLeading={Trash01} onClick={() => setConfirmDelete(true)}>Delete</Button>}{event && <Button size="sm" color="link-gray" iconLeading={Copy01} onClick={() => save(true)}>Duplicate</Button>}</div><div className="flex gap-2"><Button size="sm" color="secondary" onClick={onClose}>Cancel</Button><Button size="sm" color="primary" iconLeading={CheckCircle} onClick={() => save(false)}>{event ? "Save changes" : "Create event"}</Button></div></div>
            </SlideoutMenu.Footer>
        </SlideoutMenu>
    );
};

const Field = ({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: ReactNode }) => <label className="flex min-w-0 flex-col gap-1.5"><span className="text-xs font-medium text-secondary">{label}{required && <span className="ml-0.5 text-error-primary">*</span>}</span>{children}{hint && <span className="text-[11px] leading-4 text-tertiary">{hint}</span>}</label>;

const Section = ({ icon: Icon, title, description, children }: { icon: ComponentType<{ className?: string }>; title: string; description: string; children: ReactNode }) => <section className="rounded-xl border border-secondary bg-primary p-3.5 shadow-xs"><div className="mb-3 flex items-start gap-2.5"><span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-primary text-brand-secondary"><Icon className="size-4" /></span><div><h2 className="text-sm font-semibold text-primary">{title}</h2><p className="mt-0.5 text-xs leading-4 text-tertiary">{description}</p></div></div><div className="flex flex-col gap-3">{children}</div></section>;

const Chip = ({ children, onRemove }: { children: ReactNode; onRemove: () => void }) => <span className="inline-flex items-center gap-1 rounded-full border border-secondary bg-secondary py-1 pr-1.5 pl-2.5 text-xs font-medium text-secondary">{children}<button type="button" onClick={onRemove} className="rounded-full p-0.5 text-quaternary hover:bg-primary hover:text-secondary"><XClose className="size-3" /></button></span>;

const Notice = ({ icon: Icon, tone, title, children }: { icon: ComponentType<{ className?: string }>; tone: "brand" | "error"; title: string; children: ReactNode }) => <div className={cx("flex gap-2.5 rounded-xl border p-3", tone === "error" ? "border-error-subtle bg-error-primary" : "border-brand-secondary bg-brand-primary")}><Icon className={cx("mt-0.5 size-4 shrink-0", tone === "error" ? "text-error-primary" : "text-brand-secondary")} /><div><p className="text-xs font-semibold text-primary">{title}</p><p className="mt-0.5 text-xs leading-4 text-tertiary">{children}</p></div></div>;
