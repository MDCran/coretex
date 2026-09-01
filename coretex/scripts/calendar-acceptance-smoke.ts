import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import type { CalendarEvent } from "../src/types.js";
import { CalendarStore, normalizeOwnedCalendarEvent } from "../src/calendar/store.js";
import { normalizeUnifiedSources } from "../src/calendar/unified-feed.js";
import { getUnifiedCalendarContext } from "../src/lifeos/calendar.js";
import { getPersonalCalendar } from "../src/lifeos/personal-calendar.js";
import { CALENDAR_CATEGORIES } from "../../shared/src/coretex/calendar/categories.js";
import {
    buildCalendarEvent,
    createCalendarDraft,
    dateInputValue,
    hydrateCalendarDraft,
    isEventEditable,
    normalizeRecurrence,
    timeInputValue,
    type RichCalendarEvent,
} from "../../shared/src/coretex/calendar/event-draft.js";
import {
    deriveFinancialCalendarEvents,
    derivePersonalCalendarEvents,
    deriveWorkspaceCalendarEvents,
    expandRecurringCalendarEvents,
    mergeCalendarEvents,
    type PersonalCalendarSignal,
} from "../../shared/src/coretex/calendar/calendar-data.js";

const prisma = new PrismaClient({ log: [] });
const EXPECTED_SOURCE_KINDS = ["agent", "project", "email", "financial", "social", "workout", "nutrition", "health", "todo"] as const;
const EXPECTED_CATEGORY_IDS = ["agents", "projects", "email", "financial", "social", "workouts", "nutrition", "health", "todos"] as const;
const HOUR_MS = 60 * 60 * 1_000;

function step(label: string): void {
    process.stdout.write(`${label} ✓\n`);
}

async function expectRejected(action: () => Promise<unknown> | unknown, text: string): Promise<void> {
    try {
        await action();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, new RegExp(text, "i"));
        return;
    }
    assert.fail(`Expected rejection containing ${JSON.stringify(text)}.`);
}

function eventFixture(id = "evt_fixture", overrides: Partial<CalendarEvent> = {}): CalendarEvent {
    const start = Date.parse("2026-08-20T13:00:00.000Z");
    return {
        id,
        title: "Quarterly planning",
        category: "meeting",
        color: "#8b5cf6",
        icon: "Users01",
        allDay: false,
        start,
        end: start + HOUR_MS,
        location: "Studio A",
        description: "Agenda and decisions",
        attendees: ["owner@example.test", "Casey"],
        reminders: [60, 10],
        timezone: "America/New_York",
        status: "tentative",
        priority: "high",
        availability: "busy",
        visibility: "private",
        recurrence: { frequency: "weekly", interval: 2, weekDays: [1, 3], end: { type: "count", count: 8 } },
        tags: ["Planning", "Client"],
        url: "https://example.test/events/quarterly-planning",
        conferenceUrl: "https://meet.example.test/quarterly-planning",
        attendeeDetails: [
            { id: "attendee_owner", name: "Owner", email: "owner@example.test", response: "accepted", optional: false },
            { id: "attendee_casey", name: "Casey", email: "", response: "tentative", optional: true },
        ],
        customFields: [
            { id: "field_agenda", label: "Agenda", value: "Roadmap" },
            { id: "field_cost", label: "Budget", value: "$250" },
        ],
        source: { kind: "user", id, label: "Calendar", editable: true, href: "/calendar" },
        createdAt: 1_760_000_000_000,
        updatedAt: 1_760_000_000_000,
        ...overrides,
    };
}

function assertReadOnlySource(event: RichCalendarEvent, kind: string): void {
    assert.equal(event.source?.kind, kind);
    assert.equal(event.source?.editable, false);
    assert.equal(typeof event.source?.id, "string");
    assert.ok(event.source?.id, `${kind} source must expose its stable id`);
    assert.equal(typeof event.source?.href, "string");
    assert.ok(event.source?.href, `${kind} source must expose an in-app deep link`);
    assert.ok(Number.isFinite(event.start) && Number.isFinite(event.end) && event.end >= event.start, `${kind} dates must be canonical epoch ranges`);
    assert.equal(isEventEditable(event), false);
}

