import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";
import { prisma } from "../db/prisma.js";
import { resolveAssetUrl } from "./assets.js";

export type WorkoutUnitSystem = "IMPERIAL" | "METRIC";
export type WorkoutStatus = "completed" | "in_progress" | "paused" | "needs_review" | "logged";

export interface WorkoutSummaryRow {
    id: string;
    name: string;
    note: string | null;
    date: string;
    startedAt: string | null;
    endedAt: string | null;
    pausedAt: string | null;
    pausedMs: number;
    durationSeconds: number | null;
    elapsedSeconds: number | null;
    durationMinutes: number | null;
    status: WorkoutStatus;
    rpe: number | null;
    templateId: string | null;
    templateName: string | null;
    exerciseCount: number;
    exerciseIds: string[];
    exerciseNames: string[];
    workoutExerciseIds: string[];
    /** Completed set detail for history/recents drill-ins. */
    exercises: Array<{
        id: string;
        exerciseId: string;
        name: string;
        note: string | null;
        groupKey: string | null;
        restSec: number | null;
        tempo: string | null;
        sets: Array<{
            order: number;
            targetWeight: number | null;
            targetReps: number | null;
            targetSeconds: number | null;
            targetMeters: number | null;
            targetRpe: number | null;
            weight: number | null;
            reps: number | null;
            seconds: number | null;
            meters: number | null;
            rpe: number | null;
            restTakenSec: number | null;
            warmup: boolean;
            isAmrap: boolean;
            completed: boolean;
        }>;
    }>;
    completedSets: number;
    workingSets: number;
    volume: number;
}

export interface PersonalRecordRow {
    id: string;
    exerciseId: string;
    exerciseName: string;
    recordType: string;
    value: number;
    unit: string | null;
    displayValue: number;
    displayUnit: string;
    achievedOn: string;
    notes: string | null;
}

export interface WeeklyTrainingRow {
    week: string;
    workouts: number;
    workingSets: number;
    volume: number;
}

export interface SchedulePlanRow {
    id: string;
    date: string;
    name: string;
    notes: string | null;
    templateId: string | null;
    templateName: string | null;
    workoutId: string | null;
    skipped: boolean;
    status: "planned" | "in_progress" | "paused" | "needs_review" | "completed" | "skipped" | "missed";
}

export interface WorkoutsOverviewDto {
    unitSystem: WorkoutUnitSystem;
    weightUnit: "lb" | "kg";
    summary: {
        workoutsThisWeek: number;
        workoutsWeekDelta: number | null;
        volumeThisWeek: number;
        volumeWeekDelta: number | null;
        recentRecordCount: number;
        activeCycle: TrainingCycleRow | null;
        templateCount: number;
        adherence30: number | null;
    };
    recentWorkouts: WorkoutSummaryRow[];
    /** Every plan on the user's current local calendar day, including skipped or fulfilled plans. */
    todaySchedule: SchedulePlanRow[];
    upcomingSchedule: SchedulePlanRow[];
    recentRecords: PersonalRecordRow[];
    weeklyTraining: WeeklyTrainingRow[];
    muscleBalance: Array<{ muscle: string; sets: number }>;
}

export interface WorkoutsLogDto {
    unitSystem: WorkoutUnitSystem;
    weightUnit: "lb" | "kg";
    summary: {
        totalSessions: number;
        sessionsLast30Days: number;
        completedSetsLast30Days: number;
        volumeLast30Days: number;
        averageDurationMinutes: number | null;
    };
    workouts: WorkoutSummaryRow[];
    templates: Array<{ id: string; name: string }>;
    exerciseOptions: Array<Pick<ExerciseLibraryRow, "id" | "name" | "lastPerformedOn" | "lastWorkoutName" | "previousSets" | "records">>;
}

export interface WorkoutsScheduleDto {
    summary: {
        plannedNext7Days: number;
        completedLast30Days: number;
        missedLast30Days: number;
        adherence30: number | null;
    };
    plans: SchedulePlanRow[];
    templates: Array<{ id: string; name: string }>;
}

export interface ExerciseLibraryRow {
    id: string;
    slug: string;
    name: string;
    muscles: string[];
    secondaryMuscles: string[];
    equipment: string[];
    level: string | null;
    category: string | null;
    force: string | null;
    mechanic: string | null;
    instructions: string | null;
    instructionSteps: string[];
    notes: string | null;
    images: string[];
    mediaKey: string | null;
    mediaUrl: string | null;
    imageUrl: string | null;
    custom: boolean;
    parentId: string | null;
    parentName: string | null;
    tracksReps: boolean;
    tracksWeight: boolean;
    tracksTime: boolean;
    tracksDistance: boolean;
    useCount: number;
    records: PersonalRecordRow[];
    lastPerformedOn: string | null;
    lastWorkoutName: string | null;
    previousSets: Array<{ weight: number | null; reps: number | null; seconds: number | null; meters: number | null }>;
}

export interface WorkoutsExercisesDto {
    unitSystem: WorkoutUnitSystem;
    weightUnit: "lb" | "kg";
    summary: { total: number; custom: number; used: number; withRecords: number };
    exercises: ExerciseLibraryRow[];
}

export interface TemplateRow {
    id: string;
    name: string;
    note: string | null;
    progression: string;
    progressionStepKg: number | null;
    cycleWeek: number | null;
    exerciseCount: number;
    totalSets: number;
    estimatedMinutes: number;
    lastUsedOn: string | null;
    createdAt: string;
    updatedAt: string;
    exercises: Array<{
        id: string;
        exerciseId: string;
        exerciseName: string;
        exerciseSlug: string;
        order: number;
        targetSets: number | null;
        targetReps: number | null;
        targetRepsMin: number | null;
        targetRepsMax: number | null;
        targetWeight: number | null;
        trainingMaxKg: number | null;
        targetTimeSec: number | null;
        targetDistanceM: number | null;
        targetRpe: number | null;
        restSec: number | null;
        groupKey: string | null;
        tempo: string | null;
        note: string | null;
        warmupSets: unknown;
        perSetMode: boolean;
        sets: Array<{
            id: string;
            order: number;
            targetReps: number | null;
            targetRepsMin: number | null;
            targetRepsMax: number | null;
            targetWeight: number | null;
            targetRpe: number | null;
            isAmrap: boolean;
            isWarmup: boolean;
        }>;
    }>;
}

export interface WorkoutsTemplatesDto {
    unitSystem: WorkoutUnitSystem;
    weightUnit: "lb" | "kg";
    summary: { total: number; withProgression: number; totalExercises: number; used: number };
    templates: TemplateRow[];
    exerciseOptions: Array<{ id: string; name: string }>;
}

export interface BodyMeasurementRow {
    id: string;
    date: string;
    weightKg: number | null;
    displayWeight: number | null;
    bodyFatPct: number | null;
    chestCm: number | null;
    waistCm: number | null;
    neckCm: number | null;
    hipCm: number | null;
    armLCm: number | null;
    armRCm: number | null;
    legLCm: number | null;
    legRCm: number | null;
    note: string | null;
}

export interface TrainingCycleRow {
    id: string;
    phase: string;
    startDate: string;
    endDate: string | null;
    note: string | null;
    day: number;
    status: "upcoming" | "active" | "completed";
}

export interface BodyPersonalRecordRow {
    exerciseId: string;
    exerciseName: string;
    recordIds: string[];
    oneRm: number | null;
    volume: number | null;
    reps: number | null;
    time: number | null;
    distance: number | null;
    lastAchievedOn: string;
}

export interface WorkoutsBodyDto {
    unitSystem: WorkoutUnitSystem;
    weightUnit: "lb" | "kg";
    summary: {
        latestWeight: number | null;
        weightChange: number | null;
        latestBodyFatPct: number | null;
        bodyFatChange: number | null;
        measurementCount: number;
        activeCycle: TrainingCycleRow | null;
    };
    measurements: BodyMeasurementRow[];
    cycles: TrainingCycleRow[];
    records: BodyPersonalRecordRow[];
    weeklyTraining: WeeklyTrainingRow[];
    muscleBalance: Array<{ muscle: string; sets: number }>;
}

export interface ProgressPhotoRow {
    id: string;
    originalKey: string;
    thumbKey: string | null;
    originalUrl: string;
    thumbnailUrl: string;
    angle: string | null;
    phase: string | null;
    weightKg: number | null;
    closestWeightKg: number | null;
    displayWeight: number | null;
    approximateWeight: boolean;
    takenAt: string;
    notes: string | null;
    processed: boolean;
    workout: { id: string; name: string; date: string } | null;
}

export interface WorkoutsProgressDto {
    unitSystem: WorkoutUnitSystem;
    weightUnit: "lb" | "kg";
    summary: {
        photoCount: number;
        linkedWorkoutCount: number;
        latestPhotoAt: string | null;
        firstPhotoAt: string | null;
        timelineDays: number;
    };
    photos: ProgressPhotoRow[];
    workoutOptions: Array<{ id: string; name: string; date: string; label: string }>;
    weightSeries: Array<{ date: string; weightKg: number; displayWeight: number }>;
}

export interface CreateExerciseInput {
    name: string;
    muscles?: string[];
    equipment?: string[];
    category?: string | null;
    notes?: string | null;
    tracksReps?: boolean;
    tracksWeight?: boolean;
    tracksTime?: boolean;
    tracksDistance?: boolean;
}

export interface UpdateExerciseInput extends CreateExerciseInput { exerciseId: string }

export interface CreateTemplateInput {
    name: string;
    note?: string | null;
    progression?: "NONE" | "LINEAR" | "DOUBLE" | "FIVETHREEONE";
    progressionStepKg?: number | null;
    cycleWeek?: number | null;
    weightUnit?: "kg" | "lb";
    exercises?: Array<{
        id?: string;
        exerciseId: string;
        targetSets?: number | null;
        targetReps?: number | null;
        targetRepsMin?: number | null;
        targetRepsMax?: number | null;
        targetWeight?: number | null;
        trainingMaxKg?: number | null;
        targetTimeSec?: number | null;
        targetDistanceM?: number | null;
        targetRpe?: number | null;
        restSec?: number | null;
        groupKey?: string | null;
        tempo?: string | null;
        note?: string | null;
        warmupSets?: Prisma.InputJsonValue | null;
        perSetMode?: boolean;
        sets?: Array<{
            id?: string;
            targetReps?: number | null;
            targetRepsMin?: number | null;
            targetRepsMax?: number | null;
            targetWeight?: number | null;
            targetRpe?: number | null;
            isAmrap?: boolean;
            isWarmup?: boolean;
        }>;
    }>;
}

export interface UpdateTemplateInput extends CreateTemplateInput { templateId: string }

export interface CreateScheduleInput {
    date: string;
    name?: string | null;
    notes?: string | null;
    templateId?: string | null;
}

export interface UpdateScheduleInput {
    scheduleId: string;
    date?: string;
    name?: string | null;
    notes?: string | null;
    templateId?: string | null;
}

export interface SetScheduleSkippedInput { scheduleId: string; skipped: boolean }
export interface StartScheduledWorkoutInput { scheduleId: string }

export interface LogWorkoutInput {
    date: string;
    name?: string | null;
    note?: string | null;
    templateId?: string | null;
    scheduleId?: string | null;
    durationMinutes?: number | null;
    rpe?: number | null;
    status?: "completed" | "in_progress" | "logged";
    startedAt?: string | null;
    endedAt?: string | null;
    weightUnit?: "kg" | "lb";
    exercises?: WorkoutExerciseInput[];
}

export interface WorkoutExerciseInput {
    exerciseId: string;
    note?: string | null;
    groupKey?: string | null;
    restSec?: number | null;
    tempo?: string | null;
    sets?: Array<{
        targetWeight?: number | null;
        targetReps?: number | null;
        targetSeconds?: number | null;
        targetMeters?: number | null;
        targetRpe?: number | null;
        weight?: number | null;
        reps?: number | null;
        seconds?: number | null;
        meters?: number | null;
        rpe?: number | null;
        restTakenSec?: number | null;
        warmup?: boolean;
        isAmrap?: boolean;
        completed?: boolean;
    }>;
}

export interface UpdateWorkoutInput extends LogWorkoutInput {
    workoutId: string;
    preserveLifecycle?: boolean;
}
export interface WorkoutLifecycleInput { workoutId: string }
export interface SetWorkoutPausedInput extends WorkoutLifecycleInput { paused: boolean }
export interface WorkoutLifecycleResult {
    id: string;
    date: string;
    status: WorkoutStatus;
    startedAt: string | null;
    endedAt: string | null;
    pausedAt: string | null;
    pausedMs: number;
    elapsedSeconds: number | null;
    durationSeconds: number | null;
}

export interface AddBodyMeasurementInput {
    date: string;
    weight?: number | null;
    weightUnit?: "kg" | "lb";
    bodyFatPct?: number | null;
    chestCm?: number | null;
    waistCm?: number | null;
    neckCm?: number | null;
    hipCm?: number | null;
    armLCm?: number | null;
    armRCm?: number | null;
    legLCm?: number | null;
    legRCm?: number | null;
    note?: string | null;
}
export interface UpdateBodyMeasurementInput extends AddBodyMeasurementInput { measurementId: string }

export interface CreateTrainingCycleInput {
    phase: "BULK" | "CUT" | "MAINTAIN";
    startDate: string;
    endDate?: string | null;
    note?: string | null;
}
export interface UpdateTrainingCycleInput extends CreateTrainingCycleInput { cycleId: string }
export interface DeleteTrainingCycleInput { cycleId: string }

export interface DeleteExerciseInput { exerciseId: string }
export interface DeleteTemplateInput { templateId: string }
export interface DeleteScheduleInput { scheduleId: string }
export interface DeleteWorkoutInput { workoutId: string }
export interface DeleteBodyMeasurementInput { measurementId: string }
export interface UploadProgressPhotoInput {
    fileName: string;
    mimeType: string;
    base64: string;
    takenAt?: string | null;
    angle?: "FRONT" | "SIDE" | "BACK" | null;
    phase?: "BULK" | "CUT" | "MAINTAIN" | null;
    weightKg?: number | null;
    notes?: string | null;
    workoutId?: string | null;
}
export interface UpdateProgressPhotoInput {
    photoId: string;
    takenAt?: string;
    angle?: "FRONT" | "SIDE" | "BACK" | null;
    phase?: "BULK" | "CUT" | "MAINTAIN" | null;
    weightKg?: number | null;
    notes?: string | null;
    workoutId?: string | null;
}
export interface DeleteProgressPhotoInput { photoId: string }

