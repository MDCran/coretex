// @ts-nocheck
"use client";

import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type PointerEvent as ReactPointerEvent,
    type WheelEvent as ReactWheelEvent,
} from "react";
import type { BadgeColor, Project, TaskPriority, TaskStatus } from "@repo/coretex/types";
import {
    ArrowDown,
    ArrowUp,
    Columns01,
    Cursor01,
    Dataflow03,
    Database01,
    File02,
    FolderCode,
    Framer,
    GitBranch01,
    Grid01,
    Hand,
    Link01,
    LayoutGrid01,
    Lock01,
    Maximize02,
    MessageChatCircle,
    PauseCircle,
    Play,
    RefreshCcw01,
    Server01,
    Settings01,
    StickerSquare,
    Target04,
    Terminal,
    Trash01,
    Users01,
    Wallet02,
    XClose,
    ZoomIn,
    ZoomOut,
} from "@untitledui/icons";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { ButtonUtility } from "@/components/base/buttons/button-utility";
import { cx } from "@/utils/cx";
import { roleLabel, statusLabel, titleCase } from "../../labels";
import type { NavTarget, ProjectTab } from "../../nav";
import {
    AGENT_STATUS_COLOR,
    agentsForProject,
    formatTokens,
    formatUSD,
    type CoretexActions,
    type CoretexState,
} from "../../use-coretex";
import { IdentityAvatar } from "../../ui/identity-avatar";
import { ProjectIcon } from "../../ui/project-icon";
import { useContextMenu, type MenuItem } from "../../ui/context-menu";
import { CanvasActionDock, type CanvasDockViewMode } from "../../views/canvas-action-dock";
import {
    GRID_SIZE,
    canvasObjectId,
    clampZoom,
    freshCanvasLayout,
    loadCanvasLayout,
    saveCanvasLayout,
    snapValue,
    type CanvasFrame,
    type CanvasNote,
    type CanvasSelection,
    type CanvasTone,
    type CanvasTool,
    type ProjectCanvasLayout,
} from "./canvas-state";

type NodeKind =
    | "project"
    | "task"
    | "agent"
    | "documents"
    | "document"
    | "repo"
    | "terminals"
    | "terminal"
    | "servers"
    | "server"
    | "chat"
    | "billing"
    | "secrets"
    | "settings";

type ProjectCanvasDockView = "overview" | "graph";

const PROJECT_CANVAS_DOCK_VIEWS: readonly CanvasDockViewMode<ProjectCanvasDockView>[] = [
    { id: "overview", label: "Overview", icon: LayoutGrid01, description: "Open the project dashboard" },
    { id: "graph", label: "Graph", icon: Dataflow03, description: "Arrange and connect project objects" },
];

type NodeIcon = typeof FolderCode;

interface LiveNode {
    id: string;
    kind: NodeKind;
    entityId?: string;
    title: string;
    eyebrow: string;
    description: string;
    meta: string[];
    status?: { label: string; color: BadgeColor };
    icon: NodeIcon;
    tab?: ProjectTab;
    target?: NavTarget;
    x: number;
    y: number;
    width: number;
    height: number;
}

