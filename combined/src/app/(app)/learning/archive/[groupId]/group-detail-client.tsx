"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Edit01, PlayCircle, Trash02 } from "@untitledui/icons";
import { toast } from "sonner";
import { Button } from "@/components/base/buttons/button";
import { cx } from "@/utils/cx";
import { fileUrl } from "@/lib/files";
import { formatDuration } from "@/lib/learning/youtube-shared";
import { Card, EmptyState, Field, NativeInput, SectionHeader } from "../../_components/learning-ui";
import { FormModal } from "../../_components/form-modal";
import { VideoCard, type GroupOption, type VideoRow } from "../_components/video-card";
import { deleteGroup, renameGroup } from "@/lib/actions/learning-archive";

interface GroupHeader {
    id: string;
    name: string;
    themeColor: string | null;
    coverKey: string | null;
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

export function GroupDetailClient({ group, videos, groups }: { group: GroupHeader; videos: VideoRow[]; groups: GroupOption[] }) {
    const router = useRouter();
    const [renameOpen, setRenameOpen] = useState(false);

    const totalDuration = videos.reduce((s, v) => s + (v.durationSeconds ?? 0), 0);
    const watched = videos.filter((v) => v.watchStatus === "WATCHED").length;

    return (
        <div className="flex flex-col gap-6">
            <Button size="sm" color="link-gray" iconLeading={ArrowLeft} href="/learning/archive">
                Back to archive
            </Button>

            {/* Header with theme accent + cover */}
            <Card className="flex flex-col gap-4 overflow-hidden p-0">
                <div className="relative">
                    {group.coverKey ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={fileUrl(group.coverKey)} alt={group.name} className="h-40 w-full object-cover" />
                    ) : (
                        <div className="flex h-40 w-full items-center justify-center" style={{ backgroundColor: group.themeColor ?? undefined }}>
                            <PlayCircle aria-hidden="true" className="size-12 text-white/80" />
                        </div>
                    )}
                    <div
                        aria-hidden="true"
                        className={cx("h-1.5 w-full")}
                        style={{ backgroundColor: group.themeColor ?? undefined }}
                    />
                </div>
                <div className="flex flex-wrap items-start justify-between gap-3 p-5 pt-1">
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                            {group.themeColor && <span aria-hidden="true" className="size-3.5 rounded-full" style={{ backgroundColor: group.themeColor }} />}
                            <h1 className="text-display-xs font-semibold text-primary">{group.name}</h1>
                        </div>
                        <p className="text-sm text-tertiary">
                            {videos.length} video{videos.length === 1 ? "" : "s"} · {formatDuration(totalDuration)} · {watched} watched
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button size="sm" color="secondary" iconLeading={Edit01} onClick={() => setRenameOpen(true)}>
                            Rename
                        </Button>
                        <Button
                            size="sm"
                            color="secondary-destructive"
                            iconLeading={Trash02}
                            onClick={async () => {
                                if (!confirm("Delete this group? Its videos move back to Unsorted.")) return;
                                const fd = new FormData();
                                fd.set("id", group.id);
                                const ok = await run(deleteGroup, fd, "Group deleted");
                                if (ok) router.push("/learning/archive");
                            }}
                        >
                            Delete
                        </Button>
                    </div>
                </div>
            </Card>

            <SectionHeader title="Videos" description="Track watch status, progress, and notes for each video in this group." />

            {videos.length === 0 ? (
                <Card>
                    <EmptyState
                        icon={PlayCircle}
                        title="No videos in this group"
                        description="Move videos here from the archive, or this group will appear empty."
                        action={
                            <Button size="md" color="secondary" href="/learning/archive">
                                Back to archive
                            </Button>
                        }
                    />
                </Card>
            ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {videos.map((v) => (
                        <VideoCard key={v.id} video={v} groups={groups} currentGroupId={group.id} />
                    ))}
                </div>
            )}

            <FormModal isOpen={renameOpen} onOpenChange={setRenameOpen} title="Rename group" description="Update the group name and theme color.">
                <form
                    action={async (fd) => {
                        fd.set("id", group.id);
                        const ok = await run(renameGroup, fd, "Updated");
                        if (ok) setRenameOpen(false);
                    }}
                    className="flex flex-col gap-4"
                >
                    <Field label="Name" htmlFor="group-name" required>
                        <NativeInput id="group-name" name="name" required defaultValue={group.name} />
                    </Field>
                    <Field label="Theme color" htmlFor="group-color" hint="Hex color used for accents and fallback covers.">
                        <NativeInput id="group-color" name="themeColor" type="text" defaultValue={group.themeColor ?? "#7F56D9"} placeholder="#7F56D9" />
                    </Field>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setRenameOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="submit">Save</Button>
                    </div>
                </form>
            </FormModal>
        </div>
    );
}
