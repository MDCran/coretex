// @ts-nocheck
"use client";

// Coretex Relay — Project-scoped Kanban workspace tab.
// Filters the global task list down to the active project, exposes a compact
// inline create row (the global NewTaskForm is not project-aware), and renders
// the shared TaskBoard against the scoped state.

import { useMemo, useState } from "react";
import { Plus, Check } from "@untitledui/icons";
import type { AgentRole, ClaudeExecutionMode, Project, Task, TaskPriority } from "@repo/coretex/types";
import { Button } from "@/components/base/buttons/button";
import { Badge } from "@/components/base/badges/badges";
import { Input } from "@/components/base/input/input";
import { TextArea } from "@/components/base/textarea/textarea";
import { Toggle } from "@/components/base/toggle/toggle";
import { Slider } from "@/components/base/slider/slider";
import { FileCode02, FileSearch02 } from "@untitledui/icons";
import { priorityColor, roleColor, type CoretexActions, type CoretexState } from "../use-coretex";
import { titleCase, roleLabel } from "../labels";
import { TaskBoard } from "../panels/task-board";
import { pillSelectClass, chipSelectClass, chipSelectStyle } from "../ui/pill-select";
import { IdentityAvatar } from "../ui/identity-avatar";
import { ClaudeTierSelect } from "../ui/claude-tier-badge";
import { PLANNING_DEPTH_LEVELS, planningDepthMeta, snapPlanningDepth } from "../ui/planning-depth";
import { cx } from "@/utils/cx";

const PRIORITIES: TaskPriority[] = ["low", "medium", "high", "critical"];
const ROLE_OPTIONS: AgentRole[] = ["developer", "planner", "researcher", "writer", "analyst", "reviewer", "qa", "devops"];

