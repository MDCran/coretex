"use client";

import { useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Clock, Edit01, Plus, Trash02, Zap } from "@untitledui/icons";
import { toast } from "sonner";
import { Button } from "@/components/base/buttons/button";
import { Card, EmptyState, Field, NativeInput, NativeSelect, NativeTextarea, SectionHeader, Stat } from "../_components/learning-ui";
import { FormModal } from "../_components/form-modal";
import { FormDateInput } from "@/components/base/input/form-date-input";
import { formatDate } from "@/lib/dates";
import { TrendChart, type TrendPoint } from "../_components/trend-chart";
import { createSession, deleteSession, updateSession } from "@/lib/actions/learning";

export interface SessionRow {
    id: string;
    sessionDate: string;
    durationMinutes: number | null;
    notes: string | null;
    subject: string | null;
    energy: number | null;
    pomodoro: boolean;
}

const DONUT_COLORS = [
    "var(--color-brand-500)",
    "var(--color-utility-blue-500)",
    "var(--color-utility-pink-500)",
    "var(--color-utility-success-500)",
    "var(--color-utility-warning-500)",
    "var(--color-utility-gray-400)",
];

async function run(action: (fd: FormData) => Promise<void>, fd: FormData, ok = "Saved") {
    try {
        await action(fd);
        toast.success(ok);
        return true;
    } catch (e) {
        toast.error(e instanceof Error ? e.message : "Something went wrong");
        return false;
    }
}

function startOfWeek(d: Date) {
    const r = new Date(d);
    const day = (r.getDay() + 6) % 7;
    r.setDate(r.getDate() - day);
    r.setHours(0, 0, 0, 0);
    return r;
}

function ymd(d: Date) {
    return d.toISOString().slice(0, 10);
}

/** GitHub-style contribution heatmap of study minutes over the last 16 weeks. */
function StudyHeatmap({ sessions }: { sessions: SessionRow[] }) {
    const WEEKS = 16;
    const byDay = useMemo(() => {
        const map = new Map<string, number>();
        for (const s of sessions) {
            const key = s.sessionDate.slice(0, 10);
            map.set(key, (map.get(key) ?? 0) + (s.durationMinutes ?? 0));
        }
        return map;
    }, [sessions]);

    const columns = useMemo(() => {
        const start = startOfWeek(new Date());
        start.setDate(start.getDate() - (WEEKS - 1) * 7);
        const cols: { date: Date; minutes: number }[][] = [];
        for (let w = 0; w < WEEKS; w++) {
            const col: { date: Date; minutes: number }[] = [];
            for (let d = 0; d < 7; d++) {
                const date = new Date(start);
                date.setDate(start.getDate() + w * 7 + d);
                col.push({ date, minutes: byDay.get(ymd(date)) ?? 0 });
            }
            cols.push(col);
        }
        return cols;
    }, [byDay]);

    const opacityFor = (m: number) => (m === 0 ? 0 : m < 30 ? 0.25 : m < 60 ? 0.5 : m < 120 ? 0.75 : 1);

    return (
        <div className="flex gap-[3px] overflow-x-auto pb-1">
            {columns.map((col, i) => (
                <div key={i} className="flex flex-col gap-[3px]">
                    {col.map((cell) => {
                        const today = ymd(cell.date) === ymd(new Date());
                        const op = opacityFor(cell.minutes);
                        return (
                            <div
                                key={ymd(cell.date)}
                                title={`${formatDate(cell.date.toISOString())}: ${cell.minutes}m`}
                                className={`size-3 rounded-[3px] ${op === 0 ? "bg-quaternary" : "bg-brand-solid"} ${today ? "ring-1 ring-brand" : ""}`}
                                style={op === 0 ? undefined : { opacity: op }}
                            />
                        );
                    })}
                </div>
            ))}
        </div>
    );
}

