// @ts-nocheck
"use client";

// Coretex Relay — the per-project workspace. A secondary tab bar over one project,
// slicing the shared orchestrator state by project id. Kanban (state) and Queue
// (run order) are intentionally distinct views of the same tasks.

import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";
import { Columns01, Dataflow03, LayoutGrid01 } from "@untitledui/icons";
import type { Project } from "@repo/coretex/types";
import type { BridgeClient } from "@repo/coretex/client";
import { cx } from "@/utils/cx";
import { Button } from "@/components/base/buttons/button";
import { ProjectIcon } from "../ui/project-icon";
import { IconPicker } from "../ui/icon-picker";
import { ColorPicker } from "../ui/color-picker";
import { PageTransition } from "../ui/page-transition";
import { PROJECT_TABS, type NavTarget, type ProjectTab } from "../nav";
import type { CoretexActions, CoretexState } from "../use-coretex";
import { OverviewTab } from "./overview-tab";
import { AgentsTab } from "./agents-tab";
import { KanbanTab } from "./kanban-tab";
import { QueueTab } from "./queue-tab";
import { DocumentsTab } from "./documents-tab";
import { GitTab } from "./git-tab";
import { ChatTab } from "./chat-tab";
import { BillingTab } from "./billing-tab";
import { ProjectSettingsTab } from "./project-settings-tab";
import { ProjectTerminalsTab } from "./project-terminals-tab";
import { ProjectSecretsTab } from "./project-secrets-tab";
import { ProjectCanvasTab } from "./canvas/project-canvas-tab";
import { CanvasActionDock, type CanvasDockViewMode } from "../views/canvas-action-dock";

type ProjectWorkspaceDockView = "overview" | "graph";

const PROJECT_WORKSPACE_DOCK_VIEWS: readonly CanvasDockViewMode<ProjectWorkspaceDockView>[] = [
    { id: "overview", label: "Overview", icon: LayoutGrid01, description: "View project metrics and activity" },
    { id: "graph", label: "Graph", icon: Dataflow03, description: "Arrange and connect project objects" },
];

interface Props {
    project: Project;
    state: CoretexState;
    actions: CoretexActions;
    client?: BridgeClient;
    initialTab?: ProjectTab;
    onNavigate?: (t: NavTarget) => void;
}

