import { prisma } from "../db/prisma.js";
import type { CalendarEventSource } from "../types.js";

const DAY_MS = 86_400_000;

export type PersonalCalendarCategory = "todos" | "social" | "workouts" | "nutrition" | "health";

export interface PersonalCalendarSignal {
    id: string;
    title: string;
    start: string;
    end: string | null;
    allDay: boolean;
    category: PersonalCalendarCategory;
    description: string | null;
    status: string | null;
    source: CalendarEventSource;
}

const isoDay = (value: Date) => value.toISOString().slice(0, 10);

function rangeFromPayload(payload?: Record<string, unknown>) {
    const today = new Date();
    const fallbackStart = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() - 62));
    const fallbackEnd = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() + 63));
    const parse = (value: unknown, fallback: Date) => {
        if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
        const parsed = new Date(`${value}T00:00:00.000Z`);
        return Number.isNaN(parsed.getTime()) ? fallback : parsed;
    };
    const start = parse(payload?.start, fallbackStart);
    const requestedEnd = parse(payload?.end, fallbackEnd);
    const end = new Date(Math.min(requestedEnd.getTime() + DAY_MS, start.getTime() + 400 * DAY_MS));
    if (end <= start) return { start: fallbackStart, end: fallbackEnd };
    return { start, end };
}

function localDateTime(day: string, time: string, durationMinutes: number | null): { start: string; end: string } {
    const [year, month, date] = day.split("-").map(Number);
    const [hour, minute] = time.split(":").map(Number);
    const startMs = Date.UTC(year, month - 1, date, hour || 0, minute || 0);
    const endMs = startMs + Math.max(1, durationMinutes ?? 30) * 60_000;
    return {
        start: new Date(startMs).toISOString().slice(0, 19),
        end: new Date(endMs).toISOString().slice(0, 19),
    };
}

const sourceFor = (id: string, category: PersonalCalendarCategory): CalendarEventSource => {
    const prefix = id.split(":", 1)[0] ?? "";
    const rawId = id.slice(prefix.length + 1).replace(/:\d{4}$/, "");
    if (category === "todos") return { kind: "todo", id: rawId, label: "Todo", editable: false, href: `/todos?todo=${encodeURIComponent(rawId)}` };
    if (category === "social") return { kind: "social", id: rawId, label: "Social", editable: false, href: `/social?item=${encodeURIComponent(rawId)}` };
    if (category === "workouts") return { kind: "workout", id: rawId, label: "Workout", editable: false, href: `/workouts?item=${encodeURIComponent(rawId)}` };
    if (category === "nutrition") return { kind: "nutrition", id: rawId, label: "Nutrition", editable: false, href: `/nutrition?item=${encodeURIComponent(rawId)}` };
    return { kind: "health", id: rawId, label: "Health", editable: false, href: `/health?item=${encodeURIComponent(rawId)}` };
};

function timedSignal(input: Omit<PersonalCalendarSignal, "start" | "end" | "allDay" | "source"> & { start: Date; end?: Date | null; source?: CalendarEventSource }): PersonalCalendarSignal {
    return {
        ...input,
        source: input.source ?? sourceFor(input.id, input.category),
        start: input.start.toISOString(),
        end: (input.end ?? new Date(input.start.getTime() + 60 * 60_000)).toISOString(),
        allDay: false,
    };
}

function allDaySignal(input: Omit<PersonalCalendarSignal, "start" | "end" | "allDay" | "source"> & { date: Date | string; source?: CalendarEventSource }): PersonalCalendarSignal {
    const day = typeof input.date === "string" ? input.date : isoDay(input.date);
    const { date: _date, ...signal } = input;
    return { ...signal, source: signal.source ?? sourceFor(signal.id, signal.category), start: day, end: day, allDay: true };
}

/**
 * Read-only calendar bridge for personal modules. Mutations stay in their source
 * screens; the main calendar receives normalized signals for filtering and the
 * selected-day agenda.
 */
