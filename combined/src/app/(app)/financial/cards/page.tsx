import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fileUrl } from "@/lib/files";
import { CardsClient, type CreditCardRow } from "./cards-client";

export default async function CardsPage() {
    const user = await requireUser();
    const [cards, institutions, contacts] = await Promise.all([
        db.creditCard.findMany({
            where: { userId: user.id },
            orderBy: [{ archived: "asc" }, { createdAt: "desc" }],
            include: {
                institutionRef: { select: { id: true, name: true } },
                owners: { select: { id: true, displayName: true, avatarKey: true } },
                rewards: { orderBy: { order: "asc" } },
                statements: { orderBy: { periodEnd: "desc" }, take: 1, select: { fileName: true, periodStart: true, periodEnd: true } },
                _count: { select: { perks: true } },
                replacedBy: { select: { id: true, nickname: true, productName: true, issuer: true } },
                replaces: { select: { id: true, nickname: true, productName: true, issuer: true } },
            },
        }),
        db.institution.findMany({ where: { userId: user.id }, orderBy: { name: "asc" }, select: { id: true, name: true, website: true, logoKey: true } }),
        db.socialContact.findMany({ where: { userId: user.id, active: true }, orderBy: { displayName: "asc" }, select: { id: true, displayName: true, avatarKey: true } }),
    ]);

    const rows: CreditCardRow[] = cards.map((c) => ({
        id: c.id,
        institution: c.institutionRef?.name ?? c.issuer,
        institutionId: c.institutionId,
        issuer: c.issuer,
        nickname: c.nickname,
        cardType: c.cardType,
        productName: c.productName,
        expMonth: c.expMonth,
        expYear: c.expYear,
        branchLocation: c.branchLocation,
        openedAt: c.openedAt?.toISOString().slice(0, 10) ?? null,
        closedAt: c.closedAt?.toISOString().slice(0, 10) ?? null,
        last4: c.last4,
        apr: c.apr != null ? Number(c.apr) : null,
        creditLimit: c.creditLimit != null ? Number(c.creditLimit) : null,
        currentBalance: Number(c.currentBalance),
        cardStyle: c.cardStyle,
        cardImageUrl: c.cardImageKey ? fileUrl(c.cardImageKey) : null,
        minimumPayment: c.minimumPayment != null ? Number(c.minimumPayment) : null,
        paymentDueAt: c.paymentDueAt?.toISOString().slice(0, 10) ?? null,
        paymentOverdue: c.paymentOverdue,
        lastPaymentAmount: c.lastPaymentAmount != null ? Number(c.lastPaymentAmount) : null,
        lastStatementBalance: c.lastStatementBalance != null ? Number(c.lastStatementBalance) : null,
        latestStatementName: c.statements[0]?.fileName ?? null,
        latestStatementStart: c.statements[0]?.periodStart?.toISOString().slice(0, 10) ?? null,
        latestStatementEnd: c.statements[0]?.periodEnd?.toISOString().slice(0, 10) ?? null,
        rewardsNotes: c.rewardsNotes,
        notes: c.notes,
        archived: c.archived,
        owners: c.owners.map((o) => ({ id: o.id, name: o.displayName, avatarUrl: o.avatarKey ? fileUrl(o.avatarKey) : null })),
        rewards: c.rewards.map((r) => ({ category: r.category, type: r.type, rate: r.rate })),
        perkCount: c._count.perks,
        replacedById: c.replacedById ?? null,
        replacedByLabel: c.replacedBy ? (c.replacedBy.nickname || c.replacedBy.productName || c.replacedBy.issuer || "Card") : null,
        replacesLabels: c.replaces.map((r) => r.nickname || r.productName || r.issuer || "Card"),
    }));

    return (
        <CardsClient
            cards={rows}
            institutions={institutions}
            contacts={contacts.map((c) => ({ id: c.id, name: c.displayName, avatarUrl: c.avatarKey ? fileUrl(c.avatarKey) : null }))}
        />
    );
}