function testWorkspaceAndUnifiedFeed(): void {
    const now = Date.parse("2026-08-20T15:30:00.000Z");
    const workspace = deriveWorkspaceCalendarEvents({
        agents: [
            { id: "agent_running", status: "working", config: { name: "Atlas", role: "orchestrator", model: "gpt" } },
            { id: "agent_idle", status: "idle", config: { name: "Idle", role: "reviewer", model: "gpt" } },
        ],
        projects: [
            { id: "project_launch", name: "Launch", description: "Ship it", status: "active", dueAt: "2026-08-21T18:00:00.000Z" },
            { id: "project_unscheduled", name: "No date" },
        ],
        tasks: [
            { id: "todo_open", title: "Review brief", description: "Check details", status: "in_progress", priority: "high", dueAt: "2026-08-22T12:00:00.000Z" },
            { id: "todo_done", title: "Already done", status: "completed", priority: "none", dueAt: "2026-08-22T12:00:00.000Z" },
            { id: "todo_unscheduled", title: "Backlog only", status: "queued", priority: "low", updatedAt: "2026-08-22T12:00:00.000Z" },
        ],
        email: {
            messages: [
                {
                    id: "mail_42",
                    subject: "Client reply",
                    timestamp: Date.parse("2026-08-23T02:15:00.000Z"),
                    from: { name: "Morgan", email: "morgan@example.test" },
                    snippet: "The launch date works.",
                },
            ],
        },
    }, now);

    assert.deepEqual(workspace.map((event) => event.source?.kind).sort(), ["agent", "email", "project", "todo"]);
    assert.equal(workspace.some((event) => event.source?.id === "todo_unscheduled"), false, "an updatedAt timestamp must not fabricate a due date for an unscheduled task");
    for (const event of workspace) assertReadOnlySource(event, event.source!.kind);
    assert.match(workspace.find((event) => event.source?.kind === "email")?.description ?? "", /Morgan/);

    const financial = deriveFinancialCalendarEvents([{
        id: "subscription_1",
        date: "2026-08-24",
        label: "Cloud hosting",
        amount: 49.99,
        currency: "USD",
        kind: "SUBSCRIPTION",
        overdue: true,
    }], now);
    assert.equal(financial.length, 1);
    assert.equal(financial[0]?.priority, "urgent");
    assertReadOnlySource(financial[0]!, "financial");

    const personalSignals: PersonalCalendarSignal[] = [
        { id: "social_1", title: "Dinner", start: "2026-08-24T23:00:00.000Z", end: "2026-08-25T01:00:00.000Z", allDay: false, category: "social", description: "Downtown", status: "EVENT" },
        { id: "workout_1", title: "Leg day", start: "2026-08-25T11:00:00.000Z", end: "2026-08-25T12:15:00.000Z", allDay: false, category: "workouts", description: "Strength", status: "PLANNED" },
        { id: "nutrition_1", title: "Lunch", start: "2026-08-25", end: "2026-08-25", allDay: true, category: "nutrition", description: "650 kcal", status: "LOGGED" },
        { id: "health_1", title: "Annual physical", start: "2026-08-26T14:00:00.000Z", end: "2026-08-26T15:00:00.000Z", allDay: false, category: "health", description: "Dr. Rivera", status: "APPOINTMENT" },
    ];
    const personal = derivePersonalCalendarEvents(personalSignals, now);
    assert.deepEqual(personal.map((event) => event.source?.kind).sort(), ["health", "nutrition", "social", "workout"]);
    for (const event of personal) assertReadOnlySource(event, event.source!.kind);
    assert.equal(personal.find((event) => event.source?.kind === "social")?.start, Date.parse("2026-08-24T23:00:00.000Z"));

    const duplicateSocial = { ...personal[0]!, title: "Duplicate should lose" };
    const merged = mergeCalendarEvents(workspace, financial, personal, [duplicateSocial]);
    const actualKinds = [...new Set(merged.map((event) => event.source?.kind).filter((kind) => kind !== "user"))].sort();
    assert.deepEqual(actualKinds, [...EXPECTED_SOURCE_KINDS].sort(), "the unified calendar must include every requested source domain");
    assert.equal(merged.filter((event) => event.source?.kind === "social").length, 1, "stable source ids must dedupe duplicate feed signals");
    assert.equal(merged.find((event) => event.source?.kind === "social")?.title, "Dinner", "the first authoritative source signal must win");

    const categoryIds = new Set(CALENDAR_CATEGORIES.map((category) => category.id));
    for (const id of EXPECTED_CATEGORY_IDS) assert.ok(categoryIds.has(id), `missing ${id} calendar presentation`);
}

function testBackendUnifiedNormalizer(): void {
    const now = Date.parse("2026-11-01T15:00:00.000Z");
    const userEvent = eventFixture("evt_unified_user", {
        start: Date.parse("2026-11-01T14:00:00.000Z"),
        end: Date.parse("2026-11-01T15:00:00.000Z"),
    });
    const events = normalizeUnifiedSources({
        now,
        userEvents: [userEvent],
        agents: [{
            id: "agent_unified",
            status: "working",
            config: { name: "Atlas", role: "orchestrator", model: "gpt" },
            createdAt: new Date(now).toISOString(),
            lastActiveAt: new Date(now).toISOString(),
        } as never],
        projects: [{
            id: "project_unified",
            name: "Unified project",
            description: "Calendar fixture",
            status: "active",
            taskIds: [],
            tags: ["launch"],
            metadata: { dueAt: "2026-11-01" },
            createdAt: new Date(now).toISOString(),
            updatedAt: new Date(now).toISOString(),
        } as never],
        tasks: [
            { id: "todo_unified", title: "Scheduled task", description: "Due", status: "queued", priority: "high", dueAt: "2026-11-01T18:00:00.000Z", tags: [] } as never,
            { id: "todo_unscheduled_backend", title: "No schedule", description: "Backlog", status: "queued", priority: "low", updatedAt: "2026-11-01T18:00:00.000Z", tags: [] } as never,
        ],
        emails: [{
            id: "email_unified",
            threadId: "thread_unified",
            accountId: "account_unified",
            from: { name: "Taylor", email: "taylor@example.test" },
            to: [],
            cc: [],
            subject: "Unified email",
            bodyHtml: "",
            bodyText: "",
            snippet: "Timestamp-shaped production mail",
            attachments: [],
            folder: "inbox",
            labels: [],
            aiCategory: null,
            isRead: false,
            isStarred: false,
            timestamp: Date.parse("2026-11-01T16:30:00.000Z"),
            inReplyTo: null,
        }],
        range: {
            start: Date.parse("2026-11-01T00:00:00.000Z"),
            end: Date.parse("2026-11-02T23:59:59.999Z"),
        },
    });
    assert.deepEqual(events.map((event) => event.source?.kind).sort(), ["agent", "email", "project", "todo", "user"]);
    assert.equal(events.some((event) => event.source?.id === "todo_unscheduled_backend"), false);
    for (const event of events.filter((candidate) => candidate.source?.kind !== "user")) {
        assert.equal(event.source?.editable, false);
        assert.ok(event.source?.href);
    }
    const agent = events.find((event) => event.source?.kind === "agent");
    assert.equal(agent!.end, new Date(2026, 10, 2).getTime() - 1, "all-day unified ranges must end at the next local midnight across DST");
}

