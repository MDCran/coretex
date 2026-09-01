"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Download01, Paperclip, Trash01 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { FileUploadDropZone } from "@/components/application/file-upload/file-upload-base";
import { fileUrl } from "@/lib/files";
import { fmtFileSize } from "@/lib/jobs/format";
import { MAX_USER_FILE_SIZE, validateUploadBatch } from "@/lib/upload-limits";

type Attachment = { id: string; fileKey: string; fileName: string; fileSize: number; mimeType: string };

export function AttachmentList({
    attachments,
    onDelete,
    revalidate,
}: {
    attachments: Attachment[];
    onDelete: (formData: FormData) => void | Promise<void>;
    revalidate?: string;
}) {
    if (attachments.length === 0) return <p className="text-sm text-tertiary">No attachments.</p>;

    return (
        <ul className="flex flex-col gap-2">
            {attachments.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 rounded-lg bg-secondary px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                        <Paperclip className="size-4 shrink-0 text-fg-quaternary" />
                        <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-secondary">{a.fileName}</p>
                            <p className="text-xs text-tertiary">{fmtFileSize(a.fileSize)}</p>
                        </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                        <Button
                            href={fileUrl(a.fileKey, { download: true, name: a.fileName })}
                            color="tertiary"
                            size="sm"
                            iconLeading={Download01}
                            aria-label="Download"
                        />
                        <form action={onDelete}>
                            <input type="hidden" name="id" value={a.id} />
                            {revalidate && <input type="hidden" name="revalidate" value={revalidate} />}
                            <Button type="submit" color="tertiary-destructive" size="sm" iconLeading={Trash01} aria-label="Remove" />
                        </form>
                    </div>
                </li>
            ))}
        </ul>
    );
}

export function AttachmentUploader({ action }: { action: (formData: FormData) => void | Promise<void> }) {
    const [uploading, setUploading] = useState(false);

    async function onDropFiles(files: FileList) {
        if (!files.length) return;
        try {
            validateUploadBatch(Array.from(files));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Those files cannot be uploaded.");
            return;
        }
        const fd = new FormData();
        for (const file of Array.from(files)) fd.append("files", file);
        setUploading(true);
        try {
            await action(fd);
            toast.success("Uploaded");
        } finally {
            setUploading(false);
        }
    }

    return (
        <FileUploadDropZone
            isDisabled={uploading}
            allowsMultiple
            maxSize={MAX_USER_FILE_SIZE}
            hint={uploading ? "Uploading…" : "Up to 5 files · 25 MB each · 50 MB total."}
            onDropFiles={onDropFiles}
        />
    );
}
