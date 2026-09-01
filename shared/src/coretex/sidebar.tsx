// @ts-nocheck
"use client";

// Coretex Relay — bespoke dark sidebar (never the stock Untitled UI white panel).
// Surfaces are driven by the --sidebar-* / --c-* theme tokens so it reads as a
// custom dark rail in dark mode and a tinted gray rail in light mode.

import { ArrowLeft, Calendar, LineChartUp03, ChevronLeft, ChevronRight, Database01, Edit03, FileCode02, Folder, FolderCode, Home01, Key02, LayoutAlt01, Mail01, MessageChatCircle, RefreshCcw01, SearchLg, Trash01, Users01, ClipboardCheck, Plus, Server01, Settings01, Signal01, Stars01, Terminal, Cube01, File02, GitBranch01, BankNote01, Activity, ActivityHeart, Beaker01, CheckSquare } from "@untitledui/icons";
import type { Project } from "@repo/coretex/types";
import { Badge, BadgeWithDot } from "@/components/base/badges/badges";
import { Input } from "@/components/base/input/input";
import { cx } from "@/utils/cx";
import { formatTokens, formatUSD, type CoretexActions } from "./use-coretex";
import { ThemeToggle } from "./theme";
import { AccountMenu, type AccountInfo } from "./ui/account-menu";
import { ProjectIcon } from "./ui/project-icon";
import { useContextMenu, type MenuItem } from "./ui/context-menu";
import type { NavTarget, TopLevel } from "./nav";
import { SETTINGS_GROUPS, SETTINGS_ICONS, isSettingsPageId, type SettingsPageId } from "./settings/settings-nav";
import { useEffect, useMemo, useState } from "react";

interface SidebarProps {
    active: TopLevel;
    activeProjectId?: string;
    /** When Settings is open — which settings page is selected in the rail. */
    settingsPage?: string;
    /** Leave Settings and restore the main software sidebar. */
    onExitSettings?: () => void;
    projects: Project[];
    connected: boolean;
    costToday: number;
    tokensToday: number;
    serverCount: number;
    /** projectId -> count of running servers attributed to it (per-project badge). */
    projectServerCounts?: Record<string, number>;
    /** Running Docker containers (sidebar badge). */
    containerCount: number;
    terminalCount: number;
    agentCount: number;
    account?: AccountInfo;
    dockOpen: boolean;
    /** Brain action helpers — power the right-click context menus (reindex, delete, rescan, …). */
    actions?: CoretexActions;
    onToggleTerminal: () => void;
    onNavigate: (target: NavTarget) => void;
    onNewProject: () => void;
    onStartTour?: () => void;
    /** From Appearance settings: how the rail collapses. */
    collapseMode?: "hover" | "expanded" | "collapsed" | "manual";
    /** From Appearance settings: expanded rail width in px. */
    width?: number;
    /** From Appearance settings: row spacing density. "compact" tightens padding/height. */
    density?: "comfortable" | "compact";
    /** From Appearance settings: whether the inline project list is shown under "Projects". */
    showProjects?: boolean;
}

/**
 * Density-derived class tokens. "compact" tightens row height + section padding so more
 * of the nav fits on short viewports; "comfortable" keeps the roomy default.
 */
interface Density {
    /** NavItem vertical padding. */
    itemPy: string;
    /** Section subheading top/bottom padding. */
    sectionPad: string;
    /** Project row vertical padding. */
    projectPy: string;
    /** Gap between sibling nav rows. */
    gap: string;
}
const DENSITY: Record<"comfortable" | "compact", Density> = {
    comfortable: {
        itemPy: "py-2",
        sectionPad: "pt-3.5 pb-1",
        projectPy: "py-1.5",
        gap: "gap-0.5",
    },
    compact: {
        itemPy: "py-1.5",
        sectionPad: "pt-2.5 pb-0.5",
        projectPy: "py-1",
        gap: "gap-px",
    },
};

