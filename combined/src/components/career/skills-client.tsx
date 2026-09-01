"use client";

import { useMemo, useState } from "react";
import { Plus, Edit01, Trash02, Star01, LinkExternal01, Target04, Tag01 } from "@untitledui/icons";
import { toast } from "sonner";
import { Button } from "@/components/base/buttons/button";
import { Select } from "@/components/base/select/select";
import { Card, CardBody } from "@/components/jobs/card";
import { TextInput, TextareaInput } from "@/components/jobs/fields";
import { FormModal } from "@/app/(app)/health/_components/form-modal";
import { EmptyState, Tag } from "@/components/career/career-ui";
import { createSkill, updateSkill, deleteSkill } from "@/lib/actions/career";

export interface SkillRow {
    id: string;
    name: string;
    category: string | null;
    proficiency: number | null;
    targetProficiency: number | null;
    practicePlan: string | null;
    proofUrl: string | null;
    hoursLogged: number;
}

/** 1–5 proficiency scale shared by the level select and the dots renderer. */
const LEVELS = [
    { value: "1", label: "1 — Novice" },
    { value: "2", label: "2 — Advanced beginner" },
    { value: "3", label: "3 — Competent" },
    { value: "4", label: "4 — Proficient" },
    { value: "5", label: "5 — Expert" },
];

/** Five dots that fill up to `level`, with a hollow ring for the target. */
function ProficiencyDots({ level, target }: { level: number | null; target: number | null }) {
    return (
        <div className="flex items-center gap-1" aria-hidden="true">
            {[1, 2, 3, 4, 5].map((n) => {
                const filled = (level ?? 0) >= n;
                const isTarget = target != null && target === n && !filled;
                return (
                    <span
                        key={n}
                        className={
                            filled
                                ? "size-2.5 rounded-full bg-brand-solid"
                                : isTarget
                                  ? "size-2.5 rounded-full ring-2 ring-brand ring-inset"
                                  : "size-2.5 rounded-full bg-quaternary"
                        }
                    />
                );
            })}
        </div>
    );
}

function levelLabel(level: number | null) {
    if (level == null) return "Not set";
    return LEVELS.find((l) => l.value === String(level))?.label.replace(/^\d+ — /, "") ?? String(level);
}

