import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Activity, Calendar, Camera01, CheckCircle, ChevronDown, Edit01, PauseCircle, PlayCircle, Plus, RefreshCw01, SearchLg, SkipForward, Trash01, XClose } from "@untitledui/icons";
import { BadgeWithDot } from "@/components/base/badges/badges";
import { RichSelect } from "@/components/base/select/rich-select";
import type { NavTarget } from "../nav";
import {
    EmptyMessage,
    PersonalCard,
    PersonalModuleShell,
    PersonalTable,
    QueryBoundary,
    StatGrid,
    titleCase,
} from "./personal/personal-ui";
import { useLifeOSQuery, type LifeOSClient } from "./personal/use-lifeos-query";
import { resolveExerciseImage } from "./workouts/exercises/_components/resolve-image";
import { BodyCompositionCharts, ProgressWeightChart, ScheduleAdherenceChart, TrainingOverviewCharts } from "./workouts/_components/workout-dashboard-charts";
import { templateExercisePrescription } from "./workouts/workout-presentation";

const WORKOUT_TABS = [
    { id: "overview", label: "Overview" },
    { id: "log", label: "Log" },
    { id: "schedule", label: "Schedule" },
    { id: "exercises", label: "Exercises" },
    { id: "templates", label: "Templates" },
    { id: "body", label: "Body" },
    { id: "progress", label: "Progress" },
] as const;

type WorkoutTab = (typeof WORKOUT_TABS)[number]["id"];
type UnitSystem = "IMPERIAL" | "METRIC";
type WorkoutLifecycleStatus = "completed" | "in_progress" | "paused" | "needs_review" | "logged";
type WorkoutEditableStatus = "completed" | "in_progress" | "logged";

const COMMANDS: Record<WorkoutTab, string> = {
    overview: "workouts:getOverview",
    log: "workouts:getLog",
    schedule: "workouts:getSchedule",
    exercises: "workouts:getExercises",
    templates: "workouts:getTemplates",
    body: "workouts:getBody",
    progress: "workouts:getProgress",
};

interface WorkoutRow {
    id: string;
    name: string;
    note: string | null;
    date: string;
    startedAt: string | null;
    endedAt: string | null;
    pausedAt: string | null;
    pausedMs: number;
    status: WorkoutLifecycleStatus;
    /** Authoritative server duration for a closed workout, after paused time is removed. */
    durationSeconds: number | null;
    /** Authoritative elapsed duration at query time for an open workout. */
    elapsedSeconds: number | null;
    durationMinutes: number | null;
    rpe: number | null;
    templateId: string | null;
    templateName: string | null;
    exerciseCount: number;
    exerciseIds: string[];
    exerciseNames: string[];
    workoutExerciseIds: string[];
    exercises?: Array<{
        id: string;
        exerciseId: string;
        name: string;
        note: string | null;
        restSec: number | null;
        tempo: string | null;
        groupKey: string | null;
        sets: Array<{ order: number; weight: number | null; reps: number | null; seconds: number | null; meters: number | null; rpe: number | null; restTakenSec: number | null; targetWeight: number | null; targetReps: number | null; targetSeconds: number | null; targetMeters: number | null; targetRpe: number | null; warmup: boolean; isAmrap: boolean; completed: boolean }>;
    }>;
    completedSets: number;
    workingSets: number;
    volume: number;
}

interface ScheduleRow {
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

interface RecordRow {
    id: string;
    exerciseId: string;
    exerciseName: string;
    recordType: string;
    displayValue: number;
    displayUnit: string;
    achievedOn: string;
    notes: string | null;
}

interface WeeklyRow {
    week: string;
    workouts: number;
    workingSets: number;
    volume: number;
}

interface CycleRow {
    id: string;
    phase: string;
    startDate: string;
    endDate: string | null;
    note: string | null;
    day: number;
    status: "upcoming" | "active" | "completed";
}

interface OverviewData {
    unitSystem: UnitSystem;
    weightUnit: string;
    summary: {
        workoutsThisWeek: number;
        workoutsWeekDelta: number | null;
        volumeThisWeek: number;
        volumeWeekDelta: number | null;
        recentRecordCount: number;
        activeCycle: CycleRow | null;
        templateCount: number;
        adherence30: number | null;
    };
    recentWorkouts: WorkoutRow[];
    todaySchedule: ScheduleRow[];
    upcomingSchedule: ScheduleRow[];
    recentRecords: RecordRow[];
    weeklyTraining: WeeklyRow[];
    muscleBalance: Array<{ muscle: string; sets: number }>;
}

interface LogData {
    unitSystem: UnitSystem;
    weightUnit: string;
    summary: {
        totalSessions: number;
        sessionsLast30Days: number;
        completedSetsLast30Days: number;
        volumeLast30Days: number;
        averageDurationMinutes: number | null;
    };
    workouts: WorkoutRow[];
    templates: Array<{ id: string; name: string }>;
    exerciseOptions: Array<{
        id: string;
        name: string;
        lastPerformedOn: string | null;
        lastWorkoutName: string | null;
        previousSets: Array<{ weight: number | null; reps: number | null; seconds: number | null; meters: number | null }>;
        records: RecordRow[];
    }>;
}

interface ScheduleData {
    summary: {
        plannedNext7Days: number;
        completedLast30Days: number;
        missedLast30Days: number;
        adherence30: number | null;
    };
    plans: ScheduleRow[];
    templates: Array<{ id: string; name: string }>;
}

interface ExerciseRow {
    id: string;
    slug: string;
    name: string;
    muscles: string[];
    equipment: string[];
    level: string | null;
    category: string | null;
    notes: string | null;
    instructions?: string | null;
    images: string[];
    mediaKey: string | null;
    mediaUrl: string | null;
    imageUrl: string | null;
    custom: boolean;
    tracksReps: boolean;
    tracksWeight: boolean;
    tracksTime: boolean;
    tracksDistance: boolean;
    useCount: number;
    records: RecordRow[];
    lastPerformedOn: string | null;
    lastWorkoutName: string | null;
    previousSets: Array<{ weight: number | null; reps: number | null; seconds: number | null; meters: number | null }>;
}

interface ExercisesData {
    unitSystem: UnitSystem;
    weightUnit: string;
    summary: { total: number; custom: number; used: number; withRecords: number };
    exercises: ExerciseRow[];
}

interface TemplateRow {
    id: string;
    name: string;
    note: string | null;
    progression: string;
    cycleWeek: number | null;
    exerciseCount: number;
    totalSets: number;
    estimatedMinutes: number;
    lastUsedOn: string | null;
    updatedAt: string;
    exercises: Array<{
        id: string;
        exerciseId: string;
        exerciseName: string;
        exerciseSlug: string;
        targetSets: number | null;
        targetReps: number | null;
        targetRepsMin: number | null;
        targetRepsMax: number | null;
        targetWeight: number | null;
        targetTimeSec: number | null;
        targetDistanceM: number | null;
        targetRpe: number | null;
        restSec: number | null;
        groupKey: string | null;
        tempo: string | null;
        note: string | null;
    }>;
}

interface TemplatesData {
    unitSystem: UnitSystem;
    weightUnit: string;
    summary: { total: number; withProgression: number; totalExercises: number; used: number };
    templates: TemplateRow[];
    exerciseOptions: Array<{ id: string; name: string }>;
}

interface MeasurementRow {
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

interface BodyRecordRow {
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

interface BodyData {
    unitSystem: UnitSystem;
    weightUnit: string;
    summary: {
        latestWeight: number | null;
        weightChange: number | null;
        latestBodyFatPct: number | null;
        bodyFatChange: number | null;
        measurementCount: number;
        activeCycle: CycleRow | null;
    };
    measurements: MeasurementRow[];
    cycles: CycleRow[];
    records: BodyRecordRow[];
    weeklyTraining: WeeklyRow[];
    muscleBalance: Array<{ muscle: string; sets: number }>;
}

interface ProgressPhotoRow {
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

interface ProgressData {
    unitSystem: UnitSystem;
    weightUnit: string;
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

type WorkoutsPayload = OverviewData | LogData | ScheduleData | ExercisesData | TemplatesData | BodyData | ProgressData;

interface WorkoutMutationControls {
    run: (type: string, payload: Record<string, unknown>) => Promise<boolean>;
    runWithResult: <Result>(type: string, payload: Record<string, unknown>) => Promise<Result | null>;
    pending: boolean;
    error: string | null;
    clearError: () => void;
}

type ModuleAction =
    | { tab: "log"; nonce: number; workoutId?: string }
    | { tab: "schedule"; nonce: number; scheduleId?: string }
    | null;

export interface WorkoutsViewProps {
    client: LifeOSClient;
    onNavigate: (target: NavTarget | ((previous: NavTarget) => NavTarget)) => void;
    state?: unknown;
    actions?: unknown;
}

export function WorkoutsView({ client }: WorkoutsViewProps) {
    const [activeTab, setActiveTab] = useState<WorkoutTab>("overview");
    const [moduleAction, setModuleAction] = useState<ModuleAction>(null);
    const query = useLifeOSQuery<WorkoutsPayload>(client, COMMANDS[activeTab]);
    const mutation = useWorkoutMutation(client);
    const mutateAndRefresh = useMemo<WorkoutMutationControls>(
        () => ({
            ...mutation,
            run: async (type, payload) => {
                const changed = await mutation.run(type, payload);
                if (changed) query.refresh();
                return changed;
            },
            runWithResult: async <Result,>(type: string, payload: Record<string, unknown>) => {
                const result = await mutation.runWithResult<Result>(type, payload);
                if (result !== null) query.refresh();
                return result;
            },
        }),
        [mutation, query.refresh],
    );

    const openModuleAction = (tab: "log" | "schedule") => {
        setActiveTab(tab);
        setModuleAction({ tab, nonce: Date.now() });
    };
    const openLog = (workoutId?: string) => {
        setActiveTab("log");
        setModuleAction(workoutId ? { tab: "log", nonce: Date.now(), workoutId } : null);
    };
    const openSchedule = (openEditor = false, scheduleId?: string) => {
        setActiveTab("schedule");
        setModuleAction(openEditor ? { tab: "schedule", nonce: Date.now(), scheduleId } : null);
    };

    return (
        <PersonalModuleShell
            title="Workouts"
            description="Plan sessions, log training, and follow your strength and body progress."
            icon={Activity}
            tabs={WORKOUT_TABS.map(({ id, label }) => ({ id, label }))}
            activeTab={activeTab}
            onTabChange={(tab) => {
                setModuleAction(null);
                setActiveTab(tab as WorkoutTab);
            }}
            hero={{
                gradient: "linear-gradient(120deg, #ea580c 0%, #dc2626 50%, #db2777 100%)",
                eyebrow: "Training",
                actions: [
                    { label: "Log workout", icon: Plus, variant: "primary", onClick: () => openModuleAction("log") },
                    { label: "Schedule session", icon: Calendar, onClick: () => openModuleAction("schedule") },
                ],
            }}
        >
            {mutation.error && <MutationError error={mutation.error} onDismiss={mutation.clearError} />}
            <QueryBoundary loading={query.loading} error={query.error} onRetry={query.refresh}>
                {query.data ? <TabContent tab={activeTab} data={query.data} mutation={mutateAndRefresh} onOpenLog={openLog} onOpenSchedule={openSchedule} moduleAction={moduleAction} /> : null}
            </QueryBoundary>
        </PersonalModuleShell>
    );
}

function TabContent({ tab, data, mutation, onOpenLog, onOpenSchedule, moduleAction }: { tab: WorkoutTab; data: WorkoutsPayload; mutation: WorkoutMutationControls; onOpenLog: (workoutId?: string) => void; onOpenSchedule: (openEditor?: boolean, scheduleId?: string) => void; moduleAction: ModuleAction }) {
    switch (tab) {
        case "overview":
            return <OverviewSection data={data as OverviewData} mutation={mutation} onOpenLog={onOpenLog} onOpenSchedule={onOpenSchedule} />;
        case "log":
            return <LogSection data={data as LogData} mutation={mutation} openEditorSignal={moduleAction?.tab === "log" ? moduleAction.nonce : 0} targetWorkoutId={moduleAction?.tab === "log" ? moduleAction.workoutId : undefined} />;
        case "schedule":
            return <ScheduleSection data={data as ScheduleData} mutation={mutation} onOpenLog={onOpenLog} openEditorSignal={moduleAction?.tab === "schedule" ? moduleAction.nonce : 0} targetScheduleId={moduleAction?.tab === "schedule" ? moduleAction.scheduleId : undefined} />;
        case "exercises":
            return <ExercisesSection data={data as ExercisesData} mutation={mutation} />;
        case "templates":
            return <TemplatesSection data={data as TemplatesData} mutation={mutation} onOpenLog={onOpenLog} />;
        case "body":
            return <BodySection data={data as BodyData} mutation={mutation} />;
        case "progress":
            return <ProgressSection data={data as ProgressData} mutation={mutation} />;
    }
}

function useWorkoutMutation(client: LifeOSClient): WorkoutMutationControls {
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const runWithResult = useCallback(
        <Result,>(type: string, payload: Record<string, unknown>) =>
            new Promise<Result | null>((resolve) => {
                const requestId = `workout_mutation_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                let settled = false;
                const finish = (result: Result | null, message?: string) => {
                    if (settled) return;
                    settled = true;
                    window.clearTimeout(timeout);
                    client.offMessage(onMessage);
                    setPending(false);
                    setError(message ?? null);
                    resolve(result);
                };
                const onMessage = (message: any) => {
                    if (!message || message.type !== type || message.requestId !== requestId) return;
                    finish(message.error ? null : (message.result as Result), message.error ? String(message.error) : undefined);
                };
                const timeout = window.setTimeout(() => finish(null, "The local Coretex service did not answer this change."), 15_000);
                setPending(true);
                setError(null);
                client.onMessage(onMessage);
                if (!client.send({ type, requestId, payload })) finish(null, "The Coretex service is offline. Start the local Brain and try again.");
            }),
        [client],
    );
    const run = useCallback(
        (type: string, payload: Record<string, unknown>) =>
            runWithResult<unknown>(type, payload).then((result) => result !== null),
        [runWithResult],
    );
    const clearError = useCallback(() => setError(null), []);
    return useMemo(() => ({ run, runWithResult, pending, error, clearError }), [run, runWithResult, pending, error, clearError]);
}

function MutationError({ error, onDismiss }: { error: string; onDismiss: () => void }) {
    return (
        <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-error_subtle bg-error-primary px-4 py-3 text-sm text-error-primary">
            <span className="min-w-0 break-words">{error}</span>
            <button type="button" onClick={onDismiss} className="shrink-0 font-semibold">Dismiss</button>
        </div>
    );
}

function OverviewSection({ data, mutation, onOpenLog, onOpenSchedule }: { data: OverviewData; mutation: WorkoutMutationControls; onOpenLog: (workoutId?: string) => void; onOpenSchedule: (openEditor?: boolean, scheduleId?: string) => void }) {
    const cycle = data.summary.activeCycle;
    const todayPlans = data.todaySchedule;
    return (
        <div className="flex flex-col gap-5">
            <TodayScheduleCard
                plans={todayPlans}
                onSchedule={() => onOpenSchedule(todayPlans.length === 0)}
                emptyMessage="Rest day — no workout is scheduled. Add one from your templates if plans change."
                scheduleLabel={todayPlans.length ? "Open schedule" : "Plan today"}
                pending={mutation.pending}
                onEdit={(plan) => onOpenSchedule(true, plan.id)}
                onStart={async (plan) => {
                    const result = await mutation.runWithResult<{ workoutId: string }>("workouts:startScheduledWorkout", { scheduleId: plan.id });
                    if (result) onOpenLog(result.workoutId);
                }}
                onSkip={async (plan) => { await mutation.run("workouts:setScheduleSkipped", { scheduleId: plan.id, skipped: !plan.skipped }); }}
                onOpenWorkout={(plan) => onOpenLog(plan.workoutId ?? undefined)}
            />
            <StatGrid
                stats={[
                    {
                        label: "Workouts this week",
                        value: formatNumber(data.summary.workoutsThisWeek),
                        detail: deltaText(data.summary.workoutsWeekDelta, "session", "vs. last week"),
                    },
                    {
                        label: "Volume this week",
                        value: `${formatNumber(data.summary.volumeThisWeek)} ${data.weightUnit}`,
                        detail: deltaText(data.summary.volumeWeekDelta, data.weightUnit, "vs. last week"),
                    },
                    {
                        label: "30-day adherence",
                        value: data.summary.adherence30 === null ? "—" : `${data.summary.adherence30}%`,
                        detail: "Completed scheduled sessions",
                    },
                    {
                        label: "Recent records",
                        value: formatNumber(data.summary.recentRecordCount),
                        detail: `${data.summary.templateCount} active template${data.summary.templateCount === 1 ? "" : "s"}`,
                    },
                ]}
            />

            {cycle && (
                <PersonalCard>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <p className="text-sm font-semibold text-primary">Active {titleCase(cycle.phase)} cycle</p>
                            <p className="mt-1 text-xs text-tertiary">
                                Day {cycle.day} · started {dateLabel(cycle.startDate)}
                                {cycle.endDate ? ` · ends ${dateLabel(cycle.endDate)}` : ""}
                            </p>
                        </div>
                        <StatusBadge status={cycle.status} />
                    </div>
                </PersonalCard>
            )}

            <TrainingOverviewCharts weeklyTraining={data.weeklyTraining} muscleBalance={data.muscleBalance} weightUnit={data.weightUnit} />

            <RecentWorkoutsCard workouts={data.recentWorkouts} weightUnit={data.weightUnit} onOpenLog={onOpenLog} />

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                <PersonalCard title="Coming up">
                    <ScheduleTable plans={data.upcomingSchedule} empty="No upcoming sessions are scheduled." compact />
                </PersonalCard>
                <PersonalCard title="Recent personal records">
                    <PersonalTable
                        rows={data.recentRecords}
                        empty="Complete a working set in a finished workout to begin tracking personal records."
                        columns={[
                            {
                                key: "exercise",
                                label: "Exercise",
                                render: (row) => (
                                    <span data-exercise-id={row.exerciseId} className="font-medium text-primary">
                                        {row.exerciseName}
                                    </span>
                                ),
                            },
                            { key: "record", label: "Record", render: (row) => recordTypeLabel(row.recordType) },
                            { key: "value", label: "Best", align: "right", render: (row) => recordValue(row) },
                            { key: "date", label: "Date", align: "right", render: (row) => dateLabel(row.achievedOn) },
                        ]}
                    />
                </PersonalCard>
            </div>
        </div>
    );
}

function LogSection({ data, mutation, openEditorSignal = 0, targetWorkoutId }: { data: LogData; mutation: WorkoutMutationControls; openEditorSignal?: number; targetWorkoutId?: string }) {
    const [editorOpen, setEditorOpen] = useState(false);
    const [editing, setEditing] = useState<WorkoutRow | null>(null);
    const [filter, setFilter] = useState<"all" | "open" | "completed" | "logged">("all");
    const [search, setSearch] = useState("");
    const openNew = () => { setEditing(null); setEditorOpen(true); };
    const openEdit = (workout: WorkoutRow) => { setEditing(workout); setEditorOpen(true); };
    useEffect(() => {
        if (!openEditorSignal) return;
        if (targetWorkoutId) {
            const workout = data.workouts.find((row) => row.id === targetWorkoutId);
            if (workout) openEdit(workout);
            return;
        }
        openNew();
    }, [openEditorSignal]);
    const normalizedSearch = search.trim().toLowerCase();
    const filteredWorkouts = useMemo(
        () => data.workouts.filter((workout) => {
            if (filter === "open" && !isOpenWorkout(workout)) return false;
            if (filter !== "all" && filter !== "open" && workout.status !== filter) return false;
            if (!normalizedSearch) return true;
            return [workout.name, workout.note ?? "", workout.templateName ?? "", ...workout.exerciseNames].join(" ").toLowerCase().includes(normalizedSearch);
        }),
        [data.workouts, filter, normalizedSearch],
    );
    const currentWorkouts = data.workouts.filter(isOpenWorkout);
    const finishWorkout = async (workout: WorkoutRow) => {
        await mutation.run("workouts:finishWorkout", { workoutId: workout.id });
    };
    const setWorkoutPaused = async (workout: WorkoutRow, paused: boolean) => {
        await mutation.run("workouts:setWorkoutPaused", { workoutId: workout.id, paused });
    };
    const restartWorkout = async (workout: WorkoutRow) => {
        if (!window.confirm(`Restart the timer for ${workout.name} now? The existing stale timer will be reset, but logged exercises and sets will be kept.`)) return;
        await mutation.run("workouts:restartWorkout", { workoutId: workout.id });
    };
    return (
        <div className="flex flex-col gap-5">
            <StatGrid
                stats={[
                    { label: "All sessions", value: formatNumber(data.summary.totalSessions), detail: `${data.workouts.length} most recent loaded` },
                    { label: "Last 30 days", value: formatNumber(data.summary.sessionsLast30Days), detail: `${data.summary.completedSetsLast30Days} completed sets` },
                    { label: "30-day volume", value: `${formatNumber(data.summary.volumeLast30Days)} ${data.weightUnit}`, detail: "Completed weighted sets" },
                    { label: "Average duration", value: formatDuration(data.summary.averageDurationMinutes), detail: `${data.templates.length} templates available` },
                ]}
            />
            {editorOpen && <WorkoutEditor key={editing?.id ?? "new"} workout={editing} data={data} mutation={mutation} onClose={() => { setEditorOpen(false); setEditing(null); }} />}
            {currentWorkouts.length > 0 && (
                <PersonalCard title={`Open ${currentWorkouts.length === 1 ? "workout" : "workouts"}`}>
                    <div className="grid gap-3 lg:grid-cols-2">
                        {currentWorkouts.map((workout) => {
                            const lifecycleStatus = workoutDisplayStatus(workout);
                            const needsReview = lifecycleStatus === "needs_review";
                            const paused = lifecycleStatus === "paused";
                            return (
                                <div key={workout.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 ${needsReview ? "border-error_subtle bg-error-primary" : paused ? "border-brand bg-brand-primary_alt" : "border-warning_subtle bg-warning-primary"}`}>
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2"><StatusBadge status={lifecycleStatus} /><p className="truncate text-sm font-semibold text-primary">{workout.name}</p></div>
                                        <p className="mt-1 text-xs text-tertiary">Started {dateTimeLabel(workout.startedAt)} · <LiveWorkoutDuration workout={workout} /></p>
                                    </div>
                                    <div className="flex flex-wrap items-center justify-end gap-2">
                                        {needsReview ? (
                                            <button type="button" disabled={mutation.pending} onClick={() => void restartWorkout(workout)} className="inline-flex items-center gap-1.5 rounded-lg border border-secondary bg-primary px-3 py-2 text-xs font-semibold text-secondary hover:bg-primary_hover disabled:opacity-50"><RefreshCw01 className="size-3.5" />Restart timer</button>
                                        ) : (
                                            <button type="button" disabled={mutation.pending} onClick={() => void setWorkoutPaused(workout, !paused)} className="inline-flex items-center gap-1.5 rounded-lg border border-secondary bg-primary px-3 py-2 text-xs font-semibold text-secondary hover:bg-primary_hover disabled:opacity-50">{paused ? <PlayCircle className="size-3.5" /> : <PauseCircle className="size-3.5" />}{paused ? "Resume timer" : "Pause"}</button>
                                        )}
                                        <button type="button" onClick={() => openEdit(workout)} className="inline-flex items-center gap-1.5 rounded-lg border border-secondary bg-primary px-3 py-2 text-xs font-semibold text-secondary hover:bg-primary_hover"><Edit01 className="size-3.5" />{needsReview ? "Review details" : "Open session"}</button>
                                        {!needsReview && <button type="button" disabled={mutation.pending} onClick={() => void finishWorkout(workout)} className="inline-flex items-center gap-1.5 rounded-lg bg-success-solid px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><CheckCircle className="size-3.5" />Finish</button>}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </PersonalCard>
            )}
            <PersonalCard
                title="Workout history"
                action={<ActionButton onClick={openNew} disabled={mutation.pending}>Start or log workout</ActionButton>}
            >
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="inline-flex max-w-full overflow-x-auto rounded-lg border border-secondary bg-primary p-0.5" aria-label="Filter workout history">
                        {(["all", "open", "completed", "logged"] as const).map((status) => <button key={status} type="button" onClick={() => setFilter(status)} className={`rounded-md px-2.5 py-1.5 text-xs font-semibold ${filter === status ? "bg-secondary text-primary" : "text-tertiary hover:text-secondary"}`}>{status === "all" ? "All" : titleCase(status)}</button>)}
                    </div>
                    <label className="relative block min-w-0 sm:w-64"><SearchLg className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-quaternary" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search workout history" className={`${fieldClass} pl-9`} /></label>
                </div>
                <WorkoutTable
                    workouts={filteredWorkouts}
                    weightUnit={data.weightUnit}
                    empty={filter !== "all" || normalizedSearch ? "No workouts match these filters." : "Your workout history will appear here after the first logged session."}
                    pending={mutation.pending}
                    onEdit={openEdit}
                    onFinish={finishWorkout}
                    onPause={setWorkoutPaused}
                    onRestart={restartWorkout}
                    onDelete={async (workout) => {
                        if (window.confirm(`Delete ${workout.name} from ${dateLabel(workout.date)}?`)) {
                            await mutation.run("workouts:deleteWorkout", { workoutId: workout.id });
                        }
                    }}
                />
            </PersonalCard>
        </div>
    );
}

type WorkoutSetDraft = { id: string; weight: string; reps: string; seconds: string; meters: string; rpe: string; restTakenSec: number | null; targetWeight: number | null; targetReps: number | null; targetSeconds: number | null; targetMeters: number | null; targetRpe: number | null; warmup: boolean; isAmrap: boolean; completed: boolean };
type WorkoutExerciseDraft = { id: string; exerciseId: string; name: string; note: string; restSec: string; tempo: string; groupKey: string; sets: WorkoutSetDraft[] };

const fieldClass = "w-full rounded-lg border border-secondary bg-primary px-3 py-2 text-sm text-primary outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20";
const fieldLabel = "flex flex-col gap-1.5 text-xs font-medium text-secondary";
const draftId = () => Math.random().toString(36).slice(2, 10);
const emptySet = (): WorkoutSetDraft => ({ id: draftId(), weight: "", reps: "", seconds: "", meters: "", rpe: "", restTakenSec: null, targetWeight: null, targetReps: null, targetSeconds: null, targetMeters: null, targetRpe: null, warmup: false, isAmrap: false, completed: false });

function WorkoutEditor({ workout, data, mutation, onClose }: { workout: WorkoutRow | null; data: LogData; mutation: WorkoutMutationControls; onClose: () => void }) {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60_000);
    const lifecycleStatus = workout ? workoutDisplayStatus(workout) : null;
    const initialStatus: WorkoutEditableStatus = workout?.status === "completed" || workout?.status === "logged" ? workout.status : "in_progress";
    const initialStartedAt = dateTimeValue(workout?.startedAt ?? (initialStatus === "completed" ? oneHourAgo : now).toISOString());
    const [name, setName] = useState(workout?.name ?? "Workout");
    const [date, setDate] = useState(workout?.date ?? todayValue());
    const [status, setStatus] = useState<WorkoutEditableStatus>(initialStatus);
    const [startedAt, setStartedAt] = useState(initialStartedAt);
    const [endedAt, setEndedAt] = useState(dateTimeValue(workout?.endedAt ?? now.toISOString()));
    const [rpe, setRpe] = useState(workout?.rpe == null ? "" : String(workout.rpe));
    const [note, setNote] = useState(workout?.note ?? "");
    const [templateId, setTemplateId] = useState(workout?.templateId ?? "");
    const [exerciseId, setExerciseId] = useState("");
    const [exercises, setExercises] = useState<WorkoutExerciseDraft[]>(() => (workout?.exercises ?? []).map((exercise) => ({
        id: exercise.id,
        exerciseId: exercise.exerciseId,
        name: exercise.name,
        note: exercise.note ?? "",
        restSec: exercise.restSec == null ? "" : String(exercise.restSec),
        tempo: exercise.tempo ?? "",
        groupKey: exercise.groupKey ?? "",
        sets: exercise.sets.map((set) => ({ id: `${exercise.id}-${set.order}`, weight: set.weight == null ? "" : String(set.weight), reps: set.reps == null ? "" : String(set.reps), seconds: set.seconds == null ? "" : String(set.seconds), meters: set.meters == null ? "" : String(set.meters), rpe: set.rpe == null ? "" : String(set.rpe), restTakenSec: set.restTakenSec, targetWeight: set.targetWeight, targetReps: set.targetReps, targetSeconds: set.targetSeconds, targetMeters: set.targetMeters, targetRpe: set.targetRpe, warmup: set.warmup, isAmrap: set.isAmrap, completed: set.completed })),
    })));
    const selectedOption = data.exerciseOptions.find((option) => option.id === exerciseId);

