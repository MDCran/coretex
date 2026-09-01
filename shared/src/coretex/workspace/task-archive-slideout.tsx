// @ts-nocheck
"use client";

// Coretex Relay — Task archive. Completed/failed/cancelled tasks quietly leave
// the kanban board ARCHIVE_AFTER_MS after finishing (see isArchived in
// task-board.tsx) and land here instead, viewable as a table so the board
// doesn't accumulate finished work forever.

import { Eye, Trash01, Archive } from "@untitledui/icons";
import type { Task } from "@repo/coretex/types";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { ButtonUtility } from "@/components/base/buttons/button-utility";
import { EmptyState } from "@/components/application/empty-state/empty-state";
import { SlideoutMenu } from "@/components/application/slideout-menus/slideout-menu";
import { titleCase } from "../labels";
import { priorityColor, formatDateTime, TASK_STATUS_LABEL, type CoretexActions, type CoretexState } from "../use-coretex";

const STATUS_COLOR: Record<string, "gray" | "blue" | "success" | "error"> = {
    completed: "success",
    failed: "error",
    cancelled: "gray",
};

interface Props {
    state: CoretexState;
    actions: CoretexActions;
    archivedTasks: Task[];
    isOpen: boolean;
    onClose: () => void;
    onView: (taskId: string) => void;
}

export const TaskArchiveSlideout = ({ state, actions, archivedTasks, isOpen, onClose, onView }: Props) => {
    const projects = state.projects ?? [];
    const agents = state.agents ?? [];
    const projectName = (id?: string) => (id ? projects.find((p) => p.id === id)?.name ?? "—" : "Generic");
    const agentName = (task: Task) => {
        const id = task.assignedAgentId ?? task.assignedAgentIds?.[0];
        if (!id) return task.assignedAgentIds?.length ? `${task.assignedAgentIds.length} agents` : "—";
        return agents.find((a) => a.id === id)?.config.name ?? "Removed agent";
    };

    const rows = [...archivedTasks].sort((a, b) => String(b.completedAt ?? b.updatedAt).localeCompare(String(a.completedAt ?? a.updatedAt)));

    return (
        <SlideoutMenu isOpen={isOpen} onOpenChange={(v) => !v && onClose()} isDismissable dialogClassName="gap-0" className="sm:max-w-3xl">
            <SlideoutMenu.Header onClose={onClose}>
                <h1 className="text-md font-semibold text-primary md:text-lg">Archive</h1>
                <p className="mt-0.5 text-sm text-tertiary">Finished tasks move here automatically so the board stays focused on active work.</p>
            </SlideoutMenu.Header>

            <SlideoutMenu.Content className="py-6">
                {rows.length === 0 ? (
                    <EmptyState size="sm">
                        <EmptyState.Header>
                            <EmptyState.FeaturedIcon color="gray" theme="light" icon={Archive} />
                        </EmptyState.Header>
                        <EmptyState.Content>
                            <EmptyState.Title>Nothing archived yet</EmptyState.Title>
                            <EmptyState.Description>Completed, failed, and cancelled tasks land here a while after they finish.</EmptyState.Description>
                        </EmptyState.Content>
                    </EmptyState>
                ) : (
                    <div className="overflow-x-auto rounded-xl border border-secondary">
                        <table className="w-full min-w-[640px] text-sm">
                            <thead>
                                <tr className="border-b border-secondary text-left text-xs font-semibold tracking-wide text-tertiary uppercase">
                                    <th className="px-4 py-2.5">Task</th>
                                    <th className="px-4 py-2.5">Status</th>
                                    <th className="px-4 py-2.5">Priority</th>
                                    <th className="px-4 py-2.5">Agent</th>
                                    <th className="px-4 py-2.5">Project</th>
                                    <th className="px-4 py-2.5">Finished</th>
                                    <th className="px-4 py-2.5" />
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((task) => (
                                    <tr key={task.id} className="border-b border-secondary last:border-0 hover:bg-primary_hover">
                                        <td className="max-w-64 truncate px-4 py-2.5 font-medium text-primary">{task.title}</td>
                                        <td className="px-4 py-2.5">
                                            <Badge type="color" size="sm" color={STATUS_COLOR[task.status] ?? "gray"}>{TASK_STATUS_LABEL[task.status] ?? titleCase(task.status)}</Badge>
                                        </td>
                                        <td className="px-4 py-2.5">
                                            <Badge type="color" size="sm" color={priorityColor(task.priority, state.settings)}>{titleCase(task.priority)}</Badge>
                                        </td>
                                        <td className="px-4 py-2.5 text-secondary">{agentName(task)}</td>
                                        <td className="px-4 py-2.5 text-secondary">{projectName(task.projectId)}</td>
                                        <td className="px-4 py-2.5 text-tertiary">{formatDateTime(task.completedAt ?? task.updatedAt)}</td>
                                        <td className="px-4 py-2.5">
                                            <div className="flex items-center justify-end gap-1">
                                                <ButtonUtility size="xs" color="tertiary" icon={Eye} tooltip="View details" onClick={() => onView(task.id)} />
                                                <ButtonUtility size="xs" color="tertiary" icon={Trash01} tooltip="Delete permanently" onClick={() => actions.deleteTask(task.id)} />
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </SlideoutMenu.Content>

            {rows.length > 0 && (
                <SlideoutMenu.Footer className="flex w-full items-center justify-between gap-2">
                    <p className="text-xs text-tertiary">{rows.length} archived task{rows.length === 1 ? "" : "s"}</p>
                    <Button
                        size="sm"
                        color="secondary-destructive"
                        iconLeading={Trash01}
                        onClick={() => {
                            if (window.confirm(`Permanently delete all ${rows.length} archived tasks?`)) rows.forEach((t) => actions.deleteTask(t.id));
                        }}
                    >
                        Clear archive
                    </Button>
                </SlideoutMenu.Footer>
            )}
        </SlideoutMenu>
    );
};
