import type { CalendarEvent } from "@repo/coretex/types";
import { categoryById } from "./categories";
import {
    addCalendarDays,
    combineLocalDateTime,
    dateInputValue,
    normalizeTimezone,
    timeInputValue,
    type CalendarEventSource,
    type CalendarSourceKind,
    type RichCalendarEvent,
} from "./event-draft";

export interface FinancialCalendarSignal {
    id: string;
    date: string | null;
    label: string;
    amount: number;
    currency: string;
    kind: string;
    overdue: boolean;
}

export interface PersonalCalendarSignal {
    id: string;
    title: string;
    start: string;
    end: string | null;
    allDay: boolean;
    category: "todos" | "social" | "workouts" | "nutrition" | "health";
    description: string | null;
    status: string | null;
    source?: CalendarEventSource;
    icon?: string | null;
    color?: string | null;
    href?: string | null;
}

export interface CalendarModuleState {
    agents?: Array<Record<string, any>>;
    projects?: Array<Record<string, any>>;
    tasks?: Array<Record<string, any>>;
    email?: { messages?: Array<Record<string, any>> } | null;
    mail?: { messages?: Array<Record<string, any>>; inbox?: Array<Record<string, any>> } | null;
}

function daySpan(value: Date): { start: number; end: number } {
    const start = new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
    const end = new Date(value.getFullYear(), value.getMonth(), value.getDate() + 1).getTime() - 1;
    return { start, end };
}

function dateKeySpan(value: string): { start: number; end: number } {
    const [year, month, day] = value.slice(0, 10).split("-").map(Number);
    return {
        start: new Date(year, (month || 1) - 1, day || 1).getTime(),
        end: new Date(year, (month || 1) - 1, (day || 1) + 1).getTime() - 1,
    };
}

function timestamp(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "string" && !(value instanceof Date)) return null;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
}

function source(kind: CalendarSourceKind, id: string, label: string, href: string): CalendarEventSource {
    return { kind, id, label, editable: false, href };
}

function readonlyEvent(input: {
    id: string;
    title: string;
    start: number;
    end: number;
    allDay?: boolean;
    category: string;
    description?: string;
    status?: string;
    priority?: RichCalendarEvent["priority"];
    source: CalendarEventSource;
    color?: string;
    icon?: string;
}, now: number): RichCalendarEvent {
    const presentation = categoryById(input.category);
    return {
        id: `overlay:${input.source.kind}:${input.id}`,
        title: input.title,
        start: input.start,
        end: input.end,
        allDay: input.allDay ?? true,
        category: input.category,
        color: input.color || presentation.color,
        icon: input.icon || presentation.icon,
        description: input.description,
        attendees: [],
        reminders: [],
        createdAt: now,
        updatedAt: now,
        status: input.status === "cancelled" || input.status === "tentative" ? input.status : "confirmed",
        priority: input.priority ?? "none",
        visibility: "default",
        availability: "busy",
        source: input.source,
    };
}

