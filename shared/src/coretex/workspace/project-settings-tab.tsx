// @ts-nocheck
"use client";

// Coretex — per-project Settings. Advanced controls: details, status/tags,
// appearance (icon + color + presentation), intelligence (model + budget),
// source linking, live insights, and danger zone.

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Project,
  ProjectAppearance,
  ProjectAutomationConfig,
  ProjectExecutionTarget,
  ProjectStatus,
  ProviderType,
} from "@repo/coretex/types";
import {
  FolderCode,
  RefreshCcw01,
  Save01,
  Check,
  Folder,
  Trash01,
  AlertTriangle,
  File02,
  GitBranch01,
  Wallet02,
  CpuChip01,
  Tag01,
  ArrowRight,
} from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Badge, BadgeWithDot } from "@/components/base/badges/badges";
import { Input } from "@/components/base/input/input";
import { TextArea } from "@/components/base/textarea/textarea";
import { Toggle } from "@/components/base/toggle/toggle";
import type { CoretexActions, CoretexState } from "../use-coretex";
import {
  agentsForProject,
  formatTokens,
  formatUSD,
  isAgentActive,
} from "../use-coretex";
import type { NavTarget } from "../nav";
import { ProjectIcon } from "../ui/project-icon";
import { IconPicker } from "../ui/icon-picker";
import { ColorPicker, COLOR_SWATCHES } from "../ui/color-picker";
import { FolderPicker } from "../files/folder-picker";
import { ModelPicker } from "../ui/model-picker";
import { HelpTooltip } from "../ui/help-tooltip";
import { statusLabel } from "../labels";
import { pillSelectClass } from "../ui/pill-select";

const CARD = {
  background: "var(--surface)",
  border: "1px solid var(--c-border)",
} as const;

const STATUSES: ProjectStatus[] = ["active", "paused", "completed", "archived"];

const STATUS_COLOR: Record<
  ProjectStatus,
  "success" | "warning" | "gray" | "brand"
> = {
  active: "success",
  paused: "warning",
  completed: "brand",
  archived: "gray",
};

const APPEARANCE_PRESETS: { name: string; icon: string; color: string }[] = [
  { name: "Product", icon: "Rocket01", color: "#3b82f6" },
  { name: "Research", icon: "Beaker01", color: "#14b8a6" },
  { name: "Ops", icon: "Server01", color: "#667085" },
  { name: "Design", icon: "Palette", color: "#ec4899" },
  { name: "Data", icon: "BarChart01", color: "#8b5cf6" },
  { name: "Security", icon: "ShieldTick", color: "#22c55e" },
  { name: "Mobile", icon: "Phone01", color: "#f97316" },
  { name: "AI", icon: "Stars01", color: "#ef4444" },
];

const Section = ({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <section className="rounded-xl p-5" style={CARD}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-primary">{title}</h2>
        {description && (
          <p className="mt-0.5 text-xs text-tertiary">{description}</p>
        )}
      </div>
      {actions}
    </div>
    <div className="mt-4">{children}</div>
  </section>
);

function InsightTile({
  label,
  value,
  hint,
  onClick,
}: {
  label: string;
  value: string | number;
  hint?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <p className="text-[11px] font-medium uppercase tracking-wide text-quaternary">
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-primary">
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-tertiary">{hint}</p>}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="rounded-xl px-3.5 py-3 text-left transition hover:bg-[var(--surface-2)]"
        style={{
          background: "var(--surface-2)",
          border: "1px solid var(--c-border)",
        }}
      >
        {body}
      </button>
    );
  }
  return (
    <div
      className="rounded-xl px-3.5 py-3"
      style={{
        background: "var(--surface-2)",
        border: "1px solid var(--c-border)",
      }}
    >
      {body}
    </div>
  );
}

