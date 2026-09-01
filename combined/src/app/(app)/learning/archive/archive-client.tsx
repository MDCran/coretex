"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    Calendar,
    LayoutGrid01,
    Lightbulb02,
    MagicWand02,
    PlayCircle,
    Plus,
    PlusCircle,
    Stars02,
    VideoRecorder,
} from "@untitledui/icons";
import { toast } from "sonner";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { cx } from "@/utils/cx";
import { fileUrl } from "@/lib/files";
import { formatDate } from "@/lib/dates";
import { formatDuration } from "@/lib/learning/youtube-shared";
import { aiSortVideos, recommendWatchNext } from "@/lib/actions/learning-ai";
import { addVideo, importPlaylist } from "@/lib/actions/learning-archive";
import { Card, EmptyState, Field, NativeInput, SectionHeader, Stat } from "../_components/learning-ui";
import { FormModal } from "../_components/form-modal";
import { VideoCard, type GroupOption, type VideoRow, type WatchStatus } from "./_components/video-card";

export interface GroupCard {
    id: string;
    name: string;
    themeColor: string | null;
    coverKey: string | null;
    videoCount: number;
    totalDurationSeconds: number;
    watchedCount: number;
    lastAdded: string | null;
}

export interface VideoData extends VideoRow {
    groupId: string | null;
}

async function run(action: (fd: FormData) => Promise<unknown>, fd: FormData, ok = "Saved") {
    try {
        await action(fd);
        toast.success(ok);
        return true;
    } catch (e) {
        toast.error(e instanceof Error ? e.message : "Something went wrong");
        return false;
    }
}