interface CanvasRect {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

type MoveTarget = Exclude<NonNullable<CanvasSelection>, { kind: "edge" }>;

type DragState =
    | { mode: "pan"; pointerId: number; startX: number; startY: number; originX: number; originY: number }
    | { mode: "move"; pointerId: number; target: MoveTarget; startX: number; startY: number; originX: number; originY: number };

const TASK_STATUS_COLOR: Record<TaskStatus, BadgeColor> = {
    pending: "gray",
    assigned: "blue",
    in_progress: "brand",
    completed: "success",
    failed: "error",
    cancelled: "gray",
};

const PROJECT_STATUS_COLOR: Record<Project["status"], BadgeColor> = {
    active: "success",
    paused: "warning",
    completed: "blue",
    archived: "gray",
};

const PRIORITIES: TaskPriority[] = ["low", "medium", "high", "critical"];
const WORLD_WIDTH = 5200;
const WORLD_HEIGHT = 3600;

const TONE_STYLE: Record<CanvasTone, { fill: string; border: string; ink: string }> = {
    amber: {
        fill: "color-mix(in srgb, var(--c-warning) 14%, var(--surface))",
        border: "color-mix(in srgb, var(--c-warning) 42%, var(--c-border))",
        ink: "var(--c-warning)",
    },
    blue: {
        fill: "color-mix(in srgb, #3b82f6 12%, var(--surface))",
        border: "color-mix(in srgb, #3b82f6 38%, var(--c-border))",
        ink: "#3b82f6",
    },
    green: {
        fill: "color-mix(in srgb, var(--c-success) 12%, var(--surface))",
        border: "color-mix(in srgb, var(--c-success) 38%, var(--c-border))",
        ink: "var(--c-success)",
    },
    purple: {
        fill: "color-mix(in srgb, #8b5cf6 12%, var(--surface))",
        border: "color-mix(in srgb, #8b5cf6 38%, var(--c-border))",
        ink: "#8b5cf6",
    },
    gray: {
        fill: "var(--surface-2)",
        border: "var(--c-border)",
        ink: "var(--c-text-muted)",
    },
};

function nextPriority(priority: TaskPriority): TaskPriority | null {
    const index = PRIORITIES.indexOf(priority);
    return index >= 0 && index < PRIORITIES.length - 1 ? PRIORITIES[index + 1]! : null;
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function repoPath(sourcePath: string | undefined, path: string): string {
    const trimmed = path.trim();
    if (/^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith("/")) return trimmed;
    if (!sourcePath || trimmed === ".") return sourcePath ?? trimmed;
    const separator = sourcePath.includes("\\") ? "\\" : "/";
    return `${sourcePath.replace(/[\\/]+$/, "")}${separator}${trimmed.replace(/^[\\/]+/, "")}`;
}

function edgePath(source: CanvasRect, target: CanvasRect): string {
    const leftToRight = source.x + source.width / 2 <= target.x + target.width / 2;
    const sx = leftToRight ? source.x + source.width : source.x;
    const tx = leftToRight ? target.x : target.x + target.width;
    const sy = source.y + source.height / 2;
    const ty = target.y + target.height / 2;
    const bend = Math.max(72, Math.abs(tx - sx) * 0.45);
    const c1 = leftToRight ? sx + bend : sx - bend;
    const c2 = leftToRight ? tx - bend : tx + bend;
    return `M ${sx} ${sy} C ${c1} ${sy}, ${c2} ${ty}, ${tx} ${ty}`;
}

function isTypingTarget(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function ToolButton({ tool, active, icon, label, shortcut, onClick }: { tool: CanvasTool; active: boolean; icon: NodeIcon; label: string; shortcut: string; onClick: (tool: CanvasTool) => void }) {
    return (
        <ButtonUtility
            icon={icon}
            tooltip={`${label} / ${shortcut}`}
            color={active ? "secondary" : "tertiary"}
            onClick={() => onClick(tool)}
            className={cx(active && "ring-1 ring-[var(--brand)] ring-inset")}
            aria-pressed={active}
        />
    );
}

export interface ProjectCanvasTabProps {
    project: Project;
    state: CoretexState;
    actions: CoretexActions;
    onOpenTab: (tab: ProjectTab) => void;
    onNavigate?: (target: NavTarget) => void;
}

export function ProjectCanvasTab({ project, state, actions, onOpenTab, onNavigate }: ProjectCanvasTabProps) {
    const canvasRef = useRef<HTMLDivElement | null>(null);
    const dragRef = useRef<DragState | null>(null);
    const spaceRef = useRef(false);
    const ctx = useContextMenu();
    const [layout, setLayout] = useState<ProjectCanvasLayout>(() => freshCanvasLayout());
    const [hydrated, setHydrated] = useState(false);
    const [tool, setTool] = useState<CanvasTool>("select");
    const [selection, setSelection] = useState<CanvasSelection>(null);
    const [connectorSource, setConnectorSource] = useState<string | null>(null);
    // Live alignment guide lines (world coordinates) while dragging an object near others.
    const [alignGuides, setAlignGuides] = useState<{ v: number | null; h: number | null }>({ v: null, h: null });
    const [canvasSize, setCanvasSize] = useState({ width: 1000, height: 700 });

    useEffect(() => {
        setHydrated(false);
        setLayout(loadCanvasLayout(project.id));
        setSelection(null);
        setConnectorSource(null);
        setHydrated(true);
    }, [project.id]);

    useEffect(() => {
        if (!hydrated) return;
        const timer = window.setTimeout(() => saveCanvasLayout(project.id, layout), 180);
        return () => window.clearTimeout(timer);
    }, [hydrated, layout, project.id]);

    useEffect(() => {
        const element = canvasRef.current;
        if (!element) return;
        const update = () => setCanvasSize({ width: element.clientWidth, height: element.clientHeight });
        update();
        const observer = new ResizeObserver(update);
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        actions.getProjectBilling(project.id);
        actions.getChatHistory(project.id);
        actions.scanServers();
        actions.terminalList();
        for (const repo of project.repos ?? []) {
            const path = repoPath(project.sourcePath, repo.path);
            if (path) {
                actions.gitSummary(path);
                actions.gitBranches(path);
            }
        }
    }, [actions, project.id, project.repos, project.sourcePath]);

    const projectTasks = useMemo(() => state.tasks.filter((task) => task.projectId === project.id), [project.id, state.tasks]);
    const projectAgents = useMemo(() => agentsForProject(state.agents, state.tasks, project.id), [project.id, state.agents, state.tasks]);
    const projectTerminals = useMemo(() => state.terminals.filter((terminal) => terminal.projectId === project.id), [project.id, state.terminals]);
    const projectServers = useMemo(() => state.servers.filter((server) => server.projectId === project.id), [project.id, state.servers]);

    const nodes = useMemo<LiveNode[]>(() => {
        type Seed = Omit<LiveNode, "x" | "y"> & { defaultX: number; defaultY: number };
        const seeds: Seed[] = [];
        const taskRows = Math.max(1, Math.ceil(projectTasks.length / 3));
        const mainBottom = Math.max(470, 110 + taskRows * 190, 320 + projectAgents.length * 185);
        const resourceY = mainBottom + 120;
        const resourceSeeds: Omit<Seed, "defaultX" | "defaultY">[] = [];

        seeds.push({
            id: `project:${project.id}`,
            kind: "project",
            title: project.name,
            eyebrow: "Project",
            description: project.description || "Project command center",
            meta: [`${projectTasks.length} tasks`, `${projectAgents.length} agents`, project.sourcePath || "No source folder"],
            status: { label: statusLabel(project.status), color: PROJECT_STATUS_COLOR[project.status] },
            icon: FolderCode,
            tab: "overview",
            width: 292,
            height: 168,
            defaultX: 80,
            defaultY: 90,
        });

        projectTasks.forEach((task, index) => {
            const assigned = task.assignedAgentIds?.length ?? (task.assignedAgentId ? 1 : 0);
            seeds.push({
                id: `task:${task.id}`,
                kind: "task",
                entityId: task.id,
                title: task.title,
                eyebrow: "Task",
                description: task.description || "No instructions added",
                meta: [titleCase(task.priority), assigned ? `${assigned} assigned` : "Unassigned", task.dependencies.length ? `${task.dependencies.length} dependencies` : "No dependencies"],
                status: { label: statusLabel(task.status), color: TASK_STATUS_COLOR[task.status] },
                icon: Database01,
                tab: "kanban",
                width: 276,
                height: 166,
                defaultX: 760 + (index % 3) * 304,
                defaultY: 90 + Math.floor(index / 3) * 190,
            });
        });

        projectAgents.forEach((agent, index) => {
            const currentTask = projectTasks.find((task) => task.id === agent.currentTaskId);
            seeds.push({
                id: `agent:${agent.id}`,
                kind: "agent",
                entityId: agent.id,
                title: agent.config.name,
                eyebrow: roleLabel(agent.config.role),
                description: currentTask ? `Working on ${currentTask.title}` : `${agent.config.provider} / ${agent.config.model}`,
                meta: [`${agent.stepCount} steps`, `${formatTokens(agent.tokensUsedToday)} today`, formatUSD(agent.costToday)],
                status: { label: statusLabel(agent.status), color: AGENT_STATUS_COLOR[agent.status] },
                icon: Users01,
                tab: "agents",
                width: 292,
                height: 172,
                defaultX: 400,
                defaultY: 90 + index * 186,
            });
        });

        const index = state.codeIndex[project.id];
        resourceSeeds.push({
            id: `documents:${project.id}`,
            kind: "documents",
            title: "Documents & code",
            eyebrow: "Knowledge",
            description: index ? `${index.filesScanned} files / ${index.chunks} chunks` : "Index source code and attach references",
            meta: [`${project.documents?.length ?? 0} documents`, index?.status ? statusLabel(index.status) : "Not indexed"],
            status: index?.status ? { label: statusLabel(index.status), color: index.status === "ready" ? "success" : index.status === "error" ? "error" : "blue" } : undefined,
            icon: File02,
            tab: "documents",
            width: 260,
            height: 148,
        });
        resourceSeeds.push({
            id: `repos:${project.id}`,
            kind: "repo",
            title: "Source control",
            eyebrow: "Repositories",
            description: `${project.repos?.length ?? 0} linked repositories`,
            meta: [project.sourcePath || "Set a source folder"],
            icon: GitBranch01,
            tab: "git",
            width: 260,
            height: 148,
        });
        resourceSeeds.push({
            id: `terminals:${project.id}`,
            kind: "terminals",
            title: "Terminals",
            eyebrow: "Runtime",
            description: `${projectTerminals.length} project sessions`,
            meta: [project.sourcePath || "Default working directory"],
            icon: Terminal,
            tab: "terminals",
            width: 260,
            height: 148,
        });
        resourceSeeds.push({
            id: `servers:${project.id}`,
            kind: "servers",
            title: "Running servers",
            eyebrow: "Services",
            description: `${projectServers.length} attributed processes`,
            meta: projectServers.slice(0, 2).map((server) => `:${server.port} ${server.tech || server.process || server.type}`),
            icon: Server01,
            target: { kind: "servers" },
            width: 260,
            height: 148,
        });
        resourceSeeds.push({
            id: `chat:${project.id}`,
            kind: "chat",
            title: "Project assistant",
            eyebrow: "Chat",
            description: state.chatStreaming[project.id] ? "Replying now..." : `${state.chat[project.id]?.length ?? 0} messages`,
            meta: [project.assistantModel ? `${project.assistantModel.provider} / ${project.assistantModel.model}` : "Inherited model"],
            icon: MessageChatCircle,
            tab: "chat",
            width: 260,
            height: 148,
        });
        const billing = state.projectBilling[project.id];
        resourceSeeds.push({
            id: `billing:${project.id}`,
            kind: "billing",
            title: "Usage & billing",
            eyebrow: "Spend",
            description: `${formatUSD(billing?.totalCostToday ?? 0)} today`,
            meta: [formatUSD(billing?.totalCostAllTime ?? 0) + " all-time", formatTokens(billing?.totalTokensAllTime ?? 0)],
            icon: Wallet02,
            tab: "billing",
            width: 260,
            height: 148,
        });
        const envCount = (state.env?.environments ?? []).filter((env) => env.projectId === project.id).reduce((count, env) => count + env.variables.length, 0);
        const keyCount = (state.keyvault?.keys ?? []).filter((key) => key.projectId === project.id).length;
        resourceSeeds.push({
            id: `secrets:${project.id}`,
            kind: "secrets",
            title: "Project secrets",
            eyebrow: "Environment",
            description: `${envCount} env vars / ${keyCount} API keys`,
            meta: ["Values stay outside prompts"],
            icon: Lock01,
            tab: "secrets",
            width: 260,
            height: 148,
        });
        resourceSeeds.push({
            id: `settings:${project.id}`,
            kind: "settings",
            title: "Project settings",
            eyebrow: "Configuration",
            description: "Details, intelligence, appearance and source",
            meta: [`${project.tags.length} tags`, project.budgetUSD ? `${formatUSD(project.budgetUSD)} budget` : "No project cap"],
            icon: Settings01,
            tab: "settings",
            width: 260,
            height: 148,
        });

        for (const doc of project.documents ?? []) {
            resourceSeeds.push({
                id: `document:${doc.name}`,
                kind: "document",
                entityId: doc.name,
                title: doc.title || doc.name,
                eyebrow: "Reference document",
                description: doc.description || doc.name,
                meta: [formatBytes(doc.bytes), new Date(doc.modifiedAt ?? doc.addedAt).toLocaleDateString()],
                icon: File02,
                tab: "documents",
                width: 260,
                height: 148,
            });
        }
        for (const repo of project.repos ?? []) {
            const path = repoPath(project.sourcePath, repo.path);
            const summary = path ? state.sourceControl[path]?.summary : undefined;
            // Surface HEAD branch, dirty state, and pull/push (behind/ahead) counts directly on the node.
            const syncBits: string[] = [];
            if (summary && summary.ahead > 0) syncBits.push(`↑${summary.ahead}`);
            if (summary && summary.behind > 0) syncBits.push(`↓${summary.behind}`);
            const changed = summary ? summary.staged + summary.unstaged + summary.untracked : 0;
            resourceSeeds.push({
                id: `repo:${repo.id}`,
                kind: "repo",
                entityId: repo.id,
                title: repo.name,
                eyebrow: "Repository",
                description: summary
                    ? `${summary.branch || "Detached HEAD"} · ${changed > 0 ? "Changes pending" : "Clean"}${syncBits.length ? ` · ${syncBits.join(" ")}` : ""}`
                    : (repoPath(project.sourcePath, repo.path) || repo.path),
                meta: [
                    repo.github ? `${repo.github.owner}/${repo.github.repo}` : "Local repository",
                    summary ? `${changed} changed${syncBits.length ? ` · ${syncBits.join(" ")}` : " · in sync"}` : "Open to inspect",
                ],
                icon: GitBranch01,
                tab: "git",
                width: 260,
                height: 148,
            });
        }
        for (const terminal of projectTerminals) {
            resourceSeeds.push({
                id: `terminal:${terminal.id}`,
                kind: "terminal",
                entityId: terminal.id,
                title: terminal.title,
                eyebrow: terminal.kind === "agent" ? "Agent terminal" : "Terminal",
                description: terminal.cwd || project.sourcePath || "Shell session",
                meta: [statusLabel(terminal.status), terminal.shell || "Default shell"],
                status: { label: statusLabel(terminal.status), color: terminal.status === "running" ? "success" : "gray" },
                icon: Terminal,
                tab: "terminals",
                width: 260,
                height: 148,
            });
        }
        for (const server of projectServers) {
            resourceSeeds.push({
                id: `server:${server.port}:${server.pid ?? 0}`,
                kind: "server",
                entityId: server.pid ? String(server.pid) : undefined,
                title: `localhost:${server.port}`,
                eyebrow: "Running server",
                description: server.tech || server.process || server.type,
                meta: [server.url || `Port ${server.port}`, server.pid ? `PID ${server.pid}` : "PID unavailable"],
                status: { label: server.statusOk ? "Responding" : "Listening", color: server.statusOk ? "success" : "warning" },
                icon: Server01,
                target: { kind: "servers" },
                width: 260,
                height: 148,
            });
        }

        resourceSeeds.forEach((seed, index) => {
            seeds.push({
                ...seed,
                defaultX: 80 + (index % 5) * 284,
                defaultY: resourceY + Math.floor(index / 5) * 170,
            });
        });

        return seeds.map((seed) => {
            const position = layout.positions[seed.id];
            return { ...seed, x: position?.x ?? seed.defaultX, y: position?.y ?? seed.defaultY };
        });
    }, [layout.positions, project, projectAgents, projectServers, projectTasks, projectTerminals, state.chat, state.chatStreaming, state.codeIndex, state.env, state.keyvault, state.projectBilling, state.sourceControl]);

    const rectById = useMemo(() => {
        const map = new Map<string, CanvasRect>();
        nodes.forEach((node) => map.set(node.id, node));
        layout.notes.forEach((note) => map.set(note.id, note));
        layout.frames.forEach((frame) => map.set(frame.id, frame));
        return map;
    }, [layout.frames, layout.notes, nodes]);

    const derivedEdges = useMemo(() => {
        const edges: { id: string; sourceId: string; targetId: string; kind: "assignment" | "dependency" }[] = [];
        for (const task of projectTasks) {
            for (const dependency of task.dependencies) {
                if (rectById.has(`task:${dependency}`)) edges.push({ id: `dependency:${dependency}:${task.id}`, sourceId: `task:${dependency}`, targetId: `task:${task.id}`, kind: "dependency" });
            }
            const assigned = new Set(task.assignedAgentIds ?? []);
            if (task.assignedAgentId) assigned.add(task.assignedAgentId);
            for (const agentId of assigned) {
                if (rectById.has(`agent:${agentId}`)) edges.push({ id: `assignment:${agentId}:${task.id}`, sourceId: `agent:${agentId}`, targetId: `task:${task.id}`, kind: "assignment" });
            }
        }
        return edges;
    }, [projectTasks, rectById]);

    const setViewport = useCallback((patch: Partial<ProjectCanvasLayout["viewport"]>) => {
        setLayout((current) => ({ ...current, viewport: { ...current.viewport, ...patch } }));
    }, []);

    const worldPoint = useCallback((clientX: number, clientY: number) => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return { x: 0, y: 0 };
        return {
            x: (clientX - rect.left - layout.viewport.x) / layout.viewport.zoom,
            y: (clientY - rect.top - layout.viewport.y) / layout.viewport.zoom,
        };
    }, [layout.viewport]);

    const startPan = useCallback((event: ReactPointerEvent) => {
        canvasRef.current?.setPointerCapture(event.pointerId);
        dragRef.current = {
            mode: "pan",
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            originX: layout.viewport.x,
            originY: layout.viewport.y,
        };
    }, [layout.viewport.x, layout.viewport.y]);

    const connectObject = useCallback((id: string) => {
        if (!connectorSource) {
            setConnectorSource(id);
            setSelection(null);
            return;
        }
        if (connectorSource === id) {
            setConnectorSource(null);
            return;
        }
        const existing = layout.edges.some((edge) => edge.sourceId === connectorSource && edge.targetId === id);
        if (!existing) {
            const edge = { id: canvasObjectId("edge"), sourceId: connectorSource, targetId: id, label: "" };
            setLayout((current) => ({ ...current, edges: [...current.edges, edge] }));
            setSelection({ kind: "edge", id: edge.id });
        }
        setConnectorSource(null);
        setTool("select");
    }, [connectorSource, layout.edges]);

    const startMove = useCallback((event: ReactPointerEvent, target: MoveTarget, x: number, y: number) => {
        if (event.button !== 0 && event.button !== 1) return;
        event.preventDefault();
        if (tool === "connector") {
            event.stopPropagation();
            connectObject(target.id);
            return;
        }
        if (tool === "hand" || spaceRef.current || event.button === 1) {
            event.stopPropagation();
            startPan(event);
            return;
        }
        if (tool !== "select" || isTypingTarget(event.target)) return;
        event.stopPropagation();
        setSelection(target);
        canvasRef.current?.setPointerCapture(event.pointerId);
        dragRef.current = { mode: "move", pointerId: event.pointerId, target, startX: event.clientX, startY: event.clientY, originX: x, originY: y };
    }, [connectObject, startPan, tool]);

    const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        if (drag.mode === "pan") {
            setViewport({ x: drag.originX + event.clientX - drag.startX, y: drag.originY + event.clientY - drag.startY });
            return;
        }
        const rawX = drag.originX + (event.clientX - drag.startX) / layout.viewport.zoom;
        const rawY = drag.originY + (event.clientY - drag.startY) / layout.viewport.zoom;
        let x = snapValue(rawX, layout.snapToGrid);
        let y = snapValue(rawY, layout.snapToGrid);

        // Object alignment: snap the dragged rect's edges/centers to nearby objects' edges/centers,
        // showing live guide lines. Alignment wins over plain grid snap when a candidate is in range.
        const me = rectById.get(drag.target.id);
        const guides: { v: number | null; h: number | null } = { v: null, h: null };
        if (me) {
            const threshold = 8 / layout.viewport.zoom;
            let bestV: { delta: number; snapX: number; guide: number } | null = null;
            let bestH: { delta: number; snapY: number; guide: number } | null = null;
            for (const other of rectById.values()) {
                if (other.id === drag.target.id) continue;
                const otherXs = [other.x, other.x + other.width / 2, other.x + other.width];
                const otherYs = [other.y, other.y + other.height / 2, other.y + other.height];
                const myXOffsets = [0, me.width / 2, me.width];
                const myYOffsets = [0, me.height / 2, me.height];
                for (const ox of otherXs) {
                    for (const offset of myXOffsets) {
                        const delta = Math.abs(rawX + offset - ox);
                        if (delta < threshold && (!bestV || delta < bestV.delta)) bestV = { delta, snapX: ox - offset, guide: ox };
                    }
                }
                for (const oy of otherYs) {
                    for (const offset of myYOffsets) {
                        const delta = Math.abs(rawY + offset - oy);
                        if (delta < threshold && (!bestH || delta < bestH.delta)) bestH = { delta, snapY: oy - offset, guide: oy };
                    }
                }
            }
            if (bestV) { x = bestV.snapX; guides.v = bestV.guide; }
            if (bestH) { y = bestH.snapY; guides.h = bestH.guide; }
        }
        setAlignGuides((current) => (current.v === guides.v && current.h === guides.h ? current : guides));

        if (drag.target.kind === "node") {
            setLayout((current) => ({ ...current, positions: { ...current.positions, [drag.target.id]: { ...current.positions[drag.target.id], x, y } } }));
        } else if (drag.target.kind === "note") {
            setLayout((current) => ({ ...current, notes: current.notes.map((note) => note.id === drag.target.id ? { ...note, x, y } : note) }));
        } else {
            setLayout((current) => ({ ...current, frames: current.frames.map((frame) => frame.id === drag.target.id ? { ...frame, x, y } : frame) }));
        }
    }, [layout.snapToGrid, layout.viewport.zoom, rectById, setViewport]);

