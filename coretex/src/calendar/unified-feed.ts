import type {
    AgentState,
    CalendarEvent,
    CalendarEventSource,
    EmailMessage,
    Project,
    Task,
} from "../types.js";

export interface UnifiedCalendarSignal {
    id: string;
    title: string;
    start: number | string | Date;
    end?: number | string | Date | null;
    allDay?: boolean;
    category: "financial" | "social" | "workouts" | "nutrition" | "health" | "todos";
    description?: string | null;
    status?: string | null;
    source: CalendarEventSource;
    color?: string;
    icon?: string;
}

export interface FinancialCalendarSignal {
    id: string;
    date: string | null;
    label: string;
    amount: number;
    currency: string;
    kind: string;
    overdue: boolean;
}

export interface UnifiedCalendarSources {
    userEvents?: CalendarEvent[];
    agents?: AgentState[];
    projects?: Project[];
    tasks?: Task[];
    emails?: EmailMessage[];
    financial?: FinancialCalendarSignal[];
    personal?: UnifiedCalendarSignal[];
    range?: { start: number; end: number };
    now?: number;
}

const SOURCE_STYLE = {
    user: { category: "personal", color: "#22c55e", icon: "Calendar" },
    agent: { category: "agents", color: "#a855f7", icon: "Users01" },
    project: { category: "projects", color: "#0ea5e9", icon: "FolderCode" },
    email: { category: "email", color: "#f59e0b", icon: "Mail01" },
    financial: { category: "financial", color: "#10b981", icon: "BankNote01" },
    social: { category: "social", color: "#ec4899", icon: "MessageChatCircle" },
    workout: { category: "workouts", color: "#f97316", icon: "Activity" },
    nutrition: { category: "nutrition", color: "#84cc16", icon: "Beaker01" },
    health: { category: "health", color: "#06b6d4", icon: "ActivityHeart" },
    todo: { category: "todos", color: "#6366f1", icon: "CheckSquare" },
} as const;

const toEpoch = (value: number | string | Date | null | undefined): number | null => {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
    if (typeof value !== "string" || !value.trim()) return null;
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
    const result = new Date(dateOnly ? `${value}T00:00:00` : value).getTime();
    return Number.isFinite(result) ? result : null;
};

const localDay = (value: number): { start: number; end: number } => {
    const date = new Date(value);
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
    return { start, end: next - 1 };
};

const dateFromMetadata = (metadata: Record<string, unknown>): number | null => {
    for (const key of ["dueAt", "targetDate", "deadline", "launchDate"]) {
        const parsed = toEpoch(metadata[key] as string | number | Date | undefined);
        if (parsed !== null) return parsed;
    }
    return null;
};

const sourceEvent = (
    source: CalendarEventSource,
    event: Omit<CalendarEvent, "source" | "createdAt" | "updatedAt" | "attendees" | "reminders"> & Partial<Pick<CalendarEvent, "attendees" | "reminders">>,
    now: number,
): CalendarEvent => ({
    ...event,
    source: { ...source, editable: source.kind === "user" },
    attendees: event.attendees ?? [],
    reminders: event.reminders ?? [],
    createdAt: now,
    updatedAt: now,
});

const inRange = (event: CalendarEvent, range?: UnifiedCalendarSources["range"]): boolean =>
    !range || (event.start <= range.end && event.end >= range.start);

/**
 * Pure cross-module normalization seam. It never mutates source records and never
 * invents editability for derived data; callers can use source.href to open the
 * authoritative module.
 */
