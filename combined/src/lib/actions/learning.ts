"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { bool, int, num, parseDateOnly, parseOptionalDateTime, str } from "./health-shared";
import { gradeToQuality, schedule, type RecallGrade } from "@/lib/learning/srs";

function rl(...paths: string[]) {
    for (const p of paths) revalidatePath(p);
    revalidatePath("/learning");
}

// ── Courses & lessons ────────────────────────────────────────

export async function createCourse(fd: FormData) {
    const user = await requireUser();
    const title = str(fd, "title");
    if (!title) throw new Error("Title is required");
    await db.learningCourse.create({
        data: {
            userId: user.id,
            title,
            source: str(fd, "source"),
            url: str(fd, "url"),
            description: str(fd, "description"),
            status: str(fd, "status") ?? "planned",
        },
    });
    rl("/learning/courses");
}

export async function updateCourse(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const status = str(fd, "status");
    await db.learningCourse.updateMany({
        where: { id, userId: user.id },
        data: {
            title: str(fd, "title") ?? undefined,
            source: str(fd, "source"),
            url: str(fd, "url"),
            description: str(fd, "description"),
            status: status ?? undefined,
            completedOn: status === "completed" ? new Date() : null,
            startedOn: status === "in_progress" ? new Date() : undefined,
        },
    });
    rl("/learning/courses");
}

export async function deleteCourse(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.learningCourse.deleteMany({ where: { id, userId: user.id } });
    rl("/learning/courses");
}

export async function createLesson(fd: FormData) {
    const user = await requireUser();
    const courseId = str(fd, "courseId");
    const title = str(fd, "title");
    if (!courseId || !title) throw new Error("Course and title are required");
    const owned = await db.learningCourse.findFirst({ where: { id: courseId, userId: user.id }, select: { id: true } });
    if (!owned) throw new Error("Course not found");
    const count = await db.learningLesson.count({ where: { courseId } });
    await db.learningLesson.create({
        data: { courseId, title, description: str(fd, "description"), order: count },
    });
    rl(`/learning/courses/${courseId}`, "/learning/courses");
}

export async function updateLesson(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const lesson = await db.learningLesson.findFirst({ where: { id, course: { userId: user.id } }, select: { courseId: true } });
    if (!lesson) throw new Error("Lesson not found");
    await db.learningLesson.update({
        where: { id },
        data: { title: str(fd, "title") ?? undefined, description: str(fd, "description") },
    });
    rl(`/learning/courses/${lesson.courseId}`);
}

export async function toggleLesson(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const lesson = await db.learningLesson.findFirst({ where: { id, course: { userId: user.id } }, select: { completed: true, courseId: true } });
    if (!lesson) throw new Error("Lesson not found");
    await db.learningLesson.update({ where: { id }, data: { completed: !lesson.completed } });
    rl(`/learning/courses/${lesson.courseId}`, "/learning/courses");
}

export async function deleteLesson(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const lesson = await db.learningLesson.findFirst({ where: { id, course: { userId: user.id } }, select: { courseId: true } });
    if (!lesson) throw new Error("Lesson not found");
    await db.learningLesson.delete({ where: { id } });
    rl(`/learning/courses/${lesson.courseId}`, "/learning/courses");
}

// ── Flashcards ───────────────────────────────────────────────

export async function createFlashcard(fd: FormData) {
    const user = await requireUser();
    const front = str(fd, "front");
    const back = str(fd, "back");
    if (!front || !back) throw new Error("Front and back are required");
    // New cards are due immediately so they enter the review queue right away.
    await db.flashcard.create({ data: { userId: user.id, front, back, dueDate: new Date() } });
    rl("/learning/flashcards");
}

export async function updateFlashcard(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.flashcard.updateMany({
        where: { id, userId: user.id },
        data: { front: str(fd, "front") ?? undefined, back: str(fd, "back") ?? undefined },
    });
    rl("/learning/flashcards");
}

export async function deleteFlashcard(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.flashcard.deleteMany({ where: { id, userId: user.id } });
    rl("/learning/flashcards");
}

