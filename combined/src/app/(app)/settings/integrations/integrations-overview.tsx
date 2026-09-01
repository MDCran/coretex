"use client";

import { Card, CardBody, CardHeader } from "@/components/jobs/card";
import type { IntegrationStatus } from "@/lib/integrations/status";
import { IntegrationStatusBadges, IntegrationStatusChip, type ChipTone } from "@/components/settings/integration-status-badges";

interface Props {
    statuses: IntegrationStatus[];
}

function summaryLabel(status: IntegrationStatus): string {
    if (!status.requiresAccount) {
        return status.env === "configured" ? "Ready" : "Unavailable";
    }
    if (status.env === "not_configured") return "Unavailable";
    if (status.connection === "error") return "Needs attention";
    if (status.env === "not_required" && status.connection !== "connected") return "Not connected";
    if (status.env === "not_required" && status.connection === "connected") {
        return status.connectionDetail ?? "Connected";
    }
    if (status.connection === "connected") {
        return status.connectionDetail ?? "Connected";
    }
    return "Not connected";
}

function summaryColor(status: IntegrationStatus): ChipTone {
    if (!status.requiresAccount) return status.env === "configured" ? "success" : "warning";
    if (status.env === "not_configured" || status.connection === "unavailable") return "gray";
    if (status.connection === "error") return "error";
    return status.connection === "connected" ? "success" : "warning";
}

export function IntegrationsOverview({ statuses }: Props) {
    const readyCount = statuses.filter((s) => {
        if (!s.requiresAccount) return s.env === "configured";
        if (s.env === "not_configured") return false;
        return s.connection === "connected";
    }).length;

    return (
        <Card>
            <CardHeader
                title="Integration status"
                action={
                    <IntegrationStatusChip label={`${readyCount}/${statuses.length} active`} tone="gray" size="md" />
                }
            />
            <CardBody className="p-0">
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[36rem] text-sm">
                        <thead>
                            <tr className="border-b border-tertiary bg-secondary_subtle text-left text-xs font-medium text-tertiary">
                                <th className="px-5 py-3 font-medium">Service</th>
                                <th className="px-5 py-3 font-medium">Server (env)</th>
                                <th className="px-5 py-3 font-medium">Account</th>
                                <th className="px-5 py-3 font-medium">Summary</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-tertiary">
                            {statuses.map((status) => (
                                <tr key={status.id}>
                                    <td className="px-5 py-3 font-medium text-primary">{status.name}</td>
                                    <td className="px-5 py-3">
                                        <IntegrationStatusBadges env={status.env} showConnection={false} className="justify-start" />
                                    </td>
                                    <td className="px-5 py-3">
                                        {status.requiresAccount ? (
                                            <IntegrationStatusBadges
                                                connection={status.connection}
                                                connectionCount={status.connectionCount}
                                                showEnv={false}
                                                className="justify-start"
                                            />
                                        ) : (
                                            <span className="text-tertiary">—</span>
                                        )}
                                    </td>
                                    <td className="px-5 py-3">
                                        <IntegrationStatusChip label={summaryLabel(status)} tone={summaryColor(status)} size="sm" />
                                        {status.connectionDetail && status.connection === "connected" && status.requiresAccount && (
                                            <p className="mt-0.5 text-xs text-tertiary">{status.connectionDetail}</p>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </CardBody>
        </Card>
    );
}
