// @ts-nocheck
"use client";

// Coretex Relay — Remote & connectors. SSH hosts and Claude Code–style service
// connectors (MCP tools) that are available in this build.
// AI chat models live in Settings → AI providers and are not listed here.
import { useState } from "react";
import type { CoretexConfig, ServiceConnection } from "@repo/coretex/types";
import { Cube01, Globe01, Link01, Lock01, Phone01, Plus, QrCode01, Server01, Trash01, Wifi } from "@untitledui/icons";
import { useConfirm } from "@/components/application/confirm-dialog/confirm-dialog";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { RichSelect } from "@/components/base/select/rich-select";
import { type ServiceDef, connectorGroups, presetMcpBindings } from "../../keyvault/catalog";
import { ConnectConnectorModal } from "../../keyvault/connect-connector-modal";
import { applyVaultConnect, applyVaultDisconnect, applyVaultVerify } from "../../keyvault/vault-connect";
import type { NavTarget } from "../../nav";
import { BrandLogo } from "../../ui/brand-logo";
import type { CoretexActions, CoretexState } from "../../use-coretex";
import { SettingsSection } from "../controls";
import { SettingsPageHeader, SettingsStatusBadge } from "../settings-shell";

const NESTED_SURFACE = {
    background: "var(--surface-2)",
    border: "1px solid var(--c-border)",
} as const;

type SshHost = CoretexConfig["remote"]["sshHosts"][number];

const AUTH_OPTIONS: { label: string; value: SshHost["auth"] }[] = [
    { label: "Key", value: "key" },
    { label: "Agent", value: "agent" },
    { label: "Password", value: "password" },
];

const PROTOCOL_OPTIONS: {
    label: string;
    value: NonNullable<SshHost["protocol"]>;
}[] = [
    { label: "SFTP", value: "sftp" },
    { label: "SSH", value: "ssh" },
    { label: "FTP", value: "ftp" },
];

