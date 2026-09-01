import { EventEmitter } from "eventemitter3";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Task, TaskStatus, TaskPriority, CreateTaskInput } from "../types.js";

const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
};

function generateId(): string {
    const rand: string = Math.random().toString(36).slice(2, 10);
    return `task_${Date.now()}_${rand}`;
}

export class TaskQueue extends EventEmitter {
    private tasks = new Map<string, Task>();
    private readonly file: string | null;
    private saveTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(dataDir?: string) {
        super();
        this.file = dataDir ? path.join(dataDir, "tasks.json") : null;
    }

    /** Load persisted tasks from disk (call once at startup). */
    public async load(): Promise<void> {
        if (!this.file) return;
        try {
            const raw = JSON.parse(await readFile(this.file, "utf8")) as { tasks?: Task[] };
            if (Array.isArray(raw.tasks)) {
                this.tasks.clear();
                for (const t of raw.tasks) this.tasks.set(t.id, t);
            }
        } catch {
            /* no file yet — start empty */
        }
    }

    /** Debounced write of the full task set to disk. */
    private _persist(): void {
        if (!this.file) return;
        if (this.saveTimer) clearTimeout(this.saveTimer);
        const file = this.file;
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            const payload = JSON.stringify({ tasks: this.all() });
            void mkdir(path.dirname(file), { recursive: true })
                .then(() => writeFile(file, payload, "utf8"))
                .catch((err: unknown) => this.emit("persist:error", err));
        }, 250);
    }

    public create(input: CreateTaskInput): Task {
        const now: string = new Date().toISOString();
        const task: Task = {
            id: generateId(),
            title: input.title,
            description: input.description,
            priority: input.priority ?? "medium",
            status: "pending",
            dependencies: input.dependencies ?? [],
            tags: input.tags ?? [],
            retryCount: 0,
            maxRetries: input.maxRetries ?? 2,
            createdAt: now,
            updatedAt: now,
        };
        if (input.requiredRole !== undefined) {
            task.requiredRole = input.requiredRole;
        }
        if (input.projectId !== undefined) {
            task.projectId = input.projectId;
        }
        if (input.estimatedTokens !== undefined) {
            task.estimatedTokens = input.estimatedTokens;
        }
        if (input.assignedAgentIds !== undefined && input.assignedAgentIds.length > 0) {
            task.assignedAgentIds = input.assignedAgentIds;
        }
        if (input.planningEffort !== undefined) {
            task.planningEffort = input.planningEffort;
        }
        if (input.useProjectContext !== undefined) {
            task.useProjectContext = input.useProjectContext;
        }
        if (input.useDocuments !== undefined) {
            task.useDocuments = input.useDocuments;
        }
        if (input.executionMode !== undefined) {
            task.executionMode = input.executionMode;
        }
        if (input.maxAgents !== undefined && input.maxAgents > 1) {
            task.maxAgents = input.maxAgents;
        }
        this.tasks.set(task.id, task);
        this.emit("task:created", task);
        this._persist();
        return task;
    }

    /** Apply an in-place refinement patch (context, agents, priority, effort, …). */
    public refine(id: string, patch: import("../types.js").RefineTaskPatch): Task | undefined {
        const clean: Partial<Task> = {};
        if (patch.title !== undefined) clean.title = patch.title;
        if (patch.description !== undefined) clean.description = patch.description;
        if (patch.priority !== undefined) clean.priority = patch.priority;
        if (patch.requiredRole !== undefined) clean.requiredRole = patch.requiredRole;
        if (patch.projectId !== undefined) clean.projectId = patch.projectId;
        if (patch.tags !== undefined) clean.tags = patch.tags;
        if (patch.assignedAgentIds !== undefined) clean.assignedAgentIds = patch.assignedAgentIds;
        if (patch.planningEffort !== undefined) clean.planningEffort = patch.planningEffort;
        return this._update(id, clean);
    }

    public get(id: string): Task | undefined {
        return this.tasks.get(id);
    }

    public all(): Task[] {
        return Array.from(this.tasks.values());
    }

    public byStatus(s: TaskStatus): Task[] {
        return this.all().filter((task: Task): boolean => task.status === s);
    }

    public byProject(pid: string): Task[] {
        return this.all().filter((task: Task): boolean => task.projectId === pid);
    }

    public nextPending(predicate?: (task: Task) => boolean): Task | undefined {
        const ready: Task[] = this.all().filter((task: Task): boolean => {
            if (task.status !== "pending") {
                return false;
            }
            if (task.retryCount > 0 && task.error) {
                const retryDelayMs = Math.min(30_000, 2_000 * 2 ** (task.retryCount - 1));
                const updatedAt = Date.parse(task.updatedAt);
                if (Number.isFinite(updatedAt) && Date.now() - updatedAt < retryDelayMs) return false;
            }
            const dependenciesReady = task.dependencies.every((depId: string): boolean => {
                const dep: Task | undefined = this.tasks.get(depId);
                return dep !== undefined && dep.status === "completed";
            });
            return dependenciesReady && (predicate?.(task) ?? true);
        });
        ready.sort((a: Task, b: Task): number => {
            const weightDiff: number = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
            if (weightDiff !== 0) {
                return weightDiff;
            }
            return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
        });
        return ready[0];
    }

    public assign(taskId: string, agentId: string): Task | undefined {
        return this._update(taskId, { status: "assigned", assignedAgentId: agentId });
    }

    public markInProgress(taskId: string): Task | undefined {
        return this._update(taskId, { status: "in_progress" });
    }

    public complete(taskId: string, result: string): Task | undefined {
        const task: Task | undefined = this._update(taskId, {
            status: "completed",
            result,
            completedAt: new Date().toISOString(),
        });
        if (task !== undefined) {
            this.emit("task:completed", task);
        }
        return task;
    }

    public fail(taskId: string, error: string, retryable: boolean = true): Task | undefined {
        const existing: Task | undefined = this.tasks.get(taskId);
        if (existing === undefined) {
            return undefined;
        }
        if (retryable && existing.retryCount < existing.maxRetries) {
            return this._update(taskId, {
                status: "pending",
                assignedAgentId: undefined,
                retryCount: existing.retryCount + 1,
                error,
            });
        }
        const task: Task | undefined = this._update(taskId, { status: "failed", error });
        if (task !== undefined) {
            this.emit("task:failed", task);
        }
        return task;
    }

    /** Return interrupted work to the queue without consuming a retry. */
    public requeue(taskId: string, reason?: string): Task | undefined {
        const existing: Task | undefined = this.tasks.get(taskId);
        if (existing === undefined || existing.status === "completed" || existing.status === "cancelled") return existing;
        if (existing.status === "pending" && existing.assignedAgentId === undefined && (reason === undefined || existing.error === reason)) return existing;
        return this._update(taskId, {
            status: "pending",
            assignedAgentId: undefined,
            ...(reason !== undefined ? { error: reason } : {}),
        });
    }

    public cancel(taskId: string): Task | undefined {
        const task: Task | undefined = this._update(taskId, { status: "cancelled" });
        if (task !== undefined) {
            this.emit("task:cancelled", task);
        }
        return task;
    }

    public reprioritize(taskId: string, priority: TaskPriority): Task | undefined {
        return this._update(taskId, { priority });
    }

    /** Permanently remove a task from the queue. Returns the removed task, if any. */
    public delete(taskId: string): Task | undefined {
        const task: Task | undefined = this.tasks.get(taskId);
        if (task === undefined) {
            return undefined;
        }
        this.tasks.delete(taskId);
        this.emit("task:deleted", task);
        this._persist();
        return task;
    }

    public cancelByProject(pid: string): void {
        const terminal: TaskStatus[] = ["completed", "failed", "cancelled"];
        for (const task of this.byProject(pid)) {
            if (!terminal.includes(task.status)) {
                this.cancel(task.id);
            }
        }
    }

    public purgeCompleted(olderThanMs?: number): void {
        const cutoff: number | undefined =
            olderThanMs !== undefined ? Date.now() - olderThanMs : undefined;
        for (const task of this.all()) {
            if (task.status !== "completed") {
                continue;
            }
            if (cutoff === undefined) {
                this.tasks.delete(task.id);
                continue;
            }
            const reference: string = task.completedAt ?? task.updatedAt;
            if (new Date(reference).getTime() <= cutoff) {
                this.tasks.delete(task.id);
            }
        }
        this._persist();
    }

    public stats(): Record<TaskStatus, number> {
        const counts: Record<TaskStatus, number> = {
            pending: 0,
            assigned: 0,
            in_progress: 0,
            completed: 0,
            failed: 0,
            cancelled: 0,
        };
        for (const task of this.all()) {
            counts[task.status] += 1;
        }
        return counts;
    }

    private _update(id: string, patch: Partial<Task>): Task | undefined {
        const task: Task | undefined = this.tasks.get(id);
        if (task === undefined) {
            return undefined;
        }
        Object.assign(task, patch);
        task.updatedAt = new Date().toISOString();
        this.emit("task:updated", task);
        this._persist();
        return task;
    }
}
