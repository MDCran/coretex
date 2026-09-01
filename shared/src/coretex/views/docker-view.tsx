// @ts-nocheck
"use client";

// Coretex — Docker dashboard (first-class view). Live engine state from the Brain's
// dockerode-backed DockerService: containers (grouped by compose project, with
// start/stop/restart/remove), images, volumes, networks, and per-compose project
// linking persisted to settings.dockerLinks. Auto-detects the engine; polls while open.

import { useEffect, useMemo, useState } from "react";
import {
  Box,
  ChevronDown,
  Copy01,
  Cube01,
  Database01,
  DotsVertical,
  Link01,
  Play,
  RefreshCcw01,
  RefreshCcw05,
  Share07,
  StopCircle,
  Trash01,
} from "@untitledui/icons";
import type {
  DockerAction,
  DockerContainerInfo,
  DockerOperationState,
  DockerPruneTarget,
  Project,
} from "@repo/coretex/types";
import type { NavTarget } from "../nav";
import { useContextMenu, type MenuItem } from "../ui/context-menu";
import { BrandLogo } from "../ui/brand-logo";
import { ProjectIcon } from "../ui/project-icon";
import type { CoretexActions, CoretexState } from "../use-coretex";
import { BadgeWithDot } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Tooltip } from "@/components/base/tooltip/tooltip";
import { useConfirm } from "@/components/application/confirm-dialog/confirm-dialog";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { EmptyState } from "./social/ui";
import { getContainerActionState } from "./docker-action-state";

/** Title-case the raw engine container state so it matches the Title-Case action buttons beside it. */
const STATE_LABEL: Record<string, string> = {
  running: "Running",
  exited: "Exited",
  created: "Created",
  paused: "Paused",
  restarting: "Restarting",
  dead: "Dead",
};

const card = {
  background: "var(--surface)",
  border: "1px solid var(--c-border)",
} as const;

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "—";
  const gb = bytes / 1e9;
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

const STATE_COLOR: Record<string, "success" | "gray" | "warning" | "error"> = {
  running: "success",
  exited: "gray",
  created: "gray",
  paused: "warning",
  restarting: "warning",
  dead: "error",
};

const UNGROUPED = "__standalone__";

const PRUNE_COPY: Record<
  DockerPruneTarget,
  { title: string; description: string; confirmLabel: string }
> = {
  containers: {
    title: "Remove stopped containers?",
    description:
      "Docker will permanently remove every stopped container. Running containers and their data volumes are left unchanged.",
    confirmLabel: "Remove stopped",
  },
  images: {
    title: "Prune dangling image layers?",
    description:
      "Docker will remove untagged image layers that are not referenced by a container. Tagged images are kept.",
    confirmLabel: "Prune layers",
  },
  volumes: {
    title: "Prune unused volumes?",
    description:
      "Docker will permanently remove volumes that are not attached to a container. Deleted volume data cannot be recovered here.",
    confirmLabel: "Prune volumes",
  },
  networks: {
    title: "Prune unused networks?",
    description:
      "Docker will remove custom networks that are not being used by a container.",
    confirmLabel: "Prune networks",
  },
  buildcache: {
    title: "Clear the build cache?",
    description:
      "Docker will remove unused builder cache. Future image builds may take longer while layers are rebuilt.",
    confirmLabel: "Clear cache",
  },
  all: {
    title: "Clean up Docker resources?",
    description:
      "Docker will run the cleanup categories enabled in Settings. Review those selections before continuing if you need to preserve unused resources.",
    confirmLabel: "Clean up",
  },
};