const WORKOUT_SELECT = {
    id: true,
    name: true,
    note: true,
    rpe: true,
    date: true,
    startedAt: true,
    endedAt: true,
    pausedMs: true,
    pausedAt: true,
    templateId: true,
    template: { select: { id: true, name: true } },
    exercises: {
        orderBy: { order: "asc" },
        select: {
            id: true,
            exerciseId: true,
            note: true,
            groupKey: true,
            restSec: true,
            tempo: true,
            exercise: { select: { name: true, muscles: true } },
            sets: {
                orderBy: { order: "asc" },
                select: {
                    id: true,
                    completed: true,
                    isWarmup: true,
                    targetWeight: true,
                    targetReps: true,
                    targetSeconds: true,
                    targetMeters: true,
                    targetRpe: true,
                    actualWeight: true,
                    actualReps: true,
                    actualSeconds: true,
                    actualMeters: true,
                    rpe: true,
                    restTakenSec: true,
                    isAmrap: true,
                },
            },
        },
    },
} satisfies Prisma.WorkoutSelect;

type WorkoutSource = Prisma.WorkoutGetPayload<{ select: typeof WORKOUT_SELECT }>;

const WORKOUT_CLOCK_SELECT = {
    id: true,
    date: true,
    startedAt: true,
    endedAt: true,
    pausedAt: true,
    pausedMs: true,
} satisfies Prisma.WorkoutSelect;

type WorkoutClockSource = Prisma.WorkoutGetPayload<{ select: typeof WORKOUT_CLOCK_SELECT }>;

const EXERCISE_SELECT = {
    id: true,
    userId: true,
    name: true,
    slug: true,
    muscles: true,
    secondaryMuscles: true,
    equipment: true,
    parentId: true,
    parent: { select: { name: true } },
    instructions: true,
    instructionSteps: true,
    notes: true,
    mediaUrl: true,
    mediaKey: true,
    images: true,
    force: true,
    level: true,
    mechanic: true,
    category: true,
    tracksReps: true,
    tracksWeight: true,
    tracksTime: true,
    tracksDistance: true,
} satisfies Prisma.ExerciseSelect;

const TEMPLATE_SELECT = {
    id: true,
    name: true,
    note: true,
    progression: true,
    progressionStepKg: true,
    cycleWeek: true,
    createdAt: true,
    updatedAt: true,
    exercises: {
        orderBy: { order: "asc" },
        select: {
            id: true,
            exerciseId: true,
            order: true,
            targetSets: true,
            targetReps: true,
            targetRepsMin: true,
            targetRepsMax: true,
            targetWeight: true,
            trainingMaxKg: true,
            targetTimeSec: true,
            targetDistanceM: true,
            targetRpe: true,
            restSec: true,
            groupKey: true,
            tempo: true,
            note: true,
            warmupSets: true,
            perSetMode: true,
            exercise: { select: { id: true, name: true, slug: true } },
            sets: {
                orderBy: { order: "asc" },
                select: {
                    id: true,
                    order: true,
                    targetReps: true,
                    targetRepsMin: true,
                    targetRepsMax: true,
                    targetWeight: true,
                    targetRpe: true,
                    isAmrap: true,
                    isWarmup: true,
                },
            },
        },
    },
    workouts: {
        where: { deletedAt: null },
        orderBy: { date: "desc" },
        take: 1,
        select: { id: true, date: true },
    },
} satisfies Prisma.TemplateSelect;

type TemplateSource = Prisma.TemplateGetPayload<{ select: typeof TEMPLATE_SELECT }>;

const KG_TO_LB = 2.2046226218;
const DAY_MS = 86_400_000;
const STALE_WORKOUT_MS = DAY_MS;

function isoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function unitSystemOf(value: WorkoutUnitSystem | null | undefined): WorkoutUnitSystem {
    return value ?? "IMPERIAL";
}

function weightUnit(unitSystem: WorkoutUnitSystem): "lb" | "kg" {
    return unitSystem === "IMPERIAL" ? "lb" : "kg";
}

async function inputWeightUnit(userId: string, value: unknown): Promise<"lb" | "kg"> {
    if (value !== undefined && value !== "lb" && value !== "kg") throw new Error("Weight unit is invalid.");
    if (value === "lb" || value === "kg") return value;
    const settings = await prisma.settings.findUnique({ where: { userId }, select: { unitSystem: true } });
    return weightUnit(unitSystemOf(settings?.unitSystem));
}

function weightToDisplay(valueKg: number, unitSystem: WorkoutUnitSystem): number {
    return round(unitSystem === "IMPERIAL" ? valueKg * KG_TO_LB : valueKg, 1);
}

function weightFromInput(value: unknown, unit: "kg" | "lb", label: string): number | null {
    const weight = optionalNumber(value, label, { min: 0, max: 2_000 });
    return weight === null ? null : unit === "lb" ? weight / KG_TO_LB : weight;
}

function round(value: number, digits = 0): number {
    const scale = 10 ** digits;
    return Math.round(value * scale) / scale;
}

function startOfWeek(date: Date): Date {
    const local = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    local.setDate(local.getDate() - ((local.getDay() + 6) % 7));
    return new Date(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate()));
}

function addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setUTCDate(result.getUTCDate() + days);
    return result;
}

function localCalendarDay(date = new Date()): Date {
    return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

function setVolume(set: WorkoutSource["exercises"][number]["sets"][number]): number {
    if (!set.completed || set.isWarmup) return 0;
    return Math.max(0, set.actualWeight ?? 0) * Math.max(0, set.actualReps ?? 0);
}

type WorkoutClock = Pick<WorkoutSource, "startedAt" | "endedAt" | "pausedAt" | "pausedMs">;

function elapsedMilliseconds(workout: WorkoutClock, now = new Date()): number | null {
    if (!workout.startedAt) return null;
    const stoppedAt = workout.endedAt ?? workout.pausedAt ?? now;
    return Math.max(0, stoppedAt.getTime() - workout.startedAt.getTime() - Math.max(0, workout.pausedMs));
}

function workoutStatus(workout: WorkoutClock, now = new Date()): WorkoutStatus {
    if (workout.endedAt) return "completed";
    if (!workout.startedAt) return "logged";
    const pausedFor = workout.pausedAt ? Math.max(0, now.getTime() - workout.pausedAt.getTime()) : 0;
    if (
        (elapsedMilliseconds(workout, now) ?? 0) >= STALE_WORKOUT_MS ||
        Math.max(0, workout.pausedMs) >= STALE_WORKOUT_MS ||
        pausedFor >= STALE_WORKOUT_MS
    ) {
        return "needs_review";
    }
    if (workout.pausedAt) return "paused";
    return "in_progress";
}

function durationSeconds(workout: WorkoutClock): number | null {
    if (!workout.startedAt || !workout.endedAt) return null;
    const milliseconds = elapsedMilliseconds(workout, workout.endedAt);
    return milliseconds === null ? null : Math.max(0, Math.floor(milliseconds / 1_000));
}

function durationMinutes(workout: WorkoutClock): number | null {
    const seconds = durationSeconds(workout);
    return seconds === null ? null : Math.max(0, Math.round(seconds / 60));
}

function workoutLifecycleResult(workout: WorkoutClockSource, now = new Date()): WorkoutLifecycleResult {
    const elapsed = elapsedMilliseconds(workout, now);
    return {
        id: workout.id,
        date: isoDate(workout.date),
        status: workoutStatus(workout, now),
        startedAt: workout.startedAt?.toISOString() ?? null,
        endedAt: workout.endedAt?.toISOString() ?? null,
        pausedAt: workout.pausedAt?.toISOString() ?? null,
        pausedMs: Math.max(0, workout.pausedMs),
        elapsedSeconds: elapsed === null ? null : Math.max(0, Math.floor(elapsed / 1_000)),
        durationSeconds: durationSeconds(workout),
    };
}

function workoutRow(workout: WorkoutSource, unitSystem: WorkoutUnitSystem): WorkoutSummaryRow {
    const completedSets = workout.exercises.flatMap((exercise) => exercise.sets).filter((set) => set.completed);
    const volumeKg = completedSets.reduce((sum, set) => sum + setVolume(set), 0);
    const status = workoutStatus(workout);
    const elapsed = elapsedMilliseconds(workout);
    return {
        id: workout.id,
        name: workout.name?.trim() || "Workout",
        note: workout.note,
        date: isoDate(workout.date),
        startedAt: workout.startedAt?.toISOString() ?? null,
        endedAt: workout.endedAt?.toISOString() ?? null,
        pausedAt: workout.pausedAt?.toISOString() ?? null,
        pausedMs: Math.max(0, workout.pausedMs),
        durationSeconds: durationSeconds(workout),
        elapsedSeconds: elapsed === null ? null : Math.max(0, Math.floor(elapsed / 1_000)),
        durationMinutes: durationMinutes(workout),
        status,
        rpe: workout.rpe,
        templateId: workout.templateId,
        templateName: workout.template?.name ?? null,
        exerciseCount: workout.exercises.length,
        exerciseIds: workout.exercises.map((exercise) => exercise.exerciseId),
        exerciseNames: workout.exercises.map((exercise) => exercise.exercise.name),
        workoutExerciseIds: workout.exercises.map((exercise) => exercise.id),
        exercises: workout.exercises.map((exercise) => ({
            id: exercise.id,
            exerciseId: exercise.exerciseId,
            name: exercise.exercise.name,
            note: exercise.note,
            groupKey: exercise.groupKey,
            restSec: exercise.restSec,
            tempo: exercise.tempo,
            sets: exercise.sets.map((set, index) => ({
                order: index + 1,
                targetWeight: set.targetWeight == null ? null : weightToDisplay(set.targetWeight, unitSystem),
                targetReps: set.targetReps,
                targetSeconds: set.targetSeconds,
                targetMeters: set.targetMeters,
                targetRpe: set.targetRpe,
                weight: set.actualWeight == null ? null : weightToDisplay(set.actualWeight, unitSystem),
                reps: set.actualReps,
                seconds: set.actualSeconds,
                meters: set.actualMeters,
                rpe: set.rpe,
                restTakenSec: set.restTakenSec,
                warmup: set.isWarmup,
                isAmrap: set.isAmrap,
                completed: set.completed,
            })),
        })),
        completedSets: completedSets.length,
        workingSets: completedSets.filter((set) => !set.isWarmup).length,
        volume: weightToDisplay(volumeKg, unitSystem),
    };
}

function recordRow(
    record: {
        id: string;
        exerciseId: string;
        recordType: string;
        value: number;
        unit: string | null;
        achievedOn: Date;
        notes: string | null;
        exercise: { name: string };
    },
    unitSystem: WorkoutUnitSystem,
): PersonalRecordRow {
    const normalizedType = record.recordType.trim().toLowerCase();
    const isWeight = normalizedType === "1rm" || normalizedType === "volume";
    const displayUnit = isWeight
        ? weightUnit(unitSystem)
        : normalizedType === "reps"
          ? "reps"
          : normalizedType === "time"
            ? "sec"
            : normalizedType === "distance"
              ? "m"
              : (record.unit ?? "");
    return {
        id: record.id,
        exerciseId: record.exerciseId,
        exerciseName: record.exercise.name,
        recordType: record.recordType,
        value: record.value,
        unit: record.unit,
        displayValue: isWeight ? weightToDisplay(record.value, unitSystem) : round(record.value, 1),
        displayUnit,
        achievedOn: isoDate(record.achievedOn),
        notes: record.notes,
    };
}

function weeklyTraining(workouts: WorkoutSource[], unitSystem: WorkoutUnitSystem, weeks = 12): WeeklyTrainingRow[] {
    const firstWeek = addDays(startOfWeek(new Date()), -(weeks - 1) * 7);
    const rows = new Map<string, { workouts: number; workingSets: number; volumeKg: number }>();
    for (let index = 0; index < weeks; index += 1) {
        rows.set(isoDate(addDays(firstWeek, index * 7)), { workouts: 0, workingSets: 0, volumeKg: 0 });
    }
    for (const workout of workouts) {
        if (workoutStatus(workout) === "needs_review") continue;
        const key = isoDate(startOfWeek(workout.date));
        const entry = rows.get(key);
        if (!entry) continue;
        entry.workouts += 1;
        for (const exercise of workout.exercises) {
            for (const set of exercise.sets) {
                if (set.completed && !set.isWarmup) entry.workingSets += 1;
                entry.volumeKg += setVolume(set);
            }
        }
    }
    return [...rows.entries()].map(([week, entry]) => ({
        week,
        workouts: entry.workouts,
        workingSets: entry.workingSets,
        volume: weightToDisplay(entry.volumeKg, unitSystem),
    }));
}

function muscleBalance(workouts: WorkoutSource[], since: Date): Array<{ muscle: string; sets: number }> {
    const counts = new Map<string, number>();
    for (const workout of workouts) {
        if (workout.date < since) continue;
        for (const exercise of workout.exercises) {
            const workingSets = exercise.sets.filter((set) => set.completed && !set.isWarmup).length;
            const muscles = exercise.exercise.muscles.length > 0 ? exercise.exercise.muscles : ["other"];
            for (const muscle of muscles) counts.set(muscle, (counts.get(muscle) ?? 0) + workingSets);
        }
    }
    return [...counts.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 12)
        .map(([muscle, sets]) => ({ muscle, sets }));
}

function mapCycle(
    cycle: { id: string; phase: string; startDate: Date; endDate: Date | null; note: string | null },
    today = new Date(),
): TrainingCycleRow {
    const todayKey = isoDate(localCalendarDay(today));
    const startKey = isoDate(cycle.startDate);
    const endKey = cycle.endDate ? isoDate(cycle.endDate) : null;
    const status = startKey > todayKey ? "upcoming" : endKey && endKey < todayKey ? "completed" : "active";
    return {
        id: cycle.id,
        phase: cycle.phase,
        startDate: startKey,
        endDate: endKey,
        note: cycle.note,
        day: status === "upcoming" ? 0 : Math.max(1, Math.floor((today.getTime() - cycle.startDate.getTime()) / DAY_MS) + 1),
        status,
    };
}

function scheduleStatus(
    date: string,
    skipped: boolean,
    workout: WorkoutClock | null,
    todayKey: string,
): SchedulePlanRow["status"] {
    if (workout) {
        const status = workoutStatus(workout);
        return status === "logged" ? "completed" : status;
    }
    if (skipped) return "skipped";
    return date < todayKey ? "missed" : "planned";
}

function adherence(plans: SchedulePlanRow[], sinceKey: string, throughKey: string): number | null {
    const eligible = plans.filter(
        (plan) =>
            plan.date >= sinceKey &&
            plan.date <= throughKey &&
            (plan.status === "completed" || plan.status === "missed" || plan.status === "skipped"),
    );
    if (eligible.length === 0) return null;
    return Math.round((eligible.filter((plan) => plan.status === "completed").length / eligible.length) * 100);
}

function templateRow(template: TemplateSource, unitSystem: WorkoutUnitSystem): TemplateRow {
    let totalSets = 0;
    let seconds = 0;
    const exercises = template.exercises.map((exercise) => {
        const setCount = exercise.perSetMode && exercise.sets.length > 0 ? exercise.sets.length : (exercise.targetSets ?? 0);
        totalSets += setCount;
        const activeSeconds = exercise.targetTimeSec == null
            ? setCount * 45
            : Math.max(1, setCount) * exercise.targetTimeSec;
        seconds += activeSeconds + Math.max(0, setCount - 1) * (exercise.restSec ?? 90);
        return {
            id: exercise.id,
            exerciseId: exercise.exerciseId,
            exerciseName: exercise.exercise.name,
            exerciseSlug: exercise.exercise.slug,
            order: exercise.order,
            targetSets: exercise.targetSets,
            targetReps: exercise.targetReps,
            targetRepsMin: exercise.targetRepsMin,
            targetRepsMax: exercise.targetRepsMax,
            targetWeight: exercise.targetWeight == null ? null : weightToDisplay(exercise.targetWeight, unitSystem),
            trainingMaxKg: exercise.trainingMaxKg,
            targetTimeSec: exercise.targetTimeSec,
            targetDistanceM: exercise.targetDistanceM,
            targetRpe: exercise.targetRpe,
            restSec: exercise.restSec,
            groupKey: exercise.groupKey,
            tempo: exercise.tempo,
            note: exercise.note,
            warmupSets: exercise.warmupSets,
            perSetMode: exercise.perSetMode,
            sets: exercise.sets.map((set) => ({
                ...set,
                targetWeight: set.targetWeight == null ? null : weightToDisplay(set.targetWeight, unitSystem),
            })),
        };
    });
    return {
        id: template.id,
        name: template.name,
        note: template.note,
        progression: template.progression,
        progressionStepKg: template.progressionStepKg,
        cycleWeek: template.cycleWeek,
        exerciseCount: exercises.length,
        totalSets,
        estimatedMinutes: seconds > 0 ? Math.max(1, Math.round(seconds / 60)) : 0,
        lastUsedOn: template.workouts[0] ? isoDate(template.workouts[0].date) : null,
        createdAt: template.createdAt.toISOString(),
        updatedAt: template.updatedAt.toISOString(),
        exercises,
    };
}

export async function getOverview(userId: string): Promise<WorkoutsOverviewDto> {
    const thisWeek = startOfWeek(new Date());
    const chartStart = addDays(thisWeek, -11 * 7);
    const previousWeek = addDays(thisWeek, -7);
    const today = localCalendarDay();
    const thirtyDaysAgo = addDays(today, -30);
    const todayKey = isoDate(today);
    const thirtyDaysKey = isoDate(thirtyDaysAgo);

    const [recentWorkouts, chartWorkouts, cycles, records, recentRecordCount, templates, schedules, settings] = await Promise.all([
        prisma.workout.findMany({
            where: { userId, deletedAt: null, isQuickLog: false },
            orderBy: [{ date: "desc" }, { createdAt: "desc" }],
            take: 8,
            select: WORKOUT_SELECT,
        }),
        prisma.workout.findMany({
            where: { userId, deletedAt: null, isQuickLog: false, date: { gte: chartStart, lte: today } },
            orderBy: { date: "asc" },
            select: WORKOUT_SELECT,
        }),
        prisma.trainingCycle.findMany({ where: { userId }, orderBy: { startDate: "desc" }, take: 20 }),
        prisma.personalRecord.findMany({
            where: { userId },
            orderBy: [{ achievedOn: "desc" }, { exercise: { name: "asc" } }, { recordType: "asc" }],
            take: 8,
            include: { exercise: { select: { name: true } } },
        }),
        prisma.personalRecord.count({ where: { userId, achievedOn: { gte: thirtyDaysAgo, lte: today } } }),
        prisma.template.findMany({ where: { userId, archived: false }, orderBy: { updatedAt: "desc" }, select: { id: true, name: true } }),
        prisma.workoutSchedule.findMany({
            where: { userId },
            orderBy: { date: "desc" },
            take: 250,
            select: {
                id: true,
                date: true,
                name: true,
                notes: true,
                skipped: true,
                workoutId: true,
                workout: { select: { startedAt: true, endedAt: true, pausedAt: true, pausedMs: true } },
                templateId: true,
                template: { select: { name: true } },
            },
        }),
        prisma.settings.findUnique({ where: { userId }, select: { unitSystem: true } }),
    ]);

    const unitSystem = unitSystemOf(settings?.unitSystem);
    const plans: SchedulePlanRow[] = schedules.map((plan) => {
        const date = isoDate(plan.date);
        const workoutId = plan.workoutId;
        return {
            id: plan.id,
            date,
            name: plan.name?.trim() || plan.template?.name || "Planned workout",
            notes: plan.notes,
            templateId: plan.templateId,
            templateName: plan.template?.name ?? null,
            workoutId,
            skipped: plan.skipped,
            status: scheduleStatus(date, plan.skipped, plan.workout, todayKey),
        };
    });

    const rows = chartWorkouts.map((workout) => workoutRow(workout, unitSystem));
    const thisWeekRows = rows.filter(
        (workout) => workout.date >= isoDate(thisWeek) && workout.date <= todayKey && workout.status !== "needs_review",
    );
    const previousWeekRows = rows.filter(
        (workout) =>
            workout.date >= isoDate(previousWeek) && workout.date < isoDate(thisWeek) && workout.status !== "needs_review",
    );
    const thisWeekVolume = thisWeekRows.reduce((sum, workout) => sum + workout.volume, 0);
    const previousWeekVolume = previousWeekRows.reduce((sum, workout) => sum + workout.volume, 0);
    const mappedCycles = cycles.map((cycle) => mapCycle(cycle));

    return {
        unitSystem,
        weightUnit: weightUnit(unitSystem),
        summary: {
            workoutsThisWeek: thisWeekRows.length,
            workoutsWeekDelta: thisWeekRows.length || previousWeekRows.length ? thisWeekRows.length - previousWeekRows.length : null,
            volumeThisWeek: round(thisWeekVolume, 1),
            volumeWeekDelta: thisWeekVolume || previousWeekVolume ? round(thisWeekVolume - previousWeekVolume, 1) : null,
            recentRecordCount,
            activeCycle: mappedCycles.find((cycle) => cycle.status === "active") ?? null,
            templateCount: templates.length,
            adherence30: adherence(plans, thirtyDaysKey, todayKey),
        },
        recentWorkouts: recentWorkouts.map((workout) => workoutRow(workout, unitSystem)),
        todaySchedule: plans
            .filter((plan) => plan.date === todayKey)
            .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)),
        upcomingSchedule: plans
            .filter((plan) => plan.status === "planned")
            .sort((left, right) => left.date.localeCompare(right.date))
            .slice(0, 8),
        recentRecords: records.map((record) => recordRow(record, unitSystem)),
        weeklyTraining: weeklyTraining(chartWorkouts, unitSystem),
        muscleBalance: muscleBalance(chartWorkouts, thirtyDaysAgo),
    };
}

