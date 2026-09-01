// @ts-nocheck
"use client";

// Coretex Relay — Home view (global, all-projects dashboard).
// Full-width stack that reflows cleanly from phone-width docks to ultrawide:
// hero → metrics → providers → task board → agents → cost / new-task / log.

import type { CoretexActions, CoretexState } from "../use-coretex";
import type { NavTarget } from "../nav";
import { DashboardMetrics } from "../panels/dashboard-metrics";
import { HomeHero } from "../panels/home-hero";
import { ProviderHealthStrip } from "../panels/provider-health";
import { TaskBoard } from "../panels/task-board";
import { AgentsPanel } from "../panels/agents-panel";
import { CostMeter } from "../panels/cost-meter";
import { SystemLog } from "../panels/system-log";
import { NewTaskForm } from "../panels/new-task-form";

export const HomeView = ({
  state,
  actions,
  onNavigate,
}: {
  state: CoretexState;
  actions: CoretexActions;
  onNavigate?: (t: NavTarget) => void;
}) => {
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1600px] flex-col gap-5 sm:gap-6 lg:gap-8">
      {/* Hero / onboarding banner */}
      <HomeHero
        projectCount={state.projects.length}
        agentCount={state.agents.length}
        onNavigate={onNavigate}
      />

      {/* Live metric row */}
      <DashboardMetrics
        state={state}
        actions={actions}
        onNavigate={onNavigate}
      />

      <ProviderHealthStrip
        state={state}
        actions={actions}
        onNavigate={onNavigate}
      />

      {/* Task board — shared full-width kanban (same layout as project Kanban tab) */}
      <div className="w-full min-w-0 overflow-x-auto">
        <TaskBoard state={state} actions={actions} />
      </div>

      {/* Agents — full width grid */}
      <AgentsPanel state={state} actions={actions} onNavigate={onNavigate} />

      {/* Cost / New task / Log — stack on phones, 2-up tablet, 3-up desktop */}
      <div className="grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2 xl:grid-cols-3 xl:gap-6">
        <div className="min-w-0">
          <CostMeter state={state} actions={actions} onNavigate={onNavigate} />
        </div>
        <div className="min-w-0">
          <NewTaskForm state={state} actions={actions} />
        </div>
        <div className="min-w-0 md:col-span-2 xl:col-span-1">
          <SystemLog state={state} actions={actions} />
        </div>
      </div>
    </div>
  );
};
