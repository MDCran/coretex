import assert from "node:assert/strict";
import { templateExercisePrescription, type TemplateExercisePrescription } from "../../../shared/src/coretex/views/workouts/workout-presentation";

const defaults: TemplateExercisePrescription = {
    targetSets: null,
    targetReps: null,
    targetRepsMin: null,
    targetRepsMax: null,
    targetWeight: null,
    targetTimeSec: null,
    targetDistanceM: null,
};

assert.equal(templateExercisePrescription({ ...defaults, targetSets: 4, targetReps: 12 }, "lb"), "4 × 12 reps");
assert.equal(templateExercisePrescription({ ...defaults, targetSets: 4, targetRepsMin: 12, targetRepsMax: 15 }, "lb"), "4 × 12–15 reps");
assert.equal(templateExercisePrescription({ ...defaults, targetSets: 1, targetTimeSec: 1_800 }, "lb"), "30 min");
assert.equal(templateExercisePrescription({ ...defaults, targetSets: 3, targetTimeSec: 60 }, "lb"), "3 × 60 sec");
assert.equal(templateExercisePrescription({ ...defaults, targetSets: 3 }, "lb"), "3 sets");

process.stdout.write("Workout template presentation smoke passed.\n");
