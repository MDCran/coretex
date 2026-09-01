import type {
    CalendarEvent,
    CalendarEventAttendee,
    CalendarEventCustomField,
    CalendarEventRecurrence,
    CalendarEventSource as CoreCalendarEventSource,
    CalendarEventSourceKind,
} from "@repo/coretex/types";

export type CalendarEventStatus = "confirmed" | "tentative" | "cancelled";
export type CalendarEventPriority = "none" | "low" | "medium" | "high" | "urgent";
export type CalendarEventAvailability = "busy" | "free";
export type CalendarEventVisibility = "default" | "public" | "private";
export type CalendarRecurrenceFrequency = "daily" | "weekly" | "monthly" | "yearly";
export type CalendarRecurrenceEnd = NonNullable<CalendarEventRecurrence["end"]>;
export type CalendarRecurrence = CalendarEventRecurrence;
export type CalendarAttendee = CalendarEventAttendee;
export type CalendarCustomField = CalendarEventCustomField;
export type CalendarSourceKind = CalendarEventSourceKind;
export type CalendarEventSource = CoreCalendarEventSource;

/** Optional metadata layered over the original local-calendar DTO. */
export type RichCalendarEvent = CalendarEvent & {
    /** UI-only identity for a generated recurring occurrence. */
    seriesId?: string;
    occurrenceStart?: number;
};

export interface CalendarEventDraft {
    title: string;
    category: string;
    color: string;
    icon: string;
    allDay: boolean;
    startDate: string;
    endDate: string;
    startTime: string;
    endTime: string;
    timezone: string;
    status: CalendarEventStatus;
    priority: CalendarEventPriority;
    availability: CalendarEventAvailability;
    visibility: CalendarEventVisibility;
    location: string;
    url: string;
    conferenceUrl: string;
    description: string;
    attendees: CalendarAttendee[];
    reminders: number[];
    recurrence: CalendarRecurrence | null;
    tags: string[];
    customFields: CalendarCustomField[];
    /** Original instant/wall-time pair; preserves the later side of a DST fold on metadata-only edits. */
    original?: {
        start: number;
        end: number;
        timezone: string;
        allDay: boolean;
        startDate: string;
        endDate: string;
        startTime: string;
        endTime: string;
    };
}

const pad = (value: number) => String(value).padStart(2, "0");

interface ZonedParts {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
}

function zonedParts(ms: number, timezone: string): ZonedParts {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: normalizeTimezone(timezone),
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).formatToParts(new Date(ms));
    const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute") };
}

export function dateInputValue(ms: number, timezone = localTimezone()): string {
    const date = zonedParts(ms, timezone);
    return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}

export function timeInputValue(ms: number, timezone = localTimezone()): string {
    const date = zonedParts(ms, timezone);
    return `${pad(date.hour)}:${pad(date.minute)}`;
}

function timezoneOffsetAt(ms: number, timezone: string): number {
    const value = zonedParts(ms, timezone);
    return Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute) - Math.floor(ms / 60_000) * 60_000;
}

/** Convert an IANA-zone wall time into an epoch, including DST gaps and folds. */
export function combineLocalDateTime(dateValue: string, timeValue = "00:00", timezone = localTimezone(), preferredEpoch?: number): number {
    const [year, month, day] = dateValue.split("-").map(Number);
    const [hour, minute] = timeValue.split(":").map(Number);
    const zone = normalizeTimezone(timezone);
    const desiredWallTime = Date.UTC(year, (month || 1) - 1, day || 1, hour || 0, minute || 0, 0, 0);
    const offsets = new Set([
        timezoneOffsetAt(desiredWallTime - 12 * 60 * 60_000, zone),
        timezoneOffsetAt(desiredWallTime, zone),
        timezoneOffsetAt(desiredWallTime + 12 * 60 * 60_000, zone),
    ]);
    const candidates = [...offsets]
        .map((offset) => desiredWallTime - offset)
        .map((epoch) => {
            const rendered = zonedParts(epoch, zone);
            const renderedWallTime = Date.UTC(rendered.year, rendered.month - 1, rendered.day, rendered.hour, rendered.minute);
            return { epoch, difference: renderedWallTime - desiredWallTime };
        })
        .sort((a, b) => a.epoch - b.epoch);
    // A repeated fall-back wall time has two exact candidates; choose the first.
    const exactCandidates = candidates.filter((candidate) => candidate.difference === 0);
    const exact = Number.isFinite(preferredEpoch)
        ? exactCandidates.sort((a, b) => Math.abs(a.epoch - Number(preferredEpoch)) - Math.abs(b.epoch - Number(preferredEpoch)))[0]
        : exactCandidates[0];
    if (exact) return exact.epoch;
    // A skipped spring-forward wall time has no exact instant. Move forward to the
    // first valid wall time (02:30 becomes 03:30), matching calendar convention.
    const afterGap = candidates
        .filter((candidate) => candidate.difference > 0)
        .sort((a, b) => a.difference - b.difference)[0];
    return afterGap?.epoch ?? candidates.sort((a, b) => Math.abs(a.difference) - Math.abs(b.difference))[0]?.epoch ?? desiredWallTime;
}