export async function reviewFlashcard(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");

    // Accept an SM-2 recall grade (again|hard|good|easy); fall back to legacy gotIt.
    const raw = str(fd, "grade");
    const grade: RecallGrade = (["again", "hard", "good", "easy"] as const).includes(raw as RecallGrade)
        ? (raw as RecallGrade)
        : bool(fd, "gotIt")
          ? "good"
          : "again";

    const card = await db.flashcard.findFirst({
        where: { id, userId: user.id },
        select: { easeFactor: true, intervalDays: true, repetitions: true },
    });
    if (!card) throw new Error("Card not found");

    const next = schedule({ easeFactor: card.easeFactor, intervalDays: card.intervalDays, repetitions: card.repetitions }, gradeToQuality(grade));
    await db.flashcard.updateMany({
        where: { id, userId: user.id },
        data: {
            easeFactor: next.easeFactor,
            intervalDays: next.intervalDays,
            repetitions: next.repetitions,
            dueDate: next.dueDate,
            reviewCount: { increment: 1 },
            lastReviewedAt: new Date(),
        },
    });
    rl("/learning/flashcards");
}

// ── Quizzes & attempts ───────────────────────────────────────

export async function createQuiz(fd: FormData) {
    const user = await requireUser();
    const title = str(fd, "title");
    if (!title) throw new Error("Title is required");
    await db.quiz.create({ data: { userId: user.id, title, courseId: str(fd, "courseId") } });
    rl("/learning/quizzes");
}

export async function updateQuiz(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.quiz.updateMany({
        where: { id, userId: user.id },
        data: { title: str(fd, "title") ?? undefined, courseId: str(fd, "courseId") },
    });
    rl("/learning/quizzes");
}

export async function deleteQuiz(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.quiz.deleteMany({ where: { id, userId: user.id } });
    rl("/learning/quizzes");
}

export async function createAttempt(fd: FormData) {
    const user = await requireUser();
    const quizId = str(fd, "quizId");
    if (!quizId) throw new Error("Missing quiz");
    const owned = await db.quiz.findFirst({ where: { id: quizId, userId: user.id }, select: { id: true } });
    if (!owned) throw new Error("Quiz not found");
    await db.quizAttempt.create({ data: { quizId, score: num(fd, "score") } });
    rl("/learning/quizzes");
}

export async function deleteAttempt(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const attempt = await db.quizAttempt.findFirst({ where: { id, quiz: { userId: user.id } }, select: { id: true } });
    if (!attempt) throw new Error("Attempt not found");
    await db.quizAttempt.delete({ where: { id } });
    rl("/learning/quizzes");
}

// ── Notes ────────────────────────────────────────────────────

export async function createNote(fd: FormData) {
    const user = await requireUser();
    const title = str(fd, "title");
    if (!title) throw new Error("Title is required");
    await db.learningNote.create({ data: { userId: user.id, title, content: str(fd, "content") } });
    rl("/learning/notes");
}

export async function updateNote(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.learningNote.updateMany({
        where: { id, userId: user.id },
        data: { title: str(fd, "title") ?? undefined, content: str(fd, "content") },
    });
    rl("/learning/notes");
}

export async function deleteNote(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.learningNote.deleteMany({ where: { id, userId: user.id } });
    rl("/learning/notes");
}

// ── Sessions ─────────────────────────────────────────────────

export async function createSession(fd: FormData) {
    const user = await requireUser();
    await db.learningSession.create({
        data: {
            userId: user.id,
            sessionDate: parseDateOnly(str(fd, "sessionDate")),
            durationMinutes: int(fd, "durationMinutes"),
            notes: str(fd, "notes"),
            subject: str(fd, "subject"),
            energy: int(fd, "energy"),
            pomodoro: bool(fd, "pomodoro"),
        },
    });
    rl("/learning/sessions");
}

export async function updateSession(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const sessionDate = str(fd, "sessionDate");
    await db.learningSession.updateMany({
        where: { id, userId: user.id },
        data: {
            sessionDate: sessionDate ? parseDateOnly(sessionDate) : undefined,
            durationMinutes: int(fd, "durationMinutes"),
            notes: str(fd, "notes"),
            subject: str(fd, "subject"),
            energy: int(fd, "energy"),
            pomodoro: bool(fd, "pomodoro"),
        },
    });
    rl("/learning/sessions");
}

export async function deleteSession(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.learningSession.deleteMany({ where: { id, userId: user.id } });
    rl("/learning/sessions");
}

// ── Goals ────────────────────────────────────────────────────

export async function createGoal(fd: FormData) {
    const user = await requireUser();
    const description = str(fd, "description");
    if (!description) throw new Error("Description is required");
    await db.learningGoal.create({
        data: {
            userId: user.id,
            description,
            goalType: str(fd, "goalType"),
            targetDate: parseOptionalDateTime(str(fd, "targetDate")),
        },
    });
    rl("/learning/goals");
}

