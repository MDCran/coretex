import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fileUrl } from "@/lib/files";
import { InstitutionsClient, type InstitutionRow } from "./institutions-client";

export default async function InstitutionsPage() {
    const user = await requireUser();
    const institutions = await db.institution.findMany({
        where: { userId: user.id },
        orderBy: { name: "asc" },
        include: {
            phones: true,
            emails: true,
            people: true,
            accounts: {
                where: { userId: user.id },
                orderBy: [{ archived: "asc" }, { nickname: "asc" }, { createdAt: "desc" }],
                include: {
                    owners: { select: { id: true, displayName: true, avatarKey: true } },
                    _count: { select: { transactions: true, statements: true } },
                },
            },
            cards: {
                where: { userId: user.id },
                orderBy: [{ archived: "asc" }, { nickname: "asc" }, { productName: "asc" }, { createdAt: "desc" }],
                include: {
                    owners: { select: { id: true, displayName: true, avatarKey: true } },
                    _count: { select: { transactions: true, statements: true } },
                },
            },
        },
    });

    const rows: InstitutionRow[] = institutions.map((i) => ({
        id: i.id,
        name: i.name,
        website: i.website,
        notes: i.notes,
        logoKey: i.logoKey ?? null,
        phones: i.phones.map((p) => ({ id: p.id, label: p.label, phone: p.phone })),
        emails: i.emails.map((e) => ({ id: e.id, label: e.label, email: e.email })),
        people: i.people.map((p) => ({ id: p.id, name: p.name, role: p.role, phone: p.phone, email: p.email, notes: p.notes })),
        accounts: i.accounts.map((a) => ({
            id: a.id,
            kind: a.kind,
            nickname: a.nickname,
            branchLocation: a.branchLocation,
            openedAt: a.openedAt?.toISOString().slice(0, 10) ?? null,
            closedAt: a.closedAt?.toISOString().slice(0, 10) ?? null,
            last4: a.last4,
            currency: a.currency,
            currentBalance: Number(a.currentBalance),
            lastBalanceAt: a.lastBalanceAt?.toISOString() ?? null,
            isAsset: a.isAsset,
            includeInNetWorth: a.includeInNetWorth,
            archived: a.archived,
            owners: a.owners.map((o) => ({ id: o.id, name: o.displayName, avatarUrl: o.avatarKey ? fileUrl(o.avatarKey) : null })),
            transactionCount: a._count.transactions,
            statementCount: a._count.statements,
        })),
        cards: i.cards.map((c) => ({
            id: c.id,
            nickname: c.nickname,
            productName: c.productName,
            cardType: c.cardType,
            last4: c.last4,
            openedAt: c.openedAt?.toISOString().slice(0, 10) ?? null,
            closedAt: c.closedAt?.toISOString().slice(0, 10) ?? null,
            expMonth: c.expMonth,
            expYear: c.expYear,
            apr: c.apr != null ? Number(c.apr) : null,
            creditLimit: c.creditLimit != null ? Number(c.creditLimit) : null,
            currentBalance: Number(c.currentBalance),
            minimumPayment: c.minimumPayment != null ? Number(c.minimumPayment) : null,
            paymentDueAt: c.paymentDueAt?.toISOString().slice(0, 10) ?? null,
            paymentOverdue: c.paymentOverdue,
            lastStatementBalance: c.lastStatementBalance != null ? Number(c.lastStatementBalance) : null,
            archived: c.archived,
            owners: c.owners.map((o) => ({ id: o.id, name: o.displayName, avatarUrl: o.avatarKey ? fileUrl(o.avatarKey) : null })),
            transactionCount: c._count.transactions,
            statementCount: c._count.statements,
        })),
    }));

    return <InstitutionsClient institutions={rows} />;
}