function uniqueId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const RemotePage = ({
    settings,
    state,
    actions,
    onNavigate,
}: {
    settings: CoretexConfig;
    state: CoretexState;
    actions: CoretexActions;
    onNavigate?: (t: NavTarget) => void;
}) => {
    const remote = settings.remote;
    const sshHosts = remote.sshHosts ?? [];
    const vaultIntegrations = state.keyvault?.integrations ?? [];
    const mcpEnabledCount = (settings.mcpServers ?? []).filter((s) => s.enabled).length;
    const builtInCount = (settings.mcpBuiltIns ?? []).filter((s) => s.enabled).length;
    const [connecting, setConnecting] = useState<{ service: ServiceDef; existing?: ServiceConnection } | null>(null);
    const destructiveAction = useConfirm();
    const catalogGroups = connectorGroups();

    const writeHosts = (hosts: SshHost[]): void => {
        actions.updateSettings({ remote: { ...remote, sshHosts: hosts } });
    };

    const addHost = (): void => {
        const host: SshHost = {
            id: uniqueId("ssh"),
            label: "New host",
            protocol: "sftp",
            host: "",
            port: 22,
            user: "",
            auth: "key",
        };
        writeHosts([...sshHosts, host]);
    };
    const patchHost = (id: string, patch: Partial<SshHost>): void => {
        writeHosts(sshHosts.map((h) => (h.id === id ? { ...h, ...patch } : h)));
    };
    const removeHost = (id: string): void => {
        writeHosts(sshHosts.filter((h) => h.id !== id));
    };

    const disconnectConnector = (entry: ServiceConnection): void => {
        applyVaultDisconnect({ entry, actions });
    };

    const connectedConnectors = vaultIntegrations.filter(
        (i: ServiceConnection) => i.status !== "disconnected" && i.status !== "error" && i.category !== "ai",
    ).length;

    return (
        <div className="flex flex-col gap-6">
            {destructiveAction.dialog}
            <SettingsPageHeader
                icon={Globe01}
                title="Remote & connectors"
                subtitle="SSH hosts and authenticated service connectors available to agents."
                badges={connectedConnectors > 0 ? <SettingsStatusBadge label={`${connectedConnectors} connectors`} color="success" /> : undefined}
            />

            <SettingsSection title="Related settings" description="AI model connections and MCP tool servers are configured in their dedicated pages.">
                <div className="grid gap-3 py-1 sm:grid-cols-2">
                    <button
                        type="button"
                        onClick={() => onNavigate?.({ kind: "settings", page: "ai-providers" })}
                        className="flex items-start gap-3 rounded-xl p-4 text-left transition hover:bg-[var(--surface-2)]"
                        style={NESTED_SURFACE}
                        disabled={!onNavigate}
                    >
                        <BrandLogo domain="anthropic.com" name="AI" size={28} />
                        <div className="min-w-0">
                            <p className="text-sm font-semibold text-primary">AI providers</p>
                            <p className="mt-0.5 text-xs text-tertiary">
                                Ollama, Claude, OpenAI, Gemini, OpenRouter — models for agents and chat live here, not as connectors.
                            </p>
                        </div>
                    </button>
                    <button
                        type="button"
                        onClick={() => onNavigate?.({ kind: "settings", page: "mcp-servers" })}
                        className="flex items-start gap-3 rounded-xl p-4 text-left transition hover:bg-[var(--surface-2)]"
                        style={NESTED_SURFACE}
                        disabled={!onNavigate}
                    >
                        <Cube01 className="size-7 shrink-0 text-secondary" />
                        <div className="min-w-0">
                            <p className="text-sm font-semibold text-primary">MCP servers</p>
                            <p className="mt-0.5 text-xs text-tertiary">
                                {mcpEnabledCount} custom · {builtInCount} built-ins enabled — wire configured tools into agent workflows.
                            </p>
                        </div>
                    </button>
                </div>
            </SettingsSection>

            <SettingsSection title="SSH connections" description="Saved hosts for one-click remote terminals.">
                <div className="flex flex-col gap-3 py-1">
                    {sshHosts.length === 0 ? (
                        <div
                            className="flex flex-col items-center justify-center gap-1 rounded-xl px-4 py-8 text-center"
                            style={{ border: "1px dashed var(--c-border)" }}
                        >
                            <Server01 className="size-5 text-quaternary" />
                            <p className="text-sm font-medium text-secondary">No SSH hosts yet</p>
                            <p className="text-xs text-tertiary">Add a host to save its connection details.</p>
                        </div>
                    ) : (
                        sshHosts.map((h) => (
                            <div key={h.id} className="rounded-xl p-4" style={NESTED_SURFACE}>
                                <div className="flex items-center justify-between gap-3">
                                    <div className="flex min-w-0 items-center gap-2">
                                        <Server01 className="size-4 shrink-0 text-quaternary" />
                                        <p className="min-w-0 break-words text-sm font-semibold text-primary" title={h.label || "Untitled host"}>
                                            {h.label || "Untitled host"}
                                        </p>
                                    </div>
                                    <Button
                                        size="sm"
                                        color="link-destructive"
                                        iconLeading={Trash01}
                                        onClick={() =>
                                            destructiveAction.confirm({
                                                title: `Delete ${h.label || "SSH host"}?`,
                                                description: "This removes the saved connection details from Coretex. It does not change the remote server.",
                                                confirmLabel: "Delete host",
                                                onConfirm: () => removeHost(h.id),
                                            })
                                        }
                                    >
                                        Delete
                                    </Button>
                                </div>

                                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    <label className="flex flex-col gap-1">
                                        <span className="text-xs font-medium text-secondary">Label</span>
                                        <Input aria-label="Remote host label" value={h.label} placeholder="Production box" onChange={(v: string) => patchHost(h.id, { label: v })} />
                                    </label>
                                    <label className="flex flex-col gap-1">
                                        <span className="text-xs font-medium text-secondary">Protocol</span>
                                        <RichSelect
                                            aria-label="Remote connection protocol"
                                            options={PROTOCOL_OPTIONS}
                                            value={h.protocol ?? "sftp"}
                                            onChange={(e) => {
                                                const v = e.target.value as NonNullable<SshHost["protocol"]>;
                                                patchHost(h.id, {
                                                    protocol: v,
                                                    port: v === "ftp" ? 21 : 22,
                                                });
                                            }}
                                        />
                                    </label>
                                    <label className="flex flex-col gap-1">
                                        <span className="text-xs font-medium text-secondary">Host</span>
                                        <Input aria-label="Remote host address" value={h.host} placeholder="example.com or 10.0.0.5" onChange={(v: string) => patchHost(h.id, { host: v })} />
                                    </label>
                                    <label className="flex flex-col gap-1">
                                        <span className="text-xs font-medium text-secondary">Port</span>
                                        <Input
                                            aria-label="Remote host port"
                                            type="number"
                                            value={String(h.port)}
                                            placeholder="22"
                                            onChange={(v: string) => {
                                                const n = Number(v);
                                                if (v === "" || Number.isNaN(n)) {
                                                    patchHost(h.id, { port: 0 });
                                                    return;
                                                }
                                                patchHost(h.id, {
                                                    port: Math.max(0, Math.min(65535, Math.trunc(n))),
                                                });
                                            }}
                                        />
                                    </label>
                                    <label className="flex flex-col gap-1">
                                        <span className="text-xs font-medium text-secondary">User</span>
                                        <Input aria-label="Remote host user" value={h.user} placeholder="root" onChange={(v: string) => patchHost(h.id, { user: v })} />
                                    </label>
                                    <label className="flex flex-col gap-1 sm:col-span-2">
                                        <span className="text-xs font-medium text-secondary">Authentication</span>
                                        <RichSelect
                                            aria-label="Remote host authentication"
                                            options={AUTH_OPTIONS}
                                            value={h.auth}
                                            onChange={(e) =>
                                                patchHost(h.id, {
                                                    auth: e.target.value as SshHost["auth"],
                                                })
                                            }
                                        />
                                    </label>
                                </div>
                            </div>
                        ))
                    )}

                    <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                        <Button size="sm" color="secondary" iconLeading={Plus} onClick={addHost}>
                            Add host
                        </Button>
                        <p className="text-xs text-quaternary">Drives Quick SSH connect to this host.</p>
                    </div>
                </div>
            </SettingsSection>

            <SettingsSection
                title="Service connectors"
                description="Same catalog as Keyvault → Integrations. Connect with a real API key (or token); credentials stay in the vault and MCP servers register automatically when supported."
            >
                <div className="flex flex-col gap-5 py-1">
                    {catalogGroups.map((group) => (
                        <div key={group.category}>
                            <p className="mb-2 text-xs font-semibold tracking-wide text-quaternary uppercase">{group.category}</p>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                {group.items.map((svc) => {
                                    const accounts = vaultIntegrations.filter((i: ServiceConnection) => i.serviceId === svc.id);
                                    const liveAccounts = accounts.filter((entry) => entry.status === "connected" || entry.status === "partial").length;
                                    const defaultToolCount = svc.mcpRuntime ? presetMcpBindings(svc.id).length : 0;
                                    return (
                                        <div
                                            key={svc.id}
                                            className="flex flex-col gap-3 rounded-xl p-3.5"
                                            style={NESTED_SURFACE}
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="flex min-w-0 items-center gap-3">
                                                    <BrandLogo domain={svc.domain} name={svc.name} size={32} />
                                                    <div className="min-w-0">
                                                        <div className="flex flex-wrap items-center gap-1.5">
                                                            <p className="break-words text-sm font-semibold text-primary" title={svc.name}>{svc.name}</p>
                                                            {accounts.length > 0 && (
                                                                <Badge size="sm" color={liveAccounts > 0 ? "success" : "gray"} type="pill-color">
                                                                    {accounts.length} account{accounts.length === 1 ? "" : "s"}
                                                                </Badge>
                                                            )}
                                                        </div>
                                                        <p className="break-words text-xs text-tertiary">
                                                            {svc.caps ?? svc.domain}
                                                            {svc.mcpRuntime ? <span className="text-quaternary"> · {defaultToolCount} agent tools per account</span> : <span className="text-quaternary"> · protected credential environment</span>}
                                                        </p>
                                                    </div>
                                                </div>
                                                <Button
                                                    size="sm"
                                                    color={accounts.length > 0 ? "secondary" : "primary"}
                                                    iconLeading={Link01}
                                                    onClick={() => setConnecting({ service: svc })}
                                                >
                                                    {accounts.length > 0 ? "Add account" : "Connect"}
                                                </Button>
                                            </div>

                                            {accounts.length > 0 && (
                                                <div className="flex flex-col gap-1.5 border-t border-secondary pt-2.5">
                                                    {accounts.map((entry) => {
                                                        const connected = entry.status === "connected" || entry.status === "partial";
                                                        const needsCredentials = entry.status === "error" || entry.status === "disconnected";
                                                        const canRetryVerification = needsCredentials && Boolean(entry.credentialIds?.length);
                                                        const statusLabel = entry.status === "connecting" ? "Connecting" : entry.verification === "verified" ? "Verified" : entry.status === "partial" ? "Partial" : entry.status === "error" ? "Error" : entry.status === "disconnected" ? "Disconnected" : "Unverified";
                                                        const statusColor = entry.status === "error" ? "error" : entry.status === "partial" ? "warning" : connected ? "success" : entry.status === "connecting" ? "brand" : "gray";
                                                        return (
                                                            <div key={entry.id} className="flex flex-col gap-2 rounded-lg px-2.5 py-2 sm:flex-row sm:items-center" style={{ background: "var(--surface)" }}>
                                                                <div className="min-w-0 flex-1">
                                                                    <p className="break-all text-xs font-medium text-secondary" title={entry.connectedAs || `${svc.name} account`}>
                                                                        {entry.connectedAs || `${svc.name} account`}
                                                                    </p>
                                                                    <p className="break-words text-[11px] text-quaternary">
                                                                        {svc.mcpRuntime
                                                                            ? `${entry.mcpTools?.filter((tool) => tool.permission !== "disabled").length ?? defaultToolCount} configured tools`
                                                                            : `${entry.credentialIds?.length ?? 0} protected credentials`}
                                                                    </p>
                                                                </div>
                                                                <div className="flex flex-wrap items-center justify-end gap-1.5">
                                                                    <Badge size="sm" color={statusColor} type="pill-color">{statusLabel}</Badge>
                                                                    {canRetryVerification && (
                                                                        <Button size="sm" color="secondary" onClick={() => applyVaultVerify({ entry, actions })}>Retry verification</Button>
                                                                    )}
                                                                    {needsCredentials && (
                                                                        <Button size="sm" color="secondary" onClick={() => setConnecting({ service: svc, existing: entry })}>Replace credentials</Button>
                                                                    )}
                                                                    {onNavigate && (
                                                                        <Button size="sm" color="secondary" onClick={() => onNavigate({ kind: "keyvault" })}>Manage</Button>
                                                                    )}
                                                                    {connected && (
                                                                        <Button
                                                                            size="sm"
                                                                            color="tertiary-destructive"
                                                                            onClick={() => destructiveAction.confirm({
                                                                                title: `Disconnect ${entry.connectedAs || entry.serviceName}?`,
                                                                                description: "This removes this account from agents, clears only its linked credentials, and unregisters only its account-scoped MCP server.",
                                                                                confirmLabel: "Disconnect account",
                                                                                onConfirm: () => disconnectConnector(entry),
                                                                            })}
                                                                        >
                                                                            Disconnect
                                                                        </Button>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                    <p className="text-xs text-quaternary">
                        Connected connectors appear when you create or edit an agent under Abilities &amp; connectors. Keys live in Keyvault; stdio MCP entries
                        appear under MCP servers as <code className="font-mono">vault-*</code>.
                    </p>
                </div>
            </SettingsSection>

            {connecting && (
                <ConnectConnectorModal
                    service={connecting.service}
                    existingIntegration={connecting.existing}
                    operation={state.connectorOperation}
                    onClose={() => setConnecting(null)}
                    onConnect={(integration, credentials) =>
                        applyVaultConnect({
                            service: connecting.service,
                            integration,
                            credentials,
                            actions,
                        })
                    }
                />
            )}
        </div>
    );
};

// ---- Mobile companion roadmap ----

const MobileCompanionSection = () => (
    <SettingsSection title="Mobile companion" description="A planned companion app for remote approvals, notifications, and agent controls.">
        <div
            className="relative isolate overflow-hidden rounded-xl p-5 sm:p-6"
            style={{
                background:
                    "radial-gradient(circle at 90% 0%, color-mix(in srgb, var(--c-warning, #f59e0b) 10%, transparent), transparent 36%), var(--surface-2)",
                border: "1px solid var(--c-border)",
            }}
            role="note"
        >
            <div className="flex flex-col items-start gap-4 sm:flex-row">
                <span
                    className="grid size-11 shrink-0 place-items-center rounded-xl"
                    style={{
                        background: "color-mix(in srgb, var(--c-warning, #f59e0b) 12%, var(--surface))",
                        border: "1px solid color-mix(in srgb, var(--c-warning, #f59e0b) 28%, var(--c-border))",
                    }}
                >
                    <Lock01 className="size-5 text-warning-primary" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge size="sm" color="warning" type="pill-color">
                            Coming soon
                        </Badge>
                        <span className="text-xs font-medium text-quaternary">No release date announced</span>
                    </div>
                    <h3 className="mt-3 text-lg font-semibold text-primary">Mobile pairing is not available in this build</h3>
                    <p className="mt-1.5 max-w-2xl text-sm leading-6 text-tertiary">
                        There is no companion app relay, live pairing flow, or mobile session runtime yet. Pairing stays locked until the app, encrypted
                        transport, and device revocation are ready together.
                    </p>

                    <div className="mt-5 grid gap-3 sm:grid-cols-3">
                        {[
                            { icon: Phone01, title: "Companion apps", body: "Native iOS and Android clients." },
                            { icon: QrCode01, title: "Secure pairing", body: "Expiring invites and device revocation." },
                            { icon: Wifi, title: "Live controls", body: "Approvals, alerts, and agent actions." },
                        ].map((item) => {
                            const Icon = item.icon;
                            return (
                                <div key={item.title} className="rounded-lg p-3" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}>
                                    <Icon className="size-4 text-quaternary" aria-hidden="true" />
                                    <p className="mt-2 text-sm font-medium text-primary">{item.title}</p>
                                    <p className="mt-0.5 text-xs leading-5 text-tertiary">{item.body}</p>
                                    <Badge className="mt-2" size="sm" color="gray" type="pill-color">
                                        Planned
                                    </Badge>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    </SettingsSection>
);

const CoretexAsMcp = () => (
    <SettingsSection title="Coretex as MCP server" description="A planned way to expose selected Coretex capabilities to external AI tools through MCP.">
        <div className="flex flex-col items-start gap-3 rounded-xl p-4 sm:flex-row sm:items-center" style={NESTED_SURFACE} role="note">
            <span
                className="grid size-10 shrink-0 place-items-center rounded-lg"
                style={{
                    background: "color-mix(in srgb, var(--c-warning, #f59e0b) 12%, var(--surface))",
                    border: "1px solid color-mix(in srgb, var(--c-warning, #f59e0b) 28%, var(--c-border))",
                }}
            >
                <Lock01 className="size-4 text-warning-primary" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-primary">External MCP access is not available yet</p>
                    <Badge size="sm" color="warning" type="pill-color">
                        Coming soon
                    </Badge>
                </div>
                <p className="mt-1 text-xs leading-5 text-tertiary">
                    The local relay, authentication tokens, and permission controls will ship together. No endpoint or setup steps are available in this build.
                </p>
            </div>
        </div>
    </SettingsSection>
);
