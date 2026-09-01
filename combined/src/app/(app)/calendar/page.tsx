import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { materializeDueReminders } from "@/lib/reminders-materialize";
import { listPeptides } from "@/lib/actions/peptides";
import { generateSchedule } from "@/lib/peptides/schedule";
import { isOccurrenceTaken } from "@/lib/peptides/admin";
import { peptideColor } from "@/lib/peptides/peptide-color";
import { annualOccurrencesInWindow } from "@/lib/calendar/annual-dates";
import { CalendarClient, type CalendarItem, type NutritionDaySummary, type TxnDaySummary, type TxnEntry } from "./calendar-client";

export default async function CalendarPage() {
    const user = await requireUser();

    // Surface any due/overdue recurring reminders as notifications (no worker).
    await materializeDueReminders(user.id);

    // Auto-skip therapeutic doses that are >2 hours overdue and still pending.
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    await db.therapeuticDose.updateMany({
        where: {
            userId: user.id,
            scheduledAt: { lte: twoHoursAgo },
            loggedAt: null,
            skippedAt: null,
        },
        data: { skippedAt: now },
    });

    // Auto-skip past-due ROUTINE todos still open (one-off tasks roll over on the
    // todos page instead — see rolloverPastTodos). UTC midnight matches @db.Date.
    const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    await db.todoItem.updateMany({
        where: {
            userId: user.id,
            routineId: { not: null },
            status: { in: ["PLANNED", "IN_PROGRESS", "DRIPPED"] },
            date: { lt: startOfToday },
        },
        data: { status: "SKIPPED" },
    });

    // Window: 2 months back through 4 months forward of overlays/events.

    const windowStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const windowEnd = new Date(now.getFullYear(), now.getMonth() + 4, 0, 23, 59, 59);

    const [events, categories, contacts, providers, doctors, jobMeetings, jobDeadlines, jobUpdates, workouts, therapeuticDoses, reminders, todos, focusSprints, nutritionDays, nutritionGoal, finStatements, finTransactions, socialEvents, socialBattery, socialContacts, contactDates, contactReminders, bodyMetrics, vitalReadings, sobrietyRelapses] = await Promise.all([
        db.calendarEvent.findMany({
            where: { userId: user.id, startsAt: { gte: windowStart, lte: windowEnd } },
            include: { category: true, attendees: { include: { contact: { select: { displayName: true } } } }, reminders: true },
            orderBy: { startsAt: "asc" },
        }),
        db.eventCategory.findMany({ where: { userId: user.id }, orderBy: { name: "asc" } }),
        db.socialContact.findMany({ where: { userId: user.id, active: true }, select: { id: true, displayName: true }, orderBy: { displayName: "asc" } }),
        db.provider.findMany({ where: { userId: user.id, archived: false }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
        db.doctor.findMany({ where: { userId: user.id, archived: false }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
        db.jobMeeting.findMany({
            where: { application: { userId: user.id }, dateTime: { gte: windowStart, lte: windowEnd } },
            include: { application: { select: { id: true, role: true, company: { select: { name: true } } } } },
        }),
        db.jobApplication.findMany({
            where: { userId: user.id, deadline: { gte: windowStart, lte: windowEnd } },
            select: { id: true, role: true, deadline: true, status: true, company: { select: { name: true } } },
        }),
        // Application updates (created / status change / edited) placed on the day
        // they happened, so progress shows up on the calendar.
        db.jobApplicationEvent.findMany({
            where: {
                application: { userId: user.id },
                type: { in: ["created", "status", "updated"] },
                createdAt: { gte: windowStart, lte: windowEnd },
            },
            select: {
                id: true,
                type: true,
                message: true,
                createdAt: true,
                application: { select: { id: true, role: true, company: { select: { name: true } } } },
            },
            orderBy: { createdAt: "asc" },
        }),
        db.workout.findMany({
            where: { userId: user.id, deletedAt: null, date: { gte: windowStart, lte: windowEnd } },
            select: { id: true, name: true, date: true },
        }),
        db.therapeuticDose.findMany({
            where: { userId: user.id, scheduledAt: { gte: windowStart, lte: windowEnd } },
            include: { schedule: { select: { name: true, kind: true } } },
        }),
        db.recurringReminder.findMany({
            where: { userId: user.id, archived: false, nextDueAt: { gte: windowStart, lte: windowEnd } },
            select: { id: true, title: true, icon: true, nextDueAt: true },
        }),
        // Todos that fall in the window: those with an explicit `date`, plus
        // undated ones bucketed by their creation day.
        db.todoItem.findMany({
            where: {
                userId: user.id,
                OR: [
                    { date: { gte: windowStart, lte: windowEnd } },
                    { date: null, createdAt: { gte: windowStart, lte: windowEnd } },
                ],
            },
            select: { id: true, title: true, status: true, date: true, createdAt: true, dueAt: true, timeOfDay: true, startTime: true, durationMinutes: true },
            orderBy: { createdAt: "asc" },
        }),
        // FOCUS sessions: started sprints in the window, placed on their startedAt day.
        db.focusSprint.findMany({
            where: { userId: user.id, startedAt: { gte: windowStart, lte: windowEnd } },
            select: { id: true, title: true, startedAt: true, durationMinutes: true, completed: true },
            orderBy: { startedAt: "asc" },
        }),
        // NUTRITION: days in window with their meals/entries (calorie sum + meal count).
        db.nutritionDay.findMany({
            where: { userId: user.id, date: { gte: windowStart, lte: windowEnd } },
            select: { date: true, meals: { select: { entries: { select: { calories: true } } } } },
        }),
        db.nutritionGoal.findUnique({ where: { userId: user.id }, select: { calories: true } }),
        // FINANCIAL statements whose period overlaps the window (markers on start/end days).
        db.finStatement.findMany({
            where: {
                userId: user.id,
                OR: [
                    { periodStart: { gte: windowStart, lte: windowEnd } },
                    { periodEnd: { gte: windowStart, lte: windowEnd } },
                ],
            },
            select: {
                id: true,
                periodStart: true,
                periodEnd: true,
                endingBalance: true,
                finAccount: { select: { nickname: true, institution: true } },
                creditCard: { select: { productName: true, issuer: true } },
                brokerageAccount: { select: { accountName: true, brokerage: true } },
            },
        }),
        // FINANCIAL transactions in window (per-day chip + panel rows).
        db.finTransaction.findMany({
            where: { userId: user.id, date: { gte: windowStart, lte: windowEnd } },
            select: { id: true, date: true, amount: true, merchant: true, rawDescription: true },
            orderBy: { date: "asc" },
        }),
        db.socialEvent.findMany({
            where: {
                userId: user.id,
                eventDate: { gte: windowStart, lte: windowEnd },
            },
            select: { id: true, name: true, eventDate: true, location: true, notes: true },
            orderBy: { eventDate: "asc" },
        }),
        db.socialBattery.findMany({
            where: { userId: user.id, date: { gte: windowStart, lte: windowEnd } },
            select: { id: true, date: true, energyLevel: true, notes: true },
            orderBy: { date: "asc" },
        }),
        db.socialContact.findMany({
            where: { userId: user.id, active: true, birthday: { not: null } },
            select: { id: true, displayName: true, birthday: true },
        }),
        db.contactDate.findMany({
            where: { contact: { userId: user.id, active: true } },
            select: { id: true, dateType: true, dateValue: true, contact: { select: { id: true, displayName: true } } },
        }),
        db.contactReminder.findMany({
            where: {
                contact: { userId: user.id },
                scheduledFor: { gte: windowStart, lte: windowEnd },
            },
            select: { id: true, reminderType: true, scheduledFor: true, completed: true, contact: { select: { id: true, displayName: true } } },
            orderBy: { scheduledFor: "asc" },
        }),
        db.bodyMetric.findMany({
            where: { userId: user.id, measuredAt: { gte: windowStart, lte: windowEnd } },
            select: { id: true, metricType: true, customName: true, value: true, unit: true, measuredAt: true },
            orderBy: { measuredAt: "asc" },
        }),
        db.vitalReading.findMany({
            where: { userId: user.id, measuredAt: { gte: windowStart, lte: windowEnd } },
            select: { id: true, vitalType: true, customName: true, value: true, value2: true, unit: true, measuredAt: true },
            orderBy: { measuredAt: "asc" },
        }),
        db.sobrietyRelapse.findMany({
            where: {
                counter: { userId: user.id, archived: false },
                relapsedAt: { gte: windowStart, lte: windowEnd },
            },
            select: {
                id: true,
                relapsedAt: true,
                notes: true,
                counter: { select: { id: true, name: true, color: true } },
            },
            orderBy: { relapsedAt: "asc" },
        }),
    ]);

    // ── Normalize everything into CalendarItem[] ─────────────
    const eventItems: CalendarItem[] = events.map((e) => ({
        id: e.id,
        kind: "event",
        source: null,
        title: e.title,
        startsAt: e.startsAt.toISOString(),
        endsAt: e.endsAt?.toISOString() ?? null,
        allDay: e.allDay,
        color: e.category?.color ?? "neutral",
        categoryName: e.category?.name ?? null,
        categoryId: e.categoryId ?? null,
        iconName: e.category?.icon ?? null,
        eventKind: e.kind,
        href: null,
        editable: true,
        meta: {
            description: e.description,
            location: e.location,
            categoryId: e.categoryId,
            providerId: e.providerId,
            doctorId: e.doctorId,
            visitNotes: e.visitNotes,
            attendees: e.attendees.map((a) => ({ contactId: a.contactId, name: a.contact?.displayName ?? a.name, email: a.email })),
            reminders: e.reminders.map((r) => ({ minutesBefore: r.minutesBefore, channel: r.channel })),
        },
    }));

    const overlayItems: CalendarItem[] = [
        ...jobMeetings
            .filter((m) => m.dateTime)
            .map((m): CalendarItem => ({
                id: `jm-${m.id}`,
                kind: "overlay",
                source: "job-meeting",
                title: `Interview · ${m.application.role}${m.application.company?.name ? ` @ ${m.application.company.name}` : ""}`,
                startsAt: m.dateTime!.toISOString(),
                endsAt: null,
                allDay: false,
                color: "sky",
                categoryName: "Job meeting",
                categoryId: null,
                eventKind: null,
                href: `/career/applications/${m.application.id}`,
                editable: false,
                meta: {},
            })),
        ...jobDeadlines
            .filter((d) => d.deadline)
            .map((d): CalendarItem => ({
                id: `jd-${d.id}`,
                kind: "overlay",
                source: "job-deadline",
                title: `Deadline · ${d.role}${d.company?.name ? ` @ ${d.company.name}` : ""}`,
                startsAt: d.deadline!.toISOString(),
                endsAt: null,
                allDay: true,
                color: "red",
                categoryName: "Job deadline",
                categoryId: null,
                eventKind: null,
                href: `/career/applications/${d.id}`,
                editable: false,
                // Deadline met once the application has been submitted/advanced past not-started.
                done: d.status !== "NOT_STARTED",
                meta: {},
            })),
        ...jobUpdates.map((u): CalendarItem => ({
            id: `ju-${u.id}`,
            kind: "overlay",
            source: "job-update",
            title: `${u.application.role}${u.application.company?.name ? ` @ ${u.application.company.name}` : ""} · ${u.message}`,
            startsAt: u.createdAt.toISOString(),
            endsAt: null,
            allDay: false,
            color: "indigo",
            categoryName: "Application update",
            categoryId: null,
            eventKind: null,
            href: `/career/applications/${u.application.id}`,
            editable: false,
            meta: { description: u.message },
        })),
        ...workouts.map((w): CalendarItem => ({
            id: `wk-${w.id}`,
            kind: "overlay",
            source: "workout",
            title: `Workout${w.name ? ` · ${w.name}` : ""}`,
            startsAt: w.date.toISOString(),
            endsAt: null,
            allDay: true,
            color: "emerald",
            categoryName: "Workout",
            categoryId: null,
            eventKind: null,
            href: `/workouts`,
            editable: false,
            meta: {},
        })),
        ...therapeuticDoses.map((t): CalendarItem => ({
            id: `td-${t.id}`,
            kind: "overlay",
            source: "dose",
            title: `Dose · ${t.schedule?.name ?? "Therapeutic"}`,
            startsAt: t.scheduledAt.toISOString(),
            endsAt: null,
            allDay: false,
            color: "amber",
            categoryName: "Therapeutic dose",
            categoryId: null,
            eventKind: null,
            href: `/health/medications`,
            editable: false,
            done: t.loggedAt != null || t.skippedAt != null,
            meta: { doseLogged: t.loggedAt != null, doseSkipped: t.skippedAt != null },
        })),
        ...reminders.map((r): CalendarItem => ({
            id: `rem-${r.id}`,
            kind: "overlay",
            source: "reminder",
            title: `Reminder · ${r.title}`,
            startsAt: r.nextDueAt.toISOString(),
            endsAt: null,
            allDay: false,
            color: "violet",
            categoryName: "Reminder",
            categoryId: null,
            eventKind: null,
            href: `/calendar/reminders`,
            editable: false,
            meta: { reminderIconName: r.icon, reminderId: r.id },
        })),
        // FINANCIAL statement period markers: a pill on the start day (opens) and
        // the end day (closes · ending balance). Both link to the statements page.
        ...finStatements.flatMap((s): CalendarItem[] => {
            const label =
                s.finAccount?.nickname || s.finAccount?.institution ||
                s.creditCard?.productName || s.creditCard?.issuer ||
                s.brokerageAccount?.accountName || s.brokerageAccount?.brokerage ||
                "Statement";
            const out: CalendarItem[] = [];
            const inWindow = (d: Date) => d >= windowStart && d <= windowEnd;
            if (s.periodStart && inWindow(s.periodStart)) {
                out.push({
                    id: `stmt-open-${s.id}`,
                    kind: "overlay",
                    source: "statement",
                    title: `▸ ${label} statement opens`,
                    startsAt: s.periodStart.toISOString(),
                    endsAt: null,
                    allDay: true,
                    color: "blue",
                    categoryName: "Statement",
                    categoryId: null,
                    eventKind: null,
                    href: `/financial/statements`,
                    editable: false,
                    meta: { statementMarker: "open", statementId: s.id },
                });
            }
            if (s.periodEnd && inWindow(s.periodEnd)) {
                const ending = s.endingBalance != null ? ` · $${Number(s.endingBalance).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ending` : "";
                out.push({
                    id: `stmt-close-${s.id}`,
                    kind: "overlay",
                    source: "statement",
                    title: `◂ ${label} closes${ending}`,
                    startsAt: s.periodEnd.toISOString(),
                    endsAt: null,
                    allDay: true,
                    color: "blue",
                    categoryName: "Statement",
                    categoryId: null,
                    eventKind: null,
                    href: `/financial/statements`,
                    editable: false,
                    meta: { statementMarker: "close", statementId: s.id },
                });
            }
            return out;
        }),
        ...sobrietyRelapses.map((r): CalendarItem => ({
            id: `sob-${r.id}`,
            kind: "overlay",
            source: "sobriety",
            title: `Sobriety break · ${r.counter.name}`,
            startsAt: r.relapsedAt.toISOString(),
            endsAt: null,
            allDay: false,
            color: "red",
            categoryName: "Sobriety relapse",
            categoryId: null,
            eventKind: null,
            href: `/health/sobriety`,
            editable: false,
            done: false,
            meta: { description: r.notes, sobrietyCounterId: r.counter.id, sobrietyCounterName: r.counter.name },
        })),
        // Todos become overlay pills on their day; DONE/SKIPPED render struck-through.
        ...todos.map((t): CalendarItem => {
            const day = t.date ?? t.createdAt;
            return {
                id: `todo-${t.id}`,
                kind: "overlay",
                source: "todo",
                title: `Todo · ${t.title}`,
                startsAt: new Date(day).toISOString(),
                endsAt: null,
                allDay: true,
                color: "indigo",
                categoryName: "Todo",
                categoryId: null,
                eventKind: null,
                href: `/todos`,
                editable: false,
                done: t.status === "DONE" || t.status === "SKIPPED",
                meta: {
                    todoId: t.id,
                    todoStatus: t.status,
                    todoStartTime: t.startTime ?? null,
                    todoDurationMinutes: t.durationMinutes ?? null,
                    todoTimeOfDay: t.timeOfDay ?? null,
                },
            };
        }),
        // FOCUS sessions on their startedAt day.
        ...focusSprints
            .filter((s) => s.startedAt)
            .map((s): CalendarItem => {
                const dur = s.durationMinutes ? ` · ${s.durationMinutes}m` : "";
                return {
                    id: `focus-${s.id}`,
                    kind: "overlay",
                    source: "focus",
                    title: `🎯 ${s.title}${dur}`,
                    startsAt: s.startedAt!.toISOString(),
                    endsAt: null,
                    allDay: false,
                    color: "rose",
                    categoryName: "Focus session",
                    categoryId: null,
                    eventKind: null,
                    href: `/focus`,
                    editable: false,
                    done: s.completed,
                    meta: { focusCompleted: s.completed, focusDuration: s.durationMinutes ?? null },
                };
            }),
        ...socialEvents
            .filter((e) => e.eventDate)
            .map((e): CalendarItem => ({
                id: `soc-${e.id}`,
                kind: "overlay",
                source: "social-event",
                title: `Social · ${e.name}`,
                startsAt: e.eventDate!.toISOString(),
                endsAt: null,
                allDay: true,
                color: "pink",
                categoryName: "Social event",
                categoryId: null,
                eventKind: null,
                href: `/social/events`,
                editable: false,
                meta: { description: e.notes, location: e.location },
            })),
        ...socialBattery.map((b): CalendarItem => ({
            id: `sb-${b.id}`,
            kind: "overlay",
            source: "social-battery",
            title: `Social battery · ${b.energyLevel}/10`,
            startsAt: b.date.toISOString(),
            endsAt: null,
            allDay: true,
            color: b.energyLevel <= 3 ? "red" : b.energyLevel <= 6 ? "amber" : "emerald",
            categoryName: "Social battery",
            categoryId: null,
            eventKind: null,
            href: `/social`,
            editable: false,
            meta: { batteryLevel: b.energyLevel, description: b.notes },
        })),
        ...socialContacts.flatMap((c): CalendarItem[] => {
            if (!c.birthday) return [];
            return annualOccurrencesInWindow(c.birthday, windowStart, windowEnd).map((occ) => ({
                id: `bday-${c.id}-${occ.toISOString().slice(0, 10)}`,
                kind: "overlay" as const,
                source: "social-birthday" as const,
                title: `Birthday · ${c.displayName}`,
                startsAt: occ.toISOString(),
                endsAt: null,
                allDay: true,
                color: "pink",
                categoryName: "Birthday",
                categoryId: null,
                eventKind: null,
                href: `/social/contacts/${c.id}`,
                editable: false,
                meta: { contactId: c.id },
            }));
        }),
        ...contactDates.flatMap((d): CalendarItem[] =>
            annualOccurrencesInWindow(d.dateValue, windowStart, windowEnd).map((occ) => ({
                id: `cdate-${d.id}-${occ.toISOString().slice(0, 10)}`,
                kind: "overlay" as const,
                source: "social-birthday" as const,
                title: `${d.dateType} · ${d.contact.displayName}`,
                startsAt: occ.toISOString(),
                endsAt: null,
                allDay: true,
                color: "rose",
                categoryName: "Important date",
                categoryId: null,
                eventKind: null,
                href: `/social/contacts/${d.contact.id}`,
                editable: false,
                meta: { contactId: d.contact.id },
            })),
        ),
        ...contactReminders.map((r): CalendarItem => ({
            id: `crem-${r.id}`,
            kind: "overlay",
            source: "contact-reminder",
            title: `Reminder · ${r.contact.displayName}${r.reminderType ? ` (${r.reminderType})` : ""}`,
            startsAt: r.scheduledFor.toISOString(),
            endsAt: null,
            allDay: false,
            color: "violet",
            categoryName: "Contact reminder",
            categoryId: null,
            eventKind: null,
            href: `/social/contacts/${r.contact.id}`,
            editable: false,
            done: r.completed,
            meta: { contactId: r.contact.id },
        })),
        ...bodyMetrics.map((m): CalendarItem => {
            const label = m.metricType === "custom" ? (m.customName ?? "Metric") : m.metricType.replace(/_/g, " ");
            const val = m.unit ? `${m.value} ${m.unit}` : String(m.value);
            return {
                id: `bm-${m.id}`,
                kind: "overlay",
                source: "health-metric",
                title: `${label} · ${val}`,
                startsAt: m.measuredAt.toISOString(),
                endsAt: null,
                allDay: false,
                color: "teal",
                categoryName: "Body metric",
                categoryId: null,
                eventKind: null,
                href: `/workouts/body`,
                editable: false,
                meta: { metricType: m.metricType, value: m.value, unit: m.unit },
            };
        }),
        ...vitalReadings.map((v): CalendarItem => {
            const label = v.vitalType === "custom" ? (v.customName ?? "Vital") : v.vitalType.replace(/_/g, " ");
            const val =
                v.vitalType === "blood_pressure" && v.value != null && v.value2 != null
                    ? `${v.value}/${v.value2}`
                    : v.value != null
                      ? String(v.value)
                      : "—";
            const withUnit = v.unit ? `${val} ${v.unit}` : val;
            return {
                id: `vr-${v.id}`,
                kind: "overlay",
                source: "health-vital",
                title: `${label} · ${withUnit}`,
                startsAt: v.measuredAt.toISOString(),
                endsAt: null,
                allDay: false,
                color: "cyan",
                categoryName: "Vital",
                categoryId: null,
                eventKind: null,
                href: `/health/vitals`,
                editable: false,
                meta: { vitalType: v.vitalType, value: v.value, value2: v.value2, unit: v.unit },
            };
        }),
    ];

    // ── Peptide injection schedule: expand each peptide's cycle and place every
    //    planned dose in the window on its day (color per peptide, taken state). ──
    const peptides = await listPeptides();
    const peptideItems: CalendarItem[] = [];
    peptides.forEach((p, i) => {
        const color = peptideColor(i);
        const schedule = generateSchedule(p);

        // Task 7 — Cycle start/end milestone markers.
        if (schedule.length > 0) {
            const firstDate = schedule[0].date;
            const lastDate = schedule[schedule.length - 1].date;
            const cycleStart = new Date(`${firstDate}T12:00:00.000Z`);
            const cycleEnd = new Date(`${lastDate}T12:00:00.000Z`);
            if (cycleStart >= windowStart && cycleStart <= windowEnd) {
                peptideItems.push({
                    id: `pep-cycle-start-${p.id}`,
                    kind: "overlay",
                    source: "peptide",
                    title: `${p.name} Cycle Starts`,
                    startsAt: cycleStart.toISOString(),
                    endsAt: null,
                    allDay: true,
                    color: "purple",
                    categoryName: "Peptide cycle",
                    categoryId: null,
                    eventKind: null,
                    href: `/health/peptides/${p.id}`,
                    editable: false,
                    done: false,
                    meta: { peptideColor: color },
                });
            }
            if (cycleEnd >= windowStart && cycleEnd <= windowEnd) {
                peptideItems.push({
                    id: `pep-cycle-end-${p.id}`,
                    kind: "overlay",
                    source: "peptide",
                    title: `${p.name} Cycle Ends`,
                    startsAt: cycleEnd.toISOString(),
                    endsAt: null,
                    allDay: true,
                    color: "purple",
                    categoryName: "Peptide cycle",
                    categoryId: null,
                    eventKind: null,
                    href: `/health/peptides/${p.id}`,
                    editable: false,
                    done: false,
                    meta: { peptideColor: color },
                });
            }
        }

        for (const occ of schedule) {
            const when = new Date(`${occ.date}T12:00:00.000Z`);
            if (when < windowStart || when > windowEnd) continue;
            const taken = isOccurrenceTaken(p, occ);
            peptideItems.push({
                id: `pep-${p.id}-${occ.date}`,
                kind: "overlay",
                source: "peptide",
                title: `${p.name} · ${occ.dose}${p.doseUnit} (${occ.units}u)`,
                startsAt: when.toISOString(),
                endsAt: null,
                allDay: true,
                color: "purple",
                categoryName: "Peptide dose",
                categoryId: null,
                eventKind: null,
                href: `/health/peptides/${p.id}`,
                editable: false,
                done: taken,
                meta: { peptideColor: color, peptideTaken: taken, peptideId: p.id, peptideDate: occ.date },
            });
        }
    });

    // Panel-friendly todo list (with status + scheduling) keyed by yyyy-MM-dd (local day).
    const todoItems = todos.map((t) => {
        const day = t.date ?? t.createdAt;
        return {
            id: t.id,
            title: t.title,
            status: t.status,
            day: new Date(day).toISOString(),
            dueAt: t.dueAt?.toISOString() ?? null,
            timeOfDay: t.timeOfDay ?? null,
            startTime: t.startTime ?? null,
            durationMinutes: t.durationMinutes ?? null,
        };
    });

    // ── Nutrition per-day summaries ──────────────────────────
    const goalCalories = nutritionGoal?.calories ?? null;
    const nutrition: NutritionDaySummary[] = nutritionDays
        .map((d): NutritionDaySummary => {
            let calories = 0;
            for (const m of d.meals) for (const e of m.entries) calories += e.calories ?? 0;
            // `@db.Date` columns are stored at UTC midnight; read the calendar day from UTC.
            return { day: d.date.toISOString().slice(0, 10), calories, mealCount: d.meals.length, goal: goalCalories };
        })
        // Only surface days that actually have logged calories/meals.
        .filter((n) => n.calories > 0 || n.mealCount > 0);

    // ── Transactions: per-day rollup + individual rows ───────
    const txnByDay = new Map<string, { count: number; net: number }>();
    const transactionRows: TxnEntry[] = finTransactions.map((t) => {
        const day = t.date.toISOString().slice(0, 10);
        const amount = Number(t.amount);
        const agg = txnByDay.get(day) ?? { count: 0, net: 0 };
        agg.count += 1;
        agg.net += amount;
        txnByDay.set(day, agg);
        return { id: t.id, day, merchant: t.merchant || t.rawDescription || "Transaction", amount };
    });
    const transactions: TxnDaySummary[] = [...txnByDay.entries()].map(([day, v]) => ({ day, count: v.count, net: v.net }));

    return (
        <CalendarClient
            items={[...eventItems, ...overlayItems, ...peptideItems]}
            todos={todoItems}
            nutrition={nutrition}
            transactions={transactions}
            transactionRows={transactionRows}
            categories={categories.map((c) => ({ id: c.id, name: c.name, color: c.color, icon: c.icon }))}
            contacts={contacts}
            providers={providers}
            doctors={doctors}
        />
    );
}