/** Workspace-native signals available synchronously in Coretex state. */
export function deriveWorkspaceCalendarEvents(state: CalendarModuleState, now = Date.now()): RichCalendarEvent[] {
    const out: RichCalendarEvent[] = [];

    for (const agent of state.agents ?? []) {
        if (agent.status !== "working" && agent.status !== "thinking") continue;
        const id = String(agent.id ?? agent.config?.name ?? "agent");
        const span = daySpan(new Date(now));
        out.push(readonlyEvent({
            id,
            title: `Agent · ${agent.config?.name || agent.name || "Agent"}`,
            ...span,
            category: "agents",
            description: [agent.config?.role, agent.config?.model, agent.status].filter(Boolean).join(" · "),
            status: "confirmed",
            source: source("agent", id, "Agents", `/agents/${encodeURIComponent(id)}`),
        }, now));
    }

    for (const project of state.projects ?? []) {
        const metadata = project.metadata && typeof project.metadata === "object" ? project.metadata : {};
        const due = timestamp(project.dueAt ?? project.targetDate ?? project.deadline ?? metadata.dueAt ?? metadata.targetDate ?? metadata.deadline);
        if (due === null) continue;
        const id = String(project.id ?? project.name ?? "project");
        out.push(readonlyEvent({
            id,
            title: `Project · ${project.name || "Deadline"}`,
            ...daySpan(new Date(due)),
            category: "projects",
            description: [project.description, project.status].filter(Boolean).join(" · "),
            priority: project.priority === "high" || project.priority === "urgent" ? project.priority : "none",
            source: source("project", id, "Projects", `/projects/${encodeURIComponent(id)}`),
        }, now));
    }

    for (const task of state.tasks ?? []) {
        if (task.status === "completed" || task.status === "cancelled") continue;
        const due = timestamp(task.dueAt ?? task.plannedAt ?? task.scheduledAt);
        if (due === null) continue;
        const id = String(task.id ?? task.title ?? "todo");
        out.push(readonlyEvent({
            id,
            title: task.title || "Todo",
            ...daySpan(new Date(due)),
            category: "todos",
            description: ["Todo", task.status?.replaceAll?.("_", " "), task.description].filter(Boolean).join(" · "),
            status: task.status === "cancelled" ? "cancelled" : "confirmed",
            priority: ["low", "medium", "high", "urgent"].includes(task.priority) ? task.priority : "none",
            source: source("todo", id, "Todos", `/todos/${encodeURIComponent(id)}`),
        }, now));
    }

    const mailbox = state.email ?? state.mail;
    const messages = mailbox?.messages ?? ("inbox" in (mailbox ?? {}) ? state.mail?.inbox : undefined) ?? [];
    for (const message of messages.slice(0, 60)) {
        const receivedAt = timestamp(message.timestamp ?? message.date ?? message.receivedAt ?? message.createdAt);
        if (receivedAt === null) continue;
        const id = String(message.id ?? `${message.subject || "email"}-${receivedAt}`);
        out.push(readonlyEvent({
            id,
            title: message.subject || "Email",
            ...daySpan(new Date(receivedAt)),
            category: "email",
            description: [message.from?.name ?? message.from?.email ?? message.from, message.preview ?? message.snippet].filter(Boolean).join(" · "),
            source: source("email", id, "Email", `/email/${encodeURIComponent(id)}`),
        }, now));
    }
    return out;
}

