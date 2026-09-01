"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { aiConfigured, runClaude } from "@/lib/ai/claude";
import { generateGroupCover } from "@/lib/learning/collage";
import { thumbnailFor } from "@/lib/learning/youtube";
import { parseForm, zId } from "@/lib/learning/zod";

/** Model used for all learning AI features (per spec). */
const MODEL = "claude-sonnet-4-6";

// ── Video archive: AI thematic grouping ──────────────────────────────────────

const SORT_SCHEMA = {
    type: "object",
    properties: {
        groups: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    name: { type: "string", description: "Short thematic group name, e.g. 'React Tutorials'." },
                    theme_color: { type: "string", description: "A hex color like #7F56D9 representing the theme." },
                    video_ids: { type: "array", items: { type: "string" }, description: "Ids of videos in this group." },
                },
                required: ["name", "theme_color", "video_ids"],
            },
        },
    },
    required: ["groups"],
} as const;

interface SortResult {
    groups: { name: string; theme_color: string; video_ids: string[] }[];
}

/**
 * Send every archived video to Claude, which sorts them into thematic groups.
 * Existing groups are rebuilt; each new group gets a 2x2 thumbnail collage cover.
 */
export async function aiSortVideos(): Promise<{ groups: number }> {
    const user = await requireUser();
    if (!aiConfigured()) throw new Error("AI is not configured — set ANTHROPIC_API_KEY on the server.");

    const videos = await db.archiveVideo.findMany({
        where: { userId: user.id },
        select: { id: true, youtubeId: true, title: true, channel: true },
    });
    if (videos.length < 2) throw new Error("Add at least 2 videos before auto-sorting.");

    const settings = await db.settings.findUnique({ where: { userId: user.id }, select: { aiModel: true } });
    const list = videos.map((v) => `- [${v.id}] ${v.title}${v.channel ? ` — ${v.channel}` : ""}`).join("\n");

    const { data } = await runClaude<SortResult>({
        purpose: "video-archive-sort",
        userId: user.id,
        model: settings?.aiModel ?? MODEL,
        schema: SORT_SCHEMA,
        system:
            "You organize a user's saved YouTube videos into a small number (between 3 and 8) of coherent, " +
            "well-named thematic groups (e.g. 'React Tutorials', 'Business Strategy', 'Design Systems'). " +
            "Assign every video id to exactly one group. Pick a distinctive hex theme color per group.",
        content: `Sort these videos into thematic groups, using each id exactly once:\n\n${list}`,
    });

    const validIds = new Set(videos.map((v) => v.id));
    const thumbById = new Map(videos.map((v) => [v.id, thumbnailFor(v.youtubeId)]));

    // Rebuild groups (videos' groupId is set to null when their old group is removed).
    await db.videoGroup.deleteMany({ where: { userId: user.id } });

    let created = 0;
    for (const g of data.groups) {
        const ids = [...new Set(g.video_ids.filter((id) => validIds.has(id)))];
        if (!ids.length) continue;
        const thumbs = ids.map((id) => thumbById.get(id)).filter((t): t is string => Boolean(t));
        let coverKey: string | null = null;
        try {
            coverKey = await generateGroupCover(user.id, thumbs, g.theme_color);
        } catch {
            coverKey = null; // collage is best-effort
        }
        const group = await db.videoGroup.create({
            data: { userId: user.id, name: g.name.trim() || "Untitled group", themeColor: g.theme_color, coverKey },
        });
        await db.archiveVideo.updateMany({ where: { id: { in: ids }, userId: user.id }, data: { groupId: group.id } });
        created += 1;
    }

    revalidatePath("/learning/archive");
    return { groups: created };
}

// ── Goals: AI learning-path generator ────────────────────────────────────────

const PATH_SCHEMA = {
    type: "object",
    properties: {
        milestones: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    title: { type: "string", description: "Concrete milestone, e.g. 'Complete chapters 1-5'." },
                    week: { type: "integer", description: "1-based week number this milestone targets." },
                },
                required: ["title", "week"],
            },
        },
    },
    required: ["milestones"],
} as const;