    const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        if (dragRef.current?.pointerId !== event.pointerId) return;
        dragRef.current = null;
        setAlignGuides({ v: null, h: null });
        if (canvasRef.current?.hasPointerCapture(event.pointerId)) canvasRef.current.releasePointerCapture(event.pointerId);
    }, []);

    const handleCanvasPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 && event.button !== 1) return;
        const target = event.target as HTMLElement;
        if (target.closest("[data-canvas-object='true']")) return;
        if (tool === "note" || tool === "frame") {
            const point = worldPoint(event.clientX, event.clientY);
            if (tool === "note") {
                const note: CanvasNote = { id: canvasObjectId("note"), x: snapValue(point.x - 110, layout.snapToGrid), y: snapValue(point.y - 36, layout.snapToGrid), width: 240, height: 170, title: "New note", body: "Add context, a decision, or an idea...", tone: "amber" };
                setLayout((current) => ({ ...current, notes: [...current.notes, note] }));
                setSelection({ kind: "note", id: note.id });
            } else {
                const frame: CanvasFrame = { id: canvasObjectId("frame"), x: snapValue(point.x - 40, layout.snapToGrid), y: snapValue(point.y - 30, layout.snapToGrid), width: 560, height: 360, title: "New frame", tone: "blue" };
                setLayout((current) => ({ ...current, frames: [...current.frames, frame] }));
                setSelection({ kind: "frame", id: frame.id });
            }
            setTool("select");
            return;
        }
        if (tool === "hand" || spaceRef.current || event.button === 1) {
            startPan(event);
            return;
        }
        setSelection(null);
        setConnectorSource(null);
    }, [layout.snapToGrid, startPan, tool, worldPoint]);

    const handleWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
        event.preventDefault();
        const viewport = layout.viewport;
        // Ctrl/Cmd = zoom to cursor · Alt = fine zoom to cursor · Shift = pan sideways · plain = pan up/down.
        if (event.ctrlKey || event.metaKey || event.altKey) {
            const rect = canvasRef.current?.getBoundingClientRect();
            if (!rect) return;
            const px = event.clientX - rect.left;
            const py = event.clientY - rect.top;
            const step = event.altKey && !(event.ctrlKey || event.metaKey) ? 0.001 : 0.002;
            const nextZoom = clampZoom(viewport.zoom * Math.exp(-event.deltaY * step));
            const worldX = (px - viewport.x) / viewport.zoom;
            const worldY = (py - viewport.y) / viewport.zoom;
            setViewport({ zoom: nextZoom, x: px - worldX * nextZoom, y: py - worldY * nextZoom });
        } else {
            setViewport({ x: viewport.x - (event.shiftKey ? event.deltaY : event.deltaX), y: viewport.y - (event.shiftKey ? 0 : event.deltaY) });
        }
    }, [layout.viewport, setViewport]);

    const allRects = useMemo(() => Array.from(rectById.values()), [rectById]);

    const fitCanvas = useCallback(() => {
        if (allRects.length === 0) return;
        const minX = Math.min(...allRects.map((rect) => rect.x));
        const minY = Math.min(...allRects.map((rect) => rect.y));
        const maxX = Math.max(...allRects.map((rect) => rect.x + rect.width));
        const maxY = Math.max(...allRects.map((rect) => rect.y + rect.height));
        const width = Math.max(1, maxX - minX + 160);
        const height = Math.max(1, maxY - minY + 160);
        const zoom = clampZoom(Math.min(canvasSize.width / width, canvasSize.height / height, 1.15));
        setViewport({ zoom, x: (canvasSize.width - (maxX - minX) * zoom) / 2 - minX * zoom, y: (canvasSize.height - (maxY - minY) * zoom) / 2 - minY * zoom });
    }, [allRects, canvasSize.height, canvasSize.width, setViewport]);

    const resetLayout = useCallback(() => {
        setLayout((current) => ({ ...current, positions: {}, viewport: { x: 64, y: 64, zoom: 1 } }));
    }, []);
    const resetView = useCallback(() => {
        setViewport({ x: 64, y: 64, zoom: 1 });
    }, [setViewport]);

    const addNoteAtCenter = useCallback(() => {
        const visibleWidth = Math.max(320, canvasSize.width - (selection ? 320 : 0));
        const point = {
            x: (visibleWidth / 2 - layout.viewport.x) / layout.viewport.zoom,
            y: (canvasSize.height / 2 - layout.viewport.y) / layout.viewport.zoom,
        };
        const note: CanvasNote = {
            id: canvasObjectId("note"),
            x: Math.max(24, snapValue(point.x - 120, layout.snapToGrid)),
            y: Math.max(24, snapValue(point.y - 85, layout.snapToGrid)),
            width: 240,
            height: 170,
            title: "New note",
            body: "Add context, a decision, or an idea...",
            tone: "amber",
        };
        setLayout((current) => ({ ...current, notes: [...current.notes, note] }));
        setSelection({ kind: "note", id: note.id });
        setTool("select");
    }, [canvasSize.height, canvasSize.width, layout.snapToGrid, layout.viewport, selection]);

    const addFrameAtCenter = useCallback(() => {
        const visibleWidth = Math.max(320, canvasSize.width - (selection ? 320 : 0));
        const point = {
            x: (visibleWidth / 2 - layout.viewport.x) / layout.viewport.zoom,
            y: (canvasSize.height / 2 - layout.viewport.y) / layout.viewport.zoom,
        };
        const frame: CanvasFrame = {
            id: canvasObjectId("frame"),
            x: Math.max(24, snapValue(point.x - 280, layout.snapToGrid)),
            y: Math.max(24, snapValue(point.y - 180, layout.snapToGrid)),
            width: 560,
            height: 360,
            title: "New frame",
            tone: "blue",
        };
        setLayout((current) => ({ ...current, frames: [...current.frames, frame] }));
        setSelection({ kind: "frame", id: frame.id });
        setTool("select");
    }, [canvasSize.height, canvasSize.width, layout.snapToGrid, layout.viewport, selection]);

    const removeSelection = useCallback(() => {
        if (!selection || selection.kind === "node") return;
        setLayout((current) => {
            if (selection.kind === "note") return { ...current, notes: current.notes.filter((note) => note.id !== selection.id), edges: current.edges.filter((edge) => edge.sourceId !== selection.id && edge.targetId !== selection.id) };
            if (selection.kind === "frame") return { ...current, frames: current.frames.filter((frame) => frame.id !== selection.id), edges: current.edges.filter((edge) => edge.sourceId !== selection.id && edge.targetId !== selection.id) };
            return { ...current, edges: current.edges.filter((edge) => edge.id !== selection.id) };
        });
        setSelection(null);
    }, [selection]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (isTypingTarget(event.target)) return;
            if (event.code === "Space") {
                event.preventDefault();
                spaceRef.current = true;
                return;
            }
            const key = event.key.toLowerCase();
            if (key === "escape") {
                setSelection(null);
                setConnectorSource(null);
                setTool("select");
            } else if (key === "delete" || key === "backspace") {
                removeSelection();
            } else if (key === "v") setTool("select");
            else if (key === "h") setTool("hand");
            else if (key === "n") setTool("note");
            else if (key === "f") setTool("frame");
            else if (key === "c") setTool("connector");
            else if (key === "0") fitCanvas();
            else if (key === "1") setViewport({ zoom: 1 });
        };
        const onKeyUp = (event: KeyboardEvent) => {
            if (event.code === "Space") spaceRef.current = false;
        };
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
        };
    }, [fitCanvas, removeSelection, setViewport]);

    const openNode = useCallback((node: LiveNode) => {
        if (node.tab) onOpenTab(node.tab);
        else if (node.target) onNavigate?.(node.target);
    }, [onNavigate, onOpenTab]);

    const selectedNode = selection?.kind === "node" ? nodes.find((node) => node.id === selection.id) : undefined;
    const selectedRepo = selectedNode?.kind === "repo" && selectedNode.entityId
        ? project.repos?.find((repo) => repo.id === selectedNode.entityId)
        : undefined;
    const selectedRepoPath = selectedRepo ? repoPath(project.sourcePath, selectedRepo.path) : "";
    const selectedRepoState = selectedRepoPath ? state.sourceControl[selectedRepoPath] : undefined;
    const selectedRepoBranches = selectedRepoState?.branches?.filter((branch) => !branch.remote) ?? [];
    const selectedNote = selection?.kind === "note" ? layout.notes.find((note) => note.id === selection.id) : undefined;
    const selectedFrame = selection?.kind === "frame" ? layout.frames.find((frame) => frame.id === selection.id) : undefined;
    const selectedEdge = selection?.kind === "edge" ? layout.edges.find((edge) => edge.id === selection.id) : undefined;
    const selectedWire = selection?.kind === "wire" ? derivedEdges.find((edge) => edge.id === selection.id) : undefined;
    const inspectorOpen = Boolean(selectedNode || selectedNote || selectedFrame || selectedEdge || selectedWire);

    // Live traffic for a selected pipeline wire: log lines touching the wire's task or agent.
    const wireTraffic = useMemo(() => {
        if (!selectedWire) return [];
        const taskId = selectedWire.targetId.startsWith("task:") ? selectedWire.targetId.slice(5) : selectedWire.sourceId.startsWith("task:") ? selectedWire.sourceId.slice(5) : null;
        const agentId = selectedWire.sourceId.startsWith("agent:") ? selectedWire.sourceId.slice(6) : null;
        const agentName = agentId ? projectAgents.find((agent) => agent.id === agentId)?.config.name ?? null : null;
        const needles = [taskId ? `[task ${taskId.slice(-6)}]` : null, agentName].filter(Boolean) as string[];
        if (needles.length === 0) return [];
        return (state.logs ?? []).filter((line) => needles.some((needle) => line.message.includes(needle))).slice(-30).reverse();
    }, [selectedWire, projectAgents, state.logs]);

    const updateNote = (patch: Partial<CanvasNote>) => selectedNote && setLayout((current) => ({ ...current, notes: current.notes.map((note) => note.id === selectedNote.id ? { ...note, ...patch } : note) }));
    const updateFrame = (patch: Partial<CanvasFrame>) => selectedFrame && setLayout((current) => ({ ...current, frames: current.frames.map((frame) => frame.id === selectedFrame.id ? { ...frame, ...patch } : frame) }));

    const TONES: CanvasTone[] = ["amber", "blue", "green", "purple", "gray"];

    // Right-click a live node → open it + entity-aware quick actions (agent / task).
    const nodeMenu = useCallback((node: LiveNode): MenuItem[] => {
        const items: MenuItem[] = [
            { header: node.title },
            { key: "open", label: `Open ${node.tab ? PROJECT_TAB_LABEL[node.tab] : "view"}`, icon: Maximize02, onClick: () => openNode(node) },
        ];
        if (node.kind === "agent" && node.entityId) {
            const agent = projectAgents.find((a) => a.id === node.entityId);
            if (agent) {
                const active = agent.status === "working" || agent.status === "thinking";
                items.push(
                    agent.status === "paused"
                        ? { key: "resume", label: "Resume", icon: Play, onClick: () => actions.resumeAgent(agent.id) }
                        : { key: "pause", label: "Pause", icon: PauseCircle, disabled: active, onClick: () => actions.pauseAgent(agent.id) },
                );
                items.push({ key: "term", label: "Open terminal", icon: Terminal, onClick: () => actions.terminalCreate({ agentId: agent.id, projectId: project.id, cwd: project.sourcePath }) });
            }
        }
        if (node.kind === "task" && node.entityId) {
            const task = projectTasks.find((t) => t.id === node.entityId);
            if (task) {
                const bump = nextPriority(task.priority);
                if (bump && (task.status === "pending" || task.status === "assigned" || task.status === "in_progress")) {
                    items.push({ key: "bump", label: "Bump priority", icon: ArrowUp, onClick: () => actions.reprioritizeTask(task.id, bump) });
                }
                if (task.status !== "completed" && task.status !== "cancelled") {
                    items.push({ key: "cancel", label: "Cancel task", icon: XClose, danger: true, onClick: () => actions.cancelTask(task.id) });
                }
            }
        }
        items.push({ separator: true });
        items.push({ key: "connect", label: "Connect from here", icon: Link01, onClick: () => { setSelection(null); setConnectorSource(node.id); setTool("connector"); } });
        return items;
    }, [actions, openNode, project.id, project.sourcePath, projectAgents, projectTasks]);

    const toneSubmenu = useCallback((id: string, current: CanvasTone, kind: "note" | "frame"): MenuItem => ({
        key: "color",
        label: "Color",
        icon: StickerSquare,
        submenu: TONES.map((t) => ({
            key: `tone-${t}`,
            label: t.charAt(0).toUpperCase() + t.slice(1),
            checked: current === t,
            onClick: () => setLayout((cur) => kind === "note"
                ? { ...cur, notes: cur.notes.map((n) => (n.id === id ? { ...n, tone: t } : n)) }
                : { ...cur, frames: cur.frames.map((f) => (f.id === id ? { ...f, tone: t } : f)) }),
        })),
    }), []);

    const noteMenu = useCallback((note: CanvasNote): MenuItem[] => [
        { header: "Note" },
        { key: "edit", label: "Edit note", icon: Cursor01, onClick: () => setSelection({ kind: "note", id: note.id }) },
        toneSubmenu(note.id, note.tone, "note"),
        { separator: true },
        { key: "del", label: "Delete note", icon: Trash01, danger: true, onClick: () => { setLayout((cur) => ({ ...cur, notes: cur.notes.filter((n) => n.id !== note.id), edges: cur.edges.filter((e) => e.sourceId !== note.id && e.targetId !== note.id) })); setSelection(null); } },
    ], [toneSubmenu]);

    const frameMenu = useCallback((frame: CanvasFrame): MenuItem[] => [
        { header: "Frame" },
        { key: "edit", label: "Edit frame", icon: Cursor01, onClick: () => setSelection({ kind: "frame", id: frame.id }) },
        toneSubmenu(frame.id, frame.tone, "frame"),
        { separator: true },
        { key: "del", label: "Delete frame", icon: Trash01, danger: true, onClick: () => { setLayout((cur) => ({ ...cur, frames: cur.frames.filter((f) => f.id !== frame.id), edges: cur.edges.filter((e) => e.sourceId !== frame.id && e.targetId !== frame.id) })); setSelection(null); } },
    ], [toneSubmenu]);

    // Right-click empty canvas → place objects at the cursor + view controls.
    const bgMenu = useCallback((clientX: number, clientY: number): MenuItem[] => {
        const point = worldPoint(clientX, clientY);
        return [
            { header: "Canvas" },
            { key: "note", label: "Add note here", icon: StickerSquare, onClick: () => {
                const note: CanvasNote = { id: canvasObjectId("note"), x: snapValue(point.x - 110, layout.snapToGrid), y: snapValue(point.y - 36, layout.snapToGrid), width: 240, height: 170, title: "New note", body: "Add context, a decision, or an idea...", tone: "amber" };
                setLayout((cur) => ({ ...cur, notes: [...cur.notes, note] }));
                setSelection({ kind: "note", id: note.id });
            } },
            { key: "frame", label: "Add frame here", icon: Framer, onClick: () => {
                const frame: CanvasFrame = { id: canvasObjectId("frame"), x: snapValue(point.x - 40, layout.snapToGrid), y: snapValue(point.y - 30, layout.snapToGrid), width: 560, height: 360, title: "New frame", tone: "blue" };
                setLayout((cur) => ({ ...cur, frames: [...cur.frames, frame] }));
                setSelection({ kind: "frame", id: frame.id });
            } },
            { separator: true },
            { key: "fit", label: "Fit all", icon: Maximize02, onClick: fitCanvas },
            { key: "reset", label: "Reset layout", icon: RefreshCcw01, onClick: resetLayout },
            { key: "grid", label: layout.gridVisible ? "Hide grid" : "Show grid", icon: Grid01, checked: layout.gridVisible, onClick: () => setLayout((cur) => ({ ...cur, gridVisible: !cur.gridVisible })) },
            { key: "snap", label: layout.snapToGrid ? "Disable snap" : "Snap to grid", icon: Target04, checked: layout.snapToGrid, onClick: () => setLayout((cur) => ({ ...cur, snapToGrid: !cur.snapToGrid })) },
        ];
    }, [fitCanvas, layout.gridVisible, layout.snapToGrid, resetLayout, worldPoint]);

    const cursor = dragRef.current?.mode === "pan" ? "grabbing" : tool === "hand" ? "grab" : tool === "note" || tool === "frame" || tool === "connector" ? "crosshair" : "default";
    const markerPrefix = `canvas-${project.id.replace(/[^a-zA-Z0-9]/g, "")}`;

    return (
        <div
            ref={canvasRef}
            role="application"
            aria-label={`${project.name} visual canvas`}
            className="relative size-full min-h-[32rem] overflow-hidden outline-none"
            style={{
                cursor,
                touchAction: "none",
                backgroundColor: "var(--app-bg)",
                backgroundImage: layout.gridVisible ? "radial-gradient(circle, color-mix(in srgb, var(--c-text-muted) 34%, transparent) 1px, transparent 1.2px)" : undefined,
                backgroundSize: layout.gridVisible ? `${GRID_SIZE * layout.viewport.zoom}px ${GRID_SIZE * layout.viewport.zoom}px` : undefined,
                backgroundPosition: layout.gridVisible ? `${layout.viewport.x}px ${layout.viewport.y}px` : undefined,
            }}
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onWheel={handleWheel}
            onContextMenu={(event) => { const t = event.target as HTMLElement; if (t.closest("[data-canvas-object='true']")) return; event.preventDefault(); ctx.open(event, bgMenu(event.clientX, event.clientY)); }}
        >
            <div className="absolute left-3 top-3 z-40 flex flex-col gap-1 rounded-lg p-1.5 shadow-lg" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}>
                <ToolButton tool="select" active={tool === "select"} icon={Cursor01} label="Select" shortcut="V" onClick={setTool} />
                <ToolButton tool="hand" active={tool === "hand"} icon={Hand} label="Hand" shortcut="H" onClick={setTool} />
                <div className="my-0.5 h-px" style={{ background: "var(--c-border)" }} />
                <ToolButton tool="note" active={tool === "note"} icon={StickerSquare} label="Note" shortcut="N" onClick={setTool} />
                <ToolButton tool="frame" active={tool === "frame"} icon={Framer} label="Frame" shortcut="F" onClick={setTool} />
                <ToolButton tool="connector" active={tool === "connector"} icon={Link01} label="Connector" shortcut="C" onClick={setTool} />
            </div>

            <div className="absolute top-3 z-40 flex items-center gap-1.5 rounded-lg p-1.5 shadow-lg transition-[right]" style={{ right: inspectorOpen ? 342 : 12, background: "var(--surface)", border: "1px solid var(--c-border)" }}>
                <span className="mr-1 flex items-center gap-1.5 px-1.5 text-[11px] text-tertiary">
                    <span className="size-1.5 rounded-full" style={{ background: state.connected ? "var(--c-success)" : "var(--c-error)" }} />
                    {nodes.length} objects
                </span>
                <ButtonUtility icon={Grid01} tooltip={layout.gridVisible ? "Hide grid" : "Show grid"} color={layout.gridVisible ? "secondary" : "tertiary"} onClick={() => setLayout((current) => ({ ...current, gridVisible: !current.gridVisible }))} />
                <ButtonUtility icon={Target04} tooltip={layout.snapToGrid ? "Disable snap" : "Snap to grid"} color={layout.snapToGrid ? "secondary" : "tertiary"} onClick={() => setLayout((current) => ({ ...current, snapToGrid: !current.snapToGrid }))} />
                <div className="mx-0.5 h-5 w-px" style={{ background: "var(--c-border)" }} />
                <ButtonUtility icon={Maximize02} tooltip="Fit all / 0" onClick={fitCanvas} />
            </div>

            <div
                className="absolute left-0 top-0"
                style={{ width: WORLD_WIDTH, height: WORLD_HEIGHT, transform: `translate3d(${layout.viewport.x}px, ${layout.viewport.y}px, 0) scale(${layout.viewport.zoom})`, transformOrigin: "0 0", willChange: "transform", pointerEvents: "none" }}
            >
                {layout.frames.map((frame) => {
                    const selected = selection?.kind === "frame" && selection.id === frame.id;
                    const tone = TONE_STYLE[frame.tone];
                    return (
                        <div
                            key={frame.id}
                            data-canvas-object="true"
                            className="absolute rounded-lg border border-dashed pointer-events-auto"
                            style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height, borderColor: selected ? "var(--brand)" : tone.border, background: `color-mix(in srgb, ${tone.fill} 46%, transparent)`, boxShadow: selected ? "0 0 0 2px color-mix(in srgb, var(--brand) 24%, transparent)" : undefined }}
                            onPointerDown={(event) => startMove(event, { kind: "frame", id: frame.id }, frame.x, frame.y)}
                            onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setSelection({ kind: "frame", id: frame.id }); ctx.open(event, frameMenu(frame)); }}
                        >
                            <span className="absolute -top-7 left-0 max-w-full truncate rounded-md px-2 py-1 text-xs font-semibold" title={frame.title} style={{ color: tone.ink, background: "var(--surface)", border: `1px solid ${tone.border}` }}>{frame.title}</span>
                        </div>
                    );
                })}

                <svg className="absolute inset-0 overflow-visible" width={WORLD_WIDTH} height={WORLD_HEIGHT} aria-hidden style={{ pointerEvents: "none" }}>
                    <defs>
                        <marker id={`${markerPrefix}-assignment`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="var(--brand)" /></marker>
                        <marker id={`${markerPrefix}-dependency`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="var(--c-warning)" /></marker>
                        <marker id={`${markerPrefix}-manual`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="var(--c-text-muted)" /></marker>
                    </defs>
                    <style>{`@keyframes coretexWireFlow { to { stroke-dashoffset: -24; } }`}</style>
                    {derivedEdges.map((edge) => {
                        const source = rectById.get(edge.sourceId);
                        const target = rectById.get(edge.targetId);
                        if (!source || !target) return null;
                        const color = edge.kind === "assignment" ? "var(--brand)" : "var(--c-warning)";
                        const selected = selection?.kind === "wire" && selection.id === edge.id;
                        const d = edgePath(source, target);
                        return (
                            <g key={edge.id}>
                                <path d={d} fill="none" stroke={color} strokeWidth={selected ? 2.5 : 1.5} strokeDasharray={edge.kind === "dependency" ? "6 5" : undefined} opacity={selected ? 1 : 0.72} vectorEffect="non-scaling-stroke" markerEnd={`url(#${markerPrefix}-${edge.kind})`} />
                                {/* Flow overlay: a moving dash train that reads as data streaming along the wire. */}
                                <path d={d} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeDasharray="3 21" opacity="0.9" vectorEffect="non-scaling-stroke" style={{ animation: "coretexWireFlow 1.1s linear infinite" }} />
                                <path data-canvas-object="true" d={d} fill="none" stroke="transparent" strokeWidth="14" vectorEffect="non-scaling-stroke" style={{ pointerEvents: "stroke", cursor: "pointer" }} onPointerDown={(event) => { event.stopPropagation(); setSelection({ kind: "wire", id: edge.id }); }} />
                            </g>
                        );
                    })}
                    {layout.edges.map((edge) => {
                        const source = rectById.get(edge.sourceId);
                        const target = rectById.get(edge.targetId);
                        if (!source || !target) return null;
                        const d = edgePath(source, target);
                        const selected = selection?.kind === "edge" && selection.id === edge.id;
                        return (
                            <g key={edge.id}>
                                <path d={d} fill="none" stroke={selected ? "var(--brand)" : "var(--c-text-muted)"} strokeWidth={selected ? 2.5 : 1.5} strokeDasharray="4 5" opacity="0.88" vectorEffect="non-scaling-stroke" markerEnd={`url(#${markerPrefix}-manual)`} />
                                <path data-canvas-object="true" d={d} fill="none" stroke="transparent" strokeWidth="14" vectorEffect="non-scaling-stroke" style={{ pointerEvents: "stroke", cursor: "pointer" }} onPointerDown={(event) => { event.stopPropagation(); setSelection({ kind: "edge", id: edge.id }); }} />
                            </g>
                        );
                    })}
                </svg>

                {nodes.map((node) => {
                    const selected = selection?.kind === "node" && selection.id === node.id;
                    const isSource = connectorSource === node.id;
                    const Icon = node.icon;
                    const agent = node.kind === "agent" ? projectAgents.find((item) => item.id === node.entityId) : undefined;
                    return (
                        <div
                            key={node.id}
                            data-canvas-object="true"
                            role="group"
                            tabIndex={0}
                            aria-label={`${node.eyebrow}: ${node.title}`}
                            title={`${node.title}${node.description ? ` — ${node.description}` : ""}`}
                            className="absolute flex flex-col overflow-hidden rounded-lg p-3.5 shadow-sm pointer-events-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                            style={{ left: node.x, top: node.y, width: node.width, height: node.height, background: "var(--surface)", border: `1px solid ${selected || isSource ? "var(--brand)" : "var(--c-border)"}`, boxShadow: selected || isSource ? "0 0 0 2px color-mix(in srgb, var(--brand) 18%, transparent), 0 12px 30px color-mix(in srgb, #000 12%, transparent)" : "0 8px 20px color-mix(in srgb, #000 8%, transparent)" }}
                            onPointerDown={(event) => startMove(event, { kind: "node", id: node.id }, node.x, node.y)}
                            onDoubleClick={() => openNode(node)}
                            onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setSelection({ kind: "node", id: node.id }); ctx.open(event, nodeMenu(node)); }}
                            onFocus={() => setSelection({ kind: "node", id: node.id })}
                        >
                            <div className="flex items-start gap-2.5">
                                {node.kind === "project" ? (
                                    <ProjectIcon icon={project.icon} color={project.color} size={32} />
                                ) : agent ? (
                                    <IdentityAvatar identity={agent.config.identity} name={agent.config.name} avatarUrl={agent.config.avatarUrl} size={32} />
                                ) : (
                                    <span className="grid size-8 shrink-0 place-items-center rounded-md" style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}><Icon className="size-4 text-brand-secondary" /></span>
                                )}
                                <div className="min-w-0 flex-1">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-quaternary">{node.eyebrow}</p>
                                    <p className="line-clamp-2 break-words text-sm font-semibold leading-4 text-primary [overflow-wrap:anywhere]" title={node.title}>{node.title}</p>
                                </div>
                                {node.status && <Badge type="pill-color" size="sm" color={node.status.color}>{node.status.label}</Badge>}
                            </div>
                            <p className="mt-2 line-clamp-2 text-xs leading-5 text-tertiary" title={node.description}>{node.description}</p>
                            <div className="mt-auto flex items-end justify-between gap-2">
                                <div className="min-w-0 text-[10px] text-quaternary">{node.meta.slice(0, 2).map((item) => <span key={item} className="mr-2 inline-block max-w-36 truncate align-bottom" title={item}>{item}</span>)}</div>
                                <button type="button" onClick={(event) => { event.stopPropagation(); openNode(node); }} className="shrink-0 rounded-md px-2 py-1 text-[10px] font-semibold text-brand-secondary transition hover:bg-[var(--surface-2)]">Open</button>
                            </div>
                            {(tool === "connector" || isSource) && <><span className="absolute -left-1.5 top-1/2 size-3 -translate-y-1/2 rounded-full border-2 border-[var(--surface)] bg-[var(--brand)]" /><span className="absolute -right-1.5 top-1/2 size-3 -translate-y-1/2 rounded-full border-2 border-[var(--surface)] bg-[var(--brand)]" /></>}
                        </div>
                    );
                })}

                {layout.notes.map((note) => {
                    const selected = selection?.kind === "note" && selection.id === note.id;
                    const isSource = connectorSource === note.id;
                    const tone = TONE_STYLE[note.tone];
                    return (
                        <div key={note.id} data-canvas-object="true" className="absolute flex flex-col overflow-hidden rounded-lg p-3 shadow-md pointer-events-auto" style={{ left: note.x, top: note.y, width: note.width, height: note.height, background: tone.fill, border: `1px solid ${selected || isSource ? "var(--brand)" : tone.border}`, boxShadow: selected || isSource ? "0 0 0 2px color-mix(in srgb, var(--brand) 20%, transparent)" : undefined }} onPointerDown={(event) => startMove(event, { kind: "note", id: note.id }, note.x, note.y)} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setSelection({ kind: "note", id: note.id }); ctx.open(event, noteMenu(note)); }}>
                            <div className="flex min-w-0 items-center gap-2"><StickerSquare className="size-4 shrink-0" style={{ color: tone.ink }} /><span className="truncate text-sm font-semibold text-primary" title={note.title}>{note.title}</span></div>
                            <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-secondary">{note.body}</p>
                        </div>
                    );
                })}

                {alignGuides.v != null && <div className="pointer-events-none absolute" style={{ left: alignGuides.v, top: 0, width: 1, height: WORLD_HEIGHT, background: "var(--brand)", opacity: 0.6 }} aria-hidden="true" />}
                {alignGuides.h != null && <div className="pointer-events-none absolute" style={{ top: alignGuides.h, left: 0, height: 1, width: WORLD_WIDTH, background: "var(--brand)", opacity: 0.6 }} aria-hidden="true" />}
            </div>

            <div className="absolute bottom-3 left-3 z-40 flex items-center gap-2">
                <div className="flex items-center gap-1 rounded-lg p-1 shadow-md" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}>
                    <ButtonUtility icon={ZoomOut} tooltip="Zoom out" onClick={() => setViewport({ zoom: clampZoom(layout.viewport.zoom - 0.1) })} />
                    <span className="min-w-12 text-center text-xs font-medium tabular-nums text-secondary">{Math.round(layout.viewport.zoom * 100)}%</span>
                    <ButtonUtility icon={ZoomIn} tooltip="Zoom in" onClick={() => setViewport({ zoom: clampZoom(layout.viewport.zoom + 0.1) })} />
                </div>
                <span className="rounded-lg p-1 shadow-md" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}><ButtonUtility icon={RefreshCcw01} tooltip="Reset zoom and pan" onClick={resetView} /></span>
            </div>

            <CanvasActionDock
                label="Project graph actions"
                viewModes={PROJECT_CANVAS_DOCK_VIEWS}
                activeView="graph"
                onViewChange={(view) => {
                    if (view === "overview") onOpenTab("overview");
                }}
                inspectorOpen={inspectorOpen}
                actions={[
                    {
                        id: "add-note",
                        label: "Add note",
                        icon: StickerSquare,
                        onClick: addNoteAtCenter,
                        description: "Place an editable note at the center of the graph",
                        shortcut: "N",
                    },
                    {
                        id: "add-frame",
                        label: "Add frame",
                        icon: Framer,
                        onClick: addFrameAtCenter,
                        description: "Group related graph objects in a frame",
                        shortcut: "F",
                    },
                    {
                        id: "connect-objects",
                        label: connectorSource ? "Cancel connection" : "Connect objects",
                        icon: Link01,
                        onClick: () => {
                            if (connectorSource || tool === "connector") {
                                setConnectorSource(null);
                                setTool("select");
                            } else {
                                setSelection(null);
                                setTool("connector");
                            }
                        },
                        description: connectorSource ? "Cancel the current connector" : "Choose two graph objects to connect",
                        shortcut: "C",
                        active: tool === "connector",
                    },
                    {
                        id: "fit-project-graph",
                        label: "Fit graph",
                        icon: Maximize02,
                        onClick: fitCanvas,
                        description: "Fit every project object in the viewport",
                        shortcut: "0",
                    },
                ]}
                primaryAction={{
                    id: "add-task",
                    label: "Add task",
                    icon: Columns01,
                    onClick: () => onOpenTab("kanban"),
                    description: "Open the project task composer",
                    tone: "brand",
                }}
            />

            {inspectorOpen && (
                <aside className="absolute bottom-3 right-3 top-3 z-50 flex w-80 flex-col overflow-hidden rounded-lg shadow-xl" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }} aria-label="Canvas inspector">
                    <div className="flex items-start justify-between gap-3 border-b px-4 py-3" style={{ borderColor: "var(--c-border)" }}>
                        <div className="min-w-0 flex-1"><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-quaternary">Inspector</p><p className="break-words text-sm font-semibold leading-5 text-primary [overflow-wrap:anywhere]" title={selectedNode?.title ?? selectedNote?.title ?? selectedFrame?.title ?? undefined}>{selectedNode?.title ?? selectedNote?.title ?? selectedFrame?.title ?? (selectedWire ? (selectedWire.kind === "assignment" ? "Pipeline wire" : "Dependency wire") : "Connector")}</p></div>
                        <ButtonUtility icon={XClose} tooltip="Close inspector" color="tertiary" onClick={() => setSelection(null)} />
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto p-4">
                        {selectedNode && (
                            <div className="flex flex-col gap-4">
                                <div className="rounded-lg p-3" style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}>
                                    <p className="text-xs font-semibold text-secondary">{selectedNode.eyebrow}</p>
                                    <p className="mt-1 text-sm leading-6 text-primary">{selectedNode.description}</p>
                                    <div className="mt-2 flex flex-wrap gap-1.5">{selectedNode.meta.map((item) => <Badge key={item} size="sm" color="gray">{item}</Badge>)}</div>
                                </div>
                                {selectedNode.kind === "task" && selectedNode.entityId && (() => {
                                    const task = projectTasks.find((item) => item.id === selectedNode.entityId);
                                    const bump = task ? nextPriority(task.priority) : null;
                                    return task && (task.status === "pending" || task.status === "assigned" || task.status === "in_progress") ? (
                                        <div className="flex gap-2"><Button size="sm" color="secondary" iconLeading={ArrowUp} isDisabled={!bump || !state.connected} onClick={() => bump && actions.reprioritizeTask(task.id, bump)}>Bump</Button><Button size="sm" color="secondary-destructive" isDisabled={!state.connected} onClick={() => actions.cancelTask(task.id)}>Cancel</Button></div>
                                    ) : null;
                                })()}
                                {selectedNode.kind === "agent" && selectedNode.entityId && (() => {
                                    const agent = projectAgents.find((item) => item.id === selectedNode.entityId);
                                    if (!agent) return null;
                                    const active = agent.status === "working" || agent.status === "thinking";
                                    return <div className="flex flex-wrap gap-2">{agent.status === "paused" ? <Button size="sm" color="secondary" iconLeading={Play} isDisabled={!state.connected} onClick={() => actions.resumeAgent(agent.id)}>Resume</Button> : <Button size="sm" color="secondary" iconLeading={PauseCircle} isDisabled={!state.connected || active} onClick={() => actions.pauseAgent(agent.id)}>Pause</Button>}<Button size="sm" color="secondary" iconLeading={Terminal} isDisabled={!state.connected} onClick={() => actions.terminalCreate({ agentId: agent.id, projectId: project.id, cwd: project.sourcePath })}>Terminal</Button></div>;
                                })()}
                                {selectedRepo && selectedRepoPath && (
                                    <div className="flex flex-col gap-3 rounded-lg p-3" style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}>
                                        <label className="text-xs font-medium text-secondary">
                                            Active branch
                                            <select
                                                aria-label="Active repository branch"
                                                value={selectedRepoState?.summary?.branch ?? ""}
                                                disabled={!state.connected || selectedRepoBranches.length === 0}
                                                onChange={(event) => {
                                                    const branch = event.target.value;
                                                    if (!branch || branch === selectedRepoState?.summary?.branch) return;
                                                    actions.gitCheckout(selectedRepoPath, branch);
                                                    window.setTimeout(() => {
                                                        actions.gitSummary(selectedRepoPath);
                                                        actions.gitBranches(selectedRepoPath);
                                                    }, 700);
                                                }}
                                                className="mt-1.5 w-full rounded-md px-2.5 py-2 text-xs text-primary outline-none focus:ring-2 focus:ring-[var(--brand)] disabled:opacity-50"
                                                style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}
                                            >
                                                {selectedRepoState?.summary?.branch && <option value={selectedRepoState.summary.branch}>{selectedRepoState.summary.branch}</option>}
                                                {selectedRepoBranches.filter((branch) => branch.name !== selectedRepoState?.summary?.branch).map((branch) => <option key={branch.name} value={branch.name}>{branch.name}</option>)}
                                            </select>
                                        </label>
                                        <div className="grid grid-cols-2 gap-2">
                                            <Button
                                                size="sm"
                                                color="secondary"
                                                iconLeading={ArrowDown}
                                                isDisabled={!state.connected}
                                                onClick={() => {
                                                    actions.gitPull(selectedRepoPath, selectedRepo.github ? `${selectedRepo.github.owner}/${selectedRepo.github.repo}` : undefined);
                                                    window.setTimeout(() => actions.gitSummary(selectedRepoPath), 700);
                                                }}
                                            >
                                                Pull{selectedRepoState?.summary?.behind ? ` (${selectedRepoState.summary.behind})` : ""}
                                            </Button>
                                            <Button
                                                size="sm"
                                                color="secondary"
                                                iconLeading={ArrowUp}
                                                isDisabled={!state.connected}
                                                onClick={() => {
                                                    actions.gitPush(selectedRepoPath, !selectedRepoState?.summary?.upstream, selectedRepo.github ? `${selectedRepo.github.owner}/${selectedRepo.github.repo}` : undefined);
                                                    window.setTimeout(() => actions.gitSummary(selectedRepoPath), 700);
                                                }}
                                            >
                                                Push{selectedRepoState?.summary?.ahead ? ` (${selectedRepoState.summary.ahead})` : ""}
                                            </Button>
                                        </div>
                                        {selectedRepoState?.lastOp && (
                                            <p className={cx("text-[11px] leading-4", selectedRepoState.lastOp.ok ? "text-success-primary" : "text-error-primary")}>{selectedRepoState.lastOp.message || selectedRepoState.lastOp.error || (selectedRepoState.lastOp.ok ? "Repository updated." : "Git operation failed.")}</p>
                                        )}
                                    </div>
                                )}
                                <Button size="md" color="primary" onClick={() => openNode(selectedNode)}>Open full {selectedNode.tab ? PROJECT_TAB_LABEL[selectedNode.tab] : "view"}</Button>
                            </div>
                        )}
                        {selectedWire && (() => {
                            const sourceRect = rectById.get(selectedWire.sourceId);
                            const targetRect = rectById.get(selectedWire.targetId);
                            const agent = selectedWire.sourceId.startsWith("agent:") ? projectAgents.find((item) => item.id === selectedWire.sourceId.slice(6)) : undefined;
                            const task = selectedWire.targetId.startsWith("task:") ? projectTasks.find((item) => item.id === selectedWire.targetId.slice(5)) : undefined;
                            return (
                                <div className="flex flex-col gap-4">
                                    <div className="rounded-lg p-3" style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}>
                                        <p className="text-xs font-semibold text-secondary">{selectedWire.kind === "assignment" ? "Agent → task assignment" : "Task dependency"}</p>
                                        <p className="mt-1 text-sm leading-6 text-primary">{(sourceRect as { title?: string })?.title ?? selectedWire.sourceId} → {(targetRect as { title?: string })?.title ?? selectedWire.targetId}</p>
                                        <div className="mt-2 flex flex-wrap gap-1.5">
                                            {agent && <Badge size="sm" color="brand">{statusLabel(agent.status)}</Badge>}
                                            {agent && <Badge size="sm" color="gray">{agent.stepCount} steps</Badge>}
                                            {task && <Badge size="sm" color="gray">{task.status}</Badge>}
                                            {task?.priority && <Badge size="sm" color="warning">{task.priority}</Badge>}
                                        </div>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-quaternary">Live traffic</p>
                                        {wireTraffic.length === 0 ? (
                                            <p className="mt-2 text-xs text-tertiary">No recent messages on this wire. Activity appears here as the agent works the task.</p>
                                        ) : (
                                            <ul className="mt-2 flex max-h-72 flex-col gap-1.5 overflow-y-auto">
                                                {wireTraffic.map((line, index) => (
                                                    <li key={`${line.timestamp}-${index}`} className="rounded-md px-2.5 py-1.5 text-[11px] leading-4" style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}>
                                                        <span className="block truncate text-quaternary">{new Date(line.timestamp).toLocaleTimeString()}</span>
                                                        <span className="text-secondary">{line.message}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                </div>
                            );
                        })()}
                        {selectedNote && <LocalInspector title="Note" tone={selectedNote.tone} name={selectedNote.title} body={selectedNote.body} onName={(title) => updateNote({ title })} onBody={(body) => updateNote({ body })} onTone={(tone) => updateNote({ tone })} onDelete={removeSelection} />}
                        {selectedFrame && <LocalInspector title="Frame" tone={selectedFrame.tone} name={selectedFrame.title} onName={(title) => updateFrame({ title })} onTone={(tone) => updateFrame({ tone })} onDelete={removeSelection} />}
                        {selectedEdge && <div className="flex flex-col gap-4"><label className="text-xs font-medium text-secondary">Connector label<input value={selectedEdge.label} onChange={(event) => setLayout((current) => ({ ...current, edges: current.edges.map((edge) => edge.id === selectedEdge.id ? { ...edge, label: event.target.value } : edge) }))} placeholder="Optional label" className="mt-1.5 w-full rounded-md px-3 py-2 text-sm text-primary outline-none focus:ring-2 focus:ring-[var(--brand)]" style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }} /></label><Button size="sm" color="secondary-destructive" iconLeading={Trash01} onClick={removeSelection}>Delete connector</Button></div>}
                    </div>
                </aside>
            )}
            {ctx.node}
        </div>
    );
}

