// @ts-nocheck
"use client";

// Coretex Relay — Projects list view.
// Browse all projects, spin up a new one inline, and drill into a project.

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
    Columns01,
    Dataflow03,
    Edit05,
    Eye,
    File05,
    Folder,
    Grid01,
    MessageChatCircle,
    Plus,
    RefreshCcw01,
    Settings01,
    Trash01,
    Users01,
} from "@untitledui/icons";
import type { Project, ProjectRepo, ProjectStatus, UploadedDoc } from "@repo/coretex/types";




import type { CoretexActions, CoretexState } from "../use-coretex";
import type { NavTarget, ProjectTab } from "../nav";
import { statusLabel } from "../labels";
import { FileDrop } from "../ui/file-drop";
import { FolderPicker } from "../files/folder-picker";
import { ProjectIcon } from "../ui/project-icon";
import { useContextMenu, type MenuItem } from "../ui/context-menu";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { EmptyState } from "@/components/application/empty-state/empty-state";
import { CanvasActionDock, type CanvasDockViewMode } from "./canvas-action-dock";

const SURFACE: React.CSSProperties = {
    background: "var(--surface)",
    border: "1px solid var(--c-border)",
};

// Sharp, square-edged status chip (dot + label) replacing the old rounded pill.
const STATUS_DOT: Record<ProjectStatus, string> = {
    active: "var(--c-success, #22c55e)",
    paused: "#f59e0b",
    completed: "var(--brand)",
    archived: "var(--c-text-muted)",
};

const SquareStatusBadge = ({ status }: { status: ProjectStatus }) => (
    <span
        className="inline-flex shrink-0 items-center gap-1.5 rounded-[3px] px-2 py-0.5 text-[11px] font-medium text-secondary"
        style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}
    >
        <span className="size-1.5 rounded-[1px]" style={{ background: STATUS_DOT[status] }} aria-hidden="true" />
        {statusLabel(status)}
    </span>
);

type ProjectsViewMode = "grid" | "graph";
type ProjectGraphPoint = { x: number; y: number };
type ProjectGraphPositions = Record<string, ProjectGraphPoint>;

const PROJECTS_VIEW_KEY = "coretex:projects:view:v1";
const PROJECTS_GRAPH_KEY = "coretex:projects:graph:v1";
const GRAPH_WIDTH = 1160;
const GRAPH_CARD_WIDTH = 280;
const GRAPH_CARD_HEIGHT = 136;
const GRAPH_HUB = { x: 500, y: 36, width: 160, height: 72 };

const PROJECT_VIEW_MODES: readonly CanvasDockViewMode<ProjectsViewMode>[] = [
    { id: "grid", label: "Grid", icon: Grid01, description: "Browse project cards" },
    { id: "graph", label: "Graph", icon: Dataflow03, description: "Explore the project portfolio as a graph" },
];

function defaultGraphPoint(index: number): ProjectGraphPoint {
    const columns = 3;
    const column = index % columns;
    const row = Math.floor(index / columns);
    return { x: 90 + column * 340, y: 180 + row * 190 };
}

function loadGraphPositions(projects: Project[]): ProjectGraphPositions {
    const ids = new Set(projects.map((project) => project.id));
    let parsed: unknown = null;
    try {
        parsed = JSON.parse(window.localStorage.getItem(PROJECTS_GRAPH_KEY) ?? "null");
    } catch {
        parsed = null;
    }

    const saved = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
    return Object.fromEntries(projects.map((project, index) => {
        const point = saved[project.id];
        const valid = point && typeof point === "object"
            && Number.isFinite((point as ProjectGraphPoint).x)
            && Number.isFinite((point as ProjectGraphPoint).y);
        return [project.id, valid ? point as ProjectGraphPoint : defaultGraphPoint(index)];
    }).filter(([id]) => ids.has(id)));
}

function saveGraphPositions(positions: ProjectGraphPositions): void {
    try {
        window.localStorage.setItem(PROJECTS_GRAPH_KEY, JSON.stringify(positions));
    } catch {
        // Canvas layout persistence is best-effort; the graph remains fully usable in memory.
    }
}

