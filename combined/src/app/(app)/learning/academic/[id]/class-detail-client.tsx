"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle, Edit01, Plus, RefreshCcw01, Save01, Trash02 } from "@untitledui/icons";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Card, Field, NativeInput, NativeSelect, NativeTextarea, ProgressBar, SectionHeader } from "../../_components/learning-ui";
import { FormDateInput } from "@/components/base/input/form-date-input";
import { FormModal } from "../../_components/form-modal";
import { TrendChart, type TrendPoint } from "../../_components/trend-chart";
import { formatDate, formatDateShort } from "@/lib/dates";
import {
    categoryResults,
    gpaPoints,
    letterGrade,
    runningGrade,
    whatIfNeeded,
    type GradeItem,
    type GradeWeight,
} from "@/lib/learning/grades";
import {
    addAbsence,
    createAssignment,
    createTest,
    completeClass,
    deleteAbsence,
    deleteAssignment,
    deleteClass,
    deleteTest,
    reopenClass,
    setGradeWeights,
    updateAssignment,
    updateClass,
    updateTest,
} from "@/lib/actions/learning-academic";
import { ClassFormFields, HOMEWORK_STATUS_LABEL, StatusBadge, gradeTextClass, run } from "../_components/shared";

export interface ClassInfo {
    id: string;
    name: string;
    gradeLevel: string;
    creditHours: number | null;
    term: string | null;
    instructor: string | null;
    color: string | null;
    status: string;
    finalGrade: number | null;
    absenceLimit: number | null;
    weights: GradeWeight[];
}
export interface AssignmentRow {
    id: string;
    title: string;
    category: string | null;
    dueDate: string | null;
    status: string;
    pointsEarned: number | null;
    pointsPossible: number | null;
    extraCredit: boolean;
    notes: string | null;
}
export interface TestRow {
    id: string;
    title: string;
    category: string | null;
    date: string | null;
    score: number | null;
    maxScore: number | null;
    curveAdjustment: number | null;
}
export interface AbsenceRow {
    id: string;
    date: string;
    reason: string | null;
    excused: boolean;
}

const LETTER_TARGETS: { letter: string; percent: number }[] = [
    { letter: "A", percent: 93 },
    { letter: "A-", percent: 90 },
    { letter: "B+", percent: 87 },
    { letter: "B", percent: 83 },
    { letter: "B-", percent: 80 },
    { letter: "C+", percent: 77 },
    { letter: "C", percent: 73 },
];

function buildItems(weights: GradeWeight[], assignments: AssignmentRow[], tests: TestRow[]): GradeItem[] {
    return [
        ...assignments
            .filter((a) => a.status === "GRADED" && a.pointsPossible != null)
            .map((a) => ({ category: a.category, earned: a.pointsEarned, possible: a.pointsPossible, extraCredit: a.extraCredit })),
        ...tests.map((t) => ({
            category: t.category,
            earned: t.score == null ? null : t.score + (t.curveAdjustment ?? 0),
            possible: t.maxScore,
        })),
    ];
}

