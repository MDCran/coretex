// @ts-nocheck
/**
 * Shared transaction ledger table used by the full Transactions page and the
 * Overview "Recent transactions" block — same columns, category badge picker,
 * statement chip, and row-click slideout behavior.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bank, CreditCard02, FileCheck02, LayersTwo01, Edit01, Trash02, MagicWand02 } from "@untitledui/icons";
import { Badge } from "@/components/base/badges/badges";
import { cx } from "@/utils/cx";
import { formatCurrency, formatDate } from "../../personal/personal-ui";
import { AmountBadge } from "./amount-badge";
import { CategoryBadge } from "./category-badge";
import { categoryColor, categoryIcon } from "./category-icons";
import { EmptyRow, TableCard, TableHeaderHelp } from "./financial-ui";
import { MerchantLogo } from "./merchant-logo";

export interface LedgerStatement {
    id: string;
    fileName: string;
}

export interface LedgerTxn {
    id: string;
    date: string;
    amount: number;
    merchant: string | null;
    rawDescription: string | null;
    categoryId: string | null;
    category?: string | null;
    categoryColor?: string | null;
    finAccountId?: string | null;
    creditCardId?: string | null;
    account?: string | null;
    statement?: LedgerStatement | string | null;
    statementId?: string | null;
    splits?: { categoryId: string | null; amount: number }[];
    source?: string;
}

export interface LedgerCategory {
    id: string;
    label: string;
    color?: string | null;
}

export interface LedgerOwner {
    id: string;
    kind: "account" | "card";
    nickname: string;
}

interface Props {
    transactions: LedgerTxn[];
    categories: LedgerCategory[];
    owners?: LedgerOwner[];
    /** Compact overview mode hides row action buttons. */
    compact?: boolean;
    empty?: ReactNode;
    onRowOpen: (row: LedgerTxn) => void;
    onAssignCategory: (transactionId: string, categoryId: string | null) => void;
    onViewStatement?: (statement: LedgerStatement) => void;
    onEdit?: (row: LedgerTxn) => void;
    onDelete?: (row: LedgerTxn) => void;
    onSplit?: (row: LedgerTxn) => void;
    onAiCategorize?: (row: LedgerTxn) => void;
    aiBusyId?: string | null;
}

function resolveStatement(row: LedgerTxn): LedgerStatement | null {
    if (row.statement && typeof row.statement === "object" && row.statement.id) return row.statement;
    if (row.statementId) {
        const name = typeof row.statement === "string" ? row.statement : "Statement";
        return { id: row.statementId, fileName: name };
    }
    return null;
}

