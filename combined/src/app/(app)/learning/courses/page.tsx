import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { CoursesClient } from "./courses-client";

export default async function CoursesPage() {
    const user = await requireUser();
    const courses = await db.learningCourse.findMany({
        where: { userId: user.id },
        include: { lessons: { select: { completed: true } } },
        orderBy: { createdAt: "desc" },
    });

    const rows = courses.map((c) => ({
        id: c.id,
        title: c.title,
        provider: c.provider ?? "other",
        url: c.url,
        thumbnailUrl: c.thumbnailUrl,
        status: c.status ?? "planned",
        rating: c.rating,
        certificateKey: c.certificateKey,
        timeInvestedMinutes: c.timeInvestedMinutes,
        totalDurationSeconds: c.totalDurationSeconds,
        sectionsTotal: c.lessons.length,
        sectionsDone: c.lessons.filter((l) => l.completed).length,
    }));

    return <CoursesClient courses={rows} />;
}
