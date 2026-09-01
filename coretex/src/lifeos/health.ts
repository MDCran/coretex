import { prisma } from "../db/prisma.js";
import { resolveAssetUrl } from "./assets.js";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, resolve } from "node:path";

const DAY_MS = 86_400_000;

function utcToday(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
  );
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysSince(value: Date, now = Date.now()): number {
  return Math.max(0, Math.floor((now - value.getTime()) / DAY_MS));
}

function round(value: number, precision = 1): number {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}

function average(
  values: Array<number | null | undefined>,
  precision = 1,
): number | null {
  const finite = values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
  return finite.length > 0
    ? round(
        finite.reduce((sum, value) => sum + value, 0) / finite.length,
        precision,
      )
    : null;
}

function localAssetUrl(key: string | null): string | null {
  return resolveAssetUrl(key);
}

function bestStreakMs(
  createdAt: Date,
  currentStart: Date,
  relapses: Date[],
  now = Date.now(),
): number {
  const sorted = [...relapses].sort(
    (left, right) => left.getTime() - right.getTime(),
  );
  const earliest =
    sorted.length > 0
      ? Math.min(
          createdAt.getTime(),
          currentStart.getTime(),
          sorted[0].getTime(),
        )
      : Math.min(createdAt.getTime(), currentStart.getTime());
  const boundaries = [earliest, ...sorted.map((date) => date.getTime()), now];
  let best = 0;
  for (let index = 1; index < boundaries.length; index += 1) {
    best = Math.max(best, boundaries[index] - boundaries[index - 1]);
  }
  return Math.max(0, best);
}

export async function getGoals(userId: string) {
  const [
    profile,
    nutritionGoal,
    latestWeightMetric,
    latestMeasurement,
    settings,
  ] = await Promise.all([
    prisma.userProfile.findUnique({
      where: { userId },
      select: {
        gender: true,
        birthdate: true,
        heightCm: true,
        activityLevel: true,
        dietGoal: true,
        targetWeeklyChangeKg: true,
        goalWeightKg: true,
        goalBodyFatPct: true,
        goalTargetDate: true,
        waterGoalMl: true,
      },
    }),
    prisma.nutritionGoal.findUnique({
      where: { userId },
      select: {
        calories: true,
        proteinG: true,
        carbsG: true,
        fatG: true,
        fiberG: true,
        updatedAt: true,
      },
    }),
    prisma.bodyMetric.findFirst({
      where: { userId, metricType: "weight" },
      orderBy: { measuredAt: "desc" },
      select: { value: true, measuredAt: true },
    }),
    prisma.bodyMeasurement.findFirst({
      where: { userId },
      orderBy: { date: "desc" },
      select: { date: true, weightKg: true, bodyFatPct: true },
    }),
    prisma.settings.findUnique({
      where: { userId },
      select: { unitSystem: true },
    }),
  ]);

  const weightKg =
    latestMeasurement?.weightKg ?? latestWeightMetric?.value ?? null;
  const measuredAt =
    latestMeasurement?.weightKg != null
      ? latestMeasurement.date
      : (latestWeightMetric?.measuredAt ?? null);
  const bmi =
    weightKg != null && profile?.heightCm
      ? round(weightKg / (profile.heightCm / 100) ** 2, 1)
      : null;
  const birthdate = profile?.birthdate ?? null;
  const age = birthdate
    ? Math.max(
        0,
        Math.floor((Date.now() - birthdate.getTime()) / (365.2425 * DAY_MS)),
      )
    : null;
  const requiredFields = {
    birthdate,
    heightCm: profile?.heightCm ?? null,
    activityLevel: profile?.activityLevel ?? null,
    dietGoal: profile?.dietGoal ?? null,
    currentWeightKg: weightKg,
  };
  const missingFields = Object.entries(requiredFields)
    .filter(([, value]) => value == null || value === "")
    .map(([field]) => field);

  return {
    unitSystem: settings?.unitSystem ?? "IMPERIAL",
    profile: profile
      ? {
          gender: profile.gender,
          birthdate: profile.birthdate?.toISOString() ?? null,
          age,
          heightCm: profile.heightCm,
          activityLevel: profile.activityLevel,
          dietGoal: profile.dietGoal,
          targetWeeklyChangeKg: profile.targetWeeklyChangeKg,
          goalWeightKg: profile.goalWeightKg,
          goalBodyFatPct: profile.goalBodyFatPct,
          goalTargetDate: profile.goalTargetDate?.toISOString() ?? null,
          waterGoalMl: profile.waterGoalMl ?? 2500,
        }
      : null,
    nutritionGoal: nutritionGoal
      ? {
          calories: nutritionGoal.calories,
          proteinG: nutritionGoal.proteinG,
          carbsG: nutritionGoal.carbsG,
          fatG: nutritionGoal.fatG,
          fiberG: nutritionGoal.fiberG,
          updatedAt: nutritionGoal.updatedAt.toISOString(),
        }
      : null,
    current: {
      weightKg,
      bodyFatPct: latestMeasurement?.bodyFatPct ?? null,
      bmi,
      measuredAt: measuredAt?.toISOString() ?? null,
    },
    readiness: {
      complete: missingFields.length === 0,
      completedFields:
        Object.keys(requiredFields).length - missingFields.length,
      totalFields: Object.keys(requiredFields).length,
      missingFields,
    },
  };
}

export async function getHabits(userId: string) {
  const today = utcToday();
  const since = new Date(today);
  since.setUTCDate(since.getUTCDate() - 200);

  const habits = await prisma.habit.findMany({
    where: { userId },
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      description: true,
      habitType: true,
      frequency: true,
      targetCount: true,
      targetDays: true,
      daysOfWeek: true,
      color: true,
      icon: true,
      category: true,
      cue: true,
      routine: true,
      reward: true,
      stackAfterHabitId: true,
      difficulty: true,
      priority: true,
      reminderTime: true,
      active: true,
      createdAt: true,
      logs: {
        where: { logDate: { gte: since } },
        orderBy: { logDate: "desc" },
        select: { logDate: true, count: true, notes: true },
      },
      milestones: {
        orderBy: { milestoneDate: "desc" },
        select: { id: true, milestoneDate: true, description: true },
      },
    },
  });

  const rows = habits.map((habit) => ({
    id: habit.id,
    name: habit.name,
    description: habit.description,
    habitType: habit.habitType,
    frequency: habit.frequency,
    targetCount: habit.targetCount,
    targetDays: habit.targetDays,
    daysOfWeek: habit.daysOfWeek,
    color: habit.color,
    icon: habit.icon,
    category: habit.category,
    cue: habit.cue,
    routine: habit.routine,
    reward: habit.reward,
    stackAfterHabitId: habit.stackAfterHabitId,
    difficulty: habit.difficulty,
    priority: habit.priority,
    reminderTime: habit.reminderTime,
    active: habit.active,
    createdAt: habit.createdAt.toISOString(),
    completedToday: habit.logs.some(
      (log) => isoDay(log.logDate) === isoDay(today),
    ),
    logDates: habit.logs.map((log) => isoDay(log.logDate)),
    logs: habit.logs.map((log) => ({
      date: isoDay(log.logDate),
      count: log.count,
      notes: log.notes,
    })),
    milestones: habit.milestones.map((milestone) => ({
      id: milestone.id,
      milestoneDate: isoDay(milestone.milestoneDate),
      description: milestone.description,
    })),
  }));
  const active = rows.filter((habit) => habit.active);
  const completedToday = active.filter((habit) => habit.completedToday).length;

  return {
    date: isoDay(today),
    habits: rows,
    summary: {
      total: rows.length,
      active: active.length,
      completedToday,
      completionRateToday:
        active.length > 0
          ? round((completedToday / active.length) * 100, 0)
          : 0,
      checkInsInWindow: rows.reduce((sum, habit) => sum + habit.logs.length, 0),
    },
  };
}

