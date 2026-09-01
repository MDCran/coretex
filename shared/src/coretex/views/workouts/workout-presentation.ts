export interface TemplateExercisePrescription {
    targetSets: number | null;
    targetReps: number | null;
    targetRepsMin: number | null;
    targetRepsMax: number | null;
    targetWeight: number | null;
    targetTimeSec: number | null;
    targetDistanceM: number | null;
}

function formatTargetNumber(value: number, maximumFractionDigits = 0): string {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(Number.isFinite(value) ? value : 0);
}

/**
 * Build the compact prescription shown on workout-template cards.
 * Exact reps and timed work deliberately remain distinct from rep ranges so
 * plans such as "4 x 12 reps" and "30 min" cannot render as an empty target.
 */
export function templateExercisePrescription(
    exercise: TemplateExercisePrescription,
    weightUnit: string,
): string {
    const targets: string[] = [];
    if (exercise.targetRepsMin != null || exercise.targetRepsMax != null) {
        const minimum = exercise.targetRepsMin ?? exercise.targetRepsMax;
        const maximum = exercise.targetRepsMax ?? exercise.targetRepsMin;
        targets.push(minimum === maximum ? `${minimum} reps` : `${minimum}–${maximum} reps`);
    } else if (exercise.targetReps != null) {
        targets.push(`${exercise.targetReps} reps`);
    }
    if (exercise.targetTimeSec != null) {
        targets.push(exercise.targetTimeSec >= 120 && exercise.targetTimeSec % 60 === 0
            ? `${exercise.targetTimeSec / 60} min`
            : `${exercise.targetTimeSec} sec`);
    }
    if (exercise.targetDistanceM != null) targets.push(`${formatTargetNumber(exercise.targetDistanceM, 1)} m`);
    if (exercise.targetWeight != null) targets.push(`${formatTargetNumber(exercise.targetWeight, 1)} ${weightUnit}`);

    const prescription = targets.join(" · ");
    if (exercise.targetSets == null) return prescription || "Programmed";
    if (exercise.targetSets === 1 && exercise.targetTimeSec != null) return prescription;
    return prescription ? `${exercise.targetSets} × ${prescription}` : `${exercise.targetSets} sets`;
}
