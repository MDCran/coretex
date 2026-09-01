"use client";

import { useState, useTransition } from "react";
import { LinkExternal01, MessageTextSquare01, PlayCircle, Trash02 } from "@untitledui/icons";
import { toast } from "sonner";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { cx } from "@/utils/cx";
import { formatDate } from "@/lib/dates";
import { formatDuration, watchUrl } from "@/lib/learning/youtube-shared";
import { Field, NativeInput, NativeSelect, NativeTextarea, ProgressBar } from "../../_components/learning-ui";
import {
    deleteVideo,
    moveVideoToGroup,
    setVideoDuration,
    setWatchProgress,
    setWatchStatus,
    updateVideoNotes,
} from "@/lib/actions/learning-archive";

export type WatchStatus = "NOT_WATCHED" | "WATCHING" | "WATCHED";

export interface VideoRow {
    id: string;
    youtubeId: string;
    title: string;
    channel: string | null;
    thumbnailUrl: string | null;
    durationSeconds: number | null;
    watchStatus: WatchStatus;
    watchProgress: number;
    notes: string | null;
    addedAt: string;
}

export interface GroupOption {
    id: string;
    name: string;
}

const STATUS_OPTIONS: { value: WatchStatus; label: string }[] = [
    { value: "NOT_WATCHED", label: "To watch" },
    { value: "WATCHING", label: "Watching" },
    { value: "WATCHED", label: "Watched" },
];

const STATUS_COLOR: Record<WatchStatus, "gray" | "brand" | "success"> = {
    NOT_WATCHED: "gray",
    WATCHING: "brand",
    WATCHED: "success",
};

async function run(action: (fd: FormData) => Promise<unknown>, fd: FormData, ok = "Saved") {
    try {
        await action(fd);
        toast.success(ok);
    } catch (e) {
        toast.error(e instanceof Error ? e.message : "Something went wrong");
    }
}

/**
 * A single archived video: thumbnail, title (opens YouTube), channel, a duration
 * badge + date-added chip, an inline watch-status control with a progress bar
 * while WATCHING, an editable timestamped notes field, a move-to-group control,
 * and delete. Reused in both the unsorted section and the group detail view.
 */
