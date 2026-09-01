import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

/** Global exercise catalog (userId = null) seeded on first run. Ported from workout-tracker. */
const SEED_EXERCISES: Array<{
    name: string;
    slug: string;
    muscles: string[];
    secondaryMuscles?: string[];
    equipment: string[];
    force?: "PUSH" | "PULL" | "STATIC";
    level?: "BEGINNER" | "INTERMEDIATE" | "EXPERT";
    mechanic?: "COMPOUND" | "ISOLATION";
    category?: string;
    tracksTime?: boolean;
    tracksReps?: boolean;
    tracksWeight?: boolean;
    tracksDistance?: boolean;
}> = [
    { name: "Barbell Bench Press", slug: "barbell-bench-press", muscles: ["chest"], secondaryMuscles: ["triceps", "shoulders"], equipment: ["barbell"], force: "PUSH", level: "INTERMEDIATE", mechanic: "COMPOUND", category: "strength" },
    { name: "Incline Dumbbell Press", slug: "incline-dumbbell-press", muscles: ["chest"], secondaryMuscles: ["triceps", "shoulders"], equipment: ["dumbbell"], force: "PUSH", level: "BEGINNER", mechanic: "COMPOUND", category: "strength" },
    { name: "Barbell Squat", slug: "barbell-squat", muscles: ["quadriceps"], secondaryMuscles: ["glutes", "hamstrings", "lower back"], equipment: ["barbell"], force: "PUSH", level: "INTERMEDIATE", mechanic: "COMPOUND", category: "strength" },
    { name: "Deadlift", slug: "deadlift", muscles: ["lower back"], secondaryMuscles: ["glutes", "hamstrings", "traps"], equipment: ["barbell"], force: "PULL", level: "INTERMEDIATE", mechanic: "COMPOUND", category: "strength" },
    { name: "Romanian Deadlift", slug: "romanian-deadlift", muscles: ["hamstrings"], secondaryMuscles: ["glutes", "lower back"], equipment: ["barbell"], force: "PULL", level: "INTERMEDIATE", mechanic: "COMPOUND", category: "strength" },
    { name: "Overhead Press", slug: "overhead-press", muscles: ["shoulders"], secondaryMuscles: ["triceps"], equipment: ["barbell"], force: "PUSH", level: "INTERMEDIATE", mechanic: "COMPOUND", category: "strength" },
    { name: "Pull-up", slug: "pull-up", muscles: ["lats"], secondaryMuscles: ["biceps", "middle back"], equipment: ["body only"], force: "PULL", level: "INTERMEDIATE", mechanic: "COMPOUND", category: "strength" },
    { name: "Chin-up", slug: "chin-up", muscles: ["lats"], secondaryMuscles: ["biceps"], equipment: ["body only"], force: "PULL", level: "BEGINNER", mechanic: "COMPOUND", category: "strength" },
    { name: "Barbell Row", slug: "barbell-row", muscles: ["middle back"], secondaryMuscles: ["lats", "biceps"], equipment: ["barbell"], force: "PULL", level: "INTERMEDIATE", mechanic: "COMPOUND", category: "strength" },
    { name: "Lat Pulldown", slug: "lat-pulldown", muscles: ["lats"], secondaryMuscles: ["biceps"], equipment: ["cable"], force: "PULL", level: "BEGINNER", mechanic: "COMPOUND", category: "strength" },
    { name: "Dumbbell Curl", slug: "dumbbell-curl", muscles: ["biceps"], equipment: ["dumbbell"], force: "PULL", level: "BEGINNER", mechanic: "ISOLATION", category: "strength" },
    { name: "Tricep Pushdown", slug: "tricep-pushdown", muscles: ["triceps"], equipment: ["cable"], force: "PUSH", level: "BEGINNER", mechanic: "ISOLATION", category: "strength" },
    { name: "Lateral Raise", slug: "lateral-raise", muscles: ["shoulders"], equipment: ["dumbbell"], force: "PUSH", level: "BEGINNER", mechanic: "ISOLATION", category: "strength" },
    { name: "Leg Press", slug: "leg-press", muscles: ["quadriceps"], secondaryMuscles: ["glutes", "hamstrings"], equipment: ["machine"], force: "PUSH", level: "BEGINNER", mechanic: "COMPOUND", category: "strength" },
    { name: "Leg Curl", slug: "leg-curl", muscles: ["hamstrings"], equipment: ["machine"], force: "PULL", level: "BEGINNER", mechanic: "ISOLATION", category: "strength" },
    { name: "Calf Raise", slug: "calf-raise", muscles: ["calves"], equipment: ["machine"], force: "PUSH", level: "BEGINNER", mechanic: "ISOLATION", category: "strength" },
    { name: "Plank", slug: "plank", muscles: ["abdominals"], equipment: ["body only"], force: "STATIC", level: "BEGINNER", mechanic: "ISOLATION", category: "strength", tracksTime: true, tracksReps: false, tracksWeight: false },
    { name: "Crunch", slug: "crunch", muscles: ["abdominals"], equipment: ["body only"], force: "PULL", level: "BEGINNER", mechanic: "ISOLATION", category: "strength", tracksWeight: false },
    { name: "Running", slug: "running", muscles: ["quadriceps", "hamstrings", "calves"], equipment: ["body only"], level: "BEGINNER", category: "cardio", tracksTime: true, tracksDistance: true, tracksReps: false, tracksWeight: false },
    { name: "Cycling", slug: "cycling", muscles: ["quadriceps", "hamstrings"], equipment: ["machine"], level: "BEGINNER", category: "cardio", tracksTime: true, tracksDistance: true, tracksReps: false, tracksWeight: false },
];

async function main() {
    for (const ex of SEED_EXERCISES) {
        await db.exercise.upsert({
            where: { slug: ex.slug },
            update: {},
            create: {
                name: ex.name,
                slug: ex.slug,
                muscles: ex.muscles,
                secondaryMuscles: ex.secondaryMuscles ?? [],
                equipment: ex.equipment,
                force: ex.force,
                level: ex.level,
                mechanic: ex.mechanic,
                category: ex.category,
                tracksReps: ex.tracksReps ?? true,
                tracksWeight: ex.tracksWeight ?? true,
                tracksTime: ex.tracksTime ?? false,
                tracksDistance: ex.tracksDistance ?? false,
            },
        });
    }
    console.log(`Seeded ${SEED_EXERCISES.length} catalog exercises.`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => db.$disconnect());