export const ProjectSettingsTab = ({
  project,
  state,
  actions,
  onNavigate,
}: {
  project: Project;
  state: CoretexState;
  actions: CoretexActions;
  onNavigate?: (t: NavTarget) => void;
}) => {
  const automation: ProjectAutomationConfig = {
    unattended: true,
    documentationAgent: true,
    dualReview: true,
    initializeBranchTaxonomy: true,
    autoCreatePullRequest: false,
    autoMergePullRequest: false,
    targetBranch: "main",
    ...(project.automation ?? {}),
  };
  const updateAutomation = (patch: Partial<ProjectAutomationConfig>) =>
    actions.updateProject(project.id, { automation: { ...automation, ...patch } });
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [source, setSource] = useState(project.sourcePath ?? "");
  const [tagDraft, setTagDraft] = useState("");
  const [tags, setTags] = useState<string[]>(project.tags ?? []);
  const [budgetInput, setBudgetInput] = useState(
    String(project.budgetUSD ?? ""),
  );
  const [savedAt, setSavedAt] = useState(false);
  const [picking, setPicking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setName(project.name);
    setDescription(project.description ?? "");
    setSource(project.sourcePath ?? "");
    setTags(project.tags ?? []);
    setBudgetInput(String(project.budgetUSD ?? ""));
    setConfirmDelete(false);
    actions.getProjectBilling(project.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const index = state.codeIndex[project.id];
  const billing = state.projectBilling[project.id];
  const projectAgents = useMemo(
    () => agentsForProject(state.agents, state.tasks, project.id),
    [state.agents, state.tasks, project.id],
  );
  const projectTasks = useMemo(
    () => state.tasks.filter((t) => t.projectId === project.id),
    [state.tasks, project.id],
  );
  const activeAgents = projectAgents.filter(isAgentActive).length;
  const openTasks = projectTasks.filter(
    (t) =>
      t.status !== "completed" &&
      t.status !== "cancelled" &&
      t.status !== "failed",
  ).length;
  const completedTasks = projectTasks.filter(
    (t) => t.status === "completed",
  ).length;

  const dirtyDetails =
    name.trim() !== project.name ||
    description !== (project.description ?? "") ||
    JSON.stringify(tags) !== JSON.stringify(project.tags ?? []);
  const sourceDirty = source.trim() !== (project.sourcePath ?? "");
  const appearance = project.appearance ?? {};

  const patchAppearance = (patch: Partial<ProjectAppearance>): void => {
    actions.updateProject(project.id, {
      appearance: { ...appearance, ...patch },
    });
  };

  const saveDetails = (): void => {
    if (!name.trim()) return;
    actions.updateProject(project.id, { name: name.trim(), description, tags });
    setSavedAt(true);
    window.setTimeout(() => setSavedAt(false), 1500);
  };

  const addTag = (): void => {
    const t = tagDraft.trim().toLowerCase();
    if (!t || tags.includes(t)) return;
    setTags([...tags, t]);
    setTagDraft("");
  };

  const applyPreset = (icon: string, color: string): void => {
    actions.setProjectIcon(project.id, icon, color);
  };

  const coverInputRef = useRef<HTMLInputElement>(null);
  const onPickCover = (file: File): void => {
    if (!file.type.startsWith("image/")) return;
    if (file.size > 4 * 1024 * 1024) {
      window.alert("Cover images are limited to 4 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      actions.updateProject(project.id, { coverImageUrl: String(reader.result) });
    };
    reader.readAsDataURL(file);
  };

  const assistantValue =
    project.assistantModel?.provider && project.assistantModel?.model
      ? {
          provider: project.assistantModel.provider,
          id: project.assistantModel.model,
        }
      : null;

  const go = (
    tab: NonNullable<
      Extract<NavTarget, { kind: "project" }>["tab"]
    >,
  ): void => {
    onNavigate?.({ kind: "project", id: project.id, tab });
  };

  const handleDelete = (): void => {
    actions.deleteProject(project.id);
    onNavigate?.({ kind: "projects" });
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      {/* Preview hero */}
      <section
        className="overflow-hidden rounded-xl"
        style={{
          ...CARD,
          background: project.color
            ? `linear-gradient(135deg, color-mix(in srgb, ${project.color} 16%, var(--surface)), var(--surface))`
            : "var(--surface)",
        }}
      >
        <div className="flex flex-wrap items-center gap-5 p-5">
          <div
            className="relative grid place-items-center rounded-2xl p-3"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--c-border)",
              boxShadow:
                appearance.glow && project.color
                  ? `0 0 28px ${project.color}55`
                  : undefined,
            }}
          >
            <ProjectIcon
              icon={project.icon}
              color={project.color}
              size={appearance.largeHeaderIcon ? 56 : 48}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-lg font-semibold text-primary">
                {project.name}
              </h1>
              <BadgeWithDot
                size="sm"
                color={STATUS_COLOR[project.status]}
                type="color"
              >
                {statusLabel(project.status)}
              </BadgeWithDot>
            </div>
            <p className="mt-1 line-clamp-2 text-sm text-tertiary">
              {project.description || "No description yet."}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(project.tags ?? []).length === 0 ? (
                <span className="text-[11px] text-quaternary">No tags</span>
              ) : (
                (project.tags ?? []).map((t) => (
                  <Badge key={t} size="sm" color="gray" type="pill-color">
                    {t}
                  </Badge>
                ))
              )}
            </div>
          </div>
          <div className="flex flex-col gap-1 text-right text-[11px] text-quaternary">
            <span>
              Created {new Date(project.createdAt).toLocaleDateString()}
            </span>
            <span>Updated {new Date(project.updatedAt).toLocaleString()}</span>
          </div>
        </div>
      </section>

      {/* Insights */}
      <Section
        title="Insights"
        description="Live footprint of this project across Coretex."
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          <InsightTile
            label="Open tasks"
            value={openTasks}
            hint={`${completedTasks} done`}
            onClick={() => go("kanban")}
          />
          <InsightTile
            label="Agents"
            value={projectAgents.length}
            hint={`${activeAgents} running`}
            onClick={() => go("agents")}
          />
          <InsightTile
            label="Documents"
            value={project.documents?.length ?? 0}
            onClick={() => go("documents")}
          />
          <InsightTile
            label="Repos"
            value={project.repos?.length ?? 0}
            onClick={() => go("git")}
          />
          <InsightTile
            label="Index"
            value={index?.chunks?.toLocaleString() ?? "—"}
            hint={
              index?.status === "ready"
                ? `${index.filesScanned} files`
                : (index?.status ?? "Not indexed")
            }
            onClick={() => go("documents")}
          />
          <InsightTile
            label="Spend"
            value={formatUSD(billing?.totalCostAllTime ?? 0)}
            hint={
              billing
                ? `${formatTokens(billing.totalTokensAllTime ?? 0)} tok`
                : "Refresh on billing"
            }
            onClick={() => go("billing")}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            color="secondary"
            iconTrailing={ArrowRight}
            onClick={() => go("kanban")}
          >
            Kanban
          </Button>
          <Button
            size="sm"
            color="secondary"
            iconTrailing={ArrowRight}
            onClick={() => go("git")}
          >
            Source Control
          </Button>
          <Button
            size="sm"
            color="secondary"
            iconTrailing={ArrowRight}
            onClick={() => go("billing")}
          >
            Usage &amp; billing
          </Button>
          <Button
            size="sm"
            color="tertiary"
            iconLeading={RefreshCcw01}
            onClick={() => actions.getProjectBilling(project.id)}
          >
            Refresh spend
          </Button>
        </div>
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section
          title="Project details"
          description="Identity shown across the app."
          actions={
            <Button
              size="sm"
              color="primary"
              iconLeading={savedAt ? Check : Save01}
              isDisabled={!dirtyDetails && !savedAt}
              onClick={saveDetails}
            >
              {savedAt ? "Saved" : "Save"}
            </Button>
          }
        >
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-secondary">Name</span>
              <Input
                value={name}
                onChange={setName}
                placeholder="Project name"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-secondary">
                Description
              </span>
              <TextArea
                value={description}
                onChange={setDescription}
                rows={4}
                placeholder="What is this project?"
              />
            </label>

            <div className="flex flex-col gap-2">
              <span className="flex items-center gap-1.5 text-xs font-medium text-secondary">
                Status{" "}
                <HelpTooltip text="Paused parks the project in lists; Archived hides it from default active views over time." />
              </span>
              <div className="flex flex-wrap gap-2">
                {STATUSES.map((s) => {
                  const on = project.status === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      className={pillSelectClass(on)}
                      onClick={() =>
                        actions.updateProject(project.id, { status: s })
                      }
                    >
                      <BadgeWithDot
                        size="md"
                        color={STATUS_COLOR[s]}
                        type="color"
                      >
                        {statusLabel(s)}
                      </BadgeWithDot>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="flex items-center gap-1.5 text-xs font-medium text-secondary">
                <Tag01 className="size-3.5 text-quaternary" /> Tags
              </span>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <button
                    key={t}
                    type="button"
                    title="Remove tag"
                    onClick={() => setTags(tags.filter((x) => x !== t))}
                    className="rounded-md px-2.5 py-0.5 text-[11px] font-medium text-secondary transition hover:text-error-primary"
                    style={{
                      background: "var(--surface-2)",
                      border: "1px solid var(--c-border)",
                    }}
                  >
                    {t} ×
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  aria-label="New tag"
                  placeholder="Add tag…"
                  value={tagDraft}
                  onChange={setTagDraft}
                />
                <Button
                  size="md"
                  color="secondary"
                  onClick={addTag}
                  isDisabled={!tagDraft.trim()}
                >
                  Add
                </Button>
              </div>
            </div>
          </div>
        </Section>

        <Section
          title="Intelligence"
          description="Default assistant model and spend guardrails for this project."
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="flex items-center gap-1.5 text-xs font-medium text-secondary">
                <CpuChip01 className="size-3.5 text-quaternary" /> Project chat model
                <HelpTooltip text="Used only by this project's Chat assistant. Orchestrator and task workers keep the models configured on their agent profiles or task execution controls." />
              </span>
              <ModelPicker
                models={state.models ?? []}
                value={assistantValue}
                onChange={(provider: ProviderType, id: string) =>
                  actions.setAssistantModel(project.id, provider, id)
                }
                capability="chat"
                placeholder="Inherit chat default"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="flex items-center gap-1.5 text-xs font-medium text-secondary">
                <Wallet02 className="size-3.5 text-quaternary" /> Budget (USD)
                <HelpTooltip text="Hard project spend guardrail. New agent work pauses at the cap; zero clears it." />
              </span>
              <div className="flex gap-2">
                <Input
                  value={budgetInput}
                  onChange={setBudgetInput}
                  placeholder="0 = no cap"
                />
                <Button
                  size="md"
                  color="secondary"
                  onClick={() => {
                    const n = Number(budgetInput);
                    actions.setProjectBudget(
                      project.id,
                      Number.isFinite(n) && n > 0 ? n : 0,
                    );
                  }}
                >
                  Apply
                </Button>
              </div>
              {project.budgetUSD != null && project.budgetUSD > 0 && (
                <p className="text-[11px] text-quaternary">
                  Cap {formatUSD(project.budgetUSD)}
                  {billing
                    ? ` · used ${formatUSD(billing.totalCostAllTime ?? 0)}`
                    : ""}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div
                className="rounded-lg px-3 py-2"
                style={{ background: "var(--surface-2)" }}
              >
                <p className="text-[10px] uppercase text-quaternary">
                  Agents here
                </p>
                <p className="text-sm font-semibold text-primary">
                  {projectAgents.length}
                </p>
              </div>
              <div
                className="rounded-lg px-3 py-2"
                style={{ background: "var(--surface-2)" }}
              >
                <p className="text-[10px] uppercase text-quaternary">
                  Open work
                </p>
                <p className="text-sm font-semibold text-primary">
                  {openTasks}
                </p>
              </div>
            </div>
          </div>
        </Section>

        <Section
          title="Autonomous workflow"
          description="Placement, review, documentation, branch, and pull-request controls for unattended work."
        >
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-xs font-medium text-secondary">
              Execution target
              <select
                value={project.executionTarget ?? "hybrid"}
                onChange={(event) => actions.updateProject(project.id, { executionTarget: event.target.value as ProjectExecutionTarget })}
                className="rounded-lg px-3 py-2 text-sm text-primary outline-none focus:ring-2 focus:ring-[var(--brand)]"
                style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}
              >
                <option value="local">Local only</option>
                <option value="cloud">Cloud only</option>
                <option value="hybrid">Hybrid</option>
              </select>
              <span className="font-normal text-quaternary">Local uses Ollama/LM Studio/OpenClaw; cloud uses hosted providers; hybrid allows both.</span>
            </label>

            {([
              ["unattended", "24/7 unattended queue", "Continuously pick up eligible backlog tasks while the Brain is running."],
              ["dualReview", "Two-agent code review", "Queue two independent reviewer passes after implementation work."],
              ["documentationAgent", "Dedicated documentation agent", "Update context and technical documentation after reviews pass."],
              ["initializeBranchTaxonomy", "Initialize branch taxonomy", "Create sandbox, devel, staging, and main refs without switching HEAD."],
              ["autoCreatePullRequest", "Create PR after review", "Push the active feature branch and open a PR through authenticated GitHub CLI."],
              ["autoMergePullRequest", "Merge after checks pass", "Enable GitHub auto-merge with squash and branch cleanup. Requires PR creation."],
            ] as const).map(([key, label, description]) => (
              <label key={key} className="flex items-start justify-between gap-4 rounded-lg p-3" style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}>
                <span>
                  <span className="block text-sm font-medium text-primary">{label}</span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-tertiary">{description}</span>
                </span>
                <Toggle
                  size="sm"
                  isSelected={automation[key]}
                  isDisabled={key === "autoMergePullRequest" && !automation.autoCreatePullRequest}
                  onChange={(value) => updateAutomation({ [key]: value })}
                />
              </label>
            ))}

            <Input
              label="PR target branch"
              value={automation.targetBranch}
              onChange={(value) => updateAutomation({ targetBranch: value.trim() || "main" })}
              placeholder="main"
              hint="Completed feature/* work is reviewed against this branch."
            />
          </div>
        </Section>
      </div>

      {/* Appearance */}
      <Section
        title="Appearance"
        description="Icon, accent color, cover art, and how this project shows up in lists."
      >
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-4">
            <div>
              <p className="mb-2 text-xs font-medium text-secondary">Cover image</p>
              <div
                className="relative flex h-28 items-end overflow-hidden rounded-xl"
                style={{
                  border: "1px solid var(--c-border)",
                  backgroundImage: project.coverImageUrl ? `url(${project.coverImageUrl})` : undefined,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                  background: project.coverImageUrl ? undefined : "var(--surface-2)",
                }}
              >
                {!project.coverImageUrl && (
                  <span className="absolute inset-0 grid place-items-center text-[11px] text-quaternary">No cover image</span>
                )}
                <div className="relative flex w-full items-center justify-end gap-2 p-2">
                  <button
                    type="button"
                    onClick={() => coverInputRef.current?.click()}
                    className="rounded-md px-2.5 py-1 text-[11px] font-semibold text-primary shadow-sm"
                    style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}
                  >
                    {project.coverImageUrl ? "Replace" : "Upload"}
                  </button>
                  {project.coverImageUrl && (
                    <button
                      type="button"
                      onClick={() => actions.updateProject(project.id, { coverImageUrl: undefined })}
                      className="rounded-md px-2.5 py-1 text-[11px] font-semibold text-error-primary shadow-sm"
                      style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}
                    >
                      Remove
                    </button>
                  )}
                </div>
                <input
                  ref={coverInputRef}
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onPickCover(f);
                    e.target.value = "";
                  }}
                />
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-secondary">Icon</p>
              <IconPicker
                value={project.icon}
                color={project.color}
                density="comfortable"
                onChange={(icon) =>
                  actions.setProjectIcon(project.id, icon, project.color)
                }
              />
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-secondary">
                Accent color
              </p>
              <ColorPicker
                value={project.color ?? ""}
                onChange={(c) =>
                  actions.setProjectIcon(
                    project.id,
                    project.icon,
                    c || undefined,
                  )
                }
                variant="full"
                allowCustom
                allowNone
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {COLOR_SWATCHES.map((s) => {
                  const on =
                    project.color?.toLowerCase() === s.value.toLowerCase();
                  return (
                    <button
                      key={s.value}
                      type="button"
                      title={s.name}
                      onClick={() =>
                        actions.setProjectIcon(
                          project.id,
                          project.icon,
                          s.value,
                        )
                      }
                      className="size-6 rounded-full transition"
                      style={{
                        background: s.value,
                        boxShadow: on
                          ? "0 0 0 2px var(--surface), 0 0 0 3.5px color-mix(in srgb, var(--c-text-primary) 22%, transparent)"
                          : undefined,
                      }}
                    />
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div>
              <p className="mb-2 text-xs font-medium text-secondary">
                Quick presets
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {APPEARANCE_PRESETS.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() => applyPreset(p.icon, p.color)}
                    className="flex flex-col items-center gap-2 rounded-xl px-2 py-3 transition hover:bg-[var(--surface-2)]"
                    style={{ border: "1px solid var(--c-border)" }}
                  >
                    <ProjectIcon icon={p.icon} color={p.color} size={28} />
                    <span className="text-[11px] font-medium text-secondary">
                      {p.name}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div
              className="flex flex-col gap-3 rounded-xl p-3"
              style={{
                background: "var(--surface-2)",
                border: "1px solid var(--c-border)",
              }}
            >
              <p className="text-xs font-medium text-secondary">Presentation</p>
              <label className="flex items-center justify-between gap-3">
                <span className="text-xs text-tertiary">Icon glow</span>
                <Toggle
                  size="sm"
                  isSelected={appearance.glow === true}
                  onChange={(v: boolean) => patchAppearance({ glow: v })}
                />
              </label>
              <label className="flex items-center justify-between gap-3">
                <span className="text-xs text-tertiary">
                  Accent rail in lists
                </span>
                <Toggle
                  size="sm"
                  isSelected={appearance.accentRail === true}
                  onChange={(v: boolean) => patchAppearance({ accentRail: v })}
                />
              </label>
              <label className="flex items-center justify-between gap-3">
                <span className="text-xs text-tertiary">Large header icon</span>
                <Toggle
                  size="sm"
                  isSelected={appearance.largeHeaderIcon === true}
                  onChange={(v: boolean) =>
                    patchAppearance({ largeHeaderIcon: v })
                  }
                />
              </label>
            </div>

            {/* Live preview card */}
            <div
              className="rounded-xl p-3"
              style={{ border: "1px dashed var(--c-border)" }}
            >
              <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-quaternary">
                List preview
              </p>
              <div
                className="flex items-center gap-3 rounded-lg px-3 py-2.5"
                style={{
                  background: "var(--surface-2)",
                  borderLeft:
                    appearance.accentRail && project.color
                      ? `3px solid ${project.color}`
                      : "3px solid transparent",
                }}
              >
                <span
                  style={{
                    filter:
                      appearance.glow && project.color
                        ? `drop-shadow(0 0 6px ${project.color})`
                        : undefined,
                  }}
                >
                  <ProjectIcon
                    icon={project.icon}
                    color={project.color}
                    size={28}
                  />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-primary">
                    {name || project.name}
                  </p>
                  <p className="truncate text-[11px] text-quaternary">
                    {statusLabel(project.status)} · {openTasks} open
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* Source */}
      <Section
        title="Source code location"
        description="Root folder for indexing, terminals, and relative Source Control paths."
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-1.5">
            <span className="flex items-center gap-1.5 text-xs font-medium text-secondary">
              <FolderCode className="size-3.5 text-quaternary" /> Folder path
            </span>
            <Input
              value={source}
              onChange={setSource}
              placeholder="P:\\agents\\my-project  or  /home/me/my-project"
            />
          </label>
          <Button
            size="md"
            color="secondary"
            iconLeading={Folder}
            onClick={() => setPicking(true)}
          >
            Browse
          </Button>
          <Button
            size="md"
            color="primary"
            isDisabled={!sourceDirty}
            onClick={() => actions.setProjectSource(project.id, source.trim())}
          >
            Link folder
          </Button>
        </div>
        {picking && (
          <FolderPicker
            state={state}
            actions={actions}
            title="Choose the project's source folder"
            initialPath={source.trim() || undefined}
            onPick={(p) => {
              setSource(p);
              actions.setProjectSource(project.id, p);
              setPicking(false);
            }}
            onClose={() => setPicking(false)}
          />
        )}
        {(project.sourcePath || (project.repos?.length ?? 0) > 0) && (
          <div
            className="mt-3 flex flex-wrap items-center gap-3 rounded-lg px-3 py-2"
            style={{ background: "var(--surface-2)" }}
          >
            <span className="font-mono text-xs text-secondary">
              {project.sourcePath || "No shared root · absolute and remote repository links"}
            </span>
            <span className="text-xs text-tertiary">
              {index
                ? `Indexed ${index.sourcePaths?.length ?? (index.sourcePath ? 1 : 0)} checkout${(index.sourcePaths?.length ?? (index.sourcePath ? 1 : 0)) === 1 ? "" : "s"} · ${index.chunks.toLocaleString()} chunks`
                : "Not indexed"}
            </span>
            <Button
              size="sm"
              color="secondary"
              iconLeading={RefreshCcw01}
              onClick={() => actions.reindexCode(project.id)}
            >
              Re-index
            </Button>
            <Button
              size="sm"
              color="tertiary"
              iconLeading={GitBranch01}
              onClick={() => go("git")}
            >
              Manage repos
            </Button>
            <Button
              size="sm"
              color="tertiary"
              iconLeading={File02}
              onClick={() => go("documents")}
            >
              Documents
            </Button>
          </div>
        )}
      </Section>

      {/* Danger zone */}
      <div
        className="rounded-xl p-5"
        style={{
          background: "var(--surface)",
          border:
            "1px solid color-mix(in srgb, var(--c-error) 40%, var(--c-border))",
        }}
      >
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-error-primary">
          <AlertTriangle className="size-4" /> Danger zone
        </h2>
        <p className="mt-0.5 text-xs text-tertiary">
          Deleting removes the project and cancels its running tasks. Files on
          disk and git remotes are not touched.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {confirmDelete ? (
            <>
              <Button
                size="sm"
                color="primary-destructive"
                iconLeading={Trash01}
                onClick={handleDelete}
              >
                Yes, delete &quot;{project.name}&quot;
              </Button>
              <Button
                size="sm"
                color="secondary"
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              color="secondary-destructive"
              iconLeading={Trash01}
              onClick={() => setConfirmDelete(true)}
            >
              Delete project
            </Button>
          )}
          {project.status !== "archived" && (
            <Button
              size="sm"
              color="secondary"
              onClick={() =>
                actions.updateProject(project.id, { status: "archived" })
              }
            >
              Archive instead
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
