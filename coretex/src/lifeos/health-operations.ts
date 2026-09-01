import { prisma } from "../db/prisma.js";
import * as base from "./health.js";
import {
  deleteProgressPhoto as deleteWorkoutProgressPhoto,
  updateProgressPhoto as updateWorkoutProgressPhoto,
  uploadProgressPhoto as uploadWorkoutProgressPhoto,
} from "./workouts.js";

const DAY_MS = 86_400_000;
const KG_PER_LB = 0.45359237;
const CM_PER_INCH = 2.54;
const MG_DL_PER_MMOL_L_GLUCOSE = 18.0182;

type Payload = Record<string, unknown> | undefined;

function payload(raw: Payload): Record<string, unknown> {
  if (!raw || Array.isArray(raw)) throw new Error("A mutation payload is required.");
  return raw;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function text(value: unknown, label: string, max = 200, required = false): string | null {
  if (value == null || value === "") {
    if (required) throw new Error(`${label} is required.`);
    return null;
  }
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const result = value.trim();
  if (!result && required) throw new Error(`${label} is required.`);
  if (result.length > max) throw new Error(`${label} must be ${max} characters or fewer.`);
  return result || null;
}

function id(value: unknown, label = "id"): string {
  return text(value, label, 200, true) as string;
}

function numberValue(
  value: unknown,
  label: string,
  options: { required?: boolean; min?: number; max?: number; integer?: boolean } = {},
): number | null {
  if (value == null || value === "") {
    if (options.required) throw new Error(`${label} is required.`);
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a number.`);
  if (options.integer && !Number.isInteger(parsed)) throw new Error(`${label} must be a whole number.`);
  if (options.min != null && parsed < options.min) throw new Error(`${label} must be at least ${options.min}.`);
  if (options.max != null && parsed > options.max) throw new Error(`${label} must be at most ${options.max}.`);
  return parsed;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  if (value == null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new Error("The boolean value is invalid.");
}

function round(value: number, precision = 1): number {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}

function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function utcToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

function strictDay(value: unknown, label = "date"): Date {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must use YYYY-MM-DD format.`);
  }
  const result = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(result.getTime()) || isoDay(result) !== value) throw new Error(`${label} is invalid.`);
  return result;
}

function dateTime(value: unknown, label: string, fallback?: Date): Date {
  if (value == null || value === "") {
    if (fallback) return fallback;
    throw new Error(`${label} is required.`);
  }
  const result = new Date(String(value));
  if (Number.isNaN(result.getTime())) throw new Error(`${label} is invalid.`);
  return result;
}

function addDays(value: Date, amount: number): Date {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + amount);
  return result;
}

function daysBetween(start: Date, end: Date): number {
  return Math.floor((end.getTime() - start.getTime()) / DAY_MS);
}

function normalizeUnit(unit: string | null | undefined): string {
  return (unit ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeMetric(metricType: string, value: number, unit?: string | null) {
  const normalized = normalizeUnit(unit);
  if (metricType === "weight") {
    const kg = ["lb", "lbs", "pound", "pounds"].includes(normalized) ? value * KG_PER_LB : value;
    return { value: round(kg, 4), unit: "kg" };
  }
  if (metricType === "waist") {
    const cm = ["in", "inch", "inches"].includes(normalized) ? value * CM_PER_INCH : value;
    return { value: round(cm, 3), unit: "cm" };
  }
  if (metricType === "body_fat_pct") return { value, unit: "%" };
  if (metricType === "bmi") return { value, unit: "kg/m²" };
  if (metricType === "resting_heart_rate") return { value, unit: "bpm" };
  return { value, unit: unit?.trim() || null };
}

function normalizeVital(vitalType: string, value: number | null, unit?: string | null) {
  if (value == null) return { value, unit: unit?.trim() || null };
  const normalized = normalizeUnit(unit);
  if (vitalType === "temperature") {
    const celsius = ["f", "°f", "fahrenheit"].includes(normalized) ? (value - 32) * (5 / 9) : value;
    return { value: round(celsius, 2), unit: "°C" };
  }
  if (vitalType === "blood_glucose") {
    const mgDl = ["mmol/l", "mmol l", "mmol"].includes(normalized) ? value * MG_DL_PER_MMOL_L_GLUCOSE : value;
    return { value: round(mgDl, 2), unit: "mg/dL" };
  }
  if (vitalType === "blood_pressure") return { value, unit: "mmHg" };
  if (vitalType === "heart_rate") return { value, unit: "bpm" };
  if (vitalType === "spo2") return { value, unit: "%" };
  if (vitalType === "respiratory_rate") return { value, unit: "breaths/min" };
  return { value, unit: unit?.trim() || null };
}

function groupSeries<T extends { measuredAt: string; value: number | null; value2?: number | null }>(
  rows: T[],
  typeFor: (row: T) => string,
) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const type = typeFor(row);
    const values = groups.get(type) ?? [];
    values.push(row);
    groups.set(type, values);
  }
  return Array.from(groups.entries()).map(([type, values]) => ({
    type,
    points: [...values]
      .reverse()
      .map((row) => ({ date: row.measuredAt, value: row.value, value2: row.value2 ?? null })),
  }));
}

export async function getGoals(userId: string) {
  const [
    result,
    latestWeightMetric,
    latestBodyFatMetric,
    latestWeightMeasurement,
    latestBodyFatMeasurement,
  ] = await Promise.all([
      base.getGoals(userId),
      prisma.bodyMetric.findFirst({
        where: { userId, metricType: "weight" },
        orderBy: { measuredAt: "desc" },
        select: { value: true, unit: true, measuredAt: true },
      }),
      prisma.bodyMetric.findFirst({
        where: { userId, metricType: "body_fat_pct" },
        orderBy: { measuredAt: "desc" },
        select: { value: true, measuredAt: true },
      }),
      prisma.bodyMeasurement.findFirst({
        where: { userId, weightKg: { not: null } },
        orderBy: { date: "desc" },
        select: { date: true, weightKg: true },
      }),
      prisma.bodyMeasurement.findFirst({
        where: { userId, bodyFatPct: { not: null } },
        orderBy: { date: "desc" },
        select: { date: true, bodyFatPct: true },
      }),
    ]);
  const metricWeight = latestWeightMetric
    ? normalizeMetric("weight", latestWeightMetric.value, latestWeightMetric.unit)
        .value
    : null;
  const weightFromMeasurementIsNewest =
    latestWeightMeasurement?.weightKg != null &&
    (!latestWeightMetric ||
      latestWeightMeasurement.date.getTime() >=
        latestWeightMetric.measuredAt.getTime());
  const bodyFatFromMeasurementIsNewest =
    latestBodyFatMeasurement?.bodyFatPct != null &&
    (!latestBodyFatMetric ||
      latestBodyFatMeasurement.date.getTime() >=
        latestBodyFatMetric.measuredAt.getTime());
  const currentWeight = weightFromMeasurementIsNewest
    ? (latestWeightMeasurement?.weightKg ?? null)
    : metricWeight;
  const currentBodyFat = bodyFatFromMeasurementIsNewest
    ? (latestBodyFatMeasurement?.bodyFatPct ?? null)
    : (latestBodyFatMetric?.value ?? null);
  const goalWeight = result.profile?.goalWeightKg ?? null;
  const targetChange = result.profile?.targetWeeklyChangeKg ?? null;
  const remainingKg =
    currentWeight != null && goalWeight != null
      ? round(goalWeight - currentWeight, 2)
      : null;
  const projectedWeeks =
    remainingKg != null && targetChange != null && targetChange !== 0
      ? Math.max(0, round(Math.abs(remainingKg / targetChange), 1))
      : null;
  return {
    ...result,
    profile: result.profile
      ? {
          ...result.profile,
          birthdate: result.profile.birthdate?.slice(0, 10) ?? null,
          goalTargetDate: result.profile.goalTargetDate?.slice(0, 10) ?? null,
        }
      : null,
    current: {
      weightKg: currentWeight,
      bodyFatPct: currentBodyFat,
      bmi:
        currentWeight != null && result.profile?.heightCm
          ? round(currentWeight / (result.profile.heightCm / 100) ** 2, 1)
          : null,
      measuredAt:
        (weightFromMeasurementIsNewest && latestWeightMeasurement
          ? isoDay(latestWeightMeasurement.date)
          : latestWeightMetric?.measuredAt.toISOString()) ?? null,
    },
    progress: {
      remainingKg,
      projectedWeeks,
      direction:
        remainingKg == null
          ? null
          : remainingKg > 0
            ? "GAIN"
            : remainingKg < 0
              ? "LOSE"
              : "MAINTAIN",
    },
  };
}