export async function getLog(userId: string): Promise<WorkoutsLogDto> {
    const today = localCalendarDay();
    const thirtyDaysAgo = addDays(today, -30);
    const [workouts, recentWorkouts, totalSessions, templates, exerciseOptions, settings] = await Promise.all([
        prisma.workout.findMany({
            where: { userId, deletedAt: null, isQuickLog: false },
            orderBy: [{ date: "desc" }, { createdAt: "desc" }],
            take: 300,
            select: WORKOUT_SELECT,
        }),
        prisma.workout.findMany({
            where: { userId, deletedAt: null, isQuickLog: false, date: { gte: thirtyDaysAgo, lte: today } },
            orderBy: { date: "desc" },
            select: WORKOUT_SELECT,
        }),
        prisma.workout.count({ where: { userId, deletedAt: null, isQuickLog: false } }),
        prisma.template.findMany({ where: { userId, archived: false }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
        getExercises(userId),
        prisma.settings.findUnique({ where: { userId }, select: { unitSystem: true } }),
    ]);
    const unitSystem = unitSystemOf(settings?.unitSystem);
    const recentRows = recentWorkouts.map((workout) => workoutRow(workout, unitSystem));
    const durations = recentRows.map((workout) => workout.durationSeconds).filter((value): value is number => value !== null);
    return {
        unitSystem,
        weightUnit: weightUnit(unitSystem),
        summary: {
            totalSessions,
            sessionsLast30Days: recentRows.length,
            completedSetsLast30Days: recentRows.reduce((sum, workout) => sum + workout.completedSets, 0),
            volumeLast30Days: round(recentRows.reduce((sum, workout) => sum + workout.volume, 0), 1),
            averageDurationMinutes: durations.length
                ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length / 60)
                : null,
        },
        workouts: workouts.map((workout) => workoutRow(workout, unitSystem)),
        templates,
        exerciseOptions: exerciseOptions.exercises.map(({ id, name, lastPerformedOn, lastWorkoutName, previousSets, records }) => ({ id, name, lastPerformedOn, lastWorkoutName, previousSets, records })),
    };
}

export async function getSchedule(userId: string): Promise<WorkoutsScheduleDto> {
    const [schedules, templates] = await Promise.all([
        prisma.workoutSchedule.findMany({
            where: { userId },
            orderBy: { date: "desc" },
            take: 300,
            select: {
                id: true,
                date: true,
                name: true,
                notes: true,
                skipped: true,
                workoutId: true,
                workout: { select: { startedAt: true, endedAt: true, pausedAt: true, pausedMs: true } },
                templateId: true,
                template: { select: { name: true } },
            },
        }),
        prisma.template.findMany({ where: { userId, archived: false }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ]);
    const today = localCalendarDay();
    const todayKey = isoDate(today);
    const plans: SchedulePlanRow[] = schedules.map((schedule) => {
        const date = isoDate(schedule.date);
        const workoutId = schedule.workoutId;
        return {
            id: schedule.id,
            date,
            name: schedule.name?.trim() || schedule.template?.name || "Planned workout",
            notes: schedule.notes,
            templateId: schedule.templateId,
            templateName: schedule.template?.name ?? null,
            workoutId,
            skipped: schedule.skipped,
            status: scheduleStatus(date, schedule.skipped, schedule.workout, todayKey),
        };
    });
    const thirtyDaysKey = isoDate(addDays(today, -30));
    const nextWeekKey = isoDate(addDays(today, 7));
    const recent = plans.filter((plan) => plan.date >= thirtyDaysKey && plan.date <= todayKey);
    return {
        summary: {
            plannedNext7Days: plans.filter((plan) => plan.status === "planned" && plan.date <= nextWeekKey).length,
            completedLast30Days: recent.filter((plan) => plan.status === "completed").length,
            missedLast30Days: recent.filter((plan) => plan.status === "missed" || plan.status === "skipped").length,
            adherence30: adherence(plans, thirtyDaysKey, todayKey),
        },
        plans: plans.sort((left, right) => right.date.localeCompare(left.date)),
        templates,
    };
}

export async function getExercises(userId: string): Promise<WorkoutsExercisesDto> {
    const [exercises, usage, records, settings] = await Promise.all([
        prisma.exercise.findMany({
            where: { OR: [{ userId: null }, { userId }], archived: false },
            orderBy: { name: "asc" },
            select: EXERCISE_SELECT,
        }),
        prisma.workoutExercise.findMany({
            where: { workout: { userId, deletedAt: null } },
            orderBy: [{ workout: { date: "desc" } }, { order: "asc" }],
            select: {
                exerciseId: true,
                workout: { select: { date: true, name: true } },
                sets: { orderBy: { order: "asc" }, select: { actualWeight: true, actualReps: true, actualSeconds: true, actualMeters: true, completed: true } },
            },
        }),
        prisma.personalRecord.findMany({
            where: { userId },
            orderBy: { achievedOn: "desc" },
            include: { exercise: { select: { name: true } } },
        }),
        prisma.settings.findUnique({ where: { userId }, select: { unitSystem: true } }),
    ]);
    const unitSystem = unitSystemOf(settings?.unitSystem);
    const usageCounts = new Map<string, number>();
    for (const item of usage) usageCounts.set(item.exerciseId, (usageCounts.get(item.exerciseId) ?? 0) + 1);
    const previousByExercise = new Map<string, (typeof usage)[number]>();
    for (const item of usage) if (!previousByExercise.has(item.exerciseId)) previousByExercise.set(item.exerciseId, item);
    const recordsByExercise = new Map<string, PersonalRecordRow[]>();
    for (const record of records) {
        const rows = recordsByExercise.get(record.exerciseId) ?? [];
        rows.push(recordRow(record, unitSystem));
        recordsByExercise.set(record.exerciseId, rows);
    }
    const rows: ExerciseLibraryRow[] = exercises.map((exercise) => {
        const previous = previousByExercise.get(exercise.id);
        return ({
        id: exercise.id,
        slug: exercise.slug,
        name: exercise.name,
        muscles: exercise.muscles,
        secondaryMuscles: exercise.secondaryMuscles,
        equipment: exercise.equipment,
        level: exercise.level,
        category: exercise.category,
        force: exercise.force,
        mechanic: exercise.mechanic,
        instructions: exercise.instructions,
        instructionSteps: exercise.instructionSteps,
        notes: exercise.notes,
        images: exercise.images,
        mediaKey: exercise.mediaKey,
        mediaUrl: exercise.mediaUrl,
        imageUrl: resolveAssetUrl(exercise.mediaKey) ?? resolveAssetUrl(exercise.mediaUrl),
        custom: exercise.userId === userId,
        parentId: exercise.parentId,
        parentName: exercise.parent?.name ?? null,
        tracksReps: exercise.tracksReps,
        tracksWeight: exercise.tracksWeight,
        tracksTime: exercise.tracksTime,
        tracksDistance: exercise.tracksDistance,
        useCount: usageCounts.get(exercise.id) ?? 0,
        records: recordsByExercise.get(exercise.id) ?? [],
        lastPerformedOn: previous ? isoDate(previous.workout.date) : null,
        lastWorkoutName: previous?.workout.name?.trim() || null,
        previousSets: (previous?.sets ?? []).filter((set) => set.completed).map((set) => ({
            weight: set.actualWeight == null ? null : weightToDisplay(set.actualWeight, unitSystem),
            reps: set.actualReps,
            seconds: set.actualSeconds,
            meters: set.actualMeters,
        })),
    });
    });
    return {
        unitSystem,
        weightUnit: weightUnit(unitSystem),
        summary: {
            total: rows.length,
            custom: rows.filter((exercise) => exercise.custom).length,
            used: rows.filter((exercise) => exercise.useCount > 0).length,
            withRecords: rows.filter((exercise) => exercise.records.length > 0).length,
        },
        exercises: rows,
    };
}

export async function getExercisesNew(userId: string): Promise<{
    unitSystem: WorkoutUnitSystem;
    weightUnit: "lb" | "kg";
    parents: Array<{ id: string; name: string; slug: string }>;
    options: { muscles: string[]; equipment: string[]; categories: string[]; levels: string[]; forces: string[]; mechanics: string[] };
    trackingPresets: Array<{ id: string; label: string; tracksReps: boolean; tracksWeight: boolean; tracksTime: boolean; tracksDistance: boolean }>;
}> {
    const [library, settings] = await Promise.all([
        prisma.exercise.findMany({
            where: { OR: [{ userId: null }, { userId }], archived: false },
            orderBy: { name: "asc" },
            select: { id: true, name: true, slug: true, muscles: true, secondaryMuscles: true, equipment: true, category: true, level: true, force: true, mechanic: true },
        }),
        prisma.settings.findUnique({ where: { userId }, select: { unitSystem: true } }),
    ]);
    const unique = (values: Array<string | null | undefined>) => [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
    const unitSystem = unitSystemOf(settings?.unitSystem);
    return {
        unitSystem,
        weightUnit: weightUnit(unitSystem),
        parents: library.map(({ id, name, slug }) => ({ id, name, slug })),
        options: {
            muscles: unique(library.flatMap((exercise) => [...exercise.muscles, ...exercise.secondaryMuscles])),
            equipment: unique(library.flatMap((exercise) => exercise.equipment)),
            categories: unique(library.map((exercise) => exercise.category)),
            levels: unique(library.map((exercise) => exercise.level)),
            forces: unique(library.map((exercise) => exercise.force)),
            mechanics: unique(library.map((exercise) => exercise.mechanic)),
        },
        trackingPresets: [
            { id: "strength", label: "Weight and reps", tracksReps: true, tracksWeight: true, tracksTime: false, tracksDistance: false },
            { id: "bodyweight", label: "Reps only", tracksReps: true, tracksWeight: false, tracksTime: false, tracksDistance: false },
            { id: "timed", label: "Timed", tracksReps: false, tracksWeight: false, tracksTime: true, tracksDistance: false },
            { id: "distance", label: "Distance and time", tracksReps: false, tracksWeight: false, tracksTime: true, tracksDistance: true },
        ],
    };
}

export async function getTemplates(userId: string): Promise<WorkoutsTemplatesDto> {
    const [templates, settings, exerciseOptions] = await Promise.all([
        prisma.template.findMany({ where: { userId, archived: false }, orderBy: { updatedAt: "desc" }, select: TEMPLATE_SELECT }),
        prisma.settings.findUnique({ where: { userId }, select: { unitSystem: true } }),
        prisma.exercise.findMany({
            where: { archived: false, OR: [{ userId: null }, { userId }] },
            orderBy: { name: "asc" },
            select: { id: true, name: true },
        }),
    ]);
    const unitSystem = unitSystemOf(settings?.unitSystem);
    const rows = templates.map((template) => templateRow(template, unitSystem));
    return {
        unitSystem,
        weightUnit: weightUnit(unitSystem),
        summary: {
            total: rows.length,
            withProgression: rows.filter((template) => template.progression !== "NONE").length,
            totalExercises: rows.reduce((sum, template) => sum + template.exerciseCount, 0),
            used: rows.filter((template) => template.lastUsedOn !== null).length,
        },
        templates: rows,
        exerciseOptions,
    };
}

export async function getTemplatesNew(userId: string): Promise<{
    unitSystem: WorkoutUnitSystem;
    weightUnit: "lb" | "kg";
    library: Array<{ id: string; name: string; slug: string; muscles: string[]; equipment: string[]; tracksReps: boolean; tracksWeight: boolean; tracksTime: boolean; tracksDistance: boolean }>;
    progressionSchemes: Array<{ id: string; label: string }>;
    defaults: { restSec: number; targetSets: number; targetReps: number };
}> {
    const [library, settings] = await Promise.all([
        prisma.exercise.findMany({
            where: { OR: [{ userId: null }, { userId }], archived: false },
            orderBy: { name: "asc" },
            select: { id: true, name: true, slug: true, muscles: true, equipment: true, tracksReps: true, tracksWeight: true, tracksTime: true, tracksDistance: true },
        }),
        prisma.settings.findUnique({ where: { userId }, select: { unitSystem: true } }),
    ]);
    const unitSystem = unitSystemOf(settings?.unitSystem);
    return {
        unitSystem,
        weightUnit: weightUnit(unitSystem),
        library,
        progressionSchemes: [
            { id: "NONE", label: "No progression" },
            { id: "LINEAR", label: "Linear" },
            { id: "DOUBLE", label: "Double progression" },
            { id: "FIVETHREEONE", label: "5/3/1" },
        ],
        defaults: { restSec: 90, targetSets: 3, targetReps: 8 },
    };
}

export async function getBody(userId: string): Promise<WorkoutsBodyDto> {
    const chartStart = addDays(startOfWeek(new Date()), -11 * 7);
    const today = localCalendarDay();
    const thirtyDaysAgo = addDays(today, -30);
    const [measurements, measurementCount, cycles, records, workouts, settings] = await Promise.all([
        prisma.bodyMeasurement.findMany({ where: { userId }, orderBy: { date: "desc" }, take: 180 }),
        prisma.bodyMeasurement.count({ where: { userId } }),
        prisma.trainingCycle.findMany({ where: { userId }, orderBy: { startDate: "desc" }, take: 50 }),
        prisma.personalRecord.findMany({
            where: { userId },
            orderBy: [{ exercise: { name: "asc" } }, { achievedOn: "desc" }],
            include: { exercise: { select: { name: true } } },
        }),
        prisma.workout.findMany({
            where: { userId, deletedAt: null, date: { gte: chartStart, lte: today } },
            orderBy: { date: "asc" },
            select: WORKOUT_SELECT,
        }),
        prisma.settings.findUnique({ where: { userId }, select: { unitSystem: true } }),
    ]);
    const unitSystem = unitSystemOf(settings?.unitSystem);
    const measurementRows: BodyMeasurementRow[] = measurements.map((measurement) => ({
        id: measurement.id,
        date: isoDate(measurement.date),
        weightKg: measurement.weightKg,
        displayWeight: measurement.weightKg === null ? null : weightToDisplay(measurement.weightKg, unitSystem),
        bodyFatPct: measurement.bodyFatPct,
        chestCm: measurement.chestCm,
        waistCm: measurement.waistCm,
        neckCm: measurement.neckCm,
        hipCm: measurement.hipCm,
        armLCm: measurement.armLCm,
        armRCm: measurement.armRCm,
        legLCm: measurement.legLCm,
        legRCm: measurement.legRCm,
        note: measurement.note,
    }));
    const mappedCycles = cycles.map((cycle) => mapCycle(cycle));
    const weightMeasurements = measurementRows.filter((measurement) => measurement.displayWeight !== null);
    const fatMeasurements = measurementRows.filter((measurement) => measurement.bodyFatPct !== null);

    const groupedRecords = new Map<string, BodyPersonalRecordRow>();
    for (const record of records) {
        const current = groupedRecords.get(record.exerciseId) ?? {
            exerciseId: record.exerciseId,
            exerciseName: record.exercise.name,
            recordIds: [],
            oneRm: null,
            volume: null,
            reps: null,
            time: null,
            distance: null,
            lastAchievedOn: isoDate(record.achievedOn),
        };
        current.recordIds.push(record.id);
        const key = record.recordType.toLowerCase();
        if (key === "1rm") {
            const value = weightToDisplay(record.value, unitSystem);
            current.oneRm = current.oneRm === null ? value : Math.max(current.oneRm, value);
        } else if (key === "volume") {
            const value = weightToDisplay(record.value, unitSystem);
            current.volume = current.volume === null ? value : Math.max(current.volume, value);
        } else if (key === "reps") {
            const value = round(record.value, 1);
            current.reps = current.reps === null ? value : Math.max(current.reps, value);
        } else if (key === "time") {
            const value = round(record.value, 1);
            current.time = current.time === null ? value : Math.max(current.time, value);
        } else if (key === "distance") {
            const value = round(record.value, 1);
            current.distance = current.distance === null ? value : Math.max(current.distance, value);
        }
        if (isoDate(record.achievedOn) > current.lastAchievedOn) current.lastAchievedOn = isoDate(record.achievedOn);
        groupedRecords.set(record.exerciseId, current);
    }

    return {
        unitSystem,
        weightUnit: weightUnit(unitSystem),
        summary: {
            latestWeight: weightMeasurements[0]?.displayWeight ?? null,
            weightChange:
                weightMeasurements.length > 1
                    ? round((weightMeasurements[0].displayWeight ?? 0) - (weightMeasurements[1].displayWeight ?? 0), 1)
                    : null,
            latestBodyFatPct: fatMeasurements[0]?.bodyFatPct ?? null,
            bodyFatChange:
                fatMeasurements.length > 1 ? round((fatMeasurements[0].bodyFatPct ?? 0) - (fatMeasurements[1].bodyFatPct ?? 0), 1) : null,
            measurementCount,
            activeCycle: mappedCycles.find((cycle) => cycle.status === "active") ?? null,
        },
        measurements: measurementRows,
        cycles: mappedCycles,
        records: [...groupedRecords.values()].sort((left, right) => left.exerciseName.localeCompare(right.exerciseName)),
        weeklyTraining: weeklyTraining(workouts, unitSystem),
        muscleBalance: muscleBalance(workouts, thirtyDaysAgo),
    };
}

export async function getProgress(userId: string): Promise<WorkoutsProgressDto> {
    const [photos, photoCount, linkedWorkoutCount, photoRange, bodyWeights, workoutOptions, settings] = await Promise.all([
        prisma.progressPhoto.findMany({
            where: { userId },
            orderBy: { takenAt: "desc" },
            take: 300,
            select: {
                id: true,
                originalKey: true,
                thumbKey: true,
                angle: true,
                phase: true,
                takenAt: true,
                weightKg: true,
                notes: true,
                processed: true,
                workout: { select: { id: true, name: true, date: true } },
            },
        }),
        prisma.progressPhoto.count({ where: { userId } }),
        prisma.progressPhoto.count({ where: { userId, workoutId: { not: null } } }),
        prisma.progressPhoto.aggregate({ where: { userId }, _min: { takenAt: true }, _max: { takenAt: true } }),
        prisma.bodyMeasurement.findMany({
            where: { userId, weightKg: { not: null } },
            orderBy: { date: "desc" },
            take: 365,
            select: { date: true, weightKg: true },
        }),
        prisma.workout.findMany({
            where: { userId, deletedAt: null, isQuickLog: false },
            orderBy: [{ date: "desc" }, { createdAt: "desc" }],
            take: 50,
            select: { id: true, name: true, date: true },
        }),
        prisma.settings.findUnique({ where: { userId }, select: { unitSystem: true } }),
    ]);
    const unitSystem = unitSystemOf(settings?.unitSystem);
    const weights = new Map<string, number>();
    for (const measurement of bodyWeights) {
        if (measurement.weightKg !== null && !weights.has(isoDate(measurement.date))) weights.set(isoDate(measurement.date), measurement.weightKg);
    }
    for (const photo of photos) {
        if (photo.weightKg !== null && !weights.has(isoDate(photo.takenAt))) weights.set(isoDate(photo.takenAt), photo.weightKg);
    }
    const weightSeries = [...weights.entries()]
        .sort((left, right) => left[0].localeCompare(right[0]))
        .map(([date, weightKg]) => ({ date, weightKg, displayWeight: weightToDisplay(weightKg, unitSystem) }));

    const mappedPhotos: ProgressPhotoRow[] = photos.map((photo) => {
        let closestWeightKg: number | null = null;
        if (photo.weightKg === null) {
            let closestDistance = Number.POSITIVE_INFINITY;
            for (const weight of weightSeries) {
                const distance = Math.abs(photo.takenAt.getTime() - new Date(`${weight.date}T00:00:00.000Z`).getTime());
                if (distance <= 3 * DAY_MS && distance < closestDistance) {
                    closestDistance = distance;
                    closestWeightKg = weight.weightKg;
                }
            }
        }
        const effectiveWeight = photo.weightKg ?? closestWeightKg;
        return {
            id: photo.id,
            originalKey: photo.originalKey,
            thumbKey: photo.thumbKey,
            originalUrl: resolveAssetUrl(photo.originalKey) ?? "",
            thumbnailUrl: resolveAssetUrl(photo.thumbKey ?? photo.originalKey) ?? "",
            angle: photo.angle,
            phase: photo.phase,
            weightKg: photo.weightKg,
            closestWeightKg,
            displayWeight: effectiveWeight === null ? null : weightToDisplay(effectiveWeight, unitSystem),
            approximateWeight: photo.weightKg === null && closestWeightKg !== null,
            takenAt: photo.takenAt.toISOString(),
            notes: photo.notes,
            processed: photo.processed,
            workout: photo.workout
                ? { id: photo.workout.id, name: photo.workout.name?.trim() || "Workout", date: isoDate(photo.workout.date) }
                : null,
        };
    });
    const newest = photoRange._max.takenAt?.toISOString() ?? null;
    const oldest = photoRange._min.takenAt?.toISOString() ?? null;
    return {
        unitSystem,
        weightUnit: weightUnit(unitSystem),
        summary: {
            photoCount,
            linkedWorkoutCount,
            latestPhotoAt: newest,
            firstPhotoAt: oldest,
            timelineDays: newest && oldest ? Math.max(0, Math.round((new Date(newest).getTime() - new Date(oldest).getTime()) / DAY_MS)) : 0,
        },
        photos: mappedPhotos,
        workoutOptions: workoutOptions.map((workout) => ({
            id: workout.id,
            name: workout.name?.trim() || "Workout",
            date: isoDate(workout.date),
            label: `${isoDate(workout.date)} — ${workout.name?.trim() || "Workout"}`,
        })),
        weightSeries,
    };
}

function requiredText(value: unknown, label: string, maxLength = 120): string {
    if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} is required.`);
    const text = value.trim();
    if (text.length > maxLength) throw new Error(`${label} must be ${maxLength} characters or fewer.`);
    return text;
}

function optionalText(value: unknown, label: string, maxLength = 1_000): string | null {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value !== "string") throw new Error(`${label} must be text.`);
    const text = value.trim();
    if (text.length > maxLength) throw new Error(`${label} must be ${maxLength} characters or fewer.`);
    return text || null;
}

function dateOnly(value: unknown, label = "Date"): Date {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} must use YYYY-MM-DD.`);
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || isoDate(date) !== value) throw new Error(`${label} is invalid.`);
    return date;
}

function optionalNumber(
    value: unknown,
    label: string,
    options: { min?: number; max?: number } = {},
): number | null {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a number.`);
    if (options.min !== undefined && value < options.min) throw new Error(`${label} must be at least ${options.min}.`);
    if (options.max !== undefined && value > options.max) throw new Error(`${label} must be at most ${options.max}.`);
    return value;
}

function optionalInteger(
    value: unknown,
    label: string,
    options: { min?: number; max?: number } = {},
): number | null {
    const number = optionalNumber(value, label, options);
    if (number !== null && !Number.isInteger(number)) throw new Error(`${label} must be a whole number.`);
    return number;
}

function stringList(value: unknown, label: string): string[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${label} must be a list of text values.`);
    return [...new Set(value.map((item) => item.trim()).filter(Boolean))].slice(0, 30);
}

