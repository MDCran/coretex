// @ts-nocheck
"use client";

// Coretex Relay — Project-scoped Agents workspace tab.
// Agents live in a single shared pool, so this tab reuses the global AgentsPanel
// for the live roster and adds a compact create card on top that tags any new
// agent with this project's id (so it shows up associated with the project).

import { useState } from "react";
import { Plus } from "@untitledui/icons";
import type { AgentRole, ModelInfo, Project } from "@repo/coretex/types";
import { Button } from "@/components/base/buttons/button";
import { Badge } from "@/components/base/badges/badges";
import { Input } from "@/components/base/input/input";
import { TextArea } from "@/components/base/textarea/textarea";
import { liveModels, modelAvailability, roleColor, type CoretexActions, type CoretexState } from "../use-coretex";
import { roleLabel } from "../labels";
import { ModelPicker } from "../ui/model-picker";
import { pillSelectClass } from "../ui/pill-select";
import { AgentsPanel } from "../panels/agents-panel";
import { ProjectActiveAgents } from "./project-active-agents";
import { AgentAccessPanel, type AgentAccessSelection } from "../ui/agent-access-panel";

const ROLES: AgentRole[] = ["orchestrator", "planner", "researcher", "developer", "reviewer", "writer", "analyst", "qa", "devops"];

export const AgentsTab = ({
    project,
    state,
    actions,
}: {
    project: Project;
    state: CoretexState;
    actions: CoretexActions;
}) => {
    const [name, setName] = useState<string>("");
    const [role, setRole] = useState<AgentRole>("developer");
    const [chosen, setChosen] = useState<ModelInfo | null>(null);
    const [prompt, setPrompt] = useState<string>("");
    const [terminalAccess, setTerminalAccess] = useState(true);
    const [connectorIds, setConnectorIds] = useState<string[]>([]);
    const [mcpServerIds, setMcpServerIds] = useState<string[]>([]);

    const models: ModelInfo[] = liveModels(state);
    const availability = modelAvailability(state, chosen?.provider, chosen?.id);
    const canSubmit = name.trim().length > 0 && chosen !== null && availability.available;

    const handleCreate = (): void => {
        if (!canSubmit || chosen === null) return;
        actions.createAgent({
            name: name.trim(),
            role: role as AgentRole,
            provider: chosen.provider,
            model: chosen.id,
            systemPrompt: prompt.trim() || undefined,
            tags: [project.id],
            terminalAccess,
            connectorIds: connectorIds.length > 0 ? connectorIds : undefined,
            mcpServerIds: mcpServerIds.length > 0 ? mcpServerIds : undefined,
        });
        setName("");
        setPrompt("");
    };

    const accessSelection: AgentAccessSelection = { connectorIds, mcpServerIds, terminalAccess };
    const setAccess = (next: AgentAccessSelection): void => {
        setConnectorIds(next.connectorIds);
        setMcpServerIds(next.mcpServerIds);
        setTerminalAccess(next.terminalAccess);
    };

    return (
        <section className="flex flex-col gap-4">
            {/* Live per-project active/idle agents + scoped controls */}
            <ProjectActiveAgents project={project} state={state} actions={actions} />

            {/* Project-scoped create card */}
            <div
                className="flex flex-col gap-3 rounded-xl p-4"
                style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}
            >
                <h2 className="text-sm font-semibold text-primary">New agent for this project</h2>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <div className="flex-1">
                        <Input
                            label="Name"
                            placeholder="Agent name"
                            value={name}
                            onChange={setName}
                        />
                    </div>

                    <Button
                        size="md"
                        color="primary"
                        iconLeading={Plus}
                        isDisabled={!canSubmit}
                        onClick={handleCreate}
                    >
                        Create agent
                    </Button>
                </div>

                {/* Role chooser — colored pills (uniform with role tags elsewhere) */}
                <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-tertiary">Role</span>
                    <div className="flex flex-wrap gap-2">
                        {ROLES.map((r: AgentRole) => {
                            const on = role === r;
                            return (
                                <button key={r} type="button" onClick={() => setRole(r)} className={pillSelectClass(on)}>
                                    <Badge size="md" color={roleColor(r, state.settings)} type="color">{roleLabel(r)}</Badge>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Model picker — provider-grouped with brand logos */}
                <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-tertiary">Model</span>
                    <ModelPicker
                        models={models}
                        value={chosen ? { provider: chosen.provider, id: chosen.id } : null}
                        onChange={(p, id) => setChosen(models.find((m) => m.provider === p && m.id === id) ?? null)}
                        capability="chat"
                        placeholder="Select a model"
                        isDisabled={!state.connected || models.length === 0}
                        unavailableReason={availability.reason}
                    />
                    {!availability.available && <p role="alert" className="text-xs text-warning-primary">{availability.reason}</p>}
                </div>

                {state.settings && (
                    <AgentAccessPanel
                        settings={state.settings}
                        state={state}
                        model={chosen}
                        provider={chosen?.provider}
                        selection={accessSelection}
                        onChange={setAccess}
                        allowedConnectorIds={project.connectorIds ?? []}
                        density="compact"
                    />
                )}

                {/* System prompt / skill — editable right here */}
                <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-tertiary">System prompt / skill (optional)</span>
                    <TextArea value={prompt} onChange={setPrompt} rows={4} placeholder="What is this agent's job + how should it work?" />
                </div>

                <p className="text-xs text-tertiary">
                    Agents run in the shared pool and are tagged with this project. Their connector access can narrow this project's allowlist but cannot expand it.
                </p>
            </div>

            {/* Live shared roster */}
            <AgentsPanel state={state} actions={actions} />
        </section>
    );
};
