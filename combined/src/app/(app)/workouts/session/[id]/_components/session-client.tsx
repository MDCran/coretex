"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import confetti from "canvas-confetti";
import {
    ArrowLeft,
    ChevronDown,
    ChevronUp,
    Clock,
    Flag01,
    PauseCircle,
    Play,
    Plus,
    RefreshCw01,
    SearchLg,
    SkipForward,
    Trash01,
    Trophy01,
    X,
} from "@untitledui/icons";
import { toast } from "sonner";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { ButtonUtility } from "@/components/base/buttons/button-utility";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import {
    addSet,
    addWorkoutExercise,
    deleteSet,
    deleteWorkout,
    finishWorkout,
    removeWorkoutExercise,
    reopenWorkout,
    reorderWorkoutExercise,
    setWorkoutPaused,
    toggleSetComplete,
    updateSet,
} from "@/lib/actions/workouts-session";
import { quickCreateExercise } from "@/lib/actions/workouts-exercises";
import { DEFAULT_EXERCISE_REST_SEC, formatStopwatch, resolveSetRest, titleCase } from "@/lib/workouts";
import { type CurrentPRs, isPrSet, isPrMatch, type LastTimePerf, type LibraryLastDone } from "@/lib/workouts-history";
import { cx } from "@/utils/cx";
import { useConfirm } from "@/components/application/confirm-dialog/confirm-dialog";
import { type UnitSystem, parseWeightInput, weightToDisplay, weightUnit } from "@/lib/units";
import { ExercisePickerModal, type ExerciseLibraryItem } from "../../../exercises/_components/exercise-library-picker";
import { Card, Field, NativeInput, NativeTextarea } from "../../../_components/workouts-ui";

type Caps = { reps: boolean; weight: boolean; time: boolean; distance: boolean };

type SessionSet = {
    id: string;
    order: number;
    targetReps: number | null;
    actualReps: number | null;
    targetWeight: number | null;
    actualWeight: number | null;
    targetSeconds: number | null;
    actualSeconds: number | null;
    targetMeters: number | null;
    actualMeters: number | null;
    rpe: number | null;
    targetRpe: number | null;
    isWarmup: boolean;
    isAmrap: boolean;
    completed: boolean;
    restTakenSec: number | null;
};

type SessionWE = {
    id: string;
    order: number;
    note: string | null;
    groupKey: string | null;
    restSec: number | null;
    tempo: string | null;
    exercise: { id: string; name: string; slug: string; muscles: string[]; tracksReps: boolean; tracksWeight: boolean; tracksTime: boolean; tracksDistance: boolean };
    sets: SessionSet[];
};

type SessionWorkout = {
    id: string;
    name: string | null;
    note: string | null;
    rpe: number | null;
    endedAt: string | null;
    startedAt: string | null;
    pausedMs: number;
    pausedAt: string | null;
    exercises: SessionWE[];
};

/** Short "measured by" hint for an exercise, e.g. "Reps + weight" or "Time + distance". */
function measureHint(e: { tracksReps: boolean; tracksWeight: boolean; tracksTime: boolean; tracksDistance: boolean }): string {
    const parts: string[] = [];
    if (e.tracksReps) parts.push("Reps");
    if (e.tracksWeight) parts.push("Weight");
    if (e.tracksTime) parts.push("Time");
    if (e.tracksDistance) parts.push("Distance");
    if (parts.length === 0) return "Custom";
    return parts.join(" + ");
}

// ─────────────────────────────────────────────────────────────────────────────
// Rest stopwatch — global controller (one stopwatch on screen at a time)
// ─────────────────────────────────────────────────────────────────────────────

type RestTarget = {
    setId: string; // the completed set this rest belongs to
    targetSec: number;
    label: string; // e.g. "Bench Press" or "Next exercise"
    startedAt: number;
};

type RestController = {
    active: RestTarget | null;
    /** start a rest for a set; if one is running, auto-finish it first */
    start: (t: Omit<RestTarget, "startedAt">) => void;
    /** finish the running rest, persisting elapsed seconds to its set */
    finish: () => void;
    /** stop without logging */
    skip: () => void;
};

const PR_CONFETTI_OPTS: confetti.Options = { particleCount: 90, spread: 70, origin: { y: 0.7 }, scalar: 0.9 };

