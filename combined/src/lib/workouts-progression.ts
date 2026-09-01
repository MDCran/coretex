import type { Prisma, ProgressionScheme, SetEntry, Template, TemplateExercise, TemplateSet } from "@prisma/client";
import { db } from "@/lib/db";

/** One pre-seeded set written to a fresh workout. */
export type PlannedSet = {
    order: number;
    targetReps: number | null;
    targetWeight: number | null;
    targetRpe?: number | null;
    isWarmup?: boolean;
    isAmrap?: boolean;
};

type PlannableTE = Pick<
    TemplateExercise,
    "targetSets" | "targetReps" | "targetRepsMin" | "targetRepsMax" | "targetWeight" | "trainingMaxKg" | "targetRpe" | "warmupSets" | "perSetMode"
>;

/**
 * Computes the set plan for a single TemplateExercise given the template's
 * current progression state. Called when instantiating a workout from a template.
 */
export function planExerciseSets(
    template: Pick<Template, "progression" | "progressionStepKg" | "cycleWeek">,
    te: PlannableTE,
    templateSets: Pick<TemplateSet, "order" | "targetReps" | "targetWeight" | "targetRpe" | "isAmrap" | "isWarmup">[] = [],
): PlannedSet[] {
    // 1. Per-set mode — explicit per-set definitions replace the uniform plan.
    if (te.perSetMode && templateSets.length > 0) {
        const ordered = [...templateSets].sort((a, b) => a.order - b.order);
        return ordered.map((s, i) => ({
            order: i,
            targetReps: s.targetReps,
            targetWeight: s.targetWeight,
            targetRpe: s.targetRpe,
            isAmrap: s.isAmrap,
            isWarmup: s.isWarmup,
        }));
    }

    // 2. Working sets via the active progression scheme.
    const sets = Math.max(1, te.targetSets ?? 3);
    let working: PlannedSet[];
    switch (template.progression) {
        case "FIVETHREEONE":
            working = fiveThreeOnePlan(template.cycleWeek ?? 1, te.trainingMaxKg ?? 0);
            break;
        case "DOUBLE": {
            const min = te.targetRepsMin ?? te.targetReps ?? 5;
            working = Array.from({ length: sets }).map((_, i) => ({
                order: i,
                targetReps: te.targetReps ?? min,
                targetWeight: te.targetWeight,
                targetRpe: te.targetRpe ?? null,
            }));
            break;
        }
        case "LINEAR":
        case "NONE":
        default:
            working = Array.from({ length: sets }).map((_, i) => ({
                order: i,
                targetReps: te.targetReps,
                targetWeight: te.targetWeight,
                targetRpe: te.targetRpe ?? null,
            }));
    }

    // 3. Warmup prepend — derive working weight from the first working set,
    // ramp using each pct × first-set weight rounded to 2.5kg.
    const warmups = parseWarmupSets(te.warmupSets);
    if (warmups.length === 0) return working;
    const baseline = working[0]?.targetWeight ?? te.targetWeight ?? 0;
    const ramp: PlannedSet[] = warmups.map((w, i) => ({
        order: i,
        targetReps: w.reps,
        targetWeight: baseline > 0 ? roundToStep(baseline * w.pct, 2.5) : null,
        isWarmup: true,
    }));
    const offset = ramp.length;
    const renumbered = working.map((s) => ({ ...s, order: s.order + offset }));
    return [...ramp, ...renumbered];
}

/** Decode the JSON `warmupSets` column into a typed list. Tolerant of bad data.
 *  Accepts either {pct, reps} (this app) or {percentTm, reps} (legacy). */
export function parseWarmupSets(raw: TemplateExercise["warmupSets"] | null | undefined): Array<{ pct: number; reps: number }> {
    if (raw == null || !Array.isArray(raw)) return [];
    const out: Array<{ pct: number; reps: number }> = [];
    for (const row of raw) {
        if (row != null && typeof row === "object") {
            const r = row as { pct?: unknown; percentTm?: unknown; reps?: unknown };
            const pct = typeof r.pct === "number" ? r.pct : typeof r.percentTm === "number" ? r.percentTm : null;
            const reps = typeof r.reps === "number" ? r.reps : null;
            if (pct != null && reps != null) out.push({ pct, reps });
        }
    }
    return out;
}

/** 5/3/1 canonical Wendler week plans (3 working sets each, AMRAP on last). */
function fiveThreeOnePlan(cycleWeek: number, tm: number): PlannedSet[] {
    const week = Math.min(4, Math.max(1, cycleWeek));
    const weekMap: Record<number, Array<[number, number]>> = {
        1: [[0.65, 5], [0.75, 5], [0.85, 5]],
        2: [[0.7, 3], [0.8, 3], [0.9, 3]],
        3: [[0.75, 5], [0.85, 3], [0.95, 1]],
        4: [[0.4, 5], [0.5, 5], [0.6, 5]], // deload
    };
    return weekMap[week].map(([pct, reps], i, arr) => ({
        order: i,
        targetReps: reps,
        targetWeight: roundToStep(tm * pct, 2.5),
        isAmrap: week !== 4 && i === arr.length - 1,
    }));
}

