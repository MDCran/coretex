// @ts-nocheck
"use client";

// Coretex Relay — Task refine slideout. Open a task to add context, change
// priority/role/project, dispatch one or many collaborating agents, set how much
// master-planning effort to spend (slider), and generate a full plan document
// from a planner agent. Right-edge Untitled UI SlideoutMenu.

import { useEffect, useState } from "react";
import { Save01, ClipboardCheck, SlashCircle01, Check } from "@untitledui/icons";
import type { AgentRole, RefineTaskPatch, Task, TaskPriority } from "@repo/coretex/types";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { TextArea } from "@/components/base/textarea/textarea";
import { NativeSelect } from "@/components/base/select/select-native";
import { Slider } from "@/components/base/slider/slider";
import { SlideoutMenu } from "@/components/application/slideout-menus/slideout-menu";
import { CodeSnippet } from "@/components/application/code-snippet/code-snippet";
import { cx } from "@/utils/cx";
import { roleLabel, titleCase } from "../labels";
import { IdentityAvatar } from "../ui/identity-avatar";
import { planningDepthMeta, snapPlanningDepth } from "../ui/planning-depth";
import { priorityColor, roleColor, type CoretexActions, type CoretexState } from "../use-coretex";

const PRIORITIES: TaskPriority[] = ["low", "medium", "high", "critical"];
const ROLES: AgentRole[] = ["orchestrator", "planner", "researcher", "developer", "reviewer", "writer", "analyst", "devops", "qa", "custom"];

interface Props {
    task: Task | null;
    state: CoretexState;
    actions: CoretexActions;
    isOpen: boolean;
    onClose: () => void;
}

export const TaskRefineSlideout = ({ task, state, actions, isOpen, onClose }: Props) => {
    if (!task) {
        return <SlideoutMenu isOpen={isOpen} onOpenChange={(v) => !v && onClose()} isDismissable><div /></SlideoutMenu>;
    }
    return <RefineBody key={task.id} task={task} state={state} actions={actions} isOpen={isOpen} onClose={onClose} />;
};

