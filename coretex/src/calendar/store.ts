// Coretex — calendar event store. Persists user-managed calendar events to
// ~/.coretex/calendar.json (separate from settings, like the index/skill stores).
// The file holds both the events and the user-managed category set; older files
// that were a bare events array are migrated transparently on load.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
    CalendarCategory,
    CalendarEvent,
    CalendarEventAttendee,
    CalendarEventCustomField,
    CalendarEventRecurrence,
} from "../types.js";

/** Seed categories — mirrors the Relay's CALENDAR_CATEGORIES so first run matches the UI. */
const DEFAULT_CATEGORIES: CalendarCategory[] = [
    { id: "work", label: "Work", color: "#3b82f6", icon: "Briefcase01" },
    { id: "meeting", label: "Meeting", color: "#8b5cf6", icon: "Users01" },
    { id: "personal", label: "Personal", color: "#22c55e", icon: "Heart" },
    { id: "deadline", label: "Deadline", color: "#ef4444", icon: "AlertTriangle" },
    { id: "reminder", label: "Reminder", color: "#14b8a6", icon: "BellRinging01" },
    { id: "agents", label: "Agents", color: "#a855f7", icon: "Users01" },
    { id: "projects", label: "Projects", color: "#0ea5e9", icon: "FolderCode" },
    { id: "email", label: "Email", color: "#f59e0b", icon: "Mail01" },
    { id: "financial", label: "Financial", color: "#10b981", icon: "BankNote01" },
    { id: "social", label: "Social", color: "#ec4899", icon: "MessageChatCircle" },
    { id: "workouts", label: "Workouts", color: "#f97316", icon: "Activity" },
    { id: "nutrition", label: "Nutrition", color: "#84cc16", icon: "Beaker01" },
    { id: "health", label: "Health", color: "#06b6d4", icon: "ActivityHeart" },
    { id: "todos", label: "Todos", color: "#6366f1", icon: "CheckSquare" },
];

const EVENT_ID = /^[a-zA-Z0-9:_-]{1,160}$/;
const CATEGORY_ID = /^[a-zA-Z0-9_-]{1,64}$/;
const COLOR = /^#[0-9a-f]{6}$/i;
const MUTABLE_SOURCE = "user" as const;

const compactText = (value: unknown, max: number): string | undefined => {
    if (typeof value !== "string") return undefined;
    const text = value.trim().slice(0, max);
    return text || undefined;
};

const stringList = (value: unknown, maxItems: number, maxLength: number): string[] => {
    if (!Array.isArray(value)) return [];
    const unique = new Set<string>();
    for (const item of value) {
        const text = compactText(item, maxLength);
        if (text) unique.add(text);
        if (unique.size >= maxItems) break;
    }
    return [...unique];
};

const enumValue = <T extends string>(value: unknown, allowed: readonly T[], fallback?: T): T | undefined =>
    typeof value === "string" && allowed.includes(value as T) ? value as T : fallback;

const validUrl = (value: unknown): string | undefined => {
    const text = compactText(value, 2_048);
    if (!text) return undefined;
    try {
        const parsed = new URL(text);
        return ["http:", "https:", "mailto:"].includes(parsed.protocol) ? text : undefined;
    } catch {
        return undefined;
    }
};

const validTimezone = (value: unknown): string | undefined => {
    const zone = compactText(value, 128);
    if (!zone) return undefined;
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(0);
        return zone;
    } catch {
        return undefined;
    }
};

const normalizeRecurrence = (value: unknown, start: number): CalendarEventRecurrence | null | undefined => {
    if (value === null) return null;
    if (!value || typeof value !== "object") return undefined;
    const input = value as Partial<CalendarEventRecurrence>;
    const frequency = enumValue(input.frequency, ["daily", "weekly", "monthly", "yearly"] as const);
    if (!frequency) return undefined;
    const interval = Number.isFinite(input.interval) ? Math.min(999, Math.max(1, Math.trunc(input.interval!))) : 1;
    const weekDays = Array.isArray(input.weekDays)
        ? [...new Set(input.weekDays.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6))].sort()
        : undefined;
    const endInput = input.end;
    let end: CalendarEventRecurrence["end"];
    if (endInput && typeof endInput === "object") {
        const type = enumValue(endInput.type, ["never", "date", "count"] as const, "never")!;
        if (type === "date") {
            const date = Number(endInput.date);
            end = { type, date: Number.isFinite(date) ? Math.max(start, date) : start };
        } else if (type === "count") {
            const count = Number(endInput.count);
            end = { type, count: Number.isFinite(count) ? Math.min(10_000, Math.max(1, Math.trunc(count))) : 1 };
        } else {
            end = { type: "never" };
        }
    }
    return { frequency, interval, ...(weekDays?.length ? { weekDays } : {}), ...(end ? { end } : {}) };
};

