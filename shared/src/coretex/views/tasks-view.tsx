import { useMemo, useState, type FormEvent } from "react";
import { Calendar, CheckCircle, ClipboardCheck, Plus, Trash01 } from "@untitledui/icons";
import {
    EmptyMessage,
    PersonalCard,
    PersonalModuleShell,
    PersonalTable,
    ProgressMeter,
    QueryBoundary,
    StatGrid,
    formatDate,
    localDateKey,
    titleCase,
} from "./personal/personal-ui";
import { useLifeOSMutation } from "./personal/use-lifeos-mutation";
import { useLifeOSQuery, type LifeOSClient } from "./personal/use-lifeos-query";

type TodoStatus = "PLANNED" | "IN_PROGRESS" | "DRIPPED" | "DONE" | "SKIPPED";
type TodoPriority = "NONE" | "LOW" | "MEDIUM" | "HIGH" | "URGENT";
type Todo = {
    id: string;
    title: string;
    body?: string | null;
    status: TodoStatus;
    date?: string | null;
    priority: TodoPriority;
    category?: string | null;
    durationMinutes?: number | null;
    subtasks: Array<{ id: string; title: string; done: boolean }>;
};
type Routine = { id: string; title: string; cadence: string; category?: string | null; active: boolean };
type Dashboard = {
    date: string;
    todos: Todo[];
    routines: Routine[];
    digest: { done: number; skipped: number; total: number; completionRate: number; topCategory?: string | null };
};
type Analytics = {
    range: { start: string; end: string };
    summary: { total: number; done: number; skipped: number; completionRate: number };
    byDay: Array<{ date: string; total: number; done: number; skipped: number; minutes: number }>;
    byCategory: Array<{ category: string; total: number; done: number }>;
    byPriority: Array<{ priority: string; total: number; done: number }>;
};

const tabs = [{ id: "today", label: "Today" }, { id: "analytics", label: "Analytics" }];
const today = () => localDateKey();
const statusLabel: Record<TodoStatus, string> = { PLANNED: "Planned", DRIPPED: "Planned", IN_PROGRESS: "In progress", DONE: "Completed", SKIPPED: "Skipped" };
const statusClass: Record<TodoStatus, string> = {
    PLANNED: "bg-secondary text-secondary",
    DRIPPED: "bg-secondary text-secondary",
    IN_PROGRESS: "bg-brand-primary text-brand-secondary",
    DONE: "bg-success-secondary text-success-primary",
    SKIPPED: "bg-warning-secondary text-warning-primary",
};
const moveDay = (value: string, amount: number) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + amount);
    return date.toISOString().slice(0, 10);
};