function testDraftNormalizationAndTimezoneRoundTrip(): void {
    const draft = createCalendarDraft("2026-08-20", "meeting", "#8b5cf6", "Users01");
    Object.assign(draft, {
        title: "  Client handoff  ",
        startTime: "23:30",
        endTime: "00:30",
        timezone: "America/New_York",
        status: "tentative",
        priority: "urgent",
        availability: "free",
        visibility: "private",
        location: "  Studio B  ",
        url: " https://example.test/handoff ",
        conferenceUrl: " https://meet.example.test/handoff ",
        description: "  Notes  ",
        reminders: [60, 10, 60, -1],
        tags: [" Client ", "client", "Launch"],
        recurrence: { frequency: "weekly", interval: 0, weekDays: [5, 1, 5, 9], end: { type: "count", count: 0 } },
        attendees: [
            { id: "owner", name: " Owner ", email: "OWNER@example.test", response: "accepted", optional: false },
            { id: "duplicate", name: "Duplicate", email: "owner@example.test", response: "declined", optional: false },
            { id: "casey", name: " Casey ", email: "", response: "tentative", optional: true },
        ],
        customFields: [{ id: "", label: " Room ", value: " 12 " }, { id: "empty", label: "", value: "" }],
    });
    const event = buildCalendarEvent(draft, null, 1_770_000_000_000);
    assert.equal(event.title, "Client handoff");
    assert.equal(event.end - event.start, HOUR_MS, "same-date end times before the start must become overnight events");
    assert.deepEqual(event.reminders, [10, 60]);
    assert.deepEqual(event.tags, ["Client", "Launch"]);
    assert.deepEqual(event.recurrence, { frequency: "weekly", interval: 1, weekDays: [1, 5], end: { type: "count", count: 1 } });
    assert.equal(event.attendeeDetails?.length, 2, "email duplicates and blank attendees must normalize without dropping a valid name-only attendee");
    assert.equal(event.customFields?.length, 1);
    assert.equal(event.customFields?.[0]?.label, "Room");

    const losAngelesEvent = eventFixture("evt_zone", {
        start: Date.parse("2026-08-20T16:00:00.000Z"),
        end: Date.parse("2026-08-20T17:00:00.000Z"),
        timezone: "America/Los_Angeles",
    });
    const hydrated = hydrateCalendarDraft(losAngelesEvent);
    assert.equal(hydrated.startDate, "2026-08-20");
    assert.equal(hydrated.startTime, "09:00", "wall time must be displayed in the event timezone, not the host timezone");
    const rebuilt = buildCalendarEvent(hydrated, losAngelesEvent, losAngelesEvent.updatedAt + 1);
    assert.equal(rebuilt.start, losAngelesEvent.start, "a no-op edit from another host timezone must preserve the event instant");
    assert.equal(rebuilt.end, losAngelesEvent.end);
    assert.deepEqual(rebuilt.source, losAngelesEvent.source, "editing must retain source identity");

    const dstDraft = createCalendarDraft("2026-11-01");
    dstDraft.allDay = true;
    dstDraft.timezone = "America/New_York";
    const dstEvent = buildCalendarEvent(dstDraft, null, 1_770_000_000_100);
    assert.equal(dstEvent.start, Date.parse("2026-11-01T04:00:00.000Z"));
    assert.equal(dstEvent.end, Date.parse("2026-11-02T04:59:59.999Z"), "all-day ranges must honor the 25-hour DST fall-back day");
    assert.equal(dstEvent.end - dstEvent.start, 25 * HOUR_MS - 1);

    assert.deepEqual(normalizeRecurrence({ frequency: "monthly", interval: 3, weekDays: [1], end: { type: "never" } }), {
        frequency: "monthly",
        interval: 3,
        end: { type: "never" },
    });
}

function recurrenceEvent(
    id: string,
    start: string,
    end: string,
    recurrence: NonNullable<CalendarEvent["recurrence"]>,
    timezone = "UTC",
): RichCalendarEvent {
    return eventFixture(id, {
        start: Date.parse(start),
        end: Date.parse(end),
        timezone,
        recurrence,
        source: { kind: "user", id, label: "Calendar", editable: true, href: "/calendar" },
    }) as RichCalendarEvent;
}

function occurrenceDates(events: RichCalendarEvent[], timezone: string): string[] {
    return events.map((event) => `${dateInputValue(event.start, timezone)} ${timeInputValue(event.start, timezone)}`);
}

