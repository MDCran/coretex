// @ts-nocheck

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, X, Edit01 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { FileUploadDropZone } from "@/components/application/file-upload/file-upload-base";
import { TextInput, TextareaInput, DateInput } from "@/components/jobs/fields";
import { SubmitButton } from "@/components/jobs/submit-button";
import { toDateInput } from "./format";

const SAFE_COVER_TYPES = new Set(["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"]);
const SAFE_COVER_ACCEPT = Array.from(SAFE_COVER_TYPES).join(",");
const MAX_COVER_SIZE = 25 * 1024 * 1024;

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

type EventDefaults = {
    name?: string;
    eventDate?: Date | string | null;
    location?: string | null;
    attendees?: string[];
    notes?: string | null;
    coverUrl?: string | null;
};

export function EventDialog({
    action,
    defaults,
    mode = "create",
}: {
    action: (formData: FormData) => void | Promise<void>;
    defaults?: EventDefaults;
    mode?: "create" | "edit";
}) {
    const [open, setOpen] = useState(false);
    const [preview, setPreview] = useState<string | null>(() => safeImageUrl(defaults?.coverUrl));
    const fileRef = useRef<HTMLInputElement>(null);
    const objectUrlRef = useRef<string | null>(null);

    useEffect(() => () => {
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    }, []);

    useEffect(() => {
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
        if (fileRef.current) fileRef.current.value = "";
        setPreview(safeImageUrl(defaults?.coverUrl));
    }, [defaults?.coverUrl]);

    function resetCoverSelection() {
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
        if (fileRef.current) fileRef.current.value = "";
        setPreview(safeImageUrl(defaults?.coverUrl));
    }

    function closeDialog() {
        resetCoverSelection();
        setOpen(false);
    }

    function closeAfterSubmit() {
        if (mode === "create") resetCoverSelection();
        else if (fileRef.current) fileRef.current.value = "";
        setOpen(false);
    }

    function handleOpenChange(nextOpen: boolean) {
        if (!nextOpen) resetCoverSelection();
        setOpen(nextOpen);
    }

    function selectCover(file: File | undefined) {
        if (!file) return;
        if (file.size === 0 || file.size > MAX_COVER_SIZE) {
            toast.error(file.size === 0 ? "Choose a non-empty image." : "Cover image must be 25 MB or smaller.");
            return;
        }
        if (!SAFE_COVER_TYPES.has(file.type.toLowerCase())) {
            toast.error("Choose an AVIF, GIF, JPEG, PNG, or WebP image.");
            return;
        }

        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        if (fileRef.current) fileRef.current.files = dataTransfer.files;
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        const previewUrl = encodeURI(URL.createObjectURL(file));
        objectUrlRef.current = previewUrl;
        setPreview(previewUrl);
    }

    async function onSubmit(fd: FormData) {
        try {
            await action(fd);
            toast.success(mode === "create" ? "Event created" : "Event updated");
            closeAfterSubmit();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        }
    }

    return (
        <>
            {mode === "create" ? (
                <Button color="primary" iconLeading={Plus} onClick={() => setOpen(true)}>
                    Add event
                </Button>
            ) : (
                <Button color="secondary" size="sm" iconLeading={Edit01} onClick={() => setOpen(true)} aria-label="Edit event" />
            )}

            <ModalOverlay isDismissable isOpen={open} onOpenChange={handleOpenChange}>
                <Modal className="max-w-lg">
                    <Dialog aria-label={mode === "create" ? "Add event" : "Edit event"}>
                        <div className="w-full rounded-2xl bg-primary shadow-xl ring-1 ring-secondary">
                            <div className="flex items-center justify-between border-b border-secondary px-5 py-4">
                                <h2 className="text-md font-semibold text-primary">{mode === "create" ? "Add event" : "Edit event"}</h2>
                                <Button color="tertiary" size="sm" iconLeading={X} onClick={closeDialog} aria-label="Close" />
                            </div>
                            <form action={onSubmit} className="flex flex-col gap-4 p-5">
                                <TextInput name="name" label="Name" isRequired defaultValue={defaults?.name ?? ""} />
                                <div className="grid grid-cols-2 gap-4">
                                    <DateInput name="eventDate" label="Date" defaultValue={toDateInput(defaults?.eventDate)} />
                                    <TextInput name="location" label="Location" defaultValue={defaults?.location ?? ""} />
                                </div>
                                <TextInput
                                    name="attendees"
                                    label="Attendees"
                                    defaultValue={(defaults?.attendees ?? []).join(", ")}
                                    placeholder="Names, comma separated"
                                />
                                <TextareaInput name="notes" label="Notes" rows={3} defaultValue={defaults?.notes ?? ""} />
                                <div className="flex flex-col gap-1.5">
                                    <span className="text-sm font-medium text-secondary">Cover image</span>
                                    {preview && (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={preview} alt="" className="h-24 w-full rounded-lg object-cover ring-1 ring-secondary ring-inset" />
                                    )}
                                    <FileUploadDropZone
                                        accept={SAFE_COVER_ACCEPT}
                                        allowsMultiple={false}
                                        maxSize={MAX_COVER_SIZE}
                                        hint="AVIF, GIF, JPEG, PNG or WebP, up to 25 MB."
                                        onDropFiles={(files) => selectCover(files[0])}
                                        onSizeLimitExceed={() => toast.error("Cover image must be 25 MB or smaller.")}
                                    />
                                    <input ref={fileRef} type="file" name="coverImage" accept={SAFE_COVER_ACCEPT} className="sr-only" tabIndex={-1} aria-hidden="true" />
                                </div>
                                <div className="flex justify-end gap-2 pt-1">
                                    <Button color="secondary" onClick={closeDialog}>
                                        Cancel
                                    </Button>
                                    <SubmitButton color="primary">{mode === "create" ? "Create" : "Save"}</SubmitButton>
                                </div>
                            </form>
                        </div>
                    </Dialog>
                </Modal>
            </ModalOverlay>
        </>
    );
}