function optionalDateTime(value: unknown, label: string): Date | null {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value !== "string") throw new Error(`${label} must be a date and time.`);
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new Error(`${label} must be a valid date and time.`);
    return parsed;
}

async function explicitWorkoutExercises(
    userId: string,
    exercises: WorkoutExerciseInput[] | undefined,
    unit: "kg" | "lb",
    previousExercises: WorkoutSource["exercises"] = [],
) {
    if (exercises !== undefined && !Array.isArray(exercises)) throw new Error("Workout exercises must be a list.");
    const rows = Array.isArray(exercises) ? exercises.slice(0, 100) : [];
    const ids = [...new Set(rows.map((row) => requiredText(row.exerciseId, "Exercise id", 200)))];
    if (ids.length) {
        const allowed = await prisma.exercise.count({ where: { id: { in: ids }, archived: false, OR: [{ userId: null }, { userId }] } });
        if (allowed !== ids.length) throw new Error("One or more workout exercises are unavailable.");
    }
    const remainingPrevious = [...previousExercises];
    return rows.map((row, order) => {
        const previousIndex = remainingPrevious.findIndex((exercise) => exercise.exerciseId === row.exerciseId);
        const previous = previousIndex >= 0 ? remainingPrevious.splice(previousIndex, 1)[0] : undefined;
        if (row.sets !== undefined && !Array.isArray(row.sets)) throw new Error("Workout sets must be a list.");
        const suppliedSets = Array.isArray(row.sets) ? row.sets.slice(0, 100) : undefined;
        const sets = suppliedSets
            ? suppliedSets.map((set, setOrder) => {
                  const previousSet = previous?.sets[setOrder];
                  return {
                      id: previousSet?.id,
                      order: setOrder,
                      targetWeight:
                          set.targetWeight === undefined
                              ? previousSet?.targetWeight ?? null
                              : weightFromInput(set.targetWeight, unit, "Target weight"),
                      targetReps:
                          set.targetReps === undefined
                              ? previousSet?.targetReps ?? null
                              : optionalInteger(set.targetReps, "Target reps", { min: 0, max: 100_000 }),
                      targetSeconds:
                          set.targetSeconds === undefined
                              ? previousSet?.targetSeconds ?? null
                              : optionalInteger(set.targetSeconds, "Target time", { min: 0, max: 604_800 }),
                      targetMeters:
                          set.targetMeters === undefined
                              ? previousSet?.targetMeters ?? null
                              : optionalNumber(set.targetMeters, "Target distance", { min: 0, max: 10_000_000 }),
                      targetRpe:
                          set.targetRpe === undefined
                              ? previousSet?.targetRpe ?? null
                              : optionalNumber(set.targetRpe, "Target RPE", { min: 0, max: 10 }),
                      actualWeight:
                          set.weight === undefined
                              ? previousSet?.actualWeight ?? null
                              : weightFromInput(set.weight, unit, "Set weight"),
                      actualReps:
                          set.reps === undefined
                              ? previousSet?.actualReps ?? null
                              : optionalInteger(set.reps, "Set reps", { min: 0, max: 100_000 }),
                      actualSeconds:
                          set.seconds === undefined
                              ? previousSet?.actualSeconds ?? null
                              : optionalInteger(set.seconds, "Set time", { min: 0, max: 604_800 }),
                      actualMeters:
                          set.meters === undefined
                              ? previousSet?.actualMeters ?? null
                              : optionalNumber(set.meters, "Set distance", { min: 0, max: 10_000_000 }),
                      rpe:
                          set.rpe === undefined
                              ? previousSet?.rpe ?? null
                              : optionalNumber(set.rpe, "Set RPE", { min: 0, max: 10 }),
                      restTakenSec:
                          set.restTakenSec === undefined
                              ? previousSet?.restTakenSec ?? null
                              : optionalInteger(set.restTakenSec, "Rest taken", { min: 0, max: 86_400 }),
                      isWarmup: set.warmup === undefined ? previousSet?.isWarmup ?? false : set.warmup,
                      isAmrap: set.isAmrap === undefined ? previousSet?.isAmrap ?? false : set.isAmrap,
                      completed: set.completed === undefined ? previousSet?.completed ?? true : set.completed,
                  };
              })
            : (previous?.sets ?? []).map((set, setOrder) => ({
                  id: set.id,
                  order: setOrder,
                  targetWeight: set.targetWeight,
                  targetReps: set.targetReps,
                  targetSeconds: set.targetSeconds,
                  targetMeters: set.targetMeters,
                  targetRpe: set.targetRpe,
                  actualWeight: set.actualWeight,
                  actualReps: set.actualReps,
                  actualSeconds: set.actualSeconds,
                  actualMeters: set.actualMeters,
                  rpe: set.rpe,
                  restTakenSec: set.restTakenSec,
                  isWarmup: set.isWarmup,
                  isAmrap: set.isAmrap,
                  completed: set.completed,
              }));
        return {
            id: previous?.id,
            exerciseId: row.exerciseId,
            order,
            note: row.note === undefined ? previous?.note ?? null : optionalText(row.note, "Exercise notes"),
            groupKey: row.groupKey === undefined ? previous?.groupKey ?? null : optionalText(row.groupKey, "Exercise group", 40),
            restSec:
                row.restSec === undefined
                    ? previous?.restSec ?? null
                    : optionalInteger(row.restSec, "Rest time", { min: 0, max: 86_400 }),
            tempo: row.tempo === undefined ? previous?.tempo ?? null : optionalText(row.tempo, "Exercise tempo", 40),
            sets: { create: sets },
        };
    });
}