export async function getMetrics(userId: string) {
  const [result, measurements] = await Promise.all([
    base.getMetrics(userId),
    prisma.bodyMeasurement.findMany({
      where: { userId },
      orderBy: { date: "desc" },
      take: 500,
      select: { date: true, weightKg: true, bodyFatPct: true },
    }),
  ]);
  const metrics = result.metrics.map((metric) => {
    const normalized = normalizeMetric(metric.metricType, metric.value, metric.unit);
    return { ...metric, ...normalized, sourceUnit: metric.unit };
  });
  const weightByDay = new Map<
    string,
    {
      kg: number;
      source: "body_measurement" | "health_metric";
      recordedAt: number;
    }
  >();
  for (const metric of metrics) {
    if (metric.metricType !== "weight") continue;
    weightByDay.set(isoDay(new Date(metric.measuredAt)), {
      kg: metric.value,
      source: "health_metric",
      recordedAt: new Date(metric.measuredAt).getTime(),
    });
  }
  for (const measurement of measurements) {
    if (measurement.weightKg != null) {
      const day = isoDay(measurement.date);
      const existing = weightByDay.get(day);
      if (!existing || measurement.date.getTime() >= existing.recordedAt) {
        weightByDay.set(day, {
          kg: measurement.weightKg,
          source: "body_measurement",
          recordedAt: measurement.date.getTime(),
        });
      }
    }
  }
  const weightSeries = Array.from(weightByDay.entries())
    .map(([day, value]) => ({ day, kg: value.kg, source: value.source }))
    .sort((left, right) => left.day.localeCompare(right.day));
  const latestByType = new Map<string, (typeof metrics)[number]>();
  for (const metric of metrics) {
    const type = metric.metricType === "custom" ? metric.customName || "custom" : metric.metricType;
    if (!latestByType.has(type)) latestByType.set(type, metric);
  }
  const bodyFatSeries = [
    ...measurements
      .filter((measurement) => measurement.bodyFatPct != null)
      .map((measurement) => ({
        measuredAt: isoDay(measurement.date),
        value: measurement.bodyFatPct as number,
        value2: null,
        source: "body_measurement" as const,
      })),
    ...metrics
      .filter((metric) => metric.metricType === "body_fat_pct")
      .map((metric) => ({
        measuredAt: metric.measuredAt,
        value: metric.value,
        value2: null,
        source: "health_metric" as const,
      })),
  ].sort((left, right) => left.measuredAt.localeCompare(right.measuredAt));
  const latestWeight = weightSeries.at(-1)?.kg ?? null;
  const firstRecentWeight = weightSeries.find(
    (point) => new Date(point.day).getTime() >= Date.now() - 30 * DAY_MS,
  )?.kg ?? null;
  return {
    ...result,
    metrics,
    latestByType: Array.from(latestByType.entries()).map(([type, metric]) => ({ type, ...metric })),
    weightSeries,
    bodyFatSeries,
    girthDate: result.girthDate?.slice(0, 10) ?? null,
    series: groupSeries(metrics, (metric) =>
      metric.metricType === "custom" ? metric.customName || "custom" : metric.metricType,
    ),
    summary: {
      ...result.summary,
      latestWeightKg: latestWeight,
      latestBodyFatPct: bodyFatSeries.at(-1)?.value ?? null,
      weightChange30dKg:
        latestWeight != null && firstRecentWeight != null
          ? round(latestWeight - firstRecentWeight, 2)
          : null,
    },
  };
}

export async function getVitals(userId: string) {
  const [result, settings] = await Promise.all([
    base.getVitals(userId),
    prisma.settings.findUnique({
      where: { userId },
      select: { unitSystem: true },
    }),
  ]);
  const vitals = result.vitals.map((vital) => {
    const primary = normalizeVital(vital.vitalType, vital.value, vital.unit);
    return { ...vital, ...primary, sourceUnit: vital.unit };
  });
  const latestByType = new Map<string, (typeof vitals)[number]>();
  for (const vital of vitals) {
    const type = vital.vitalType === "custom" ? vital.customName || "custom" : vital.vitalType;
    if (!latestByType.has(type)) latestByType.set(type, vital);
  }
  return {
    ...result,
    unitSystem: settings?.unitSystem ?? "IMPERIAL",
    vitals,
    latestByType: Array.from(latestByType.entries()).map(([type, reading]) => ({ type, ...reading })),
    series: groupSeries(vitals, (vital) =>
      vital.vitalType === "custom" ? vital.customName || "custom" : vital.vitalType,
    ),
  };
}

export async function getSleep(userId: string) {
  const result = await base.getSleep(userId);
  const trend = [...result.entries].reverse().map((entry) => ({
    date: entry.date,
    hours: entry.totalMinutes == null ? null : round(entry.totalMinutes / 60, 2),
    quality: entry.sleepQuality,
    rested: entry.feelRested,
    latencyMin: entry.sleepLatencyMin,
    restingHrBpm: entry.restingHrBpm,
    hrvMs: entry.hrvMs,
    interruptions: entry.interruptions.length,
    interruptionMinutes: entry.interruptions.reduce(
      (total, interruption) => total + (interruption.durationMinutes ?? 0),
      0,
    ),
  }));
  const weeks = new Map<string, typeof trend>();
  for (const point of trend) {
    const date = new Date(`${point.date}T00:00:00.000Z`);
    const weekStart = addDays(date, -((date.getUTCDay() + 6) % 7));
    const key = isoDay(weekStart);
    const points = weeks.get(key) ?? [];
    points.push(point);
    weeks.set(key, points);
  }
  return {
    ...result,
    trend,
    weeklyTrend: Array.from(weeks.entries()).map(([weekStart, points]) => ({
      weekStart,
      averageHours: averageNumber(points.map((point) => point.hours), 2),
      averageQuality: averageNumber(points.map((point) => point.quality), 1),
      nightsLogged: points.length,
    })),
  };
}

function averageNumber(values: Array<number | null | undefined>, precision = 1): number | null {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!finite.length) return null;
  return round(finite.reduce((total, value) => total + value, 0) / finite.length, precision);
}

function streaksForDates(dates: string[], today: string) {
  const unique = Array.from(new Set(dates)).sort();
  let best = 0;
  let run = 0;
  let previous: Date | null = null;
  for (const day of unique) {
    const current = new Date(`${day}T00:00:00.000Z`);
    run = previous && daysBetween(previous, current) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    previous = current;
  }
  const completed = new Set(unique);
  let current = 0;
  for (let cursor = new Date(`${today}T00:00:00.000Z`); ; cursor = addDays(cursor, -1)) {
    if (!completed.has(isoDay(cursor))) break;
    current += 1;
  }
  return { current, best };
}

export async function getHabits(userId: string) {
  const result = await base.getHabits(userId);
  const start = addDays(utcToday(), -27);
  const days = Array.from({ length: 28 }, (_, index) => isoDay(addDays(start, index)));
  const habits = result.habits.map((habit) => {
    const completedDates = habit.logs
      .filter((log) => log.count >= (habit.targetCount ?? 1))
      .map((log) => log.date);
    const streaks = streaksForDates(completedDates, result.date);
    const recentCompletions = completedDates.filter(
      (date) => date >= isoDay(addDays(utcToday(), -29)),
    ).length;
    return {
      ...habit,
      logDates: completedDates,
      completedToday: completedDates.includes(result.date),
      streaks,
      completionRate30d: round((recentCompletions / 30) * 100, 0),
    };
  });
  const active = habits.filter((habit) => habit.active);
  const trend = days.map((date) => {
    const completed = active.filter((habit) => habit.logDates.includes(date)).length;
    return {
      date,
      completed,
      total: active.length,
      completionRate: active.length ? round((completed / active.length) * 100, 0) : 0,
    };
  });
  const completedToday = active.filter((habit) => habit.completedToday).length;
  return {
    ...result,
    habits,
    trend,
    summary: {
      ...result.summary,
      completedToday,
      completionRateToday: active.length
        ? round((completedToday / active.length) * 100, 0)
        : 0,
    },
  };
}

export async function getJournal(userId: string) {
  const result = await base.getJournal(userId);
  return {
    ...result,
    trend: [...result.entries].reverse().map((entry) => ({
      date: entry.date,
      rating: entry.overallRating,
      realms: Object.fromEntries(entry.realmRatings.map((rating) => [rating.realm, rating.rating])),
    })),
  };
}

export async function getMedical(userId: string) {
  const [result, recordLinks] = await Promise.all([
    base.getMedical(userId),
    prisma.medicalRecord.findMany({
      where: { userId },
      select: { id: true, eventId: true },
    }),
  ]);
  const eventIdByRecord = new Map(
    recordLinks.map((record) => [record.id, record.eventId]),
  );
  const now = Date.now();
  const upcomingAppointments = result.appointments
    .filter((appointment) => new Date(appointment.startsAt).getTime() >= now)
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt));
  return {
    ...result,
    records: result.records.map((record) => ({
      ...record,
      eventId: eventIdByRecord.get(record.id) ?? null,
    })),
    upcomingAppointments,
    summary: {
      ...result.summary,
      appointments: result.appointments.length,
      upcomingAppointments: upcomingAppointments.length,
      nextAppointmentAt: upcomingAppointments[0]?.startsAt ?? null,
    },
  };
}

export async function getPhotos(userId: string) {
  const result = await base.getPhotos(userId);
  return {
    ...result,
    timeline: [...result.photos].reverse().map((photo) => ({
      id: photo.id,
      date: photo.takenAt,
      angle: photo.angle,
      phase: photo.phase,
      weightKg: photo.weightKg,
      thumbnailUrl: photo.url,
    })),
    weightSeries: [...result.photos]
      .reverse()
      .filter((photo) => photo.weightKg != null)
      .map((photo) => ({ date: photo.takenAt, weightKg: photo.weightKg as number })),
  };
}

export async function getSobriety(userId: string) {
  const result = await base.getSobriety(userId);
  const since = isoDay(addDays(utcToday(), -29));
  const byDay = new Map<string, { count: number; amount: number }>();
  for (const log of result.substanceLogs) {
    const day = log.loggedAt.slice(0, 10);
    if (day < since) continue;
    const current = byDay.get(day) ?? { count: 0, amount: 0 };
    current.count += 1;
    current.amount += log.amount ?? 0;
    byDay.set(day, current);
  }
  return {
    ...result,
    substanceTrend: Array.from({ length: 30 }, (_, index) => {
      const date = isoDay(addDays(utcToday(), index - 29));
      const value = byDay.get(date) ?? { count: 0, amount: 0 };
      return { date, count: value.count, amount: round(value.amount, 2) };
    }),
  };
}

export async function getPeptides(userId: string) {
  const result = await base.getPeptides(userId);
  const doseSeries = result.peptides.flatMap((peptide) =>
    [...peptide.logs].reverse().map((log) => ({
      id: log.id,
      peptideId: peptide.id,
      name: peptide.name,
      date: log.date,
      dose: log.dose,
      unit: peptide.doseUnit,
      site: log.site,
    })),
  ).sort((left, right) => left.date.localeCompare(right.date));
  return {
    ...result,
    doseSeries,
    summary: {
      ...result.summary,
      dosesLast30Days: doseSeries.filter((dose) => dose.date >= isoDay(addDays(utcToday(), -29))).length,
      lowInventory: result.peptides.filter((peptide) => peptide.activeVialRemainingMl <= Math.max(0.25, peptide.waterMl * 0.1)).length,
    },
  };
}