export function VideoCard({ video, groups, currentGroupId }: { video: VideoRow; groups: GroupOption[]; currentGroupId?: string | null }) {
    const [pending, startTransition] = useTransition();
    const [showNotes, setShowNotes] = useState(Boolean(video.notes));
    const [notes, setNotes] = useState(video.notes ?? "");
    const [progress, setProgress] = useState(video.watchProgress);
    const [duration, setDuration] = useState(video.durationSeconds);
    const link = watchUrl(video.youtubeId);

    const submit = (action: (fd: FormData) => Promise<unknown>, fd: FormData, ok?: string) =>
        startTransition(() => {
            void run(action, fd, ok);
        });

    return (
        <div className={cx("flex flex-col gap-3 rounded-xl bg-primary p-4 ring-1 ring-secondary ring-inset", pending && "opacity-70")}>
            <a href={link} target="_blank" rel="noreferrer" className="group relative block overflow-hidden rounded-lg ring-1 ring-secondary ring-inset">
                {video.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={video.thumbnailUrl} alt={video.title} className="aspect-video w-full object-cover" />
                ) : (
                    <div className="flex aspect-video w-full items-center justify-center bg-brand-secondary">
                        <PlayCircle aria-hidden="true" className="size-8 text-fg-brand-primary" />
                    </div>
                )}
                <div className="absolute inset-0 flex items-center justify-center bg-overlay/0 transition duration-100 ease-linear group-hover:bg-overlay/30">
                    <PlayCircle aria-hidden="true" className="size-10 text-white opacity-0 transition duration-100 ease-linear group-hover:opacity-100" />
                </div>
                <span className="absolute right-1.5 bottom-1.5 rounded-md bg-primary-solid px-1.5 py-0.5 text-xs font-medium text-white">
                    {formatDuration(video.durationSeconds)}
                </span>
            </a>

            <div className="flex flex-col gap-1">
                <a href={link} target="_blank" rel="noreferrer" className="line-clamp-2 text-sm font-semibold text-primary transition duration-100 ease-linear hover:text-brand-secondary">
                    {video.title}
                </a>
                {video.channel && <p className="truncate text-xs text-tertiary">{video.channel}</p>}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
                <Badge color={STATUS_COLOR[video.watchStatus]} size="sm" type="pill-color">
                    {STATUS_OPTIONS.find((s) => s.value === video.watchStatus)?.label}
                </Badge>
                <Badge color="gray" size="sm" type="modern">
                    {formatDate(video.addedAt)}
                </Badge>
            </div>

            {/* Watch-status control */}
            <NativeSelect
                aria-label="Watch status"
                value={video.watchStatus}
                disabled={pending}
                onChange={(e) => {
                    const fd = new FormData();
                    fd.set("id", video.id);
                    fd.set("status", e.target.value);
                    submit(setWatchStatus, fd, "Status updated");
                }}
            >
                {STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                        {o.label}
                    </option>
                ))}
            </NativeSelect>

            {video.watchStatus === "WATCHING" && (
                <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-xs text-tertiary">
                        <span>Progress</span>
                        <span className="font-medium text-secondary">{progress}%</span>
                    </div>
                    <ProgressBar value={progress} max={100} />
                    <input
                        type="range"
                        min={0}
                        max={100}
                        value={progress}
                        disabled={pending}
                        aria-label="Watch progress"
                        className="w-full cursor-pointer accent-[var(--color-bg-brand-solid,#7F56D9)]"
                        onChange={(e) => setProgress(Number(e.target.value))}
                        onMouseUp={() => {
                            const fd = new FormData();
                            fd.set("id", video.id);
                            fd.set("progress", String(progress));
                            submit(setWatchProgress, fd, "Progress saved");
                        }}
                        onTouchEnd={() => {
                            const fd = new FormData();
                            fd.set("id", video.id);
                            fd.set("progress", String(progress));
                            submit(setWatchProgress, fd, "Progress saved");
                        }}
                    />
                </div>
            )}

            {/* Notes (timestamped) */}
            {showNotes ? (
                <Field label="Notes" htmlFor={`notes-${video.id}`} hint="Drop timestamped notes, e.g. 'key concept at 12:34'.">
                    <NativeTextarea
                        id={`notes-${video.id}`}
                        value={notes}
                        disabled={pending}
                        placeholder="e.g. key concept at 12:34"
                        onChange={(e) => setNotes(e.target.value)}
                        onBlur={() => {
                            if (notes === (video.notes ?? "")) return;
                            const fd = new FormData();
                            fd.set("id", video.id);
                            fd.set("notes", notes);
                            submit(updateVideoNotes, fd, "Notes saved");
                        }}
                    />
                </Field>
            ) : (
                <Button size="sm" color="link-gray" iconLeading={MessageTextSquare01} onClick={() => setShowNotes(true)}>
                    Add notes
                </Button>
            )}

            {/* Move to group */}
            <Field label="Group" htmlFor={`group-${video.id}`}>
                <NativeSelect
                    id={`group-${video.id}`}
                    value={currentGroupId ?? ""}
                    disabled={pending}
                    onChange={(e) => {
                        const fd = new FormData();
                        fd.set("id", video.id);
                        fd.set("groupId", e.target.value);
                        submit(moveVideoToGroup, fd, "Moved");
                    }}
                >
                    <option value="">Unsorted</option>
                    {groups.map((g) => (
                        <option key={g.id} value={g.id}>
                            {g.name}
                        </option>
                    ))}
                </NativeSelect>
            </Field>

            {/* Manual duration + actions */}
            <div className="mt-auto flex items-end justify-between gap-2 pt-1">
                <div className="w-28">
                    <Field label="Duration (min)" htmlFor={`dur-${video.id}`}>
                        <NativeInput
                            id={`dur-${video.id}`}
                            type="number"
                            min={0}
                            defaultValue={duration ? Math.round(duration / 60) : ""}
                            disabled={pending}
                            placeholder="—"
                            onBlur={(e) => {
                                const mins = e.target.value.trim();
                                const seconds = mins ? Math.round(Number(mins) * 60) : 0;
                                if (seconds === (duration ?? 0)) return;
                                setDuration(seconds || null);
                                const fd = new FormData();
                                fd.set("id", video.id);
                                if (seconds > 0) fd.set("durationSeconds", String(seconds));
                                submit(setVideoDuration, fd, "Duration saved");
                            }}
                        />
                    </Field>
                </div>
                <div className="flex items-center gap-1">
                    <Button size="sm" color="tertiary" iconLeading={LinkExternal01} href={link} target="_blank" rel="noreferrer" aria-label="Open on YouTube" />
                    <Button
                        size="sm"
                        color="tertiary-destructive"
                        iconLeading={Trash02}
                        aria-label="Delete video"
                        isDisabled={pending}
                        onClick={() => {
                            if (!confirm("Remove this video from your archive?")) return;
                            const fd = new FormData();
                            fd.set("id", video.id);
                            submit(deleteVideo, fd, "Removed");
                        }}
                    />
                </div>
            </div>
        </div>
    );
}
