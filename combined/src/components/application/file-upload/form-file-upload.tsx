"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { FileUpload } from "@/components/application/file-upload/file-upload-base";
import { MAX_USER_FILE_SIZE, validateUploadBatch } from "@/lib/upload-limits";
import { cx } from "@/utils/cx";

interface FormFileUploadProps {
    /** The form field name submitted in FormData. */
    name: string;
    /** Accepted file types, e.g. "image/*" or ".pdf,image/*". */
    accept?: string;
    /** Allow selecting multiple files. */
    multiple?: boolean;
    /** Hint text shown inside the drop zone. */
    hint?: string;
    /** Maximum file size in bytes (drop-zone validation only). */
    maxSize?: number;
    /** Disables the drop zone. */
    isDisabled?: boolean;
    /** Class name for the root wrapper. */
    className?: string;
    /** Called whenever the selected files change. */
    onFilesChange?: (files: File[]) => void;
}

/**
 * Untitled UI drop-zone wired to a real, named `<input type="file">` so existing
 * server-action / FormData submission flows keep working. The drop zone updates
 * the hidden input's `files` via `DataTransfer`, and selected files are listed
 * with the library's file list item.
 */
export function FormFileUpload({
    name,
    accept,
    multiple = false,
    hint,
    maxSize = MAX_USER_FILE_SIZE,
    isDisabled,
    className,
    onFilesChange,
}: FormFileUploadProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [files, setFiles] = useState<File[]>([]);

    const syncInput = (next: File[]) => {
        const dataTransfer = new DataTransfer();
        next.forEach((file) => dataTransfer.items.add(file));
        if (inputRef.current) {
            inputRef.current.files = dataTransfer.files;
        }
        setFiles(next);
        onFilesChange?.(next);
    };

    const handleDropFiles = (dropped: FileList) => {
        const incoming = Array.from(dropped);
        const next = multiple ? [...files, ...incoming] : incoming.slice(0, 1);
        try {
            validateUploadBatch(next);
            if (next.some((file) => file.size > maxSize)) throw new Error("A selected file is too large.");
            syncInput(next);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Those files cannot be uploaded.");
        }
    };

    const handleDelete = (index: number) => {
        syncInput(files.filter((_, i) => i !== index));
    };

    const fileTypeFor = (file: File) => {
        const ext = file.name.split(".").pop()?.toLowerCase();
        return (ext || "empty") as React.ComponentProps<typeof FileUpload.ListItemProgressBar>["type"];
    };

    return (
        <FileUpload.Root className={cx("gap-3", className)}>
            <FileUpload.DropZone
                accept={accept}
                allowsMultiple={multiple}
                isDisabled={isDisabled}
                maxSize={maxSize}
                hint={hint}
                onDropFiles={handleDropFiles}
            />

            {/* Hidden, real form input kept in sync for FormData submission. */}
            <input ref={inputRef} type="file" name={name} accept={accept} multiple={multiple} className="sr-only" tabIndex={-1} aria-hidden="true" />

            {files.length > 0 && (
                <FileUpload.List>
                    {files.map((file, index) => (
                        <FileUpload.ListItemProgressBar
                            key={`${file.name}-${index}`}
                            name={file.name}
                            size={file.size}
                            progress={100}
                            type={fileTypeFor(file)}
                            onDelete={() => handleDelete(index)}
                        />
                    ))}
                </FileUpload.List>
            )}
        </FileUpload.Root>
    );
}