export async function getJournal(userId: string) {
  const entries = await prisma.journalEntry.findMany({
    where: { userId },
    orderBy: { date: "desc" },
    take: 180,
    select: {
      id: true,
      date: true,
      reflection: true,
      gratitude: true,
      overallRating: true,
      realmRatings: { select: { realm: true, rating: true } },
    },
  });

  const rows = entries.map((entry) => ({
    id: entry.id,
    date: isoDay(entry.date),
    reflection: entry.reflection,
    gratitude: entry.gratitude,
    overallRating: entry.overallRating,
    realmRatings: entry.realmRatings.map((rating) => ({
      realm: rating.realm,
      rating: rating.rating,
    })),
  }));
  const realmValues = new Map<string, number[]>();
  for (const entry of entries) {
    for (const rating of entry.realmRatings) {
      const values = realmValues.get(rating.realm) ?? [];
      values.push(rating.rating);
      realmValues.set(rating.realm, values);
    }
  }

  return {
    entries: rows,
    summary: {
      entries: rows.length,
      averageRating: average(entries.map((entry) => entry.overallRating)),
      gratitudeEntries: entries.filter((entry) =>
        Boolean(entry.gratitude?.trim()),
      ).length,
      latestDate: rows[0]?.date ?? null,
      realmAverages: Array.from(realmValues.entries())
        .map(([realm, values]) => ({ realm, average: average(values) ?? 0 }))
        .sort((left, right) => right.average - left.average),
    },
  };
}

export async function getMedical(userId: string) {
  const [records, providers, doctors, appointments, settings] = await Promise.all([
    prisma.medicalRecord.findMany({
      where: { userId },
      orderBy: [{ recordDate: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        name: true,
        recordDate: true,
        notes: true,
        fileName: true,
        fileKey: true,
        mimeType: true,
        fileSize: true,
        providerId: true,
        doctorId: true,
        providerName: true,
        doctorName: true,
        provider: { select: { name: true } },
        doctor: { select: { name: true } },
        extractedItems: {
          select: {
            id: true,
            itemType: true,
            label: true,
            value: true,
            unit: true,
          },
        },
      },
    }),
    prisma.provider.findMany({
      where: { userId, archived: false },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        address: true,
        phone: true,
        website: true,
        notes: true,
      },
    }),
    prisma.doctor.findMany({
      where: { userId, archived: false },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        profession: true,
        location: true,
        phone: true,
        email: true,
        notes: true,
        providerId: true,
      },
    }),
    prisma.calendarEvent.findMany({
      where: { userId, kind: "APPOINTMENT" },
      orderBy: { startsAt: "desc" },
      take: 300,
      select: { id: true, title: true, description: true, location: true, startsAt: true, endsAt: true, visitNotes: true, providerId: true, doctorId: true, provider: { select: { name: true } }, doctor: { select: { name: true } }, records: { select: { id: true, name: true } } },
    }),
    prisma.settings.findUnique({
      where: { userId },
      select: { aiEnabled: true },
    }),
  ]);

  return {
    records: records.map((record) => ({
      id: record.id,
      name: record.name,
      recordDate: record.recordDate?.toISOString() ?? null,
      notes: record.notes,
      fileName: record.fileName,
      fileKey: record.fileKey,
      fileUrl: localAssetUrl(record.fileKey),
      mimeType: record.mimeType,
      fileSize: record.fileSize,
      providerId: record.providerId,
      doctorId: record.doctorId,
      providerName: record.provider?.name ?? record.providerName,
      doctorName: record.doctor?.name ?? record.doctorName,
      extractedItems: record.extractedItems,
    })),
    providers,
    doctors,
    appointments: appointments.map((appointment) => ({ ...appointment, startsAt: appointment.startsAt.toISOString(), endsAt: appointment.endsAt?.toISOString() ?? null, providerName: appointment.provider?.name ?? null, doctorName: appointment.doctor?.name ?? null })),
    aiEnabled: settings?.aiEnabled ?? false,
    summary: {
      records: records.length,
      providers: providers.length,
      doctors: doctors.length,
      extractedItems: records.reduce(
        (sum, record) => sum + record.extractedItems.length,
        0,
      ),
      latestRecordDate: records[0]?.recordDate?.toISOString() ?? null,
    },
  };
}

async function ownedMedicalLinks(userId: string, providerId: string | null, doctorId: string | null) {
  if (providerId) {
    const provider = await prisma.provider.findFirst({ where: { id: providerId, userId, archived: false }, select: { id: true } });
    if (!provider) throw new Error("Provider not found.");
  }
  if (doctorId) {
    const doctor = await prisma.doctor.findFirst({ where: { id: doctorId, userId, archived: false }, select: { id: true } });
    if (!doctor) throw new Error("Doctor not found.");
  }
}

export async function saveProvider(userId: string, raw: MutationPayload) {
  const payload = mutationPayload(raw);
  const id = optionalText(payload, "id", 100);
  const data = { name: requiredText(payload, "name", 160), address: optionalText(payload, "address", 2_000), phone: optionalText(payload, "phone", 80), website: optionalText(payload, "website", 500), notes: optionalText(payload, "notes", 4_000), archived: false };
  if (id) {
    const owned = await prisma.provider.findFirst({ where: { id, userId }, select: { id: true } });
    if (!owned) throw new Error("Provider not found.");
    return prisma.provider.update({ where: { id }, data });
  }
  return prisma.provider.create({ data: { userId, ...data } });
}

export async function deleteProvider(userId: string, raw: MutationPayload) {
  const id = requiredText(mutationPayload(raw), "id", 100);
  const result = await prisma.provider.updateMany({ where: { id, userId }, data: { archived: true } });
  if (!result.count) throw new Error("Provider not found.");
  return { id, archived: true };
}

export async function saveDoctor(userId: string, raw: MutationPayload) {
  const payload = mutationPayload(raw);
  const id = optionalText(payload, "id", 100);
  const providerId = optionalText(payload, "providerId", 100);
  await ownedMedicalLinks(userId, providerId, null);
  const data = { providerId, name: requiredText(payload, "name", 160), profession: optionalText(payload, "profession", 160), location: optionalText(payload, "location", 2_000), phone: optionalText(payload, "phone", 80), email: optionalText(payload, "email", 320), notes: optionalText(payload, "notes", 4_000), archived: false };
  let doctor;
  if (id) {
    const owned = await prisma.doctor.findFirst({ where: { id, userId }, select: { id: true } });
    if (!owned) throw new Error("Doctor not found.");
    doctor = await prisma.doctor.update({ where: { id }, data });
  } else {
    doctor = await prisma.doctor.create({ data: { userId, ...data } });
  }
  const contact = await prisma.socialContact.findFirst({ where: { userId, displayName: data.name, relationshipType: "Healthcare", active: true }, select: { id: true } });
  if (contact) {
    await prisma.socialContact.update({ where: { id: contact.id }, data: { occupation: data.profession, notes: data.notes, preferredContactMethod: data.email ? "email" : data.phone ? "phone" : null } });
  } else {
    await prisma.socialContact.create({ data: { userId, displayName: data.name, relationshipType: "Healthcare", occupation: data.profession, notes: data.notes, preferredContactMethod: data.email ? "email" : data.phone ? "phone" : null, emails: data.email ? { create: { email: data.email, label: "Work", isPrimary: true } } : undefined, phones: data.phone ? { create: { phone: data.phone, label: "Work", isPrimary: true } } : undefined, tags: { connectOrCreate: { where: { userId_name: { userId, name: "Care team" } }, create: { userId, name: "Care team", color: "#06b6d4" } } } } });
  }
  return doctor;
}