const normalizeAttendeeDetails = (value: unknown): CalendarEventAttendee[] | undefined => {
    if (!Array.isArray(value)) return undefined;
    const result: CalendarEventAttendee[] = [];
    const seen = new Set<string>();
    for (const raw of value.slice(0, 250)) {
        if (!raw || typeof raw !== "object") continue;
        const input = raw as Partial<CalendarEventAttendee>;
        const email = compactText(input.email, 320)?.toLowerCase() ?? "";
        const name = compactText(input.name, 200);
        const identity = email || name?.toLowerCase();
        if (!identity || seen.has(identity)) continue;
        seen.add(identity);
        const response = enumValue(input.response, ["needsAction", "accepted", "declined", "tentative"] as const);
        result.push({
            id: compactText(input.id, 160) ?? `attendee_${result.length + 1}`,
            email,
            ...(name ? { name } : {}),
            ...(response ? { response } : {}),
            ...(input.optional === true ? { optional: true } : {}),
        });
    }
    return result;
};

const normalizeCustomFields = (value: unknown): CalendarEventCustomField[] | undefined => {
    if (!Array.isArray(value)) return undefined;
    const result: CalendarEventCustomField[] = [];
    for (const raw of value.slice(0, 50)) {
        if (!raw || typeof raw !== "object") continue;
        const input = raw as Partial<CalendarEventCustomField>;
        const label = compactText(input.label, 120);
        if (!label) continue;
        result.push({
            id: compactText(input.id, 160) ?? `field_${result.length + 1}`,
            label,
            value: compactText(input.value, 2_000) ?? "",
        });
    }
    return result;
};

