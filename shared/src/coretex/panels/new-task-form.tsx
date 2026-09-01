// @ts-nocheck
"use client";

// Coretex Relay — New Task form. Create a generic task or one tied to a project,
// optionally dispatch one or many agents, set master-planning effort, and pick a
// color-coded priority/role. All controls are Untitled UI.

import { useState } from "react";
import { Plus, Check } from "@untitledui/icons";
import type {
  AgentRole,
  ClaudeExecutionMode,
  TaskPriority,
} from "@repo/coretex/types";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { NativeSelect } from "@/components/base/select/select-native";
import { Slider } from "@/components/base/slider/slider";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { cx } from "@/utils/cx";
import { titleCase, roleLabel } from "../labels";
import { IdentityAvatar } from "../ui/identity-avatar";
import { ClaudeTierSelect } from "../ui/claude-tier-badge";
import {
  PLANNING_DEPTH_LEVELS,
  planningDepthMeta,
  snapPlanningDepth,
} from "../ui/planning-depth";
import {
  chipSelectClass,
  chipSelectStyle,
  pillSelectClass,
} from "../ui/pill-select";
import {
  priorityColor,
  roleColor,
  type CoretexActions,
  type CoretexState,
} from "../use-coretex";

const PRIORITIES: TaskPriority[] = ["low", "medium", "high", "critical"];
const ROLE_OPTIONS: AgentRole[] = [
  "developer",
  "planner",
  "researcher",
  "writer",
  "analyst",
  "reviewer",
  "qa",
  "devops",
];

/** The five master-planning effort levels, each anchored at a slider value. */
const EFFORT_LEVELS: {
  at: number;
  max: number;
  label: string;
  desc: string;
}[] = [
  // Anchors are evenly spaced (0/25/50/75/100) so the thumb lines up under its
  // evenly-spaced label, and `max` splits the track into five equal snap ranges.
  {
    at: 0,
    max: 12,
    label: "Off",
    desc: "No upfront planning — the agent starts work immediately.",
  },
  {
    at: 25,
    max: 37,
    label: "Quick",
    desc: "One planning pass (~seconds): a short outline, then execute.",
  },
  {
    at: 50,
    max: 62,
    label: "Balanced",
    desc: "A few planning passes: steps are outlined before any execution.",
  },
  {
    at: 75,
    max: 87,
    label: "Thorough",
    desc: "Multi-step plan with sub-tasks (~a minute of planning first).",
  },
  {
    at: 100,
    max: 100,
    label: "Deep",
    desc: "Exhaustive plan: decomposed sub-tasks + a review pass before execution.",
  },
];

/** Master-planning effort → human label + what it actually changes (planning depth before execution). */
function effortMeta(v: number): { label: string; desc: string } {
  return (
    EFFORT_LEVELS.find((l) => v <= l.max) ??
    EFFORT_LEVELS[EFFORT_LEVELS.length - 1]
  );
}

