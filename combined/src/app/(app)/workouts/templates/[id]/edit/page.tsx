import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseWarmupSets } from "@/lib/workouts-progression";
import { mapExerciseLibrary } from "../../../exercises/_components/map-exercise-library";
import { TemplateEditor } from "../../_components/template-editor";

export default async function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
    const user = await requireUser();
    const { id } = await params;

    const [template, library, settings] = await Promise.all([
        db.template.findFirst({
            where: { id, userId: user.id },
            include: { exercises: { orderBy: { order: "asc" }, include: { exercise: { select: { name: true } }, sets: { orderBy: { order: "asc" } } } } },
        }),
        db.exercise.findMany({
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
        }),
        db.settings.findUnique({ where: { userId: user.id } }),
    ]);
    if (!template) notFound();

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-1">
                <h1 className="text-display-xs font-semibold text-primary">Edit {template.name}</h1>
            </div>
<TemplateEditor
                library={mapExerciseLibrary(library, user.id)}
                unitSystem={settings?.unitSystem ?? "IMPERIAL"}
                initial={{
                    id: template.id,
                    name: template.name,
                    note: template.note,
                    progression: template.progression,
                    progressionStepKg: template.progressionStepKg,
                    cycleWeek: template.cycleWeek,
                    exercises: template.exercises.map((te) => ({
                        exerciseId: te.exerciseId,
                        _name: te.exercise.name,
                        targetSets: te.targetSets,
                        targetReps: te.targetReps,
                        targetRepsMin: te.targetRepsMin,
                        targetRepsMax: te.targetRepsMax,
                        targetWeight: te.targetWeight,
                        trainingMaxKg: te.trainingMaxKg,
                        note: te.note,
                        restSec: te.restSec,
                        warmupSets: parseWarmupSets(te.warmupSets),
                        groupKey: te.groupKey,
                        targetRpe: te.targetRpe,
                        tempo: te.tempo,
                        perSetMode: te.perSetMode,
                        sets: te.sets.map((s) => ({
                            targetReps: s.targetReps,
                            targetRepsMin: s.targetRepsMin,
                            targetRepsMax: s.targetRepsMax,
                            targetWeight: s.targetWeight,
                            targetRpe: s.targetRpe,
                            isAmrap: s.isAmrap,
                            isWarmup: s.isWarmup,
                        })),
                    })),
                }}
            />
        </div>
    );
}
