"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bank, CreditCard02, LinkExternal01, RefreshCcw01, XCircle } from "@untitledui/icons";
import { Dialog as AriaDialog, Heading as AriaHeading } from "react-aria-components";
import { toast } from "sonner";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Card, CardBody, CardHeader } from "@/components/jobs/card";
import { Modal, ModalOverlay } from "@/components/application/modals/modal";
import { formatDateTime } from "@/lib/dates";
import {
    disconnectPlaidItem,
    linkPlaidAccountToOwner,
    syncAllPlaidItems,
    syncPlaidItem,
    type PlaidLinkOption,
    type PlaidItemView,
} from "@/lib/actions/financial-plaid";
import { formatCurrency } from "@/lib/financial/format";
import type { IntegrationStatus } from "@/lib/integrations/status";
import { IntegrationStatusBadges, IntegrationStatusChip } from "@/components/settings/integration-status-badges";
import { SettingsEnvCode, SettingsEnvVarList, SettingsNotice } from "@/components/settings/settings-notice";
import { PlaidLinkButton } from "./plaid-link-button";

interface Props {
    status: IntegrationStatus;
    items: PlaidItemView[];
    plaidLinkToken?: string | null;
    plaidLinkError?: string | null;
    plaidLinkOptions: PlaidLinkOption[];
}

