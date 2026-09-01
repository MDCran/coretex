"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Edit01, Trash02, ArrowUp, ArrowDown, Printer, FilePlus02, LinkExternal01, FolderCheck, ArrowRight } from "@untitledui/icons";
import { toast } from "sonner";
import type { ResumeItemKind } from "@prisma/client";
import { Button } from "@/components/base/buttons/button";
import { Card, CardBody } from "@/components/jobs/card";
import { TextInput, TextareaInput, SelectInput, DateInput } from "@/components/jobs/fields";
import { FormModal } from "@/app/(app)/health/_components/form-modal";
import { EmptyState } from "@/components/career/career-ui";
import { fmtDate, toDateInput } from "@/lib/jobs/format";
import {
    createResume,
    updateResume,
    deleteResume,
    createResumeItem,
    updateResumeItem,
    deleteResumeItem,
    moveResumeItem,
} from "@/lib/actions/career";

export interface ResumeItemData {
    id: string;
    kind: ResumeItemKind;
    order: number;
    title: string;
    subtitle: string | null;
    location: string | null;
    startDate: string | null;
    endDate: string | null;
    current: boolean;
    description: string | null;
    url: string | null;
}
export interface ResumeData {
    id: string;
    name: string;
    headline: string | null;
    summary: string | null;
    items: ResumeItemData[];
}

const KIND_ORDER: ResumeItemKind[] = ["EXPERIENCE", "PROJECT", "EDUCATION", "VOLUNTEER", "SKILL", "CERTIFICATION", "AWARD", "ORGANIZATION"];
const KIND_LABEL: Record<ResumeItemKind, string> = {
    EXPERIENCE: "Experience",
    PROJECT: "Projects",
    EDUCATION: "Education",
    VOLUNTEER: "Volunteer",
    SKILL: "Skills",
    CERTIFICATION: "Certifications",
    AWARD: "Awards",
    ORGANIZATION: "Organizations",
};
const KIND_OPTIONS = KIND_ORDER.map((k) => ({ value: k, label: KIND_LABEL[k].replace(/s$/, "") }));

function dateRange(item: ResumeItemData) {
    const start = item.startDate ? fmtDate(item.startDate) : "";
    const end = item.current ? "Present" : item.endDate ? fmtDate(item.endDate) : "";
    if (!start && !end) return "";
    return [start, end].filter(Boolean).join(" – ");
}

