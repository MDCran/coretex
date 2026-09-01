import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fileUrl } from "@/lib/files";
import { aiConfigured } from "@/lib/ai/claude";
import { StatementsClient, type StatementRow } from "./statements-client";

export default async function StatementsPage() {
    const user = await requireUser();
    const [statements, accounts, cards, brokerages] = await Promise.all([
        db.finStatement.findMany({
            where: { userId: user.id },
            orderBy: { periodEnd: "desc" },
            include: {
                finAccount: { include: { institutionRef: { select: { name: true } } } },
                creditCard: { include: { institutionRef: { select: { name: true } } } },
                brokerageAccount: true,
                _count: { select: { transactions: true } },
            },
        }),
        db.finAccount.findMany({ where: { userId: user.id, archived: false }, orderBy: { createdAt: "desc" }, include: { institutionRef: { select: { name: true } } } }),
        db.creditCard.findMany({ where: { userId: user.id, archived: false }, orderBy: { createdAt: "desc" }, include: { institutionRef: { select: { name: true } } } }),
        db.brokerageAccount.findMany({ where: { userId: user.id, archived: false }, orderBy: { createdAt: "desc" } }),
    ]);

    const acctLabel = (a: { nickname: string | null; institution: string | null; institutionRef: { name: string } | null }) =>
        a.nickname || a.institutionRef?.name || a.institution || "Account";
    const cardLabel = (c: { nickname: string | null; productName: string | null; issuer: string | null; institutionRef: { name: string } | null }) =>
        c.nickname || c.productName || c.institutionRef?.name || c.issuer || "Card";

    const rows: StatementRow[] = statements.map((s) => {
        const ownerId = s.finAccountId ?? s.creditCardId ?? s.brokerageAccountId ?? null;
        const targetLabel = s.finAccount
            ? acctLabel(s.finAccount)
            : s.creditCard
              ? cardLabel(s.creditCard)
              : s.brokerageAccount
                ? s.brokerageAccount.accountName || s.brokerageAccount.brokerage || "Brokerage"
                : null;
        const targetKind: StatementRow["targetKind"] = s.finAccount ? "account" : s.creditCard ? "card" : s.brokerageAccount ? "brokerage" : null;
        return {
            id: s.id,
            fileName: s.fileName,
            downloadUrl: fileUrl(s.fileKey, { name: s.fileName }),
            ownerId,
            targetLabel,
            targetKind,
            periodStart: s.periodStart?.toISOString() ?? null,
            periodEnd: s.periodEnd?.toISOString() ?? null,
            endingBalance: s.endingBalance != null ? Number(s.endingBalance) : null,
            transactionCount: s._count.transactions,
            processingStatus: s.processingStatus,
            processingError: s.processingError,
            aiExtractedAt: s.aiExtractedAt?.toISOString() ?? null,
        };
    });

    return (
        <StatementsClient
            statements={rows}
            accounts={accounts.map((a) => ({ id: a.id, label: acctLabel(a) }))}
            cards={cards.map((c) => ({ id: c.id, label: cardLabel(c) }))}
            brokerages={brokerages.map((b) => ({ id: b.id, label: b.accountName || b.brokerage || "Brokerage" }))}
            aiConfigured={aiConfigured()}
        />
    );
}
