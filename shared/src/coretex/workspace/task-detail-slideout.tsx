// @ts-nocheck
"use client";

// Coretex Relay — Task detail slideout. Read-only view opened by clicking a
// task card: full metadata, result/error, the generated plan (if any), and a
// step-by-step history of how the task ran. History is session-scoped — the
// Brain doesn't persist TaskLog entries, so only tasks that ran while this
// client was connected show steps here. "Edit" hands off to TaskRefineSlideout.

import { Edit01, AlertCircle, CheckCircle } from "@untitledui/icons";
import type { Task } from "@repo/coretex/types";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { CodeSnippet } from "@/components/application/code-snippet/code-snippet";
import { SlideoutMenu } from "@/components/application/slideout-menus/slideout-menu";
import { roleLabel, titleCase } from "../labels";
import { IdentityAvatar } from "../ui/identity-avatar";
import {
    priorityColor,
    roleColor,
    formatDateTime,
    TASK_STATUS_LABEL,
    type CoretexActions,
    type CoretexState,
} from "../use-coretex";

const STATUS_COLOR: Record<string, "gray" | "blue" | "success" | "error"> = {
    pending: "gray",
    assigned: "blue",
    in_progress: "blue",
    completed: "success",
    failed: "error",
    cancelled: "gray",
};

interface Props {
    task: Task | null;
    state: CoretexState;
    actions: CoretexActions;
    isOpen: boolean;
    onClose: () => void;
    onEdit: () => void;
}

export const TaskDetailSlideout = ({ task, state, actions, isOpen, onClose, onEdit }: Props) => {
    if (!task) {
        return <SlideoutMenu isOpen={isOpen} onOpenChange={(v) => !v && onClose()} isDismissable><div /></SlideoutMenu>;
    }
    return <DetailBody key={task.id} task={task} state={state} actions={actions} isOpen={isOpen} onClose={onClose} onEdit={onEdit} />;
};

