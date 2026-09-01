// @ts-nocheck


import { Button } from "react-aria-components";
import { useState } from "react";
import { Plus } from "@untitledui/icons";
import { UnitSystem } from "@/lib/units";
import { LogExerciseAttemptModal, type AttemptExercise } from "./log-exercise-attempt-modal";

export function LogAttemptButton({
    exercise,
    unitSystem,
    currentPrs,
    size = "md",
}: {
    exercise: AttemptExercise;
    unitSystem: UnitSystem;
    currentPrs?: CurrentPRs;
    size?: "sm" | "md" | "lg";
}) {
    const [open, setOpen] = useState(false);

    return (
        <>
            <Button size={size} color="primary" iconLeading={<Plus data-icon className="size-4" />} onClick={() => setOpen(true)}>
                Log attempt
            </Button>
            {open && <LogExerciseAttemptModal exercise={exercise} unitSystem={unitSystem} currentPrs={currentPrs} onClose={() => setOpen(false)} />}
        </>
    );
}