export async function getPersonalCalendar(userId: string, payload?: Record<string, unknown>) {
    const { start, end } = rangeFromPayload(payload);
    const [todos, socialEvents, appointments, contacts, reminders, drafts, schedules, workouts, journal, doses, peptideLogs, nutritionDays, waterLogs, sleepEntries, habitLogs, bodyMetrics, vitalReadings] = await Promise.all([
        prisma.todoItem.findMany({
            where: {
                userId,
                status: { not: "SKIPPED" },
                OR: [
                    { date: { gte: start, lt: end } },
                    { plannedAt: { gte: start, lt: end } },
                    { dueAt: { gte: start, lt: end } },
                ],
            },
            orderBy: [{ date: "asc" }, { plannedAt: "asc" }],
            take: 1_000,
            select: { id: true, title: true, body: true, status: true, priority: true, category: true, date: true, startTime: true, durationMinutes: true, plannedAt: true, dueAt: true },
        }),
        prisma.socialEvent.findMany({
            where: { userId, eventDate: { gte: start, lt: end } },
            orderBy: { eventDate: "asc" },
            take: 500,
            select: { id: true, name: true, eventDate: true, location: true, notes: true },
        }),
        prisma.calendarEvent.findMany({
            where: { userId, kind: "APPOINTMENT", startsAt: { gte: start, lt: end } },
            orderBy: { startsAt: "asc" },
            take: 500,
            select: { id: true, title: true, description: true, location: true, startsAt: true, endsAt: true, visitNotes: true, provider: { select: { name: true } }, doctor: { select: { name: true } } },
        }),
        prisma.socialContact.findMany({
            where: { userId, active: true, OR: [{ birthday: { not: null } }, { dates: { some: {} } }] },
            select: { id: true, displayName: true, birthday: true, dates: { select: { id: true, dateType: true, dateValue: true } } },
        }),
        prisma.contactReminder.findMany({
            where: { contact: { userId, active: true }, completed: false, scheduledFor: { gte: start, lt: end } },
            orderBy: { scheduledFor: "asc" },
            take: 500,
            select: { id: true, reminderType: true, scheduledFor: true, contact: { select: { displayName: true } } },
        }),
        prisma.outreachDraft.findMany({
            where: { userId, archived: false, sentAt: null, dueAt: { gte: start, lt: end } },
            orderBy: { dueAt: "asc" },
            take: 500,
            select: { id: true, channel: true, dueAt: true, contact: { select: { displayName: true } } },
        }),
        prisma.workoutSchedule.findMany({
            where: { userId, date: { gte: start, lt: end } },
            orderBy: { date: "asc" },
            take: 500,
            select: { id: true, date: true, name: true, notes: true, skipped: true, template: { select: { name: true } }, workout: { select: { id: true, name: true, startedAt: true, endedAt: true } } },
        }),
        prisma.workout.findMany({
            where: { userId, deletedAt: null, isQuickLog: false, schedule: null, date: { gte: start, lt: end } },
            orderBy: { date: "asc" },
            take: 500,
            select: { id: true, name: true, note: true, date: true, startedAt: true, endedAt: true },
        }),
        prisma.journalEntry.findMany({
            where: { userId, date: { gte: start, lt: end } },
            orderBy: { date: "asc" },
            take: 500,
            select: { id: true, date: true, reflection: true, gratitude: true, overallRating: true },
        }),
        prisma.therapeuticDose.findMany({
            where: { userId, scheduledAt: { gte: start, lt: end } },
            orderBy: { scheduledAt: "asc" },
            take: 1_000,
            select: { id: true, scheduledAt: true, loggedAt: true, skippedAt: true, schedule: { select: { name: true, kind: true, dosage: true } } },
        }),
        prisma.peptideLog.findMany({
            where: { peptide: { userId }, date: { gte: start, lt: end } },
            orderBy: { date: "asc" },
            take: 500,
            select: { id: true, date: true, dose: true, units: true, site: true, peptide: { select: { name: true, doseUnit: true } } },
        }),
        prisma.nutritionDay.findMany({
            where: { userId, date: { gte: start, lt: end } },
            orderBy: { date: "asc" },
            take: 500,
            select: {
                id: true,
                date: true,
                notes: true,
                meals: {
                    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
                    select: {
                        id: true,
                        mealType: true,
                        name: true,
                        loggedAt: true,
                        entries: { orderBy: { order: "asc" }, select: { description: true, calories: true, proteinG: true, carbsG: true, fatG: true } },
                    },
                },
            },
        }),
        prisma.waterLog.findMany({
            where: { userId, date: { gte: start, lt: end } },
            orderBy: { date: "asc" },
            take: 500,
            select: { id: true, date: true, amountMl: true },
        }),
        prisma.sleepEntry.findMany({
            where: { userId, date: { gte: start, lt: end } },
            orderBy: { date: "asc" },
            take: 500,
            select: { id: true, date: true, bedtime: true, wakeTime: true, totalMinutes: true, sleepQuality: true, feelRested: true, restingHrBpm: true, hrvMs: true, notes: true },
        }),
        prisma.habitLog.findMany({
            where: { habit: { userId }, logDate: { gte: start, lt: end } },
            orderBy: { logDate: "asc" },
            take: 1_000,
            select: { id: true, logDate: true, count: true, notes: true, habit: { select: { id: true, name: true, targetCount: true, category: true } } },
        }),
        prisma.bodyMetric.findMany({
            where: { userId, measuredAt: { gte: start, lt: end } },
            orderBy: { measuredAt: "asc" },
            take: 1_000,
            select: { id: true, metricType: true, customName: true, value: true, unit: true, measuredAt: true, notes: true },
        }),
        prisma.vitalReading.findMany({
            where: { userId, measuredAt: { gte: start, lt: end } },
            orderBy: { measuredAt: "asc" },
            take: 1_000,
            select: { id: true, vitalType: true, customName: true, value: true, value2: true, unit: true, measuredAt: true, notes: true },
        }),
    ]);

    const events: PersonalCalendarSignal[] = [];

    for (const todo of todos) {
        const description = [todo.category, todo.priority !== "NONE" ? `${todo.priority.toLowerCase()} priority` : null, todo.body].filter(Boolean).join(" · ") || null;
        if (todo.date && todo.startTime) {
            const timing = localDateTime(isoDay(todo.date), todo.startTime, todo.durationMinutes);
            const id = `todo:${todo.id}`;
            events.push({ id, title: todo.title, ...timing, allDay: false, category: "todos", description, status: todo.status, source: sourceFor(id, "todos") });
        } else if (todo.plannedAt || todo.dueAt) {
            const when = todo.plannedAt ?? todo.dueAt!;
            events.push(timedSignal({ id: `todo:${todo.id}`, title: todo.title, start: when, end: todo.durationMinutes ? new Date(when.getTime() + todo.durationMinutes * 60_000) : null, category: "todos", description, status: todo.status }));
        } else if (todo.date) {
            events.push(allDaySignal({ id: `todo:${todo.id}`, title: todo.title, date: todo.date, category: "todos", description, status: todo.status }));
        }
    }

    for (const event of socialEvents) {
        if (!event.eventDate) continue;
        const midnight = event.eventDate.getUTCHours() === 0 && event.eventDate.getUTCMinutes() === 0 && event.eventDate.getUTCSeconds() === 0;
        const description = [event.location, event.notes].filter(Boolean).join(" · ") || null;
        events.push(midnight
            ? allDaySignal({ id: `social-event:${event.id}`, title: event.name, date: event.eventDate, category: "social", description, status: "EVENT" })
            : timedSignal({ id: `social-event:${event.id}`, title: event.name, start: event.eventDate, category: "social", description, status: "EVENT" }));
    }
    for (const appointment of appointments) {
        events.push(timedSignal({ id: `appointment:${appointment.id}`, title: appointment.title, start: appointment.startsAt, end: appointment.endsAt, category: "health", description: [appointment.doctor?.name, appointment.provider?.name, appointment.location, appointment.description, appointment.visitNotes].filter(Boolean).join(" · ") || null, status: "APPOINTMENT" }));
    }

    const firstYear = start.getUTCFullYear();
    const lastYear = new Date(end.getTime() - 1).getUTCFullYear();
    const addAnnualDate = (id: string, name: string, kind: string, value: Date) => {
        for (let year = firstYear; year <= lastYear; year++) {
            const instance = new Date(Date.UTC(year, value.getUTCMonth(), value.getUTCDate()));
            if (instance.getUTCMonth() !== value.getUTCMonth() || instance < start || instance >= end) continue;
            events.push(allDaySignal({ id: `${id}:${year}`, title: `${kind} · ${name}`, date: instance, category: "social", description: `Annual ${kind.toLowerCase()}`, status: "ANNUAL" }));
        }
    };
    for (const contact of contacts) {
        if (contact.birthday) addAnnualDate(`birthday:${contact.id}`, contact.displayName, "Birthday", contact.birthday);
        for (const date of contact.dates) addAnnualDate(`contact-date:${date.id}`, contact.displayName, date.dateType, date.dateValue);
    }

    for (const reminder of reminders) {
        events.push(timedSignal({ id: `social-reminder:${reminder.id}`, title: `Reach out · ${reminder.contact.displayName}`, start: reminder.scheduledFor, category: "social", description: reminder.reminderType || "Relationship reminder", status: "OPEN" }));
    }
    for (const draft of drafts) {
        if (!draft.dueAt) continue;
        events.push(timedSignal({ id: `social-draft:${draft.id}`, title: `Send ${draft.channel || "message"}${draft.contact ? ` · ${draft.contact.displayName}` : ""}`, start: draft.dueAt, category: "social", description: "Draft follow-up due", status: "DRAFT" }));
    }

    for (const schedule of schedules) {
        const title = schedule.name?.trim() || schedule.workout?.name?.trim() || schedule.template?.name || "Planned workout";
        if (schedule.workout?.startedAt) {
            events.push(timedSignal({ id: `workout-plan:${schedule.id}`, title, start: schedule.workout.startedAt, end: schedule.workout.endedAt, category: "workouts", description: schedule.notes, status: "COMPLETED" }));
        } else {
            events.push(allDaySignal({ id: `workout-plan:${schedule.id}`, title, date: schedule.date, category: "workouts", description: schedule.notes, status: schedule.skipped ? "SKIPPED" : isoDay(schedule.date) < isoDay(new Date()) ? "MISSED" : "PLANNED" }));
        }
    }
    for (const workout of workouts) {
        const title = workout.name?.trim() || "Workout";
        events.push(workout.startedAt
            ? timedSignal({ id: `workout:${workout.id}`, title, start: workout.startedAt, end: workout.endedAt, category: "workouts", description: workout.note, status: workout.endedAt ? "COMPLETED" : "IN_PROGRESS" })
            : allDaySignal({ id: `workout:${workout.id}`, title, date: workout.date, category: "workouts", description: workout.note, status: "LOGGED" }));
    }

    for (const day of nutritionDays) {
        for (const meal of day.meals) {
            if (meal.entries.length === 0) continue;
            const calories = meal.entries.reduce((total, entry) => total + (entry.calories ?? 0), 0);
            const protein = meal.entries.reduce((total, entry) => total + (entry.proteinG ?? 0), 0);
            const carbs = meal.entries.reduce((total, entry) => total + (entry.carbsG ?? 0), 0);
            const fat = meal.entries.reduce((total, entry) => total + (entry.fatG ?? 0), 0);
            const mealName = meal.name?.trim() || meal.mealType.toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
            const title = `${mealName} · ${Math.round(calories)} kcal`;
            const foods = meal.entries.slice(0, 4).map((entry) => entry.description).join(", ");
            const description = [foods, `P ${Math.round(protein)}g · C ${Math.round(carbs)}g · F ${Math.round(fat)}g`, day.notes].filter(Boolean).join(" · ");
            const id = `meal:${meal.id}`;
            const source = { kind: "nutrition" as const, id: meal.id, label: "Meal", editable: false, href: `/nutrition?date=${isoDay(day.date)}&meal=${encodeURIComponent(meal.id)}` };
            events.push(meal.loggedAt
                ? timedSignal({ id, title, start: meal.loggedAt, end: new Date(meal.loggedAt.getTime() + 30 * 60_000), category: "nutrition", description, status: "LOGGED", source })
                : allDaySignal({ id, title, date: day.date, category: "nutrition", description, status: "LOGGED", source }));
        }
    }
    for (const water of waterLogs) {
        if (water.amountMl <= 0) continue;
        const liters = water.amountMl / 1_000;
        const amount = liters >= 1 ? `${Number(liters.toFixed(2))} L` : `${water.amountMl} ml`;
        events.push(allDaySignal({
            id: `water:${water.id}`,
            title: `Water · ${amount}`,
            date: water.date,
            category: "nutrition",
            description: "Daily hydration total",
            status: "LOGGED",
            source: { kind: "nutrition", id: water.id, label: "Water", editable: false, href: `/nutrition?date=${isoDay(water.date)}` },
        }));
    }

    for (const entry of journal) {
        const summary = entry.reflection?.trim() || entry.gratitude?.trim() || null;
        events.push(allDaySignal({ id: `journal:${entry.id}`, title: entry.overallRating ? `Journal · ${entry.overallRating}/10` : "Journal entry", date: entry.date, category: "health", description: summary, status: "LOGGED" }));
    }
    for (const dose of doses) {
        const status = dose.loggedAt ? "TAKEN" : dose.skippedAt ? "SKIPPED" : dose.scheduledAt.getTime() < Date.now() ? "MISSED" : "UPCOMING";
        events.push(timedSignal({ id: `dose:${dose.id}`, title: dose.schedule?.name || "Medication dose", start: dose.scheduledAt, end: new Date(dose.scheduledAt.getTime() + 15 * 60_000), category: "health", description: [dose.schedule?.kind, dose.schedule?.dosage].filter(Boolean).join(" · ") || null, status }));
    }
    for (const log of peptideLogs) {
        events.push(allDaySignal({ id: `peptide:${log.id}`, title: `${log.peptide.name} dose`, date: log.date, category: "health", description: `${log.dose} ${log.peptide.doseUnit}${log.site ? ` · ${log.site}` : ""}`, status: "TAKEN" }));
    }

    for (const sleep of sleepEntries) {
        const duration = sleep.totalMinutes ? `${Math.floor(sleep.totalMinutes / 60)}h ${sleep.totalMinutes % 60}m` : null;
        const title = duration ? `Sleep · ${duration}` : "Sleep entry";
        const description = [
            sleep.sleepQuality ? `quality ${sleep.sleepQuality}/10` : null,
            sleep.feelRested ? `rested ${sleep.feelRested}/10` : null,
            sleep.restingHrBpm ? `${sleep.restingHrBpm} bpm resting` : null,
            sleep.hrvMs ? `${sleep.hrvMs} ms HRV` : null,
            sleep.notes,
        ].filter(Boolean).join(" · ") || null;
        const source = { kind: "health" as const, id: sleep.id, label: "Sleep", editable: false, href: `/health?tab=sleep&entry=${encodeURIComponent(sleep.id)}` };
        events.push(sleep.bedtime
            ? timedSignal({ id: `sleep:${sleep.id}`, title, start: sleep.bedtime, end: sleep.wakeTime, category: "health", description, status: "LOGGED", source })
            : allDaySignal({ id: `sleep:${sleep.id}`, title, date: sleep.date, category: "health", description, status: "LOGGED", source }));
    }
    for (const habit of habitLogs) {
        const target = habit.habit.targetCount ? ` / ${habit.habit.targetCount}` : "";
        events.push(allDaySignal({
            id: `habit:${habit.id}`,
            title: `${habit.habit.name} · ${habit.count}${target}`,
            date: habit.logDate,
            category: "health",
            description: [habit.habit.category, habit.notes].filter(Boolean).join(" · ") || null,
            status: habit.habit.targetCount && habit.count < habit.habit.targetCount ? "IN_PROGRESS" : "COMPLETED",
            source: { kind: "health", id: habit.habit.id, label: "Habit", editable: false, href: `/health?tab=habits&habit=${encodeURIComponent(habit.habit.id)}` },
        }));
    }
    for (const metric of bodyMetrics) {
        const label = metric.customName?.trim() || metric.metricType.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
        events.push(timedSignal({
            id: `metric:${metric.id}`,
            title: `${label} · ${metric.value}${metric.unit ? ` ${metric.unit}` : ""}`,
            start: metric.measuredAt,
            end: new Date(metric.measuredAt.getTime() + 15 * 60_000),
            category: "health",
            description: metric.notes,
            status: "LOGGED",
            source: { kind: "health", id: metric.id, label: "Body metric", editable: false, href: `/health?tab=metrics&metric=${encodeURIComponent(metric.id)}` },
        }));
    }
    for (const vital of vitalReadings) {
        const label = vital.customName?.trim() || vital.vitalType.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
        const reading = vital.value == null ? "Logged" : `${vital.value}${vital.value2 == null ? "" : `/${vital.value2}`}${vital.unit ? ` ${vital.unit}` : ""}`;
        events.push(timedSignal({
            id: `vital:${vital.id}`,
            title: `${label} · ${reading}`,
            start: vital.measuredAt,
            end: new Date(vital.measuredAt.getTime() + 15 * 60_000),
            category: "health",
            description: vital.notes,
            status: "LOGGED",
            source: { kind: "health", id: vital.id, label: "Vital", editable: false, href: `/health?tab=vitals&vital=${encodeURIComponent(vital.id)}` },
        }));
    }

    events.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
    return { range: { start: isoDay(start), end: isoDay(new Date(end.getTime() - DAY_MS)) }, events };
}
