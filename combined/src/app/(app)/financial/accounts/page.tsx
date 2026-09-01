import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fileUrl } from "@/lib/files";
import { reconcileLegacyBrokerage } from "@/lib/financial/brokerage-holdings";
import { AccountsClient, type AccountRow } from "./accounts-client";

export default async function AccountsPage() {
    const user = await requireUser();
    // Idempotent: migrate any legacy BrokerageAccount rows to FinAccount(kind BROKERAGE).
    await reconcileLegacyBrokerage(user.id).catch(() => undefined);
    const [accounts, institutions, contacts] = await Promise.all([
        db.finAccount.findMany({
            where: { userId: user.id },
            orderBy: [{ archived: "asc" }, { createdAt: "desc" }],
            include: {
                institutionRef: { select: { id: true, name: true } },
                owners: { select: { id: true, displayName: true, avatarKey: true } },
                _count: { select: { transactions: true, statements: true } },
            },
        }),
        db.institution.findMany({ where: { userId: user.id }, orderBy: { name: "asc" }, select: { id: true, name: true, website: true, logoKey: true } }),
        db.socialContact.findMany({ where: { userId: user.id, active: true }, orderBy: { displayName: "asc" }, select: { id: true, displayName: true, avatarKey: true } }),
    ]);

    const rows: AccountRow[] = accounts.map((a) => ({
        id: a.id,
        kind: a.kind,
        institution: a.institutionRef?.name ?? a.institution,
        institutionId: a.institutionId,
        nickname: a.nickname,
        branchLocation: a.branchLocation,
        openedAt: a.openedAt?.toISOString().slice(0, 10) ?? null,
        closedAt: a.closedAt?.toISOString().slice(0, 10) ?? null,
        last4: a.last4,
        currentBalance: Number(a.currentBalance),
        lastBalanceAt: a.lastBalanceAt?.toISOString() ?? null,
        isAsset: a.isAsset,
        includeInNetWorth: a.includeInNetWorth,
        notes: a.notes,
        archived: a.archived,
        owners: a.owners.map((o) => ({ id: o.id, name: o.displayName, avatarUrl: o.avatarKey ? fileUrl(o.avatarKey) : null })),
        transactionCount: a._count.transactions,
        statementCount: a._count.statements,
    }));

    return (
        <AccountsClient
            accounts={rows}
            institutions={institutions}
            contacts={contacts.map((c) => ({ id: c.id, name: c.displayName, avatarUrl: c.avatarKey ? fileUrl(c.avatarKey) : null }))}
        />
    );
}
