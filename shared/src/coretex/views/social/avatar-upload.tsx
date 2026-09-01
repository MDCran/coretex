// @ts-nocheck

import { useEffect, useRef, useState } from "react";
import { User01 } from "@untitledui/icons";
import { FileUploadDropZone } from "@/components/application/file-upload/file-upload-base";

const SAFE_AVATAR_TYPES = new Set(["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"]);
const SAFE_AVATAR_ACCEPT = Array.from(SAFE_AVATAR_TYPES).join(",");
const MAX_AVATAR_SIZE = 25 * 1024 * 1024;

function safeImageUrl(value: string | null | undefined): string | null {
    if (!value) return null;
    try {
        if (value.startsWith("/") && !value.startsWith("//")) {
            const local = new URL(value, "https://coretex.invalid");
            return local.origin === "https://coretex.invalid" ? `${local.pathname}${local.search}${local.hash}` : null;
        }
        const parsed = new URL(value);
        return ["blob:", "http:", "https:"].includes(parsed.protocol) ? parsed.href : null;
    } catch {
        return null;
    }
}

/** Round avatar picker that posts the chosen file under `name` (default "avatar"). */
export function AvatarUpload({ name = "avatar", currentUrl, alt = "" }: { name?: string; currentUrl?: string | null; alt?: string }) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [preview, setPreview] = useState<string | null>(() => safeImageUrl(currentUrl));
    const objectUrlRef = useRef<string | null>(null);

    useEffect(() => () => {
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    }, []);

    const setFile = (file: File | undefined) => {
        if (!file || file.size > MAX_AVATAR_SIZE || !SAFE_AVATAR_TYPES.has(file.type.toLowerCase())) return;
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        if (inputRef.current) inputRef.current.files = dataTransfer.files;
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        const previewUrl = encodeURI(URL.createObjectURL(file));
        objectUrlRef.current = previewUrl;
        setPreview(previewUrl);
    };

    const pickerRef = useRef<HTMLInputElement>(null);

    return (
        <div className="flex items-center gap-4">
            <button
                type="button"
                aria-label="Upload avatar"
                onClick={() => pickerRef.current?.click()}
                className="group flex size-16 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full bg-secondary ring-1 ring-secondary transition duration-100 ease-linear ring-inset hover:ring-2 hover:ring-brand"
            >
                {preview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={preview} alt={alt} className="size-full object-cover" />
                ) : (
                    <User01 className="size-7 text-fg-quaternary transition duration-100 ease-linear group-hover:text-fg-brand-primary" aria-hidden="true" />
                )}
            </button>
            <FileUploadDropZone
                className="flex-1"
                accept={SAFE_AVATAR_ACCEPT}
                allowsMultiple={false}
                maxSize={MAX_AVATAR_SIZE}
                hint="PNG or JPG, up to 25 MB."
                onDropFiles={(files) => setFile(files[0])}
            />
            {/* The clickable-zone picker mirrors its selection into the form carrier input below. */}
            <input
                ref={pickerRef}
                type="file"
                accept={SAFE_AVATAR_ACCEPT}
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(e) => setFile(e.target.files?.[0])}
            />
            <input ref={inputRef} type="file" name={name} accept={SAFE_AVATAR_ACCEPT} className="sr-only" tabIndex={-1} aria-hidden="true" />
        </div>
    );
}