export async function getOverview(userId: string) {
  const [result, metrics, measurements, latestVitals, profile] = await Promise.all([
    base.getOverview(userId),
    prisma.bodyMetric.findMany({
      where: { userId, metricType: "weight" },
      orderBy: { measuredAt: "asc" },
      take: 365,
      select: { value: true, unit: true, measuredAt: true },
    }),
    prisma.bodyMeasurement.findMany({
      where: { userId, weightKg: { not: null } },
      orderBy: { date: "asc" },
      take: 365,
      select: { date: true, weightKg: true },
    }),
    prisma.vitalReading.findMany({
      where: { userId },
      orderBy: { measuredAt: "desc" },
      take: 100,
      select: { id: true, vitalType: true, customName: true, value: true, value2: true, unit: true, measuredAt: true },
    }),
    prisma.userProfile.findUnique({
      where: { userId },
      select: { goalWeightKg: true },
    }),
  ]);
  const weightByDay = new Map<string, { valueKg: number; measuredAt: string; source: string; sourceUnit: string | null }>();
  for (const metric of metrics) {
    const normalized = normalizeMetric("weight", metric.value, metric.unit);
    weightByDay.set(isoDay(metric.measuredAt), {
      valueKg: normalized.value,
      measuredAt: metric.measuredAt.toISOString(),
      source: "health_metric",
      sourceUnit: metric.unit,
    });
  }
  for (const measurement of measurements) {
    if (measurement.weightKg == null) continue;
    const day = isoDay(measurement.date);
    const existing = weightByDay.get(day);
    if (existing && existing.measuredAt > isoDay(measurement.date)) continue;
    weightByDay.set(day, {
      valueKg: measurement.weightKg,
      measuredAt: isoDay(measurement.date),
      source: "body_measurement",
      sourceUnit: "kg",
    });
  }
  const weight = Array.from(weightByDay.entries())
    .map(([date, point]) => ({ date, ...point }))
    .sort((left, right) => left.date.localeCompare(right.date));
  const vitalTypes = new Set<string>();
  const vitals = latestVitals.flatMap((vital) => {
    const type = vital.vitalType === "custom" ? vital.customName || "custom" : vital.vitalType;
    if (vitalTypes.has(type)) return [];
    vitalTypes.add(type);
    const normalized = normalizeVital(vital.vitalType, vital.value, vital.unit);
    return [{
      id: vital.id,
      type,
      value: normalized.value,
      value2: vital.value2,
      unit: normalized.unit,
      measuredAt: vital.measuredAt.toISOString(),
    }];
  });
  const latest = weight.at(-1) ?? null;
  return {
    ...result,
    latestWeight: latest
      ? {
          valueKg: latest.valueKg,
          sourceUnit: latest.sourceUnit,
          source: latest.source,
          measuredAt: latest.measuredAt,
          goalWeightKg: profile?.goalWeightKg ?? null,
        }
      : null,
    latestVitals: vitals,
    trends: {
      ...result.trends,
      weight: weight.map((point) => ({
        date: point.date,
        valueKg: point.valueKg,
        source: point.source,
      })),
    },
    summary: {
      weightChange30dKg:
        latest == null
          ? null
          : (() => {
              const start = weight.find((point) => point.date >= isoDay(addDays(utcToday(), -30)));
              return start ? round(latest.valueKg - start.valueKg, 2) : null;
            })(),
      sleepAverageHours30d: averageNumber(result.trends.sleep.map((point) => point.hours), 2),
      habitCompletionRate: result.habits.total
        ? round((result.habits.completed / result.habits.total) * 100, 0)
        : 0,
      waterProgress: result.water.goalMl
        ? round((result.water.amountMl / result.water.goalMl) * 100, 0)
        : 0,
    },
  };
}

const ACTIVITY_LEVELS = new Set(["SEDENTARY", "LIGHT", "MODERATE", "VERY_ACTIVE", "EXTREME"]);
const DIET_GOALS = new Set(["LOSE", "MAINTAIN", "GAIN", "lose", "maintain", "gain"]);

export async function updateGoals(userId: string, raw: Payload) {
  const input = payload(raw);
  const profileData: Record<string, unknown> = {};
  if (hasOwn(input, "gender")) profileData.gender = text(input.gender, "gender", 50);
  if (hasOwn(input, "birthdate")) {
    profileData.birthdate = input.birthdate == null || input.birthdate === ""
      ? null
      : strictDay(input.birthdate, "birthdate");
  }
  if (hasOwn(input, "heightCm")) profileData.heightCm = numberValue(input.heightCm, "heightCm", { min: 50, max: 300 });
  if (hasOwn(input, "activityLevel")) {
    const value = text(input.activityLevel, "activityLevel", 50);
    if (value && !ACTIVITY_LEVELS.has(value.toUpperCase())) throw new Error("activityLevel is invalid.");
    profileData.activityLevel = value?.toUpperCase() ?? null;
  }
  if (hasOwn(input, "dietGoal")) {
    const value = text(input.dietGoal, "dietGoal", 50);
    if (value && !DIET_GOALS.has(value)) throw new Error("dietGoal is invalid.");
    profileData.dietGoal = value?.toUpperCase() ?? null;
  }
  if (hasOwn(input, "targetWeeklyChangeKg")) {
    profileData.targetWeeklyChangeKg = numberValue(input.targetWeeklyChangeKg, "targetWeeklyChangeKg", { min: -5, max: 5 });
  }
  if (hasOwn(input, "goalWeightKg")) profileData.goalWeightKg = numberValue(input.goalWeightKg, "goalWeightKg", { min: 20, max: 1_000 });
  if (hasOwn(input, "goalBodyFatPct")) profileData.goalBodyFatPct = numberValue(input.goalBodyFatPct, "goalBodyFatPct", { min: 1, max: 80 });
  if (hasOwn(input, "goalTargetDate")) {
    profileData.goalTargetDate = input.goalTargetDate == null || input.goalTargetDate === ""
      ? null
      : strictDay(input.goalTargetDate, "goalTargetDate");
  }
  if (hasOwn(input, "waterGoalMl")) profileData.waterGoalMl = numberValue(input.waterGoalMl, "waterGoalMl", { min: 0, max: 20_000, integer: true });

  const macroData: Record<string, number | null> = {};
  for (const [key, maximum] of [
    ["calories", 20_000],
    ["proteinG", 2_000],
    ["carbsG", 5_000],
    ["fatG", 2_000],
    ["fiberG", 1_000],
  ] as const) {
    if (hasOwn(input, key)) macroData[key] = numberValue(input[key], key, { min: 0, max: maximum });
  }
  const unitSystem = hasOwn(input, "unitSystem")
    ? String(input.unitSystem).toUpperCase()
    : null;
  if (unitSystem && unitSystem !== "IMPERIAL" && unitSystem !== "METRIC") throw new Error("unitSystem is invalid.");

  await prisma.$transaction(async (tx) => {
    if (Object.keys(profileData).length) {
      await tx.userProfile.upsert({
        where: { userId },
        create: { userId, ...(profileData as any) },
        update: profileData as any,
      });
    }
    if (Object.keys(macroData).length) {
      await tx.nutritionGoal.upsert({
        where: { userId },
        create: { userId, ...macroData },
        update: macroData,
      });
    }
    if (unitSystem) {
      await tx.settings.upsert({
        where: { userId },
        create: { userId, unitSystem: unitSystem as "IMPERIAL" | "METRIC" },
        update: { unitSystem: unitSystem as "IMPERIAL" | "METRIC" },
      });
    }
  });
  return { ok: true, goals: await getGoals(userId) };
}

const METRIC_TYPES = new Set(["weight", "body_fat_pct", "bmi", "waist", "resting_heart_rate", "custom"]);

function metricValues(input: Record<string, unknown>) {
  const metricType = (text(input.metricType, "metricType", 50, true) as string).toLowerCase();
  if (!METRIC_TYPES.has(metricType)) throw new Error("Unsupported metric type.");
  const customName = text(input.customName, "customName", 100);
  if (metricType === "custom" && !customName) throw new Error("customName is required for a custom metric.");
  const rawValue = numberValue(input.value, "value", { required: true, min: -100_000, max: 100_000 }) as number;
  const normalized = normalizeMetric(metricType, rawValue, text(input.unit, "unit", 30));
  const measuredAt = input.measuredAt ? dateTime(input.measuredAt, "measuredAt") : new Date();
  return {
    metricType,
    customName: metricType === "custom" ? customName : null,
    value: normalized.value,
    unit: normalized.unit,
    measuredAt,
    notes: text(input.notes, "notes", 4_000),
  };
}

export async function createMetric(userId: string, raw: Payload) {
  const metric = await prisma.bodyMetric.create({ data: { userId, ...metricValues(payload(raw)) } });
  return { ok: true, id: metric.id, metric: { ...metric, measuredAt: metric.measuredAt.toISOString() } };
}

export async function updateMetric(userId: string, raw: Payload) {
  const input = payload(raw);
  const metricId = id(input.id ?? input.metricId, "Metric id");
  const owned = await prisma.bodyMetric.findFirst({ where: { id: metricId, userId }, select: { id: true } });
  if (!owned) throw new Error("Metric not found.");
  const metric = await prisma.bodyMetric.update({ where: { id: metricId }, data: metricValues(input) });
  return { ok: true, id: metric.id, metric: { ...metric, measuredAt: metric.measuredAt.toISOString() } };
}

export async function deleteMetric(userId: string, raw: Payload) {
  const metricId = id(payload(raw).id ?? payload(raw).metricId, "Metric id");
  const result = await prisma.bodyMetric.deleteMany({ where: { id: metricId, userId } });
  if (!result.count) throw new Error("Metric not found.");
  return { id: metricId, deleted: true };
}

const VITAL_TYPES = new Set(["blood_pressure", "heart_rate", "temperature", "spo2", "respiratory_rate", "blood_glucose", "custom"]);