/** Validate persisted/client calendar input and stamp immutable ownership metadata. */
export function normalizeOwnedCalendarEvent(value: unknown, existing?: CalendarEvent, now = Date.now(), preserveTimestamps = false): CalendarEvent {
    if (!value || typeof value !== "object") throw new Error("Calendar event must be an object.");
    const input = value as Partial<CalendarEvent>;
    const id = compactText(existing?.id ?? input.id, 160);
    if (!id || !EVENT_ID.test(id) || id.startsWith("overlay:") || id.startsWith("source:")) throw new Error("Calendar event id is invalid.");
    if (input.source && input.source.kind !== MUTABLE_SOURCE) throw new Error("Derived calendar events must be edited in their source module.");
    const start = Number(input.start);
    if (!Number.isFinite(start)) throw new Error("Calendar event start is invalid.");
    const requestedEnd = Number(input.end);
    const allDay = input.allDay === true;
    const startDate = new Date(start);
    const defaultEnd = allDay
        ? new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + 1).getTime() - 1
        : start + 30 * 60_000;
    const end = Number.isFinite(requestedEnd) && requestedEnd >= start
        ? requestedEnd
        : defaultEnd;
    const category = compactText(input.category, 64);
    const title = compactText(input.title, 500) ?? "Untitled event";
    const recurrence = normalizeRecurrence(input.recurrence, start);
    const attendeeDetails = normalizeAttendeeDetails(input.attendeeDetails);
    const customFields = normalizeCustomFields(input.customFields);
    const reminders = Array.isArray(input.reminders)
        ? [...new Set(input.reminders.filter((offset): offset is number => Number.isInteger(offset) && offset >= 0 && offset <= 525_600))].sort((a, b) => a - b).slice(0, 25)
        : [];
    return {
        id,
        title,
        category: category && CATEGORY_ID.test(category) ? category : "personal",
        color: typeof input.color === "string" && COLOR.test(input.color) ? input.color : "#667085",
        ...(compactText(input.icon, 120) ? { icon: compactText(input.icon, 120) } : {}),
        allDay,
        start,
        end,
        ...(compactText(input.location, 1_000) ? { location: compactText(input.location, 1_000) } : {}),
        ...(compactText(input.description, 20_000) ? { description: compactText(input.description, 20_000) } : {}),
        attendees: stringList(input.attendees, 250, 320),
        reminders,
        ...(validTimezone(input.timezone) ? { timezone: validTimezone(input.timezone) } : {}),
        status: enumValue(input.status, ["confirmed", "tentative", "cancelled"] as const, "confirmed"),
        priority: enumValue(input.priority, ["none", "low", "medium", "high", "urgent"] as const, "none"),
        availability: enumValue(input.availability, ["busy", "free"] as const, "busy"),
        visibility: enumValue(input.visibility, ["default", "public", "private"] as const, "default"),
        ...(recurrence !== undefined ? { recurrence } : {}),
        tags: stringList(input.tags, 50, 80),
        ...(validUrl(input.url) ? { url: validUrl(input.url) } : {}),
        ...(validUrl(input.conferenceUrl) ? { conferenceUrl: validUrl(input.conferenceUrl) } : {}),
        ...(customFields ? { customFields } : {}),
        ...(attendeeDetails ? { attendeeDetails } : {}),
        source: { kind: MUTABLE_SOURCE, id, label: "Calendar", editable: true, href: "/calendar" },
        createdAt: existing?.createdAt ?? (preserveTimestamps && Number.isFinite(input.createdAt) ? Number(input.createdAt) : now),
        updatedAt: existing ? Math.max(now, existing.updatedAt + 1) : (preserveTimestamps && Number.isFinite(input.updatedAt) ? Number(input.updatedAt) : now),
    };
}

interface PersistShape {
    events: CalendarEvent[];
    categories: CalendarCategory[];
}

export class CalendarStore {
    private events: CalendarEvent[] = [];
    private categories: CalendarCategory[] = DEFAULT_CATEGORIES.slice();
    private readonly file: string;

    constructor(dataDir: string) {
        this.file = path.join(dataDir, "calendar.json");
    }

    async load(): Promise<void> {
        try {
            const raw = await readFile(this.file, "utf8");
            const parsed = JSON.parse(raw) as unknown;
            if (Array.isArray(parsed)) {
                // Legacy format: a bare events array. Keep events, seed default categories.
                this.events = this.normalizeLoadedEvents(parsed);
                this.categories = DEFAULT_CATEGORIES.slice();
            } else if (parsed && typeof parsed === "object") {
                const p = parsed as Partial<PersistShape>;
                this.events = this.normalizeLoadedEvents(p.events);
                this.categories =
                    Array.isArray(p.categories) && p.categories.length > 0 ? this.normalizeCategories(p.categories) : DEFAULT_CATEGORIES.slice();
            } else {
                this.events = [];
                this.categories = DEFAULT_CATEGORIES.slice();
            }
        } catch {
            this.events = [];
            this.categories = DEFAULT_CATEGORIES.slice();
        }
    }

    list(): CalendarEvent[] {
        return this.events.slice().sort((a, b) => a.start - b.start);
    }

    getCategories(): CalendarCategory[] {
        return this.categories.slice();
    }

    async setCategories(categories: CalendarCategory[]): Promise<void> {
        this.categories = this.normalizeCategories(categories);
        await this.save();
    }

    /** Backward-compatible whole-record mutation used by existing Relay clients. */
    async upsert(event: CalendarEvent): Promise<CalendarEvent> {
        const idx = this.events.findIndex((e) => e.id === event.id);
        const normalized = normalizeOwnedCalendarEvent(event, idx === -1 ? undefined : this.events[idx]);
        if (idx === -1) {
            this.events.push(normalized);
        } else {
            this.events[idx] = normalized;
        }
        await this.save();
        return normalized;
    }