export function TasksView({ client }: { client: LifeOSClient }) {
    const [activeTab, setActiveTab] = useState("today");
    const [date, setDate] = useState(today);
    const dashboard = useLifeOSQuery<Dashboard>(client, "tasks:getDashboard", { date });
    const analytics = useLifeOSQuery<Analytics>(client, "tasks:getAnalytics");

    return (
        <PersonalModuleShell
            title="Todos"
            description="Plan the day, work through priorities, and review your completion patterns."
            icon={ClipboardCheck}
            tabs={tabs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
        >
            {activeTab === "today"
                ? <TodoDashboard client={client} query={dashboard} date={date} setDate={setDate} />
                : <TodoAnalytics query={analytics} />}
        </PersonalModuleShell>
    );
}

function TodoDashboard({
    client,
    query,
    date,
    setDate,
}: {
    client: LifeOSClient;
    query: ReturnType<typeof useLifeOSQuery<Dashboard>>;
    date: string;
    setDate: (date: string) => void;
}) {
    const [title, setTitle] = useState("");
    const [category, setCategory] = useState("");
    const [priority, setPriority] = useState<TodoPriority>("NONE");
    const [durationMinutes, setDurationMinutes] = useState("");
    const [routineTitle, setRoutineTitle] = useState("");
    const create = useLifeOSMutation(client, "tasks:createTodo");
    const update = useLifeOSMutation(client, "tasks:updateTodo");
    const remove = useLifeOSMutation(client, "tasks:deleteTodo");
    const createSubtask = useLifeOSMutation(client, "tasks:createSubtask");
    const toggleSubtask = useLifeOSMutation(client, "tasks:toggleSubtask");
    const createRoutine = useLifeOSMutation(client, "tasks:createRoutine");
    const toggleRoutine = useLifeOSMutation(client, "tasks:toggleRoutine");
    const deleteRoutine = useLifeOSMutation(client, "tasks:deleteRoutine");

    const groups = useMemo(() => {
        const todos = query.data?.todos ?? [];
        return {
            active: todos.filter((todo) => todo.status !== "DONE" && todo.status !== "SKIPPED"),
            finished: todos.filter((todo) => todo.status === "DONE" || todo.status === "SKIPPED"),
        };
    }, [query.data]);

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        if (!title.trim()) return;
        try {
            await create.mutate({
                title,
                category,
                date,
                priority,
                durationMinutes: durationMinutes ? Number(durationMinutes) : null,
            });
            setTitle("");
            setCategory("");
            setPriority("NONE");
            setDurationMinutes("");
        } catch { /* shown inline */ }
    };

    const setStatus = async (id: string, status: TodoStatus) => {
        try { await update.mutate({ id, status }); } catch { /* shown inline */ }
    };
    const deleteTodo = async (id: string) => {
        if (!window.confirm("Delete this todo?")) return;
        try { await remove.mutate({ id }); } catch { /* shown inline */ }
    };
    const addSubtask = async (todoId: string, subtaskTitle: string) => {
        try { await createSubtask.mutate({ todoId, title: subtaskTitle }); } catch { /* shown inline */ }
    };
    const flipSubtask = async (id: string) => {
        try { await toggleSubtask.mutate({ id }); } catch { /* shown inline */ }
    };
    const submitRoutine = async (event: FormEvent) => {
        event.preventDefault();
        if (!routineTitle.trim()) return;
        try { await createRoutine.mutate({ title: routineTitle }); setRoutineTitle(""); } catch { /* shown inline */ }
    };
    const flipRoutine = async (id: string) => {
        try { await toggleRoutine.mutate({ id }); } catch { /* shown inline */ }
    };
    const removeRoutine = async (id: string) => {
        if (!window.confirm("Delete this routine?")) return;
        try { await deleteRoutine.mutate({ id }); } catch { /* shown inline */ }
    };
    const mutationError = [create, update, remove, createSubtask, toggleSubtask, createRoutine, toggleRoutine, deleteRoutine]
        .find((operation) => operation.error)?.error ?? null;
    const busy = [create, update, remove, createSubtask, toggleSubtask, createRoutine, toggleRoutine, deleteRoutine].some((operation) => operation.pending);

    return (
        <QueryBoundary loading={query.loading} error={query.error} onRetry={query.refresh}>
            <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-secondary bg-primary p-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <button type="button" onClick={() => setDate(moveDay(date, -1))} className="rounded-lg border border-secondary px-3 py-2 text-sm text-secondary hover:bg-secondary" aria-label="Previous day">Previous</button>
                        <label className="flex min-w-0 max-w-full items-center gap-2 rounded-lg border border-secondary bg-primary px-3 py-2 text-sm text-secondary">
                            <Calendar className="size-4" />
                            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="min-w-0 max-w-full bg-transparent text-primary outline-none" />
                        </label>
                        <button type="button" onClick={() => setDate(moveDay(date, 1))} className="rounded-lg border border-secondary px-3 py-2 text-sm text-secondary hover:bg-secondary" aria-label="Next day">Next</button>
                    </div>
                    {date !== today() && <button type="button" onClick={() => setDate(today())} className="text-sm font-semibold text-brand-secondary">Jump to today</button>}
                </div>

                <StatGrid stats={[
                    { label: "Scheduled", value: query.data?.todos.length ?? 0, detail: formatDate(date) },
                    { label: "Completed this week", value: query.data?.digest.done ?? 0 },
                    { label: "Completion", value: `${query.data?.digest.completionRate ?? 0}%` },
                    { label: "Top category", value: query.data?.digest.topCategory ?? "—" },
                ]} />

                <PersonalCard title="Add a todo">
                    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(14rem,2fr)_minmax(9rem,1fr)_9rem_8rem_auto]">
                        <input aria-label="Todo title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What needs to get done?" maxLength={300} className="min-w-0 rounded-lg border border-secondary bg-primary px-3 py-2.5 text-sm text-primary outline-none focus:border-brand sm:col-span-2 lg:col-span-1" />
                        <input aria-label="Todo category" value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Category" maxLength={100} className="min-w-0 rounded-lg border border-secondary bg-primary px-3 py-2.5 text-sm text-primary outline-none focus:border-brand" />
                        <select aria-label="Todo priority" value={priority} onChange={(event) => setPriority(event.target.value as TodoPriority)} className="rounded-lg border border-secondary bg-primary px-3 py-2.5 text-sm text-primary outline-none focus:border-brand">
                            <option value="NONE">No priority</option><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option><option value="URGENT">Urgent</option>
                        </select>
                        <input aria-label="Estimated minutes" type="number" min="1" max="10080" step="1" value={durationMinutes} onChange={(event) => setDurationMinutes(event.target.value)} placeholder="Minutes" className="rounded-lg border border-secondary bg-primary px-3 py-2.5 text-sm text-primary outline-none focus:border-brand" />
                        <button disabled={create.pending || !title.trim()} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-solid px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"><Plus className="size-4" /> Add</button>
                    </form>
                    {mutationError && <p className="mt-2 text-sm text-error-primary">{mutationError}</p>}
                </PersonalCard>

                <PersonalCard title="Plan">
                    {groups.active.length === 0 ? <EmptyMessage>No active todos for this day.</EmptyMessage> : (
                        <div className="space-y-2">
                            {groups.active.map((todo) => (
                                <TodoRow key={todo.id} todo={todo} busy={busy} onStatus={setStatus} onDelete={deleteTodo} onAddSubtask={addSubtask} onToggleSubtask={flipSubtask} />
                            ))}
                        </div>
                    )}
                </PersonalCard>

                {groups.finished.length > 0 && (
                    <PersonalCard title="Finished">
                        <div className="space-y-2">
                            {groups.finished.map((todo) => <TodoRow key={todo.id} todo={todo} busy={busy} onStatus={setStatus} onDelete={deleteTodo} onAddSubtask={addSubtask} onToggleSubtask={flipSubtask} />)}
                        </div>
                    </PersonalCard>
                )}

                <PersonalCard title="Routines">
                    <form onSubmit={submitRoutine} className="mb-4 flex gap-2">
                        <input aria-label="Routine title" value={routineTitle} onChange={(event) => setRoutineTitle(event.target.value)} placeholder="Add a daily routine" className="min-w-0 flex-1 rounded-lg border border-secondary bg-primary px-3 py-2 text-sm text-primary outline-none focus:border-brand" />
                        <button disabled={createRoutine.pending || !routineTitle.trim()} className="inline-flex items-center gap-2 rounded-lg bg-brand-solid px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><Plus className="size-4" /> Add</button>
                    </form>
                    <PersonalTable
                        rows={query.data?.routines ?? []}
                        empty="No recurring routines yet."
                        columns={[
                            { key: "title", label: "Routine", render: (row) => <span className="font-medium text-primary">{row.title}</span> },
                            { key: "cadence", label: "Cadence", render: (row) => titleCase(row.cadence) },
                            { key: "category", label: "Category", render: (row) => row.category ?? "—" },
                            { key: "status", label: "Status", render: (row) => <button type="button" disabled={busy} onClick={() => flipRoutine(row.id)} className="rounded-md border border-secondary px-2 py-1 text-xs font-semibold text-secondary">{row.active ? "Active" : "Paused"}</button> },
                            { key: "actions", label: "", align: "right", render: (row) => <button type="button" disabled={busy} onClick={() => removeRoutine(row.id)} aria-label={`Delete ${row.title}`} className="p-1.5 text-quaternary hover:text-error-primary"><Trash01 className="size-4" /></button> },
                        ]}
                    />
                </PersonalCard>
            </div>
        </QueryBoundary>
    );
}