function testRecurrenceExpansion(): void {
    const daily = recurrenceEvent(
        "series_daily",
        "2026-08-20T13:00:00.000Z",
        "2026-08-20T14:00:00.000Z",
        { frequency: "daily", interval: 2, end: { type: "count", count: 4 } },
        "America/New_York",
    );
    const dailyOccurrences = expandRecurringCalendarEvents(
        [daily],
        Date.parse("2026-08-19T00:00:00.000Z"),
        Date.parse("2026-08-31T23:59:59.999Z"),
    );
    assert.deepEqual(occurrenceDates(dailyOccurrences, "America/New_York"), [
        "2026-08-20 09:00",
        "2026-08-22 09:00",
        "2026-08-24 09:00",
        "2026-08-26 09:00",
    ]);

    const weekly = recurrenceEvent(
        "series_weekly",
        "2026-08-19T13:00:00.000Z",
        "2026-08-19T14:00:00.000Z",
        { frequency: "weekly", interval: 2, weekDays: [1, 3], end: { type: "count", count: 5 } },
        "America/New_York",
    );
    const weeklyOccurrences = expandRecurringCalendarEvents(
        [weekly],
        Date.parse("2026-08-01T00:00:00.000Z"),
        Date.parse("2026-09-30T23:59:59.999Z"),
    );
    assert.deepEqual(occurrenceDates(weeklyOccurrences, "America/New_York"), [
        "2026-08-19 09:00",
        "2026-08-31 09:00",
        "2026-09-02 09:00",
        "2026-09-14 09:00",
        "2026-09-16 09:00",
    ], "biweekly BYDAY must anchor to Sunday-first calendar weeks, not seven-day buckets beginning at DTSTART");

    const sundayAnchored = recurrenceEvent(
        "series_sunday_wkst",
        "2026-08-19T13:00:00.000Z",
        "2026-08-19T14:00:00.000Z",
        { frequency: "weekly", interval: 2, weekDays: [0], end: { type: "count", count: 3 } },
        "America/New_York",
    );
    const sundayOccurrences = expandRecurringCalendarEvents(
        [sundayAnchored],
        Date.parse("2026-08-01T00:00:00.000Z"),
        Date.parse("2026-10-01T00:00:00.000Z"),
    );
    assert.deepEqual(occurrenceDates(sundayOccurrences, "America/New_York"), [
        "2026-08-30 09:00",
        "2026-09-13 09:00",
        "2026-09-27 09:00",
    ], "WKST is deliberately Sunday: a Sunday after a Wednesday DTSTART belongs to the next calendar week");

    const monthly = recurrenceEvent(
        "series_monthly",
        "2026-01-31T15:00:00.000Z",
        "2026-01-31T16:00:00.000Z",
        { frequency: "monthly", interval: 1, end: { type: "count", count: 4 } },
        "America/New_York",
    );
    const monthlyOccurrences = expandRecurringCalendarEvents(
        [monthly],
        Date.parse("2026-01-01T00:00:00.000Z"),
        Date.parse("2026-05-01T00:00:00.000Z"),
    );
    assert.deepEqual(occurrenceDates(monthlyOccurrences, "America/New_York"), [
        "2026-01-31 10:00",
        "2026-02-28 10:00",
        "2026-03-31 10:00",
        "2026-04-30 10:00",
    ], "month-end recurrences must clamp to each target month's last day");

    const yearly = recurrenceEvent(
        "series_yearly",
        "2024-02-29T17:00:00.000Z",
        "2024-02-29T18:00:00.000Z",
        { frequency: "yearly", interval: 1, end: { type: "count", count: 3 } },
        "America/New_York",
    );
    const yearlyOccurrences = expandRecurringCalendarEvents(
        [yearly],
        Date.parse("2024-01-01T00:00:00.000Z"),
        Date.parse("2027-01-01T00:00:00.000Z"),
    );
    assert.deepEqual(occurrenceDates(yearlyOccurrences, "America/New_York"), [
        "2024-02-29 12:00",
        "2025-02-28 12:00",
        "2026-02-28 12:00",
    ], "leap-day yearly recurrences must remain visible in non-leap years");

    const until = Date.parse("2026-08-22T13:00:00.000Z");
    const untilSeries = recurrenceEvent(
        "series_until",
        "2026-08-20T13:00:00.000Z",
        "2026-08-20T14:00:00.000Z",
        { frequency: "daily", interval: 1, end: { type: "date", date: until } },
        "America/New_York",
    );
    const untilOccurrences = expandRecurringCalendarEvents(
        [untilSeries],
        Date.parse("2026-08-01T00:00:00.000Z"),
        Date.parse("2026-08-31T23:59:59.999Z"),
    );
    assert.equal(untilOccurrences.length, 3, "until must be inclusive of an occurrence at the exact end instant");

    const dstSeries = recurrenceEvent(
        "series_dst",
        "2026-10-25T16:00:00.000Z",
        "2026-10-25T17:00:00.000Z",
        { frequency: "weekly", interval: 1, weekDays: [0], end: { type: "count", count: 3 } },
        "America/Los_Angeles",
    );
    const dstOccurrences = expandRecurringCalendarEvents(
        [dstSeries],
        Date.parse("2026-10-20T00:00:00.000Z"),
        Date.parse("2026-11-15T00:00:00.000Z"),
    );
    assert.deepEqual(occurrenceDates(dstOccurrences, "America/Los_Angeles"), [
        "2026-10-25 09:00",
        "2026-11-01 09:00",
        "2026-11-08 09:00",
    ]);
    assert.deepEqual(dstOccurrences.map((event) => event.start), [
        Date.parse("2026-10-25T16:00:00.000Z"),
        Date.parse("2026-11-01T17:00:00.000Z"),
        Date.parse("2026-11-08T17:00:00.000Z"),
    ], "non-local recurring wall time must remain 09:00 across the DST offset change");
    assert.ok(dstOccurrences.every((event) => event.end - event.start === HOUR_MS));

    const springGapSeries = recurrenceEvent(
        "series_spring_gap",
        "2026-03-07T07:30:00.000Z",
        "2026-03-07T08:30:00.000Z",
        { frequency: "daily", interval: 1, end: { type: "count", count: 3 } },
        "America/New_York",
    );
    const springGapOccurrences = expandRecurringCalendarEvents(
        [springGapSeries],
        Date.parse("2026-03-01T00:00:00.000Z"),
        Date.parse("2026-03-15T00:00:00.000Z"),
    );
    assert.deepEqual(occurrenceDates(springGapOccurrences, "America/New_York"), [
        "2026-03-07 02:30",
        "2026-03-08 03:30",
        "2026-03-09 02:30",
    ]);
    assert.ok(springGapOccurrences.every((event) => event.end - event.start === HOUR_MS), "a spring-gap start shift must not collapse a one-hour occurrence to one minute");

    const ancientYearly = recurrenceEvent(
        "series_century",
        "1920-08-20T13:00:00.000Z",
        "1920-08-20T14:00:00.000Z",
        { frequency: "yearly", interval: 1, end: { type: "never" } },
        "America/New_York",
    );
    const ancientOccurrences = expandRecurringCalendarEvents(
        [ancientYearly],
        Date.parse("2026-08-01T00:00:00.000Z"),
        Date.parse("2026-08-31T23:59:59.999Z"),
    );
    assert.deepEqual(occurrenceDates(ancientOccurrences, "America/New_York"), ["2026-08-20 09:00"], "old never-ending series must not disappear behind a fixed scan-from-DTSTART cap");

    const oldOneOff = recurrenceEvent("oneoff_old", "2000-01-01T14:00:00.000Z", "2000-01-01T15:00:00.000Z", null as never, "America/New_York");
    oldOneOff.recurrence = null;
    const laterOneOff = recurrenceEvent("oneoff_later", "2026-01-20T14:00:00.000Z", "2026-01-20T15:00:00.000Z", null as never, "America/New_York");
    laterOneOff.recurrence = null;
    const earlierOneOff = recurrenceEvent("oneoff_earlier", "2026-01-01T14:00:00.000Z", "2026-01-01T15:00:00.000Z", null as never, "America/New_York");
    earlierOneOff.recurrence = null;
    const boundedOneOffs = expandRecurringCalendarEvents(
        [oldOneOff, laterOneOff, earlierOneOff],
        Date.parse("2026-01-01T00:00:00.000Z"),
        Date.parse("2026-01-31T23:59:59.999Z"),
        1,
    );
    assert.deepEqual(boundedOneOffs.map((event) => event.id), ["oneoff_earlier"], "range/limit must apply to one-offs and choose the earliest visible event independent of input order");

    const secondFold = eventFixture("evt_second_fold", {
        start: Date.parse("2026-11-01T06:30:00.000Z"),
        end: Date.parse("2026-11-01T07:30:00.000Z"),
        timezone: "America/New_York",
    }) as RichCalendarEvent;
    const secondFoldDraft = hydrateCalendarDraft(secondFold);
    assert.equal(secondFoldDraft.startTime, "01:30");
    const secondFoldRebuilt = buildCalendarEvent(secondFoldDraft, secondFold, secondFold.updatedAt + 1);
    assert.equal(secondFoldRebuilt.start, secondFold.start, "a no-op edit must retain the second occurrence of an ambiguous fall-back wall time");
    assert.equal(secondFoldRebuilt.end, secondFold.end);
    const secondFoldSeries = { ...secondFold, recurrence: { frequency: "yearly" as const, interval: 1, end: { type: "count" as const, count: 1 } } };
    const secondFoldOccurrence = expandRecurringCalendarEvents(
        [secondFoldSeries],
        Date.parse("2026-11-01T00:00:00.000Z"),
        Date.parse("2026-11-02T00:00:00.000Z"),
    );
    assert.equal(secondFoldOccurrence[0]?.start, secondFold.start, "the DTSTART occurrence must retain the exact stored side of a repeated hour");
    assert.equal(secondFoldOccurrence[0]?.end, secondFold.end);

    const shortSecondFold = eventFixture("evt_second_fold_edit", {
        start: Date.parse("2026-11-01T06:30:00.000Z"),
        end: Date.parse("2026-11-01T06:45:00.000Z"),
        timezone: "America/New_York",
    }) as RichCalendarEvent;
    const changedFoldDraft = hydrateCalendarDraft(shortSecondFold);
    changedFoldDraft.endTime = "01:50";
    const changedFold = buildCalendarEvent(changedFoldDraft, shortSecondFold, shortSecondFold.updatedAt + 1);
    assert.equal(changedFold.start, shortSecondFold.start);
    assert.equal(changedFold.end, Date.parse("2026-11-01T06:50:00.000Z"), "editing one endpoint during a repeated hour must stay on the original fold, not jump overnight");
    assert.equal(changedFold.end - changedFold.start, 20 * 60_000);

    const apia = recurrenceEvent(
        "series_apia_skip",
        "2011-12-29T10:00:00.000Z",
        "2011-12-30T09:59:59.999Z",
        { frequency: "daily", interval: 1, end: { type: "count", count: 3 } },
        "Pacific/Apia",
    );
    apia.allDay = true;
    const apiaOccurrences = expandRecurringCalendarEvents(
        [apia],
        Date.parse("2011-12-28T00:00:00.000Z"),
        Date.parse("2012-01-03T00:00:00.000Z"),
    );
    assert.deepEqual(occurrenceDates(apiaOccurrences, "Pacific/Apia"), [
        "2011-12-29 00:00",
        "2011-12-31 00:00",
        "2012-01-01 00:00",
    ], "a nonexistent civil day must be skipped without consuming count or duplicating the next day's occurrence id");
    assert.equal(new Set(apiaOccurrences.map((event) => event.id)).size, apiaOccurrences.length);

    for (const occurrence of [...dailyOccurrences, ...weeklyOccurrences, ...sundayOccurrences, ...monthlyOccurrences, ...yearlyOccurrences, ...dstOccurrences, ...springGapOccurrences, ...ancientOccurrences, ...apiaOccurrences]) {
        assert.equal(occurrence.seriesId?.startsWith("series_"), true);
        assert.equal(occurrence.occurrenceStart, occurrence.start);
        assert.match(occurrence.id, /::occurrence:/);
    }
}