/** Bills and subscriptions returned by the financial calendar endpoint. */
export function deriveFinancialCalendarEvents(events: FinancialCalendarSignal[] | undefined, now = Date.now()): RichCalendarEvent[] {
    if (!events?.length) return [];
    return events.flatMap((event) => {
        if (!event.date) return [];
        const span = dateKeySpan(event.date);
        const start = span.start;
        if (!Number.isFinite(start)) return [];
        let amount = String(event.amount);
        try {
            amount = new Intl.NumberFormat(undefined, { style: "currency", currency: event.currency || "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(event.amount);
        } catch {
            // Keep the numeric fallback for an unknown currency code.
        }
        return [readonlyEvent({
            id: event.id,
            title: `${event.label} · ${amount}`,
            start,
            end: span.end,
            category: "financial",
            description: `${event.kind === "CARD_PAYMENT" ? "Card payment due" : "Subscription charge"}${event.overdue ? " · Overdue" : ""}`,
            priority: event.overdue ? "urgent" : "medium",
            source: source("financial", event.id, "Financial", `/financial`),
        }, now)];
    });
}

const PERSONAL_KIND: Record<PersonalCalendarSignal["category"], CalendarSourceKind> = {
    todos: "todo",
    social: "social",
    workouts: "workout",
    nutrition: "nutrition",
    health: "health",
};

const PERSONAL_HREF: Record<PersonalCalendarSignal["category"], string> = {
    todos: "/todos",
    social: "/social",
    workouts: "/workouts",
    nutrition: "/nutrition",
    health: "/health",
};

/** LifeOS signals, including todos, social, workouts, nutrition, and health. */
export function derivePersonalCalendarEvents(signals: PersonalCalendarSignal[] | undefined, now = Date.now()): RichCalendarEvent[] {
    if (!signals?.length) return [];
    return signals.flatMap((signal) => {
        const start = signal.allDay
            ? dateKeySpan(signal.start).start
            : new Date(signal.start).getTime();
        const end = signal.allDay
            ? dateKeySpan(signal.end || signal.start).end
            : signal.end
                ? new Date(signal.end).getTime()
                : start + 60 * 60_000;
        if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
        const normalizedStatus = signal.status?.toLowerCase().replaceAll("_", " ") ?? "";
        const kind = PERSONAL_KIND[signal.category];
        return [readonlyEvent({
            id: signal.id,
            title: signal.title,
            start,
            end,
            allDay: signal.allDay,
            category: signal.category,
            color: signal.color || undefined,
            icon: signal.icon || undefined,
            description: [signal.description, normalizedStatus].filter(Boolean).join(" · "),
            status: normalizedStatus === "cancelled" ? "cancelled" : normalizedStatus === "tentative" ? "tentative" : "confirmed",
            source: {
                ...(signal.source ?? source(kind, signal.id, categoryById(signal.category).label, signal.href || PERSONAL_HREF[signal.category])),
                kind,
                id: signal.source?.id ?? signal.id,
                editable: false,
                href: signal.source?.href ?? signal.href ?? PERSONAL_HREF[signal.category],
            },
        }, now)];
    });
}

/** Stable merge: local user events win, then the first source signal for a key. */
export function mergeCalendarEvents(...groups: Array<Array<CalendarEvent | RichCalendarEvent> | null | undefined>): RichCalendarEvent[] {
    const byKey = new Map<string, RichCalendarEvent>();
    for (const group of groups) {
        for (const event of group ?? []) {
            const rich = event as RichCalendarEvent;
            const sourceKey = rich.source?.id ? `${rich.source.kind}:${rich.source.id}` : "";
            const key = String(rich.id).startsWith("overlay:") && sourceKey ? `source:${sourceKey}` : `event:${rich.id}`;
            if (!byKey.has(key)) byKey.set(key, rich);
        }
    }
    return [...byKey.values()].sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
}

function dateOrdinal(dateValue: string): number {
    const [year, month, day] = dateValue.split("-").map(Number);
    return Math.floor(Date.UTC(year, (month || 1) - 1, day || 1) / 86_400_000);
}

function dateParts(dateValue: string): { year: number; month: number; day: number } {
    const [year, month, day] = dateValue.split("-").map(Number);
    return { year, month: month || 1, day: day || 1 };
}

function weekday(dateValue: string): number {
    const { year, month, day } = dateParts(dateValue);
    return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function daysInMonth(year: number, month: number): number {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function recurrenceMatches(event: RichCalendarEvent, dateValue: string, startDate: string): boolean {
    const recurrence = event.recurrence;
    if (!recurrence) return dateValue === startDate;
    const interval = Math.max(1, Math.round(recurrence.interval || 1));
    const dayDifference = dateOrdinal(dateValue) - dateOrdinal(startDate);
    if (dayDifference < 0) return false;
    const start = dateParts(startDate);
    const candidate = dateParts(dateValue);
    if (recurrence.frequency === "daily") return dayDifference % interval === 0;
    if (recurrence.frequency === "weekly") {
        const activeDays = recurrence.weekDays?.length ? recurrence.weekDays : [weekday(startDate)];
        const startWeek = dateOrdinal(startDate) - weekday(startDate);
        const candidateWeek = dateOrdinal(dateValue) - weekday(dateValue);
        return Math.floor((candidateWeek - startWeek) / 7) % interval === 0 && activeDays.includes(weekday(dateValue));
    }
    if (recurrence.frequency === "monthly") {
        const monthDifference = (candidate.year - start.year) * 12 + candidate.month - start.month;
        return monthDifference >= 0 && monthDifference % interval === 0 && candidate.day === Math.min(start.day, daysInMonth(candidate.year, candidate.month));
    }
    const yearDifference = candidate.year - start.year;
    return yearDifference >= 0
        && yearDifference % interval === 0
        && candidate.month === start.month
        && candidate.day === Math.min(start.day, daysInMonth(candidate.year, start.month));
}

/**
 * Expand base recurrence rules for display only. Occurrences keep `seriesId`, so
 * edit/delete operations always resolve back to the single persisted series.
 */
export function expandRecurringCalendarEvents(
    events: Array<CalendarEvent | RichCalendarEvent>,
    rangeStart: number,
    rangeEnd: number,
    limit = 1_000,
): RichCalendarEvent[] {
    const expanded: RichCalendarEvent[] = [];
    for (const raw of events) {
        const event = raw as RichCalendarEvent;
        if (!event.recurrence) {
            if (event.end >= rangeStart && event.start <= rangeEnd) expanded.push(event);
            continue;
        }
        const timezone = normalizeTimezone(event.timezone);
        const seriesStartDate = dateInputValue(event.start, timezone);
        const seriesEndDate = dateInputValue(event.end, timezone);
        const startTime = timeInputValue(event.start, timezone);
        const endTime = timeInputValue(event.end, timezone);
        const durationDays = Math.max(0, dateOrdinal(seriesEndDate) - dateOrdinal(seriesStartDate));
        const [startHour, startMinute] = startTime.split(":").map(Number);
        const [endHour, endMinute] = endTime.split(":").map(Number);
        const wallDuration = Math.max(60_000, ((durationDays * 24 * 60) + (endHour * 60 + endMinute) - (startHour * 60 + startMinute)) * 60_000);
        const recurrenceEnd = event.recurrence.end ?? { type: "never" as const };
        const scanEndDate = dateInputValue(rangeEnd, timezone);
        const rangeStartDate = dateInputValue(rangeStart, timezone);
        const jumpDate = addCalendarDays(rangeStartDate, -Math.max(8, durationDays + 1));
        // Count-limited series must retain the exact ordinal, so scan from DTSTART.
        // Other rules can jump close to the requested window; recurrenceMatches is
        // anchored to DTSTART and still preserves interval phase.
        let candidateDate = recurrenceEnd.type === "count" || jumpDate <= seriesStartDate ? seriesStartDate : jumpDate;
        let occurrenceNumber = 0;
        while (candidateDate <= scanEndDate) {
            if (recurrenceMatches(event, candidateDate, seriesStartDate)) {
                const isFirstOccurrence = candidateDate === seriesStartDate;
                const occurrenceStart = isFirstOccurrence ? event.start : combineLocalDateTime(candidateDate, event.allDay ? "00:00" : startTime, timezone);
                // Some zones have skipped an entire civil date (for example Apia
                // 2011-12-30). A normalized instant landing on another date is not
                // an occurrence and must not consume a count slot.
                if (!isFirstOccurrence && dateInputValue(occurrenceStart, timezone) !== candidateDate) {
                    candidateDate = addCalendarDays(candidateDate, 1);
                    continue;
                }
                occurrenceNumber += 1;
                if (recurrenceEnd.type === "count" && occurrenceNumber > Math.max(1, Number(recurrenceEnd.count) || 1)) break;
                if (recurrenceEnd.type === "date" && Number.isFinite(recurrenceEnd.date) && occurrenceStart > Number(recurrenceEnd.date)) break;
                const occurrenceEndDate = addCalendarDays(candidateDate, durationDays);
                const occurrenceEnd = isFirstOccurrence
                    ? event.end
                    : event.allDay
                        ? combineLocalDateTime(addCalendarDays(occurrenceEndDate, 1), "00:00", timezone) - 1
                        : combineLocalDateTime(occurrenceEndDate, endTime, timezone);
                if (occurrenceEnd >= rangeStart && occurrenceStart <= rangeEnd) {
                    expanded.push({
                        ...event,
                        id: `${event.id}::occurrence:${occurrenceStart}`,
                        start: occurrenceStart,
                        end: occurrenceEnd > occurrenceStart ? occurrenceEnd : occurrenceStart + (event.allDay ? 0 : wallDuration),
                        seriesId: event.id,
                        occurrenceStart,
                    });
                }
            }
            candidateDate = addCalendarDays(candidateDate, 1);
        }
    }
    return expanded.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title)).slice(0, Math.max(0, limit));
}