export function PlaidIntegrationCard({ status, items, plaidLinkToken, plaidLinkError, plaidLinkOptions }: Props) {
    const configured = status.env === "configured";
    const erroredItems = items.filter((item) => item.status === "error");
    const router = useRouter();
    const [syncing, setSyncing] = useState(false);
    const [itemSyncing, setItemSyncing] = useState<string | null>(null);
    const [disconnectId, setDisconnectId] = useState<string | null>(null);
    const [linkingId, setLinkingId] = useState<string | null>(null);
    const [pending, setPending] = useState(false);

    async function onSyncAll() {
        setSyncing(true);
        try {
            const res = await syncAllPlaidItems();
            toast.success(
                res.items === 0
                    ? "No banks connected"
                    : `Synced ${res.items} connection${res.items === 1 ? "" : "s"} - ${res.added} new, ${res.linked} linked, ${res.updated} updated`,
            );
            router.refresh();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Sync failed");
        } finally {
            setSyncing(false);
        }
    }

    async function onSyncItem(id: string) {
        setItemSyncing(id);
        try {
            const res = await syncPlaidItem(id);
            toast.success(`${res.added} new transactions, ${res.linked} linked, ${res.accounts} account balances, ${res.liabilityCards} card liability updates`);
            router.refresh();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Sync failed");
        } finally {
            setItemSyncing(null);
        }
    }

    async function onDisconnect() {
        if (!disconnectId) return;
        setPending(true);
        try {
            await disconnectPlaidItem(disconnectId);
            toast.success("Bank disconnected");
            setDisconnectId(null);
            router.refresh();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not disconnect");
        } finally {
            setPending(false);
        }
    }

    async function onRelink(plaidAccountId: string, owner: string) {
        setLinkingId(plaidAccountId);
        try {
            await linkPlaidAccountToOwner(plaidAccountId, owner);
            toast.success(owner ? "Plaid account linked" : "Plaid account unlinked");
            router.refresh();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not link Plaid account");
        } finally {
            setLinkingId(null);
        }
    }

    return (
        <Card>
            <CardHeader
                title={
                    <span className="flex items-center gap-2">
                        <Bank className="size-5 text-fg-quaternary" aria-hidden="true" />
                        Plaid (banks & cards)
                    </span>
                }
                action={
                    <IntegrationStatusBadges
                        env={status.env}
                        connection={status.connection}
                        connectionCount={status.connectionCount}
                    />
                }
            />
            <CardBody className="flex flex-col gap-5">
                {!configured ? (
                    <SettingsNotice status="info" title="Plaid is not configured on the server">
                        <p>
                            Add these environment variables (use sandbox, development, or production for{" "}
                            <SettingsEnvCode tone="info">PLAID_ENV</SettingsEnvCode>):
                        </p>
                        <div className="mt-2">
                            <SettingsEnvVarList vars={status.envVars} tone="info" />
                        </div>
                    </SettingsNotice>
                ) : (
                    <>
                        <SettingsNotice status="success" title="Read-only balances, liabilities, and transactions">
                            Uses Plaid&apos;s <strong className="font-semibold text-primary">Accounts</strong> (balances),{" "}
                            <strong className="font-semibold text-primary">Liabilities</strong> (APR, limits, due dates), and{" "}
                            <strong className="font-semibold text-primary">Transactions</strong> (ledger sync with merchant + category tags).
                            It does not request Transfer, Payment Initiation, processor tokens, or any other money-movement product.
                            Data is stored locally - sync runs server-side, not from the dashboard on every load.
                        </SettingsNotice>

                        {erroredItems.length > 0 && (
                            <SettingsNotice
                                status="error"
                                title={`${erroredItems.length} bank connection${erroredItems.length === 1 ? "" : "s"} need attention`}
                            >
                                Re-link the affected {erroredItems.length === 1 ? "bank" : "banks"} below to resume automatic sync.
                            </SettingsNotice>
                        )}

                        {items.length === 0 && (
                            <SettingsNotice status="warning" title="No banks connected yet">
                                Use Plaid Link to connect accounts - they will appear under Financial {"->"} Accounts and Cards with
                                institution metadata preserved.
                            </SettingsNotice>
                        )}

                        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                            <div className="flex flex-wrap items-center gap-2">
                                <PlaidLinkButton initialLinkToken={plaidLinkToken} initialLinkError={plaidLinkError} />
                                {items.length > 0 && (
                                    <Button
                                        color="secondary"
                                        iconLeading={RefreshCcw01}
                                        onClick={() => void onSyncAll()}
                                        isLoading={syncing}
                                        showTextWhileLoading
                                    >
                                        Sync all
                                    </Button>
                                )}
                            </div>
                            <Button
                                color="link-color"
                                size="sm"
                                href="/financial/transactions"
                                iconTrailing={LinkExternal01}
                                className="self-start sm:self-center"
                            >
                                View transactions
                            </Button>
                        </div>

                        {items.length > 0 && (
                            <div className="flex flex-col gap-3">
                                {items.map((item) => (
                                    <div key={item.id} className="overflow-hidden rounded-xl bg-secondary_subtle ring-1 ring-inset ring-secondary">
                                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-tertiary px-4 py-3">
                                            <div>
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <p className="text-sm font-medium text-primary">{item.institutionName ?? "Bank connection"}</p>
                                                    {item.status === "error" && (
                                                        <IntegrationStatusChip label="Needs attention" tone="error" size="sm" />
                                                    )}
                                                </div>
                                                <p className="text-xs text-tertiary">
                                                    {item.accountCount} account{item.accountCount === 1 ? "" : "s"}
                                                    {item.lastSyncedAt ? ` · Last sync ${formatDateTime(item.lastSyncedAt)}` : " · Not synced yet"}
                                                </p>
                                            </div>
                                            <div className="flex gap-1.5">
                                                <Button
                                                    size="sm"
                                                    color="secondary"
                                                    iconLeading={RefreshCcw01}
                                                    onClick={() => void onSyncItem(item.id)}
                                                    isLoading={itemSyncing === item.id}
                                                    showTextWhileLoading
                                                >
                                                    Sync
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    color="secondary-destructive"
                                                    iconLeading={XCircle}
                                                    onClick={() => setDisconnectId(item.id)}
                                                >
                                                    Disconnect
                                                </Button>
                                            </div>
                                        </div>
                                        <ul className="divide-y divide-tertiary">
                                            {item.accounts.map((a) => {
                                                const compatibleKind = a.type === "credit" ? "card" : "account";
                                                const compatibleOptions = plaidLinkOptions.filter((o) => o.kind === compatibleKind);
                                                return (
                                                <li key={a.id} className="grid gap-2 px-4 py-2.5 text-sm md:grid-cols-[minmax(0,1fr)_minmax(220px,300px)] md:items-center">
                                                    <div className="flex min-w-0 items-center gap-2">
                                                    {a.type === "credit" ? (
                                                        <CreditCard02 className="size-4 shrink-0 text-fg-quaternary" aria-hidden="true" />
                                                    ) : (
                                                        <Bank className="size-4 shrink-0 text-fg-quaternary" aria-hidden="true" />
                                                    )}
                                                    <span className="min-w-0 flex-1 truncate text-primary">
                                                        {a.name}
                                                        {a.mask ? ` ·••${a.mask}` : ""}
                                                    </span>
                                                    <span className="hidden shrink-0 text-xs text-tertiary lg:inline">
                                                        {a.balanceCurrent != null ? formatCurrency(Math.abs(a.balanceCurrent)) : "No balance"}
                                                    </span>
                                                    {a.linkedLabel && (
                                                        <Badge color="gray" size="sm" type="pill-color">
                                                            {a.linkedLabel}
                                                        </Badge>
                                                    )}
                                                    </div>
                                                    <select
                                                        aria-label={`Link ${a.name}`}
                                                        value={a.finAccountId ? `account:${a.finAccountId}` : a.creditCardId ? `card:${a.creditCardId}` : ""}
                                                        disabled={linkingId === a.id}
                                                        onChange={(event) => void onRelink(a.id, event.target.value)}
                                                        className="w-full rounded-lg bg-primary px-3 py-2 text-sm text-primary shadow-xs ring-1 ring-primary ring-inset outline-brand"
                                                    >
                                                        <option value="">Unlinked</option>
                                                        <optgroup label={compatibleKind === "card" ? "Cards" : "Accounts"}>
                                                            {compatibleOptions.map((o) => (
                                                                <option key={o.value} value={o.value}>
                                                                    {o.label}
                                                                </option>
                                                            ))}
                                                        </optgroup>
                                                    </select>
                                                </li>
                                                );
                                            })}
                                        </ul>
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                )}

            </CardBody>

            <ModalOverlay isOpen={!!disconnectId} onOpenChange={(o) => !o && setDisconnectId(null)}>
                <Modal className="max-w-md">
                    <AriaDialog className="rounded-xl bg-primary p-6 outline-hidden ring-1 ring-secondary">
                        <AriaHeading slot="title" className="text-lg font-semibold text-primary">
                            Disconnect this bank?
                        </AriaHeading>
                        <p className="mt-2 text-sm text-tertiary">
                            This removes the Plaid connection. Your accounts, cards, and imported transactions stay in LifeOS — only automatic sync
                            stops.
                        </p>
                        <div className="mt-5 flex justify-end gap-2">
                            <Button color="secondary" onClick={() => setDisconnectId(null)} isDisabled={pending}>
                                Cancel
                            </Button>
                            <Button color="primary-destructive" onClick={() => void onDisconnect()} isLoading={pending} showTextWhileLoading>
                                Disconnect
                            </Button>
                        </div>
                    </AriaDialog>
                </Modal>
            </ModalOverlay>
        </Card>
    );
}
