import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ArchiveClient, type GroupCard, type VideoData } from "./archive-client";

export default async function ArchivePage() {
    const user = await requireUser();

    const [groups, videos] = await Promise.all([
        db.videoGroup.findMany({
            where: { userId: user.id },
            include: { videos: { select: { durationSeconds: true, addedAt: true, watchStatus: true } } },
            orderBy: { createdAt: "asc" },
        }),
        db.archiveVideo.findMany({ where: { userId: user.id }, orderBy: { addedAt: "desc" } }),
    ]);

    const groupCards: GroupCard[] = groups.map((g) => {
        const totalDuration = g.videos.reduce((s, v) => s + (v.durationSeconds ?? 0), 0);
        const lastAdded = g.videos.reduce<Date | null>((max, v) => (!max || v.addedAt > max ? v.addedAt : max), null);
        return {
            id: g.id,
            name: g.name,
            themeColor: g.themeColor,
            coverKey: g.coverKey,
            videoCount: g.videos.length,
            totalDurationSeconds: totalDuration,
            watchedCount: g.videos.filter((v) => v.watchStatus === "WATCHED").length,
            lastAdded: lastAdded ? lastAdded.toISOString() : null,
        };
    });

    const videoData: VideoData[] = videos.map((v) => ({
        id: v.id,
        youtubeId: v.youtubeId,
        title: v.title,
        channel: v.channel,
        thumbnailUrl: v.thumbnailUrl,
        durationSeconds: v.durationSeconds,
        watchStatus: v.watchStatus,
        watchProgress: v.watchProgress,
        notes: v.notes,
        addedAt: v.addedAt.toISOString(),
        groupId: v.groupId,
    }));

    return <ArchiveClient groups={groupCards} videos={videoData} />;
}
