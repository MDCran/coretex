import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { mapExerciseLibrary } from "../../exercises/_components/map-exercise-library";
import { TemplateEditor } from "../_components/template-editor";

const LIBRARY_SELECT = {
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
} as const;

export default async function NewTemplatePage() {
    const user = await requireUser();
    const [library, settings] = await Promise.all([
        db.exercise.findMany({
            where: { OR: [{ userId: null }, { userId: user.id }], archived: false },
            orderBy: { name: "asc" },
            select: LIBRARY_SELECT,
        }),
        db.settings.findUnique({ where: { userId: user.id } }),
    ]);

    return (
        <div className="flex flex-col gap-6">
<TemplateEditor library={mapExerciseLibrary(library, user.id)} unitSystem={settings?.unitSystem ?? "IMPERIAL"} />
        </div>
    );
}
