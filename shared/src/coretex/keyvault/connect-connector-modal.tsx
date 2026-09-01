// @ts-nocheck
"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle, Key01, LinkExternal01, Server01, X } from "@untitledui/icons";
import { Heading } from "react-aria-components";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import type { ConnectorCredentialInput, ConnectorOperationResult, ServiceConnection } from "@repo/coretex/types";
import { BrandLogo } from "../ui/brand-logo";
import { CATEGORY_LABELS, credentialFields, type ServiceDef } from "./catalog";
import { buildConnectorCredentials, buildVaultIntegration } from "./register-vault-mcp";

type ConnectResult = ConnectorOperationResult | null | undefined;

/** Shared, accessible connector flow for Keyvault and Settings. OAuth providers
 * use a manual provider-issued token until a real PKCE callback is implemented. */
export function ConnectConnectorModal({
    service,
    existingIntegration,
    operation,
    onClose,
    onConnect,
}: {
    service: ServiceDef;
    existingIntegration?: ServiceConnection | null;
    operation?: ConnectResult;
    onClose: () => void;
    onConnect: (integration: ServiceConnection, credentials: ConnectorCredentialInput[]) => string | null;
}) {
    const fields = useMemo(() => credentialFields(service), [service]);
    const [values, setValues] = useState<Record<string, string>>({});
    const [account, setAccount] = useState(existingIntegration?.connectedAs ?? "");
    const [requestId, setRequestId] = useState<string | null>(null);
    const [submittedIntegration, setSubmittedIntegration] = useState<ServiceConnection | null>(null);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const matchingResult = requestId && operation?.requestId === requestId ? operation : null;
    const pending = Boolean(requestId && !matchingResult);
    const ready = fields.every((field) => (values[field.id] ?? "").trim().length > 0);

    useEffect(() => {
        if (matchingResult?.ok) onClose();
    }, [matchingResult?.ok, onClose]);

    const connect = (): void => {
        if (!ready || pending) return;
        setSubmitError(null);
        const freshIntegration = buildVaultIntegration(service, {
            accountLabel: account,
            enableMcpTools: Boolean(service.mcpRuntime),
            // A runtime may fail after credentials are atomically saved. Reuse
            // that same account id on retry so a second click cannot orphan a
            // partial connector account.
            integrationId: existingIntegration?.id ?? submittedIntegration?.id,
        });
        const integration = existingIntegration
            ? {
                ...freshIntegration,
                // Credential replacement must not reset the account's policy.
                connectedAt: existingIntegration.connectedAt,
                mcpEnabled: existingIntegration.mcpEnabled,
                agentEnabled: existingIntegration.agentEnabled ?? existingIntegration.mcpEnabled,
                mcpTools: (existingIntegration.mcpTools ?? []).map((tool) => ({ ...tool })),
                requireConfirmWrites: existingIntegration.requireConfirmWrites,
                stats: (existingIntegration.stats ?? []).map((stat) => ({ ...stat })),
            }
            : freshIntegration;
        const credentials = buildConnectorCredentials(service, values);
        const id = onConnect(integration, credentials);
        if (id) {
            setSubmittedIntegration(integration);
            setRequestId(id);
        } else {
            setSubmitError("Coretex is not connected to the local Brain. Reconnect the app, then try again.");
        }
    };

    const manualToken = service.authType === "oauth";
    const capabilityTitle = service.mcpRuntime ? "Agent-ready connector" : "Protected credential environment";
    const capabilityCopy = service.mcpRuntime
        ? "After verification, Coretex starts an account-scoped MCP server and exposes its live tools to supported Claude agents."
        : "Coretex stores each credential separately and can inject permitted values into authorized, supported agent subprocess environments. This service has no live agent-tool adapter yet.";
    const runtimePartial = Boolean(matchingResult && !matchingResult.ok && matchingResult.status === "partial");

    return (
        <ModalOverlay
            isDismissable={!pending}
            isOpen
            onOpenChange={(open) => {
                if (!open && !pending) onClose();
            }}
        >
            <Modal className="max-w-xl">
                <Dialog>
                    <div className="flex max-h-[min(88vh,760px)] w-full flex-col overflow-hidden rounded-2xl bg-primary shadow-2xl ring-1 ring-secondary ring-inset">
                        <header className="flex items-start justify-between gap-4 border-b border-secondary px-5 py-4">
                            <div className="flex min-w-0 items-center gap-3">
                                <BrandLogo domain={service.domain} name={service.name} size={40} />
                                <div className="min-w-0">
                                    <Heading slot="title" className="truncate text-md font-semibold text-primary">
                                        {existingIntegration ? "Reconnect" : "Connect"} {service.name}
                                    </Heading>
                                    <p className="text-xs text-tertiary">
                                        {manualToken ? "Manual access-token connection" : `${service.authType.replace("_", " ")} connection`} · {CATEGORY_LABELS[service.category]}
                                    </p>
                                </div>
                            </div>
                            <Button color="tertiary" size="sm" iconLeading={X} aria-label="Close connector dialog" onClick={onClose} isDisabled={pending} />
                        </header>

                        <div className="min-h-0 flex-1 overflow-y-auto p-5">
                            <div className="flex flex-col gap-4">
                                {manualToken && (
                                    <div className="flex gap-2.5 rounded-xl border border-warning-secondary bg-warning-primary p-3 text-xs text-warning-primary">
                                        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                                        <div>
                                            <p className="font-semibold">Manual token flow</p>
                                            <p className="mt-0.5 leading-5 text-tertiary">
                                                Coretex does not open a provider login or claim OAuth authorization in this build. Create an access token in {service.name}, paste it below, and revoke it from the provider at any time.
                                            </p>
                                        </div>
                                    </div>
                                )}

                                <label className="flex flex-col gap-1.5">
                                    <span className="text-xs font-medium text-secondary">Account or workspace label <span className="font-normal text-quaternary">· optional</span></span>
                                    <Input aria-label={`${service.name} account or workspace label`} value={account} onChange={setAccount} placeholder="Personal, Acme production, workspace…" isDisabled={pending} />
                                </label>

                                <div className="grid gap-3 sm:grid-cols-2">
                                    {fields.map((field) => (
                                        <label key={field.id} className={fields.length === 1 ? "flex flex-col gap-1.5 sm:col-span-2" : "flex flex-col gap-1.5"}>
                                            <span className="flex items-center justify-between gap-2 text-xs font-medium text-secondary">
                                                <span>{field.label}</span>
                                                <code className="truncate font-mono text-[10px] font-normal text-quaternary">{field.envVar}</code>
                                            </span>
                                            <Input
                                                aria-label={`${service.name} ${field.label}`}
                                                type={field.secret === false ? "text" : "password"}
                                                value={values[field.id] ?? ""}
                                                onChange={(value) => setValues((current) => ({ ...current, [field.id]: value }))}
                                                placeholder={field.placeholder}
                                                inputClassName="font-mono"
                                                isDisabled={pending}
                                                isRequired
                                            />
                                        </label>
                                    ))}
                                </div>

                                <div className="flex items-start gap-3 rounded-xl border border-secondary bg-secondary p-3.5">
                                    {service.mcpRuntime ? <Server01 className="mt-0.5 size-5 shrink-0 text-brand-secondary" /> : <Key01 className="mt-0.5 size-5 shrink-0 text-secondary" />}
                                    <div className="min-w-0">
                                        <p className="text-sm font-semibold text-primary">{capabilityTitle}</p>
                                        <p className="mt-0.5 text-xs leading-5 text-tertiary">{capabilityCopy}</p>
                                        {service.mcpRuntime && <p className="mt-1 font-mono text-[11px] text-quaternary">{service.mcpRuntime.package} · {service.mcpRuntime.envVar}</p>}
                                    </div>
                                </div>

                                {matchingResult && !matchingResult.ok && (
                                    <div role="alert" className={`flex gap-2 rounded-xl p-3 text-xs ${runtimePartial ? "border border-warning-secondary bg-warning-primary text-warning-primary" : "border border-error-secondary bg-error-primary text-error-primary"}`}>
                                        <AlertCircle className="size-4 shrink-0" />
                                        <span>
                                            {runtimePartial && <strong className="mb-0.5 block">Credentials saved; agent runtime needs attention</strong>}
                                            {matchingResult.message || (runtimePartial
                                                ? `${service.name} is stored as a partial connection, but its MCP runtime did not become ready. Retry this same account after checking the token and local runtime.`
                                                : `Coretex could not connect ${service.name}. Check the credential and try again.`)}
                                        </span>
                                    </div>
                                )}
                                {matchingResult?.ok && (
                                    <div role="status" className="flex gap-2 rounded-xl border border-success-secondary bg-success-primary p-3 text-xs text-success-primary">
                                        <CheckCircle className="size-4 shrink-0" /> Connected {submittedIntegration?.connectedAs || service.name}.
                                    </div>
                                )}
                                {submitError && (
                                    <div role="alert" className="flex gap-2 rounded-xl border border-error-secondary bg-error-primary p-3 text-xs text-error-primary">
                                        <AlertCircle className="size-4 shrink-0" />
                                        <span>{submitError}</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        <footer className="flex items-center justify-between gap-3 border-t border-secondary px-5 py-4">
                            <p className="max-w-xs text-[11px] leading-4 text-quaternary">Credentials are protected locally and are never added to prompts.</p>
                            <div className="flex shrink-0 gap-2">
                                <Button color="secondary" onClick={onClose} isDisabled={pending}>Cancel</Button>
                                <Button color="primary" iconLeading={LinkExternal01} onClick={connect} isDisabled={!ready || pending} isLoading={pending}>
                                    {matchingResult && !matchingResult.ok ? "Try again" : manualToken ? "Connect token" : existingIntegration ? "Reconnect" : "Connect"}
                                </Button>
                            </div>
                        </footer>
                    </div>
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
}