export async function deleteDoctor(userId: string, raw: MutationPayload) {
  const id = requiredText(mutationPayload(raw), "id", 100);
  const result = await prisma.doctor.updateMany({ where: { id, userId }, data: { archived: true } });
  if (!result.count) throw new Error("Doctor not found.");
  return { id, archived: true };
}

function medicalAssetDirectory(userId: string) {
  const dataRoot = process.env.CORETEX_DATA_DIR?.trim() || resolve(homedir(), ".coretex");
  return resolve(dataRoot, "lifeos", "assets", userId, "medical");
}

export async function saveMedicalRecord(userId: string, raw: MutationPayload) {
  const payload = mutationPayload(raw);
  const id = optionalText(payload, "id", 100);
  const providerId = optionalText(payload, "providerId", 100);
  const doctorId = optionalText(payload, "doctorId", 100);
  await ownedMedicalLinks(userId, providerId, doctorId);
  const eventId = optionalText(payload, "eventId", 100);
  if (eventId) {
    const event = await prisma.calendarEvent.findFirst({ where: { id: eventId, userId, kind: "APPOINTMENT" }, select: { id: true } });
    if (!event) throw new Error("Appointment not found.");
  }
  let fileData: { fileKey: string; fileName: string; mimeType: string | null; fileSize: number } | undefined;
  const base64 = optionalText(payload, "base64", 40_000_000);
  if (base64) {
    const buffer = Buffer.from(base64.replace(/^data:[^;]+;base64,/i, ""), "base64");
    if (!buffer.length) throw new Error("The selected medical file is empty.");
    if (buffer.length > 25 * 1024 * 1024) throw new Error("Medical files must be 25 MB or smaller.");
    const suppliedName = optionalText(payload, "fileName", 260) || "medical-record";
    const extension = extname(suppliedName).replace(/[^.a-z0-9]/gi, "").slice(0, 12);
    const directory = medicalAssetDirectory(userId);
    await mkdir(directory, { recursive: true });
    const fileKey = resolve(directory, `${Date.now()}_${randomUUID()}${extension}`);
    await writeFile(fileKey, buffer);
    fileData = { fileKey, fileName: suppliedName, mimeType: optionalText(payload, "mimeType", 160), fileSize: buffer.length };
  }
  const recordDate = payload.recordDate ? isoDateTime(payload.recordDate, "recordDate") : null;
  const data = { name: requiredText(payload, "name", 200), recordDate, providerId, doctorId, eventId, notes: optionalText(payload, "notes", 10_000), ...(fileData ?? {}) };
  if (id) {
    const owned = await prisma.medicalRecord.findFirst({ where: { id, userId }, select: { id: true } });
    if (!owned) throw new Error("Medical record not found.");
    return prisma.medicalRecord.update({ where: { id }, data });
  }
  return prisma.medicalRecord.create({ data: { userId, ...data } });
}

export async function deleteMedicalRecord(userId: string, raw: MutationPayload) {
  const id = requiredText(mutationPayload(raw), "id", 100);
  const owned = await prisma.medicalRecord.findFirst({ where: { id, userId }, select: { id: true } });
  if (!owned) throw new Error("Medical record not found.");
  await prisma.medicalRecord.delete({ where: { id } });
  return { id, deleted: true };
}

export async function saveAppointment(userId: string, raw: MutationPayload) {
  const payload = mutationPayload(raw);
  const id = optionalText(payload, "id", 100);
  const providerId = optionalText(payload, "providerId", 100);
  const doctorId = optionalText(payload, "doctorId", 100);
  await ownedMedicalLinks(userId, providerId, doctorId);
  const startsAt = isoDateTime(payload.startsAt, "startsAt");
  const endsAt = payload.endsAt ? isoDateTime(payload.endsAt, "endsAt") : new Date(startsAt.getTime() + 60 * 60_000);
  if (endsAt <= startsAt) throw new Error("Appointment end must be after its start.");
  const data = { kind: "APPOINTMENT" as const, title: requiredText(payload, "title", 200), description: optionalText(payload, "description", 4_000), location: optionalText(payload, "location", 1_000), startsAt, endsAt, allDay: false, providerId, doctorId, visitNotes: optionalText(payload, "visitNotes", 20_000) };
  if (id) {
    const owned = await prisma.calendarEvent.findFirst({ where: { id, userId, kind: "APPOINTMENT" }, select: { id: true } });
    if (!owned) throw new Error("Appointment not found.");
    return prisma.calendarEvent.update({ where: { id }, data });
  }
  return prisma.calendarEvent.create({ data: { userId, ...data } });
}

export async function deleteAppointment(userId: string, raw: MutationPayload) {
  const id = requiredText(mutationPayload(raw), "id", 100);
  const owned = await prisma.calendarEvent.findFirst({ where: { id, userId, kind: "APPOINTMENT" }, select: { id: true } });
  if (!owned) throw new Error("Appointment not found.");
  await prisma.calendarEvent.delete({ where: { id } });
  return { id, deleted: true };
}

