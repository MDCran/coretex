import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "../../_components/workouts-ui";
import { ExerciseForm } from "../_components/exercise-form";

export default async function NewExercisePage() {
    const user = await requireUser();
    const parents = await db.exercise.findMany({
        where: { OR: [{ userId: null }, { userId: user.id }], archived: false },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
    });

    return (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
            <PageHeader
                title="New exercise"
                description="Add a custom movement to your library and choose what you want to track for it."
            />
            <ExerciseForm parents={parents} />
        </div>
    );
}
