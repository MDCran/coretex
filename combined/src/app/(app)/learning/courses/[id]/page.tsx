import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { CourseDetailClient } from "./course-detail-client";

export default async function CourseDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const user = await requireUser();

    const course = await db.learningCourse.findFirst({
        where: { id, userId: user.id },
        include: {
            lessons: { orderBy: { order: "asc" } },
            quizzes: { select: { id: true, title: true } },
        },
    });
    if (!course) notFound();

    const goals = await db.learningGoal.findMany({
        where: { userId: user.id },
        select: { id: true, title: true, description: true },
        orderBy: { createdAt: "desc" },
    });

    return (
        <CourseDetailClient
            course={{
                id: course.id,
                title: course.title,
                provider: course.provider ?? "other",
                url: course.url,
                thumbnailUrl: course.thumbnailUrl,
                description: course.description,
                status: course.status ?? "planned",
                rating: course.rating,
                review: course.review,
                certificateKey: course.certificateKey,
                timeInvestedMinutes: course.timeInvestedMinutes,
                totalDurationSeconds: course.totalDurationSeconds,
                linkedGoalId: course.linkedGoalId,
            }}
            sections={course.lessons.map((l) => ({
                id: l.id,
                title: l.title,
                description: l.description,
                completed: l.completed,
                estimatedMinutes: l.estimatedMinutes,
                order: l.order,
            }))}
            goals={goals.map((g) => ({ id: g.id, label: g.title ?? g.description }))}
            quizzes={course.quizzes.map((q) => ({ id: q.id, title: q.title }))}
        />
    );
}
