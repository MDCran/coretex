// @ts-nocheck
"use client";

// Coretex — project Secrets tab. Same look as the global Env vars + API keys
// surfaces, but locked to this project so agents working here can see (and use)
// project-scoped credentials and environments.

import { useEffect, useRef, useState } from "react";
import type { Project } from "@repo/coretex/types";
import { Key01, Link01, Lock01, Shield01 } from "@untitledui/icons";
import type { CoretexActions, CoretexState } from "../use-coretex";
import { EnvView } from "../env/env-view";
import { KeyVaultView } from "../keyvault/keyvault-view";
import { SecretsPageLayout, SecretsTabs } from "../secrets/secrets-page";
import { ProjectConnectorsPanel } from "./project-connectors-panel";
import type { NavTarget } from "../nav";

type Pane = "env" | "keys" | "connectors";

export const ProjectSecretsTab = ({
  project,
  state,
  actions,
  onNavigate,
}: {
  project: Project;
  state: CoretexState;
  actions: CoretexActions;
  onNavigate?: (target: NavTarget) => void;
}) => {
  const [pane, setPane] = useState<Pane>("env");
  const pendingEnvironmentSeeds = useRef(new Set<string>());

  useEffect(() => {
    actions.envGet();
    actions.keyvaultGet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  // Ensure every project has at least one (local) environment to edit in Secrets.
  useEffect(() => {
    if (!state.env) return;

    const envs = (state.env?.environments ?? []).filter(
      (e) => e.projectId === project.id,
    );

    if (envs.length > 0) {
      pendingEnvironmentSeeds.current.delete(project.id);
      return;
    }

    // React Strict Mode runs mount effects twice in development. Keep the
    // request idempotent while the first upsert is still making its round trip,
    // and use a stable id as a second line of defence on the store side.
    if (!pendingEnvironmentSeeds.current.has(project.id)) {
      pendingEnvironmentSeeds.current.add(project.id);
      actions.envUpsertEnvironment({
        id: `env_${project.id}_local`,
        projectId: project.id,
        name: "local",
        kind: "local",
        color: "#3b82f6",
        isDefault: true,
        variables: [],
        updatedAt: Date.now(),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, state.env?.environments]);

  const envCount = (state.env?.environments ?? [])
    .filter((e) => e.projectId === project.id)
    .reduce((n, e) => n + e.variables.length, 0);
  const keyCount = (state.keyvault?.keys ?? []).filter(
    (k) => k.projectId === project.id,
  ).length;
  const connectorCount = project.connectorIds?.length ?? 0;

  return (
    <SecretsPageLayout
      icon={Shield01}
      title="Project secrets"
      description={
        <>
          Environment variables and API keys scoped to{" "}
          <span className="font-medium text-secondary">{project.name}</span>.
          Agents can use permitted values at runtime, while secret values stay
          in the local credential store and out of prompts.
        </>
      }
      badge="Stored locally"
      stats={[
        { label: "Environment variables", value: envCount, color: "#3b82f6" },
        { label: "API keys", value: keyCount, color: "var(--brand)" },
        { label: "Connectors", value: connectorCount, color: "#14b8a6" },
      ]}
      compact
      navigation={
        <SecretsTabs
          items={[
            { id: "env", label: "Environment variables", icon: Lock01, count: envCount },
            { id: "keys", label: "API keys", icon: Key01, count: keyCount },
            { id: "connectors", label: "Connectors", icon: Link01, count: connectorCount },
          ]}
          value={pane}
          onChange={(id) => setPane(id as Pane)}
          ariaLabel={`${project.name} secret types`}
        />
      }
    >
      <div className="h-full min-h-0 overflow-auto">
        {pane === "env" ? (
          <EnvView
            state={state}
            actions={actions}
            lockedProjectId={project.id}
            embedded
          />
        ) : pane === "keys" ? (
          <KeyVaultView
            state={state}
            actions={actions}
            lockedProjectId={project.id}
            embedded
          />
        ) : (
          <ProjectConnectorsPanel project={project} state={state} actions={actions} onNavigate={onNavigate} />
        )}
      </div>
    </SecretsPageLayout>
  );
};