export function ClassDetailClient({
    cls,
    assignments,
    tests,
    absences,
}: {
    cls: ClassInfo;
    assignments: AssignmentRow[];
    tests: TestRow[];
    absences: AbsenceRow[];
}) {
    const items = useMemo(() => buildItems(cls.weights, assignments, tests), [cls.weights, assignments, tests]);
    const grade = useMemo(() => runningGrade(cls.weights, items), [cls.weights, items]);
    const cats = useMemo(() => categoryResults(cls.weights, items), [cls.weights, items]);

    const displayPercent = cls.status === "COMPLETED" ? (cls.finalGrade ?? grade.percent) : grade.percent;
    const displayLetter = displayPercent == null ? null : letterGrade(displayPercent);

    // Extra-credit net adjustment: sum of extra-credit points earned in graded assignments.
    const extraCreditPoints = assignments
        .filter((a) => a.status === "GRADED" && a.extraCredit && a.pointsEarned != null)
        .reduce((s, a) => s + (a.pointsEarned as number), 0);

    return (
        <div className="flex flex-col gap-6">
            <Button size="sm" color="link-gray" iconLeading={ArrowLeft} href="/learning/academic">
                Back to academic
            </Button>

            {/* Header */}
            <Card className="flex flex-col gap-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                        <span
                            aria-hidden="true"
                            className={"inline-block size-3 shrink-0 rounded-full " + (cls.color ? "" : "bg-brand-solid")}
                            style={cls.color ? { backgroundColor: cls.color } : undefined}
                        />
                        <div className="min-w-0">
                            <h1 className="truncate text-xl font-semibold text-primary">{cls.name}</h1>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-tertiary">
                                <StatusBadge status={cls.status} />
                                {cls.term && <Badge color="gray" size="sm">{cls.term}</Badge>}
                                {cls.creditHours != null && <span>{cls.creditHours} credits</span>}
                                {cls.instructor && <span>· {cls.instructor}</span>}
                            </div>
                        </div>
                    </div>
                    <div className="text-right">
                        <p className={"text-display-sm font-semibold " + gradeTextClass(displayPercent)}>
                            {displayPercent == null ? "—" : `${displayPercent.toFixed(1)}%`}
                        </p>
                        <p className="text-sm text-tertiary">
                            {displayLetter ?? "No grades"}
                            {displayLetter && ` · ${gpaPoints(displayLetter).toFixed(1)} GPA`}
                        </p>
                    </div>
                </div>
                {cls.status === "COMPLETED" && (
                    <p className="text-sm text-success-primary">Final grade locked at {(cls.finalGrade ?? 0).toFixed(1)}%.</p>
                )}
            </Card>

            <GradeTracker cls={cls} cats={cats} grade={grade} displayPercent={displayPercent} extraCreditPoints={extraCreditPoints} />

            <WhatIfCalculator cls={cls} items={items} />

            <HomeworkSection cls={cls} assignments={assignments} extraCreditPoints={extraCreditPoints} />

            <TestsSection cls={cls} tests={tests} />

            <AttendanceSection cls={cls} absences={absences} />

            <SettingsSection cls={cls} />
        </div>
    );
}

// ── Grade tracker ────────────────────────────────────────────