function fireConfetti() {
    confetti(PR_CONFETTI_OPTS);
    setTimeout(() => confetti({ ...PR_CONFETTI_OPTS, particleCount: 50, angle: 60, origin: { x: 0, y: 0.8 } }), 120);
    setTimeout(() => confetti({ ...PR_CONFETTI_OPTS, particleCount: 50, angle: 120, origin: { x: 1, y: 0.8 } }), 120);
}

export function SessionClient({
    workout,
    library,
    lastTime,
    currentPRs,
    libraryLastDone,
    unitSystem,
}: {
    workout: SessionWorkout;
    library: ExerciseLibraryItem[];
    lastTime: Record<string, LastTimePerf>;
    currentPRs: Record<string, CurrentPRs>;
    libraryLastDone: Record<string, LibraryLastDone>;
    unitSystem: UnitSystem;
}) {
    const router = useRouter();
    const finished = !!workout.endedAt;

    // Session totals shown in the header meta line.
    const stats = useMemo(() => {
        let totalSets = 0;
        let doneSets = 0;
        let volumeKg = 0;
        for (const we of workout.exercises) {
            for (const s of we.sets) {
                totalSets++;
                if (s.completed) {
                    doneSets++;
                    if (!s.isWarmup && s.actualReps != null && s.actualWeight != null) volumeKg += s.actualReps * s.actualWeight;
                }
            }
        }
        return { totalSets, doneSets, exercises: workout.exercises.length, volumeKg };
    }, [workout.exercises]);

    const [pickerOpen, setPickerOpen] = useState(false);
    const [finishOpen, setFinishOpen] = useState(false);
    const [pending, startTransition] = useTransition();
    const { confirm, dialog } = useConfirm();

    // ── Rest stopwatch controller ────────────────────────────────────────────
    const [rest, setRest] = useState<RestTarget | null>(null);
    const restRef = useRef<RestTarget | null>(null);
    restRef.current = rest;

    const persistRest = useCallback((setId: string, elapsedSec: number) => {
        // fire-and-forget; revalidate refreshes the row tag
        updateSet(workout.id, setId, { restTakenSec: elapsedSec })
            .then(() => router.refresh())
            .catch(() => {});
    }, [router, workout.id]);

    const restController = useMemo<RestController>(() => {
        const finishCurrent = (log: boolean) => {
            const cur = restRef.current;
            if (cur) {
                if (log) {
                    const elapsed = Math.round((Date.now() - cur.startedAt) / 1000);
                    persistRest(cur.setId, elapsed);
                }
            }
            setRest(null);
        };
        return {
            get active() {
                return restRef.current;
            },
            start: (t) => {
                // starting a new rest auto-finishes (logs) a running one
                const cur = restRef.current;
                if (cur && cur.setId !== t.setId) {
                    const elapsed = Math.round((Date.now() - cur.startedAt) / 1000);
                    persistRest(cur.setId, elapsed);
                }
                setRest({ ...t, startedAt: Date.now() });
            },
            finish: () => finishCurrent(true),
            skip: () => finishCurrent(false),
        };
    }, [persistRest]);

    // ── Confetti on set-level PR (fired by SetRow via callback) ───────────────
    const celebratePr = useCallback((exerciseName: string) => {
        fireConfetti();
        toast.success(`PR! ${exerciseName}`, { duration: 4000 });
    }, []);

    const onFinish = (note: string | null, rpe: number | null) => {
        startTransition(async () => {
            try {
                const { prs } = await finishWorkout(workout.id, { note, rpe });
                setFinishOpen(false);
                if (prs.length > 0) {
                    fireConfetti();
                    toast.success(`New PR on ${prs.join(", ")}!`, { duration: 5000 });
                } else toast.success("Workout finished");
                router.refresh();
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed to finish");
            }
        });
    };

    const onReopen = () =>
        startTransition(async () => {
            await reopenWorkout(workout.id);
            toast.success("Workout reopened");
            router.refresh();
        });

    const onDelete = () => {
        confirm({
            title: "Delete this workout permanently?",
            destructive: true,
            confirmLabel: "Delete",
            onConfirm: () =>
                startTransition(async () => {
                    await deleteWorkout(workout.id);
                    router.push("/workouts/log");
                }),
        });
    };

    return (
        <div className="flex flex-col gap-5 px-4 py-6 pb-28 lg:px-8">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <ButtonUtility size="sm" color="tertiary" icon={ArrowLeft} tooltip="Back to log" onClick={() => router.push("/workouts/log")} />
                    <div>
                        <h1 className="text-display-xs font-semibold text-primary">{workout.name ?? "Workout"}</h1>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-tertiary">
                            <SessionClock
                                workoutId={workout.id}
                                startedAt={workout.startedAt}
                                endedAt={workout.endedAt}
                                pausedMs={workout.pausedMs}
                                pausedAt={workout.pausedAt}
                            />
                            <span aria-hidden="true">·</span>
                            <span className="tabular-nums">
                                {stats.doneSets}/{stats.totalSets} sets
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="tabular-nums">{stats.exercises} {stats.exercises === 1 ? "exercise" : "exercises"}</span>
                            {stats.volumeKg > 0 && (
                                <>
                                    <span aria-hidden="true">·</span>
                                    <span className="tabular-nums">
                                        {Math.round(weightToDisplay(stats.volumeKg, unitSystem)).toLocaleString()} {weightUnit(unitSystem)} vol
                                    </span>
                                </>
                            )}
                            {finished && (
                                <Badge color="success" size="sm">
                                    Finished
                                </Badge>
                            )}
                        </div>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button size="md" color="secondary-destructive" iconLeading={Trash01} isDisabled={pending} onClick={onDelete}>
                        Delete
                    </Button>
                    {finished ? (
                        <Button size="md" color="secondary" iconLeading={RefreshCw01} onClick={onReopen} isLoading={pending}>
                            Reopen
                        </Button>
                    ) : (
                        <Button size="md" color="primary" iconLeading={Flag01} onClick={() => setFinishOpen(true)} isLoading={pending}>
                            Finish
                        </Button>
                    )}
                </div>
            </div>

            {workout.exercises.length === 0 ? (
                <Card className="flex flex-col items-center gap-3 py-12 text-center">
                    <p className="text-sm text-tertiary">No exercises yet. Add one to start logging.</p>
                    <Button color="primary" iconLeading={Plus} onClick={() => setPickerOpen(true)}>
                        Add exercise
                    </Button>
                </Card>
            ) : (
                <div className="flex flex-col gap-4">
                    {workout.exercises.map((we, i) => (
                        <ExerciseCard
                            key={we.id}
                            workoutId={workout.id}
                            we={we}
                            isFirst={i === 0}
                            isLast={i === workout.exercises.length - 1}
                            disabled={finished}
                            rest={restController}
                            lastTime={lastTime[we.exercise.id]}
                            prs={currentPRs[we.exercise.id]}
                            onPr={() => celebratePr(we.exercise.name)}
                            unitSystem={unitSystem}
                        />
                    ))}
                    <Button color="secondary" iconLeading={Plus} onClick={() => setPickerOpen(true)} isDisabled={finished}>
                        Add exercise
                    </Button>
                </div>
            )}

            {pickerOpen && (
                <ExercisePickerModal
                    exercises={library}
                    lastDone={libraryLastDone}
                    existingIds={workout.exercises.map((e) => e.exercise.id)}
                    onClose={() => setPickerOpen(false)}
                    onPick={(id) =>
                        startTransition(async () => {
                            await addWorkoutExercise(workout.id, id);
                            setPickerOpen(false);
                            router.refresh();
                        })
                    }
                    onCreate={(name) =>
                        startTransition(async () => {
                            const created = await quickCreateExercise(name);
                            await addWorkoutExercise(workout.id, created.id);
                            setPickerOpen(false);
                            router.refresh();
                        })
                    }
                />
            )}

            <FinishDialog open={finishOpen} onClose={() => setFinishOpen(false)} onConfirm={onFinish} pending={pending} defaultNote={workout.note} defaultRpe={workout.rpe} />

            {/* Sticky rest stopwatch */}
            {rest && !finished && <RestStopwatch rest={rest} onFinish={restController.finish} onSkip={restController.skip} />}

            {dialog}
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Session clock (with client-side pause/resume)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Durable elapsed clock. Pause state lives on the server (workout.pausedAt /
 * pausedMs) so it survives the router.refresh() fired by every set mutation and
 * a full page reload. Toggling persists via setWorkoutPaused then refreshes.
 */
function SessionClock({
    workoutId,
    startedAt,
    endedAt,
    pausedMs,
    pausedAt,
}: {
    workoutId: string;
    startedAt: string | null;
    endedAt: string | null;
    pausedMs: number;
    pausedAt: string | null;
}) {
    const router = useRouter();
    const [now, setNow] = useState(() => Date.now());
    const [mounted, setMounted] = useState(false);
    const [pending, startTransition] = useTransition();
    const paused = pausedAt != null;

    useEffect(() => setMounted(true), []);

    useEffect(() => {
        if (endedAt || !startedAt || paused) return;
        setNow(Date.now()); // resync immediately on (re)start/resume so the clock never ticks backward
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, [endedAt, startedAt, paused]);

    if (!startedAt) return null;

    const startMs = new Date(startedAt).getTime();
    let end: number;
    if (endedAt) end = new Date(endedAt).getTime();
    else if (paused) end = new Date(pausedAt).getTime();
    // Before client mount, render a deterministic value (elapsed 0) so the SSR
    // and first client render agree — avoids a hydration mismatch on the clock.
    else if (!mounted) end = startMs + pausedMs;
    else end = now;
    // When finished while paused, still subtract that final pause window.
    const tailPause = endedAt && pausedAt ? Math.max(0, new Date(endedAt).getTime() - new Date(pausedAt).getTime()) : 0;
    const elapsed = Math.max(0, end - startMs - pausedMs - tailPause);
    const m = Math.floor(elapsed / 60000);
    const s = Math.floor((elapsed % 60000) / 1000);
    const clock = m < 60 ? `${m}:${String(s).padStart(2, "0")}` : `${Math.floor(m / 60)}h ${m % 60}m`;

    const togglePause = () =>
        startTransition(async () => {
            try {
                await setWorkoutPaused(workoutId, !paused);
                router.refresh();
            } catch {
                /* ignore */
            }
        });

    return (
        <span className="inline-flex items-center gap-1.5">
            <span className={cx("inline-flex items-center gap-1 font-mono tabular-nums", paused && "text-warning-primary")}>
                <Clock className="size-3.5" /> {clock}
                {paused && " (paused)"}
            </span>
            {!endedAt && (
                <button
                    type="button"
                    onClick={togglePause}
                    disabled={pending}
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-tertiary ring-1 ring-secondary ring-inset hover:bg-secondary_hover disabled:opacity-50"
                >
                    {paused ? <Play className="size-3" /> : <PauseCircle className="size-3" />}
                    {paused ? "Resume" : "Pause"}
                </button>
            )}
        </span>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Rest stopwatch — sticky bottom bar that counts UP from 0
// ─────────────────────────────────────────────────────────────────────────────

function RestStopwatch({ rest, onFinish, onSkip }: { rest: RestTarget; onFinish: () => void; onSkip: () => void }) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 250);
        return () => clearInterval(id);
    }, []);

    const elapsed = Math.max(0, Math.floor((now - rest.startedAt) / 1000));
    const over = elapsed > rest.targetSec;
    const pct = Math.min(100, (elapsed / rest.targetSec) * 100);

    return (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-secondary bg-primary/95 px-4 py-3 shadow-xl backdrop-blur lg:px-8">
            <div className="mx-auto flex max-w-3xl items-center gap-4">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-baseline gap-2">
                            <span className={cx("font-mono text-2xl font-bold tabular-nums", over ? "text-error-primary" : "text-success-primary")}>
                                {formatStopwatch(elapsed)}
                            </span>
                            <span className="truncate text-xs text-tertiary">
                                {rest.label} · {formatStopwatch(rest.targetSec)} recommended
                            </span>
                        </div>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-quaternary">
                        <div
                            className={cx("h-full rounded-full transition-[width] duration-200 ease-linear", over ? "bg-error-solid" : "bg-success-solid")}
                            style={{ width: `${over ? 100 : pct}%` }}
                        />
                    </div>
                </div>
                <div className="flex shrink-0 gap-2">
                    <Button size="sm" color="secondary" iconLeading={SkipForward} onClick={onSkip}>
                        Skip
                    </Button>
                    <Button size="sm" color="primary" onClick={onFinish}>
                        Finish rest
                    </Button>
                </div>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Exercise card
// ─────────────────────────────────────────────────────────────────────────────

function ExerciseCard({
    workoutId,
    we,
    isFirst,
    isLast,
    disabled,
    rest,
    lastTime,
    prs,
    onPr,
    unitSystem,
}: {
    workoutId: string;
    we: SessionWE;
    isFirst: boolean;
    isLast: boolean;
    disabled: boolean;
    rest: RestController;
    lastTime: LastTimePerf | undefined;
    prs: CurrentPRs | undefined;
    onPr: () => void;
    unitSystem: UnitSystem;
}) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const { confirm, dialog } = useConfirm();
    const caps: Caps = {
        reps: we.exercise.tracksReps,
        weight: we.exercise.tracksWeight,
        time: we.exercise.tracksTime,
        distance: we.exercise.tracksDistance,
    };

    const move = (direction: "up" | "down") =>
        startTransition(async () => {
            await reorderWorkoutExercise(workoutId, we.id, direction);
            router.refresh();
        });

    const remove = () => {
        confirm({
            title: `Remove "${we.exercise.name}" and its sets from this workout?`,
            destructive: true,
            confirmLabel: "Remove",
            onConfirm: () =>
                startTransition(async () => {
                    await removeWorkoutExercise(workoutId, we.id);
                    router.refresh();
                }),
        });
    };

    return (
        <Card>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/workouts/exercises/${we.exercise.slug}`} className="text-lg font-semibold text-primary hover:underline">
                            {we.exercise.name}
                        </Link>
                        {we.groupKey && (
                            <Badge color="purple" size="sm">
                                Superset {we.groupKey}
                            </Badge>
                        )}
                        {we.tempo && (
                            <span className="rounded-md bg-secondary px-1.5 py-0.5 font-mono text-xs tabular-nums text-secondary" title="Eccentric · pause · concentric · rest">
                                {we.tempo}
                            </span>
                        )}
                    </div>
                    {we.exercise.muscles.length > 0 && <p className="mt-0.5 truncate text-xs text-tertiary">{we.exercise.muscles.slice(0, 4).map(titleCase).join(" · ")}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    <ButtonUtility size="sm" color="tertiary" icon={ChevronUp} tooltip="Move up" isDisabled={isFirst || disabled || pending} onClick={() => move("up")} />
                    <ButtonUtility size="sm" color="tertiary" icon={ChevronDown} tooltip="Move down" isDisabled={isLast || disabled || pending} onClick={() => move("down")} />
                    <ButtonUtility size="sm" color="tertiary" icon={Trash01} tooltip="Remove exercise" isDisabled={disabled || pending} onClick={remove} />
                </div>
            </div>

            <LastTimePanel lastTime={lastTime} caps={caps} unitSystem={unitSystem} />

            <SetList workoutId={workoutId} we={we} caps={caps} disabled={disabled} rest={rest} prs={prs} onPr={onPr} unitSystem={unitSystem} />

            {dialog}
        </Card>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Last-time performance panel
// ─────────────────────────────────────────────────────────────────────────────

function LastTimePanel({ lastTime, caps, unitSystem }: { lastTime: LastTimePerf | undefined; caps: Caps; unitSystem: UnitSystem }) {
    if (!lastTime || lastTime.sets.length === 0) return null;
    const date = new Date(`${lastTime.date}T00:00:00`);
    const chip = (s: LastTimePerf["sets"][number]) => {
        // s.weight is stored kg; show in the chosen unit.
        if (caps.weight && caps.reps && s.weight != null && s.reps != null) return `${s.reps}×${weightToDisplay(s.weight, unitSystem)}`;
        if (caps.reps && s.reps != null) return `${s.reps} reps`;
        if (caps.time && s.seconds != null) return formatStopwatch(s.seconds);
        if (caps.distance && s.meters != null) return s.meters >= 1000 ? `${+(s.meters / 1000).toFixed(2)}km` : `${s.meters}m`;
        return null;
    };
    const chips = lastTime.sets.map(chip).filter(Boolean) as string[];
    if (chips.length === 0) return null;
    return (
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-secondary_subtle px-3 py-2">
            <span className="text-[11px] font-semibold tracking-wide text-quaternary uppercase">Last time</span>
            <span className="text-[11px] text-tertiary">{date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
            <div className="flex flex-wrap gap-1">
                {chips.map((c, i) => (
                    <span key={i} className="rounded-md bg-secondary px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-secondary">
                        {c}
                    </span>
                ))}
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Set list
// ─────────────────────────────────────────────────────────────────────────────

function SetList({
    workoutId,
    we,
    caps,
    disabled,
    rest,
    prs,
    onPr,
    unitSystem,
}: {
    workoutId: string;
    we: SessionWE;
    caps: Caps;
    disabled: boolean;
    rest: RestController;
    prs: CurrentPRs | undefined;
    onPr: () => void;
    unitSystem: UnitSystem;
}) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const setRestTarget = resolveSetRest(we.restSec);

    const addRow = (isWarmup: boolean) =>
        startTransition(async () => {
            await addSet(workoutId, we.id, isWarmup);
            router.refresh();
        });

    return (
        <div className="mt-3 flex flex-col gap-1.5">
            <div
                className="grid items-center gap-2 px-1 text-[10px] font-semibold tracking-wider text-quaternary uppercase"
                style={{ gridTemplateColumns: gridTemplate(caps) }}
            >
                <span className="text-center">Set</span>
                {caps.weight && <span className="text-center">{weightUnit(unitSystem)}</span>}
                {caps.reps && <span className="text-center">Reps</span>}
                {caps.time && <span className="text-center">Sec</span>}
                {caps.distance && <span className="text-center">m</span>}
                <span className="text-center">RPE</span>
                <span className="text-center">✓</span>
                <span />
            </div>

            {we.sets.map((s, i) => {
                // last working set → use between-exercise rest default + label
                const workingSets = we.sets.filter((x) => !x.isWarmup);
                const isLastWorking = !s.isWarmup && workingSets[workingSets.length - 1]?.id === s.id;
                return (
                    <SetRow
                        key={s.id}
                        workoutId={workoutId}
                        set={s}
                        index={i}
                        caps={caps}
                        disabled={disabled}
                        rest={rest}
                        restTarget={isLastWorking ? DEFAULT_EXERCISE_REST_SEC : setRestTarget}
                        restLabel={isLastWorking ? "Next exercise" : we.exercise.name}
                        prs={prs}
                        onPr={onPr}
                        unitSystem={unitSystem}
                    />
                );
            })}

            {!disabled && (
                <div className="mt-1 flex gap-2">
                    <Button size="sm" color="secondary" iconLeading={Plus} onClick={() => addRow(false)} isLoading={pending}>
                        Add set
                    </Button>
                    <Button size="sm" color="tertiary" onClick={() => addRow(true)} isDisabled={pending}>
                        + Warmup
                    </Button>
                </div>
            )}
        </div>
    );
}

const RPE_STEPS = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];

function SetRow({
    workoutId,
    set,
    index,
    caps,
    disabled,
    rest,
    restTarget,
    restLabel,
    prs,
    onPr,
    unitSystem,
}: {
    workoutId: string;
    set: SessionSet;
    index: number;
    caps: Caps;
    disabled: boolean;
    rest: RestController;
    restTarget: number;
    restLabel: string;
    prs: CurrentPRs | undefined;
    onPr: () => void;
    unitSystem: UnitSystem;
}) {
    const router = useRouter();
    const [, startTransition] = useTransition();
    const [rpeOpen, setRpeOpen] = useState(false);

    // Badge persists for the set that holds the current PR (matches), even after
    // recompute folds it into the stored record; confetti uses strict-beat below.
    const isPr = set.completed && isPrMatch(set, prs);

    const patch = (data: Parameters<typeof updateSet>[2]) =>
        startTransition(async () => {
            await updateSet(workoutId, set.id, data);
            router.refresh();
        });

    const toggle = () => {
        const next = !set.completed;
        // completing a working set: check PR + start rest stopwatch
        if (next && !set.isWarmup) {
            if (isPrSet(set, prs)) onPr();
            rest.start({ setId: set.id, targetSec: restTarget, label: restLabel });
        }
        startTransition(async () => {
            await toggleSetComplete(workoutId, set.id, next);
            router.refresh();
        });
    };

    const remove = () =>
        startTransition(async () => {
            await deleteSet(workoutId, set.id);
            router.refresh();
        });

    const label = set.isWarmup ? "W" : set.isAmrap ? "∞" : index + 1;
    const restOver = set.restTakenSec != null && set.restTakenSec > restTarget;

    return (
        <div>
            <div
                className={cx("grid items-center gap-2 rounded-lg px-1 py-1.5", set.completed ? "bg-success-primary/40" : set.isWarmup ? "bg-secondary" : "bg-secondary_subtle")}
                style={{ gridTemplateColumns: gridTemplate(caps) }}
            >
                <div
                    className="mx-auto flex size-8 items-center justify-center rounded-md bg-tertiary text-xs font-semibold text-secondary"
                    title={set.isWarmup ? "Warmup" : set.isAmrap ? "AMRAP — go to failure" : `Set ${index + 1}`}
                >
                    {label}
                </div>
                {caps.weight && (
                    <NumCell
                        value={set.actualWeight}
                        placeholder={set.targetWeight != null ? numStr(weightToDisplay(set.targetWeight, unitSystem)) : numStr(null)}
                        step="0.5"
                        disabled={disabled}
                        onCommit={(v) => patch({ actualWeight: v })}
                        toDisplay={(kg) => weightToDisplay(kg, unitSystem)}
                        fromDisplay={(d) => parseWeightInput(d, unitSystem) ?? d}
                    />
                )}
                {caps.reps && <NumCell value={set.actualReps} placeholder={numStr(set.targetReps)} disabled={disabled} onCommit={(v) => patch({ actualReps: v })} />}
                {caps.time && <NumCell value={set.actualSeconds} placeholder={numStr(set.targetSeconds)} disabled={disabled} onCommit={(v) => patch({ actualSeconds: v })} />}
                {caps.distance && <NumCell value={set.actualMeters} placeholder={numStr(set.targetMeters)} disabled={disabled} onCommit={(v) => patch({ actualMeters: v })} />}
                <div className="relative flex justify-center">
                    <button
                        type="button"
                        disabled={disabled}
                        onClick={() => setRpeOpen((o) => !o)}
                        className="rounded-md bg-tertiary px-1.5 py-1 text-xs font-medium text-secondary disabled:opacity-50"
                    >
                        {set.rpe ?? set.targetRpe ?? "—"}
                    </button>
                    {rpeOpen && (
                        <div className="absolute top-9 z-20 flex max-w-44 flex-wrap gap-1 rounded-lg bg-primary p-2 shadow-lg ring-1 ring-secondary">
                            {RPE_STEPS.map((v) => (
                                <button
                                    key={v}
                                    type="button"
                                    onClick={() => {
                                        patch({ rpe: v });
                                        setRpeOpen(false);
                                    }}
                                    className="rounded-md bg-secondary px-1.5 py-0.5 font-mono text-xs text-secondary hover:bg-secondary_hover"
                                >
                                    {v}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                <button
                    type="button"
                    disabled={disabled}
                    onClick={toggle}
                    aria-label="Toggle complete"
                    className={cx(
                        "mx-auto flex size-8 items-center justify-center rounded-md transition disabled:opacity-50",
                        set.completed ? "bg-success-solid text-white" : "bg-tertiary text-fg-quaternary hover:bg-quaternary",
                    )}
                >
                    ✓
                </button>
                {!disabled ? <ButtonUtility size="xs" color="tertiary" icon={Trash01} tooltip="Delete set" onClick={remove} /> : <span />}
            </div>

            {(isPr || set.restTakenSec != null) && (
                <div className="mt-0.5 flex items-center gap-1.5 pl-10 text-[11px]">
                    {isPr && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-brand-solid px-1.5 py-0.5 font-semibold text-white">
                            <Trophy01 className="size-3" /> PR
                        </span>
                    )}
                    {set.restTakenSec != null && (
                        <span className={cx("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium", restOver ? "bg-error-secondary text-error-primary" : "bg-secondary text-tertiary")}>
                            <Clock className="size-3" /> rested {formatStopwatch(set.restTakenSec)}
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}

function NumCell({
    value,
    placeholder,
    step = "1",
    disabled,
    onCommit,
    toDisplay,
    fromDisplay,
}: {
    value: number | null;
    placeholder?: string;
    step?: string;
    disabled?: boolean;
    onCommit: (n: number | null) => void;
    // Optional unit transforms: value/onCommit are in the stored (metric) unit,
    // while the input shows/accepts the display unit. Defaults to identity.
    toDisplay?: (n: number) => number;
    fromDisplay?: (n: number) => number;
}) {
    const show = (n: number) => (toDisplay ? toDisplay(n) : n);
    const [local, setLocal] = useState(value == null ? "" : String(show(value)));
    useEffect(() => setLocal(value == null ? "" : String(show(value))), [value, toDisplay]);

    const commit = () => {
        if (local === "") {
            if (value != null) onCommit(null);
            return;
        }
        const d = Number(local);
        if (!Number.isFinite(d)) return;
        const n = fromDisplay ? fromDisplay(d) : d;
        if (n !== value) onCommit(n);
    };

    return (
        <input
            type="text"
            inputMode="decimal"
            disabled={disabled}
            value={local}
            placeholder={placeholder ?? "—"}
            data-step={step}
            onChange={(e) => setLocal(e.target.value.replace(/[^\d.]/g, ""))}
            onBlur={commit}
            onKeyDown={(e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    commit();
                    (e.target as HTMLInputElement).blur();
                }
            }}
            className="h-9 w-full rounded-md bg-primary text-center font-mono text-sm tabular-nums text-primary ring-1 ring-primary ring-inset outline-none placeholder:text-placeholder focus:outline-2 focus:-outline-offset-2 focus:outline-brand disabled:opacity-50"
        />
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Finish dialog
// ─────────────────────────────────────────────────────────────────────────────

function FinishDialog({
    open,
    onClose,
    onConfirm,
    pending,
    defaultNote,
    defaultRpe,
}: {
    open: boolean;
    onClose: () => void;
    onConfirm: (note: string | null, rpe: number | null) => void;
    pending: boolean;
    defaultNote: string | null;
    defaultRpe: number | null;
}) {
    const [note, setNote] = useState(defaultNote ?? "");
    const [rpe, setRpe] = useState(defaultRpe != null ? String(defaultRpe) : "");

    return (
        <ModalOverlay isOpen={open} onOpenChange={(v) => !v && onClose()}>
            <Modal className="max-w-md">
                <Dialog aria-label="Finish workout">
                    <div className="w-full rounded-2xl bg-primary p-6 shadow-xl ring-1 ring-secondary">
                        <h2 className="text-lg font-semibold text-primary">Finish workout</h2>
                        <p className="mt-1 text-sm text-tertiary">Progression and personal records update automatically.</p>
                        <div className="mt-4 flex flex-col gap-4">
                            <Field label="Session RPE" hint="Overall perceived exertion (6–10)">
                                <NativeInput type="number" min={1} max={10} step={0.5} value={rpe} onChange={(e) => setRpe(e.target.value)} placeholder="e.g. 8" />
                            </Field>
                            <Field label="Notes">
                                <NativeTextarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="How did it go?" />
                            </Field>
                        </div>
                        <div className="mt-6 flex justify-end gap-2">
                            <Button color="secondary" onClick={onClose}>
                                Cancel
                            </Button>
                            <Button color="primary" iconLeading={Flag01} isLoading={pending} onClick={() => onConfirm(note.trim() || null, rpe ? Number(rpe) : null)}>
                                Finish
                            </Button>
                        </div>
                    </div>
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function gridTemplate(caps: Caps) {
    const cols = ["2.5rem"];
    if (caps.weight) cols.push("minmax(0,1fr)");
    if (caps.reps) cols.push("minmax(0,1fr)");
    if (caps.time) cols.push("minmax(0,1fr)");
    if (caps.distance) cols.push("minmax(0,1fr)");
    cols.push("2.75rem", "2.25rem", "2rem");
    return cols.join(" ");
}

function numStr(n: number | null): string | undefined {
    return n == null ? undefined : String(n);
}
