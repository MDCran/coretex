import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "../../../_components/workouts-ui";
import { ExerciseForm } from "../../_components/exercise-form";

export default async function EditExercisePage({ params }: { params: Promise<{ slug: string }> }) {
    const user = await requireUser();
    const { slug } = await params;

    const exercise = await db.exercise.findFirst({ where: { slug, userId: user.id } });
    if (!exercise) notFound();

    const parents = await db.exercise.findMany({
        where: { OR: [{ userId: null }, { userId: user.id }], archived: false, NOT: { id: exercise.id } },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
    });

    return (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
            <PageHeader title={`Edit ${exercise.name}`} description="Update the details and tracked measurements for this exercise." />
            <ExerciseForm
                parents={parents}
                initial={{
                    id: exercise.id,
                    name: exercise.name,
                    muscles: exercise.muscles.join(", "),
                    secondaryMuscles: exercise.secondaryMuscles.join(", "),
                    equipment: exercise.equipment.join(", "),
                    instructions: exercise.instructions ?? "",
                    notes: exercise.notes ?? "",
                    mediaUrl: exercise.mediaUrl ?? "",
                    category: exercise.category ?? "",
                    force: exercise.force ?? "",
                    level: exercise.level ?? "",
                    mechanic: exercise.mechanic ?? "",
                    parentId: exercise.parentId ?? "",
                    tracksReps: exercise.tracksReps,
                    tracksWeight: exercise.tracksWeight,
                    tracksTime: exercise.tracksTime,
                    tracksDistance: exercise.tracksDistance,
                }}
            />
        </div>
    );
}