export const KanbanTab = ({
    project,
    state,
    actions,
}: {
    project: Project;
    state: CoretexState;
    actions: CoretexActions;
}) => {
    const [title, setTitle] = useState<string>("");
    const [description, setDescription] = useState<string>("");
    const [priority, setPriority] = useState<TaskPriority>("medium");
    const [requiredRole, setRequiredRole] = useState<string>("");
    const [assigned, setAssigned] = useState<string[]>([]);
    const [effort, setEffort] = useState<number>(50);
    const [executionMode, setExecutionMode] = useState<ClaudeExecutionMode>("autonomous");
    const [maxAgents, setMaxAgents] = useState<number>(1);
    const [useProjectContext, setUseProjectContext] = useState(false);
    const [useDocuments, setUseDocuments] = useState(false);
    const agents = state.agents ?? [];
    const toggleAgent = (id: string) => setAssigned((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

    // Restrict the board to tasks owned by this project. Spread keeps every
    // other field (agents, etc.) intact so TaskCard can still resolve assignees.
    const scoped: CoretexState = useMemo(
        () => ({ ...state, tasks: state.tasks.filter((t: Task) => t.projectId === project.id) }),
        [state, project.id],
    );

    const canSubmit = title.trim().length > 0;

    const handleCreate = (): void => {
        if (!canSubmit) return;
        actions.createTask({
            title: title.trim(),
            description: description.trim(),
            priority,
            projectId: project.id,
            useProjectContext,
            useDocuments,
            ...(requiredRole ? { requiredRole: requiredRole as AgentRole } : {}),
            ...(assigned.length ? { assignedAgentIds: assigned } : {}),
            ...(effort ? { planningEffort: effort } : {}),
            executionMode,
            ...(maxAgents > 1 ? { maxAgents } : {}),
        });
        setTitle("");
        setDescription("");
        setPriority("medium");
        setRequiredRole("");
        setAssigned([]);
        setEffort(50);
        setExecutionMode("autonomous");
        setMaxAgents(1);
        setUseProjectContext(false);
        setUseDocuments(false);
    };

    return (
        <section className="flex w-full min-w-0 flex-col gap-4">
            {/* Compact, project-scoped create row */}
            <div
                className="flex w-full min-w-0 flex-col gap-3 rounded-xl p-4"
                style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}
            >
                <h2 className="text-sm font-semibold text-primary">New task</h2>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <div className="flex-1">
                        <Input
                            label="Title"
                            placeholder="What needs doing?"
                            value={title}
                            onChange={setTitle}
                        />
                    </div>

                    <Button
                        size="md"
                        color="primary"
                        iconLeading={Plus}
                        isDisabled={!canSubmit}
                        onClick={handleCreate}
                    >
                        Create
                    </Button>
                </div>

                {/* Prompt / instructions for the agent */}
                <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-tertiary">Prompt / instructions</span>
                    <TextArea
                        value={description}
                        onChange={setDescription}
                        rows={3}
                        placeholder="What should the agent do? Add detail, acceptance criteria, links…"
                    />
                </div>

                {/* Context toggles — tell the agent what to ground on */}
                <div className="flex flex-wrap items-center gap-4">
                    <span className="text-xs text-tertiary">Context</span>
                    <label className="flex items-center gap-2">
                        <Toggle size="sm" isSelected={useProjectContext} onChange={setUseProjectContext} />
                        <span className="flex items-center gap-1.5 text-sm text-secondary"><FileCode02 className="size-3.5 text-quaternary" /> Project files / code</span>
                    </label>
                    <label className="flex items-center gap-2">
                        <Toggle size="sm" isSelected={useDocuments} onChange={setUseDocuments} />
                        <span className="flex items-center gap-1.5 text-sm text-secondary"><FileSearch02 className="size-3.5 text-quaternary" /> Documents</span>
                    </label>
                </div>

                <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-tertiary">Priority</span>
                    <div className="flex flex-wrap gap-2">
                        {PRIORITIES.map((p: TaskPriority) => {
                            const on = priority === p;
                            return (
                                <button key={p} type="button" onClick={() => setPriority(p)} title={`${titleCase(p)} priority`} className={pillSelectClass(on)}>
                                    <Badge type="color" size="md" color={priorityColor(p, state.settings)}>{titleCase(p)}</Badge>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Assign to role */}
                <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-tertiary">Assign to role</span>
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setRequiredRole("")}
                            className={cx("rounded-lg px-3 py-1 text-xs font-medium transition", requiredRole === "" ? "bg-[var(--surface-2)] text-primary" : "text-tertiary hover:text-secondary")}
                            style={{ border: "1px solid var(--c-border)" }}
                        >
                            Any
                        </button>
                        {ROLE_OPTIONS.map((r) => {
                            const on = requiredRole === r;
                            return (
                                <button key={r} type="button" onClick={() => setRequiredRole(r)} title={`Assign to ${roleLabel(r)}`} className={pillSelectClass(on)}>
                                    <Badge type="color" size="md" color={roleColor(r, state.settings)}>{roleLabel(r)}</Badge>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Dispatch agents */}
                {agents.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                        <span className="text-xs text-tertiary">Assign agents {assigned.length > 1 && <span className="text-quaternary">({assigned.length} collaborating)</span>}</span>
                        <div className="flex flex-wrap gap-2">
                            {agents.map((a) => {
                                const on = assigned.includes(a.id);
                                return (
                                    <button key={a.id} type="button" onClick={() => toggleAgent(a.id)} className={chipSelectClass(on)} style={chipSelectStyle(on)}>
                                        <IdentityAvatar identity={a.config.identity} name={a.config.name} avatarUrl={a.config.avatarUrl} size={18} />
                                        <span className="font-medium text-primary">{a.config.name}</span>
                                        {on && <Check className="size-3 text-secondary" />}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Planning depth */}
                <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                        <span className="text-xs text-tertiary">Planning depth</span>
                        <span className="text-xs font-medium text-primary">{planningDepthMeta(effort).label} <span className="text-quaternary">({effort}%)</span></span>
                    </div>
                    <Slider aria-label="Planning depth" value={effort} onChange={(v) => setEffort(snapPlanningDepth(Array.isArray(v) ? v[0] : v))} minValue={0} maxValue={100} step={25} />
                    <div className="flex items-center justify-between">
                        {PLANNING_DEPTH_LEVELS.map((level) => {
                            const active = planningDepthMeta(effort).value === level.value;
                            return (
                                <button key={level.value} type="button" onClick={() => setEffort(level.value)} title={level.description} className={cx("rounded px-1.5 py-0.5 text-[10px] font-medium transition", active ? "text-primary" : "text-quaternary hover:text-secondary")} style={active ? { background: "var(--surface-2)", border: "1px solid var(--c-border)" } : undefined}>
                                    {level.label}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Execution mode */}
                <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-tertiary">Execution mode</span>
                    <ClaudeTierSelect value={executionMode} onChange={setExecutionMode} size="sm" />
                </div>

                {/* Max deployable agents — orchestrator scales identical workers up to this count. */}
                <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                        <span className="text-xs text-tertiary">Max deployable agents</span>
                        <span className="text-xs font-medium text-primary">{maxAgents === 1 ? "Single agent" : `${maxAgents} workers`}</span>
                    </div>
                    <Slider aria-label="Max deployable agents" value={maxAgents} onChange={(v) => setMaxAgents(Array.isArray(v) ? v[0] : v)} minValue={1} maxValue={8} step={1} />
                    <p className="text-[11px] leading-snug text-quaternary">One orchestrator governs the task; up to {maxAgents} identical worker{maxAgents === 1 ? "" : "s"} run in parallel when the work fans out.</p>
                </div>
            </div>

            <TaskBoard state={scoped} actions={actions} />
        </section>
    );
};