    /** Server-id create path for new callers that do not need legacy client ids. */
    async create(event: Omit<CalendarEvent, "id" | "createdAt" | "updatedAt" | "source"> & Partial<Pick<CalendarEvent, "id">>): Promise<CalendarEvent> {
        const id = event.id && EVENT_ID.test(event.id) ? event.id : `evt_${randomUUID().replaceAll("-", "")}`;
        if (this.events.some((item) => item.id === id)) throw new Error("A calendar event with this id already exists.");
        const normalized = normalizeOwnedCalendarEvent({ ...event, id });
        this.events.push(normalized);
        await this.save();
        return normalized;
    }

    /** Patch only an existing user-owned event. Id/source/createdAt remain immutable. */
    async update(id: string, patch: Partial<CalendarEvent>, expectedUpdatedAt?: number): Promise<CalendarEvent> {
        const idx = this.events.findIndex((event) => event.id === id);
        if (idx === -1) throw new Error("Calendar event was not found.");
        const existing = this.events[idx]!;
        if (existing.source?.kind && existing.source.kind !== MUTABLE_SOURCE) throw new Error("Derived calendar events must be edited in their source module.");
        if (expectedUpdatedAt !== undefined && existing.updatedAt !== expectedUpdatedAt) {
            throw new Error("Calendar event changed since it was opened. Refresh and try again.");
        }
        const normalized = normalizeOwnedCalendarEvent({ ...existing, ...patch, id, createdAt: existing.createdAt, source: existing.source }, existing);
        this.events[idx] = normalized;
        await this.save();
        return normalized;
    }

    async remove(id: string): Promise<boolean> {
        if (id.startsWith("overlay:") || id.startsWith("source:")) throw new Error("Derived calendar events must be deleted in their source module.");
        if (!EVENT_ID.test(id)) return false;
        const existing = this.events.find((event) => event.id === id);
        if (!existing) return false;
        if (existing.source?.kind && existing.source.kind !== MUTABLE_SOURCE) throw new Error("Derived calendar events must be deleted in their source module.");
        this.events = this.events.filter((e) => e.id !== id);
        await this.save();
        return true;
    }

    private normalizeLoadedEvents(value: unknown): CalendarEvent[] {
        if (!Array.isArray(value)) return [];
        const loaded: CalendarEvent[] = [];
        const ids = new Set<string>();
        for (const raw of value.slice(0, 25_000)) {
            try {
                const event = normalizeOwnedCalendarEvent(raw, undefined, Date.now(), true);
                if (ids.has(event.id)) continue;
                ids.add(event.id);
                loaded.push(event);
            } catch {
                // A single corrupt/forged entry must not make the whole calendar unreadable.
            }
        }
        return loaded;
    }

    private normalizeCategories(value: unknown): CalendarCategory[] {
        if (!Array.isArray(value)) return DEFAULT_CATEGORIES.slice();
        const categories: CalendarCategory[] = [];
        const ids = new Set<string>();
        for (const raw of value.slice(0, 100)) {
            if (!raw || typeof raw !== "object") continue;
            const input = raw as Partial<CalendarCategory>;
            const id = compactText(input.id, 64);
            const label = compactText(input.label, 120);
            if (!id || !CATEGORY_ID.test(id) || !label || ids.has(id)) continue;
            ids.add(id);
            const reminderOffsets = Array.isArray(input.reminderOffsets)
                ? [...new Set(input.reminderOffsets.filter((offset): offset is number => Number.isInteger(offset) && offset >= 0 && offset <= 525_600))].sort((a, b) => a - b).slice(0, 25)
                : undefined;
            categories.push({
                id,
                label,
                color: typeof input.color === "string" && COLOR.test(input.color) ? input.color : "#667085",
                ...(compactText(input.icon, 120) ? { icon: compactText(input.icon, 120) } : {}),
                ...(reminderOffsets?.length ? { reminderOffsets } : {}),
            });
        }
        return categories.length ? categories : DEFAULT_CATEGORIES.slice();
    }

    private async save(): Promise<void> {
        await mkdir(path.dirname(this.file), { recursive: true });
        const data: PersistShape = { events: this.events, categories: this.categories };
        await writeFile(this.file, JSON.stringify(data, null, 2), "utf8");
    }
}