    const addExercise = () => {
        if (!selectedOption) return;
        setExercises((current) => [...current, { id: draftId(), exerciseId: selectedOption.id, name: selectedOption.name, note: "", restSec: "", tempo: "", groupKey: "", sets: [emptySet()] }]);
        setExerciseId("");
    };
    const updateExercise = (exerciseKey: string, patch: Partial<WorkoutExerciseDraft>) => setExercises((current) => current.map((exercise) => exercise.id === exerciseKey ? { ...exercise, ...patch } : exercise));
    const updateSet = (exerciseKey: string, setKey: string, patch: Partial<WorkoutSetDraft>) => setExercises((current) => current.map((exercise) => exercise.id === exerciseKey ? { ...exercise, sets: exercise.sets.map((set) => set.id === setKey ? { ...set, ...patch } : set) } : exercise));
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const payload = {
            ...(workout ? { workoutId: workout.id } : {}),
            name,
            date,
            status,
            startedAt: status === "logged" ? null : startedAt || null,
            endedAt: status === "completed" ? endedAt || null : null,
            ...(workout && (lifecycleStatus === "paused" || lifecycleStatus === "in_progress") && status === "in_progress" && date === workout.date && startedAt === initialStartedAt ? { preserveLifecycle: true } : {}),
            rpe: numberOrNull(rpe),
            note,
            ...(!workout ? { templateId: exercises.length === 0 ? templateId || null : null } : {}),
            weightUnit: data.weightUnit,
            exercises: exercises.map((exercise) => ({ exerciseId: exercise.exerciseId, note: exercise.note, restSec: numberOrNull(exercise.restSec), tempo: exercise.tempo || null, groupKey: exercise.groupKey || null, sets: exercise.sets.map((set) => ({ weight: numberOrNull(set.weight), reps: numberOrNull(set.reps), seconds: numberOrNull(set.seconds), meters: numberOrNull(set.meters), rpe: numberOrNull(set.rpe), restTakenSec: set.restTakenSec, targetWeight: set.targetWeight, targetReps: set.targetReps, targetSeconds: set.targetSeconds, targetMeters: set.targetMeters, targetRpe: set.targetRpe, warmup: set.warmup, isAmrap: set.isAmrap, completed: set.completed })) })),
        };
        const ok = await mutation.run(workout ? "workouts:updateWorkout" : "workouts:logWorkout", payload);
        if (ok) onClose();
    };
    return (
        <PersonalCard title={workout ? "Edit workout" : "Log a workout"} action={<button type="button" className="inline-flex items-center gap-1.5 rounded-lg border border-secondary px-3 py-2 text-sm font-semibold text-secondary hover:bg-secondary" onClick={onClose}><XClose className="size-4" />Close</button>}>
            <form onSubmit={submit} className="space-y-5">
                {lifecycleStatus === "paused" && <div className="rounded-xl border border-brand bg-brand-primary_alt px-4 py-3 text-sm text-secondary"><span className="font-semibold text-primary">This timer is paused.</span> Saving exercise details keeps the session paused; use Resume from the workout card when you are ready.</div>}
                {lifecycleStatus === "needs_review" && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-error_subtle bg-error-primary px-4 py-3 text-sm text-secondary"><div><p className="font-semibold text-error-primary">This session has been open for more than 24 hours.</p><p className="mt-0.5 text-xs text-tertiary">Correct the start and finish times, mark it logged, or reset the timer before saving it as in progress.</p></div><button type="button" onClick={() => { const resetAt = new Date(); const resetDate = todayValue(); setDate(resetDate); setStartedAt(dateTimeValue(resetAt.toISOString())); setEndedAt(""); setStatus("in_progress"); }} className="rounded-lg border border-secondary bg-primary px-3 py-2 text-xs font-semibold text-secondary hover:bg-primary_hover">Reset start to now</button></div>}
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <label className={fieldLabel}>Workout name<input className={fieldClass} required value={name} onChange={(event) => setName(event.target.value)} /></label>
                    <label className={fieldLabel}>Date<input className={fieldClass} required type="date" value={date} onChange={(event) => { const next = event.target.value; setDate(next); setStartedAt((value) => moveLocalDateTime(value, next)); setEndedAt((value) => moveLocalDateTime(value, next)); }} /></label>
                    <label className={fieldLabel}>Status<RichSelect aria-label="Workout status" value={status} onChange={(event) => setStatus(event.target.value as WorkoutEditableStatus)} options={[{ value: "completed", label: "Completed" }, { value: "in_progress", label: "In progress" }, { value: "logged", label: "Logged only" }]} /></label>
                    <label className={fieldLabel}>Session RPE<input className={fieldClass} type="number" min="0" max="10" step="0.5" value={rpe} onChange={(event) => setRpe(event.target.value)} /></label>
                    {status !== "logged" && <label className={fieldLabel}>Started<input className={fieldClass} type="datetime-local" value={startedAt} onChange={(event) => setStartedAt(event.target.value)} /></label>}
                    {status === "completed" && <label className={fieldLabel}>Finished<input className={fieldClass} type="datetime-local" value={endedAt} onChange={(event) => setEndedAt(event.target.value)} /></label>}
                    {!workout && <label className={fieldLabel}>Start from template<RichSelect aria-label="Start workout from template" value={templateId} onChange={(event) => { setTemplateId(event.target.value); if (event.target.value) { setStatus("in_progress"); setEndedAt(""); } }} placeholder="No template" options={data.templates.map((template) => ({ value: template.id, label: template.name }))} /></label>}
                    <label className={`${fieldLabel} md:col-span-2`}>Notes<input className={fieldClass} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Session notes, pain, cues, wins…" /></label>
                </div>

                <div className="rounded-xl border border-secondary bg-secondary p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                        <label className={`${fieldLabel} min-w-0 flex-1`}>Add exercise<RichSelect aria-label="Exercise to add" value={exerciseId} onChange={(event) => setExerciseId(event.target.value)} placeholder="Choose from the exercise library" options={data.exerciseOptions.map((exercise) => ({ value: exercise.id, label: exercise.name, supportingText: exercise.lastPerformedOn ? `Last: ${dateLabel(exercise.lastPerformedOn)}` : "Not performed yet" }))} /></label>
                        <button type="button" onClick={addExercise} disabled={!exerciseId} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-secondary bg-primary px-3 py-2 text-sm font-semibold text-secondary hover:bg-primary_hover disabled:opacity-50"><Plus className="size-4" />Add exercise</button>
                    </div>
                    {selectedOption && <PreviousPerformance exercise={selectedOption} weightUnit={data.weightUnit} />}
                </div>

                <div className="space-y-3">
                    {exercises.length === 0 ? <EmptyMessage>{templateId ? "The selected template's exercises will be copied into this workout when you save." : "Add an exercise to log sets, reps, weight, time, or distance."}</EmptyMessage> : exercises.map((exercise) => (
                        <section key={exercise.id} className="rounded-xl border border-secondary bg-primary p-4">
                            <div className="flex items-center justify-between gap-3"><div><h3 className="font-semibold text-primary">{exercise.name}</h3><p className="text-xs text-tertiary">{exercise.sets.length} sets</p></div><button type="button" className="rounded-md p-2 text-error-primary hover:bg-error-secondary" onClick={() => setExercises((current) => current.filter((item) => item.id !== exercise.id))} aria-label={`Remove ${exercise.name}`}><Trash01 className="size-4" /></button></div>
                            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4"><label className={fieldLabel}>Exercise note<input value={exercise.note} onChange={(event) => updateExercise(exercise.id, { note: event.target.value })} className={fieldClass} placeholder="Cues or variation" /></label><label className={fieldLabel}>Rest (sec)<input type="number" min="0" value={exercise.restSec} onChange={(event) => updateExercise(exercise.id, { restSec: event.target.value })} className={fieldClass} /></label><label className={fieldLabel}>Tempo<input value={exercise.tempo} onChange={(event) => updateExercise(exercise.id, { tempo: event.target.value })} className={fieldClass} placeholder="3-1-1-0" /></label><label className={fieldLabel}>Superset group<input value={exercise.groupKey} maxLength={8} onChange={(event) => updateExercise(exercise.id, { groupKey: event.target.value.toUpperCase() })} className={fieldClass} placeholder="A" /></label></div>
                            <div className="mt-3 space-y-2">
                                {exercise.sets.map((set, index) => <div key={set.id} className="grid items-end gap-2 rounded-lg bg-secondary p-2 md:grid-cols-[2rem_repeat(5,minmax(0,1fr))_auto_auto_auto_auto]">
                                    <span className="pb-2 text-center text-xs font-semibold text-tertiary">{index + 1}</span>
                                    <MiniField label={`Weight (${data.weightUnit})`} value={set.weight} placeholder={set.targetWeight == null ? undefined : String(set.targetWeight)} onChange={(value) => updateSet(exercise.id, set.id, { weight: value })} />
                                    <MiniField label="Reps" value={set.reps} placeholder={set.targetReps == null ? undefined : String(set.targetReps)} onChange={(value) => updateSet(exercise.id, set.id, { reps: value })} />
                                    <MiniField label="Seconds" value={set.seconds} placeholder={set.targetSeconds == null ? undefined : String(set.targetSeconds)} onChange={(value) => updateSet(exercise.id, set.id, { seconds: value })} />
                                    <MiniField label="Meters" value={set.meters} placeholder={set.targetMeters == null ? undefined : String(set.targetMeters)} onChange={(value) => updateSet(exercise.id, set.id, { meters: value })} />
                                    <MiniField label="RPE" value={set.rpe} placeholder={set.targetRpe == null ? undefined : String(set.targetRpe)} onChange={(value) => updateSet(exercise.id, set.id, { rpe: value })} />
                                    <label className="flex items-center gap-1.5 pb-2 text-xs text-secondary"><input type="checkbox" checked={set.warmup} onChange={(event) => updateSet(exercise.id, set.id, { warmup: event.target.checked })} />Warm-up</label>
                                    <label className="flex items-center gap-1.5 pb-2 text-xs text-secondary"><input type="checkbox" checked={set.isAmrap} onChange={(event) => updateSet(exercise.id, set.id, { isAmrap: event.target.checked })} />AMRAP</label>
                                    <label className="flex items-center gap-1.5 pb-2 text-xs font-semibold text-secondary"><input type="checkbox" checked={set.completed} onChange={(event) => updateSet(exercise.id, set.id, { completed: event.target.checked })} />Done</label>
                                    <button type="button" className="mb-1 rounded p-1.5 text-error-primary hover:bg-error-secondary" onClick={() => setExercises((current) => current.map((item) => item.id === exercise.id ? { ...item, sets: item.sets.filter((itemSet) => itemSet.id !== set.id) } : item))} aria-label={`Remove set ${index + 1}`}><Trash01 className="size-4" /></button>
                                </div>)}
                            </div>
                            <button type="button" className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-secondary hover:underline" onClick={() => setExercises((current) => current.map((item) => item.id === exercise.id ? { ...item, sets: [...item.sets, emptySet()] } : item))}><Plus className="size-3.5" />Add set</button>
                        </section>
                    ))}
                </div>
                <div className="flex justify-end"><button type="submit" disabled={mutation.pending} className="rounded-lg bg-brand-solid px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-solid_hover disabled:opacity-50">{mutation.pending ? "Saving…" : workout ? "Save changes" : "Save workout"}</button></div>
            </form>
        </PersonalCard>
    );
}

function MiniField({ label, value, placeholder, onChange }: { label: string; value: string; placeholder?: string; onChange: (value: string) => void }) {
    return <label className="flex min-w-0 flex-col gap-1 text-[10px] font-medium text-tertiary">{label}<input className="min-w-0 rounded-md border border-secondary bg-primary px-2 py-1.5 text-xs text-primary outline-none placeholder:text-quaternary focus:border-brand" type="number" min="0" step="any" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>;
}

function PreviousPerformance({ exercise, weightUnit }: { exercise: LogData["exerciseOptions"][number]; weightUnit: string }) {
    const best = exercise.records.find((record) => record.recordType.toLowerCase() === "1rm") ?? exercise.records[0];
    return <div className="mt-3 grid gap-2 rounded-lg border border-secondary bg-primary p-3 text-xs text-tertiary sm:grid-cols-2"><p><span className="font-semibold text-secondary">Previous:</span> {exercise.lastPerformedOn ? `${dateLabel(exercise.lastPerformedOn)}${exercise.lastWorkoutName ? ` · ${exercise.lastWorkoutName}` : ""}` : "No earlier workout"}</p><p><span className="font-semibold text-secondary">Personal best:</span> {best ? `${recordValue(best)} · ${dateLabel(best.achievedOn)}` : "No record yet"}</p>{exercise.previousSets.length > 0 && <p className="sm:col-span-2">Last sets: {exercise.previousSets.map((set, index) => `#${index + 1} ${set.weight != null ? `${formatNumber(set.weight, 1)} ${weightUnit}` : ""}${set.reps != null ? ` × ${set.reps}` : ""}${set.seconds != null ? ` · ${set.seconds}s` : ""}${set.meters != null ? ` · ${set.meters}m` : ""}`).join("; ")}</p>}</div>;
}

function TodayScheduleCard({
    plans,
    onSchedule,
    scheduleLabel = "Schedule today",
    emptyMessage = "Rest day — no workout is scheduled.",
    onEdit,
    onStart,
    onSkip,
    onOpenWorkout,
    pending = false,
}: {
    plans: ScheduleRow[];
    onSchedule: () => void;
    scheduleLabel?: string;
    emptyMessage?: string;
    onEdit?: (plan: ScheduleRow) => void;
    onStart?: (plan: ScheduleRow) => void | Promise<void>;
    onSkip?: (plan: ScheduleRow) => void | Promise<void>;
    onOpenWorkout?: (plan: ScheduleRow) => void;
    pending?: boolean;
}) {
    const today = new Date(`${todayValue()}T12:00:00`);
    const todayLabel = today.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    return (
        <PersonalCard className="border-brand">
            <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-primary_alt text-brand-secondary"><Calendar className="size-5" /></span>
                        <div className="min-w-0">
                            <p className="text-xs font-semibold uppercase tracking-wide text-brand-secondary">Today&apos;s training</p>
                            <h2 className="mt-0.5 break-words text-lg font-semibold text-primary">{todayLabel}</h2>
                            {plans.length === 0 && <p className="mt-1 text-sm text-tertiary">{emptyMessage}</p>}
                        </div>
                    </div>
                    <button type="button" disabled={pending} onClick={onSchedule} className="w-full shrink-0 rounded-lg border border-secondary bg-primary px-3 py-2 text-sm font-semibold text-secondary transition hover:bg-primary_hover disabled:opacity-50 sm:w-auto">{scheduleLabel}</button>
                </div>

                {plans.length > 0 && (
                    <div className="grid gap-2 lg:grid-cols-2">
                        {plans.map((plan) => (
                            <div key={plan.id} data-schedule-id={plan.id} data-template-id={plan.templateId ?? undefined} className="flex min-w-0 flex-col gap-3 rounded-xl border border-secondary bg-secondary p-3 sm:flex-row sm:items-center sm:justify-between">
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <p className="min-w-0 break-words text-sm font-semibold text-primary">{plan.name}</p>
                                        <StatusBadge status={plan.status} />
                                    </div>
                                    {plan.templateName && plan.templateName !== plan.name && <p className="mt-1 break-words text-xs text-tertiary">Template · {plan.templateName}</p>}
                                    {plan.notes && <p className="mt-1 break-words text-xs text-quaternary">{plan.notes}</p>}
                                </div>
                                <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:shrink-0 sm:justify-end">
                                    {plan.workoutId && onOpenWorkout && <button type="button" disabled={pending} onClick={() => onOpenWorkout(plan)} className="rounded-md border border-secondary bg-primary px-2.5 py-1.5 text-xs font-semibold text-brand-secondary hover:bg-primary_hover">View workout</button>}
                                    {!plan.workoutId && plan.status === "planned" && onStart && <button type="button" disabled={pending} onClick={() => void onStart(plan)} className="inline-flex items-center gap-1 rounded-md bg-brand-solid px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-solid_hover"><PlayCircle className="size-3.5" />Start</button>}
                                    {!plan.workoutId && onSkip && <button type="button" disabled={pending} onClick={() => void onSkip(plan)} className="inline-flex items-center gap-1 rounded-md border border-secondary bg-primary px-2.5 py-1.5 text-xs font-semibold text-secondary hover:bg-primary_hover"><SkipForward className="size-3.5" />{plan.skipped ? "Restore" : "Skip today"}</button>}
                                    {!plan.workoutId && onEdit && <button type="button" disabled={pending} onClick={() => onEdit(plan)} className="inline-flex items-center gap-1 rounded-md border border-secondary bg-primary px-2.5 py-1.5 text-xs font-semibold text-secondary hover:bg-primary_hover"><Edit01 className="size-3.5" />Change</button>}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </PersonalCard>
    );
}

function ScheduleSection({ data, mutation, onOpenLog, openEditorSignal = 0, targetScheduleId }: { data: ScheduleData; mutation: WorkoutMutationControls; onOpenLog: (workoutId?: string) => void; openEditorSignal?: number; targetScheduleId?: string }) {
    const [editorOpen, setEditorOpen] = useState(false);
    const [editing, setEditing] = useState<ScheduleRow | null>(null);
    const [editorDate, setEditorDate] = useState(todayValue());
    const [weekOffset, setWeekOffset] = useState(0);
    const openNew = (date = todayValue()) => { setEditing(null); setEditorDate(date); setEditorOpen(true); };
    const openEdit = (plan: ScheduleRow) => { setEditing(plan); setEditorDate(plan.date); setEditorOpen(true); };
    useEffect(() => {
        if (!openEditorSignal) return;
        if (targetScheduleId) {
            const plan = data.plans.find((row) => row.id === targetScheduleId);
            if (plan) {
                openEdit(plan);
                return;
            }
        }
        openNew();
    }, [openEditorSignal, targetScheduleId]);
    const weekDays = useMemo(() => scheduleWeekDays(weekOffset), [weekOffset]);
    const plansByDate = useMemo(() => {
        const grouped = new Map<string, ScheduleRow[]>();
        for (const plan of data.plans) grouped.set(plan.date, [...(grouped.get(plan.date) ?? []), plan]);
        return grouped;
    }, [data.plans]);
    const upcoming = data.plans.filter((plan) => plan.status === "planned").sort((left, right) => left.date.localeCompare(right.date));
    const history = data.plans.filter((plan) => plan.status !== "planned").sort((left, right) => right.date.localeCompare(left.date));
    const todayPlans = data.plans.filter((plan) => plan.date === todayValue()).sort((left, right) => left.name.localeCompare(right.name));
    const startPlan = async (plan: ScheduleRow) => {
        const result = await mutation.runWithResult<{ workoutId: string }>("workouts:startScheduledWorkout", { scheduleId: plan.id });
        if (result) onOpenLog(result.workoutId);
    };
    return (
        <div className="flex flex-col gap-5">
            <TodayScheduleCard
                plans={todayPlans}
                onSchedule={() => openNew(todayValue())}
                scheduleLabel={todayPlans.length ? "Add another" : "Schedule today"}
                pending={mutation.pending}
                onEdit={openEdit}
                onStart={startPlan}
                onSkip={async (plan) => { await mutation.run("workouts:setScheduleSkipped", { scheduleId: plan.id, skipped: !plan.skipped }); }}
                onOpenWorkout={(plan) => onOpenLog(plan.workoutId ?? undefined)}
            />
            <StatGrid
                stats={[
                    { label: "Next 7 days", value: data.summary.plannedNext7Days, detail: "Planned sessions" },
                    { label: "Completed · 30 days", value: data.summary.completedLast30Days, detail: "Scheduled sessions fulfilled" },
                    { label: "Missed · 30 days", value: data.summary.missedLast30Days, detail: "Missed or skipped sessions" },
                    { label: "Adherence · 30 days", value: data.summary.adherence30 === null ? "—" : `${data.summary.adherence30}%`, detail: `${data.templates.length} templates available` },
                ]}
            />
            {editorOpen && <ScheduleEditor key={editing?.id ?? `new-${editorDate}`} plan={editing} initialDate={editorDate} templates={data.templates} mutation={mutation} onClose={() => { setEditorOpen(false); setEditing(null); }} />}
            <PersonalCard
                title="Plan your training week"
                action={<div className="flex items-center gap-1"><button type="button" onClick={() => setWeekOffset((value) => value - 1)} className="rounded-md border border-secondary px-2 py-1 text-sm text-secondary hover:bg-secondary" aria-label="Previous week">‹</button><button type="button" onClick={() => setWeekOffset(0)} className="rounded-md px-2 py-1 text-xs font-semibold text-tertiary hover:bg-secondary">This week</button><button type="button" onClick={() => setWeekOffset((value) => value + 1)} className="rounded-md border border-secondary px-2 py-1 text-sm text-secondary hover:bg-secondary" aria-label="Next week">›</button></div>}
            >
                <div className="overflow-x-auto pb-1">
                    <div className="grid min-w-[46rem] grid-cols-7 gap-2">
                        {weekDays.map((day) => {
                            const date = localDateValue(day);
                            const plans = plansByDate.get(date) ?? [];
                            const today = date === todayValue();
                            return (
                                <div key={date} className={`flex min-w-0 flex-col rounded-xl border p-2 ${today ? "border-brand bg-brand-primary_alt" : "border-secondary bg-primary"}`}>
                                    <button type="button" onClick={() => openNew(date)} aria-label={`Schedule a workout on ${dateLabel(date)}`} className="flex items-center justify-between gap-2 rounded-lg px-1 py-0.5 text-left hover:bg-primary_hover">
                                        <span>
                                            <span className="block text-[10px] font-semibold uppercase tracking-wide text-quaternary">{day.toLocaleDateString(undefined, { weekday: "short" })}</span>
                                            <span className={`mt-1 grid size-7 place-items-center rounded-full text-sm font-semibold ${today ? "bg-brand-solid text-white" : "text-primary"}`}>{day.getDate()}</span>
                                        </span>
                                        <Plus className="size-4 shrink-0 text-quaternary" />
                                    </button>
                                    <div className="mt-2 flex flex-1 flex-col gap-1.5">
                                        {plans.length === 0 ? (
                                            <p className="px-1 py-1 text-[10px] text-quaternary">Rest / open</p>
                                        ) : plans.map((plan) => (
                                            <button key={plan.id} type="button" onClick={() => openEdit(plan)} className="min-w-0 rounded-lg border border-secondary bg-secondary px-2 py-1.5 text-left transition hover:border-brand hover:bg-primary_hover" aria-label={`Change ${plan.name} on ${dateLabel(plan.date)}`}>
                                                <span className="block break-words text-[11px] font-semibold leading-4 text-primary">{plan.name}</span>
                                                <span className={`mt-1 block text-[10px] font-medium ${plan.status === "completed" ? "text-success-primary" : plan.status === "missed" || plan.status === "skipped" ? "text-error-primary" : "text-brand-secondary"}`}>{plan.skipped ? "Skipped · change or restore" : titleCase(plan.status)}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </PersonalCard>
            <ScheduleAdherenceChart plans={data.plans} />
            <PersonalCard
                title="Upcoming workouts"
                action={<ActionButton onClick={() => openNew()} disabled={mutation.pending}>Schedule workout</ActionButton>}
            >
                <ScheduleTable
                    plans={upcoming}
                    empty="No upcoming training sessions are scheduled."
                    pending={mutation.pending}
                    onEdit={openEdit}
                    onStart={startPlan}
                    onSkip={async (plan) => { await mutation.run("workouts:setScheduleSkipped", { scheduleId: plan.id, skipped: !plan.skipped }); }}
                    onDelete={async (plan) => {
                        if (window.confirm(`Delete ${plan.name} from ${dateLabel(plan.date)}?`)) {
                            await mutation.run("workouts:deleteSchedule", { scheduleId: plan.id });
                        }
                    }}
                />
            </PersonalCard>
            {history.length > 0 && <PersonalCard title="Schedule history"><ScheduleTable plans={history} empty="No completed or missed plans yet." pending={mutation.pending} onEdit={openEdit} onOpenWorkout={(plan) => onOpenLog(plan.workoutId ?? undefined)} onSkip={async (plan) => { await mutation.run("workouts:setScheduleSkipped", { scheduleId: plan.id, skipped: !plan.skipped }); }} onDelete={async (plan) => { if (window.confirm(`Delete ${plan.name} from ${dateLabel(plan.date)}?`)) await mutation.run("workouts:deleteSchedule", { scheduleId: plan.id }); }} /></PersonalCard>}
        </div>
    );
}

function ScheduleEditor({ plan, initialDate, templates, mutation, onClose }: { plan: ScheduleRow | null; initialDate: string; templates: ScheduleData["templates"]; mutation: WorkoutMutationControls; onClose: () => void }) {
    const [date, setDate] = useState(plan?.date ?? initialDate);
    const [templateId, setTemplateId] = useState(plan?.templateId ?? "");
    const [name, setName] = useState(plan?.name ?? "");
    const [notes, setNotes] = useState(plan?.notes ?? "");
    const changeTemplate = (nextTemplateId: string) => {
        const previousTemplateName = templates.find((template) => template.id === templateId)?.name ?? plan?.templateName ?? "";
        const nextTemplateName = templates.find((template) => template.id === nextTemplateId)?.name ?? "";
        const currentName = name.trim();
        const nameWasTemplateDerived = !currentName || (previousTemplateName && currentName === previousTemplateName);
        setTemplateId(nextTemplateId);
        if (nextTemplateName && nameWasTemplateDerived) setName(nextTemplateName);
    };
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const ok = await mutation.run(plan ? "workouts:updateSchedule" : "workouts:createSchedule", { ...(plan ? { scheduleId: plan.id } : {}), date, templateId: templateId || null, name, notes });
        if (ok) onClose();
    };
    return (
        <PersonalCard title={plan ? "Change scheduled workout" : "Schedule a workout"} action={<button type="button" onClick={onClose} className="rounded-lg border border-secondary p-2 text-secondary hover:bg-secondary" aria-label="Close schedule editor"><XClose className="size-4" /></button>}>
            <form onSubmit={submit} className="grid gap-4 lg:grid-cols-2">
                <label className={fieldLabel}>
                    Workout day
                    <input type="date" required value={date} onChange={(event) => setDate(event.target.value)} className={fieldClass} />
                    {plan && <span className="text-xs font-normal text-quaternary">Choose another day to move this workout.</span>}
                </label>
                <label className={fieldLabel}>
                    Workout template
                    <RichSelect aria-label="Scheduled workout template" value={templateId} onChange={(event) => changeTemplate(event.target.value)} placeholder="No template" options={templates.map((template) => ({ value: template.id, label: template.name }))} />
                    <span className="text-xs font-normal text-quaternary">Pick any template; a custom workout name is preserved.</span>
                </label>
                <label className={fieldLabel}>Workout name<input required value={name} onChange={(event) => setName(event.target.value)} className={fieldClass} placeholder="Push day" /></label>
                <label className={fieldLabel}>Notes<input value={notes} onChange={(event) => setNotes(event.target.value)} className={fieldClass} placeholder="Focus, reminders, equipment…" /></label>
                <div className="flex flex-wrap justify-end gap-2 lg:col-span-2">
                    <button type="button" onClick={onClose} className="rounded-lg border border-secondary px-3 py-2 text-sm font-semibold text-secondary">Cancel</button>
                    <button type="submit" disabled={mutation.pending} className="rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{plan ? "Save changes" : "Schedule workout"}</button>
                </div>
            </form>
        </PersonalCard>
    );
}

function ExerciseThumbnail({ exercise }: { exercise: ExerciseRow }) {
    const sources = useMemo(
        () => Array.from(new Set([
            exercise.imageUrl,
            resolveExerciseImage(exercise.mediaUrl),
            ...exercise.images.map(resolveExerciseImage),
        ].filter((source): source is string => Boolean(source)))),
        [exercise.imageUrl, exercise.images, exercise.mediaUrl],
    );
    const [sourceIndex, setSourceIndex] = useState(0);
    const source = sources[sourceIndex];
    return (
        <span className="relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-lg bg-secondary text-quaternary ring-1 ring-secondary ring-inset">
            <Activity className="size-5" />
            {source && (
                <img
                    src={source}
                    alt=""
                    loading="lazy"
                    className="absolute inset-0 size-full object-cover"
                    onError={() => setSourceIndex((index) => index + 1)}
                />
            )}
        </span>
    );
}

function ExercisesSection({ data, mutation }: { data: ExercisesData; mutation: WorkoutMutationControls }) {
    const [search, setSearch] = useState("");
    const [view, setView] = useState<"table" | "grid">("table");
    const [editing, setEditing] = useState<ExerciseRow | null>(null);
    const [selected, setSelected] = useState<ExerciseRow | null>(null);
    const [showEditor, setShowEditor] = useState(false);
    const normalizedSearch = search.trim().toLowerCase();
    const filtered = useMemo(
        () =>
            data.exercises.filter((exercise) => {
                if (!normalizedSearch) return true;
                return [exercise.name, exercise.category ?? "", exercise.level ?? "", ...exercise.muscles, ...exercise.equipment]
                    .join(" ")
                    .toLowerCase()
                    .includes(normalizedSearch);
            }),
        [data.exercises, normalizedSearch],
    );
    return (
        <div className="flex flex-col gap-5">
            <StatGrid
                stats={[
                    { label: "Exercise library", value: data.summary.total, detail: "Built-in and custom movements" },
                    { label: "Custom", value: data.summary.custom, detail: "Movements you created" },
                    { label: "Used", value: data.summary.used, detail: "Included in logged workouts" },
                    { label: "With records", value: data.summary.withRecords, detail: "Movements with a personal best" },
                ]}
            />
            <PersonalCard
                title="Exercise library"
                action={
                    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                        <div className="inline-flex rounded-lg border border-secondary bg-primary p-0.5" aria-label="Exercise view">
                            {(["table", "grid"] as const).map((mode) => <button key={mode} type="button" onClick={() => setView(mode)} className={`rounded-md px-2.5 py-1.5 text-xs font-semibold ${view === mode ? "bg-secondary text-primary" : "text-tertiary hover:text-secondary"}`}>{titleCase(mode)}</button>)}
                        </div>
                        <input
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Search exercises"
                            aria-label="Search exercises"
                            className="w-full min-w-0 rounded-lg border border-primary bg-primary px-3 py-2 text-sm text-primary outline-hidden placeholder:text-quaternary focus:border-brand sm:w-48"
                        />
                        <ActionButton onClick={() => { setEditing(null); setShowEditor(true); }} disabled={mutation.pending}>Add exercise</ActionButton>
                    </div>
                }
            >
                {showEditor && <div className="mb-5 border-b border-secondary pb-5"><ExerciseEditor key={editing?.id ?? "new"} exercise={editing} mutation={mutation} onClose={() => { setShowEditor(false); setEditing(null); }} /></div>}
                {selected && <div className="mb-5 rounded-xl border border-secondary bg-secondary p-4" data-exercise-detail={selected.id}><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3"><ExerciseThumbnail exercise={selected} /><div className="min-w-0"><h3 className="break-words text-md font-semibold text-primary">{selected.name}</h3><p className="mt-0.5 break-words text-xs text-tertiary">{listLabel(selected.muscles)} · {trackingLabel(selected)}</p></div></div><button type="button" onClick={() => setSelected(null)} className="shrink-0 rounded p-1.5 text-tertiary hover:bg-primary" aria-label="Close exercise details"><XClose className="size-4" /></button></div><div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-quaternary">Equipment</p><p className="mt-1 text-sm text-secondary">{listLabel(selected.equipment)}</p></div><div><p className="text-xs font-semibold uppercase tracking-wide text-quaternary">Previous</p><p className="mt-1 text-sm text-secondary">{selected.lastPerformedOn ? `${dateLabel(selected.lastPerformedOn)}${selected.lastWorkoutName ? ` · ${selected.lastWorkoutName}` : ""}` : "Not performed yet"}</p></div><div><p className="text-xs font-semibold uppercase tracking-wide text-quaternary">Usage</p><p className="mt-1 text-sm text-secondary">{selected.useCount} workout{selected.useCount === 1 ? "" : "s"}</p></div><div><p className="text-xs font-semibold uppercase tracking-wide text-quaternary">Personal records</p><p className="mt-1 text-sm text-secondary">{selected.records.length ? selected.records.slice(0, 3).map(recordValue).join(" · ") : "No records yet"}</p></div></div>{(selected.instructions || selected.notes) && <div className="mt-4 border-t border-secondary pt-4"><p className="text-xs font-semibold uppercase tracking-wide text-quaternary">Instructions and notes</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-secondary">{selected.instructions || selected.notes}</p></div>}{selected.previousSets.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{selected.previousSets.map((set, index) => <span key={index} className="rounded-lg bg-primary px-2.5 py-1.5 text-xs text-secondary">Set {index + 1}: {set.weight != null ? `${formatNumber(set.weight, 1)} ${data.weightUnit}` : ""}{set.reps != null ? ` × ${set.reps}` : ""}{set.seconds != null ? ` · ${set.seconds}s` : ""}{set.meters != null ? ` · ${set.meters}m` : ""}</span>)}</div>}</div>}
                {view === "table" ? <PersonalTable
                    rows={filtered}
                    empty={normalizedSearch ? "No exercises match this search." : "No exercises are available."}
                    columns={[
                        {
                            key: "exercise",
                            label: "Exercise",
                            render: (row) => (
                                <div data-exercise-id={row.id} data-exercise-slug={row.slug} className="flex min-w-56 items-center gap-3">
                                    <ExerciseThumbnail exercise={row} />
                                    <div className="min-w-0">
                                        <p className="truncate font-medium text-primary">{row.name}</p>
                                        <p className="mt-0.5 text-xs text-quaternary">{row.custom ? "Custom" : "Catalog"}{row.category ? ` · ${titleCase(row.category)}` : ""}</p>
                                    </div>
                                </div>
                            ),
                        },
                        { key: "muscle", label: "Muscles", render: (row) => listLabel(row.muscles) },
                        { key: "equipment", label: "Equipment", render: (row) => listLabel(row.equipment) },
                        { key: "tracking", label: "Tracks", render: (row) => trackingLabel(row) },
                        { key: "previous", label: "Previous", render: (row) => row.lastPerformedOn ? <span className="text-xs"><span className="font-medium text-secondary">{dateLabel(row.lastPerformedOn)}</span>{row.previousSets[0] && <span className="mt-0.5 block text-quaternary">{row.previousSets.slice(0, 3).map((set) => `${set.weight != null ? `${formatNumber(set.weight, 1)} ${data.weightUnit}` : ""}${set.reps != null ? ` × ${set.reps}` : ""}${set.seconds != null ? ` · ${set.seconds}s` : ""}`).join("; ")}</span>}</span> : "—" },
                        { key: "best", label: "Personal best", render: (row) => { const record = row.records.find((item) => item.recordType.toLowerCase() === "1rm") ?? row.records[0]; return record ? <span className="text-xs"><span className="font-semibold text-primary">{recordValue(record)}</span><span className="mt-0.5 block text-quaternary">{dateLabel(record.achievedOn)}</span></span> : "—"; } },
                        { key: "usage", label: "Uses", align: "right", render: (row) => formatNumber(row.useCount) },
                        { key: "records", label: "Records", align: "right", render: (row) => formatNumber(row.records.length) },
                        {
                            key: "actions",
                            label: "",
                            align: "right",
                            render: (row) => (
                                <div className="flex justify-end gap-1"><button type="button" className="rounded-md border border-secondary px-2 py-1 text-xs font-semibold text-secondary hover:bg-secondary" onClick={() => setSelected(row)}>View</button>{row.custom && <><button type="button" className="inline-flex items-center gap-1 rounded-md border border-secondary px-2 py-1 text-xs font-semibold text-secondary hover:bg-secondary" onClick={() => { setEditing(row); setShowEditor(true); }}><Edit01 className="size-3.5" />Edit</button><DeleteButton
                                    disabled={mutation.pending}
                                    onClick={async () => {
                                        if (window.confirm(`Remove ${row.name} from your exercise library?`)) {
                                            await mutation.run("workouts:deleteExercise", { exerciseId: row.id });
                                        }
                                    }}
                                /></>}</div>
                            ),
                        },
                    ]}
                /> : filtered.length === 0 ? <EmptyMessage>{normalizedSearch ? "No exercises match this search." : "No exercises are available."}</EmptyMessage> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {filtered.map((row) => {
                        const record = row.records.find((item) => item.recordType.toLowerCase() === "1rm") ?? row.records[0];
                        return <article key={row.id} data-exercise-id={row.id} className="rounded-xl border border-secondary bg-secondary_subtle p-4">
                            <div className="flex items-start gap-3"><ExerciseThumbnail exercise={row} /><div className="min-w-0 flex-1"><h3 className="truncate text-sm font-semibold text-primary">{row.name}</h3><p className="text-xs text-tertiary">{row.custom ? "Custom" : "Catalog"}{row.category ? ` · ${titleCase(row.category)}` : ""}</p></div><button type="button" className="rounded-md border border-secondary px-2 py-1 text-xs font-semibold text-secondary hover:bg-secondary" onClick={() => setSelected(row)}>View</button>{row.custom && <button type="button" className="rounded-md border border-secondary p-1.5 text-secondary hover:bg-secondary" onClick={() => { setEditing(row); setShowEditor(true); }} aria-label={`Edit ${row.name}`}><Edit01 className="size-3.5" /></button>}</div>
                            <dl className="mt-4 grid grid-cols-2 gap-3 text-xs"><div><dt className="text-quaternary">Muscles</dt><dd className="mt-0.5 text-secondary">{listLabel(row.muscles)}</dd></div><div><dt className="text-quaternary">Tracks</dt><dd className="mt-0.5 text-secondary">{trackingLabel(row)}</dd></div><div><dt className="text-quaternary">Previous</dt><dd className="mt-0.5 font-medium text-secondary">{row.lastPerformedOn ? dateLabel(row.lastPerformedOn) : "—"}</dd></div><div><dt className="text-quaternary">Personal best</dt><dd className="mt-0.5 font-medium text-secondary">{record ? `${recordValue(record)} · ${dateLabel(record.achievedOn)}` : "—"}</dd></div></dl>
                            {row.previousSets.length > 0 && <p className="mt-3 rounded-lg bg-primary px-3 py-2 text-xs text-tertiary">Last sets: {row.previousSets.slice(0, 3).map((set) => `${set.weight != null ? `${formatNumber(set.weight, 1)} ${data.weightUnit}` : ""}${set.reps != null ? ` × ${set.reps}` : ""}${set.seconds != null ? ` · ${set.seconds}s` : ""}`).join("; ")}</p>}
                        </article>;
                    })}
                </div>}
            </PersonalCard>
        </div>
    );
}

function ExerciseEditor({ exercise, mutation, onClose }: { exercise: ExerciseRow | null; mutation: WorkoutMutationControls; onClose: () => void }) {
    const [name, setName] = useState(exercise?.name ?? "");
    const [muscles, setMuscles] = useState(exercise?.muscles.join(", ") ?? "");
    const [equipment, setEquipment] = useState(exercise?.equipment.join(", ") ?? "");
    const [category, setCategory] = useState(exercise?.category ?? "");
    const [notes, setNotes] = useState(exercise?.notes ?? "");
    const [tracksReps, setTracksReps] = useState(exercise?.tracksReps ?? true);
    const [tracksWeight, setTracksWeight] = useState(exercise?.tracksWeight ?? true);
    const [tracksTime, setTracksTime] = useState(exercise?.tracksTime ?? false);
    const [tracksDistance, setTracksDistance] = useState(exercise?.tracksDistance ?? false);
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const ok = await mutation.run(exercise ? "workouts:updateExercise" : "workouts:createExercise", { ...(exercise ? { exerciseId: exercise.id } : {}), name, muscles: commaList(muscles), equipment: commaList(equipment), category, notes, tracksReps, tracksWeight, tracksTime, tracksDistance });
        if (ok) onClose();
    };
    return <form onSubmit={submit} className="rounded-xl bg-secondary p-4"><div className="mb-3 flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold text-primary">{exercise ? "Edit custom exercise" : "Create custom exercise"}</h3><p className="text-xs text-tertiary">Customize movement metadata and exactly what each set tracks.</p></div><button type="button" className="rounded p-1.5 text-tertiary hover:bg-primary" onClick={onClose} aria-label="Close exercise editor"><XClose className="size-4" /></button></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><label className={fieldLabel}>Name<input className={fieldClass} value={name} onChange={(event) => setName(event.target.value)} required /></label><label className={fieldLabel}>Muscles<input className={fieldClass} value={muscles} onChange={(event) => setMuscles(event.target.value)} placeholder="chest, triceps" /></label><label className={fieldLabel}>Equipment<input className={fieldClass} value={equipment} onChange={(event) => setEquipment(event.target.value)} placeholder="barbell, rack" /></label><label className={fieldLabel}>Category<input className={fieldClass} value={category} onChange={(event) => setCategory(event.target.value)} placeholder="strength" /></label><label className={`${fieldLabel} md:col-span-2`}>Notes<input className={fieldClass} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Setup cues, variations, safety notes…" /></label><fieldset className="flex flex-wrap items-center gap-3 md:col-span-2"><legend className="mb-1 text-xs font-medium text-secondary">Track per set</legend>{[["Weight", tracksWeight, setTracksWeight], ["Reps", tracksReps, setTracksReps], ["Time", tracksTime, setTracksTime], ["Distance", tracksDistance, setTracksDistance]].map(([label, checked, setter]) => <label key={String(label)} className="inline-flex items-center gap-1.5 rounded-full border border-secondary bg-primary px-2.5 py-1.5 text-xs text-secondary"><input type="checkbox" checked={Boolean(checked)} onChange={(event) => (setter as (value: boolean) => void)(event.target.checked)} />{String(label)}</label>)}</fieldset></div><div className="mt-4 flex justify-end"><button className="rounded-lg bg-brand-solid px-3 py-2 text-sm font-semibold text-white" type="submit" disabled={mutation.pending}>{exercise ? "Save exercise" : "Create exercise"}</button></div></form>;
}

function TemplatesSection({ data, mutation, onOpenLog }: { data: TemplatesData; mutation: WorkoutMutationControls; onOpenLog: (workoutId?: string) => void }) {
    const [editing, setEditing] = useState<TemplateRow | null>(null);
    const [showEditor, setShowEditor] = useState(false);
    const startTemplate = async (template: TemplateRow) => {
        const result = await mutation.runWithResult<{ id: string }>("workouts:logWorkout", { date: todayValue(), name: template.name, templateId: template.id, status: "in_progress", startedAt: new Date().toISOString() });
        if (result) onOpenLog(result.id);
    };
    return (
        <div className="flex flex-col gap-5">
            <StatGrid
                stats={[
                    { label: "Active templates", value: data.summary.total, detail: "Reusable workout plans" },
                    { label: "With progression", value: data.summary.withProgression, detail: "Automated loading schemes" },
                    { label: "Programmed exercises", value: data.summary.totalExercises, detail: "Across active templates" },
                    { label: "Used templates", value: data.summary.used, detail: "Started at least once" },
                ]}
            />
            <div className="flex justify-end">
                <ActionButton onClick={() => { setEditing(null); setShowEditor(true); }} disabled={mutation.pending}>Create template</ActionButton>
            </div>
            {showEditor && <TemplateEditor key={editing?.id ?? "new"} template={editing} data={data} mutation={mutation} onClose={() => { setShowEditor(false); setEditing(null); }} />}
            {data.templates.length === 0 ? (
                <PersonalCard><EmptyMessage>No workout templates have been created yet.</EmptyMessage></PersonalCard>
            ) : (
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
                    {data.templates.map((template) => (
                        <PersonalCard key={template.id} className="h-full">
                            <article data-template-id={template.id}>
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div className="min-w-0 flex-1">
                                        <h2 className="break-words text-md font-semibold text-primary">{template.name}</h2>
                                        <p className="mt-1 text-xs text-tertiary">{titleCase(template.progression)} progression</p>
                                    </div>
                                    <div className="flex flex-wrap items-center justify-end gap-2">
                                        <span className="rounded-full bg-secondary px-2 py-1 text-xs font-medium text-secondary">~{template.estimatedMinutes} min</span>
                                        <button type="button" disabled={mutation.pending} className="inline-flex items-center gap-1 rounded-md bg-brand-solid px-2 py-1.5 text-xs font-semibold text-white disabled:opacity-50" onClick={() => void startTemplate(template)}><PlayCircle className="size-3.5" />Start</button>
                                        <button type="button" className="rounded-md border border-secondary p-1.5 text-secondary hover:bg-secondary" onClick={() => { setEditing(template); setShowEditor(true); }} aria-label={`Edit ${template.name}`}><Edit01 className="size-3.5" /></button>
                                        <DeleteButton
                                            disabled={mutation.pending}
                                            onClick={async () => {
                                                if (window.confirm(`Delete the ${template.name} template?`)) {
                                                    await mutation.run("workouts:deleteTemplate", { templateId: template.id });
                                                }
                                            }}
                                        />
                                    </div>
                                </div>
                                {template.note && <p className="mt-3 whitespace-pre-wrap text-sm leading-5 text-secondary">{template.note}</p>}
                                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                                    <TemplateMetric label="Exercises" value={template.exerciseCount} />
                                    <TemplateMetric label="Sets" value={template.totalSets} />
                                </div>
                                {template.exercises.length ? (
                                    <ul className="mt-4 space-y-2 border-t border-secondary pt-3">
                                        {template.exercises.map((exercise) => (
                                            <li key={exercise.id} className="flex items-start justify-between gap-3 text-xs">
                                                <span className="min-w-0 break-words font-medium text-secondary">{exercise.exerciseName}</span>
                                                <span className="max-w-[58%] break-words text-right tabular-nums text-tertiary">{templateExercisePrescription(exercise, data.weightUnit)}</span>
                                            </li>
                                        ))}
                                    </ul>
                                ) : <p className="mt-4 text-xs text-tertiary">No exercises added</p>}
                                <p className="mt-3 text-xs text-quaternary">{template.lastUsedOn ? `Last used ${dateLabel(template.lastUsedOn)}` : "Never used"}</p>
                            </article>
                        </PersonalCard>
                    ))}
                </div>
            )}
        </div>
    );
}

type TemplateExerciseDraft = { id: string; exerciseId: string; name: string; sets: string; reps: string; repsMin: string; repsMax: string; weight: string; seconds: string; meters: string; rpe: string; rest: string; groupKey: string; tempo: string; note: string };

function TemplateEditor({ template, data, mutation, onClose }: { template: TemplateRow | null; data: TemplatesData; mutation: WorkoutMutationControls; onClose: () => void }) {
    const [name, setName] = useState(template?.name ?? "");
    const [note, setNote] = useState(template?.note ?? "");
    const [progression, setProgression] = useState(template?.progression ?? "NONE");
    const [exerciseId, setExerciseId] = useState("");
    const [exercises, setExercises] = useState<TemplateExerciseDraft[]>(() => (template?.exercises ?? []).map((exercise) => ({ id: exercise.id, exerciseId: exercise.exerciseId, name: exercise.exerciseName, sets: String(exercise.targetSets ?? 3), reps: exercise.targetReps == null ? "" : String(exercise.targetReps), repsMin: exercise.targetRepsMin == null ? "" : String(exercise.targetRepsMin), repsMax: exercise.targetRepsMax == null ? "" : String(exercise.targetRepsMax), weight: exercise.targetWeight == null ? "" : String(exercise.targetWeight), seconds: exercise.targetTimeSec == null ? "" : String(exercise.targetTimeSec), meters: exercise.targetDistanceM == null ? "" : String(exercise.targetDistanceM), rpe: exercise.targetRpe == null ? "" : String(exercise.targetRpe), rest: String(exercise.restSec ?? 90), groupKey: exercise.groupKey ?? "", tempo: exercise.tempo ?? "", note: exercise.note ?? "" })));
    const add = () => {
        const option = data.exerciseOptions.find((item) => item.id === exerciseId);
        if (!option) return;
        setExercises((current) => [...current, { id: draftId(), exerciseId: option.id, name: option.name, sets: "3", reps: "8", repsMin: "", repsMax: "", weight: "", seconds: "", meters: "", rpe: "", rest: "90", groupKey: "", tempo: "", note: "" }]);
        setExerciseId("");
    };
    const move = (id: string, direction: -1 | 1) => {
        setExercises((current) => {
            const index = current.findIndex((item) => item.id === id);
            const target = index + direction;
            if (index < 0 || target < 0 || target >= current.length) return current;
            const next = [...current];
            [next[index], next[target]] = [next[target], next[index]];
            return next;
        });
    };
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const ok = await mutation.run(template ? "workouts:updateTemplate" : "workouts:createTemplate", {
            ...(template ? { templateId: template.id } : {}), name, note, progression, weightUnit: data.weightUnit,
            exercises: exercises.map((exercise) => ({ exerciseId: exercise.exerciseId, targetSets: numberOrNull(exercise.sets), targetReps: numberOrNull(exercise.reps), targetRepsMin: numberOrNull(exercise.repsMin), targetRepsMax: numberOrNull(exercise.repsMax), targetWeight: numberOrNull(exercise.weight), targetTimeSec: numberOrNull(exercise.seconds), targetDistanceM: numberOrNull(exercise.meters), targetRpe: numberOrNull(exercise.rpe), restSec: numberOrNull(exercise.rest), groupKey: exercise.groupKey || null, tempo: exercise.tempo || null, note: exercise.note || null })),
        });
        if (ok) onClose();
    };
    return <PersonalCard title={template ? "Edit workout template" : "Create workout template"} action={<button type="button" className="rounded-lg border border-secondary p-2 text-secondary hover:bg-secondary" onClick={onClose} aria-label="Close template editor"><XClose className="size-4" /></button>}>
        <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3"><label className={fieldLabel}>Template name<input className={fieldClass} required value={name} onChange={(event) => setName(event.target.value)} /></label><label className={fieldLabel}>Progression<RichSelect aria-label="Template progression" value={progression} onChange={(event) => setProgression(event.target.value)} options={[{ value: "NONE", label: "None" }, { value: "LINEAR", label: "Linear" }, { value: "DOUBLE", label: "Double progression" }, { value: "FIVETHREEONE", label: "5/3/1" }]} /></label><label className={fieldLabel}>Notes<input className={fieldClass} value={note} onChange={(event) => setNote(event.target.value)} /></label></div>
            <div className="flex flex-col gap-3 rounded-xl border border-secondary bg-secondary p-4 sm:flex-row sm:items-end"><label className={`${fieldLabel} min-w-0 flex-1`}>Exercise<RichSelect aria-label="Template exercise to add" value={exerciseId} onChange={(event) => setExerciseId(event.target.value)} placeholder="Choose an exercise" options={data.exerciseOptions.map((exercise) => ({ value: exercise.id, label: exercise.name }))} /></label><button type="button" onClick={add} disabled={!exerciseId} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-secondary bg-primary px-3 py-2 text-sm font-semibold text-secondary disabled:opacity-50"><Plus className="size-4" />Add</button></div>
            <div className="space-y-3">{exercises.map((exercise, index) => <section key={exercise.id} className="rounded-xl border border-secondary p-3"><div className="flex items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold text-tertiary">{index + 1}</span><h3 className="break-words text-sm font-semibold text-primary">{exercise.name}</h3></div><div className="flex shrink-0 items-center gap-1"><button type="button" disabled={index === 0} className="rounded border border-secondary px-2 py-1 text-xs font-semibold text-secondary disabled:opacity-30" onClick={() => move(exercise.id, -1)} aria-label={`Move ${exercise.name} up`}>↑</button><button type="button" disabled={index === exercises.length - 1} className="rounded border border-secondary px-2 py-1 text-xs font-semibold text-secondary disabled:opacity-30" onClick={() => move(exercise.id, 1)} aria-label={`Move ${exercise.name} down`}>↓</button><button type="button" className="rounded p-1.5 text-error-primary hover:bg-error-secondary" onClick={() => setExercises((current) => current.filter((item) => item.id !== exercise.id))} aria-label={`Remove ${exercise.name} from template`}><Trash01 className="size-4" /></button></div></div><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-9"><MiniField label="Sets" value={exercise.sets} onChange={(value) => setExercises((current) => current.map((item) => item.id === exercise.id ? { ...item, sets: value } : item))} /><MiniField label="Exact reps" value={exercise.reps} onChange={(value) => setExercises((current) => current.map((item) => item.id === exercise.id ? { ...item, reps: value } : item))} /><MiniField label="Reps min" value={exercise.repsMin} onChange={(value) => setExercises((current) => current.map((item) => item.id === exercise.id ? { ...item, repsMin: value } : item))} /><MiniField label="Reps max" value={exercise.repsMax} onChange={(value) => setExercises((current) => current.map((item) => item.id === exercise.id ? { ...item, repsMax: value } : item))} /><MiniField label={`Weight (${data.weightUnit})`} value={exercise.weight} onChange={(value) => setExercises((current) => current.map((item) => item.id === exercise.id ? { ...item, weight: value } : item))} /><MiniField label="Time (sec)" value={exercise.seconds} onChange={(value) => setExercises((current) => current.map((item) => item.id === exercise.id ? { ...item, seconds: value } : item))} /><MiniField label="Distance (m)" value={exercise.meters} onChange={(value) => setExercises((current) => current.map((item) => item.id === exercise.id ? { ...item, meters: value } : item))} /><MiniField label="Target RPE" value={exercise.rpe} onChange={(value) => setExercises((current) => current.map((item) => item.id === exercise.id ? { ...item, rpe: value } : item))} /><MiniField label="Rest (sec)" value={exercise.rest} onChange={(value) => setExercises((current) => current.map((item) => item.id === exercise.id ? { ...item, rest: value } : item))} /></div><div className="mt-2 grid gap-2 md:grid-cols-3"><label className={fieldLabel}>Superset group<input className={fieldClass} value={exercise.groupKey} maxLength={8} onChange={(event) => setExercises((current) => current.map((item) => item.id === exercise.id ? { ...item, groupKey: event.target.value.toUpperCase() } : item))} placeholder="A" /></label><label className={fieldLabel}>Tempo<input className={fieldClass} value={exercise.tempo} onChange={(event) => setExercises((current) => current.map((item) => item.id === exercise.id ? { ...item, tempo: event.target.value } : item))} placeholder="3-1-1-0" /></label><label className={fieldLabel}>Exercise note<input className={fieldClass} value={exercise.note} onChange={(event) => setExercises((current) => current.map((item) => item.id === exercise.id ? { ...item, note: event.target.value } : item))} placeholder="Cues or substitutions" /></label></div></section>)}</div>
            <div className="flex justify-end"><button type="submit" disabled={mutation.pending} className="rounded-lg bg-brand-solid px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{template ? "Save template" : "Create template"}</button></div>
        </form>
    </PersonalCard>;
}

function BodySection({ data, mutation }: { data: BodyData; mutation: WorkoutMutationControls }) {
    const activeCycle = data.summary.activeCycle;
    const [measurementEditor, setMeasurementEditor] = useState<MeasurementRow | "new" | null>(null);
    const [cycleEditor, setCycleEditor] = useState<CycleRow | "new" | null>(null);
    return (
        <div className="flex flex-col gap-5">
            <StatGrid
                stats={[
                    {
                        label: "Latest weight",
                        value: data.summary.latestWeight === null ? "—" : `${formatNumber(data.summary.latestWeight, 1)} ${data.weightUnit}`,
                        detail: deltaText(data.summary.weightChange, data.weightUnit, "since previous entry"),
                    },
                    {
                        label: "Body fat",
                        value: data.summary.latestBodyFatPct === null ? "—" : `${formatNumber(data.summary.latestBodyFatPct, 1)}%`,
                        detail: deltaText(data.summary.bodyFatChange, "points", "since previous entry"),
                    },
                    { label: "Measurements", value: data.summary.measurementCount, detail: "Body check-ins retained" },
                    {
                        label: "Training cycle",
                        value: activeCycle ? titleCase(activeCycle.phase) : "—",
                        detail: activeCycle ? `Day ${activeCycle.day}` : "No active cycle",
                    },
                ]}
            />

            <BodyCompositionCharts measurements={data.measurements} weightUnit={data.weightUnit} />

            <PersonalCard
                title="Body measurements"
                action={<ActionButton onClick={() => setMeasurementEditor("new")} disabled={mutation.pending}>Add measurement</ActionButton>}
            >
                {measurementEditor && <div className="mb-5 border-b border-secondary pb-5"><BodyMeasurementEditor row={measurementEditor === "new" ? null : measurementEditor} weightUnit={data.weightUnit} mutation={mutation} onClose={() => setMeasurementEditor(null)} /></div>}
                <PersonalTable
                    rows={data.measurements}
                    empty="Log a body measurement to start your history."
                    columns={[
                        { key: "date", label: "Date", render: (row) => dateLabel(row.date) },
                        { key: "weight", label: `Weight (${data.weightUnit})`, align: "right", render: (row) => nullableNumber(row.displayWeight, 1) },
                        { key: "fat", label: "Body fat", align: "right", render: (row) => row.bodyFatPct === null ? "—" : `${formatNumber(row.bodyFatPct, 1)}%` },
                        { key: "chest", label: "Chest", align: "right", render: (row) => cmValue(row.chestCm) },
                        { key: "waist", label: "Waist", align: "right", render: (row) => cmValue(row.waistCm) },
                        { key: "other", label: "Other measurements", render: (row) => [["Neck", row.neckCm], ["Hip", row.hipCm], ["Arms", row.armLCm != null || row.armRCm != null ? Math.max(row.armLCm ?? 0, row.armRCm ?? 0) : null], ["Legs", row.legLCm != null || row.legRCm != null ? Math.max(row.legLCm ?? 0, row.legRCm ?? 0) : null]].filter(([, value]) => value != null).map(([label, value]) => `${label} ${cmValue(value as number)}`).join(" · ") || "—" },
                        { key: "note", label: "Note", render: (row) => row.note || "—" },
                        {
                            key: "actions",
                            label: "",
                            align: "right",
                            render: (row) => (
                                <div className="flex justify-end gap-1"><button type="button" className="inline-flex items-center gap-1 rounded-md border border-secondary px-2 py-1 text-xs font-semibold text-secondary hover:bg-secondary" onClick={() => setMeasurementEditor(row)}><Edit01 className="size-3.5" />Edit</button><DeleteButton
                                    disabled={mutation.pending}
                                    onClick={async () => {
                                        if (window.confirm(`Delete the measurement from ${dateLabel(row.date)}?`)) {
                                            await mutation.run("workouts:deleteBodyMeasurement", { measurementId: row.id });
                                        }
                                    }}
                                /></div>
                            ),
                        },
                    ]}
                />
            </PersonalCard>

            <PersonalCard title="Personal records" action={<ActionButton onClick={async () => { await mutation.run("workouts:recomputeRecords", {}); }} disabled={mutation.pending}>Recompute records</ActionButton>}>
                <PersonalTable
                    rows={data.records.map((record) => ({ ...record, id: record.exerciseId }))}
                    empty="Complete a working set in a finished workout to calculate personal records."
                    columns={[
                        {
                            key: "exercise",
                            label: "Exercise",
                            render: (row) => <span data-exercise-id={row.exerciseId} className="font-medium text-primary">{row.exerciseName}</span>,
                        },
                        { key: "rm", label: `Est. 1RM (${data.weightUnit})`, align: "right", render: (row) => nullableNumber(row.oneRm, 1) },
                        { key: "volume", label: `Best volume (${data.weightUnit})`, align: "right", render: (row) => nullableNumber(row.volume) },
                        { key: "reps", label: "Most reps", align: "right", render: (row) => nullableNumber(row.reps) },
                        { key: "endurance", label: "Time / distance", align: "right", render: (row) => [row.time != null ? `${formatNumber(row.time)} sec` : "", row.distance != null ? `${formatNumber(row.distance, 1)} m` : ""].filter(Boolean).join(" · ") || "—" },
                        { key: "date", label: "Last PR", align: "right", render: (row) => dateLabel(row.lastAchievedOn) },
                    ]}
                />
            </PersonalCard>

            <PersonalCard title="Training cycles" action={<ActionButton onClick={() => setCycleEditor("new")} disabled={mutation.pending}>Add cycle</ActionButton>}>
                {cycleEditor && <div className="mb-5 border-b border-secondary pb-5"><TrainingCycleEditor cycle={cycleEditor === "new" ? null : cycleEditor} mutation={mutation} onClose={() => setCycleEditor(null)} /></div>}
                <PersonalTable
                    rows={data.cycles}
                    empty="No bulk, cut, or maintenance cycles have been logged."
                    columns={[
                        { key: "phase", label: "Phase", render: (row) => <span className="font-medium text-primary">{titleCase(row.phase)}</span> },
                        { key: "start", label: "Start", render: (row) => dateLabel(row.startDate) },
                        { key: "end", label: "End", render: (row) => row.endDate ? dateLabel(row.endDate) : "Open-ended" },
                        { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
                        { key: "note", label: "Note", render: (row) => row.note || "—" },
                        { key: "actions", label: "", align: "right", render: (row) => <div className="flex justify-end gap-1"><button type="button" onClick={() => setCycleEditor(row)} className="inline-flex items-center gap-1 rounded-md border border-secondary px-2 py-1 text-xs font-semibold text-secondary hover:bg-secondary"><Edit01 className="size-3.5" />Edit</button><DeleteButton disabled={mutation.pending} onClick={async () => { if (window.confirm(`Delete the ${titleCase(row.phase)} cycle starting ${dateLabel(row.startDate)}?`)) await mutation.run("workouts:deleteTrainingCycle", { cycleId: row.id }); }} /></div> },
                    ]}
                />
            </PersonalCard>
        </div>
    );
}

function TrainingCycleEditor({ cycle, mutation, onClose }: { cycle: CycleRow | null; mutation: WorkoutMutationControls; onClose: () => void }) {
    const [phase, setPhase] = useState(cycle?.phase ?? "MAINTAIN");
    const [startDate, setStartDate] = useState(cycle?.startDate ?? todayValue());
    const [endDate, setEndDate] = useState(cycle?.endDate ?? "");
    const [note, setNote] = useState(cycle?.note ?? "");
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const ok = await mutation.run(cycle ? "workouts:updateTrainingCycle" : "workouts:createTrainingCycle", { ...(cycle ? { cycleId: cycle.id } : {}), phase, startDate, endDate: endDate || null, note });
        if (ok) onClose();
    };
    return <form onSubmit={submit} className="rounded-xl bg-secondary p-4"><div className="mb-3 flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold text-primary">{cycle ? "Edit training cycle" : "Add training cycle"}</h3><p className="text-xs text-tertiary">Track bulk, cut, and maintenance phases alongside performance.</p></div><button type="button" onClick={onClose} className="rounded p-1.5 text-tertiary hover:bg-primary" aria-label="Close training cycle editor"><XClose className="size-4" /></button></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><label className={fieldLabel}>Phase<RichSelect aria-label="Training cycle phase" value={phase} onChange={(event) => setPhase(event.target.value)} options={[{ value: "BULK", label: "Bulk" }, { value: "CUT", label: "Cut" }, { value: "MAINTAIN", label: "Maintain" }]} /></label><label className={fieldLabel}>Start date<input type="date" required value={startDate} onChange={(event) => setStartDate(event.target.value)} className={fieldClass} /></label><label className={fieldLabel}>End date<input type="date" min={startDate} value={endDate} onChange={(event) => setEndDate(event.target.value)} className={fieldClass} /></label><label className={fieldLabel}>Notes<input value={note} onChange={(event) => setNote(event.target.value)} className={fieldClass} placeholder="Goal, calories, target weight…" /></label></div><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-lg border border-secondary px-3 py-2 text-sm font-semibold text-secondary">Cancel</button><button type="submit" disabled={mutation.pending} className="rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{cycle ? "Save cycle" : "Add cycle"}</button></div></form>;
}

function BodyMeasurementEditor({ row, weightUnit, mutation, onClose }: { row: MeasurementRow | null; weightUnit: string; mutation: WorkoutMutationControls; onClose: () => void }) {
    const [values, setValues] = useState(() => ({
        date: row?.date ?? todayValue(),
        weight: row?.displayWeight == null ? "" : String(row.displayWeight),
        bodyFatPct: row?.bodyFatPct == null ? "" : String(row.bodyFatPct),
        chestCm: row?.chestCm == null ? "" : String(row.chestCm),
        waistCm: row?.waistCm == null ? "" : String(row.waistCm),
        neckCm: row?.neckCm == null ? "" : String(row.neckCm),
        hipCm: row?.hipCm == null ? "" : String(row.hipCm),
        armLCm: row?.armLCm == null ? "" : String(row.armLCm),
        armRCm: row?.armRCm == null ? "" : String(row.armRCm),
        legLCm: row?.legLCm == null ? "" : String(row.legLCm),
        legRCm: row?.legRCm == null ? "" : String(row.legRCm),
        note: row?.note ?? "",
    }));
    const update = (key: keyof typeof values, value: string) => setValues((current) => ({ ...current, [key]: value }));
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const payload = Object.fromEntries(Object.entries(values).map(([key, value]) => key === "date" || key === "note" ? [key, value] : [key, numberOrNull(value)]));
        const ok = await mutation.run(row ? "workouts:updateBodyMeasurement" : "workouts:addBodyMeasurement", { ...(row ? { measurementId: row.id } : {}), ...payload, weightUnit });
        if (ok) onClose();
    };
    const numberFields: Array<[keyof typeof values, string]> = [["weight", `Weight (${weightUnit})`], ["bodyFatPct", "Body fat (%)"], ["chestCm", "Chest (cm)"], ["waistCm", "Waist (cm)"], ["neckCm", "Neck (cm)"], ["hipCm", "Hip (cm)"], ["armLCm", "Left arm (cm)"], ["armRCm", "Right arm (cm)"], ["legLCm", "Left leg (cm)"], ["legRCm", "Right leg (cm)"]];
    return <form onSubmit={submit} className="rounded-xl bg-secondary p-4"><div className="mb-3 flex items-center justify-between"><div><h3 className="text-sm font-semibold text-primary">{row ? "Edit body measurement" : "Add body measurement"}</h3><p className="text-xs text-tertiary">Record as much or as little detail as you have.</p></div><button type="button" onClick={onClose} className="rounded p-1.5 text-tertiary hover:bg-primary" aria-label="Close body measurement editor"><XClose className="size-4" /></button></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><label className={fieldLabel}>Date<input type="date" required className={fieldClass} value={values.date} onChange={(event) => update("date", event.target.value)} /></label>{numberFields.map(([key, label]) => <label key={key} className={fieldLabel}>{label}<input type="number" min="0" step="0.1" className={fieldClass} value={values[key]} onChange={(event) => update(key, event.target.value)} /></label>)}<label className={`${fieldLabel} sm:col-span-2 lg:col-span-3`}>Notes<input className={fieldClass} value={values.note} onChange={(event) => update("note", event.target.value)} /></label></div><div className="mt-4 flex justify-end"><button type="submit" disabled={mutation.pending} className="rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{row ? "Save measurement" : "Add measurement"}</button></div></form>;
}

function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
        reader.readAsDataURL(file);
    });
}

function workoutImageMime(file: File): string {
    if (file.type) return file.type;
    const extension = file.name.toLowerCase().split(".").pop();
    return extension === "png" ? "image/png" : extension === "gif" ? "image/gif" : extension === "webp" ? "image/webp" : "image/jpeg";
}

function ProgressPhotoForm({ data, mutation }: { data: ProgressData; mutation: WorkoutMutationControls }) {
    const previousWeight = data.weightSeries[data.weightSeries.length - 1]?.displayWeight;
    const [file, setFile] = useState<File | null>(null);
    const [date, setDate] = useState(todayValue());
    const [angle, setAngle] = useState("");
    const [phase, setPhase] = useState("");
    const [weight, setWeight] = useState(previousWeight == null ? "" : String(previousWeight));
    const [workoutId, setWorkoutId] = useState("");
    const [notes, setNotes] = useState("");
    const [localError, setLocalError] = useState<string | null>(null);
    const inputClass = "w-full min-w-0 rounded-lg border border-primary bg-primary px-3 py-2 text-sm text-primary outline-hidden placeholder:text-quaternary focus:border-brand";
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = event.currentTarget;
        setLocalError(null);
        if (!file) {
            setLocalError("Choose a progress image first.");
            return;
        }
        if (file.size > 25 * 1024 * 1024) {
            setLocalError("Progress photos must be 25 MB or smaller.");
            return;
        }
        const displayWeight = numberOrNull(weight);
        if (Number.isNaN(displayWeight)) {
            setLocalError("Enter a valid weight or leave it blank.");
            return;
        }
        try {
            const changed = await mutation.run("workouts:uploadProgressPhoto", {
                fileName: file.name,
                mimeType: workoutImageMime(file),
                base64: await fileToBase64(file),
                takenAt: date,
                angle: angle || null,
                phase: phase || null,
                weightKg: displayWeight === null ? null : data.weightUnit === "lb" ? displayWeight / 2.2046226218 : displayWeight,
                workoutId: workoutId || null,
                notes: notes.trim() || null,
            });
            if (!changed) return;
            form.reset();
            setFile(null);
            setDate(todayValue());
            setAngle("");
            setPhase("");
            setWeight(previousWeight == null ? "" : String(previousWeight));
            setWorkoutId("");
            setNotes("");
        } catch (error) {
            setLocalError(error instanceof Error ? error.message : "Could not prepare the selected image.");
        }
    };
    return (
        <PersonalCard title="Add progress photo">
            <form onSubmit={(event) => void submit(event)} className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                <label className="flex flex-col gap-1.5 text-xs font-medium text-secondary md:col-span-2">
                    Image
                    <input type="file" required accept="image/jpeg,image/png,image/gif,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className={inputClass} />
                </label>
                <label className="flex flex-col gap-1.5 text-xs font-medium text-secondary">Date
                    <input type="date" required value={date} onChange={(event) => setDate(event.target.value)} className={inputClass} />
                </label>
                <label className="flex flex-col gap-1.5 text-xs font-medium text-secondary">Weight ({data.weightUnit})
                    <input type="number" min="0" step="0.1" value={weight} onChange={(event) => setWeight(event.target.value)} placeholder="Optional" className={inputClass} />
                </label>
                <label className="flex flex-col gap-1.5 text-xs font-medium text-secondary">Angle
                    <RichSelect aria-label="Progress photo angle" value={angle} onChange={(event) => setAngle(event.target.value)} placeholder="Untagged" options={[{ value: "FRONT", label: "Front" }, { value: "SIDE", label: "Side" }, { value: "BACK", label: "Back" }]} />
                </label>
                <label className="flex flex-col gap-1.5 text-xs font-medium text-secondary">Phase
                    <RichSelect aria-label="Progress photo phase" value={phase} onChange={(event) => setPhase(event.target.value)} placeholder="Untagged" options={[{ value: "BULK", label: "Bulk" }, { value: "CUT", label: "Cut" }, { value: "MAINTAIN", label: "Maintain" }]} />
                </label>
                <label className="flex flex-col gap-1.5 text-xs font-medium text-secondary md:col-span-2">Workout
                    <RichSelect aria-label="Workout linked to progress photo" value={workoutId} onChange={(event) => setWorkoutId(event.target.value)} placeholder="No linked workout" options={data.workoutOptions.map((workout) => ({ value: workout.id, label: workout.label }))} />
                </label>
                <label className="flex flex-col gap-1.5 text-xs font-medium text-secondary md:col-span-2 xl:col-span-3">Notes
                    <input value={notes} maxLength={4000} onChange={(event) => setNotes(event.target.value)} placeholder="Optional context" className={inputClass} />
                </label>
                <div className="flex items-end justify-end"><button type="submit" disabled={mutation.pending} className="rounded-lg bg-brand-solid px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-solid_hover disabled:cursor-not-allowed disabled:opacity-50">{mutation.pending ? "Uploading…" : "Upload photo"}</button></div>
                {localError && <p role="alert" className="text-sm text-error-primary md:col-span-2 xl:col-span-4">{localError}</p>}
            </form>
        </PersonalCard>
    );
}

function ProgressPhotoMetadataEditor({ photo, data, mutation, onClose }: { photo: ProgressPhotoRow; data: ProgressData; mutation: WorkoutMutationControls; onClose: () => void }) {
    const [date, setDate] = useState(photo.takenAt.slice(0, 10));
    const [angle, setAngle] = useState(photo.angle ?? "");
    const [phase, setPhase] = useState(photo.phase ?? "");
    const explicitDisplayWeight = photo.weightKg == null ? null : data.weightUnit === "lb" ? photo.weightKg * 2.2046226218 : photo.weightKg;
    const [weight, setWeight] = useState(explicitDisplayWeight == null ? "" : String(Math.round(explicitDisplayWeight * 10) / 10));
    const [weightChanged, setWeightChanged] = useState(false);
    const [workoutId, setWorkoutId] = useState(photo.workout?.id ?? "");
    const [notes, setNotes] = useState(photo.notes ?? "");
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const displayWeight = numberOrNull(weight);
        const ok = await mutation.run("workouts:updateProgressPhoto", {
            photoId: photo.id,
            takenAt: date,
            angle: angle || null,
            phase: phase || null,
            weightKg: weightChanged ? (displayWeight === null ? null : data.weightUnit === "lb" ? displayWeight / 2.2046226218 : displayWeight) : photo.weightKg,
            workoutId: workoutId || null,
            notes: notes.trim() || null,
        });
        if (ok) onClose();
    };
    return <PersonalCard title="Edit progress photo details" action={<button type="button" onClick={onClose} className="rounded-lg border border-secondary p-2 text-secondary hover:bg-secondary" aria-label="Close photo editor"><XClose className="size-4" /></button>}><form onSubmit={submit} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><label className={fieldLabel}>Date<input type="date" required value={date} onChange={(event) => setDate(event.target.value)} className={fieldClass} /></label><label className={fieldLabel}>Weight ({data.weightUnit})<input type="number" min="0" step="0.1" value={weight} onChange={(event) => { setWeight(event.target.value); setWeightChanged(true); }} className={fieldClass} /></label><label className={fieldLabel}>Angle<RichSelect aria-label="Progress photo angle" value={angle} onChange={(event) => setAngle(event.target.value)} placeholder="Untagged" options={[{ value: "FRONT", label: "Front" }, { value: "SIDE", label: "Side" }, { value: "BACK", label: "Back" }]} /></label><label className={fieldLabel}>Phase<RichSelect aria-label="Progress photo phase" value={phase} onChange={(event) => setPhase(event.target.value)} placeholder="Untagged" options={[{ value: "BULK", label: "Bulk" }, { value: "CUT", label: "Cut" }, { value: "MAINTAIN", label: "Maintain" }]} /></label><label className={`${fieldLabel} md:col-span-2`}>Linked workout<RichSelect aria-label="Workout linked to progress photo" value={workoutId} onChange={(event) => setWorkoutId(event.target.value)} placeholder="No linked workout" options={data.workoutOptions.map((workout) => ({ value: workout.id, label: workout.label }))} /></label><label className={`${fieldLabel} md:col-span-2`}>Notes<input value={notes} maxLength={4000} onChange={(event) => setNotes(event.target.value)} className={fieldClass} /></label><div className="flex justify-end gap-2 md:col-span-2 xl:col-span-4"><button type="button" onClick={onClose} className="rounded-lg border border-secondary px-3 py-2 text-sm font-semibold text-secondary">Cancel</button><button type="submit" disabled={mutation.pending} className="rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Save details</button></div></form></PersonalCard>;
}

function ProgressSection({ data, mutation }: { data: ProgressData; mutation: WorkoutMutationControls }) {
    const [revealed, setRevealed] = useState<Record<string, boolean>>({});
    const [editing, setEditing] = useState<ProgressPhotoRow | null>(null);
    const [angleFilter, setAngleFilter] = useState("");
    const [phaseFilter, setPhaseFilter] = useState("");
    const [beforeId, setBeforeId] = useState(data.photos[data.photos.length - 1]?.id ?? "");
    const [afterId, setAfterId] = useState(data.photos[0]?.id ?? "");
    const filteredPhotos = data.photos.filter((photo) => (!angleFilter || photo.angle === angleFilter) && (!phaseFilter || photo.phase === phaseFilter));
    const beforePhoto = data.photos.find((photo) => photo.id === beforeId);
    const afterPhoto = data.photos.find((photo) => photo.id === afterId);
    return (
        <div className="flex flex-col gap-5">
            <StatGrid
                stats={[
                    { label: "Progress photos", value: data.summary.photoCount, detail: "Across your full timeline" },
                    { label: "Linked sessions", value: data.summary.linkedWorkoutCount, detail: "Photos tied to workouts" },
                    { label: "Timeline", value: data.summary.timelineDays ? `${data.summary.timelineDays} days` : "—", detail: data.summary.firstPhotoAt ? `Since ${dateLabel(data.summary.firstPhotoAt)}` : "No photos yet" },
                    { label: "Latest photo", value: data.summary.latestPhotoAt ? dateLabel(data.summary.latestPhotoAt) : "—", detail: `${data.workoutOptions.length} recent workouts available to link` },
                ]}
            />

            <ProgressPhotoForm data={data} mutation={mutation} />
            {editing && <ProgressPhotoMetadataEditor key={editing.id} photo={editing} data={data} mutation={mutation} onClose={() => setEditing(null)} />}

            {data.photos.length >= 2 && <PersonalCard title="Compare progress"><div className="mb-4 grid gap-3 sm:grid-cols-2"><label className={fieldLabel}>Before<RichSelect aria-label="Before progress photo" value={beforeId} onChange={(event) => setBeforeId(event.target.value)} options={data.photos.map((photo) => ({ value: photo.id, label: `${dateLabel(photo.takenAt)} · ${photo.angle ? titleCase(photo.angle) : "Untagged"}` }))} /></label><label className={fieldLabel}>After<RichSelect aria-label="After progress photo" value={afterId} onChange={(event) => setAfterId(event.target.value)} options={data.photos.map((photo) => ({ value: photo.id, label: `${dateLabel(photo.takenAt)} · ${photo.angle ? titleCase(photo.angle) : "Untagged"}` }))} /></label></div>{beforePhoto && afterPhoto && <div className="grid gap-4 sm:grid-cols-2">{[["Before", beforePhoto], ["After", afterPhoto]].map(([label, photo]) => { const row = photo as ProgressPhotoRow; return <figure key={String(label)} className="overflow-hidden rounded-xl border border-secondary bg-secondary"><div className="relative aspect-[4/3]"><img src={row.thumbnailUrl} alt={`${label} progress from ${dateLabel(row.takenAt)}`} className={`size-full object-cover ${revealed[row.id] ? "" : "blur-md"}`} />{!revealed[row.id] && <button type="button" onClick={() => setRevealed((current) => ({ ...current, [row.id]: true }))} className="absolute inset-x-3 bottom-3 rounded-lg bg-primary/95 px-3 py-2 text-xs font-semibold text-secondary">Reveal {String(label).toLowerCase()}</button>}</div><figcaption className="flex items-center justify-between gap-2 p-3 text-sm"><span className="font-semibold text-primary">{String(label)} · {dateLabel(row.takenAt)}</span><span className="text-tertiary">{row.displayWeight == null ? "" : `${formatNumber(row.displayWeight, 1)} ${data.weightUnit}`}</span></figcaption></figure>; })}</div>}</PersonalCard>}

            <PersonalCard title="Progress timeline" action={<div className="flex w-full flex-wrap items-center gap-2 sm:w-auto"><RichSelect aria-label="Filter progress photos by angle" value={angleFilter} onChange={(event) => setAngleFilter(event.target.value)} placeholder="All angles" className="min-w-32 flex-1 sm:w-36 sm:flex-none" options={[{ value: "FRONT", label: "Front" }, { value: "SIDE", label: "Side" }, { value: "BACK", label: "Back" }]} /><RichSelect aria-label="Filter progress photos by phase" value={phaseFilter} onChange={(event) => setPhaseFilter(event.target.value)} placeholder="All phases" className="min-w-32 flex-1 sm:w-36 sm:flex-none" options={[{ value: "BULK", label: "Bulk" }, { value: "CUT", label: "Cut" }, { value: "MAINTAIN", label: "Maintain" }]} /></div>}>
                {filteredPhotos.length === 0 ? (
                    <EmptyMessage>Add a progress photo to begin a visual training timeline.</EmptyMessage>
                ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {filteredPhotos.map((photo) => (
                            <article key={photo.id} data-photo-id={photo.id} className="overflow-hidden rounded-xl border border-secondary bg-secondary_subtle">
                                <div className="relative aspect-[3/4] overflow-hidden bg-secondary">
                                    <div className="absolute inset-0 flex items-center justify-center text-quaternary">
                                        <Camera01 className="size-8" />
                                    </div>
                                    <img
                                        src={photo.thumbnailUrl}
                                        alt={`Progress from ${dateLabel(photo.takenAt)}`}
                                        loading="lazy"
                                        className={`relative z-10 size-full object-cover transition-[filter] ${revealed[photo.id] ? "" : "blur-md"}`}
                                        onError={(event) => { event.currentTarget.style.display = "none"; }}
                                    />
                                    {!revealed[photo.id] && <button type="button" onClick={() => setRevealed((current) => ({ ...current, [photo.id]: true }))} className="absolute inset-x-3 bottom-3 z-20 rounded-lg border border-secondary bg-primary/95 px-3 py-2 text-xs font-semibold text-secondary shadow-sm backdrop-blur hover:bg-primary">Reveal photo</button>}
                                </div>
                                <div className="relative z-10 p-3">
                                    <div className="flex items-start justify-between gap-2">
                                        <div>
                                            <p className="text-sm font-semibold text-primary">{dateLabel(photo.takenAt)}</p>
                                            <p className="mt-0.5 text-xs text-tertiary">{[photo.angle && titleCase(photo.angle), photo.phase && titleCase(photo.phase)].filter(Boolean).join(" · ") || "Untagged"}</p>
                                        </div>
                                        {photo.displayWeight !== null && (
                                            <span className="text-xs font-medium text-secondary" title={photo.approximateWeight ? "Nearest body-weight entry within three days" : undefined}>
                                                {photo.approximateWeight ? "~" : ""}{formatNumber(photo.displayWeight, 1)} {data.weightUnit}
                                            </span>
                                        )}
                                    </div>
                                    {photo.workout && (
                                        <p data-workout-id={photo.workout.id} className="mt-3 truncate rounded-md bg-brand-secondary px-2 py-1.5 text-xs font-medium text-brand-secondary">
                                            {photo.workout.name} · {dateLabel(photo.workout.date)}
                                        </p>
                                    )}
                                    {photo.notes && <p className="mt-2 line-clamp-2 text-xs text-tertiary">{photo.notes}</p>}
                                    <div className="mt-3 flex items-center justify-between gap-2">
                                        {photo.originalUrl ? <a href={photo.originalUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold text-brand-secondary hover:underline">Open original</a> : <span />}
                                        <div className="flex items-center gap-1"><button type="button" onClick={() => setEditing(photo)} className="inline-flex items-center gap-1 rounded-md border border-secondary px-2 py-1 text-xs font-semibold text-secondary"><Edit01 className="size-3.5" />Edit</button><DeleteButton disabled={mutation.pending} onClick={async () => {
                                            if (window.confirm(`Delete the progress photo from ${dateLabel(photo.takenAt)}?`)) {
                                                await mutation.run("workouts:deleteProgressPhoto", { photoId: photo.id });
                                            }
                                        }} /></div>
                                    </div>
                                </div>
                            </article>
                        ))}
                    </div>
                )}
            </PersonalCard>

            <ProgressWeightChart weightSeries={data.weightSeries} weightUnit={data.weightUnit} />
        </div>
    );
}

function WorkoutTable({
    workouts,
    weightUnit,
    empty,
    onEdit,
    onFinish,
    onPause,
    onRestart,
    onDelete,
    pending = false,
}: {
    workouts: WorkoutRow[];
    weightUnit: string;
    empty: string;
    onEdit?: (workout: WorkoutRow) => void;
    onFinish?: (workout: WorkoutRow) => void | Promise<void>;
    onPause?: (workout: WorkoutRow, paused: boolean) => void | Promise<void>;
    onRestart?: (workout: WorkoutRow) => void | Promise<void>;
    onDelete?: (workout: WorkoutRow) => void | Promise<void>;
    pending?: boolean;
}) {
    const [expandedId, setExpandedId] = useState<string | null>(null);
    if (workouts.length === 0) return <EmptyMessage>{empty}</EmptyMessage>;
    return (
        <div className="divide-y divide-secondary">
            {workouts.map((workout) => {
                const expanded = expandedId === workout.id;
                const lifecycleStatus = workoutDisplayStatus(workout);
                const open = isOpenWorkout(workout);
                const paused = lifecycleStatus === "paused";
                const needsReview = lifecycleStatus === "needs_review";
                return <article key={workout.id} data-workout-id={workout.id} data-template-id={workout.templateId ?? undefined} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                        <button type="button" className="flex w-full min-w-0 flex-1 items-center gap-2 text-left sm:w-auto sm:gap-3" aria-expanded={expanded} onClick={() => setExpandedId(expanded ? null : workout.id)}>
                            <span className="hidden w-24 shrink-0 text-xs text-tertiary sm:block">{dateLabel(workout.date)}</span>
                            <div className="min-w-0 flex-1"><p className="break-words font-medium text-primary">{workout.name}</p><p className="mt-0.5 truncate text-xs text-quaternary">{workout.exerciseNames.length ? workout.exerciseNames.join(" · ") : workout.templateName || "No exercises logged"}</p><span className="mt-1 inline-flex sm:hidden"><StatusBadge status={lifecycleStatus} /></span></div>
                            <span className="hidden sm:inline-flex"><StatusBadge status={lifecycleStatus} /></span>
                            <span className="hidden w-16 text-right text-xs text-secondary lg:block">{workout.completedSets} sets</span>
                            <span className="hidden w-24 text-right text-xs text-secondary xl:block">{formatNumber(workout.volume, 1)} {weightUnit}</span>
                            <span className="hidden w-28 whitespace-nowrap text-right text-xs text-secondary md:block"><LiveWorkoutDuration workout={workout} /></span>
                            <ChevronDown className={`size-4 shrink-0 text-quaternary transition ${expanded ? "rotate-180" : ""}`} />
                        </button>
                        {needsReview && onRestart && <button type="button" disabled={pending} onClick={() => void onRestart(workout)} className="inline-flex items-center gap-1 rounded-md border border-secondary px-2 py-1.5 text-xs font-semibold text-secondary hover:bg-secondary disabled:opacity-50"><RefreshCw01 className="size-3.5" />Restart timer</button>}
                        {!needsReview && open && onPause && <button type="button" disabled={pending} onClick={() => void onPause(workout, !paused)} className="inline-flex items-center gap-1 rounded-md border border-secondary px-2 py-1.5 text-xs font-semibold text-secondary hover:bg-secondary disabled:opacity-50">{paused ? <PlayCircle className="size-3.5" /> : <PauseCircle className="size-3.5" />}{paused ? "Resume" : "Pause"}</button>}
                        {onFinish && open && !needsReview && <button type="button" disabled={pending} onClick={() => void onFinish(workout)} className="inline-flex items-center gap-1 rounded-md bg-success-solid px-2 py-1.5 text-xs font-semibold text-white disabled:opacity-50"><CheckCircle className="size-3.5" />Finish</button>}
                        {onEdit && <button type="button" disabled={pending} onClick={() => onEdit(workout)} className="inline-flex items-center gap-1 rounded-md border border-secondary px-2 py-1.5 text-xs font-semibold text-secondary hover:bg-secondary"><Edit01 className="size-3.5" />{needsReview ? "Review" : "Edit"}</button>}
                        {onDelete && <DeleteButton disabled={pending} onClick={() => onDelete(workout)} />}
                    </div>
                    {expanded && <div className="mt-3 rounded-xl border border-secondary bg-secondary p-3 sm:p-4">
                        <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-tertiary"><span><b className="text-secondary">Started:</b> {dateTimeLabel(workout.startedAt)}</span><span><b className="text-secondary">Finished:</b> {dateTimeLabel(workout.endedAt)}</span><span><b className="text-secondary">RPE:</b> {workout.rpe ?? "—"}</span>{workout.note && <span className="min-w-full"><b className="text-secondary">Notes:</b> {workout.note}</span>}</div>
                        {workout.exercises?.length ? <div className="grid gap-2 xl:grid-cols-2">{workout.exercises.map((exercise) => <div key={exercise.id} className="rounded-lg border border-secondary bg-primary p-3"><div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold text-primary">{exercise.name}</p>{exercise.groupKey && <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-tertiary">Group {exercise.groupKey}</span>}</div>{exercise.note && <p className="mt-1 text-[11px] text-tertiary">{exercise.note}</p>}<div className="mt-2 flex flex-wrap gap-1.5">{exercise.sets.map((set) => <span key={set.order} className={`rounded-md px-2 py-1 text-[11px] ${set.completed ? "bg-success-primary text-success-primary" : "bg-secondary text-tertiary"}`}>#{set.order}{set.warmup ? " · warm-up" : ""}{set.isAmrap ? " · AMRAP" : ""} · {set.weight != null ? `${formatNumber(set.weight, 1)} ${weightUnit}` : ""}{set.weight != null && set.reps != null ? " × " : ""}{set.reps != null ? `${set.reps} reps` : ""}{set.seconds != null ? ` · ${set.seconds}s` : ""}{set.meters != null ? ` · ${set.meters}m` : ""}{set.rpe != null ? ` · RPE ${set.rpe}` : ""}</span>)}</div></div>)}</div> : <p className="text-xs text-tertiary">No exercise detail was logged.</p>}
                    </div>}
                </article>;
            })}
        </div>
    );
}

/** Overview's "Recent workouts" list: click a row to expand its exercises; "Open in log" jumps to the full Log tab. */
function RecentWorkoutsCard({ workouts, weightUnit, onOpenLog }: { workouts: WorkoutRow[]; weightUnit: string; onOpenLog: () => void }) {
    const [expandedId, setExpandedId] = useState<string | null>(null);
    return (
        <PersonalCard
            title="Recent workouts"
            action={<button type="button" onClick={onOpenLog} className="text-sm font-semibold text-brand-secondary hover:underline">Open in log</button>}
        >
            {workouts.length === 0 ? (
                <EmptyMessage>No workouts logged yet.</EmptyMessage>
            ) : (
                <div className="divide-y divide-secondary">
                    {workouts.map((workout) => {
                        const expanded = expandedId === workout.id;
                        return (
                            <div key={workout.id} data-workout-id={workout.id} data-template-id={workout.templateId ?? undefined}>
                                <button
                                    type="button"
                                    onClick={() => setExpandedId(expanded ? null : workout.id)}
                                    aria-expanded={expanded}
                                    className="flex w-full min-w-0 items-center gap-2 py-3 text-left first:pt-0 last:pb-0 sm:gap-4"
                                >
                                    <span className="hidden w-20 shrink-0 text-xs text-tertiary sm:block">{dateLabel(workout.date)}</span>
                                    <div className="min-w-0 flex-1">
                                        <p className="break-words font-medium text-primary">{workout.name}</p>
                                        {workout.templateName && <p className="mt-0.5 truncate text-xs text-quaternary">{workout.templateName}</p>}
                                        <span className="mt-1 inline-flex sm:hidden"><StatusBadge status={workoutDisplayStatus(workout)} /></span>
                                    </div>
                                    <span className="hidden sm:inline-flex"><StatusBadge status={workoutDisplayStatus(workout)} /></span>
                                    <span className="hidden w-24 shrink-0 text-right text-sm text-secondary md:block">{formatNumber(workout.volume)} {weightUnit}</span>
                                    <span className="hidden w-28 shrink-0 whitespace-nowrap text-right text-sm text-secondary lg:block"><LiveWorkoutDuration workout={workout} /></span>
                                    <ChevronDown className={`size-4 shrink-0 text-quaternary transition-transform ${expanded ? "rotate-180" : ""}`} />
                                </button>
                                {expanded && (
                                    <div className="pb-4 sm:pl-[5.5rem]">
                                        {workout.exercises?.length ? (
                                            <div className="space-y-2">
                                                {workout.exercises.map((exercise) => (
                                                    <div key={exercise.id} data-exercise-id={exercise.exerciseId} className="rounded-lg border border-secondary bg-secondary p-2.5">
                                                        <p className="text-xs font-semibold text-primary">{exercise.name}</p>
                                                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                                                            {exercise.sets.map((set) => <span key={set.order} className={`rounded-md px-2 py-1 text-[11px] ${set.completed ? "bg-primary text-secondary" : "bg-secondary text-quaternary"}`}>Set {set.order}{set.warmup ? " · warm-up" : ""} · {set.weight != null ? `${formatNumber(set.weight, 1)} ${weightUnit}` : ""}{set.weight != null && set.reps != null ? " × " : ""}{set.reps != null ? `${set.reps} reps` : ""}{set.seconds != null ? ` · ${set.seconds}s` : ""}{set.meters != null ? ` · ${set.meters}m` : ""}</span>)}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <p className="text-xs text-tertiary">No exercises logged for this session.</p>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </PersonalCard>
    );
}

function ScheduleTable({
    plans,
    empty,
    compact = false,
    onEdit,
    onStart,
    onSkip,
    onOpenWorkout,
    onDelete,
    pending = false,
}: {
    plans: ScheduleRow[];
    empty: string;
    compact?: boolean;
    onEdit?: (plan: ScheduleRow) => void;
    onStart?: (plan: ScheduleRow) => void | Promise<void>;
    onSkip?: (plan: ScheduleRow) => void | Promise<void>;
    onOpenWorkout?: (plan: ScheduleRow) => void;
    onDelete?: (plan: ScheduleRow) => void | Promise<void>;
    pending?: boolean;
}) {
    const visible = compact ? plans.slice(0, 8) : plans;
    return (
        <PersonalTable
            rows={visible}
            empty={empty}
            columns={[
                { key: "date", label: "Date", render: (row) => dateLabel(row.date) },
                {
                    key: "plan",
                    label: "Plan",
                    render: (row) => (
                        <div data-schedule-id={row.id} data-workout-id={row.workoutId ?? undefined} data-template-id={row.templateId ?? undefined}>
                            <p className="font-medium text-primary">{row.name}</p>
                            {row.templateName && row.templateName !== row.name && <p className="mt-0.5 text-xs text-quaternary">{row.templateName}</p>}
                        </div>
                    ),
                },
                { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
                { key: "notes", label: "Notes", render: (row) => row.notes || "—" },
                ...(onDelete || onEdit || onStart || onSkip || onOpenWorkout
                    ? [{ key: "actions", label: "", align: "right" as const, render: (row: ScheduleRow) => <div className="flex min-w-max flex-wrap justify-end gap-1">
                        {row.workoutId && onOpenWorkout && <button type="button" disabled={pending} onClick={() => onOpenWorkout(row)} className="rounded-md border border-secondary px-2 py-1 text-xs font-semibold text-brand-secondary hover:bg-secondary">View workout</button>}
                        {!row.workoutId && onStart && (row.status === "missed" || (row.status === "planned" && row.date === todayValue())) && <button type="button" disabled={pending} onClick={() => void onStart(row)} className="inline-flex items-center gap-1 rounded-md border border-secondary px-2 py-1 text-xs font-semibold text-secondary hover:bg-secondary"><PlayCircle className="size-3.5" />Start</button>}
                        {!row.workoutId && onSkip && <button type="button" disabled={pending} onClick={() => void onSkip(row)} className="inline-flex items-center gap-1 rounded-md border border-secondary px-2 py-1 text-xs font-semibold text-secondary hover:bg-secondary"><SkipForward className="size-3.5" />{row.skipped ? "Restore" : "Skip"}</button>}
                        {!row.workoutId && onEdit && <button type="button" disabled={pending} onClick={() => onEdit(row)} className="inline-flex items-center gap-1 rounded-md border border-secondary px-2 py-1 text-xs font-semibold text-secondary hover:bg-secondary" aria-label={`Change ${row.name}`}><Edit01 className="size-3.5" />Change</button>}
                        {onDelete && <DeleteButton disabled={pending} onClick={() => onDelete(row)} />}
                    </div> }]
                    : []),
            ]}
        />
    );
}

function workoutDisplayStatus(workout: Pick<WorkoutRow, "status" | "pausedAt">): WorkoutLifecycleStatus {
    if (workout.status === "needs_review") return "needs_review";
    if (workout.status === "paused" || (workout.status === "in_progress" && workout.pausedAt)) return "paused";
    return workout.status;
}

function isOpenWorkout(workout: Pick<WorkoutRow, "status" | "pausedAt">): boolean {
    const status = workoutDisplayStatus(workout);
    return status === "in_progress" || status === "paused" || status === "needs_review";
}

function StatusBadge({ status }: { status: string }) {
    const color = status === "completed" || status === "active" || status === "logged"
        ? "success"
        : status === "missed" || status === "needs_review"
            ? "error"
            : status === "in_progress"
                ? "warning"
                : status === "planned" || status === "upcoming" || status === "paused"
                    ? "brand"
                    : "gray";
    const label = status === "needs_review" ? "Needs review" : status === "in_progress" ? "In progress" : titleCase(status);
    return <BadgeWithDot color={color} size="sm">{label}</BadgeWithDot>;
}

function TemplateMetric({ label, value }: { label: string; value: ReactNode }) {
    return (
        <div className="rounded-lg bg-secondary px-3 py-2">
            <p className="text-xs text-tertiary">{label}</p>
            <p className="mt-0.5 font-semibold text-primary">{value}</p>
        </div>
    );
}

function ActionButton({ children, disabled, onClick }: { children: ReactNode; disabled?: boolean; onClick: () => void | Promise<void> }) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={() => void onClick()}
            className="rounded-lg bg-brand-solid px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-solid_hover disabled:cursor-not-allowed disabled:opacity-50"
        >
            {children}
        </button>
    );
}

function DeleteButton({ disabled, onClick }: { disabled?: boolean; onClick: () => void | Promise<void> }) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={() => void onClick()}
            className="rounded-md px-2 py-1 text-xs font-semibold text-error-primary transition hover:bg-error-secondary disabled:cursor-not-allowed disabled:opacity-50"
        >
            Delete
        </button>
    );
}

function todayValue(): string {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 10);
}

function localDateValue(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function scheduleWeekDays(offset: number): Date[] {
    const anchor = new Date();
    anchor.setHours(12, 0, 0, 0);
    anchor.setDate(anchor.getDate() - ((anchor.getDay() + 6) % 7) + offset * 7);
    return Array.from({ length: 7 }, (_, index) => {
        const date = new Date(anchor);
        date.setDate(anchor.getDate() + index);
        return date;
    });
}

function numberOrNull(value: string): number | null {
    if (!value.trim()) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : Number.NaN;
}

function moveLocalDateTime(value: string, date: string): string {
    if (!value || !date) return value;
    const time = value.includes("T") ? value.slice(value.indexOf("T") + 1) : "12:00";
    return `${date}T${time}`;
}

function commaList(value: string): string[] {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function formatNumber(value: number, maximumFractionDigits = 0): string {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(Number.isFinite(value) ? value : 0);
}

function nullableNumber(value: number | null, digits = 0): string {
    return value === null ? "—" : formatNumber(value, digits);
}

function dateLabel(value: string): string {
    const calendarDate = value.match(/^(\d{4}-\d{2}-\d{2})/);
    const date = calendarDate ? new Date(`${calendarDate[1]}T12:00:00`) : new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function dateTimeValue(value: string | null | undefined): string {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function dateTimeLabel(value: string | null | undefined): string {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function shortDate(value: string): string {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDuration(minutes: number | null): string {
    if (minutes === null) return "—";
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

const MAX_OPEN_WORKOUT_SECONDS = 24 * 60 * 60;

function finiteSeconds(value: number | null | undefined): number | null {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null;
}

function clockDuration(totalSeconds: number): string {
    const seconds = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(seconds / 3_600);
    const minutes = Math.floor((seconds % 3_600) / 60);
    const remainder = seconds % 60;
    return hours > 0
        ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
        : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function LiveWorkoutDuration({ workout }: { workout: Pick<WorkoutRow, "status" | "startedAt" | "endedAt" | "pausedAt" | "pausedMs" | "durationMinutes" | "durationSeconds" | "elapsedSeconds"> }) {
    const lifecycleStatus = workoutDisplayStatus(workout);
    const running = lifecycleStatus === "in_progress" && !workout.pausedAt;
    const [clock, setClock] = useState(() => {
        const timestamp = Date.now();
        return { anchor: timestamp, now: timestamp };
    });

    useEffect(() => {
        const timestamp = Date.now();
        setClock({ anchor: timestamp, now: timestamp });
        if (!running || !workout.startedAt) return;
        const timer = window.setInterval(() => setClock((current) => ({ ...current, now: Date.now() })), 1_000);
        return () => window.clearInterval(timer);
    }, [running, workout.startedAt, workout.pausedAt, workout.elapsedSeconds]);

    if (lifecycleStatus === "needs_review") {
        return <span className="font-medium text-error-primary">Review needed</span>;
    }

    if (lifecycleStatus === "completed") {
        let duration = finiteSeconds(workout.durationSeconds);
        if (duration === null && workout.startedAt && workout.endedAt) {
            const started = new Date(workout.startedAt).getTime();
            const ended = new Date(workout.endedAt).getTime();
            if (Number.isFinite(started) && Number.isFinite(ended)) duration = Math.max(0, Math.floor((ended - started - Math.max(0, workout.pausedMs ?? 0)) / 1_000));
        }
        if (duration === null && workout.durationMinutes !== null) duration = Math.max(0, Math.round(workout.durationMinutes * 60));
        return duration === null ? <>—</> : <span className="tabular-nums">{clockDuration(duration)}</span>;
    }

    if (lifecycleStatus === "logged" || !workout.startedAt) return <>—</>;

    let elapsed = finiteSeconds(workout.elapsedSeconds);
    if (elapsed === null) {
        const started = new Date(workout.startedAt).getTime();
        const stoppedAt = workout.pausedAt ? new Date(workout.pausedAt).getTime() : clock.anchor;
        if (Number.isFinite(started) && Number.isFinite(stoppedAt)) elapsed = Math.max(0, Math.floor((stoppedAt - started - Math.max(0, workout.pausedMs ?? 0)) / 1_000));
    }
    if (elapsed === null) return <>—</>;
    if (running) elapsed += Math.max(0, Math.floor((clock.now - clock.anchor) / 1_000));
    if (elapsed >= MAX_OPEN_WORKOUT_SECONDS) return <span className="font-medium text-error-primary">Review needed</span>;

    return <span className={`font-medium tabular-nums ${lifecycleStatus === "paused" ? "text-brand-secondary" : "text-warning-primary"}`}>{clockDuration(elapsed)}</span>;
}

function deltaText(value: number | null, unit: string, suffix: string): string {
    if (value === null) return suffix;
    const sign = value > 0 ? "+" : "";
    const plural = unit === "session" && Math.abs(value) !== 1 ? "sessions" : unit;
    return `${sign}${formatNumber(value, 1)} ${plural} ${suffix}`;
}

function recordValue(record: RecordRow): string {
    return `${formatNumber(record.displayValue, record.displayValue % 1 ? 1 : 0)}${record.displayUnit ? ` ${record.displayUnit}` : ""}`;
}

function recordTypeLabel(recordType: string): string {
    switch (recordType.trim().toLowerCase()) {
        case "1rm": return "Est. 1RM";
        case "volume": return "Set volume";
        case "reps": return "Reps";
        case "time": return "Time";
        case "distance": return "Distance";
        default: return titleCase(recordType);
    }
}

function listLabel(values: string[]): string {
    return values.length ? values.map(titleCase).join(", ") : "—";
}

function trackingLabel(exercise: Pick<ExerciseRow, "tracksReps" | "tracksWeight" | "tracksTime" | "tracksDistance">): string {
    const values = [
        exercise.tracksWeight && "Weight",
        exercise.tracksReps && "Reps",
        exercise.tracksTime && "Time",
        exercise.tracksDistance && "Distance",
    ].filter((value): value is string => Boolean(value));
    return values.join(" · ") || "None";
}

function cmValue(value: number | null): string {
    return value === null ? "—" : `${formatNumber(value, 1)} cm`;
}
