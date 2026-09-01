"use client";

import { useState } from "react";
import { type CurrentPRs } from "@/lib/workouts-history";
import { type UnitSystem } from "@/lib/units";
import { ExerciseLibraryGrid, type ExerciseLibraryItem } from "./exercise-library-picker";
import { LogExerciseAttemptModal, type AttemptExercise } from "./log-exercise-attempt-modal";

export function ExerciseAttemptProvider({
    exercises,
    unitSystem,
    currentPrs = {},
    density = 3,
    showFilters = true,
}: {
    exercises: ExerciseLibraryItem[];
    unitSystem: UnitSystem;
    currentPrs?: Record<string, CurrentPRs>;
    density?: 2 | 3 | 4;
    showFilters?: boolean;
}) {
    const [attemptExercise, setAttemptExercise] = useState<AttemptExercise | null>(null);

    const openAttempt = (e: ExerciseLibraryItem) => {
        setAttemptExercise({
            id: e.id,
            name: e.name,
            slug: e.slug,
            tracksReps: e.tracksReps ?? true,
            tracksWeight: e.tracksWeight ?? true,
            tracksTime: e.tracksTime ?? false,
            tracksDistance: e.tracksDistance ?? false,
        });
    };

    return (
        <>
            <ExerciseLibraryGrid exercises={exercises} density={density} showFilters={showFilters} onLogAttempt={openAttempt} />
            {attemptExercise && (
                <LogExerciseAttemptModal
                    exercise={attemptExercise}
                    unitSystem={unitSystem}
                    currentPrs={currentPrs[attemptExercise.id]}
                    onClose={() => setAttemptExercise(null)}
                />
            )}
        </>
    );
}
