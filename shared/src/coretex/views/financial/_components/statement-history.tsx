// @ts-nocheck




import { Card, EmptyRow, TableCard } from "./financial-ui";
import { TrendChart, type TrendPoint } from "./trend-chart";
import { useConfirm } from "./confirm-modal";
import { FormModal } from "./form-modal";
import { BadgeColors } from "@/components/base/badges/badge-types";
import { Badge } from "@/components/base/badges/badges";
import { FileCheck02, RefreshCw01, Eye, Download01, Trash02 } from "@untitledui/icons";
import { formatDate } from "../../personal/personal-ui";
import { useState } from "react";
import { Button } from "react-aria-components";
import { toast } from "sonner";
import { formatCurrency } from "../../personal/personal-ui";

export interface DetailStatement {
    id: string;
    fileName: string;
    previewUrl: string;
    downloadUrl: string;
    periodStart: string | null;
    periodEnd: string | null;
    endingBalance: number | null;
    transactionCount: number;
    processingStatus: string;
    processingError: string | null;
}

const statusColor: Record<string, BadgeColors> = { PENDING: "gray", PROCESSING: "warning", DONE: "success", FAILED: "error" };

/**
 * Statement list + balance-over-time chart for an account/card/brokerage detail
 * page. Shows normalized statement names, status/duplicate badges, and a reprocess
 * action. The chart plots statement ending balances over periodEnd, plus the
 * current derived balance as the latest point.
 */
export function StatementHistory({
    entityLabel,
    statements,
    currentBalance,
    aiConfigured,
}: {
    entityLabel: string;
    statements: DetailStatement[];
    currentBalance: number | null;
    aiConfigured: boolean;
}) {
    const [busyId, setBusyId] = useState<string | null>(null);
    const [preview, setPreview] = useState<DetailStatement | null>(null);
    const { confirm, dialog } = useConfirm();

    // Balance history: points from statements with an ending balance + periodEnd, sorted ascending.
    const points = statements
        .filter((s) => s.endingBalance != null && s.periodEnd)
        .map((s) => ({ t: new Date(s.periodEnd as string).getTime(), value: s.endingBalance as number, periodEnd: s.periodEnd as string }))
        .sort((a, b) => a.t - b.t);

    const chartData: TrendPoint[] = points.map((p) => ({
        label: formatMonthYear(p.periodEnd),
        balance: p.value,
    }));
    if (currentBalance != null) chartData.push({ label: "Now", balance: currentBalance });

    async function onReprocess(id: string) {
        if (!aiConfigured) {
            toast.error("Add ANTHROPIC_API_KEY to enable AI extraction.");
            return;
        }
        setBusyId(id);
        try {
            const res = await reprocessStatement(formData({ id }));
            if (res.duplicate) toast.warning(res.error ?? "Duplicate statement");
            else if (res.status === "DONE") toast.success(`Extracted ${res.inserted} transactions${res.skipped ? `, skipped ${res.skipped}` : ""}`);
            else toast.error(res.error ?? "Extraction failed");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Extraction failed");
        } finally {
            setBusyId(null);
        }
    }
    function onDelete(id: string) {
        confirm({
            title: "Delete this statement and its extracted transactions?",
            destructive: true,
            confirmLabel: "Delete",
            onConfirm: async () => {
                try {
                    await deleteStatement(formData({ id }));
                    toast.success("Deleted");
                } catch {
                    toast.error("Failed");
                }
            },
        });
    }

    return (
        <div className="flex flex-col gap-4">
            {chartData.length > 1 && (
                <Card className="flex flex-col gap-3">
                    <h3 className="text-sm font-semibold text-primary">Balance over time</h3>
                    <TrendChart data={chartData} series={[{ key: "balance", name: "Ending balance" }]} type="area" fitDomain height={220} />
                </Card>
            )}

            <TableCard minWidth={720}>
                <thead>
                    <tr className="border-b border-secondary text-left text-tertiary">
                        <th className="px-5 py-3 font-medium">Statement</th>
                        <th className="px-5 py-3 font-medium">Period</th>
                        <th className="px-5 py-3 text-right font-medium">Ending balance</th>
                        <th className="px-5 py-3 font-medium">Transactions</th>
                        <th className="px-5 py-3 font-medium">Status</th>
                        <th className="px-5 py-3" />
                    </tr>
                </thead>
                <tbody>
                    {statements.length === 0 && (
                        <EmptyRow
                            colSpan={6}
                            icon={FileCheck02}
                            title="No statements yet"
                            description="Upload a PDF statement above to extract transactions and chart your balance over time automatically."
                        />
                    )}
                    {statements.map((s) => {
                        const isDup = s.processingStatus === "FAILED" && (s.processingError ?? "").startsWith("Duplicate");
                        const displayName = normalizedStatementName(entityLabel, s.periodEnd);
                        return (
                            <tr key={s.id} className="border-b border-secondary last:border-0">
                                <td className="px-5 py-3">
                                    <p className="font-medium text-primary">{displayName}</p>
                                    <p className="text-xs text-tertiary">{s.fileName}</p>
                                </td>
                                <td className="px-5 py-3 text-tertiary">{s.periodStart || s.periodEnd ? `${formatDate(s.periodStart)} – ${formatDate(s.periodEnd)}` : "—"}</td>
                                <td className="px-5 py-3 text-right text-secondary">{s.endingBalance != null ? formatCurrency(s.endingBalance) : "—"}</td>
                                <td className="px-5 py-3 text-tertiary">{s.transactionCount > 0 ? s.transactionCount : "—"}</td>
                                <td className="px-5 py-3">
                                    {isDup ? (
                                        <Badge size="sm" color="warning">
                                            Duplicate
                                        </Badge>
                                    ) : (
                                        <Badge size="sm" color={statusColor[s.processingStatus] ?? "gray"}>
                                            {s.processingStatus}
                                        </Badge>
                                    )}
                                    {s.processingStatus === "FAILED" && !isDup && s.processingError && (
                                        <p className="mt-1 max-w-[200px] truncate text-xs text-error-primary" title={s.processingError}>
                                            {s.processingError}
                                        </p>
                                    )}
                                </td>
                                <td className="px-5 py-3">
                                    <div className="flex justify-end gap-1">
                                        <Button
                                            size="sm"
                                            color="tertiary"
                                            iconLeading={RefreshCw01}
                                            onClick={() => onReprocess(s.id)}
                                            isLoading={busyId === s.id}
                                            aria-label="Process with AI"
                                        />
                                        <Button size="sm" color="tertiary" iconLeading={Eye} onClick={() => setPreview(s)} aria-label="Preview statement" />
                                        <Button size="sm" color="tertiary" iconLeading={Download01} href={s.downloadUrl} aria-label="Download" />
                                        <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} onClick={() => onDelete(s.id)} aria-label="Delete" />
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </TableCard>

            <FormModal
                isOpen={!!preview}
                onOpenChange={(open) => {
                    if (!open) setPreview(null);
                }}
                title={preview ? normalizedStatementName(entityLabel, preview.periodEnd) : "Statement preview"}
                description={preview?.fileName}
                className="max-w-5xl"
                bodyClassName="p-0"
            >
                {preview && (
                    <iframe
                        title={preview.fileName}
                        src={preview.previewUrl}
                        className="h-[70vh] w-full bg-secondary"
                    />
                )}
            </FormModal>

            {dialog}
        </div>
    );
}

function formData(obj: Record<string, string>): FormData {
    const fd = new FormData();
    for (const [k, v] of Object.entries(obj)) fd.set(k, v);
    return fd;
}
