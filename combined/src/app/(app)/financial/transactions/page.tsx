import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { aiConfigured } from "@/lib/ai/claude";
import { fileUrl } from "@/lib/files";
import { GENERIC_TOTAL_CATEGORY } from "@/lib/financial/category-data";
import { formatDate } from "@/lib/dates";
import { TransactionsClient, type OwnerOpt, type StatementInfo, type TxnRow } from "./transactions-client";

/** Last-4 / short mask for an account or card number. */
function mask(value: string | null | undefined): string | null {
    if (!value) return null;
    const digits = value.replace(/\s/g, "");
    if (digits.length <= 4) return `•• ${digits}`;
    return `•••• ${digits.slice(-4)}`;
}

/** First 1–2 letters for an institution monogram fallback. */
function monogram(name: string | null | undefined): string {
    if (!name) return "?";
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}

export default async function TransactionsPage() {
    const user = await requireUser();
    const [transactions, accounts, cards, categories] = await Promise.all([
        db.finTransaction.findMany({
            where: { userId: user.id },
            orderBy: { date: "desc" },
            take: 1000,
            include: {
                statement: { select: { id: true, fileName: true, fileKey: true, periodStart: true, periodEnd: true } },
                splits: { select: { categoryId: true, amount: true } },
                finAccount: {
                    select: {
                        plaidAccount: {
                            select: {
                                id: true,
                                plaidAccountId: true,
                                name: true,
                                officialName: true,
                                mask: true,
                                type: true,
                                subtype: true,
                                lastBalanceSyncAt: true,
                                plaidItem: { select: { institutionName: true, lastSyncedAt: true } },
                            },
                        },
                    },
                },
                creditCard: {
                    select: {
                        plaidAccount: {
                            select: {
                                id: true,
                                plaidAccountId: true,
                                name: true,
                                officialName: true,
                                mask: true,
                                type: true,
                                subtype: true,
                                lastBalanceSyncAt: true,
                                plaidItem: { select: { institutionName: true, lastSyncedAt: true } },
                            },
                        },
                    },
                },
            },
        }),
        db.finAccount.findMany({
            where: { userId: user.id, archived: false },
            orderBy: { createdAt: "desc" },
            include: { institutionRef: { select: { name: true } } },
        }),
        db.creditCard.findMany({
            where: { userId: user.id, archived: false },
            orderBy: { createdAt: "desc" },
            include: { institutionRef: { select: { name: true } } },
        }),
        db.budgetCategory.findMany({ where: { userId: user.id, NOT: { name: GENERIC_TOTAL_CATEGORY } }, orderBy: { name: "asc" } }),
    ]);

    const accountOpts: OwnerOpt[] = accounts.map((a) => {
        const institution = a.institutionRef?.name ?? a.institution ?? null;
        return {
            id: a.id,
            kind: "account",
            nickname: a.nickname || institution || "Account",
            institution,
            monogram: monogram(institution || a.nickname),
            masked: a.last4 ? `•••• ${a.last4}` : mask(null),
            typeLabel: a.kind,
        };
    });

    const cardOpts: OwnerOpt[] = cards.map((c) => {
        const institution = c.institutionRef?.name ?? c.issuer ?? null;
        return {
            id: c.id,
            kind: "card",
            nickname: c.nickname || c.productName || institution || "Card",
            institution,
            monogram: monogram(institution || c.nickname || c.productName),
            masked: c.last4 ? `•••• ${c.last4}` : mask(null),
            typeLabel: c.cardType,
        };
    });

    const rows: TxnRow[] = transactions.map((t) => {
        const plaidAccount = t.finAccount?.plaidAccount ?? t.creditCard?.plaidAccount ?? null;
        const stmt: StatementInfo | null = t.statement
            ? {
                  id: t.statement.id,
                  fileName: t.statement.fileName,
                  fileUrl: fileUrl(t.statement.fileKey, { name: t.statement.fileName }),
                  period:
                      t.statement.periodStart || t.statement.periodEnd
                          ? `${formatDate(t.statement.periodStart)} – ${formatDate(t.statement.periodEnd)}`
                          : null,
              }
            : null;
        return {
            id: t.id,
            finAccountId: t.finAccountId,
            creditCardId: t.creditCardId,
            date: t.date.toISOString().slice(0, 10),
            amount: Number(t.amount),
            currency: t.currency,
            merchant: t.merchant,
            rawDescription: t.rawDescription,
            categoryId: t.categoryId,
            pending: t.pending,
            source: t.source,
            plaidTransactionId: t.plaidTransactionId,
            plaidCategory: t.plaidCategory,
            plaidAccount: plaidAccount
                ? {
                      id: plaidAccount.id,
                      plaidAccountId: plaidAccount.plaidAccountId,
                      name: plaidAccount.name,
                      officialName: plaidAccount.officialName,
                      mask: plaidAccount.mask,
                      type: plaidAccount.type,
                      subtype: plaidAccount.subtype,
                      institutionName: plaidAccount.plaidItem.institutionName,
                      lastSyncedAt: plaidAccount.plaidItem.lastSyncedAt?.toISOString() ?? null,
                      lastBalanceSyncAt: plaidAccount.lastBalanceSyncAt?.toISOString() ?? null,
                  }
                : null,
            notes: t.notes,
            receiptUrl: t.receiptKey ? fileUrl(t.receiptKey, { name: "receipt" }) : null,
            createdAt: t.createdAt.toISOString(),
            updatedAt: t.updatedAt.toISOString(),
            statement: stmt,
            splits: t.splits.map((s) => ({ categoryId: s.categoryId, amount: Number(s.amount) })),
        };
    });

    return (
        <TransactionsClient
            transactions={rows}
            accounts={accountOpts}
            cards={cardOpts}
            categories={categories.map((c) => ({ id: c.id, label: c.name, color: c.color ?? null }))}
            aiConfigured={aiConfigured()}
            uncategorizedCount={transactions.filter((t) => t.categoryId === null).length}
        />
    );
}
