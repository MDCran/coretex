// @ts-nocheck
"use client";

// Coretex — universal command palette / search. A bottom-center "AI search bar"
// that expands into an advanced, typo-tolerant search across everything in the app:
// every screen, agents, projects, files, databases, docker, remote, servers,
// terminals, env vars, API keys, calendar, emails, plans, councils, analytics,
// every settings page + toggle, and theme. Ctrl/Cmd+K opens it from anywhere.

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { FC } from "react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { SearchMd, Stars01, Home01, LineChartUp03, MessageChatCircle, Users01, ClipboardCheck, Mail01, Key01, Key02, Calendar, Folder, FolderCode, Database01, Cube01, Server01, Signal01, Terminal, Globe01, Settings01, Sun, Moon01, Monitor01, Plus, Zap, ShieldTick, CornerDownLeft, ArrowUp, ArrowDown, Lightning01, Play, PauseCircle, StopCircle, ChevronDown, XClose, ArrowRight, Command, Palette, Keyboard01, BankNote01, Activity, ActivityHeart, Beaker01, CheckSquare, GitBranch01 } from "@untitledui/icons";
import { liveModels, modelAvailability, type CoretexActions, type CoretexState } from "../use-coretex";
import type { NavTarget } from "../nav";
import { useTheme, type ThemeMode } from "../theme";
import { roleLabel, providerLabel } from "../labels";
import { cx } from "@/utils/cx";
import { ProjectIcon } from "./project-icon";
import { IdentityAvatar } from "./identity-avatar";
import { MicButton } from "./mic-button";
import { speechOptsFor } from "./speech-opts";

// ---- fuzzy matching (typo-tolerant) ----
function editDistance(a: string, b: string): number {
    const m = a.length,
        n = b.length;
    if (!m) return n;
    if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    const cur = new Array<number>(n + 1).fill(0);
    for (let i = 1; i <= m; i++) {
        cur[0] = i;
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        }
        prev = cur.slice();
    }
    return prev[n];
}

function isSubsequence(q: string, s: string): boolean {
    let i = 0;
    for (let j = 0; j < s.length && i < q.length; j++) if (s[j] === q[i]) i++;
    return i === q.length;
}

type IconCmp = FC<{ className?: string; style?: React.CSSProperties }>;

interface SearchItem {
    id: string;
    title: string;
    subtitle?: string;
    category: string;
    keywords?: string;
    icon: IconCmp;
    run: () => void;
}

/** Score an item against the query. 0 = no match. Tolerant of spelling errors. */
function scoreItem(q: string, item: SearchItem): number {
    const title = item.title.toLowerCase();
    const extra = `${item.subtitle ?? ""} ${item.keywords ?? ""} ${item.category}`.toLowerCase();
    let s = 0;
    if (title === q) s = 1000;
    else if (title.startsWith(q)) s = 820;
    else if (title.includes(q)) s = 640 - Math.min(120, title.indexOf(q));
    if (extra.includes(q)) s = Math.max(s, 430);

    const qTokens = q.split(/\s+/).filter(Boolean);
    const hayTokens = `${title} ${extra}`.split(/[\s/_.-]+/).filter(Boolean);
    if (qTokens.length) {
        let tokenScore = 0;
        for (const qt of qTokens) {
            let best = 0;
            for (const ht of hayTokens) {
                if (ht === qt) {
                    best = Math.max(best, 340);
                    continue;
                }
                if (ht.startsWith(qt)) {
                    best = Math.max(best, 300);
                    continue;
                }
                if (ht.includes(qt)) {
                    best = Math.max(best, 260);
                    continue;
                }
                if (qt.length >= 3) {
                    const d = editDistance(qt, ht.slice(0, qt.length + 2));
                    const tol = qt.length <= 4 ? 1 : 2;
                    if (d <= tol) best = Math.max(best, 240 - d * 50);
                }
            }
            tokenScore += best;
        }
        s = Math.max(s, tokenScore / qTokens.length);
    }
    if (isSubsequence(q.replace(/\s/g, ""), title.replace(/\s/g, ""))) s = Math.max(s, 190);
    return s;
}

const CATEGORY_ORDER = ["Best match", "Go to", "Agents", "Projects", "Tasks", "Servers", "Terminals", "Docker", "Database", "Remote", "Calendar", "Email", "Env vars", "API keys", "Memory", "Settings", "Actions"];

/** Color-coded category badges. Resolved against theme tokens so results read at a glance. */
const CATEGORY_COLOR: Record<string, string> = {
    "Best match": "var(--brand)",
    "Go to": "var(--c-text-secondary)",
    Agents: "var(--brand)",
    Projects: "var(--c-success, #22c55e)",
    Tasks: "var(--c-warning, #f59e0b)",
    Servers: "var(--c-success, #22c55e)",
    Terminals: "var(--c-text-secondary)",
    Docker: "var(--c-success, #22c55e)",
    Database: "var(--c-warning, #f59e0b)",
    Remote: "var(--c-text-secondary)",
    Calendar: "var(--c-warning, #f59e0b)",
    Email: "var(--brand)",
    "Env vars": "var(--c-warning, #f59e0b)",
    "API keys": "var(--c-error, #ef4444)",
    Memory: "var(--brand)",
    Settings: "var(--c-text-secondary)",
    Actions: "var(--brand)",
};
const catColor = (cat: string) => CATEGORY_COLOR[cat] ?? "var(--c-text-secondary)";

type PaletteMode = "search" | "ai";

/** Opened Ask-AI popover width — the bottom pill grows to this on hover for a seamless click. */
const COMPACT_PANEL_W = 440;
/** Full search palette width. */
const FULL_PANEL_W = 680;
/** Collapsed pill resting width (Ask AI + divider + search + ⌘K). */
const LAUNCHER_IDLE_W = 196;
/** Shared placeholder so hover preview and the live field read as the same control. */
const ASK_PLACEHOLDER = "Ask the command-center, or run a command…";

/** Shared Ask composer chrome — used for hover preview and the live open field. */
const AskComposerStrip = ({
    preview,
    placeholder = ASK_PLACEHOLDER,
    inputRef,
    value,
    onChange,
    onKeyDown,
    onSend,
    onSearch,
    speech,
    disabled,
    disabledReason,
}: {
    /** Non-interactive hover preview (text, not an input). */
    preview?: boolean;
    placeholder?: string;
    inputRef?: RefObject<HTMLInputElement | null>;
    value?: string;
    onChange?: (v: string) => void;
    onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
    onSend?: () => void;
    onSearch?: () => void;
    speech?: {
        enabled?: boolean;
        language?: string;
        pushToTalk?: boolean;
        autoSpace?: boolean;
    };
    disabled?: boolean;
    disabledReason?: string;
}) => (
    <div className="flex w-full items-center gap-2.5 px-3.5 py-3">
        <span
            className="flex size-7 shrink-0 items-center justify-center rounded-lg"
            style={{
                background: "color-mix(in srgb, var(--brand) 16%, transparent)",
            }}
        >
            <Stars01 className="size-4" style={{ color: "var(--brand)" }} />
        </span>
        {preview ? <span className="min-w-0 flex-1 truncate text-left text-sm text-quaternary">{placeholder}</span> : <input ref={inputRef} value={value} onChange={(e) => onChange?.(e.target.value)} onKeyDown={onKeyDown} placeholder={placeholder} disabled={disabled} title={disabled ? disabledReason : undefined} className="min-w-0 flex-1 bg-transparent text-sm text-primary outline-none placeholder:text-quaternary" />}
        {!preview && speech?.enabled && <MicButton size="sm" value={value ?? ""} onChange={(next) => onChange?.(next)} onTranscript={() => undefined} language={speech.language} pushToTalk={speech.pushToTalk} autoSpace={speech.autoSpace !== false} disabled={disabled} />}
        {onSearch && (
            <button
                type="button"
                onClick={(e) => {
                    e.stopPropagation();
                    onSearch();
                }}
                className="grid size-7 shrink-0 place-items-center rounded-lg text-quaternary transition hover:bg-[var(--surface-2)] hover:text-secondary"
                title="Search everything (Ctrl+K)"
                aria-label="Search everything"
            >
                <SearchMd className="size-3.5" />
            </button>
        )}
        <button
            type="button"
            onClick={(e) => {
                e.stopPropagation();
                onSend?.();
            }}
            disabled={disabled || (!preview && !value?.trim())}
            className="flex size-7 shrink-0 items-center justify-center rounded-lg transition hover:brightness-110 disabled:opacity-40"
            style={{ background: "var(--brand)", color: "#fff" }}
            title={disabled ? disabledReason : "Send"}
            tabIndex={preview ? -1 : 0}
            aria-hidden={preview || undefined}
        >
            <ArrowRight className="size-3.5" />
        </button>
    </div>
);

