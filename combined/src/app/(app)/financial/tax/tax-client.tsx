"use client";

import { useMemo, useState } from "react";
import { Download01, Edit01, FileCheck02, Plus, Trash02 } from "@untitledui/icons";
import { toast } from "sonner";
import { Button } from "@/components/base/buttons/button";
import { createTaxDocument, deleteTaxDocument, updateTaxDocument } from "@/lib/actions/financial-tax";
import { Card, EmptyRow, EmptyState, Field, NativeInput, NativeTextarea, SectionHeader } from "../_components/financial-ui";
import { FormModal } from "../_components/form-modal";
import { useConfirm } from "../_components/confirm-modal";
import { FormFileUpload } from "@/components/application/file-upload/form-file-upload";
import { TAX_DOCUMENT_KINDS } from "@/lib/financial/tax-kinds";

export interface TaxRow {
    id: string;
    taxYear: number;
    kind: string | null;
    description: string | null;
    fileName: string | null;
    downloadUrl: string | null;
    notes: string | null;
}

export function TaxClient({ docs }: { docs: TaxRow[] }) {
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<TaxRow | null>(null);
    const [saving, setSaving] = useState(false);
    const { confirm, dialog } = useConfirm();

    const byYear = useMemo(() => {
        const map = new Map<number, TaxRow[]>();
        for (const d of docs) {
            const list = map.get(d.taxYear) ?? [];
            list.push(d);
            map.set(d.taxYear, list);
        }
        return Array.from(map.entries())
            .sort(([a], [b]) => b - a)
            .map(([year, list]) => [
                year,
                [...list].sort((a, b) => {
                    const ka = (a.kind ?? "").toLowerCase();
                    const kb = (b.kind ?? "").toLowerCase();
                    if (ka !== kb) return ka.localeCompare(kb);
                    return (a.description ?? a.fileName ?? "").localeCompare(b.description ?? b.fileName ?? "");
                }),
            ] as const);
    }, [docs]);

    function openCreate() {
        setEditing(null);
        setOpen(true);
    }
    function openEdit(d: TaxRow) {
        setEditing(d);
        setOpen(true);
    }

    async function onSubmit(fd: FormData) {
        setSaving(true);
        try {
            if (editing) await updateTaxDocument(fd);
            else await createTaxDocument(fd);
            toast.success(editing ? "Document updated" : "Document added");
            setOpen(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        } finally {
            setSaving(false);
        }
    }
    function onDelete(id: string) {
        confirm({
            title: "Delete this document?",
            destructive: true,
            confirmLabel: "Delete",
            onConfirm: async () => {
                const fd = new FormData();
                fd.set("id", id);
                try {
                    await deleteTaxDocument(fd);
                    toast.success("Deleted");
                } catch {
                    toast.error("Failed");
                }
            },
        });
    }

    return (
        <div className="flex flex-col gap-6">
            <SectionHeader
                title="Tax documents"
                description="Organize tax files by year."
                action={
                    <Button size="md" iconLeading={Plus} onClick={openCreate}>
                        Add document
                    </Button>
                }
            />

            {docs.length === 0 ? (
                <Card className="p-0">
                    <EmptyState
                        icon={FileCheck02}
                        title="Keep every tax document in one place"
                        description="Upload W-2s, 1099s and filed returns, organized by year — so you're ready come tax season instead of digging through email."
                        action={
                            <Button size="sm" iconLeading={Plus} onClick={openCreate}>
                                Add document
                            </Button>
                        }
                    />
                </Card>
            ) : (
                byYear.map(([year, list]) => (
                    <Card key={year} className="p-0">
                        <h3 className="border-b border-secondary px-5 py-4 text-md font-semibold text-primary">{year}</h3>
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[560px] text-sm">
                                <thead>
                                    <tr className="border-b border-secondary text-left text-tertiary">
                                        <th className="px-5 py-3 font-medium">Kind</th>
                                        <th className="px-5 py-3 font-medium">Description</th>
                                        <th className="px-5 py-3 font-medium">File</th>
                                        <th className="px-5 py-3" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {list.length === 0 && <EmptyRow colSpan={4} />}
                                    {list.map((d) => (
                                        <tr key={d.id} className="border-b border-secondary last:border-0">
                                            <td className="px-5 py-3 font-medium text-primary">{d.kind || "—"}</td>
                                            <td className="px-5 py-3 text-secondary">{d.description || "—"}</td>
                                            <td className="px-5 py-3 text-tertiary">{d.fileName || "—"}</td>
                                            <td className="px-5 py-3">
                                                <div className="flex justify-end gap-1">
                                                    {d.downloadUrl && <Button size="sm" color="tertiary" iconLeading={Download01} href={d.downloadUrl} target="_blank" aria-label="Download" />}
                                                    <Button size="sm" color="tertiary" iconLeading={Edit01} onClick={() => openEdit(d)} aria-label="Edit" />
                                                    <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} onClick={() => onDelete(d.id)} aria-label="Delete" />
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </Card>
                ))
            )}

            <FormModal isOpen={open} onOpenChange={setOpen} title={editing ? "Edit document" : "Add tax document"}>
                <form action={onSubmit} className="flex flex-col gap-4">
                    {editing && <input type="hidden" name="id" value={editing.id} />}
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Tax year" htmlFor="taxYear">
                            <NativeInput id="taxYear" name="taxYear" type="number" required defaultValue={editing?.taxYear ?? new Date().getFullYear() - 1} />
                        </Field>
                        <Field label="Kind" htmlFor="kind">
                            <NativeInput id="kind" name="kind" list="tax-kind-options" defaultValue={editing?.kind ?? ""} placeholder="e.g. W-2, 1099, return" />
                            <datalist id="tax-kind-options">
                                {TAX_DOCUMENT_KINDS.map((k) => (
                                    <option key={k} value={k} />
                                ))}
                            </datalist>
                        </Field>
                    </div>
                    <Field label="Description" htmlFor="description">
                        <NativeInput id="description" name="description" defaultValue={editing?.description ?? ""} />
                    </Field>
                    <Field label="File name" htmlFor="fileName" hint="Display name for downloads (rename without re-uploading).">
                        <NativeInput id="fileName" name="fileName" defaultValue={editing?.fileName ?? ""} placeholder="e.g. 2024-w2-employer.pdf" />
                    </Field>
                    <Field label="File" htmlFor="file">
                        <FormFileUpload name="file" hint={editing?.fileName ? `Current: ${editing.fileName}. Upload to replace.` : "PDF, image or any document up to 25 MB."} />
                    </Field>
                    <Field label="Notes" htmlFor="notes">
                        <NativeTextarea id="notes" name="notes" defaultValue={editing?.notes ?? ""} />
                    </Field>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="submit" isLoading={saving}>
                            {editing ? "Save" : "Add"}
                        </Button>
                    </div>
                </form>
            </FormModal>

            {dialog}
        </div>
    );
}