async function testTemporaryCalendarStore(): Promise<void> {
    const prefix = path.join(tmpdir(), "coretex-calendar-acceptance-");
    const dataDir = await mkdtemp(prefix);
    assert.ok(path.resolve(dataDir).startsWith(path.resolve(tmpdir())), "fixture directory must stay inside the OS temp directory");
    try {
        const store = new CalendarStore(dataDir);
        await store.load();
        const created = await store.create({
            ...eventFixture("evt_created"),
            id: "evt_created",
            source: undefined,
            createdAt: undefined,
            updatedAt: undefined,
        } as unknown as Parameters<CalendarStore["create"]>[0]);
        assert.equal(created.id, "evt_created");
        assert.deepEqual(created.source, { kind: "user", id: "evt_created", label: "Calendar", editable: true, href: "/calendar" });
        assert.equal(created.attendeeDetails?.length, 2, "store persistence must retain name-only attendee metadata");
        assert.equal(isEventEditable(created), true);

        const createdOccurrences = expandRecurringCalendarEvents(
            [created as RichCalendarEvent],
            created.start,
            created.start + 90 * 86_400_000,
        );
        const editableOccurrence = createdOccurrences[1];
        assert.ok(editableOccurrence?.seriesId, "generated occurrences must point back to their persisted series");
        await expectRejected(() => store.update(editableOccurrence!.id, { title: "Wrong record" }), "not found");

        const updated = await store.update(editableOccurrence!.seriesId!, {
            title: "Updated planning",
            status: "confirmed",
            priority: "urgent",
            tags: ["Updated", "Planning"],
            recurrence: { frequency: "monthly", interval: 1, end: { type: "date", date: created.start + 180 * 86_400_000 } },
            id: "evt_forged",
            source: { kind: "financial", id: "bill_1", editable: false },
            createdAt: 0,
        }, created.updatedAt);
        assert.equal(updated.id, created.id, "patches must not replace the event id");
        assert.equal(updated.createdAt, created.createdAt, "patches must not replace createdAt");
        assert.equal(updated.source?.kind, "user", "patches must not forge source ownership");
        assert.ok(updated.updatedAt > created.updatedAt);
        await expectRejected(() => store.update(created.id, { title: "Stale writer" }, created.updatedAt), "changed since");
        await expectRejected(() => store.upsert(eventFixture("overlay:email:forged", { source: { kind: "email", id: "forged", editable: false } })), "invalid|source module");
        await expectRejected(() => store.upsert(eventFixture("evt_forged_source", { source: { kind: "email", id: "forged", editable: false } })), "source module");

        const reloaded = new CalendarStore(dataDir);
        await reloaded.load();
        const persisted = reloaded.list().find((item) => item.id === created.id);
        assert.ok(persisted);
        assert.equal(persisted?.title, "Updated planning");
        assert.equal(persisted?.timezone, "America/New_York");
        assert.equal(persisted?.conferenceUrl, "https://meet.example.test/quarterly-planning");
        assert.deepEqual(persisted?.customFields, created.customFields);
        assert.deepEqual(persisted?.attendeeDetails, created.attendeeDetails);

        assert.equal(await reloaded.remove("does_not_exist"), false);
        assert.equal(await reloaded.remove(editableOccurrence!.id), false, "generated occurrence ids must never delete a detached record");
        assert.equal(await reloaded.remove(editableOccurrence!.seriesId!), true, "series delete must remove the single canonical base record");
        assert.equal(reloaded.list().length, 0);

        await writeFile(path.join(dataDir, "calendar.json"), JSON.stringify([
            {
                id: "legacy_event",
                title: "Legacy event",
                category: "personal",
                color: "#22c55e",
                allDay: true,
                start: Date.parse("2026-08-25T00:00:00.000Z"),
                end: Date.parse("2026-08-25T23:59:59.999Z"),
                attendees: [],
                reminders: [15],
                createdAt: 123,
                updatedAt: 123,
            },
            eventFixture("overlay:agent:must_not_persist", { source: { kind: "agent", id: "must_not_persist", editable: false } }),
            { id: "broken", start: "not-a-date" },
        ], null, 2), "utf8");
        const migrated = new CalendarStore(dataDir);
        await migrated.load();
        assert.equal(migrated.list().length, 1, "legacy migration must isolate corrupt and derived records");
        assert.equal(migrated.list()[0]?.id, "legacy_event");
        assert.equal(migrated.list()[0]?.source?.kind, "user");
        assert.equal(migrated.list()[0]?.status, "confirmed");
        assert.ok(migrated.getCategories().some((category) => category.id === "nutrition"), "default categories must include every module source");

        await migrated.setCategories([
            { id: "custom", label: "  Custom  ", color: "bad", reminderOffsets: [60, 15, 60, -1] },
            { id: "custom", label: "Duplicate", color: "#ffffff" },
        ]);
        assert.deepEqual(migrated.getCategories(), [{ id: "custom", label: "Custom", color: "#667085", reminderOffsets: [15, 60] }]);
        const persistedJson = JSON.parse(await readFile(path.join(dataDir, "calendar.json"), "utf8")) as { events: unknown[]; categories: unknown[] };
        assert.equal(persistedJson.events.length, 1);
        assert.equal(persistedJson.categories.length, 1);

        const malformed = normalizeOwnedCalendarEvent({ ...eventFixture("evt_normalized"), timezone: "Mars/Olympus", url: "javascript:alert(1)", reminders: [10, 10, -1, 999_999] });
        assert.equal(malformed.timezone, undefined);
        assert.equal(malformed.url, undefined);
        assert.deepEqual(malformed.reminders, [10]);
    } finally {
        await rm(dataDir, { recursive: true, force: true });
    }
}

