import { EventEmitter } from "eventemitter3";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Project, ProjectStatus, Task, CreateProjectInput } from "../types.js";

const DEFAULT_AUTOMATION = {
    unattended: true,
    documentationAgent: true,
    dualReview: true,
    initializeBranchTaxonomy: true,
    autoCreatePullRequest: false,
    autoMergePullRequest: false,
    targetBranch: "main",
} as const;

function generateProjectId(): string {
    const millis: number = Date.now();
    const rand: string = Math.random().toString(36).slice(2, 10);
    return `proj_${millis}_${rand}`;
}

export class ProjectManager extends EventEmitter {
    private projects = new Map<string, Project>();
    private readonly file: string | null;
    private saveTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(dataDir?: string) {
        super();
        this.file = dataDir ? path.join(dataDir, "projects.json") : null;
    }

    /** Load persisted projects from disk (call once at startup). */
    async load(): Promise<void> {
        if (!this.file) return;
        try {
            const raw = JSON.parse(await readFile(this.file, "utf8")) as Project[];
            if (Array.isArray(raw)) for (const p of raw) if (p && p.id) this.projects.set(p.id, p);
        } catch {
            /* no file yet / unreadable — start empty */
        }
    }

    /** Debounced persist of all projects to disk. */
    private _persist(): void {
        if (!this.file) return;
        if (this.saveTimer) clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => {
            const file = this.file;
            if (!file) return;
            void mkdir(path.dirname(file), { recursive: true })
                .then(() => writeFile(file, JSON.stringify(this.all()), "utf8"))
                .catch(() => undefined);
        }, 300);
    }

    create(input: CreateProjectInput): Project {
        const millis = Date.now();
        const now: string = new Date().toISOString();
        const project: Project = {
            id: generateProjectId(),
            name: input.name,
            description: input.description ?? "",
            status: "active",
            taskIds: [],
            tags: input.tags ?? [],
            metadata: input.metadata ?? {},
            sourcePath: input.sourcePath,
            repos: input.repos ?? (input.sourcePath ? [{
                id: `repo_${millis.toString(36)}`,
                name: input.name,
                path: ".",
                visibility: "private",
                includeInIndex: true,
                isPrimary: true,
                createdAt: millis,
            }] : []),
            executionTarget: input.executionTarget ?? "hybrid",
            automation: { ...DEFAULT_AUTOMATION, ...(input.automation ?? {}) },
            createdAt: now,
            updatedAt: now
        };
        this.projects.set(project.id, project);
        this.emit("project:created", project);
        this._persist();
        return project;
    }

    /** Permanently delete a project; emits project:deleted + persists. */
    remove(id: string): boolean {
        if (!this.projects.delete(id)) return false;
        this.emit("project:deleted", id);
        this._persist();
        return true;
    }

    get(id: string): Project | undefined {
        return this.projects.get(id);
    }

    all(): Project[] {
        return Array.from(this.projects.values());
    }

    active(): Project[] {
        return this.all().filter((project) => project.status === "active");
    }

    update(id: string, patch: Partial<Project>): Project | undefined {
        const existing: Project | undefined = this.projects.get(id);
        if (!existing) {
            return undefined;
        }
        const updated: Project = {
            ...existing,
            ...patch,
            id: existing.id,
            createdAt: existing.createdAt,
            updatedAt: new Date().toISOString()
        };
        this.projects.set(updated.id, updated);
        this.emit("project:updated", updated);
        this._persist();
        return updated;
    }

    setStatus(id: string, status: ProjectStatus): Project | undefined {
        return this.update(id, { status });
    }

    addTask(projectId: string, taskId: string): void {
        const project: Project | undefined = this.projects.get(projectId);
        if (!project) {
            return;
        }
        if (project.taskIds.includes(taskId)) {
            return;
        }
        const updated: Project = {
            ...project,
            taskIds: [...project.taskIds, taskId],
            updatedAt: new Date().toISOString()
        };
        this.projects.set(updated.id, updated);
        this.emit("project:updated", updated);
        this._persist();
    }

    removeTask(projectId: string, taskId: string): void {
        const project: Project | undefined = this.projects.get(projectId);
        if (!project) {
            return;
        }
        if (!project.taskIds.includes(taskId)) {
            return;
        }
        const updated: Project = {
            ...project,
            taskIds: project.taskIds.filter((id) => id !== taskId),
            updatedAt: new Date().toISOString()
        };
        this.projects.set(updated.id, updated);
        this.emit("project:updated", updated);
        this._persist();
    }

    syncStatus(projectId: string, tasks: Task[]): void {
        const project: Project | undefined = this.projects.get(projectId);
        if (!project) {
            return;
        }
        if (project.status !== "active") {
            return;
        }
        const ownTasks: Task[] = tasks.filter((task) => project.taskIds.includes(task.id));
        if (ownTasks.length === 0) {
            return;
        }
        const allDone: boolean = ownTasks.every(
            (task) => task.status === "completed" || task.status === "cancelled"
        );
        if (allDone) {
            this.setStatus(projectId, "completed");
        }
    }

    snapshot(): Project[] {
        return this.all();
    }
}