/** Donut of study-time distribution by subject this month. */
function SubjectDonut({ sessions }: { sessions: SessionRow[] }) {
    const data = useMemo(() => {
        const monthStart = ymd(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
        const totals = new Map<string, number>();
        for (const s of sessions) {
            if (s.sessionDate.slice(0, 10) < monthStart) continue;
            const key = s.subject?.trim() || "Unlabeled";
            totals.set(key, (totals.get(key) ?? 0) + (s.durationMinutes ?? 0));
        }
        const sorted = [...totals.entries()].map(([name, minutes]) => ({ name, minutes })).filter((e) => e.minutes > 0).sort((a, b) => b.minutes - a.minutes);
        if (sorted.length <= 6) return sorted;
        const top = sorted.slice(0, 5);
        const other = sorted.slice(5).reduce((s, e) => s + e.minutes, 0);
        return [...top, { name: "Other", minutes: other }];
    }, [sessions]);

    if (!data.length) {
        return <p className="py-8 text-center text-sm text-tertiary">No subject-tagged sessions this month yet.</p>;
    }

    return (
        <div className="flex flex-col items-center gap-4 sm:flex-row">
            <div className="h-[180px] w-full max-w-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie data={data} dataKey="minutes" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2} stroke="none">
                            {data.map((_, i) => (
                                <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                            ))}
                        </Pie>
                        <Tooltip
                            formatter={(value) => {
                                const v = Number(value);
                                return `${Math.floor(v / 60)}h ${v % 60}m`;
                            }}
                            contentStyle={{ background: "var(--color-bg-primary)", border: "1px solid var(--color-border-secondary)", borderRadius: 8, fontSize: 12 }}
                        />
                    </PieChart>
                </ResponsiveContainer>
            </div>
            <div className="flex flex-1 flex-col gap-2">
                {data.map((d, i) => (
                    <div key={d.name} className="flex items-center justify-between gap-3 text-sm">
                        <span className="flex items-center gap-2 text-secondary">
                            <span className="size-2.5 rounded-full" style={{ backgroundColor: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                            {d.name}
                        </span>
                        <span className="tabular-nums text-tertiary">{`${Math.floor(d.minutes / 60)}h ${d.minutes % 60}m`}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

export function SessionsClient({ sessions }: { sessions: SessionRow[] }) {
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<SessionRow | null>(null);

    function openNew() {
        setEditing(null);
        setOpen(true);
    }
    function openEdit(s: SessionRow) {
        setEditing(s);
        setOpen(true);
    }

    const weekly: TrendPoint[] = useMemo(() => {
        const days: TrendPoint[] = [];
        const today = new Date();
        for (let i = 6; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            const key = d.toISOString().slice(0, 10);
            const minutes = sessions.filter((s) => s.sessionDate.slice(0, 10) === key).reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0);
            days.push({ label: d.toLocaleDateString(undefined, { weekday: "short" }), minutes });
        }
        return days;
    }, [sessions]);

    const weekStart = startOfWeek(new Date()).toISOString().slice(0, 10);
    const weekMinutes = sessions.filter((s) => s.sessionDate.slice(0, 10) >= weekStart).reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0);
    const totalMinutes = sessions.reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0);
    const pomodoros = sessions.filter((s) => s.pomodoro).length;

    return (
        <div className="flex flex-col gap-6">
            <SectionHeader title="Study sessions" description="Log your study time and watch consistency turn into real progress." action={<Button size="md" iconLeading={Plus} onClick={openNew}>Log session</Button>} />

            {sessions.length === 0 ? (
                <Card>
                    <EmptyState
                        icon={Clock}
                        title="Track your study time"
                        description="Log your first session to start building a streak and see exactly where your hours go."
                        action={<Button size="md" iconLeading={Plus} onClick={openNew}>Log your first session</Button>}
                    />
                </Card>
            ) : (
                <>
                    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                        <Stat label="This week" value={`${Math.floor(weekMinutes / 60)}h ${weekMinutes % 60}m`} />
                        <Stat label="All time" value={`${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`} sub={`${sessions.length} sessions`} />
                        <Stat label="Avg / session" value={sessions.length ? `${Math.round(totalMinutes / sessions.length)}m` : "—"} />
                        <Stat label="Pomodoros" value={pomodoros} />
                    </div>

                    <Card>
                        <h3 className="mb-4 text-md font-semibold text-primary">Study heatmap</h3>
                        <StudyHeatmap sessions={sessions} />
                        <p className="mt-3 text-xs text-tertiary">Last 16 weeks — darker squares are heavier study days.</p>
                    </Card>

                    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                        <Card>
                            <h3 className="mb-4 text-md font-semibold text-primary">Last 7 days (minutes)</h3>
                            <TrendChart data={weekly} series={[{ key: "minutes", name: "Minutes" }]} type="bar" height={200} emptyLabel="No sessions yet" />
                        </Card>
                        <Card>
                            <h3 className="mb-4 text-md font-semibold text-primary">Subject distribution (this month)</h3>
                            <SubjectDonut sessions={sessions} />
                        </Card>
                    </div>

                    <Card className="overflow-x-auto p-0">
                        <table className="w-full min-w-[640px] text-sm">
                            <thead>
                                <tr className="border-b border-secondary text-left text-tertiary">
                                    <th className="px-5 py-3 font-medium">Date</th>
                                    <th className="px-5 py-3 font-medium">Subject</th>
                                    <th className="px-5 py-3 font-medium">Duration</th>
                                    <th className="px-5 py-3 font-medium">Energy</th>
                                    <th className="px-5 py-3 font-medium">Notes</th>
                                    <th className="px-5 py-3" />
                                </tr>
                            </thead>
                            <tbody>
                                {sessions.map((s) => (
                                    <tr key={s.id} className="border-b border-secondary transition duration-100 ease-linear last:border-0 hover:bg-secondary_hover">
                                        <td className="px-5 py-3 text-secondary">{formatDate(s.sessionDate)}</td>
                                        <td className="px-5 py-3 text-tertiary">
                                            <span className="flex items-center gap-1.5">
                                                {s.pomodoro && <Zap className="size-3.5 text-fg-warning-primary" aria-label="Pomodoro" />}
                                                {s.subject ?? "—"}
                                            </span>
                                        </td>
                                        <td className="px-5 py-3 text-tertiary">{s.durationMinutes != null ? `${s.durationMinutes}m` : "—"}</td>
                                        <td className="px-5 py-3 text-tertiary">{s.energy != null ? "⚡".repeat(Math.max(1, Math.min(5, s.energy))) : "—"}</td>
                                        <td className="max-w-[240px] truncate px-5 py-3 text-tertiary">{s.notes}</td>
                                        <td className="px-5 py-3 text-right">
                                            <div className="flex items-center justify-end gap-1">
                                                <Button size="sm" color="tertiary" iconLeading={Edit01} aria-label="Edit" onClick={() => openEdit(s)} />
                                                <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} aria-label="Delete" onClick={() => { const fd = new FormData(); fd.set("id", s.id); run(deleteSession, fd, "Deleted"); }} />
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </Card>
                </>
            )}

            <FormModal isOpen={open} onOpenChange={setOpen} title={editing ? "Edit study session" : "Log study session"}>
                <form
                    key={editing?.id ?? "new"}
                    action={async (fd) => {
                        const ok = await run(editing ? updateSession : createSession, fd, editing ? "Updated" : "Logged");
                        if (ok) setOpen(false);
                    }}
                    className="flex flex-col gap-4"
                >
                    {editing && <input type="hidden" name="id" value={editing.id} />}
                    <div className="grid grid-cols-2 gap-4">
                        <FormDateInput name="sessionDate" label="Date" isRequired defaultValue={editing ? editing.sessionDate.slice(0, 10) : new Date().toISOString().slice(0, 10)} />
                        <Field label="Minutes" htmlFor="durationMinutes" required><NativeInput id="durationMinutes" name="durationMinutes" type="number" min={1} defaultValue={editing?.durationMinutes ?? undefined} required /></Field>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Subject" htmlFor="subject" hint="e.g. a class or course name"><NativeInput id="subject" name="subject" defaultValue={editing?.subject ?? ""} placeholder="Calculus II" /></Field>
                        <Field label="Energy" htmlFor="energy">
                            <NativeSelect id="energy" name="energy" defaultValue={editing?.energy?.toString() ?? ""}>
                                <option value="">—</option>
                                <option value="1">⚡ Drained</option>
                                <option value="2">⚡⚡ Low</option>
                                <option value="3">⚡⚡⚡ OK</option>
                                <option value="4">⚡⚡⚡⚡ Good</option>
                                <option value="5">⚡⚡⚡⚡⚡ Peak</option>
                            </NativeSelect>
                        </Field>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-secondary">
                        <input type="checkbox" name="pomodoro" value="true" defaultChecked={editing?.pomodoro} className="size-4 rounded border-primary text-brand-solid" />
                        Logged via a Pomodoro timer
                    </label>
                    <Field label="Notes" htmlFor="notes"><NativeTextarea id="notes" name="notes" defaultValue={editing?.notes ?? ""} /></Field>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setOpen(false)}>Cancel</Button>
                        <Button type="submit">{editing ? "Save" : "Log"}</Button>
                    </div>
                </form>
            </FormModal>
        </div>
    );
}
