/**
 * Migrate workout-tracker -> LifeOS (Workouts, Health, Financial, Social,
 * Jobs/Career, Calendar, Therapeutics).
 *
 * Source: postgresql://postgres:postgres@localhost:5434/workout
 * Source S3: MinIO localhost:9000 bucket "workout-media" (minioadmin/minioadmin)
 *
 * The source is multi-tenant via Context; LifeOS is per-user. We pick the single
 * source User (or the first) and route ALL its data to the target user, dropping
 * Context/ContextMember entirely.
 *
 * SKIPPED (per plan): Context/ContextMember, Plaid (PlaidItem), Email/Gmail
 * (EmailMessage/EmailAttachment/GmailConnection), AiCall/AiNarrative telemetry,
 * Settings (target user keeps its own), FoodCache, AccountOwnership ownerships
 * (single-user), voice.
 *
 * CENTS -> DOLLARS conversions (documented inline):
 *   Subscription.amountCents, BudgetCategory.monthlyCents, IncomeEntry.amountCents,
 *   FinTransaction.amountCents  -> Decimal dollars via /100.
 *   NetWorthSnapshot.*Cents (BigInt) -> Decimal dollars via /100.
 */

import { Prisma } from "@prisma/client";
import {
    alreadyMigrated,
    bigCentsToDollars,
    centsToDollars,
    CliArgs,
    copyObject,
    IdMap,
    parseArgs,
    prisma,
    printCounts,
    resolveUserId,
    safeDisconnect,
    SOURCES,
    sourcePrisma,
    toDate,
    toNum,
    writeMarker,
} from "./shared";

const src = SOURCES.workout;
const s3 = src.s3!;

// Source JobApplicationStatus -> target JobStatus.
function mapJobStatus(s: string): Prisma.JobApplicationCreateInput["status"] {
    switch (s) {
        case "NOT_APPLIED":
            return "NOT_STARTED";
        case "UNDER_REVIEW":
            return "UNDER_REVIEW";
        case "ASSESSMENT":
            return "ASSESSMENT";
        case "INTERVIEW":
            return "INTERVIEWING";
        case "OFFER":
            return "OFFERED";
        case "APPLIED":
            return "APPLIED";
        case "OFFER_ACCEPTED":
            return "OFFER_ACCEPTED";
        case "REJECTED":
            return "REJECTED";
        case "GHOSTED":
            return "GHOSTED";
        case "WITHDRAWN":
            return "WITHDRAWN";
        default:
            return "NOT_STARTED";
    }
}

