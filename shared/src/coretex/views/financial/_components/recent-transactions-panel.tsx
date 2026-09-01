// @ts-nocheck
/**
 * Overview "Recent transactions" — same ledger table + slideout as the
 * Transactions page (compact actions).
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { FileCheck02 } from "@untitledui/icons";
import { SlideoutMenu } from "@/components/application/slideout-menus/slideout-menu";
import { FormModal } from "./form-modal";
import { CategoryBadge } from "./category-badge";
import { categoryColor } from "./category-icons";
import { MerchantLogo } from "./merchant-logo";
import { TransactionLedgerTable, type LedgerTxn } from "./transaction-ledger-table";
import { formatCurrency, formatDate } from "../../personal/personal-ui";
import { useLifeOSMutation } from "../../personal/use-lifeos-mutation";
import type { LifeOSClient } from "../../personal/use-lifeos-query";

interface Props {
    client: LifeOSClient;
    transactions: LedgerTxn[];
    categories: { id: string; label: string; color?: string | null }[];
    accounts?: { id: string; kind: "account" | "card"; nickname: string }[];
    cards?: { id: string; kind: "account" | "card"; nickname: string }[];
    onViewAll?: () => void;
}

function DetailItem({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div className="flex items-start justify-between gap-4 py-2.5">
            <dt className="shrink-0 text-tertiary">{label}</dt>
            <dd className="max-w-[60%] text-right font-medium text-primary">{value}</dd>
        </div>
    );
}

export function RecentTransactionsPanel({ client, transactions, categories, accounts = [], cards = [], onViewAll }: Props) {
    const assignMutation = useLifeOSMutation(client, "financial:setTransactionCategory");
    const getFileMutation = useLifeOSMutation(client, "financial:getFinancialFile");
    const [detailRow, setDetailRow] = useState<LedgerTxn | null>(null);
    const [stmtPreview, setStmtPreview] = useState<{ id: string; fileName: string } | null>(null);
    const [stmtFileUrl, setStmtFileUrl] = useState<string | null>(null);

    const owners = useMemo(() => [...accounts, ...cards], [accounts, cards]);
    const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

    async function onAssign(id: string, categoryId: string | null) {
        try {
            await assignMutation.mutate({ id, categoryId });
        } catch {
            toast.error("Failed to set category");
        }
    }

    async function openStatementPreview(statement: { id: string; fileName: string } | null) {
        if (!statement) return;
        setStmtPreview(statement);
        setStmtFileUrl(null);
        try {
            const file = await getFileMutation.mutate<{ fileName: string; mimeType: string; base64: string }>({ id: statement.id });
            setStmtFileUrl(`data:${file.mimeType || "application/octet-stream"};base64,${file.base64}`);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't open that statement.");
        }
    }

    const catName = (row: LedgerTxn) => {
        if (row.categoryId && categoryById.get(row.categoryId)) return categoryById.get(row.categoryId)!.label;
        return row.category || "Uncategorized";
    };

    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
                <h3 className="text-md font-semibold text-primary">Recent transactions</h3>
                {onViewAll && (
                    <button type="button" onClick={onViewAll} className="text-sm font-medium text-brand-secondary hover:underline">
                        View all
                    </button>
                )}
            </div>

            <TransactionLedgerTable
                compact
                transactions={transactions}
                categories={categories}
                owners={owners}
                onRowOpen={(row) => setDetailRow(row)}
                onAssignCategory={onAssign}
                onViewStatement={(s) => void openStatementPreview(s)}
            />

            <SlideoutMenu isOpen={!!detailRow} onOpenChange={(o) => !o && setDetailRow(null)} isDismissable dialogClassName="gap-0">
                <SlideoutMenu.Header onClose={() => setDetailRow(null)} className="flex w-full flex-col gap-1 pb-4">
                    <h2 className="pr-10 text-lg font-semibold text-primary">Transaction details</h2>
                    {detailRow && (
                        <p className="truncate text-sm text-tertiary">
                            {detailRow.merchant || detailRow.rawDescription || "Transaction"} · {formatDate(detailRow.date)}
                        </p>
                    )}
                </SlideoutMenu.Header>
                <SlideoutMenu.Content className="py-4">
                    {detailRow && (
                        <dl className="flex w-full flex-col divide-y divide-secondary text-sm">
                            <DetailItem label="Date" value={formatDate(detailRow.date)} />
                            <DetailItem
                                label="Merchant"
                                value={
                                    <span className="inline-flex max-w-full items-center justify-end gap-2">
                                        <MerchantLogo merchant={detailRow.merchant || detailRow.rawDescription || "Unknown"} size="xs" />
                                        <span className="truncate">{detailRow.merchant || "—"}</span>
                                    </span>
                                }
                            />
                            <DetailItem label="Raw description" value={detailRow.rawDescription || "—"} />
                            <DetailItem
                                label="Amount"
                                value={
                                    <span className={detailRow.amount < 0 ? "text-primary" : "text-success-primary"}>
                                        {formatCurrency(detailRow.amount)}
                                    </span>
                                }
                            />
                            <DetailItem
                                label="Category"
                                value={
                                    <CategoryBadge
                                        name={catName(detailRow)}
                                        color={categoryColor(catName(detailRow), detailRow.categoryColor ?? categoryById.get(detailRow.categoryId ?? "")?.color)}
                                    />
                                }
                            />
                            <DetailItem label="Account / Card" value={detailRow.account || "—"} />
                            <DetailItem
                                label="Statement"
                                value={
                                    detailRow.statement && typeof detailRow.statement === "object" ? (
                                        <button
                                            type="button"
                                            className="inline-flex items-center gap-1 text-brand-secondary hover:underline"
                                            onClick={() => void openStatementPreview(detailRow.statement as { id: string; fileName: string })}
                                        >
                                            <FileCheck02 className="size-3.5" /> View statement
                                        </button>
                                    ) : (
                                        "—"
                                    )
                                }
                            />
                        </dl>
                    )}
                </SlideoutMenu.Content>
            </SlideoutMenu>

            <FormModal
                isOpen={!!stmtPreview}
                onOpenChange={(o) => {
                    if (!o) {
                        setStmtPreview(null);
                        setStmtFileUrl(null);
                    }
                }}
                title="Statement preview"
            >
                {stmtPreview && (
                    <div className="flex h-[55vh] items-center justify-center overflow-hidden rounded-lg ring-1 ring-secondary ring-inset">
                        {stmtFileUrl ? (
                            <iframe src={stmtFileUrl} title={stmtPreview.fileName} className="size-full" />
                        ) : (
                            <p className="text-sm text-tertiary">Loading…</p>
                        )}
                    </div>
                )}
            </FormModal>
        </div>
    );
}