export const CommandPalette = ({
    state,
    actions,
    onNavigate,
    onToggleTerminal,
    onNewProject,
    onOpenBrowser,
    hideLauncher,
}: {
    state: CoretexState;
    actions: CoretexActions;
    onNavigate: (t: NavTarget) => void;
    onToggleTerminal?: () => void;
    onNewProject?: () => void;
    onOpenBrowser?: (url?: string) => void;
    /** Hide the bottom-center launcher bar (e.g. on the AI Chat page, where it's redundant). */
    hideLauncher?: boolean;
}) => {
    const theme = useTheme();
    const reduceMotion = useReducedMotion();
    const [open, setOpen] = useState(false);
    // Hover-preview: the collapsed bar grows into a chat-bar preview of the open look.
    // compact = opened from the one-line "Ask AI" pill → a small chat popover.
    // Full search (the wide list) only opens via Ctrl+K or the pill's search icon.
    const [compact, setCompact] = useState(false);
    // Collapsed launcher hover-preview: grows the pill toward the opened width so the click is seamless.
    const [barHovered, setBarHovered] = useState(false);
    const [query, setQuery] = useState("");
    const [sel, setSel] = useState(0);
    const [mode, setMode] = useState<PaletteMode>("search");
    // AI command-center scope: which project + agent the chat is acting on.
    const [scopeProjectId, setScopeProjectId] = useState<string | null>(null);
    const [scopeAgentId, setScopeAgentId] = useState<string | null>(null);
    const [showProjectPicker, setShowProjectPicker] = useState(false);
    const [showAgentPicker, setShowAgentPicker] = useState(false);
    // Chat transcript. Assistant turns carry an `askId` — their live text streams in via
    // `state.assistant[askId]` (Brain → assistant:answer/done/error); `text` is the fallback.
    const [chat, setChat] = useState<{ id: string; role: "user" | "assistant"; text: string; askId?: string }[]>([]);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const chatRef = useRef<HTMLDivElement>(null);
    // The collapsed chip row — measured on open so the panel can GROW out of it
    // (origin-anchored: we translate + scale the panel up from the chip's rect).
    const chipRowRef = useRef<HTMLDivElement>(null);
    // The transform we hand framer-motion as the panel's "from"/"to" state: the panel
    // starts shrunk down onto the chip (offset + scale), then springs to identity.
    const [growFrom, setGrowFrom] = useState<{
        x: number;
        y: number;
        scale: number;
    } | null>(null);

    // Ctrl/Cmd+K toggles the palette from anywhere; Esc closes.
    useEffect(() => {
        const onKey = (e: globalThis.KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
                e.preventDefault();
                setMode("search");
                setCompact(false);
                setOpen((v) => !v);
            } else if (e.key === "Escape" && open) {
                setOpen(false);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open]);

    useEffect(() => {
        if (open) {
            setQuery("");
            setSel(0);
            setShowProjectPicker(false);
            setShowAgentPicker(false);
            setTimeout(() => inputRef.current?.focus(), 20);
        }
    }, [open]);

    // Compact Ask-AI panel width — also the hover target for the bottom pill so click feels seamless.
    const compactPanelWidthPx = () => Math.min(COMPACT_PANEL_W, (typeof window !== "undefined" ? window.innerWidth : COMPACT_PANEL_W) - 32);
    const fullPanelWidthPx = () => Math.min(FULL_PANEL_W, (typeof window !== "undefined" ? window.innerWidth : FULL_PANEL_W) - 32);
    const commandBarSpeech = speechOptsFor(state.settings?.speech, "commandBar");

    // Measure the chip row and derive the panel's "from" pose so it GROWS out of the chip.
    // Pass the destination panel width (compact AI vs full search) so scale starts from the
    // already-hovered pill width instead of snapping from a smaller idle size.
    const computeGrowFrom = (destWidth?: number) => {
        if (reduceMotion) {
            setGrowFrom(null);
            return;
        }
        const chip = chipRowRef.current?.getBoundingClientRect();
        if (!chip || chip.width === 0) {
            setGrowFrom(null);
            return;
        }
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const panelW = destWidth ?? fullPanelWidthPx();
        const panelCx = vw / 2; // bottom-center
        const panelBottom = vh - 24; // p-4 (16) + mb-2 (8)
        const chipCx = chip.left + chip.width / 2;
        const chipBottom = chip.top + chip.height;
        // After hover, chip ≈ panel width → scale near 1 (smooth morph). Idle click still grows up.
        const scale = Math.min(0.98, Math.max(0.42, chip.width / panelW));
        setGrowFrom({ x: chipCx - panelCx, y: chipBottom - panelBottom, scale });
    };

    // Ctrl+K (and other non-click opens) won't have run computeGrowFrom; fill it in then.
    useEffect(() => {
        if (open && !growFrom) computeGrowFrom(compact ? compactPanelWidthPx() : fullPanelWidthPx());
        if (!open) {
            setGrowFrom(null);
            setBarHovered(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, compact]);

    // Keep the chat transcript scrolled to the latest message (re-runs as streamed text grows).
    useEffect(() => {
        if (mode === "ai") chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight });
    }, [chat, state.assistant, mode]);

    useEffect(() => {
        if (state.connected) return;
        setChat((previous) =>
            previous.map((message) =>
                message.askId && !state.assistant[message.askId]
                    ? {
                          ...message,
                          askId: undefined,
                          text: "Brain disconnected before the request was accepted.",
                      }
                    : message,
            ),
        );
    }, [state.connected, state.assistant]);

    const go = (t: NavTarget) => () => {
        onNavigate(t);
        setOpen(false);
    };
    const setTheme = (m: ThemeMode) => () => {
        theme.setMode(m);
        actions.setSetting("appearance.application.theme", m);
        setOpen(false);
    };

    const scopeProject = useMemo(() => (state.projects ?? []).find((p) => p.id === scopeProjectId) ?? null, [state.projects, scopeProjectId]);
    const scopeAgent = useMemo(() => (state.agents ?? []).find((a) => a.id === scopeAgentId) ?? null, [state.agents, scopeAgentId]);
    const fallbackModel = liveModels(state)[0];
    const commandModel = scopeAgent ? { provider: scopeAgent.config.provider, model: scopeAgent.config.model } : (scopeProject?.assistantModel ?? (fallbackModel ? { provider: fallbackModel.provider, model: fallbackModel.id } : undefined));
    const assistantAvailability = modelAvailability(state, commandModel?.provider, commandModel?.model);

    // Agents available to scope by — narrowed to the chosen project when one is set.
    const scopableAgents = useMemo(() => {
        const all = state.agents ?? [];
        if (!scopeProjectId) return all;
        const proj = (state.projects ?? []).find((p) => p.id === scopeProjectId);
        const taskIds = new Set(proj?.taskIds ?? []);
        const projTaskIds = new Set((state.tasks ?? []).filter((t) => t.projectId === scopeProjectId).map((t) => t.id));
        const owned = all.filter((a) => a.currentTaskId && (taskIds.has(a.currentTaskId) || projTaskIds.has(a.currentTaskId)));
        return owned.length ? owned : all;
    }, [state.agents, state.projects, state.tasks, scopeProjectId]);

    // ---- AI command-center: ask the Brain, stream the answer back -----------------
    // Fires the `assistant:ask` command (model picked from the scoped agent/project on the
    // Brain side) and tracks the streamed turn by request id via `state.assistant[askId]`.
    const askAI = (text: string) => {
        const prompt = text.trim();
        if (!prompt || !assistantAvailability.available) return;
        const stamp = Date.now();
        const askId = actions.assistantAsk(prompt, {
            projectId: scopeProjectId ?? undefined,
            agentId: scopeAgentId ?? undefined,
        });
        if (!askId) return;
        setChat((c) => [...c, { id: `u${stamp}`, role: "user", text: prompt }, { id: `a${stamp}`, role: "assistant", text: "", askId }]);
        setQuery("");
    };

    // Quick actions wired to EXISTING CoretexActions / host callbacks only.
    type QuickAction = {
        id: string;
        label: string;
        icon: IconCmp;
        tone?: string;
        disabled?: boolean;
        run: () => void;
    };
    const quickActions = useMemo<QuickAction[]>(() => {
        const acts: QuickAction[] = [];
        const a = scopeAgent;
        const active = a ? a.status === "working" || a.status === "thinking" : false;
        const paused = a?.status === "paused";
        if (a) {
            if (active)
                acts.push({
                    id: "qa-stop",
                    label: "Stop",
                    icon: StopCircle,
                    tone: "var(--c-error, #ef4444)",
                    run: () => {
                        actions.haltAgent(a.id);
                    },
                });
            if (paused)
                acts.push({
                    id: "qa-resume",
                    label: "Resume",
                    icon: Play,
                    tone: "var(--c-success, #22c55e)",
                    run: () => {
                        actions.resumeAgent(a.id);
                    },
                });
            else if (!active)
                acts.push({
                    id: "qa-pause",
                    label: "Pause",
                    icon: PauseCircle,
                    tone: "var(--c-warning, #f59e0b)",
                    run: () => {
                        actions.pauseAgent(a.id);
                    },
                });
        } else {
            // No agent scoped: act on the whole fleet (or the scoped project's agents).
            acts.push({
                id: "qa-pause-all",
                label: "Pause agents",
                icon: PauseCircle,
                tone: "var(--c-warning, #f59e0b)",
                run: () => {
                    actions.pauseAllAgents(scopeProjectId ?? undefined);
                },
            });
            acts.push({
                id: "qa-resume-all",
                label: "Resume agents",
                icon: Play,
                tone: "var(--c-success, #22c55e)",
                run: () => {
                    actions.resumeAllAgents(scopeProjectId ?? undefined);
                },
            });
        }
        acts.push({
            id: "qa-task",
            label: "New task",
            icon: Plus,
            run: () => {
                onNavigate(scopeProjectId ? { kind: "project", id: scopeProjectId, tab: "kanban" } : { kind: "projects" });
                setOpen(false);
            },
        });
        acts.push({
            id: "qa-terminal",
            label: "Terminal",
            icon: Terminal,
            disabled: !onToggleTerminal,
            run: () => {
                onToggleTerminal?.();
                setOpen(false);
            },
        });
        acts.push({
            id: "qa-browser",
            label: "Browser",
            icon: Globe01,
            disabled: !onOpenBrowser,
            run: () => {
                onOpenBrowser?.();
                setOpen(false);
            },
        });
        acts.push({
            id: "qa-agents",
            label: "Open agents",
            icon: Users01,
            run: () => {
                onNavigate({ kind: "agents" });
                setOpen(false);
            },
        });
        return acts;
    }, [scopeAgent, scopeProjectId, actions, onNavigate, onToggleTerminal, onOpenBrowser]);

    // ---- build the full searchable index from live state + navigation + settings + actions ----
    const items = useMemo<SearchItem[]>(() => {
        const out: SearchItem[] = [];

        // Navigation (every top-level screen)
        const nav: [string, IconCmp, NavTarget, string][] = [
            ["Home", Home01, { kind: "home" }, "dashboard overview"],
            ["AI Chat", Stars01, { kind: "aichat" }, "assistant ask conversation models"],
            ["Usage & Analytics", LineChartUp03, { kind: "usage" }, "cost spend tokens charts metrics"],
            ["Financial", BankNote01, { kind: "financial" }, "money accounts cards budgets transactions tax"],
            ["Social", Users01, { kind: "social" }, "contacts relationships events drafts"],
            ["Workouts", Activity, { kind: "workouts" }, "training exercises schedule templates body progress"],
            ["Nutrition", Beaker01, { kind: "nutrition" }, "meals macros water food logger"],
            ["Health", ActivityHeart, { kind: "health" }, "metrics vitals sleep habits medical peptides medications"],
            ["Todos", CheckSquare, { kind: "tasks" }, "tasks routines priorities completion"],
            ["Council", MessageChatCircle, { kind: "council" }, "debate topology multi-agent pipeline meeting team"],
            ["Agents", Users01, { kind: "agents" }, "fleet deploy roster"],
            ["Plan", ClipboardCheck, { kind: "plan" }, "planner planning"],
            ["Email", Mail01, { kind: "email" }, "mail inbox gmail sorter"],
            ["Env vars", Key01, { kind: "env" }, "environment variables secrets dotenv"],
            ["API keys", Key02, { kind: "keyvault" }, "vault credentials integrations tokens"],
            ["Calendar", Calendar, { kind: "calendar" }, "events schedule"],
            ["Projects", Folder, { kind: "projects" }, "workspaces"],
            ["GitHub", GitBranch01, { kind: "github" }, "repositories source control commits branches pull requests deployments clone"],
            ["Files", FolderCode, { kind: "files" }, "file manager explorer drives index"],
            ["Database", Database01, { kind: "database" }, "sql postgres mysql sqlite query"],
            ["Docker", Cube01, { kind: "docker" }, "containers images volumes compose"],
            ["Remote", Server01, { kind: "remote" }, "ssh sftp ftp hosts"],
            ["Running servers", Signal01, { kind: "servers" }, "ports localhost processes"],
            ["Settings", Settings01, { kind: "settings" }, "preferences config options"],
        ];
        for (const [title, icon, target, kw] of nav)
            out.push({
                id: `nav:${title}`,
                title,
                category: "Go to",
                icon,
                keywords: kw,
                run: go(target),
            });

        // Agents
        for (const a of state.agents ?? [])
            out.push({
                id: `agent:${a.id}`,
                title: a.config.name,
                subtitle: `${roleLabel(a.config.role)} · ${providerLabel(a.config.provider)} · ${a.status}`,
                category: "Agents",
                icon: Users01,
                keywords: `${a.config.model} agent`,
                run: go({ kind: "agents" }),
            });

        // Projects
        for (const p of state.projects ?? [])
            out.push({
                id: `project:${p.id}`,
                title: p.name,
                subtitle: p.description || "Project",
                category: "Projects",
                icon: Folder,
                keywords: (p.tags ?? []).join(" "),
                run: go({ kind: "project", id: p.id, tab: "overview" }),
            });

        // Tasks
        for (const t of state.tasks ?? [])
            out.push({
                id: `task:${t.id}`,
                title: t.title,
                subtitle: `Task · ${t.status} · ${t.priority}`,
                category: "Tasks",
                icon: ClipboardCheck,
                keywords: t.description ?? "",
                run: t.projectId ? go({ kind: "project", id: t.projectId, tab: "kanban" }) : go({ kind: "projects" }),
            });

        // Running servers
        for (const sv of state.servers ?? [])
            out.push({
                id: `server:${sv.owner}-${sv.port}-${sv.pid ?? "x"}`,
                title: `:${sv.port}${sv.tech ? ` — ${sv.tech}` : ""}`,
                subtitle: `Running server${sv.process ? ` · ${sv.process}` : ""}`,
                category: "Servers",
                icon: Signal01,
                keywords: `port localhost ${sv.url ?? ""} ${sv.type}`,
                run: go({ kind: "servers" }),
            });

        // Terminals
        for (const term of state.terminals ?? [])
            out.push({
                id: `term:${term.id}`,
                title: term.title,
                subtitle: `Terminal · ${term.status}${term.kind === "agent" ? " · AI console" : ""}`,
                category: "Terminals",
                icon: Terminal,
                keywords: "shell console",
                run: () => {
                    onToggleTerminal?.();
                    setOpen(false);
                },
            });

        // Docker containers
        for (const c of state.docker?.containers ?? [])
            out.push({
                id: `docker:${c.id}`,
                title: c.name,
                subtitle: `Container · ${c.state} · ${c.image}`,
                category: "Docker",
                icon: Cube01,
                keywords: `${c.composeProject ?? ""} container`,
                run: go({ kind: "docker" }),
            });

        // Database connections
        for (const conn of state.settings?.database.connections ?? [])
            out.push({
                id: `db:${conn.id}`,
                title: conn.name,
                subtitle: `Database · ${conn.engine}`,
                category: "Database",
                icon: Database01,
                keywords: "connection sql",
                run: go({ kind: "database" }),
            });

        // Remote hosts
        for (const h of state.settings?.remote.sshHosts ?? [])
            out.push({
                id: `remote:${h.id}`,
                title: h.label || h.host,
                subtitle: `Remote · ${h.user}@${h.host}`,
                category: "Remote",
                icon: Server01,
                keywords: `ssh sftp ftp host ${h.protocol ?? ""}`,
                run: go({ kind: "remote" }),
            });

        // Calendar events
        for (const ev of state.calendar ?? [])
            out.push({
                id: `cal:${ev.id}`,
                title: ev.title,
                subtitle: "Calendar event",
                category: "Calendar",
                icon: Calendar,
                keywords: ev.description ?? "",
                run: go({ kind: "calendar" }),
            });

        // Emails
        for (const m of state.email?.messages ?? [])
            out.push({
                id: `mail:${m.id}`,
                title: m.subject,
                subtitle: `Email · ${m.from.name}`,
                category: "Email",
                icon: Mail01,
                keywords: `${m.from.email} ${m.snippet}`,
                run: go({ kind: "email" }),
            });

        // Env vars (across environments)
        for (const env of state.env?.environments ?? [])
            for (const v of env.variables)
                out.push({
                    id: `env:${env.id}:${v.id}`,
                    title: v.name,
                    subtitle: `Env var · ${env.name}`,
                    category: "Env vars",
                    icon: Key01,
                    keywords: "environment variable secret",
                    run: go({ kind: "env" }),
                });

        // API keys
        for (const k of state.keyvault?.keys ?? [])
            out.push({
                id: `key:${k.id}`,
                title: `${k.serviceName}${k.nickname ? ` — ${k.nickname}` : ""}`,
                subtitle: "API key",
                category: "API keys",
                icon: Key02,
                keywords: `${k.category} credential token`,
                run: go({ kind: "keyvault" }),
            });

        // Memory
        for (const mem of state.memory ?? [])
            out.push({
                id: `mem:${mem.id}`,
                title: mem.text.slice(0, 56),
                subtitle: `Memory · ${mem.category}`,
                category: "Memory",
                icon: Stars01,
                keywords: mem.text,
                run: go({ kind: "settings", page: "memory" }),
            });

        // Settings pages + searchable toggles
        const settingsEntries: [string, string, string][] = [
            ["AI providers", "ai-providers", "openai anthropic claude ollama gemini lm studio openrouter openclaw api models keys agents"],
            ["Model pricing", "model-pricing", "cost per token"],
            ["MCP servers", "mcp-servers", "connectors tools model context protocol"],
            ["Agents & assistants", "agents", "build deploy skills terminal access coding assistants providers"],
            ["Memory", "memory", "remember past chats"],
            ["Email", "email", "gmail sorter categories confidence"],
            ["Database", "database", "connections engines"],
            ["Docker", "docker", "engine containers"],
            ["Remote & integrations", "remote", "ssh sftp p2p relay mesh pairing"],
            ["Security", "security", "vault oauth credentials leak scan"],
            ["Appearance", "appearance", "theme window always on top hide title bar pane animations opacity sidebar status bar acrylic"],
            ["Color schemes", "color-schemes", "colors palette campbell terminal"],
            ["Notifications", "notifications", "alerts"],
            ["Actions & keybinds", "keybinds", "shortcuts hotkeys"],
            ["Startup", "startup", "launch default terminal run in background"],
            ["Interaction", "interaction", "behavior"],
            ["Microphone", "speech", "mic speech dictation voice speech to text terminal ask ai"],
            ["Rendering & compat", "rendering", "performance gpu background"],
            ["Profiles", "profiles", "shell terminal profiles"],
            ["Account", "account", "profile sync companion mobile"],
            ["Extensions", "extensions", "plugins"],
            ["About & updates", "about", "version license acknowledgements release"],
        ];
        for (const [label, page, kw] of settingsEntries)
            out.push({
                id: `set:${page}`,
                title: label,
                subtitle: page === "extensions" ? "Settings · Coming soon" : "Settings",
                category: "Settings",
                icon: Settings01,
                keywords: `settings ${kw}${page === "extensions" ? " coming soon roadmap preview unavailable" : ""}`,
                run: go({ kind: "settings", page }),
            });

        // Theme + actions
        out.push(
            {
                id: "act:dark",
                title: "Dark mode",
                subtitle: "Switch theme",
                category: "Actions",
                icon: Moon01,
                keywords: "theme appearance night",
                run: setTheme("dark"),
            },
            {
                id: "act:light",
                title: "Light mode",
                subtitle: "Switch theme",
                category: "Actions",
                icon: Sun,
                keywords: "theme appearance day",
                run: setTheme("light"),
            },
            {
                id: "act:system",
                title: "System theme",
                subtitle: "Match the OS",
                category: "Actions",
                icon: Monitor01,
                keywords: "theme appearance auto",
                run: setTheme("system"),
            },
            {
                id: "act:newproject",
                title: "New project",
                subtitle: "Create a project",
                category: "Actions",
                icon: Plus,
                keywords: "add create",
                run: () => {
                    (onNewProject ?? (() => onNavigate({ kind: "projects" })))();
                    setOpen(false);
                },
            },
            {
                id: "act:terminal",
                title: "Open terminal",
                subtitle: "Toggle the terminal dock",
                category: "Actions",
                icon: Terminal,
                keywords: "shell console",
                run: () => {
                    onToggleTerminal?.();
                    setOpen(false);
                },
            },
            {
                id: "act:browser",
                title: "Open browser",
                subtitle: "Open the embedded browser",
                category: "Actions",
                icon: Globe01,
                keywords: "web url localhost webview internet site",
                run: () => {
                    onOpenBrowser?.();
                    setOpen(false);
                },
            },
            {
                id: "act:sort",
                title: "Run email sorter now",
                subtitle: "Categorize the inbox with AI",
                category: "Actions",
                icon: Zap,
                keywords: "ai categorize mail",
                run: () => {
                    actions.emailCategorize();
                    onNavigate({ kind: "email" });
                    setOpen(false);
                },
            },
            {
                id: "act:leak",
                title: "Scan for leaked secrets",
                subtitle: "Search indexed code for keys",
                category: "Actions",
                icon: ShieldTick,
                keywords: "security keys vault",
                run: () => {
                    actions.keyvaultScanLeaks();
                    onNavigate({ kind: "keyvault" });
                    setOpen(false);
                },
            },
            {
                id: "act:health",
                title: "Refresh providers",
                subtitle: "Re-check AI provider health",
                category: "Actions",
                icon: Lightning01,
                keywords: "reconnect models ai",
                run: () => {
                    actions.healthCheck();
                    setOpen(false);
                },
            },
        );

        return out;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state, theme.mode]);

    // ---- rank + group ----
    const { groups, flat } = useMemo(() => {
        const q = query.trim().toLowerCase();
        let ranked: { item: SearchItem; score: number }[];
        if (!q) {
            // Empty query: a curated set of quick links + the most relevant entities.
            const quickIds = new Set(["nav:Home", "nav:Agents", "nav:Projects", "nav:Settings", "act:dark", "act:light", "act:terminal", "nav:Files", "nav:Docker"]);
            ranked = items.filter((i) => quickIds.has(i.id)).map((item) => ({ item, score: 1 }));
        } else {
            ranked = items
                .map((item) => ({ item, score: scoreItem(q, item) }))
                .filter((r) => r.score > 150)
                .sort((a, b) => b.score - a.score);
        }

        const byCat = new Map<string, SearchItem[]>();
        const flatList: SearchItem[] = [];
        const PER_CAT = q ? 6 : 12;
        // Promote the single best result to a "Best match" group.
        if (q && ranked.length) {
            byCat.set("Best match", [ranked[0].item]);
            flatList.push(ranked[0].item);
        }
        for (const { item } of ranked) {
            if (q && flatList[0] && item.id === flatList[0].id) continue; // already in Best match
            const arr = byCat.get(item.category) ?? [];
            if (arr.length >= PER_CAT) continue;
            arr.push(item);
            byCat.set(item.category, arr);
        }
        const ordered = [...byCat.entries()].sort((a, b) => {
            const ai = CATEGORY_ORDER.indexOf(a[0]);
            const bi = CATEGORY_ORDER.indexOf(b[0]);
            return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
        });
        // Rebuild the flat list in display order for keyboard nav.
        const flat2: SearchItem[] = [];
        for (const [, arr] of ordered) for (const it of arr) flat2.push(it);
        return { groups: ordered, flat: flat2 };
    }, [items, query]);

    useEffect(() => {
        setSel(0);
    }, [query]);
    useEffect(() => {
        const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${sel}"]`);
        el?.scrollIntoView({ block: "nearest" });
    }, [sel]);

    const onInputKey = (e: React.KeyboardEvent) => {
        if (mode === "ai") {
            if (e.key === "Enter") {
                e.preventDefault();
                askAI(query);
            }
            return;
        }
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setSel((s) => Math.min(flat.length - 1, s + 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSel((s) => Math.max(0, s - 1));
        } else if (e.key === "Enter") {
            e.preventDefault();
            flat[sel]?.run();
        }
    };

    // Small reusable mode toggle (Search | Ask AI).
    const ModeToggle = () => (
        <div className="flex shrink-0 items-center gap-0.5 rounded-lg p-0.5" style={{ background: "var(--surface-2)" }}>
            {(["search", "ai"] as const).map((m) => {
                const on = mode === m;
                return (
                    <button
                        key={m}
                        type="button"
                        onClick={() => {
                            setMode(m);
                            setTimeout(() => inputRef.current?.focus(), 0);
                        }}
                        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition"
                        style={{
                            background: on ? "var(--surface)" : "transparent",
                            color: on ? "var(--brand)" : "var(--c-text-muted)",
                            boxShadow: on ? "0 1px 2px rgba(0,0,0,0.18)" : undefined,
                        }}
                    >
                        {m === "search" ? <SearchMd className="size-3.5" /> : <Stars01 className="size-3.5" />}
                        {m === "search" ? "Search" : "Ask AI"}
                    </button>
                );
            })}
        </div>
    );

    // ---- capabilities showcase (empty-query "What you can do") ----------------------
    // Surfaces what the bar can do, using the same category-tinted icon-chip language as
    // the result rows. Each item can jump straight into the relevant flow.
    type Capability = {
        icon: IconCmp;
        title: string;
        desc: string;
        color: string;
        run?: () => void;
    };
    const capabilities = useMemo<Capability[]>(
        () => [
            {
                icon: SearchMd,
                title: "Search anything",
                desc: "Screens, agents, projects, files, db, docker, settings…",
                color: catColor("Best match"),
                run: () => {
                    setMode("search");
                    setTimeout(() => inputRef.current?.focus(), 0);
                },
            },
            {
                icon: Stars01,
                title: "Ask AI",
                desc: "Chat scoped to a project + agent",
                color: catColor("Agents"),
                run: () => {
                    setMode("ai");
                    setTimeout(() => inputRef.current?.focus(), 0);
                },
            },
            {
                icon: PauseCircle,
                title: "Pause / resume agents",
                desc: "Halt or wake the fleet in one tap",
                color: catColor("Tasks"),
                run: () => {
                    actions.pauseAllAgents();
                },
            },
            {
                icon: Plus,
                title: "New task",
                desc: "Drop a task into a project board",
                color: catColor("Projects"),
                run: () => {
                    onNavigate({ kind: "projects" });
                    setOpen(false);
                },
            },
            {
                icon: Terminal,
                title: "Open terminal",
                desc: "Toggle the terminal dock",
                color: catColor("Terminals"),
                run: onToggleTerminal
                    ? () => {
                          onToggleTerminal();
                          setOpen(false);
                      }
                    : undefined,
            },
            {
                icon: Globe01,
                title: "Open browser",
                desc: "Launch the embedded browser",
                color: catColor("Remote"),
                run: onOpenBrowser
                    ? () => {
                          onOpenBrowser();
                          setOpen(false);
                      }
                    : undefined,
            },
            {
                icon: Zap,
                title: "Run email sorter",
                desc: "Categorize the inbox with AI",
                color: catColor("Email"),
                run: () => {
                    actions.emailCategorize();
                    onNavigate({ kind: "email" });
                    setOpen(false);
                },
            },
            {
                icon: ShieldTick,
                title: "Scan secrets",
                desc: "Search indexed code for leaked keys",
                color: catColor("API keys"),
                run: () => {
                    actions.keyvaultScanLeaks();
                    onNavigate({ kind: "keyvault" });
                    setOpen(false);
                },
            },
            {
                icon: Lightning01,
                title: "Refresh providers",
                desc: "Re-check AI provider health",
                color: catColor("Actions"),
                run: () => {
                    actions.healthCheck();
                },
            },
            {
                icon: Palette,
                title: "Switch theme",
                desc: "Dark, light, or match the OS",
                color: catColor("Settings"),
                run: () => {
                    onNavigate({ kind: "settings", page: "appearance" });
                    setOpen(false);
                },
            },
            {
                icon: Keyboard01,
                title: "Keyboard nav",
                desc: "↑ ↓ to move · Enter to run · Esc to close",
                color: catColor("Go to"),
            },
            {
                icon: Command,
                title: "Ctrl K anywhere",
                desc: "Summon this bar from any screen",
                color: catColor("Go to"),
            },
        ],
        [actions, onNavigate, onToggleTerminal, onOpenBrowser],
    );

    const showcaseEnter = reduceMotion
        ? {}
        : {
              initial: { opacity: 0, y: 6 },
              animate: { opacity: 1, y: 0 },
              transition: { duration: 0.18, ease: "easeOut" as const },
          };

    let runningIdx = -1;

    // Shared shell chrome for launcher ↔ open panel (same glass, border, glow).
    const shellChrome = {
        background: "var(--glass-bg, var(--surface))",
        border: "1px solid var(--glass-border, var(--c-border))",
        boxShadow: "0 20px 50px -16px var(--brand-glow, rgba(239,66,66,0.45))",
        backdropFilter: "blur(16px) saturate(140%)",
        WebkitBackdropFilter: "blur(16px) saturate(140%)",
    } as const;

    const openAskAi = () => {
        setBarHovered(true);
        // Wait a frame so the shell is at open width/radius before the layoutId morph.
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                computeGrowFrom(compactPanelWidthPx());
                setMode("ai");
                setCompact(true);
                setOpen(true);
            });
        });
    };
    const openSearch = () => {
        computeGrowFrom(fullPanelWidthPx());
        setMode("search");
        setCompact(false);
        setOpen(true);
    };

    return (
        <LayoutGroup id="coretex-omni">
            {/* Bottom-center launcher — unmounts when open so layoutId can morph into the panel. */}
            {!open && !hideLauncher && (
                <div ref={chipRowRef} data-tour="omni-bar" className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2">
                    <motion.div
                        layoutId="coretex-omni-shell"
                        role="button"
                        tabIndex={0}
                        onClick={() => onNavigate({ kind: "aichat" })}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                onNavigate({ kind: "aichat" });
                            }
                        }}
                        onHoverStart={() => setBarHovered(true)}
                        onHoverEnd={() => setBarHovered(false)}
                        onFocus={() => setBarHovered(true)}
                        onBlur={() => setBarHovered(false)}
                        initial={false}
                        animate={{
                            y: barHovered ? -4 : 0,
                            width: LAUNCHER_IDLE_W,
                            borderRadius: 9999,
                            // Padding lives inside AskComposerStrip / idle row so open + hover match 1:1.
                            padding: 0,
                        }}
                        whileTap={reduceMotion ? undefined : { scale: 0.995 }}
                        transition={reduceMotion ? { duration: 0.22, ease: [0.22, 1, 0.36, 1] } : { type: "spring", stiffness: 280, damping: 30, mass: 0.85 }}
                        className="group flex cursor-pointer items-center overflow-hidden"
                        style={{
                            ...shellChrome,
                            width: LAUNCHER_IDLE_W,
                            borderRadius: 9999,
                        }}
                        title="Open AI chat"
                    >
                        {/* A dock launcher, not an input: click opens the full AI workspace. */}
                        <div className="flex w-full items-center gap-2.5 px-4 py-2.5">
                            <span className="flex size-7 shrink-0 items-center justify-center">
                                <Stars01 className="size-4 transition-transform duration-200 group-hover:scale-110" style={{ color: "var(--brand)" }} />
                            </span>
                            <span className="shrink-0 whitespace-nowrap text-sm font-semibold text-primary">Ask AI</span>
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    openSearch();
                                }}
                                className="ml-auto grid size-7 shrink-0 place-items-center rounded-lg text-quaternary transition hover:bg-[var(--surface-2)] hover:text-secondary"
                                title="Search everything (Ctrl+K)"
                                aria-label="Search everything"
                            >
                                <SearchMd className="size-3.5" />
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}

            {/* Open panel — same layoutId shell morphs from the hovered launcher. */}
            <AnimatePresence>
                {open && (
                    <motion.div className="fixed inset-0 z-50 flex flex-col items-center justify-end p-4" style={{ background: "transparent" }} onMouseDown={() => setOpen(false)} initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16, ease: "easeOut" }}>
                        <motion.div
                            layoutId="coretex-omni-shell"
                            className="mb-2 flex flex-col overflow-hidden shadow-2xl"
                            style={{
                                ...shellChrome,
                                width: compact ? `min(${COMPACT_PANEL_W}px, calc(100vw - 2rem))` : `min(${FULL_PANEL_W}px, calc(100vw - 2rem))`,
                                maxHeight: compact ? "min(62vh, 520px)" : "min(70vh, 620px)",
                                borderRadius: 28,
                            }}
                            onMouseDown={(e) => e.stopPropagation()}
                            transition={reduceMotion ? { duration: 0.2, ease: [0.22, 1, 0.36, 1] } : { type: "spring", stiffness: 320, damping: 34, mass: 0.8 }}
                        >
                            {/* Inner content fades in after the shell morph begins. */}
                            <motion.div className="flex min-h-0 flex-1 flex-col" initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={reduceMotion ? { duration: 0.12 } : { duration: 0.22, delay: 0.08, ease: "easeOut" }}>
                                {/* Header: mode toggle (Search | Ask AI) */}
                                <div
                                    className="flex items-center justify-between gap-2 border-b px-3 py-2"
                                    style={{
                                        borderColor: "var(--glass-border, var(--c-border))",
                                    }}
                                >
                                    {compact ? (
                                        <span className="flex items-center gap-1.5 px-1 text-sm font-semibold text-primary">
                                            <Stars01 className="size-4" style={{ color: "var(--brand)" }} /> Ask AI
                                        </span>
                                    ) : (
                                        <ModeToggle />
                                    )}
                                    <button type="button" onClick={() => setOpen(false)} className="flex size-7 items-center justify-center rounded-md text-quaternary transition hover:text-primary" title="Close (Esc)" style={{ background: "var(--surface-2)" }}>
                                        <XClose className="size-4" />
                                    </button>
                                </div>

                                {/* Body crossfades between Search and Ask-AI modes so toggling feels streamlined. */}
                                <AnimatePresence mode="wait" initial={false}>
                                    {mode === "search" ? (
                                        <motion.div key="mode-search" className="flex min-h-0 flex-1 flex-col" initial={reduceMotion ? false : { opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -10 }} transition={reduceMotion ? { duration: 0 } : { duration: 0.16, ease: "easeOut" }}>
                                            {/* Results (above the input — grows upward from the bottom bar) */}
                                            <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-2">
                                                {/* Capabilities showcase — only with an empty query; collapses once you type. */}
                                                {!query.trim() && (
                                                    <motion.div {...showcaseEnter} className="mb-2">
                                                        <p className="flex items-center gap-1.5 px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--brand)" }}>
                                                            <span className="inline-block size-1.5 rounded-full" style={{ background: "var(--brand)" }} />
                                                            What you can do
                                                        </p>
                                                        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                                                            {capabilities.map((cap) => {
                                                                const Icon = cap.icon;
                                                                const clickable = !!cap.run;
                                                                return (
                                                                    <button key={cap.title} type="button" disabled={!clickable} onClick={cap.run} className={cx("flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition", clickable ? "hover:bg-[var(--surface-2)]" : "cursor-default")}>
                                                                        <span
                                                                            className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg"
                                                                            style={{
                                                                                background: `color-mix(in srgb, ${cap.color} 16%, var(--surface-2))`,
                                                                            }}
                                                                        >
                                                                            <Icon className="size-3.5" style={{ color: cap.color }} />
                                                                        </span>
                                                                        <span className="min-w-0 flex-1">
                                                                            <span className="block truncate text-xs font-medium text-primary">{cap.title}</span>
                                                                            <span className="block truncate text-[11px] text-tertiary">{cap.desc}</span>
                                                                        </span>
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                        <p className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-quaternary">Quick links</p>
                                                    </motion.div>
                                                )}
                                                {flat.length === 0 ? (
                                                    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                                                        <SearchMd className="size-6 text-quaternary" />
                                                        <p className="text-sm text-tertiary">No matches for “{query}”.</p>
                                                        <p className="text-xs text-quaternary">Try a screen name, an agent, a setting, or “dark mode”.</p>
                                                    </div>
                                                ) : (
                                                    groups.map(([cat, arr]) => (
                                                        <div key={cat} className="mb-1">
                                                            <p className="flex items-center gap-1.5 px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: catColor(cat) }}>
                                                                <span className="inline-block size-1.5 rounded-full" style={{ background: catColor(cat) }} />
                                                                {cat}
                                                            </p>
                                                            {arr.map((it) => {
                                                                runningIdx++;
                                                                const idx = runningIdx;
                                                                const active = idx === sel;
                                                                const Icon = it.icon;
                                                                const color = catColor(it.category);
                                                                return (
                                                                    <button
                                                                        key={it.id}
                                                                        type="button"
                                                                        data-idx={idx}
                                                                        onMouseEnter={() => setSel(idx)}
                                                                        onClick={() => it.run()}
                                                                        className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition"
                                                                        style={{
                                                                            background: active ? "var(--sidebar-active-bg)" : undefined,
                                                                            boxShadow: active ? "inset 0 0 0 1px color-mix(in srgb, var(--brand) 34%, transparent)" : undefined,
                                                                        }}
                                                                    >
                                                                        <span
                                                                            className="flex size-8 shrink-0 items-center justify-center rounded-lg"
                                                                            style={{
                                                                                background: `color-mix(in srgb, ${color} 16%, var(--surface-2))`,
                                                                            }}
                                                                        >
                                                                            <Icon
                                                                                className="size-4"
                                                                                style={{
                                                                                    color: active ? "var(--brand)" : color,
                                                                                }}
                                                                            />
                                                                        </span>
                                                                        <span className="min-w-0 flex-1">
                                                                            <span className="block truncate text-sm text-primary">{it.title}</span>
                                                                            {it.subtitle && <span className="block truncate text-xs text-tertiary">{it.subtitle}</span>}
                                                                        </span>
                                                                        <span
                                                                            className="hidden shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium sm:inline"
                                                                            style={{
                                                                                color,
                                                                                background: `color-mix(in srgb, ${color} 14%, transparent)`,
                                                                            }}
                                                                        >
                                                                            {it.category}
                                                                        </span>
                                                                        {active && <CornerDownLeft className="size-3.5 shrink-0 text-quaternary" />}
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                    ))
                                                )}
                                            </div>

                                            {/* Search input bar (bottom) */}
                                            <div
                                                className="flex items-center gap-2.5 border-t px-4 py-3"
                                                style={{
                                                    borderColor: "var(--glass-border, var(--c-border))",
                                                }}
                                            >
                                                <SearchMd className="size-4 shrink-0" style={{ color: "var(--brand)" }} />
                                                <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onInputKey} placeholder="Search agents, projects, files, settings, toggles, anything…" className="min-w-0 flex-1 bg-transparent text-sm text-primary outline-none placeholder:text-quaternary" />
                                                <div className="hidden items-center gap-1 text-[10px] text-quaternary sm:flex">
                                                    <kbd className="flex items-center rounded px-1 py-0.5" style={{ background: "var(--surface-2)" }}>
                                                        <ArrowUp className="size-2.5" />
                                                        <ArrowDown className="size-2.5" />
                                                    </kbd>
                                                    <span>navigate</span>
                                                    <kbd className="rounded px-1 py-0.5" style={{ background: "var(--surface-2)" }}>
                                                        enter
                                                    </kbd>
                                                    <span>select</span>
                                                    <kbd className="rounded px-1 py-0.5" style={{ background: "var(--surface-2)" }}>
                                                        esc
                                                    </kbd>
                                                </div>
                                            </div>
                                        </motion.div>
                                    ) : (
                                        <motion.div key="mode-ai" className="flex min-h-0 flex-1 flex-col" initial={reduceMotion ? false : { opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 10 }} transition={reduceMotion ? { duration: 0 } : { duration: 0.16, ease: "easeOut" }}>
                                            {/* AI command-center chat transcript */}
                                            <div ref={chatRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
                                                {chat.length === 0 ? (
                                                    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                                                        <span
                                                            className="flex size-10 items-center justify-center rounded-full"
                                                            style={{
                                                                background: "color-mix(in srgb, var(--brand) 16%, transparent)",
                                                            }}
                                                        >
                                                            <Stars01 className="size-5" style={{ color: "var(--brand)" }} />
                                                        </span>
                                                        <p className="text-sm text-primary">AI command-center</p>
                                                        <p className="max-w-sm text-xs text-tertiary">Pick a project + agent to scope the chat, then ask a question or use a quick action below. Switch to Search to jump anywhere instantly.</p>
                                                    </div>
                                                ) : (
                                                    <div className="flex flex-col gap-2.5">
                                                        {chat.map((m) => {
                                                            const live = m.askId ? state.assistant[m.askId] : undefined;
                                                            const body = live ? live.content : m.text;
                                                            const streaming = !!live?.streaming;
                                                            const error = live?.error ?? null;
                                                            return (
                                                                <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                                                                    <div
                                                                        className="max-w-[80%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm"
                                                                        style={
                                                                            m.role === "user"
                                                                                ? {
                                                                                      background: "var(--brand)",
                                                                                      color: "#fff",
                                                                                      borderBottomRightRadius: 6,
                                                                                  }
                                                                                : {
                                                                                      background: "var(--surface-2)",
                                                                                      color: error ? "var(--c-error, #ef4444)" : "var(--c-text-primary)",
                                                                                      borderBottomLeftRadius: 6,
                                                                                  }
                                                                        }
                                                                    >
                                                                        {error ? `Could not get an answer: ${error}` : body.length > 0 ? body : streaming || (m.role === "assistant" && m.askId && !live) ? "Thinking…" : body}
                                                                        {streaming && body.length > 0 && <span className="ml-0.5 animate-pulse">▍</span>}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Scope pickers + quick actions */}
                                            <div
                                                className="flex flex-col gap-2 border-t px-3 pb-2 pt-2.5"
                                                style={{
                                                    borderColor: "var(--glass-border, var(--c-border))",
                                                }}
                                            >
                                                {/* Context chips: project + agent */}
                                                <div className="flex flex-wrap items-center gap-1.5">
                                                    {/* Project picker */}
                                                    <div className="relative">
                                                        <button
                                                            type="button"
                                                            title={scopeProject?.name ?? "All projects"}
                                                            onClick={() => {
                                                                setShowProjectPicker((v) => !v);
                                                                setShowAgentPicker(false);
                                                            }}
                                                            className="flex items-center gap-1.5 rounded-full py-1 pl-1.5 pr-2 text-xs transition hover:brightness-110"
                                                            style={{
                                                                background: "var(--surface-2)",
                                                                color: "var(--c-text-secondary)",
                                                                border: "1px solid var(--c-border)",
                                                            }}
                                                        >
                                                            {scopeProject ? <ProjectIcon icon={scopeProject.icon} color={scopeProject.color} size={18} /> : <Folder className="size-4" style={{ color: "var(--c-text-muted)" }} />}
                                                            <span className="max-w-[140px] truncate">{scopeProject ? scopeProject.name : "All projects"}</span>
                                                            <ChevronDown className="size-3 opacity-60" />
                                                        </button>
                                                        {showProjectPicker && (
                                                            <div
                                                                className="absolute bottom-full left-0 z-10 mb-1 max-h-56 w-60 overflow-y-auto rounded-xl p-1 shadow-2xl"
                                                                style={{
                                                                    background: "var(--surface)",
                                                                    border: "1px solid var(--c-border)",
                                                                }}
                                                            >
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        setScopeProjectId(null);
                                                                        setShowProjectPicker(false);
                                                                    }}
                                                                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-tertiary transition hover:brightness-110"
                                                                    style={{
                                                                        background: !scopeProjectId ? "var(--surface-2)" : undefined,
                                                                    }}
                                                                >
                                                                    <Folder className="size-4" /> All projects
                                                                </button>
                                                                {(state.projects ?? []).map((p) => (
                                                                    <button
                                                                        key={p.id}
                                                                        type="button"
                                                                        title={p.name}
                                                                        onClick={() => {
                                                                            setScopeProjectId(p.id);
                                                                            setScopeAgentId(null);
                                                                            setShowProjectPicker(false);
                                                                        }}
                                                                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-primary transition hover:brightness-110"
                                                                        style={{
                                                                            background: scopeProjectId === p.id ? "var(--surface-2)" : undefined,
                                                                        }}
                                                                    >
                                                                        <ProjectIcon icon={p.icon} color={p.color} size={20} />
                                                                        <span className="min-w-0 flex-1 truncate">{p.name}</span>
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                    {/* Agent picker */}
                                                    <div className="relative">
                                                        <button
                                                            type="button"
                                                            title={scopeAgent?.config.name ?? "No agent"}
                                                            onClick={() => {
                                                                setShowAgentPicker((v) => !v);
                                                                setShowProjectPicker(false);
                                                            }}
                                                            className="flex items-center gap-1.5 rounded-full py-1 pl-1.5 pr-2 text-xs transition hover:brightness-110"
                                                            style={{
                                                                background: "var(--surface-2)",
                                                                color: "var(--c-text-secondary)",
                                                                border: "1px solid var(--c-border)",
                                                            }}
                                                        >
                                                            {scopeAgent ? <IdentityAvatar identity={scopeAgent.config.identity} name={scopeAgent.config.name} avatarUrl={scopeAgent.config.avatarUrl} size={18} /> : <Users01 className="size-4" style={{ color: "var(--c-text-muted)" }} />}
                                                            <span className="max-w-[140px] truncate">{scopeAgent ? scopeAgent.config.name : "No agent"}</span>
                                                            <ChevronDown className="size-3 opacity-60" />
                                                        </button>
                                                        {showAgentPicker && (
                                                            <div
                                                                className="absolute bottom-full left-0 z-10 mb-1 max-h-56 w-60 overflow-y-auto rounded-xl p-1 shadow-2xl"
                                                                style={{
                                                                    background: "var(--surface)",
                                                                    border: "1px solid var(--c-border)",
                                                                }}
                                                            >
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        setScopeAgentId(null);
                                                                        setShowAgentPicker(false);
                                                                    }}
                                                                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-tertiary transition hover:brightness-110"
                                                                    style={{
                                                                        background: !scopeAgentId ? "var(--surface-2)" : undefined,
                                                                    }}
                                                                >
                                                                    <Users01 className="size-4" /> No agent (fleet)
                                                                </button>
                                                                {scopableAgents.map((a) => (
                                                                    <button
                                                                        key={a.id}
                                                                        type="button"
                                                                        title={a.config.name}
                                                                        onClick={() => {
                                                                            setScopeAgentId(a.id);
                                                                            setShowAgentPicker(false);
                                                                        }}
                                                                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-primary transition hover:brightness-110"
                                                                        style={{
                                                                            background: scopeAgentId === a.id ? "var(--surface-2)" : undefined,
                                                                        }}
                                                                    >
                                                                        <IdentityAvatar identity={a.config.identity} name={a.config.name} avatarUrl={a.config.avatarUrl} size={20} />
                                                                        <span className="min-w-0 flex-1 truncate">{a.config.name}</span>
                                                                        <span className="shrink-0 text-[10px] text-quaternary">{a.status}</span>
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                    {(scopeProject || scopeAgent) && (
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setScopeProjectId(null);
                                                                setScopeAgentId(null);
                                                            }}
                                                            className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-quaternary transition hover:text-primary"
                                                        >
                                                            <XClose className="size-3" /> Clear
                                                        </button>
                                                    )}
                                                </div>

                                                {/* Quick actions wired to existing CoretexActions */}
                                                <div className="flex flex-wrap items-center gap-1.5">
                                                    {quickActions.map((qa) => {
                                                        const Icon = qa.icon;
                                                        const tone = qa.tone ?? "var(--c-text-secondary)";
                                                        return (
                                                            <button
                                                                key={qa.id}
                                                                type="button"
                                                                disabled={qa.disabled}
                                                                onClick={qa.run}
                                                                title={qa.label}
                                                                className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition hover:brightness-110 disabled:opacity-40"
                                                                style={{
                                                                    background: "var(--surface-2)",
                                                                    color: tone,
                                                                    border: "1px solid var(--c-border)",
                                                                }}
                                                            >
                                                                <Icon className="size-3.5" />
                                                                {qa.label}
                                                            </button>
                                                        );
                                                    })}
                                                </div>

                                                {/* Live field — identical strip chrome as the hover-expanded launcher. */}
                                                {!assistantAvailability.available && (
                                                    <p
                                                        role="alert"
                                                        className="mx-1 mb-2 rounded-lg px-2.5 py-2 text-xs text-warning-primary"
                                                        style={{
                                                            background: "color-mix(in srgb, #f59e0b 10%, transparent)",
                                                            border: "1px solid color-mix(in srgb, #f59e0b 30%, var(--c-border))",
                                                        }}
                                                    >
                                                        Ask AI unavailable: {assistantAvailability.reason}
                                                    </p>
                                                )}
                                                <div
                                                    className="-mx-3 -mb-2 mt-0.5 border-t"
                                                    style={{
                                                        borderColor: "var(--glass-border, var(--c-border))",
                                                    }}
                                                >
                                                    <AskComposerStrip inputRef={inputRef} value={query} onChange={setQuery} onKeyDown={onInputKey} onSend={() => askAI(query)} placeholder={scopeAgent ? `Ask ${scopeAgent.config.name} or run a command…` : ASK_PLACEHOLDER} speech={commandBarSpeech} disabled={!assistantAvailability.available} disabledReason={assistantAvailability.reason} />
                                                </div>
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </motion.div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </LayoutGroup>
    );
};