type RecordCandidate = {
    exerciseId: string;
    recordType: "1RM" | "volume" | "reps" | "time" | "distance";
    value: number;
    unit: "kg" | "reps" | "sec" | "m";
    achievedOn: Date;
    notes: string;
};

const DERIVED_RECORD_PREFIX = "[coretex:workout-pr:";

function recordKey(exerciseId: string, recordType: string): string {
    return `${exerciseId}:${recordType.toLowerCase()}`;
}

/**
 * Personal records are an authoritative materialized view of completed
 * working sets in finished, non-deleted workouts. Rebuilding the view replaces
 * every prior row, including legacy rows that predate the source marker, so a
 * deleted or edited workout can never leave a stale personal best behind.
 */
async function recomputePersonalRecordsInTransaction(transaction: Prisma.TransactionClient, userId: string): Promise<number> {
    const sets = await transaction.setEntry.findMany({
        where: {
            completed: true,
            isWarmup: false,
            workoutExercise: {
                workout: {
                    userId,
                    deletedAt: null,
                    OR: [{ endedAt: { not: null } }, { startedAt: null }],
                },
            },
        },
        select: {
            actualWeight: true,
            actualReps: true,
            actualSeconds: true,
            actualMeters: true,
            workoutExercise: {
                select: {
                    exerciseId: true,
                    exercise: { select: { name: true } },
                    workout: { select: { id: true, name: true, date: true } },
                },
            },
        },
    });

    const best = new Map<string, RecordCandidate>();
    const consider = (candidate: RecordCandidate) => {
        if (!Number.isFinite(candidate.value) || candidate.value <= 0) return;
        const key = recordKey(candidate.exerciseId, candidate.recordType);
        const current = best.get(key);
        if (
            !current ||
            candidate.value > current.value ||
            (candidate.value === current.value && candidate.achievedOn < current.achievedOn)
        ) {
            best.set(key, candidate);
        }
    };

    for (const set of sets) {
        const source = set.workoutExercise;
        const notes = `${DERIVED_RECORD_PREFIX}${source.workout.id}] Recorded in ${source.workout.name?.trim() || source.exercise.name}`;
        const base = { exerciseId: source.exerciseId, achievedOn: source.workout.date, notes };
        if (set.actualWeight != null && set.actualWeight > 0 && set.actualReps != null && set.actualReps > 0) {
            consider({ ...base, recordType: "1RM", value: set.actualWeight * (1 + set.actualReps / 30), unit: "kg" });
            consider({ ...base, recordType: "volume", value: set.actualWeight * set.actualReps, unit: "kg" });
        }
        if (set.actualReps != null) consider({ ...base, recordType: "reps", value: set.actualReps, unit: "reps" });
        if (set.actualSeconds != null) consider({ ...base, recordType: "time", value: set.actualSeconds, unit: "sec" });
        if (set.actualMeters != null) consider({ ...base, recordType: "distance", value: set.actualMeters, unit: "m" });
    }

    const derivedRecords = [...best.values()];

    await transaction.personalRecord.deleteMany({ where: { userId } });
    if (derivedRecords.length > 0) {
        await transaction.personalRecord.createMany({
            data: derivedRecords.map((record) => ({ userId, ...record })),
        });
    }
    return derivedRecords.length;
}

export async function recomputePersonalRecords(userId: string): Promise<{ count: number }> {
    const count = await prisma.$transaction((transaction) => recomputePersonalRecordsInTransaction(transaction, userId));
    return { count };
}

async function uniqueExerciseSlug(name: string, userId: string): Promise<string> {
    const base = name
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60) || "exercise";
    const owner = userId.replace(/[^a-z0-9]/gi, "").slice(-8).toLowerCase() || "local";
    for (let index = 0; index < 100; index += 1) {
        const suffix = index === 0 ? owner : `${owner}-${index + 1}`;
        const slug = `${base}-${suffix}`;
        if (!(await prisma.exercise.findUnique({ where: { slug }, select: { id: true } }))) return slug;
    }
    throw new Error("Could not create a unique exercise name. Try a more specific name.");
}

export async function createExercise(userId: string, input: CreateExerciseInput): Promise<{ id: string; name: string; slug: string }> {
    if (!input || typeof input !== "object") throw new Error("Exercise details are required.");
    const name = requiredText(input.name, "Exercise name");
    const muscles = stringList(input.muscles, "Muscles");
    const equipment = stringList(input.equipment, "Equipment");
    const slug = await uniqueExerciseSlug(name, userId);
    const exercise = await prisma.exercise.create({
        data: {
            userId,
            name,
            slug,
            muscles,
            equipment,
            category: optionalText(input.category, "Category", 80),
            notes: optionalText(input.notes, "Notes"),
            tracksReps: input.tracksReps ?? true,
            tracksWeight: input.tracksWeight ?? true,
            tracksTime: input.tracksTime ?? false,
            tracksDistance: input.tracksDistance ?? false,
        },
        select: { id: true, name: true, slug: true },
    });
    return exercise;
}

export async function updateExercise(userId: string, input: UpdateExerciseInput): Promise<{ id: string; name: string; slug: string }> {
    if (!input || typeof input !== "object") throw new Error("Exercise details are required.");
    const id = requiredText(input.exerciseId, "Exercise id", 200);
    const existing = await prisma.exercise.findFirst({ where: { id, userId, archived: false }, select: { id: true } });
    if (!existing) throw new Error("Custom exercise not found.");
    return prisma.exercise.update({
        where: { id },
        data: {
            name: requiredText(input.name, "Exercise name"),
            muscles: stringList(input.muscles, "Muscles"),
            equipment: stringList(input.equipment, "Equipment"),
            category: optionalText(input.category, "Category", 80),
            notes: optionalText(input.notes, "Notes"),
            tracksReps: input.tracksReps ?? true,
            tracksWeight: input.tracksWeight ?? true,
            tracksTime: input.tracksTime ?? false,
            tracksDistance: input.tracksDistance ?? false,
        },
        select: { id: true, name: true, slug: true },
    });
}

/** Custom exercises are archived so historical workouts and records remain intact. */
export async function deleteExercise(userId: string, input: DeleteExerciseInput): Promise<{ id: string; archived: true }> {
    const id = requiredText(input?.exerciseId, "Exercise id", 200);
    const exercise = await prisma.exercise.findFirst({ where: { id, userId }, select: { id: true } });
    if (!exercise) throw new Error("Custom exercise not found.");
    await prisma.exercise.update({ where: { id }, data: { archived: true, archivedAt: new Date() } });
    return { id, archived: true };
}