const RefineBody = ({ task, state, actions, isOpen, onClose }: Props & { task: Task }) => {
    const agents = state.agents ?? [];
    const projects = state.projects ?? [];
    const plan = state.planning;

    const [title, setTitle] = useState(task.title);
    const [description, setDescription] = useState(task.description);
    const [priority, setPriority] = useState<TaskPriority>(task.priority);
    const [requiredRole, setRequiredRole] = useState<string>(task.requiredRole ?? "");
    const [projectId, setProjectId] = useState<string>(task.projectId ?? "");
    const [assigned, setAssigned] = useState<string[]>(task.assignedAgentIds ?? (task.assignedAgentId ? [task.assignedAgentId] : []));
    const [effort, setEffort] = useState<number>(snapPlanningDepth(task.planningEffort ?? 0));
    const [saved, setSaved] = useState(false);

    // Keep the displayed plan doc in sync with live streaming / the task's stored plan.
    const livePlan = plan.taskId === task.id ? plan.markdown : "";
    const planDoc = plan.running && plan.taskId === task.id ? livePlan : (task.planMarkdown ?? livePlan);

    useEffect(() => setSaved(false), [title, description, priority, requiredRole, projectId, assigned, effort]);

    const toggleAgent = (id: string) =>
        setAssigned((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

    const save = () => {
        const patch: RefineTaskPatch = {
            title: title.trim(),
            description: description.trim(),
            priority,
            requiredRole: requiredRole ? (requiredRole as AgentRole) : undefined,
            projectId: projectId || undefined,
            assignedAgentIds: assigned,
            planningEffort: effort,
        };
        actions.refineTask(task.id, patch);
        setSaved(true);
    };

    const planner = agents.find((a) => a.config.role === "planner") ?? agents[0];
    const generatePlan = () => {
        if (!planner) return;
        actions.runPlan(planner.id, `${title}\n\n${description}`.trim(), task.id);
    };

    return (
        <SlideoutMenu isOpen={isOpen} onOpenChange={(v) => !v && onClose()} isDismissable dialogClassName="gap-0">
            <SlideoutMenu.Header onClose={onClose}>
                <div className="flex items-center gap-2">
                    <h1 className="text-md font-semibold text-primary md:text-lg">Refine task</h1>
                    <Badge type="color" size="sm" color={priorityColor(priority, state.settings)}>{titleCase(priority)}</Badge>
                </div>
                <p className="mt-0.5 text-sm text-tertiary">Add context, dispatch agents, and plan before the work runs.</p>
            </SlideoutMenu.Header>

            <SlideoutMenu.Content className="py-6">
                <div className="flex flex-col gap-6">
                    {/* Title + description */}
                    <Section label="Title">
                        <Input aria-label="Task title" value={title} onChange={setTitle} />
                    </Section>
                    <Section label="Context / description">
                        <TextArea aria-label="Task context and description" value={description} onChange={setDescription} rows={4} placeholder="Add as much context as the agents need…" />
                    </Section>

                    {/* Priority */}
                    <Section label="Priority">
                        <div className="flex flex-wrap gap-2">
                            {PRIORITIES.map((p) => {
                                const on = priority === p;
                                return (
                                    <button key={p} type="button" onClick={() => setPriority(p)} className={cx("rounded-lg px-2.5 py-1.5 text-xs font-medium transition", on ? "" : "opacity-70 hover:opacity-100")} style={{ border: on ? "1px solid var(--brand)" : "1px solid var(--c-border)", background: on ? "var(--surface-2)" : undefined }}>
                                        <Badge type="color" size="sm" color={priorityColor(p, state.settings)}>{titleCase(p)}</Badge>
                                    </button>
                                );
                            })}
                        </div>
                    </Section>

                    {/* Role + project */}
                    <div className="grid grid-cols-2 gap-4">
                        <Section label="Required role">
                            <NativeSelect
                                aria-label="Required role"
                                value={requiredRole}
                                onChange={(e) => setRequiredRole(e.target.value)}
                                options={[{ label: "Any role", value: "" }, ...ROLES.map((r) => ({ label: roleLabel(r), value: r }))]}
                            />
                        </Section>
                        <Section label="Project">
                            <NativeSelect
                                aria-label="Project"
                                value={projectId}
                                onChange={(e) => setProjectId(e.target.value)}
                                options={[{ label: "Generic (no project)", value: "" }, ...projects.map((p) => ({ label: p.name, value: p.id }))]}
                            />
                        </Section>
                    </div>

                    {/* Assigned agents */}
                    <Section label={`Dispatch agents${assigned.length > 1 ? ` — ${assigned.length} collaborating` : ""}`}>
                        {agents.length === 0 ? (
                            <p className="text-sm text-tertiary">No agents yet — deploy some in the Agents tab.</p>
                        ) : (
                            <div className="flex flex-wrap gap-2">
                                {agents.map((a) => {
                                    const on = assigned.includes(a.id);
                                    return (
                                        <button key={a.id} type="button" onClick={() => toggleAgent(a.id)} className={cx("flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition", on ? "" : "opacity-60 hover:opacity-100")} style={{ border: on ? "1px solid var(--brand)" : "1px solid var(--c-border)", background: on ? "var(--surface-2)" : "var(--surface)" }}>
                                            <IdentityAvatar identity={a.config.identity} name={a.config.name} avatarUrl={a.config.avatarUrl} size={20} />
                                            <span className="font-medium text-primary">{a.config.name}</span>
                                            <Badge type="color" size="sm" color={roleColor(a.config.role, state.settings)}>{roleLabel(a.config.role)}</Badge>
                                            {on && <Check className="size-3.5 text-[var(--brand)]" />}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </Section>

                    {/* Planning effort */}
                    <Section label="Master-planning effort">
                        <div className="flex items-center gap-4">
                            <div className="flex-1">
                                <Slider
                                    aria-label="Planning depth"
                                    value={effort}
                                    onChange={(v) => setEffort(snapPlanningDepth(Array.isArray(v) ? v[0] : v))}
                                    minValue={0}
                                    maxValue={100}
                                    step={25}
                                />
                            </div>
                            <span className="w-28 shrink-0 text-right text-sm font-medium text-primary">{planningDepthMeta(effort).label} <span className="text-quaternary">({effort}%)</span></span>
                        </div>
                        <p className="text-[11px] text-quaternary">{planningDepthMeta(effort).description}</p>
                    </Section>

                    {/* Plan document */}
                    <Section label="Plan document">
                        <div className="flex items-center gap-2">
                            <Button size="sm" color="secondary" iconLeading={ClipboardCheck} onClick={generatePlan} isDisabled={!planner || (plan.running && plan.taskId === task.id)}>
                                {plan.running && plan.taskId === task.id ? "Planning…" : "Generate plan"}
                            </Button>
                            {plan.running && plan.taskId === task.id && (
                                <Button size="sm" color="primary-destructive" iconLeading={SlashCircle01} onClick={() => actions.stopPlan()}>Stop</Button>
                            )}
                            {planner && <span className="text-xs text-quaternary">via {planner.config.name}</span>}
                        </div>
                        {planDoc && <CodeSnippet className="mt-2" code={planDoc} title="plan.md" language="markdown" collapsedLines={24} />}
                    </Section>
                </div>
            </SlideoutMenu.Content>

            <SlideoutMenu.Footer className="flex w-full items-center justify-end gap-2">
                <Button size="sm" color="secondary" onClick={onClose}>Close</Button>
                <Button size="sm" color="primary" iconLeading={saved ? Check : Save01} onClick={save}>{saved ? "Saved" : "Save changes"}</Button>
            </SlideoutMenu.Footer>
        </SlideoutMenu>
    );
};

const Section = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <section className="flex flex-col gap-2">
        <p className="text-xs font-medium text-secondary">{label}</p>
        {children}
    </section>
);
