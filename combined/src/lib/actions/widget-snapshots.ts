"use server";

import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { alpacaEnvConfigured, alpacaPaperEnvCreds, resolveActiveAlpacaCreds } from "@/lib/financial/alpaca-config";
import { getAccount, type AlpacaCreds } from "@/lib/financial/alpaca";
import type { UnitSystem } from "@/lib/units";

/** Start of today as a DateTime bound (server local; used for startsAt/eventDate ranges). */
function todayUtc(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
}

function endOfToday(): Date {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d;
}

/**
 * UTC-midnight day key for @db.Date columns (nutritionDay/waterLog/habitLog).
 * Matches the server's parseDateOnly convention (Date.UTC of the calendar date)
 * so widget READS line up with the writes done by the health/nutrition actions
 * regardless of the server timezone.
 */
function todayDateKeyUtc(): Date {
    const n = new Date();
    return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

// ============================================================
// Workouts — full in-widget session logging payload
// ============================================================

export interface WorkoutWidgetSet {
    id: string;
    order: number;
    isWarmup: boolean;
    isAmrap: boolean;
    completed: boolean;
    actualReps: number | null;
    actualWeight: number | null;
    actualSeconds: number | null;
    actualMeters: number | null;
    targetReps: number | null;
    targetWeight: number | null;
    rpe: number | null;
}

export interface WorkoutWidgetExercise {
    id: string;
    name: string;
    caps: { reps: boolean; weight: boolean; time: boolean; distance: boolean };
    restSec: number | null;
    sets: WorkoutWidgetSet[];
}

export interface WorkoutsWidgetSnapshot {
    unitSystem: UnitSystem;
    activeSession: {
        id: string;
        name: string | null;
        startedAt: string;
        exercises: WorkoutWidgetExercise[];
    } | null;
    templates: Array<{ id: string; name: string }>;
    library: Array<{ id: string; name: string }>;
}

export async function getWorkoutsWidgetSnapshot(): Promise<WorkoutsWidgetSnapshot> {
    const user = await requireUser();
    const [active, templates, libraryRows, settings] = await Promise.all([
        db.workout.findFirst({
            where: { userId: user.id, deletedAt: null, startedAt: { not: null }, endedAt: null },
            orderBy: { startedAt: "desc" },
            select: {
                id: true,
                name: true,
                startedAt: true,
                exercises: {
                    orderBy: { order: "asc" },
                    select: {
                        id: true,
                        restSec: true,
                        exercise: {
                            select: {
                                name: true,
                                tracksReps: true,
                                tracksWeight: true,
                                tracksTime: true,
                                tracksDistance: true,
                            },
                        },
                        sets: {
                            orderBy: { order: "asc" },
                            select: {
                                id: true,
                                order: true,
                                isWarmup: true,
                                isAmrap: true,
                                completed: true,
                                actualReps: true,
                                actualWeight: true,
                                actualSeconds: true,
                                actualMeters: true,
                                targetReps: true,
                                targetWeight: true,
                                rpe: true,
                            },
                        },
                    },
                },
            },
        }),
        db.template.findMany({
            where: { userId: user.id, archived: false },
            orderBy: { updatedAt: "desc" },
            take: 6,
            select: { id: true, name: true },
        }),
        db.exercise.findMany({
            where: { OR: [{ userId: null }, { userId: user.id }], archived: false },
            orderBy: { name: "asc" },
            select: { id: true, name: true },
        }),
        db.settings.findUnique({ where: { userId: user.id }, select: { unitSystem: true } }),
    ]);

    return {
        unitSystem: (settings?.unitSystem as UnitSystem) ?? "IMPERIAL",
        activeSession:
            active?.startedAt != null
                ? {
                      id: active.id,
                      name: active.name,
                      startedAt: active.startedAt.toISOString(),
                      exercises: active.exercises.map((we) => ({
                          id: we.id,
                          name: we.exercise.name,
                          restSec: we.restSec,
                          caps: {
                              reps: we.exercise.tracksReps,
                              weight: we.exercise.tracksWeight,
                              time: we.exercise.tracksTime,
                              distance: we.exercise.tracksDistance,
                          },
                          sets: we.sets.map((s) => ({
                              id: s.id,
                              order: s.order,
                              isWarmup: s.isWarmup,
                              isAmrap: s.isAmrap,
                              completed: s.completed,
                              actualReps: s.actualReps,
                              actualWeight: s.actualWeight,
                              actualSeconds: s.actualSeconds,
                              actualMeters: s.actualMeters,
                              targetReps: s.targetReps,
                              targetWeight: s.targetWeight,
                              rpe: s.rpe,
                          })),
                      })),
                  }
                : null,
        templates,
        library: libraryRows,
    };
}

// ============================================================
// Calendar — today / tomorrow / upcoming-week range
// ============================================================

export type CalendarRange = "today" | "tomorrow" | "week" | "day";

export interface CalendarWidgetSnapshot {
    range: CalendarRange;
    /** Day offset from today (0 = today) when range === "day"; null otherwise. */
    dayOffset: number | null;
    /** ISO start of the focused day when range === "day"; null otherwise. */
    dayIso: string | null;
    events: Array<{ id: string; title: string; startsAt: string; allDay: boolean }>;
}

/** Start/end of the calendar day that is `offset` days from today (server local). */
function dayBounds(offset: number): { gte: Date; lte: Date } {
    const start = new Date();
    start.setDate(start.getDate() + offset);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return { gte: start, lte: end };
}

function rangeBounds(range: CalendarRange, dayOffset: number): { gte: Date; lte: Date } {
    if (range === "day") {
        return dayBounds(dayOffset);
    }
    if (range === "tomorrow") {
        return dayBounds(1);
    }
    if (range === "week") {
        // Start at the beginning of today so in-progress and all-day events today
        // still show in the upcoming view.
        const start = todayUtc();
        const end = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        return { gte: start, lte: end };
    }
    return { gte: todayUtc(), lte: endOfToday() };
}

export async function getCalendarWidgetSnapshot(range: CalendarRange = "today", dayOffset = 0): Promise<CalendarWidgetSnapshot> {
    const user = await requireUser();
    const { gte, lte } = rangeBounds(range, dayOffset);
    const events = await db.calendarEvent.findMany({
        where: { userId: user.id, startsAt: { gte, lte } },
        orderBy: { startsAt: "asc" },
        take: 25,
        select: { id: true, title: true, startsAt: true, allDay: true },
    });
    return {
        range,
        dayOffset: range === "day" ? dayOffset : null,
        dayIso: range === "day" ? gte.toISOString() : null,
        events: events.map((e) => ({
            id: e.id,
            title: e.title,
            startsAt: e.startsAt.toISOString(),
            allDay: e.allDay,
        })),
    };
}

// ============================================================
// Nutrition — calories + macros vs daily goals
// ============================================================

export interface NutritionWidgetSnapshot {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    mealCount: number;
    goalCalories: number | null;
    goalProtein: number | null;
    goalCarbs: number | null;
    goalFat: number | null;
}

export async function getNutritionWidgetSnapshot(): Promise<NutritionWidgetSnapshot> {
    const user = await requireUser();
    const date = todayDateKeyUtc();
    const [day, goal] = await Promise.all([
        db.nutritionDay.findUnique({
            where: { userId_date: { userId: user.id, date } },
            include: { meals: { include: { entries: { select: { calories: true, proteinG: true, carbsG: true, fatG: true } } } } },
        }),
        db.nutritionGoal.findUnique({ where: { userId: user.id } }),
    ]);

    let calories = 0;
    let protein = 0;
    let carbs = 0;
    let fat = 0;
    let mealCount = 0;
    if (day) {
        // Count only meals that actually have entries (matches getNutritionDaySummaries);
        // empty Meal rows can linger after entries are deleted.
        mealCount = day.meals.filter((m) => m.entries.length > 0).length;
        for (const meal of day.meals) {
            for (const e of meal.entries) {
                calories += e.calories ?? 0;
                protein += e.proteinG ?? 0;
                carbs += e.carbsG ?? 0;
                fat += e.fatG ?? 0;
            }
        }
    }

    return {
        calories: Math.round(calories),
        protein: Math.round(protein),
        carbs: Math.round(carbs),
        fat: Math.round(fat),
        mealCount,
        goalCalories: goal?.calories ?? null,
        goalProtein: goal?.proteinG ?? null,
        goalCarbs: goal?.carbsG ?? null,
        goalFat: goal?.fatG ?? null,
    };
}

// ============================================================
// Health — rich snapshot (weight, body fat, water, sleep, HR, habits)
// ============================================================

export interface HealthWidgetSnapshot {
    unitSystem: UnitSystem;
    latestWeightKg: number | null;
    latestWeightAt: string | null;
    latestBodyFatPct: number | null;
    waterMl: number;
    waterGoalMl: number | null;
    lastSleepMinutes: number | null;
    lastSleepDate: string | null;
    lastSleepQuality: number | null;
    latestHeartRateBpm: number | null;
    habits: Array<{ id: string; name: string; done: boolean }>;
    habitsDone: number;
    habitsTotal: number;
}

export async function getHealthWidgetSnapshot(): Promise<HealthWidgetSnapshot> {
    const user = await requireUser();
    const date = todayDateKeyUtc();
    const [settings, weight, bodyFat, profile, water, sleep, hr, habits] = await Promise.all([
        db.settings.findUnique({ where: { userId: user.id }, select: { unitSystem: true } }),
        db.bodyMetric.findFirst({
            where: { userId: user.id, metricType: "weight" },
            orderBy: { measuredAt: "desc" },
            select: { value: true, measuredAt: true },
        }),
        db.bodyMetric.findFirst({
            where: { userId: user.id, metricType: "body_fat_pct" },
            orderBy: { measuredAt: "desc" },
            select: { value: true },
        }),
        db.userProfile.findUnique({ where: { userId: user.id }, select: { waterGoalMl: true } }),
        db.waterLog.findUnique({ where: { userId_date: { userId: user.id, date } }, select: { amountMl: true } }),
        db.sleepEntry.findFirst({
            where: { userId: user.id },
            orderBy: { date: "desc" },
            select: { totalMinutes: true, date: true, sleepQuality: true },
        }),
        db.vitalReading.findFirst({
            where: { userId: user.id, vitalType: "heart_rate" },
            orderBy: { measuredAt: "desc" },
            select: { value: true },
        }),
        db.habit.findMany({
            where: { userId: user.id, active: true },
            orderBy: { createdAt: "asc" },
            take: 8,
            select: { id: true, name: true },
        }),
    ]);

    const todayLogs = habits.length
        ? await db.habitLog.findMany({
              where: { habitId: { in: habits.map((h) => h.id) }, logDate: date },
              select: { habitId: true },
          })
        : [];
    const doneSet = new Set(todayLogs.map((l) => l.habitId));
    const habitRows = habits.map((h) => ({ id: h.id, name: h.name, done: doneSet.has(h.id) }));

    return {
        unitSystem: (settings?.unitSystem as UnitSystem) ?? "IMPERIAL",
        latestWeightKg: weight?.value ?? null,
        latestWeightAt: weight?.measuredAt?.toISOString() ?? null,
        latestBodyFatPct: bodyFat?.value ?? null,
        waterMl: water?.amountMl ?? 0,
        waterGoalMl: profile?.waterGoalMl ?? null,
        lastSleepMinutes: sleep?.totalMinutes ?? null,
        lastSleepDate: sleep?.date?.toISOString() ?? null,
        lastSleepQuality: sleep?.sleepQuality ?? null,
        latestHeartRateBpm: hr?.value ?? null,
        habits: habitRows,
        habitsDone: habitRows.filter((h) => h.done).length,
        habitsTotal: habitRows.length,
    };
}

// ============================================================
// Social — upcoming social events (quick-log handled in panel)
// ============================================================

export interface SocialWidgetSnapshot {
    upcoming: Array<{ id: string; title: string; startsAt: string; location: string | null }>;
    contactCount: number;
}

export async function getSocialWidgetSnapshot(): Promise<SocialWidgetSnapshot> {
    const user = await requireUser();
    // Start of today so an all-day social event today (midnight) still counts as upcoming.
    const from = todayUtc();
    const [upcoming, contactCount] = await Promise.all([
        db.socialEvent.findMany({
            where: { userId: user.id, eventDate: { gte: from } },
            orderBy: { eventDate: "asc" },
            take: 6,
            select: { id: true, name: true, eventDate: true, location: true },
        }),
        db.socialContact.count({ where: { userId: user.id } }),
    ]);

    return {
        upcoming: upcoming
            .filter((e): e is typeof e & { eventDate: Date } => e.eventDate != null)
            .map((e) => ({
                id: e.id,
                title: e.name,
                startsAt: e.eventDate.toISOString(),
                location: e.location ?? null,
            })),
        contactCount,
    };
}

// ============================================================
// Financial — net worth + accounts (works without Alpaca)
// ============================================================

export interface FinancialWidgetSnapshot {
    hasData: boolean;
    netWorth: number;
    assets: number;
    liabilities: number;
    cash: number;
    investments: number;
    cardDebt: number;
    alpaca: { configured: boolean; connected: boolean; mode: "paper" | "live" | null; equity: number | null } | null;
}

async function alpacaCredsForUser(userId: string): Promise<AlpacaCreds | null> {
    const row = await db.alpacaConnection.findUnique({ where: { userId } });
    if (!row) {
        if (!alpacaEnvConfigured()) return null;
        const paper = alpacaPaperEnvCreds();
        if (paper) return { ...paper, paper: true };
        return null;
    }
    return resolveActiveAlpacaCreds(row);
}

export async function getFinancialWidgetSnapshot(): Promise<FinancialWidgetSnapshot> {
    const user = await requireUser();
    const [accounts, cards, debts, brokerage] = await Promise.all([
        db.finAccount.findMany({ where: { userId: user.id, archived: false } }),
        db.creditCard.findMany({ where: { userId: user.id, archived: false } }),
        db.debt.findMany({ where: { userId: user.id } }),
        db.brokerageAccount.findMany({ where: { userId: user.id, archived: false } }),
    ]);

    let assets = 0;
    let liabilities = 0;
    let brokerageAssets = 0;
    let cash = 0;
    for (const a of accounts) {
        const bal = Number(a.currentBalance);
        // Liquid cash tile: only positive-asset checking/savings (never an isAsset:false account).
        if ((a.kind === "CHECKING" || a.kind === "SAVINGS") && a.isAsset) cash += bal;
        if (!a.includeInNetWorth) continue;
        if (a.kind === "LOAN" || !a.isAsset) liabilities += Math.abs(bal);
        else {
            assets += bal;
            if (a.kind === "BROKERAGE") brokerageAssets += bal;
        }
    }
    const legacyBrokerage = brokerage.reduce((s, b) => s + Number(b.currentValue), 0);
    assets += legacyBrokerage;
    const cardDebt = cards.reduce((s, c) => s + Number(c.currentBalance), 0);
    liabilities += cardDebt;
    liabilities += debts.reduce((s, d) => s + Number(d.principalRemaining ?? 0), 0);
    const netWorth = assets - liabilities;

    // Alpaca is additive context, never required for the widget to show data.
    const configured = alpacaEnvConfigured();
    let alpaca: FinancialWidgetSnapshot["alpaca"] = configured ? { configured, connected: false, mode: null, equity: null } : null;
    const creds = await alpacaCredsForUser(user.id);
    if (creds) {
        try {
            const account = await getAccount(creds);
            alpaca = { configured, connected: true, mode: creds.paper ? "paper" : "live", equity: account.equity };
        } catch {
            alpaca = { configured, connected: true, mode: creds.paper ? "paper" : "live", equity: null };
        }
    }

    const hasData =
        accounts.length > 0 || cards.length > 0 || debts.length > 0 || brokerage.length > 0 || Boolean(alpaca?.connected);

    return {
        hasData,
        netWorth,
        assets,
        liabilities,
        cash,
        investments: brokerageAssets + legacyBrokerage,
        cardDebt,
        alpaca,
    };
}
