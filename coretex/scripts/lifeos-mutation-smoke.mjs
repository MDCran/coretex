import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { bridgeProtocols } from "./bridge-smoke-auth.mjs";

if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = "postgresql://lifeos:lifeos@localhost:5450/lifeos?schema=public";
}

const prisma = new PrismaClient();
const url = process.env.CORETEX_WS_URL ?? "ws://127.0.0.1:8765";
const stamp = `${Date.now()}_${randomUUID()}`;
const userId = `codex_lifeos_smoke_${stamp}`;
const socket = new WebSocket(url, await bridgeProtocols(url));
const pending = new Map();
let sequence = 0;
let uploadedPhotoId = null;

socket.on("message", (raw) => {
    let message;
    try { message = JSON.parse(String(raw)); } catch { return; }
    if (!message.requestId || !pending.has(message.requestId)) return;
    const { resolve, reject, timer } = pending.get(message.requestId);
    clearTimeout(timer);
    pending.delete(message.requestId);
    if (message.error) reject(new Error(`${message.type}: ${message.error}`));
    else resolve(message.result);
});

const opened = new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
});

function request(type, payload = undefined) {
    const requestId = `lifeos_mutation_smoke_${++sequence}`;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pending.delete(requestId);
            reject(new Error(`${type}: timed out`));
        }, 20_000);
        pending.set(requestId, { resolve, reject, timer });
        socket.send(JSON.stringify({ type, requestId, userId, ...(payload ? { payload } : {}) }));
    });
}

function check(condition, message) {
    if (!condition) throw new Error(message);
}

async function step(label, action) {
    await action();
    process.stdout.write(`${label} ✓\n`);
}

function closeTo(actual, expected, tolerance = 0.2) {
    return typeof actual === "number" && Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
}

function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function localDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