// Thin, themed scrollbar for the nav scroll region (Firefox + WebKit). Injected once
// so the rail doesn't depend on a global utility being present in every host's CSS.
const SCROLL_STYLE_ID = "coretex-sidebar-scroll-style";
function ensureScrollStyle() {
    if (typeof document === "undefined") return;
    if (document.getElementById(SCROLL_STYLE_ID)) return;
    const el = document.createElement("style");
    el.id = SCROLL_STYLE_ID;
    el.textContent = `
.coretex-sidebar-scroll { scrollbar-width: thin; scrollbar-color: var(--c-border) transparent; overscroll-behavior: contain; }
.coretex-sidebar-scroll::-webkit-scrollbar { width: 8px; }
.coretex-sidebar-scroll::-webkit-scrollbar-track { background: transparent; }
.coretex-sidebar-scroll::-webkit-scrollbar-thumb { background: transparent; border-radius: 9999px; border: 2px solid transparent; background-clip: padding-box; }
.coretex-sidebar-scroll:hover::-webkit-scrollbar-thumb { background: var(--c-border); background-clip: padding-box; }
.coretex-sidebar-scroll::-webkit-scrollbar-thumb:hover { background: var(--c-text-muted); background-clip: padding-box; }`;
    document.head.appendChild(el);
}

interface NavItemProps {
    icon: typeof Home01;
    label: string;
    active?: boolean;
    collapsed: boolean;
    onClick: () => void;
    trailing?: React.ReactNode;
    /** Optional right-click handler — additive to the existing left-click `onClick`. */
    onContextMenu?: (e: React.MouseEvent) => void;
    /** Row vertical-padding class from the active density. */
    py?: string;
    /** Optional data-tour key so the onboarding spotlight can anchor to this row. */
    "data-tour"?: string;
}

const NavItem = ({ icon: Icon, label, active, collapsed, onClick, trailing, onContextMenu, py = "py-2", "data-tour": dataTour }: NavItemProps) => (
    <button
        type="button"
        onClick={onClick}
        onContextMenu={onContextMenu}
        data-tour={dataTour}
        title={label}
        className={cx("group flex w-full cursor-pointer items-center gap-2 rounded-md px-3 text-sm transition-[background-color,color,box-shadow,transform] duration-150 ease-out", "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sidebar-bg)]", py, active ? "font-medium" : "font-normal hover:bg-[var(--surface-2)]", collapsed && "justify-center px-0")}
        style={{
            background: active ? "var(--sidebar-active-bg)" : undefined,
            color: active ? "var(--sidebar-active-fg)" : "var(--c-text-secondary)",
            // Active items wear the brand accent the user loves — a soft translucent ring,
            // matching the Agents/Terminals chip glow.
            boxShadow: active ? "inset 0 0 0 1px color-mix(in srgb, var(--brand) 34%, transparent)" : undefined,
        }}
    >
        <Icon className="size-4 shrink-0" style={active ? { color: "var(--brand)" } : undefined} />
        {!collapsed && <span className="min-w-0 flex-1 break-words text-left leading-5">{label}</span>}
        {!collapsed && trailing}
    </button>
);

/** Grouped-section subheading. Collapses to a thin divider when the rail is narrow. */
const SectionLabel = ({ collapsed, pad = "pt-3.5 pb-1", children }: { collapsed: boolean; pad?: string; children: React.ReactNode }) =>
    collapsed ? (
        <div className="mx-auto my-1.5 h-px w-6" style={{ background: "var(--c-border)" }} />
    ) : (
        <p className={cx("px-3 text-[11px] font-semibold uppercase tracking-wider", pad)} style={{ color: "var(--c-text-muted)" }}>
            {children}
        </p>
    );

/** Count pill — neutral gray for static counts, success (green dot) for live/running. */
const CountBadge = ({ n, live }: { n: number; live?: boolean }) =>
    live ? (
        <BadgeWithDot color="success" type="pill-color" size="sm">
            {n}
        </BadgeWithDot>
    ) : (
        <Badge color="gray" type="pill-color" size="sm">
            {n}
        </Badge>
    );

