import { fileUrl } from "@/lib/files";
import type { ExerciseLibraryItem } from "./exercise-library-picker";
import { resolveExerciseImage } from "./resolve-image";

type DbExercise = {
    id: string;
    name: string;
    slug: string;
    muscles: string[];
    equipment: string[];
    level: string | null;
    category: string | null;
    images: string[];
    mediaKey: string | null;
    mediaUrl: string | null;
    userId: string | null;
    tracksReps: boolean;
    tracksWeight: boolean;
    tracksTime: boolean;
    tracksDistance: boolean;
};

export function mapExerciseLibrary(exercises: DbExercise[], userId: string): ExerciseLibraryItem[] {
    return exercises.map((e) => ({
        id: e.id,
        name: e.name,
        slug: e.slug,
        muscles: e.muscles,
        equipment: e.equipment,
        level: e.level,
        category: e.category,
        image: e.mediaKey ? fileUrl(e.mediaKey) : (e.mediaUrl ?? resolveExerciseImage(e.images[0]) ?? null),
        mine: e.userId === userId,
        tracksReps: e.tracksReps,
        tracksWeight: e.tracksWeight,
        tracksTime: e.tracksTime,
        tracksDistance: e.tracksDistance,
    }));
}