export const NewTaskForm = ({
  state,
  actions,
}: {
  state: CoretexState;
  actions: CoretexActions;
}) => {
  const settings = state.settings;
  const projects = state.projects ?? [];
  const agents = state.agents ?? [];

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [requiredRole, setRequiredRole] = useState<string>("");
  const [projectId, setProjectId] = useState<string>("");
  const [assigned, setAssigned] = useState<string[]>([]);
  const [effort, setEffort] = useState<number>(50);
  const [executionMode, setExecutionMode] =
    useState<ClaudeExecutionMode>("autonomous");

  const canSubmit = title.trim().length > 0;

  const toggleAgent = (id: string) =>
    setAssigned((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    );

  const handleSubmit = () => {
    if (!canSubmit) return;
    actions.createTask({
      title: title.trim(),
      description: description.trim(),
      priority,
      ...(requiredRole ? { requiredRole: requiredRole as AgentRole } : {}),
      ...(projectId ? { projectId } : {}),
      ...(assigned.length ? { assignedAgentIds: assigned } : {}),
      ...(effort ? { planningEffort: effort } : {}),
      executionMode,
    });
    setTitle("");
    setDescription("");
    setAssigned([]);
    setEffort(50);
    setExecutionMode("autonomous");
  };

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-secondary bg-primary p-5">
      <div className="flex items-center gap-3">
        <FeaturedIcon icon={Plus} size="md" color="gray" theme="light" />
        <div className="flex flex-col">
          <h3 className="text-sm font-semibold text-primary">New Task</h3>
          <p className="text-xs text-tertiary">
            Queue work — generic or tied to a project
          </p>
        </div>
      </div>

      <Input
        label="Title"
        placeholder="What needs doing?"
        value={title}
        onChange={setTitle}
      />
      <Input
        label="Description"
        placeholder="Add context for the agent…"
        value={description}
        onChange={setDescription}
      />

      {/* Project */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-tertiary">Project</span>
        <NativeSelect
          aria-label="Project"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          options={[
            { label: "Generic (no project)", value: "" },
            ...projects.map((p) => ({ label: p.name, value: p.id })),
          ]}
        />
      </div>

      {/* Priority — clickable pills; selected = quiet neutral ring (not brand red) */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-tertiary">Priority</span>
        <div className="flex flex-wrap gap-2">
          {PRIORITIES.map((p) => {
            const on = priority === p;
            return (
              <button
                key={p}
                type="button"
                onClick={() => setPriority(p)}
                title={`${titleCase(p)} priority`}
                className={pillSelectClass(on)}
              >
                <Badge type="color" size="md" color={priorityColor(p, settings)}>
                  {titleCase(p)}
                </Badge>
              </button>
            );
          })}
        </div>
      </div>

      {/* Role — clickable pills */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-tertiary">
          Assign to role
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setRequiredRole("")}
            className={cx(
              "rounded-lg px-3 py-1 text-xs font-medium transition",
              requiredRole === ""
                ? "bg-[var(--surface-2)] text-primary"
                : "text-tertiary hover:text-secondary",
            )}
            style={{
              border: "1px solid var(--c-border)",
              boxShadow:
                requiredRole === ""
                  ? "inset 0 0 0 1px color-mix(in srgb, var(--c-text-primary) 10%, transparent)"
                  : undefined,
            }}
          >
            Any
          </button>
          {ROLE_OPTIONS.map((r) => {
            const on = requiredRole === r;
            return (
              <button
                key={r}
                type="button"
                onClick={() => setRequiredRole(r)}
                title={`Assign to ${roleLabel(r)}`}
                className={pillSelectClass(on)}
              >
                <Badge
                  type="color"
                  size="md"
                  color={roleColor(r, settings)}
                >
                  {roleLabel(r)}
                </Badge>
              </button>
            );
          })}
        </div>
      </div>

      {/* Dispatch agents */}
      {agents.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-tertiary">
            Assign agents{" "}
            {assigned.length > 1 && (
              <span className="text-quaternary">
                ({assigned.length} collaborating)
              </span>
            )}
          </span>
          <div className="flex flex-wrap gap-2">
            {agents.map((a) => {
              const on = assigned.includes(a.id);
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => toggleAgent(a.id)}
                  className={cx(chipSelectClass(on), "max-w-full flex-wrap")}
                  title={a.config.name}
                  style={chipSelectStyle(on)}
                >
                  <IdentityAvatar
                    identity={a.config.identity}
                    name={a.config.name}
                    avatarUrl={a.config.avatarUrl}
                    size={18}
                  />
                  <span className="min-w-0 break-words font-medium text-primary [overflow-wrap:anywhere]">
                    {a.config.name}
                  </span>
                  {on && <Check className="size-3 text-secondary" />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Planning effort — explains what the value actually does (planning depth before execution) */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-tertiary">
            Planning depth
          </span>
          <span className="text-xs font-medium text-primary">
            {planningDepthMeta(effort).label}{" "}
            <span className="text-quaternary">({effort}%)</span>
          </span>
        </div>
        <Slider
          aria-label="Planning depth"
          value={effort}
          onChange={(v) =>
            setEffort(snapPlanningDepth(Array.isArray(v) ? v[0] : v))
          }
          minValue={0}
          maxValue={100}
          step={25}
        />
        {/* Level scale — click a level to snap there; the active one is highlighted. */}
        <div className="flex items-center justify-between">
          {PLANNING_DEPTH_LEVELS.map((level) => {
            const active = planningDepthMeta(effort).value === level.value;
            return (
              <button
                key={level.value}
                type="button"
                onClick={() => setEffort(level.value)}
                title={level.description}
                className={cx(
                  "rounded px-1.5 py-0.5 text-[10px] font-medium transition",
                  active
                    ? "text-primary"
                    : "text-quaternary hover:text-secondary",
                )}
                style={
                  active
                    ? {
                        background: "var(--surface-2)",
                        border: "1px solid var(--c-border)",
                      }
                    : undefined
                }
              >
                {level.label}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] leading-snug text-quaternary">
          {planningDepthMeta(effort).description}
        </p>
      </div>

      {/* Execution mode — which Claude tier runs this task */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-tertiary">
          Execution mode
        </span>
        <ClaudeTierSelect
          value={executionMode}
          onChange={setExecutionMode}
          size="sm"
        />
      </div>

      <Button
        size="md"
        color="primary"
        iconLeading={Plus}
        isDisabled={!canSubmit}
        onClick={handleSubmit}
      >
        Create Task
      </Button>
    </div>
  );
};