export function ResumeClient({ resumes, profile }: { resumes: ResumeData[]; profile: { name: string | null; email: string } }) {
    const [selectedId, setSelectedId] = useState<string | null>(resumes[0]?.id ?? null);
    const selected = resumes.find((r) => r.id === selectedId) ?? resumes[0] ?? null;

    const [resumeModal, setResumeModal] = useState<"create" | "edit" | null>(null);
    const [itemModal, setItemModal] = useState(false);
    const [editingItem, setEditingItem] = useState<ResumeItemData | null>(null);
    const [defaultKind, setDefaultKind] = useState<ResumeItemKind>("EXPERIENCE");

    const grouped = useMemo(() => {
        const map = new Map<ResumeItemKind, ResumeItemData[]>();
        for (const k of KIND_ORDER) map.set(k, []);
        for (const i of selected?.items ?? []) map.get(i.kind)?.push(i);
        for (const k of KIND_ORDER) map.get(k)?.sort((a, b) => a.order - b.order);
        return map;
    }, [selected]);

    async function run(fn: () => Promise<unknown>, msg: string, onOk?: () => void) {
        try {
            await fn();
            toast.success(msg);
            onOk?.();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        }
    }

    if (resumes.length === 0) {
        return (
            <div className="flex flex-col gap-4">
                <Card>
                    <EmptyState
                        icon={FilePlus02}
                        title="Build your first resume"
                        action={
                            <Button iconLeading={Plus} onClick={() => setResumeModal("create")}>
                                Create resume
                            </Button>
                        }
                    >
                        Compose tailored, section-based resumes with a live preview and one-click PDF export — ready for every application.
                    </EmptyState>
                </Card>
                <ResumeFormModal mode={resumeModal} onClose={() => setResumeModal(null)} resume={null} run={run} />
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-6">
            {/* Print CSS: only the preview is shown when printing. */}
            <style>{`
                @media print {
                    body * { visibility: hidden !important; }
                    #resume-print, #resume-print * { visibility: visible !important; }
                    #resume-print { position: absolute; inset: 0; margin: 0; padding: 32px; box-shadow: none !important; }
                    .no-print { display: none !important; }
                }
            `}</style>

            <Link
                href="/career/documents"
                className="no-print flex items-center gap-3 rounded-xl bg-secondary_subtle px-4 py-3 ring-1 ring-secondary ring-inset transition duration-100 ease-linear hover:bg-secondary_hover"
            >
                <FolderCheck aria-hidden="true" className="size-5 shrink-0 text-fg-brand-primary" />
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-primary">Looking for your uploaded resume files?</p>
                    <p className="text-xs text-tertiary">Manage uploaded resumes and cover letters, with version history and PDF preview, in Documents.</p>
                </div>
                <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-fg-quaternary" />
            </Link>

            <div className="no-print flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <SelectInput
                        label=""
                        aria-label="Select resume"
                        name="resumeSelect"
                        id="resumeSelect"
                        value={selected?.id}
                        onChange={(e) => setSelectedId(e.target.value)}
                        options={resumes.map((r) => ({ value: r.id, label: r.name }))}
                        fieldClassName="w-56"
                    />
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button color="secondary" iconLeading={Plus} onClick={() => setResumeModal("create")}>
                        New resume
                    </Button>
                    {selected && (
                        <>
                            <Button color="secondary" iconLeading={Edit01} onClick={() => setResumeModal("edit")}>
                                Edit details
                            </Button>
                            <Button color="secondary-destructive" iconLeading={Trash02} onClick={() => run(() => {
                                const fd = new FormData();
                                fd.set("id", selected.id);
                                return deleteResume(fd);
                            }, "Resume deleted", () => setSelectedId(resumes.find((r) => r.id !== selected.id)?.id ?? null))}>
                                Delete
                            </Button>
                            <Button iconLeading={Printer} onClick={() => window.print()}>
                                Print / PDF
                            </Button>
                        </>
                    )}
                </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
                {/* Editor */}
                <div className="no-print flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-semibold text-primary">Sections</h2>
                        <Button
                            size="sm"
                            iconLeading={Plus}
                            onClick={() => {
                                setEditingItem(null);
                                setDefaultKind("EXPERIENCE");
                                setItemModal(true);
                            }}
                        >
                            Add item
                        </Button>
                    </div>

                    {KIND_ORDER.map((kind) => {
                        const items = grouped.get(kind) ?? [];
                        if (items.length === 0) return null;
                        return (
                            <Card key={kind}>
                                <CardBody className="flex flex-col gap-2">
                                    <h3 className="text-sm font-semibold text-tertiary uppercase tracking-wide">{KIND_LABEL[kind]}</h3>
                                    <ul className="flex flex-col divide-y divide-secondary">
                                        {items.map((item, idx) => (
                                            <li key={item.id} className="flex items-start justify-between gap-3 py-2.5">
                                                <div className="min-w-0">
                                                    <p className="truncate text-sm font-medium text-primary">{item.title}</p>
                                                    {item.subtitle && <p className="truncate text-xs text-tertiary">{item.subtitle}</p>}
                                                    {dateRange(item) && <p className="text-xs text-tertiary">{dateRange(item)}</p>}
                                                </div>
                                                <div className="flex shrink-0 gap-0.5">
                                                    <Button
                                                        size="sm"
                                                        color="tertiary"
                                                        iconLeading={ArrowUp}
                                                        isDisabled={idx === 0}
                                                        onClick={() => {
                                                            const fd = new FormData();
                                                            fd.set("id", item.id);
                                                            fd.set("direction", "up");
                                                            run(() => moveResumeItem(fd), "Reordered");
                                                        }}
                                                        aria-label="Move up"
                                                    />
                                                    <Button
                                                        size="sm"
                                                        color="tertiary"
                                                        iconLeading={ArrowDown}
                                                        isDisabled={idx === items.length - 1}
                                                        onClick={() => {
                                                            const fd = new FormData();
                                                            fd.set("id", item.id);
                                                            fd.set("direction", "down");
                                                            run(() => moveResumeItem(fd), "Reordered");
                                                        }}
                                                        aria-label="Move down"
                                                    />
                                                    <Button
                                                        size="sm"
                                                        color="tertiary"
                                                        iconLeading={Edit01}
                                                        onClick={() => {
                                                            setEditingItem(item);
                                                            setItemModal(true);
                                                        }}
                                                        aria-label="Edit"
                                                    />
                                                    <Button
                                                        size="sm"
                                                        color="tertiary-destructive"
                                                        iconLeading={Trash02}
                                                        onClick={() => {
                                                            const fd = new FormData();
                                                            fd.set("id", item.id);
                                                            run(() => deleteResumeItem(fd), "Item deleted");
                                                        }}
                                                        aria-label="Delete"
                                                    />
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                </CardBody>
                            </Card>
                        );
                    })}

                    {(selected?.items.length ?? 0) === 0 && (
                        <Card>
                            <EmptyState
                                icon={Plus}
                                title="Add your first section"
                                action={
                                    <Button
                                        size="sm"
                                        iconLeading={Plus}
                                        onClick={() => {
                                            setEditingItem(null);
                                            setDefaultKind("EXPERIENCE");
                                            setItemModal(true);
                                        }}
                                    >
                                        Add item
                                    </Button>
                                }
                            >
                                Start with your experience, then add education, projects, and skills. The preview updates as you go.
                            </EmptyState>
                        </Card>
                    )}
                </div>

                {/* Live preview */}
                <div>
                    <div id="resume-print" className="rounded-xl bg-primary p-8 ring-1 ring-secondary ring-inset">
                        <header className="border-b border-secondary pb-4">
                            <h1 className="text-2xl font-bold text-primary">{profile.name ?? "Your name"}</h1>
                            {selected?.headline && <p className="mt-0.5 text-md text-secondary">{selected.headline}</p>}
                            <p className="mt-1 text-sm text-tertiary">{profile.email}</p>
                        </header>

                        {selected?.summary && (
                            <section className="mt-4">
                                <p className="text-sm leading-relaxed text-secondary">{selected.summary}</p>
                            </section>
                        )}

                        {KIND_ORDER.map((kind) => {
                            const items = grouped.get(kind) ?? [];
                            if (items.length === 0) return null;
                            return (
                                <section key={kind} className="mt-5">
                                    <h2 className="border-b border-secondary pb-1 text-xs font-bold uppercase tracking-wider text-primary">{KIND_LABEL[kind]}</h2>
                                    <div className="mt-2 flex flex-col gap-3">
                                        {items.map((item) => (
                                            <div key={item.id}>
                                                <div className="flex items-baseline justify-between gap-3">
                                                    <p className="text-sm font-semibold text-primary">{item.title}</p>
                                                    {dateRange(item) && <p className="shrink-0 text-xs text-tertiary">{dateRange(item)}</p>}
                                                </div>
                                                {(item.subtitle || item.location) && (
                                                    <p className="text-xs text-secondary">{[item.subtitle, item.location].filter(Boolean).join(" · ")}</p>
                                                )}
                                                {item.description && <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-secondary">{item.description}</p>}
                                                {item.url && (
                                                    <a href={item.url} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-xs text-brand-secondary hover:underline">
                                                        <LinkExternal01 className="size-3" /> {item.url}
                                                    </a>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </section>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Resume details modal */}
            <ResumeFormModal mode={resumeModal} onClose={() => setResumeModal(null)} resume={resumeModal === "edit" ? selected : null} run={run} onCreated={setSelectedId} />

            {/* Item modal */}
            <FormModal isOpen={itemModal} onOpenChange={setItemModal} title={editingItem ? "Edit item" : "Add item"}>
                {selected && (
                    <form
                        action={(fd) =>
                            run(() => (editingItem ? updateResumeItem(fd) : createResumeItem(fd)), editingItem ? "Item updated" : "Item added", () => setItemModal(false))
                        }
                        className="flex flex-col gap-4"
                    >
                        {editingItem ? <input type="hidden" name="id" value={editingItem.id} /> : <input type="hidden" name="resumeId" value={selected.id} />}
                        <SelectInput label="Section" name="kind" id="i-kind" options={KIND_OPTIONS} defaultValue={editingItem?.kind ?? defaultKind} />
                        <TextInput label="Title" name="title" id="i-title" isRequired defaultValue={editingItem?.title ?? ""} placeholder="e.g. Senior Engineer" />
                        <TextInput label="Subtitle" name="subtitle" id="i-subtitle" defaultValue={editingItem?.subtitle ?? ""} placeholder="e.g. Acme Inc." />
                        <TextInput label="Location" name="location" id="i-location" defaultValue={editingItem?.location ?? ""} />
                        <div className="grid grid-cols-2 gap-4">
                            <DateInput label="Start date" name="startDate" id="i-start" defaultValue={toDateInput(editingItem?.startDate)} />
                            <DateInput label="End date" name="endDate" id="i-end" defaultValue={toDateInput(editingItem?.endDate)} />
                        </div>
                        <label className="flex items-center gap-2 text-sm text-secondary">
                            <input type="checkbox" name="current" defaultChecked={editingItem?.current ?? false} className="size-4 rounded border-primary" /> Current / ongoing
                        </label>
                        <TextareaInput label="Description" name="description" id="i-description" rows={4} defaultValue={editingItem?.description ?? ""} />
                        <TextInput label="URL" name="url" id="i-url" type="url" defaultValue={editingItem?.url ?? ""} placeholder="https://" />
                        <div className="flex justify-end gap-2 pt-2">
                            <Button color="secondary" type="button" onClick={() => setItemModal(false)}>
                                Cancel
                            </Button>
                            <Button type="submit">{editingItem ? "Save" : "Add"}</Button>
                        </div>
                    </form>
                )}
            </FormModal>
        </div>
    );
}

function ResumeFormModal({
    mode,
    onClose,
    resume,
    run,
    onCreated,
}: {
    mode: "create" | "edit" | null;
    onClose: () => void;
    resume: ResumeData | null;
    run: (fn: () => Promise<unknown>, msg: string, onOk?: () => void) => Promise<void>;
    onCreated?: (id: string) => void;
}) {
    const isEdit = mode === "edit";
    return (
        <FormModal isOpen={mode !== null} onOpenChange={(o) => !o && onClose()} title={isEdit ? "Edit resume" : "New resume"}>
            <form
                action={(fd) =>
                    run(
                        async () => {
                            if (isEdit) {
                                await updateResume(fd);
                            } else {
                                const id = await createResume(fd);
                                if (typeof id === "string") onCreated?.(id);
                            }
                        },
                        isEdit ? "Resume updated" : "Resume created",
                        onClose,
                    )
                }
                className="flex flex-col gap-4"
            >
                {isEdit && resume && <input type="hidden" name="id" value={resume.id} />}
                <TextInput label="Name" name="name" id="res-name" isRequired defaultValue={resume?.name ?? ""} placeholder="e.g. Software Engineer 2026" />
                <TextInput label="Headline" name="headline" id="res-headline" defaultValue={resume?.headline ?? ""} placeholder="e.g. Full-stack engineer" />
                <TextareaInput label="Summary" name="summary" id="res-summary" rows={4} defaultValue={resume?.summary ?? ""} />
                <div className="flex justify-end gap-2 pt-2">
                    <Button color="secondary" type="button" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button type="submit">{isEdit ? "Save" : "Create"}</Button>
                </div>
            </form>
        </FormModal>
    );
}
