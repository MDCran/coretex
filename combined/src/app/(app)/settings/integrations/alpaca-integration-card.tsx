"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, LineChartUp03, LinkExternal01 } from "@untitledui/icons";
import { toast } from "sonner";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Card, CardBody, CardHeader } from "@/components/jobs/card";
import { Toggle } from "@/components/base/toggle/toggle";
import {
    connectAlpacaFromEnv,
    setAlpacaActiveMode,
    testAlpacaConnection,
    type AlpacaConnectionView,
} from "@/lib/actions/financial-alpaca";
import type { AlpacaEnvStatus } from "@/lib/financial/alpaca-config";
import type { IntegrationStatus } from "@/lib/integrations/status";
import { IntegrationStatusBadges } from "@/components/settings/integration-status-badges";
import { SettingsEnvCode, SettingsEnvVarList, SettingsNotice } from "@/components/settings/settings-notice";
import { formatCurrency } from "@/lib/financial/format";

interface Props {
    status: IntegrationStatus;
    connection: AlpacaConnectionView | null;
    envStatus: AlpacaEnvStatus;
    autoConnectError?: string | null;
}

export function AlpacaIntegrationCard({ status, connection, envStatus, autoConnectError }: Props) {
    const router = useRouter();
    const [connecting, setConnecting] = useState(false);
    const [switching, setSwitching] = useState(false);
    const [testing, setTesting] = useState(false);

    const envConfigured = status.env === "configured";
    const connected = Boolean(connection);
    const activePaper = connection?.activePaper ?? true;

    async function onConnect() {
        setConnecting(true);
        try {
            const res = await connectAlpacaFromEnv();
            toast.success(
                `Alpaca ${res.paper ? "paper" : "live"} connected — equity ${formatCurrency(res.equity)}`,
            );
            router.refresh();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not connect to Alpaca");
        } finally {
            setConnecting(false);
        }
    }

    async function onModeSwitch(paper: boolean) {
        if (!connection || paper === activePaper) return;
        setSwitching(true);
        try {
            const res = await setAlpacaActiveMode(paper);
            toast.success(
                `Switched to ${res.paper ? "paper trading" : "live"} — equity ${formatCurrency(res.equity)}`,
            );
            router.refresh();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not switch mode");
        } finally {
            setSwitching(false);
        }
    }

    async function onTest() {
        setTesting(true);
        try {
            const res = await testAlpacaConnection();
            toast.success(`Connection OK — equity ${formatCurrency(res.equity)} (${res.paper ? "paper" : "live"})`);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Test failed");
        } finally {
            setTesting(false);
        }
    }

    return (
        <Card>
            <CardHeader
                title={
                    <span className="flex items-center gap-2">
                        <LineChartUp03 className="size-5 text-fg-quaternary" aria-hidden="true" />
                        Alpaca
                    </span>
                }
                action={<IntegrationStatusBadges env={status.env} connection={status.connection} />}
            />
            <CardBody className="flex flex-col gap-5">
                {envStatus.paperKeyOnly || envStatus.liveKeyOnly ? (
                    <SettingsNotice status="warning" title="Alpaca API key found — secret missing">
                        <p>
                            {envStatus.paperKeyOnly && (
                                <>
                                    Add <SettingsEnvCode tone="warning">ALPACA_PAPER_API_SECRET</SettingsEnvCode> to{" "}
                                    <SettingsEnvCode tone="warning">.env</SettingsEnvCode> (paper key is already set).{" "}
                                </>
                            )}
                            {envStatus.liveKeyOnly && (
                                <>
                                    Add <SettingsEnvCode tone="warning">ALPACA_LIVE_API_SECRET</SettingsEnvCode> to{" "}
                                    <SettingsEnvCode tone="warning">.env</SettingsEnvCode> (live key is already set).{" "}
                                </>
                            )}
                            Restart the dev server after saving, then refresh this page.
                        </p>
                    </SettingsNotice>
                ) : !envConfigured ? (
                    <SettingsNotice status="info" title="Alpaca keys go in .env">
                        <p>Add credentials on the server — paper and live are separate. Only set the mode you use.</p>
                        <div className="mt-2">
                            <SettingsEnvVarList
                                vars={["ALPACA_PAPER_API_KEY", "ALPACA_PAPER_API_SECRET", "ALPACA_LIVE_API_KEY", "ALPACA_LIVE_API_SECRET"]}
                                tone="info"
                            />
                        </div>
                        <p className="mt-2 text-tertiary">
                            Paper uses <span className="font-mono text-xs">https://paper-api.alpaca.markets</span>. Generic{" "}
                            <span className="font-mono text-xs">APCA_API_KEY_ID</span> /{" "}
                            <span className="font-mono text-xs">APCA_API_SECRET_KEY</span> also work (paper unless{" "}
                            <span className="font-mono text-xs">APCA_API_BASE_URL</span> points at live).
                        </p>
                    </SettingsNotice>
                ) : connected && connection ? (
                    <>
                        <div className="flex flex-col gap-3 rounded-xl bg-secondary_subtle p-4 ring-1 ring-inset ring-secondary">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <p className="text-sm font-medium text-primary">Trading environment</p>
                                    <p className="text-xs text-tertiary">
                                        {connection.hasPaper && connection.hasLive
                                            ? "Switch between paper and live — keys come from .env."
                                            : connection.hasPaper
                                              ? "Using paper trading keys from .env."
                                              : "Using live account keys from .env."}
                                    </p>
                                </div>
                                {connection.hasPaper && connection.hasLive && (
                                    <Toggle
                                        label={activePaper ? "Paper trading" : "Live account"}
                                        hint={activePaper ? "Using paper-api.alpaca.markets" : "Using api.alpaca.markets"}
                                        isSelected={activePaper}
                                        onChange={(paper) => void onModeSwitch(paper)}
                                        isDisabled={switching}
                                    />
                                )}
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {connection.hasPaper && (
                                    <Badge color={activePaper ? "brand" : "gray"} type="pill-color" size="sm">
                                        Paper {connection.paperApiKeyMasked ? `· ${connection.paperApiKeyMasked}` : ""}
                                    </Badge>
                                )}
                                {connection.hasLive && (
                                    <Badge color={!activePaper ? "brand" : "gray"} type="pill-color" size="sm">
                                        Live {connection.liveApiKeyMasked ? `· ${connection.liveApiKeyMasked}` : ""}
                                    </Badge>
                                )}
                            </div>
                        </div>

                        <SettingsNotice
                            status="success"
                            title={`Connected — ${activePaper ? "paper trading" : "live account"}`}
                        >
                            Read-only portfolio on the Brokerage page and net worth.
                        </SettingsNotice>

                        <div className="flex flex-wrap items-center gap-2">
                            <Button
                                color="secondary"
                                iconLeading={CheckCircle}
                                onClick={() => void onTest()}
                                isLoading={testing}
                                showTextWhileLoading
                            >
                                Test connection
                            </Button>
                            <Button color="link-color" href="/financial/brokerage" iconTrailing={LinkExternal01}>
                                Open Brokerage
                            </Button>
                        </div>
                    </>
                ) : (
                    <>
                        {autoConnectError ? (
                            <SettingsNotice status="error" title="Alpaca rejected the keys in .env">
                                <p>{autoConnectError}</p>
                                <p className="mt-1 text-tertiary">
                                    Double-check <SettingsEnvCode tone="error">ALPACA_PAPER_API_KEY</SettingsEnvCode> and{" "}
                                    <SettingsEnvCode tone="error">ALPACA_PAPER_API_SECRET</SettingsEnvCode>, then restart the server.
                                </p>
                            </SettingsNotice>
                        ) : (
                            <SettingsNotice status="warning" title="Connect Alpaca from .env">
                                <p>
                                    Keys are in <span className="font-mono text-xs">.env</span> — click connect to verify with
                                    Alpaca{envStatus.paperReady && !envStatus.liveReady ? " (paper)" : ""}
                                    {envStatus.liveReady && !envStatus.paperReady ? " (live)" : ""}.
                                </p>
                            </SettingsNotice>
                        )}

                        <Button onClick={() => void onConnect()} isLoading={connecting} showTextWhileLoading>
                            Connect Alpaca
                        </Button>
                    </>
                )}
            </CardBody>
        </Card>
    );
}