export const ProjectWorkspace = ({ project, state, actions, client, initialTab, onNavigate }: Props) => {
    const [tab, setTab] = useState<ProjectTab>(initialTab ?? "overview");
    const [iconOpen, setIconOpen] = useState(false);
    const reduceMotion = useReducedMotion();

    // Deep links and context-menu actions can target another tab while this same
    // project workspace remains mounted. Keep the local tab in sync with them.
    useEffect(() => {
        if (initialTab) setTab(initialTab);
    }, [initialTab]);

    const tabProps = { project, state, actions, onNavigate };

    return (
        <div className="relative flex h-full min-w-0 flex-col overflow-hidden">
            {/* Project header */}
            <div className="shrink-0 px-4 pt-4 sm:px-6 sm:pt-6">
                <div className="flex min-w-0 items-start gap-3">
                    {/* Project icon — click to customize */}
                    <div className="relative shrink-0">
                        <button
                            type="button"
                            onClick={() => setIconOpen((v) => !v)}
                            title="Change project icon"
                            className="rounded-lg p-0.5 transition hover:bg-[var(--surface-2)]"
                            style={{
                                filter: project.appearance?.glow && project.color ? `drop-shadow(0 0 8px ${project.color})` : undefined,
                            }}
                        >
                            <ProjectIcon
                                icon={project.icon}
                                color={project.color}
                                size={project.appearance?.largeHeaderIcon ? 44 : 34}
                            />
                        </button>
                        {iconOpen && (
                            <>
                                <div className="fixed inset-0 z-30" onClick={() => setIconOpen(false)} />
                                <div className="absolute left-0 top-full z-40 mt-1 w-80 max-w-[calc(100vw-2rem)] rounded-xl p-3 shadow-xl" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}>
                                    <p className="mb-2 text-xs font-medium text-secondary">Project icon</p>
                                    <IconPicker
                                        value={project.icon}
                                        color={project.color}
                                        density="comfortable"
                                        onChange={(name) => actions.setProjectIcon(project.id, name, project.color)}
                                    />
                                    <p className="mb-2 mt-3 text-xs font-medium text-secondary">Color</p>
                                    <ColorPicker value={project.color ?? ""} onChange={(c) => actions.setProjectIcon(project.id, project.icon, c || undefined)} />
                                    <Button
                                        size="sm"
                                        color="link-gray"
                                        className="mt-2"
                                        onClick={() => {
                                            setIconOpen(false);
                                            setTab("settings");
                                        }}
                                    >
                                        Open full appearance settings
                                    </Button>
                                </div>
                            </>
                        )}
                    </div>
                    <div className="min-w-0 flex-1">
                        <h1 className="break-words text-display-xs font-semibold leading-tight text-primary [overflow-wrap:anywhere]" title={project.name}>{project.name}</h1>
                        {project.description && <p className="mt-0.5 max-w-2xl break-words text-sm text-tertiary [overflow-wrap:anywhere]" title={project.description}>{project.description}</p>}
                    </div>
                </div>

                {/* Secondary tab bar */}
                <div className="mt-4 flex gap-1 overflow-x-auto" style={{ borderBottom: "1px solid var(--c-border)" }}>
                    {PROJECT_TABS.map((t) => {
                        const active = t.id === tab;
                        return (
                            <button
                                key={t.id}
                                type="button"
                                onClick={() => setTab(t.id)}
                                className={cx(
                                    "whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition",
                                    active ? "text-primary" : "border-transparent text-tertiary hover:text-secondary",
                                )}
                                style={active ? { borderColor: "var(--brand)", color: "var(--sidebar-active-fg)" } : { borderColor: "transparent" }}
                            >
                                {t.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Active tab — full width so Kanban columns can span the content area */}
            <div
                className={cx(
                    "min-h-0 w-full min-w-0 flex-1",
                    tab === "canvas" ? "overflow-hidden p-0" : "overflow-y-auto p-4 sm:p-6 lg:p-8",
                )}
                style={tab === "overview" ? { paddingBottom: "8rem" } : undefined}
            >
                <PageTransition pageKey={tab} reduceMotion={reduceMotion} tone="soft" className="w-full min-w-0">
                    {tab === "overview" && <OverviewTab {...tabProps} />}
                    {tab === "canvas" && <ProjectCanvasTab project={project} state={state} actions={actions} onOpenTab={setTab} onNavigate={onNavigate} />}
                    {tab === "agents" && <AgentsTab {...tabProps} />}
                    {tab === "kanban" && <KanbanTab {...tabProps} />}
                    {tab === "queue" && <QueueTab {...tabProps} />}
                    {tab === "documents" && <DocumentsTab {...tabProps} />}
                    {tab === "git" && <GitTab {...tabProps} />}
                    {tab === "secrets" && <ProjectSecretsTab {...tabProps} onNavigate={onNavigate} />}
                    {tab === "chat" && <ChatTab {...tabProps} />}
                    {tab === "terminals" && <ProjectTerminalsTab project={project} state={state} actions={actions} client={client} />}
                    {tab === "billing" && <BillingTab {...tabProps} />}
                    {tab === "settings" && <ProjectSettingsTab {...tabProps} />}
                </PageTransition>
            </div>

            {tab === "overview" && (
                <CanvasActionDock
                    label="Project overview actions"
                    viewModes={PROJECT_WORKSPACE_DOCK_VIEWS}
                    activeView="overview"
                    onViewChange={(view) => {
                        if (view === "graph") setTab("canvas");
                    }}
                    primaryAction={{
                        id: "add-task",
                        label: "Add task",
                        icon: Columns01,
                        onClick: () => setTab("kanban"),
                        description: "Open the project task composer",
                        tone: "brand",
                    }}
                />
            )}
        </div>
    );
};