export function addCalendarDays(dateValue: string, count: number): string {
    const [year, month, day] = dateValue.split("-").map(Number);
    const date = new Date(Date.UTC(year, (month || 1) - 1, (day || 1) + count));
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function localTimezone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
        return "UTC";
    }
}

export function normalizeTimezone(value: string | null | undefined): string {
    const timezone = value?.trim() || localTimezone();
    try {
        new Intl.DateTimeFormat(undefined, { timeZone: timezone }).format();
        return timezone;
    } catch {
        return localTimezone();
    }
}

export function isValidTimezone(value: string): boolean {
    if (!value.trim()) return false;
    try {
        new Intl.DateTimeFormat(undefined, { timeZone: value.trim() }).format();
        return true;
    } catch {
        return false;
    }
}

function uniqueStrings(values: string[]): string[] {
    const seen = new Set<string>();
    return values.flatMap((value) => {
        const clean = value.trim();
        const key = clean.toLocaleLowerCase();
        if (!clean || seen.has(key)) return [];
        seen.add(key);
        return [clean];
    });
}

function normalizeAttendees(attendees: CalendarAttendee[]): CalendarAttendee[] {
    const seen = new Set<string>();
    return attendees.flatMap((attendee, index) => {
        const email = attendee.email.trim();
        const name = attendee.name?.trim() || undefined;
        const key = (email || name || String(index)).toLocaleLowerCase();
        if ((!email && !name) || seen.has(key)) return [];
        seen.add(key);
        return [{
            id: attendee.id || `attendee_${key.replace(/[^a-z0-9]+/g, "_")}`,
            ...(name ? { name } : {}),
            email,
            response: attendee.response ?? "needsAction",
            optional: Boolean(attendee.optional),
        }];
    });
}