export function normalizeUnifiedSources(input: UnifiedCalendarSources): CalendarEvent[] {
    const now = input.now ?? Date.now();
    const out: CalendarEvent[] = [];

    for (const userEvent of input.userEvents ?? []) {
        out.push({
            ...userEvent,
            source: { kind: "user", id: userEvent.id, label: "Calendar", editable: true, href: "/calendar" },
        });
    }

    for (const agent of input.agents ?? []) {
        if (agent.status !== "working" && agent.status !== "thinking") continue;
        const span = localDay(now);
        out.push(sourceEvent(
            { kind: "agent", id: agent.id, label: "Agent", editable: false, href: `/agents/${encodeURIComponent(agent.id)}` },
            {
                id: `source:agent:${agent.id}:${new Date(span.start).toISOString().slice(0, 10)}`,
                title: `Agent · ${agent.config.name}`,
                category: SOURCE_STYLE.agent.category,
                color: SOURCE_STYLE.agent.color,
                icon: SOURCE_STYLE.agent.icon,
                allDay: true,
                start: span.start,
                end: span.end,
                description: `${agent.config.role} · ${agent.status} · ${agent.config.model}`,
                tags: [agent.status],
                customFields: [{ id: "status", label: "Agent status", value: agent.status }],
            },
            now,
        ));
    }

    for (const project of input.projects ?? []) {
        const when = dateFromMetadata(project.metadata ?? {});
        if (when === null) continue;
        const span = localDay(when);
        out.push(sourceEvent(
            { kind: "project", id: project.id, label: "Project", editable: false, href: `/projects/${encodeURIComponent(project.id)}` },
            {
                id: `source:project:${project.id}`,
                title: `Project · ${project.name}`,
                category: SOURCE_STYLE.project.category,
                color: project.color ?? SOURCE_STYLE.project.color,
                icon: project.icon ?? SOURCE_STYLE.project.icon,
                allDay: true,
                start: span.start,
                end: span.end,
                description: project.description,
                tags: [project.status, ...(project.tags ?? [])],
                customFields: [{ id: "status", label: "Project status", value: project.status }],
            },
            now,
        ));
    }

    for (const task of input.tasks ?? []) {
        if (task.status === "cancelled") continue;
        const taskWithDates = task as Task & { dueAt?: string; plannedAt?: string; scheduledAt?: string };
        const when = toEpoch(taskWithDates.dueAt ?? taskWithDates.plannedAt ?? taskWithDates.scheduledAt);
        if (when === null) continue;
        const span = localDay(when);
        out.push(sourceEvent(
            { kind: "todo", id: task.id, label: "Task", editable: false, href: `/todos?task=${encodeURIComponent(task.id)}` },
            {
                id: `source:todo:${task.id}`,
                title: task.title,
                category: SOURCE_STYLE.todo.category,
                color: SOURCE_STYLE.todo.color,
                icon: SOURCE_STYLE.todo.icon,
                allDay: true,
                start: span.start,
                end: span.end,
                description: task.description,
                priority: task.priority === "critical" ? "urgent" : task.priority,
                tags: [task.status, ...(task.tags ?? [])],
                customFields: [{ id: "status", label: "Task status", value: task.status }],
            },
            now,
        ));
    }

    for (const message of input.emails ?? []) {
        const start = toEpoch(message.timestamp);
        if (start === null) continue;
        out.push(sourceEvent(
            { kind: "email", id: message.id, label: "Email", editable: false, href: `/email?message=${encodeURIComponent(message.id)}` },
            {
                id: `source:email:${message.id}`,
                title: message.subject || "Email",
                category: SOURCE_STYLE.email.category,
                color: SOURCE_STYLE.email.color,
                icon: SOURCE_STYLE.email.icon,
                allDay: false,
                start,
                end: start + 15 * 60_000,
                description: [message.from.name || message.from.email, message.snippet].filter(Boolean).join(" · "),
                tags: [message.folder, ...(message.labels ?? [])],
                customFields: [
                    { id: "from", label: "From", value: message.from.email },
                    { id: "read", label: "Read", value: message.isRead ? "Yes" : "No" },
                ],
            },
            now,
        ));
    }

    for (const event of input.financial ?? []) {
        const parsed = toEpoch(event.date);
        if (parsed === null) continue;
        const span = localDay(parsed);
        const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: event.currency || "USD" }).format(event.amount);
        out.push(sourceEvent(
            { kind: "financial", id: event.id, label: "Financial", editable: false, href: "/financial/calendar" },
            {
                id: `source:financial:${event.id}`,
                title: `${event.label} · ${amount}`,
                category: SOURCE_STYLE.financial.category,
                color: SOURCE_STYLE.financial.color,
                icon: SOURCE_STYLE.financial.icon,
                allDay: true,
                start: span.start,
                end: span.end,
                description: `${event.kind === "CARD_PAYMENT" ? "Card payment due" : "Subscription charge"}${event.overdue ? " · Overdue" : ""}`,
                priority: event.overdue ? "urgent" : "medium",
                tags: [event.kind.toLowerCase(), ...(event.overdue ? ["overdue"] : [])],
                customFields: [{ id: "amount", label: "Amount", value: amount }],
            },
            now,
        ));
    }

    for (const signal of input.personal ?? []) {
        const startValue = toEpoch(signal.start);
        if (startValue === null) continue;
        const start = signal.allDay ? localDay(startValue).start : startValue;
        const rawEnd = toEpoch(signal.end);
        const end = signal.allDay ? localDay(rawEnd ?? startValue).end : rawEnd ?? start + 60 * 60_000;
        const style = SOURCE_STYLE[signal.source.kind];
        const detailFields = signal.status ? [{ id: "status", label: "Source status", value: signal.status }] : undefined;
        out.push(sourceEvent(
            { ...signal.source, editable: false },
            {
                id: `source:${signal.source.kind}:${signal.id}`,
                title: signal.title,
                category: signal.category,
                color: signal.color ?? style.color,
                icon: signal.icon ?? style.icon,
                allDay: signal.allDay === true,
                start,
                end,
                ...(signal.description ? { description: signal.description } : {}),
                ...(signal.status ? { tags: [signal.status.toLowerCase()] } : {}),
                ...(detailFields ? { customFields: detailFields } : {}),
            },
            now,
        ));
    }

    const seen = new Set<string>();
    return out
        .filter((event) => inRange(event, input.range))
        .filter((event) => {
            if (seen.has(event.id)) return false;
            seen.add(event.id);
            return true;
        })
        .sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
}