/** Clickable category chip that opens a compact picker menu. */
export function CategoryBadgePicker({
    name,
    color,
    categoryId,
    categories,
    onAssign,
}: {
    name: string;
    color?: string | null;
    categoryId: string | null;
    categories: LedgerCategory[];
    onAssign: (categoryId: string | null) => void;
}) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const uncategorized = !categoryId;
    const displayName = uncategorized ? "Add category" : name;
    const displayColor = uncategorized ? null : categoryColor(name, color);

    useEffect(() => {
        if (!open) return;
        const onDoc = (event: MouseEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") setOpen(false);
        };
        document.addEventListener("mousedown", onDoc);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onDoc);
            document.removeEventListener("keydown", onKey);
        };
    }, [open]);

    return (
        <div ref={rootRef} className="relative inline-flex max-w-full" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className={cx("max-w-full rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-brand", uncategorized && "opacity-90")}
                title={uncategorized ? "Add a budget category" : "Change category"}
                aria-haspopup="listbox"
                aria-expanded={open}
            >
                <CategoryBadge name={displayName} color={displayColor} />
            </button>
            {open && (
                <div
                    role="listbox"
                    className="absolute top-full left-0 z-[80] mt-1 max-h-64 w-56 overflow-y-auto rounded-xl py-1 shadow-xl ring-1 ring-secondary"
                    style={{ background: "var(--surface, var(--color-bg-primary))" }}
                >
                    <button
                        type="button"
                        role="option"
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-tertiary hover:bg-primary_hover"
                        onClick={() => {
                            onAssign(null);
                            setOpen(false);
                        }}
                    >
                        Uncategorized
                    </button>
                    {categories.map((c) => {
                        const Icon = categoryIcon(c.label);
                        const hex = categoryColor(c.label, c.color);
                        return (
                            <button
                                key={c.id}
                                type="button"
                                role="option"
                                aria-selected={c.id === categoryId}
                                className={cx(
                                    "flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-primary_hover",
                                    c.id === categoryId && "bg-active font-medium",
                                )}
                                onClick={() => {
                                    onAssign(c.id);
                                    setOpen(false);
                                }}
                            >
                                <span
                                    className="inline-flex size-5 shrink-0 items-center justify-center rounded-md"
                                    style={{ backgroundColor: `${hex ?? "#6B7280"}22`, color: hex ?? "#6B7280" }}
                                >
                                    <Icon className="size-3.5" aria-hidden="true" />
                                </span>
                                <span className="truncate text-primary">{c.label}</span>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export function TransactionLedgerTable({
    transactions,
    categories,
    owners = [],
    compact = false,
    empty,
    onRowOpen,
    onAssignCategory,
    onViewStatement,
    onEdit,
    onDelete,
    onSplit,
    onAiCategorize,
    aiBusyId = null,
}: Props) {
    const ownerById = new Map(owners.map((o) => [o.id, o]));
    const categoryById = new Map(categories.map((c) => [c.id, c]));
    const colCount = compact ? 5 : 6;

    return (
        <TableCard minWidth={compact ? 720 : 980} tableClassName="table-fixed">
            <colgroup>
                <col className="w-[8rem]" />
                <col className={compact ? "w-[18rem]" : "w-[16rem]"} />
                <col className="w-[11rem]" />
                <col className="w-[12rem]" />
                <col className="w-[7rem]" />
                {!compact && <col className="w-[10rem]" />}
            </colgroup>
            <thead>
                <tr className="border-b border-secondary text-left text-tertiary">
                    <th className="px-4 py-3 font-medium">
                        <TableHeaderHelp label="Date" help="The transaction date from the bank, card, statement, CSV, Plaid, or manual entry." />
                    </th>
                    <th className="px-4 py-3 font-medium">
                        <TableHeaderHelp label="Merchant" help="Clean merchant name with the original bank/card descriptor underneath when it differs. Statement chip opens the source PDF." />
                    </th>
                    <th className="px-4 py-3 font-medium">
                        <TableHeaderHelp label="Account" help="The linked bank account or card." />
                    </th>
                    <th className="px-4 py-3 font-medium">
                        <TableHeaderHelp label="Category" help="Click the colored badge to set or change the budget category." />
                    </th>
                    <th className="px-4 py-3 text-right font-medium">
                        <TableHeaderHelp label="Amount" help="Negative amounts are charges or withdrawals. Positive amounts are deposits, credits, or payments." align="right" />
                    </th>
                    {!compact && <th className="px-4 py-3" />}
                </tr>
            </thead>
            <tbody>
                {transactions.length === 0 &&
                    (empty ?? <EmptyRow colSpan={colCount} label="No transactions yet." />)}
                {transactions.map((t) => {
                    const catOpt = t.categoryId ? categoryById.get(t.categoryId) : null;
                    const catName = catOpt?.label ?? t.category ?? "Uncategorized";
                    const catColor = categoryColor(catName, catOpt?.color ?? t.categoryColor);
                    const owner = ownerById.get(t.finAccountId ?? t.creditCardId ?? "") ?? null;
                    const accountLabel = owner?.nickname ?? t.account ?? null;
                    const merchantLabel = t.merchant || t.rawDescription || "Unknown merchant";
                    const statement = resolveStatement(t);
                    return (
                        <tr
                            key={t.id}
                            className="cursor-pointer border-b border-secondary last:border-0 transition-colors hover:bg-primary_hover/60"
                            onClick={() => onRowOpen(t)}
                        >
                            <td className="px-4 py-3 text-tertiary">{formatDate(t.date)}</td>
                            <td className="px-4 py-3 text-primary">
                                <div className="flex min-w-0 items-center gap-2.5">
                                    <MerchantLogo merchant={merchantLabel} />
                                    <div className="min-w-0">
                                        <span className="block truncate font-medium">{merchantLabel}</span>
                                        {t.merchant && t.rawDescription && t.rawDescription !== t.merchant && (
                                            <span className="block truncate text-xs text-tertiary">{t.rawDescription}</span>
                                        )}
                                    </div>
                                    {statement && onViewStatement && (
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onViewStatement(statement);
                                            }}
                                            title="View linked statement"
                                            className="shrink-0"
                                        >
                                            <Badge size="sm" type="modern" color="gray" className="gap-1">
                                                <FileCheck02 className="size-3" aria-hidden="true" /> Statement
                                            </Badge>
                                        </button>
                                    )}
                                </div>
                            </td>
                            <td className="px-4 py-3 text-tertiary">
                                {accountLabel ? (
                                    <span className="inline-flex max-w-full items-center gap-1.5">
                                        {(owner?.kind ?? (t.creditCardId ? "card" : "account")) === "card" ? (
                                            <CreditCard02 className="size-3.5 text-fg-quaternary" aria-hidden="true" />
                                        ) : (
                                            <Bank className="size-3.5 text-fg-quaternary" aria-hidden="true" />
                                        )}
                                        <span className="truncate">{accountLabel}</span>
                                    </span>
                                ) : (
                                    "—"
                                )}
                            </td>
                            <td className="px-4 py-3">
                                <CategoryBadgePicker
                                    name={catName}
                                    color={catColor}
                                    categoryId={t.categoryId}
                                    categories={categories}
                                    onAssign={(id) => onAssignCategory(t.id, id)}
                                />
                            </td>
                            <td className="px-4 py-3 text-right">
                                <AmountBadge amount={t.amount} />
                            </td>
                            {!compact && (
                                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                                    <div className="flex justify-end gap-1">
                                        {onAiCategorize && (
                                            <button
                                                type="button"
                                                className="rounded-lg p-1.5 text-fg-quaternary hover:bg-primary_hover hover:text-secondary disabled:opacity-50"
                                                onClick={() => onAiCategorize(t)}
                                                disabled={aiBusyId !== null && aiBusyId !== t.id}
                                                title="Suggest category with AI"
                                                aria-label="Categorize with AI"
                                            >
                                                <MagicWand02 className={cx("size-4", aiBusyId === t.id && "animate-pulse")} />
                                            </button>
                                        )}
                                        {onSplit && (
                                            <button
                                                type="button"
                                                className={cx(
                                                    "rounded-lg p-1.5 hover:bg-primary_hover",
                                                    (t.splits?.length ?? 0) > 0 ? "text-brand-secondary" : "text-fg-quaternary hover:text-secondary",
                                                )}
                                                onClick={() => onSplit(t)}
                                                title={(t.splits?.length ?? 0) > 0 ? `Edit split (${t.splits!.length})` : "Split"}
                                                aria-label="Split"
                                            >
                                                <LayersTwo01 className="size-4" />
                                            </button>
                                        )}
                                        {onEdit && (
                                            <button
                                                type="button"
                                                className="rounded-lg p-1.5 text-fg-quaternary hover:bg-primary_hover hover:text-secondary"
                                                onClick={() => onEdit(t)}
                                                aria-label="Edit"
                                            >
                                                <Edit01 className="size-4" />
                                            </button>
                                        )}
                                        {onDelete && (
                                            <button
                                                type="button"
                                                className="rounded-lg p-1.5 text-fg-quaternary hover:bg-error-primary hover:text-error-primary"
                                                onClick={() => onDelete(t)}
                                                aria-label="Delete"
                                            >
                                                <Trash02 className="size-4" />
                                            </button>
                                        )}
                                    </div>
                                </td>
                            )}
                        </tr>
                    );
                })}
            </tbody>
        </TableCard>
    );
}

// silence unused import if formatCurrency ends up unused in some builds
void formatCurrency;