function vitalFields(raw: unknown) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new Error("fields must be a list.");
  return raw.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`fields[${index}] is invalid.`);
    const field = item as Record<string, unknown>;
    return {
      label: text(field.label, `fields[${index}].label`, 100, true) as string,
      value: numberValue(field.value, `fields[${index}].value`, { required: true, min: -100_000, max: 100_000 }) as number,
      unit: text(field.unit, `fields[${index}].unit`, 30),
      position: index,
    };
  });
}

function vitalValues(input: Record<string, unknown>) {
  const vitalType = (text(input.vitalType, "vitalType", 50, true) as string).toLowerCase();
  if (!VITAL_TYPES.has(vitalType)) throw new Error("Unsupported vital type.");
  const customName = text(input.customName, "customName", 100);
  if (vitalType === "custom" && !customName) throw new Error("customName is required for a custom vital.");
  const rawPrimary = numberValue(input.value, "value", { min: -10_000, max: 100_000 });
  const value2 = numberValue(input.value2, "value2", { min: -10_000, max: 100_000 });
  const fields = vitalFields(input.fields);
  if (rawPrimary == null && value2 == null && fields.length === 0) throw new Error("A vital value is required.");
  const sourceUnit = text(input.unit, "unit", 30);
  const normalized = normalizeVital(vitalType, rawPrimary, sourceUnit);
  const normalizedSecondary = normalizeVital(vitalType, value2, sourceUnit);
  return {
    data: {
      vitalType,
      customName: vitalType === "custom" ? customName : null,
      value: normalized.value,
      value2: normalizedSecondary.value,
      unit: normalized.unit,
      measuredAt: input.measuredAt ? dateTime(input.measuredAt, "measuredAt") : new Date(),
      notes: text(input.notes, "notes", 4_000),
    },
    fields,
  };
}

export async function createVital(userId: string, raw: Payload) {
  const values = vitalValues(payload(raw));
  const vital = await prisma.vitalReading.create({
    data: { userId, ...values.data, fields: values.fields.length ? { create: values.fields } : undefined },
  });
  return { ok: true, id: vital.id, vital: { ...vital, measuredAt: vital.measuredAt.toISOString() } };
}

export async function updateVital(userId: string, raw: Payload) {
  const input = payload(raw);
  const vitalId = id(input.id ?? input.vitalId, "Vital id");
  const owned = await prisma.vitalReading.findFirst({ where: { id: vitalId, userId }, select: { id: true } });
  if (!owned) throw new Error("Vital reading not found.");
  const values = vitalValues(input);
  const vital = await prisma.$transaction(async (tx) => {
    await tx.vitalReadingField.deleteMany({ where: { readingId: vitalId } });
    return tx.vitalReading.update({
      where: { id: vitalId },
      data: { ...values.data, fields: values.fields.length ? { create: values.fields } : undefined },
    });
  });
  return { ok: true, id: vital.id, vital: { ...vital, measuredAt: vital.measuredAt.toISOString() } };
}

export async function deleteVital(userId: string, raw: Payload) {
  const input = payload(raw);
  const vitalId = id(input.id ?? input.vitalId, "Vital id");
  const result = await prisma.vitalReading.deleteMany({ where: { id: vitalId, userId } });
  if (!result.count) throw new Error("Vital reading not found.");
  return { id: vitalId, deleted: true };
}

function sleepInterruptions(raw: unknown) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new Error("interruptions must be a list.");
  return raw.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`interruptions[${index}] is invalid.`);
    const interruption = item as Record<string, unknown>;
    return {
      time: interruption.time ? dateTime(interruption.time, `interruptions[${index}].time`) : null,
      durationMinutes: numberValue(interruption.durationMinutes, `interruptions[${index}].durationMinutes`, { min: 0, max: 1_440, integer: true }),
      reason: text(interruption.reason, `interruptions[${index}].reason`, 200),
      notes: text(interruption.notes, `interruptions[${index}].notes`, 1_000),
    };
  });
}

export async function upsertSleep(userId: string, raw: Payload) {
  const input = payload(raw);
  const date = strictDay(input.date);
  const existing = await prisma.sleepEntry.findUnique({
    where: { userId_date: { userId, date } },
    select: {
      bedtime: true,
      wakeTime: true,
      totalMinutes: true,
      sleepQuality: true,
      feelRested: true,
      sleepLatencyMin: true,
      restingHrBpm: true,
      hrvMs: true,
      notes: true,
    },
  });
  const bedtime = hasOwn(input, "bedtime")
    ? input.bedtime
      ? dateTime(input.bedtime, "bedtime")
      : null
    : (existing?.bedtime ?? null);
  const wakeTime = hasOwn(input, "wakeTime")
    ? input.wakeTime
      ? dateTime(input.wakeTime, "wakeTime")
      : null
    : (existing?.wakeTime ?? null);
  if (bedtime && wakeTime && wakeTime <= bedtime) throw new Error("wakeTime must be after bedtime.");
  const timingChanged = hasOwn(input, "bedtime") || hasOwn(input, "wakeTime");
  const totalMinutes = hasOwn(input, "totalMinutes")
    ? numberValue(input.totalMinutes, "totalMinutes", {
        min: 0,
        max: 1_440,
        integer: true,
      })
    : timingChanged && bedtime && wakeTime
      ? Math.min(
          1_440,
          Math.round((wakeTime.getTime() - bedtime.getTime()) / 60_000),
        )
      : (existing?.totalMinutes ?? null);
  const data = {
    bedtime,
    wakeTime,
    totalMinutes,
    sleepQuality: hasOwn(input, "sleepQuality")
      ? numberValue(input.sleepQuality, "sleepQuality", {
          min: 1,
          max: 5,
          integer: true,
        })
      : (existing?.sleepQuality ?? null),
    feelRested: hasOwn(input, "feelRested")
      ? numberValue(input.feelRested, "feelRested", {
          min: 1,
          max: 5,
          integer: true,
        })
      : (existing?.feelRested ?? null),
    sleepLatencyMin: hasOwn(input, "sleepLatencyMin")
      ? numberValue(input.sleepLatencyMin, "sleepLatencyMin", {
          min: 0,
          max: 600,
          integer: true,
        })
      : (existing?.sleepLatencyMin ?? null),
    restingHrBpm: hasOwn(input, "restingHrBpm")
      ? numberValue(input.restingHrBpm, "restingHrBpm", {
          min: 20,
          max: 300,
          integer: true,
        })
      : (existing?.restingHrBpm ?? null),
    hrvMs: hasOwn(input, "hrvMs")
      ? numberValue(input.hrvMs, "hrvMs", {
          min: 0,
          max: 1_000,
          integer: true,
        })
      : (existing?.hrvMs ?? null),
    notes: hasOwn(input, "notes")
      ? text(input.notes, "notes", 4_000)
      : (existing?.notes ?? null),
  };
  const surveyResponses =
    input.surveyResponses && typeof input.surveyResponses === "object"
      ? (input.surveyResponses as any)
      : undefined;
  const interruptions = sleepInterruptions(input.interruptions);
  const sleep = await prisma.sleepEntry.upsert({
    where: { userId_date: { userId, date } },
    create: {
      userId,
      date,
      ...data,
      surveyResponses,
      interruptions: interruptions.length
        ? { create: interruptions }
        : undefined,
    },
    update: {
      ...data,
      ...(hasOwn(input, "surveyResponses") && surveyResponses
        ? { surveyResponses }
        : {}),
      ...(hasOwn(input, "interruptions")
        ? {
            interruptions: {
              deleteMany: {},
              ...(interruptions.length ? { create: interruptions } : {}),
            },
          }
        : {}),
    },
  });
  return { ok: true, id: sleep.id, sleep: { ...sleep, date: isoDay(sleep.date) } };
}

export async function deleteSleep(userId: string, raw: Payload) {
  const input = payload(raw);
  const sleepId = text(input.id ?? input.sleepId, "Sleep entry id", 200);
  const date = input.date ? strictDay(input.date) : null;
  if (!sleepId && !date) throw new Error("Sleep entry id or date is required.");
  const result = await prisma.sleepEntry.deleteMany({ where: { userId, ...(sleepId ? { id: sleepId } : { date: date as Date }) } });
  if (!result.count) throw new Error("Sleep entry not found.");
  return { id: sleepId, date: date ? isoDay(date) : null, deleted: true };
}

const HABIT_FREQUENCIES = new Set(["daily", "weekly", "custom"]);
const WEEKDAYS = new Set(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]);