function parseGitHubRemote(value: string): { owner: string; repo: string } | null {
    const input = value.trim();
    if (!input) return null;
    const patterns = [
        /^([a-z0-9_.-]+)\/([a-z0-9_.-]+?)(?:\.git)?$/i,
        /^https?:\/\/github\.com\/([a-z0-9_.-]+)\/([a-z0-9_.-]+?)(?:\.git)?\/?$/i,
        /^git@github\.com:([a-z0-9_.-]+)\/([a-z0-9_.-]+?)(?:\.git)?$/i,
    ];
    for (const pattern of patterns) {
        const match = input.match(pattern);
        if (match) return { owner: match[1]!, repo: match[2]! };
    }
    return null;
}

export const ProjectsListView = ({
    state,
    actions,
    onOpenProject,
    onNavigate,
}: {
    state: CoretexState;
    actions: CoretexActions;
    onOpenProject: (id: string) => void;
    onNavigate?: (t: NavTarget) => void;
}) => {
    const [creating, setCreating] = useState<boolean>(false);
    const [name, setName] = useState<string>("");
    const [description, setDescription] = useState<string>("");
    const [sourcePath, setSourcePath] = useState<string>("");
    const [pickingSource, setPickingSource] = useState(false);
    const [repoName, setRepoName] = useState("");
    const [repoNotes, setRepoNotes] = useState("");
    const [repoVisibility, setRepoVisibility] = useState<"public" | "private">("private");
    const [githubRemote, setGithubRemote] = useState("");
    const [docs, setDocs] = useState<UploadedDoc[]>([]);
    const [createError, setCreateError] = useState<string | null>(null);
    const [armed, setArmed] = useState<string | null>(null);
    // Inline rename: which project is being renamed + its draft name.
    const [renaming, setRenaming] = useState<string | null>(null);
    const [renameDraft, setRenameDraft] = useState<string>("");
    const [viewMode, setViewMode] = useState<ProjectsViewMode>("grid");
    const [graphPositions, setGraphPositions] = useState<ProjectGraphPositions>({});
    const graphSceneRef = useRef<HTMLDivElement | null>(null);
    const graphDragRef = useRef<{
        id: string;
        pointerId: number;
        startX: number;
        startY: number;
        offsetX: number;
        offsetY: number;
        origin: ProjectGraphPoint;
        moved: boolean;
    } | null>(null);
    const ctx = useContextMenu();

    useEffect(() => {
        const savedView = window.localStorage.getItem(PROJECTS_VIEW_KEY);
        if (savedView === "grid" || savedView === "graph") setViewMode(savedView);
    }, []);

    useEffect(() => {
        setGraphPositions((current) => {
            const saved = loadGraphPositions(state.projects);
            const next = Object.fromEntries(state.projects.map((project, index) => [
                project.id,
                current[project.id] ?? saved[project.id] ?? defaultGraphPoint(index),
            ]));
            saveGraphPositions(next);
            return next;
        });
    }, [state.projects]);

    const chooseView = (next: ProjectsViewMode): void => {
        setViewMode(next);
        try {
            window.localStorage.setItem(PROJECTS_VIEW_KEY, next);
        } catch {
            // View persistence is optional.
        }
    };

    const armDelete = (id: string): void => {
        setArmed(id);
        window.setTimeout(() => setArmed((cur) => (cur === id ? null : cur)), 3000);
    };

    const startRename = (p: Project): void => {
        setRenameDraft(p.name);
        setRenaming(p.id);
    };

    const commitRename = (id: string): void => {
        const next = renameDraft.trim();
        if (next) actions.updateProject(id, { name: next });
        setRenaming(null);
    };

    // Open a specific tab of a project — prefer onNavigate (deep tab), fall back
    // to the plain open behavior so the menu still works without onNavigate wired.
    const openTab = (id: string, tab: ProjectTab): void => {
        if (onNavigate) onNavigate({ kind: "project", id, tab });
        else onOpenProject(id);
    };

    // Build the right-click menu for a project card from existing CoretexActions.
    const projectMenu = (p: Project): MenuItem[] => {
        const hasSource = Boolean(p.sourcePath);
        return [
            { header: p.name },
            { key: "open", label: "Open", icon: Eye, onClick: () => onOpenProject(p.id) },
            { separator: true },
            { key: "agents", label: "Open Agents", icon: Users01, onClick: () => openTab(p.id, "agents") },
            { key: "kanban", label: "Open Kanban", icon: Columns01, onClick: () => openTab(p.id, "kanban") },
            { key: "chat", label: "Open Chat", icon: MessageChatCircle, onClick: () => openTab(p.id, "chat") },
            { key: "documents", label: "Open Documents", icon: File05, onClick: () => openTab(p.id, "documents") },
            { separator: true },
            { key: "rename", label: "Rename", icon: Edit05, onClick: () => startRename(p) },
            {
                key: "reindex",
                label: "Re-index code",
                icon: RefreshCcw01,
                disabled: !hasSource,
                onClick: () => actions.reindexCode(p.id),
            },
            { key: "settings", label: "Settings", icon: Settings01, onClick: () => openTab(p.id, "settings") },
            { separator: true },
            { key: "delete", label: "Delete project", icon: Trash01, danger: true, onClick: () => armDelete(p.id) },
            { separator: true },
            { key: "new", label: "New project", icon: Plus, onClick: () => setCreating(true) },
        ];
    };

    const githubInput = githubRemote.trim();
    const githubRef = parseGitHubRemote(githubInput);
    const githubInvalid = githubInput.length > 0 && githubRef === null;
    const canSubmit = name.trim().length > 0 && !githubInvalid && state.connected;

    const reset = (): void => {
        setName("");
        setDescription("");
        setSourcePath("");
        setRepoName("");
        setRepoNotes("");
        setRepoVisibility("private");
        setGithubRemote("");
        setDocs([]);
        setCreateError(null);
        setCreating(false);
    };

    const handleSubmit = (): void => {
        setCreateError(null);
        if (!state.connected) {
            setCreateError("Coretex Brain is disconnected. Reconnect before creating a project.");
            return;
        }
        if (githubInvalid) {
            setCreateError("Enter a GitHub remote as owner/repo, a github.com URL, or an SSH GitHub URL.");
            return;
        }
        if (!canSubmit) return;
        const repos: ProjectRepo[] = sourcePath.trim() || githubRef
            ? [{
                id: `repo_${Date.now().toString(36)}`,
                name: repoName.trim() || githubRef?.repo || name.trim(),
                // A GitHub-only project can be created before it is cloned.
                // Empty path is the explicit remote-only state; `.` means the
                // chosen project folder is the local checkout.
                path: sourcePath.trim() ? "." : "",
                visibility: repoVisibility,
                notes: repoNotes.trim() || undefined,
                github: githubRef ? { owner: githubRef.owner, repo: githubRef.repo, url: `https://github.com/${githubRef.owner}/${githubRef.repo}` } : null,
                includeInIndex: Boolean(sourcePath.trim()),
                isPrimary: true,
                createdAt: Date.now(),
            }]
            : [];
        const sent = actions.createProject({
            name: name.trim(),
            ...(description.trim() ? { description: description.trim() } : {}),
            ...(sourcePath.trim() ? { sourcePath: sourcePath.trim() } : {}),
            ...(docs.length ? { documents: docs } : {}),
            ...(repos.length ? { repos } : {}),
            executionTarget: "hybrid",
        });
        if (sent) reset();
        else setCreateError("The project could not be sent to Coretex Brain. Check the connection and try again.");
    };

    const projects = state.projects;
    const graphHeight = useMemo(() => {
        const furthest = projects.reduce((max, project, index) => {
            const point = graphPositions[project.id] ?? defaultGraphPoint(index);
            return Math.max(max, point.y + GRAPH_CARD_HEIGHT);
        }, 0);
        return Math.max(560, furthest + 110);
    }, [graphPositions, projects]);

    const openCreateForm = (): void => {
        setCreating(true);
        window.requestAnimationFrame(() => document.getElementById("project-create-form")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    };

    const resetGraphLayout = (): void => {
        const next = Object.fromEntries(projects.map((project, index) => [project.id, defaultGraphPoint(index)]));
        setGraphPositions(next);
        saveGraphPositions(next);
        graphSceneRef.current?.parentElement?.scrollTo({ top: 0, left: 0, behavior: "smooth" });
    };

    const beginGraphDrag = (event: ReactPointerEvent<HTMLDivElement>, projectId: string): void => {
        if (event.button !== 0) return;
        const scene = graphSceneRef.current;
        const point = graphPositions[projectId];
        if (!scene || !point) return;
        const rect = scene.getBoundingClientRect();
        graphDragRef.current = {
            id: projectId,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            offsetX: event.clientX - rect.left - point.x,
            offsetY: event.clientY - rect.top - point.y,
            origin: point,
            moved: false,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
    };

    const moveGraphNode = (event: ReactPointerEvent<HTMLDivElement>): void => {
        const drag = graphDragRef.current;
        const scene = graphSceneRef.current;
        if (!drag || drag.pointerId !== event.pointerId || !scene) return;
        if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return;
        drag.moved = true;
        const rect = scene.getBoundingClientRect();
        const x = Math.max(24, Math.min(GRAPH_WIDTH - GRAPH_CARD_WIDTH - 24, event.clientX - rect.left - drag.offsetX));
        const y = Math.max(132, Math.min(graphHeight - GRAPH_CARD_HEIGHT - 24, event.clientY - rect.top - drag.offsetY));
        setGraphPositions((current) => ({ ...current, [drag.id]: { x, y } }));
    };

    const finishGraphDrag = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false): void => {
        const drag = graphDragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        graphDragRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);

        if (cancelled) {
            setGraphPositions((current) => {
                const next = { ...current, [drag.id]: drag.origin };
                saveGraphPositions(next);
                return next;
            });
            return;
        }

        if (!drag.moved) {
            onOpenProject(drag.id);
            return;
        }
        setGraphPositions((current) => {
            saveGraphPositions(current);
            return current;
        });
    };

    return (
        <div className="relative flex size-full min-h-0 flex-col overflow-hidden">
            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pb-32">
            <div className="flex items-center gap-4">
                <h1 className="text-display-xs font-semibold text-primary">Projects</h1>
            </div>

            {creating && (
                <div id="project-create-form" className="flex scroll-mt-4 flex-col gap-3 rounded-xl p-4" style={SURFACE}>
                    <h2 className="text-sm font-semibold text-primary">Create a project</h2>
                    <Input label="Name" placeholder="e.g. Coretex Relay" value={name} onChange={setName} isRequired />
                    <Input label="Description" placeholder="What is this project about?" value={description} onChange={setDescription} />
                    <Input label="Source path (optional)" placeholder="C:\\path\\to\\repo — indexed for the assistant" value={sourcePath} onChange={setSourcePath} />
                    <div className="flex flex-wrap items-center gap-2">
                        <Button size="sm" color="secondary" iconLeading={Folder} onClick={() => setPickingSource(true)}>Choose folder</Button>
                        {sourcePath && <span className="min-w-0 flex-1 truncate font-mono text-xs text-tertiary" title={sourcePath}>{sourcePath}</span>}
                    </div>

                    <div className="grid gap-3 rounded-xl p-3 sm:grid-cols-2" style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}>
                        <Input label="Repository name" placeholder={name.trim() || "Repository name"} value={repoName} onChange={setRepoName} />
                        <label className="flex flex-col gap-1.5 text-xs font-medium text-secondary">
                            Visibility
                            <select value={repoVisibility} onChange={(event) => setRepoVisibility(event.target.value as "public" | "private")} className="rounded-lg px-3 py-2 text-sm text-primary outline-none" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}>
                                <option value="private">Private</option>
                                <option value="public">Public</option>
                            </select>
                        </label>
                        <Input label="GitHub remote (optional)" placeholder="owner/repo or GitHub URL" value={githubRemote} onChange={setGithubRemote} />
                        <Input label="Repository notes" placeholder="Purpose, ownership, or constraints" value={repoNotes} onChange={setRepoNotes} />
                    </div>

                    {githubInvalid && <p role="alert" className="text-xs text-error-primary">Use owner/repo, https://github.com/owner/repo, or git@github.com:owner/repo.git.</p>}
                    {createError && <p role="alert" className="rounded-lg px-3 py-2 text-xs text-error-primary" style={{ background: "color-mix(in srgb, var(--c-error) 10%, var(--surface))", border: "1px solid color-mix(in srgb, var(--c-error) 30%, var(--c-border))" }}>{createError}</p>}

                    {/* Context documents */}
                    <div className="flex flex-col gap-2">
                        <span className="text-xs font-medium text-secondary">Context documents (optional)</span>
                        <FileDrop
                            accept=".txt,.md,.json,.csv,.js,.ts,.tsx,.jsx,.py,.go,.rs,.java,.rb,.php,.yml,.yaml,.html,.css,.sql,.sh,.env,.xml,.toml"
                            hint="txt, md, json, csv or code — indexed so agents and the assistant can use them"
                            onComplete={(r) => setDocs((prev) => [...prev.filter((d) => d.name !== r.name), { name: r.name, mime: r.mime, content: r.dataUrl }])}
                            onRemove={(fileName) => setDocs((prev) => prev.filter((d) => d.name !== fileName))}
                        />
                    </div>

                    <div className="flex flex-wrap gap-2">
                        <Button size="sm" color="primary" isDisabled={!canSubmit} onClick={handleSubmit}>Create project</Button>
                        <Button size="sm" color="secondary" onClick={reset}>Cancel</Button>
                    </div>
                </div>
            )}

            {pickingSource && <FolderPicker state={state} actions={actions} title="Choose project source folder" initialPath={sourcePath || undefined} onPick={(picked) => { setSourcePath(picked); setPickingSource(false); }} onClose={() => setPickingSource(false)} />}

            {projects.length === 0 ? (
                <EmptyState size="sm" className="py-12">
                    <EmptyState.Header>
                        <EmptyState.FeaturedIcon icon={Folder} color="brand" theme="gradient" />
                    </EmptyState.Header>
                    <EmptyState.Content>
                        <EmptyState.Title>No projects yet</EmptyState.Title>
                        <EmptyState.Description>
                            Create your first project to organize tasks, agents, and indexed context in one place.
                        </EmptyState.Description>
                    </EmptyState.Content>
                    <EmptyState.Footer>
                        <Button size="md" color="primary" iconLeading={Plus} onClick={() => setCreating(true)}>
                            Create project
                        </Button>
                    </EmptyState.Footer>
                </EmptyState>
            ) : viewMode === "grid" ? (
                <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                    {projects.map((p: Project) => {
                        const taskCount = state.tasks.filter((t) => t.projectId === p.id).length;
                        const indexStatus = state.codeIndex[p.id]?.status;

                        const isRenaming = renaming === p.id;

                        return (
                            <div key={p.id} className="group relative min-w-0" onContextMenu={(e) => ctx.open(e, projectMenu(p))}>
                            <div
                                role={isRenaming ? undefined : "button"}
                                tabIndex={isRenaming ? -1 : 0}
                                aria-label={isRenaming ? undefined : `Open ${p.name}`}
                                onClick={() => { if (!isRenaming) onOpenProject(p.id); }}
                                onKeyDown={(event) => {
                                    if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
                                    event.preventDefault();
                                    onOpenProject(p.id);
                                }}
                                className="flex w-full cursor-pointer flex-col overflow-hidden rounded-xl text-left outline-none transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                                style={{
                                    ...SURFACE,
                                    borderLeft: p.appearance?.accentRail && p.color ? `3px solid ${p.color}` : undefined,
                                }}
                            >
                                {p.coverImageUrl && (
                                    <span
                                        className="block h-24 w-full shrink-0"
                                        style={{ backgroundImage: `url(${p.coverImageUrl})`, backgroundSize: "cover", backgroundPosition: "center" }}
                                        aria-hidden="true"
                                    />
                                )}
                                <span className="flex w-full flex-1 flex-col gap-3 p-5">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex min-w-0 flex-1 items-start gap-2.5">
                                        <span className="shrink-0" style={{ filter: p.appearance?.glow && p.color ? `drop-shadow(0 0 6px ${p.color})` : undefined }}>
                                            <ProjectIcon icon={p.icon} color={p.color} size={28} />
                                        </span>
                                        {isRenaming ? (
                                            // Stop click/keys from bubbling to the card's open handler while editing.
                                            <input
                                                autoFocus
                                                value={renameDraft}
                                                onChange={(e) => setRenameDraft(e.target.value)}
                                                onClick={(e) => e.stopPropagation()}
                                                onKeyDown={(e) => {
                                                    e.stopPropagation();
                                                    if (e.key === "Enter") commitRename(p.id);
                                                    if (e.key === "Escape") setRenaming(null);
                                                }}
                                                onBlur={() => commitRename(p.id)}
                                                className="min-w-0 flex-1 rounded-md px-1.5 py-0.5 text-md font-semibold text-primary outline-none"
                                                style={{ background: "var(--surface-2)", border: "1px solid var(--brand)" }}
                                            />
                                        ) : (
                                            <span className="min-w-0 break-words text-md font-semibold leading-6 text-primary [overflow-wrap:anywhere]" title={p.name}>{p.name}</span>
                                        )}
                                    </div>
                                    <SquareStatusBadge status={p.status} />
                                </div>

                                {p.description ? (
                                    <p className="line-clamp-2 break-words text-sm text-tertiary [overflow-wrap:anywhere]" title={p.description}>{p.description}</p>
                                ) : (
                                    <p className="text-sm text-tertiary">No description</p>
                                )}

                                <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-tertiary">
                                    <span>
                                        {taskCount} {taskCount === 1 ? "task" : "tasks"}
                                    </span>
                                    {indexStatus ? (
                                        <>
                                            <span aria-hidden>·</span>
                                            <span>Index: {statusLabel(indexStatus)}</span>
                                        </>
                                    ) : null}
                                </div>
                                </span>
                            </div>

                            {/* Hover delete — arm-to-confirm so it can't fire on a stray click. */}
                            {armed === p.id ? (
                                <button
                                    type="button"
                                    onClick={() => { actions.deleteProject(p.id); setArmed(null); }}
                                    title="Click again to delete this project"
                                    className="absolute right-3 top-3 flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-white shadow-sm"
                                    style={{ background: "var(--c-error)" }}
                                >
                                    <Trash01 className="size-3.5" /> Confirm
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => armDelete(p.id)}
                                    title="Delete project"
                                    className="absolute right-3 top-3 rounded-md p-1.5 text-tertiary opacity-0 shadow-sm transition group-hover:opacity-100 hover:text-error-primary"
                                    style={{ background: "var(--surface-2)" }}
                                >
                                    <Trash01 className="size-4" />
                                </button>
                            )}
                            </div>
                        );
                    })}
                </div>
            ) : (
                <section
                    aria-label="Project portfolio graph"
                    className="min-h-[34rem] min-w-0 flex-1 overflow-auto rounded-xl"
                    style={{ ...SURFACE, background: "var(--app-bg)" }}
                >
                    <div
                        ref={graphSceneRef}
                        className="relative"
                        style={{
                            width: GRAPH_WIDTH,
                            height: graphHeight,
                            backgroundImage: "radial-gradient(circle, color-mix(in srgb, var(--c-text-muted) 30%, transparent) 1px, transparent 1.2px)",
                            backgroundSize: "24px 24px",
                            touchAction: "none",
                        }}
                    >
                        <svg className="pointer-events-none absolute inset-0" width={GRAPH_WIDTH} height={graphHeight} aria-hidden="true">
                            <defs>
                                <marker id="project-portfolio-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                                    <path d="M0,0 L8,4 L0,8 Z" fill="var(--brand)" />
                                </marker>
                            </defs>
                            {projects.map((project, index) => {
                                const point = graphPositions[project.id] ?? defaultGraphPoint(index);
                                const startX = GRAPH_HUB.x + GRAPH_HUB.width / 2;
                                const startY = GRAPH_HUB.y + GRAPH_HUB.height;
                                const endX = point.x + GRAPH_CARD_WIDTH / 2;
                                const endY = point.y;
                                const bendY = startY + Math.max(38, (endY - startY) * 0.52);
                                return (
                                    <path
                                        key={project.id}
                                        d={`M ${startX} ${startY} C ${startX} ${bendY}, ${endX} ${bendY}, ${endX} ${endY}`}
                                        fill="none"
                                        stroke={project.color || "var(--brand)"}
                                        strokeWidth="1.5"
                                        opacity="0.62"
                                        markerEnd="url(#project-portfolio-arrow)"
                                    />
                                );
                            })}
                        </svg>

                        <div
                            className="absolute flex flex-col items-center justify-center rounded-xl text-center shadow-lg"
                            style={{
                                left: GRAPH_HUB.x,
                                top: GRAPH_HUB.y,
                                width: GRAPH_HUB.width,
                                height: GRAPH_HUB.height,
                                background: "var(--surface)",
                                border: "1px solid var(--brand)",
                            }}
                        >
                            <Dataflow03 className="size-5 text-brand-secondary" />
                            <span className="mt-1 text-xs font-semibold text-primary">Workspace</span>
                            <span className="text-[10px] text-tertiary">{projects.length} projects</span>
                        </div>

                        {projects.map((project, index) => {
                            const point = graphPositions[project.id] ?? defaultGraphPoint(index);
                            const taskCount = state.tasks.filter((task) => task.projectId === project.id).length;
                            const repoCount = project.repos?.length ?? 0;
                            return (
                                <div
                                    key={project.id}
                                    role="button"
                                    tabIndex={0}
                                    aria-label={`Open ${project.name}`}
                                    title={`${project.name}${project.description ? ` — ${project.description}` : ""}`}
                                    className="group absolute flex cursor-grab flex-col overflow-hidden rounded-xl p-4 text-left shadow-md outline-none transition-shadow hover:shadow-xl focus-visible:ring-2 focus-visible:ring-[var(--brand)] active:cursor-grabbing"
                                    style={{
                                        left: point.x,
                                        top: point.y,
                                        width: GRAPH_CARD_WIDTH,
                                        height: GRAPH_CARD_HEIGHT,
                                        background: "var(--surface)",
                                        border: `1px solid ${project.color || "var(--c-border)"}`,
                                        userSelect: "none",
                                    }}
                                    onPointerDown={(event) => beginGraphDrag(event, project.id)}
                                    onPointerMove={moveGraphNode}
                                    onPointerUp={(event) => finishGraphDrag(event)}
                                    onPointerCancel={(event) => finishGraphDrag(event, true)}
                                    onKeyDown={(event) => {
                                        if (event.key !== "Enter" && event.key !== " ") return;
                                        event.preventDefault();
                                        onOpenProject(project.id);
                                    }}
                                    onContextMenu={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        ctx.open(event, projectMenu(project));
                                    }}
                                >
                                    <div className="flex items-start gap-2.5">
                                        <ProjectIcon icon={project.icon} color={project.color} size={30} />
                                        <div className="min-w-0 flex-1">
                                            <p className="line-clamp-2 break-words text-sm font-semibold leading-4 text-primary [overflow-wrap:anywhere]" title={project.name}>{project.name}</p>
                                            <p className="mt-0.5 truncate text-[11px] text-tertiary" title={project.description || "No description"}>{project.description || "No description"}</p>
                                        </div>
                                        <SquareStatusBadge status={project.status} />
                                    </div>
                                    <div className="mt-auto flex items-center gap-3 text-[11px] text-tertiary">
                                        <span>{taskCount} {taskCount === 1 ? "task" : "tasks"}</span>
                                        <span aria-hidden="true">·</span>
                                        <span>{repoCount} {repoCount === 1 ? "repo" : "repos"}</span>
                                        <span className="ml-auto text-brand-secondary opacity-0 transition-opacity group-hover:opacity-100">Drag or open</span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </section>
            )}
            </div>

            <CanvasActionDock
                label="Project portfolio actions"
                viewModes={PROJECT_VIEW_MODES}
                activeView={viewMode}
                onViewChange={chooseView}
                actions={viewMode === "graph" ? [{
                    id: "reset-project-layout",
                    label: "Reset graph layout",
                    icon: RefreshCcw01,
                    onClick: resetGraphLayout,
                    description: "Restore the default project positions",
                }] : []}
                primaryAction={{
                    id: "new-project",
                    label: "New project",
                    icon: Plus,
                    onClick: openCreateForm,
                    description: "Add a project to this workspace",
                    tone: "brand",
                }}
            />

            {/* Right-click context menu (rendered once near the root). */}
            {ctx.node}
        </div>
    );
};
