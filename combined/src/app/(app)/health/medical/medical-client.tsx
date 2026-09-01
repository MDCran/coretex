"use client";

import { useEffect, useState } from "react";
import { Plus, Trash02, Edit01, FileAttachment02, MedicalCross as Stethoscope, Building02, MagicWand01 as Sparkles01, Download01 } from "@untitledui/icons";
import { toast } from "sonner";
import { Button } from "@/components/base/buttons/button";
import { Badge } from "@/components/base/badges/badges";
import { Tooltip, TooltipTrigger } from "@/components/base/tooltip/tooltip";
import { Card, Field, NativeInput, NativeSelect, NativeTextarea, SectionHeader } from "../_components/health-ui";
import { HealthEmptyState } from "../_components/empty-state";
import { FormModal } from "../_components/form-modal";
import { FormDateInput } from "@/components/base/input/form-date-input";
import { formatDate } from "@/lib/dates";
import { FormFileUpload } from "@/components/application/file-upload/form-file-upload";
import { Select } from "@/components/base/select/select";
import { HealthTabs } from "../_components/health-tabs";
import {
    addExtractedItem,
    createMedicalRecord,
    deleteDoctor,
    deleteExtractedItem,
    deleteMedicalRecord,
    deleteProvider,
    updateMedicalRecord,
    upsertDoctor,
    upsertProvider,
} from "@/lib/actions/health-medical";

export interface ProviderRow {
    id: string;
    name: string;
    address: string | null;
    phone: string | null;
    website: string | null;
    notes: string | null;
}
export interface DoctorRow {
    id: string;
    name: string;
    profession: string | null;
    location: string | null;
    phone: string | null;
    email: string | null;
    notes: string | null;
    providerId: string | null;
}
export interface ExtractedItem {
    id: string;
    itemType: string | null;
    label: string;
    value: string | null;
    unit: string | null;
}
export interface RecordRow {
    id: string;
    name: string;
    recordDate: string | null;
    notes: string | null;
    fileName: string | null;
    fileUrl: string | null;
    providerId: string | null;
    doctorId: string | null;
    providerName: string | null;
    doctorName: string | null;
    extractedItems: ExtractedItem[];
}

