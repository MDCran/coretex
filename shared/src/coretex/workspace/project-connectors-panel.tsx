"use client";

import type { Project, ServiceConnection } from "@repo/coretex/types";
import { AlertCircle, Link01 } from "@untitledui/icons";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Toggle } from "@/components/base/toggle/toggle";
import { BrandLogo } from "../ui/brand-logo";
import type { NavTarget } from "../nav";
import type { CoretexActions, CoretexState } from "../use-coretex";

type ConnectorAccount = ServiceConnection & {
  agentEnabled?: boolean;
  runtimeServerId?: string;
  verification?: "verified" | "unverified" | "failed";
  lastError?: string;
};

type ConnectorProject = Project & { connectorIds?: string[] };

function usableProjectConnectors(state: CoretexState): ConnectorAccount[] {
  return ((state.keyvault?.integrations ?? []) as ConnectorAccount[]).filter(
    (connection) =>
      connection.category !== "ai" &&
      connection.agentEnabled !== false &&
      (connection.status === "connected" || connection.status === "partial"),
  );
}

export function ProjectConnectorsPanel({
  project,
  state,
  actions,
  onNavigate,
}: {
  project: ConnectorProject;
  state: CoretexState;
  actions: CoretexActions;
  onNavigate?: (target: NavTarget) => void;
}) {
  const selected = new Set(project.connectorIds ?? []);
  const availableConnectors = usableProjectConnectors(state);
  const availableIds = new Set(availableConnectors.map((connector) => connector.id));
  // Keep an unavailable-but-assigned account visible so project access never
  // becomes a hidden stale permission after an account is disconnected.
  const connectors = ((state.keyvault?.integrations ?? []) as ConnectorAccount[]).filter(
    (connection) =>
      connection.category !== "ai" &&
      (availableIds.has(connection.id) || selected.has(connection.id)),
  );

  const update = (ids: string[]) => {
    actions.updateProject(project.id, { connectorIds: ids });
  };

  const toggle = (id: string, enabled: boolean) => {
    const next = new Set(selected);
    if (enabled) next.add(id);
    else next.delete(id);
    update([...next]);
  };

  return (
    <div className="flex flex-col gap-4 p-1">
      <div
        className="flex flex-col gap-3 rounded-xl p-4 sm:flex-row sm:items-start sm:justify-between"
        style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Link01 className="size-4 text-brand-secondary" />
            <h2 className="text-sm font-semibold text-primary">Connector access for this project</h2>
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-tertiary">
            Only enabled accounts are exposed to agents working on this project. MCP connectors provide direct tools; other accounts provide named,
            protected runtime variables. Secret values never enter prompts.
          </p>
        </div>
        {connectors.length > 0 && (
          <div className="flex shrink-0 gap-2">
            <Button size="sm" color="secondary" onClick={() => update(availableConnectors.map((connector) => connector.id))} isDisabled={availableConnectors.length === 0}>
              Allow all
            </Button>
            <Button size="sm" color="secondary" onClick={() => update([])} isDisabled={selected.size === 0}>
              Remove all
            </Button>
          </div>
        )}
      </div>

      {connectors.length === 0 ? (
        <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-secondary px-6 text-center">
          <span className="grid size-10 place-items-center rounded-xl bg-secondary">
            <AlertCircle className="size-5 text-quaternary" />
          </span>
          <p className="mt-3 text-sm font-semibold text-primary">No usable connectors yet</p>
          <p className="mt-1 max-w-md text-xs leading-5 text-tertiary">
            Connect and verify an account in Settings → Remote &amp; connectors. It will then appear here for explicit project access.
          </p>
          {onNavigate && (
            <Button
              size="sm"
              color="primary"
              className="mt-3"
              onClick={() => onNavigate({ kind: "settings", page: "remote" })}
            >
              Open connectors
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {connectors.map((connector) => {
            const enabled = selected.has(connector.id);
            const runtimeId = connector.runtimeServerId;
            const runtime = runtimeId ? state.mcp?.[runtimeId] : undefined;
            const directTools = Boolean(runtimeId);
            const accountAvailable = availableIds.has(connector.id);
            const healthy = accountAvailable && (directTools ? runtime?.connected === true : true);
            const statusLabel = !accountAvailable
              ? connector.status === "error" ? "Connection error" : "Disconnected"
              : directTools
                ? runtime?.connected ? `${runtime.tools?.length ?? 0} tools live` : "Tools unavailable"
                : "Credential runtime";
            return (
              <div
                key={connector.id}
                className="flex items-start justify-between gap-4 rounded-xl p-4"
                style={{
                  background: enabled ? "color-mix(in srgb, var(--brand) 7%, var(--surface))" : "var(--surface)",
                  border: enabled
                    ? "1px solid color-mix(in srgb, var(--brand) 35%, var(--c-border))"
                    : "1px solid var(--c-border)",
                }}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <BrandLogo domain={connector.serviceDomain} name={connector.serviceName} size={34} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-primary">{connector.serviceName}</p>
                      <Badge size="sm" color={healthy ? "success" : "warning"} type="pill-color">
                        {statusLabel}
                      </Badge>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-tertiary">{connector.connectedAs}</p>
                    <p className="mt-1 text-[11px] leading-4 text-quaternary">
                      {directTools
                        ? "Direct MCP tools are constrained by both this project and the assigned agent."
                        : accountAvailable
                          ? "Agents receive only the connector’s named runtime variables; terminal and agent policies still govern how they may be used."
                          : "This saved project permission is inactive until the account reconnects. Remove it here to revoke that future access too."}
                    </p>
                  </div>
                </div>
                <Toggle
                  size="sm"
                  isSelected={enabled}
                  onChange={(value) => toggle(connector.id, value)}
                  isDisabled={!enabled && !accountAvailable}
                  aria-label={`${enabled ? "Remove" : "Allow"} ${connector.serviceName} for ${project.name}`}
                />
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-quaternary">
        New projects start with no connector access. Agent-level choices can narrow this list further but can never expand beyond it.
      </p>
    </div>
  );
}