export async function getMedications(userId: string) {
  const today = utcToday();
  const horizon = new Date(today);
  horizon.setUTCDate(horizon.getUTCDate() + 8);
  const since30 = new Date(today);
  since30.setUTCDate(since30.getUTCDate() - 30);

  const [medications, supplements, schedules, doses, doseHistory30, logs] =
    await Promise.all([
      prisma.medication.findMany({
        where: { userId },
        orderBy: [{ active: "desc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          dosageAmount: true,
          dosageUnit: true,
          frequency: true,
          notes: true,
          active: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.supplement.findMany({
        where: { userId },
        orderBy: [{ active: "desc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          dosageAmount: true,
          dosageUnit: true,
          frequency: true,
          notes: true,
          active: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.therapeuticSchedule.findMany({
        where: { userId, archived: false },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          kind: true,
          name: true,
          dosage: true,
          notes: true,
          pattern: true,
          everyN: true,
          daysOfWeek: true,
          timesOfDay: true,
          startDate: true,
          endDate: true,
        },
      }),
      prisma.therapeuticDose.findMany({
        where: { userId, scheduledAt: { gte: today, lt: horizon } },
        orderBy: { scheduledAt: "asc" },
        select: {
          id: true,
          scheduledAt: true,
          loggedAt: true,
          skippedAt: true,
          notes: true,
          schedule: { select: { name: true, kind: true, dosage: true } },
        },
      }),
      prisma.therapeuticDose.findMany({
        where: { userId, scheduledAt: { gte: since30, lte: new Date() } },
        orderBy: { scheduledAt: "desc" },
        select: {
          id: true,
          scheduledAt: true,
          loggedAt: true,
          skippedAt: true,
          notes: true,
          schedule: { select: { name: true, kind: true, dosage: true } },
        },
      }),
      prisma.therapeuticLog.findMany({
        where: { userId, loggedAt: { gte: since30 } },
        orderBy: { loggedAt: "desc" },
        select: {
          id: true,
          therapeuticKind: true,
          name: true,
          doseAmount: true,
          doseUnit: true,
          notes: true,
          loggedAt: true,
        },
      }),
    ]);

  const mapTherapeutic = (
    item: (typeof medications)[number] | (typeof supplements)[number],
  ) => ({
    id: item.id,
    name: item.name,
    dosageAmount: item.dosageAmount,
    dosageUnit: item.dosageUnit,
    frequency: item.frequency,
    notes: item.notes,
    active: item.active,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  });
  const mapDose = (dose: (typeof doses)[number]) => ({
    id: dose.id,
    scheduleName: dose.schedule?.name ?? "Dose",
    scheduleKind: dose.schedule?.kind ?? "OTHER",
    dosage: dose.schedule?.dosage ?? null,
    scheduledAt: dose.scheduledAt.toISOString(),
    loggedAt: dose.loggedAt?.toISOString() ?? null,
    skippedAt: dose.skippedAt?.toISOString() ?? null,
    notes: dose.notes,
    status: dose.loggedAt
      ? "TAKEN"
      : dose.skippedAt
        ? "SKIPPED"
        : dose.scheduledAt.getTime() < Date.now()
          ? "MISSED"
          : "UPCOMING",
  });
  const eligible = doseHistory30.length;
  const taken = doseHistory30.filter((dose) => dose.loggedAt != null).length;
  const skipped = doseHistory30.filter((dose) => dose.skippedAt != null).length;

  return {
    medications: medications.map(mapTherapeutic),
    supplements: supplements.map(mapTherapeutic),
    schedules: schedules.map((schedule) => ({
      id: schedule.id,
      kind: schedule.kind,
      name: schedule.name,
      dosage: schedule.dosage,
      notes: schedule.notes,
      pattern: schedule.pattern,
      everyN: schedule.everyN,
      daysOfWeek: schedule.daysOfWeek,
      timesOfDay: schedule.timesOfDay,
      startDate: schedule.startDate ? isoDay(schedule.startDate) : null,
      endDate: schedule.endDate ? isoDay(schedule.endDate) : null,
    })),
    doses: doses.map(mapDose),
    doseHistory30: doseHistory30.map(mapDose),
    logs: logs.map((log) => ({
      id: log.id,
      therapeuticKind: log.therapeuticKind,
      name: log.name,
      doseAmount: log.doseAmount,
      doseUnit: log.doseUnit,
      notes: log.notes,
      loggedAt: log.loggedAt.toISOString(),
    })),
    adherence: {
      windowDays: 30,
      scheduled: eligible,
      taken,
      skipped,
      missed: Math.max(0, eligible - taken - skipped),
      percentage: eligible > 0 ? round((taken / eligible) * 100, 0) : null,
    },
    summary: {
      activeMedications: medications.filter((item) => item.active).length,
      activeSupplements: supplements.filter((item) => item.active).length,
      activeSchedules: schedules.length,
      upcomingDoses: doses.filter(
        (dose) =>
          dose.scheduledAt.getTime() >= Date.now() &&
          !dose.loggedAt &&
          !dose.skippedAt,
      ).length,
    },
  };
}

export async function getMetrics(userId: string) {
  const [metrics, settings, latestMeasurement, measurementWeights] =
    await Promise.all([
      prisma.bodyMetric.findMany({
        where: { userId },
        orderBy: { measuredAt: "desc" },
        take: 500,
        select: {
          id: true,
          metricType: true,
          customName: true,
          value: true,
          unit: true,
          measuredAt: true,
          notes: true,
        },
      }),
      prisma.settings.findUnique({
        where: { userId },
        select: { unitSystem: true },
      }),
      prisma.bodyMeasurement.findFirst({
        where: { userId },
        orderBy: { date: "desc" },
        select: {
          date: true,
          weightKg: true,
          bodyFatPct: true,
          chestCm: true,
          waistCm: true,
          neckCm: true,
          hipCm: true,
          armLCm: true,
          armRCm: true,
          legLCm: true,
          legRCm: true,
        },
      }),
      prisma.bodyMeasurement.findMany({
        where: { userId, weightKg: { not: null } },
        orderBy: { date: "desc" },
        take: 365,
        select: { date: true, weightKg: true },
      }),
    ]);

  const rows = metrics.map((metric) => ({
    id: metric.id,
    metricType: metric.metricType,
    customName: metric.customName,
    value: metric.value,
    unit: metric.unit,
    measuredAt: metric.measuredAt.toISOString(),
    notes: metric.notes,
  }));
  const weightByDay = new Map<
    string,
    { kg: number; source: "body_measurement" | "health_metric" }
  >();
  for (const measurement of measurementWeights) {
    if (measurement.weightKg != null)
      weightByDay.set(isoDay(measurement.date), {
        kg: measurement.weightKg,
        source: "body_measurement",
      });
  }
  for (const metric of metrics) {
    if (metric.metricType !== "weight") continue;
    const day = isoDay(metric.measuredAt);
    if (!weightByDay.has(day))
      weightByDay.set(day, { kg: metric.value, source: "health_metric" });
  }
  const girthFields = latestMeasurement
    ? ([
        ["Chest", latestMeasurement.chestCm],
        ["Waist", latestMeasurement.waistCm],
        ["Neck", latestMeasurement.neckCm],
        ["Hip", latestMeasurement.hipCm],
        ["Arm (L)", latestMeasurement.armLCm],
        ["Arm (R)", latestMeasurement.armRCm],
        ["Leg (L)", latestMeasurement.legLCm],
        ["Leg (R)", latestMeasurement.legRCm],
      ] as const)
    : [];
  const latestByType = new Map<string, (typeof rows)[number]>();
  for (const metric of rows) {
    const key =
      metric.metricType === "custom"
        ? (metric.customName ?? "custom")
        : metric.metricType;
    if (!latestByType.has(key)) latestByType.set(key, metric);
  }

  return {
    metrics: rows,
    weightSeries: Array.from(weightByDay.entries())
      .map(([day, value]) => ({ day, ...value }))
      .sort((left, right) => left.day.localeCompare(right.day)),
    unitSystem: settings?.unitSystem ?? "IMPERIAL",
    girths: girthFields
      .filter(([, cm]) => cm != null)
      .map(([label, cm]) => ({ label, cm: cm as number })),
    girthDate: latestMeasurement?.date.toISOString() ?? null,
    latestByType: Array.from(latestByType.entries()).map(([type, metric]) => ({
      type,
      ...metric,
    })),
    summary: {
      totalEntries: metrics.length,
      metricTypes: latestByType.size,
      latestWeightKg:
        latestMeasurement?.weightKg ??
        metrics.find((metric) => metric.metricType === "weight")?.value ??
        null,
      latestBodyFatPct:
        latestMeasurement?.bodyFatPct ??
        metrics.find((metric) => metric.metricType === "body_fat_pct")?.value ??
        null,
    },
  };
}

export async function getOverview(userId: string) {
  const today = utcToday();
  const [
    latestWeight,
    weightHistoryDesc,
    lastSleep,
    sleepHistoryDesc,
    water,
    profile,
    goal,
    nutritionDay,
    habits,
    sobrietyCounters,
    settings,
  ] = await Promise.all([
    prisma.bodyMetric.findFirst({
      where: { userId, metricType: "weight" },
      orderBy: { measuredAt: "desc" },
      select: { value: true, unit: true, measuredAt: true },
    }),
    prisma.bodyMetric.findMany({
      where: { userId, metricType: "weight" },
      orderBy: { measuredAt: "desc" },
      take: 60,
      select: { value: true, measuredAt: true },
    }),
    prisma.sleepEntry.findFirst({
      where: { userId },
      orderBy: { date: "desc" },
      select: {
        date: true,
        totalMinutes: true,
        sleepQuality: true,
        feelRested: true,
      },
    }),
    prisma.sleepEntry.findMany({
      where: { userId },
      orderBy: { date: "desc" },
      take: 30,
      select: { date: true, totalMinutes: true, sleepQuality: true },
    }),
    prisma.waterLog.findUnique({
      where: { userId_date: { userId, date: today } },
      select: { amountMl: true },
    }),
    prisma.userProfile.findUnique({
      where: { userId },
      select: { waterGoalMl: true, goalWeightKg: true },
    }),
    prisma.nutritionGoal.findUnique({
      where: { userId },
      select: { calories: true, proteinG: true, carbsG: true, fatG: true },
    }),
    prisma.nutritionDay.findUnique({
      where: { userId_date: { userId, date: today } },
      select: {
        meals: {
          select: {
            entries: {
              select: {
                calories: true,
                proteinG: true,
                carbsG: true,
                fatG: true,
              },
            },
          },
        },
      },
    }),
    prisma.habit.findMany({
      where: { userId, active: true },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        logs: { where: { logDate: today }, select: { id: true } },
      },
    }),
    prisma.sobrietyCounter.findMany({
      where: { userId, archived: false },
      orderBy: { startedAt: "asc" },
      select: {
        id: true,
        name: true,
        startedAt: true,
        color: true,
        icon: true,
      },
    }),
    prisma.settings.findUnique({
      where: { userId },
      select: { unitSystem: true },
    }),
  ]);

  const entries = (nutritionDay?.meals ?? []).flatMap((meal) => meal.entries);
  const nutritionTotals = entries.reduce<{
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
  }>(
    (totals, entry) => ({
      calories: totals.calories + (entry.calories ?? 0),
      proteinG: totals.proteinG + (entry.proteinG ?? 0),
      carbsG: totals.carbsG + (entry.carbsG ?? 0),
      fatG: totals.fatG + (entry.fatG ?? 0),
    }),
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );
  const completedHabits = habits.filter(
    (habit) => habit.logs.length > 0,
  ).length;
  const sobriety = sobrietyCounters.map((counter) => ({
    id: counter.id,
    name: counter.name,
    startedAt: counter.startedAt.toISOString(),
    currentDays: daysSince(counter.startedAt),
    color: counter.color,
    icon: counter.icon,
  }));

  return {
    date: isoDay(today),
    unitSystem: settings?.unitSystem ?? "IMPERIAL",
    latestWeight: latestWeight
      ? {
          valueKg: latestWeight.value,
          sourceUnit: latestWeight.unit,
          measuredAt: latestWeight.measuredAt.toISOString(),
          goalWeightKg: profile?.goalWeightKg ?? null,
        }
      : null,
    lastSleep: lastSleep
      ? {
          date: isoDay(lastSleep.date),
          totalMinutes: lastSleep.totalMinutes,
          sleepQuality: lastSleep.sleepQuality,
          feelRested: lastSleep.feelRested,
        }
      : null,
    nutrition: { totals: nutritionTotals, goal },
    water: {
      amountMl: water?.amountMl ?? 0,
      goalMl: profile?.waterGoalMl ?? 2500,
    },
    habits: {
      completed: completedHabits,
      total: habits.length,
      items: habits.map((habit) => ({
        id: habit.id,
        name: habit.name,
        completed: habit.logs.length > 0,
      })),
    },
    sobriety: {
      counters: sobriety,
      longest: sobriety.reduce<(typeof sobriety)[number] | null>(
        (best, counter) =>
          !best || counter.currentDays > best.currentDays ? counter : best,
        null,
      ),
    },
    trends: {
      weight: [...weightHistoryDesc].reverse().map((metric) => ({
        date: isoDay(metric.measuredAt),
        valueKg: metric.value,
      })),
      sleep: [...sleepHistoryDesc].reverse().map((entry) => ({
        date: isoDay(entry.date),
        hours:
          entry.totalMinutes == null ? null : round(entry.totalMinutes / 60, 1),
        quality: entry.sleepQuality,
      })),
    },
  };
}

export async function getPeptides(userId: string) {
  const [peptides, settings] = await Promise.all([
    prisma.peptide.findMany({
      where: { userId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        vialMg: true,
        doseUnit: true,
        waterMl: true,
        syringeUnitsPerMl: true,
        vialsOwned: true,
        vialsOpened: true,
        activeVialRemainingMl: true,
        cycleStartDate: true,
        blocks: {
          orderBy: [{ order: "asc" }, { startWeek: "asc" }],
          select: {
            id: true,
            startWeek: true,
            endWeek: true,
            dosePerAdmin: true,
            dosesPerWeek: true,
            note: true,
          },
        },
        logs: {
          orderBy: { date: "desc" },
          take: 90,
          select: {
            id: true,
            blockId: true,
            date: true,
            dose: true,
            units: true,
            mlUsed: true,
            site: true,
          },
        },
      },
    }),
    prisma.settings.findUnique({
      where: { userId },
      select: { unitSystem: true },
    }),
  ]);

  const rows = peptides.map((peptide) => {
    const daysInCycle = peptide.cycleStartDate
      ? daysSince(peptide.cycleStartDate)
      : null;
    return {
      id: peptide.id,
      name: peptide.name,
      vialMg: peptide.vialMg,
      doseUnit: peptide.doseUnit,
      waterMl: peptide.waterMl,
      concentrationMgPerMl:
        peptide.waterMl > 0 ? round(peptide.vialMg / peptide.waterMl, 3) : null,
      syringeUnitsPerMl: peptide.syringeUnitsPerMl,
      vialsOwned: peptide.vialsOwned,
      vialsOpened: peptide.vialsOpened,
      activeVialRemainingMl: round(peptide.activeVialRemainingMl, 4),
      cycleStartDate: peptide.cycleStartDate
        ? isoDay(peptide.cycleStartDate)
        : null,
      currentWeek: daysInCycle == null ? null : Math.floor(daysInCycle / 7) + 1,
      blocks: peptide.blocks,
      logs: peptide.logs.map((log) => ({ ...log, date: isoDay(log.date) })),
      lastDose: peptide.logs[0]
        ? {
            date: isoDay(peptide.logs[0].date),
            dose: peptide.logs[0].dose,
            site: peptide.logs[0].site,
          }
        : null,
    };
  });

  return {
    peptides: rows,
    unitSystem: settings?.unitSystem ?? "IMPERIAL",
    summary: {
      peptides: rows.length,
      activeCycles: rows.filter((peptide) => peptide.cycleStartDate != null)
        .length,
      vialsOwned: round(
        rows.reduce((sum, peptide) => sum + peptide.vialsOwned, 0),
        1,
      ),
      dosesLogged: rows.reduce((sum, peptide) => sum + peptide.logs.length, 0),
    },
  };
}

export async function getPhotos(userId: string) {
  const [photos, settings, workouts] = await Promise.all([
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
        weightKg: true,
        notes: true,
        takenAt: true,
        processed: true,
        workout: { select: { id: true, name: true, date: true } },
      },
    }),
    prisma.settings.findUnique({
      where: { userId },
      select: { unitSystem: true },
    }),
    prisma.workout.findMany({
      where: { userId, deletedAt: null, isQuickLog: false },
      orderBy: { date: "desc" },
      take: 50,
      select: { id: true, name: true, date: true },
    }),
  ]);

  const rows = photos.map((photo) => ({
    id: photo.id,
    url: localAssetUrl(photo.thumbKey ?? photo.originalKey),
    originalUrl: localAssetUrl(photo.originalKey),
    assetKey: photo.thumbKey ?? photo.originalKey,
    angle: photo.angle,
    phase: photo.phase,
    weightKg: photo.weightKg,
    notes: photo.notes,
    takenAt: photo.takenAt.toISOString(),
    processed: photo.processed,
    workout: photo.workout
      ? {
          id: photo.workout.id,
          name: photo.workout.name?.trim() || "Workout",
          date: isoDay(photo.workout.date),
        }
      : null,
  }));

  return {
    photos: rows,
    workoutOptions: workouts.map((workout) => ({
      id: workout.id,
      name: workout.name?.trim() || "Workout",
      date: isoDay(workout.date),
    })),
    unitSystem: settings?.unitSystem ?? "IMPERIAL",
    summary: {
      photos: rows.length,
      processed: rows.filter((photo) => photo.processed).length,
      linkedToWorkout: rows.filter((photo) => photo.workout != null).length,
      angles: {
        front: rows.filter((photo) => photo.angle === "FRONT").length,
        side: rows.filter((photo) => photo.angle === "SIDE").length,
        back: rows.filter((photo) => photo.angle === "BACK").length,
      },
    },
  };
}

export async function getSleep(userId: string) {
  const entries = await prisma.sleepEntry.findMany({
    where: { userId },
    orderBy: { date: "desc" },
    take: 180,
    select: {
      id: true,
      date: true,
      bedtime: true,
      wakeTime: true,
      totalMinutes: true,
      sleepQuality: true,
      feelRested: true,
      sleepLatencyMin: true,
      restingHrBpm: true,
      hrvMs: true,
      notes: true,
      interruptions: {
        orderBy: { time: "asc" },
        select: {
          time: true,
          durationMinutes: true,
          reason: true,
          notes: true,
        },
      },
    },
  });

  const rows = entries.map((entry) => ({
    id: entry.id,
    date: isoDay(entry.date),
    bedtime: entry.bedtime?.toISOString() ?? null,
    wakeTime: entry.wakeTime?.toISOString() ?? null,
    totalMinutes: entry.totalMinutes,
    sleepQuality: entry.sleepQuality,
    feelRested: entry.feelRested,
    sleepLatencyMin: entry.sleepLatencyMin,
    restingHrBpm: entry.restingHrBpm,
    hrvMs: entry.hrvMs,
    notes: entry.notes,
    interruptions: entry.interruptions.map((interruption) => ({
      time: interruption.time?.toISOString() ?? null,
      durationMinutes: interruption.durationMinutes,
      reason: interruption.reason,
      notes: interruption.notes,
    })),
  }));
  const recent = entries.slice(0, 30);

  return {
    entries: rows,
    summary: {
      entries: rows.length,
      latestDate: rows[0]?.date ?? null,
      averageMinutes: average(
        recent.map((entry) => entry.totalMinutes),
        0,
      ),
      averageQuality: average(recent.map((entry) => entry.sleepQuality)),
      averageRested: average(recent.map((entry) => entry.feelRested)),
      averageLatencyMin: average(
        recent.map((entry) => entry.sleepLatencyMin),
        0,
      ),
      interruptions: recent.reduce(
        (sum, entry) => sum + entry.interruptions.length,
        0,
      ),
    },
  };
}

export async function getSobriety(userId: string) {
  const [counters, substanceLogs, customTypes] = await Promise.all([
    prisma.sobrietyCounter.findMany({
      where: { userId },
      orderBy: [{ archived: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        description: true,
        color: true,
        icon: true,
        startedAt: true,
        archived: true,
        createdAt: true,
        relapses: {
          orderBy: { relapsedAt: "desc" },
          select: { id: true, relapsedAt: true, notes: true },
        },
      },
    }),
    prisma.substanceLog.findMany({
      where: { userId },
      orderBy: { loggedAt: "desc" },
      take: 500,
      select: {
        id: true,
        substanceType: true,
        amount: true,
        unit: true,
        loggedAt: true,
        notes: true,
      },
    }),
    prisma.customSubstanceType.findMany({
      where: { userId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const rows = counters.map((counter) => {
    const recordMs = bestStreakMs(
      counter.createdAt,
      counter.startedAt,
      counter.relapses.map((relapse) => relapse.relapsedAt),
    );
    return {
      id: counter.id,
      name: counter.name,
      description: counter.description,
      color: counter.color,
      icon: counter.icon,
      startedAt: counter.startedAt.toISOString(),
      archived: counter.archived,
      createdAt: counter.createdAt.toISOString(),
      currentStreakDays: daysSince(counter.startedAt),
      bestStreakMs: recordMs,
      bestStreakDays: Math.floor(recordMs / DAY_MS),
      relapses: counter.relapses.map((relapse) => ({
        id: relapse.id,
        relapsedAt: relapse.relapsedAt.toISOString(),
        notes: relapse.notes,
      })),
    };
  });
  const logRows = substanceLogs.map((log) => ({
    id: log.id,
    substanceType: log.substanceType,
    amount: log.amount,
    unit: log.unit,
    loggedAt: log.loggedAt.toISOString(),
    notes: log.notes,
  }));
  const active = rows.filter((counter) => !counter.archived);

  return {
    counters: rows,
    substanceLogs: logRows,
    customTypes,
    summary: {
      activeCounters: active.length,
      longestCurrentDays: active.reduce(
        (best, counter) => Math.max(best, counter.currentStreakDays),
        0,
      ),
      longestBestDays: rows.reduce(
        (best, counter) => Math.max(best, counter.bestStreakDays),
        0,
      ),
      substanceLogs: logRows.length,
      relapses: rows.reduce((sum, counter) => sum + counter.relapses.length, 0),
    },
  };
}

export async function getVitals(userId: string) {
  const vitals = await prisma.vitalReading.findMany({
    where: { userId },
    orderBy: { measuredAt: "desc" },
    take: 500,
    select: {
      id: true,
      vitalType: true,
      customName: true,
      value: true,
      value2: true,
      unit: true,
      measuredAt: true,
      notes: true,
      fields: {
        orderBy: { position: "asc" },
        select: { label: true, unit: true, value: true },
      },
    },
  });

  const rows = vitals.map((vital) => ({
    id: vital.id,
    vitalType: vital.vitalType,
    customName: vital.customName,
    value: vital.value,
    value2: vital.value2,
    unit: vital.unit,
    measuredAt: vital.measuredAt.toISOString(),
    notes: vital.notes,
    fields: vital.fields,
  }));
  const latestByType = new Map<string, (typeof rows)[number]>();
  for (const vital of rows) {
    const type =
      vital.vitalType === "custom"
        ? (vital.customName ?? "custom")
        : vital.vitalType;
    if (!latestByType.has(type)) latestByType.set(type, vital);
  }
  const since30 = Date.now() - 30 * DAY_MS;

  return {
    vitals: rows,
    latestByType: Array.from(latestByType.entries()).map(([type, reading]) => ({
      type,
      ...reading,
    })),
    summary: {
      readings: rows.length,
      vitalTypes: latestByType.size,
      readingsLast30Days: vitals.filter(
        (vital) => vital.measuredAt.getTime() >= since30,
      ).length,
      latestMeasuredAt: rows[0]?.measuredAt ?? null,
    },
  };
}

type MutationPayload = Record<string, unknown> | undefined;

function mutationPayload(payload: MutationPayload): Record<string, unknown> {
  if (!payload || Array.isArray(payload)) {
    throw new Error("A mutation payload is required.");
  }
  return payload;
}

function requiredText(
  payload: Record<string, unknown>,
  key: string,
  maxLength = 200,
): string {
  const value = payload[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} is required.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new Error(`${key} must be ${maxLength} characters or fewer.`);
  }
  return trimmed;
}

function optionalText(
  payload: Record<string, unknown>,
  key: string,
  maxLength = 2_000,
): string | null {
  const value = payload[key];
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new Error(`${key} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new Error(`${key} must be ${maxLength} characters or fewer.`);
  }
  return trimmed || null;
}

function finiteNumber(
  payload: Record<string, unknown>,
  key: string,
  options: {
    min?: number;
    max?: number;
    required?: boolean;
    integer?: boolean;
  } = {},
): number | null {
  const value = payload[key];
  if (value == null || value === "") {
    if (options.required) throw new Error(`${key} is required.`);
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${key} must be a number.`);
  if (options.integer && !Number.isInteger(parsed)) {
    throw new Error(`${key} must be a whole number.`);
  }
  if (options.min != null && parsed < options.min) {
    throw new Error(`${key} must be at least ${options.min}.`);
  }
  if (options.max != null && parsed > options.max) {
    throw new Error(`${key} must be at most ${options.max}.`);
  }
  return parsed;
}

function isoDateTime(value: unknown, key: string, fallback?: Date): Date {
  if (value == null || value === "") {
    if (fallback) return fallback;
    throw new Error(`${key} is required.`);
  }
  if (typeof value !== "string") throw new Error(`${key} is invalid.`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${key} is invalid.`);
  return parsed;
}

function strictUtcDay(value: unknown, key = "date"): Date {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${key} must use YYYY-MM-DD format.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    !parsed.toISOString().startsWith(value)
  ) {
    throw new Error(`${key} is invalid.`);
  }
  return parsed;
}

const METRIC_TYPES = new Set([
  "weight",
  "body_fat_pct",
  "bmi",
  "waist",
  "resting_heart_rate",
  "custom",
]);

const VITAL_TYPES = new Set([
  "blood_pressure",
  "heart_rate",
  "temperature",
  "spo2",
  "respiratory_rate",
  "blood_glucose",
  "custom",
]);

export async function createMetric(userId: string, raw: MutationPayload) {
  const payload = mutationPayload(raw);
  const metricType = requiredText(payload, "metricType", 50).toLowerCase();
  if (!METRIC_TYPES.has(metricType))
    throw new Error("Unsupported metric type.");
  const customName = optionalText(payload, "customName", 100);
  if (metricType === "custom" && !customName) {
    throw new Error("customName is required for a custom metric.");
  }
  const value = finiteNumber(payload, "value", {
    required: true,
    min: -100_000,
    max: 100_000,
  }) as number;
  const measuredAt = isoDateTime(payload.measuredAt, "measuredAt", new Date());
  const metric = await prisma.bodyMetric.create({
    data: {
      userId,
      metricType,
      customName,
      value,
      unit: optionalText(payload, "unit", 30),
      measuredAt,
      notes: optionalText(payload, "notes"),
    },
  });
  return {
    ok: true,
    metric: {
      ...metric,
      measuredAt: metric.measuredAt.toISOString(),
      createdAt: metric.createdAt.toISOString(),
      updatedAt: metric.updatedAt.toISOString(),
    },
  };
}

export async function setUnitSystem(userId: string, raw: MutationPayload) {
  const unitSystem = String(raw?.unitSystem ?? "IMPERIAL").toUpperCase() === "METRIC" ? "METRIC" : "IMPERIAL";
  await prisma.settings.upsert({ where: { userId }, create: { userId, unitSystem }, update: { unitSystem } });
  return { unitSystem };
}

export async function createVital(userId: string, raw: MutationPayload) {
  const payload = mutationPayload(raw);
  const vitalType = requiredText(payload, "vitalType", 50).toLowerCase();
  if (!VITAL_TYPES.has(vitalType)) throw new Error("Unsupported vital type.");
  const customName = optionalText(payload, "customName", 100);
  if (vitalType === "custom" && !customName) {
    throw new Error("customName is required for a custom vital.");
  }
  const value = finiteNumber(payload, "value", { min: -10_000, max: 100_000 });
  const value2 = finiteNumber(payload, "value2", {
    min: -10_000,
    max: 100_000,
  });
  if (value == null && value2 == null)
    throw new Error("A vital value is required.");
  const vital = await prisma.vitalReading.create({
    data: {
      userId,
      vitalType,
      customName,
      value,
      value2,
      unit: optionalText(payload, "unit", 30),
      measuredAt: isoDateTime(payload.measuredAt, "measuredAt", new Date()),
      notes: optionalText(payload, "notes"),
    },
  });
  return {
    ok: true,
    vital: {
      ...vital,
      measuredAt: vital.measuredAt.toISOString(),
      createdAt: vital.createdAt.toISOString(),
      updatedAt: vital.updatedAt.toISOString(),
    },
  };
}

export async function upsertSleep(userId: string, raw: MutationPayload) {
  const payload = mutationPayload(raw);
  const date = strictUtcDay(payload.date);
  const bedtime = payload.bedtime
    ? isoDateTime(payload.bedtime, "bedtime")
    : null;
  const wakeTime = payload.wakeTime
    ? isoDateTime(payload.wakeTime, "wakeTime")
    : null;
  const totalMinutes = finiteNumber(payload, "totalMinutes", {
    min: 0,
    max: 1_440,
    integer: true,
  });
  const sleepQuality = finiteNumber(payload, "sleepQuality", {
    min: 1,
    max: 5,
    integer: true,
  });
  const feelRested = finiteNumber(payload, "feelRested", {
    min: 1,
    max: 5,
    integer: true,
  });
  const sleepLatencyMin = finiteNumber(payload, "sleepLatencyMin", {
    min: 0,
    max: 600,
    integer: true,
  });
  const restingHrBpm = finiteNumber(payload, "restingHrBpm", {
    min: 20,
    max: 300,
    integer: true,
  });
  const hrvMs = finiteNumber(payload, "hrvMs", {
    min: 0,
    max: 1_000,
    integer: true,
  });
  if (bedtime && wakeTime && wakeTime <= bedtime) {
    throw new Error("wakeTime must be after bedtime.");
  }
  const sleep = await prisma.sleepEntry.upsert({
    where: { userId_date: { userId, date } },
    create: {
      userId,
      date,
      bedtime,
      wakeTime,
      totalMinutes,
      sleepQuality,
      feelRested,
      sleepLatencyMin,
      restingHrBpm,
      hrvMs,
      notes: optionalText(payload, "notes"),
    },
    update: {
      bedtime,
      wakeTime,
      totalMinutes,
      sleepQuality,
      feelRested,
      sleepLatencyMin,
      restingHrBpm,
      hrvMs,
      notes: optionalText(payload, "notes"),
    },
  });
  return {
    ok: true,
    sleep: {
      ...sleep,
      date: isoDay(sleep.date),
      bedtime: sleep.bedtime?.toISOString() ?? null,
      wakeTime: sleep.wakeTime?.toISOString() ?? null,
      createdAt: sleep.createdAt.toISOString(),
      updatedAt: sleep.updatedAt.toISOString(),
    },
  };
}

export async function createHabit(userId: string, raw: MutationPayload) {
  const payload = mutationPayload(raw);
  const habit = await prisma.habit.create({
    data: {
      userId,
      name: requiredText(payload, "name", 120),
      description: optionalText(payload, "description", 500),
      category: optionalText(payload, "category", 80),
      frequency: "daily",
      habitType: "good",
      targetCount: 1,
      active: true,
    },
  });
  return {
    ok: true,
    habit: {
      ...habit,
      createdAt: habit.createdAt.toISOString(),
      updatedAt: habit.updatedAt.toISOString(),
    },
  };
}

export async function toggleHabit(userId: string, raw: MutationPayload) {
  const payload = mutationPayload(raw);
  const habitId = requiredText(payload, "habitId", 100);
  const date = payload.date ? strictUtcDay(payload.date) : utcToday();
  const habit = await prisma.habit.findFirst({
    where: { id: habitId, userId },
    select: { id: true, active: true },
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
        count: 1,
        notes: optionalText(payload, "notes", 500),
      },
    });
    return {
      completed: true,
      log: {
        ...log,
        logDate: isoDay(log.logDate),
        createdAt: log.createdAt.toISOString(),
      },
    };
  });
  return { ok: true, habitId, date: isoDay(date), ...result };
}

export async function upsertJournal(userId: string, raw: MutationPayload) {
  const payload = mutationPayload(raw);
  const date = strictUtcDay(payload.date);
  const overallRating = finiteNumber(payload, "overallRating", {
    min: 1,
    max: 10,
    integer: true,
  });
  const data = {
    reflection: optionalText(payload, "reflection", 10_000),
    gratitude: optionalText(payload, "gratitude", 5_000),
    overallRating,
  };
  if (!data.reflection && !data.gratitude && data.overallRating == null) {
    throw new Error("Add a reflection, gratitude note, or rating.");
  }
  const requestedId = optionalText(payload, "id", 100);
  const existing = requestedId
    ? await prisma.journalEntry.findFirst({
        where: { id: requestedId, userId },
        select: { id: true },
      })
    : await prisma.journalEntry.findFirst({
        where: { userId, date },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
  if (requestedId && !existing) throw new Error("Journal entry not found.");
  const entry = existing
    ? await prisma.journalEntry.update({
        where: { id: existing.id },
        data: { date, ...data },
      })
    : await prisma.journalEntry.create({ data: { userId, date, ...data } });
  return {
    ok: true,
    entry: {
      ...entry,
      date: isoDay(entry.date),
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
    },
  };
}

export async function saveMedication(userId: string, raw: MutationPayload) {
  const payload = mutationPayload(raw);
  const requestedId = optionalText(payload, "id", 100);
  const data = {
    name: requiredText(payload, "name", 150),
    dosageAmount: finiteNumber(payload, "dosageAmount", {
      min: 0,
      max: 1_000_000,
    }),
    dosageUnit: optionalText(payload, "dosageUnit", 30),
    frequency: optionalText(payload, "frequency", 100),
    notes: optionalText(payload, "notes", 2_000),
    active: typeof payload.active === "boolean" ? payload.active : true,
  };
  let medication;
  if (requestedId) {
    const owned = await prisma.medication.findFirst({
      where: { id: requestedId, userId },
      select: { id: true },
    });
    if (!owned) throw new Error("Medication not found.");
    medication = await prisma.medication.update({
      where: { id: owned.id },
      data,
    });
  } else {
    medication = await prisma.medication.create({ data: { userId, ...data } });
  }
  return {
    ok: true,
    medication: {
      ...medication,
      createdAt: medication.createdAt.toISOString(),
      updatedAt: medication.updatedAt.toISOString(),
    },
  };
}

export async function createSobrietyCounter(userId: string, raw: MutationPayload) {
  const payload = raw ?? {};
  const name = String(payload.name ?? "").trim();
  if (!name) throw new Error("A sobriety counter name is required.");
  const startedAt = payload.startedAt ? new Date(String(payload.startedAt)) : utcToday();
  const counter = await prisma.sobrietyCounter.create({ data: { userId, name, description: String(payload.description ?? "").trim() || null, startedAt } });
  return { id: counter.id };
}

export async function logSubstance(userId: string, raw: MutationPayload) {
  const payload = raw ?? {};
  const substanceType = String(payload.substanceType ?? "").trim();
  if (!substanceType) throw new Error("A substance type is required.");
  const log = await prisma.substanceLog.create({ data: { userId, substanceType, amount: payload.amount == null || payload.amount === "" ? null : Number(payload.amount), unit: String(payload.unit ?? "").trim() || null, notes: String(payload.notes ?? "").trim() || null, loggedAt: payload.loggedAt ? new Date(String(payload.loggedAt)) : new Date() } });
  return { id: log.id };
}

export async function createPeptide(userId: string, raw: MutationPayload) {
  const payload = raw ?? {};
  const name = String(payload.name ?? "").trim();
  if (!name) throw new Error("A peptide name is required.");
  const peptide = await prisma.peptide.create({ data: { userId, name, vialMg: Number(payload.vialMg ?? 0), waterMl: Number(payload.waterMl ?? 0), doseUnit: String(payload.doseUnit ?? "mg"), vialsOwned: Number(payload.vialsOwned ?? 0), activeVialRemainingMl: Number(payload.activeVialRemainingMl ?? payload.waterMl ?? 0) } });
  return { id: peptide.id };
}

export async function logPeptideDose(userId: string, raw: MutationPayload) {
  const payload = raw ?? {};
  const peptideId = String(payload.peptideId ?? "");
  const peptide = await prisma.peptide.findFirst({ where: { id: peptideId, userId }, select: { id: true, waterMl: true, vialMg: true, activeVialRemainingMl: true } });
  if (!peptide) throw new Error("Peptide not found.");
  const dose = Number(payload.dose ?? 0);
  const mlUsed = Number(payload.mlUsed ?? 0);
  const log = await prisma.peptideLog.create({ data: { peptideId, date: payload.date ? new Date(String(payload.date)) : utcToday(), dose, units: Number(payload.units ?? dose), mlUsed, site: String(payload.site ?? "").trim() || null } });
  await prisma.peptide.update({ where: { id: peptide.id }, data: { activeVialRemainingMl: Math.max(0, peptide.activeVialRemainingMl - mlUsed) } });
  return { id: log.id };
}
