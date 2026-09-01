// @ts-nocheck
"use client";

// Coretex Relay — the live dashboard. Composes every panel over a single
// useCoretex() connection to the Brain. Rendered identically by the web app
// and the desktop (Electron) renderer.

import { Cube01 } from "@untitledui/icons";
import { BadgeWithDot } from "@/components/base/badges/badges";
import { cx } from "@/utils/cx";
import { AgentsPanel } from "./panels/agents-panel";
import { CostMeter } from "./panels/cost-meter";
import { NewTaskForm } from "./panels/new-task-form";
import { ProviderHealthStrip } from "./panels/provider-health";
import { SystemLog } from "./panels/system-log";
import { TaskBoard } from "./panels/task-board";
import { useCoretex } from "./use-coretex";

export interface CoretexDashboardProps {
    /** WebSocket URL of the Brain bridge. Defaults to ws://localhost:8765. */
    url?: string;
    /** Ephemeral local bridge token supplied by the trusted host. */
    authToken?: string;
    className?: string;
}

export const CoretexDashboard = ({ url, authToken, className }: CoretexDashboardProps) => {
    const { state, connected, actions } = useCoretex(url, authToken);

    const activeAgents = state.agents.filter((a) => a.status === "working" || a.status === "thinking").length;
    const openTasks = state.tasks.filter((t) => t.status !== "completed" && t.status !== "cancelled" && t.status !== "failed").length;

    return (
        <div className={cx("flex h-dvh flex-col overflow-hidden bg-secondary_subtle", className)}>
            {/* Header */}
            <header className="flex shrink-0 items-center justify-between gap-4 border-b border-secondary bg-primary px-5 py-3">
                <div className="flex items-center gap-3">
                    <div className="flex size-9 items-center justify-center rounded-lg bg-brand-solid text-white">
                        <Cube01 className="size-5" />
                    </div>
                    <div>
                        <h1 className="text-md font-semibold text-primary">Coretex</h1>
                        <p className="text-xs text-tertiary">Your local AI agent workspace</p>
                    </div>
                </div>

                <div className="flex items-center gap-3 text-xs text-tertiary">
                    <span className="hidden sm:inline">
                        {activeAgents} active · {state.agents.length} agents · {openTasks} open tasks
                    </span>
                    <BadgeWithDot type="pill-color" size="md" color={connected ? "success" : "error"}>
                        {connected ? "Connected" : "Offline"}
                    </BadgeWithDot>
                </div>
            </header>

            {/* Body */}
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
                <div className="flex w-full flex-col gap-5">
                    <ProviderHealthStrip state={state} actions={actions} />

                    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
                        {/* Primary column */}
                        <div className="flex flex-col gap-5">
                            <TaskBoard state={state} actions={actions} />
                            <AgentsPanel state={state} actions={actions} />
                        </div>

                        {/* Side column */}
                        <div className="flex flex-col gap-5">
                            <CostMeter state={state} actions={actions} />
                            <NewTaskForm state={state} actions={actions} />
                            <SystemLog state={state} actions={actions} />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