function operationId(kind: DockerOperationState["kind"]): string {
  return `docker_${kind.replace("-", "_")}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function operationMessage(operation: DockerOperationState): string {
  if (operation.status === "failed")
    return (
      operation.error ||
      operation.message ||
      "Docker could not complete the operation."
    );
  if (operation.kind === "prune" && operation.summary) {
    const removed = Object.values(operation.summary.deletedByTarget).reduce(
      (total, count) => total + (count ?? 0),
      0,
    );
    const reclaimed = formatBytes(operation.summary.spaceReclaimedBytes);
    return `${removed} item${removed === 1 ? "" : "s"} removed${reclaimed === "—" ? "" : ` · ${reclaimed} reclaimed`}.`;
  }
  return operation.message || "Docker finished the operation successfully.";
}

/** Known image base names → company domain, so container/image rows show the real brand mark. */
const IMAGE_DOMAIN: Record<string, string> = {
  postgres: "postgresql.org",
  postgresql: "postgresql.org",
  redis: "redis.io",
  mongo: "mongodb.com",
  mongodb: "mongodb.com",
  mysql: "mysql.com",
  mariadb: "mariadb.org",
  nginx: "nginx.org",
  node: "nodejs.org",
  rabbitmq: "rabbitmq.com",
  traefik: "traefik.io",
  grafana: "grafana.com",
  minio: "min.io",
  elasticsearch: "elastic.co",
  kibana: "elastic.co",
  prometheus: "prometheus.io",
  caddy: "caddyserver.com",
  httpd: "apache.org",
  memcached: "memcached.org",
  influxdb: "influxdata.com",
  cassandra: "cassandra.apache.org",
  consul: "consul.io",
  vault: "vaultproject.io",
  nats: "nats.io",
  kafka: "kafka.apache.org",
  python: "python.org",
  golang: "go.dev",
  php: "php.net",
  ruby: "ruby-lang.org",
  ubuntu: "ubuntu.com",
  debian: "debian.org",
  alpine: "alpinelinux.org",
};

/**
 * Parse the base name from a Docker image ref — strips any registry/host prefix
 * (e.g. "docker.io/library/", "ghcr.io/org/") and the tag/digest suffix.
 * "registry:5000/library/postgres:16" → "postgres".
 */
function imageBaseName(image: string): string {
  if (!image) return "";
  // Drop tag/digest: take the part before the last ":" only if it doesn't look like a host:port.
  let ref = image.split("@")[0];
  const lastColon = ref.lastIndexOf(":");
  const lastSlash = ref.lastIndexOf("/");
  if (lastColon > lastSlash) ref = ref.slice(0, lastColon);
  // Last path segment is the repository name.
  const seg = ref.slice(lastSlash + 1);
  return seg.toLowerCase();
}

/** Logo for an image ref — its real brand mark when known, else the generic Cube tile. */
const ImageLogo = ({ image, size = 20 }: { image: string; size?: number }) => {
  const base = imageBaseName(image);
  const domain = IMAGE_DOMAIN[base];
  if (domain) return <BrandLogo domain={domain} name={base} size={size} />;
  return <FeaturedIcon icon={Cube01} size="sm" color="gray" theme="light" />;
};

export const DockerView = ({
  state,
  actions,
  onNavigate,
}: {
  state: CoretexState;
  actions: CoretexActions;
  onNavigate?: (t: NavTarget) => void;
}) => {
  const docker = state.docker;
  const dockerSettings = state.settings?.docker;
  const links = state.settings?.dockerLinks ?? {};
  const projects = state.projects;
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [issuedOperation, setIssuedOperation] =
    useState<DockerOperationState | null>(null);
  const [operationNotice, setOperationNotice] =
    useState<DockerOperationState | null>(null);
  const ctx = useContextMenu();
  const confirmDestructive = dockerSettings?.confirmDestructive !== false;
  const showStopped = dockerSettings?.showStoppedContainers !== false;
  const pollMs =
    Math.max(3, Math.min(60, dockerSettings?.pollIntervalSec ?? 6)) * 1000;
  const autoRefresh =
    dockerSettings?.autoRefresh !== false && dockerSettings?.enabled !== false;
  const activeOperations = Object.values(state.dockerOperations?.active ?? {});
  const visibleOperations =
    issuedOperation &&
    !activeOperations.some((operation) => operation.id === issuedOperation.id)
      ? [...activeOperations, issuedOperation]
      : activeOperations;
  const activeContainerOperation = visibleOperations.find(
    (operation) => operation.kind === "container-action",
  );
  const activePruneOperation = visibleOperations.find(
    (operation) => operation.kind === "prune",
  );
  const activeRefreshOperation = visibleOperations.find(
    (operation) => operation.kind === "refresh",
  );
  const pendingAction =
    activeContainerOperation?.containerId && activeContainerOperation.action
      ? {
          id: activeContainerOperation.containerId,
          action: activeContainerOperation.action,
        }
      : null;
  const pendingPrune = activePruneOperation?.target ?? null;
  const refreshing = Boolean(activeRefreshOperation);
  const operationBusy = visibleOperations.length > 0;

  const containerMenu = (c: DockerContainerInfo): MenuItem[] => {
    const actionState = getContainerActionState(c.state);
    const busy = operationBusy;
    return [
      { header: c.name },
      {
        key: "start",
        label: actionState.primaryLabel ?? "Start",
        icon: Play,
        onClick: () =>
          actionState.primaryAction &&
          runContainerAction(actionState.primaryAction, c.id),
        disabled: busy || actionState.primaryAction === null,
      },
      {
        key: "stop",
        label: "Stop",
        icon: StopCircle,
        onClick: () => runContainerAction("stop", c.id),
        disabled: busy || !actionState.canStop,
      },
      {
        key: "restart",
        label: "Restart",
        icon: RefreshCcw05,
        onClick: () => runContainerAction("restart", c.id),
        disabled: busy || !actionState.canRestart,
      },
      { separator: true },
      {
        key: "copy",
        label: "Copy name",
        icon: Copy01,
        onClick: () => void navigator.clipboard?.writeText(c.name),
      },
      { separator: true },
      {
        key: "remove",
        label: "Remove container",
        icon: Trash01,
        danger: true,
        onClick: () => requestRemove(c),
        disabled: busy || !actionState.canRemove,
      },
    ];
  };

  const refresh = (): void => {
    if (operationBusy) return;
    const id = operationId("refresh");
    const operation: DockerOperationState = {
      id,
      kind: "refresh",
      status: "running",
      startedAt: Date.now(),
    };
    setIssuedOperation(operation);
    const accepted = actions.dockerRefresh(id);
    if (!accepted) setIssuedOperation(null);
  };

  const runContainerAction = (action: DockerAction, id: string): void => {
    if (operationBusy) return;
    const idempotencyKey = operationId("container-action");
    const operation: DockerOperationState = {
      id: idempotencyKey,
      kind: "container-action",
      status: "running",
      startedAt: Date.now(),
      action,
      containerId: id,
    };
    setIssuedOperation(operation);
    const accepted = actions.dockerAction(action, id, idempotencyKey);
    if (!accepted) setIssuedOperation(null);
  };

  const requestRemove = (container: DockerContainerInfo): void => {
    const execute = () => runContainerAction("remove", container.id);
    if (!confirmDestructive) {
      execute();
      return;
    }
    confirm({
      title: `Remove ${container.name}?`,
      description:
        "This permanently removes the stopped container. Its image and named volumes are kept, but changes inside the container's writable layer are lost.",
      confirmLabel: "Remove container",
      onConfirm: execute,
    });
  };

  const runPrune = (target: DockerPruneTarget): void => {
    if (operationBusy) return;
    const id = operationId("prune");
    const operation: DockerOperationState = {
      id,
      kind: "prune",
      status: "running",
      startedAt: Date.now(),
      target,
    };
    setIssuedOperation(operation);
    const accepted = actions.dockerPrune(target, id);
    if (!accepted) setIssuedOperation(null);
  };

  const requestPrune = (target: DockerPruneTarget): void => {
    if (!confirmDestructive) {
      runPrune(target);
      return;
    }
    const copy = PRUNE_COPY[target];
    confirm({
      title: copy.title,
      description: copy.description,
      confirmLabel: copy.confirmLabel,
      onConfirm: () => runPrune(target),
    });
  };

  useEffect(() => {
    actions.dockerRefresh();
    if (!autoRefresh) return;
    const t = window.setInterval(() => actions.dockerRefresh(), pollMs);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, pollMs]);

  // Only the correlated operation result clears its optimistic UI state.
  // Auto-refresh snapshots can arrive while a lifecycle command is running.
  useEffect(() => {
    const completed = state.dockerOperations?.last;
    if (!completed || completed.status === "running") return;
    setIssuedOperation((current) =>
      current?.id === completed.id ? null : current,
    );
    if (completed.kind === "refresh" && completed.status !== "failed") return;
    setOperationNotice(completed);
    const timer = window.setTimeout(
      () =>
        setOperationNotice((current) =>
          current?.id === completed.id ? null : current,
        ),
      6_000,
    );
    return () => window.clearTimeout(timer);
  }, [state.dockerOperations?.last]);

  // A lost bridge/result must not leave every Docker control disabled forever.
  // Normal completion always resolves through the correlated event above.
  useEffect(() => {
    if (!issuedOperation) return;
    const timer = window.setTimeout(() => {
      setIssuedOperation((current) =>
        current?.id === issuedOperation.id ? null : current,
      );
      setOperationNotice({
        ...issuedOperation,
        status: "failed",
        finishedAt: Date.now(),
        error:
          "Docker did not report a result in time. Refresh to confirm the current engine state before retrying.",
      });
    }, 20_000);
    return () => window.clearTimeout(timer);
  }, [issuedOperation]);

  // Group containers by compose project (or "standalone").
  const groups = useMemo(() => {
    const g = new Map<string, DockerContainerInfo[]>();
    const list = (docker?.containers ?? []).filter(
      (c) =>
        showStopped ||
        c.state === "running" ||
        c.state === "paused" ||
        c.state === "restarting",
    );
    for (const c of list) {
      const key = c.composeProject || UNGROUPED;
      const arr = g.get(key) ?? [];
      arr.push(c);
      g.set(key, arr);
    }
    return [...g.entries()].sort((a, b) =>
      a[0] === UNGROUPED
        ? 1
        : b[0] === UNGROUPED
          ? -1
          : a[0].localeCompare(b[0]),
    );
  }, [docker, showStopped]);

  const running =
    docker?.containers.filter((c) => c.state === "running").length ?? 0;

  const linkCompose = (compose: string, projectId: string): void => {
    const next = { ...links };
    if (projectId) next[compose] = projectId;
    else delete next[compose];
    actions.setSetting("dockerLinks", next);
  };

  return (
    <div className="flex h-full flex-col gap-6 overflow-x-hidden overflow-y-auto p-4 *:shrink-0 sm:p-6">
      <header className="flex flex-col gap-4 border-b border-secondary pb-5 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <BrandLogo
            domain="docker.com"
            name="Docker"
            size={40}
            className="shrink-0"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-display-xs font-semibold text-primary">
                Docker
              </h1>
              {docker?.available ? (
                <BadgeWithDot size="sm" color="success">
                  Engine online{docker.version ? ` · v${docker.version}` : ""}
                </BadgeWithDot>
              ) : (
                <BadgeWithDot size="sm" color="error">
                  Engine unavailable
                </BadgeWithDot>
              )}
            </div>
            <p className="mt-1 max-w-3xl text-sm text-tertiary">
              {docker?.info?.operatingSystem
                ? `${docker.info.operatingSystem}${docker.info.ncpu ? ` · ${docker.info.ncpu} CPUs` : ""}${docker.info.driver ? ` · ${docker.info.driver}` : ""}`
                : "Manage containers and reclaim unused Docker resources from one place."}
            </p>
          </div>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          {docker?.available && (
            <Tooltip
              title="Clean up unused resources"
              description="Uses the cleanup categories selected in Settings → Docker. You will review a confirmation before anything is removed."
              placement="bottom"
            >
              <Button
                size="sm"
                color="secondary-destructive"
                iconLeading={Trash01}
                onClick={() => requestPrune("all")}
                isLoading={pendingPrune === "all"}
                isDisabled={operationBusy}
                aria-label="Clean up unused Docker resources"
              >
                Clean up
              </Button>
            </Tooltip>
          )}
          <Tooltip
            title="Refresh Docker data"
            description="Fetch the latest containers, images, volumes, and networks."
            placement="bottom"
          >
            <Button
              size="sm"
              color="secondary"
              iconLeading={RefreshCcw01}
              onClick={refresh}
              isLoading={refreshing}
              showTextWhileLoading
              isDisabled={operationBusy}
              aria-label="Refresh Docker data"
            >
              Refresh
            </Button>
          </Tooltip>
        </div>
      </header>

      {operationNotice && (
        <div
          role={operationNotice.status === "failed" ? "alert" : "status"}
          className={`flex flex-col gap-3 rounded-xl px-4 py-3 ring-1 ring-inset sm:flex-row sm:items-center ${operationNotice.status === "failed" ? "bg-error-primary ring-error_subtle" : "bg-success-primary ring-utility-green-300"}`}
        >
          <BadgeWithDot
            size="sm"
            color={operationNotice.status === "failed" ? "error" : "success"}
          >
            {operationNotice.status === "failed"
              ? "Action failed"
              : "Action complete"}
          </BadgeWithDot>
          <p className="min-w-0 flex-1 break-words text-sm text-secondary">
            {operationMessage(operationNotice)}
          </p>
          <Button
            size="sm"
            color="link-gray"
            onClick={() => setOperationNotice(null)}
            aria-label="Dismiss Docker operation message"
          >
            Dismiss
          </Button>
        </div>
      )}

      {!docker?.available ? (
        <div className="rounded-2xl px-5 py-12 text-center" style={card}>
          <FeaturedIcon
            icon={Cube01}
            size="lg"
            color="gray"
            theme="light"
            className="mx-auto"
          />
          <p className="mt-4 text-md font-semibold text-primary">
            Docker engine not reachable
          </p>
          <p className="mx-auto mt-1 max-w-lg text-sm text-tertiary">
            Start Docker Desktop (or the daemon), then refresh this page.
            Connection options live in Settings → Docker.
          </p>
          {docker?.error && (
            <p className="mx-auto mt-3 max-w-2xl break-words rounded-lg bg-secondary px-3 py-2 font-mono text-xs text-quaternary">
              {docker.error}
            </p>
          )}
          <Button
            className="mt-5"
            size="sm"
            color="secondary"
            iconLeading={RefreshCcw01}
            onClick={refresh}
            isLoading={refreshing}
            isDisabled={operationBusy}
            showTextWhileLoading
          >
            Try again
          </Button>
        </div>
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              icon={Box}
              color="success"
              label="Containers running"
              value={`${running} / ${docker.containers.length}`}
              hint={`${docker.containers.length - running} non-running`}
            />
            <Stat
              icon={Cube01}
              color="brand"
              label="Images"
              value={String(docker.images.length)}
              hint={`${formatBytes(docker.images.reduce((s, i) => s + i.sizeBytes, 0))} stored`}
            />
            <Stat
              icon={Database01}
              color="gray"
              label="Volumes"
              value={String(docker.volumes.length)}
              hint="persistent data volumes"
            />
            <Stat
              icon={Share07}
              color="gray"
              label="Networks"
              value={String(docker.networks.length)}
              hint="Docker networks"
            />
          </div>

          {/* Images / volumes / networks — above the big container list */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <SummaryCard
              icon={Cube01}
              title="Images"
              description="Tagged images and local layers"
              count={docker.images.length}
              action={
                docker.images.length > 0 ? (
                  <PruneBtn
                    loading={pendingPrune === "images"}
                    disabled={operationBusy}
                    onClick={() => requestPrune("images")}
                    label="Prune dangling layers"
                  />
                ) : undefined
              }
            >
              {docker.images.slice(0, 8).map((im) => {
                const label = im.tags[0] ?? im.id.slice(7, 19);
                return (
                  <div
                    key={im.id}
                    className="flex min-h-8 items-center justify-between gap-3 rounded-lg px-1.5 py-1 transition hover:bg-secondary"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <ImageLogo image={im.tags[0] ?? ""} size={18} />
                      <span className="truncate text-xs text-secondary">
                        {label}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-quaternary">
                      {formatBytes(im.sizeBytes)}
                    </span>
                  </div>
                );
              })}
              {docker.images.length === 0 && (
                <SummaryEmpty label="No images stored" />
              )}
            </SummaryCard>
            <SummaryCard
              icon={Database01}
              title="Volumes"
              description="Persistent container data"
              count={docker.volumes.length}
              action={
                docker.volumes.length > 0 ? (
                  <PruneBtn
                    loading={pendingPrune === "volumes"}
                    disabled={operationBusy}
                    onClick={() => requestPrune("volumes")}
                    label="Prune volumes"
                  />
                ) : undefined
              }
            >
              {docker.volumes.slice(0, 8).map((v) => (
                <Row key={v.name} label={v.name} value={v.driver} />
              ))}
              {docker.volumes.length === 0 && (
                <SummaryEmpty label="No volumes created" />
              )}
            </SummaryCard>
            <SummaryCard
              icon={Share07}
              title="Networks"
              description="Container connectivity"
              count={docker.networks.length}
              action={
                docker.networks.length > 0 ? (
                  <PruneBtn
                    loading={pendingPrune === "networks"}
                    disabled={operationBusy}
                    onClick={() => requestPrune("networks")}
                    label="Prune networks"
                  />
                ) : undefined
              }
            >
              {docker.networks.slice(0, 8).map((n) => (
                <Row key={n.id} label={n.name} value={n.driver} />
              ))}
              {docker.networks.length === 0 && (
                <SummaryEmpty label="No custom networks" />
              )}
            </SummaryCard>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-primary">Containers</h2>
              <p className="mt-0.5 text-sm text-tertiary">
                Start, stop, restart, and safely remove containers grouped by
                Compose project.
              </p>
            </div>
            {docker.containers.some(
              (container) => getContainerActionState(container.state).canRemove,
            ) && (
              <Tooltip
                title="Remove all stopped containers"
                description="Running, paused, and restarting containers are not removed."
                placement="top"
              >
                <Button
                  size="sm"
                  color="secondary-destructive"
                  iconLeading={Trash01}
                  onClick={() => requestPrune("containers")}
                  isLoading={pendingPrune === "containers"}
                  isDisabled={operationBusy}
                  aria-label="Remove all stopped containers"
                >
                  Remove stopped
                </Button>
              </Tooltip>
            )}
          </div>

          {/* Containers grouped by compose project */}
          {groups.length === 0 ? (
            <div className="rounded-xl p-10" style={card}>
              <EmptyState size="sm">
                <EmptyState.Header>
                  <EmptyState.FeaturedIcon
                    icon={Cube01}
                    color="brand"
                    theme="gradient"
                  />
                </EmptyState.Header>
                <EmptyState.Content>
                  <EmptyState.Title>No containers running</EmptyState.Title>
                  <EmptyState.Description>
                    The Docker engine is reachable but has no containers. Start
                    a stack with{" "}
                    <span className="font-mono text-xs text-secondary">
                      docker compose up
                    </span>{" "}
                    or run a container, then refresh.
                  </EmptyState.Description>
                </EmptyState.Content>
                <EmptyState.Footer>
                  <Button
                    size="md"
                    color="secondary"
                    iconLeading={RefreshCcw01}
                    onClick={refresh}
                    isLoading={refreshing}
                    isDisabled={operationBusy}
                    showTextWhileLoading
                    aria-label="Refresh Docker containers"
                  >
                    Refresh
                  </Button>
                </EmptyState.Footer>
              </EmptyState>
            </div>
          ) : (
            groups.map(([group, containers]) => (
              <section
                key={group}
                className="shrink-0 overflow-hidden rounded-2xl"
                style={card}
              >
                <div className="flex flex-wrap items-center gap-2 border-b border-secondary bg-secondary/30 px-4 py-3 sm:px-5">
                  <h3 className="text-sm font-semibold text-primary">
                    {group === UNGROUPED ? "Standalone containers" : group}
                  </h3>
                  <BadgeWithDot
                    size="sm"
                    color={
                      containers.some(
                        (container) => container.state === "running",
                      )
                        ? "success"
                        : "gray"
                    }
                  >
                    {
                      containers.filter(
                        (container) => container.state === "running",
                      ).length
                    }{" "}
                    running · {containers.length} total
                  </BadgeWithDot>
                  {group !== UNGROUPED && (
                    <div className="w-full sm:ml-auto sm:w-auto">
                      <div className="flex items-center gap-2 sm:justify-end">
                        <Link01 className="size-3.5 text-quaternary" />
                        <span className="text-xs text-tertiary">Project</span>
                        <ProjectLinkSelect
                          projects={projects}
                          value={links[group] ?? ""}
                          onChange={(id) => linkCompose(group, id)}
                        />
                      </div>
                    </div>
                  )}
                </div>
                <ul className="flex flex-col divide-y divide-[var(--c-border)]">
                  {containers.map((c) => {
                    const isRunning = c.state === "running";
                    const isPaused = c.state === "paused";
                    const isRestarting = c.state === "restarting";
                    const actionState = getContainerActionState(c.state);
                    const rowPending = pendingAction?.id === c.id;
                    const controlsDisabled = operationBusy;
                    // Docker commonly returns the same binding for IPv4 and IPv6.
                    // Collapse those duplicates so each public mapping is shown once.
                    const pubPorts = [
                      ...new Map(
                        c.ports
                          .filter((port) => port.publicPort)
                          .map((port) => [
                            `${port.publicPort}:${port.privatePort}:${port.type}`,
                            port,
                          ]),
                      ).values(),
                    ];
                    return (
                      <li
                        key={c.id}
                        className="group flex flex-wrap items-center gap-3 px-4 py-3.5 transition hover:bg-secondary/40 sm:px-5"
                        onContextMenu={(e) => ctx.open(e, containerMenu(c))}
                      >
                        <div className="shrink-0">
                          <ImageLogo image={c.image} size={20} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-medium text-primary">
                              {c.name}
                            </span>
                            <BadgeWithDot
                              size="sm"
                              color={STATE_COLOR[c.state] ?? "gray"}
                            >
                              {STATE_LABEL[c.state] ?? c.state}
                            </BadgeWithDot>
                            <span className="text-xs text-quaternary">
                              {c.status}
                            </span>
                          </div>
                          <p className="mt-0.5 truncate text-xs text-tertiary">
                            {c.image}
                            {pubPorts.length > 0 && (
                              <span className="text-quaternary">
                                {" · "}
                                {pubPorts.map((p) => (
                                  <a
                                    key={p.privatePort}
                                    href={`http://localhost:${p.publicPort}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-brand-secondary hover:underline"
                                  >
                                    {p.publicPort}→{p.privatePort}{" "}
                                  </a>
                                ))}
                              </span>
                            )}
                          </p>
                        </div>
                        <div className="flex w-full shrink-0 items-center justify-end gap-1.5 sm:w-auto">
                          {isRunning ? (
                            <>
                              <ActionIconButton
                                label={`Restart ${c.name}`}
                                description="Gracefully restart this running container."
                                icon={RefreshCcw05}
                                loading={
                                  rowPending &&
                                  pendingAction?.action === "restart"
                                }
                                disabled={controlsDisabled}
                                onClick={() =>
                                  runContainerAction("restart", c.id)
                                }
                              />
                              <Button
                                size="sm"
                                color="secondary"
                                iconLeading={StopCircle}
                                onClick={() => runContainerAction("stop", c.id)}
                                isLoading={
                                  rowPending && pendingAction?.action === "stop"
                                }
                                isDisabled={controlsDisabled}
                                aria-label={`Stop ${c.name}`}
                              >
                                Stop
                              </Button>
                            </>
                          ) : isPaused ? (
                            <Button
                              size="sm"
                              color="primary"
                              iconLeading={Play}
                              onClick={() =>
                                runContainerAction("unpause", c.id)
                              }
                              isLoading={
                                rowPending &&
                                pendingAction?.action === "unpause"
                              }
                              isDisabled={controlsDisabled}
                              aria-label={`Resume ${c.name}`}
                            >
                              Resume
                            </Button>
                          ) : isRestarting ? (
                            <Button
                              size="sm"
                              color="secondary"
                              iconLeading={StopCircle}
                              onClick={() => runContainerAction("stop", c.id)}
                              isLoading={
                                rowPending && pendingAction?.action === "stop"
                              }
                              isDisabled={controlsDisabled}
                              aria-label={`Stop ${c.name}`}
                            >
                              Stop
                            </Button>
                          ) : (
                            actionState.primaryAction === "start" && (
                              <Button
                                size="sm"
                                color="primary"
                                iconLeading={Play}
                                onClick={() =>
                                  runContainerAction("start", c.id)
                                }
                                isLoading={
                                  rowPending &&
                                  pendingAction?.action === "start"
                                }
                                isDisabled={controlsDisabled}
                                aria-label={`Start ${c.name}`}
                              >
                                Start
                              </Button>
                            )
                          )}
                          <ActionIconButton
                            label={
                              actionState.canRemove
                                ? `Remove ${c.name}`
                                : `Stop ${c.name} before removing it`
                            }
                            description={
                              actionState.canRemove
                                ? "Permanently remove this stopped container."
                                : "Running, paused, and restarting containers must be stopped before they can be removed."
                            }
                            icon={Trash01}
                            destructive
                            loading={
                              rowPending && pendingAction?.action === "remove"
                            }
                            disabled={
                              !actionState.canRemove || controlsDisabled
                            }
                            onClick={() => requestRemove(c)}
                          />
                          <ActionIconButton
                            label={`More actions for ${c.name}`}
                            description="Open the container action menu."
                            icon={DotsVertical}
                            disabled={controlsDisabled}
                            onClick={(event) =>
                              ctx.open(event, containerMenu(c))
                            }
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}

          {Object.keys(links).length > 0 && onNavigate && (
            <p className="text-xs text-quaternary">
              Linked compose projects surface their containers under the
              project.{" "}
              <button
                type="button"
                className="text-brand-secondary hover:underline"
                onClick={() => onNavigate({ kind: "projects" })}
              >
                View projects
              </button>
            </p>
          )}
        </>
      )}
      {ctx.node}
      {confirmDialog}
    </div>
  );
};