async function habitValues(userId: string, input: Record<string, unknown>, currentId?: string) {
  const frequency = (text(input.frequency, "frequency", 20) ?? "daily").toLowerCase();
  if (!HABIT_FREQUENCIES.has(frequency)) throw new Error("frequency is invalid.");
  const habitType = (text(input.habitType, "habitType", 20) ?? "good").toLowerCase();
  if (habitType !== "good" && habitType !== "bad") throw new Error("habitType is invalid.");
  const daysOfWeek = Array.isArray(input.daysOfWeek)
    ? Array.from(new Set(input.daysOfWeek.map((day) => String(day).toUpperCase())))
    : [];
  if (daysOfWeek.some((day) => !WEEKDAYS.has(day))) throw new Error("daysOfWeek contains an invalid weekday.");
  const stackAfterHabitId = text(input.stackAfterHabitId, "stackAfterHabitId", 200);
  if (stackAfterHabitId) {
    if (stackAfterHabitId === currentId) throw new Error("A habit cannot be stacked after itself.");
    const parent = await prisma.habit.findFirst({ where: { id: stackAfterHabitId, userId }, select: { id: true } });
    if (!parent) throw new Error("The selected stacked habit was not found.");
  }
  const color = text(input.color, "color", 30);
  if (color && !/^#[0-9a-f]{6}$/i.test(color)) throw new Error("color must be a six-digit hex color.");
  return {
    name: text(input.name, "name", 120, true) as string,
    description: text(input.description, "description", 1_000),
    habitType,
    frequency,
    targetCount: numberValue(input.targetCount ?? 1, "targetCount", { min: 1, max: 10_000, integer: true }),
    targetDays: numberValue(input.targetDays, "targetDays", { min: 1, max: 366, integer: true }),
    daysOfWeek,
    color,
    icon: text(input.icon, "icon", 80),
    category: text(input.category, "category", 80),
    cue: text(input.cue, "cue", 500),
    routine: text(input.routine, "routine", 1_000),
    reward: text(input.reward, "reward", 500),
    stackAfterHabitId,
    difficulty: text(input.difficulty, "difficulty", 30),
    priority: text(input.priority, "priority", 30),
    reminderTime: validateTime(text(input.reminderTime, "reminderTime", 10), "reminderTime"),
    active: booleanValue(input.active, true),
  };
}

function validateTime(value: string | null, label: string): string | null {
  if (!value) return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error(`${label} must use HH:mm format.`);
  return value;
}

export async function createHabit(userId: string, raw: Payload) {
  const values = await habitValues(userId, payload(raw));
  const habit = await prisma.habit.create({ data: { userId, ...values } });
  return { ok: true, id: habit.id, habit };
}

export async function updateHabit(userId: string, raw: Payload) {
  const input = payload(raw);
  const habitId = id(input.id ?? input.habitId, "Habit id");
  const owned = await prisma.habit.findFirst({ where: { id: habitId, userId }, select: { id: true } });
  if (!owned) throw new Error("Habit not found.");
  const habit = await prisma.habit.update({ where: { id: habitId }, data: await habitValues(userId, input, habitId) });
  return { ok: true, id: habit.id, habit };
}

export async function deleteHabit(userId: string, raw: Payload) {
  const input = payload(raw);
  const habitId = id(input.id ?? input.habitId, "Habit id");
  const result = await prisma.habit.deleteMany({ where: { id: habitId, userId } });
  if (!result.count) throw new Error("Habit not found.");
  return { id: habitId, deleted: true };
}

export async function toggleHabit(userId: string, raw: Payload) {
  const input = payload(raw);
  const habitId = id(input.habitId ?? input.id, "Habit id");
  const date = input.date ? strictDay(input.date) : utcToday();
  const habit = await prisma.habit.findFirst({
    where: { id: habitId, userId },
    select: { id: true, active: true, targetCount: true },
  });
  if (!habit) throw new Error("Habit not found.");
  if (!habit.active) throw new Error("Inactive habits cannot be checked in.");
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.habitLog.findFirst({
      where: { habitId, logDate: date },
      select: { id: true },
    });
    if (existing) {
      await tx.habitLog.deleteMany({ where: { habitId, logDate: date } });
      return { completed: false, log: null };
    }
    const log = await tx.habitLog.create({
      data: {
        habitId,
        logDate: date,
        count: habit.targetCount ?? 1,
        notes: text(input.notes, "notes", 500),
      },
    });
    return { completed: true, log: { ...log, logDate: isoDay(log.logDate) } };
  });
  return { ok: true, habitId, date: isoDay(date), ...result };
}

export async function addHabitMilestone(userId: string, raw: Payload) {
  const input = payload(raw);
  const habitId = id(input.habitId, "Habit id");
  const habit = await prisma.habit.findFirst({ where: { id: habitId, userId }, select: { id: true } });
  if (!habit) throw new Error("Habit not found.");
  const milestone = await prisma.habitMilestone.create({
    data: {
      habitId,
      milestoneDate: input.milestoneDate ? strictDay(input.milestoneDate, "milestoneDate") : utcToday(),
      description: text(input.description, "description", 1_000),
    },
  });
  return { ok: true, id: milestone.id, milestone: { ...milestone, milestoneDate: isoDay(milestone.milestoneDate) } };
}

export async function deleteHabitMilestone(userId: string, raw: Payload) {
  const input = payload(raw);
  const milestoneId = id(input.id ?? input.milestoneId, "Milestone id");
  const milestone = await prisma.habitMilestone.findFirst({
    where: { id: milestoneId, habit: { userId } },
    select: { id: true },
  });
  if (!milestone) throw new Error("Habit milestone not found.");
  await prisma.habitMilestone.delete({ where: { id: milestoneId } });
  return { id: milestoneId, deleted: true };
}

function realmRatings(raw: unknown) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new Error("realmRatings must be a list.");
  const seen = new Set<string>();
  return raw.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`realmRatings[${index}] is invalid.`);
    const rating = item as Record<string, unknown>;
    const realm = (text(rating.realm, `realmRatings[${index}].realm`, 80, true) as string).toLowerCase();
    if (seen.has(realm)) throw new Error(`realmRatings contains duplicate realm ${realm}.`);
    seen.add(realm);
    return { realm, rating: numberValue(rating.rating, `realmRatings[${index}].rating`, { required: true, min: 1, max: 10, integer: true }) as number };
  });
}

export async function upsertJournal(userId: string, raw: Payload) {
  const input = payload(raw);
  const date = strictDay(input.date);
  const ratings = realmRatings(input.realmRatings);
  const data = {
    date,
    reflection: text(input.reflection, "reflection", 10_000),
    gratitude: text(input.gratitude, "gratitude", 5_000),
    overallRating: numberValue(input.overallRating, "overallRating", { min: 1, max: 10, integer: true }),
  };
  if (!data.reflection && !data.gratitude && data.overallRating == null && !ratings.length) {
    throw new Error("Add a reflection, gratitude note, rating, or realm rating.");
  }
  const requestedId = text(input.id ?? input.entryId, "Journal entry id", 200);
  const existing = requestedId
    ? await prisma.journalEntry.findFirst({ where: { id: requestedId, userId }, select: { id: true } })
    : await prisma.journalEntry.findFirst({ where: { userId, date }, orderBy: { createdAt: "desc" }, select: { id: true } });
  if (requestedId && !existing) throw new Error("Journal entry not found.");
  const entry = existing
    ? await prisma.journalEntry.update({
        where: { id: existing.id },
        data: {
          ...data,
          ...(hasOwn(input, "realmRatings")
            ? {
                realmRatings: {
                  deleteMany: {},
                  ...(ratings.length ? { create: ratings } : {}),
                },
              }
            : {}),
        },
      })
    : await prisma.journalEntry.create({
        data: { userId, ...data, realmRatings: ratings.length ? { create: ratings } : undefined },
      });
  return { ok: true, id: entry.id, entry: { ...entry, date: isoDay(entry.date) } };
}

export async function deleteJournal(userId: string, raw: Payload) {
  const input = payload(raw);
  const entryId = text(input.id ?? input.entryId, "Journal entry id", 200);
  const date = input.date ? strictDay(input.date) : null;
  if (!entryId && !date) throw new Error("Journal entry id or date is required.");
  const result = await prisma.journalEntry.deleteMany({ where: { userId, ...(entryId ? { id: entryId } : { date: date as Date }) } });
  if (!result.count) throw new Error("Journal entry not found.");
  return { id: entryId, date: date ? isoDay(date) : null, deleted: true };
}

export async function createProgressPhoto(userId: string, raw: Payload) {
  const input = payload(raw);
  const result = await uploadWorkoutProgressPhoto(userId, {
    base64: text(input.base64, "base64", 40_000_000, true) as string,
    fileName: text(input.fileName, "fileName", 260) ?? "progress-photo",
    mimeType: text(input.mimeType, "mimeType", 100, true) as string,
    takenAt: input.takenAt ? String(input.takenAt) : undefined,
    angle: input.angle ? String(input.angle).toUpperCase() as any : null,
    phase: input.phase ? String(input.phase).toUpperCase() as any : null,
    weightKg: numberValue(input.weightKg, "weightKg", { min: 1, max: 2_000 }),
    notes: text(input.notes, "notes", 4_000),
    workoutId: text(input.workoutId, "workoutId", 200),
  } as any);
  return { ok: true, ...result };
}

export async function updateProgressPhoto(userId: string, raw: Payload) {
  const input = payload(raw);
  const photoId = id(input.id ?? input.photoId, "Progress photo id");
  return updateWorkoutProgressPhoto(userId, {
    photoId,
    ...(hasOwn(input, "takenAt") ? { takenAt: input.takenAt ? String(input.takenAt) : null } : {}),
    ...(hasOwn(input, "angle") ? { angle: input.angle ? String(input.angle).toUpperCase() : null } : {}),
    ...(hasOwn(input, "phase") ? { phase: input.phase ? String(input.phase).toUpperCase() : null } : {}),
    ...(hasOwn(input, "weightKg") ? { weightKg: numberValue(input.weightKg, "weightKg", { min: 1, max: 2_000 }) } : {}),
    ...(hasOwn(input, "notes") ? { notes: text(input.notes, "notes", 4_000) } : {}),
    ...(hasOwn(input, "workoutId") ? { workoutId: text(input.workoutId, "workoutId", 200) } : {}),
  } as any);
}

export async function deleteProgressPhoto(userId: string, raw: Payload) {
  const input = payload(raw);
  return deleteWorkoutProgressPhoto(userId, { photoId: id(input.id ?? input.photoId, "Progress photo id") });
}