function GradeTracker({
    cls,
    cats,
    grade,
    displayPercent,
    extraCreditPoints,
}: {
    cls: ClassInfo;
    cats: ReturnType<typeof categoryResults>;
    grade: ReturnType<typeof runningGrade>;
    displayPercent: number | null;
    extraCreditPoints: number;
}) {
    const [open, setOpen] = useState(false);
    const [rows, setRows] = useState<GradeWeight[]>(cls.weights);
    const sum = rows.reduce((s, r) => s + (Number.isFinite(r.weight) ? r.weight : 0), 0);

    const dropAlert = displayPercent != null && displayPercent < 87;

    return (
        <Card className="flex flex-col gap-4">
            <SectionHeader
                title="Grade tracker"
                description="Weighted running grade by category."
                action={<Button size="sm" color="secondary" iconLeading={Edit01} onClick={() => { setRows(cls.weights); setOpen(true); }}>Edit weights</Button>}
            />

            {dropAlert && (
                <div className="flex items-start gap-2 rounded-lg bg-warning-secondary p-3 ring-1 ring-secondary ring-inset">
                    <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning-primary" />
                    <p className="text-sm text-secondary">
                        Grade-drop alert: running grade is {displayPercent!.toFixed(1)}% — below a B+. Use the what-if calculator below to see what you need to recover.
                    </p>
                </div>
            )}

            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-secondary text-left text-xs text-tertiary">
                            <th className="py-2 pr-3 font-medium">Category</th>
                            <th className="py-2 pr-3 font-medium">Weight</th>
                            <th className="py-2 pr-3 font-medium">Earned / Possible</th>
                            <th className="py-2 pr-3 font-medium">Percent</th>
                        </tr>
                    </thead>
                    <tbody>
                        {cats.map((c) => (
                            <tr key={c.name} className="border-b border-secondary last:border-0">
                                <td className="py-2 pr-3 font-medium text-primary">{c.name}</td>
                                <td className="py-2 pr-3 text-tertiary">{c.weight}%</td>
                                <td className="py-2 pr-3 text-tertiary">{c.possible > 0 ? `${c.earned} / ${c.possible}` : "—"}</td>
                                <td className={"py-2 pr-3 font-medium " + gradeTextClass(c.percent)}>{c.percent == null ? "—" : `${c.percent.toFixed(1)}%`}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-secondary p-3">
                <div>
                    <p className="text-xs text-tertiary">Running grade ({grade.gradedWeight}% of weight graded)</p>
                    <p className={"text-display-xs font-semibold " + gradeTextClass(displayPercent)}>
                        {displayPercent == null ? "—" : `${displayPercent.toFixed(1)}% · ${letterGrade(displayPercent)}`}
                    </p>
                </div>
                <div className="text-right">
                    <p className="text-xs text-tertiary">GPA contribution</p>
                    <p className="text-md font-semibold text-primary">{displayPercent == null ? "—" : gpaPoints(letterGrade(displayPercent)).toFixed(1)}</p>
                </div>
            </div>
            {extraCreditPoints > 0 && (
                <p className="text-xs text-success-primary">Includes {extraCreditPoints} extra-credit point{extraCreditPoints === 1 ? "" : "s"} boosting your net grade.</p>
            )}

            <FormModal isOpen={open} onOpenChange={setOpen} title="Edit grade weights" description="Category weights should sum to ~100%.">
                <form
                    action={async (fd) => {
                        fd.set("id", cls.id);
                        fd.set("weights", JSON.stringify(rows.filter((r) => r.name.trim())));
                        const ok = await run(setGradeWeights, fd, "Weights saved");
                        if (ok) setOpen(false);
                    }}
                    className="flex flex-col gap-3"
                >
                    {rows.map((r, i) => (
                        <div key={i} className="flex items-end gap-2">
                            <Field label={i === 0 ? "Category" : ""} className="flex-1">
                                <NativeInput
                                    value={r.name}
                                    onChange={(e) => setRows((prev) => prev.map((p, j) => (j === i ? { ...p, name: e.target.value } : p)))}
                                    placeholder="Assignments"
                                />
                            </Field>
                            <Field label={i === 0 ? "Weight %" : ""} className="w-28">
                                <NativeInput
                                    type="number"
                                    min="0"
                                    value={Number.isFinite(r.weight) ? r.weight : ""}
                                    onChange={(e) => setRows((prev) => prev.map((p, j) => (j === i ? { ...p, weight: Number(e.target.value) } : p)))}
                                />
                            </Field>
                            <Button
                                type="button"
                                size="sm"
                                color="tertiary-destructive"
                                iconLeading={Trash02}
                                aria-label="Remove category"
                                onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                            />
                        </div>
                    ))}
                    <div className="flex items-center justify-between">
                        <Button type="button" size="sm" color="link-color" iconLeading={Plus} onClick={() => setRows((prev) => [...prev, { name: "", weight: 0 }])}>
                            Add category
                        </Button>
                        <span className={"text-sm font-medium " + (Math.abs(sum - 100) > 1 ? "text-error-primary" : "text-success-primary")}>Total: {sum}%</span>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setOpen(false)}>Cancel</Button>
                        <Button type="submit" iconLeading={Save01}>Save weights</Button>
                    </div>
                </form>
            </FormModal>
        </Card>
    );
}

// ── What-if calculator ───────────────────────────────────────

function WhatIfCalculator({ cls, items }: { cls: ClassInfo; items: GradeItem[] }) {
    const [category, setCategory] = useState(cls.weights[cls.weights.length - 1]?.name ?? "");
    const [targetPercent, setTargetPercent] = useState(93);
    const targetLetter = LETTER_TARGETS.find((t) => t.percent === targetPercent)?.letter ?? letterGrade(targetPercent);

    const needed = useMemo(
        () => (category ? whatIfNeeded(cls.weights, items, category, targetPercent) : null),
        [cls.weights, items, category, targetPercent],
    );

    let message: { tone: "success" | "warning" | "error" | "neutral"; text: string };
    if (!category) {
        message = { tone: "neutral", text: "Pick a category to calculate." };
    } else if (needed == null) {
        message = { tone: "neutral", text: "Not enough data to calculate." };
    } else if (needed <= 0) {
        message = { tone: "success", text: `You'll reach an ${targetLetter} (${targetPercent}%) regardless of your ${category} score.` };
    } else if (needed > 100) {
        message = { tone: "error", text: `You'd need ${needed.toFixed(1)}% on ${category} — not reachable for an ${targetLetter}.` };
    } else {
        message = { tone: needed > 90 ? "warning" : "success", text: `You need ${needed.toFixed(1)}% on ${category} to finish with an ${targetLetter} (${targetPercent}%).` };
    }

    const toneClass =
        message.tone === "success"
            ? "bg-success-secondary text-success-primary"
            : message.tone === "warning"
              ? "bg-warning-secondary text-warning-primary"
              : message.tone === "error"
                ? "bg-error-secondary text-error-primary"
                : "bg-secondary text-secondary";

    return (
        <Card className="flex flex-col gap-4">
            <SectionHeader title="What-if calculator" description="See the score you need to hit a target grade." />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Category">
                    <NativeSelect value={category} onChange={(e) => setCategory(e.target.value)}>
                        <option value="">Select…</option>
                        {cls.weights.map((w) => (
                            <option key={w.name} value={w.name}>
                                {w.name} ({w.weight}%)
                            </option>
                        ))}
                    </NativeSelect>
                </Field>
                <Field label="Target grade">
                    <NativeSelect value={targetPercent} onChange={(e) => setTargetPercent(Number(e.target.value))}>
                        {LETTER_TARGETS.map((t) => (
                            <option key={t.letter} value={t.percent}>
                                {t.letter} ({t.percent}%)
                            </option>
                        ))}
                    </NativeSelect>
                </Field>
            </div>
            <div className={"rounded-lg p-3 text-sm font-medium " + toneClass}>{message.text}</div>
        </Card>
    );
}

// ── Homework ─────────────────────────────────────────────────

const HOMEWORK_STATUS_COLOR: Record<string, "gray" | "brand" | "success" | "warning"> = {
    NOT_STARTED: "gray",
    IN_PROGRESS: "warning",
    SUBMITTED: "brand",
    GRADED: "success",
};

function HomeworkSection({ cls, assignments, extraCreditPoints }: { cls: ClassInfo; assignments: AssignmentRow[]; extraCreditPoints: number }) {
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<AssignmentRow | null>(null);
    const now = Date.now();

    return (
        <Card className="flex flex-col gap-4">
            <SectionHeader
                title="Homework"
                description={extraCreditPoints > 0 ? `Net grade includes +${extraCreditPoints} extra-credit points.` : "Assignments tracked against grade categories."}
                action={<Button size="sm" iconLeading={Plus} onClick={() => { setEditing(null); setOpen(true); }}>Add</Button>}
            />
            <div className="flex flex-col gap-2">
                {assignments.length === 0 && <p className="text-sm text-tertiary">No assignments yet.</p>}
                {assignments.map((a) => {
                    const due = a.dueDate ? new Date(a.dueDate).getTime() : null;
                    const overdue = due != null && due < now && a.status !== "GRADED" && a.status !== "SUBMITTED";
                    return (
                        <div key={a.id} className="flex items-start justify-between gap-3 rounded-lg p-3 ring-1 ring-secondary ring-inset">
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-sm font-medium text-primary">{a.title}</p>
                                    {a.extraCredit && <Badge color="purple" size="sm">Extra credit</Badge>}
                                    {overdue && <Badge color="error" size="sm">Overdue</Badge>}
                                </div>
                                <p className="text-xs text-tertiary">
                                    {a.category ?? "Uncategorized"}
                                    {a.dueDate && ` · due ${formatDate(a.dueDate)}`}
                                    {a.pointsPossible != null && ` · ${a.pointsEarned ?? "—"}/${a.pointsPossible} pts`}
                                </p>
                                {a.notes && <p className="mt-1 text-xs text-tertiary">{a.notes}</p>}
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                                <Badge color={HOMEWORK_STATUS_COLOR[a.status] ?? "gray"} size="sm">{HOMEWORK_STATUS_LABEL[a.status] ?? a.status}</Badge>
                                <Button size="sm" color="tertiary" iconLeading={Edit01} aria-label="Edit" onClick={() => { setEditing(a); setOpen(true); }} />
                                <Button
                                    size="sm"
                                    color="tertiary-destructive"
                                    iconLeading={Trash02}
                                    aria-label="Delete"
                                    onClick={() => {
                                        const fd = new FormData();
                                        fd.set("id", a.id);
                                        fd.set("classId", cls.id);
                                        run(deleteAssignment, fd, "Deleted");
                                    }}
                                />
                            </div>
                        </div>
                    );
                })}
            </div>

            <FormModal isOpen={open} onOpenChange={setOpen} title={editing ? "Edit assignment" : "Add assignment"}>
                <form
                    action={async (fd) => {
                        fd.set("classId", cls.id);
                        const ok = await run(editing ? updateAssignment : createAssignment, fd, editing ? "Updated" : "Added");
                        if (ok) setOpen(false);
                    }}
                    className="flex flex-col gap-4"
                >
                    {editing && <input type="hidden" name="id" value={editing.id} />}
                    <Field label="Title" htmlFor="hw-title" required><NativeInput id="hw-title" name="title" defaultValue={editing?.title} required /></Field>
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Category" htmlFor="hw-cat">
                            <NativeSelect id="hw-cat" name="category" defaultValue={editing?.category ?? ""}>
                                <option value="">Uncategorized</option>
                                {cls.weights.map((w) => <option key={w.name} value={w.name}>{w.name}</option>)}
                            </NativeSelect>
                        </Field>
                        <Field label="Status" htmlFor="hw-status">
                            <NativeSelect id="hw-status" name="status" defaultValue={editing?.status ?? "NOT_STARTED"}>
                                <option value="NOT_STARTED">Not started</option>
                                <option value="IN_PROGRESS">In progress</option>
                                <option value="SUBMITTED">Submitted</option>
                                <option value="GRADED">Graded</option>
                            </NativeSelect>
                        </Field>
                    </div>
                    <FormDateInput name="dueDate" variant="date" label="Due date" defaultValue={editing?.dueDate ? editing.dueDate.slice(0, 10) : ""} />
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Points earned" htmlFor="hw-earned"><NativeInput id="hw-earned" name="pointsEarned" type="number" step="0.1" defaultValue={editing?.pointsEarned ?? ""} /></Field>
                        <Field label="Points possible" htmlFor="hw-possible"><NativeInput id="hw-possible" name="pointsPossible" type="number" step="0.1" defaultValue={editing?.pointsPossible ?? ""} /></Field>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-secondary">
                        <input type="checkbox" name="extraCredit" defaultChecked={editing?.extraCredit ?? false} className="size-4 rounded ring-1 ring-primary" />
                        Extra credit (adds points without raising the denominator)
                    </label>
                    <Field label="Notes" htmlFor="hw-notes"><NativeTextarea id="hw-notes" name="notes" defaultValue={editing?.notes ?? ""} /></Field>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setOpen(false)}>Cancel</Button>
                        <Button type="submit">{editing ? "Save" : "Add"}</Button>
                    </div>
                </form>
            </FormModal>
        </Card>
    );
}

// ── Tests / quizzes ──────────────────────────────────────────

function TestsSection({ cls, tests }: { cls: ClassInfo; tests: TestRow[] }) {
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<TestRow | null>(null);

    const chartData: TrendPoint[] = tests
        .filter((t) => t.date && t.maxScore != null && t.maxScore > 0 && t.score != null)
        .map((t) => ({
            label: formatDateShort(t.date),
            Score: Math.round((((t.score as number) + (t.curveAdjustment ?? 0)) / (t.maxScore as number)) * 1000) / 10,
        }));

    return (
        <Card className="flex flex-col gap-4">
            <SectionHeader
                title="Tests & quizzes"
                description="Log scores and track your performance trend."
                action={<Button size="sm" iconLeading={Plus} onClick={() => { setEditing(null); setOpen(true); }}>Add</Button>}
            />

            {chartData.length > 0 && (
                <div className="rounded-lg ring-1 ring-secondary ring-inset">
                    <TrendChart data={chartData} series={[{ key: "Score", name: "Score %" }]} type="line" fitDomain height={220} emptyLabel="No test scores yet" />
                </div>
            )}

            <div className="flex flex-col gap-2">
                {tests.length === 0 && <p className="text-sm text-tertiary">No tests yet.</p>}
                {tests.map((t) => {
                    const pct = t.score != null && t.maxScore != null && t.maxScore > 0 ? ((t.score + (t.curveAdjustment ?? 0)) / t.maxScore) * 100 : null;
                    return (
                        <div key={t.id} className="flex items-center justify-between gap-3 rounded-lg p-3 ring-1 ring-secondary ring-inset">
                            <div className="min-w-0">
                                <p className="text-sm font-medium text-primary">{t.title}</p>
                                <p className="text-xs text-tertiary">
                                    {t.category ?? "Uncategorized"}
                                    {t.date && ` · ${formatDate(t.date)}`}
                                    {t.maxScore != null && ` · ${t.score ?? "—"}/${t.maxScore}`}
                                    {t.curveAdjustment ? ` (+${t.curveAdjustment} curve)` : ""}
                                </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                                {pct != null && <span className={"text-sm font-medium " + gradeTextClass(pct)}>{pct.toFixed(1)}%</span>}
                                <Button size="sm" color="tertiary" iconLeading={Edit01} aria-label="Edit" onClick={() => { setEditing(t); setOpen(true); }} />
                                <Button
                                    size="sm"
                                    color="tertiary-destructive"
                                    iconLeading={Trash02}
                                    aria-label="Delete"
                                    onClick={() => {
                                        const fd = new FormData();
                                        fd.set("id", t.id);
                                        fd.set("classId", cls.id);
                                        run(deleteTest, fd, "Deleted");
                                    }}
                                />
                            </div>
                        </div>
                    );
                })}
            </div>

            <FormModal isOpen={open} onOpenChange={setOpen} title={editing ? "Edit test" : "Add test"}>
                <form
                    action={async (fd) => {
                        fd.set("classId", cls.id);
                        const ok = await run(editing ? updateTest : createTest, fd, editing ? "Updated" : "Added");
                        if (ok) setOpen(false);
                    }}
                    className="flex flex-col gap-4"
                >
                    {editing && <input type="hidden" name="id" value={editing.id} />}
                    <Field label="Title" htmlFor="t-title" required><NativeInput id="t-title" name="title" defaultValue={editing?.title} required /></Field>
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Category" htmlFor="t-cat">
                            <NativeSelect id="t-cat" name="category" defaultValue={editing?.category ?? ""}>
                                <option value="">Uncategorized</option>
                                {cls.weights.map((w) => <option key={w.name} value={w.name}>{w.name}</option>)}
                            </NativeSelect>
                        </Field>
                        <FormDateInput name="date" variant="date" label="Date" defaultValue={editing?.date ? editing.date.slice(0, 10) : ""} />
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <Field label="Score" htmlFor="t-score"><NativeInput id="t-score" name="score" type="number" step="0.1" defaultValue={editing?.score ?? ""} /></Field>
                        <Field label="Max score" htmlFor="t-max"><NativeInput id="t-max" name="maxScore" type="number" step="0.1" defaultValue={editing?.maxScore ?? ""} /></Field>
                        <Field label="Curve" htmlFor="t-curve"><NativeInput id="t-curve" name="curveAdjustment" type="number" step="0.1" defaultValue={editing?.curveAdjustment ?? ""} /></Field>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setOpen(false)}>Cancel</Button>
                        <Button type="submit">{editing ? "Save" : "Add"}</Button>
                    </div>
                </form>
            </FormModal>
        </Card>
    );
}