const Stat = ({
  icon,
  color,
  label,
  value,
  hint,
}: {
  icon: typeof Cube01;
  color: "brand" | "success" | "gray";
  label: string;
  value: string;
  hint: string;
}) => (
  <div className="rounded-xl p-4" style={card}>
    <div className="flex items-center gap-3">
      <FeaturedIcon icon={icon} size="md" color={color} theme="light" />
      <span className="text-xs font-medium text-tertiary">{label}</span>
    </div>
    <p className="mt-3 text-display-xs font-semibold text-primary">{value}</p>
    <p className="mt-1 text-xs text-tertiary">{hint}</p>
  </div>
);

const SummaryCard = ({
  icon: Icon,
  title,
  description,
  count,
  action,
  children,
}: {
  icon: typeof Cube01;
  title: string;
  description: string;
  count: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <div
    className="flex min-h-80 flex-col overflow-hidden rounded-2xl"
    style={card}
  >
    <div className="flex items-start justify-between gap-3 border-b border-secondary px-4 py-3.5">
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <FeaturedIcon icon={Icon} size="sm" color="gray" theme="light" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-primary">{title}</p>
          <p className="truncate text-xs text-quaternary">{description}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-tertiary">
          {count}
        </span>
        {action}
      </div>
    </div>
    <div className="flex flex-1 flex-col gap-0.5 px-3 py-3">{children}</div>
    {count > 8 && (
      <p className="border-t border-secondary px-4 py-2 text-[11px] text-quaternary">
        Showing 8 of {count}
      </p>
    )}
  </div>
);

/** Compact Untitled UI prune action; the shared confirm dialog explains scope. */
const PruneBtn = ({
  loading,
  disabled,
  onClick,
  label,
}: {
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
  label: string;
}) => (
  <Tooltip
    title={label}
    description="Remove Docker resources that are not currently in use."
    placement="top"
  >
    <Button
      size="xs"
      color="tertiary-destructive"
      iconLeading={Trash01}
      onClick={onClick}
      isLoading={loading}
      isDisabled={disabled}
      aria-label={label}
      title={label}
    />
  </Tooltip>
);

const SummaryEmpty = ({ label }: { label: string }) => (
  <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-secondary px-3 py-8 text-center text-xs text-quaternary">
    {label}
  </div>
);

const ActionIconButton = ({
  label,
  description,
  icon,
  loading = false,
  disabled = false,
  destructive = false,
  onClick,
}: {
  label: string;
  description: string;
  icon: typeof Cube01;
  loading?: boolean;
  disabled?: boolean;
  destructive?: boolean;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) => (
  <Tooltip title={label} description={description} placement="top">
    <Button
      size="sm"
      color={destructive ? "tertiary-destructive" : "secondary"}
      iconLeading={icon}
      onClick={onClick}
      isLoading={loading}
      isDisabled={disabled}
      aria-label={label}
      title={label}
    />
  </Tooltip>
);

// ---- compact project link dropdown (shows the project's icon + name, or "Not set") ----
const ProjectLinkSelect = ({
  projects,
  value,
  onChange,
}: {
  projects: Project[];
  value: string;
  onChange: (id: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const sel = projects.find((p) => p.id === value);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Link Compose group to a project"
        className="flex min-h-8 max-w-full items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs outline-brand transition hover:bg-primary_hover focus-visible:outline-2 focus-visible:outline-offset-2"
        style={{
          background: "var(--surface-2)",
          border: "1px solid var(--c-border)",
        }}
      >
        {sel ? (
          <>
            <ProjectIcon icon={sel.icon} color={sel.color} size={16} />
            <span className="max-w-32 truncate text-primary">{sel.name}</span>
          </>
        ) : (
          <span className="text-tertiary">Not set</span>
        )}
        <ChevronDown className="size-3.5 text-quaternary" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 z-30 mt-1 max-h-64 w-52 overflow-y-auto rounded-lg p-1 shadow-xl"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--c-border)",
            }}
          >
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-tertiary hover:bg-[var(--surface-2)]"
            >
              Not set
            </button>
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  onChange(p.id);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-secondary hover:bg-[var(--surface-2)]"
              >
                <ProjectIcon icon={p.icon} color={p.color} size={16} />
                <span className="flex-1 truncate text-primary">{p.name}</span>
              </button>
            ))}
            {projects.length === 0 && (
              <p className="px-2 py-1.5 text-xs text-quaternary">
                No projects yet.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
};

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex min-h-8 items-center justify-between gap-3 rounded-lg px-1.5 py-1 transition hover:bg-secondary">
    <span className="truncate text-xs text-secondary">{label}</span>
    <span className="shrink-0 text-xs text-quaternary">{value}</span>
  </div>
);
