// @ts-nocheck
"use client";

// Coretex Relay — Task board panel.
// A horizontally scrollable kanban view of all tasks, grouped by status column.
// Click a card to refine it (context, agents, planning effort, plan doc). Cancel
// truly aborts the running agent; Bump raises priority. "Customize" recolors badges.

import { useEffect, useState } from "react";
import {
  Sliders04,
  ArrowUp,
  XClose,
  Zap,
  ClipboardCheck,
  Users01,
  Inbox01,
  Trash01,
  Flag01,
  Archive,
} from "@untitledui/icons";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import type {
  AgentState,
  Task,
  TaskPriority,
  TaskStatus,
} from "@repo/coretex/types";
import { roleLabel, titleCase } from "../labels";
import type { CoretexActions, CoretexState } from "../use-coretex";
import { TASK_BOARD_COLUMNS, priorityColor, roleColor } from "../use-coretex";
import { CustomizeBoardSlideout } from "../workspace/customize-board-slideout";
import { TaskRefineSlideout } from "../workspace/task-refine-slideout";
import { TaskDetailSlideout } from "../workspace/task-detail-slideout";
import { TaskArchiveSlideout } from "../workspace/task-archive-slideout";
import { ClaudeTierBadge } from "../ui/claude-tier-badge";
import { useContextMenu, type MenuItem } from "../ui/context-menu";

/** Statuses that still permit user intervention (cancel / reprioritize). */
const NON_TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  "pending",
  "assigned",
  "in_progress",
]);
/** Terminal statuses whose tasks are eligible to leave the board and archive. */
const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  "completed",
  "failed",
  "cancelled",
]);
/** How long a finished task stays visible on the board before quietly archiving. */
const ARCHIVE_AFTER_MS = 15 * 60 * 1000;

function isArchived(task: Task): boolean {
  if (!TERMINAL_STATUSES.has(task.status)) return false;
  const finishedAt = Date.parse(task.completedAt ?? task.updatedAt);
  if (!Number.isFinite(finishedAt)) return false;
  return Date.now() - finishedAt >= ARCHIVE_AFTER_MS;
}

const PRIORITY_LADDER: TaskPriority[] = ["low", "medium", "high", "critical"];

function nextPriority(priority: TaskPriority): TaskPriority | null {
  const idx = PRIORITY_LADDER.indexOf(priority);
  if (idx === -1 || idx >= PRIORITY_LADDER.length - 1) return null;
  return PRIORITY_LADDER[idx + 1];
}

interface TaskCardProps {
  task: Task;
  agents: AgentState[];
  actions: CoretexActions;
  settings: CoretexState["settings"];
  /** Click the card body — opens the read-only detail + history view. */
  onOpen: () => void;
  /** "Refine…" from the right-click menu — opens the edit form directly. */
  onRefine: () => void;
}