async function templateExerciseWrites(
    userId: string,
    exercises: CreateTemplateInput["exercises"],
    unit: "kg" | "lb",
    previousExercises: TemplateSource["exercises"] = [],
): Promise<Prisma.TemplateExerciseUncheckedCreateWithoutTemplateInput[]> {
    if (exercises !== undefined && !Array.isArray(exercises)) throw new Error("Template exercises must be a list.");
    const rows = (exercises ?? []).slice(0, 50).map((exercise) => ({
        ...exercise,
        exerciseId: requiredText(exercise.exerciseId, "Exercise id", 200),
    }));
    const exerciseIds = [...new Set(rows.map((exercise) => exercise.exerciseId))];
    if (exerciseIds.length > 0) {
        const allowed = await prisma.exercise.count({
            where: { id: { in: exerciseIds }, archived: false, OR: [{ userId: null }, { userId }] },
        });
        if (allowed !== exerciseIds.length) throw new Error("One or more template exercises are unavailable.");
    }

    const remainingPrevious = [...previousExercises];
    return rows.map((exercise, order) => {
        const suppliedId = exercise.id === undefined ? null : requiredText(exercise.id, "Template exercise id", 200);
        let previousIndex = suppliedId ? remainingPrevious.findIndex((candidate) => candidate.id === suppliedId) : -1;
        if (previousIndex < 0) previousIndex = remainingPrevious.findIndex((candidate) => candidate.exerciseId === exercise.exerciseId);
        const previous = previousIndex >= 0 ? remainingPrevious.splice(previousIndex, 1)[0] : undefined;

        if (exercise.sets !== undefined && !Array.isArray(exercise.sets)) throw new Error("Template sets must be a list.");
        const remainingPreviousSets = [...(previous?.sets ?? [])];
        const suppliedSets = Array.isArray(exercise.sets) ? exercise.sets.slice(0, 100) : undefined;
        const sets: Prisma.TemplateSetUncheckedCreateWithoutTemplateExerciseInput[] = suppliedSets
            ? suppliedSets.map((set, setOrder) => {
                  const suppliedSetId = set.id === undefined ? null : requiredText(set.id, "Template set id", 200);
                  let previousSetIndex = suppliedSetId
                      ? remainingPreviousSets.findIndex((candidate) => candidate.id === suppliedSetId)
                      : -1;
                  if (previousSetIndex < 0 && remainingPreviousSets.length > 0) previousSetIndex = 0;
                  const previousSet = previousSetIndex >= 0 ? remainingPreviousSets.splice(previousSetIndex, 1)[0] : undefined;
                  const targetReps =
                      set.targetReps === undefined
                          ? previousSet?.targetReps ?? null
                          : optionalInteger(set.targetReps, "Set target reps", { min: 1, max: 10_000 });
                  const targetRepsMin =
                      set.targetRepsMin === undefined
                          ? previousSet?.targetRepsMin ?? null
                          : optionalInteger(set.targetRepsMin, "Set minimum reps", { min: 1, max: 10_000 });
                  const targetRepsMax =
                      set.targetRepsMax === undefined
                          ? previousSet?.targetRepsMax ?? null
                          : optionalInteger(set.targetRepsMax, "Set maximum reps", { min: 1, max: 10_000 });
                  if (targetRepsMin !== null && targetRepsMax !== null && targetRepsMin > targetRepsMax) {
                      throw new Error("Set minimum reps cannot exceed maximum reps.");
                  }
                  if (set.isAmrap !== undefined && typeof set.isAmrap !== "boolean") throw new Error("AMRAP must be true or false.");
                  if (set.isWarmup !== undefined && typeof set.isWarmup !== "boolean") throw new Error("Warm-up must be true or false.");
                  return {
                      id: previousSet?.id,
                      order: setOrder,
                      targetReps,
                      targetRepsMin,
                      targetRepsMax,
                      targetWeight:
                          set.targetWeight === undefined
                              ? previousSet?.targetWeight ?? null
                              : weightFromInput(set.targetWeight, unit, "Set target weight"),
                      targetRpe:
                          set.targetRpe === undefined
                              ? previousSet?.targetRpe ?? null
                              : optionalNumber(set.targetRpe, "Set target RPE", { min: 0, max: 10 }),
                      isAmrap: set.isAmrap ?? previousSet?.isAmrap ?? false,
                      isWarmup: set.isWarmup ?? previousSet?.isWarmup ?? false,
                  };
              })
            : (previous?.sets ?? []).map((set) => ({
                  id: set.id,
                  order: set.order,
                  targetReps: set.targetReps,
                  targetRepsMin: set.targetRepsMin,
                  targetRepsMax: set.targetRepsMax,
                  targetWeight: set.targetWeight,
                  targetRpe: set.targetRpe,
                  isAmrap: set.isAmrap,
                  isWarmup: set.isWarmup,
              }));

        const targetReps =
            exercise.targetReps === undefined
                ? previous?.targetReps ?? null
                : optionalInteger(exercise.targetReps, "Target reps", { min: 1, max: 10_000 });
        const targetRepsMin =
            exercise.targetRepsMin === undefined
                ? previous?.targetRepsMin ?? null
                : optionalInteger(exercise.targetRepsMin, "Minimum reps", { min: 1, max: 10_000 });
        const targetRepsMax =
            exercise.targetRepsMax === undefined
                ? previous?.targetRepsMax ?? null
                : optionalInteger(exercise.targetRepsMax, "Maximum reps", { min: 1, max: 10_000 });
        if (targetRepsMin !== null && targetRepsMax !== null && targetRepsMin > targetRepsMax) {
            throw new Error("Minimum reps cannot exceed maximum reps.");
        }
        if (exercise.perSetMode !== undefined && typeof exercise.perSetMode !== "boolean") {
            throw new Error("Per-set mode must be true or false.");
        }
        const warmupSets = exercise.warmupSets === undefined ? previous?.warmupSets : exercise.warmupSets;
        return {
            id: previous?.id,
            exerciseId: exercise.exerciseId,
            order,
            targetSets:
                exercise.targetSets === undefined
                    ? previous?.targetSets ?? null
                    : optionalInteger(exercise.targetSets, "Target sets", { min: 1, max: 100 }),
            targetReps,
            targetRepsMin,
            targetRepsMax,
            targetWeight:
                exercise.targetWeight === undefined
                    ? previous?.targetWeight ?? null
                    : weightFromInput(exercise.targetWeight, unit, "Target weight"),
            trainingMaxKg:
                exercise.trainingMaxKg === undefined
                    ? previous?.trainingMaxKg ?? null
                    : optionalNumber(exercise.trainingMaxKg, "Training max", { min: 0, max: 2_000 }),
            targetTimeSec:
                exercise.targetTimeSec === undefined
                    ? previous?.targetTimeSec ?? null
                    : optionalInteger(exercise.targetTimeSec, "Target time", { min: 0, max: 604_800 }),
            targetDistanceM:
                exercise.targetDistanceM === undefined
                    ? previous?.targetDistanceM ?? null
                    : optionalNumber(exercise.targetDistanceM, "Target distance", { min: 0, max: 10_000_000 }),
            targetRpe:
                exercise.targetRpe === undefined
                    ? previous?.targetRpe ?? null
                    : optionalNumber(exercise.targetRpe, "Target RPE", { min: 0, max: 10 }),
            restSec:
                exercise.restSec === undefined
                    ? previous?.restSec ?? null
                    : optionalInteger(exercise.restSec, "Rest time", { min: 0, max: 86_400 }),
            groupKey:
                exercise.groupKey === undefined
                    ? previous?.groupKey ?? null
                    : optionalText(exercise.groupKey, "Exercise group", 40),
            tempo: exercise.tempo === undefined ? previous?.tempo ?? null : optionalText(exercise.tempo, "Exercise tempo", 40),
            note: exercise.note === undefined ? previous?.note ?? null : optionalText(exercise.note, "Exercise notes"),
            warmupSets: warmupSets == null ? undefined : (warmupSets as Prisma.InputJsonValue),
            perSetMode: exercise.perSetMode ?? previous?.perSetMode ?? Boolean(suppliedSets?.length),
            sets: sets.length > 0 ? { create: sets } : undefined,
        };
    });
}

export async function createTemplate(userId: string, input: CreateTemplateInput): Promise<{ id: string; name: string }> {
    if (!input || typeof input !== "object") throw new Error("Template details are required.");
    const name = requiredText(input.name, "Template name");
    const progression = input.progression ?? "NONE";
    if (!["NONE", "LINEAR", "DOUBLE", "FIVETHREEONE"].includes(progression)) throw new Error("Progression scheme is invalid.");
    const inputUnit = await inputWeightUnit(userId, input.weightUnit);
    const exercises = await templateExerciseWrites(userId, input.exercises, inputUnit);
    const template = await prisma.template.create({
        data: {
            userId,
            name,
            note: optionalText(input.note, "Notes"),
            progression,
            progressionStepKg: optionalNumber(input.progressionStepKg, "Progression step", { min: 0, max: 2_000 }),
            cycleWeek: optionalInteger(input.cycleWeek, "Cycle week", { min: 1, max: 100 }),
            exercises: exercises.length > 0 ? { create: exercises } : undefined,
        },
        select: { id: true, name: true },
    });
    return template;
}

export async function updateTemplate(userId: string, input: UpdateTemplateInput): Promise<{ id: string; name: string }> {
    if (!input || typeof input !== "object") throw new Error("Template details are required.");
    const id = requiredText(input.templateId, "Template id", 200);
    const existing = await prisma.template.findFirst({ where: { id, userId, archived: false }, select: TEMPLATE_SELECT });
    if (!existing) throw new Error("Template not found.");
    const name = requiredText(input.name, "Template name");
    const progression = input.progression ?? existing.progression;
    if (!["NONE", "LINEAR", "DOUBLE", "FIVETHREEONE"].includes(progression)) throw new Error("Progression scheme is invalid.");
    const inputUnit = await inputWeightUnit(userId, input.weightUnit);
    const exercises = input.exercises === undefined
        ? undefined
        : await templateExerciseWrites(userId, input.exercises, inputUnit, existing.exercises);
    const updated = await prisma.$transaction(async (transaction) => {
        if (exercises !== undefined) await transaction.templateExercise.deleteMany({ where: { templateId: id } });
        return transaction.template.update({
            where: { id },
            data: {
                name,
                note: input.note === undefined ? existing.note : optionalText(input.note, "Notes"),
                progression,
                progressionStepKg:
                    input.progressionStepKg === undefined
                        ? existing.progressionStepKg
                        : optionalNumber(input.progressionStepKg, "Progression step", { min: 0, max: 2_000 }),
                cycleWeek:
                    input.cycleWeek === undefined
                        ? existing.cycleWeek
                        : optionalInteger(input.cycleWeek, "Cycle week", { min: 1, max: 100 }),
                exercises: exercises && exercises.length > 0 ? { create: exercises } : undefined,
            },
            select: { id: true, name: true },
        });
    });
    return updated;
}

/** Templates are archived so completed sessions retain their template attribution. */
export async function deleteTemplate(userId: string, input: DeleteTemplateInput): Promise<{ id: string; archived: true }> {
    const id = requiredText(input?.templateId, "Template id", 200);
    const template = await prisma.template.findFirst({ where: { id, userId }, select: { id: true } });
    if (!template) throw new Error("Template not found.");
    await prisma.template.update({ where: { id }, data: { archived: true } });
    return { id, archived: true };
}

export async function createSchedule(userId: string, input: CreateScheduleInput): Promise<{ id: string; date: string; name: string }> {
    if (!input || typeof input !== "object") throw new Error("Schedule details are required.");
    const date = dateOnly(input.date);
    const templateId = optionalText(input.templateId, "Template id", 200);
    let templateName: string | null = null;
    if (templateId) {
        const template = await prisma.template.findFirst({ where: { id: templateId, userId, archived: false }, select: { name: true } });
        if (!template) throw new Error("Template not found.");
        templateName = template.name;
    }
    const name = optionalText(input.name, "Schedule name", 120) ?? templateName ?? "Planned workout";
    const schedule = await prisma.workoutSchedule.create({
        data: { userId, date, name, notes: optionalText(input.notes, "Notes"), templateId },
        select: { id: true, date: true, name: true },
    });
    return { id: schedule.id, date: isoDate(schedule.date), name: schedule.name ?? name };
}

export async function updateSchedule(userId: string, input: UpdateScheduleInput): Promise<{ id: string; date: string; name: string }> {
    if (!input || typeof input !== "object") throw new Error("Schedule details are required.");
    const id = requiredText(input.scheduleId, "Schedule id", 200);
    const existing = await prisma.workoutSchedule.findFirst({
        where: { id, userId },
        select: {
            id: true,
            date: true,
            name: true,
            notes: true,
            templateId: true,
            workoutId: true,
            template: { select: { name: true } },
        },
    });
    if (!existing) throw new Error("Scheduled workout not found.");

    const date = input.date === undefined ? existing.date : dateOnly(input.date);
    const templateId = input.templateId === undefined ? existing.templateId : optionalText(input.templateId, "Template id", 200);
    let templateName = templateId === existing.templateId ? existing.template?.name ?? null : null;
    if (templateId && templateId !== existing.templateId) {
        const template = await prisma.template.findFirst({ where: { id: templateId, userId, archived: false }, select: { name: true } });
        if (!template) throw new Error("Template not found.");
        templateName = template.name;
    }
    if (existing.workoutId && (isoDate(date) !== isoDate(existing.date) || templateId !== existing.templateId)) {
        throw new Error("A started scheduled workout cannot change its date or template.");
    }

    const name = input.name === undefined ? existing.name : optionalText(input.name, "Schedule name", 120);
    const notes = input.notes === undefined ? existing.notes : optionalText(input.notes, "Notes");
    const updated = await prisma.workoutSchedule.update({
        where: { id },
        data: { date, templateId, name, notes },
        select: { id: true, date: true, name: true },
    });
    return { id: updated.id, date: isoDate(updated.date), name: updated.name?.trim() || templateName || "Planned workout" };
}

export async function setScheduleSkipped(userId: string, input: SetScheduleSkippedInput): Promise<{ id: string; skipped: boolean }> {
    const id = requiredText(input?.scheduleId, "Schedule id", 200);
    if (typeof input?.skipped !== "boolean") throw new Error("Skipped must be true or false.");
    const schedule = await prisma.workoutSchedule.findFirst({ where: { id, userId }, select: { id: true, workoutId: true } });
    if (!schedule) throw new Error("Scheduled workout not found.");
    if (input.skipped && schedule.workoutId) throw new Error("A completed scheduled workout cannot be skipped.");
    await prisma.workoutSchedule.update({ where: { id }, data: { skipped: input.skipped } });
    return { id, skipped: input.skipped };
}

export async function startScheduledWorkout(
    userId: string,
    input: StartScheduledWorkoutInput,
): Promise<{ scheduleId: string; workoutId: string }> {
    const scheduleId = requiredText(input?.scheduleId, "Schedule id", 200);
    const plan = await prisma.workoutSchedule.findFirst({
        where: { id: scheduleId, userId },
        select: {
            id: true,
            date: true,
            name: true,
            notes: true,
            templateId: true,
            workoutId: true,
            template: {
                select: {
                    name: true,
                    exercises: {
                        orderBy: { order: "asc" },
                        select: {
                            exerciseId: true,
                            order: true,
                            note: true,
                            groupKey: true,
                            restSec: true,
                            tempo: true,
                            targetSets: true,
                            targetReps: true,
                            targetRepsMin: true,
                            targetRepsMax: true,
                            targetWeight: true,
                            targetTimeSec: true,
                            targetDistanceM: true,
                            targetRpe: true,
                            sets: {
                                orderBy: { order: "asc" },
                                select: {
                                    order: true,
                                    targetReps: true,
                                    targetRepsMin: true,
                                    targetRepsMax: true,
                                    targetWeight: true,
                                    targetRpe: true,
                                    isAmrap: true,
                                    isWarmup: true,
                                },
                            },
                        },
                    },
                },
            },
        },
    });
    if (!plan) throw new Error("Scheduled workout not found.");
    if (plan.workoutId) return { scheduleId: plan.id, workoutId: plan.workoutId };
    const today = localCalendarDay();
    const todayKey = isoDate(today);
    const planDateKey = isoDate(plan.date);
    if (planDateKey > todayKey) throw new Error("Scheduled workouts cannot be started before their scheduled date.");

    let workoutId: string;
    try {
        workoutId = await prisma.$transaction(async (transaction) => {
        const current = await transaction.workoutSchedule.findFirst({
            where: { id: plan.id, userId },
            select: { workoutId: true, date: true },
        });
        if (!current) throw new Error("Scheduled workout not found.");
        if (current.workoutId) return current.workoutId;
        const currentDateKey = isoDate(current.date);
        if (currentDateKey > todayKey) throw new Error("Scheduled workouts cannot be started before their scheduled date.");
        if (currentDateKey !== planDateKey) throw new Error("The schedule changed while it was being started. Try again.");

        const workout = await transaction.workout.create({
            data: {
                userId,
                // Starting a missed plan is a current workout, not a multi-day timer.
                date: currentDateKey < todayKey ? today : current.date,
                name: plan.name?.trim() || plan.template?.name || "Workout",
                note: plan.notes,
                templateId: plan.templateId,
                startedAt: new Date(),
                exercises: plan.template
                    ? {
                          create: plan.template.exercises.map((exercise) => {
                              const programmedSets = exercise.sets.length > 0
                                  ? exercise.sets
                                  : Array.from({ length: exercise.targetSets ?? 0 }, (_, order) => ({
                                        order,
                                        targetReps: exercise.targetReps,
                                        targetRepsMin: exercise.targetRepsMin,
                                        targetRepsMax: exercise.targetRepsMax,
                                        targetWeight: exercise.targetWeight,
                                        targetRpe: exercise.targetRpe,
                                        isAmrap: false,
                                        isWarmup: false,
                                    }));
                              return {
                                  exerciseId: exercise.exerciseId,
                                  order: exercise.order,
                                  note: exercise.note,
                                  groupKey: exercise.groupKey,
                                  restSec: exercise.restSec,
                                  tempo: exercise.tempo,
                                  sets: {
                                      create: programmedSets.map((set) => ({
                                          order: set.order,
                                          targetReps: set.targetReps ?? set.targetRepsMin ?? set.targetRepsMax,
                                          targetWeight: set.targetWeight,
                                          targetSeconds: exercise.targetTimeSec,
                                          targetMeters: exercise.targetDistanceM,
                                          targetRpe: set.targetRpe,
                                          isAmrap: set.isAmrap,
                                          isWarmup: set.isWarmup,
                                          completed: false,
                                      })),
                                  },
                              };
                          }),
                      }
                    : undefined,
            },
            select: { id: true },
        });
            const claimed = await transaction.workoutSchedule.updateMany({
                where: { id: plan.id, userId, workoutId: null },
                data: { workoutId: workout.id, skipped: false },
            });
            if (claimed.count !== 1) throw new Error("WORKOUT_SCHEDULE_ALREADY_STARTED");
            return workout.id;
        });
    } catch (error) {
        if (!(error instanceof Error) || error.message !== "WORKOUT_SCHEDULE_ALREADY_STARTED") throw error;
        const claimed = await prisma.workoutSchedule.findFirst({
            where: { id: plan.id, userId },
            select: { workoutId: true },
        });
        if (!claimed?.workoutId) throw new Error("The scheduled workout could not be started. Try again.");
        workoutId = claimed.workoutId;
    }

    return { scheduleId: plan.id, workoutId };
}

