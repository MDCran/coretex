import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { GroupDetailClient } from "./group-detail-client";
import type { GroupOption, VideoRow } from "../_components/video-card";

export default async function GroupDetailPage({ params }: { params: Promise<{ groupId: string }> }) {
    const { groupId } = await params;
    const user = await requireUser();

    const group = await db.videoGroup.findFirst({
        where: { id: groupId, userId: user.id },
        include: { videos: { orderBy: { addedAt: "desc" } } },
    });
    if (!group) notFound();

    const allGroups = await db.videoGroup.findMany({
        where: { userId: user.id },
        select: { id: true, name: true },
        orderBy: { createdAt: "asc" },
    });

    const videos: VideoRow[] = group.videos.map((v) => ({
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
    }));

    const groupOptions: GroupOption[] = allGroups;

    return (
        <GroupDetailClient
            group={{
                id: group.id,
                name: group.name,
                themeColor: group.themeColor,
                coverKey: group.coverKey,
            }}
            videos={videos}
            groups={groupOptions}
        />
    );
}