export async function toggleGoal(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const goal = await db.learningGoal.findFirst({ where: { id, userId: user.id }, select: { completed: true } });
    if (!goal) throw new Error("Goal not found");
    await db.learningGoal.update({ where: { id }, data: { completed: !goal.completed } });
    rl("/learning/goals");
}

export async function updateGoal(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const description = str(fd, "description");
    await db.learningGoal.updateMany({
        where: { id, userId: user.id },
        data: {
            description: description ?? undefined,
            goalType: str(fd, "goalType"),
            targetDate: parseOptionalDateTime(str(fd, "targetDate")),
        },
    });
    rl("/learning/goals");
}

export async function deleteGoal(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.learningGoal.deleteMany({ where: { id, userId: user.id } });
    rl("/learning/goals");
}

// ── Plan entries (checklist) ─────────────────────────────────

export async function createPlanEntry(fd: FormData) {
    const user = await requireUser();
    const title = str(fd, "title");
    if (!title) throw new Error("Title is required");
    await db.learningPlanEntry.create({
        data: { userId: user.id, title, scheduledFor: parseOptionalDateTime(str(fd, "scheduledFor")) },
    });
    rl("/learning/goals");
}

export async function togglePlanEntry(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const entry = await db.learningPlanEntry.findFirst({ where: { id, userId: user.id }, select: { completed: true } });
    if (!entry) throw new Error("Entry not found");
    await db.learningPlanEntry.update({ where: { id }, data: { completed: !entry.completed } });
    rl("/learning/goals");
}

export async function updatePlanEntry(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const title = str(fd, "title");
    await db.learningPlanEntry.updateMany({
        where: { id, userId: user.id },
        data: {
            title: title ?? undefined,
            scheduledFor: parseOptionalDateTime(str(fd, "scheduledFor")),
        },
    });
    rl("/learning/goals");
}

export async function deletePlanEntry(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.learningPlanEntry.deleteMany({ where: { id, userId: user.id } });
    rl("/learning/goals");
}

// ── Skills ───────────────────────────────────────────────────

export async function createSkill(fd: FormData) {
    const user = await requireUser();
    const name = str(fd, "name");
    if (!name) throw new Error("Name is required");
    await db.learningSkill.create({ data: { userId: user.id, name, proficiency: int(fd, "proficiency") ?? 0 } });
    rl("/learning/goals");
}

export async function updateSkillProficiency(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.learningSkill.updateMany({ where: { id, userId: user.id }, data: { proficiency: int(fd, "proficiency") ?? 0 } });
    rl("/learning/goals");
}

export async function deleteSkill(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.learningSkill.deleteMany({ where: { id, userId: user.id } });
    rl("/learning/goals");
}

// ── Resources ────────────────────────────────────────────────

export async function createResource(fd: FormData) {
    const user = await requireUser();
    const title = str(fd, "title");
    if (!title) throw new Error("Title is required");
    await db.learningResource.create({
        data: { userId: user.id, title, resourceType: str(fd, "resourceType"), url: str(fd, "url") },
    });
    rl("/learning/goals");
}

export async function updateResource(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const title = str(fd, "title");
    await db.learningResource.updateMany({
        where: { id, userId: user.id },
        data: {
            title: title ?? undefined,
            resourceType: str(fd, "resourceType"),
            url: str(fd, "url"),
        },
    });
    rl("/learning/goals");
}

export async function deleteResource(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.learningResource.deleteMany({ where: { id, userId: user.id } });
    rl("/learning/goals");
}

// ── Achievements ─────────────────────────────────────────────

export async function createAchievement(fd: FormData) {
    const user = await requireUser();
    const achievementType = str(fd, "achievementType");
    if (!achievementType) throw new Error("Type is required");
    await db.learningAchievement.create({
        data: {
            userId: user.id,
            achievementType,
            title: str(fd, "title"),
            earnedOn: parseDateOnly(str(fd, "earnedOn")),
        },
    });
    rl("/learning/goals");
}

export async function updateAchievement(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const achievementType = str(fd, "achievementType");
    const earnedOn = str(fd, "earnedOn");
    await db.learningAchievement.updateMany({
        where: { id, userId: user.id },
        data: {
            achievementType: achievementType ?? undefined,
            title: str(fd, "title"),
            earnedOn: earnedOn ? parseDateOnly(earnedOn) : undefined,
        },
    });
    rl("/learning/goals");
}

export async function deleteAchievement(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.learningAchievement.deleteMany({ where: { id, userId: user.id } });
    rl("/learning/goals");
}
