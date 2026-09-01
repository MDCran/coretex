// @ts-nocheck









import { CardPreview } from "../card-preview";
import { CardDetailControls } from "./card-detail-controls";
import { CardNumbersClient, type CardNumberRow } from "./card-numbers-client";
import { RewardsPerksClient, type CardPerkRow, type CardRewardRow } from "./rewards-perks-client";
import type { RewardType } from "../../_components/reward-format";
import { Avatar } from "@/components/base/avatar/avatar";
import { formatCurrency } from "@/coretex/views/personal/personal-ui";
import { db } from "@/lib/db";
import { ArrowLeft, MarkerPin01 } from "@untitledui/icons";
import { formatDate } from "../../../personal/personal-ui";
import { Button } from "react-aria-components";
import { SectionHeader, Stat, EmptyRow } from "../../_components/financial-ui";
import { FlowTimelineChart } from "../../_components/flow-timeline-chart";
import { InstitutionLogo } from "../../_components/institution-logo";
import { MerchantLogo } from "../../_components/merchant-logo";
import { ReplacementOption, ReplacementLink } from "../../_components/replacement-link";
import { DetailStatement, StatementHistory } from "../../_components/statement-history";
import { StatementUploadButton } from "../../_components/statement-upload-button";
import { notFound } from "next/navigation";

const cardLabel = (c: { nickname?: string | null; productName: string | null; issuer: string | null; institutionRef?: { name: string } | null }) =>
    c.nickname || c.productName || c.institutionRef?.name || c.issuer || "Card";

const CARD_TYPE_LABEL: Record<string, string> = { CREDIT: "Credit", DEBIT: "Debit", CHARGE: "Charge", PREPAID: "Prepaid", OTHER: "Other" };

