import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { bridgeProtocols } from "./bridge-smoke-auth.mjs";

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    "postgresql://lifeos:lifeos@localhost:5450/lifeos?schema=public";
}

const prisma = new PrismaClient();
const url = process.env.CORETEX_WS_URL ?? "ws://127.0.0.1:8765";
const protocols = await bridgeProtocols(url);
const stamp = `${Date.now()}_${randomUUID()}`;
const userId = `codex_health_smoke_${stamp}`;
const outsiderId = `codex_health_smoke_outsider_${stamp}`;
const disposableUserIds = [userId, outsiderId];
const uploadedPhotoIds = new Set();

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function closeTo(actual, expected, tolerance = 0.01) {
  return (
    typeof actual === "number" &&
    Number.isFinite(actual) &&
    Math.abs(actual - expected) <= tolerance
  );
}

function dayOffset(offset) {
  const now = new Date();
  // Date-only health records use the user's local calendar day, represented
  // as UTC midnight in storage. Keep the fixture on that same boundary so it
  // remains valid when local time and UTC fall on different dates.
  const day = new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
  );
  day.setUTCDate(day.getUTCDate() + offset);
  return day.toISOString().slice(0, 10);
}

function instant(day, hour = 12, minute = 0) {
  return `${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`;
}

function localDay(value) {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function weekdayForDay(day) {
  return ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][
    new Date(`${day}T00:00:00.000Z`).getUTCDay()
  ];
}

function mutationId(result, key) {
  const id = result?.[key]?.id ?? result?.id;
  check(typeof id === "string" && id.length > 0, `Missing ${key} id.`);
  return id;
}

async function expectRejected(action, expectedText) {
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (expectedText) {
      check(
        message.toLowerCase().includes(expectedText.toLowerCase()),
        `Expected an error containing ${JSON.stringify(expectedText)}, received ${JSON.stringify(message)}.`,
      );
    }
    return;
  }
  throw new Error("Expected the request to be rejected.");
}