try {
    await prisma.user.create({
        data: {
            id: userId,
            email: `${userId}@example.invalid`,
            name: "LifeOS mutation smoke",
            passwordHash: "temporary-smoke-account",
        },
    });
    await prisma.settings.create({ data: { userId, unitSystem: "IMPERIAL" } });
    await opened;
    // LifeOS calendar pages define "today" using the host's local calendar,
    // which can differ from the UTC date during evening hours in US time zones.
    const today = localDateKey();

    let account;
    let debt;
    await step("Financial", async () => {
        account = await request("financial:createAccount", { nickname: "Smoke checking", kind: "CHECKING", currentBalance: 1250, currency: "USD", isAsset: true, includeInNetWorth: true });
        await request("financial:createTransaction", { accountId: account.id, date: today, merchant: "Smoke merchant", amount: -12.34, pending: false });
        const transactionBaseTime = Date.now() - 60_000;
        await prisma.finTransaction.createMany({
            data: Array.from({ length: 505 }, (_, index) => ({
                userId,
                finAccountId: account.id,
                date: new Date(`${today}T00:00:00.000Z`),
                amount: -(index + 1) / 100,
                merchant: `Smoke paged merchant ${String(index).padStart(3, "0")}`,
                source: "MANUAL",
                createdAt: new Date(transactionBaseTime - index * 1_000),
            })),
        });
        const firstTransactionPage = await request("financial:getTransactions", { limit: 10_000, offset: 0 });
        const secondTransactionPage = await request("financial:getTransactions", { limit: 500, offset: 500 });
        check(firstTransactionPage.transactions.length === 500, "The transactions contract did not enforce its 500-row response cap.");
        check(firstTransactionPage.pagination?.limit === 500 && firstTransactionPage.pagination?.offset === 0 && firstTransactionPage.pagination?.total === 506 && firstTransactionPage.pagination?.hasMore === true, "The first transactions page returned incorrect pagination metadata.");
        check(secondTransactionPage.transactions.length === 6 && secondTransactionPage.pagination?.hasPrevious === true && secondTransactionPage.pagination?.hasMore === false, "The final transactions page returned incorrect rows or pagination metadata.");
        check(!secondTransactionPage.transactions.some((row) => firstTransactionPage.transactions.some((first) => first.id === row.id)), "Transaction pages overlapped.");
        debt = await request("financial:createDebt", { name: "Smoke loan", kind: "Personal loan", principalOriginal: 1000, principalRemaining: 750, apr: 7.5, minimumPayment: 50 });
        const view = await request("financial:getDebt");
        check(view.debts.some((row) => row.id === debt.id), "Created debt was not returned by financial:getDebt.");
    });

    let firstContact;
    await step("Social", async () => {
        const tag = await request("social:createTag", { name: "Smoke tag", color: "#7c3aed" });
        firstContact = await request("social:createContact", { displayName: "Smoke Person One", relationshipType: "friend", howWeMet: "Mutation smoke", tagIds: [tag.id] });
        const secondContact = await request("social:createContact", { displayName: "Smoke Person Two", relationshipType: "friend" });
        await request("social:createConnection", { contact1Id: firstContact.id, contact2Id: secondContact.id, relationshipType: "friends" });
        await request("social:createHandle", { contactId: firstContact.id, platform: "Instagram", handle: "@smoke" });
        await request("social:logInteraction", { contactId: firstContact.id, interactionType: "message", date: new Date().toISOString(), notes: "Write-path check" });
        await request("social:createEvent", { name: "Smoke event", eventDate: new Date().toISOString(), attendees: ["Smoke Person One"] });
        await request("social:createDraft", { contactId: firstContact.id, channel: "text", body: "Smoke draft" });
        await request("social:logBattery", { date: today, energyLevel: 8, notes: "Smoke check" });
        const canvas = await request("social:getCanvas");
        check(canvas.contacts.length === 2 && canvas.connections.length === 1, "Social canvas did not return the created graph.");
    });

    await step("Workouts", async () => {
        const exercise = await request("workouts:createExercise", { name: "Smoke press", muscles: ["chest"], equipment: ["dumbbell"] });
        await request("workouts:updateExercise", {
            exerciseId: exercise.id,
            name: "Smoke incline press",
            muscles: ["chest", "triceps"],
            equipment: ["dumbbell"],
            category: "strength",
            notes: "Updated by the mutation smoke",
            tracksReps: true,
            tracksWeight: true,
        });
        const exercisesView = await request("workouts:getExercises");
        check(exercisesView.exercises.some((row) => row.id === exercise.id && row.name === "Smoke incline press"), "Updated exercise was not returned by workouts:getExercises.");

        const template = await request("workouts:createTemplate", { name: "Smoke template", exercises: [{ exerciseId: exercise.id, targetSets: 3, targetReps: 8, targetWeight: 40, restSec: 60 }] });
        let templatesView = await request("workouts:getTemplates");
        let templateRow = templatesView.templates.find((row) => row.id === template.id);
        check(closeTo(templateRow?.exercises?.[0]?.targetWeight, 40), "An omitted template weight unit did not honor the user's IMPERIAL setting.");
        await request("workouts:updateTemplate", {
            templateId: template.id,
            name: "Smoke updated template",
            note: "Updated by the mutation smoke",
            progression: "DOUBLE",
            exercises: [{ exerciseId: exercise.id, targetSets: 4, targetReps: null, targetRepsMin: 8, targetRepsMax: 12, targetWeight: 45, restSec: 75 }],
        });
        templatesView = await request("workouts:getTemplates");
        templateRow = templatesView.templates.find((row) => row.id === template.id);
        check(templateRow?.name === "Smoke updated template", "Updated template was not returned by workouts:getTemplates.");
        check(closeTo(templateRow?.exercises?.[0]?.targetWeight, 45), "An omitted updated-template weight unit did not honor the user's IMPERIAL setting.");

        const unfinishedRecordWorkout = await request("workouts:logWorkout", {
            date: today,
            name: "Smoke unfinished record candidate",
            status: "in_progress",
            exercises: [{ exerciseId: exercise.id, sets: [{ weight: 500, reps: 20, completed: true }] }],
        });
        let unfinishedRecords = await request("workouts:getBody");
        check(
            !unfinishedRecords.records.some((row) => row.exerciseId === exercise.id),
            "A completed set inside an unfinished workout incorrectly created a personal record.",
        );
        await request("workouts:deleteWorkout", { workoutId: unfinishedRecordWorkout.id });

        const lifecycleWorkout = await request("workouts:logWorkout", {
            date: today,
            name: "Smoke live session",
            templateId: template.id,
            status: "in_progress",
        });
        let lifecycleLog = await request("workouts:getLog");
        let lifecycleRow = lifecycleLog.workouts.find((row) => row.id === lifecycleWorkout.id);
        check(lifecycleRow?.status === "in_progress", "A newly started current workout was not returned as in progress.");
        const programmedSet = lifecycleRow.exercises.flatMap((row) => row.sets)[0];
        check(programmedSet?.targetReps === 8, `Direct template start did not preserve the 8–12 rep-range fallback (received ${JSON.stringify(programmedSet ?? null)}).`);
        const lifecycleSet = await prisma.setEntry.findFirst({
            where: { workoutExercise: { workoutId: lifecycleWorkout.id } },
            orderBy: { order: "asc" },
            select: { id: true },
        });
        check(lifecycleSet, "The active workout did not create a set for rest-timer preservation coverage.");
        await prisma.setEntry.update({ where: { id: lifecycleSet.id }, data: { restTakenSec: 47 } });

        const firstPause = await request("workouts:setWorkoutPaused", { workoutId: lifecycleWorkout.id, paused: true });
        await delay(1_100);
        const secondPause = await request("workouts:setWorkoutPaused", { workoutId: lifecycleWorkout.id, paused: true });
        check(
            firstPause.status === "paused" &&
                secondPause.status === "paused" &&
                firstPause.pausedAt === secondPause.pausedAt &&
                firstPause.elapsedSeconds === secondPause.elapsedSeconds &&
                firstPause.pausedMs === secondPause.pausedMs,
            "Pausing twice was not idempotent or the elapsed timer advanced while paused.",
        );
        lifecycleLog = await request("workouts:getLog");
        lifecycleRow = lifecycleLog.workouts.find((row) => row.id === lifecycleWorkout.id);
        check(lifecycleRow?.status === "paused" && typeof lifecycleRow.pausedAt === "string" && lifecycleRow.elapsedSeconds >= 0, "Paused workout state was not returned by workouts:getLog.");
        const startedAtBeforeMetadataSave = lifecycleRow.startedAt;
        const pausedAtBeforeMetadataSave = lifecycleRow.pausedAt;
        const pausedMsBeforeMetadataSave = lifecycleRow.pausedMs;
        const elapsedSecondsBeforeMetadataSave = lifecycleRow.elapsedSeconds;
        const startedAtDate = new Date(lifecycleRow.startedAt);
        const minuteTruncatedStartedAt = new Date(startedAtDate.getTime() - startedAtDate.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
        await request("workouts:updateWorkout", {
            workoutId: lifecycleWorkout.id,
            date: today,
            name: "Smoke live session edited while paused",
            note: "Metadata-only save while paused",
            status: "in_progress",
            startedAt: minuteTruncatedStartedAt,
            endedAt: null,
            preserveLifecycle: true,
            rpe: lifecycleRow.rpe,
            weightUnit: lifecycleLog.weightUnit,
            exercises: lifecycleRow.exercises.map((workoutExercise) => ({
                exerciseId: workoutExercise.exerciseId,
                note: workoutExercise.note,
                restSec: workoutExercise.restSec,
                tempo: workoutExercise.tempo,
                groupKey: workoutExercise.groupKey,
                sets: workoutExercise.sets.map((set) => ({
                    weight: set.weight,
                    reps: set.reps,
                    seconds: set.seconds,
                    meters: set.meters,
                    rpe: set.rpe,
                    targetWeight: set.targetWeight,
                    targetReps: set.targetReps,
                    targetSeconds: set.targetSeconds,
                    targetMeters: set.targetMeters,
                    targetRpe: set.targetRpe,
                    warmup: set.warmup,
                    isAmrap: set.isAmrap,
                    completed: set.completed,
                })),
            })),
        });
        lifecycleLog = await request("workouts:getLog");
        lifecycleRow = lifecycleLog.workouts.find((row) => row.id === lifecycleWorkout.id);
        check(
            lifecycleRow?.name === "Smoke live session edited while paused" &&
                lifecycleRow.status === "paused" &&
                lifecycleRow.startedAt === startedAtBeforeMetadataSave &&
                lifecycleRow.endedAt === null &&
                lifecycleRow.pausedAt === pausedAtBeforeMetadataSave &&
                lifecycleRow.pausedMs === pausedMsBeforeMetadataSave &&
                lifecycleRow.elapsedSeconds === elapsedSecondsBeforeMetadataSave,
            "The UI-shaped workout edit did not preserve the exact active pause clock.",
        );
        const restTimerSet = lifecycleRow.exercises.flatMap((row) => row.sets)[0];
        const persistedRestTimerSet = await prisma.setEntry.findFirst({
            where: { workoutExercise: { workoutId: lifecycleWorkout.id, exerciseId: exercise.id } },
            orderBy: { order: "asc" },
            select: { restTakenSec: true },
        });
        check(
            restTimerSet?.restTakenSec === 47 && persistedRestTimerSet?.restTakenSec === 47,
            `Editing unrelated workout details did not preserve the set rest timer (API ${JSON.stringify(restTimerSet?.restTakenSec ?? null)}, storage ${JSON.stringify(persistedRestTimerSet?.restTakenSec ?? null)}).`,
        );

        const firstResume = await request("workouts:setWorkoutPaused", { workoutId: lifecycleWorkout.id, paused: false });
        const secondResume = await request("workouts:setWorkoutPaused", { workoutId: lifecycleWorkout.id, paused: false });
        check(
            firstResume.status === "in_progress" &&
                secondResume.status === "in_progress" &&
                firstResume.pausedAt === null &&
                secondResume.pausedAt === null &&
                firstResume.pausedMs >= firstPause.pausedMs + 900 &&
                secondResume.pausedMs === firstResume.pausedMs,
            "Resuming twice was not idempotent or did not persist the completed pause window.",
        );
        lifecycleLog = await request("workouts:getLog");
        lifecycleRow = lifecycleLog.workouts.find((row) => row.id === lifecycleWorkout.id);
        check(lifecycleRow?.status === "in_progress" && lifecycleRow.pausedAt === null && lifecycleRow.pausedMs >= 0, "Resumed workout state was not returned by workouts:getLog.");
        const startedAtBeforeResumedSave = lifecycleRow.startedAt;
        const pausedMsBeforeResumedSave = lifecycleRow.pausedMs;
        const resumedStartedAtDate = new Date(lifecycleRow.startedAt);
        const minuteTruncatedResumedStartedAt = new Date(resumedStartedAtDate.getTime() - resumedStartedAtDate.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
        await request("workouts:updateWorkout", {
            workoutId: lifecycleWorkout.id,
            date: today,
            name: "Smoke live session edited after resume",
            note: "UI-shaped save after resume",
            status: "in_progress",
            startedAt: minuteTruncatedResumedStartedAt,
            endedAt: null,
            preserveLifecycle: true,
            rpe: lifecycleRow.rpe,
            weightUnit: lifecycleLog.weightUnit,
            exercises: lifecycleRow.exercises.map((workoutExercise) => ({
                exerciseId: workoutExercise.exerciseId,
                note: workoutExercise.note,
                restSec: workoutExercise.restSec,
                tempo: workoutExercise.tempo,
                groupKey: workoutExercise.groupKey,
                sets: workoutExercise.sets.map((set) => ({
                    weight: set.weight,
                    reps: set.reps,
                    seconds: set.seconds,
                    meters: set.meters,
                    rpe: set.rpe,
                    restTakenSec: set.restTakenSec,
                    targetWeight: set.targetWeight,
                    targetReps: set.targetReps,
                    targetSeconds: set.targetSeconds,
                    targetMeters: set.targetMeters,
                    targetRpe: set.targetRpe,
                    warmup: set.warmup,
                    isAmrap: set.isAmrap,
                    completed: set.completed,
                })),
            })),
        });
        lifecycleLog = await request("workouts:getLog");
        lifecycleRow = lifecycleLog.workouts.find((row) => row.id === lifecycleWorkout.id);
        const resumedRestTimerSet = lifecycleRow?.exercises.flatMap((row) => row.sets)[0];
        const persistedResumedRestTimerSet = await prisma.setEntry.findFirst({
            where: { workoutExercise: { workoutId: lifecycleWorkout.id, exerciseId: exercise.id } },
            orderBy: { order: "asc" },
            select: { restTakenSec: true },
        });
        check(
            lifecycleRow?.name === "Smoke live session edited after resume" &&
                lifecycleRow.status === "in_progress" &&
                lifecycleRow.startedAt === startedAtBeforeResumedSave &&
                lifecycleRow.endedAt === null &&
                lifecycleRow.pausedAt === null &&
                lifecycleRow.pausedMs === pausedMsBeforeResumedSave &&
                resumedRestTimerSet?.restTakenSec === 47 &&
                persistedResumedRestTimerSet?.restTakenSec === 47,
            `The UI-shaped resumed workout edit did not preserve lifecycle/rest state (API rest ${JSON.stringify(resumedRestTimerSet?.restTakenSec ?? null)}, storage rest ${JSON.stringify(persistedResumedRestTimerSet?.restTakenSec ?? null)}).`,
        );

        await request("workouts:setWorkoutPaused", { workoutId: lifecycleWorkout.id, paused: true });
        await request("workouts:finishWorkout", { workoutId: lifecycleWorkout.id });
        lifecycleLog = await request("workouts:getLog");
        lifecycleRow = lifecycleLog.workouts.find((row) => row.id === lifecycleWorkout.id);
        check(
            lifecycleRow?.status === "completed" &&
                typeof lifecycleRow.endedAt === "string" &&
                lifecycleRow.pausedAt === null &&
                Number.isInteger(lifecycleRow.durationSeconds) && lifecycleRow.durationSeconds >= 0 &&
                Number.isInteger(lifecycleRow.elapsedSeconds) && lifecycleRow.elapsedSeconds === lifecycleRow.durationSeconds &&
                Number.isInteger(lifecycleRow.durationMinutes) && lifecycleRow.durationMinutes >= 0,
            "Finished workout did not return a sane completed duration.",
        );

        const staleWorkout = await request("workouts:logWorkout", { date: today, name: "Smoke stale session", status: "in_progress" });
        await prisma.workout.update({
            where: { id: staleWorkout.id },
            data: { startedAt: new Date(Date.now() - 25 * 60 * 60_000), endedAt: null, pausedAt: null, pausedMs: 0 },
        });
        let staleLog = await request("workouts:getLog");
        let staleRow = staleLog.workouts.find((row) => row.id === staleWorkout.id);
        check(staleRow?.status === "needs_review", "A workout open for more than 24 hours was not marked as needing review.");
        await request("workouts:restartWorkout", { workoutId: staleWorkout.id });
        staleLog = await request("workouts:getLog");
        staleRow = staleLog.workouts.find((row) => row.id === staleWorkout.id);
        check(staleRow?.status === "in_progress" && staleRow.elapsedSeconds >= 0 && staleRow.elapsedSeconds < 10, "Restarting a stale workout did not reset it to a sane active timer.");

        const schedule = await request("workouts:createSchedule", { date: today, name: "Smoke session", templateId: template.id });
        const movedScheduleDate = new Date();
        movedScheduleDate.setDate(movedScheduleDate.getDate() + 1);
        const movedScheduleDay = localDateKey(movedScheduleDate);
        await request("workouts:updateSchedule", { scheduleId: schedule.id, date: movedScheduleDay, name: "Smoke scheduled session", notes: "Updated schedule", templateId: template.id });
        let scheduleView = await request("workouts:getSchedule");
        check(
            scheduleView.plans.some((row) => row.id === schedule.id && row.date === movedScheduleDay && row.templateId === template.id),
            "Changing a scheduled workout to a different day did not persist.",
        );
        await request("workouts:updateSchedule", { scheduleId: schedule.id, date: today, name: "Smoke scheduled session", notes: "Updated schedule", templateId: template.id });
        let scheduleOverview = await request("workouts:getOverview");
        check(
            scheduleOverview.todaySchedule.some((row) => row.id === schedule.id && row.status === "planned" && row.templateId === template.id),
            "The workout overview did not expose today's planned template workout.",
        );
        await request("workouts:setScheduleSkipped", { scheduleId: schedule.id, skipped: true });
        scheduleView = await request("workouts:getSchedule");
        check(scheduleView.plans.some((row) => row.id === schedule.id && row.name === "Smoke scheduled session" && row.skipped === true), "Updated/skipped schedule state was not returned by workouts:getSchedule.");
        scheduleOverview = await request("workouts:getOverview");
        check(
            scheduleOverview.todaySchedule.some((row) => row.id === schedule.id && row.status === "skipped" && row.templateId === template.id),
            "The workout overview did not expose today's skipped template plan.",
        );
        await request("workouts:setScheduleSkipped", { scheduleId: schedule.id, skipped: false });
        const started = await request("workouts:startScheduledWorkout", { scheduleId: schedule.id });
        check(typeof started.workoutId === "string" && started.workoutId.length > 0, "Starting a scheduled workout did not return a workout id.");
        scheduleView = await request("workouts:getSchedule");
        check(scheduleView.plans.some((row) => row.id === schedule.id && row.status === "in_progress"), "A started schedule was marked completed before its workout finished.");
        scheduleOverview = await request("workouts:getOverview");
        check(
            scheduleOverview.todaySchedule.some((row) => row.id === schedule.id && row.status === "in_progress" && row.workoutId === started.workoutId),
            "The workout overview did not expose today's active scheduled workout.",
        );

        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + 2);
        const futureDay = localDateKey(futureDate);
        const futureSchedule = await request("workouts:createSchedule", { date: futureDay, name: "Smoke future session", templateId: template.id });
        let futureStartError = "";
        try {
            await request("workouts:startScheduledWorkout", { scheduleId: futureSchedule.id });
        } catch (error) {
            futureStartError = error instanceof Error ? error.message : String(error);
        }
        check(/scheduled date/i.test(futureStartError), `Starting a future scheduled workout was not rejected for its date (received ${futureStartError || "no error"}).`);

        const startedAt = new Date(Date.now() - 35 * 60_000).toISOString();
        const endedAt = new Date().toISOString();
        await prisma.personalRecord.create({
            data: {
                userId,
                exerciseId: exercise.id,
                recordType: "1RM",
                value: 9_999,
                unit: "kg",
                achievedOn: new Date(`${today}T00:00:00.000Z`),
                notes: null,
            },
        });
        await request("workouts:updateWorkout", {
            workoutId: started.workoutId,
            date: today,
            name: "Smoke completed session",
            note: "Updated and completed by the mutation smoke",
            status: "completed",
            startedAt,
            endedAt,
            rpe: 8,
            exercises: [{
                exerciseId: exercise.id,
                sets: [
                    { weight: 40, reps: 10, rpe: 8, completed: true },
                    { weight: 200, reps: 1, completed: true, warmup: true },
                    { weight: 300, reps: 1, completed: false },
                ],
            }],
        });
        let logView = await request("workouts:getLog");
        let completedWorkout = logView.workouts.find((row) => row.id === started.workoutId);
        check(completedWorkout?.status === "completed" && completedWorkout.name === "Smoke completed session", "Updated workout was not returned as completed by workouts:getLog.");
        check(
            closeTo(completedWorkout?.exercises?.[0]?.sets?.[0]?.weight, 40) &&
                closeTo(completedWorkout?.volume, 400) &&
                completedWorkout?.workingSets === 1,
            "An omitted workout weight unit did not honor IMPERIAL settings or working-set totals included warmup/incomplete sets.",
        );
        scheduleView = await request("workouts:getSchedule");
        check(scheduleView.plans.some((row) => row.id === schedule.id && row.status === "completed"), "A finished scheduled workout was not marked completed.");
        scheduleOverview = await request("workouts:getOverview");
        check(
            scheduleOverview.todaySchedule.some((row) => row.id === schedule.id && row.status === "completed" && row.workoutId === started.workoutId),
            "The workout overview did not expose today's completed scheduled workout.",
        );

        let recordsBody = await request("workouts:getBody");
        let exerciseRecord = recordsBody.records.find((row) => row.exerciseId === exercise.id);
        check(
            closeTo(exerciseRecord?.oneRm, 53.3) &&
                closeTo(exerciseRecord?.volume, 400) &&
                exerciseRecord?.reps === 10,
            "Personal records included a warmup/incomplete set, retained a stale legacy row, or did not use the completed working set.",
        );
        let recordsOverview = await request("workouts:getOverview");
        let overviewRecords = recordsOverview.recentRecords.filter((row) => row.exerciseId === exercise.id);
        const overviewByType = new Map(overviewRecords.map((row) => [row.recordType.toLowerCase(), row]));
        check(
            overviewRecords.length === 3 &&
                overviewRecords.every((row) => row.exerciseName === "Smoke incline press" && row.achievedOn === today) &&
                closeTo(overviewByType.get("1rm")?.displayValue, 53.3) && overviewByType.get("1rm")?.displayUnit === "lb" &&
                closeTo(overviewByType.get("volume")?.displayValue, 400) && overviewByType.get("volume")?.displayUnit === "lb" &&
                overviewByType.get("reps")?.displayValue === 10 && overviewByType.get("reps")?.displayUnit === "reps",
            `Workout overview did not return complete exercise/type/value/date record rows (${JSON.stringify(overviewRecords)}).`,
        );

        await request("workouts:updateWorkout", {
            workoutId: started.workoutId,
            date: today,
            name: "Smoke completed session",
            note: "Lowered by the mutation smoke",
            status: "completed",
            startedAt,
            endedAt,
            rpe: 7,
            exercises: [{
                exerciseId: exercise.id,
                sets: [
                    { weight: 20, reps: 5, rpe: 7, completed: true },
                    { weight: 200, reps: 1, completed: true, warmup: true },
                    { weight: 300, reps: 1, completed: false },
                ],
            }],
        });
        recordsBody = await request("workouts:getBody");
        exerciseRecord = recordsBody.records.find((row) => row.exerciseId === exercise.id);
        check(
            closeTo(exerciseRecord?.oneRm, 23.3) &&
                closeTo(exerciseRecord?.volume, 100) &&
                exerciseRecord?.reps === 5,
            "Editing the best working set downward did not rebuild personal records.",
        );
        recordsOverview = await request("workouts:getOverview");
        overviewRecords = recordsOverview.recentRecords.filter((row) => row.exerciseId === exercise.id);
        check(
            overviewRecords.some((row) => row.recordType.toLowerCase() === "1rm" && closeTo(row.displayValue, 23.3)) &&
                overviewRecords.some((row) => row.recordType.toLowerCase() === "volume" && closeTo(row.displayValue, 100)) &&
                overviewRecords.some((row) => row.recordType.toLowerCase() === "reps" && row.displayValue === 5),
            "Editing the best working set downward did not update the overview record display.",
        );

        const measurement = await request("workouts:addBodyMeasurement", { date: today, weight: 180, bodyFatPct: 18 });
        let measurementBody = await request("workouts:getBody");
        check(measurementBody.weightUnit === "lb" && closeTo(measurementBody.measurements.find((row) => row.id === measurement.id)?.displayWeight, 180), "An omitted body weight unit did not honor IMPERIAL settings on create.");
        await request("workouts:updateBodyMeasurement", { measurementId: measurement.id, date: today, weight: 179, bodyFatPct: 17.5, waistCm: 82, note: "Updated measurement" });
        measurementBody = await request("workouts:getBody");
        check(closeTo(measurementBody.measurements.find((row) => row.id === measurement.id)?.displayWeight, 179), "An omitted body weight unit did not honor IMPERIAL settings on update.");
        const storedMeasurement = await prisma.bodyMeasurement.findUnique({ where: { id: measurement.id }, select: { weightKg: true } });
        check(closeTo(storedMeasurement?.weightKg, 179 / 2.2046226218, 0.01), "The body measurement was not stored in canonical kilograms after an IMPERIAL input.");

        const cycleMarker = `Smoke cycle ${stamp}`;
        const createdCycle = await request("workouts:createTrainingCycle", { phase: "MAINTAIN", startDate: today, note: cycleMarker });
        const bodyWithCycle = await request("workouts:getBody");
        const cycle = bodyWithCycle.cycles.find((row) => row.id === createdCycle?.id || row.note === cycleMarker);
        check(cycle?.id, "Created training cycle was not returned by workouts:getBody.");
        await request("workouts:updateTrainingCycle", { cycleId: cycle.id, phase: "CUT", startDate: today, endDate: today, note: `${cycleMarker} updated` });
        const updatedBody = await request("workouts:getBody");
        check(updatedBody.measurements.some((row) => row.id === measurement.id && row.bodyFatPct === 17.5 && row.waistCm === 82), "Updated measurement was not returned by workouts:getBody.");
        check(updatedBody.cycles.some((row) => row.id === cycle.id && row.phase === "CUT" && row.note === `${cycleMarker} updated`), "Updated training cycle was not returned by workouts:getBody.");

        const photo = await request("workouts:uploadProgressPhoto", {
            fileName: "smoke.png",
            mimeType: "image/png",
            base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
            takenAt: today,
            angle: "FRONT",
            phase: "MAINTAIN",
            weightKg: 81.65,
            workoutId: started.workoutId,
            notes: "Temporary mutation smoke",
        });
        uploadedPhotoId = photo.id;
        await request("workouts:updateProgressPhoto", {
            photoId: photo.id,
            takenAt: today,
            angle: "SIDE",
            phase: "CUT",
            weightKg: 81.2,
            workoutId: started.workoutId,
            notes: "Updated temporary mutation smoke",
        });
        const progress = await request("workouts:getProgress");
        check(progress.photos.some((row) => row.id === photo.id && row.angle === "SIDE" && row.phase === "CUT" && row.thumbnailUrl.startsWith("coretex-asset:")), "Updated workout photo was not returned as an Electron asset URL.");

        await request("workouts:deleteProgressPhoto", { photoId: photo.id });
        uploadedPhotoId = null;
        await request("workouts:deleteTrainingCycle", { cycleId: cycle.id });
        await request("workouts:deleteBodyMeasurement", { measurementId: measurement.id });
        await request("workouts:deleteWorkout", { workoutId: lifecycleWorkout.id });
        await request("workouts:deleteWorkout", { workoutId: staleWorkout.id });
        await request("workouts:deleteWorkout", { workoutId: started.workoutId });
        await request("workouts:deleteSchedule", { scheduleId: futureSchedule.id });
        await request("workouts:deleteSchedule", { scheduleId: schedule.id });
        await request("workouts:deleteTemplate", { templateId: template.id });
        await request("workouts:deleteExercise", { exerciseId: exercise.id });

        scheduleView = await request("workouts:getSchedule");
        const cleanedLog = await request("workouts:getLog");
        const cleanedExercises = await request("workouts:getExercises");
        const cleanedTemplates = await request("workouts:getTemplates");
        const cleanedBody = await request("workouts:getBody");
        const cleanedOverview = await request("workouts:getOverview");
        const cleanedProgress = await request("workouts:getProgress");
        check(!scheduleView.plans.some((row) => row.id === schedule.id || row.id === futureSchedule.id), "Deleted schedule remained in workouts:getSchedule.");
        check(!cleanedLog.workouts.some((row) => row.id === started.workoutId || row.id === lifecycleWorkout.id), "Deleted workout remained in workouts:getLog.");
        check(!cleanedLog.workouts.some((row) => row.id === staleWorkout.id), "Deleted stale workout remained in workouts:getLog.");
        check(!cleanedExercises.exercises.some((row) => row.id === exercise.id), "Archived exercise remained in workouts:getExercises.");
        check(!cleanedTemplates.templates.some((row) => row.id === template.id), "Archived template remained in workouts:getTemplates.");
        check(!cleanedBody.measurements.some((row) => row.id === measurement.id) && !cleanedBody.cycles.some((row) => row.id === cycle.id), "Deleted body records remained in workouts:getBody.");
        check(!cleanedBody.records.some((row) => row.exerciseId === exercise.id), "Deleting the source workout did not remove its personal records.");
        check(!cleanedOverview.recentRecords.some((row) => row.exerciseId === exercise.id), "Deleting the source workout left a stale record on the overview.");
        check(!cleanedProgress.photos.some((row) => row.id === photo.id), "Deleted progress photo remained in workouts:getProgress.");
    });

    await step("Health", async () => {
        await request("health:createMetric", { metricType: "weight", value: 81.65, unit: "kg", measuredAt: new Date().toISOString() });
        await request("health:createVital", { vitalType: "heart_rate", value: 62, unit: "bpm", measuredAt: new Date().toISOString() });
        await request("health:upsertSleep", { date: today, totalMinutes: 480, sleepQuality: 4, feelRested: 4 });
        const habit = await request("health:createHabit", { name: "Smoke habit", category: "health" });
        await request("health:toggleHabit", { habitId: habit.habit.id, date: today });
        await request("health:upsertJournal", { date: today, reflection: "Smoke reflection", overallRating: 8 });
        await request("health:saveMedication", { name: "Smoke medication", dosageAmount: 5, dosageUnit: "mg", frequency: "daily", active: true });
        const overview = await request("health:getOverview");
        check(overview.habits.total === 1 && overview.lastSleep?.totalMinutes === 480, "Health mutations were not reflected in the overview.");
    });

    await step("Nutrition", async () => {
        // The API stores water canonically in milliliters. Exercise the same
        // rounded values used by the IMPERIAL quick-add buttons, then switch
        // this isolated fixture to METRIC and verify the stored total remains
        // canonical rather than being reinterpreted when settings change.
        const imperialEightOzMl = Math.round(8 / 0.033814022702);
        const imperialSixteenOzMl = Math.round(16 / 0.033814022702);
        await request("nutrition:addWater", { date: today, amountMl: imperialEightOzMl });
        await request("nutrition:addWater", { date: today, amountMl: imperialSixteenOzMl });
        let view = await request("nutrition:getOverview", { date: today });
        check(
            view.unitSystem === "IMPERIAL" && view.water.amountMl === imperialEightOzMl + imperialSixteenOzMl,
            "IMPERIAL water quick-add values were not stored canonically in milliliters.",
        );

        await prisma.settings.update({ where: { userId }, data: { unitSystem: "METRIC" } });
        await request("nutrition:setWater", { date: today, amountMl: 500 });
        view = await request("nutrition:getOverview", { date: today });
        check(
            view.unitSystem === "METRIC" && view.water.amountMl === 500,
            "METRIC water total was not returned in canonical milliliters after changing unit settings.",
        );

        const manual = await request("nutrition:logFood", {
            date: today,
            mealType: "BREAKFAST",
            description: "Smoke oatmeal",
            servingSize: "1.5 cups",
            quantity: 1.5,
            unit: "cup",
            calories: 320,
            proteinG: 12,
            carbsG: 52,
            fatG: 8,
            fiberG: 6,
            source: "MANUAL",
        });
        check(
            manual.entry.source === "MANUAL" &&
                manual.entry.manuallyAdjusted === true &&
                manual.entry.aiAnalyzed === false &&
                closeTo(manual.entry.quantity, 1.5) &&
                manual.entry.unit === "cup" &&
                closeTo(manual.entry.fiberG, 6),
            "Structured manual nutrition fields or provenance were not persisted.",
        );

        const textAnalyzed = await request("nutrition:logFood", {
            date: today,
            mealType: "LUNCH",
            description: "Smoke AI-reviewed soup",
            servingSize: "2 cups",
            quantity: 2,
            unit: "cup",
            calories: 280,
            proteinG: 14,
            carbsG: 34,
            fatG: 9,
            fiberG: 7,
            source: "TEXT",
        });
        check(
            textAnalyzed.entry.source === "TEXT" &&
                textAnalyzed.entry.aiAnalyzed === true &&
                textAnalyzed.entry.manuallyAdjusted === false,
            "A reviewed text estimate was not persisted with TEXT/AI provenance.",
        );

        const barcodeProduct = await prisma.foodProduct.create({
            data: {
                userId,
                name: "Smoke barcoded yogurt",
                quantity: 170,
                unit: "g",
                calories: 120,
                proteinG: 15,
                carbsG: 10,
                fatG: 2,
                fiberG: 1,
                barcode: "3017620422003",
            },
        });
        const barcodeEstimate = await request("nutrition:lookupBarcode", { barcode: barcodeProduct.barcode });
        check(
            barcodeEstimate.productId === barcodeProduct.id &&
                barcodeEstimate.source === "BARCODE" &&
                closeTo(barcodeEstimate.fiberG, 1),
            "A cached barcode product did not return its structured serving, fiber, and product linkage.",
        );
        const barcode = await request("nutrition:logFood", {
            date: today,
            mealType: "SNACK",
            productId: barcodeProduct.id,
            description: barcodeProduct.name,
            servingSize: "170 g",
            quantity: 170,
            unit: "g",
            calories: 120,
            proteinG: 15,
            carbsG: 10,
            fatG: 2,
            fiberG: 1,
            source: "BARCODE",
        });
        check(
            barcode.entry.source === "BARCODE" &&
                barcode.entry.productId === barcodeProduct.id &&
                barcode.entry.aiAnalyzed === false &&
                barcode.entry.manuallyAdjusted === false,
            "A reviewed barcode entry was not linked to its fixture product with BARCODE provenance.",
        );

        // Put two differently sourced foods in one meal so a saved-meal
        // snapshot has to preserve item order, product linkage, serving data,
        // provenance, and fiber rather than only copying display names/macros.
        const breakfastBarcode = await request("nutrition:logFood", {
            date: today,
            mealType: "BREAKFAST",
            productId: barcodeProduct.id,
            description: barcodeProduct.name,
            servingSize: "170 g",
            quantity: 170,
            unit: "g",
            calories: 120,
            proteinG: 15,
            carbsG: 10,
            fatG: 2,
            fiberG: 1,
            source: "BARCODE",
        });

        await request("nutrition:updateGoals", { calories: 2200, proteinG: 150, carbsG: 240, fatG: 70, fiberG: 30, waterGoalMl: 2800 });
        await request("nutrition:updateGoals", { proteinG: 165 });
        await request("nutrition:updateGoals", { fatG: null });
        view = await request("nutrition:getOverview", { date: today });
        const entries = view.meals.flatMap((meal) => meal.entries);
        const manualOverview = entries.find((entry) => entry.id === manual.entry.id);
        const textOverview = entries.find((entry) => entry.id === textAnalyzed.entry.id);
        const barcodeOverview = entries.find((entry) => entry.id === barcode.entry.id);
        check(
            view.water.amountMl === 500 &&
                view.water.goalMl === 2800 &&
                closeTo(view.goal?.calories, 2200) &&
                closeTo(view.goal?.proteinG, 165) &&
                closeTo(view.goal?.carbsG, 240) &&
                view.goal?.fatG == null &&
                closeTo(view.goal?.fiberG, 30) &&
                manualOverview?.source === "MANUAL" &&
                closeTo(manualOverview?.quantity, 1.5) &&
                manualOverview?.unit === "cup" &&
                closeTo(manualOverview?.fiberG, 6) &&
                textOverview?.source === "TEXT" &&
                barcodeOverview?.source === "BARCODE" &&
                barcodeOverview?.productId === barcodeProduct.id,
            "Nutrition mutations were not returned with their structured fields and provenance.",
        );

        await request("nutrition:setFoodFavorite", { entryId: manual.entry.id, isFavorite: true });
        view = await request("nutrition:getOverview", { date: today });
        check(
            view.favoriteSummary.count === 1 &&
                view.favorites.some((favorite) =>
                    favorite.id === manual.entry.id &&
                    favorite.description === "Smoke oatmeal" &&
                    closeTo(favorite.quantity, 1.5) &&
                    favorite.unit === "cup" &&
                    closeTo(favorite.fiberG, 6)),
            "Favoriting a structured food did not expose it as a reusable favorite.",
        );

        const savedMealCreate = await request("nutrition:createSavedMeal", {
            sourceMealId: manual.meal.id,
            name: "Smoke breakfast pair",
            mealType: "BREAKFAST",
        });
        view = await request("nutrition:getOverview", { date: today });
        let savedMeal = view.savedMeals.find((meal) => meal.id === savedMealCreate.savedMeal.id);
        check(
            savedMeal?.name === "Smoke breakfast pair" &&
                savedMeal.mealType === "BREAKFAST" &&
                savedMeal.itemCount === 2 &&
                closeTo(savedMeal.totals.calories, 440) &&
                closeTo(savedMeal.totals.proteinG, 27) &&
                closeTo(savedMeal.totals.fiberG, 7) &&
                savedMeal.items.some((item) =>
                    item.description === "Smoke oatmeal" &&
                    item.source === "MANUAL" &&
                    closeTo(item.quantity, 1.5) &&
                    item.unit === "cup" &&
                    closeTo(item.fiberG, 6)) &&
                savedMeal.items.some((item) =>
                    item.productId === barcodeProduct.id &&
                    item.source === "BARCODE" &&
                    closeTo(item.quantity, 170) &&
                    item.unit === "g" &&
                    closeTo(item.fiberG, 1)),
            "A saved multi-item meal did not preserve its full structured food snapshot and totals.",
        );

        await request("nutrition:updateSavedMeal", {
            savedMealId: savedMealCreate.savedMeal.id,
            name: "Smoke reusable breakfast",
            mealType: "LUNCH",
        });
        view = await request("nutrition:getOverview", { date: today });
        savedMeal = view.savedMeals.find((meal) => meal.id === savedMealCreate.savedMeal.id);
        check(
            savedMeal?.name === "Smoke reusable breakfast" &&
                savedMeal.mealType === "LUNCH" &&
                savedMeal.itemCount === 2 &&
                closeTo(savedMeal.totals.fiberG, 7),
            "Updating saved-meal metadata unexpectedly changed or dropped its food items.",
        );

        const reuseDate = new Date(Date.parse(`${today}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
        const favoriteLog = await request("nutrition:logFavorite", {
            favoriteEntryId: manual.entry.id,
            date: reuseDate,
            mealType: "LUNCH",
        });
        const savedMealLog = await request("nutrition:logSavedMeal", {
            savedMealId: savedMealCreate.savedMeal.id,
            date: reuseDate,
            mealType: "DINNER",
        });
        check(
            savedMealLog.entries.length === 2 &&
                closeTo(savedMealLog.totals.calories, 440) &&
                closeTo(savedMealLog.totals.fiberG, 7),
            "Logging a saved meal did not return the complete copied meal totals.",
        );

        let reuseView = await request("nutrition:getOverview", { date: reuseDate });
        const reusedLunch = reuseView.meals.find((meal) => meal.mealType === "LUNCH");
        const reusedDinner = reuseView.meals.find((meal) => meal.mealType === "DINNER");
        check(
            reusedLunch?.entries.length === 1 &&
                reusedLunch.entries[0].id === favoriteLog.entry.id &&
                reusedLunch.entries[0].description === "Smoke oatmeal" &&
                reusedLunch.entries[0].source === "MANUAL" &&
                closeTo(reusedLunch.entries[0].quantity, 1.5) &&
                reusedLunch.entries[0].unit === "cup" &&
                closeTo(reusedLunch.entries[0].fiberG, 6) &&
                reusedDinner?.entries.length === 2 &&
                closeTo(reusedDinner.totals.calories, 440) &&
                closeTo(reusedDinner.totals.proteinG, 27) &&
                closeTo(reusedDinner.totals.carbsG, 62) &&
                closeTo(reusedDinner.totals.fatG, 10) &&
                closeTo(reusedDinner.totals.fiberG, 7) &&
                reusedDinner.entries.some((entry) =>
                    entry.productId === barcodeProduct.id &&
                    entry.source === "BARCODE" &&
                    closeTo(entry.quantity, 170) &&
                    entry.unit === "g" &&
                    closeTo(entry.fiberG, 1)),
            "Favorites or saved meals were not logged into their selected date and meal with accurate nutrition.",
        );

        await request("nutrition:updateFoodEntry", {
            entryId: favoriteLog.entry.id,
            description: "Smoke edited favorite oatmeal",
            servingSize: "1 bowl",
            quantity: 1,
            unit: "bowl",
            calories: 300,
            proteinG: 11,
            carbsG: 49,
            fatG: 7,
            fiberG: 5,
            source: "MANUAL",
        });
        reuseView = await request("nutrition:getOverview", { date: reuseDate });
        const editedFavorite = reuseView.meals
            .flatMap((meal) => meal.entries)
            .find((entry) => entry.id === favoriteLog.entry.id);
        check(
            editedFavorite?.description === "Smoke edited favorite oatmeal" &&
                closeTo(editedFavorite.quantity, 1) &&
                editedFavorite.unit === "bowl" &&
                closeTo(editedFavorite.calories, 300) &&
                closeTo(editedFavorite.fiberG, 5),
            "Editing a logged reusable food did not update its structured nutrition fields.",
        );
        await request("nutrition:deleteFoodEntry", { entryId: favoriteLog.entry.id });
        reuseView = await request("nutrition:getOverview", { date: reuseDate });
        check(
            !reuseView.meals.flatMap((meal) => meal.entries).some((entry) => entry.id === favoriteLog.entry.id),
            "A deleted reusable-food log remained in the selected day's overview.",
        );

        await request("nutrition:setFoodFavorite", { entryId: manual.entry.id, isFavorite: false });
        await request("nutrition:deleteSavedMeal", { savedMealId: savedMealCreate.savedMeal.id });
        view = await request("nutrition:getOverview", { date: today });
        check(
            view.favoriteSummary.count === 0 &&
                !view.favorites.some((favorite) => favorite.id === manual.entry.id) &&
                !view.savedMeals.some((meal) => meal.id === savedMealCreate.savedMeal.id),
            "Unfavoriting a food or deleting a saved meal did not remove it from the reusable library.",
        );

        const storedEntries = await prisma.foodEntry.findMany({
            where: { id: { in: [manual.entry.id, textAnalyzed.entry.id, barcode.entry.id, breakfastBarcode.entry.id] } },
            select: { id: true, source: true, productId: true, aiAnalyzed: true, manuallyAdjusted: true, quantity: true, unit: true, fiberG: true },
        });
        check(
            storedEntries.length === 4 &&
                storedEntries.some((entry) => entry.id === manual.entry.id && entry.source === "MANUAL" && entry.manuallyAdjusted && closeTo(entry.fiberG, 6)) &&
                storedEntries.some((entry) => entry.id === textAnalyzed.entry.id && entry.source === "TEXT" && entry.aiAnalyzed) &&
                storedEntries.some((entry) => entry.id === barcode.entry.id && entry.source === "BARCODE" && entry.productId === barcodeProduct.id) &&
                storedEntries.some((entry) => entry.id === breakfastBarcode.entry.id && entry.source === "BARCODE" && entry.productId === barcodeProduct.id),
            "Canonical nutrition rows did not preserve source flags, serving fields, or product linkage.",
        );
    });

    await step("Todos", async () => {
        const todo = await request("tasks:createTodo", { title: "Smoke todo", date: today, category: "Health", priority: "HIGH", durationMinutes: 25 });
        const subtask = await request("tasks:createSubtask", { todoId: todo.id, title: "Smoke subtask" });
        const toggledSubtask = await request("tasks:toggleSubtask", { id: subtask.id });
        check(toggledSubtask.done === true, "Todo subtask did not toggle to done.");
        await request("tasks:updateTodo", { id: todo.id, status: "IN_PROGRESS" });
        let dashboard = await request("tasks:getDashboard", { date: today });
        let todoRow = dashboard.todos.find((row) => row.id === todo.id);
        check(todoRow?.status === "IN_PROGRESS" && todoRow.priority === "HIGH" && todoRow.durationMinutes === 25 && todoRow.subtasks[0]?.done === true, "Created todo metadata or in-progress state was not returned by the dashboard.");
        await request("tasks:updateTodo", { id: todo.id, status: "DONE" });
        dashboard = await request("tasks:getDashboard", { date: today });
        todoRow = dashboard.todos.find((row) => row.id === todo.id);
        check(todoRow?.status === "DONE" && typeof todoRow.completedAt === "string", "Completing a todo did not persist completion metadata.");
        const routine = await request("tasks:createRoutine", { title: "Smoke routine", category: "Health" });
        const pausedRoutine = await request("tasks:toggleRoutine", { id: routine.id });
        check(pausedRoutine.active === false, "Todo routine did not pause.");
        await request("tasks:deleteRoutine", { id: routine.id });
        await request("tasks:deleteTodo", { id: todo.id });
        dashboard = await request("tasks:getDashboard", { date: today });
        check(!dashboard.todos.some((row) => row.id === todo.id) && !dashboard.routines.some((row) => row.id === routine.id), "Deleted todo or routine remained in the dashboard.");
    });

    process.stdout.write("LifeOS mutation smoke passed: 6 Personal domains.\n");
} catch (error) {
    console.error(`LifeOS mutation smoke failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
} finally {
    if (uploadedPhotoId) {
        try { await request("workouts:deleteProgressPhoto", { photoId: uploadedPhotoId }); } catch { /* best-effort temporary-file cleanup */ }
    }
    socket.close();
    if (userId.startsWith("codex_lifeos_smoke_")) {
        await prisma.user.deleteMany({ where: { id: userId } });
        const [remainingUsers, remainingSettings, remainingProfiles, remainingDays, remainingMeals, remainingWater, remainingGoals, remainingProducts, remainingEntries, remainingSavedMeals, remainingSavedMealItems] = await Promise.all([
            prisma.user.count({ where: { id: userId } }),
            prisma.settings.count({ where: { userId } }),
            prisma.userProfile.count({ where: { userId } }),
            prisma.nutritionDay.count({ where: { userId } }),
            prisma.meal.count({ where: { day: { userId } } }),
            prisma.waterLog.count({ where: { userId } }),
            prisma.nutritionGoal.count({ where: { userId } }),
            prisma.foodProduct.count({ where: { userId } }),
            prisma.foodEntry.count({ where: { meal: { day: { userId } } } }),
            prisma.savedMeal.count({ where: { userId } }),
            prisma.savedMealItem.count({ where: { savedMeal: { userId } } }),
        ]);
        if (remainingUsers + remainingSettings + remainingProfiles + remainingDays + remainingMeals + remainingWater + remainingGoals + remainingProducts + remainingEntries + remainingSavedMeals + remainingSavedMealItems !== 0) {
            console.error(`LifeOS mutation smoke cleanup failed for ${userId}.`);
            process.exitCode = 1;
        }
    }
    await prisma.$disconnect();
}
