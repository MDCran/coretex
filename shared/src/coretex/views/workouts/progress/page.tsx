// @ts-nocheck





import { db } from "@/lib/db";
import { PageHeader } from "../_components/workouts-ui";
import { ProgressClient } from "./_components/progress-client";

/** For a given photo takenAt date (ms), find the closest weight entry within ±3 days. */
function closestWeightKg(photoMs: number, series: Array<{ day: string; kg: number }>): number | null {
    const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
    let best: { diff: number; kg: number } | null = null;
    for (const entry of series) {
        const entryMs = new Date(`${entry.day}T00:00:00.000Z`).getTime();
        const diff = Math.abs(photoMs - entryMs);
        if (diff <= THREE_DAYS_MS && (best === null || diff < best.diff)) {
            best = { diff, kg: entry.kg };
        }
    }
    return best ? best.kg : null;
}

export default async function ProgressPage({ searchParams }: { searchParams: Promise<{ workout?: string }> }) {
    const user = await requireUser();
    const { workout: defaultWorkoutId } = await searchParams;

    const [photos, settings, workoutOptions, weightSeries] = await Promise.all([
        // ALL of the user's photos (shared with /health/photos — no source filter).
        db.progressPhoto.findMany({
            where: { userId: user.id },
            orderBy: { takenAt: "desc" },
            include: { workout: { select: { id: true, name: true, date: true } } },
        }),
        db.settings.findUnique({ where: { userId: user.id } }),
        getRecentWorkoutOptions(user.id),
        // Unified weight history for the closest-weight fallback.
        getWeightSeries(user.id),
    ]);

    return (
        <div className="flex flex-col gap-6">
            <PageHeader
                title="Progress photos"
                description="Capture your transformation. Tag angle, phase and weight, then drag the slider to compare any two shots side by side."
            />

            <ProgressClient
                photos={photos.map((p) => {
                    const takenMs = p.takenAt.getTime();
                    // If the photo has no explicit weight, look for the closest body-metric weight.
                    const closestKg = p.weightKg == null ? closestWeightKg(takenMs, weightSeries) : null;
                    return {
                        id: p.id,
                        url: fileUrl(p.originalKey),
                        angle: p.angle,
                        phase: p.phase,
                        weightKg: p.weightKg,
                        closestWeightKg: closestKg,
                        takenAt: p.takenAt.toISOString(),
                        notes: p.notes,
                        workout: p.workout
                            ? { id: p.workout.id, name: p.workout.name?.trim() || "Workout", date: p.workout.date.toLocaleDateString() }
                            : null,
                    };
                })}
                workoutOptions={workoutOptions}
                defaultWorkoutId={defaultWorkoutId && workoutOptions.some((w) => w.id === defaultWorkoutId) ? defaultWorkoutId : null}
                unitSystem={settings?.unitSystem ?? "IMPERIAL"}
            />
        </div>
    );
}