export async function migrateWorkout(args: CliArgs): Promise<void> {
    const userId = await resolveUserId(args.userEmail);
    if (!args.force && (await alreadyMigrated(userId, "workout"))) {
        console.log("[workout] already migrated (marker present) — skipping. Use --force to re-run.");
        return;
    }

    const db = sourcePrisma(src.db);
    const counts: Record<string, number> = {};
    try {
        console.log("[workout] connecting to source…");

        // -- read all relevant tables --
        const exercises = await db.$queryRawUnsafe<ExerciseRow[]>(
            `SELECT id,name,slug,muscles,"secondaryMuscles",equipment,"parentId",instructions,"instructionSteps",notes,"mediaUrl","mediaKey","mediaType",images,force,level,mechanic,category,"externalId","tracksReps","tracksWeight","tracksTime","tracksDistance",archived,"archivedAt","createdAt","updatedAt" FROM "Exercise"`,
        );
        const templates = await db.$queryRawUnsafe<TemplateRow[]>(
            `SELECT id,name,note,progression,"progressionStepKg","cycleWeek",archived,"createdAt","updatedAt" FROM "Template"`,
        );
        const templateExercises = await db.$queryRawUnsafe<TemplateExerciseRow[]>(
            `SELECT id,"templateId","exerciseId","order","targetSets","targetReps","targetRepsMin","targetRepsMax","targetWeight","trainingMaxKg","targetTimeSec","targetDistanceM",note,"restSec","warmupSets","groupKey","targetRpe",tempo,"perSetMode" FROM "TemplateExercise"`,
        );
        const templateSets = await db.$queryRawUnsafe<TemplateSetRow[]>(
            `SELECT id,"templateExerciseId","order","targetReps","targetRepsMin","targetRepsMax","targetWeight","targetRpe","isAmrap","isWarmup" FROM "TemplateSet"`,
        );
        const workouts = await db.$queryRawUnsafe<WorkoutRow[]>(
            `SELECT id,name,note,rpe,date,"startedAt","endedAt","templateId","deletedAt","createdAt","updatedAt" FROM "Workout"`,
        );
        const workoutExercises = await db.$queryRawUnsafe<WorkoutExerciseRow[]>(
            `SELECT id,"workoutId","exerciseId","order",note,"groupKey","restSec",tempo FROM "WorkoutExercise"`,
        );
        const setEntries = await db.$queryRawUnsafe<SetEntryRow[]>(
            `SELECT id,"workoutExerciseId","order","targetReps","actualReps","targetWeight","actualWeight","targetSeconds","actualSeconds","targetMeters","actualMeters",rpe,"targetRpe","isWarmup","isAmrap",completed FROM "SetEntry"`,
        );
        const cycles = await db.$queryRawUnsafe<CycleRow[]>(
            `SELECT id,phase,"startDate","endDate",note,"createdAt","updatedAt" FROM "Cycle"`,
        );
        const bodyMetrics = await db.$queryRawUnsafe<BodyMetricRow[]>(
            `SELECT id,date,weight,"bodyFatPct",chest,waist,"neckCm","hipCm","armL","armR","legL","legR",note,"deletedAt","createdAt","updatedAt" FROM "BodyMetric"`,
        );
        const water = await db.$queryRawUnsafe<WaterRow[]>(
            `SELECT id,date,ml FROM "WaterEntry"`,
        );
        const sleep = await db.$queryRawUnsafe<SleepRow[]>(
            `SELECT id,date,"durationMin","qualityRating","restingHrBpm","hrvMs",notes,"createdAt","updatedAt" FROM "SleepEntry"`,
        );
        const photos = await db.$queryRawUnsafe<PhotoRow[]>(
            `SELECT id,"originalKey","thumbKey","blurKey",angle,phase,"takenAt","workoutId",processed,"deletedAt","createdAt" FROM "Photo"`,
        );
        const meals = await db.$queryRawUnsafe<MealRow[]>(
            `SELECT id,date,type,"loggedAt",note,"deletedAt","createdAt","updatedAt" FROM "Meal"`,
        );
        const foodItems = await db.$queryRawUnsafe<FoodItemRow[]>(
            `SELECT id,"mealId",name,source,quantity,unit,calories,"proteinG","fatG","carbsG","fiberG","sugarG","sodiumMg",confidence,"rawData","order" FROM "FoodItem"`,
        );
        const medSchedules = await db.$queryRawUnsafe<MedScheduleRow[]>(
            `SELECT id,kind,name,dosage,notes,"startDate","endDate",pattern,"everyN","daysOfWeek","timesOfDay","archivedAt","createdAt","updatedAt" FROM "MedicationSchedule"`,
        );
        const medDoses = await db.$queryRawUnsafe<MedDoseRow[]>(
            `SELECT id,"scheduleId","scheduledAt","loggedAt","skippedAt",notes FROM "MedicationDose"`,
        );
        const eventCategories = await db.$queryRawUnsafe<EventCategoryRow[]>(
            `SELECT id,name,color,icon,"createdAt" FROM "EventCategory"`,
        );
        const providers = await db.$queryRawUnsafe<ProviderRow[]>(
            `SELECT id,name,address,phone,website,notes,"archivedAt","createdAt","updatedAt" FROM "Provider"`,
        );
        const doctors = await db.$queryRawUnsafe<DoctorRow[]>(
            `SELECT id,"providerId",name,profession,"avatarS3Key",location,phone,email,notes,"archivedAt","createdAt","updatedAt" FROM "Doctor"`,
        );
        const calEvents = await db.$queryRawUnsafe<CalEventRow[]>(
            `SELECT id,kind,title,description,location,"startsAt","endsAt","allDay","categoryId","providerId","doctorId","visitNotes",rrule,"createdAt","updatedAt" FROM "CalendarEvent"`,
        );
        const attendees = await db.$queryRawUnsafe<AttendeeRow[]>(
            `SELECT id,"eventId","personId",email,name,rsvp FROM "EventAttendee"`,
        );
        const reminders = await db.$queryRawUnsafe<ReminderRow[]>(
            `SELECT id,"eventId","minutesBefore",channel,"firesAt","sentAt" FROM "EventReminder"`,
        );
        const medicalRecords = await db.$queryRawUnsafe<MedicalRecordRow[]>(
            `SELECT id,name,"recordedAt",notes,"eventId","providerId","doctorId","createdAt","updatedAt" FROM "MedicalRecord"`,
        );
        const people = await db.$queryRawUnsafe<WPersonRow[]>(
            `SELECT id,name,email,phone,notes,"firstName","lastName","displayName","avatarS3Key",company,"jobTitle",dob,"archivedAt","createdAt","updatedAt" FROM "Person"`,
        );
        const contactEmails = await db.$queryRawUnsafe<ContactValueRow[]>(
            `SELECT id,"personId",email as value,label,"isPrimary" FROM "ContactEmail"`,
        );
        const contactPhones = await db.$queryRawUnsafe<ContactValueRow[]>(
            `SELECT id,"personId",phone as value,label,"isPrimary" FROM "ContactPhone"`,
        );
        const finAccounts = await db.$queryRawUnsafe<FinAccountRow[]>(
            `SELECT id,kind,institution,nickname,last4,"currentBalance",notes,"archivedAt","createdAt","updatedAt" FROM "FinAccount"`,
        );
        const creditCards = await db.$queryRawUnsafe<CreditCardRow[]>(
            `SELECT id,issuer,"productName",last4,apr,"creditLimit","currentBalance","rewardsNotes",notes,"archivedAt","createdAt","updatedAt" FROM "CreditCard"`,
        );
        const cardNumbers = await db.$queryRawUnsafe<CardNumberRow[]>(
            `SELECT id,"creditCardId",last4,"validFrom","validTo","isCurrent",notes FROM "CardNumber"`,
        );
        const brokerages = await db.$queryRawUnsafe<BrokerageRow[]>(
            `SELECT id,brokerage,"accountName","accountType","currentValue",notes,"archivedAt","createdAt","updatedAt" FROM "BrokerageAccount"`,
        );
        const holdings = await db.$queryRawUnsafe<HoldingRow[]>(
            `SELECT id,"brokerageAccountId",symbol,shares,"costBasisPerShare","currentPrice","asOf" FROM "Holding"`,
        );
        const statements = await db.$queryRawUnsafe<StatementRow[]>(
            `SELECT id,"finAccountId","creditCardId","s3Key",filename,"contentType","sizeBytes","periodStart","periodEnd","endingBalanceCents","extractedTransactionCount","processingStatus","processedAt","processingError","rawExtraction","createdAt" FROM "Statement"`,
        );
        const finTxns = await db.$queryRawUnsafe<FinTxnRow[]>(
            `SELECT id,"finAccountId","creditCardId","statementId",date,"amountCents",merchant,"rawDescription","categoryId",pending,source,"plaidId",notes,"createdAt","updatedAt" FROM "FinTransaction"`,
        );
        const budgets = await db.$queryRawUnsafe<BudgetRow[]>(
            `SELECT id,name,"parentId","monthlyCents","createdAt","updatedAt" FROM "BudgetCategory"`,
        );
        const subscriptions = await db.$queryRawUnsafe<SubscriptionRow[]>(
            `SELECT id,merchant,cadence,"amountCents",currency,status,notes,"createdAt","updatedAt" FROM "Subscription"`,
        );
        const incomeStreams = await db.$queryRawUnsafe<IncomeStreamRow[]>(
            `SELECT id,name,kind,"finAccountId",notes,"archivedAt","createdAt","updatedAt" FROM "IncomeStream"`,
        );
        const incomeEntries = await db.$queryRawUnsafe<IncomeEntryRow[]>(
            `SELECT id,"streamId","amountCents",currency,"receivedAt",source,notes,"createdAt" FROM "IncomeEntry"`,
        );
        const netWorth = await db.$queryRawUnsafe<NetWorthRow[]>(
            `SELECT id,"asOf","assetsCents","liabilitiesCents","netWorthCents",breakdown,"createdAt" FROM "NetWorthSnapshot"`,
        );
        const taxDocs = await db.$queryRawUnsafe<TaxDocRow[]>(
            `SELECT id,"taxYear",kind,description,notes,"createdAt" FROM "TaxDocument"`,
        );
        const todos = await db.$queryRawUnsafe<TodoRow[]>(
            `SELECT id,title,body,source,status,"plannedAt","dueAt","completedAt",hindrance,"createdAt","updatedAt" FROM "TodoItem"`,
        );
        const notifications = await db.$queryRawUnsafe<NotificationRow[]>(
            `SELECT id,kind,severity,title,body,href,"readAt","createdAt" FROM "Notification"`,
        );
        const jobApps = await db.$queryRawUnsafe<JobAppRow[]>(
            `SELECT id,company,position,link,"expectedSalary",notes,status,"appliedAt","archivedAt","createdAt","updatedAt" FROM "JobApplication"`,
        );
        const jobAppEvents = await db.$queryRawUnsafe<JobAppEventRow[]>(
            `SELECT id,"applicationId","fromStatus","toStatus","occurredAt",notes FROM "JobApplicationEvent"`,
        );
        // Resume is one-per-context; sections are separate tables.
        const resumes = await db.$queryRawUnsafe<ResumeRow[]>(
            `SELECT id,headline,summary,"createdAt","updatedAt" FROM "Resume"`,
        );
        const resExp = await db.$queryRawUnsafe<ResExpRow[]>(
            `SELECT id,"resumeId",title,company,location,description,bullets,"startDate","endDate","isPresent","order" FROM "ResumeExperience"`,
        );
        const resProj = await db.$queryRawUnsafe<ResProjRow[]>(
            `SELECT id,"resumeId",title,organization,location,description,bullets,"startDate","endDate","isPresent",link,"order" FROM "ResumeProject"`,
        );
        const resEdu = await db.$queryRawUnsafe<ResEduRow[]>(
            `SELECT id,"resumeId",institution,degree,description,bullets,location,"startDate","endDate","isPresent","order" FROM "ResumeEducation"`,
        );
        const resVol = await db.$queryRawUnsafe<ResVolRow[]>(
            `SELECT id,"resumeId",title,organization,location,description,bullets,"startDate","endDate","isPresent","order" FROM "ResumeVolunteer"`,
        );
        const resSkill = await db.$queryRawUnsafe<ResSkillRow[]>(
            `SELECT id,"resumeId",name,category,"order" FROM "ResumeSkill"`,
        );
        const resCert = await db.$queryRawUnsafe<ResCertRow[]>(
            `SELECT id,"resumeId",name,issuer,link,"issuedAt","order" FROM "ResumeCertification"`,
        );
        const resAward = await db.$queryRawUnsafe<ResAwardRow[]>(
            `SELECT id,"resumeId",name,place,description,"receivedAt","order" FROM "ResumeAward"`,
        );
        const resOrg = await db.$queryRawUnsafe<ResOrgRow[]>(
            `SELECT id,"resumeId",name,status,description,link,"order" FROM "ResumeOrganization"`,
        );

        // counts
        Object.assign(counts, {
            Exercise: exercises.length,
            Template: templates.length,
            TemplateExercise: templateExercises.length,
            TemplateSet: templateSets.length,
            Workout: workouts.length,
            WorkoutExercise: workoutExercises.length,
            SetEntry: setEntries.length,
            TrainingCycle: cycles.length,
            BodyMeasurement: bodyMetrics.length,
            WaterLog: water.length,
            SleepEntry: sleep.length,
            ProgressPhoto: photos.length,
            Meal: meals.length,
            FoodEntry: foodItems.length,
            TherapeuticSchedule: medSchedules.length,
            TherapeuticDose: medDoses.length,
            EventCategory: eventCategories.length,
            Provider: providers.length,
            Doctor: doctors.length,
            CalendarEvent: calEvents.length,
            EventAttendee: attendees.length,
            EventReminder: reminders.length,
            MedicalRecord: medicalRecords.length,
            SocialContact: people.length,
            FinAccount: finAccounts.length,
            CreditCard: creditCards.length,
            CardNumber: cardNumbers.length,
            BrokerageAccount: brokerages.length,
            Holding: holdings.length,
            FinStatement: statements.length,
            FinTransaction: finTxns.length,
            BudgetCategory: budgets.length,
            FinSubscription: subscriptions.length,
            IncomeStream: incomeStreams.length,
            IncomeEntry: incomeEntries.length,
            NetWorthSnapshot: netWorth.length,
            TaxDocument: taxDocs.length,
            TodoItem: todos.length,
            Notification: notifications.length,
            JobApplication: jobApps.length,
            JobApplicationEvent: jobAppEvents.length,
            Resume: resumes.length,
            ResumeItem:
                resExp.length + resProj.length + resEdu.length + resVol.length +
                resSkill.length + resCert.length + resAward.length + resOrg.length,
        });

        if (args.dryRun) {
            printCounts("workout DRY-RUN", counts);
            return;
        }

        // ---------------- Exercises (slug reuse) ----------------
        const exMap = new IdMap("exercise");
        // First pass without parentId (resolve parents second pass).
        for (const e of exercises) {
            const existing = await prisma.exercise.findUnique({ where: { slug: e.slug } });
            if (existing) {
                // Reuse existing catalog exercise id.
                exMap.set(e.id, existing.id);
                continue;
            }
            const mediaKey = await copyObject(s3, e.mediaKey, userId, "workouts", {
                originalName: e.name,
            });
            const created = await prisma.exercise.create({
                data: {
                    userId, // attach to user (was global possible, but per-user here)
                    name: e.name,
                    slug: e.slug,
                    muscles: e.muscles ?? [],
                    secondaryMuscles: e.secondaryMuscles ?? [],
                    equipment: e.equipment ?? [],
                    instructions: e.instructions,
                    instructionSteps: e.instructionSteps ?? [],
                    notes: e.notes,
                    mediaUrl: e.mediaUrl,
                    mediaKey,
                    mediaType: (e.mediaType as Prisma.ExerciseCreateInput["mediaType"]) ?? null,
                    images: e.images ?? [],
                    force: (e.force as Prisma.ExerciseCreateInput["force"]) ?? null,
                    level: (e.level as Prisma.ExerciseCreateInput["level"]) ?? null,
                    mechanic: (e.mechanic as Prisma.ExerciseCreateInput["mechanic"]) ?? null,
                    category: e.category,
                    externalId: e.externalId,
                    tracksReps: e.tracksReps,
                    tracksWeight: e.tracksWeight,
                    tracksTime: e.tracksTime,
                    tracksDistance: e.tracksDistance,
                    archived: e.archived,
                    archivedAt: toDate(e.archivedAt),
                    createdAt: toDate(e.createdAt) ?? undefined,
                    updatedAt: toDate(e.updatedAt) ?? undefined,
                },
            });
            exMap.set(e.id, created.id);
        }
        // parent links second pass (only for freshly-created exercises we own).
        for (const e of exercises) {
            if (!e.parentId) continue;
            const childId = exMap.get(e.id);
            const parentId = exMap.get(e.parentId);
            if (!childId || !parentId || childId === parentId) continue;
            await prisma.exercise
                .update({ where: { id: childId }, data: { parentId } })
                .catch(() => undefined);
        }

        // ---------------- Templates ----------------
        const tMap = new IdMap("template");
        for (const t of templates) {
            const created = await prisma.template.create({
                data: {
                    userId,
                    name: t.name,
                    note: t.note,
                    progression: (t.progression as Prisma.TemplateCreateInput["progression"]) ?? "NONE",
                    progressionStepKg: toNum(t.progressionStepKg),
                    cycleWeek: t.cycleWeek,
                    archived: t.archived,
                    createdAt: toDate(t.createdAt) ?? undefined,
                    updatedAt: toDate(t.updatedAt) ?? undefined,
                },
            });
            tMap.set(t.id, created.id);
        }

        const teMap = new IdMap("templateExercise");
        for (const te of templateExercises) {
            const created = await prisma.templateExercise.create({
                data: {
                    templateId: tMap.require(te.templateId),
                    exerciseId: exMap.require(te.exerciseId),
                    order: te.order,
                    targetSets: te.targetSets,
                    targetReps: te.targetReps,
                    targetRepsMin: te.targetRepsMin,
                    targetRepsMax: te.targetRepsMax,
                    targetWeight: toNum(te.targetWeight),
                    trainingMaxKg: toNum(te.trainingMaxKg),
                    targetTimeSec: te.targetTimeSec,
                    targetDistanceM: toNum(te.targetDistanceM),
                    note: te.note,
                    restSec: te.restSec,
                    warmupSets: (te.warmupSets as Prisma.InputJsonValue) ?? Prisma.JsonNull,
                    groupKey: te.groupKey,
                    targetRpe: toNum(te.targetRpe),
                    tempo: te.tempo,
                    perSetMode: te.perSetMode,
                },
            });
            teMap.set(te.id, created.id);
        }
        for (const ts of templateSets) {
            await prisma.templateSet.create({
                data: {
                    templateExerciseId: teMap.require(ts.templateExerciseId),
                    order: ts.order,
                    targetReps: ts.targetReps,
                    targetRepsMin: ts.targetRepsMin,
                    targetRepsMax: ts.targetRepsMax,
                    targetWeight: toNum(ts.targetWeight),
                    targetRpe: toNum(ts.targetRpe),
                    isAmrap: ts.isAmrap,
                    isWarmup: ts.isWarmup,
                },
            });
        }

        // ---------------- Workouts ----------------
        const wMap = new IdMap("workout");
        for (const w of workouts) {
            const created = await prisma.workout.create({
                data: {
                    userId,
                    name: w.name,
                    note: w.note,
                    rpe: toNum(w.rpe),
                    date: toDate(w.date) ?? new Date(),
                    startedAt: toDate(w.startedAt),
                    endedAt: toDate(w.endedAt),
                    templateId: tMap.get(w.templateId) ?? null,
                    deletedAt: toDate(w.deletedAt),
                    createdAt: toDate(w.createdAt) ?? undefined,
                    updatedAt: toDate(w.updatedAt) ?? undefined,
                },
            });
            wMap.set(w.id, created.id);
        }
        const weMap = new IdMap("workoutExercise");
        for (const we of workoutExercises) {
            const created = await prisma.workoutExercise.create({
                data: {
                    workoutId: wMap.require(we.workoutId),
                    exerciseId: exMap.require(we.exerciseId),
                    order: we.order,
                    note: we.note,
                    groupKey: we.groupKey,
                    restSec: we.restSec,
                    tempo: we.tempo,
                },
            });
            weMap.set(we.id, created.id);
        }
        for (const se of setEntries) {
            await prisma.setEntry.create({
                data: {
                    workoutExerciseId: weMap.require(se.workoutExerciseId),
                    order: se.order,
                    targetReps: se.targetReps,
                    actualReps: se.actualReps,
                    targetWeight: toNum(se.targetWeight),
                    actualWeight: toNum(se.actualWeight),
                    targetSeconds: se.targetSeconds,
                    actualSeconds: se.actualSeconds,
                    targetMeters: toNum(se.targetMeters),
                    actualMeters: toNum(se.actualMeters),
                    rpe: toNum(se.rpe),
                    targetRpe: toNum(se.targetRpe),
                    isWarmup: se.isWarmup,
                    isAmrap: se.isAmrap,
                    completed: se.completed,
                },
            });
        }

        // ---------------- PersonalRecord (source workout has none in this schema; skip) ----

        // ---------------- TrainingCycle ----------------
        for (const c of cycles) {
            await prisma.trainingCycle.create({
                data: {
                    userId,
                    phase: c.phase as Prisma.TrainingCycleCreateInput["phase"],
                    startDate: toDate(c.startDate) ?? new Date(),
                    endDate: toDate(c.endDate),
                    note: c.note,
                    createdAt: toDate(c.createdAt) ?? undefined,
                    updatedAt: toDate(c.updatedAt) ?? undefined,
                },
            });
        }

        // ---------------- BodyMeasurement (BodyMetric) ----------------
        for (const m of bodyMetrics) {
            const d = toDate(m.date) ?? new Date();
            await prisma.bodyMeasurement.create({
                data: {
                    userId,
                    date: dateOnly(d),
                    weightKg: toNum(m.weight),
                    bodyFatPct: toNum(m.bodyFatPct),
                    chestCm: toNum(m.chest),
                    waistCm: toNum(m.waist),
                    neckCm: toNum(m.neckCm),
                    hipCm: toNum(m.hipCm),
                    armLCm: toNum(m.armL),
                    armRCm: toNum(m.armR),
                    legLCm: toNum(m.legL),
                    legRCm: toNum(m.legR),
                    note: m.note,
                    createdAt: toDate(m.createdAt) ?? undefined,
                    updatedAt: toDate(m.updatedAt) ?? undefined,
                },
            });
        }

        // ---------------- WaterLog (upsert by date) ----------------
        for (const w of water) {
            const d = dateOnly(toDate(w.date) ?? new Date());
            await prisma.waterLog.upsert({
                where: { userId_date: { userId, date: d } },
                update: { amountMl: w.ml ?? 0 },
                create: { userId, date: d, amountMl: w.ml ?? 0 },
            });
        }

        // ---------------- SleepEntry (upsert/merge by date) ----------------
        for (const s of sleep) {
            const d = dateOnly(toDate(s.date) ?? new Date());
            await prisma.sleepEntry.upsert({
                where: { userId_date: { userId, date: d } },
                update: {
                    totalMinutes: s.durationMin ?? undefined,
                    sleepQuality: s.qualityRating ?? undefined,
                    restingHrBpm: s.restingHrBpm ?? undefined,
                    hrvMs: s.hrvMs ?? undefined,
                    notes: s.notes ?? undefined,
                },
                create: {
                    userId,
                    date: d,
                    totalMinutes: s.durationMin,
                    sleepQuality: s.qualityRating,
                    restingHrBpm: s.restingHrBpm,
                    hrvMs: s.hrvMs,
                    notes: s.notes,
                    createdAt: toDate(s.createdAt) ?? undefined,
                    updatedAt: toDate(s.updatedAt) ?? undefined,
                },
            });
        }

        // ---------------- ProgressPhoto (copy 3 keys, module "workouts") ----------------
        for (const p of photos) {
            const originalKey = await copyObject(s3, p.originalKey, userId, "workouts");
            const thumbKey = await copyObject(s3, p.thumbKey, userId, "workouts");
            const blurKey = await copyObject(s3, p.blurKey, userId, "workouts");
            await prisma.progressPhoto.create({
                data: {
                    userId,
                    originalKey: originalKey ?? p.originalKey,
                    thumbKey,
                    blurKey,
                    angle: (p.angle as Prisma.ProgressPhotoCreateInput["angle"]) ?? null,
                    phase: (p.phase as Prisma.ProgressPhotoCreateInput["phase"]) ?? null,
                    takenAt: toDate(p.takenAt) ?? new Date(),
                    workoutId: wMap.get(p.workoutId) ?? null,
                    processed: p.processed,
                    createdAt: toDate(p.createdAt) ?? undefined,
                },
            });
        }

        // ---------------- Nutrition: Meal/FoodItem -> NutritionDay+Meal+FoodEntry ----------------
        // NutritionDay is found/created per (user,date). Source Meal has date+type.
        const dayCache = new Map<string, string>();
        async function ensureDay(dateStr: string): Promise<string> {
            let id = dayCache.get(dateStr);
            if (id) return id;
            const d = new Date(`${dateStr}T00:00:00.000Z`);
            const day = await prisma.nutritionDay.upsert({
                where: { userId_date: { userId, date: d } },
                update: {},
                create: { userId, date: d },
            });
            dayCache.set(dateStr, day.id);
            return day.id;
        }
        const mealMap = new IdMap("meal");
        for (const m of meals) {
            const d = toDate(m.date) ?? new Date();
            const dayId = await ensureDay(isoDate(d));
            const created = await prisma.meal.create({
                data: {
                    dayId,
                    mealType: m.type as Prisma.MealCreateInput["mealType"],
                    loggedAt: toDate(m.loggedAt),
                    name: m.note ?? null,
                    createdAt: toDate(m.createdAt) ?? undefined,
                    updatedAt: toDate(m.updatedAt) ?? undefined,
                },
            });
            mealMap.set(m.id, created.id);
        }
        for (const f of foodItems) {
            const mealId = mealMap.get(f.mealId);
            if (!mealId) continue;
            await prisma.foodEntry.create({
                data: {
                    mealId,
                    description: f.name,
                    source: (f.source as Prisma.FoodEntryCreateInput["source"]) ?? "MANUAL",
                    quantity: toNum(f.quantity),
                    unit: f.unit,
                    calories: toNum(f.calories),
                    proteinG: toNum(f.proteinG),
                    carbsG: toNum(f.carbsG),
                    fatG: toNum(f.fatG),
                    fiberG: toNum(f.fiberG),
                    sugarG: toNum(f.sugarG),
                    sodiumMg: toNum(f.sodiumMg),
                    confidence: toNum(f.confidence),
                    aiRawResponse: (f.rawData as Prisma.InputJsonValue) ?? Prisma.JsonNull,
                    order: f.order ?? 0,
                },
            });
        }

        // ---------------- MedicationSchedule/Dose -> TherapeuticSchedule/Dose ----------------
        const schedMap = new IdMap("medSchedule");
        for (const ms of medSchedules) {
            const created = await prisma.therapeuticSchedule.create({
                data: {
                    userId,
                    kind: mapMedKind(ms.kind),
                    name: ms.name,
                    dosage: ms.dosage,
                    notes: ms.notes,
                    startDate: dateOnlyOrNull(ms.startDate),
                    endDate: dateOnlyOrNull(ms.endDate),
                    pattern: (ms.pattern as Prisma.TherapeuticScheduleCreateInput["pattern"]) ?? "DAILY",
                    everyN: ms.everyN,
                    daysOfWeek: ms.daysOfWeek ?? [],
                    timesOfDay: ms.timesOfDay ?? [],
                    archived: ms.archivedAt != null,
                    createdAt: toDate(ms.createdAt) ?? undefined,
                    updatedAt: toDate(ms.updatedAt) ?? undefined,
                },
            });
            schedMap.set(ms.id, created.id);
        }
        for (const md of medDoses) {
            await prisma.therapeuticDose.create({
                data: {
                    userId,
                    scheduleId: schedMap.get(md.scheduleId) ?? null,
                    scheduledAt: toDate(md.scheduledAt) ?? new Date(),
                    loggedAt: toDate(md.loggedAt),
                    skippedAt: toDate(md.skippedAt),
                    notes: md.notes,
                },
            });
        }

        // ---------------- EventCategory / Provider / Doctor ----------------
        const catMap = new IdMap("eventCategory");
        for (const c of eventCategories) {
            const created = await prisma.eventCategory.create({
                data: {
                    userId,
                    name: c.name,
                    color: c.color ?? "neutral",
                    icon: c.icon,
                    createdAt: toDate(c.createdAt) ?? undefined,
                },
            });
            catMap.set(c.id, created.id);
        }
        const provMap = new IdMap("provider");
        for (const p of providers) {
            const created = await prisma.provider.create({
                data: {
                    userId,
                    name: p.name,
                    address: p.address,
                    phone: p.phone,
                    website: p.website,
                    notes: p.notes,
                    archived: p.archivedAt != null,
                    createdAt: toDate(p.createdAt) ?? undefined,
                    updatedAt: toDate(p.updatedAt) ?? undefined,
                },
            });
            provMap.set(p.id, created.id);
        }
        const docMap = new IdMap("doctor");
        for (const d of doctors) {
            const avatarKey = await copyObject(s3, d.avatarS3Key, userId, "health", {
                originalName: d.name,
            });
            const created = await prisma.doctor.create({
                data: {
                    userId,
                    providerId: provMap.get(d.providerId) ?? null,
                    name: d.name,
                    profession: d.profession,
                    avatarKey,
                    location: d.location,
                    phone: d.phone,
                    email: d.email,
                    notes: d.notes,
                    archived: d.archivedAt != null,
                    createdAt: toDate(d.createdAt) ?? undefined,
                    updatedAt: toDate(d.updatedAt) ?? undefined,
                },
            });
            docMap.set(d.id, created.id);
        }

        // ---------------- CalendarEvent (+attendees, reminders) ----------------
        const evMap = new IdMap("calendarEvent");
        for (const e of calEvents) {
            const created = await prisma.calendarEvent.create({
                data: {
                    userId,
                    kind: (e.kind as Prisma.CalendarEventCreateInput["kind"]) ?? "EVENT",
                    title: e.title,
                    description: e.description,
                    location: e.location,
                    startsAt: toDate(e.startsAt) ?? new Date(),
                    endsAt: toDate(e.endsAt),
                    allDay: e.allDay,
                    categoryId: catMap.get(e.categoryId) ?? null,
                    providerId: provMap.get(e.providerId) ?? null,
                    doctorId: docMap.get(e.doctorId) ?? null,
                    visitNotes: e.visitNotes,
                    rrule: e.rrule,
                    createdAt: toDate(e.createdAt) ?? undefined,
                    updatedAt: toDate(e.updatedAt) ?? undefined,
                },
            });
            evMap.set(e.id, created.id);
        }

        // ---------------- SocialContact (Person + emails/phones) ----------------
        // Build first so attendee personId can match by display name.
        const contactMap = new IdMap("person");
        const contactByName = new Map<string, string>();
        for (const p of people) {
            const displayName =
                p.displayName ||
                [p.firstName, p.lastName].filter(Boolean).join(" ").trim() ||
                p.name ||
                "Unknown";
            const avatarKey = await copyObject(s3, p.avatarS3Key, userId, "social", {
                originalName: displayName,
            });
            const created = await prisma.socialContact.create({
                data: {
                    userId,
                    displayName,
                    firstName: p.firstName,
                    lastName: p.lastName,
                    avatarKey,
                    occupation: p.jobTitle,
                    companyOrSchool: p.company,
                    birthday: toDate(p.dob),
                    notes: p.notes,
                    active: p.archivedAt == null,
                    createdAt: toDate(p.createdAt) ?? undefined,
                    updatedAt: toDate(p.updatedAt) ?? undefined,
                },
            });
            contactMap.set(p.id, created.id);
            contactByName.set(displayName.toLowerCase(), created.id);

            // Seed single-value email/phone too (in case sub-tables are sparse).
            if (p.email) {
                await prisma.contactEmail.create({
                    data: { contactId: created.id, email: p.email, label: "Other", isPrimary: true },
                });
            }
            if (p.phone) {
                await prisma.contactPhone.create({
                    data: { contactId: created.id, phone: p.phone, label: "Mobile", isPrimary: true },
                });
            }
        }
        for (const ce of contactEmails) {
            const contactId = contactMap.get(ce.personId);
            if (!contactId || !ce.value) continue;
            await prisma.contactEmail
                .create({
                    data: { contactId, email: ce.value, label: ce.label ?? "Other", isPrimary: ce.isPrimary },
                })
                .catch(() => undefined);
        }
        for (const cp of contactPhones) {
            const contactId = contactMap.get(cp.personId);
            if (!contactId || !cp.value) continue;
            await prisma.contactPhone
                .create({
                    data: { contactId, phone: cp.value, label: cp.label ?? "Mobile", isPrimary: cp.isPrimary },
                })
                .catch(() => undefined);
        }

        // attendees (match personId -> SocialContact by id; else keep name/email)
        for (const a of attendees) {
            const eventId = evMap.get(a.eventId);
            if (!eventId) continue;
            await prisma.eventAttendee.create({
                data: {
                    eventId,
                    contactId: contactMap.get(a.personId) ?? null,
                    email: a.email,
                    name: a.name,
                    rsvp: (a.rsvp as Prisma.EventAttendeeCreateInput["rsvp"]) ?? "PENDING",
                },
            });
        }
        for (const r of reminders) {
            const eventId = evMap.get(r.eventId);
            if (!eventId) continue;
            await prisma.eventReminder.create({
                data: {
                    eventId,
                    minutesBefore: r.minutesBefore,
                    channel: (r.channel as Prisma.EventReminderCreateInput["channel"]) ?? "INAPP",
                    firesAt: toDate(r.firesAt),
                    sentAt: toDate(r.sentAt),
                },
            });
        }

        // ---------------- MedicalRecord ----------------
        for (const mr of medicalRecords) {
            await prisma.medicalRecord.create({
                data: {
                    userId,
                    name: mr.name,
                    providerId: provMap.get(mr.providerId) ?? null,
                    doctorId: docMap.get(mr.doctorId) ?? null,
                    eventId: evMap.get(mr.eventId) ?? null,
                    recordDate: toDate(mr.recordedAt),
                    notes: mr.notes,
                    createdAt: toDate(mr.createdAt) ?? undefined,
                    updatedAt: toDate(mr.updatedAt) ?? undefined,
                },
            });
        }

        // ---------------- Financial: FinAccount ----------------
        const finAccMap = new IdMap("finAccount");
        for (const a of finAccounts) {
            const created = await prisma.finAccount.create({
                data: {
                    userId,
                    kind: (a.kind as Prisma.FinAccountCreateInput["kind"]) ?? "CHECKING",
                    institution: a.institution,
                    nickname: a.nickname,
                    last4: a.last4,
                    currentBalance: dec(toNum(a.currentBalance) ?? 0),
                    notes: a.notes,
                    archived: a.archivedAt != null,
                    createdAt: toDate(a.createdAt) ?? undefined,
                    updatedAt: toDate(a.updatedAt) ?? undefined,
                },
            });
            finAccMap.set(a.id, created.id);
        }
        const cardMap = new IdMap("creditCard");
        for (const c of creditCards) {
            const created = await prisma.creditCard.create({
                data: {
                    userId,
                    issuer: c.issuer,
                    productName: c.productName,
                    last4: c.last4,
                    apr: c.apr != null ? dec(toNum(c.apr)!) : null,
                    creditLimit: c.creditLimit != null ? dec(toNum(c.creditLimit)!) : null,
                    currentBalance: dec(toNum(c.currentBalance) ?? 0),
                    rewardsNotes: c.rewardsNotes,
                    notes: c.notes,
                    archived: c.archivedAt != null,
                    createdAt: toDate(c.createdAt) ?? undefined,
                    updatedAt: toDate(c.updatedAt) ?? undefined,
                },
            });
            cardMap.set(c.id, created.id);
        }
        for (const cn of cardNumbers) {
            const ccId = cardMap.get(cn.creditCardId);
            if (!ccId) continue;
            await prisma.cardNumber.create({
                data: {
                    creditCardId: ccId,
                    last4: cn.last4,
                    validFrom: toDate(cn.validFrom),
                    validTo: toDate(cn.validTo),
                    isCurrent: cn.isCurrent,
                    notes: cn.notes,
                },
            });
        }
        const brokMap = new IdMap("brokerage");
        for (const b of brokerages) {
            const created = await prisma.brokerageAccount.create({
                data: {
                    userId,
                    brokerage: b.brokerage,
                    accountName: b.accountName,
                    accountType: b.accountType,
                    currentValue: dec(toNum(b.currentValue) ?? 0),
                    notes: b.notes,
                    archived: b.archivedAt != null,
                    createdAt: toDate(b.createdAt) ?? undefined,
                    updatedAt: toDate(b.updatedAt) ?? undefined,
                },
            });
            brokMap.set(b.id, created.id);
        }
        for (const h of holdings) {
            const baId = brokMap.get(h.brokerageAccountId);
            if (!baId) continue;
            await prisma.holding.create({
                data: {
                    brokerageAccountId: baId,
                    symbol: h.symbol,
                    shares: dec(toNum(h.shares) ?? 0),
                    costBasisPerShare: h.costBasisPerShare != null ? dec(toNum(h.costBasisPerShare)!) : null,
                    currentPrice: h.currentPrice != null ? dec(toNum(h.currentPrice)!) : null,
                    asOf: toDate(h.asOf),
                },
            });
        }
        const stmtMap = new IdMap("statement");
        for (const st of statements) {
            const fileKey = await copyObject(s3, st.s3Key, userId, "financial", {
                originalName: st.filename,
            });
            const created = await prisma.finStatement.create({
                data: {
                    userId,
                    finAccountId: finAccMap.get(st.finAccountId) ?? null,
                    creditCardId: cardMap.get(st.creditCardId) ?? null,
                    fileKey: fileKey ?? st.s3Key,
                    fileName: st.filename,
                    mimeType: st.contentType,
                    fileSize: st.sizeBytes,
                    periodStart: toDate(st.periodStart),
                    periodEnd: toDate(st.periodEnd),
                    // BigInt cents -> Decimal dollars (/100).
                    endingBalance: st.endingBalanceCents != null ? dec(bigCentsToDollars(st.endingBalanceCents)) : null,
                    extractedTransactionCount: st.extractedTransactionCount,
                    processingStatus: (st.processingStatus as Prisma.FinStatementCreateInput["processingStatus"]) ?? "PENDING",
                    processedAt: toDate(st.processedAt),
                    processingError: st.processingError,
                    rawExtraction: (st.rawExtraction as Prisma.InputJsonValue) ?? Prisma.JsonNull,
                    createdAt: toDate(st.createdAt) ?? undefined,
                },
            });
            stmtMap.set(st.id, created.id);
        }
        // BudgetCategory (cents/100) — parents resolved second pass.
        const budgetMap = new IdMap("budget");
        for (const b of budgets) {
            const created = await prisma.budgetCategory.upsert({
                where: { userId_name: { userId, name: b.name } },
                update: {},
                create: {
                    userId,
                    name: b.name,
                    // monthlyCents Int -> Decimal dollars (/100).
                    monthlyBudget: dec(centsToDollars(b.monthlyCents)),
                    createdAt: toDate(b.createdAt) ?? undefined,
                    updatedAt: toDate(b.updatedAt) ?? undefined,
                },
            });
            budgetMap.set(b.id, created.id);
        }
        for (const b of budgets) {
            if (!b.parentId) continue;
            const childId = budgetMap.get(b.id);
            const parentId = budgetMap.get(b.parentId);
            if (!childId || !parentId || childId === parentId) continue;
            await prisma.budgetCategory.update({ where: { id: childId }, data: { parentId } }).catch(() => undefined);
        }
        const subMap = new IdMap("subscription");
        for (const s of subscriptions) {
            const created = await prisma.finSubscription.create({
                data: {
                    userId,
                    merchant: s.merchant,
                    cadence: (s.cadence as Prisma.FinSubscriptionCreateInput["cadence"]) ?? "MONTHLY",
                    // amountCents Int -> Decimal dollars (/100).
                    amount: dec(centsToDollars(s.amountCents)),
                    currency: s.currency ?? "USD",
                    status: (s.status as Prisma.FinSubscriptionCreateInput["status"]) ?? "ACTIVE",
                    notes: s.notes,
                    createdAt: toDate(s.createdAt) ?? undefined,
                    updatedAt: toDate(s.updatedAt) ?? undefined,
                },
            });
            subMap.set(s.id, created.id);
        }
        const streamMap = new IdMap("incomeStream");
        for (const st of incomeStreams) {
            const created = await prisma.incomeStream.upsert({
                where: { userId_name: { userId, name: st.name } },
                update: {},
                create: {
                    userId,
                    name: st.name,
                    kind: st.kind,
                    finAccountId: finAccMap.get(st.finAccountId) ?? null,
                    notes: st.notes,
                    archived: st.archivedAt != null,
                    createdAt: toDate(st.createdAt) ?? undefined,
                    updatedAt: toDate(st.updatedAt) ?? undefined,
                },
            });
            streamMap.set(st.id, created.id);
        }
        for (const ie of incomeEntries) {
            const streamId = streamMap.get(ie.streamId);
            if (!streamId) continue;
            await prisma.incomeEntry.create({
                data: {
                    userId,
                    streamId,
                    // amountCents Int -> Decimal dollars (/100).
                    amount: dec(centsToDollars(ie.amountCents)),
                    currency: ie.currency ?? "USD",
                    receivedAt: toDate(ie.receivedAt) ?? new Date(),
                    source: ie.source ?? "MANUAL",
                    notes: ie.notes,
                    createdAt: toDate(ie.createdAt) ?? undefined,
                },
            });
        }
        // FinTransaction (amountCents Int -> Decimal dollars /100).
        for (const t of finTxns) {
            await prisma.finTransaction.create({
                data: {
                    userId,
                    finAccountId: finAccMap.get(t.finAccountId) ?? null,
                    creditCardId: cardMap.get(t.creditCardId) ?? null,
                    statementId: stmtMap.get(t.statementId) ?? null,
                    date: dateOnly(toDate(t.date) ?? new Date()),
                    amount: dec(centsToDollars(t.amountCents)),
                    merchant: t.merchant,
                    rawDescription: t.rawDescription,
                    categoryId: budgetMap.get(t.categoryId) ?? null,
                    pending: t.pending,
                    source: mapTxSource(t.source),
                    subscriptionId: null,
                    notes: t.notes,
                    createdAt: toDate(t.createdAt) ?? undefined,
                    updatedAt: toDate(t.updatedAt) ?? undefined,
                },
            });
        }
        for (const n of netWorth) {
            await prisma.netWorthSnapshot.create({
                data: {
                    userId,
                    asOf: toDate(n.asOf) ?? new Date(),
                    // BigInt cents -> Decimal dollars (/100).
                    assets: dec(bigCentsToDollars(n.assetsCents)),
                    liabilities: dec(bigCentsToDollars(n.liabilitiesCents)),
                    netWorth: dec(bigCentsToDollars(n.netWorthCents)),
                    breakdown: (n.breakdown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
                    createdAt: toDate(n.createdAt) ?? undefined,
                },
            });
        }
        for (const td of taxDocs) {
            await prisma.taxDocument.create({
                data: {
                    userId,
                    taxYear: td.taxYear,
                    kind: td.kind,
                    description: td.description,
                    notes: td.notes,
                    createdAt: toDate(td.createdAt) ?? undefined,
                },
            });
        }

        // ---------------- TodoItem ----------------
        for (const t of todos) {
            await prisma.todoItem.create({
                data: {
                    userId,
                    title: t.title,
                    body: t.body,
                    source: (t.source as Prisma.TodoItemCreateInput["source"]) ?? "USER",
                    status: (t.status as Prisma.TodoItemCreateInput["status"]) ?? "PLANNED",
                    plannedAt: toDate(t.plannedAt),
                    dueAt: toDate(t.dueAt),
                    completedAt: toDate(t.completedAt),
                    hindrance: t.hindrance,
                    createdAt: toDate(t.createdAt) ?? undefined,
                    updatedAt: toDate(t.updatedAt) ?? undefined,
                },
            });
        }

        // ---------------- Notification (skip our own migration markers) ----------------
        for (const n of notifications) {
            if (n.title?.startsWith("migration:")) continue;
            await prisma.notification.create({
                data: {
                    userId,
                    kind: (n.kind as Prisma.NotificationCreateInput["kind"]) ?? "SYSTEM",
                    severity: (n.severity as Prisma.NotificationCreateInput["severity"]) ?? "INFO",
                    title: n.title,
                    body: n.body,
                    href: n.href,
                    readAt: toDate(n.readAt),
                    createdAt: toDate(n.createdAt) ?? undefined,
                },
            });
        }

        // ---------------- JobApplication (needs Company; create-or-find by name) ----------------
        const companyByName = new Map<string, string>();
        async function ensureCompany(name: string): Promise<string> {
            const key = name.toLowerCase();
            let id = companyByName.get(key);
            if (id) return id;
            const existing = await prisma.company.findFirst({ where: { userId, name } });
            if (existing) {
                companyByName.set(key, existing.id);
                return existing.id;
            }
            const created = await prisma.company.create({ data: { userId, name } });
            companyByName.set(key, created.id);
            return created.id;
        }
        const jobAppMap = new IdMap("jobApp");
        for (const j of jobApps) {
            const companyId = await ensureCompany(j.company || "Unknown");
            const created = await prisma.jobApplication.create({
                data: {
                    userId,
                    companyId,
                    role: j.position,
                    applicationUrl: j.link,
                    status: mapJobStatus(j.status),
                    dateApplied: toDate(j.appliedAt),
                    notesMarkdown: j.notes,
                    createdAt: toDate(j.createdAt) ?? undefined,
                    updatedAt: toDate(j.updatedAt) ?? undefined,
                },
            });
            jobAppMap.set(j.id, created.id);
        }
        for (const e of jobAppEvents) {
            const applicationId = jobAppMap.get(e.applicationId);
            if (!applicationId) continue;
            await prisma.jobApplicationEvent.create({
                data: {
                    applicationId,
                    type: "status",
                    message: e.notes ?? `${e.fromStatus ?? "—"} → ${e.toStatus}`,
                    fromStatus: e.fromStatus ? mapJobStatus(e.fromStatus) : null,
                    toStatus: mapJobStatus(e.toStatus),
                    createdAt: toDate(e.occurredAt) ?? undefined,
                },
            });
        }

        // ---------------- Resume + sections -> Resume + ResumeItem ----------------
        for (const r of resumes) {
            const resume = await prisma.resume.create({
                data: {
                    userId,
                    headline: r.headline,
                    summary: r.summary,
                    createdAt: toDate(r.createdAt) ?? undefined,
                    updatedAt: toDate(r.updatedAt) ?? undefined,
                },
            });
            const items: Prisma.ResumeItemCreateManyInput[] = [];
            for (const x of resExp.filter((s) => s.resumeId === r.id)) {
                items.push({
                    resumeId: resume.id, kind: "EXPERIENCE", order: x.order, title: x.title,
                    subtitle: x.company, location: x.location, description: x.description,
                    startDate: toDate(x.startDate), endDate: toDate(x.endDate), current: x.isPresent,
                    meta: (x.bullets ? { bullets: x.bullets } : undefined) as Prisma.InputJsonValue | undefined,
                });
            }
            for (const x of resProj.filter((s) => s.resumeId === r.id)) {
                items.push({
                    resumeId: resume.id, kind: "PROJECT", order: x.order, title: x.title,
                    subtitle: x.organization, location: x.location, description: x.description,
                    startDate: toDate(x.startDate), endDate: toDate(x.endDate), current: x.isPresent, url: x.link,
                    meta: (x.bullets ? { bullets: x.bullets } : undefined) as Prisma.InputJsonValue | undefined,
                });
            }
            for (const x of resEdu.filter((s) => s.resumeId === r.id)) {
                items.push({
                    resumeId: resume.id, kind: "EDUCATION", order: x.order, title: x.institution,
                    subtitle: x.degree, location: x.location, description: x.description,
                    startDate: toDate(x.startDate), endDate: toDate(x.endDate), current: x.isPresent,
                    meta: (x.bullets ? { bullets: x.bullets } : undefined) as Prisma.InputJsonValue | undefined,
                });
            }
            for (const x of resVol.filter((s) => s.resumeId === r.id)) {
                items.push({
                    resumeId: resume.id, kind: "VOLUNTEER", order: x.order, title: x.title,
                    subtitle: x.organization, location: x.location, description: x.description,
                    startDate: toDate(x.startDate), endDate: toDate(x.endDate), current: x.isPresent,
                    meta: (x.bullets ? { bullets: x.bullets } : undefined) as Prisma.InputJsonValue | undefined,
                });
            }
            for (const x of resSkill.filter((s) => s.resumeId === r.id)) {
                items.push({ resumeId: resume.id, kind: "SKILL", order: x.order, title: x.name, subtitle: x.category });
            }
            for (const x of resCert.filter((s) => s.resumeId === r.id)) {
                items.push({
                    resumeId: resume.id, kind: "CERTIFICATION", order: x.order, title: x.name,
                    subtitle: x.issuer, url: x.link, startDate: toDate(x.issuedAt),
                });
            }
            for (const x of resAward.filter((s) => s.resumeId === r.id)) {
                items.push({
                    resumeId: resume.id, kind: "AWARD", order: x.order, title: x.name,
                    subtitle: x.place, description: x.description, startDate: toDate(x.receivedAt),
                });
            }
            for (const x of resOrg.filter((s) => s.resumeId === r.id)) {
                items.push({
                    resumeId: resume.id, kind: "ORGANIZATION", order: x.order, title: x.name,
                    subtitle: x.status, description: x.description, url: x.link,
                });
            }
            if (items.length) await prisma.resumeItem.createMany({ data: items });
        }

        printCounts("workout", counts);
        await writeMarker(userId, "workout", counts, args.dryRun);
        console.log("[workout] done.");
    } finally {
        await safeDisconnect(db);
    }
}

// --- helpers ---
function dec(n: number): Prisma.Decimal {
    return new Prisma.Decimal(n);
}
function isoDate(d: Date): string {
    return d.toISOString().slice(0, 10);
}
function dateOnly(d: Date): Date {
    return new Date(`${isoDate(d)}T00:00:00.000Z`);
}
function dateOnlyOrNull(v: unknown): Date | null {
    const d = toDate(v);
    return d ? dateOnly(d) : null;
}
function mapMedKind(k: string): Prisma.TherapeuticScheduleCreateInput["kind"] {
    switch (k) {
        case "THERAPEUTIC":
            return "OTHER";
        case "SUPPLEMENT":
            return "SUPPLEMENT";
        case "MEDICATION":
            return "MEDICATION";
        default:
            return "OTHER";
    }
}
function mapTxSource(s: string): Prisma.FinTransactionCreateInput["source"] {
    switch (s) {
        case "PLAID":
            return "PLAID";
        case "CSV":
            return "CSV";
        default:
            return "MANUAL";
    }
}

// ---- minimal row types ----
interface ExerciseRow {
    id: string; name: string; slug: string; muscles: string[] | null; secondaryMuscles: string[] | null;
    equipment: string[] | null; parentId: string | null; instructions: string | null; instructionSteps: string[] | null;
    notes: string | null; mediaUrl: string | null; mediaKey: string | null; mediaType: string | null; images: string[] | null;
    force: string | null; level: string | null; mechanic: string | null; category: string | null; externalId: string | null;
    tracksReps: boolean; tracksWeight: boolean; tracksTime: boolean; tracksDistance: boolean; archived: boolean;
    archivedAt: Date | null; createdAt: Date | null; updatedAt: Date | null;
}
interface TemplateRow {
    id: string; name: string; note: string | null; progression: string; progressionStepKg: unknown;
    cycleWeek: number | null; archived: boolean; createdAt: Date | null; updatedAt: Date | null;
}
interface TemplateExerciseRow {
    id: string; templateId: string; exerciseId: string; order: number; targetSets: number | null; targetReps: number | null;
    targetRepsMin: number | null; targetRepsMax: number | null; targetWeight: unknown; trainingMaxKg: unknown;
    targetTimeSec: number | null; targetDistanceM: unknown; note: string | null; restSec: number | null;
    warmupSets: unknown; groupKey: string | null; targetRpe: unknown; tempo: string | null; perSetMode: boolean;
}
interface TemplateSetRow {
    id: string; templateExerciseId: string; order: number; targetReps: number | null; targetRepsMin: number | null;
    targetRepsMax: number | null; targetWeight: unknown; targetRpe: unknown; isAmrap: boolean; isWarmup: boolean;
}
interface WorkoutRow {
    id: string; name: string | null; note: string | null; rpe: unknown; date: Date | null; startedAt: Date | null;
    endedAt: Date | null; templateId: string | null; deletedAt: Date | null; createdAt: Date | null; updatedAt: Date | null;
}
interface WorkoutExerciseRow {
    id: string; workoutId: string; exerciseId: string; order: number; note: string | null; groupKey: string | null;
    restSec: number | null; tempo: string | null;
}
interface SetEntryRow {
    id: string; workoutExerciseId: string; order: number; targetReps: number | null; actualReps: number | null;
    targetWeight: unknown; actualWeight: unknown; targetSeconds: number | null; actualSeconds: number | null;
    targetMeters: unknown; actualMeters: unknown; rpe: unknown; targetRpe: unknown; isWarmup: boolean; isAmrap: boolean; completed: boolean;
}
interface CycleRow {
    id: string; phase: string; startDate: Date | null; endDate: Date | null; note: string | null; createdAt: Date | null; updatedAt: Date | null;
}
interface BodyMetricRow {
    id: string; date: Date | null; weight: unknown; bodyFatPct: unknown; chest: unknown; waist: unknown; neckCm: unknown;
    hipCm: unknown; armL: unknown; armR: unknown; legL: unknown; legR: unknown; note: string | null; deletedAt: Date | null;
    createdAt: Date | null; updatedAt: Date | null;
}
interface WaterRow { id: string; date: Date | null; ml: number | null; }
interface SleepRow {
    id: string; date: Date | null; durationMin: number | null; qualityRating: number | null; restingHrBpm: number | null;
    hrvMs: number | null; notes: string | null; createdAt: Date | null; updatedAt: Date | null;
}
interface PhotoRow {
    id: string; originalKey: string; thumbKey: string | null; blurKey: string | null; angle: string | null; phase: string | null;
    takenAt: Date | null; workoutId: string | null; processed: boolean; deletedAt: Date | null; createdAt: Date | null;
}
interface MealRow {
    id: string; date: Date | null; type: string; loggedAt: Date | null; note: string | null; deletedAt: Date | null;
    createdAt: Date | null; updatedAt: Date | null;
}
interface FoodItemRow {
    id: string; mealId: string; name: string; source: string; quantity: unknown; unit: string; calories: unknown;
    proteinG: unknown; fatG: unknown; carbsG: unknown; fiberG: unknown; sugarG: unknown; sodiumMg: unknown;
    confidence: unknown; rawData: unknown; order: number;
}
interface MedScheduleRow {
    id: string; kind: string; name: string; dosage: string | null; notes: string | null; startDate: Date | null;
    endDate: Date | null; pattern: string; everyN: number | null; daysOfWeek: string[] | null; timesOfDay: string[] | null;
    archivedAt: Date | null; createdAt: Date | null; updatedAt: Date | null;
}
interface MedDoseRow {
    id: string; scheduleId: string | null; scheduledAt: Date | null; loggedAt: Date | null; skippedAt: Date | null; notes: string | null;
}
interface EventCategoryRow { id: string; name: string; color: string | null; icon: string | null; createdAt: Date | null; }
interface ProviderRow {
    id: string; name: string; address: string | null; phone: string | null; website: string | null; notes: string | null;
    archivedAt: Date | null; createdAt: Date | null; updatedAt: Date | null;
}
interface DoctorRow {
    id: string; providerId: string | null; name: string; profession: string | null; avatarS3Key: string | null;
    location: string | null; phone: string | null; email: string | null; notes: string | null; archivedAt: Date | null;
    createdAt: Date | null; updatedAt: Date | null;
}
interface CalEventRow {
    id: string; kind: string; title: string; description: string | null; location: string | null; startsAt: Date | null;
    endsAt: Date | null; allDay: boolean; categoryId: string | null; providerId: string | null; doctorId: string | null;
    visitNotes: string | null; rrule: string | null; createdAt: Date | null; updatedAt: Date | null;
}
interface AttendeeRow { id: string; eventId: string; personId: string | null; email: string | null; name: string | null; rsvp: string; }
interface ReminderRow { id: string; eventId: string; minutesBefore: number; channel: string; firesAt: Date | null; sentAt: Date | null; }
interface MedicalRecordRow {
    id: string; name: string; recordedAt: Date | null; notes: string | null; eventId: string | null; providerId: string | null; doctorId: string | null;
    createdAt: Date | null; updatedAt: Date | null;
}
interface WPersonRow {
    id: string; name: string; email: string | null; phone: string | null; notes: string | null; firstName: string | null;
    lastName: string | null; displayName: string | null; avatarS3Key: string | null; company: string | null; jobTitle: string | null;
    dob: Date | null; archivedAt: Date | null; createdAt: Date | null; updatedAt: Date | null;
}
interface ContactValueRow { id: string; personId: string; value: string; label: string | null; isPrimary: boolean; }
interface FinAccountRow {
    id: string; kind: string; institution: string; nickname: string; last4: string | null; currentBalance: unknown;
    notes: string | null; archivedAt: Date | null; createdAt: Date | null; updatedAt: Date | null;
}
interface CreditCardRow {
    id: string; issuer: string; productName: string; last4: string | null; apr: unknown; creditLimit: unknown;
    currentBalance: unknown; rewardsNotes: string | null; notes: string | null; archivedAt: Date | null; createdAt: Date | null; updatedAt: Date | null;
}
interface CardNumberRow { id: string; creditCardId: string; last4: string; validFrom: Date | null; validTo: Date | null; isCurrent: boolean; notes: string | null; }
interface BrokerageRow {
    id: string; brokerage: string; accountName: string; accountType: string; currentValue: unknown; notes: string | null;
    archivedAt: Date | null; createdAt: Date | null; updatedAt: Date | null;
}
interface HoldingRow {
    id: string; brokerageAccountId: string; symbol: string; shares: unknown; costBasisPerShare: unknown; currentPrice: unknown; asOf: Date | null;
}
interface StatementRow {
    id: string; finAccountId: string | null; creditCardId: string | null; s3Key: string; filename: string; contentType: string;
    sizeBytes: number; periodStart: Date | null; periodEnd: Date | null; endingBalanceCents: bigint | null;
    extractedTransactionCount: number; processingStatus: string; processedAt: Date | null; processingError: string | null;
    rawExtraction: unknown; createdAt: Date | null;
}
interface FinTxnRow {
    id: string; finAccountId: string | null; creditCardId: string | null; statementId: string | null; date: Date | null;
    amountCents: number; merchant: string; rawDescription: string | null; categoryId: string | null; pending: boolean;
    source: string; plaidId: string | null; notes: string | null; createdAt: Date | null; updatedAt: Date | null;
}
interface BudgetRow { id: string; name: string; parentId: string | null; monthlyCents: number; createdAt: Date | null; updatedAt: Date | null; }
interface SubscriptionRow {
    id: string; merchant: string; cadence: string; amountCents: number; currency: string; status: string; notes: string | null;
    createdAt: Date | null; updatedAt: Date | null;
}
interface IncomeStreamRow {
    id: string; name: string; kind: string; finAccountId: string | null; notes: string | null; archivedAt: Date | null; createdAt: Date | null; updatedAt: Date | null;
}
interface IncomeEntryRow {
    id: string; streamId: string; amountCents: number; currency: string; receivedAt: Date | null; source: string; notes: string | null; createdAt: Date | null;
}
interface NetWorthRow {
    id: string; asOf: Date | null; assetsCents: bigint; liabilitiesCents: bigint; netWorthCents: bigint; breakdown: unknown; createdAt: Date | null;
}
interface TaxDocRow { id: string; taxYear: number; kind: string; description: string | null; notes: string | null; createdAt: Date | null; }
interface TodoRow {
    id: string; title: string; body: string | null; source: string; status: string; plannedAt: Date | null; dueAt: Date | null;
    completedAt: Date | null; hindrance: string | null; createdAt: Date | null; updatedAt: Date | null;
}
interface NotificationRow {
    id: string; kind: string; severity: string; title: string; body: string | null; href: string | null; readAt: Date | null; createdAt: Date | null;
}
interface JobAppRow {
    id: string; company: string; position: string; link: string | null; expectedSalary: string | null; notes: string | null;
    status: string; appliedAt: Date | null; archivedAt: Date | null; createdAt: Date | null; updatedAt: Date | null;
}
interface JobAppEventRow { id: string; applicationId: string; fromStatus: string | null; toStatus: string; occurredAt: Date | null; notes: string | null; }
interface ResumeRow { id: string; headline: string | null; summary: string | null; createdAt: Date | null; updatedAt: Date | null; }
interface ResExpRow { id: string; resumeId: string; title: string; company: string; location: string | null; description: string | null; bullets: string[] | null; startDate: Date | null; endDate: Date | null; isPresent: boolean; order: number; }
interface ResProjRow { id: string; resumeId: string; title: string; organization: string | null; location: string | null; description: string | null; bullets: string[] | null; startDate: Date | null; endDate: Date | null; isPresent: boolean; link: string | null; order: number; }
interface ResEduRow { id: string; resumeId: string; institution: string; degree: string | null; description: string | null; bullets: string[] | null; location: string | null; startDate: Date | null; endDate: Date | null; isPresent: boolean; order: number; }
interface ResVolRow { id: string; resumeId: string; title: string; organization: string; location: string | null; description: string | null; bullets: string[] | null; startDate: Date | null; endDate: Date | null; isPresent: boolean; order: number; }
interface ResSkillRow { id: string; resumeId: string; name: string; category: string | null; order: number; }
interface ResCertRow { id: string; resumeId: string; name: string; issuer: string; link: string | null; issuedAt: Date | null; order: number; }
interface ResAwardRow { id: string; resumeId: string; name: string; place: string | null; description: string | null; receivedAt: Date | null; order: number; }
interface ResOrgRow { id: string; resumeId: string; name: string; status: string | null; description: string | null; link: string | null; order: number; }

if (import.meta.url === `file://${process.argv[1]}`) {
    migrateWorkout(parseArgs())
        .then(() => prisma.$disconnect())
        .catch(async (e) => {
            console.error(e);
            await prisma.$disconnect();
            process.exit(1);
        });
}