const PROJECT_TAB_LABEL: Record<ProjectTab, string> = {
    overview: "overview",
    canvas: "canvas",
    agents: "agents",
    kanban: "Kanban",
    queue: "queue",
    documents: "documents",
    git: "source control",
    secrets: "secrets",
    chat: "chat",
    terminals: "terminals",
    billing: "billing",
    settings: "settings",
};

function LocalInspector({ title, tone, name, body, onName, onBody, onTone, onDelete }: { title: string; tone: CanvasTone; name: string; body?: string; onName: (value: string) => void; onBody?: (value: string) => void; onTone: (tone: CanvasTone) => void; onDelete: () => void }) {
    const tones: CanvasTone[] = ["amber", "blue", "green", "purple", "gray"];
    return (
        <div className="flex flex-col gap-4">
            <label className="text-xs font-medium text-secondary">{title} title<input value={name} onChange={(event) => onName(event.target.value)} className="mt-1.5 w-full rounded-md px-3 py-2 text-sm text-primary outline-none focus:ring-2 focus:ring-[var(--brand)]" style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }} /></label>
            {onBody && <label className="text-xs font-medium text-secondary">Body<textarea value={body} onChange={(event) => onBody(event.target.value)} rows={6} className="mt-1.5 w-full resize-none rounded-md px-3 py-2 text-sm text-primary outline-none focus:ring-2 focus:ring-[var(--brand)]" style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }} /></label>}
            <div><p className="mb-2 text-xs font-medium text-secondary">Color</p><div className="flex gap-2">{tones.map((item) => <button key={item} type="button" aria-label={`${item} tone`} aria-pressed={tone === item} onClick={() => onTone(item)} className="size-7 rounded-md" style={{ background: TONE_STYLE[item].fill, border: `2px solid ${tone === item ? "var(--brand)" : TONE_STYLE[item].border}` }} />)}</div></div>
            <Button size="sm" color="secondary-destructive" iconLeading={Trash01} onClick={onDelete}>Delete {title.toLowerCase()}</Button>
        </div>
    );
}
