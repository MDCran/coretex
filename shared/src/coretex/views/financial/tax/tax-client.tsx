// @ts-nocheck
import { Plus, FileCheck02, Download01, Edit01, Trash02 } from "@untitledui/icons";
import { useMemo, useState } from "react";
import { Button } from "react-aria-components";
import { toast } from "sonner";
import { useConfirm } from "../_components/confirm-modal";
import { SectionHeader, Card, EmptyState, EmptyRow, Field, NativeInput, NativeSelect, NativeTextarea, Stat } from "../_components/financial-ui";
import { FormModal } from "../_components/form-modal";
import { FormFileUpload } from "@/components/application/file-upload/form-file-upload";
import { useLifeOSMutation } from "../../personal/use-lifeos-mutation";
import type { LifeOSClient } from "../../personal/use-lifeos-query";
import { formatCurrency } from "../../personal/personal-ui";

export interface TaxRow {
    id: string;
    taxYear: number;
    kind: string | null;
    description: string | null;
    fileName: string | null;
    hasFile: boolean;
    notes: string | null;
}

async function fileToBase64(file: File): Promise<string> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    const chunkSize = 32_768;
    for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(index, Math.min(bytes.length, index + chunkSize)));
    }
    return window.btoa(binary);
}

interface TaxSummary {
    taxDocuments: number;
    currentYearIncome: number;
    currentYearSpending: number;
    currentYearDeductions: number;
}

export function TaxClient({ client, documents: docs, documentKinds = [], summary }: { client: LifeOSClient; documents: TaxRow[]; documentKinds?: string[]; summary?: TaxSummary }) {
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<TaxRow | null>(null);
    const [saving, setSaving] = useState(false);
    const { confirm, dialog } = useConfirm();

    const createMutation = useLifeOSMutation(client, "financial:createTaxDocument");
    const updateMutation = useLifeOSMutation(client, "financial:updateTaxDocument");
    const deleteMutation = useLifeOSMutation(client, "financial:deleteTaxDocument");
    const previewMutation = useLifeOSMutation(client, "financial:getFinancialFile");

    const kinds = documentKinds;

    // Group primarily by document kind (in canonical order, "Other" last), then by tax year descending within each.
    const byKind = useMemo(() => {
        const map = new Map<string, TaxRow[]>();
        for (const d of docs) {
            const key = d.kind && kinds.includes(d.kind) ? d.kind : "Other";
            const list = map.get(key) ?? [];
            list.push(d);
            map.set(key, list);
        }
        const order = [...kinds.filter((k) => k !== "Other"), "Other"];
        return order
            .filter((kind) => map.has(kind))
            .map((kind) => [kind, [...map.get(kind)!].sort((a, b) => b.taxYear - a.taxYear || (a.description ?? a.fileName ?? "").localeCompare(b.description ?? b.fileName ?? ""))] as const);
    }, [docs, kinds]);

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
            const payload: Record<string, unknown> = {
                taxYear: String(fd.get("taxYear") ?? ""),
                kind: String(fd.get("kind") ?? ""),
                description: String(fd.get("description") ?? ""),
                fileName: String(fd.get("fileName") ?? ""),
                notes: String(fd.get("notes") ?? ""),
            };
            const file = fd.get("file");
            if (file instanceof File && file.size > 0) {
                payload.base64 = await fileToBase64(file);
                payload.mimeType = file.type || "application/octet-stream";
                if (!payload.fileName) payload.fileName = file.name;
            }
            if (editing) await updateMutation.mutate({ id: editing.id, ...payload });
            else await createMutation.mutate(payload);
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
                try {
                    await deleteMutation.mutate({ id });
                    toast.success("Deleted");
                } catch {
                    toast.error("Failed");
                }
            },
        });
    }
    async function onPreview(d: TaxRow) {
        try {
            const file = await previewMutation.mutate<{ fileName: string; mimeType: string; base64: string }>({ id: d.id });
            const url = `data:${file.mimeType || "application/octet-stream"};base64,${file.base64}`;
            const a = document.createElement("a");
            a.href = url;
            a.download = file.fileName || d.fileName || "document";
            a.target = "_blank";
            a.click();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't open that file.");
        }
    }

    return (
        <div className="flex flex-col gap-6">
            <SectionHeader
                title="Tax documents"
                description="Organized by document type — W-2s, 1099s, returns and more."
                action={
                    <Button size="md" iconLeading={Plus} onClick={openCreate}>
                        Add document
                    </Button>
                }
            />

            {summary && (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <Stat label="Tax documents" value={summary.taxDocuments.toLocaleString()} />
                    <Stat label="Current-year income" value={formatCurrency(summary.currentYearIncome)} tone="success" />
                    <Stat label="Current-year spending" value={formatCurrency(summary.currentYearSpending)} />
                    <Stat label="Current-year deductions" value={formatCurrency(summary.currentYearDeductions)} tone="success" />
                </div>
            )}

            {docs.length === 0 ? (
                <Card className="p-0">
                    <EmptyState
                        icon={FileCheck02}
                        title="Keep every tax document in one place"
                        description="Upload W-2s, 1099s and filed returns, organized by type — so you're ready come tax season instead of digging through email."
                        action={
                            <Button size="sm" iconLeading={Plus} onClick={openCreate}>
                                Add document
                            </Button>
                        }
                    />
                </Card>
            ) : (
                byKind.map(([kind, list]) => (
                    <Card key={kind} className="p-0">
                        <h3 className="border-b border-secondary px-5 py-4 text-md font-semibold text-primary">
                            {kind} <span className="font-normal text-tertiary">· {list.length}</span>
                        </h3>
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[560px] text-sm">
                                <thead>
                                    <tr className="border-b border-secondary text-left text-tertiary">
                                        <th className="px-5 py-3 font-medium">Tax year</th>
                                        <th className="px-5 py-3 font-medium">Description</th>
                                        <th className="px-5 py-3 font-medium">File</th>
                                        <th className="px-5 py-3" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {list.length === 0 && <EmptyRow colSpan={4} />}
                                    {list.map((d) => (
                                        <tr key={d.id} className="border-b border-secondary last:border-0">
                                            <td className="px-5 py-3 font-medium text-primary">{d.taxYear || "—"}</td>
                                            <td className="px-5 py-3 text-secondary">{d.description || "—"}</td>
                                            <td className="px-5 py-3 text-tertiary">{d.fileName || "—"}</td>
                                            <td className="px-5 py-3">
                                                <div className="flex justify-end gap-1">
                                                    {d.hasFile && <Button size="sm" color="tertiary" iconLeading={Download01} onClick={() => onPreview(d)} aria-label="Download" />}
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
                            <NativeSelect id="kind" name="kind" required defaultValue={editing?.kind ?? kinds[0] ?? "Other"}>
                                {kinds.map((k) => (
                                    <option key={k} value={k}>
                                        {k}
                                    </option>
                                ))}
                            </NativeSelect>
                        </Field>
                    </div>
                    <Field label="Description" htmlFor="description">
                        <NativeInput id="description" name="description" defaultValue={editing?.description ?? ""} />
                    </Field>
                    <Field label="File name" htmlFor="fileName" hint="Display name (auto-filled from the uploaded file if left blank).">
                        <NativeInput id="fileName" name="fileName" defaultValue={editing?.fileName ?? ""} placeholder="e.g. 2024-w2-employer.pdf" />
                    </Field>
                    <Field label="File" htmlFor="file">
                        <FormFileUpload name="file" accept=".pdf,image/*" hint={editing?.fileName ? `Current: ${editing.fileName}. Upload to replace.` : "PDF or image up to 20 MB."} />
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