export function SkillsClient({ skills }: { skills: SkillRow[] }) {
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<SkillRow | null>(null);
    const [proficiency, setProficiency] = useState<string>("");
    const [target, setTarget] = useState<string>("");

    const summary = useMemo(() => {
        const total = skills.length;
        const withGap = skills.filter((s) => s.targetProficiency != null && (s.proficiency ?? 0) < s.targetProficiency).length;
        const expert = skills.filter((s) => (s.proficiency ?? 0) >= 5).length;
        const hours = skills.reduce((sum, s) => sum + (s.hoursLogged || 0), 0);
        return { total, withGap, expert, hours };
    }, [skills]);

    // Group skills by category for a tidy, scannable layout.
    const grouped = useMemo(() => {
        const map = new Map<string, SkillRow[]>();
        for (const s of skills) {
            const key = s.category?.trim() || "Uncategorized";
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(s);
        }
        return Array.from(map.entries()).sort((a, b) => {
            if (a[0] === "Uncategorized") return 1;
            if (b[0] === "Uncategorized") return -1;
            return a[0].localeCompare(b[0]);
        });
    }, [skills]);

    function openCreate() {
        setEditing(null);
        setProficiency("");
        setTarget("");
        setOpen(true);
    }
    function openEdit(row: SkillRow) {
        setEditing(row);
        setProficiency(row.proficiency != null ? String(row.proficiency) : "");
        setTarget(row.targetProficiency != null ? String(row.targetProficiency) : "");
        setOpen(true);
    }

    async function onSubmit(fd: FormData) {
        try {
            if (editing) await updateSkill(fd);
            else await createSkill(fd);
            toast.success(editing ? "Skill updated" : "Skill added");
            setOpen(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        }
    }

    async function onDelete(id: string) {
        const fd = new FormData();
        fd.set("id", id);
        try {
            await deleteSkill(fd);
            toast.success("Skill deleted");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to delete");
        }
    }

    const summaryCards = [
        { label: "Skills tracked", value: summary.total, icon: Star01 },
        { label: "Below target", value: summary.withGap, icon: Target04 },
        { label: "At expert level", value: summary.expert, icon: Star01 },
        { label: "Hours logged", value: Math.round(summary.hours), icon: Tag01 },
    ];

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h2 className="text-lg font-semibold text-primary">Skills</h2>
                    <p className="text-sm text-tertiary">Track proficiency, set targets, and log practice toward each skill.</p>
                </div>
                <Button iconLeading={Plus} onClick={openCreate}>
                    Add skill
                </Button>
            </div>

            <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
                {summaryCards.map((c) => (
                    <Card key={c.label}>
                        <CardBody className="flex items-center justify-between gap-2 p-4">
                            <div className="min-w-0">
                                <p className="text-display-xs font-semibold text-primary">{c.value}</p>
                                <p className="truncate text-xs text-tertiary">{c.label}</p>
                            </div>
                            <c.icon aria-hidden="true" className="size-5 shrink-0 text-fg-quaternary" />
                        </CardBody>
                    </Card>
                ))}
            </div>

            {skills.length === 0 ? (
                <Card>
                    <EmptyState
                        icon={Star01}
                        title="Build your skills profile"
                        action={
                            <Button iconLeading={Plus} onClick={openCreate}>
                                Add your first skill
                            </Button>
                        }
                    >
                        Track proficiency, set targets, and log practice hours so you can prove growth and spot gaps before your next interview.
                    </EmptyState>
                </Card>
            ) : (
                <div className="flex flex-col gap-6">
                    {grouped.map(([category, rows]) => (
                        <div key={category} className="flex flex-col gap-3">
                            <div className="flex items-center gap-2">
                                <Tag01 aria-hidden="true" className="size-4 text-fg-quaternary" />
                                <h3 className="text-sm font-semibold text-secondary">{category}</h3>
                                <span className="text-xs text-tertiary">· {rows.length}</span>
                            </div>
                            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                                {rows.map((s) => {
                                    const belowTarget = s.targetProficiency != null && (s.proficiency ?? 0) < s.targetProficiency;
                                    return (
                                        <Card key={s.id} className="transition hover:bg-secondary_hover">
                                            <CardBody className="flex flex-col gap-3">
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="min-w-0">
                                                        <h4 className="truncate text-sm font-semibold text-primary">{s.name}</h4>
                                                        <p className="text-xs text-tertiary">{levelLabel(s.proficiency)}</p>
                                                    </div>
                                                    <div className="flex shrink-0 gap-1">
                                                        <Button size="sm" color="tertiary" iconLeading={Edit01} onClick={() => openEdit(s)} aria-label="Edit skill" />
                                                        <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} onClick={() => onDelete(s.id)} aria-label="Delete skill" />
                                                    </div>
                                                </div>

                                                <div className="flex items-center justify-between gap-2">
                                                    <ProficiencyDots level={s.proficiency} target={s.targetProficiency} />
                                                    {s.targetProficiency != null && (
                                                        <span className={belowTarget ? "text-xs font-medium text-warning-primary" : "text-xs font-medium text-success-primary"}>
                                                            {belowTarget ? `Target ${s.targetProficiency}` : "On target"}
                                                        </span>
                                                    )}
                                                </div>

                                                {s.practicePlan && <p className="line-clamp-3 text-xs text-tertiary">{s.practicePlan}</p>}

                                                <div className="flex flex-wrap items-center gap-2 pt-1">
                                                    {s.hoursLogged > 0 && <Tag>{Math.round(s.hoursLogged)}h logged</Tag>}
                                                    {s.proofUrl && (
                                                        <a
                                                            href={s.proofUrl}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            className="inline-flex items-center gap-1 text-xs font-medium text-brand-secondary hover:underline"
                                                        >
                                                            <LinkExternal01 aria-hidden="true" className="size-3" />
                                                            Proof
                                                        </a>
                                                    )}
                                                </div>
                                            </CardBody>
                                        </Card>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <FormModal isOpen={open} onOpenChange={setOpen} title={editing ? "Edit skill" : "Add skill"}>
                <form action={onSubmit} className="flex flex-col gap-4">
                    {editing && <input type="hidden" name="id" value={editing.id} />}
                    {/* Controlled selects post their value via hidden inputs (works in server-action forms). */}
                    <input type="hidden" name="proficiency" value={proficiency} />
                    <input type="hidden" name="targetProficiency" value={target} />

                    <TextInput label="Skill name" name="name" id="name" isRequired defaultValue={editing?.name ?? ""} placeholder="e.g. TypeScript" />
                    <TextInput label="Category" name="category" id="category" defaultValue={editing?.category ?? ""} placeholder="e.g. Engineering, Leadership" />

                    <div className="grid grid-cols-2 gap-4">
                        <Select
                            label="Current level"
                            placeholder="Not set"
                            selectedKey={proficiency || null}
                            onSelectionChange={(key) => setProficiency(key ? String(key) : "")}
                            items={LEVELS.map((l) => ({ id: l.value, label: l.label }))}
                        >
                            {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                        </Select>
                        <Select
                            label="Target level"
                            placeholder="Not set"
                            selectedKey={target || null}
                            onSelectionChange={(key) => setTarget(key ? String(key) : "")}
                            items={LEVELS.map((l) => ({ id: l.value, label: l.label }))}
                        >
                            {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                        </Select>
                    </div>

                    <TextInput
                        label="Hours logged"
                        name="hoursLogged"
                        id="hoursLogged"
                        type="number"
                        step="any"
                        min={0}
                        defaultValue={editing?.hoursLogged ?? 0}
                    />
                    <TextareaInput
                        label="Practice plan"
                        name="practicePlan"
                        id="practicePlan"
                        rows={3}
                        defaultValue={editing?.practicePlan ?? ""}
                        placeholder="How you'll close the gap to your target"
                    />
                    <TextInput label="Proof URL" name="proofUrl" id="proofUrl" type="url" defaultValue={editing?.proofUrl ?? ""} placeholder="https://..." />

                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="submit">{editing ? "Save" : "Add"}</Button>
                    </div>
                </form>
            </FormModal>
        </div>
    );
}