// ── Attendance ───────────────────────────────────────────────

function AttendanceSection({ cls, absences }: { cls: ClassInfo; absences: AbsenceRow[] }) {
    const [open, setOpen] = useState(false);
    const count = absences.length;
    const atLimit = cls.absenceLimit != null && count >= cls.absenceLimit;
    const nearLimit = cls.absenceLimit != null && !atLimit && count >= cls.absenceLimit - 1;

    return (
        <Card className="flex flex-col gap-4">
            <SectionHeader
                title="Attendance"
                description={cls.absenceLimit != null ? `Limit: ${cls.absenceLimit} absences before being dropped.` : "No absence limit set."}
                action={<Button size="sm" iconLeading={Plus} onClick={() => setOpen(true)}>Log absence</Button>}
            />

            {cls.absenceLimit != null && (
                <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-1 text-tertiary">
                            {(atLimit || nearLimit) && <AlertTriangle aria-hidden="true" className={"size-4 " + (atLimit ? "text-error-primary" : "text-warning-primary")} />}
                            Absences used
                        </span>
                        <span className={atLimit ? "font-medium text-error-primary" : nearLimit ? "font-medium text-warning-primary" : "text-secondary"}>
                            {count} / {cls.absenceLimit}
                        </span>
                    </div>
                    <ProgressBar value={count} max={cls.absenceLimit} color={atLimit ? "error" : nearLimit ? "warning" : "brand"} />
                    {atLimit && <p className="text-xs text-error-primary">You're at or over the absence limit — at risk of being dropped.</p>}
                </div>
            )}

            <div className="flex flex-col gap-2">
                {absences.length === 0 && <p className="text-sm text-tertiary">No absences logged.</p>}
                {absences.map((ab) => (
                    <div key={ab.id} className="flex items-center justify-between gap-3 rounded-lg p-3 ring-1 ring-secondary ring-inset">
                        <div className="min-w-0">
                            <p className="text-sm font-medium text-primary">{formatDate(ab.date)}</p>
                            {ab.reason && <p className="text-xs text-tertiary">{ab.reason}</p>}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                            <Badge color={ab.excused ? "success" : "gray"} size="sm">{ab.excused ? "Excused" : "Unexcused"}</Badge>
                            <Button
                                size="sm"
                                color="tertiary-destructive"
                                iconLeading={Trash02}
                                aria-label="Delete"
                                onClick={() => {
                                    const fd = new FormData();
                                    fd.set("id", ab.id);
                                    fd.set("classId", cls.id);
                                    run(deleteAbsence, fd, "Deleted");
                                }}
                            />
                        </div>
                    </div>
                ))}
            </div>

            <FormModal isOpen={open} onOpenChange={setOpen} title="Log absence">
                <form
                    action={async (fd) => {
                        fd.set("classId", cls.id);
                        const ok = await run(addAbsence, fd, "Logged");
                        if (ok) setOpen(false);
                    }}
                    className="flex flex-col gap-4"
                >
                    <FormDateInput name="date" variant="date" label="Date" defaultValue={new Date().toISOString().slice(0, 10)} />
                    <Field label="Reason" htmlFor="ab-reason"><NativeInput id="ab-reason" name="reason" placeholder="Sick, travel…" /></Field>
                    <label className="flex items-center gap-2 text-sm text-secondary">
                        <input type="checkbox" name="excused" className="size-4 rounded ring-1 ring-primary" />
                        Excused
                    </label>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setOpen(false)}>Cancel</Button>
                        <Button type="submit">Log</Button>
                    </div>
                </form>
            </FormModal>
        </Card>
    );
}

