"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, X, Tag01, Edit01, Trash01 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { useConfirm } from "@/components/application/confirm-dialog/confirm-dialog";
import { TextInput, SelectInput } from "@/components/jobs/fields";
import { SubmitButton } from "@/components/jobs/submit-button";
import { cx } from "@/utils/cx";

export type TagRow = { id: string; name: string; color: string | null; count: number };
type Action = (formData: FormData) => Promise<void>;

const COLORS = ["brand", "gray", "blue", "indigo", "purple", "pink", "rose", "orange", "sky", "slate", "success", "warning", "error"];
const colorOptions = COLORS.map((c) => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1) }));

export const TAG_SWATCH: Record<string, string> = {
    brand: "bg-brand-solid",
    gray: "bg-fg-quaternary",
    blue: "bg-utility-blue-500",
    indigo: "bg-utility-indigo-500",
    purple: "bg-utility-purple-500",
    pink: "bg-utility-pink-500",
    rose: "bg-utility-rose-500",
    orange: "bg-utility-orange-500",
    sky: "bg-utility-sky-500",
    slate: "bg-fg-tertiary",
    success: "bg-success-solid",
    warning: "bg-warning-solid",
    error: "bg-error-solid",
};

/**
 * "Manage tags" affordance for the contacts page — create/edit/delete tags
 * inline in a modal. Replaces the standalone /social/tags dashboard.
 */
export function TagsInline({
    tags,
    createAction,
    updateAction,
    deleteAction,
}: {
    tags: TagRow[];
    createAction: Action;
    updateAction: Action;
    deleteAction: Action;
}) {
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<TagRow | null>(null);
    const [formOpen, setFormOpen] = useState(false);
    const { confirm, dialog } = useConfirm();

    function openCreate() {
        setEditing(null);
        setFormOpen(true);
    }
    function openEdit(t: TagRow) {
        setEditing(t);
        setFormOpen(true);
    }

    async function onSubmit(fd: FormData) {
        try {
            if (editing) await updateAction(fd);
            else await createAction(fd);
            toast.success(editing ? "Tag updated" : "Tag created");
            setFormOpen(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        }
    }

    async function remove(t: TagRow) {
        const fd = new FormData();
        fd.set("id", t.id);
        try {
            await deleteAction(fd);
            toast.success("Tag deleted");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to delete");
        }
    }

    return (
        <>
            <Button color="secondary" size="md" iconLeading={Tag01} onClick={() => setOpen(true)}>
                Manage tags
            </Button>

            <ModalOverlay isDismissable isOpen={open} onOpenChange={setOpen}>
                <Modal className="max-w-md">
                    <Dialog aria-label="Manage tags">
                        <div className="w-full rounded-2xl bg-primary shadow-xl ring-1 ring-secondary">
                            <div className="flex items-center justify-between border-b border-secondary px-5 py-4">
                                <h2 className="text-md font-semibold text-primary">Manage tags</h2>
                                <Button color="tertiary" size="sm" iconLeading={X} onClick={() => setOpen(false)} aria-label="Close" />
                            </div>
                            <div className="flex flex-col gap-4 p-5">
                                <Button color="primary" size="sm" iconLeading={Plus} onClick={openCreate} className="self-start">
                                    New tag
                                </Button>
                                {tags.length === 0 ? (
                                    <p className="py-4 text-center text-sm text-tertiary">No tags yet.</p>
                                ) : (
                                    <ul className="flex flex-col divide-y divide-secondary">
                                        {tags.map((t) => (
                                            <li key={t.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                                                <div className="flex items-center gap-2.5">
                                                    <span className={cx("size-3 rounded-full", TAG_SWATCH[t.color ?? "gray"] ?? "bg-fg-quaternary")} />
                                                    <span className="font-medium text-primary">{t.name}</span>
                                                    <span className="text-xs text-tertiary">
                                                        {t.count} contact{t.count === 1 ? "" : "s"}
                                                    </span>
                                                </div>
                                                <div className="flex gap-0.5">
                                                    <Button color="tertiary" size="sm" iconLeading={Edit01} onClick={() => openEdit(t)} aria-label="Edit tag" />
                                                    <Button
                                                        color="tertiary-destructive"
                                                        size="sm"
                                                        iconLeading={Trash01}
                                                        aria-label="Delete tag"
                                                        onClick={() => confirm({ title: `Delete "${t.name}"?`, description: "Removes the tag from all contacts.", confirmLabel: "Delete", onConfirm: () => remove(t) })}
                                                    />
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </div>
                    </Dialog>
                </Modal>
            </ModalOverlay>

            <ModalOverlay isDismissable isOpen={formOpen} onOpenChange={setFormOpen}>
                <Modal className="max-w-sm">
                    <Dialog aria-label={editing ? "Edit tag" : "New tag"}>
                        <div className="w-full rounded-2xl bg-primary shadow-xl ring-1 ring-secondary">
                            <div className="flex items-center justify-between border-b border-secondary px-5 py-4">
                                <h2 className="text-md font-semibold text-primary">{editing ? "Edit tag" : "New tag"}</h2>
                                <Button color="tertiary" size="sm" iconLeading={X} onClick={() => setFormOpen(false)} aria-label="Close" />
                            </div>
                            <form action={onSubmit} className="flex flex-col gap-4 p-5">
                                {editing && <input type="hidden" name="id" value={editing.id} />}
                                <TextInput name="name" label="Name" isRequired defaultValue={editing?.name ?? ""} />
                                <SelectInput name="color" label="Color" options={colorOptions} defaultValue={editing?.color ?? "brand"} />
                                <div className="flex justify-end gap-2">
                                    <Button color="secondary" onClick={() => setFormOpen(false)}>
                                        Cancel
                                    </Button>
                                    <SubmitButton color="primary">{editing ? "Save" : "Create"}</SubmitButton>
                                </div>
                            </form>
                        </div>
                    </Dialog>
                </Modal>
            </ModalOverlay>
            {dialog}
        </>
    );
}