async function testDisposablePersonalFeedFixtures(): Promise<void> {
    const suffix = randomUUID().replaceAll("-", "");
    const userId = `calendar_smoke_${suffix}`;
    const outsiderId = `calendar_smoke_outsider_${suffix}`;
    const day = new Date("2026-08-20T00:00:00.000Z");
    try {
        await prisma.user.createMany({
            data: [
                { id: userId, email: `${userId}@example.invalid`, name: "Calendar fixture", passwordHash: "disposable" },
                { id: outsiderId, email: `${outsiderId}@example.invalid`, name: "Calendar outsider", passwordHash: "disposable" },
            ],
        });
        await prisma.todoItem.create({ data: { userId, title: "Fixture todo", status: "PLANNED", date: day, startTime: "08:15", durationMinutes: 45 } });
        await prisma.socialEvent.create({ data: { userId, name: "Fixture social", eventDate: new Date("2026-08-20T18:30:00.000Z"), location: "Cafe" } });
        await prisma.workout.create({ data: { userId, name: "Fixture workout", date: day, startedAt: new Date("2026-08-20T12:00:00.000Z"), endedAt: new Date("2026-08-20T13:10:00.000Z") } });
        await prisma.nutritionDay.create({
            data: {
                userId,
                date: day,
                meals: {
                    create: {
                        mealType: "LUNCH",
                        name: "Fixture lunch",
                        loggedAt: new Date("2026-08-20T16:30:00.000Z"),
                        entries: { create: { description: "Fixture bowl", source: "MANUAL", calories: 650, proteinG: 35 } },
                    },
                },
            },
        });
        await prisma.calendarEvent.create({
            data: {
                userId,
                kind: "APPOINTMENT",
                title: "Fixture physical",
                startsAt: new Date("2026-08-20T14:00:00.000Z"),
                endsAt: new Date("2026-08-20T15:00:00.000Z"),
                location: "Clinic",
            },
        });
        await prisma.finSubscription.create({
            data: {
                userId,
                name: "Fixture hosting",
                merchant: "Fixture cloud",
                amount: 29.99,
                currency: "USD",
                status: "ACTIVE",
                cadence: "MONTHLY",
                nextChargeOn: day,
            },
        });

        const result = await getPersonalCalendar(userId, { start: "2026-08-20", end: "2026-08-20" });
        const sourceKinds = new Set(result.events.map((event) => event.source?.kind));
        for (const kind of ["todo", "social", "workout", "nutrition", "health"]) {
            assert.ok(sourceKinds.has(kind as never), `DB-backed personal feed omitted ${kind}`);
        }
        for (const event of result.events) {
            assert.ok(event.source?.id, `${event.id} omitted stable source id`);
            assert.ok(event.source?.href, `${event.id} omitted source deep link`);
            assert.equal(event.source?.editable, false);
            assert.ok(event.start);
            if (!event.allDay) assert.ok(event.end, `${event.id} omitted timed end`);
        }
        const todo = result.events.find((event) => event.source?.kind === "todo");
        assert.match(todo?.start ?? "", /T08:15:00/, "todo wall-clock time must not be replaced by a generic all-day signal");
        const outsider = await getPersonalCalendar(outsiderId, { start: "2026-08-20", end: "2026-08-20" });
        assert.equal(outsider.events.length, 0, "calendar reads must remain tenant-scoped");
        const unified = await getUnifiedCalendarContext(userId, { start: "2026-08-20", end: "2026-08-20" });
        const unifiedKinds = new Set(unified.events.map((event) => event.source?.kind));
        for (const kind of ["financial", "social", "workout", "nutrition", "health", "todo"]) {
            assert.ok(unifiedKinds.has(kind as never), `unified LifeOS endpoint omitted ${kind}`);
        }
        assert.equal(unified.counts.financial, 1);
        assert.equal(unified.sources.includes("nutrition"), true);
    } finally {
        await prisma.user.deleteMany({ where: { id: { in: [userId, outsiderId] } } });
        const residue = await prisma.user.count({ where: { id: { in: [userId, outsiderId] } } });
        assert.equal(residue, 0, "disposable calendar fixture users were not cleaned up");
    }
}

