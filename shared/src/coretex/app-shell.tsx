// @ts-nocheck
"use client";

// Coretex Relay — top-level app shell. One useCoretex() connection feeds the
// custom dark sidebar and a content area that switches between the global views
// and a per-project workspace via in-app view state (host-agnostic navigation).

import { useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { cx } from "@/utils/cx";
import { Columns03, SwitchHorizontal01, X as XIcon, FolderCode, Database01, Cube01, Server01, Signal01 } from "@untitledui/icons";
import { AnchoredPopover } from "./ui/anchored-popover";
import { PaneSplit, clampRatio } from "./ui/pane-split";
import { ThemeProvider, ColorSchemeApplier } from "./theme";
import { Sidebar } from "./sidebar";
import { TerminalDock } from "./terminal/terminal-dock";
import { isTerminalExclusive } from "./terminal/terminal-layout";
import { StatusCluster } from "./status/status-cluster";
import { BrowserDock, type BrowserSession } from "./browser/browser-dock";
import { CoretexTour, tourSeen, TOUR_EVENT } from "./ui/tour";
import { Toaster } from "./ui/toaster";
import { SettingsEffects } from "./settings/settings-effects";
import { CommandPalette } from "./ui/command-palette";
import { AppErrorBoundary } from "./ui/error-boundary";
import { PageTransition } from "./ui/page-transition";
import { PageSkeleton } from "./ui/skeleton";
import { useViewportWidth, BP } from "./ui/use-viewport";
import { useCoretex } from "./use-coretex";
import type { NavTarget, TopLevel } from "./nav";
import { HomeView } from "./views/home-view";
import { AIChatView } from "./views/ai-chat-view";
import { AnalyticsView } from "./views/analytics-view";
import { CouncilView } from "./views/council-view";
import { AgentsView } from "./views/agents-view";
import { AgentDetailView } from "./views/agent-detail-view";
import { PlanView } from "./views/plan-view";
import { EmailView } from "./email/email-view";
import { EnvView } from "./env/env-view";
import { KeyVaultView } from "./keyvault/keyvault-view";
import { CalendarView } from "./calendar/calendar-view";
import { ProjectsListView } from "./views/projects-list-view";
import { GithubView } from "./views/github-view";
import { SettingsWindow } from "./settings/settings-window";
import { FilesPaneGrid } from "./files/files-pane";
import { DatabaseView } from "./database/database-view";
import { DockerView } from "./views/docker-view";
import { RemoteView } from "./remote/remote-view";
import { ServersView } from "./views/servers-view";
import { ProjectWorkspace } from "./workspace/project-workspace";

// LifeOS Ported Views
import { FinancialView } from "./views/financial-view";
import { SocialView } from "./views/social-view";
import { WorkoutsView } from "./views/workouts-view";
import { NutritionView } from "./views/nutrition-view";
import { HealthView } from "./views/health-view";
import { TasksView } from "./views/tasks-view";

let _brSeq = 0;

// ---- Infrastructure split-pane support ----
// The Infrastructure sidebar group (files/database/docker/remote/servers) can be
// viewed side-by-side; every other top-level view stays single-pane. INFRA_KINDS
// drives the gate; INFRA_META mirrors each area's sidebar icon + label for the
// split control, popover, and per-pane headers.
type InfraKind = "files" | "database" | "docker" | "remote" | "servers";
const INFRA = new Set<InfraKind>(["files", "database", "docker", "remote", "servers"]);
const isInfra = (k: NavTarget["kind"]): k is InfraKind => INFRA.has(k as InfraKind);
const INFRA_META: Record<InfraKind, { label: string; icon: React.FC<{ className?: string; style?: React.CSSProperties }> }> = {
    files: { label: "Files", icon: FolderCode },
    database: { label: "Database", icon: Database01 },
    docker: { label: "Docker", icon: Cube01 },
    remote: { label: "Remote", icon: Server01 },
    servers: { label: "Running servers", icon: Signal01 },
};
const INFRA_ORDER: InfraKind[] = ["files", "database", "docker", "remote", "servers"];
const SPLIT_KEY = "coretex-infra-split";
const ASK_DOCK_KEY = "coretex-ask-dock-visible";

export interface CoretexAppProps {
    /** WebSocket URL of the Brain bridge. Defaults to ws://localhost:8765. */
    url?: string;
    /** Ephemeral local bridge token supplied by the trusted desktop/web host. */
    authToken?: string;
    className?: string;
}

export const CoretexApp = ({ url, authToken, className }: CoretexAppProps) => {
    const { state, connected, client, actions } = useCoretex(url, authToken);
    const [nav, setNavState] = useState<NavTarget>({ kind: "home" });
    /** Where to return when leaving Settings (Back in the settings sidebar). */
    const settingsReturnNav = useRef<NavTarget>({ kind: "home" });
    const setNav = (target: NavTarget | ((prev: NavTarget) => NavTarget)) => {
        setNavState((prev) => {
            const next = typeof target === "function" ? target(prev) : target;
            if (next.kind === "settings" && prev.kind !== "settings") {
                settingsReturnNav.current = prev;
            }
            if (next.kind === "settings" && !next.page) {
                return { kind: "settings", page: "account" };
            }
            return next;
        });
    };
    const exitSettings = () => {
        const back = settingsReturnNav.current;
        setNavState(back.kind === "settings" ? { kind: "home" } : back);
    };
    const [dockOpen, setDockOpen] = useState(false);
    // A newly opened dock starts full-page. Reset this default after every close
    // so reopening never flashes the previous workspace beside the Terminal.
    const [terminalFullscreen, setTerminalFullscreen] = useState(true);
    useEffect(() => {
        if (!dockOpen) setTerminalFullscreen(true);
    }, [dockOpen]);
    const [askDockVisible, setAskDockVisible] = useState(true);
    const [browserSessions, setBrowserSessions] = useState<BrowserSession[]>([]);
    const openBrowser = (url: string) => setBrowserSessions((s) => [...s, { id: `br_${_brSeq++}`, url }]);
    const closeBrowserTab = (id: string) => setBrowserSessions((s) => s.filter((x) => x.id !== id));
    const [tourOpen, setTourOpen] = useState(false);
    // Capture where the user was when the tour opened, so we can restore it on close
    // (the tour navigates around the app as it runs).
    const tourReturnNav = useRef<NavTarget | null>(null);
    const openTour = () => { tourReturnNav.current = nav; setTourOpen(true); };
    const closeTour = () => {
        setTourOpen(false);
        if (tourReturnNav.current) setNav(tourReturnNav.current);
        tourReturnNav.current = null;
    };
    // Status-cluster → dock coordination: focus / pop-out a specific session (cleared once handled).
    const [focusSessionId, setFocusSessionId] = useState<string | null>(null);
    const [popoutSessionId, setPopoutSessionId] = useState<string | null>(null);
    const openTerminal = (id: string) => { setDockOpen(true); setFocusSessionId(id); };
    const popoutTerminal = (id: string) => { setDockOpen(true); setPopoutSessionId(id); };

    useEffect(() => {
        if (typeof window === "undefined") return;
        setAskDockVisible(window.localStorage.getItem(ASK_DOCK_KEY) !== "false");
    }, []);
    const toggleAskDock = () => {
        setAskDockVisible((visible) => {
            const next = !visible;
            if (typeof window !== "undefined") window.localStorage.setItem(ASK_DOCK_KEY, String(next));
            return next;
        });
    };

    // ---- Infrastructure split-pane state ----
    // The primary infra area is nav.kind; splitTarget (when set) is the SECONDARY
    // area shown in the right pane. Only valid while an infra area is active.
    const infraActive = isInfra(nav.kind);
    const [splitTarget, setSplitTarget] = useState<InfraKind | null>(null);
    const [splitRatio, setSplitRatio] = useState(0.5);
    const [splitMenuOpen, setSplitMenuOpen] = useState(false);
    const splitBtnRef = useRef<HTMLButtonElement | null>(null);
    const splitContainerRef = useRef<HTMLDivElement | null>(null);
    // Load the persisted split ratio once (clamped to 0.2–0.8).
    useEffect(() => {
        if (typeof window === "undefined") return;
        const raw = window.localStorage.getItem(SPLIT_KEY);
        const n = raw ? Number(raw) : NaN;
        if (Number.isFinite(n)) setSplitRatio(clampRatio(n));
    }, []);
    const updateSplitRatio = (r: number) => {
        let c = clampRatio(r);
        // Snap pane edges to 5% grid when interaction.windowPanes.snapToGrid is on.
        if (state.settings?.interaction.windowPanes.snapToGrid !== false) {
            c = clampRatio(Math.round(c * 20) / 20);
        }
        setSplitRatio(c);
        if (typeof window !== "undefined") window.localStorage.setItem(SPLIT_KEY, String(c));
    };
    // Leaving Infrastructure collapses any split (and never lets a non-infra kind
    // linger in splitTarget). Also drop a split that points at the current primary.
    useEffect(() => {
        if (!infraActive) {
            setSplitTarget(null);
            setSplitMenuOpen(false);
        } else if (splitTarget && splitTarget === nav.kind) {
            setSplitTarget(null);
        }
    }, [infraActive, nav.kind, splitTarget]);

    // Show the welcome tour once, on first run; and on explicit request anywhere.
    // openTour captures the current nav so closeTour can restore it; use refs so this
    // once-bound listener always sees the latest closures.
    const openTourRef = useRef(openTour);
    openTourRef.current = openTour;
    useEffect(() => {
        if (!tourSeen()) openTourRef.current();
        const open = () => openTourRef.current();
        window.addEventListener(TOUR_EVENT, open);
        return () => window.removeEventListener(TOUR_EVENT, open);
    }, []);

    /** Count of "relevant" servers (not system/background) for the sidebar badge. */
    const relevantServers = state.servers.filter((s) => s.tier !== "system").length;
    // Count running servers attributed to each project (for the per-project sidebar badge).
    const projectServerCounts = state.servers.reduce<Record<string, number>>((acc, s) => {
        if (s.projectId) acc[s.projectId] = (acc[s.projectId] ?? 0) + 1;
        return acc;
    }, {});
    const containerCount = state.docker?.containers.filter((c) => c.state === "running").length ?? 0;
    /** Total agents in the pool (sidebar badge for the Agents tab). */
    const agentCount = state.agents.length;

    /** Logged-in identity for the sidebar account control, from the saved profile. */
    const profile = state.settings?.profile;
    const account = {
        name: profile?.fullName || profile?.nickname || "Local workspace",
        email: profile?.email || "",
        avatarUrl: profile?.avatarUrl || undefined,
    };

    // A per-agent detail page keeps the "Agents" sidebar item highlighted.
    const active: TopLevel = nav.kind === "agent" ? "agents" : nav.kind;
    const activeProjectId = nav.kind === "project" ? nav.id : undefined;
    const activeProject = activeProjectId ? state.projects.find((p) => p.id === activeProjectId) : undefined;

    const costToday = state.cost?.totalCostToday ?? 0;
    const tokensToday = state.cost?.totalTokensToday ?? 0;

    // Tab appearance + interaction settings that drive terminal/window behavior.
    const tabsAlwaysShow = state.settings?.appearance.tabs.alwaysShow !== false;
    const tabsShowInFullScreen = state.settings?.appearance.tabs.showInFullScreen === true;
    const tabsWidthMode = state.settings?.appearance.tabs.widthMode ?? "equal";
    const tabsAcrylic = state.settings?.appearance.tabs.acrylic === true;
    const titleFromActiveTerminal = state.settings?.appearance.tabs.titleFromActiveTerminal !== false;
    const newTabPosition = state.settings?.appearance.application.newTabPosition ?? "end";
    const defaultProfileId = state.settings?.startup.defaultProfileId ?? null;
    const tabSwitcherStyle = state.settings?.interaction.windowPanes.tabSwitcherStyle ?? "strip";
    const ctrlShiftScrollOpacity = state.settings?.interaction.windowPanes.ctrlShiftScrollOpacity === true;
    const keybinds = state.settings?.keybinds ?? [];

    // Appearance settings that drive the shell directly.
    const showStatusBar = state.settings?.appearance.coretex.statusBar !== false;
    const sidebarCollapseMode = state.settings?.appearance.coretex.sidebarCollapse ?? "manual";
    const sidebarWidth = state.settings?.appearance.coretex.sidebarWidth ?? 240;
    const sidebarDensity = state.settings?.appearance.coretex.sidebarDensity ?? "comfortable";
    const sidebarShowProjects = state.settings?.appearance.coretex.sidebarShowProjects ?? true;

    // Responsive shell. Track the viewport so the right-side docks can overlay
    // (instead of crushing the main content) on narrow screens, and the sidebar
    // can auto-collapse to icons below the tablet breakpoint. Desktop is unchanged.
    const vw = useViewportWidth();
    const dockOverlay = vw < BP.dock; // <1024px: docks float over main instead of taking flex space
    // Below ~768px always use the icon rail. An explicitly expanded desktop
    // preference must not consume most of a phone-sized viewport.
    const effectiveCollapseMode = vw < BP.sidebar ? "collapsed" : sidebarCollapseMode;

    const openProject = (id: string) => setNav({ kind: "project", id, tab: "overview" });

    // The selected color scheme (if any) recolors the whole app shell live.
    const activeSchemeName = state.settings?.appearance.application.activeColorScheme ?? null;
    const activeScheme = activeSchemeName ? (state.settings?.colorSchemes ?? []).find((s) => s.name === activeSchemeName) ?? null : null;

    // ---- Terminal creation honoring startup.defaultProfileId + newTabPosition ----
    // The new tab's position (end / after-current / start) is realized by the dock's
    // persisted tab-order list (coretex-term-order in localStorage); we pre-seed the
    // freshly created session id into that list at the requested slot so the dock picks
    // it up on its next render. The active session for "after-current" is the dock's
    // last-focused id, which the dock mirrors into the MRU stack below.
    const ORDER_KEY = "coretex-term-order";
    // Pending placement intent consumed when the next terminal:created session appears.
    const pendingTabPlacement = useRef<{ mode: "start" } | { mode: "after"; afterId: string | null } | null>(null);
    const orderNewTab = (placeBeforeId: string | null) => {
        if (typeof window === "undefined" || newTabPosition === "end") return;
        // We don't yet know the new session id (it's assigned by the Brain and arrives
        // via terminal:created). Record the intent so the terminal:created handler can
        // splice the real id into the order list at the right slot.
        pendingTabPlacement.current = newTabPosition === "start" ? { mode: "start" } : { mode: "after", afterId: placeBeforeId };
    };

    // ---- MRU tab stack (for interaction.windowPanes.tabSwitcherStyle === "mru") ----
    // Most-recently-used session ids, newest first. Kept in sync with the live session
    // list so closed terminals drop out. next/previous-tab walk this when MRU is active.
    const mruRef = useRef<string[]>([]);

    /** Create a terminal honoring the default profile + requested tab position + launch size. */
    const createTerminal = (opts?: { cwd?: string; shell?: string }) => {
        orderNewTab(mruRef.current[0] ?? null);
        const profile = defaultProfileId ? state.settings?.profiles.find((p) => p.id === defaultProfileId) : undefined;
        const cols = state.settings?.startup.launchCols;
        const rows = state.settings?.startup.launchRows;
        actions.terminalCreate({
            profileId: profile?.id,
            // The profile's commandLine is the shell; its cwd/appearance ride along via profileId,
            // but we also pass cwd/shell explicitly so a profile-less default still lands right.
            shell: opts?.shell ?? (profile?.commandLine || undefined),
            cwd: opts?.cwd ?? (profile?.cwd || undefined),
            cols: typeof cols === "number" ? cols : undefined,
            rows: typeof rows === "number" ? rows : undefined,
        });
    };

    useEffect(() => {
        const live = new Set(state.terminals.map((t) => t.id));
        // Drop dead ids; append any new ones to the back (they become MRU on focus).
        const kept = mruRef.current.filter((id) => live.has(id));
        for (const t of state.terminals) if (!kept.includes(t.id)) kept.push(t.id);
        mruRef.current = kept;
    }, [state.terminals]);
    // When the dock focuses a session, bump it to the front of the MRU stack.
    useEffect(() => {
        if (!focusSessionId) return;
        mruRef.current = [focusSessionId, ...mruRef.current.filter((id) => id !== focusSessionId)];
    }, [focusSessionId]);

    // Splice a newly created terminal into the persisted dock order per newTabPosition.
    useEffect(() => {
        const intent = pendingTabPlacement.current;
        if (!intent || typeof window === "undefined" || state.terminals.length === 0) return;
        const newest = state.terminals[state.terminals.length - 1].id;
        let order: string[];
        try { order = JSON.parse(window.localStorage.getItem(ORDER_KEY) ?? "[]") as string[]; } catch { order = []; }
        order = order.filter((id) => id !== newest);
        if (intent.mode === "start") {
            order.unshift(newest);
        } else {
            const idx = intent.afterId ? order.indexOf(intent.afterId) : -1;
            if (idx >= 0) order.splice(idx + 1, 0, newest);
            else order.push(newest);
        }
        window.localStorage.setItem(ORDER_KEY, JSON.stringify(order));
        window.dispatchEvent(new StorageEvent("storage", { key: ORDER_KEY }));
        pendingTabPlacement.current = null;
    }, [state.terminals]);

    const toggleDock = () => {
        setDockOpen((v) => {
            const next = !v;
            if (next && state.terminals.length === 0) createTerminal();
            return next;
        });
    };

    /** Step the active terminal selection forward/back, MRU-aware. */
    const stepTab = (dir: 1 | -1) => {
        const ids = tabSwitcherStyle === "mru"
            ? mruRef.current
            : state.terminals.map((t) => t.id);
        if (ids.length === 0) return;
        if (tabSwitcherStyle === "mru") {
            // MRU: forward = previously-used (index 1), back = oldest. Simple two-step toggle
            // toward the most-recent neighbor; the dock then re-bumps it to front on focus.
            const target = dir === 1 ? ids[1] ?? ids[0] : ids[ids.length - 1];
            if (target) { setDockOpen(true); setFocusSessionId(target); }
            return;
        }
        // Strip order: walk the live list relative to the current focus / MRU head.
        const current = mruRef.current[0] ?? ids[0];
        const at = ids.indexOf(current);
        const next = ids[(at + dir + ids.length) % ids.length];
        if (next) { setDockOpen(true); setFocusSessionId(next); }
    };

    // ---- Global keybind dispatcher (settings.keybinds[]) ----
    // Build a normalized chord string from the event and run the first enabled binding
    // whose chord matches. Replaces the old hardcoded Ctrl+` toggle (now the
    // "toggle-terminal" action; falls back to Ctrl+` when no binding is present).
    // Latest-value refs keep the listener stable without re-binding on every render.
    const keybindsRef = useRef(keybinds);
    keybindsRef.current = keybinds;
    const termCountRef = useRef(state.terminals.length);
    termCountRef.current = state.terminals.length;
    // Stable refs to the helpers so the once-bound listener always calls the latest closure.
    const createTerminalRef = useRef(createTerminal);
    createTerminalRef.current = createTerminal;
    const stepTabRef = useRef(stepTab);
    stepTabRef.current = stepTab;
    useEffect(() => {
        const chordOf = (e: KeyboardEvent): string => {
            const parts: string[] = [];
            if (e.ctrlKey) parts.push("Ctrl");
            if (e.altKey) parts.push("Alt");
            if (e.shiftKey) parts.push("Shift");
            // Normalize the main key: prefer the printable key, fall back to code.
            let key = e.key;
            if (key === " " || e.code === "Space") key = "Space";
            else if (key === "+") key = "Plus";
            else if (key.length === 1) key = key.toUpperCase();
            parts.push(key);
            return parts.join("+");
        };
        const norm = (c: string) => c.split("+").map((p) => (p.length === 1 ? p.toUpperCase() : p)).join("+");

        const runAction = (actionId: string): boolean => {
            switch (actionId) {
                case "toggle-terminal":
                    setDockOpen((v) => { const next = !v; if (next && termCountRef.current === 0) createTerminalRef.current(); return next; });
                    return true;
                case "new-tab":
                    setDockOpen(true); createTerminalRef.current(); return true;
                case "next-tab":
                    stepTabRef.current(1); return true;
                case "previous-tab":
                    stepTabRef.current(-1); return true;
                case "open-settings":
                    setNav({ kind: "settings" }); return true;
                case "open-file-manager":
                    setNav({ kind: "files" }); return true;
                case "open-ai-pane":
                    setNav({ kind: "aichat" }); return true;
                default:
                    return false; // not an app-shell-level action (terminal-local bindings handled in the dock)
            }
        };

        const onKey = (e: KeyboardEvent) => {
            const chord = norm(chordOf(e));
            for (const b of keybindsRef.current) {
                if (b.enabled === false) continue; // honor the per-binding enabled toggle
                if (!b.chords.some((c) => norm(c) === chord)) continue;
                if (runAction(b.actionId)) { e.preventDefault(); return; }
                break; // matched a binding we don't handle here — let the dock/host take it
            }
            // Fallback: Ctrl+` always toggles the dock even if no binding exists for it.
            if (e.ctrlKey && (e.key === "`" || e.code === "Backquote") && !keybindsRef.current.some((b) => b.actionId === "toggle-terminal" && b.enabled !== false)) {
                e.preventDefault();
                setDockOpen((v) => { const next = !v; if (next && termCountRef.current === 0) createTerminalRef.current(); return next; });
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    // ---- Ctrl+Shift+wheel → window opacity (interaction.windowPanes.ctrlShiftScrollOpacity) ----
    const opacityRef = useRef<number>(state.settings?.appearance.coretex.windowOpacity ?? 100);
    opacityRef.current = state.settings?.appearance.coretex.windowOpacity ?? 100;
    const ctrlShiftScrollRef = useRef(ctrlShiftScrollOpacity);
    ctrlShiftScrollRef.current = ctrlShiftScrollOpacity;
    useEffect(() => {
        const onWheel = (e: WheelEvent) => {
            if (!ctrlShiftScrollRef.current || !e.ctrlKey || !e.shiftKey) return;
            e.preventDefault();
            // Scroll up = more opaque, down = more transparent. Clamp to 30..100.
            const delta = e.deltaY < 0 ? 2 : -2;
            const next = Math.max(30, Math.min(100, Math.round(opacityRef.current + delta)));
            if (next !== opacityRef.current) actions.setSetting("appearance.coretex.windowOpacity", next);
        };
        // Passive must be false so preventDefault stops the page from zooming/scrolling.
        window.addEventListener("wheel", onWheel, { passive: false });
        return () => window.removeEventListener("wheel", onWheel);
    }, [actions]);

    // ---- Window/document title from the focused terminal + currency-formatted cost ----
    // When tabs.titleFromActiveTerminal is on, reflect the active shell's title; always
    // suffix today's spend formatted with the locale currency (appearance.locale.currency).
    useEffect(() => {
        if (typeof document === "undefined") return;
        const focused = mruRef.current[0] ?? state.terminals[state.terminals.length - 1]?.id;
        const term = focused ? state.terminals.find((t) => t.id === focused) : undefined;
        // Window name is just "Coretex" (or the active terminal's title) — no cost suffix.
        document.title = titleFromActiveTerminal && term ? term.title : "Coretex";
    }, [state.terminals, titleFromActiveTerminal, focusSessionId]);

    // ---- Infrastructure pane renderer ----
    // Returns the right component for an infra kind, wrapped in a self-contained
    // min-w-0 / overflow-auto / h-full container so it slots into either a single
    // pane or a side-by-side split without leaking width or scroll.
    const infraView = (kind: InfraKind) => {
        let body: React.ReactNode;
        switch (kind) {
            case "files":
                body = <FilesPaneGrid state={state} actions={actions} onNavigate={setNav} />;
                break;
            case "database":
                body = <DatabaseView state={state} actions={actions} />;
                break;
            case "docker":
                body = <DockerView state={state} actions={actions} onNavigate={setNav} />;
                break;
            case "remote":
                body = <RemoteView state={state} actions={actions} />;
                break;
            case "servers":
                body = (
                    <div className="w-full p-4 sm:p-6 lg:p-8">
                        <ServersView state={state} actions={actions} onOpenBrowser={(url) => openBrowser(url)} />
                    </div>
                );
                break;
        }
        return <div className="h-full min-w-0 overflow-auto">{body}</div>;
    };

    // A compact pane header (icon + name) used in the split layout, with optional
    // "swap sides" and "close split" affordances.
    const PaneHeader = ({ kind, onSwap, onClose }: { kind: InfraKind; onSwap?: () => void; onClose?: () => void }) => {
        const meta = INFRA_META[kind];
        const Icon = meta.icon;
        return (
            <div
                className="flex h-9 shrink-0 items-center gap-2 border-b px-3"
                style={{ background: "var(--surface)", borderColor: "var(--c-border)" }}
            >
                <Icon className="size-4" style={{ color: "var(--brand)" }} />
                <span className="truncate text-sm font-medium" style={{ color: "var(--c-text-primary)" }}>{meta.label}</span>
                <div className="ml-auto flex items-center gap-1">
                    {onSwap && (
                        <button
                            type="button"
                            onClick={onSwap}
                            aria-label="Swap sides"
                            title="Swap sides"
                            className="grid size-6 place-items-center rounded-md hover:bg-[var(--surface-2)]"
                            style={{ color: "var(--c-text-secondary)" }}
                        >
                            <SwitchHorizontal01 className="size-4" />
                        </button>
                    )}
                    {onClose && (
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label="Close split view"
                            title="Close split view"
                            className="grid size-6 place-items-center rounded-md hover:bg-[var(--surface-2)]"
                            style={{ color: "var(--c-text-secondary)" }}
                        >
                            <XIcon className="size-4" />
                        </button>
                    )}
                </div>
            </div>
        );
    };

    const swapSides = () => {
        if (!isInfra(nav.kind) || !splitTarget) return;
        const primary = nav.kind;
        setNav({ kind: splitTarget });
        setSplitTarget(primary);
    };

    // Below ~900px the split collapses to a single primary pane (divider hidden).
    const splitNarrow = vw < 900;
    const showSplit = infraActive && splitTarget != null && !splitNarrow;

    // Stable key for soft page crossfades. Settings / project tabs handle their own
    // inner transitions so the outer shell keeps the rail/workspace mount stable.
    const pageKey = useMemo(() => {
        if (nav.kind === "project") return `project:${nav.id}`;
        if (nav.kind === "agent") return `agent:${nav.id}`;
        if (nav.kind === "settings") return "settings";
        if (nav.kind === "usage" || nav.kind === "analytics") return "analytics";
        return nav.kind;
    }, [nav]);

    const mainScrollRef = useRef<HTMLElement>(null);
    useEffect(() => {
        // Each top-level destination is its own page. Reusing the shell's scroll
        // container must not carry a previous page's deep scroll position into it.
        mainScrollRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }, [pageKey]);

    const preferReduced = useReducedMotion();
    const paneAnimationsOn = state.settings?.appearance.window.paneAnimations !== false;
    const reduceMotion = preferReduced || !paneAnimationsOn;
    const bootstrapping = !state.settings;

    const skeletonVariant =
        nav.kind === "settings" ? "settings"
        : nav.kind === "agents" || nav.kind === "projects" || nav.kind === "github" || nav.kind === "council" ? "list"
        : "dashboard";
    const terminalExclusive = isTerminalExclusive(dockOpen, terminalFullscreen);

    // Anchored menus are portaled to <body>, so hiding their owning surface alone
    // is not enough. An outside press closes any open hover/menu popover as the
    // Terminal takes over, preventing it from resurfacing when the shell returns.
    useEffect(() => {
        if (!terminalExclusive || typeof document === "undefined") return;
        document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    }, [terminalExclusive]);

    return (
        <ThemeProvider>
            <AppErrorBoundary>
            <ColorSchemeApplier scheme={activeScheme} />
            <SettingsEffects settings={state.settings} />
            {/* Transparent root lets the fixed body bloom-field glow through the whole shell. */}
            <div className={cx("flex h-dvh overflow-hidden", className)} style={{ background: "transparent" }}>
                <div
                    aria-hidden={terminalExclusive || undefined}
                    inert={terminalExclusive}
                    style={{ display: terminalExclusive ? "none" : "contents" }}
                >
                <Sidebar
                    active={active}
                    activeProjectId={activeProjectId}
                    settingsPage={nav.kind === "settings" ? nav.page : undefined}
                    onExitSettings={exitSettings}
                    projects={state.projects}
                    connected={connected}
                    costToday={costToday}
                    tokensToday={tokensToday}
                    serverCount={relevantServers}
                    projectServerCounts={projectServerCounts}
                    containerCount={containerCount}
                    terminalCount={state.terminals.filter((t) => t.status === "running").length}
                    agentCount={agentCount}
                    account={account}
                    dockOpen={dockOpen}
                    actions={actions}
                    onToggleTerminal={toggleDock}
                    onNavigate={setNav}
                    onNewProject={() => setNav({ kind: "projects" })}
                    onStartTour={openTour}
                    collapseMode={effectiveCollapseMode}
                    width={sidebarWidth}
                    density={sidebarDensity}
                    showProjects={sidebarShowProjects}
                />

                <AppErrorBoundary label="view" resetKey={pageKey}>
                <main ref={mainScrollRef} className={cx("relative min-w-0 flex-1", infraActive ? "flex flex-col overflow-hidden" : nav.kind === "projects" ? "overflow-hidden" : "overflow-x-hidden overflow-y-auto")}>
                    {bootstrapping ? (
                        <PageSkeleton variant={skeletonVariant} />
                    ) : (
                    <PageTransition pageKey={pageKey} reduceMotion={reduceMotion} className={infraActive ? "flex flex-col overflow-hidden" : undefined}>
                    {/* Infrastructure areas: single-view with a split-view toolbar, or a
                        two-pane resizable layout when a secondary area is loaded. */}
                    {infraActive && isInfra(nav.kind) && (
                        showSplit && splitTarget ? (
                            <div ref={splitContainerRef} className="flex min-h-0 flex-1">
                                <div className="flex min-w-0 flex-col" style={{ flexBasis: `${splitRatio * 100}%` }}>
                                    <PaneHeader kind={nav.kind} onSwap={swapSides} />
                                    <div className="min-h-0 flex-1">{infraView(nav.kind)}</div>
                                </div>
                                <PaneSplit ratio={splitRatio} onRatio={updateSplitRatio} containerRef={splitContainerRef} />
                                <div className="flex min-w-0 flex-1 flex-col" style={{ flexBasis: `${(1 - splitRatio) * 100}%` }}>
                                    <PaneHeader kind={splitTarget} onSwap={swapSides} onClose={() => setSplitTarget(null)} />
                                    <div className="min-h-0 flex-1">{infraView(splitTarget)}</div>
                                </div>
                            </div>
                        ) : (
                            <>
                                <div
                                    className="sticky top-0 z-20 flex h-10 shrink-0 items-center border-b px-3"
                                    style={{ background: "var(--surface)", borderColor: "var(--c-border)" }}
                                >
                                    <span className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--c-text-muted)" }}>
                                        {INFRA_META[nav.kind].label}
                                    </span>
                                    <button
                                        ref={splitBtnRef}
                                        type="button"
                                        data-tour="split-view"
                                        onClick={() => setSplitMenuOpen((v) => !v)}
                                        aria-haspopup="menu"
                                        aria-expanded={splitMenuOpen}
                                        className="ml-auto flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium hover:bg-[var(--surface-2)]"
                                        style={{ borderColor: "var(--c-border)", color: "var(--c-text-secondary)" }}
                                    >
                                        <Columns03 className="size-4" />
                                        Split view
                                    </button>
                                    {splitMenuOpen && (
                                        <AnchoredPopover
                                            anchorRef={splitBtnRef}
                                            onClose={() => setSplitMenuOpen(false)}
                                            align="right"
                                            role="menu"
                                            aria-label="Open area in split view"
                                            className="min-w-52 overflow-hidden rounded-lg border p-1 shadow-xl"
                                            style={{ background: "var(--surface)", borderColor: "var(--c-border)" }}
                                        >
                                            {INFRA_ORDER.filter((k) => k !== nav.kind).map((k) => {
                                                const meta = INFRA_META[k];
                                                const Icon = meta.icon;
                                                return (
                                                    <button
                                                        key={k}
                                                        type="button"
                                                        role="menuitem"
                                                        onClick={() => { setSplitTarget(k); setSplitMenuOpen(false); }}
                                                        className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm hover:bg-[var(--surface-2)]"
                                                        style={{ color: "var(--c-text-primary)" }}
                                                    >
                                                        <Icon className="size-4" style={{ color: "var(--brand)" }} />
                                                        {meta.label}
                                                    </button>
                                                );
                                            })}
                                        </AnchoredPopover>
                                    )}
                                </div>
                                <div className="min-h-0 flex-1">{infraView(nav.kind)}</div>
                            </>
                        )
                    )}
                    {nav.kind === "home" && (
                        <div className="w-full min-w-0 overflow-x-hidden p-3 sm:p-5 lg:p-8">
                            <HomeView state={state} actions={actions} onNavigate={setNav} />
                        </div>
                    )}
                    {nav.kind === "aichat" && (
                        <div className="h-full w-full">
                            <AIChatView state={state} actions={actions} onNavigate={setNav} />
                        </div>
                    )}
                    {(nav.kind === "usage" || nav.kind === "analytics") && (
                        <div className="w-full p-4 sm:p-6 lg:p-8">
                            <AnalyticsView state={state} actions={actions} onNavigate={setNav} onOpenPricing={() => setNav({ kind: "settings", page: "model-pricing" })} />
                        </div>
                    )}
                    {nav.kind === "council" && (
                        <div className="h-full w-full p-4 sm:p-6 lg:p-8">
                            <CouncilView state={state} actions={actions} onNavigate={setNav} />
                        </div>
                    )}
                    {nav.kind === "agents" && (
                        <div className="h-full w-full p-4 sm:p-6 lg:p-8">
                            <AgentsView state={state} actions={actions} onNavigate={setNav} />
                        </div>
                    )}
                    {nav.kind === "agent" && (
                        <div className="w-full p-4 sm:p-6 lg:p-8">
                            <AgentDetailView agentId={nav.id} state={state} actions={actions} onNavigate={setNav} />
                        </div>
                    )}
                    {nav.kind === "plan" && (
                        <div className="h-full w-full p-4 sm:p-6 lg:p-8">
                                <PlanView state={state} actions={actions} onNavigate={setNav} />
                        </div>
                    )}
                    {nav.kind === "email" && (
                        <div className="h-full p-4">
                            <EmailView state={state} actions={actions} onNavigate={setNav} />
                        </div>
                    )}
                    {nav.kind === "env" && (
                        <div className="h-full w-full p-4 sm:p-6 lg:p-8">
                            <EnvView state={state} actions={actions} />
                        </div>
                    )}
                    {/* LifeOS Ported Views */}
                    {nav.kind === "financial" && (
                        <div className="h-full w-full p-4 sm:p-6 lg:p-8">
                            <FinancialView client={client} onNavigate={setNav} />
                        </div>
                    )}
                    {nav.kind === "social" && (
                        <div className="h-full w-full p-4 sm:p-6 lg:p-8">
                            <SocialView state={state} actions={actions} onNavigate={setNav} client={client} />
                        </div>
                    )}
                    {nav.kind === "workouts" && (
                        <div className="h-full w-full p-4 sm:p-6 lg:p-8">
                            <WorkoutsView state={state} actions={actions} onNavigate={setNav} client={client} />
                        </div>
                    )}
                    {nav.kind === "nutrition" && (
                        <div className="h-full w-full p-4 sm:p-6 lg:p-8">
                            <NutritionView state={state} actions={actions} onNavigate={setNav} client={client} />
                        </div>
                    )}
                    {nav.kind === "health" && (
                        <div className="h-full w-full p-4 sm:p-6 lg:p-8">
                            <HealthView state={state} actions={actions} onNavigate={setNav} client={client} />
                        </div>
                    )}
                    {nav.kind === "tasks" && (
                        <div className="h-full w-full p-4 sm:p-6 lg:p-8">
                            <TasksView state={state} actions={actions} onNavigate={setNav} client={client} />
                        </div>
                    )}
                    {nav.kind === "keyvault" && (
                        <div className="h-full w-full p-4 sm:p-6 lg:p-8">
                            <KeyVaultView state={state} actions={actions} />
                        </div>
                    )}
                    {nav.kind === "calendar" && (
                        <div className="w-full p-4 sm:p-6 lg:p-8">
                            <CalendarView state={state} actions={actions} client={client} onNavigate={setNav} />
                        </div>
                    )}
                    {nav.kind === "projects" && (
                        <div className="h-full w-full overflow-hidden p-4 sm:p-6 lg:p-8">
                            <ProjectsListView state={state} actions={actions} onOpenProject={openProject} onNavigate={setNav} />
                        </div>
                    )}
                    {nav.kind === "github" && (
                        <div className="h-full w-full p-4 sm:p-6 lg:p-8">
                            <GithubView state={state} actions={actions} onNavigate={setNav} />
                        </div>
                    )}
                    {nav.kind === "settings" && <SettingsWindow state={state} actions={actions} page={nav.page} onNavigate={setNav} />}
                    {nav.kind === "project" &&
                        (activeProject ? (
                            <ProjectWorkspace project={activeProject} state={state} actions={actions} client={client} initialTab={nav.tab} onNavigate={setNav} />
                        ) : (
                            <div className="p-6 text-sm text-tertiary">Project not found. It may have been removed.</div>
                        ))}
                    </PageTransition>
                    )}
                </main>
                </AppErrorBoundary>

                {/* On narrow screens the docks overlay the main content; a scrim dims it and taps dismiss. */}
                {dockOverlay && (browserSessions.length > 0 || dockOpen) && (
                    <div
                        aria-hidden
                        onClick={() => { if (dockOpen) setDockOpen(false); else setBrowserSessions([]); }}
                        className="fixed inset-0 z-40 motion-safe:animate-[fadeIn_150ms_ease-out]"
                        style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(2px)" }}
                    />
                )}

                {browserSessions.length > 0 && (
                    <BrowserDock
                        overlay={dockOverlay}
                        sessions={browserSessions}
                        // AI/agent navigation lands in state.browser[id].url → drive the view via controlledUrl.
                        controlledUrls={Object.fromEntries(Object.values(state.browser).map((b) => [b.sessionId, b.url]).filter(([, u]) => !!u))}
                        // Sessions an agent currently owns → render the "AI controlled" badge.
                        aiControlledIds={new Set(Object.values(state.browser).filter((b) => b.aiControlled).map((b) => b.sessionId))}
                        controllerLabels={Object.fromEntries(Object.values(state.browser).filter((b) => b.controllerAgentId).map((b) => [b.sessionId, state.agents.find((agent) => agent.id === b.controllerAgentId)?.config.name ?? b.controllerAgentId!]))}
                        onTakeOver={(id) => actions.browserTakeover(id)}
                        // Local user navigation → report back so the Brain's session model stays in sync.
                        onUrlChange={(id, url) => actions.browserReport(id, url)}
                        // Brain → host DOM/click/eval instructions (the Electron <webview> services these).
                        commands={state.browserCommands}
                        onResult={(result) => actions.browserResultReport(result)}
                        onHostCaps={(canScript) => actions.browserHostCaps(canScript)}
                        onClose={() => setBrowserSessions([])}
                        onNewTab={(url) => openBrowser(url ?? "")}
                        onCloseTab={closeBrowserTab}
                    />
                )}
                </div>

                {dockOpen && (
                    <TerminalDock
                        overlay={dockOverlay}
                        defaultFullscreen
                        alwaysShowTabs={tabsAlwaysShow}
                        showTabsInFullscreen={tabsShowInFullScreen}
                        tabWidthMode={tabsWidthMode}
                        tabAcrylic={tabsAcrylic}
                        state={state}
                        actions={actions}
                        client={client}
                        onClose={() => setDockOpen(false)}
                        onFullscreenChange={setTerminalFullscreen}
                        focusSessionId={focusSessionId}
                        onFocusHandled={() => setFocusSessionId(null)}
                        popoutSessionId={popoutSessionId}
                        onPopoutHandled={() => setPopoutSessionId(null)}
                    />
                )}

                <div
                    aria-hidden={terminalExclusive || undefined}
                    inert={terminalExclusive}
                    style={{ display: terminalExclusive ? "none" : "contents" }}
                >
                {/* Bottom-right status cluster: terminals + active agents (with their linked terminals). */}
                {showStatusBar && <StatusCluster state={state} actions={actions} onOpenTerminal={openTerminal} onPopoutTerminal={popoutTerminal} onOpenFiles={() => setNav({ kind: "files" })} notice={state.lastNotice} connected={connected} askDockVisible={askDockVisible} onToggleAskDock={toggleAskDock} />}

                {/* Bottom-center universal search / command palette (Ctrl+K). */}
                <CommandPalette
                    state={state}
                    actions={actions}
                    onNavigate={setNav}
                    hideLauncher={!askDockVisible || nav.kind === "aichat" || dockOpen}
                    onToggleTerminal={toggleDock}
                    onNewProject={() => setNav({ kind: "projects" })}
                    onOpenBrowser={(url) => openBrowser(url ?? "")}
                />

                <CoretexTour isOpen={tourOpen} onClose={closeTour} onNavigate={setNav} />
                <Toaster notice={state.lastNotice} />
                </div>
            </div>
            </AppErrorBoundary>
        </ThemeProvider>
    );
};
