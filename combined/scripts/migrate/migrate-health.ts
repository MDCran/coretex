/**
 * Migrate health-tracker (Flyway/Postgres) -> LifeOS.
 *
 * Source: postgresql://health_user:health_dev_pass@localhost:5433/personal_health
 * Source S3: LocalStack localhost:4566 bucket "health-tracker" (test/test)
 *
 * The source app's generated client is not available, so we use a second
 * PrismaClient pointed at the source URL with $queryRawUnsafe + raw SELECTs.
 * Health tables are snake_case (created by Flyway), so identifiers are NOT
 * quoted in raw SQL. BIGSERIAL ids come back as BigInt — IdMap stringifies.
 *
 * MONEY: financial_transaction.amount + financial_account.current_balance are
 * NUMERIC dollars already (NO cents). Career *_cents and social gift amount_cents
 * + financial_goal *_cents + net_worth_snapshot *_cents ARE cents -> /100.
 *
 * SKIP (per plan): billing/stripe, totp, api keys, openai_usage, google tokens,
 * identity_document, medical_history, family_history, referral_code, *_extraction
 * internals (we map the resolved extracted items only), workout_* (covered by
 * workout-tracker migration), peptide_compound dosing internals.
 */

import { Prisma } from "@prisma/client";
import {
    alreadyMigrated,
    bigCentsToDollars,
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

const src = SOURCES.health;
const s3 = src.s3!;

function dec(n: number): Prisma.Decimal {
    return new Prisma.Decimal(n);
}
function isoDate(d: Date): string {
    return d.toISOString().slice(0, 10);
}
function dateOnly(v: unknown): Date {
    const d = toDate(v) ?? new Date();
    return new Date(`${isoDate(d)}T00:00:00.000Z`);
}
function dateOnlyOrNull(v: unknown): Date | null {
    const d = toDate(v);
    return d ? new Date(`${isoDate(d)}T00:00:00.000Z`) : null;
}
/** Best-effort JSON parse of a JSONB column (object or string). */
function asJson(v: unknown): unknown {
    if (v == null) return null;
    if (typeof v === "string") {
        try {
            return JSON.parse(v);
        } catch {
            return null;
        }
    }
    return v;
}
function asStringArray(v: unknown): string[] {
    const j = asJson(v);
    if (Array.isArray(j)) return j.map((x) => String(x));
    return [];
}

export async function migrateHealth(args: CliArgs): Promise<void> {
    const userId = await resolveUserId(args.userEmail);
    if (!args.force && (await alreadyMigrated(userId, "health"))) {
        console.log("[health] already migrated (marker present) — skipping. Use --force to re-run.");
        return;
    }

    const db = sourcePrisma(src.db);
    const counts: Record<string, number> = {};
    const q = <T>(sql: string) => db.$queryRawUnsafe<T[]>(sql);

    try {
        console.log("[health] connecting to source…");

        // ===================== USER PROFILE (merge only) =====================
        const profiles = await q<ProfileRow>(
            `SELECT height_cm, gender, activity_level, diet_goal, target_weekly_change_kg,
                    goal_weight_kg, goal_body_fat_pct, goal_target_date, water_goal_ml, phone, date_of_birth
             FROM user_profile LIMIT 1`,
        );
        if (!args.dryRun && profiles.length) {
            const p = profiles[0];
            await prisma.userProfile.upsert({
                where: { userId },
                update: {
                    heightCm: toNum(p.height_cm) ?? undefined,
                    gender: p.gender ?? undefined,
                    activityLevel: p.activity_level ?? undefined,
                    dietGoal: p.diet_goal ?? undefined,
                    targetWeeklyChangeKg: toNum(p.target_weekly_change_kg) ?? undefined,
                    goalWeightKg: toNum(p.goal_weight_kg) ?? undefined,
                    goalBodyFatPct: toNum(p.goal_body_fat_pct) ?? undefined,
                    goalTargetDate: toDate(p.goal_target_date) ?? undefined,
                    waterGoalMl: p.water_goal_ml ?? undefined,
                    phone: p.phone ?? undefined,
                    birthdate: toDate(p.date_of_birth) ?? undefined,
                },
                create: {
                    userId,
                    heightCm: toNum(p.height_cm),
                    gender: p.gender,
                    activityLevel: p.activity_level,
                    dietGoal: p.diet_goal,
                    targetWeeklyChangeKg: toNum(p.target_weekly_change_kg),
                    goalWeightKg: toNum(p.goal_weight_kg),
                    goalBodyFatPct: toNum(p.goal_body_fat_pct),
                    goalTargetDate: toDate(p.goal_target_date),
                    waterGoalMl: p.water_goal_ml ?? 2500,
                    phone: p.phone,
                    birthdate: toDate(p.date_of_birth),
                },
            });
        }

        // ===================== HEALTH: body_metric =====================
        const bodyMetrics = await q<BodyMetricRow>(
            `SELECT metric_type, custom_name, value, unit, measured_at, notes, created_at, updated_at FROM body_metric`,
        );
        counts.BodyMetric = bodyMetrics.length;

        // ===================== HEALTH: vital_reading (+ fields) =====================
        const vitals = await q<VitalRow>(
            `SELECT id, vital_type, custom_name, value, value2, unit, measured_at, notes, created_at, updated_at FROM vital_reading`,
        );
        const vitalFields = await q<VitalFieldRow>(
            `SELECT id, vital_reading_id, label, unit, value, position FROM vital_reading_field`,
        );
        counts.VitalReading = vitals.length;
        counts.VitalReadingField = vitalFields.length;

        // ===================== HEALTH: nutrition =====================
        const nutritionDays = await q<NutritionDayRow>(
            `SELECT id, date, notes, created_at, updated_at FROM nutrition_day`,
        );
        const healthMeals = await q<HMealRow>(
            `SELECT id, nutrition_day_id, meal_type, name, meal_order, created_at, updated_at FROM meal`,
        );
        const foodEntries = await q<FoodEntryRow>(
            `SELECT id, meal_id, product_id, description, serving_size, calories, protein_g, carbs_g, fat_g,
                    fiber_g, sugar_g, sodium_mg, cholesterol_mg, saturated_fat_g, trans_fat_g, potassium_mg,
                    ai_analyzed, ai_raw_response, manually_adjusted FROM food_entry`,
        );
        const foodProducts = await q<FoodProductRow>(
            `SELECT id, barcode, brand, name, calories, protein_g, carbs_g, fat_g, serving_size_value, serving_size_unit FROM food_product`,
        );
        const nutritionGoals = await q<NutritionGoalRow>(
            `SELECT calories, protein_g, carbs_g, fat_g, fiber_g FROM nutrition_goal LIMIT 1`,
        );
        const waterLogs = await q<WaterLogRow>(
            `SELECT wil.amount_ml, nd.date FROM water_intake_log wil JOIN nutrition_day nd ON nd.id = wil.nutrition_day_id`,
        );
        counts.NutritionDay = nutritionDays.length;
        counts.Meal = healthMeals.length;
        counts.FoodEntry = foodEntries.length;
        counts.FoodProduct = foodProducts.length;

        // ===================== HEALTH: sleep (+ interruptions) =====================
        const sleeps = await q<SleepRow>(
            `SELECT id, date, bedtime, wake_time, total_minutes, sleep_quality, feel_rested, sleep_latency_min, notes, survey_responses, created_at, updated_at FROM sleep_entry`,
        );
        const interruptions = await q<InterruptionRow>(
            `SELECT id, sleep_entry_id, woke_at, fell_back_at, duration_min, reason FROM sleep_interruption`,
        );
        counts.SleepEntry = sleeps.length;
        counts.SleepInterruption = interruptions.length;

        // ===================== HEALTH: habits (+ logs, milestones) =====================
        const habits = await q<HabitRow>(
            `SELECT id, name, description, habit_type, frequency, target_count, target_days, days_of_week, color, icon,
                    active, category, cue, routine, reward, stack_after_habit_id, difficulty, priority, reminder_time,
                    created_at, updated_at FROM habit`,
        );
        const habitLogs = await q<HabitLogRow>(
            `SELECT id, habit_id, date, completed, notes, created_at FROM habit_log`,
        );
        const milestones = await q<MilestoneRow>(
            `SELECT id, habit_id, milestone_type, milestone_value, achieved_at FROM habit_milestone`,
        );
        counts.Habit = habits.length;
        counts.HabitLog = habitLogs.length;
        counts.HabitMilestone = milestones.length;

        // ===================== HEALTH: journal (+ realm ratings) =====================
        const journals = await q<JournalRow>(
            `SELECT id, date, reflection, gratitude, overall_rating, created_at, updated_at FROM journal_entry`,
        );
        const realmRatings = await q<RealmRow>(
            `SELECT id, journal_entry_id, realm, rating FROM realm_rating`,
        );
        counts.JournalEntry = journals.length;
        counts.RealmRating = realmRatings.length;

        // ===================== HEALTH: appointments -> CalendarEvent =====================
        const appointments = await q<AppointmentRow>(
            `SELECT id, title, doctor_name, office_name, specialty, location, appointment_date, appointment_time, duration_minutes, notes, status, created_at, updated_at FROM appointment`,
        );
        counts.CalendarEvent_appointments = appointments.length;

        // ===================== HEALTH: medical records (+ extracted items) =====================
        const medRecords = await q<MedRecordRow>(
            `SELECT id, name, provider_name, doctor_name, record_date, mime_type, file_size, notes, s3_key, created_at, updated_at FROM medical_record`,
        );
        // Resolved extracted items live under the active extraction run.
        const extractedItems = await q<ExtractedItemRow>(
            `SELECT mei.id, mre.medical_record_id, mei.kind, mei.raw_label, mei.canonical_type, mei.value, mei.unit
             FROM medical_extracted_item mei
             JOIN medical_record_extraction mre ON mre.id = mei.extraction_id`,
        ).catch(() => [] as ExtractedItemRow[]);
        counts.MedicalRecord = medRecords.length;
        counts.MedicalExtractedItem = extractedItems.length;

        // ===================== HEALTH: progress photos =====================
        const progressPhotos = await q<ProgressPhotoRow>(
            `SELECT id, s3_key, taken_at, weight_kg, notes, created_at FROM progress_photo`,
        );
        counts.ProgressPhoto = progressPhotos.length;

        // ===================== THERAPEUTICS =====================
        const medications = await q<TherapeuticRow>(
            `SELECT id, name, dosage_amount, dosage_unit, frequency, notes, active, created_at, updated_at FROM medication`,
        );
        const supplements = await q<TherapeuticRow>(
            `SELECT id, name, dosage_amount, dosage_unit, frequency, notes, active, created_at, updated_at FROM supplement`,
        );
        const healthPeptides = await q<HPeptideRow>(
            `SELECT id, name, total_amount_mg, bac_water_ml, concentration_mg_per_ml, notes, active FROM peptide`,
        );
        const therapeuticSchedules = await q<TherapScheduleRow>(
            `SELECT id, therapeutic_type, schedule_type, days_of_week, interval_days, time_of_day, dosage_override, dosage_unit, notes, active, start_date, end_date FROM therapeutic_schedule`,
        );
        const therapeuticLogs = await q<TherapLogRow>(
            `SELECT id, therapeutic_type, therapeutic_id, taken_at, dosage_amount, dosage_unit, notes, skipped FROM therapeutic_log`,
        );
        counts.Medication = medications.length;
        counts.Supplement = supplements.length;
        counts.TherapeuticSchedule = therapeuticSchedules.length + healthPeptides.length;
        counts.TherapeuticLog = therapeuticLogs.length;

        // ===================== SUBSTANCES =====================
        const substanceLogs = await q<SubstanceLogRow>(
            `SELECT id, substance_type, occurred_at, amount, notes FROM substance_log`,
        );
        const customSubs = await q<CustomSubRow>(
            `SELECT id, name FROM custom_substance_type`,
        );
        counts.SubstanceLog = substanceLogs.length;
        counts.CustomSubstanceType = customSubs.length;

        // ===================== SOCIAL =====================
        const contacts = await q<SContactRow>(
            `SELECT id, display_name, nickname, avatar_path, relationship_type, how_we_met, birthday, phone, email,
                    interests, notes, closeness_score, active, last_contact_at, pronouns, status, trust_score,
                    communication_frequency, energy_tags, inner_circle, stay_in_touch, stay_in_touch_days,
                    occupation, company_or_school, hometown, time_zone, preferred_contact_method, created_at, updated_at FROM social_contact`,
        );
        const cPhones = await q<CSubRow>(`SELECT id, contact_id, label, value FROM social_contact_phone`).catch(() => []);
        const cEmails = await q<CSubRow>(`SELECT id, contact_id, label, value FROM social_contact_email`).catch(() => []);
        const cAddresses = await q<CAddrRow>(`SELECT id, contact_id, label, line1, line2, city, state, postal_code, country FROM social_contact_address`).catch(() => []);
        const cHandles = await q<CHandleRow>(`SELECT id, contact_id, platform, handle FROM social_contact_handle`).catch(() => []);
        const cDates = await q<CDateRow>(`SELECT id, contact_id, kind, date FROM social_contact_date`).catch(() => []);
        const cNotes = await q<CNoteRow>(`SELECT id, contact_id, kind, body, created_at FROM social_contact_note`).catch(() => []);
        const cReminders = await q<CReminderRow>(`SELECT id, contact_id, kind, scheduled_for, completed_at FROM social_contact_reminder`).catch(() => []);
        const sInteractions = await q<SInteractionRow>(`SELECT id, contact_id, occurred_at, kind, summary FROM social_interaction`).catch(() => []);
        const commLogs = await q<CommLogRow>(`SELECT id, contact_id, kind, occurred_at, snippet, platform FROM communication_log`).catch(() => []);
        const sEvents = await q<SEventRow>(`SELECT id, title, starts_at, location, contact_ids, description, cover_image_s3_key, created_at, updated_at FROM social_event`).catch(() => []);
        const sMemories = await q<SMemoryRow>(`SELECT id, contact_ids, occurred_on, caption, body, photo_url FROM social_memory`).catch(() => []);
        const sGifts = await q<SGiftRow>(`SELECT id, contact_id, occasion, idea, status, gifted_on FROM social_gift`).catch(() => []);
        const sBatteries = await q<SBatteryRow>(`SELECT id, recorded_at, energy_after, energy_before, notes FROM social_battery`).catch(() => []);
        const sConflicts = await q<SConflictRow>(`SELECT id, contact_id, occurred_at, conflict_type, trigger_text, resolution_text FROM social_conflict`).catch(() => []);
        const sTags = await q<STagRow>(`SELECT id, name, color FROM social_tag`).catch(() => []);
        const tagLinks = await q<TagLinkRow>(`SELECT contact_id, tag_id FROM social_contact_tag_link`).catch(() => []);
        const sConnections = await q<SConnectionRow>(`SELECT id, a_id, b_id, kind, notes FROM social_connection`).catch(() => []);
        counts.SocialContact = contacts.length;
        counts.SocialEvent = sEvents.length;
        counts.SocialMemory = sMemories.length;
        counts.SocialTag = sTags.length;

        // ===================== CAREER =====================
        const careerSkills = await q<CSkillRow>(`SELECT id, name, category, proficiency, target_proficiency, practice_plan, verified_proof_url, hours_logged, created_at, updated_at FROM career_skill`).catch(() => []);
        const careerEvidence = await q<CEvidenceRow>(`SELECT id, skill_id, kind, note, recorded_on FROM career_skill_evidence`).catch(() => []);
        const careerCerts = await q<CCertRow>(`SELECT id, name, issuer, status, exam_date, completed_at, expires_at, created_at, updated_at FROM career_certification`).catch(() => []);
        const careerProjects = await q<CProjectRow>(`SELECT id, title, description, started_on, ended_on, tech_stack, outcomes, url, created_at, updated_at FROM career_project`).catch(() => []);
        const careerSalary = await q<CSalaryRow>(`SELECT id, employer, effective_on, base_salary_cents, bonus_cents, equity_cents, total_comp_cents, currency FROM career_salary_entry`).catch(() => []);
        const careerGoals = await q<CGoalRow>(`SELECT id, title, description, target_date, status, created_at, updated_at FROM career_goal`).catch(() => []);
        const careerWeekly = await q<CWeeklyRow>(`SELECT id, week_start, wins, blockers, lessons, summary, created_at, updated_at FROM career_weekly_review`).catch(() => []);
        const careerJournal = await q<CJournalRow>(`SELECT id, entry_date, body, created_at, updated_at FROM career_journal_entry`).catch(() => []);
        const careerMentors = await q<CMentorRow>(`SELECT id, name, relationship, topics, next_session_on, notes, created_at, updated_at FROM career_mentor`).catch(() => []);
        const careerReviews = await q<CReviewRow>(`SELECT id, review_date, reviewer, overall_rating, manager_feedback, created_at FROM career_review`).catch(() => []);
        const careerApps = await q<CAppRow>(`SELECT id, company, role, date_applied, status, salary_range, location, notes, created_at, updated_at FROM career_application`).catch(() => []);
        const careerInterviews = await q<CInterviewRow>(`SELECT id, application_id, stage, scheduled_at, interviewer, feedback FROM career_interview`).catch(() => []);
        counts.CareerSkill = careerSkills.length;
        counts.CareerCertification = careerCerts.length;
        counts.CareerProject = careerProjects.length;
        counts.CareerSalaryEntry = careerSalary.length;
        counts.CareerGoal = careerGoals.length;
        counts.CareerWeeklyReview = careerWeekly.length;
        counts.CareerJournalEntry = careerJournal.length;
        counts.CareerMentor = careerMentors.length;
        counts.CareerReview = careerReviews.length;
        counts.JobApplication_career = careerApps.length;

        // ===================== LEARNING =====================
        const courses = await q<LCourseRow>(`SELECT id, title, source, url, description, status, started_on, completed_on, created_at, updated_at FROM learning_course`).catch(() => []);
        const lessons = await q<LLessonRow>(`SELECT id, course_id, title, completed, position, created_at, updated_at FROM learning_lesson`).catch(() => []);
        const lGoals = await q<LGoalRow>(`SELECT id, title, description, target_date, status, created_at, updated_at FROM learning_goal`).catch(() => []);
        const lSkills = await q<LSkillRow>(`SELECT id, name, level, created_at, updated_at FROM learning_skill`).catch(() => []);
        const lResources = await q<LResourceRow>(`SELECT id, title, kind, url, created_at FROM learning_resource`).catch(() => []);
        const flashcards = await q<FlashcardRow>(`SELECT id, front, back, repetitions, last_reviewed_at, created_at, updated_at FROM learning_flashcard`).catch(() => []);
        const quizzes = await q<QuizRow>(`SELECT id, course_id, title, created_at FROM learning_quiz`).catch(() => []);
        const quizAttempts = await q<QuizAttemptRow>(`SELECT id, quiz_id, score, max_score, taken_at FROM learning_quiz_attempt`).catch(() => []);
        const lNotes = await q<LNoteRow>(`SELECT id, title, body, created_at, updated_at FROM learning_note`).catch(() => []);
        const lSessions = await q<LSessionRow>(`SELECT id, started_at, duration_minutes, notes FROM learning_session`).catch(() => []);
        const lPlans = await q<LPlanRow>(`SELECT id, scheduled_for, topic, completed, created_at FROM learning_plan_entry`).catch(() => []);
        const lAchievements = await q<LAchievementRow>(`SELECT id, kind, title, earned_at, created_at FROM learning_achievement`).catch(() => []);
        counts.LearningCourse = courses.length;
        counts.LearningLesson = lessons.length;
        counts.Flashcard = flashcards.length;
        counts.Quiz = quizzes.length;
        counts.QuizAttempt = quizAttempts.length;

        // ===================== FINANCIAL =====================
        const finAccounts = await q<FinAccountRow>(`SELECT id, name, institution, kind, currency, current_balance, last_balance_at, include_in_net_worth, archived, is_asset, notes, created_at, updated_at FROM financial_account`).catch(() => []);
        const finTxns = await q<FinTxnRow>(`SELECT id, account_id, occurred_on, direction, category, amount, currency, merchant, description, source, created_at, updated_at FROM financial_transaction`).catch(() => []);
        const finSubs = await q<FinSubRow>(`SELECT id, name, merchant, amount, currency, cadence, active, started_on, cancelled_on, next_charge_on, notes, created_at, updated_at FROM subscription`).catch(() => []);
        const debts = await q<DebtRow>(`SELECT id, name, kind, principal_original, principal_remaining, apr, minimum_payment, payoff_goal_date, strategy, created_at, updated_at FROM debt`).catch(() => []);
        const investments = await q<InvestmentRow>(`SELECT id, account_id, symbol, name, quantity, cost_basis, current_price, last_priced_at FROM investment_holding`).catch(() => []);
        const budgetMonths = await q<BudgetMonthRow>(`SELECT id, month FROM budget_month`).catch(() => []);
        const budgetCats = await q<BudgetCatRow>(`SELECT id, budget_month_id, category, cap_amount, kind FROM budget_category`).catch(() => []);
        const creditScores = await q<CreditScoreRow>(`SELECT id, recorded_on, score FROM credit_score_entry`).catch(() => []);
        const finGoals = await q<FinGoalRow>(`SELECT id, title, target_amount_cents, current_amount_cents, target_date FROM financial_goal`).catch(() => []);
        const finStatements = await q<FinStatementRow>(`SELECT id, account_id, period_start, period_end, closing_balance_cents, s3_key, original_filename, mime_type, file_size_bytes, status, created_at FROM financial_statement`).catch(() => []);
        const finDocs = await q<FinDocRow>(`SELECT id, kind, document_date, s3_key, mime_type, original_filename, notes FROM financial_document`).catch(() => []);
        const netWorthSnaps = await q<NetWorthRow>(`SELECT recorded_on, assets_cents, liabilities_cents, net_worth_cents, breakdown, created_at FROM net_worth_snapshot`).catch(() => []);
        counts.FinAccount = finAccounts.length;
        counts.FinTransaction = finTxns.length;
        counts.FinSubscription = finSubs.length;
        counts.Debt = debts.length;
        counts.BrokerageHolding = investments.length;
        counts.BudgetCategory = budgetCats.length;
        counts.CreditScoreEntry = creditScores.length;
        counts.FinancialGoal = finGoals.length;
        counts.FinStatement = finStatements.length;
        counts.NetWorthSnapshot = netWorthSnaps.length;

        // ===================== FOCUS / LIFE ENGINE =====================
        const focusSprints = await q<FocusRow>(`SELECT id, started_at, planned_focus_seconds, completed_at, status, note FROM focus_sprint`).catch(() => []);
        const weeklyPriorities = await q<WeeklyPriorityRow>(`SELECT id, week_start, title, position, completed, created_at, updated_at FROM weekly_priority`).catch(() => []);
        const rewardGoals = await q<RewardGoalRow>(`SELECT id, reward_text, status, created_at, updated_at FROM reward_goal`).catch(() => []);
        const lifeScores = await q<LifeScoreRow>(`SELECT recorded_on, health_score, social_score, financial_score, career_score, learning_score, life_score FROM life_score_snapshot`).catch(() => []);
        const lifeInsights = await q<InsightRow>(`SELECT id, kind, title, body, domain_tags, created_at FROM life_insight`).catch(() => []);
        const finInsights = await q<FinInsightRow>(`SELECT id, kind, title, body, created_at FROM financial_insight`).catch(() => []);
        const careerInsights = await q<FinInsightRow>(`SELECT id, kind, title, body, created_at FROM career_insight`).catch(() => []);
        const notifications = await q<NotificationRow>(`SELECT id, title, message, notification_type, read, link_url, scheduled_for, created_at FROM notification`).catch(() => []);
        counts.FocusSprint = focusSprints.length;
        counts.WeeklyPriority = weeklyPriorities.length;
        counts.RewardGoal = rewardGoals.length;
        counts.ScoreSnapshot = lifeScores.length * 6;
        counts.Insight = lifeInsights.length + finInsights.length + careerInsights.length;
        counts.Notification = notifications.length;

        if (args.dryRun) {
            printCounts("health DRY-RUN", counts);
            return;
        }

        // ====================================================================
        // WRITE PHASE
        // ====================================================================

        // ---- body_metric ----
        for (const m of bodyMetrics) {
            await prisma.bodyMetric.create({
                data: {
                    userId,
                    metricType: m.metric_type,
                    customName: m.custom_name,
                    value: toNum(m.value) ?? 0,
                    unit: m.unit,
                    measuredAt: toDate(m.measured_at) ?? new Date(),
                    notes: m.notes,
                    createdAt: toDate(m.created_at) ?? undefined,
                    updatedAt: toDate(m.updated_at) ?? undefined,
                },
            });
        }

        // ---- vital_reading (+ fields) ----
        const vitalMap = new IdMap("vital");
        for (const v of vitals) {
            const created = await prisma.vitalReading.create({
                data: {
                    userId,
                    vitalType: v.vital_type,
                    customName: v.custom_name,
                    value: toNum(v.value),
                    value2: toNum(v.value2),
                    unit: v.unit,
                    measuredAt: toDate(v.measured_at) ?? new Date(),
                    notes: v.notes,
                    createdAt: toDate(v.created_at) ?? undefined,
                    updatedAt: toDate(v.updated_at) ?? undefined,
                },
            });
            vitalMap.set(v.id, created.id);
        }
        for (const f of vitalFields) {
            const readingId = vitalMap.get(f.vital_reading_id);
            if (!readingId) continue;
            await prisma.vitalReadingField.create({
                data: { readingId, label: f.label, unit: f.unit, value: toNum(f.value) ?? 0, position: f.position ?? 0 },
            });
        }

        // ---- nutrition: product, day, meal, entry ----
        const productMap = new IdMap("foodProduct");
        for (const fp of foodProducts) {
            const created = await prisma.foodProduct.create({
                data: {
                    userId,
                    name: fp.name,
                    barcode: fp.barcode,
                    calories: toNum(fp.calories),
                    proteinG: toNum(fp.protein_g),
                    carbsG: toNum(fp.carbs_g),
                    fatG: toNum(fp.fat_g),
                    quantity: toNum(fp.serving_size_value),
                    unit: fp.serving_size_unit,
                },
            });
            productMap.set(fp.id, created.id);
        }
        const dayMap = new IdMap("nutritionDay");
        for (const d of nutritionDays) {
            const date = dateOnly(d.date);
            const created = await prisma.nutritionDay.upsert({
                where: { userId_date: { userId, date } },
                update: { notes: d.notes ?? undefined },
                create: { userId, date, notes: d.notes, createdAt: toDate(d.created_at) ?? undefined, updatedAt: toDate(d.updated_at) ?? undefined },
            });
            dayMap.set(d.id, created.id);
        }
        const hMealMap = new IdMap("healthMeal");
        for (const m of healthMeals) {
            const dayId = dayMap.get(m.nutrition_day_id);
            if (!dayId) continue;
            const created = await prisma.meal.create({
                data: {
                    dayId,
                    mealType: mapMealType(m.meal_type),
                    name: m.name,
                    order: m.meal_order ?? 0,
                    createdAt: toDate(m.created_at) ?? undefined,
                    updatedAt: toDate(m.updated_at) ?? undefined,
                },
            });
            hMealMap.set(m.id, created.id);
        }
        for (const f of foodEntries) {
            const mealId = hMealMap.get(f.meal_id);
            if (!mealId) continue;
            await prisma.foodEntry.create({
                data: {
                    mealId,
                    productId: productMap.get(f.product_id) ?? null,
                    description: f.description,
                    servingSize: f.serving_size,
                    calories: toNum(f.calories),
                    proteinG: toNum(f.protein_g),
                    carbsG: toNum(f.carbs_g),
                    fatG: toNum(f.fat_g),
                    fiberG: toNum(f.fiber_g),
                    sugarG: toNum(f.sugar_g),
                    sodiumMg: toNum(f.sodium_mg),
                    cholesterolMg: toNum(f.cholesterol_mg),
                    saturatedFatG: toNum(f.saturated_fat_g),
                    transFatG: toNum(f.trans_fat_g),
                    potassiumMg: toNum(f.potassium_mg),
                    aiAnalyzed: f.ai_analyzed ?? false,
                    aiRawResponse: (asJson(f.ai_raw_response) as Prisma.InputJsonValue) ?? Prisma.JsonNull,
                    manuallyAdjusted: f.manually_adjusted ?? false,
                },
            });
        }
        if (nutritionGoals.length) {
            const g = nutritionGoals[0];
            await prisma.nutritionGoal.upsert({
                where: { userId },
                update: {},
                create: {
                    userId,
                    calories: toNum(g.calories),
                    proteinG: toNum(g.protein_g),
                    carbsG: toNum(g.carbs_g),
                    fatG: toNum(g.fat_g),
                    fiberG: toNum(g.fiber_g),
                },
            });
        }
        // WaterLog from water_intake_log (sum per date), upsert.
        const waterByDate = new Map<string, number>();
        for (const w of waterLogs) {
            const key = isoDate(toDate(w.date) ?? new Date());
            waterByDate.set(key, (waterByDate.get(key) ?? 0) + (w.amount_ml ?? 0));
        }
        for (const [key, amount] of waterByDate) {
            const date = new Date(`${key}T00:00:00.000Z`);
            await prisma.waterLog.upsert({
                where: { userId_date: { userId, date } },
                update: { amountMl: { increment: amount } },
                create: { userId, date, amountMl: amount },
            });
        }

        // ---- sleep (+ interruptions) upsert-merge by date (prefer non-null) ----
        const sleepMap = new IdMap("sleep");
        for (const s of sleeps) {
            const date = dateOnly(s.date);
            const created = await prisma.sleepEntry.upsert({
                where: { userId_date: { userId, date } },
                update: {
                    bedtime: toDate(s.bedtime) ?? undefined,
                    wakeTime: toDate(s.wake_time) ?? undefined,
                    totalMinutes: s.total_minutes ?? undefined,
                    sleepQuality: s.sleep_quality ?? undefined,
                    feelRested: s.feel_rested ?? undefined,
                    sleepLatencyMin: s.sleep_latency_min ?? undefined,
                    notes: s.notes ?? undefined,
                    surveyResponses: (asJson(s.survey_responses) as Prisma.InputJsonValue) ?? undefined,
                },
                create: {
                    userId,
                    date,
                    bedtime: toDate(s.bedtime),
                    wakeTime: toDate(s.wake_time),
                    totalMinutes: s.total_minutes,
                    sleepQuality: s.sleep_quality,
                    feelRested: s.feel_rested,
                    sleepLatencyMin: s.sleep_latency_min,
                    notes: s.notes,
                    surveyResponses: (asJson(s.survey_responses) as Prisma.InputJsonValue) ?? Prisma.JsonNull,
                    createdAt: toDate(s.created_at) ?? undefined,
                    updatedAt: toDate(s.updated_at) ?? undefined,
                },
            });
            sleepMap.set(s.id, created.id);
        }
        for (const i of interruptions) {
            const entryId = sleepMap.get(i.sleep_entry_id);
            if (!entryId) continue;
            const dur = i.duration_min ?? minutesBetween(i.woke_at, i.fell_back_at);
            await prisma.sleepInterruption.create({
                data: { entryId, time: toDate(i.woke_at), durationMinutes: dur, reason: i.reason },
            });
        }

        // ---- habits (+ logs, milestones), stack second pass ----
        const habitMap = new IdMap("habit");
        for (const h of habits) {
            const created = await prisma.habit.create({
                data: {
                    userId,
                    name: h.name,
                    description: h.description,
                    habitType: h.habit_type,
                    frequency: h.frequency,
                    targetCount: h.target_count,
                    targetDays: h.target_days,
                    daysOfWeek: numArrToStr(h.days_of_week),
                    color: h.color,
                    icon: h.icon,
                    active: h.active ?? true,
                    category: h.category,
                    cue: h.cue,
                    routine: h.routine,
                    reward: h.reward,
                    difficulty: h.difficulty,
                    priority: h.priority != null ? String(h.priority) : null,
                    reminderTime: h.reminder_time != null ? String(h.reminder_time) : null,
                    createdAt: toDate(h.created_at) ?? undefined,
                    updatedAt: toDate(h.updated_at) ?? undefined,
                },
            });
            habitMap.set(h.id, created.id);
        }
        for (const h of habits) {
            if (!h.stack_after_habit_id) continue;
            const childId = habitMap.get(h.id);
            const parentId = habitMap.get(h.stack_after_habit_id);
            if (!childId || !parentId || childId === parentId) continue;
            await prisma.habit.update({ where: { id: childId }, data: { stackAfterHabitId: parentId } }).catch(() => undefined);
        }
        for (const l of habitLogs) {
            const habitId = habitMap.get(l.habit_id);
            if (!habitId) continue;
            await prisma.habitLog.create({
                data: { habitId, logDate: dateOnly(l.date), count: l.completed ? 1 : 0, notes: l.notes, createdAt: toDate(l.created_at) ?? undefined },
            });
        }
        for (const m of milestones) {
            const habitId = habitMap.get(m.habit_id);
            if (!habitId) continue;
            await prisma.habitMilestone.create({
                data: { habitId, milestoneDate: dateOnly(m.achieved_at), description: `${m.milestone_type}: ${m.milestone_value}` },
            });
        }

        // ---- journal (+ realm ratings) ----
        // JournalEntry has no compound unique on (userId,date) in the target, so
        // we plain-create one row per source entry.
        const journalMap = new IdMap("journal");
        for (const j of journals) {
            const date = dateOnly(j.date);
            const created = await prisma.journalEntry.create({
                data: {
                    userId,
                    date,
                    reflection: j.reflection,
                    gratitude: j.gratitude,
                    overallRating: j.overall_rating,
                    createdAt: toDate(j.created_at) ?? undefined,
                    updatedAt: toDate(j.updated_at) ?? undefined,
                },
            });
            journalMap.set(j.id, created.id);
        }
        for (const r of realmRatings) {
            const entryId = journalMap.get(r.journal_entry_id);
            if (!entryId) continue;
            await prisma.realmRating.create({ data: { entryId, realm: r.realm, rating: r.rating } });
        }

        // ---- appointments -> CalendarEvent (kind APPOINTMENT) ----
        for (const a of appointments) {
            const startsAt = combineDateTime(a.appointment_date, a.appointment_time);
            const endsAt = a.duration_minutes ? new Date(startsAt.getTime() + a.duration_minutes * 60000) : null;
            await prisma.calendarEvent.create({
                data: {
                    userId,
                    kind: "APPOINTMENT",
                    title: a.title,
                    description: [a.doctor_name, a.office_name, a.specialty].filter(Boolean).join(" · ") || null,
                    location: a.location,
                    startsAt,
                    endsAt,
                    visitNotes: a.notes,
                    createdAt: toDate(a.created_at) ?? undefined,
                    updatedAt: toDate(a.updated_at) ?? undefined,
                },
            });
        }

        // ---- medical records (+ extracted items), s3 copy module "health" ----
        const medRecMap = new IdMap("medicalRecord");
        for (const mr of medRecords) {
            const fileKey = await copyObject(s3, mr.s3_key, userId, "health", { originalName: mr.name });
            const created = await prisma.medicalRecord.create({
                data: {
                    userId,
                    name: mr.name,
                    providerName: mr.provider_name,
                    doctorName: mr.doctor_name,
                    recordDate: toDate(mr.record_date),
                    fileKey,
                    mimeType: mr.mime_type,
                    fileSize: mr.file_size != null ? Number(mr.file_size) : null,
                    notes: mr.notes,
                    createdAt: toDate(mr.created_at) ?? undefined,
                    updatedAt: toDate(mr.updated_at) ?? undefined,
                },
            });
            medRecMap.set(mr.id, created.id);
        }
        for (const it of extractedItems) {
            const recordId = medRecMap.get(it.medical_record_id);
            if (!recordId) continue;
            await prisma.medicalExtractedItem.create({
                data: {
                    recordId,
                    itemType: it.canonical_type ?? it.kind,
                    label: it.raw_label,
                    value: it.value != null ? String(toNum(it.value)) : null,
                    unit: it.unit,
                },
            });
        }

        // ---- progress photos, s3 copy module "health" ----
        for (const p of progressPhotos) {
            const originalKey = await copyObject(s3, p.s3_key, userId, "health");
            if (!originalKey) continue;
            await prisma.progressPhoto.create({
                data: {
                    userId,
                    originalKey,
                    takenAt: toDate(p.taken_at) ?? new Date(),
                    weightKg: toNum(p.weight_kg),
                    notes: p.notes,
                    createdAt: toDate(p.created_at) ?? undefined,
                },
            });
        }

        // ---- therapeutics: Medication / Supplement / (health peptide -> schedule) ----
        for (const m of medications) {
            await prisma.medication.create({
                data: {
                    userId, name: m.name, dosageAmount: toNum(m.dosage_amount), dosageUnit: m.dosage_unit,
                    frequency: m.frequency, notes: m.notes, active: m.active ?? true,
                    createdAt: toDate(m.created_at) ?? undefined, updatedAt: toDate(m.updated_at) ?? undefined,
                },
            });
        }
        for (const s of supplements) {
            await prisma.supplement.create({
                data: {
                    userId, name: s.name, dosageAmount: toNum(s.dosage_amount), dosageUnit: s.dosage_unit,
                    frequency: s.frequency, notes: s.notes, active: s.active ?? true,
                    createdAt: toDate(s.created_at) ?? undefined, updatedAt: toDate(s.updated_at) ?? undefined,
                },
            });
        }
        // Health "peptide" rows -> TherapeuticSchedule kind PEPTIDE (avoid colliding
        // with peptide_tracker's richer Peptide model — these are simple reconstitution
        // records, not cycle plans).
        for (const p of healthPeptides) {
            await prisma.therapeuticSchedule.create({
                data: {
                    userId,
                    kind: "PEPTIDE",
                    name: p.name,
                    dosage: p.concentration_mg_per_ml != null ? `${toNum(p.concentration_mg_per_ml)} mg/ml` : (p.total_amount_mg != null ? `${toNum(p.total_amount_mg)} mg` : null),
                    notes: p.notes,
                    pattern: "DAILY",
                    archived: !(p.active ?? true),
                },
            });
        }
        // therapeutic_schedule -> TherapeuticSchedule
        for (const t of therapeuticSchedules) {
            await prisma.therapeuticSchedule.create({
                data: {
                    userId,
                    kind: mapTherapKind(t.therapeutic_type),
                    name: `${t.therapeutic_type} schedule`,
                    dosage: t.dosage_override != null ? `${toNum(t.dosage_override)} ${t.dosage_unit ?? ""}`.trim() : null,
                    notes: t.notes,
                    startDate: dateOnlyOrNull(t.start_date),
                    endDate: dateOnlyOrNull(t.end_date),
                    pattern: mapSchedulePattern(t.schedule_type),
                    everyN: t.interval_days,
                    daysOfWeek: dowIntToStr(t.days_of_week),
                    timesOfDay: t.time_of_day != null ? [String(t.time_of_day).slice(0, 5)] : [],
                    archived: !(t.active ?? true),
                },
            });
        }
        for (const l of therapeuticLogs) {
            await prisma.therapeuticLog.create({
                data: {
                    userId,
                    therapeuticKind: mapTherapKind(l.therapeutic_type),
                    name: l.therapeutic_type,
                    doseAmount: toNum(l.dosage_amount),
                    doseUnit: l.dosage_unit,
                    loggedAt: toDate(l.taken_at) ?? new Date(),
                    notes: l.skipped ? `[SKIPPED] ${l.notes ?? ""}`.trim() : l.notes,
                },
            });
        }

        // ---- substances ----
        for (const s of substanceLogs) {
            await prisma.substanceLog.create({
                data: {
                    userId, substanceType: s.substance_type, unit: null, amount: parseAmount(s.amount),
                    loggedAt: toDate(s.occurred_at) ?? new Date(), notes: s.notes ?? combineAmountNote(s.amount),
                },
            });
        }
        for (const c of customSubs) {
            await prisma.customSubstanceType.create({ data: { userId, name: c.name } });
        }

        // ---- SOCIAL ----
        const contactMap = new IdMap("contact");
        const tagMap = new IdMap("socialTag");
        for (const t of sTags) {
            const created = await prisma.socialTag.upsert({
                where: { userId_name: { userId, name: t.name } },
                update: {},
                create: { userId, name: t.name, color: t.color },
            });
            tagMap.set(t.id, created.id);
        }
        for (const c of contacts) {
            const avatarKey = await copyObject(s3, c.avatar_path, userId, "social", { originalName: c.display_name });
            const created = await prisma.socialContact.create({
                data: {
                    userId,
                    displayName: c.display_name,
                    nickname: c.nickname,
                    avatarKey,
                    relationshipType: c.relationship_type,
                    howWeMet: c.how_we_met,
                    birthday: toDate(c.birthday),
                    occupation: c.occupation,
                    companyOrSchool: c.company_or_school,
                    hometown: c.hometown,
                    timezone: c.time_zone,
                    pronouns: c.pronouns,
                    status: c.status,
                    interests: c.interests,
                    notes: c.notes,
                    closenessScore: c.closeness_score,
                    trustScore: c.trust_score,
                    communicationFrequency: c.communication_frequency,
                    energyTags: asStringArray(c.energy_tags),
                    innerCircle: c.inner_circle ?? false,
                    stayInTouch: c.stay_in_touch ?? false,
                    stayInTouchDays: c.stay_in_touch_days,
                    preferredContactMethod: c.preferred_contact_method,
                    lastContactAt: toDate(c.last_contact_at),
                    active: c.active ?? true,
                    createdAt: toDate(c.created_at) ?? undefined,
                    updatedAt: toDate(c.updated_at) ?? undefined,
                },
            });
            contactMap.set(c.id, created.id);
            if (c.email) await prisma.contactEmail.create({ data: { contactId: created.id, email: c.email, label: "Other", isPrimary: true } });
            if (c.phone) await prisma.contactPhone.create({ data: { contactId: created.id, phone: c.phone, label: "Mobile", isPrimary: true } });
        }
        for (const e of cEmails as CSubRow[]) {
            const contactId = contactMap.get(e.contact_id);
            if (!contactId || !e.value) continue;
            await prisma.contactEmail.create({ data: { contactId, email: e.value, label: e.label ?? "Other" } }).catch(() => undefined);
        }
        for (const p of cPhones as CSubRow[]) {
            const contactId = contactMap.get(p.contact_id);
            if (!contactId || !p.value) continue;
            await prisma.contactPhone.create({ data: { contactId, phone: p.value, label: p.label ?? "Mobile" } }).catch(() => undefined);
        }
        for (const a of cAddresses as CAddrRow[]) {
            const contactId = contactMap.get(a.contact_id);
            if (!contactId) continue;
            await prisma.contactAddress.create({
                data: { contactId, addressType: a.label, addressLine1: a.line1, addressLine2: a.line2, city: a.city, state: a.state, postalCode: a.postal_code, country: a.country },
            });
        }
        for (const h of cHandles as CHandleRow[]) {
            const contactId = contactMap.get(h.contact_id);
            if (!contactId) continue;
            await prisma.contactHandle.create({ data: { contactId, platform: h.platform, handle: h.handle } });
        }
        for (const d of cDates as CDateRow[]) {
            const contactId = contactMap.get(d.contact_id);
            if (!contactId) continue;
            await prisma.contactDate.create({ data: { contactId, dateType: d.kind, dateValue: dateOnly(d.date) } });
        }
        for (const n of cNotes as CNoteRow[]) {
            const contactId = contactMap.get(n.contact_id);
            if (!contactId) continue;
            await prisma.contactNote.create({ data: { contactId, noteType: n.kind, noteText: n.body, createdAt: toDate(n.created_at) ?? undefined } });
        }
        for (const r of cReminders as CReminderRow[]) {
            const contactId = contactMap.get(r.contact_id);
            if (!contactId) continue;
            await prisma.contactReminder.create({ data: { contactId, reminderType: r.kind, scheduledFor: toDate(r.scheduled_for) ?? new Date(), completed: r.completed_at != null } });
        }
        for (const it of sInteractions as SInteractionRow[]) {
            const contactId = contactMap.get(it.contact_id);
            if (!contactId) continue;
            await prisma.socialInteraction.create({ data: { contactId, interactionType: it.kind, date: toDate(it.occurred_at) ?? new Date(), notes: it.summary } });
        }
        for (const cl of commLogs as CommLogRow[]) {
            const contactId = contactMap.get(cl.contact_id);
            if (!contactId) continue;
            await prisma.communicationLog.create({ data: { contactId, channel: cl.platform ?? cl.kind, date: toDate(cl.occurred_at) ?? new Date(), notes: cl.snippet } });
        }
        for (const ev of sEvents as SEventRow[]) {
            const coverImageKey = await copyObject(s3, ev.cover_image_s3_key, userId, "social", { originalName: ev.title });
            await prisma.socialEvent.create({
                data: {
                    userId, name: ev.title, eventDate: toDate(ev.starts_at), location: ev.location, notes: ev.description,
                    attendees: (asJson(ev.contact_ids) as Prisma.InputJsonValue) ?? Prisma.JsonNull, coverImageKey,
                    createdAt: toDate(ev.created_at) ?? undefined, updatedAt: toDate(ev.updated_at) ?? undefined,
                },
            });
        }
        for (const mem of sMemories as SMemoryRow[]) {
            // first associated contact, if any
            const ids = asStringArray(mem.contact_ids);
            const contactId = ids.length ? contactMap.get(ids[0]) : undefined;
            if (!contactId) continue;
            const mediaKey = await copyObject(s3, mem.photo_url, userId, "social");
            await prisma.socialMemory.create({
                data: { contactId, description: mem.body ?? mem.caption ?? "Memory", memoryDate: toDate(mem.occurred_on), mediaKeys: mediaKey ? [mediaKey] : [] },
            });
        }
        for (const g of sGifts as SGiftRow[]) {
            const contactId = contactMap.get(g.contact_id);
            if (!contactId) continue;
            await prisma.socialGift.create({ data: { contactId, giftDescription: g.idea, occasion: g.occasion, givenDate: toDate(g.gifted_on), direction: "given" } });
        }
        for (const b of sBatteries as SBatteryRow[]) {
            const date = dateOnly(b.recorded_at);
            await prisma.socialBattery.upsert({
                where: { userId_date: { userId, date } },
                update: { energyLevel: b.energy_after ?? b.energy_before ?? 0 },
                create: { userId, date, energyLevel: b.energy_after ?? b.energy_before ?? 0, notes: b.notes },
            });
        }
        for (const cf of sConflicts as SConflictRow[]) {
            const contactId = contactMap.get(cf.contact_id);
            if (!contactId) continue;
            await prisma.socialConflict.create({ data: { contactId, date: toDate(cf.occurred_at), description: cf.trigger_text ?? cf.conflict_type ?? "Conflict", resolution: cf.resolution_text } });
        }
        for (const link of tagLinks as TagLinkRow[]) {
            const contactId = contactMap.get(link.contact_id);
            const tagId = tagMap.get(link.tag_id);
            if (!contactId || !tagId) continue;
            await prisma.socialContact.update({ where: { id: contactId }, data: { tags: { connect: { id: tagId } } } }).catch(() => undefined);
        }
        for (const c of sConnections as SConnectionRow[]) {
            const a = contactMap.get(c.a_id);
            const b = contactMap.get(c.b_id);
            if (!a || !b) continue;
            await prisma.socialConnection.create({ data: { contact1Id: a, contact2Id: b, relationshipType: c.kind, notes: c.notes } });
        }

        // ---- CAREER ----
        const careerSkillMap = new IdMap("careerSkill");
        for (const sk of careerSkills as CSkillRow[]) {
            const created = await prisma.careerSkill.create({
                data: {
                    userId, name: sk.name, category: sk.category, proficiency: sk.proficiency, targetProficiency: sk.target_proficiency,
                    practicePlan: sk.practice_plan, proofUrl: sk.verified_proof_url, hoursLogged: toNum(sk.hours_logged) ?? 0,
                    createdAt: toDate(sk.created_at) ?? undefined, updatedAt: toDate(sk.updated_at) ?? undefined,
                },
            });
            careerSkillMap.set(sk.id, created.id);
        }
        for (const ev of careerEvidence as CEvidenceRow[]) {
            const skillId = careerSkillMap.get(ev.skill_id);
            if (!skillId) continue;
            await prisma.careerSkillEvidence.create({ data: { skillId, evidenceType: ev.kind, description: ev.note, createdAt: toDate(ev.recorded_on) ?? undefined } });
        }
        for (const c of careerCerts as CCertRow[]) {
            await prisma.careerCertification.create({
                data: { userId, name: c.name, issuer: c.issuer, status: c.status, examDate: toDate(c.exam_date), completedAt: toDate(c.completed_at), expiresAt: toDate(c.expires_at), createdAt: toDate(c.created_at) ?? undefined, updatedAt: toDate(c.updated_at) ?? undefined },
            });
        }
        for (const p of careerProjects as CProjectRow[]) {
            await prisma.careerProject.create({
                data: { userId, name: p.title, description: p.description, technologies: asStringArray(p.tech_stack), startedOn: toDate(p.started_on), completedOn: toDate(p.ended_on), impactDescription: p.outcomes, url: p.url, createdAt: toDate(p.created_at) ?? undefined, updatedAt: toDate(p.updated_at) ?? undefined },
            });
        }
        for (const sal of careerSalary as CSalaryRow[]) {
            const base = bigCentsToDollars(sal.base_salary_cents);
            const bonus = bigCentsToDollars(sal.bonus_cents);
            const equity = bigCentsToDollars(sal.equity_cents);
            const total = sal.total_comp_cents != null ? bigCentsToDollars(sal.total_comp_cents) : base + bonus + equity;
            await prisma.careerSalaryEntry.create({
                // *_cents (BigInt) -> Decimal dollars (/100).
                data: { userId, date: toDate(sal.effective_on) ?? new Date(), company: sal.employer, baseSalary: dec(base), bonus: dec(bonus), equity: dec(equity), totalComp: dec(total), currency: sal.currency ?? "USD" },
            });
        }
        for (const g of careerGoals as CGoalRow[]) {
            await prisma.careerGoal.create({ data: { userId, title: g.title, description: g.description, targetDate: toDate(g.target_date), status: g.status, createdAt: toDate(g.created_at) ?? undefined, updatedAt: toDate(g.updated_at) ?? undefined } });
        }
        for (const w of careerWeekly as CWeeklyRow[]) {
            await prisma.careerWeeklyReview.create({
                data: { userId, weekOf: dateOnly(w.week_start), wins: jsonToText(w.wins), challenges: jsonToText(w.blockers), learning: jsonToText(w.lessons), createdAt: toDate(w.created_at) ?? undefined, updatedAt: toDate(w.updated_at) ?? undefined },
            });
        }
        for (const j of careerJournal as CJournalRow[]) {
            await prisma.careerJournalEntry.create({ data: { userId, date: dateOnly(j.entry_date), entry: j.body ?? "", createdAt: toDate(j.created_at) ?? undefined, updatedAt: toDate(j.updated_at) ?? undefined } });
        }
        for (const m of careerMentors as CMentorRow[]) {
            await prisma.careerMentor.create({ data: { userId, name: m.name, expertise: jsonToText(m.topics), contactInfo: m.relationship, lastMeetingDate: toDate(m.next_session_on), createdAt: toDate(m.created_at) ?? undefined, updatedAt: toDate(m.updated_at) ?? undefined } });
        }
        for (const r of careerReviews as CReviewRow[]) {
            await prisma.careerReview.create({ data: { userId, reviewDate: toDate(r.review_date) ?? new Date(), reviewerName: r.reviewer, rating: parseRating(r.overall_rating), feedback: r.manager_feedback, createdAt: toDate(r.created_at) ?? undefined } });
        }
        // career applications -> JobApplication (find/create Company by name).
        const companyByName = new Map<string, string>();
        async function ensureCompany(name: string): Promise<string> {
            const key = name.toLowerCase();
            let id = companyByName.get(key);
            if (id) return id;
            const existing = await prisma.company.findFirst({ where: { userId, name } });
            if (existing) { companyByName.set(key, existing.id); return existing.id; }
            const created = await prisma.company.create({ data: { userId, name } });
            companyByName.set(key, created.id);
            return created.id;
        }
        const careerAppMap = new IdMap("careerApp");
        for (const a of careerApps as CAppRow[]) {
            const companyId = await ensureCompany(a.company || "Unknown");
            const created = await prisma.jobApplication.create({
                data: {
                    userId, companyId, role: a.role, status: mapCareerStatus(a.status), dateApplied: toDate(a.date_applied),
                    location: a.location, notesMarkdown: a.notes, createdAt: toDate(a.created_at) ?? undefined, updatedAt: toDate(a.updated_at) ?? undefined,
                },
            });
            careerAppMap.set(a.id, created.id);
        }
        for (const iv of careerInterviews as CInterviewRow[]) {
            const applicationId = careerAppMap.get(iv.application_id);
            if (!applicationId) continue;
            await prisma.jobMeeting.create({
                data: { applicationId, type: "Interview", dateTime: toDate(iv.scheduled_at), notesMarkdown: [iv.stage, iv.interviewer, iv.feedback].filter(Boolean).join("\n") || null },
            });
        }

        // ---- LEARNING ----
        const courseMap = new IdMap("course");
        for (const c of courses as LCourseRow[]) {
            const created = await prisma.learningCourse.create({
                data: { userId, title: c.title, source: c.source, url: c.url, description: c.description, status: c.status, startedOn: toDate(c.started_on), completedOn: toDate(c.completed_on), createdAt: toDate(c.created_at) ?? undefined, updatedAt: toDate(c.updated_at) ?? undefined },
            });
            courseMap.set(c.id, created.id);
        }
        for (const l of lessons as LLessonRow[]) {
            const courseId = courseMap.get(l.course_id);
            if (!courseId) continue;
            await prisma.learningLesson.create({ data: { courseId, title: l.title, completed: l.completed ?? false, order: l.position ?? 0, createdAt: toDate(l.created_at) ?? undefined, updatedAt: toDate(l.updated_at) ?? undefined } });
        }
        for (const g of lGoals as LGoalRow[]) {
            await prisma.learningGoal.create({ data: { userId, description: g.title + (g.description ? ` — ${g.description}` : ""), targetDate: toDate(g.target_date), completed: (g.status ?? "").toUpperCase() === "COMPLETED", createdAt: toDate(g.created_at) ?? undefined, updatedAt: toDate(g.updated_at) ?? undefined } });
        }
        for (const s of lSkills as LSkillRow[]) {
            await prisma.learningSkill.create({ data: { userId, name: s.name, proficiency: s.level, createdAt: toDate(s.created_at) ?? undefined, updatedAt: toDate(s.updated_at) ?? undefined } });
        }
        for (const r of lResources as LResourceRow[]) {
            await prisma.learningResource.create({ data: { userId, title: r.title, resourceType: r.kind, url: r.url, createdAt: toDate(r.created_at) ?? undefined } });
        }
        for (const f of flashcards as FlashcardRow[]) {
            await prisma.flashcard.create({ data: { userId, front: f.front, back: f.back, reviewCount: f.repetitions ?? 0, lastReviewedAt: toDate(f.last_reviewed_at), createdAt: toDate(f.created_at) ?? undefined, updatedAt: toDate(f.updated_at) ?? undefined } });
        }
        const quizMap = new IdMap("quiz");
        for (const qz of quizzes as QuizRow[]) {
            const created = await prisma.quiz.create({ data: { userId, courseId: courseMap.get(qz.course_id) ?? null, title: qz.title, createdAt: toDate(qz.created_at) ?? undefined } });
            quizMap.set(qz.id, created.id);
        }
        for (const at of quizAttempts as QuizAttemptRow[]) {
            const quizId = quizMap.get(at.quiz_id);
            if (!quizId) continue;
            const max = toNum(at.max_score);
            const score = toNum(at.score);
            await prisma.quizAttempt.create({ data: { quizId, score: score != null && max ? (score / max) * 100 : score, createdAt: toDate(at.taken_at) ?? undefined } });
        }
        for (const n of lNotes as LNoteRow[]) {
            await prisma.learningNote.create({ data: { userId, title: n.title ?? "Note", content: n.body, createdAt: toDate(n.created_at) ?? undefined, updatedAt: toDate(n.updated_at) ?? undefined } });
        }
        for (const s of lSessions as LSessionRow[]) {
            await prisma.learningSession.create({ data: { userId, sessionDate: dateOnly(s.started_at), durationMinutes: s.duration_minutes, notes: s.notes } });
        }
        for (const p of lPlans as LPlanRow[]) {
            await prisma.learningPlanEntry.create({ data: { userId, title: p.topic ?? "Study", scheduledFor: toDate(p.scheduled_for), completed: p.completed ?? false, createdAt: toDate(p.created_at) ?? undefined } });
        }
        for (const a of lAchievements as LAchievementRow[]) {
            await prisma.learningAchievement.create({ data: { userId, achievementType: a.kind, title: a.title, earnedOn: dateOnly(a.earned_at), createdAt: toDate(a.created_at) ?? undefined } });
        }

        // ---- FINANCIAL ----
        const finAccMap = new IdMap("finAccount");
        for (const a of finAccounts as FinAccountRow[]) {
            const created = await prisma.finAccount.create({
                data: {
                    userId, kind: mapFinKind(a.kind), institution: a.institution, nickname: a.name, currency: a.currency ?? "USD",
                    // current_balance is NUMERIC dollars already (NO cents).
                    currentBalance: dec(toNum(a.current_balance) ?? 0), lastBalanceAt: toDate(a.last_balance_at),
                    includeInNetWorth: a.include_in_net_worth ?? true, isAsset: a.is_asset ?? true, notes: a.notes, archived: a.archived ?? false,
                    createdAt: toDate(a.created_at) ?? undefined, updatedAt: toDate(a.updated_at) ?? undefined,
                },
            });
            finAccMap.set(a.id, created.id);
        }
        const finSubMap = new IdMap("finSub");
        for (const s of finSubs as FinSubRow[]) {
            const created = await prisma.finSubscription.create({
                data: {
                    userId, name: s.name, merchant: s.merchant ?? s.name, cadence: mapCadence(s.cadence),
                    // subscription.amount is NUMERIC dollars already (NO cents).
                    amount: dec(toNum(s.amount) ?? 0), currency: s.currency ?? "USD", status: (s.active ?? true) ? "ACTIVE" : "CANCELLED",
                    startedOn: toDate(s.started_on), cancelledOn: toDate(s.cancelled_on), nextChargeOn: toDate(s.next_charge_on), notes: s.notes,
                    createdAt: toDate(s.created_at) ?? undefined, updatedAt: toDate(s.updated_at) ?? undefined,
                },
            });
            finSubMap.set(s.id, created.id);
        }
        // BudgetCategory: source caps live on budget_category(cap_amount, NUMERIC).
        for (const b of budgetCats as BudgetCatRow[]) {
            await prisma.budgetCategory.upsert({
                where: { userId_name: { userId, name: b.category } },
                update: {},
                // cap_amount is NUMERIC dollars already (monthly cap).
                create: { userId, name: b.category, monthlyBudget: dec(toNum(b.cap_amount) ?? 0) },
            });
        }
        for (const t of finTxns as FinTxnRow[]) {
            // amount NUMERIC dollars; direction OUT -> negative (outflow).
            const raw = toNum(t.amount) ?? 0;
            const signed = (t.direction ?? "").toUpperCase() === "OUT" || (t.direction ?? "").toUpperCase() === "DEBIT" ? -Math.abs(raw) : Math.abs(raw);
            await prisma.finTransaction.create({
                data: {
                    userId, finAccountId: finAccMap.get(t.account_id) ?? null, date: dateOnly(t.occurred_on), amount: dec(signed),
                    currency: t.currency ?? "USD", merchant: t.merchant, rawDescription: t.description, source: mapFinTxSource(t.source), notes: null,
                    createdAt: toDate(t.created_at) ?? undefined, updatedAt: toDate(t.updated_at) ?? undefined,
                },
            });
        }
        for (const d of debts as DebtRow[]) {
            await prisma.debt.create({
                data: {
                    userId, name: d.name, kind: d.kind, principalOriginal: d.principal_original != null ? dec(toNum(d.principal_original)!) : null,
                    principalRemaining: d.principal_remaining != null ? dec(toNum(d.principal_remaining)!) : null,
                    apr: d.apr != null ? dec(toNum(d.apr)!) : null, minimumPayment: d.minimum_payment != null ? dec(toNum(d.minimum_payment)!) : null,
                    payoffGoalDate: toDate(d.payoff_goal_date), strategy: d.strategy, createdAt: toDate(d.created_at) ?? undefined, updatedAt: toDate(d.updated_at) ?? undefined,
                },
            });
        }
        // investment_holding -> a single "Imported holdings" BrokerageAccount + Holdings.
        if (investments.length) {
            const brokerage = await prisma.brokerageAccount.create({ data: { userId, accountName: "Imported holdings", brokerage: "Imported" } });
            for (const h of investments as InvestmentRow[]) {
                if (!h.symbol) continue;
                await prisma.holding.create({
                    data: {
                        brokerageAccountId: brokerage.id, symbol: h.symbol, shares: dec(toNum(h.quantity) ?? 0),
                        costBasisPerShare: h.cost_basis != null && toNum(h.quantity) ? dec((toNum(h.cost_basis)! ) / (toNum(h.quantity) || 1)) : null,
                        currentPrice: h.current_price != null ? dec(toNum(h.current_price)!) : null, asOf: toDate(h.last_priced_at),
                    },
                });
            }
        }
        for (const cs of creditScores as CreditScoreRow[]) {
            await prisma.creditScoreEntry.create({ data: { userId, score: cs.score, scoreDate: dateOnly(cs.recorded_on) } });
        }
        for (const g of finGoals as FinGoalRow[]) {
            await prisma.financialGoal.create({
                // *_cents (BigInt) -> Decimal dollars (/100).
                data: { userId, title: g.title, targetAmount: g.target_amount_cents != null ? dec(bigCentsToDollars(g.target_amount_cents)) : null, currentAmount: dec(bigCentsToDollars(g.current_amount_cents)), targetDate: toDate(g.target_date) },
            });
        }
        for (const st of finStatements as FinStatementRow[]) {
            const fileKey = await copyObject(s3, st.s3_key, userId, "financial", { originalName: st.original_filename });
            await prisma.finStatement.create({
                data: {
                    userId, finAccountId: finAccMap.get(st.account_id) ?? null, fileKey: fileKey ?? st.s3_key, fileName: st.original_filename ?? "statement",
                    mimeType: st.mime_type, fileSize: st.file_size_bytes != null ? Number(st.file_size_bytes) : null, periodStart: toDate(st.period_start), periodEnd: toDate(st.period_end),
                    // closing_balance_cents (BigInt) -> Decimal dollars (/100).
                    endingBalance: st.closing_balance_cents != null ? dec(bigCentsToDollars(st.closing_balance_cents)) : null,
                    processingStatus: mapStatementStatus(st.status), createdAt: toDate(st.created_at) ?? undefined,
                },
            });
        }
        // financial_document: only map tax-ish docs -> TaxDocument; else warn+skip.
        for (const d of finDocs as FinDocRow[]) {
            const kind = (d.kind ?? "").toUpperCase();
            if (kind.includes("TAX") || kind.includes("W2") || kind.includes("1099")) {
                const fileKey = await copyObject(s3, d.s3_key, userId, "financial", { originalName: d.original_filename });
                const year = toDate(d.document_date)?.getUTCFullYear() ?? new Date().getUTCFullYear();
                await prisma.taxDocument.create({ data: { userId, taxYear: year, kind: d.kind, fileKey, fileName: d.original_filename, notes: d.notes } });
            } else {
                console.warn(`  [financial_document] skipping non-tax doc kind="${d.kind}" id=${d.id}`);
            }
        }
        for (const n of netWorthSnaps as NetWorthRow[]) {
            await prisma.netWorthSnapshot.create({
                data: {
                    userId, asOf: dateOnly(n.recorded_on),
                    // *_cents (BigInt) -> Decimal dollars (/100).
                    assets: dec(bigCentsToDollars(n.assets_cents)), liabilities: dec(bigCentsToDollars(n.liabilities_cents)), netWorth: dec(bigCentsToDollars(n.net_worth_cents)),
                    breakdown: (asJson(n.breakdown) as Prisma.InputJsonValue) ?? Prisma.JsonNull, createdAt: toDate(n.created_at) ?? undefined,
                },
            });
        }

        // ---- FOCUS / LIFE ----
        for (const f of focusSprints as FocusRow[]) {
            await prisma.focusSprint.create({
                data: { userId, title: f.note ?? "Focus sprint", durationMinutes: f.planned_focus_seconds != null ? Math.round(f.planned_focus_seconds / 60) : null, startedAt: toDate(f.started_at), finishedAt: toDate(f.completed_at), completed: (f.status ?? "").toUpperCase() === "COMPLETED" },
            });
        }
        for (const w of weeklyPriorities as WeeklyPriorityRow[]) {
            await prisma.weeklyPriority.create({ data: { userId, weekOf: dateOnly(w.week_start), priorityText: w.title, order: w.position ?? 0, completed: w.completed ?? false, createdAt: toDate(w.created_at) ?? undefined, updatedAt: toDate(w.updated_at) ?? undefined } });
        }
        for (const r of rewardGoals as RewardGoalRow[]) {
            await prisma.rewardGoal.create({ data: { userId, description: r.reward_text, earned: (r.status ?? "").toUpperCase() === "ACHIEVED", createdAt: toDate(r.created_at) ?? undefined, updatedAt: toDate(r.updated_at) ?? undefined } });
        }
        // life_score_snapshot -> ScoreSnapshot per domain + OVERALL.
        for (const ls of lifeScores as LifeScoreRow[]) {
            const calculatedOn = dateOnly(ls.recorded_on);
            const rows: Array<[Prisma.ScoreSnapshotCreateInput["domain"], number | null]> = [
                ["HEALTH", toNum(ls.health_score)],
                ["SOCIAL", toNum(ls.social_score)],
                ["FINANCIAL", toNum(ls.financial_score)],
                ["CAREER", toNum(ls.career_score)],
                ["LEARNING", toNum(ls.learning_score)],
                ["OVERALL", toNum(ls.life_score)],
            ];
            for (const [domain, score] of rows) {
                if (score == null) continue;
                await prisma.scoreSnapshot.create({ data: { userId, domain, score, calculatedOn } });
            }
        }
        for (const i of lifeInsights as InsightRow[]) {
            await prisma.insight.create({ data: { userId, domain: domainFromTags(i.domain_tags), type: i.kind, message: i.title + (i.body ? ` — ${i.body}` : ""), createdAt: toDate(i.created_at) ?? undefined } });
        }
        for (const i of finInsights as FinInsightRow[]) {
            await prisma.insight.create({ data: { userId, domain: "FINANCIAL", type: i.kind, message: i.title + (i.body ? ` — ${i.body}` : ""), createdAt: toDate(i.created_at) ?? undefined } });
        }
        for (const i of careerInsights as FinInsightRow[]) {
            await prisma.insight.create({ data: { userId, domain: "CAREER", type: i.kind, message: i.title + (i.body ? ` — ${i.body}` : ""), createdAt: toDate(i.created_at) ?? undefined } });
        }
        for (const n of notifications as NotificationRow[]) {
            if (n.title?.startsWith("migration:")) continue;
            await prisma.notification.create({
                data: { userId, kind: "SYSTEM", severity: "INFO", title: n.title, body: n.message, href: n.link_url, readAt: n.read ? new Date() : null, createdAt: toDate(n.created_at) ?? undefined },
            });
        }

        printCounts("health", counts);
        await writeMarker(userId, "health", counts, args.dryRun);
        console.log("[health] done.");
    } finally {
        await safeDisconnect(db);
    }
}

// ---------------------------------------------------------------------------
// enum / value mappers
// ---------------------------------------------------------------------------
function mapMealType(t: string): Prisma.MealCreateInput["mealType"] {
    switch ((t ?? "").toUpperCase()) {
        case "BREAKFAST": return "BREAKFAST";
        case "LUNCH": return "LUNCH";
        case "DINNER": return "DINNER";
        default: return "SNACK";
    }
}
function mapTherapKind(t: string): Prisma.TherapeuticLogCreateInput["therapeuticKind"] {
    switch ((t ?? "").toUpperCase()) {
        case "MEDICATION": return "MEDICATION";
        case "SUPPLEMENT": return "SUPPLEMENT";
        case "PEPTIDE": return "PEPTIDE";
        default: return "OTHER";
    }
}
function mapSchedulePattern(t: string): Prisma.TherapeuticScheduleCreateInput["pattern"] {
    switch ((t ?? "").toUpperCase()) {
        case "DAILY": return "DAILY";
        case "INTERVAL":
        case "EVERY_N_DAYS": return "EVERY_N_DAYS";
        case "WEEKLY":
        case "WEEKLY_DOW": return "WEEKLY_DOW";
        case "WEEKLY_ONCE": return "WEEKLY_ONCE";
        default: return "DAILY";
    }
}
function mapCareerStatus(s: string): Prisma.JobApplicationCreateInput["status"] {
    switch ((s ?? "").toUpperCase()) {
        case "APPLIED": return "APPLIED";
        case "INTERVIEW":
        case "INTERVIEWED":
        case "INTERVIEWING": return "INTERVIEWING";
        case "OFFER":
        case "OFFERED": return "OFFERED";
        case "OFFER_ACCEPTED": return "OFFER_ACCEPTED";
        case "REJECTED": return "REJECTED";
        case "GHOSTED": return "GHOSTED";
        case "WITHDRAWN": return "WITHDRAWN";
        case "ASSESSMENT": return "ASSESSMENT";
        case "UNDER_REVIEW": return "UNDER_REVIEW";
        default: return "APPLIED";
    }
}
function mapFinKind(k: string): Prisma.FinAccountCreateInput["kind"] {
    switch ((k ?? "").toUpperCase()) {
        case "CHECKING": return "CHECKING";
        case "SAVINGS": return "SAVINGS";
        case "LOAN": return "LOAN";
        default: return "OTHER";
    }
}
function mapCadence(c: string): Prisma.FinSubscriptionCreateInput["cadence"] {
    switch ((c ?? "").toUpperCase()) {
        case "MONTHLY": return "MONTHLY";
        case "YEARLY":
        case "ANNUAL": return "YEARLY";
        case "WEEKLY": return "WEEKLY";
        default: return "OTHER";
    }
}
function mapFinTxSource(s: string | null): Prisma.FinTransactionCreateInput["source"] {
    switch ((s ?? "").toUpperCase()) {
        case "STATEMENT": return "STATEMENT";
        case "CSV": return "CSV";
        case "PLAID": return "PLAID";
        default: return "MANUAL";
    }
}
function mapStatementStatus(s: string): Prisma.FinStatementCreateInput["processingStatus"] {
    switch ((s ?? "").toUpperCase()) {
        case "DONE":
        case "COMPLETE":
        case "COMPLETED": return "DONE";
        case "PROCESSING": return "PROCESSING";
        case "FAILED":
        case "ERROR": return "FAILED";
        default: return "PENDING";
    }
}
function domainFromTags(tags: unknown): Prisma.InsightCreateInput["domain"] {
    const arr = asStringArray(tags).map((s) => s.toUpperCase());
    for (const d of ["HEALTH", "SOCIAL", "FINANCIAL", "CAREER", "LEARNING"] as const) {
        if (arr.includes(d)) return d;
    }
    return "OVERALL";
}

// ---------------------------------------------------------------------------
// misc helpers
// ---------------------------------------------------------------------------
function numArrToStr(v: unknown): string[] {
    if (Array.isArray(v)) return v.map((x) => String(x));
    return [];
}
const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
function dowIntToStr(v: unknown): string[] {
    if (!Array.isArray(v)) return [];
    return (v as number[]).map((n) => DOW[((n % 7) + 7) % 7]).filter(Boolean);
}
function minutesBetween(a: unknown, b: unknown): number | null {
    const da = toDate(a);
    const dbb = toDate(b);
    if (!da || !dbb) return null;
    return Math.max(0, Math.round((dbb.getTime() - da.getTime()) / 60000));
}
function combineDateTime(date: unknown, time: unknown): Date {
    const d = toDate(date) ?? new Date();
    const dateStr = isoDate(d);
    const timeStr = time != null ? String(time).slice(0, 8) : "00:00:00";
    const combined = new Date(`${dateStr}T${timeStr}Z`);
    return Number.isNaN(combined.getTime()) ? d : combined;
}
function parseAmount(s: string | null): number | null {
    if (!s) return null;
    const m = s.match(/[\d.]+/);
    return m ? Number(m[0]) : null;
}
function combineAmountNote(s: string | null): string | null {
    return s ? `amount: ${s}` : null;
}
function jsonToText(v: unknown): string | null {
    const j = asJson(v);
    if (j == null) return null;
    if (Array.isArray(j)) return (j as unknown[]).map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join("\n");
    if (typeof j === "string") return j;
    return JSON.stringify(j);
}
function parseRating(s: string | null): number | null {
    if (!s) return null;
    const n = Number(s);
    if (!Number.isNaN(n)) return n;
    switch (s.toUpperCase()) {
        case "EXCEEDS": return 5;
        case "MEETS": return 3;
        case "BELOW": return 1;
        default: return null;
    }
}

// ---------------------------------------------------------------------------
// row types (snake_case from Flyway tables)
// ---------------------------------------------------------------------------
interface ProfileRow { height_cm: unknown; gender: string | null; activity_level: string | null; diet_goal: string | null; target_weekly_change_kg: unknown; goal_weight_kg: unknown; goal_body_fat_pct: unknown; goal_target_date: Date | null; water_goal_ml: number | null; phone: string | null; date_of_birth: Date | null; }
interface BodyMetricRow { metric_type: string; custom_name: string | null; value: unknown; unit: string | null; measured_at: Date | null; notes: string | null; created_at: Date | null; updated_at: Date | null; }
interface VitalRow { id: bigint; vital_type: string; custom_name: string | null; value: unknown; value2: unknown; unit: string | null; measured_at: Date | null; notes: string | null; created_at: Date | null; updated_at: Date | null; }
interface VitalFieldRow { id: bigint; vital_reading_id: bigint; label: string; unit: string | null; value: unknown; position: number; }
interface NutritionDayRow { id: bigint; date: Date; notes: string | null; created_at: Date | null; updated_at: Date | null; }
interface HMealRow { id: bigint; nutrition_day_id: bigint; meal_type: string; name: string | null; meal_order: number | null; created_at: Date | null; updated_at: Date | null; }
interface FoodEntryRow { id: bigint; meal_id: bigint; product_id: bigint | null; description: string; serving_size: string | null; calories: unknown; protein_g: unknown; carbs_g: unknown; fat_g: unknown; fiber_g: unknown; sugar_g: unknown; sodium_mg: unknown; cholesterol_mg: unknown; saturated_fat_g: unknown; trans_fat_g: unknown; potassium_mg: unknown; ai_analyzed: boolean; ai_raw_response: unknown; manually_adjusted: boolean; }
interface FoodProductRow { id: bigint; barcode: string; brand: string | null; name: string; calories: unknown; protein_g: unknown; carbs_g: unknown; fat_g: unknown; serving_size_value: unknown; serving_size_unit: string | null; }
interface NutritionGoalRow { calories: number | null; protein_g: unknown; carbs_g: unknown; fat_g: unknown; fiber_g: unknown; }
interface WaterLogRow { amount_ml: number; date: Date; }
interface SleepRow { id: bigint; date: Date; bedtime: Date | null; wake_time: Date | null; total_minutes: number | null; sleep_quality: number | null; feel_rested: number | null; sleep_latency_min: number | null; notes: string | null; survey_responses: unknown; created_at: Date | null; updated_at: Date | null; }
interface InterruptionRow { id: bigint; sleep_entry_id: bigint; woke_at: Date | null; fell_back_at: Date | null; duration_min: number | null; reason: string | null; }
interface HabitRow { id: bigint; name: string; description: string | null; habit_type: string | null; frequency: string | null; target_count: number | null; target_days: number | null; days_of_week: unknown; color: string | null; icon: string | null; active: boolean | null; category: string | null; cue: string | null; routine: string | null; reward: string | null; stack_after_habit_id: bigint | null; difficulty: string | null; priority: number | null; reminder_time: unknown; created_at: Date | null; updated_at: Date | null; }
interface HabitLogRow { id: bigint; habit_id: bigint; date: Date; completed: boolean; notes: string | null; created_at: Date | null; }
interface MilestoneRow { id: bigint; habit_id: bigint; milestone_type: string; milestone_value: number; achieved_at: Date; }
interface JournalRow { id: bigint; date: Date; reflection: string | null; gratitude: string | null; overall_rating: number | null; created_at: Date | null; updated_at: Date | null; }
interface RealmRow { id: bigint; journal_entry_id: bigint; realm: string; rating: number; }
interface AppointmentRow { id: bigint; title: string; doctor_name: string | null; office_name: string | null; specialty: string | null; location: string | null; appointment_date: Date; appointment_time: unknown; duration_minutes: number | null; notes: string | null; status: string; created_at: Date | null; updated_at: Date | null; }
interface MedRecordRow { id: bigint; name: string; provider_name: string | null; doctor_name: string | null; record_date: Date | null; mime_type: string | null; file_size: bigint | null; notes: string | null; s3_key: string | null; created_at: Date | null; updated_at: Date | null; }
interface ExtractedItemRow { id: bigint; medical_record_id: bigint; kind: string; raw_label: string; canonical_type: string | null; value: unknown; unit: string | null; }
interface ProgressPhotoRow { id: bigint; s3_key: string | null; taken_at: Date | null; weight_kg: unknown; notes: string | null; created_at: Date | null; }
interface TherapeuticRow { id: bigint; name: string; dosage_amount: unknown; dosage_unit: string | null; frequency: string | null; notes: string | null; active: boolean | null; created_at: Date | null; updated_at: Date | null; }
interface HPeptideRow { id: bigint; name: string; total_amount_mg: unknown; bac_water_ml: unknown; concentration_mg_per_ml: unknown; notes: string | null; active: boolean | null; }
interface TherapScheduleRow { id: bigint; therapeutic_type: string; schedule_type: string; days_of_week: unknown; interval_days: number | null; time_of_day: unknown; dosage_override: unknown; dosage_unit: string | null; notes: string | null; active: boolean | null; start_date: Date | null; end_date: Date | null; }
interface TherapLogRow { id: bigint; therapeutic_type: string; therapeutic_id: bigint; taken_at: Date | null; dosage_amount: unknown; dosage_unit: string | null; notes: string | null; skipped: boolean; }
interface SubstanceLogRow { id: bigint; substance_type: string; occurred_at: Date | null; amount: string | null; notes: string | null; }
interface CustomSubRow { id: bigint; name: string; }
interface SContactRow { id: bigint; display_name: string; nickname: string | null; avatar_path: string | null; relationship_type: string | null; how_we_met: string | null; birthday: Date | null; phone: string | null; email: string | null; interests: string | null; notes: string | null; closeness_score: number | null; active: boolean | null; last_contact_at: Date | null; pronouns: string | null; status: string | null; trust_score: number | null; communication_frequency: string | null; energy_tags: unknown; inner_circle: boolean | null; stay_in_touch: boolean | null; stay_in_touch_days: number | null; occupation: string | null; company_or_school: string | null; hometown: string | null; time_zone: string | null; preferred_contact_method: string | null; created_at: Date | null; updated_at: Date | null; }
interface CSubRow { id: bigint; contact_id: bigint; label: string | null; value: string; }
interface CAddrRow { id: bigint; contact_id: bigint; label: string | null; line1: string | null; line2: string | null; city: string | null; state: string | null; postal_code: string | null; country: string | null; }
interface CHandleRow { id: bigint; contact_id: bigint; platform: string; handle: string; }
interface CDateRow { id: bigint; contact_id: bigint; kind: string; date: Date; }
interface CNoteRow { id: bigint; contact_id: bigint; kind: string; body: string; created_at: Date | null; }
interface CReminderRow { id: bigint; contact_id: bigint; kind: string; scheduled_for: Date | null; completed_at: Date | null; }
interface SInteractionRow { id: bigint; contact_id: bigint | null; occurred_at: Date | null; kind: string; summary: string | null; }
interface CommLogRow { id: bigint; contact_id: bigint | null; kind: string; occurred_at: Date | null; snippet: string | null; platform: string | null; }
interface SEventRow { id: bigint; title: string; starts_at: Date | null; location: string | null; contact_ids: unknown; description: string | null; cover_image_s3_key: string | null; created_at: Date | null; updated_at: Date | null; }
interface SMemoryRow { id: bigint; contact_ids: unknown; occurred_on: Date | null; caption: string | null; body: string | null; photo_url: string | null; }
interface SGiftRow { id: bigint; contact_id: bigint | null; occasion: string | null; idea: string; status: string; gifted_on: Date | null; }
interface SBatteryRow { id: bigint; recorded_at: Date | null; energy_after: number | null; energy_before: number | null; notes: string | null; }
interface SConflictRow { id: bigint; contact_id: bigint | null; occurred_at: Date | null; conflict_type: string | null; trigger_text: string | null; resolution_text: string | null; }
interface STagRow { id: bigint; name: string; color: string | null; }
interface TagLinkRow { contact_id: bigint; tag_id: bigint; }
interface SConnectionRow { id: bigint; a_id: bigint; b_id: bigint; kind: string | null; notes: string | null; }
interface CSkillRow { id: bigint; name: string; category: string | null; proficiency: number | null; target_proficiency: number | null; practice_plan: string | null; verified_proof_url: string | null; hours_logged: unknown; created_at: Date | null; updated_at: Date | null; }
interface CEvidenceRow { id: bigint; skill_id: bigint; kind: string; note: string | null; recorded_on: Date | null; }
interface CCertRow { id: bigint; name: string; issuer: string | null; status: string | null; exam_date: Date | null; completed_at: Date | null; expires_at: Date | null; created_at: Date | null; updated_at: Date | null; }
interface CProjectRow { id: bigint; title: string; description: string | null; started_on: Date | null; ended_on: Date | null; tech_stack: unknown; outcomes: string | null; url: string | null; created_at: Date | null; updated_at: Date | null; }
interface CSalaryRow { id: bigint; employer: string | null; effective_on: Date | null; base_salary_cents: bigint | null; bonus_cents: bigint | null; equity_cents: bigint | null; total_comp_cents: bigint | null; currency: string | null; }
interface CGoalRow { id: bigint; title: string; description: string | null; target_date: Date | null; status: string | null; created_at: Date | null; updated_at: Date | null; }
interface CWeeklyRow { id: bigint; week_start: Date; wins: unknown; blockers: unknown; lessons: unknown; summary: string | null; created_at: Date | null; updated_at: Date | null; }
interface CJournalRow { id: bigint; entry_date: Date; body: string | null; created_at: Date | null; updated_at: Date | null; }
interface CMentorRow { id: bigint; name: string; relationship: string | null; topics: unknown; next_session_on: Date | null; notes: string | null; created_at: Date | null; updated_at: Date | null; }
interface CReviewRow { id: bigint; review_date: Date; reviewer: string | null; overall_rating: string | null; manager_feedback: string | null; created_at: Date | null; }
interface CAppRow { id: bigint; company: string; role: string; date_applied: Date | null; status: string; salary_range: string | null; location: string | null; notes: string | null; created_at: Date | null; updated_at: Date | null; }
interface CInterviewRow { id: bigint; application_id: bigint | null; stage: string | null; scheduled_at: Date | null; interviewer: string | null; feedback: string | null; }
interface LCourseRow { id: bigint; title: string; source: string | null; url: string | null; description: string | null; status: string | null; started_on: Date | null; completed_on: Date | null; created_at: Date | null; updated_at: Date | null; }
interface LLessonRow { id: bigint; course_id: bigint | null; title: string; completed: boolean | null; position: number | null; created_at: Date | null; updated_at: Date | null; }
interface LGoalRow { id: bigint; title: string; description: string | null; target_date: Date | null; status: string | null; created_at: Date | null; updated_at: Date | null; }
interface LSkillRow { id: bigint; name: string; level: number | null; created_at: Date | null; updated_at: Date | null; }
interface LResourceRow { id: bigint; title: string; kind: string | null; url: string | null; created_at: Date | null; }
interface FlashcardRow { id: bigint; front: string; back: string; repetitions: number | null; last_reviewed_at: Date | null; created_at: Date | null; updated_at: Date | null; }
interface QuizRow { id: bigint; course_id: bigint | null; title: string; created_at: Date | null; }
interface QuizAttemptRow { id: bigint; quiz_id: bigint | null; score: unknown; max_score: unknown; taken_at: Date | null; }
interface LNoteRow { id: bigint; title: string | null; body: string | null; created_at: Date | null; updated_at: Date | null; }
interface LSessionRow { id: bigint; started_at: Date; duration_minutes: number | null; notes: string | null; }
interface LPlanRow { id: bigint; scheduled_for: Date | null; topic: string | null; completed: boolean | null; created_at: Date | null; }
interface LAchievementRow { id: bigint; kind: string; title: string; earned_at: Date; created_at: Date | null; }
interface FinAccountRow { id: bigint; name: string; institution: string | null; kind: string; currency: string | null; current_balance: unknown; last_balance_at: Date | null; include_in_net_worth: boolean | null; archived: boolean | null; is_asset: boolean | null; notes: string | null; created_at: Date | null; updated_at: Date | null; }
interface FinTxnRow { id: bigint; account_id: bigint | null; occurred_on: Date; direction: string | null; category: string | null; amount: unknown; currency: string | null; merchant: string | null; description: string | null; source: string | null; created_at: Date | null; updated_at: Date | null; }
interface FinSubRow { id: bigint; name: string; merchant: string | null; amount: unknown; currency: string | null; cadence: string; active: boolean | null; started_on: Date | null; cancelled_on: Date | null; next_charge_on: Date | null; notes: string | null; created_at: Date | null; updated_at: Date | null; }
interface DebtRow { id: bigint; name: string; kind: string; principal_original: unknown; principal_remaining: unknown; apr: unknown; minimum_payment: unknown; payoff_goal_date: Date | null; strategy: string | null; created_at: Date | null; updated_at: Date | null; }
interface InvestmentRow { id: bigint; account_id: bigint | null; symbol: string | null; name: string | null; quantity: unknown; cost_basis: unknown; current_price: unknown; last_priced_at: Date | null; }
interface BudgetMonthRow { id: bigint; month: Date; }
interface BudgetCatRow { id: bigint; budget_month_id: bigint; category: string; cap_amount: unknown; kind: string; }
interface CreditScoreRow { id: bigint; recorded_on: Date; score: number; }
interface FinGoalRow { id: bigint; title: string; target_amount_cents: bigint | null; current_amount_cents: bigint | null; target_date: Date | null; }
interface FinStatementRow { id: bigint; account_id: bigint | null; period_start: Date | null; period_end: Date | null; closing_balance_cents: bigint | null; s3_key: string; original_filename: string | null; mime_type: string | null; file_size_bytes: bigint | null; status: string; created_at: Date | null; }
interface FinDocRow { id: bigint; kind: string; document_date: Date | null; s3_key: string; mime_type: string | null; original_filename: string | null; notes: string | null; }
interface NetWorthRow { recorded_on: Date; assets_cents: bigint; liabilities_cents: bigint; net_worth_cents: bigint; breakdown: unknown; created_at: Date | null; }
interface FocusRow { id: bigint; started_at: Date | null; planned_focus_seconds: number | null; completed_at: Date | null; status: string; note: string | null; }
interface WeeklyPriorityRow { id: bigint; week_start: Date; title: string; position: number | null; completed: boolean | null; created_at: Date | null; updated_at: Date | null; }
interface RewardGoalRow { id: bigint; reward_text: string; status: string; created_at: Date | null; updated_at: Date | null; }
interface LifeScoreRow { recorded_on: Date; health_score: unknown; social_score: unknown; financial_score: unknown; career_score: unknown; learning_score: unknown; life_score: unknown; }
interface InsightRow { id: bigint; kind: string; title: string; body: string | null; domain_tags: unknown; created_at: Date | null; }
interface FinInsightRow { id: bigint; kind: string; title: string; body: string | null; created_at: Date | null; }
interface NotificationRow { id: bigint; title: string; message: string | null; notification_type: string; read: boolean; link_url: string | null; scheduled_for: Date | null; created_at: Date | null; }

if (import.meta.url === `file://${process.argv[1]}`) {
    migrateHealth(parseArgs())
        .then(() => prisma.$disconnect())
        .catch(async (e) => {
            console.error(e);
            await prisma.$disconnect();
            process.exit(1);
        });
}
