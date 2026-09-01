// @ts-nocheck
import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Check, Flag01, Plus, RefreshCw01, Trash01 } from "@untitledui/icons";
import { toast } from "sonner";
import { Button } from "@/components/base/buttons/button";
import { Select } from "@/components/base/select/select";
import { cx } from "@/utils/cx";
import {
    addSet,
    addWorkoutExercise,
    createBlankWorkout,
    createWorkoutFromTemplate,
    deleteSet,
    finishWorkout,
    toggleSetComplete,
    updateSet,
} from "@/lib/actions/workouts-session";
import {
    getWorkoutsWidgetSnapshot,
    type WorkoutsWidgetSnapshot,
    type WorkoutWidgetExercise,
    type WorkoutWidgetSet,
} from "@/lib/actions/widget-snapshots";
import { parseWeightInput, weightToDisplay, weightUnit, type UnitSystem } from "@/lib/units";

function formatElapsed(startedAt: string): string {
    const ms = Math.max(0, Date.now() - new Date(startedAt).getTime());
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
    return `${m}:${s.toString().padStart(2, "0")}`;
}

export function WorkoutsWidgetPanel() {
    const [data, setData] = useState<WorkoutsWidgetSnapshot | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        try {
            setData(await getWorkoutsWidgetSnapshot());
        } catch {
            /* optional poll */
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
        const id = setInterval(() => void load(), 15000);
        return () => clearInterval(id);
    }, [load]);

    // UTC day key — dateKeyToUtc() on the server parses this as UTC midnight.
    const today = () => new Date().toISOString().slice(0, 10);

    async function startBlank() {
        setBusy(true);
        try {
            await createBlankWorkout(today());
            await load();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't start workout");
        } finally {
            setBusy(false);
        }
    }

    async function startTemplate(templateId: string) {
        setBusy(true);
        try {
            await createWorkoutFromTemplate(templateId, today());
            await load();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't start from template");
        } finally {
            setBusy(false);
        }
    }

    if (loading && !data) {
        return (
            <div className="flex flex-1 items-center justify-center p-6">
                <Activity className="size-6 animate-pulse text-fg-quaternary motion-reduce:animate-none" aria-hidden="true" />
            </div>
        );
    }

    const active = data?.activeSession ?? null;

    if (active && data) {
        return <ActiveSession session={active} unitSystem={data.unitSystem} library={data.library} onChanged={load} />;
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
            <Button size="sm" color="primary" iconLeading={Plus} className="w-full" isLoading={busy} onClick={() => void startBlank()}>
                Start a workout
            </Button>

            {data && data.templates.length > 0 && (
                <div>
                    <p className="pb-2 text-xs font-semibold tracking-wide text-tertiary uppercase">Start from template</p>
                    <div className="flex flex-col gap-1">
                        {data.templates.map((t) => (
                            <button
                                key={t.id}
                                type="button"
                                disabled={busy}
                                onClick={() => void startTemplate(t.id)}
                                className="rounded-lg bg-secondary_subtle px-3 py-2 text-left text-sm font-medium text-primary ring-1 ring-inset ring-secondary transition hover:bg-secondary_hover disabled:opacity-50"
                            >
                                {t.name}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <div className="mt-auto flex flex-col gap-2 border-t border-secondary pt-3">
                <Button href="/workouts/exercises" size="sm" color="secondary" className="w-full">
                    Exercise library
                </Button>
                <Button href="/workouts" size="sm" color="link-gray" className="w-full">
                    Open Workouts
                </Button>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Active session — full in-widget logging
// ─────────────────────────────────────────────────────────────────────────────

function ActiveSession({
    session,
    unitSystem,
    library,
    onChanged,
}: {
    session: NonNullable<WorkoutsWidgetSnapshot["activeSession"]>;
    unitSystem: UnitSystem;
    library: Array<{ id: string; name: string }>;
    onChanged: () => Promise<void>;
}) {
    const [clock, setClock] = useState(() => formatElapsed(session.startedAt));
    const [busy, setBusy] = useState(false);
    const [adding, setAdding] = useState(false);

    useEffect(() => {
        const tick = () => setClock(formatElapsed(session.startedAt));
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [session.startedAt]);

    const totalSets = session.exercises.reduce((n, e) => n + e.sets.length, 0);
    const doneSets = session.exercises.reduce((n, e) => n + e.sets.filter((s) => s.completed).length, 0);

    const run = useCallback(
        async (fn: () => Promise<unknown>) => {
            setBusy(true);
            try {
                await fn();
                await onChanged();
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Something went wrong");
            } finally {
                setBusy(false);
            }
        },
        [onChanged],
    );

    async function onAddExercise(exerciseId: string) {
        if (!exerciseId) return;
        setAdding(false);
        await run(() => addWorkoutExercise(session.id, exerciseId));
    }

    async function onFinish() {
        setBusy(true);
        try {
            const { prs } = await finishWorkout(session.id);
            if (prs.length > 0) toast.success(`New PR on ${prs.join(", ")}!`);
            else toast.success("Workout finished");
            await onChanged();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't finish");
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="shrink-0 border-b border-secondary bg-secondary px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-primary">{session.name ?? "Workout"}</p>
                    <span className="flex shrink-0 items-center gap-1 rounded-full bg-success-secondary px-2 py-0.5 text-xs font-medium text-success-primary">
                        <span className="size-1.5 rounded-full bg-success-solid" aria-hidden="true" />
                        Active
                    </span>
                </div>
                <p className="mt-0.5 font-mono text-xs tabular-nums text-secondary">
                    {clock} · {doneSets}/{totalSets} sets · {session.exercises.length} {session.exercises.length === 1 ? "exercise" : "exercises"}
                </p>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
                {session.exercises.length === 0 ? (
                    <p className="text-sm text-tertiary">No exercises yet. Add one below to start logging.</p>
                ) : (
                    session.exercises.map((we) => (
                        <ExerciseBlock key={we.id} workoutId={session.id} we={we} unitSystem={unitSystem} busy={busy} run={run} />
                    ))
                )}

                {adding ? (
                    <Select.ComboBox
                        aria-label="Add exercise"
                        size="sm"
                        placeholder="Search exercises…"
                        items={library.map((x) => ({ id: x.id, label: x.name }))}
                        isDisabled={busy}
                        menuTrigger="focus"
                        onSelectionChange={(key) => {
                            if (key != null) void onAddExercise(String(key));
                        }}
                    >
                        {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                    </Select.ComboBox>
                ) : (
                    <Button size="sm" color="secondary" iconLeading={Plus} className="w-full" isDisabled={busy} onClick={() => setAdding(true)}>
                        Add exercise
                    </Button>
                )}
            </div>

            <div className="shrink-0 border-t border-secondary p-3">
                <Button size="sm" color="primary" iconLeading={Flag01} className="w-full" isLoading={busy} onClick={() => void onFinish()}>
                    Finish workout
                </Button>
            </div>
        </div>
    );
}

function ExerciseBlock({
    workoutId,
    we,
    unitSystem,
    busy,
    run,
}: {
    workoutId: string;
    we: WorkoutWidgetExercise;
    unitSystem: UnitSystem;
    busy: boolean;
    run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
    return (
        <div className="rounded-xl bg-secondary_subtle p-3 ring-1 ring-inset ring-secondary">
            <p className="truncate text-sm font-semibold text-primary">{we.name}</p>
            <div className="mt-2 flex flex-col gap-1.5">
                {we.sets.map((s, i) => (
                    <SetRow key={s.id} workoutId={workoutId} set={s} index={i} caps={we.caps} unitSystem={unitSystem} busy={busy} run={run} />
                ))}
            </div>
            <Button size="sm" color="link-color" iconLeading={Plus} className="mt-2" isDisabled={busy} onClick={() => void run(() => addSet(workoutId, we.id))}>
                Add set
            </Button>
        </div>
    );
}

function SetRow({
    workoutId,
    set,
    index,
    caps,
    unitSystem,
    busy,
    run,
}: {
    workoutId: string;
    set: WorkoutWidgetSet;
    index: number;
    caps: WorkoutWidgetExercise["caps"];
    unitSystem: UnitSystem;
    busy: boolean;
    run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
    const label = set.isWarmup ? "W" : set.isAmrap ? "∞" : index + 1;

    return (
        <div className={cx("flex items-center gap-1.5 rounded-lg px-1.5 py-1", set.completed ? "bg-success-primary/40" : "bg-primary ring-1 ring-inset ring-secondary")}>
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-tertiary text-[11px] font-semibold text-secondary">{label}</span>
            {caps.weight && (
                <NumCell
                    value={set.actualWeight}
                    placeholder={set.targetWeight != null ? String(weightToDisplay(set.targetWeight, unitSystem)) : weightUnit(unitSystem)}
                    disabled={busy}
                    toDisplay={(kg) => weightToDisplay(kg, unitSystem)}
                    fromDisplay={(d) => parseWeightInput(d, unitSystem) ?? d}
                    onCommit={(v) => run(() => updateSet(workoutId, set.id, { actualWeight: v }))}
                />
            )}
            {caps.reps && (
                <NumCell
                    value={set.actualReps}
                    placeholder={set.targetReps != null ? String(set.targetReps) : "reps"}
                    disabled={busy}
                    onCommit={(v) => run(() => updateSet(workoutId, set.id, { actualReps: v }))}
                />
            )}
            {caps.time && (
                <NumCell
                    value={set.actualSeconds}
                    placeholder="sec"
                    disabled={busy}
                    onCommit={(v) => run(() => updateSet(workoutId, set.id, { actualSeconds: v }))}
                />
            )}
            {caps.distance && (
                <NumCell
                    value={set.actualMeters}
                    placeholder="m"
                    disabled={busy}
                    onCommit={(v) => run(() => updateSet(workoutId, set.id, { actualMeters: v }))}
                />
            )}
            <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => toggleSetComplete(workoutId, set.id, !set.completed))}
                aria-label="Toggle complete"
                className={cx(
                    "flex size-7 shrink-0 items-center justify-center rounded-md transition disabled:opacity-50",
                    set.completed ? "bg-success-solid text-white" : "bg-tertiary text-fg-quaternary hover:bg-quaternary",
                )}
            >
                <Check className="size-4" aria-hidden="true" />
            </button>
            <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => deleteSet(workoutId, set.id))}
                aria-label="Delete set"
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-fg-quaternary transition hover:bg-error-primary hover:text-error-primary disabled:opacity-50"
            >
                <Trash01 className="size-3.5" aria-hidden="true" />
            </button>
        </div>
    );
}

function NumCell({
    value,
    placeholder,
    disabled,
    onCommit,
    toDisplay,
    fromDisplay,
}: {
    value: number | null;
    placeholder?: string;
    disabled?: boolean;
    onCommit: (n: number | null) => void;
    toDisplay?: (n: number) => number;
    fromDisplay?: (n: number) => number;
}) {
    const show = (n: number) => (toDisplay ? toDisplay(n) : n);
    const [local, setLocal] = useState(value == null ? "" : String(show(value)));
    const lastValue = useRef(value);
    useEffect(() => {
        if (lastValue.current !== value) {
            lastValue.current = value;
            setLocal(value == null ? "" : String(show(value)));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- resync only when server value changes
    }, [value]);

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
            onChange={(e) => setLocal(e.target.value.replace(/[^\d.]/g, ""))}
            onBlur={commit}
            onKeyDown={(e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    commit();
                    (e.target as HTMLInputElement).blur();
                }
            }}
            className="h-7 min-w-0 flex-1 rounded-md bg-primary text-center font-mono text-sm tabular-nums text-primary ring-1 ring-primary ring-inset outline-none placeholder:text-placeholder focus:outline-2 focus:-outline-offset-2 focus:outline-brand disabled:opacity-50"
        />
    );
}