export async function deleteSchedule(userId: string, input: DeleteScheduleInput): Promise<{ id: string; deleted: true }> {
    const id = requiredText(input?.scheduleId, "Schedule id", 200);
    const schedule = await prisma.workoutSchedule.findFirst({ where: { id, userId }, select: { id: true } });
    if (!schedule) throw new Error("Scheduled workout not found.");
    await prisma.workoutSchedule.delete({ where: { id } });
    return { id, deleted: true };
}

export async function logWorkout(userId: string, input: LogWorkoutInput): Promise<{ id: string; name: string; date: string }> {
    if (!input || typeof input !== "object") throw new Error("Workout details are required.");
    const date = dateOnly(input.date);
    const templateId = optionalText(input.templateId, "Template id", 200);
    const scheduleId = optionalText(input.scheduleId, "Schedule id", 200);
    const duration = optionalNumber(input.durationMinutes, "Duration", { min: 0, max: 1_440 });
    const rpe = optionalNumber(input.rpe, "RPE", { min: 0, max: 10 });
    const inputUnit = await inputWeightUnit(userId, input.weightUnit);
    const explicitExercises = await explicitWorkoutExercises(userId, input.exercises, inputUnit);
    const template = templateId
        ? await prisma.template.findFirst({
              where: { id: templateId, userId, archived: false },
              select: {
                  id: true,
                  name: true,
                  exercises: {
                      orderBy: { order: "asc" },
                      select: {
                          exerciseId: true,
                          order: true,
                          note: true,
                          groupKey: true,
                          restSec: true,
                          tempo: true,
                          targetSets: true,
                          targetReps: true,
                          targetRepsMin: true,
                          targetRepsMax: true,
                          targetWeight: true,
                          targetTimeSec: true,
                          targetDistanceM: true,
                          targetRpe: true,
                          sets: {
                              orderBy: { order: "asc" },
                              select: {
                                  order: true,
                                  targetReps: true,
                                  targetRepsMin: true,
                                  targetRepsMax: true,
                                  targetWeight: true,
                                  targetRpe: true,
                                  isAmrap: true,
                                  isWarmup: true,
                              },
                          },
                      },
                  },
              },
          })
        : null;
    if (templateId && !template) throw new Error("Template not found.");
    const schedule = scheduleId
        ? await prisma.workoutSchedule.findFirst({
              where: { id: scheduleId, userId, workoutId: null },
              select: { id: true, date: true, templateId: true },
          })
        : null;
    if (scheduleId && !schedule) throw new Error("Scheduled workout not found or already completed.");
    if (schedule && isoDate(schedule.date) !== isoDate(date)) throw new Error("Workout date must match the scheduled date.");
    if (schedule?.templateId && templateId && schedule.templateId !== templateId) throw new Error("Workout template must match the scheduled template.");

    const name = optionalText(input.name, "Workout name", 120) ?? template?.name ?? "Workout";
    const status = input.status ?? "completed";
    if (!["completed", "in_progress", "logged"].includes(status)) throw new Error("Workout status is invalid.");
    const suppliedStart = optionalDateTime(input.startedAt, "Start time");
    const suppliedEnd = optionalDateTime(input.endedAt, "Finish time");
    const defaultEnd = new Date(`${isoDate(date)}T12:00:00.000Z`);
    const endedAt = status === "completed" ? suppliedEnd ?? defaultEnd : null;
    const startedAt = status === "logged" ? null : suppliedStart ?? (status === "in_progress" ? new Date() : duration === null ? null : new Date(endedAt!.getTime() - duration * 60_000));
    if (startedAt && endedAt && endedAt < startedAt) throw new Error("Finish time must be after start time.");
    const workout = await prisma.$transaction(async (transaction) => {
        const created = await transaction.workout.create({
            data: {
                userId,
                name,
                note: optionalText(input.note, "Notes"),
                rpe,
                date,
                templateId,
                startedAt,
                endedAt,
                exercises: explicitExercises.length
                    ? { create: explicitExercises }
                    : template
                    ? {
                          create: template.exercises.map((exercise) => {
                              const programmedSets = exercise.sets.length > 0
                                  ? exercise.sets
                                  : Array.from({ length: exercise.targetSets ?? 0 }, (_, order) => ({
                                        order,
                                        targetReps: exercise.targetReps,
                                        targetRepsMin: exercise.targetRepsMin,
                                        targetRepsMax: exercise.targetRepsMax,
                                        targetWeight: exercise.targetWeight,
                                        targetRpe: exercise.targetRpe,
                                        isAmrap: false,
                                        isWarmup: false,
                                    }));
                              return {
                                  exerciseId: exercise.exerciseId,
                                  order: exercise.order,
                                  note: exercise.note,
                                  groupKey: exercise.groupKey,
                                  restSec: exercise.restSec,
                                  tempo: exercise.tempo,
                                  sets: {
                                      create: programmedSets.map((set) => ({
                                          order: set.order,
                                          targetReps: set.targetReps ?? set.targetRepsMin ?? set.targetRepsMax,
                                          targetWeight: set.targetWeight,
                                          targetSeconds: exercise.targetTimeSec,
                                          targetMeters: exercise.targetDistanceM,
                                          targetRpe: set.targetRpe,
                                          isAmrap: set.isAmrap,
                                          isWarmup: set.isWarmup,
                                          completed: false,
                                      })),
                                  },
                              };
                          }),
                      }
                    : undefined,
            },
            select: { id: true, name: true, date: true },
        });
        if (schedule) await transaction.workoutSchedule.update({ where: { id: schedule.id }, data: { workoutId: created.id, skipped: false } });
        await recomputePersonalRecordsInTransaction(transaction, userId);
        return created;
    });
    return { id: workout.id, name: workout.name ?? name, date: isoDate(workout.date) };
}

export async function updateWorkout(userId: string, input: UpdateWorkoutInput): Promise<{ id: string; name: string; date: string }> {
    if (!input || typeof input !== "object") throw new Error("Workout details are required.");
    const id = requiredText(input.workoutId, "Workout id", 200);
    const existing = await prisma.workout.findFirst({ where: { id, userId, deletedAt: null }, select: WORKOUT_SELECT });
    if (!existing) throw new Error("Workout not found.");
    const date = dateOnly(input.date);
    const name = optionalText(input.name, "Workout name", 120) ?? "Workout";
    const duration = optionalNumber(input.durationMinutes, "Duration", { min: 0, max: 1_440 });
    const status = input.status ?? "completed";
    if (!["completed", "in_progress", "logged"].includes(status)) throw new Error("Workout status is invalid.");
    if (input.preserveLifecycle !== undefined && typeof input.preserveLifecycle !== "boolean") {
        throw new Error("Preserve lifecycle must be true or false.");
    }
    const preserveLifecycle = input.preserveLifecycle === true;
    if (
        preserveLifecycle &&
        (status !== "in_progress" ||
            existing.endedAt !== null ||
            existing.startedAt === null ||
            isoDate(existing.date) !== isoDate(date))
    ) {
        throw new Error("Only an unchanged open workout can preserve its lifecycle clock.");
    }
    const suppliedStart = optionalDateTime(input.startedAt, "Start time");
    const suppliedEnd = optionalDateTime(input.endedAt, "Finish time");
    const defaultEnd = new Date(`${isoDate(date)}T12:00:00.000Z`);
    const endedAt = status === "completed" ? suppliedEnd ?? defaultEnd : null;
    const startedAt =
        status === "logged"
            ? null
            : preserveLifecycle
              ? existing.startedAt
              : suppliedStart ??
              (status === "in_progress"
                  ? existing.startedAt ?? new Date()
                  : existing.startedAt ?? (duration === null ? null : new Date(endedAt!.getTime() - duration * 60_000)));
    if (startedAt && endedAt && endedAt < startedAt) throw new Error("Finish time must be after start time.");
    const sameOpenSession =
        status === "in_progress" &&
        existing.endedAt === null &&
        startedAt !== null &&
        (preserveLifecycle || existing.startedAt?.getTime() === startedAt.getTime());
    const pausedMs =
        status === "logged"
            ? 0
            : status === "in_progress"
              ? sameOpenSession
                  ? Math.max(0, existing.pausedMs)
                  : 0
              : Math.max(0, existing.pausedMs) +
                (existing.pausedAt && endedAt ? Math.max(0, endedAt.getTime() - existing.pausedAt.getTime()) : 0);
    const pausedAt = status === "in_progress" && sameOpenSession ? existing.pausedAt : null;
    if (
        status === "completed" &&
        elapsedMilliseconds({ startedAt, endedAt, pausedAt: null, pausedMs }, endedAt ?? undefined)! >= STALE_WORKOUT_MS
    ) {
        throw new Error("Workout duration must be less than 24 hours. Review the start and finish times before saving.");
    }
    const inputUnit = await inputWeightUnit(userId, input.weightUnit);
    const exercises = await explicitWorkoutExercises(userId, input.exercises, inputUnit, existing.exercises);
    const updated = await prisma.$transaction(async (transaction) => {
        if (Array.isArray(input.exercises)) await transaction.workoutExercise.deleteMany({ where: { workoutId: id } });
        const workout = await transaction.workout.update({
            where: { id },
            data: {
                name,
                note: optionalText(input.note, "Notes"),
                rpe: optionalNumber(input.rpe, "RPE", { min: 0, max: 10 }),
                date,
                startedAt,
                endedAt,
                pausedAt,
                pausedMs,
                templateId: existing.templateId,
                exercises: Array.isArray(input.exercises) && exercises.length ? { create: exercises } : undefined,
            },
            select: { id: true, name: true, date: true },
        });
        await recomputePersonalRecordsInTransaction(transaction, userId);
        return workout;
    });
    return { id: updated.id, name: updated.name ?? name, date: isoDate(updated.date) };
}

/** Pause is idempotent so a double click cannot create a second pause window. */
export async function pauseWorkout(userId: string, input: WorkoutLifecycleInput): Promise<WorkoutLifecycleResult> {
    const id = requiredText(input?.workoutId, "Workout id", 200);
    return prisma.$transaction(async (transaction) => {
        const workout = await transaction.workout.findFirst({
            where: { id, userId, deletedAt: null },
            select: WORKOUT_CLOCK_SELECT,
        });
        if (!workout) throw new Error("Workout not found.");
        const now = new Date();
        if (workout.endedAt) throw new Error("A completed workout cannot be paused.");
        if (!workout.startedAt) throw new Error("A logged workout has no running timer to pause.");
        if (workoutStatus(workout, now) === "needs_review") {
            throw new Error("This session needs review before its timer can change. Review its times or restart the timer.");
        }
        if (workout.pausedAt) return workoutLifecycleResult(workout, now);
        const updated = await transaction.workout.update({
            where: { id },
            data: { pausedAt: now },
            select: WORKOUT_CLOCK_SELECT,
        });
        return workoutLifecycleResult(updated, now);
    });
}

/** Resume folds exactly one pause window and is safe to repeat. */
export async function resumeWorkout(userId: string, input: WorkoutLifecycleInput): Promise<WorkoutLifecycleResult> {
    const id = requiredText(input?.workoutId, "Workout id", 200);
    return prisma.$transaction(async (transaction) => {
        const workout = await transaction.workout.findFirst({
            where: { id, userId, deletedAt: null },
            select: WORKOUT_CLOCK_SELECT,
        });
        if (!workout) throw new Error("Workout not found.");
        const now = new Date();
        if (workout.endedAt) throw new Error("A completed workout cannot be resumed.");
        if (!workout.startedAt) throw new Error("A logged workout has no running timer to resume.");
        if (workoutStatus(workout, now) === "needs_review") {
            throw new Error("This session needs review before its timer can change. Review its times or restart the timer.");
        }
        if (!workout.pausedAt) return workoutLifecycleResult(workout, now);
        const pausedMs = Math.max(0, workout.pausedMs) + Math.max(0, now.getTime() - workout.pausedAt.getTime());
        const updated = await transaction.workout.update({
            where: { id },
            data: { pausedAt: null, pausedMs },
            select: WORKOUT_CLOCK_SELECT,
        });
        return workoutLifecycleResult(updated, now);
    });
}

/** Compatibility command used by the current UI; delegates to the explicit lifecycle operations. */
export async function setWorkoutPaused(userId: string, input: SetWorkoutPausedInput): Promise<WorkoutLifecycleResult> {
    if (typeof input?.paused !== "boolean") throw new Error("Paused must be true or false.");
    return input.paused ? pauseWorkout(userId, input) : resumeWorkout(userId, input);
}

/** Finish a plausible live session and freeze its exact elapsed duration. */
export async function finishWorkout(userId: string, input: WorkoutLifecycleInput): Promise<WorkoutLifecycleResult> {
    const id = requiredText(input?.workoutId, "Workout id", 200);
    return prisma.$transaction(async (transaction) => {
        const workout = await transaction.workout.findFirst({
            where: { id, userId, deletedAt: null },
            select: WORKOUT_CLOCK_SELECT,
        });
        if (!workout) throw new Error("Workout not found.");
        if (workout.endedAt) {
            await recomputePersonalRecordsInTransaction(transaction, userId);
            return workoutLifecycleResult(workout, workout.endedAt);
        }
        if (!workout.startedAt) throw new Error("A logged workout has no running timer to finish.");
        if (workoutStatus(workout) === "needs_review") {
            throw new Error("This session has been open too long to finish safely. Review its times or restart the timer first.");
        }

        const now = new Date();
        const pausedMs =
            Math.max(0, workout.pausedMs) +
            (workout.pausedAt ? Math.max(0, now.getTime() - workout.pausedAt.getTime()) : 0);
        const updated = await transaction.workout.update({
            where: { id },
            data: { endedAt: now, pausedAt: null, pausedMs },
            select: WORKOUT_CLOCK_SELECT,
        });
        await recomputePersonalRecordsInTransaction(transaction, userId);
        return workoutLifecycleResult(updated, now);
    });
}