function sobrietyCounterValues(input: Record<string, unknown>, existing?: { name: string; description: string | null; color: string | null; icon: string | null; startedAt: Date; archived: boolean }) {
  const color = hasOwn(input, "color") ? text(input.color, "color", 30) : existing?.color ?? null;
  if (color && !/^#[0-9a-f]{6}$/i.test(color)) throw new Error("color must be a six-digit hex color.");
  return {
    name: hasOwn(input, "name") ? text(input.name, "name", 120, true) as string : existing?.name as string,
    description: hasOwn(input, "description") ? text(input.description, "description", 2_000) : existing?.description ?? null,
    color,
    icon: hasOwn(input, "icon") ? text(input.icon, "icon", 80) : existing?.icon ?? null,
    startedAt: hasOwn(input, "startedAt") ? dateTime(input.startedAt, "startedAt") : existing?.startedAt ?? utcToday(),
    archived: hasOwn(input, "archived") ? booleanValue(input.archived, false) : existing?.archived ?? false,
  };
}

export async function createSobrietyCounter(userId: string, raw: Payload) {
  const counter = await prisma.sobrietyCounter.create({ data: { userId, ...sobrietyCounterValues(payload(raw)) } });
  return { ok: true, id: counter.id, counter: { ...counter, startedAt: counter.startedAt.toISOString() } };
}

export async function updateSobrietyCounter(userId: string, raw: Payload) {
  const input = payload(raw);
  const counterId = id(input.id ?? input.counterId, "Sobriety counter id");
  const existing = await prisma.sobrietyCounter.findFirst({
    where: { id: counterId, userId },
    select: { name: true, description: true, color: true, icon: true, startedAt: true, archived: true },
  });
  if (!existing) throw new Error("Sobriety counter not found.");
  const counter = await prisma.sobrietyCounter.update({ where: { id: counterId }, data: sobrietyCounterValues(input, existing) });
  return { ok: true, id: counter.id, counter: { ...counter, startedAt: counter.startedAt.toISOString() } };
}

export async function deleteSobrietyCounter(userId: string, raw: Payload) {
  const input = payload(raw);
  const counterId = id(input.id ?? input.counterId, "Sobriety counter id");
  const result = await prisma.sobrietyCounter.deleteMany({ where: { id: counterId, userId } });
  if (!result.count) throw new Error("Sobriety counter not found.");
  return { id: counterId, deleted: true };
}

export async function logRelapse(userId: string, raw: Payload) {
  const input = payload(raw);
  const counterId = id(input.counterId, "Sobriety counter id");
  const counter = await prisma.sobrietyCounter.findFirst({ where: { id: counterId, userId }, select: { id: true } });
  if (!counter) throw new Error("Sobriety counter not found.");
  const relapsedAt = input.relapsedAt ? dateTime(input.relapsedAt, "relapsedAt") : new Date();
  if (relapsedAt.getTime() > Date.now() + 60_000) throw new Error("relapsedAt cannot be in the future.");
  const restartAt = input.restartAt ? dateTime(input.restartAt, "restartAt") : relapsedAt;
  if (restartAt < relapsedAt) throw new Error("restartAt cannot be before relapsedAt.");
  const relapse = await prisma.$transaction(async (tx) => {
    const created = await tx.sobrietyRelapse.create({
      data: { counterId, relapsedAt, notes: text(input.notes, "notes", 2_000) },
    });
    await tx.sobrietyCounter.update({ where: { id: counterId }, data: { startedAt: restartAt, archived: false } });
    return created;
  });
  return { ok: true, id: relapse.id, relapse: { ...relapse, relapsedAt: relapse.relapsedAt.toISOString() } };
}

export async function deleteRelapse(userId: string, raw: Payload) {
  const input = payload(raw);
  const relapseId = id(input.id ?? input.relapseId, "Relapse id");
  const relapse = await prisma.sobrietyRelapse.findFirst({
    where: { id: relapseId, counter: { userId } },
    select: { id: true },
  });
  if (!relapse) throw new Error("Relapse not found.");
  await prisma.sobrietyRelapse.delete({ where: { id: relapseId } });
  return { id: relapseId, deleted: true };
}

export async function logSubstance(userId: string, raw: Payload) {
  const input = payload(raw);
  const substanceType = text(input.substanceType, "substanceType", 120, true) as string;
  const amount = numberValue(input.amount, "amount", { min: 0, max: 1_000_000 });
  const loggedAt = input.loggedAt ? dateTime(input.loggedAt, "loggedAt") : new Date();
  const log = await prisma.substanceLog.create({
    data: {
      userId,
      substanceType,
      amount,
      unit: text(input.unit, "unit", 40),
      notes: text(input.notes, "notes", 2_000),
      loggedAt,
    },
  });
  return { ok: true, id: log.id, log: { ...log, loggedAt: log.loggedAt.toISOString() } };
}

export async function deleteSubstance(userId: string, raw: Payload) {
  const input = payload(raw);
  const logId = id(input.id ?? input.logId, "Substance log id");
  const result = await prisma.substanceLog.deleteMany({ where: { id: logId, userId } });
  if (!result.count) throw new Error("Substance log not found.");
  return { id: logId, deleted: true };
}

export async function createCustomSubstance(userId: string, raw: Payload) {
  const input = payload(raw);
  const name = text(input.name, "name", 120, true) as string;
  const existing = await prisma.customSubstanceType.findFirst({
    where: { userId, name: { equals: name, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) throw new Error("That custom substance already exists.");
  const custom = await prisma.customSubstanceType.create({ data: { userId, name } });
  return { ok: true, id: custom.id, customType: custom };
}

export async function deleteCustomSubstance(userId: string, raw: Payload) {
  const input = payload(raw);
  const customId = id(input.id ?? input.customId, "Custom substance id");
  const result = await prisma.customSubstanceType.deleteMany({ where: { id: customId, userId } });
  if (!result.count) throw new Error("Custom substance not found.");
  return { id: customId, deleted: true };
}

function peptideCreateValues(input: Record<string, unknown>) {
  const vialMg = numberValue(input.vialMg, "vialMg", { required: true, min: 0.000001, max: 100_000 }) as number;
  const waterMl = numberValue(input.waterMl, "waterMl", { required: true, min: 0.000001, max: 100_000 }) as number;
  const doseUnit = (text(input.doseUnit, "doseUnit", 20) ?? "mg").toLowerCase();
  if (!new Set(["mg", "mcg", "units", "iu"]).has(doseUnit)) throw new Error("doseUnit is invalid.");
  return {
    name: text(input.name, "name", 120, true) as string,
    vialMg,
    doseUnit,
    waterMl,
    syringeUnitsPerMl: numberValue(input.syringeUnitsPerMl ?? 100, "syringeUnitsPerMl", { required: true, min: 1, max: 1_000, integer: true }) as number,
    vialsOwned: numberValue(input.vialsOwned ?? 0, "vialsOwned", { required: true, min: 0, max: 100_000 }) as number,
    vialsOpened: numberValue(input.vialsOpened ?? 0, "vialsOpened", { required: true, min: 0, max: 100_000, integer: true }) as number,
    activeVialRemainingMl: numberValue(input.activeVialRemainingMl ?? waterMl, "activeVialRemainingMl", { required: true, min: 0, max: 100_000 }) as number,
    cycleStartDate: input.cycleStartDate ? strictDay(input.cycleStartDate, "cycleStartDate") : null,
    position: numberValue(input.position ?? 0, "position", { required: true, min: 0, max: 1_000_000, integer: true }) as number,
  };
}

export async function savePeptide(userId: string, raw: Payload) {
  const input = payload(raw);
  const peptideId = text(input.id ?? input.peptideId, "Peptide id", 200);
  const values = peptideCreateValues(input);
  if (values.activeVialRemainingMl > values.waterMl) throw new Error("activeVialRemainingMl cannot exceed waterMl.");
  let peptide;
  if (peptideId) {
    const owned = await prisma.peptide.findFirst({ where: { id: peptideId, userId }, select: { id: true } });
    if (!owned) throw new Error("Peptide not found.");
    peptide = await prisma.peptide.update({ where: { id: peptideId }, data: values });
  } else {
    peptide = await prisma.peptide.create({ data: { userId, ...values } });
  }
  return { ok: true, id: peptide.id, peptide };
}

export async function createPeptide(userId: string, raw: Payload) {
  return savePeptide(userId, raw);
}

export async function deletePeptide(userId: string, raw: Payload) {
  const input = payload(raw);
  const peptideId = id(input.id ?? input.peptideId, "Peptide id");
  const result = await prisma.peptide.deleteMany({ where: { id: peptideId, userId } });
  if (!result.count) throw new Error("Peptide not found.");
  return { id: peptideId, deleted: true };
}

export async function savePeptideBlock(userId: string, raw: Payload) {
  const input = payload(raw);
  const blockId = text(input.id ?? input.blockId, "Peptide block id", 200);
  const peptideId = id(input.peptideId, "Peptide id");
  const peptide = await prisma.peptide.findFirst({ where: { id: peptideId, userId }, select: { id: true } });
  if (!peptide) throw new Error("Peptide not found.");
  const startWeek = numberValue(input.startWeek, "startWeek", { required: true, min: 1, max: 520, integer: true }) as number;
  const endWeek = numberValue(input.endWeek, "endWeek", { required: true, min: 1, max: 520, integer: true }) as number;
  if (endWeek < startWeek) throw new Error("endWeek cannot be before startWeek.");
  const data = {
    peptideId,
    startWeek,
    endWeek,
    dosePerAdmin: numberValue(input.dosePerAdmin, "dosePerAdmin", { required: true, min: 0.000001, max: 1_000_000 }) as number,
    dosesPerWeek: numberValue(input.dosesPerWeek, "dosesPerWeek", { required: true, min: 0.01, max: 100 }) as number,
    note: text(input.note, "note", 2_000),
    order: numberValue(input.order ?? 0, "order", { required: true, min: 0, max: 10_000, integer: true }) as number,
  };
  let block;
  if (blockId) {
    const owned = await prisma.peptideBlock.findFirst({ where: { id: blockId, peptide: { userId } }, select: { id: true } });
    if (!owned) throw new Error("Peptide block not found.");
    block = await prisma.peptideBlock.update({ where: { id: blockId }, data });
  } else {
    block = await prisma.peptideBlock.create({ data });
  }
  return { ok: true, id: block.id, block };
}

export async function deletePeptideBlock(userId: string, raw: Payload) {
  const input = payload(raw);
  const blockId = id(input.id ?? input.blockId, "Peptide block id");
  const block = await prisma.peptideBlock.findFirst({ where: { id: blockId, peptide: { userId } }, select: { id: true } });
  if (!block) throw new Error("Peptide block not found.");
  await prisma.peptideBlock.delete({ where: { id: blockId } });
  return { id: blockId, deleted: true };
}

function doseDate(value: unknown): Date {
  if (!value) return utcToday();
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return strictDay(value);
  const parsed = dateTime(value, "date");
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
}

export async function logPeptideDose(userId: string, raw: Payload) {
  const input = payload(raw);
  const peptideId = id(input.peptideId, "Peptide id");
  const peptide = await prisma.peptide.findFirst({
    where: { id: peptideId, userId },
    select: { id: true, activeVialRemainingMl: true, syringeUnitsPerMl: true },
  });
  if (!peptide) throw new Error("Peptide not found.");
  const blockId = text(input.blockId, "blockId", 200);
  if (blockId) {
    const block = await prisma.peptideBlock.findFirst({ where: { id: blockId, peptideId }, select: { id: true } });
    if (!block) throw new Error("Peptide block not found.");
  }
  const dose = numberValue(input.dose, "dose", { required: true, min: 0.000001, max: 1_000_000 }) as number;
  const units = numberValue(input.units ?? dose, "units", { required: true, min: 0, max: 1_000_000 }) as number;
  const derivedMlUsed = peptide.syringeUnitsPerMl > 0 ? units / peptide.syringeUnitsPerMl : 0;
  const mlUsed = numberValue(input.mlUsed ?? derivedMlUsed, "mlUsed", { required: true, min: 0, max: 100_000 }) as number;
  if (mlUsed > peptide.activeVialRemainingMl + 1e-9) throw new Error("mlUsed exceeds the active vial inventory.");
  const log = await prisma.$transaction(async (tx) => {
    const created = await tx.peptideLog.create({
      data: { peptideId, blockId, date: doseDate(input.date), dose, units, mlUsed, site: text(input.site, "site", 100) },
    });
    await tx.peptide.update({ where: { id: peptideId }, data: { activeVialRemainingMl: { decrement: mlUsed } } });
    return created;
  });
  return { ok: true, id: log.id, log: { ...log, date: isoDay(log.date) } };
}

export async function updatePeptideDose(userId: string, raw: Payload) {
  const input = payload(raw);
  const logId = id(input.id ?? input.logId, "Peptide dose id");
  const existing = await prisma.peptideLog.findFirst({
    where: { id: logId, peptide: { userId } },
    select: { id: true, peptideId: true, blockId: true, date: true, dose: true, units: true, mlUsed: true, site: true, peptide: { select: { activeVialRemainingMl: true } } },
  });
  if (!existing) throw new Error("Peptide dose not found.");
  const blockId = hasOwn(input, "blockId") ? text(input.blockId, "blockId", 200) : existing.blockId;
  if (blockId) {
    const block = await prisma.peptideBlock.findFirst({ where: { id: blockId, peptideId: existing.peptideId }, select: { id: true } });
    if (!block) throw new Error("Peptide block not found.");
  }
  const mlUsed = hasOwn(input, "mlUsed")
    ? numberValue(input.mlUsed, "mlUsed", { required: true, min: 0, max: 100_000 }) as number
    : existing.mlUsed;
  const available = existing.peptide.activeVialRemainingMl + existing.mlUsed;
  if (mlUsed > available + 1e-9) throw new Error("mlUsed exceeds the active vial inventory.");
  const data = {
    blockId,
    date: hasOwn(input, "date") ? doseDate(input.date) : existing.date,
    dose: hasOwn(input, "dose") ? numberValue(input.dose, "dose", { required: true, min: 0.000001, max: 1_000_000 }) as number : existing.dose,
    units: hasOwn(input, "units") ? numberValue(input.units, "units", { required: true, min: 0, max: 1_000_000 }) as number : existing.units,
    mlUsed,
    site: hasOwn(input, "site") ? text(input.site, "site", 100) : existing.site,
  };
  const log = await prisma.$transaction(async (tx) => {
    const updated = await tx.peptideLog.update({ where: { id: logId }, data });
    await tx.peptide.update({ where: { id: existing.peptideId }, data: { activeVialRemainingMl: available - mlUsed } });
    return updated;
  });
  return { ok: true, id: log.id, log: { ...log, date: isoDay(log.date) } };
}

export async function deletePeptideDose(userId: string, raw: Payload) {
  const input = payload(raw);
  const logId = id(input.id ?? input.logId, "Peptide dose id");
  const existing = await prisma.peptideLog.findFirst({
    where: { id: logId, peptide: { userId } },
    select: { id: true, peptideId: true, mlUsed: true },
  });
  if (!existing) throw new Error("Peptide dose not found.");
  await prisma.$transaction([
    prisma.peptideLog.delete({ where: { id: logId } }),
    prisma.peptide.update({ where: { id: existing.peptideId }, data: { activeVialRemainingMl: { increment: existing.mlUsed } } }),
  ]);
  return { id: logId, deleted: true };
}

function medicationValues(input: Record<string, unknown>) {
  return {
    name: text(input.name, "name", 150, true) as string,
    dosageAmount: numberValue(input.dosageAmount, "dosageAmount", { min: 0, max: 1_000_000 }),
    dosageUnit: text(input.dosageUnit, "dosageUnit", 30),
    frequency: text(input.frequency, "frequency", 100),
    notes: text(input.notes, "notes", 2_000),
    active: booleanValue(input.active, true),
  };
}

export async function saveMedication(userId: string, raw: Payload) {
  const input = payload(raw);
  const medicationId = text(input.id ?? input.medicationId, "Medication id", 200);
  const values = medicationValues(input);
  let medication;
  if (medicationId) {
    const owned = await prisma.medication.findFirst({ where: { id: medicationId, userId }, select: { id: true } });
    if (!owned) throw new Error("Medication not found.");
    medication = await prisma.medication.update({ where: { id: medicationId }, data: values });
  } else {
    medication = await prisma.medication.create({ data: { userId, ...values } });
  }
  return { ok: true, id: medication.id, medication };
}

export async function deleteMedication(userId: string, raw: Payload) {
  const input = payload(raw);
  const medicationId = id(input.id ?? input.medicationId, "Medication id");
  const result = await prisma.medication.deleteMany({ where: { id: medicationId, userId } });
  if (!result.count) throw new Error("Medication not found.");
  return { id: medicationId, deleted: true };
}

export async function saveSupplement(userId: string, raw: Payload) {
  const input = payload(raw);
  const supplementId = text(input.id ?? input.supplementId, "Supplement id", 200);
  const values = medicationValues(input);
  let supplement;
  if (supplementId) {
    const owned = await prisma.supplement.findFirst({ where: { id: supplementId, userId }, select: { id: true } });
    if (!owned) throw new Error("Supplement not found.");
    supplement = await prisma.supplement.update({ where: { id: supplementId }, data: values });
  } else {
    supplement = await prisma.supplement.create({ data: { userId, ...values } });
  }
  return { ok: true, id: supplement.id, supplement };
}

export async function deleteSupplement(userId: string, raw: Payload) {
  const input = payload(raw);
  const supplementId = id(input.id ?? input.supplementId, "Supplement id");
  const result = await prisma.supplement.deleteMany({ where: { id: supplementId, userId } });
  if (!result.count) throw new Error("Supplement not found.");
  return { id: supplementId, deleted: true };
}

const THERAPEUTIC_KINDS = new Set(["MEDICATION", "SUPPLEMENT", "PEPTIDE", "OTHER"]);
const SCHEDULE_PATTERNS = new Set(["DAILY", "EVERY_N_DAYS", "WEEKLY_DOW", "WEEKLY_ONCE"]);
const WEEKDAY_BY_INDEX = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** Convert a conceptual @db.Date plus local HH:mm into the persisted instant. */
function localScheduleInstant(day: Date, time: string): Date {
  const [year, month, date] = isoDay(day).split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return new Date(year, month - 1, date, hour, minute, 0, 0);
}

function localDayForInstant(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function scheduleValues(input: Record<string, unknown>) {
  const kind = String(input.kind ?? "MEDICATION").toUpperCase();
  if (!THERAPEUTIC_KINDS.has(kind)) throw new Error("kind is invalid.");
  const pattern = String(input.pattern ?? "DAILY").toUpperCase();
  if (!SCHEDULE_PATTERNS.has(pattern)) throw new Error("pattern is invalid.");
  const everyN = numberValue(input.everyN, "everyN", { min: 1, max: 365, integer: true });
  if (pattern === "EVERY_N_DAYS" && everyN == null) throw new Error("everyN is required for an every-N-days schedule.");
  const daysOfWeek = Array.isArray(input.daysOfWeek)
    ? Array.from(new Set(input.daysOfWeek.map((day) => String(day).toUpperCase())))
    : [];
  if (daysOfWeek.some((day) => !WEEKDAYS.has(day))) throw new Error("daysOfWeek contains an invalid weekday.");
  if (pattern === "WEEKLY_DOW" && !daysOfWeek.length) throw new Error("Choose at least one weekday.");
  const timesOfDay = Array.isArray(input.timesOfDay) && input.timesOfDay.length
    ? Array.from(new Set(input.timesOfDay.map((time) => validateTime(String(time), "timesOfDay") as string))).sort()
    : ["08:00"];
  const startDate = input.startDate ? strictDay(input.startDate, "startDate") : utcToday();
  const endDate = input.endDate ? strictDay(input.endDate, "endDate") : null;
  if (endDate && endDate < startDate) throw new Error("endDate cannot be before startDate.");
  return {
    kind: kind as "MEDICATION" | "SUPPLEMENT" | "PEPTIDE" | "OTHER",
    name: text(input.name, "name", 150, true) as string,
    dosage: text(input.dosage, "dosage", 100),
    notes: text(input.notes, "notes", 2_000),
    startDate,
    endDate,
    pattern: pattern as "DAILY" | "EVERY_N_DAYS" | "WEEKLY_DOW" | "WEEKLY_ONCE",
    everyN: pattern === "EVERY_N_DAYS" ? everyN : null,
    daysOfWeek: pattern === "WEEKLY_DOW" ? daysOfWeek : [],
    timesOfDay,
    archived: booleanValue(input.archived, false),
  };
}

function scheduleRunsOn(
  schedule: {
    pattern: string;
    everyN: number | null;
    daysOfWeek: string[];
    startDate: Date | null;
  },
  day: Date,
): boolean {
  const start = schedule.startDate ?? day;
  if (day < start) return false;
  if (schedule.pattern === "DAILY") return true;
  if (schedule.pattern === "EVERY_N_DAYS") return daysBetween(start, day) % Math.max(1, schedule.everyN ?? 1) === 0;
  if (schedule.pattern === "WEEKLY_DOW") return schedule.daysOfWeek.includes(WEEKDAY_BY_INDEX[day.getUTCDay()]);
  return day.getUTCDay() === start.getUTCDay();
}

export async function materializeTherapeuticDoses(
  userId: string,
  start = addDays(utcToday(), -30),
  end = addDays(utcToday(), 8),
) {
  const schedules = await prisma.therapeuticSchedule.findMany({
    where: { userId, archived: false, OR: [{ endDate: null }, { endDate: { gte: start } }] },
    select: { id: true, pattern: true, everyN: true, daysOfWeek: true, timesOfDay: true, startDate: true, endDate: true },
  });
  const queryStart = addDays(start, -1);
  const queryEnd = addDays(end, 2);
  const existing = await prisma.therapeuticDose.findMany({
    where: {
      userId,
      scheduleId: { not: null },
      scheduledAt: { gte: queryStart, lt: queryEnd },
    },
    select: {
      id: true,
      scheduleId: true,
      scheduledAt: true,
      loggedAt: true,
      skippedAt: true,
    },
  });
  const existingKeys = new Set(
    existing.map(
      (dose) => `${dose.scheduleId}:${dose.scheduledAt.toISOString()}`,
    ),
  );
  const expectedKeys = new Set<string>();
  const rows: Array<{ userId: string; scheduleId: string; scheduledAt: Date }> = [];
  for (const schedule of schedules) {
    for (let day = new Date(start); day <= end; day = addDays(day, 1)) {
      if (schedule.endDate && day > schedule.endDate) continue;
      if (!scheduleRunsOn(schedule, day)) continue;
      for (const time of schedule.timesOfDay.length ? schedule.timesOfDay : ["08:00"]) {
        const scheduledAt = localScheduleInstant(day, time);
        const key = `${schedule.id}:${scheduledAt.toISOString()}`;
        expectedKeys.add(key);
        if (existingKeys.has(key)) continue;
        rows.push({ userId, scheduleId: schedule.id, scheduledAt });
      }
    }
  }
  const activeScheduleIds = new Set(schedules.map((schedule) => schedule.id));
  const startDay = isoDay(start);
  const endDay = isoDay(end);
  const staleIds = existing
    .filter(
      (dose) =>
        dose.scheduleId != null &&
        activeScheduleIds.has(dose.scheduleId) &&
        localDayForInstant(dose.scheduledAt) >= startDay &&
        localDayForInstant(dose.scheduledAt) <= endDay &&
        dose.loggedAt == null &&
        dose.skippedAt == null &&
        !expectedKeys.has(
          `${dose.scheduleId}:${dose.scheduledAt.toISOString()}`,
        ),
    )
    .map((dose) => dose.id);
  if (staleIds.length) {
    await prisma.therapeuticDose.deleteMany({
      where: { id: { in: staleIds }, userId },
    });
  }
  if (rows.length) await prisma.therapeuticDose.createMany({ data: rows, skipDuplicates: true });
  return {
    created: rows.length,
    replaced: staleIds.length,
    start: isoDay(start),
    end: isoDay(end),
    timeZone: systemTimeZone(),
  };
}

export async function saveTherapeuticSchedule(userId: string, raw: Payload) {
  const input = payload(raw);
  const scheduleId = text(input.id ?? input.scheduleId, "Schedule id", 200);
  const values = scheduleValues(input);
  let schedule;
  if (scheduleId) {
    const owned = await prisma.therapeuticSchedule.findFirst({ where: { id: scheduleId, userId }, select: { id: true } });
    if (!owned) throw new Error("Therapeutic schedule not found.");
    schedule = await prisma.$transaction(async (tx) => {
      await tx.therapeuticDose.deleteMany({
        where: { scheduleId, loggedAt: null, skippedAt: null, scheduledAt: { gte: utcToday() } },
      });
      return tx.therapeuticSchedule.update({ where: { id: scheduleId }, data: values });
    });
  } else {
    schedule = await prisma.therapeuticSchedule.create({ data: { userId, ...values } });
  }
  await materializeTherapeuticDoses(userId);
  return { ok: true, id: schedule.id, schedule };
}

export async function deleteTherapeuticSchedule(userId: string, raw: Payload) {
  const input = payload(raw);
  const scheduleId = id(input.id ?? input.scheduleId, "Schedule id");
  const owned = await prisma.therapeuticSchedule.findFirst({ where: { id: scheduleId, userId }, select: { id: true } });
  if (!owned) throw new Error("Therapeutic schedule not found.");
  await prisma.$transaction([
    prisma.therapeuticDose.deleteMany({ where: { scheduleId, loggedAt: null, skippedAt: null } }),
    prisma.therapeuticSchedule.update({ where: { id: scheduleId }, data: { archived: true } }),
  ]);
  return { id: scheduleId, archived: true };
}

export async function setTherapeuticDoseStatus(userId: string, raw: Payload) {
  const input = payload(raw);
  const doseId = id(input.id ?? input.doseId, "Dose id");
  const status = String(input.status ?? "").toUpperCase();
  if (!new Set(["TAKEN", "SKIPPED", "PENDING"]).has(status)) throw new Error("status must be TAKEN, SKIPPED, or PENDING.");
  const owned = await prisma.therapeuticDose.findFirst({ where: { id: doseId, userId }, select: { id: true } });
  if (!owned) throw new Error("Therapeutic dose not found.");
  const now = new Date();
  const dose = await prisma.therapeuticDose.update({
    where: { id: doseId },
    data: {
      loggedAt: status === "TAKEN" ? (input.loggedAt ? dateTime(input.loggedAt, "loggedAt") : now) : null,
      skippedAt: status === "SKIPPED" ? (input.skippedAt ? dateTime(input.skippedAt, "skippedAt") : now) : null,
      ...(hasOwn(input, "notes") ? { notes: text(input.notes, "notes", 2_000) } : {}),
    },
  });
  return { ok: true, id: dose.id, status, dose };
}

async function ownedTherapeutic(
  userId: string,
  kind: string,
  therapeuticId: string | null,
): Promise<{ id: string; name: string } | null> {
  if (!therapeuticId) return null;
  if (kind === "MEDICATION") return prisma.medication.findFirst({ where: { id: therapeuticId, userId }, select: { id: true, name: true } });
  if (kind === "SUPPLEMENT") return prisma.supplement.findFirst({ where: { id: therapeuticId, userId }, select: { id: true, name: true } });
  if (kind === "PEPTIDE") return prisma.peptide.findFirst({ where: { id: therapeuticId, userId }, select: { id: true, name: true } });
  return null;
}

export async function logTherapeutic(userId: string, raw: Payload) {
  const input = payload(raw);
  const kind = String(input.therapeuticKind ?? input.kind ?? "OTHER").toUpperCase();
  if (!THERAPEUTIC_KINDS.has(kind)) throw new Error("therapeuticKind is invalid.");
  const therapeuticId = text(input.therapeuticId, "therapeuticId", 200);
  const owned = await ownedTherapeutic(userId, kind, therapeuticId);
  if (therapeuticId && kind !== "OTHER" && !owned) throw new Error("Therapeutic item not found.");
  const name = text(input.name, "name", 150) ?? owned?.name ?? null;
  if (!name) throw new Error("name is required.");
  const log = await prisma.therapeuticLog.create({
    data: {
      userId,
      therapeuticKind: kind as "MEDICATION" | "SUPPLEMENT" | "PEPTIDE" | "OTHER",
      therapeuticId,
      name,
      doseAmount: numberValue(input.doseAmount, "doseAmount", { min: 0, max: 1_000_000 }),
      doseUnit: text(input.doseUnit, "doseUnit", 30),
      loggedAt: input.loggedAt ? dateTime(input.loggedAt, "loggedAt") : new Date(),
      notes: text(input.notes, "notes", 2_000),
    },
  });
  return { ok: true, id: log.id, log: { ...log, loggedAt: log.loggedAt.toISOString() } };
}

export async function deleteTherapeutic(userId: string, raw: Payload) {
  const input = payload(raw);
  const logId = id(input.id ?? input.logId, "Therapeutic log id");
  const result = await prisma.therapeuticLog.deleteMany({ where: { id: logId, userId } });
  if (!result.count) throw new Error("Therapeutic log not found.");
  return { id: logId, deleted: true };
}

export async function getMedications(userId: string) {
  await materializeTherapeuticDoses(userId);
  const result = await base.getMedications(userId);
  const days = Array.from({ length: 30 }, (_, index) => isoDay(addDays(utcToday(), index - 29)));
  const doseByDay = new Map<string, { scheduled: number; taken: number; skipped: number; missed: number }>();
  for (const dose of result.doseHistory30) {
    const day = localDayForInstant(dose.scheduledAt);
    const current = doseByDay.get(day) ?? { scheduled: 0, taken: 0, skipped: 0, missed: 0 };
    current.scheduled += 1;
    if (dose.status === "TAKEN") current.taken += 1;
    else if (dose.status === "SKIPPED") current.skipped += 1;
    else if (dose.status === "MISSED") current.missed += 1;
    doseByDay.set(day, current);
  }
  return {
    ...result,
    timeZone: systemTimeZone(),
    adherenceTrend: days.map((date) => {
      const value = doseByDay.get(date) ?? { scheduled: 0, taken: 0, skipped: 0, missed: 0 };
      return {
        date,
        ...value,
        percentage: value.scheduled ? round((value.taken / value.scheduled) * 100, 0) : null,
      };
    }),
  };
}