export function normalizeRecurrence(recurrence: CalendarRecurrence | null | undefined): CalendarRecurrence | null {
    if (!recurrence) return null;
    const interval = Math.max(1, Math.round(Number(recurrence.interval) || 1));
    const weekDays = recurrence.frequency === "weekly"
        ? [...new Set((recurrence.weekDays ?? []).map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort()
        : undefined;
    let end: CalendarRecurrenceEnd = { type: "never" };
    if (recurrence.end?.type === "date" && Number.isFinite(recurrence.end.date)) {
        end = { type: "date", date: Number(recurrence.end.date) };
    } else if (recurrence.end?.type === "count") {
        end = { type: "count", count: Math.max(1, Math.round(Number(recurrence.end.count) || 1)) };
    }
    return { frequency: recurrence.frequency, interval, ...(weekDays?.length ? { weekDays } : {}), end };
}

export function createCalendarDraft(defaultDate: string, category = "work", color = "#3b82f6", icon = "Calendar"): CalendarEventDraft {
    return {
        title: "",
        category,
        color,
        icon,
        allDay: false,
        startDate: defaultDate,
        endDate: defaultDate,
        startTime: "09:00",
        endTime: "10:00",
        timezone: localTimezone(),
        status: "confirmed",
        priority: "none",
        availability: "busy",
        visibility: "default",
        location: "",
        url: "",
        conferenceUrl: "",
        description: "",
        attendees: [],
        reminders: [10],
        recurrence: null,
        tags: [],
        customFields: [],
    };
}

export function hydrateCalendarDraft(event: RichCalendarEvent, defaultDate = dateInputValue(event.start)): CalendarEventDraft {
    const timezone = normalizeTimezone(event.timezone);
    const legacyAttendees = (event.attendees ?? []).map((entry, index) => ({
        id: `legacy_${index}_${entry.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
        email: entry,
        response: "needsAction" as const,
        optional: false,
    }));
    const startDate = dateInputValue(event.start, timezone);
    const endDate = dateInputValue(event.end, timezone);
    const startTime = timeInputValue(event.start, timezone);
    const endTime = timeInputValue(event.end, timezone);
    return {
        ...createCalendarDraft(defaultDate, event.category, event.color, event.icon ?? "Calendar"),
        title: event.title,
        allDay: event.allDay,
        startDate,
        endDate,
        startTime,
        endTime,
        timezone,
        status: event.status ?? "confirmed",
        priority: event.priority ?? "none",
        availability: event.availability ?? "busy",
        visibility: event.visibility ?? "default",
        location: event.location ?? "",
        url: event.url ?? "",
        conferenceUrl: event.conferenceUrl ?? "",
        description: event.description ?? "",
        attendees: normalizeAttendees(event.attendeeDetails?.length ? event.attendeeDetails : legacyAttendees),
        reminders: [...new Set((event.reminders ?? []).map(Number).filter((value) => Number.isFinite(value) && value >= 0))].sort((a, b) => a - b),
        recurrence: normalizeRecurrence(event.recurrence),
        tags: uniqueStrings(event.tags ?? []),
        customFields: (event.customFields ?? []).map((field) => ({ ...field })),
        original: { start: event.start, end: event.end, timezone, allDay: event.allDay, startDate, endDate, startTime, endTime },
    };
}

export function buildCalendarEvent(draft: CalendarEventDraft, previous?: RichCalendarEvent | null, now = Date.now()): RichCalendarEvent {
    const timezone = normalizeTimezone(draft.timezone);
    const original = draft.original;
    const sameZoneAndMode = Boolean(original && original.timezone === timezone && original.allDay === draft.allDay);
    const unchangedStart = Boolean(sameZoneAndMode && original?.startDate === draft.startDate && (draft.allDay || original?.startTime === draft.startTime));
    const startPreference = original?.startDate === draft.startDate && original.timezone === timezone ? original.start : undefined;
    const start = unchangedStart ? original!.start : combineLocalDateTime(draft.startDate, draft.allDay ? "00:00" : draft.startTime, timezone, startPreference);
    let end: number;
    const unchangedEnd = Boolean(sameZoneAndMode && original?.endDate === draft.endDate && (draft.allDay || original?.endTime === draft.endTime));
    if (unchangedStart && unchangedEnd) {
        end = original!.end;
    } else if (draft.allDay) {
        const finalDate = (draft.endDate || draft.startDate) < draft.startDate ? draft.startDate : (draft.endDate || draft.startDate);
        end = combineLocalDateTime(addCalendarDays(finalDate, 1), "00:00", timezone) - 1;
    } else {
        const endPreference = original?.endDate === (draft.endDate || draft.startDate) && original.timezone === timezone ? original.end : undefined;
        end = combineLocalDateTime(draft.endDate || draft.startDate, draft.endTime, timezone, endPreference);
        // A finish time before the start time on the same date is an overnight event.
        if (end < start && (draft.endDate || draft.startDate) === draft.startDate) {
            end = combineLocalDateTime(addCalendarDays(draft.startDate, 1), draft.endTime, timezone);
        }
        if (end <= start) end = start + 30 * 60_000;
    }
    const attendees = normalizeAttendees(draft.attendees);
    const reminders = [...new Set(draft.reminders.map(Number).filter((value) => Number.isFinite(value) && value >= 0))].sort((a, b) => a - b);
    const tags = uniqueStrings(draft.tags);
    const customFields = draft.customFields
        .map((field, index) => ({ id: field.id || `field_${now}_${index}`, label: field.label.trim(), value: field.value.trim() }))
        .filter((field) => field.label || field.value);
    const result: RichCalendarEvent = {
        ...(previous ?? {}),
        id: previous?.id ?? `evt_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        title: draft.title.trim() || "Untitled event",
        category: draft.category,
        color: draft.color,
        icon: draft.icon,
        allDay: draft.allDay,
        start,
        end,
        timezone,
        status: draft.status,
        priority: draft.priority,
        availability: draft.availability,
        visibility: draft.visibility,
        location: draft.location.trim() || undefined,
        url: draft.url.trim() || undefined,
        conferenceUrl: draft.conferenceUrl.trim() || undefined,
        description: draft.description.trim() || undefined,
        attendees: attendees.map((attendee) => attendee.email || attendee.name || "").filter(Boolean),
        attendeeDetails: attendees,
        reminders,
        recurrence: normalizeRecurrence(draft.recurrence),
        tags,
        customFields,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
    };
    delete result.seriesId;
    delete result.occurrenceStart;
    return result;
}

export function isEventEditable(event: RichCalendarEvent): boolean {
    if (event.source?.editable === false) return false;
    return !String(event.id).startsWith("overlay:");
}