function createRpcClient() {
  const socket = new WebSocket(url, protocols);
  const pending = new Map();
  let sequence = 0;

  const opened = new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });

  socket.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!message.requestId || !pending.has(message.requestId)) return;
    const request = pending.get(message.requestId);
    clearTimeout(request.timer);
    pending.delete(message.requestId);
    if (message.error) request.reject(new Error(`${message.type}: ${message.error}`));
    else request.resolve(message.result);
  });

  socket.on("close", () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("Coretex WebSocket closed before the response arrived."));
    }
    pending.clear();
  });

  return {
    async request(type, payload, actingUserId = userId) {
      await opened;
      const requestId = `health_smoke_${++sequence}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error(`${type}: timed out`));
        }, 20_000);
        pending.set(requestId, { resolve, reject, timer });
        socket.send(
          JSON.stringify({
            type,
            requestId,
            userId: actingUserId,
            ...(payload === undefined ? {} : { payload }),
          }),
        );
      });
    },
    async close() {
      await opened.catch(() => undefined);
      socket.close();
    },
  };
}

async function step(label, action) {
  await action();
  process.stdout.write(`${label} ✓\n`);
}

async function countHealthRows(targetUserId) {
  const counts = await Promise.all([
    prisma.user.count({ where: { id: targetUserId } }),
    prisma.settings.count({ where: { userId: targetUserId } }),
    prisma.userProfile.count({ where: { userId: targetUserId } }),
    prisma.nutritionGoal.count({ where: { userId: targetUserId } }),
    prisma.bodyMeasurement.count({ where: { userId: targetUserId } }),
    prisma.bodyMetric.count({ where: { userId: targetUserId } }),
    prisma.vitalReading.count({ where: { userId: targetUserId } }),
    prisma.vitalReadingField.count({ where: { reading: { userId: targetUserId } } }),
    prisma.sleepEntry.count({ where: { userId: targetUserId } }),
    prisma.sleepInterruption.count({ where: { entry: { userId: targetUserId } } }),
    prisma.habit.count({ where: { userId: targetUserId } }),
    prisma.habitLog.count({ where: { habit: { userId: targetUserId } } }),
    prisma.habitMilestone.count({ where: { habit: { userId: targetUserId } } }),
    prisma.journalEntry.count({ where: { userId: targetUserId } }),
    prisma.realmRating.count({ where: { entry: { userId: targetUserId } } }),
    prisma.provider.count({ where: { userId: targetUserId } }),
    prisma.doctor.count({ where: { userId: targetUserId } }),
    prisma.medicalRecord.count({ where: { userId: targetUserId } }),
    prisma.calendarEvent.count({ where: { userId: targetUserId, kind: "APPOINTMENT" } }),
    prisma.progressPhoto.count({ where: { userId: targetUserId } }),
    prisma.sobrietyCounter.count({ where: { userId: targetUserId } }),
    prisma.sobrietyRelapse.count({ where: { counter: { userId: targetUserId } } }),
    prisma.substanceLog.count({ where: { userId: targetUserId } }),
    prisma.customSubstanceType.count({ where: { userId: targetUserId } }),
    prisma.peptide.count({ where: { userId: targetUserId } }),
    prisma.peptideBlock.count({ where: { peptide: { userId: targetUserId } } }),
    prisma.peptideLog.count({ where: { peptide: { userId: targetUserId } } }),
    prisma.medication.count({ where: { userId: targetUserId } }),
    prisma.supplement.count({ where: { userId: targetUserId } }),
    prisma.therapeuticSchedule.count({ where: { userId: targetUserId } }),
    prisma.therapeuticDose.count({ where: { userId: targetUserId } }),
    prisma.therapeuticLog.count({ where: { userId: targetUserId } }),
  ]);
  return counts.reduce((sum, count) => sum + count, 0);
}

const client = createRpcClient();

try {
  await prisma.user.createMany({
    data: disposableUserIds.map((id) => ({
      id,
      email: `${id}@example.invalid`,
      name: "Disposable Health smoke",
      passwordHash: "temporary-smoke-account",
    })),
  });
  await prisma.settings.createMany({
    data: disposableUserIds.map((id) => ({ userId: id, unitSystem: "IMPERIAL" })),
  });

  const today = dayOffset(0);
  const yesterday = dayOffset(-1);
  const twoDaysAgo = dayOffset(-2);
  const tenDaysAgo = dayOffset(-10);

  let weightId;
  let bodyFatId;
  await step("Metrics and goals", async () => {
    const oldWeight = await client.request("health:createMetric", {
      metricType: "weight",
      value: 82,
      unit: "kg",
      measuredAt: instant(twoDaysAgo),
      notes: "Disposable baseline",
    });
    weightId = mutationId(oldWeight, "metric");
    await client.request("health:updateMetric", {
      id: weightId,
      metricType: "weight",
      value: 81.5,
      unit: "kg",
      measuredAt: instant(twoDaysAgo),
      notes: "Corrected baseline",
    });
    const latestWeight = await client.request("health:createMetric", {
      metricType: "weight",
      value: 80,
      unit: "kg",
      measuredAt: instant(today),
    });
    const latestWeightId = mutationId(latestWeight, "metric");
    const bodyFat = await client.request("health:createMetric", {
      metricType: "body_fat_pct",
      value: 18.5,
      unit: "%",
      measuredAt: instant(today, 12, 5),
    });
    bodyFatId = mutationId(bodyFat, "metric");

    await client.request("health:updateGoals", {
      gender: "male",
      birthdate: "1990-01-02",
      heightCm: 180,
      activityLevel: "moderate",
      dietGoal: "maintain",
      targetWeeklyChangeKg: 0,
      goalWeightKg: 78,
      goalBodyFatPct: 16,
      goalTargetDate: dayOffset(90),
      waterGoalMl: 3000,
      calories: 2400,
      proteinG: 160,
      carbsG: 250,
      fatG: 75,
      fiberG: 32,
    });

    const metrics = await client.request("health:getMetrics");
    check(metrics.metrics.length === 3, "Metrics query did not return all disposable entries.");
    check(
      metrics.weightSeries.length === 2 &&
        metrics.weightSeries[0].day === twoDaysAgo &&
        closeTo(metrics.weightSeries[0].kg, 81.5) &&
        metrics.weightSeries[1].day === today &&
        closeTo(metrics.summary.latestWeightKg, 80) &&
        closeTo(metrics.summary.latestBodyFatPct, 18.5),
      "Metric chart series or summary was inaccurate.",
    );
    check(
      metrics.series.some(
        (series) => series.type === "weight" && series.points.length === 2,
      ) && metrics.bodyFatSeries.length === 1,
      "Metric type or body-fat chart series was incomplete.",
    );

    await prisma.bodyMeasurement.create({
      data: {
        userId,
        date: new Date(`${tenDaysAgo}T00:00:00.000Z`),
        weightKg: 95,
        bodyFatPct: 29,
      },
    });

    const goals = await client.request("health:getGoals");
    check(
      goals.readiness.complete === true &&
        closeTo(goals.profile.heightCm, 180) &&
        closeTo(goals.profile.goalWeightKg, 78) &&
        goals.profile.waterGoalMl === 3000 &&
        closeTo(goals.nutritionGoal.calories, 2400) &&
        closeTo(goals.nutritionGoal.fiberG, 32) &&
        closeTo(goals.current.weightKg, 80) &&
        closeTo(goals.current.bodyFatPct, 18.5) &&
        goals.current.measuredAt?.startsWith(today),
      "Goal profile, readiness, newest-source metrics, or nutrition targets were inaccurate.",
    );

    const newerMeasurement = await prisma.bodyMeasurement.create({
      data: {
        userId,
        date: new Date(`${dayOffset(1)}T00:00:00.000Z`),
        weightKg: 77,
        bodyFatPct: 15,
      },
    });
    const goalsFromMeasurement = await client.request("health:getGoals");
    check(
      closeTo(goalsFromMeasurement.current.weightKg, 77) &&
        closeTo(goalsFromMeasurement.current.bodyFatPct, 15) &&
        goalsFromMeasurement.current.measuredAt === dayOffset(1),
      "A newer body measurement did not supersede older metric sources in goals.",
    );
    await prisma.bodyMeasurement.delete({ where: { id: newerMeasurement.id } });

    await expectRejected(
      () =>
        client.request(
          "health:updateMetric",
          { id: latestWeightId, value: 1, metricType: "weight", measuredAt: instant(today) },
          outsiderId,
        ),
      "not found",
    );
  });

  let heartRateId;
  let pressureId;
  let temperatureId;
  let glucoseId;
  await step("Vitals", async () => {
    const heartRate = await client.request("health:createVital", {
      vitalType: "heart_rate",
      value: 61,
      unit: "bpm",
      measuredAt: instant(yesterday),
    });
    heartRateId = mutationId(heartRate, "vital");
    await client.request("health:updateVital", {
      id: heartRateId,
      vitalType: "heart_rate",
      value: 62,
      unit: "bpm",
      measuredAt: instant(yesterday),
      notes: "Corrected reading",
    });
    const pressure = await client.request("health:createVital", {
      vitalType: "blood_pressure",
      value: 118,
      value2: 76,
      unit: "mmHg",
      measuredAt: instant(today),
      fields: [
        { label: "Pulse", value: 60, unit: "bpm" },
        { label: "Position", value: 1, unit: "seated" },
      ],
    });
    pressureId = mutationId(pressure, "vital");
    const temperature = await client.request("health:createVital", {
      vitalType: "temperature",
      value: 98.6,
      value2: 100.4,
      unit: "\u00b0F",
      measuredAt: instant(today, 12, 10),
    });
    temperatureId = mutationId(temperature, "vital");
    const glucose = await client.request("health:createVital", {
      vitalType: "blood_glucose",
      value: 5.5,
      value2: 7,
      unit: "mmol/L",
      measuredAt: instant(today, 12, 15),
    });
    glucoseId = mutationId(glucose, "vital");

    const vitals = await client.request("health:getVitals");
    check(
      vitals.summary.readings === 4 &&
        vitals.summary.vitalTypes === 4 &&
        vitals.unitSystem === "IMPERIAL" &&
        vitals.latestByType.some(
          (row) => row.type === "heart_rate" && closeTo(row.value, 62),
        ) &&
        vitals.latestByType.some(
          (row) =>
            row.type === "blood_pressure" &&
            closeTo(row.value, 118) &&
            closeTo(row.value2, 76),
        ) &&
        vitals.latestByType.some(
          (row) =>
            row.type === "temperature" &&
            closeTo(row.value, 37) &&
            closeTo(row.value2, 38) &&
            row.unit === "\u00b0C",
        ) &&
        vitals.latestByType.some(
          (row) =>
            row.type === "blood_glucose" &&
            closeTo(row.value, 99.1) &&
            closeTo(row.value2, 126.13) &&
            row.unit === "mg/dL",
        ),
      "Vital latest-values, unit normalization, or summary was inaccurate.",
    );
    check(
      vitals.series.length === 4 &&
        vitals.series.every((series) => series.points.length === 1),
      "Vital chart series was incomplete.",
    );
  });

  let todaySleepId;
  await step("Sleep", async () => {
    await client.request("health:upsertSleep", {
      date: yesterday,
      bedtime: instant(twoDaysAgo, 23),
      wakeTime: instant(yesterday, 7),
      totalMinutes: 480,
      sleepQuality: 4,
      feelRested: 4,
      sleepLatencyMin: 15,
      restingHrBpm: 55,
      hrvMs: 52,
      interruptions: [
        { time: instant(yesterday, 2), durationMinutes: 8, reason: "Noise" },
      ],
    });
    const todaySleep = await client.request("health:upsertSleep", {
      date: today,
      bedtime: instant(yesterday, 23, 30),
      wakeTime: instant(today, 6, 30),
      totalMinutes: 420,
      sleepQuality: 3,
      feelRested: 3,
      sleepLatencyMin: 20,
      restingHrBpm: 57,
      hrvMs: 48,
      notes: "Disposable sleep",
    });
    todaySleepId = mutationId(todaySleep, "sleep");
    await client.request("health:upsertSleep", {
      date: yesterday,
      totalMinutes: 480,
      notes: "Partial update must preserve extended fields",
    });

    const sleep = await client.request("health:getSleep");
    const preservedSleep = sleep.entries.find((entry) => entry.date === yesterday);
    check(
      sleep.entries.length === 2 &&
        sleep.trend.length === 2 &&
        closeTo(sleep.summary.averageMinutes, 450) &&
        closeTo(sleep.summary.averageQuality, 3.5) &&
        sleep.summary.interruptions === 1 &&
        preservedSleep?.bedtime === instant(twoDaysAgo, 23) &&
        preservedSleep?.wakeTime === instant(yesterday, 7) &&
        preservedSleep?.sleepLatencyMin === 15 &&
        preservedSleep?.restingHrBpm === 55 &&
        preservedSleep?.hrvMs === 52 &&
        preservedSleep?.interruptions.length === 1 &&
        sleep.trend.some(
          (point) => point.date === yesterday && closeTo(point.hours, 8),
        ) &&
        sleep.weeklyTrend.reduce((sum, week) => sum + week.nightsLogged, 0) === 2,
      "Sleep trend or summary was inaccurate.",
    );
  });

  let habitId;
  let milestoneId;
  await step("Habits", async () => {
    const habit = await client.request("health:createHabit", {
      name: "Disposable walk",
      description: "Initial description",
      category: "Movement",
      color: "#22c55e",
      icon: "footprints",
      frequency: "daily",
      targetCount: 1,
    });
    habitId = mutationId(habit, "habit");
    await client.request("health:updateHabit", {
      id: habitId,
      name: "Disposable daily walk",
      description: "Updated description",
      category: "Movement",
      color: "#16a34a",
      icon: "footprints",
      frequency: "daily",
      targetCount: 1,
      active: true,
    });
    await client.request("health:toggleHabit", { habitId, date: yesterday });
    await client.request("health:toggleHabit", { habitId, date: today });
    const milestone = await client.request("health:addHabitMilestone", {
      habitId,
      milestoneDate: today,
      description: "First two check-ins",
    });
    milestoneId = mutationId(milestone, "milestone");

    const habits = await client.request("health:getHabits");
    const row = habits.habits.find((item) => item.id === habitId);
    check(
      habits.summary.total === 1 &&
        habits.summary.active === 1 &&
        habits.summary.completedToday === 1 &&
        habits.summary.completionRateToday === 100 &&
        habits.summary.checkInsInWindow === 2 &&
        row?.name === "Disposable daily walk" &&
        row.logs.length === 2 &&
        row.milestones.some((item) => item.id === milestoneId) &&
        row.streaks.current === 2 &&
        row.streaks.best === 2 &&
        habits.trend.at(-1)?.completionRate === 100,
      "Habit summary, history, edit, or milestone was inaccurate.",
    );
  });

  let journalId;
  await step("Journal", async () => {
    await client.request("health:upsertJournal", {
      date: yesterday,
      reflection: "Disposable first reflection",
      gratitude: "A calm morning",
      overallRating: 6,
      realmRatings: [
        { realm: "physical_health", rating: 7 },
        { realm: "work", rating: 5 },
      ],
    });
    const journal = await client.request("health:upsertJournal", {
      date: today,
      reflection: "Disposable second reflection",
      gratitude: "A useful test",
      overallRating: 8,
      realmRatings: [
        { realm: "physical_health", rating: 9 },
        { realm: "work", rating: 7 },
      ],
    });
    journalId = mutationId(journal, "entry");
    await client.request("health:upsertJournal", {
      id: journalId,
      date: today,
      reflection: "Disposable edited reflection",
      gratitude: "A useful test",
      overallRating: 8,
      realmRatings: [
        { realm: "physical_health", rating: 9 },
        { realm: "work", rating: 7 },
      ],
    });

    const journalView = await client.request("health:getJournal");
    check(
      journalView.entries.length === 2 &&
        journalView.trend.length === 2 &&
        closeTo(journalView.summary.averageRating, 7) &&
        journalView.summary.gratitudeEntries === 2 &&
        journalView.summary.realmAverages.some(
          (row) => row.realm === "physical_health" && closeTo(row.average, 8),
        ) &&
        journalView.entries.some(
          (entry) => entry.id === journalId && entry.reflection.includes("edited"),
        ),
      "Journal edit, averages, or realm-rating series was inaccurate.",
    );
  });

  let providerId;
  let doctorId;
  let appointmentId;
  let recordId;
  await step("Medical", async () => {
    const provider = await client.request("health:saveProvider", {
      name: "Disposable Health Clinic",
      phone: "555-0100",
    });
    providerId = mutationId(provider, "provider");
    const doctor = await client.request("health:saveDoctor", {
      providerId,
      name: "Dr. Disposable",
      profession: "Primary care",
      email: "doctor@example.invalid",
    });
    doctorId = mutationId(doctor, "doctor");
    const appointment = await client.request("health:saveAppointment", {
      title: "Disposable annual visit",
      startsAt: instant(dayOffset(7), 15),
      endsAt: instant(dayOffset(7), 16),
      providerId,
      doctorId,
      location: "Test suite",
    });
    appointmentId = mutationId(appointment, "appointment");
    const record = await client.request("health:saveMedicalRecord", {
      name: "Disposable lab summary",
      recordDate: instant(yesterday),
      providerId,
      doctorId,
      eventId: appointmentId,
      notes: "No file is stored by this smoke fixture.",
    });
    recordId = mutationId(record, "record");

    await client.request("health:saveProvider", {
      id: providerId,
      name: "Disposable Health Clinic Updated",
      phone: "555-0101",
    });
    await client.request("health:saveDoctor", {
      id: doctorId,
      providerId,
      name: "Dr. Disposable",
      profession: "Family medicine",
      email: "doctor@example.invalid",
    });
    await client.request("health:saveAppointment", {
      id: appointmentId,
      title: "Disposable annual visit updated",
      startsAt: instant(dayOffset(7), 15),
      endsAt: instant(dayOffset(7), 16),
      providerId,
      doctorId,
      location: "Test suite",
    });
    await client.request("health:saveMedicalRecord", {
      id: recordId,
      name: "Disposable lab summary updated",
      recordDate: instant(yesterday),
      providerId,
      doctorId,
      eventId: appointmentId,
      notes: "Updated metadata",
    });

    const medical = await client.request("health:getMedical");
    check(
      medical.summary.records === 1 &&
        medical.summary.providers === 1 &&
        medical.summary.doctors === 1 &&
        medical.summary.appointments === 1 &&
        medical.summary.upcomingAppointments === 1 &&
        medical.providers[0].name.endsWith("Updated") &&
        medical.doctors[0].profession === "Family medicine" &&
        medical.appointments.some(
          (item) => item.id === appointmentId && item.title.endsWith("updated"),
        ) &&
        medical.records.some(
          (item) =>
            item.id === recordId &&
            item.name.endsWith("updated") &&
            item.providerId === providerId &&
            item.doctorId === doctorId &&
            item.eventId === appointmentId,
        ),
      "Medical CRUD, relationship links, or summary was inaccurate.",
    );
    await expectRejected(
      () => client.request("health:deleteProvider", { id: providerId }, outsiderId),
      "not found",
    );
  });

  let photoId;
  await step("Photos", async () => {
    const photo = await client.request("health:createProgressPhoto", {
      fileName: "health-smoke.png",
      mimeType: "image/png",
      base64:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      takenAt: instant(yesterday),
      angle: "FRONT",
      phase: "MAINTAIN",
      weightKg: 80,
      notes: "Disposable Health photo",
    });
    photoId = mutationId(photo, "photo");
    uploadedPhotoIds.add(photoId);
    await client.request("health:updateProgressPhoto", {
      id: photoId,
      takenAt: instant(today),
      angle: "SIDE",
      phase: "CUT",
      weightKg: 79.8,
      notes: "Updated disposable Health photo",
    });

    const photos = await client.request("health:getPhotos");
    const row = photos.photos.find((item) => item.id === photoId);
    check(
      photos.summary.photos === 1 &&
        photos.summary.angles.side === 1 &&
        photos.timeline.length === 1 &&
        photos.weightSeries.length === 1 &&
        row?.angle === "SIDE" &&
        row?.phase === "CUT" &&
        row?.url?.startsWith("coretex-asset:"),
      "Progress-photo edit, asset URL, or summary was inaccurate.",
    );
  });

  let sobrietyId;
  let relapseId;
  let substanceId;
  let customSubstanceId;
  await step("Sobriety", async () => {
    const counter = await client.request("health:createSobrietyCounter", {
      name: "Disposable caffeine break",
      description: "Initial description",
      startedAt: instant(tenDaysAgo),
      color: "#0ea5e9",
      icon: "coffee",
    });
    sobrietyId = mutationId(counter, "counter");
    await client.request("health:updateSobrietyCounter", {
      id: sobrietyId,
      name: "Disposable caffeine reset",
      description: "Updated description",
      startedAt: instant(tenDaysAgo),
      color: "#0284c7",
      icon: "coffee",
      archived: false,
    });
    const customType = await client.request("health:createCustomSubstance", {
      name: "Disposable soda",
    });
    customSubstanceId = mutationId(customType, "customType");
    const substance = await client.request("health:logSubstance", {
      substanceType: "Disposable soda",
      amount: 12,
      unit: "fl oz",
      loggedAt: instant(yesterday),
      notes: "Disposable log",
    });
    substanceId = mutationId(substance, "log");
    const relapse = await client.request("health:logRelapse", {
      counterId: sobrietyId,
      relapsedAt: instant(yesterday),
      notes: "Disposable lapse",
    });
    relapseId = mutationId(relapse, "relapse");

    const sobriety = await client.request("health:getSobriety");
    const row = sobriety.counters.find((item) => item.id === sobrietyId);
    check(
      sobriety.summary.activeCounters === 1 &&
        sobriety.summary.substanceLogs === 1 &&
        sobriety.summary.relapses === 1 &&
        row?.name === "Disposable caffeine reset" &&
        row.relapses.some((item) => item.id === relapseId) &&
        sobriety.customTypes.some((item) => item.id === customSubstanceId) &&
        sobriety.substanceTrend.some(
          (point) => point.date === yesterday && point.count === 1 && closeTo(point.amount, 12),
        ),
      "Sobriety streak, relapse, substance log, or summary was inaccurate.",
    );
  });

  let peptideId;
  let peptideBlockId;
  let peptideDoseId;
  await step("Peptides", async () => {
    const peptide = await client.request("health:savePeptide", {
      name: "Disposable peptide",
      vialMg: 10,
      waterMl: 2,
      doseUnit: "mg",
      syringeUnitsPerMl: 100,
      vialsOwned: 2,
      vialsOpened: 1,
      activeVialRemainingMl: 2,
      cycleStartDate: tenDaysAgo,
    });
    peptideId = mutationId(peptide, "peptide");
    await client.request("health:savePeptide", {
      id: peptideId,
      name: "Disposable peptide updated",
      vialMg: 10,
      waterMl: 2,
      doseUnit: "mg",
      syringeUnitsPerMl: 100,
      vialsOwned: 2,
      vialsOpened: 1,
      activeVialRemainingMl: 2,
      cycleStartDate: tenDaysAgo,
    });
    const block = await client.request("health:savePeptideBlock", {
      peptideId,
      startWeek: 1,
      endWeek: 4,
      dosePerAdmin: 0.5,
      dosesPerWeek: 2,
      note: "Disposable ramp",
      order: 0,
    });
    peptideBlockId = mutationId(block, "block");
    await client.request("health:savePeptideBlock", {
      id: peptideBlockId,
      peptideId,
      startWeek: 1,
      endWeek: 6,
      dosePerAdmin: 0.5,
      dosesPerWeek: 2,
      note: "Disposable ramp updated",
      order: 0,
    });
    const dose = await client.request("health:logPeptideDose", {
      peptideId,
      blockId: peptideBlockId,
      date: yesterday,
      dose: 0.5,
      units: 10,
      site: "left abdomen",
    });
    peptideDoseId = mutationId(dose, "log");
    check(closeTo(dose.log?.mlUsed, 0.1), "Peptide dose volume was not derived from syringe units.");
    await client.request("health:updatePeptideDose", {
      id: peptideDoseId,
      peptideId,
      blockId: peptideBlockId,
      date: yesterday,
      dose: 0.6,
      units: 12,
      mlUsed: 0.12,
      site: "right abdomen",
    });

    const peptides = await client.request("health:getPeptides");
    const row = peptides.peptides.find((item) => item.id === peptideId);
    check(
      peptides.summary.peptides === 1 &&
        peptides.summary.activeCycles === 1 &&
        peptides.summary.dosesLogged === 1 &&
        closeTo(row?.concentrationMgPerMl, 5) &&
        closeTo(row?.activeVialRemainingMl, 1.88) &&
        row?.blocks.some((item) => item.id === peptideBlockId) &&
        peptides.doseSeries.length === 1 &&
        row?.logs.some(
          (item) => item.id === peptideDoseId && closeTo(item.dose, 0.6),
        ),
      "Peptide concentration, blocks, dose edit, or summary was inaccurate.",
    );
  });

  let medicationId;
  let supplementId;
  let scheduleId;
  let therapeuticLogId;
  let scheduledDoseId;
  await step("Medications", async () => {
    const medication = await client.request("health:saveMedication", {
      name: "Disposable medication",
      dosageAmount: 5,
      dosageUnit: "mg",
      frequency: "daily",
      active: true,
    });
    medicationId = mutationId(medication, "medication");
    await client.request("health:saveMedication", {
      id: medicationId,
      name: "Disposable medication updated",
      dosageAmount: 10,
      dosageUnit: "mg",
      frequency: "daily",
      active: true,
    });
    const supplement = await client.request("health:saveSupplement", {
      name: "Disposable supplement",
      dosageAmount: 1000,
      dosageUnit: "IU",
      frequency: "daily",
      active: true,
    });
    supplementId = mutationId(supplement, "supplement");
    await client.request("health:saveSupplement", {
      id: supplementId,
      name: "Disposable supplement updated",
      dosageAmount: 1200,
      dosageUnit: "IU",
      frequency: "daily",
      active: true,
    });
    const schedule = await client.request("health:saveTherapeuticSchedule", {
      kind: "MEDICATION",
      name: "Disposable medication schedule",
      dosage: "10 mg",
      pattern: "DAILY",
      timesOfDay: ["08:00"],
      startDate: twoDaysAgo,
      endDate: dayOffset(7),
    });
    scheduleId = mutationId(schedule, "schedule");
    await client.request("health:saveTherapeuticSchedule", {
      id: scheduleId,
      kind: "MEDICATION",
      name: "Disposable medication schedule updated",
      dosage: "10 mg",
      pattern: "WEEKLY_DOW",
      daysOfWeek: [weekdayForDay(yesterday)],
      timesOfDay: ["02:30"],
      startDate: yesterday,
      endDate: yesterday,
    });

    let medications = await client.request("health:getMedications");
    const eligibleDose = [...medications.doseHistory30, ...medications.doses].find(
      (dose) => dose.status === "MISSED" || dose.status === "UPCOMING",
    );
    check(eligibleDose?.id, "Therapeutic schedule did not materialize a dose.");
    const scheduledLocal = new Date(eligibleDose.scheduledAt);
    check(
      medications.timeZone === Intl.DateTimeFormat().resolvedOptions().timeZone &&
        localDay(scheduledLocal) === yesterday &&
        scheduledLocal.getHours() === 2 &&
        scheduledLocal.getMinutes() === 30,
      `Therapeutic schedule shifted from local ${yesterday} 02:30 to ${scheduledLocal.toString()} (${medications.timeZone ?? "no timezone"}).`,
    );
    scheduledDoseId = eligibleDose.id;
    await client.request("health:setTherapeuticDoseStatus", {
      id: scheduledDoseId,
      status: "TAKEN",
      loggedAt: new Date().toISOString(),
      notes: "Disposable dose",
    });
    const therapeuticLog = await client.request("health:logTherapeutic", {
      therapeuticKind: "SUPPLEMENT",
      therapeuticId: supplementId,
      name: "Disposable supplement",
      doseAmount: 1000,
      doseUnit: "IU",
      loggedAt: instant(today, 8),
      notes: "Disposable manual log",
    });
    therapeuticLogId = mutationId(therapeuticLog, "log");

    medications = await client.request("health:getMedications");
    check(
      medications.summary.activeMedications === 1 &&
        medications.summary.activeSupplements === 1 &&
        medications.summary.activeSchedules === 1 &&
        medications.medications[0].name.endsWith("updated") &&
        medications.logs.some((log) => log.id === therapeuticLogId) &&
        medications.doseHistory30.some(
          (dose) => dose.id === scheduledDoseId && dose.status === "TAKEN",
        ) &&
        medications.adherence.taken >= 1,
      "Medication edit, therapeutic schedule, dose status, log, or adherence was inaccurate.",
    );
  });

  await step("Overview and fresh connection persistence", async () => {
    const overview = await client.request("health:getOverview");
    check(
      closeTo(overview.latestWeight?.valueKg, 80) &&
        overview.lastSleep?.totalMinutes === 420 &&
        overview.water.goalMl === 3000 &&
        overview.habits.completed === 1 &&
        overview.habits.total === 1 &&
        overview.sobriety.counters.length === 1 &&
        overview.trends.weight.length === 3 &&
        overview.trends.sleep.length === 2,
      "Health overview cards or trend series did not reflect persisted tab data.",
    );

    const freshClient = createRpcClient();
    try {
      const [metrics, vitals, sleep, habits, journal, medical, photos, sobriety, peptides, medications] =
        await Promise.all([
          freshClient.request("health:getMetrics"),
          freshClient.request("health:getVitals"),
          freshClient.request("health:getSleep"),
          freshClient.request("health:getHabits"),
          freshClient.request("health:getJournal"),
          freshClient.request("health:getMedical"),
          freshClient.request("health:getPhotos"),
          freshClient.request("health:getSobriety"),
          freshClient.request("health:getPeptides"),
          freshClient.request("health:getMedications"),
        ]);
      check(
        metrics.metrics.length === 3 &&
          vitals.vitals.length === 4 &&
          sleep.entries.length === 2 &&
          habits.habits.length === 1 &&
          journal.entries.length === 2 &&
          medical.records.length === 1 &&
          photos.photos.length === 1 &&
          sobriety.counters.length === 1 &&
          peptides.peptides.length === 1 &&
          medications.medications.length === 1,
        "A fresh Coretex connection did not return the persisted Health fixture.",
      );
    } finally {
      await freshClient.close();
    }
  });

  await step("Delete paths", async () => {
    await client.request("health:deleteHabitMilestone", { id: milestoneId });
    await client.request("health:deleteHabit", { id: habitId });
    await client.request("health:deleteJournal", { id: journalId });
    await client.request("health:deleteSleep", { id: todaySleepId });
    await client.request("health:deleteMetric", { id: bodyFatId });
    await client.request("health:deleteVital", { id: pressureId });
    await client.request("health:deleteVital", { id: temperatureId });
    await client.request("health:deleteVital", { id: glucoseId });
    await client.request("health:deleteMedicalRecord", { id: recordId });
    await client.request("health:deleteAppointment", { id: appointmentId });
    await client.request("health:deleteDoctor", { id: doctorId });
    await client.request("health:deleteProvider", { id: providerId });
    await client.request("health:deleteProgressPhoto", { id: photoId });
    uploadedPhotoIds.delete(photoId);
    await client.request("health:deleteRelapse", { id: relapseId });
    await client.request("health:deleteSubstance", { id: substanceId });
    await client.request("health:deleteCustomSubstance", { id: customSubstanceId });
    await client.request("health:deleteSobrietyCounter", { id: sobrietyId });
    await client.request("health:deletePeptideDose", { id: peptideDoseId });
    await client.request("health:deletePeptideBlock", { id: peptideBlockId });
    await client.request("health:deletePeptide", { id: peptideId });
    await client.request("health:deleteTherapeutic", { id: therapeuticLogId });
    await client.request("health:deleteTherapeuticSchedule", { id: scheduleId });
    await client.request("health:deleteSupplement", { id: supplementId });
    await client.request("health:deleteMedication", { id: medicationId });

    const [metrics, vitals, sleep, habits, journal, medical, photos, sobriety, peptides, medications] =
      await Promise.all([
        client.request("health:getMetrics"),
        client.request("health:getVitals"),
        client.request("health:getSleep"),
        client.request("health:getHabits"),
        client.request("health:getJournal"),
        client.request("health:getMedical"),
        client.request("health:getPhotos"),
        client.request("health:getSobriety"),
        client.request("health:getPeptides"),
        client.request("health:getMedications"),
      ]);
    check(
      metrics.metrics.length === 2 &&
        !metrics.metrics.some((row) => row.id === bodyFatId) &&
        vitals.vitals.length === 1 &&
        !vitals.vitals.some((row) => row.id === pressureId) &&
        sleep.entries.length === 1 &&
        habits.habits.length === 0 &&
        journal.entries.length === 1 &&
        medical.records.length === 0 &&
        medical.providers.length === 0 &&
        medical.doctors.length === 0 &&
        medical.appointments.length === 0 &&
        photos.photos.length === 0 &&
        sobriety.counters.length === 0 &&
        sobriety.substanceLogs.length === 0 &&
        sobriety.customTypes.length === 0 &&
        peptides.peptides.length === 0 &&
        medications.medications.length === 0 &&
        medications.supplements.length === 0 &&
        medications.schedules.length === 0 &&
        medications.logs.length === 0,
      "One or more Health delete paths remained visible in a read contract.",
    );
  });

  process.stdout.write("Health smoke passed: all 12 tabs, summaries, persistence, ownership, and delete paths.\n");
} catch (error) {
  console.error(`Health smoke failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  for (const photoId of uploadedPhotoIds) {
    try {
      await client.request("health:deleteProgressPhoto", { id: photoId });
    } catch {
      // The fixture user cascade below is the final database fallback. The
      // endpoint attempt is retained so asset files receive normal cleanup.
    }
  }
  await client.close();
  await prisma.user.deleteMany({ where: { id: { in: disposableUserIds } } });
  const remaining = await Promise.all(disposableUserIds.map(countHealthRows));
  if (remaining.some((count) => count !== 0)) {
    console.error(
      `Health smoke cleanup failed (${disposableUserIds.map((id, index) => `${id}: ${remaining[index]}`).join(", ")}).`,
    );
    process.exitCode = 1;
  }
  await prisma.$disconnect();
}
