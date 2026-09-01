// @ts-nocheck





import { mapExerciseLibrary } from "../../exercises/_components/map-exercise-library";
import { SessionClient } from "./_components/session-client";
import { LinkedPhotosStrip } from "./_components/linked-photos-strip";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
    const user = await requireUser();
    const { id } = await params;

    const workout = await db.workout.findFirst({
        where: { id, userId: user.id, deletedAt: null },
        include: {
            exercises: {
                orderBy: { order: "asc" },
                include: {
                    exercise: {
                        select: {
                            id: true,
                            name: true,
                            slug: true,
                            muscles: true,
                            tracksReps: true,
                            tracksWeight: true,
                            tracksTime: true,
                            tracksDistance: true,
                        },
                    },
                    sets: { orderBy: { order: "asc" } },
                },
            },
        },
    });
    if (!workout) notFound();

    const libraryRows = await db.exercise.findMany({
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
    const library = mapExerciseLibrary(libraryRows, user.id);

    // Auto-backfill PRs if the user has completed working sets but no PersonalRecord
    // rows yet (migrated data). Keeps the session PR baseline accurate so the PR
    // pill / confetti only fires on a genuine record rather than on every set.
    const [prCount, completedSetCount] = await Promise.all([
        db.personalRecord.count({ where: { userId: user.id } }),
        db.setEntry.count({ where: { completed: true, isWarmup: false, workoutExercise: { workout: { userId: user.id, deletedAt: null } } } }),
    ]);
    if (prCount === 0 && completedSetCount > 0) {
        await recomputeAllPersonalRecords(user.id);
    }

    const exerciseIds = workout.exercises.map((we) => we.exerciseId);
    const [lastTime, currentPRs, libraryLastDone, settings, linkedPhotos] = await Promise.all([
        getLastTimePerformance(user.id, exerciseIds, workout.id),
        getCurrentPRs(user.id, exerciseIds),
        getLibraryLastDone(user.id),
        db.settings.findUnique({ where: { userId: user.id } }),
        db.progressPhoto.findMany({
            where: { userId: user.id, workoutId: workout.id },
            orderBy: { takenAt: "desc" },
            select: { id: true, originalKey: true, thumbKey: true, takenAt: true, angle: true },
        }),
    ]);

    return (
        <>
        <SessionClient
            lastTime={lastTime}
            currentPRs={currentPRs}
            libraryLastDone={libraryLastDone}
            unitSystem={settings?.unitSystem ?? "IMPERIAL"}
            workout={{
                id: workout.id,
                name: workout.name,
                note: workout.note,
                rpe: workout.rpe,
                endedAt: workout.endedAt ? workout.endedAt.toISOString() : null,
                startedAt: workout.startedAt ? workout.startedAt.toISOString() : null,
                pausedMs: workout.pausedMs,
                pausedAt: workout.pausedAt ? workout.pausedAt.toISOString() : null,
                exercises: workout.exercises.map((we) => ({
                    id: we.id,
                    order: we.order,
                    note: we.note,
                    groupKey: we.groupKey,
                    restSec: we.restSec,
                    tempo: we.tempo,
                    exercise: we.exercise,
                    sets: we.sets.map((s) => ({
                        id: s.id,
                        order: s.order,
                        targetReps: s.targetReps,
                        actualReps: s.actualReps,
                        targetWeight: s.targetWeight,
                        actualWeight: s.actualWeight,
                        targetSeconds: s.targetSeconds,
                        actualSeconds: s.actualSeconds,
                        targetMeters: s.targetMeters,
                        actualMeters: s.actualMeters,
                        rpe: s.rpe,
                        targetRpe: s.targetRpe,
                        isWarmup: s.isWarmup,
                        isAmrap: s.isAmrap,
                        completed: s.completed,
                        restTakenSec: s.restTakenSec,
                    })),
                })),
            }}
            library={library}
        />
        <LinkedPhotosStrip
            workoutId={workout.id}
            unitSystem={settings?.unitSystem ?? "IMPERIAL"}
            photos={linkedPhotos.map((p) => ({
                id: p.id,
                url: fileUrl(p.thumbKey ?? p.originalKey),
                takenAt: p.takenAt.toISOString(),
                angle: p.angle,
            }))}
        />
        </>
    );
}