export function MedicalClient({
    records,
    providers,
    doctors,
    aiEnabled,
}: {
    records: RecordRow[];
    providers: ProviderRow[];
    doctors: DoctorRow[];
    aiEnabled: boolean;
}) {
    const [tab, setTab] = useState<"records" | "providers" | "doctors">("records");
    const [recordOpen, setRecordOpen] = useState(false);
    const [editingRecord, setEditingRecord] = useState<RecordRow | null>(null);
    const [providerOpen, setProviderOpen] = useState(false);
    const [editingProvider, setEditingProvider] = useState<ProviderRow | null>(null);
    const [doctorOpen, setDoctorOpen] = useState(false);
    const [editingDoctor, setEditingDoctor] = useState<DoctorRow | null>(null);
    const [itemsFor, setItemsFor] = useState<RecordRow | null>(null);
    const [recordProviderId, setRecordProviderId] = useState("");
    const [recordDoctorId, setRecordDoctorId] = useState("");

    function toLocalInput(iso: string) {
        const d = new Date(iso);
        return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    }

    useEffect(() => {
        if (!recordOpen) return;
        setRecordProviderId(editingRecord?.providerId ?? "");
        setRecordDoctorId(editingRecord?.doctorId ?? "");
    }, [recordOpen, editingRecord]);

    async function wrap(fn: () => Promise<void>, ok: string, onDone?: () => void) {
        try {
            await fn();
            toast.success(ok);
            onDone?.();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        }
    }

    return (
        <div className="flex flex-col gap-6">
            <SectionHeader
                title="Medical records"
                description="Documents, providers and doctors."
                action={
                    tab === "records" ? (
                        <Button size="md" iconLeading={Plus} onClick={() => { setEditingRecord(null); setRecordOpen(true); }}>Add record</Button>
                    ) : tab === "providers" ? (
                        <Button size="md" iconLeading={Plus} onClick={() => { setEditingProvider(null); setProviderOpen(true); }}>Add provider</Button>
                    ) : (
                        <Button size="md" iconLeading={Plus} onClick={() => { setEditingDoctor(null); setDoctorOpen(true); }}>Add doctor</Button>
                    )
                }
            />

            <HealthTabs
                tabs={[
                    { id: "records" as const, label: "Records" },
                    { id: "providers" as const, label: "Providers" },
                    { id: "doctors" as const, label: "Doctors" },
                ]}
                value={tab}
                onChange={setTab}
            />

            <div className="min-h-[20rem]">
            {tab === "records" && (
                <div className="flex flex-col gap-3">
                    {records.length === 0 && (
                        <Card className="p-0">
                            <HealthEmptyState
                                icon={FileAttachment02}
                                title="Keep your records in one place"
                                description="Upload lab results, scans and visit summaries — then attach the provider and doctor so nothing gets lost."
                                actionLabel="Add record"
                                onAction={() => { setEditingRecord(null); setRecordOpen(true); }}
                            />
                        </Card>
                    )}
                    {records.map((r) => (
                        <Card key={r.id}>
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex items-start gap-3">
                                    <FileAttachment02 className="size-5 text-fg-quaternary" />
                                    <div>
                                        <p className="text-sm font-semibold text-primary">{r.name}</p>
                                        <p className="text-xs text-tertiary">
                                            {r.recordDate && formatDate(r.recordDate)}
                                            {r.providerName && ` · ${r.providerName}`}
                                            {r.doctorName && ` · ${r.doctorName}`}
                                        </p>
                                        {r.notes && <p className="mt-1 text-sm text-secondary">{r.notes}</p>}
                                    </div>
                                </div>
                                <div className="flex gap-1">
                                    {r.fileUrl && <Button size="sm" color="tertiary" iconLeading={Download01} href={r.fileUrl} target="_blank" aria-label="Download" />}
                                    <Button size="sm" color="tertiary" iconLeading={Edit01} onClick={() => { setEditingRecord(r); setRecordOpen(true); }} aria-label="Edit record" />
                                    <Button size="sm" color="tertiary" onClick={() => setItemsFor(r)}>Items</Button>
                                    <form action={(fd) => wrap(() => deleteMedicalRecord(fd), "Deleted")}>
                                        <input type="hidden" name="id" value={r.id} />
                                        <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} type="submit" aria-label="Delete" />
                                    </form>
                                </div>
                            </div>
                            {r.extractedItems.length > 0 && (
                                <div className="mt-3 flex flex-wrap gap-2">
                                    {r.extractedItems.map((it) => (
                                        <Badge key={it.id} color="gray" size="sm">
                                            {it.label}: {it.value}
                                            {it.unit ? ` ${it.unit}` : ""}
                                        </Badge>
                                    ))}
                                </div>
                            )}
                        </Card>
                    ))}
                </div>
            )}

            {tab === "providers" && (
                <div className="grid gap-3 sm:grid-cols-2">
                    {providers.length === 0 && (
                        <Card className="p-0 sm:col-span-2">
                            <HealthEmptyState
                                icon={Building02}
                                title="Add your first provider"
                                description="Save the clinics, hospitals and labs you visit so you can link them to records and doctors."
                                actionLabel="Add provider"
                                onAction={() => { setEditingProvider(null); setProviderOpen(true); }}
                            />
                        </Card>
                    )}
                    {providers.map((p) => (
                        <Card key={p.id}>
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex items-start gap-3">
                                    <Building02 className="size-5 text-fg-quaternary" />
                                    <div>
                                        <p className="text-sm font-semibold text-primary">{p.name}</p>
                                        {p.address && <p className="text-xs text-tertiary">{p.address}</p>}
                                        {p.phone && <p className="text-xs text-tertiary">{p.phone}</p>}
                                    </div>
                                </div>
                                <div className="flex gap-1">
                                    <Button size="sm" color="tertiary" iconLeading={Edit01} onClick={() => { setEditingProvider(p); setProviderOpen(true); }} aria-label="Edit" />
                                    <form action={(fd) => wrap(() => deleteProvider(fd), "Deleted")}>
                                        <input type="hidden" name="id" value={p.id} />
                                        <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} type="submit" aria-label="Delete" />
                                    </form>
                                </div>
                            </div>
                        </Card>
                    ))}
                </div>
            )}

            {tab === "doctors" && (
                <div className="grid gap-3 sm:grid-cols-2">
                    {doctors.length === 0 && (
                        <Card className="p-0 sm:col-span-2">
                            <HealthEmptyState
                                icon={Stethoscope}
                                title="Add your care team"
                                description="Keep your doctors and specialists handy with their contact details, ready to attach to any record."
                                actionLabel="Add doctor"
                                onAction={() => { setEditingDoctor(null); setDoctorOpen(true); }}
                            />
                        </Card>
                    )}
                    {doctors.map((d) => (
                        <Card key={d.id}>
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex items-start gap-3">
                                    <Stethoscope className="size-5 text-fg-quaternary" />
                                    <div>
                                        <p className="text-sm font-semibold text-primary">{d.name}</p>
                                        {d.profession && <p className="text-xs text-tertiary">{d.profession}</p>}
                                        {(d.phone || d.email) && <p className="text-xs text-tertiary">{[d.phone, d.email].filter(Boolean).join(" · ")}</p>}
                                    </div>
                                </div>
                                <div className="flex gap-1">
                                    <Button size="sm" color="tertiary" iconLeading={Edit01} onClick={() => { setEditingDoctor(d); setDoctorOpen(true); }} aria-label="Edit" />
                                    <form action={(fd) => wrap(() => deleteDoctor(fd), "Deleted")}>
                                        <input type="hidden" name="id" value={d.id} />
                                        <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} type="submit" aria-label="Delete" />
                                    </form>
                                </div>
                            </div>
                        </Card>
                    ))}
                </div>
            )}
            </div>

            {/* Record modal */}
            <FormModal
                isOpen={recordOpen}
                onOpenChange={(o) => {
                    setRecordOpen(o);
                    if (!o) setEditingRecord(null);
                }}
                title={editingRecord ? "Edit medical record" : "Add medical record"}
            >
                <form
                    action={(fd) =>
                        wrap(
                            () => (editingRecord ? updateMedicalRecord(fd) : createMedicalRecord(fd)),
                            editingRecord ? "Record updated" : "Record added",
                            () => {
                                setRecordOpen(false);
                                setEditingRecord(null);
                            },
                        )
                    }
                    className="flex flex-col gap-4"
                >
                    {editingRecord && <input type="hidden" name="id" value={editingRecord.id} />}
                    <Field label="Name" htmlFor="name">
                        <NativeInput id="name" name="name" required placeholder="e.g. Annual blood panel" defaultValue={editingRecord?.name ?? ""} />
                    </Field>
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Provider">
                            <Select
                                selectedKey={recordProviderId || null}
                                onSelectionChange={(k) => setRecordProviderId(k ? String(k) : "")}
                                items={[{ id: "", label: "—" }, ...providers.map((p) => ({ id: p.id, label: p.name }))]}
                                size="sm"
                                aria-label="Provider"
                            >
                                {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                            </Select>
                            <input type="hidden" name="providerId" value={recordProviderId} />
                        </Field>
                        <Field label="Doctor">
                            <Select
                                selectedKey={recordDoctorId || null}
                                onSelectionChange={(k) => setRecordDoctorId(k ? String(k) : "")}
                                items={[{ id: "", label: "—" }, ...doctors.map((d) => ({ id: d.id, label: d.name }))]}
                                size="sm"
                                aria-label="Doctor"
                            >
                                {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                            </Select>
                            <input type="hidden" name="doctorId" value={recordDoctorId} />
                        </Field>
                    </div>
                    <FormDateInput
                        name="recordDate"
                        label="Record date"
                        variant="datetime"
                        defaultValue={editingRecord?.recordDate ? toLocalInput(editingRecord.recordDate) : toLocalInput(new Date().toISOString())}
                    />
                    <Field label="File" htmlFor="file">
                        <FormFileUpload name="file" accept="image/*,.pdf,.doc,.docx" hint={editingRecord?.fileName ? `Current: ${editingRecord.fileName}. Upload to replace.` : "Click or drag — PDF, image or document up to 25 MB."} />
                    </Field>
                    <Field label="Notes" htmlFor="notes">
                        <NativeTextarea id="notes" name="notes" defaultValue={editingRecord?.notes ?? ""} />
                    </Field>
                    <div className="flex items-center justify-between gap-2 pt-2">
                        <Tooltip title={aiEnabled ? "AI extraction" : "Set ANTHROPIC_API_KEY to enable"}>
                            <TooltipTrigger>
                                <Button type="button" color="secondary" iconLeading={Sparkles01} isDisabled={!aiEnabled}>
                                    AI extract
                                </Button>
                            </TooltipTrigger>
                        </Tooltip>
                        <div className="flex gap-2">
                            <Button color="secondary" type="button" onClick={() => setRecordOpen(false)}>Cancel</Button>
                            <Button type="submit">Save</Button>
                        </div>
                    </div>
                </form>
            </FormModal>

            {/* Provider modal */}
            <FormModal isOpen={providerOpen} onOpenChange={setProviderOpen} title={editingProvider ? "Edit provider" : "Add provider"}>
                <form action={(fd) => wrap(() => upsertProvider(fd), "Saved", () => setProviderOpen(false))} className="flex flex-col gap-4">
                    {editingProvider && <input type="hidden" name="id" value={editingProvider.id} />}
                    <Field label="Name" htmlFor="p_name">
                        <NativeInput id="p_name" name="name" required defaultValue={editingProvider?.name ?? ""} />
                    </Field>
                    <Field label="Address" htmlFor="p_address">
                        <NativeInput id="p_address" name="address" defaultValue={editingProvider?.address ?? ""} />
                    </Field>
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Phone" htmlFor="p_phone">
                            <NativeInput id="p_phone" name="phone" defaultValue={editingProvider?.phone ?? ""} />
                        </Field>
                        <Field label="Website" htmlFor="p_website">
                            <NativeInput id="p_website" name="website" defaultValue={editingProvider?.website ?? ""} />
                        </Field>
                    </div>
                    <Field label="Notes" htmlFor="p_notes">
                        <NativeTextarea id="p_notes" name="notes" defaultValue={editingProvider?.notes ?? ""} />
                    </Field>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setProviderOpen(false)}>Cancel</Button>
                        <Button type="submit">Save</Button>
                    </div>
                </form>
            </FormModal>

            {/* Doctor modal */}
            <FormModal isOpen={doctorOpen} onOpenChange={setDoctorOpen} title={editingDoctor ? "Edit doctor" : "Add doctor"}>
                <form action={(fd) => wrap(() => upsertDoctor(fd), "Saved", () => setDoctorOpen(false))} className="flex flex-col gap-4">
                    {editingDoctor && <input type="hidden" name="id" value={editingDoctor.id} />}
                    <Field label="Name" htmlFor="d_name">
                        <NativeInput id="d_name" name="name" required defaultValue={editingDoctor?.name ?? ""} />
                    </Field>
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Profession" htmlFor="d_profession">
                            <NativeInput id="d_profession" name="profession" defaultValue={editingDoctor?.profession ?? ""} />
                        </Field>
                        <Field label="Provider" htmlFor="d_providerId">
                            <NativeSelect id="d_providerId" name="providerId" defaultValue={editingDoctor?.providerId ?? ""}>
                                <option value="">—</option>
                                {providers.map((p) => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </NativeSelect>
                        </Field>
                        <Field label="Phone" htmlFor="d_phone">
                            <NativeInput id="d_phone" name="phone" defaultValue={editingDoctor?.phone ?? ""} />
                        </Field>
                        <Field label="Email" htmlFor="d_email">
                            <NativeInput id="d_email" name="email" defaultValue={editingDoctor?.email ?? ""} />
                        </Field>
                    </div>
                    <Field label="Location" htmlFor="d_location">
                        <NativeInput id="d_location" name="location" defaultValue={editingDoctor?.location ?? ""} />
                    </Field>
                    <Field label="Notes" htmlFor="d_notes">
                        <NativeTextarea id="d_notes" name="notes" defaultValue={editingDoctor?.notes ?? ""} />
                    </Field>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setDoctorOpen(false)}>Cancel</Button>
                        <Button type="submit">Save</Button>
                    </div>
                </form>
            </FormModal>

            {/* Extracted items modal */}
            <FormModal isOpen={!!itemsFor} onOpenChange={(o) => !o && setItemsFor(null)} title={itemsFor ? `Extracted items · ${itemsFor.name}` : "Extracted items"}>
                {itemsFor && (
                    <div className="flex flex-col gap-4">
                        <form action={(fd) => wrap(() => addExtractedItem(fd), "Added")} className="flex flex-col gap-3">
                            <input type="hidden" name="recordId" value={itemsFor.id} />
                            <div className="grid grid-cols-2 gap-3">
                                <Field label="Label" htmlFor="ei_label">
                                    <NativeInput id="ei_label" name="label" required placeholder="e.g. LDL" />
                                </Field>
                                <Field label="Type" htmlFor="ei_type">
                                    <NativeInput id="ei_type" name="itemType" placeholder="e.g. lab_value" />
                                </Field>
                                <Field label="Value" htmlFor="ei_value">
                                    <NativeInput id="ei_value" name="value" />
                                </Field>
                                <Field label="Unit" htmlFor="ei_unit">
                                    <NativeInput id="ei_unit" name="unit" />
                                </Field>
                            </div>
                            <Button type="submit" iconLeading={Plus} className="self-start">Add item</Button>
                        </form>
                        <div className="flex flex-col gap-2">
                            {itemsFor.extractedItems.length === 0 && <p className="text-sm text-tertiary">No items yet.</p>}
                            {itemsFor.extractedItems.map((it) => (
                                <div key={it.id} className="flex items-center justify-between rounded-lg px-3 py-2 ring-1 ring-secondary ring-inset">
                                    <span className="text-sm text-primary">
                                        {it.label}: {it.value}
                                        {it.unit ? ` ${it.unit}` : ""}
                                    </span>
                                    <form action={(fd) => wrap(() => deleteExtractedItem(fd), "Removed")}>
                                        <input type="hidden" name="id" value={it.id} />
                                        <Button type="submit" size="sm" color="tertiary-destructive" iconLeading={Trash02} aria-label="Delete" />
                                    </form>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </FormModal>
        </div>
    );
}