function TaskCard({ task, agents, actions, settings, onOpen, onRefine }: TaskCardProps) {
  const [deleteArmed, setDeleteArmed] = useState(false);
  const assignedAgent = task.assignedAgentId
    ? agents.find((a: AgentState) => a.id === task.assignedAgentId)
    : undefined;
  const collaborators = task.assignedAgentIds?.length ?? 0;
  const agentName =
    assignedAgent?.config.name ??
    (collaborators > 0 ? `${collaborators} agents` : "unassigned");

  const bumpTo = nextPriority(task.priority);
  const showFooter = NON_TERMINAL_STATUSES.has(task.status);
  const isTerminal = !showFooter;

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const { open: openMenu, node: menuNode } = useContextMenu();

  const requestDelete = () => {
    if (deleteArmed) {
      actions.deleteTask(task.id);
      setDeleteArmed(false);
      return;
    }
    setDeleteArmed(true);
    window.setTimeout(() => setDeleteArmed(false), 3000);
  };

  // Right-click menu mirrors the footer buttons and exposes the priority ladder.
  // Built live so disabled/checked state reflects the current task.
  const buildMenuItems = (): MenuItem[] => {
    const items: MenuItem[] = [
      {
        key: "refine",
        label: "Refine…",
        icon: ClipboardCheck,
        onClick: onRefine,
      },
    ];

    // Cancel is only meaningful while the task can still be intervened on.
    if (!isTerminal) {
      items.push(
        {
          key: "bump",
          label: bumpTo
            ? `Bump priority → ${titleCase(bumpTo)}`
            : "Bump priority",
          icon: ArrowUp,
          disabled: !bumpTo,
          onClick: () => bumpTo && actions.reprioritizeTask(task.id, bumpTo),
        },
        {
          key: "set-priority",
          label: "Set priority",
          icon: Flag01,
          submenu: PRIORITY_LADDER.map<MenuItem>((p) => ({
            key: `prio-${p}`,
            label: titleCase(p),
            icon: Flag01,
            checked: task.priority === p,
            disabled: task.priority === p,
            onClick: () => actions.reprioritizeTask(task.id, p),
          })),
        },
        { separator: true },
        {
          key: "cancel",
          label: "Cancel task",
          icon: XClose,
          danger: true,
          onClick: () => actions.cancelTask(task.id),
        },
      );
    } else {
      // Terminal tasks can no longer be cancelled — only removed.
      items.push(
        { separator: true },
        {
          key: "delete",
          label: deleteArmed ? "Confirm delete" : "Delete task",
          icon: Trash01,
          danger: true,
          onClick: requestDelete,
        },
      );
    }

    return items;
  };

  return (
    <>
      <div
        onClick={onOpen}
        onContextMenu={(e) => openMenu(e, buildMenuItems())}
        className="mb-2 cursor-pointer rounded-xl border border-secondary bg-primary p-4 transition hover:border-primary hover:shadow-xs"
      >
        <div className="mb-2 flex items-start justify-between gap-2">
          <p className="line-clamp-2 text-sm font-medium leading-snug text-primary" title={task.title}>
            {task.title}
          </p>
          <Badge type="color" color={priorityColor(task.priority, settings)} size="sm">
            {titleCase(task.priority)}
          </Badge>
        </div>

        {task.description ? (
          <p className="mb-3 line-clamp-2 text-xs text-tertiary" title={task.description}>
            {task.description}
          </p>
        ) : null}

        {/* Color-coded role + collaborators + planning/plan indicators */}
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <ClaudeTierBadge
            mode={task.executionMode ?? "autonomous"}
            size="sm"
          />
          {task.requiredRole && (
            <Badge
              type="color"
              size="sm"
              color={roleColor(task.requiredRole, settings)}
            >
              {roleLabel(task.requiredRole)}
            </Badge>
          )}
          {collaborators > 1 && (
            <span
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-brand-secondary"
              style={{ background: "var(--surface-2)" }}
            >
              <Users01 className="size-3" />
              {collaborators}
            </span>
          )}
          {task.planningEffort ? (
            <span
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-tertiary"
              style={{ background: "var(--surface-2)" }}
            >
              <Zap className="size-3" />
              {task.planningEffort}
            </span>
          ) : null}
          {task.planMarkdown && (
            <span
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-success-primary"
              style={{ background: "var(--surface-2)" }}
            >
              <ClipboardCheck className="size-3" />
              plan
            </span>
          )}
        </div>

        <div className="flex min-w-0 items-start gap-1.5" title={agentName}>
          <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-brand-secondary text-[10px] font-semibold text-brand-secondary">
            {agentName.charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0 break-words text-xs text-quaternary [overflow-wrap:anywhere]">
            {agentName}
            {task.retryCount > 0 ? ` · retry ${task.retryCount}` : ""}
          </span>
        </div>

        {showFooter ? (
          <div className="mt-2 flex items-center gap-1" onClick={stop}>
            <Button
              size="sm"
              color="link-destructive"
              iconLeading={XClose}
              onClick={() => actions.cancelTask(task.id)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              color="link-gray"
              iconLeading={ArrowUp}
              isDisabled={!bumpTo}
              onClick={() =>
                bumpTo && actions.reprioritizeTask(task.id, bumpTo)
              }
            >
              Bump
            </Button>
          </div>
        ) : (
          <div className="mt-2 flex items-center gap-1" onClick={stop}>
            <Button
              size="sm"
              color={deleteArmed ? "primary-destructive" : "link-destructive"}
              iconLeading={Trash01}
              onClick={requestDelete}
            >
              {deleteArmed ? "Confirm delete" : "Delete"}
            </Button>
          </div>
        )}
      </div>
      {menuNode}
    </>
  );
}

export const TaskBoard = ({
  state,
  actions,
}: {
  state: CoretexState;
  actions: CoretexActions;
}) => {
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [refineId, setRefineId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const detailTask = detailId
    ? (state.tasks.find((t) => t.id === detailId) ?? null)
    : null;
  const refineTask = refineId
    ? (state.tasks.find((t) => t.id === refineId) ?? null)
    : null;
  const archivedTasks = state.tasks.filter(isArchived);
  const visibleTasks = state.tasks.filter((task) => !isArchived(task));

  // Finished tasks age into the archive purely by elapsed time (isArchived), so
  // force a re-render every minute — otherwise a quiet board (no other state
  // changes) would never actually move a card once its 15 minutes are up.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="w-full min-w-0">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-md font-semibold text-primary">Task board</h2>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            color="secondary"
            iconLeading={Archive}
            onClick={() => setArchiveOpen(true)}
          >
            Archive{archivedTasks.length > 0 ? ` (${archivedTasks.length})` : ""}
          </Button>
          <Button
            size="sm"
            color="secondary"
            iconLeading={Sliders04}
            onClick={() => setCustomizeOpen(true)}
          >
            Customize
          </Button>
        </div>
      </div>

      {/*
              Full-width board at every breakpoint:
              1 → 2 → 3 → 6 equal columns that always share the content width.
              On mid widths, allow horizontal scroll of a compact 6-col strip
              so columns never crush under a narrow shell + dock.
            */}
      {visibleTasks.length === 0 ? (
        <div className="flex min-h-28 items-center justify-center gap-3 rounded-xl border border-dashed border-secondary bg-primary px-4 py-6 text-center">
          <Inbox01 className="size-5 shrink-0 text-quaternary" />
          <div className="text-left">
            <p className="text-sm font-medium text-secondary">No active tasks</p>
            <p className="text-xs text-quaternary">Create a task below or assign work from the Agents page.</p>
          </div>
        </div>
      ) : (
      <div className="grid w-full min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-6 2xl:gap-4">
        {TASK_BOARD_COLUMNS.map((column) => {
          const columnTasks = state.tasks.filter(
            (t) => t.status === column.status && !isArchived(t),
          );
          return (
            <div key={column.status} className="flex min-w-0 flex-col">
              <div className="mb-2 flex items-center justify-between gap-2 px-0.5 sm:mb-3">
                <span className="truncate text-xs font-semibold tracking-wider text-tertiary">
                  {column.label}
                </span>
                <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium text-secondary">
                  {columnTasks.length}
                </span>
              </div>
              <div
                className="flex min-h-[7rem] flex-1 flex-col rounded-xl p-1.5 sm:min-h-[8rem] sm:p-2.5"
                style={{
                  background: "var(--surface-2)",
                  border: "1px solid var(--c-border)",
                }}
              >
                {columnTasks.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center overflow-hidden rounded-lg border border-dashed border-secondary px-2 py-5">
                    <p className="text-xs text-quaternary">No tasks</p>
                  </div>
                ) : (
                  <div className="flex max-h-[min(70vh,42rem)] flex-col overflow-y-auto pr-0.5">
                    {columnTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        agents={state.agents}
                        actions={actions}
                        settings={state.settings}
                        onOpen={() => setDetailId(task.id)}
                        onRefine={() => setRefineId(task.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      )}

      <CustomizeBoardSlideout
        state={state}
        actions={actions}
        isOpen={customizeOpen}
        onClose={() => setCustomizeOpen(false)}
      />
      <TaskRefineSlideout
        task={refineTask}
        state={state}
        actions={actions}
        isOpen={refineId !== null}
        onClose={() => setRefineId(null)}
      />
      <TaskDetailSlideout
        task={detailTask}
        state={state}
        actions={actions}
        isOpen={detailId !== null}
        onClose={() => setDetailId(null)}
        onEdit={() => {
          const id = detailId;
          setDetailId(null);
          if (id) setRefineId(id);
        }}
      />
      <TaskArchiveSlideout
        state={state}
        actions={actions}
        archivedTasks={archivedTasks}
        isOpen={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        onView={(id) => {
          setArchiveOpen(false);
          setDetailId(id);
        }}
      />
    </section>
  );
};