interface PathResult {
    milestones: { title: string; week: number }[];
}

/** Generate a week-by-week milestone curriculum for a goal and append it. */
export async function generateLearningPath(fd: FormData): Promise<{ added: number }> {
    const user = await requireUser();
    if (!aiConfigured()) throw new Error("AI is not configured — set ANTHROPIC_API_KEY on the server.");

    const { goalId } = parseForm(z.object({ goalId: zId }), fd);
    const goal = await db.learningGoal.findFirst({ where: { id: goalId, userId: user.id } });
    if (!goal) throw new Error("Goal not found.");

    const settings = await db.settings.findUnique({ where: { userId: user.id }, select: { aiModel: true } });
    const target = goal.targetDate ? ` Target completion date: ${goal.targetDate.toISOString().slice(0, 10)}.` : "";

    const { data } = await runClaude<PathResult>({
        purpose: "learning-path",
        userId: user.id,
        model: settings?.aiModel ?? MODEL,
        schema: PATH_SCHEMA,
        system:
            "You are a learning coach. Break a learning goal into an ordered sequence of 4-12 concrete, " +
            "achievable weekly milestones with specific deliverables. Keep titles short and actionable.",
        content: `Goal: ${goal.title ?? goal.description}\nDetail: ${goal.description}.${target}`,
    });

    const existingCount = await db.goalMilestone.count({ where: { goalId } });
    const base = new Date();
    base.setHours(0, 0, 0, 0);

    const rows = data.milestones.map((m, i) => {
        const due = new Date(base);
        due.setDate(due.getDate() + Math.max(1, m.week || i + 1) * 7);
        return { goalId, title: m.title.trim(), order: existingCount + i, dueDate: due };
    });
    if (rows.length) await db.goalMilestone.createMany({ data: rows });

    revalidatePath("/learning/goals");
    return { added: rows.length };
}

// ── Archive: "Watch next" recommendation ─────────────────────────────────────

const NEXT_SCHEMA = {
    type: "object",
    properties: {
        video_id: { type: "string" },
        reason: { type: "string", description: "One short sentence on why this video is the best next watch." },
    },
    required: ["video_id", "reason"],
} as const;

export async function recommendWatchNext(): Promise<{ videoId: string | null; reason: string }> {
    const user = await requireUser();
    if (!aiConfigured()) throw new Error("AI is not configured — set ANTHROPIC_API_KEY on the server.");

    const [videos, goals] = await Promise.all([
        db.archiveVideo.findMany({
            where: { userId: user.id, watchStatus: { not: "WATCHED" } },
            select: { id: true, title: true, group: { select: { name: true } } },
            take: 60,
        }),
        db.learningGoal.findMany({ where: { userId: user.id, completed: false }, select: { title: true, description: true }, take: 10 }),
    ]);
    if (!videos.length) return { videoId: null, reason: "You've watched everything in your archive 🎉" };

    const settings = await db.settings.findUnique({ where: { userId: user.id }, select: { aiModel: true } });
    const list = videos.map((v) => `- [${v.id}] ${v.title}${v.group ? ` (group: ${v.group.name})` : ""}`).join("\n");
    const goalText = goals.length ? goals.map((g) => `- ${g.title ?? g.description}`).join("\n") : "No active goals.";

    const { data } = await runClaude<{ video_id: string; reason: string }>({
        purpose: "watch-next",
        userId: user.id,
        model: settings?.aiModel ?? MODEL,
        schema: NEXT_SCHEMA,
        system: "You recommend the single best next video to watch based on the user's active learning goals.",
        content: `Active learning goals:\n${goalText}\n\nUnwatched videos:\n${list}\n\nPick the most relevant video id to watch next and explain briefly.`,
    });

    const exists = videos.some((v) => v.id === data.video_id);
    return { videoId: exists ? data.video_id : videos[0].id, reason: data.reason };
}