/** Bucket a date into a human label relative to today. */
function timelineBucket(iso: string): string {
    const d = new Date(iso);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const that = new Date(d);
    that.setHours(0, 0, 0, 0);
    const diffDays = Math.round((today.getTime() - that.getTime()) / 86_400_000);
    if (diffDays <= 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    return formatDate(iso);
}

/** Group cover: collage when available, else a theme-tinted fallback block. */
function GroupCover({ group, className }: { group: GroupCard; className?: string }) {
    if (group.coverKey) {
        // eslint-disable-next-line @next/next/no-img-element
        return <img src={fileUrl(group.coverKey)} alt={group.name} className={cx("w-full object-cover", className)} />;
    }
    return (
        <div
            className={cx("flex w-full items-center justify-center", className)}
            style={{ backgroundColor: group.themeColor ?? undefined }}
        >
            <PlayCircle aria-hidden="true" className="size-10 text-white/80" />
        </div>
    );
}

export function ArchiveClient({ groups, videos }: { groups: GroupCard[]; videos: VideoData[] }) {
    const router = useRouter();
    const [addOpen, setAddOpen] = useState(false);
    const [playlistOpen, setPlaylistOpen] = useState(false);
    const [view, setView] = useState<"groups" | "timeline">("groups");
    const [sorting, startSort] = useTransition();
    const [recommending, startRecommend] = useTransition();
    const [rec, setRec] = useState<{ video: VideoData | null; reason: string } | null>(null);

    const groupOptions: GroupOption[] = useMemo(() => groups.map((g) => ({ id: g.id, name: g.name })), [groups]);
    const unsorted = useMemo(() => videos.filter((v) => v.groupId == null), [videos]);

    const totalDuration = videos.reduce((s, v) => s + (v.durationSeconds ?? 0), 0);
    const watchedCount = videos.filter((v) => v.watchStatus === ("WATCHED" as WatchStatus)).length;

    // Build timeline buckets in addedAt order (videos already sorted desc).
    const timeline = useMemo(() => {
        const buckets: { label: string; videos: VideoData[] }[] = [];
        for (const v of videos) {
            const label = timelineBucket(v.addedAt);
            const last = buckets[buckets.length - 1];
            if (last && last.label === label) last.videos.push(v);
            else buckets.push({ label, videos: [v] });
        }
        return buckets;
    }, [videos]);

    const runSort = () =>
        startSort(async () => {
            try {
                const { groups: n } = await aiSortVideos();
                toast.success(`Sorted into ${n} group${n === 1 ? "" : "s"}`);
                router.refresh();
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Could not sort videos");
            }
        });

    const runRecommend = () =>
        startRecommend(async () => {
            try {
                const { videoId, reason } = await recommendWatchNext();
                const video = videoId ? (videos.find((v) => v.id === videoId) ?? null) : null;
                setRec({ video, reason });
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Could not get a recommendation");
            }
        });

    return (
        <div className="flex flex-col gap-6">
            <SectionHeader
                title="YouTube video archive"
                description="Save videos, let AI sort them into thematic groups, track your watch progress, and get a smart pick for what to watch next."
                action={
                    <div className="flex flex-wrap items-center gap-2">
                        <Button size="md" color="secondary" iconLeading={PlusCircle} onClick={() => setPlaylistOpen(true)}>
                            Import playlist
                        </Button>
                        <Button size="md" iconLeading={Plus} onClick={() => setAddOpen(true)}>
                            Add video
                        </Button>
                    </div>
                }
            />

            {videos.length > 0 && (
                <>
                    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                        <Stat label="Videos" value={videos.length} />
                        <Stat label="Groups" value={groups.length} />
                        <Stat label="Watched" value={watchedCount} sub={videos.length ? `of ${videos.length}` : undefined} />
                        <Stat label="Total duration" value={formatDuration(totalDuration)} />
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <Button
                                size="sm"
                                color="secondary"
                                iconLeading={MagicWand02}
                                isLoading={sorting}
                                showTextWhileLoading
                                isDisabled={videos.length < 2}
                                onClick={runSort}
                            >
                                AI sort
                            </Button>
                            <Button
                                size="sm"
                                color="secondary"
                                iconLeading={Stars02}
                                isLoading={recommending}
                                showTextWhileLoading
                                onClick={runRecommend}
                            >
                                Watch next
                            </Button>
                        </div>

                        {/* View toggle */}
                        <div className="flex items-center gap-1 rounded-lg bg-secondary p-1 ring-1 ring-secondary ring-inset">
                            <button
                                type="button"
                                onClick={() => setView("groups")}
                                className={cx(
                                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition duration-100 ease-linear",
                                    view === "groups" ? "bg-primary text-primary shadow-xs" : "text-tertiary hover:text-secondary",
                                )}
                            >
                                <LayoutGrid01 aria-hidden="true" className="size-4" /> Groups
                            </button>
                            <button
                                type="button"
                                onClick={() => setView("timeline")}
                                className={cx(
                                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition duration-100 ease-linear",
                                    view === "timeline" ? "bg-primary text-primary shadow-xs" : "text-tertiary hover:text-secondary",
                                )}
                            >
                                <Calendar aria-hidden="true" className="size-4" /> Timeline
                            </button>
                        </div>
                    </div>

                    {rec && (
                        <div className="flex items-start gap-3 rounded-xl bg-brand-secondary p-4 ring-1 ring-brand ring-inset">
                            <Lightbulb02 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-fg-brand-primary" />
                            <div className="flex min-w-0 flex-col gap-0.5">
                                <p className="text-sm font-semibold text-primary">
                                    {rec.video ? `Watch next: ${rec.video.title}` : "Watch next"}
                                </p>
                                <p className="text-sm text-tertiary">{rec.reason}</p>
                                {rec.video && (
                                    <a
                                        href={`https://www.youtube.com/watch?v=${rec.video.youtubeId}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="mt-1 text-sm font-medium text-brand-secondary hover:text-brand-secondary_hover"
                                    >
                                        Open on YouTube →
                                    </a>
                                )}
                            </div>
                            <button
                                type="button"
                                aria-label="Dismiss"
                                onClick={() => setRec(null)}
                                className="ml-auto text-sm text-tertiary hover:text-secondary"
                            >
                                Dismiss
                            </button>
                        </div>
                    )}
                </>
            )}

            {videos.length === 0 ? (
                <Card>
                    <EmptyState
                        icon={VideoRecorder}
                        title="Start your video archive"
                        description="Paste a YouTube link to save a video, or import a playlist. Once you've added a few, let AI sort them into thematic groups."
                        action={
                            <>
                                <Button size="md" iconLeading={Plus} onClick={() => setAddOpen(true)}>
                                    Add video
                                </Button>
                                <Button size="md" color="secondary" iconLeading={PlusCircle} onClick={() => setPlaylistOpen(true)}>
                                    Import playlist
                                </Button>
                            </>
                        }
                    />
                </Card>
            ) : view === "groups" ? (
                <div className="flex flex-col gap-6">
                    {/* Group grid (masonry-ish via CSS columns) */}
                    {groups.length > 0 && (
                        <div className="columns-1 gap-4 sm:columns-2 lg:columns-3 [&>*]:mb-4">
                            {groups.map((g, i) => (
                                <Link
                                    key={g.id}
                                    href={`/learning/archive/${g.id}`}
                                    className="block break-inside-avoid overflow-hidden rounded-xl bg-primary ring-1 ring-secondary ring-inset transition duration-100 ease-linear hover:ring-brand"
                                >
                                    {/* Varied heights for a masonry feel */}
                                    <GroupCover group={g} className={i % 3 === 0 ? "aspect-square" : i % 3 === 1 ? "aspect-video" : "aspect-4/3"} />
                                    <div className="flex flex-col gap-2 p-4">
                                        <div className="flex items-center gap-2">
                                            {g.themeColor && (
                                                <span aria-hidden="true" className="size-3 shrink-0 rounded-full" style={{ backgroundColor: g.themeColor }} />
                                            )}
                                            <h3 className="line-clamp-1 text-md font-semibold text-primary">{g.name}</h3>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            <Badge color="gray" size="sm" type="modern">
                                                {g.videoCount} video{g.videoCount === 1 ? "" : "s"}
                                            </Badge>
                                            <Badge color="gray" size="sm" type="modern">
                                                {formatDuration(g.totalDurationSeconds)}
                                            </Badge>
                                            {g.watchedCount > 0 && (
                                                <Badge color="success" size="sm" type="pill-color">
                                                    {g.watchedCount} watched
                                                </Badge>
                                            )}
                                        </div>
                                        {g.lastAdded && <p className="text-xs text-tertiary">Last added {formatDate(g.lastAdded)}</p>}
                                    </div>
                                </Link>
                            ))}
                        </div>
                    )}

                    {/* Unsorted section */}
                    <div className="flex flex-col gap-4">
                        <SectionHeader
                            title="Unsorted"
                            description={unsorted.length ? `${unsorted.length} video${unsorted.length === 1 ? "" : "s"} not yet grouped.` : "Everything is sorted."}
                            action={
                                unsorted.length >= 2 ? (
                                    <Button size="sm" color="secondary" iconLeading={MagicWand02} isLoading={sorting} showTextWhileLoading onClick={runSort}>
                                        AI sort these
                                    </Button>
                                ) : undefined
                            }
                        />
                        {unsorted.length === 0 ? (
                            <Card>
                                <EmptyState compact icon={LayoutGrid01} title="No unsorted videos" description="New videos land here until you group them." />
                            </Card>
                        ) : (
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                {unsorted.map((v) => (
                                    <VideoCard key={v.id} video={v} groups={groupOptions} currentGroupId={null} />
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                /* Timeline view */
                <div className="flex flex-col gap-6">
                    {timeline.map((bucket) => (
                        <div key={bucket.label} className="flex flex-col gap-3">
                            <div className="flex items-center gap-3">
                                <span aria-hidden="true" className="size-2.5 rounded-full bg-brand-solid" />
                                <h3 className="text-sm font-semibold text-primary">{bucket.label}</h3>
                                <span className="text-xs text-tertiary">
                                    {bucket.videos.length} video{bucket.videos.length === 1 ? "" : "s"}
                                </span>
                            </div>
                            <div className="ml-1 flex flex-col gap-4 border-l border-secondary pl-5">
                                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                    {bucket.videos.map((v) => (
                                        <VideoCard key={v.id} video={v} groups={groupOptions} currentGroupId={v.groupId} />
                                    ))}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Add video modal */}
            <FormModal isOpen={addOpen} onOpenChange={setAddOpen} title="Add video" description="Paste a YouTube link. Title, channel, and thumbnail auto-fill via oEmbed.">
                <form
                    action={async (fd) => {
                        const mins = fd.get("durationMinutes");
                        fd.delete("durationMinutes");
                        if (typeof mins === "string" && mins.trim()) {
                            const n = Number(mins);
                            if (Number.isFinite(n) && n > 0) fd.set("durationSeconds", String(Math.round(n * 60)));
                        }
                        const ok = await run(addVideo, fd, "Added");
                        if (ok) setAddOpen(false);
                    }}
                    className="flex flex-col gap-4"
                >
                    <Field label="YouTube URL" htmlFor="url" required hint="Any watch, share, shorts, or embed link.">
                        <NativeInput id="url" name="url" type="url" required placeholder="https://www.youtube.com/watch?v=..." />
                    </Field>
                    <Field label="Duration (minutes)" htmlFor="durationMinutes" hint="Optional — oEmbed does not expose duration, so set it manually.">
                        <NativeInput id="durationMinutes" name="durationMinutes" type="number" min={0} placeholder="e.g. 14" />
                    </Field>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setAddOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="submit">Add</Button>
                    </div>
                </form>
            </FormModal>

            {/* Import playlist modal */}
            <FormModal
                isOpen={playlistOpen}
                onOpenChange={setPlaylistOpen}
                title="Import playlist"
                description="Paste a public YouTube playlist URL."
            >
                <form
                    action={async (fd) => {
                        try {
                            const { added } = await importPlaylist(fd);
                            toast.success(added > 0 ? `Imported ${added} video${added === 1 ? "" : "s"}` : "No new videos to import");
                            setPlaylistOpen(false);
                        } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Could not import playlist");
                        }
                    }}
                    className="flex flex-col gap-4"
                >
                    <Field label="Playlist URL" htmlFor="playlist-url" required hint="Keyless import grabs up to ~15 recent videos; duration is not available.">
                        <NativeInput id="playlist-url" name="url" type="url" required placeholder="https://www.youtube.com/playlist?list=..." />
                    </Field>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setPlaylistOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="submit">Import</Button>
                    </div>
                </form>
            </FormModal>
        </div>
    );
}