// ── Settings ─────────────────────────────────────────────────

function SettingsSection({ cls }: { cls: ClassInfo }) {
    const [open, setOpen] = useState(false);

    return (
        <Card className="flex flex-col gap-4">
            <SectionHeader title="Class settings" description="Edit details, lock the final grade, or remove the class." />
            <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" color="secondary" iconLeading={Edit01} onClick={() => setOpen(true)}>Edit class</Button>
                {cls.status === "COMPLETED" ? (
                    <Button
                        size="sm"
                        color="secondary"
                        iconLeading={RefreshCcw01}
                        onClick={() => {
                            const fd = new FormData();
                            fd.set("id", cls.id);
                            run(reopenClass, fd, "Reopened");
                        }}
                    >
                        Reopen class
                    </Button>
                ) : (
                    <Button
                        size="sm"
                        color="secondary"
                        iconLeading={CheckCircle}
                        onClick={() => {
                            const fd = new FormData();
                            fd.set("id", cls.id);
                            run(completeClass, fd, "Class completed — final grade locked");
                        }}
                    >
                        Complete class
                    </Button>
                )}
                <Button
                    size="sm"
                    color="primary-destructive"
                    iconLeading={Trash02}
                    href="/learning/academic"
                    onClick={() => {
                        const fd = new FormData();
                        fd.set("id", cls.id);
                        run(deleteClass, fd, "Class deleted");
                    }}
                >
                    Delete class
                </Button>
            </div>

            <FormModal isOpen={open} onOpenChange={setOpen} title="Edit class">
                <form
                    action={async (fd) => {
                        const ok = await run(updateClass, fd, "Updated");
                        if (ok) setOpen(false);
                    }}
                    className="flex flex-col gap-4"
                >
                    <ClassFormFields editing={cls} />
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setOpen(false)}>Cancel</Button>
                        <Button type="submit" iconLeading={Save01}>Save</Button>
                    </div>
                </form>
            </FormModal>
        </Card>
    );
}