function roundToStep(n: number, step: number): number {
    return Math.round(n / step) * step;
}

// ─────────────────────────────────────────────────────────────────────────────
// Post-workout progression advance
// ─────────────────────────────────────────────────────────────────────────────

export type AdvanceResult = {
    scheme: ProgressionScheme;
    updatedCount: number;
    details: Array<{ exerciseName: string; change: string }>;
};

/**
 * Inspects completed sets from a finished template-backed workout and updates
 * the template's progression state.
 */
export async function advanceTemplateAfterWorkout(workoutId: string): Promise<AdvanceResult | null> {
    const workout = await db.workout.findUnique({
        where: { id: workoutId },
        include: {
            exercises: {
                include: {
                    exercise: { select: { name: true } },
                    sets: { where: { completed: true } },
                },
            },
        },
    });
    if (!workout || !workout.templateId) return null;

    const template = await db.template.findUnique({
        where: { id: workout.templateId },
        include: { exercises: true },
    });
    if (!template) return null;

    const step = template.progressionStepKg ?? 2.5;
    const details: AdvanceResult["details"] = [];
    const teByExerciseId = new Map(template.exercises.map((te) => [te.exerciseId, te]));
    const updates: Prisma.PrismaPromise<unknown>[] = [];

    for (const we of workout.exercises) {
        const te = teByExerciseId.get(we.exerciseId);
        if (!te || te.perSetMode) continue;

        if (template.progression === "LINEAR") {
            const res = advanceLinear(te, we.sets, step);
            if (res) {
                updates.push(db.templateExercise.update({ where: { id: te.id }, data: res.patch }));
                details.push({ exerciseName: we.exercise.name, change: res.change });
            }
        } else if (template.progression === "DOUBLE") {
            const res = advanceDouble(te, we.sets, step);
            if (res) {
                updates.push(db.templateExercise.update({ where: { id: te.id }, data: res.patch }));
                details.push({ exerciseName: we.exercise.name, change: res.change });
            }
        }
    }

    // Advance cycle on FIVETHREEONE regardless of individual success.
    if (template.progression === "FIVETHREEONE") {
        const finishedWeek = template.cycleWeek ?? 1;
        const nextWeek = finishedWeek >= 4 ? 1 : finishedWeek + 1;
        updates.push(db.template.update({ where: { id: template.id }, data: { cycleWeek: nextWeek } }));
        details.push({ exerciseName: "Cycle", change: `week ${finishedWeek} → ${nextWeek}` });
        if (finishedWeek === 4) {
            for (const te of template.exercises) {
                if (te.trainingMaxKg == null) continue;
                const next = +(te.trainingMaxKg + step).toFixed(2);
                updates.push(db.templateExercise.update({ where: { id: te.id }, data: { trainingMaxKg: next } }));
                const exName = workout.exercises.find((we) => we.exerciseId === te.exerciseId)?.exercise.name ?? "exercise";
                details.push({ exerciseName: exName, change: `TM ${te.trainingMaxKg} → ${next} kg` });
            }
        }
    }

    if (updates.length) await db.$transaction(updates);

    return { scheme: template.progression, updatedCount: details.length, details };
}

function advanceLinear(te: TemplateExercise, sets: SetEntry[], step: number): { patch: Prisma.TemplateExerciseUpdateInput; change: string } | null {
    if (te.targetWeight == null || te.targetReps == null || te.targetSets == null) return null;
    const working = sets.filter((s) => !s.isWarmup);
    const hitAll =
        working.length >= te.targetSets &&
        working
            .slice(0, te.targetSets)
            .every((s) => s.actualReps != null && s.actualReps >= (te.targetReps ?? 0) && s.actualWeight != null && s.actualWeight >= (te.targetWeight ?? 0));
    if (!hitAll) return null;
    const next = +((te.targetWeight ?? 0) + step).toFixed(2);
    return { patch: { targetWeight: next }, change: `${te.targetWeight} → ${next} kg` };
}

function advanceDouble(te: TemplateExercise, sets: SetEntry[], step: number): { patch: Prisma.TemplateExerciseUpdateInput; change: string } | null {
    const min = te.targetRepsMin ?? te.targetReps ?? 5;
    const max = te.targetRepsMax ?? min + 3;
    const target = te.targetReps ?? min;
    const requiredSets = te.targetSets ?? 3;
    const working = sets.filter((s) => !s.isWarmup);
    if (working.length < requiredSets) return null;
    const actuals = working.slice(0, requiredSets).map((s) => s.actualReps ?? 0);
    if (actuals.every((r) => r >= max)) {
        const next = +((te.targetWeight ?? 0) + step).toFixed(2);
        return { patch: { targetWeight: next, targetReps: min }, change: `${te.targetWeight} → ${next} kg (reps → ${min})` };
    }
    if (actuals.every((r) => r >= target) && target < max) {
        return { patch: { targetReps: target + 1 }, change: `${target} → ${target + 1} reps` };
    }
    return null;
}