/** Reset an abandoned open session without discarding its programmed exercises. */
export async function restartWorkout(userId: string, input: WorkoutLifecycleInput): Promise<WorkoutLifecycleResult> {
    const id = requiredText(input?.workoutId, "Workout id", 200);
    return prisma.$transaction(async (transaction) => {
        const workout = await transaction.workout.findFirst({
            where: { id, userId, deletedAt: null },
            select: WORKOUT_CLOCK_SELECT,
        });
        if (!workout) throw new Error("Workout not found.");
        const now = new Date();
        if (workoutStatus(workout, now) !== "needs_review") {
            throw new Error("Only a workout that needs review can restart its timer.");
        }
        const updated = await transaction.workout.update({
            where: { id },
            data: { date: localCalendarDay(now), startedAt: now, endedAt: null, pausedAt: null, pausedMs: 0 },
            select: WORKOUT_CLOCK_SELECT,
        });
        await recomputePersonalRecordsInTransaction(transaction, userId);
        return workoutLifecycleResult(updated, now);
    });
}

/** Workout deletion is soft so accidental deletion can be recovered directly from the database. */
export async function deleteWorkout(userId: string, input: DeleteWorkoutInput): Promise<{ id: string; deleted: true }> {
    const id = requiredText(input?.workoutId, "Workout id", 200);
    const workout = await prisma.workout.findFirst({ where: { id, userId, deletedAt: null }, select: { id: true } });
    if (!workout) throw new Error("Workout not found.");
    await prisma.$transaction(async (transaction) => {
        await transaction.workoutSchedule.updateMany({ where: { userId, workoutId: id }, data: { workoutId: null } });
        await transaction.workout.update({ where: { id }, data: { deletedAt: new Date() } });
        await recomputePersonalRecordsInTransaction(transaction, userId);
    });
    return { id, deleted: true };
}

export async function addBodyMeasurement(userId: string, input: AddBodyMeasurementInput): Promise<{ id: string; date: string }> {
    if (!input || typeof input !== "object") throw new Error("Measurement details are required.");
    const date = dateOnly(input.date);
    const weight = optionalNumber(input.weight, "Weight", { min: 1, max: 2_000 });
    const inputUnit = await inputWeightUnit(userId, input.weightUnit);
    const weightKg = weight === null ? null : inputUnit === "lb" ? weight / KG_TO_LB : weight;
    const values = {
        bodyFatPct: optionalNumber(input.bodyFatPct, "Body fat", { min: 0, max: 100 }),
        chestCm: optionalNumber(input.chestCm, "Chest", { min: 0, max: 500 }),
        waistCm: optionalNumber(input.waistCm, "Waist", { min: 0, max: 500 }),
        neckCm: optionalNumber(input.neckCm, "Neck", { min: 0, max: 500 }),
        hipCm: optionalNumber(input.hipCm, "Hip", { min: 0, max: 500 }),
        armLCm: optionalNumber(input.armLCm, "Left arm", { min: 0, max: 500 }),
        armRCm: optionalNumber(input.armRCm, "Right arm", { min: 0, max: 500 }),
        legLCm: optionalNumber(input.legLCm, "Left leg", { min: 0, max: 500 }),
        legRCm: optionalNumber(input.legRCm, "Right leg", { min: 0, max: 500 }),
    };
    if (weightKg === null && Object.values(values).every((value) => value === null)) throw new Error("Enter at least one body measurement.");
    const measurement = await prisma.bodyMeasurement.create({
        data: { userId, date, weightKg, ...values, note: optionalText(input.note, "Notes") },
        select: { id: true, date: true },
    });
    return { id: measurement.id, date: isoDate(measurement.date) };
}

export async function updateBodyMeasurement(userId: string, input: UpdateBodyMeasurementInput): Promise<{ id: string; date: string }> {
    const id = requiredText(input?.measurementId, "Measurement id", 200);
    const existing = await prisma.bodyMeasurement.findFirst({ where: { id, userId }, select: { id: true } });
    if (!existing) throw new Error("Body measurement not found.");
    const date = dateOnly(input.date);
    const weight = optionalNumber(input.weight, "Weight", { min: 1, max: 2_000 });
    const inputUnit = await inputWeightUnit(userId, input.weightUnit);
    const weightKg = weight === null ? null : inputUnit === "lb" ? weight / KG_TO_LB : weight;
    const values = {
        bodyFatPct: optionalNumber(input.bodyFatPct, "Body fat", { min: 0, max: 100 }),
        chestCm: optionalNumber(input.chestCm, "Chest", { min: 0, max: 500 }),
        waistCm: optionalNumber(input.waistCm, "Waist", { min: 0, max: 500 }),
        neckCm: optionalNumber(input.neckCm, "Neck", { min: 0, max: 500 }),
        hipCm: optionalNumber(input.hipCm, "Hip", { min: 0, max: 500 }),
        armLCm: optionalNumber(input.armLCm, "Left arm", { min: 0, max: 500 }),
        armRCm: optionalNumber(input.armRCm, "Right arm", { min: 0, max: 500 }),
        legLCm: optionalNumber(input.legLCm, "Left leg", { min: 0, max: 500 }),
        legRCm: optionalNumber(input.legRCm, "Right leg", { min: 0, max: 500 }),
    };
    if (weightKg === null && Object.values(values).every((value) => value === null)) throw new Error("Enter at least one body measurement.");
    const measurement = await prisma.bodyMeasurement.update({
        where: { id },
        data: { date, weightKg, ...values, note: optionalText(input.note, "Notes") },
        select: { id: true, date: true },
    });
    return { id: measurement.id, date: isoDate(measurement.date) };
}

export async function deleteBodyMeasurement(userId: string, input: DeleteBodyMeasurementInput): Promise<{ id: string; deleted: true }> {
    const id = requiredText(input?.measurementId, "Measurement id", 200);
    const measurement = await prisma.bodyMeasurement.findFirst({ where: { id, userId }, select: { id: true } });
    if (!measurement) throw new Error("Body measurement not found.");
    await prisma.bodyMeasurement.delete({ where: { id } });
    return { id, deleted: true };
}

function trainingCycleValues(input: CreateTrainingCycleInput): {
    phase: CreateTrainingCycleInput["phase"];
    startDate: Date;
    endDate: Date | null;
    note: string | null;
} {
    if (!input || typeof input !== "object") throw new Error("Training cycle details are required.");
    if (!(["BULK", "CUT", "MAINTAIN"] as const).includes(input.phase)) throw new Error("Training phase is invalid.");
    const startDate = dateOnly(input.startDate, "Start date");
    const endDate = input.endDate === null || input.endDate === undefined || input.endDate === "" ? null : dateOnly(input.endDate, "End date");
    if (endDate && endDate < startDate) throw new Error("End date must be on or after the start date.");
    return { phase: input.phase, startDate, endDate, note: optionalText(input.note, "Notes") };
}

export async function createTrainingCycle(
    userId: string,
    input: CreateTrainingCycleInput,
): Promise<{ id: string; phase: string; startDate: string; endDate: string | null }> {
    const values = trainingCycleValues(input);
    const cycle = await prisma.trainingCycle.create({
        data: { userId, ...values },
        select: { id: true, phase: true, startDate: true, endDate: true },
    });
    return { id: cycle.id, phase: cycle.phase, startDate: isoDate(cycle.startDate), endDate: cycle.endDate ? isoDate(cycle.endDate) : null };
}

export async function updateTrainingCycle(
    userId: string,
    input: UpdateTrainingCycleInput,
): Promise<{ id: string; phase: string; startDate: string; endDate: string | null }> {
    const id = requiredText(input?.cycleId, "Training cycle id", 200);
    const existing = await prisma.trainingCycle.findFirst({ where: { id, userId }, select: { id: true } });
    if (!existing) throw new Error("Training cycle not found.");
    const values = trainingCycleValues(input);
    const cycle = await prisma.trainingCycle.update({
        where: { id },
        data: values,
        select: { id: true, phase: true, startDate: true, endDate: true },
    });
    return { id: cycle.id, phase: cycle.phase, startDate: isoDate(cycle.startDate), endDate: cycle.endDate ? isoDate(cycle.endDate) : null };
}

export async function deleteTrainingCycle(userId: string, input: DeleteTrainingCycleInput): Promise<{ id: string; deleted: true }> {
    const id = requiredText(input?.cycleId, "Training cycle id", 200);
    const cycle = await prisma.trainingCycle.findFirst({ where: { id, userId }, select: { id: true } });
    if (!cycle) throw new Error("Training cycle not found.");
    await prisma.trainingCycle.delete({ where: { id } });
    return { id, deleted: true };
}

const MAX_PROGRESS_PHOTO_BYTES = 25 * 1024 * 1024;
const PHOTO_MIME_EXTENSIONS: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
};

function progressPhotoDirectory(userId: string): string {
    const dataRoot = process.env.CORETEX_DATA_DIR?.trim() || join(homedir(), ".coretex");
    return resolve(dataRoot, "lifeos", "assets", userId, "workouts");
}

export async function uploadProgressPhoto(userId: string, input: UploadProgressPhotoInput): Promise<{ id: string; url: string }> {
    const mimeType = typeof input.mimeType === "string" ? input.mimeType.toLowerCase() : "";
    const fallbackExtension = PHOTO_MIME_EXTENSIONS[mimeType];
    if (!fallbackExtension) throw new Error("Progress photos must be JPEG, PNG, GIF, or WebP images.");
    if (typeof input.base64 !== "string" || !input.base64.trim()) throw new Error("Choose an image to upload.");
    const buffer = Buffer.from(input.base64.replace(/^data:[^;]+;base64,/i, ""), "base64");
    if (!buffer.length) throw new Error("The selected image is empty.");
    if (buffer.length > MAX_PROGRESS_PHOTO_BYTES) throw new Error("Progress photos must be 25 MB or smaller.");
    const workoutId = typeof input.workoutId === "string" && input.workoutId.trim() ? input.workoutId.trim() : null;
    if (workoutId) {
        const workout = await prisma.workout.findFirst({ where: { id: workoutId, userId, deletedAt: null }, select: { id: true } });
        if (!workout) throw new Error("The selected workout was not found.");
    }
    const takenAt = input.takenAt ? new Date(input.takenAt) : new Date();
    if (Number.isNaN(takenAt.getTime())) throw new Error("Choose a valid photo date.");
    const directory = progressPhotoDirectory(userId);
    await mkdir(directory, { recursive: true });
    const suppliedExtension = extname(input.fileName || "").toLowerCase();
    const extension = [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(suppliedExtension) ? suppliedExtension : fallbackExtension;
    const filePath = join(directory, `${Date.now()}-${randomUUID()}${extension}`);
    await writeFile(filePath, buffer, { flag: "wx" });
    try {
        const photo = await prisma.progressPhoto.create({
            data: {
                userId,
                originalKey: filePath,
                angle: input.angle ?? null,
                phase: input.phase ?? null,
                takenAt,
                weightKg: typeof input.weightKg === "number" && Number.isFinite(input.weightKg) ? input.weightKg : null,
                notes: typeof input.notes === "string" && input.notes.trim() ? input.notes.trim().slice(0, 4_000) : null,
                workoutId,
            },
            select: { id: true },
        });
        return { id: photo.id, url: resolveAssetUrl(filePath)! };
    } catch (error) {
        await unlink(filePath).catch(() => undefined);
        throw error;
    }
}

export async function updateProgressPhoto(
    userId: string,
    input: UpdateProgressPhotoInput,
): Promise<{ id: string; updated: true }> {
    if (!input || typeof input !== "object") throw new Error("Progress photo details are required.");
    const photoId = requiredText(input.photoId, "Progress photo id", 200);
    const photo = await prisma.progressPhoto.findFirst({ where: { id: photoId, userId }, select: { id: true } });
    if (!photo) throw new Error("Progress photo not found.");

    const data: Prisma.ProgressPhotoUncheckedUpdateInput = {};
    if (Object.prototype.hasOwnProperty.call(input, "takenAt")) {
        if (!input.takenAt) throw new Error("Photo date is required.");
        data.takenAt = optionalDateTime(input.takenAt, "Photo date")!;
    }
    if (Object.prototype.hasOwnProperty.call(input, "angle")) {
        if (input.angle !== null && !["FRONT", "SIDE", "BACK"].includes(input.angle as string)) throw new Error("Photo angle is invalid.");
        data.angle = input.angle ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(input, "phase")) {
        if (input.phase !== null && !["BULK", "CUT", "MAINTAIN"].includes(input.phase as string)) throw new Error("Training phase is invalid.");
        data.phase = input.phase ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(input, "weightKg")) {
        data.weightKg = optionalNumber(input.weightKg, "Weight", { min: 1, max: 2_000 });
    }
    if (Object.prototype.hasOwnProperty.call(input, "notes")) {
        data.notes = optionalText(input.notes, "Notes", 4_000);
    }
    if (Object.prototype.hasOwnProperty.call(input, "workoutId")) {
        const workoutId = optionalText(input.workoutId, "Workout id", 200);
        if (workoutId) {
            const workout = await prisma.workout.findFirst({ where: { id: workoutId, userId, deletedAt: null }, select: { id: true } });
            if (!workout) throw new Error("The selected workout was not found.");
        }
        data.workoutId = workoutId;
    }

    await prisma.progressPhoto.update({ where: { id: photo.id }, data });
    return { id: photo.id, updated: true };
}

export async function deleteProgressPhoto(userId: string, input: DeleteProgressPhotoInput): Promise<{ id: string; deleted: true }> {
    const photoId = typeof input.photoId === "string" ? input.photoId.trim() : "";
    if (!photoId) throw new Error("Progress photo id is required.");
    const photo = await prisma.progressPhoto.findFirst({ where: { id: photoId, userId }, select: { id: true, originalKey: true, thumbKey: true } });
    if (!photo) throw new Error("Progress photo not found.");
    await prisma.progressPhoto.delete({ where: { id: photo.id } });
    const directory = progressPhotoDirectory(userId);
    for (const key of [photo.originalKey, photo.thumbKey]) {
        if (!key) continue;
        const candidate = resolve(key);
        if (candidate.startsWith(`${directory}\\`) || candidate.startsWith(`${directory}/`)) await unlink(candidate).catch(() => undefined);
    }
    return { id: photo.id, deleted: true };
}
