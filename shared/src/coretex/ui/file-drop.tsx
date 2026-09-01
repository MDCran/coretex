// @ts-nocheck
"use client";

// Coretex — reusable file selector/uploader built on the Untitled UI FileUpload
// component (drop zone + per-file progress + delete/retry). Used wherever we pick
// files: AI-context documents, logos, .env imports, etc. Reads each file to a
// data URL (local, no network) and reports completed files to the parent.

import { useState } from "react";
import { FileUpload, type FileListItemProps } from "@/components/application/file-upload/file-upload-base";

export interface UploadResult {
    name: string;
    /** MIME type, e.g. "image/png" or "text/markdown". */
    mime: string;
    size: number;
    /** Base64 data URL of the file contents. */
    dataUrl: string;
}

interface Row {
    id: string;
    name: string;
    size: number;
    type: string;
    progress: number;
    failed?: boolean;
    file: File;
}

interface Props {
    accept?: string;
    allowsMultiple?: boolean;
    hint?: string;
    /** Max file size in bytes. */
    maxSize?: number;
    isDisabled?: boolean;
    /** Called for each file once it finishes reading. */
    onComplete: (result: UploadResult) => void;
    /** Called when a file row is removed (by name). */
    onRemove?: (name: string) => void;
}

const ext = (name: string): string => name.split(".").pop()?.toLowerCase() ?? "";

export const FileDrop = ({ accept, allowsMultiple = true, hint, maxSize, isDisabled, onComplete, onRemove }: Props) => {
    const [rows, setRows] = useState<Row[]>([]);

    const read = (file: File, id: string): void => {
        const reader = new FileReader();
        reader.onprogress = (e) => {
            if (e.lengthComputable) {
                const pct = Math.min(99, Math.round((e.loaded / e.total) * 100));
                setRows((p) => p.map((r) => (r.id === id ? { ...r, progress: pct } : r)));
            }
        };
        reader.onload = () => {
            const dataUrl = typeof reader.result === "string" ? reader.result : "";
            setRows((p) => p.map((r) => (r.id === id ? { ...r, progress: 100, failed: false } : r)));
            onComplete({ name: file.name, mime: file.type, size: file.size, dataUrl });
        };
        reader.onerror = () => setRows((p) => p.map((r) => (r.id === id ? { ...r, failed: true } : r)));
        reader.readAsDataURL(file);
    };

    const handleDrop = (files: FileList): void => {
        const arr = Array.from(files);
        const newRows: Row[] = arr.map((f) => ({ id: Math.random().toString(36).slice(2), name: f.name, size: f.size, type: ext(f.name), progress: 0, file: f }));
        setRows((prev) => (allowsMultiple ? [...newRows, ...prev] : newRows));
        newRows.forEach((r) => read(r.file, r.id));
    };

    const del = (id: string): void => {
        const row = rows.find((r) => r.id === id);
        setRows((p) => p.filter((r) => r.id !== id));
        if (row) onRemove?.(row.name);
    };

    const retry = (id: string): void => {
        const row = rows.find((r) => r.id === id);
        if (!row) return;
        setRows((p) => p.map((r) => (r.id === id ? { ...r, failed: false, progress: 0 } : r)));
        read(row.file, id);
    };

    return (
        <FileUpload.Root>
            <FileUpload.DropZone accept={accept} allowsMultiple={allowsMultiple} hint={hint} maxSize={maxSize} isDisabled={isDisabled} onDropFiles={handleDrop} />
            {rows.length > 0 && (
                <FileUpload.List>
                    {rows.map((r) => (
                        <FileUpload.ListItemProgressBar
                            key={r.id}
                            name={r.name}
                            size={r.size}
                            type={(r.type || "empty") as FileListItemProps["type"]}
                            progress={r.progress}
                            failed={r.failed}
                            onDelete={() => del(r.id)}
                            onRetry={() => retry(r.id)}
                        />
                    ))}
                </FileUpload.List>
            )}
        </FileUpload.Root>
    );
};