const DetailBody = ({ task, state, isOpen, onClose, onEdit }: Props & { task: Task }) => {
    const agents = state.agents ?? [];
    const projects = state.projects ?? [];
    const project = task.projectId ? projects.find((p) => p.id === task.projectId) : undefined;
    const collaboratorIds = task.assignedAgentIds?.length ? task.assignedAgentIds : task.assignedAgentId ? [task.assignedAgentId] : [];
    const collaborators = collaboratorIds.map((id) => agents.find((a) => a.id === id)).filter(Boolean) as typeof agents;
    const history = state.taskLogs[task.id] ?? [];
    const agentName = (id: string) => agents.find((a) => a.id === id)?.config.name ?? "Removed agent";

    return (
        <SlideoutMenu isOpen={isOpen} onOpenChange={(v) => !v && onClose()} isDismissable dialogClassName="gap-0">
            <SlideoutMenu.Header onClose={onClose}>
                <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-md font-semibold text-primary md:text-lg">{task.title}</h1>
                    <Badge type="color" size="sm" color={STATUS_COLOR[task.status] ?? "gray"}>{TASK_STATUS_LABEL[task.status] ?? titleCase(task.status)}</Badge>
                    <Badge type="color" size="sm" color={priorityColor(task.priority, state.settings)}>{titleCase(task.priority)}</Badge>
                </div>
                <p className="mt-0.5 text-sm text-tertiary">Full detail and run history for this task.</p>
            </SlideoutMenu.Header>

            <SlideoutMenu.Content className="py-6">
                <div className="flex flex-col gap-6">
                    {task.description && (
                        <Section label="Description">
                            <p className="text-sm whitespace-pre-wrap text-secondary">{task.description}</p>
                        </Section>
                    )}

                    <Section label="Details">
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                            <Detail label="Role" value={task.requiredRole ? roleLabel(task.requiredRole) : "Any"} />
                            <Detail label="Project" value={project?.name ?? "Generic (no project)"} />
                            <Detail label="Created" value={formatDateTime(task.createdAt)} />
                            <Detail label="Updated" value={formatDateTime(task.updatedAt)} />
                            {task.completedAt && <Detail label="Completed" value={formatDateTime(task.completedAt)} />}
                            <Detail label="Retries" value={`${task.retryCount} / ${task.maxRetries}`} />
                            {task.planningEffort ? <Detail label="Planning effort" value={`${task.planningEffort}%`} /> : null}
                            {task.executionMode && <Detail label="Execution mode" value={titleCase(task.executionMode)} />}
                        </dl>
                    </Section>

                    <Section label={`Assigned agents${collaborators.length > 1 ? ` — ${collaborators.length} collaborating` : ""}`}>
                        {collaborators.length === 0 ? (
                            <p className="text-sm text-tertiary">Unassigned.</p>
                        ) : (
                            <div className="flex flex-wrap gap-2">
                                {collaborators.map((a) => (
                                    <span key={a.id} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm" style={{ border: "1px solid var(--c-border)", background: "var(--surface)" }}>
                                        <IdentityAvatar identity={a.config.identity} name={a.config.name} avatarUrl={a.config.avatarUrl} size={20} />
                                        <span className="font-medium text-primary">{a.config.name}</span>
                                        <Badge type="color" size="sm" color={roleColor(a.config.role, state.settings)}>{roleLabel(a.config.role)}</Badge>
                                    </span>
                                ))}
                            </div>
                        )}
                    </Section>

                    {task.result && (
                        <Section label="Result">
                            <div className="flex items-start gap-2 rounded-lg p-3 text-sm" style={{ background: "var(--surface-2)" }}>
                                <CheckCircle className="mt-0.5 size-4 shrink-0 text-success-primary" />
                                <p className="whitespace-pre-wrap text-secondary">{task.result}</p>
                            </div>
                        </Section>
                    )}
                    {task.error && (
                        <Section label="Error">
                            <div className="flex items-start gap-2 rounded-lg p-3 text-sm" style={{ background: "var(--surface-2)" }}>
                                <AlertCircle className="mt-0.5 size-4 shrink-0 text-error-primary" />
                                <p className="whitespace-pre-wrap text-error-primary">{task.error}</p>
                            </div>
                        </Section>
                    )}

                    {task.planMarkdown && (
                        <Section label="Plan document">
                            <CodeSnippet code={task.planMarkdown} title="plan.md" language="markdown" collapsedLines={24} />
                        </Section>
                    )}

                    <Section label={`History${history.length > 0 ? ` — ${history.length} step${history.length === 1 ? "" : "s"}` : ""}`}>
                        {history.length === 0 ? (
                            <p className="text-sm text-tertiary">
                                {task.status === "pending"
                                    ? "Not started yet."
                                    : "No step history was captured this session. History only accumulates for tasks that run while this app stays connected — it isn't persisted by the Brain across restarts."}
                            </p>
                        ) : (
                            <ol className="flex flex-col gap-3">
                                {history.map((log, i) => (
                                    <li key={`${log.step}-${i}`} className="flex gap-3">
                                        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-tertiary" style={{ background: "var(--surface-2)" }}>
                                            {log.step}
                                        </span>
                                        <div className="min-w-0 flex-1 border-b border-secondary pb-3 last:border-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="text-xs font-medium text-primary">{agentName(log.agentId)}</span>
                                                <span className="text-[11px] text-quaternary">{formatDateTime(log.timestamp)}</span>
                                            </div>
                                            <p className="mt-0.5 text-sm whitespace-pre-wrap text-secondary">{log.message}</p>
                                        </div>
                                    </li>
                                ))}
                            </ol>
                        )}
                    </Section>
                </div>
            </SlideoutMenu.Content>

            <SlideoutMenu.Footer className="flex w-full items-center justify-end gap-2">
                <Button size="sm" color="secondary" onClick={onClose}>Close</Button>
                <Button size="sm" color="primary" iconLeading={Edit01} onClick={onEdit}>Edit task</Button>
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

const Detail = ({ label, value }: { label: string; value: string }) => (
    <div>
        <dt className="text-xs text-quaternary">{label}</dt>
        <dd className="mt-0.5 truncate font-medium text-primary">{value}</dd>
    </div>
);
