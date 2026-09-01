import { Plus } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "../_components/workouts-ui";
import { ExerciseAttemptProvider } from "./_components/exercise-attempt-provider";
import { mapExerciseLibrary } from "./_components/map-exercise-library";

export default async function ExercisesPage() {
    const user = await requireUser();
    const settings = await db.settings.findUnique({ where: { userId: user.id } });
    const unitSystem = settings?.unitSystem ?? "IMPERIAL";

    const exercises = await db.exercise.findMany({
        where: { OR: [{ userId: null }, { userId: user.id }], archived: false },
        orderBy: { name: "asc" },
        select: {
            id: true,
            name: true,
            slug: true,
            muscles: true,
            equipment: true,
            level: true,
            category: true,
            images: true,
            mediaKey: true,
            mediaUrl: true,
            userId: true,
            tracksReps: true,
            tracksWeight: true,
            tracksTime: true,
            tracksDistance: true,
        },
    });

    return (
        <div className="flex flex-col gap-6">
            <PageHeader
                title="Exercise library"
                description="Browse hundreds of built-in movements, log a quick attempt, or add your own custom exercises."
                actions={
                    <Button size="md" color="primary" iconLeading={<Plus data-icon className="size-4" />} href="/workouts/exercises/new">
                        New exercise
                    </Button>
                }
            />

            <ExerciseAttemptProvider exercises={mapExerciseLibrary(exercises, user.id)} unitSystem={unitSystem} />
        </div>
    );
}