function TodoRow({ todo, busy, onStatus, onDelete, onAddSubtask, onToggleSubtask }: { todo: Todo; busy: boolean; onStatus: (id: string, status: TodoStatus) => void; onDelete: (id: string) => void; onAddSubtask: (todoId: string, title: string) => Promise<void>; onToggleSubtask: (id: string) => Promise<void> }) {
    const done = todo.status === "DONE";
    const finished = done || todo.status === "SKIPPED";
    const [subtaskTitle, setSubtaskTitle] = useState("");
    const submitSubtask = async (event: FormEvent) => {
        event.preventDefault();
        if (!subtaskTitle.trim()) return;
        await onAddSubtask(todo.id, subtaskTitle);
        setSubtaskTitle("");
    };
    return (
        <article className="flex flex-col gap-3 rounded-lg border border-secondary p-3 sm:flex-row sm:items-center">
            <button type="button" disabled={busy} onClick={() => onStatus(todo.id, finished ? "PLANNED" : "DONE")} aria-label={finished ? `Reopen ${todo.title}` : `Complete ${todo.title}`} className="self-start rounded-full text-quaternary hover:text-brand-secondary">
                <CheckCircle className={`size-5 ${done ? "text-success-primary" : ""}`} />
            </button>
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <p className={`min-w-0 break-words font-medium text-primary ${finished ? "line-through opacity-60" : ""}`}>{todo.title}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusClass[todo.status]}`}>{statusLabel[todo.status]}</span>
                </div>
                <p className="mt-0.5 text-xs text-tertiary">{[todo.category, todo.priority !== "NONE" ? `${titleCase(todo.priority)} priority` : null, todo.durationMinutes ? `${todo.durationMinutes} min` : null].filter(Boolean).join(" · ") || "No extra details"}</p>
                {todo.body && <p className="mt-1 line-clamp-2 text-xs text-secondary">{todo.body}</p>}
                {todo.subtasks.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">{todo.subtasks.map((item) => (
                        <button key={item.id} type="button" disabled={busy} onClick={() => onToggleSubtask(item.id)} className={`rounded-md border border-secondary px-2 py-1 text-xs ${item.done ? "text-quaternary line-through" : "text-secondary"}`}>{item.done ? "✓ " : ""}{item.title}</button>
                    ))}</div>
                )}
                {!finished && (
                    <form onSubmit={submitSubtask} className="mt-2 flex max-w-md gap-1.5">
                        <input aria-label={`Add subtask to ${todo.title}`} value={subtaskTitle} onChange={(event) => setSubtaskTitle(event.target.value)} placeholder="Add subtask" className="min-w-0 flex-1 rounded-md border border-secondary bg-primary px-2 py-1 text-xs text-primary outline-none focus:border-brand" />
                        <button disabled={busy || !subtaskTitle.trim()} className="rounded-md border border-secondary px-2 py-1 text-xs font-semibold text-secondary disabled:opacity-50">Add</button>
                    </form>
                )}
            </div>
            {!finished && todo.status !== "IN_PROGRESS" && <button type="button" disabled={busy} onClick={() => onStatus(todo.id, "IN_PROGRESS")} className="rounded-lg border border-secondary px-2.5 py-1.5 text-xs font-semibold text-secondary hover:bg-secondary">Start</button>}
            {!finished && <button type="button" disabled={busy} onClick={() => onStatus(todo.id, "SKIPPED")} className="rounded-lg border border-secondary px-2.5 py-1.5 text-xs font-semibold text-tertiary hover:bg-secondary">Skip</button>}
            <button type="button" disabled={busy} onClick={() => onDelete(todo.id)} aria-label={`Delete ${todo.title}`} className="rounded-lg p-2 text-quaternary hover:bg-error-primary hover:text-error-primary"><Trash01 className="size-4" /></button>
        </article>
    );
}

function TodoAnalytics({ query }: { query: ReturnType<typeof useLifeOSQuery<Analytics>> }) {
    return (
        <QueryBoundary loading={query.loading} error={query.error} onRetry={query.refresh}>
            <div className="space-y-4">
                <StatGrid stats={[
                    { label: "Todos", value: query.data?.summary.total ?? 0, detail: "Last 30 days" },
                    { label: "Completed", value: query.data?.summary.done ?? 0 },
                    { label: "Skipped", value: query.data?.summary.skipped ?? 0 },
                    { label: "Completion", value: `${query.data?.summary.completionRate ?? 0}%` },
                ]} />
                <PersonalCard title="Completion by category">
                    {(query.data?.byCategory.length ?? 0) === 0 ? <EmptyMessage>No completed history yet.</EmptyMessage> : (
                        <div className="space-y-4">{query.data?.byCategory.map((row) => <div key={row.category}><ProgressMeter value={row.done} max={row.total} label={`${row.category} · ${row.done}/${row.total}`} /></div>)}</div>
                    )}
                </PersonalCard>
                <PersonalCard title="Daily activity">
                    <PersonalTable
                        rows={(query.data?.byDay ?? []).map((row) => ({ ...row, id: row.date }))}
                        empty="No activity in this period."
                        columns={[
                            { key: "date", label: "Date", render: (row) => formatDate(row.date) },
                            { key: "total", label: "Planned", render: (row) => row.total, align: "right" },
                            { key: "done", label: "Done", render: (row) => row.done, align: "right" },
                            { key: "minutes", label: "Est. minutes", render: (row) => row.minutes, align: "right" },
                        ]}
                    />
                </PersonalCard>
            </div>
        </QueryBoundary>
    );
}