async function testUiCompositionContract(): Promise<void> {
    const [view, editor, appShell] = await Promise.all([
        readFile(fileURLToPath(new URL("../../shared/src/coretex/calendar/calendar-view.tsx", import.meta.url)), "utf8"),
        readFile(fileURLToPath(new URL("../../shared/src/coretex/calendar/event-editor.tsx", import.meta.url)), "utf8"),
        readFile(fileURLToPath(new URL("../../shared/src/coretex/app-shell.tsx", import.meta.url)), "utf8"),
    ]);

    for (const helper of ["deriveWorkspaceCalendarEvents", "deriveFinancialCalendarEvents", "derivePersonalCalendarEvents", "mergeCalendarEvents", "expandRecurringCalendarEvents"]) {
        assert.match(view, new RegExp(`\\b${helper}\\b`), `CalendarView must consume ${helper}`);
    }
    assert.match(view, /const allEvents = useMemo\(\(\) => expandRecurringCalendarEvents\(baseEvents, recurrenceRange\.start, recurrenceRange\.end\)/);
    assert.match(view, /const events = useMemo\(\(\) => allEvents\.filter/);
    assert.match(view, /<MiniCalendar[\s\S]*?eventDays=\{eventDays\}/, "mini-calendar dots must consume expanded occurrences");
    assert.match(view, /<MonthCalendar[\s\S]*?eventsForDay=\{eventsForDay\}/);
    assert.match(view, /<WeekView[\s\S]*?eventsForDay=\{eventsForDay\}/);
    assert.match(view, /<DayView[\s\S]*?events=\{eventsForDay\(cursor\)\}/);
    assert.match(view, /<DaySidebar[\s\S]*?events=\{eventsForDay\(cursor\)\}/);

    assert.match(view, /if \(!isEventEditable\(ev\)\) \{\s*setSourceDetail\(ev\)/, "source event clicks must open details rather than silently returning");
    assert.match(view, /ev\.seriesId \? userEvents\.find\(\(event\) => event\.id === ev\.seriesId\) : ev/, "occurrence editing must resolve the canonical base series before hydration");
    assert.match(view, /const editorEvent = ev\.seriesId \? \{ \.\.\.base, seriesId: base\.id, occurrenceStart: ev\.start \} : base/);
    assert.match(view, /<CalendarSourceDetail[\s\S]*?onNavigate\(target\)/, "source details must offer actionable in-app navigation");
    assert.match(view, /Managed by \{sourceLabel\}[\s\S]*?live source event/);
    assert.match(view, /fmtTime\(event\.start, event\.timezone\)[\s\S]*?fmtTime\(event\.end, event\.timezone\)/, "source details must not label host-zone wall times as the event timezone");
    assert.match(view, /export function calendarSourceTarget/);
    for (const kind of EXPECTED_SOURCE_KINDS) assert.match(view, new RegExp(`source\\.kind === "${kind}"`), `source navigation omitted ${kind}`);
    assert.match(appShell, /<CalendarView[\s\S]*?onNavigate=\{setNav\}/, "AppShell must wire Calendar source navigation");

    for (const field of ["timezone", "status", "priority", "availability", "visibility", "recurrence", "tags", "url", "conferenceUrl", "customFields", "attendees", "reminders", "location", "description"] as const) {
        assert.match(editor, new RegExp(`draft\\.${field}\\b`), `rich event editor omitted ${field}`);
    }
    assert.match(editor, /buildCalendarEvent\(draft/);
    assert.match(editor, /hydrateCalendarDraft\(current\)/);
    assert.match(editor, /seriesId \?\? event\.id/, "series delete must target the canonical base id");
    assert.match(editor, /Delete this \{draft\.recurrence \? "entire series" : "event"\}/);
    assert.match(editor, /Duplicate/);
    assert.match(editor, /Enter a valid IANA timezone/);
    assert.match(editor, /Choose at least one weekday/);
    assert.doesNotMatch(view, /task\.dueAt \|\| task\.updatedAt/, "CalendarView must not restore the old fabricated updatedAt due date");
    assert.doesNotMatch(view, /const dayEnd = dayStart \+ DAY_MS/, "time-grid day boundaries must not assume every civil day is 24 hours");
}

async function main(): Promise<void> {
    testWorkspaceAndUnifiedFeed();
    step("Unified workspace, email, finance, and personal source contracts");
    testBackendUnifiedNormalizer();
    step("Backend cross-module normalizer and DST-safe range contracts");
    testDraftNormalizationAndTimezoneRoundTrip();
    step("Rich editor normalization, recurrence, and timezone round-trip");
    testRecurrenceExpansion();
    step("Daily, weekly, monthly, yearly, bounded, and DST recurrence expansion");
    await testTemporaryCalendarStore();
    step("Temporary CalendarStore CRUD, concurrency, validation, and migration");
    await testDisposablePersonalFeedFixtures();
    step("Disposable DB feed coverage and tenant isolation");
    await testUiCompositionContract();
    step("Calendar view, recurrence-series, source-detail, and rich-editor UI wiring");
}

main()
    .finally(async () => {
        await prisma.$disconnect();
    })
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