export const Sidebar = ({ active, activeProjectId, settingsPage, onExitSettings, projects, connected, costToday, tokensToday, serverCount, projectServerCounts, containerCount, terminalCount, agentCount, account, dockOpen, actions, onToggleTerminal, onNavigate, onNewProject, onStartTour, collapseMode = "manual", width = 240, density = "comfortable", showProjects = true }: SidebarProps) => {
    const [manualCollapsed, setManualCollapsed] = useState(false);
    const [hovering, setHovering] = useState(false);
    const [settingsQuery, setSettingsQuery] = useState("");
    const { open: openMenu, node: menuNode } = useContextMenu();
    const d = DENSITY[density === "compact" ? "compact" : "comfortable"];
    useEffect(() => {
        ensureScrollStyle();
    }, []);

    const inSettings = active === "settings";
    const activeSettingsPage: SettingsPageId = isSettingsPageId(settingsPage) ? settingsPage : "account";

    const settingsGroups = useMemo(() => {
        const q = settingsQuery.trim().toLowerCase();
        if (!q) return SETTINGS_GROUPS;
        return SETTINGS_GROUPS.map((g) => ({
            ...g,
            items: g.items.filter((it) => it.label.toLowerCase().includes(q)),
        })).filter((g) => g.items.length > 0);
    }, [settingsQuery]);

    // Clear search when leaving settings so it doesn't linger next open.
    useEffect(() => {
        if (!inSettings) setSettingsQuery("");
    }, [inSettings]);

    // Right-click a project row → navigate shortcuts + Brain actions (rename / reindex / delete).
    const projectMenuItems = (p: Project): MenuItem[] => [
        { header: p.name },
        {
            key: "open",
            label: "Open",
            icon: Folder,
            onClick: () => onNavigate({ kind: "project", id: p.id, tab: "overview" }),
        },
        {
            // Submenu flyout: jump straight to any tab of this project.
            key: "open-in",
            label: "Open in",
            icon: LayoutAlt01,
            submenu: [
                {
                    key: "ov",
                    label: "Overview",
                    icon: Home01,
                    onClick: () => onNavigate({ kind: "project", id: p.id, tab: "overview" }),
                },
                {
                    key: "ag",
                    label: "Agents",
                    icon: Users01,
                    onClick: () => onNavigate({ kind: "project", id: p.id, tab: "agents" }),
                },
                {
                    key: "kb",
                    label: "Kanban",
                    icon: LayoutAlt01,
                    onClick: () => onNavigate({ kind: "project", id: p.id, tab: "kanban" }),
                },
                {
                    key: "ch",
                    label: "Chat",
                    icon: MessageChatCircle,
                    onClick: () => onNavigate({ kind: "project", id: p.id, tab: "chat" }),
                },
                {
                    key: "doc",
                    label: "Documents",
                    icon: File02,
                    onClick: () => onNavigate({ kind: "project", id: p.id, tab: "documents" }),
                },
                {
                    key: "git",
                    label: "Source Control",
                    icon: GitBranch01,
                    onClick: () => onNavigate({ kind: "project", id: p.id, tab: "git" }),
                },
            ],
        },
        { separator: true },
        {
            key: "rename",
            label: "Rename…",
            icon: Edit03,
            disabled: !actions,
            onClick: () => {
                if (!actions) return;
                const name = typeof window !== "undefined" ? window.prompt("Rename project", p.name)?.trim() : undefined;
                if (name && name !== p.name) actions.updateProject(p.id, { name });
            },
        },
        {
            key: "reindex",
            label: "Reindex code",
            icon: RefreshCcw01,
            disabled: !actions,
            onClick: () => actions?.reindexCode(p.id),
        },
        { separator: true },
        {
            key: "delete",
            label: "Delete project",
            icon: Trash01,
            danger: true,
            disabled: !actions,
            onClick: () => {
                if (!actions) return;
                const ok = typeof window === "undefined" || window.confirm(`Delete project "${p.name}"? This cannot be undone.`);
                if (ok) actions.deleteProject(p.id);
            },
        },
        { separator: true },
        { key: "new", label: "New project", icon: Plus, onClick: onNewProject },
    ];

    // Right-click a nav row → "Go to" + the row's most relevant quick action.
    const navMenu = (target: NavTarget, label: string, quick?: MenuItem): MenuItem[] => [{ key: "go", label: `Go to ${label}`, onClick: () => onNavigate(target) }, ...(quick ? [{ separator: true } as MenuItem, quick] : [])];

    // Settings mode always shows labels. Otherwise collapse follows Appearance setting.
    const collapsed = inSettings ? false : collapseMode === "hover" ? !hovering : collapseMode === "expanded" ? false : collapseMode === "collapsed" ? true : manualCollapsed;
    const expandedWidth = Math.max(160, Math.min(420, width));

    return (
        <>
            <aside
                onMouseEnter={!inSettings && collapseMode === "hover" ? () => setHovering(true) : undefined}
                onMouseLeave={!inSettings && collapseMode === "hover" ? () => setHovering(false) : undefined}
                className="flex h-dvh flex-col transition-all"
                style={{
                    width: collapsed ? "4rem" : `${expandedWidth}px`,
                    background: "var(--sidebar-bg)",
                    borderRight: "1px solid var(--glass-border, var(--c-border))",
                    backdropFilter: "blur(18px) saturate(140%)",
                    WebkitBackdropFilter: "blur(18px) saturate(140%)",
                }}
            >
                {inSettings ? (
                    <>
                        <div className="flex shrink-0 flex-col gap-3 px-3 pb-2 pt-4">
                            <button type="button" onClick={() => onExitSettings?.()} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm font-medium transition hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]" style={{ color: "var(--c-text-secondary)" }} title="Back to app">
                                <ArrowLeft className="size-4 shrink-0" />
                                <span className="truncate">Back</span>
                            </button>
                            <div className="flex items-center gap-2.5 px-1">
                                <div
                                    className="flex size-8 items-center justify-center rounded-lg"
                                    style={{
                                        background: "var(--surface-2)",
                                        border: "1px solid var(--c-border)",
                                    }}
                                >
                                    <Settings01 className="size-4 text-secondary" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-primary">Settings</p>
                                    <p className="truncate text-[11px] text-quaternary">Configure Coretex</p>
                                </div>
                            </div>
                            <Input value={settingsQuery} onChange={setSettingsQuery} placeholder="Search settings" icon={SearchLg} size="sm" />
                        </div>

                        <div className="coretex-sidebar-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pb-3">
                            <nav className={cx("flex flex-col", d.gap)}>
                                {settingsGroups.map((g) => (
                                    <div key={g.group}>
                                        <SectionLabel collapsed={false} pad={d.sectionPad}>
                                            {g.group}
                                        </SectionLabel>
                                        {g.items.map((it) => {
                                            const Icon = SETTINGS_ICONS[it.id];
                                            return (
                                                <NavItem
                                                    key={it.id}
                                                    icon={Icon}
                                                    label={it.label}
                                                    active={activeSettingsPage === it.id}
                                                    collapsed={false}
                                                    py={d.itemPy}
                                                    trailing={
                                                        it.availability === "coming-soon" ? (
                                                            <Badge color="warning" type="pill-color" size="sm">
                                                                Soon
                                                            </Badge>
                                                        ) : undefined
                                                    }
                                                    onClick={() => onNavigate({ kind: "settings", page: it.id })}
                                                />
                                            );
                                        })}
                                    </div>
                                ))}
                                {settingsGroups.length === 0 && <p className="px-2 pt-4 text-xs text-quaternary">No settings match “{settingsQuery}”.</p>}
                            </nav>
                        </div>

                        <div className="flex shrink-0 flex-col gap-1.5 p-3" style={{ borderTop: "1px solid var(--c-border)" }}>
                            <button
                                type="button"
                                onClick={() => {
                                    if (typeof window !== "undefined") window.location.reload();
                                }}
                                className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm font-medium transition hover:bg-[var(--surface-2)]"
                                style={{ color: "var(--c-text-secondary)" }}
                            >
                                <RefreshCcw01 className="size-4 shrink-0" />
                                <span className="truncate">Reload UI</span>
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        {/* Brand — PINNED at the top; never scrolls away */}
                        <div data-tour="sidebar-brand" className={cx("flex shrink-0 items-center gap-2 px-3 pt-4 pb-3", collapsed && "justify-center px-0")}>
                            <img src="./coretex-icon.svg" alt="Coretex" className="size-7 shrink-0" />
                            {!collapsed && (
                                <span className="text-sm font-semibold" style={{ color: "var(--c-text-primary)" }}>
                                    Coretex
                                </span>
                            )}
                        </div>

                        {/* Scroll region — the grouped nav + project list. Flexes to fill the gap
                between the pinned brand header and the pinned footer, scrolling on short
                viewports so neither chrome edge is ever pushed off-screen. */}
                        <div className="coretex-sidebar-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
                            {/* Primary nav — grouped into labelled sections for scannability */}
                            <nav className={cx("flex flex-col px-3", d.gap)}>
                                <SectionLabel collapsed={collapsed} pad={d.sectionPad}>
                                    Overview
                                </SectionLabel>
                                <NavItem icon={Home01} label="Home" data-tour="nav-home" active={active === "home"} collapsed={collapsed} py={d.itemPy} onClick={() => onNavigate({ kind: "home" })} />
                                <NavItem icon={Calendar} label="Calendar" active={active === "calendar"} collapsed={collapsed} py={d.itemPy} onClick={() => onNavigate({ kind: "calendar" })} />
                                <NavItem icon={Stars01} label="AI Chat" data-tour="nav-aichat" active={active === "aichat"} collapsed={collapsed} py={d.itemPy} onClick={() => onNavigate({ kind: "aichat" })} />
                                <NavItem icon={LineChartUp03} label="Usage & Analytics" active={active === "usage" || active === "analytics"} collapsed={collapsed} py={d.itemPy} onClick={() => onNavigate({ kind: "usage" })} />

                                <SectionLabel collapsed={collapsed} pad={d.sectionPad}>
                                    Personal
                                </SectionLabel>
                                <NavItem icon={Mail01} label="Email" active={active === "email"} collapsed={collapsed} py={d.itemPy} onClick={() => onNavigate({ kind: "email" })} />
                                <NavItem icon={BankNote01} label="Financial" active={active === "financial"} collapsed={collapsed} py={d.itemPy} onClick={() => onNavigate({ kind: "financial" })} />
                                <NavItem icon={Users01} label="Social" active={active === "social"} collapsed={collapsed} py={d.itemPy} onClick={() => onNavigate({ kind: "social" })} />
                                <NavItem icon={Activity} label="Workouts" active={active === "workouts"} collapsed={collapsed} py={d.itemPy} onClick={() => onNavigate({ kind: "workouts" })} />
                                <NavItem icon={Beaker01} label="Nutrition" active={active === "nutrition"} collapsed={collapsed} py={d.itemPy} onClick={() => onNavigate({ kind: "nutrition" })} />
                                <NavItem icon={ActivityHeart} label="Health" active={active === "health"} collapsed={collapsed} py={d.itemPy} onClick={() => onNavigate({ kind: "health" })} />
                                <NavItem icon={CheckSquare} label="Todos" active={active === "tasks"} collapsed={collapsed} py={d.itemPy} onClick={() => onNavigate({ kind: "tasks" })} />

                                <SectionLabel collapsed={collapsed} pad={d.sectionPad}>
                                    Workspace
                                </SectionLabel>
                                <NavItem icon={Users01} label="Agents" data-tour="nav-agents" active={active === "agents"} collapsed={collapsed} py={d.itemPy} onClick={() => onNavigate({ kind: "agents" })} trailing={agentCount > 0 ? <CountBadge n={agentCount} /> : undefined} />
                                <NavItem icon={MessageChatCircle} label="Council" active={active === "council"} collapsed={collapsed} py={d.itemPy} onClick={() => onNavigate({ kind: "council" })} />
                                <NavItem icon={ClipboardCheck} label="Plan" active={active === "plan"} collapsed={collapsed} py={d.itemPy} onClick={() => onNavigate({ kind: "plan" })} />
                                <NavItem
                                    icon={GitBranch01}
                                    label="GitHub"
                                    active={active === "github"}
                                    collapsed={collapsed}
                                    py={d.itemPy}
                                    onClick={() => onNavigate({ kind: "github" })}
                                    trailing={projects.some((project) => (project.repos?.length ?? 0) > 0) ? <CountBadge n={new Set(projects.flatMap((project) => (project.repos ?? []).map((repo) => repo.github ? `${repo.github.owner.toLowerCase()}/${repo.github.repo.toLowerCase()}` : `${project.id}:${repo.id}`))).size} /> : undefined}
                                />

                                {/* Projects sub-group: the subheading IS the label; the row below is "All projects" */}
                                {!collapsed && (
                                    <div className="flex items-center justify-between pr-1">
                                        <p className={cx("px-3 text-[11px] font-semibold uppercase tracking-wider", d.sectionPad)} style={{ color: "var(--c-text-muted)" }}>
                                            Projects
                                        </p>
                                        <button type="button" onClick={onNewProject} title="New project" className="flex size-5 cursor-pointer items-center justify-center rounded-md opacity-60 transition-[opacity,background-color,box-shadow] duration-150 ease-out hover:bg-[var(--surface-2)] hover:opacity-100 focus-visible:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sidebar-bg)]" style={{ color: "var(--c-text-secondary)" }}>
                                            <Plus className="size-3.5" />
                                        </button>
                                    </div>
                                )}
                                {collapsed && (
                                    <SectionLabel collapsed={collapsed} pad={d.sectionPad}>
                                        Projects
                                    </SectionLabel>
                                )}

                                <NavItem icon={Folder} label="All projects" active={active === "projects"} collapsed={collapsed} py={d.itemPy} onClick={() => onNavigate({ kind: "projects" })} />

                                {/* Inline project list — expanded rail only, and only when the
                    `sidebarShowProjects` appearance setting is on. */}
                                {!collapsed && showProjects && (
                                    <div className={cx("mt-0.5 flex flex-col", d.gap)}>
                                        {projects.length === 0 ? (
                                            <span className={cx("pl-9 pr-3 text-xs", d.projectPy)} style={{ color: "var(--c-text-muted)" }}>
                                                No projects yet
                                            </span>
                                        ) : (
                                            projects.map((p) => {
                                                const isActive = active === "project" && activeProjectId === p.id;
                                                const srv = projectServerCounts?.[p.id] ?? 0;
                                                return (
                                                    <button
                                                        key={p.id}
                                                        type="button"
                                                        onClick={() =>
                                                            onNavigate({
                                                                kind: "project",
                                                                id: p.id,
                                                                tab: "overview",
                                                            })
                                                        }
                                                        onContextMenu={(e) => openMenu(e, projectMenuItems(p))}
                                                        title={p.name}
                                                        className={cx(
                                                            "flex min-w-0 items-center gap-2 rounded-md pr-3 text-left text-sm transition-[background-color,color,box-shadow] duration-150 ease-out",
                                                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sidebar-bg)]",
                                                            d.projectPy,
                                                            isActive ? "font-medium" : "hover:bg-[var(--surface-2)]",
                                                            // Optional per-project accent rail (opt-in decoration) shifts padding to keep text aligned.
                                                            p.appearance?.accentRail && p.color ? "border-l-2 pl-[26px]" : "pl-7",
                                                        )}
                                                        style={{
                                                            // Selected projects now match the other nav items: soft brand inset ring, no
                                                            // brand left-border sliver. The accent rail (if enabled) keeps its own color.
                                                            background: isActive ? "var(--sidebar-active-bg)" : undefined,
                                                            color: isActive ? "var(--sidebar-active-fg)" : "var(--c-text-secondary)",
                                                            boxShadow: isActive ? "inset 0 0 0 1px color-mix(in srgb, var(--brand) 34%, transparent)" : undefined,
                                                            borderColor: p.appearance?.accentRail && p.color ? p.color : undefined,
                                                            borderLeftWidth: p.appearance?.accentRail && p.color ? 2 : undefined,
                                                        }}
                                                    >
                                                        <span
                                                            style={{
                                                                filter: p.appearance?.glow && p.color ? `drop-shadow(0 0 4px ${p.color})` : undefined,
                                                            }}
                                                        >
                                                            <ProjectIcon icon={p.icon} color={p.color} size={18} />
                                                        </span>
                                                        <span className="flex-1 truncate">{p.name}</span>
                                                        {srv > 0 && (
                                                            <span title={`${srv} running server${srv === 1 ? "" : "s"}`} className="shrink-0">
                                                                <CountBadge n={srv} live />
                                                            </span>
                                                        )}
                                                    </button>
                                                );
                                            })
                                        )}
                                    </div>
                                )}

                                <SectionLabel collapsed={collapsed} pad={d.sectionPad}>
                                    Infrastructure
                                </SectionLabel>
                                <NavItem icon={FolderCode} label="Files" data-tour="nav-files" active={active === "files"} collapsed={collapsed} py={d.itemPy} onClick={() => onNavigate({ kind: "files" })} />
                                <NavItem icon={Database01} label="Database" active={active === "database"} collapsed={collapsed} py={d.itemPy} onClick={() => onNavigate({ kind: "database" })} />
                                <NavItem
                                    icon={Cube01}
                                    label="Docker"
                                    active={active === "docker"}
                                    collapsed={collapsed}
                                    py={d.itemPy}
                                    onClick={() => onNavigate({ kind: "docker" })}
                                    onContextMenu={(e) =>
                                        openMenu(
                                            e,
                                            navMenu({ kind: "docker" }, "Docker", {
                                                key: "refresh",
                                                label: "Refresh containers",
                                                icon: RefreshCcw01,
                                                disabled: !actions,
                                                onClick: () => actions?.dockerRefresh(),
                                            }),
                                        )
                                    }
                                    trailing={containerCount > 0 ? <CountBadge n={containerCount} /> : undefined}
                                />
                                <NavItem icon={Server01} label="Remote" active={active === "remote"} collapsed={collapsed} py={d.itemPy} onClick={() => onNavigate({ kind: "remote" })} />
                                <NavItem
                                    icon={Signal01}
                                    label="Running servers"
                                    active={active === "servers"}
                                    collapsed={collapsed}
                                    py={d.itemPy}
                                    onClick={() => onNavigate({ kind: "servers" })}
                                    onContextMenu={(e) =>
                                        openMenu(
                                            e,
                                            navMenu({ kind: "servers" }, "Running servers", {
                                                key: "rescan",
                                                label: "Rescan ports",
                                                icon: RefreshCcw01,
                                                disabled: !actions,
                                                onClick: () => actions?.scanServers(),
                                            }),
                                        )
                                    }
                                    trailing={serverCount > 0 ? <CountBadge n={serverCount} /> : undefined}
                                />
                                <NavItem
                                    icon={Terminal}
                                    label="Terminal"
                                    active={dockOpen}
                                    collapsed={collapsed}
                                    py={d.itemPy}
                                    onClick={onToggleTerminal}
                                    onContextMenu={(e) =>
                                        openMenu(e, [
                                            {
                                                key: "toggle",
                                                label: dockOpen ? "Hide terminal dock" : "Open terminal dock",
                                                icon: Terminal,
                                                onClick: onToggleTerminal,
                                            },
                                            { separator: true },
                                            {
                                                key: "new",
                                                label: "New terminal",
                                                icon: Plus,
                                                disabled: !actions,
                                                onClick: () => {
                                                    if (!dockOpen) onToggleTerminal();
                                                    actions?.terminalCreate();
                                                },
                                            },
                                        ])
                                    }
                                    trailing={terminalCount > 0 ? <CountBadge n={terminalCount} live /> : undefined}
                                />

                                <SectionLabel collapsed={collapsed} pad={d.sectionPad}>
                                    Secrets
                                </SectionLabel>
                                <NavItem icon={FileCode02} label="Env vars" active={active === "env"} collapsed={collapsed} py={d.itemPy} onClick={() => onNavigate({ kind: "env" })} />
                                <NavItem icon={Key02} label="API keys" active={active === "keyvault"} collapsed={collapsed} py={d.itemPy} onClick={() => onNavigate({ kind: "keyvault" })} />
                            </nav>
                        </div>
                        {/* /scroll region */}

                        {/* Footer — PINNED at the bottom; account + status + collapse never scroll away */}
                        <div className="flex shrink-0 flex-col gap-1.5 p-3" style={{ borderTop: "1px solid var(--c-border)" }}>
                            {/* Account control */}
                            <AccountMenu collapsed={collapsed} connected={connected} account={account} onNavigate={onNavigate} onStartTour={onStartTour} />

                            {!collapsed && (
                                <>
                                    <div className="flex items-center justify-between">
                                        <ThemeToggle />
                                        <span
                                            className="inline-flex items-center gap-1.5 text-xs font-medium"
                                            style={{
                                                color: connected ? "var(--c-success)" : "var(--c-warning)",
                                            }}
                                        >
                                            <span
                                                className="size-1.5 rounded-full"
                                                style={{
                                                    background: connected ? "var(--c-success)" : "var(--c-warning)",
                                                }}
                                            />
                                            {connected ? "Connected" : "Reconnecting"}
                                        </span>
                                    </div>
                                    <div className="py-1 text-xs" style={{ color: "var(--c-text-muted)" }}>
                                        Today: {formatUSD(costToday)} · {formatTokens(tokensToday)} tokens
                                    </div>
                                </>
                            )}

                            <NavItem icon={Settings01} label="Settings" data-tour="nav-settings" active={(active as string) === "settings"} collapsed={collapsed} py={d.itemPy} onClick={() => onNavigate({ kind: "settings" })} />

                            {collapseMode === "manual" && (
                                <button type="button" onClick={() => setManualCollapsed((v) => !v)} className={cx("flex items-center gap-2 rounded-md px-3 py-1.5 text-xs transition", collapsed && "justify-center px-0")} style={{ color: "var(--c-text-muted)" }}>
                                    {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
                                    {!collapsed && "Collapse"}
                                </button>
                            )}
                        </div>
                    </>
                )}
            </aside>
            {menuNode}
        </>
    );
};