export default async function CardDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const user = await requireUser();
    const card = await db.creditCard.findFirst({
        where: { id, userId: user.id },
        include: {
            institutionRef: { select: { id: true, name: true, website: true, logoKey: true } },
            owners: { select: { id: true, displayName: true, avatarKey: true } },
            cardNumbers: { orderBy: [{ isCurrent: "desc" }, { validFrom: "desc" }] },
            transactions: { orderBy: { date: "desc" }, take: 50, include: { category: true } },
            statements: { orderBy: { periodEnd: "desc" } },
            replacedBy: { include: { institutionRef: { select: { name: true } } } },
            replaces: { include: { institutionRef: { select: { name: true } } } },
            rewards: { orderBy: { order: "asc" } },
            perks: { orderBy: { order: "asc" } },
            plaidAccount: { include: { plaidItem: { select: { institutionName: true, lastSyncedAt: true } } } },
        },
    });
    if (!card) notFound();

    const derivedBalance = await computeCreditCardBalance(card.id);
    const util = card.creditLimit && Number(card.creditLimit) > 0 ? derivedBalance / Number(card.creditLimit) : null;

    const [otherCards, institutions, contacts, cardTransactions] = await Promise.all([
        db.creditCard.findMany({
            where: { userId: user.id, id: { not: card.id } },
            orderBy: [{ archived: "asc" }, { createdAt: "desc" }],
            select: { id: true, nickname: true, productName: true, issuer: true, institutionRef: { select: { name: true } } },
        }),
        db.institution.findMany({ where: { userId: user.id }, orderBy: { name: "asc" }, select: { id: true, name: true, website: true, logoKey: true } }),
        db.socialContact.findMany({ where: { userId: user.id, active: true }, orderBy: { displayName: "asc" }, select: { id: true, displayName: true, avatarKey: true } }),
        db.finTransaction.findMany({
            where: { userId: user.id, creditCardId: card.id },
            orderBy: { date: "asc" },
            select: { date: true, amount: true },
        }),
    ]);

    const label = cardLabel(card);
    const exp = card.expMonth && card.expYear ? `${String(card.expMonth).padStart(2, "0")}/${String(card.expYear).slice(-2)}` : "";
    const numbers: CardNumberRow[] = card.cardNumbers.map((n) => ({
        id: n.id,
        last4: n.last4,
        validFrom: n.validFrom?.toISOString() ?? null,
        validTo: n.validTo?.toISOString() ?? null,
        isCurrent: n.isCurrent,
        notes: n.notes,
    }));
    const statements: DetailStatement[] = card.statements.map((s) => ({
        id: s.id,
        fileName: s.fileName,
        previewUrl: fileUrl(s.fileKey, { name: s.fileName }),
        downloadUrl: fileUrl(s.fileKey, { name: s.fileName, download: true }),
        periodStart: s.periodStart?.toISOString() ?? null,
        periodEnd: s.periodEnd?.toISOString() ?? null,
        endingBalance: s.endingBalance != null ? Number(s.endingBalance) : null,
        transactionCount: s.extractedTransactionCount ?? 0,
        processingStatus: s.processingStatus,
        processingError: s.processingError,
    }));

    const rewards: CardRewardRow[] = card.rewards.map((r) => ({
        id: r.id,
        category: r.category,
        type: r.type as RewardType,
        rate: r.rate,
        cap: r.cap,
        notes: r.notes,
    }));
    const perks: CardPerkRow[] = card.perks.map((p) => ({ id: p.id, title: p.title, description: p.description }));

    const replacedBy: ReplacementOption | null = card.replacedBy ? { id: card.replacedBy.id, label: cardLabel(card.replacedBy) } : null;
    const replaces: ReplacementOption[] = card.replaces.map((r) => ({ id: r.id, label: cardLabel(r) }));
    const options: ReplacementOption[] = otherCards.map((c) => ({ id: c.id, label: cardLabel(c) }));
    const cardImageUrl = card.cardImageKey ? fileUrl(card.cardImageKey) : null;
    const maskedCardNumber = `**** **** **** ${card.last4 ?? "****"}`;
    const logo = card.institutionRef ? institutionLogoSrc(card.institutionRef) : null;
    const latestStatement = statements[0] ?? null;
    const flowTransactions = cardTransactions.map((txn) => ({ date: txn.date.toISOString().slice(0, 10), amount: Number(txn.amount) }));

    return (
        <div className="flex flex-col gap-6">
            <Button color="link-gray" iconLeading={<ArrowLeft data-icon className="size-4" />} href="/financial/cards" className="self-start">
                Back to cards
            </Button>

            <SectionHeader
                title={label}
                description={CARD_TYPE_LABEL[card.cardType] ?? card.cardType}
                action={
                    <CardDetailControls
                        card={{
                            id: card.id,
                            institutionId: card.institutionId,
                            nickname: card.nickname,
                            cardType: card.cardType,
                            productName: card.productName,
                            last4: card.last4,
                            expMonth: card.expMonth,
                            expYear: card.expYear,
                            branchLocation: card.branchLocation,
                            openedAt: card.openedAt?.toISOString().slice(0, 10) ?? null,
                            closedAt: card.closedAt?.toISOString().slice(0, 10) ?? null,
                            apr: card.apr != null ? Number(card.apr) : null,
                            creditLimit: card.creditLimit != null ? Number(card.creditLimit) : null,
                            cardStyle: card.cardStyle,
                            cardImageUrl,
                            minimumPayment: card.minimumPayment != null ? Number(card.minimumPayment) : null,
                            paymentDueAt: card.paymentDueAt?.toISOString().slice(0, 10) ?? null,
                            paymentOverdue: card.paymentOverdue,
                            lastPaymentAmount: card.lastPaymentAmount != null ? Number(card.lastPaymentAmount) : null,
                            lastStatementBalance: card.lastStatementBalance != null ? Number(card.lastStatementBalance) : null,
                            rewardsNotes: card.rewardsNotes,
                            notes: card.notes,
                            archived: card.archived,
                            owners: card.owners.map((o) => ({ id: o.id, name: o.displayName, avatarUrl: o.avatarKey ? fileUrl(o.avatarKey) : null })),
                        }}
                        institutions={institutions}
                        contacts={contacts.map((c) => ({ id: c.id, name: c.displayName, avatarUrl: c.avatarKey ? fileUrl(c.avatarKey) : null }))}
                    />
                }
            />

            <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[320px_1fr]">
                <div className="flex min-h-[190px] items-start justify-center lg:justify-start">
                    <CardPreview
                        width={300}
                        imageUrl={cardImageUrl}
                        styleValue={card.cardStyle}
                        archived={card.archived}
                        company={card.institutionRef?.name || card.issuer || "Card"}
                        cardHolder={card.owners[0]?.displayName || card.productName || ""}
                        cardNumber={maskedCardNumber}
                        cardExpiration={exp}
                    />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <Stat label="Balance" value={formatCurrency(derivedBalance)} />
                    <Stat label="Limit" value={card.creditLimit != null ? formatCurrency(Number(card.creditLimit)) : "—"} />
                    <Stat label="APR" value={card.apr != null ? `${Number(card.apr)}%` : "—"} />
                    <Stat label="Utilization" value={util != null ? formatPercent(util) : "—"} tone={util != null && util > 0.3 ? "error" : undefined} />
                    <Stat
                        label="Payment due"
                        value={card.paymentDueAt ? formatDateOnly(card.paymentDueAt.toISOString().slice(0, 10)) : "-"}
                        sub={card.paymentOverdue ? "Overdue" : undefined}
                        tone={card.paymentOverdue ? "error" : undefined}
                    />
                    <Stat label="Minimum payment" value={card.minimumPayment != null ? formatCurrency(Number(card.minimumPayment)) : "-"} />
                    <Stat
                        label="Statement balance"
                        value={card.lastStatementBalance != null ? formatCurrency(Number(card.lastStatementBalance)) : "-"}
                        sub={latestStatement?.periodEnd ? formatDateOnly(latestStatement.periodEnd.slice(0, 10)) : undefined}
                    />
                    <Stat label="Last payment" value={card.lastPaymentAmount != null ? formatCurrency(Number(card.lastPaymentAmount)) : "-"} />
                </div>
            </div>

            {flowTransactions.length > 0 && (
                <CardSurface className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-md font-semibold text-primary">Card activity</h3>
                        <Button size="sm" color="link-color" href={`/financial/transactions?account=${card.id}`}>
                            Search transactions
                        </Button>
                    </div>
                    <FlowTimelineChart
                        transactions={flowTransactions}
                        depositLabel="Payments"
                        withdrawalLabel="Charges"
                        emptyLabel="No payments or charges match this filter"
                    />
                </CardSurface>
            )}

            {/* Card details */}
            <CardSurface className="flex flex-col gap-4">
                <h3 className="text-md font-semibold text-primary">Card details</h3>
                <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                    <Detail label="Institution">
                        {card.institutionRef ? (
                            <a href="#">
                                <InstitutionLogo src={logo} name={card.institutionRef.name} size="sm" /> {card.institutionRef.name}
                            </a>
                        ) : card.issuer ? (
                            <span className="text-sm text-secondary">{card.issuer}</span>
                        ) : (
                            <span className="text-tertiary">—</span>
                        )}
                    </Detail>
                    <Detail label="Plaid link">
                        <span className="inline-flex flex-wrap items-center gap-2">
                            {card.plaidAccount ? (
                                <span className="text-sm text-secondary">
                                    {card.plaidAccount.name}
                                    {card.plaidAccount.mask ? ` ending ${card.plaidAccount.mask}` : ""}
                                    {card.plaidAccount.plaidItem.lastSyncedAt ? ` - synced ${formatDate(card.plaidAccount.plaidItem.lastSyncedAt)}` : ""}
                                </span>
                            ) : (
                                <span className="text-sm text-tertiary">Manual card</span>
                            )}
                            <Button size="sm" color="link-color" href="/settings/integrations">
                                Manage Plaid link
                            </Button>
                        </span>
                    </Detail>
                    <Detail label="Card look">
                        <span className="text-sm text-secondary">{cardImageUrl ? "Custom image" : card.cardStyle ?? "brand-dark"}</span>
                    </Detail>
                    <Detail label="Card ending">
                        <span className="font-mono text-sm tabular-nums text-secondary">{card.last4 ? `•••• ${card.last4}` : "—"}</span>
                    </Detail>
                    <Detail label="Expires">
                        <span className="text-sm text-secondary">{exp || "—"}</span>
                    </Detail>
                    <Detail label="Opening date">
                        <span className="text-sm text-secondary">{card.openedAt ? formatDateOnly(card.openedAt.toISOString().slice(0, 10)) : "-"}</span>
                    </Detail>
                    <Detail label="Closing date">
                        <span className="text-sm text-secondary">{card.closedAt ? formatDateOnly(card.closedAt.toISOString().slice(0, 10)) : "-"}</span>
                    </Detail>
                    <Detail label="Branch location">
                        {card.branchLocation ? (
                            <span className="inline-flex items-center gap-1.5 text-sm text-secondary">
                                <MarkerPin01 className="size-3.5 text-fg-quaternary" /> {card.branchLocation}
                            </span>
                        ) : (
                            <span className="text-tertiary">—</span>
                        )}
                    </Detail>
                    <Detail label="Owners">
                        {card.owners.length === 0 ? (
                            <span className="text-tertiary">—</span>
                        ) : (
                            <div className="flex flex-wrap gap-1.5">
                                {card.owners.map((o) => (
                                    <a href="#">
                                        <Avatar size="xs" src={o.avatarKey ? fileUrl(o.avatarKey) : undefined} alt={o.displayName} initials={o.displayName.slice(0, 2).toUpperCase()} />
                                        {o.displayName}
                                    </a>
                                ))}
                            </div>
                        )}
                    </Detail>
                </dl>
                {card.notes && (
                    <div className="border-t border-secondary pt-3">
                        <p className="text-sm whitespace-pre-wrap text-tertiary">{card.notes}</p>
                    </div>
                )}
            </CardSurface>

            <ReplacementLink id={card.id} kind="card" replacedBy={replacedBy} replaces={replaces} options={options} setReplacedBy={setCreditCardReplacedBy} />

            <RewardsPerksClient cardId={card.id} rewards={rewards} perks={perks} />

            {card.rewardsNotes && (
                <CardSurface>
                    <h3 className="mb-1 text-md font-semibold text-primary">Rewards notes</h3>
                    <p className="text-sm whitespace-pre-wrap text-tertiary">{card.rewardsNotes}</p>
                </CardSurface>
            )}

            <CardNumbersClient cardId={card.id} numbers={numbers} />

            <CardSurface>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-md font-semibold text-primary">Recent transactions</h3>
                    <Button size="sm" color="link-color" href={`/financial/transactions?account=${card.id}`}>
                        Search transactions
                    </Button>
                </div>
                <div className="-mx-5 -mb-5 overflow-x-auto">
                    <table className="w-full min-w-[560px] text-sm">
                        <thead>
                            <tr className="border-y border-secondary text-left text-tertiary">
                                <th className="px-5 py-3 font-medium">Date</th>
                                <th className="px-5 py-3 font-medium">Merchant</th>
                                <th className="px-5 py-3 font-medium">Category</th>
                                <th className="px-5 py-3 text-right font-medium">Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            {card.transactions.length === 0 && <EmptyRow colSpan={4} label="No transactions yet." />}
                            {card.transactions.map((t) => (
                                <tr key={t.id} className="border-b border-secondary last:border-0">
                                    <td className="px-5 py-3 text-tertiary">{formatDate(t.date)}</td>
                                    <td className="px-5 py-3 text-primary">
                                        <span className="inline-flex max-w-full items-center gap-2">
                                            <MerchantLogo merchant={t.merchant || t.rawDescription || "Unknown merchant"} size="xs" />
                                            <span className="truncate">{t.merchant || t.rawDescription || "—"}</span>
                                        </span>
                                    </td>
                                    <td className="px-5 py-3 text-tertiary">{t.category?.name ?? "—"}</td>
                                    <td className={`px-5 py-3 text-right font-medium ${Number(t.amount) < 0 ? "text-primary" : "text-success-primary"}`}>{formatCurrency(Number(t.amount))}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </CardSurface>

            <div className="flex flex-col gap-3">
                <SectionHeader
                    title="Statements"
                    description="Upload a statement to auto-extract transactions and track balance over time."
                    action={<StatementUploadButton creditCardId={card.id} targetLabel={label} aiConfigured={aiConfigured()} />}
                />
                <StatementHistory entityLabel={label} statements={statements} currentBalance={derivedBalance} aiConfigured={aiConfigured()} />
            </div>
        </div>
    );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex flex-col gap-1">
            <dt className="text-xs font-medium tracking-wide text-quaternary uppercase">{label}</dt>
            <dd>{children}</dd>
        </div>
    );
}
