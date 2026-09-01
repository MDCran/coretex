"use client";

import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Edit01, FilePlus02, Plus, X, Tag01, FileSearch02 } from "@untitledui/icons";
import type { JobDocumentKind } from "@prisma/client";
import { Button } from "@/components/base/buttons/button";
import type { Props as ButtonProps } from "@/components/base/buttons/button";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { TextInput, SelectInput } from "@/components/jobs/fields";
import { SubmitButton } from "@/components/jobs/submit-button";
import { DOCUMENT_KIND_LABELS, toOptions } from "@/lib/jobs/enums";
import { addVersion, createDocument, editDocument, editVersionLabel, renameVersionFile } from "@/lib/actions/jobs-documents";

function DialogShell({ open, setOpen, title, children }: { open: boolean; setOpen: (v: boolean) => void; title: string; children: ReactNode }) {
    return (
        <ModalOverlay isDismissable isOpen={open} onOpenChange={setOpen}>
            <Modal className="max-w-md">
                <Dialog aria-label={title}>
                    <div className="w-full rounded-2xl bg-primary shadow-xl ring-1 ring-secondary">
                        <div className="flex items-center justify-between border-b border-secondary px-5 py-4">
                            <h2 className="text-md font-semibold text-primary">{title}</h2>
                            <Button color="tertiary" size="sm" iconLeading={X} onClick={() => setOpen(false)} aria-label="Close" />
                        </div>
                        <div className="p-5">{children}</div>
                    </div>
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
}

const fileInputClass =
    "text-sm text-tertiary file:mr-3 file:rounded-lg file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-secondary";

/** Create a new document. When `kind` is preset, the kind selector is hidden. */
export function NewDocumentDialog({
    kind,
    label = "New document",
    color = "primary",
    size,
}: {
    kind?: JobDocumentKind;
    label?: string;
    color?: ButtonProps["color"];
    size?: ButtonProps["size"];
}) {
    const [open, setOpen] = useState(false);
    const title = kind ? `New ${DOCUMENT_KIND_LABELS[kind].toLowerCase()}` : "New document";
    return (
        <>
            <Button color={color} size={size} iconLeading={Plus} onClick={() => setOpen(true)}>
                {label}
            </Button>
            <DialogShell open={open} setOpen={setOpen} title={title}>
                <form
                    action={async (fd) => {
                        try {
                            await createDocument(fd);
                            toast.success("Document created");
                            setOpen(false);
                        } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Something went wrong");
                        }
                    }}
                    className="flex flex-col gap-4"
                >
                    <TextInput name="name" label="Name" isRequired placeholder={kind === "COVER_LETTER" ? "Generic cover letter" : "AI/ML resume"} />
                    {kind ? (
                        <input type="hidden" name="kind" value={kind} />
                    ) : (
                        <SelectInput name="kind" label="Kind" isRequired options={toOptions(DOCUMENT_KIND_LABELS)} />
                    )}
                    <div className="flex flex-col gap-1.5">
                        <span className="text-sm font-medium text-secondary">First file (optional)</span>
                        <input type="file" name="file" className={fileInputClass} />
                        <p className="text-xs text-tertiary">You can upload a file now or add versions later.</p>
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button color="secondary" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <SubmitButton color="primary">Create</SubmitButton>
                    </div>
                </form>
            </DialogShell>
        </>
    );
}

export function AddVersionDialog({ documentId, nextVersion }: { documentId: string; nextVersion: number }) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <Button color="secondary" size="sm" iconLeading={FilePlus02} onClick={() => setOpen(true)}>
                Upload new version
            </Button>
            <DialogShell open={open} setOpen={setOpen} title={`Upload version v${nextVersion}`}>
                <form
                    action={async (fd) => {
                        try {
                            await addVersion(documentId, fd);
                            toast.success("Version added");
                            setOpen(false);
                        } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Something went wrong");
                        }
                    }}
                    className="flex flex-col gap-4"
                >
                    <TextInput name="label" label="Label (optional)" placeholder="Tailored for Acme" />
                    <div className="flex flex-col gap-1.5">
                        <span className="text-sm font-medium text-secondary">File</span>
                        <input type="file" name="file" required className={fileInputClass} />
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button color="secondary" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <SubmitButton color="primary">Upload version</SubmitButton>
                    </div>
                </form>
            </DialogShell>
        </>
    );
}

export function EditDocumentDialog({ id, name, kind }: { id: string; name: string; kind: JobDocumentKind }) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <Button color="tertiary" size="sm" iconLeading={Edit01} onClick={() => setOpen(true)} aria-label="Edit document" />
            <DialogShell open={open} setOpen={setOpen} title="Edit document">
                <form
                    action={async (fd) => {
                        try {
                            await editDocument(fd);
                            toast.success("Saved");
                            setOpen(false);
                        } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Something went wrong");
                        }
                    }}
                    className="flex flex-col gap-4"
                >
                    <input type="hidden" name="id" value={id} />
                    <TextInput name="name" label="Name" isRequired defaultValue={name} placeholder="AI/ML resume" />
                    <SelectInput name="kind" label="Type" isRequired defaultValue={kind} options={toOptions(DOCUMENT_KIND_LABELS)} />
                    <div className="flex justify-end gap-2">
                        <Button color="secondary" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <SubmitButton color="primary">Save</SubmitButton>
                    </div>
                </form>
            </DialogShell>
        </>
    );
}

/** Edit only the version's label. */
export function EditVersionLabelDialog({ id, versionNumber, label }: { id: string; versionNumber: number; label: string | null }) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <Button color="tertiary" size="sm" iconLeading={<Tag01 data-icon className="size-4" />} onClick={() => setOpen(true)} aria-label="Edit label">
                Label
            </Button>
            <DialogShell open={open} setOpen={setOpen} title={`Edit label · v${versionNumber}`}>
                <form
                    action={async (fd) => {
                        try {
                            await editVersionLabel(fd);
                            toast.success("Label updated");
                            setOpen(false);
                        } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Something went wrong");
                        }
                    }}
                    className="flex flex-col gap-4"
                >
                    <input type="hidden" name="id" value={id} />
                    <TextInput name="label" label="Label" defaultValue={label ?? ""} placeholder="Tailored for Acme" />
                    <div className="flex justify-end gap-2">
                        <Button color="secondary" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <SubmitButton color="primary">Save</SubmitButton>
                    </div>
                </form>
            </DialogShell>
        </>
    );
}

/** Rename only the display/download file name (the stored file is unchanged). */
export function RenameFileDialog({ id, versionNumber, fileName }: { id: string; versionNumber: number; fileName: string }) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <Button color="tertiary" size="sm" iconLeading={<FileSearch02 data-icon className="size-4" />} onClick={() => setOpen(true)} aria-label="Rename file">
                Rename file
            </Button>
            <DialogShell open={open} setOpen={setOpen} title={`Rename file · v${versionNumber}`}>
                <form
                    action={async (fd) => {
                        try {
                            await renameVersionFile(fd);
                            toast.success("File renamed");
                            setOpen(false);
                        } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Something went wrong");
                        }
                    }}
                    className="flex flex-col gap-4"
                >
                    <input type="hidden" name="id" value={id} />
                    <TextInput name="fileName" label="File name" isRequired defaultValue={fileName} placeholder="resume.pdf" />
                    <p className="text-xs text-tertiary">Only the display and download name change. The stored file stays the same.</p>
                    <div className="flex justify-end gap-2">
                        <Button color="secondary" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <SubmitButton color="primary">Save</SubmitButton>
                    </div>
                </form>
            </DialogShell>
        </>
    );
}
