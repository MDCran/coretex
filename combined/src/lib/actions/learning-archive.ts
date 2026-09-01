"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fetchPlaylistVideos, fetchVideoMeta } from "@/lib/learning/youtube";
import { parseForm, zId, zInt, zOptInt, zOptText, zText } from "@/lib/learning/zod";

/** Revalidate the archive + learning hub after a mutation. */
function rl() {
    revalidatePath("/learning/archive");
    revalidatePath("/learning");
}

// ── Videos ───────────────────────────────────────────────────────────────────

/**
 * Add a single video from a pasted YouTube URL. Metadata is resolved keylessly
 * via oEmbed. If the user already has this video (unique on userId+youtubeId),
 * this is a graceful no-op rather than a 500.
 */
export async function addVideo(fd: FormData) {
    const user = await requireUser();
    const { url, durationSeconds, groupId } = parseForm(
        z.object({ url: zText, durationSeconds: zOptInt, groupId: zOptText }),
        fd,
    );

    const meta = await fetchVideoMeta(url);

    const existing = await db.archiveVideo.findUnique({
        where: { userId_youtubeId: { userId: user.id, youtubeId: meta.youtubeId } },
        select: { id: true },
    });
    if (existing) {
        rl();
        return; // already saved — skip gracefully
    }

    let group: string | null = null;
    if (groupId) {
        const owned = await db.videoGroup.findFirst({ where: { id: groupId, userId: user.id }, select: { id: true } });
        group = owned?.id ?? null;
    }

    await db.archiveVideo.create({
        data: {
            userId: user.id,
            groupId: group,
            youtubeId: meta.youtubeId,
            url: meta.url,
            title: meta.title,
            channel: meta.channel,
            thumbnailUrl: meta.thumbnailUrl,
            durationSeconds: durationSeconds && durationSeconds > 0 ? durationSeconds : null,
        },
    });
    rl();
}

/**
 * Import up to ~15 recent videos from a public playlist (keyless RSS). Existing
 * videos are skipped (skipDuplicates). Returns how many were newly added.
 */
export async function importPlaylist(fd: FormData): Promise<{ added: number }> {
    const user = await requireUser();
    const { url } = parseForm(z.object({ url: zText }), fd);

    const metas = await fetchPlaylistVideos(url);
    const result = await db.archiveVideo.createMany({
        data: metas.map((m) => ({
            userId: user.id,
            youtubeId: m.youtubeId,
            url: m.url,
            title: m.title,
            channel: m.channel,
            thumbnailUrl: m.thumbnailUrl,
        })),
        skipDuplicates: true,
    });

    rl();
    return { added: result.count };
}

export async function deleteVideo(fd: FormData) {
    const user = await requireUser();
    const { id } = parseForm(z.object({ id: zId }), fd);
    await db.archiveVideo.deleteMany({ where: { id, userId: user.id } });
    rl();
}

export async function setWatchStatus(fd: FormData) {
    const user = await requireUser();
    const { id, status } = parseForm(
        z.object({ id: zId, status: z.enum(["NOT_WATCHED", "WATCHING", "WATCHED"]) }),
        fd,
    );
    // Keep progress coherent with the chosen status.
    const data =
        status === "WATCHED"
            ? { watchStatus: status, watchProgress: 100 }
            : status === "NOT_WATCHED"
              ? { watchStatus: status, watchProgress: 0 }
              : { watchStatus: status };
    await db.archiveVideo.updateMany({ where: { id, userId: user.id }, data });
    rl();
}

export async function setWatchProgress(fd: FormData) {
    const user = await requireUser();
    const { id, progress } = parseForm(z.object({ id: zId, progress: zInt }), fd);
    const clamped = Math.max(0, Math.min(100, progress));
    // Moving the slider implies the video is in progress (or finished at 100).
    const status = clamped >= 100 ? "WATCHED" : clamped > 0 ? "WATCHING" : "NOT_WATCHED";
    await db.archiveVideo.updateMany({
        where: { id, userId: user.id },
        data: { watchProgress: clamped, watchStatus: status },
    });
    rl();
}

export async function updateVideoNotes(fd: FormData) {
    const user = await requireUser();
    const { id, notes } = parseForm(z.object({ id: zId, notes: zOptText }), fd);
    await db.archiveVideo.updateMany({ where: { id, userId: user.id }, data: { notes: notes ?? null } });
    rl();
}

export async function setVideoDuration(fd: FormData) {
    const user = await requireUser();
    const { id, durationSeconds } = parseForm(z.object({ id: zId, durationSeconds: zOptInt }), fd);
    await db.archiveVideo.updateMany({
        where: { id, userId: user.id },
        data: { durationSeconds: durationSeconds && durationSeconds > 0 ? durationSeconds : null },
    });
    rl();
}

export async function moveVideoToGroup(fd: FormData) {
    const user = await requireUser();
    const { id, groupId } = parseForm(z.object({ id: zId, groupId: zOptText }), fd);

    let target: string | null = null;
    if (groupId) {
        const owned = await db.videoGroup.findFirst({ where: { id: groupId, userId: user.id }, select: { id: true } });
        if (!owned) throw new Error("Group not found.");
        target = owned.id;
    }
    await db.archiveVideo.updateMany({ where: { id, userId: user.id }, data: { groupId: target } });
    rl();
}

// ── Groups ───────────────────────────────────────────────────────────────────

export async function createGroup(fd: FormData) {
    const user = await requireUser();
    const { name, themeColor } = parseForm(z.object({ name: zText, themeColor: zOptText }), fd);
    await db.videoGroup.create({
        data: { userId: user.id, name, themeColor: themeColor ?? null },
    });
    rl();
}

export async function renameGroup(fd: FormData) {
    const user = await requireUser();
    const { id, name, themeColor } = parseForm(z.object({ id: zId, name: zText, themeColor: zOptText }), fd);
    await db.videoGroup.updateMany({
        where: { id, userId: user.id },
        data: { name, themeColor: themeColor ?? undefined },
    });
    rl();
}

export async function deleteGroup(fd: FormData) {
    const user = await requireUser();
    const { id } = parseForm(z.object({ id: zId }), fd);
    // Videos' groupId is SetNull on delete — they fall back to the unsorted section.
    await db.videoGroup.deleteMany({ where: { id, userId: user.id } });
    rl();
}
