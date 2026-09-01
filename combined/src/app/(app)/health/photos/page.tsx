import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fileUrl } from "@/lib/files";
import { getRecentWorkoutOptions } from "@/lib/workouts-history";
import { PhotosClient, type PhotoRow } from "./photos-client";

export default async function PhotosPage() {
    const user = await requireUser();
    const [photos, settings, workoutOptions] = await Promise.all([
        // ALL of the user's photos (shared with /workouts/progress — no source filter).
        db.progressPhoto.findMany({
            where: { userId: user.id },
            orderBy: { takenAt: "desc" },
            take: 300,
            include: { workout: { select: { id: true, name: true, date: true } } },
        }),
        db.settings.findUnique({ where: { userId: user.id } }),
        getRecentWorkoutOptions(user.id),
    ]);

    const rows: PhotoRow[] = photos.map((p) => ({
        id: p.id,
        url: fileUrl(p.thumbKey ?? p.originalKey),
        angle: p.angle,
        phase: p.phase,
        weightKg: p.weightKg,
        notes: p.notes,
        takenAt: p.takenAt.toISOString(),
        workout: p.workout ? { id: p.workout.id, name: p.workout.name?.trim() || "Workout", date: p.workout.date.toLocaleDateString() } : null,
    }));

    return <PhotosClient photos={rows} workoutOptions={workoutOptions} unitSystem={settings?.unitSystem ?? "IMPERIAL"} />;
}
