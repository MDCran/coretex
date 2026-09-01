import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Bank, MarkerPin01 } from "@untitledui/icons";
import { Avatar } from "@/components/base/avatar/avatar";
import { Button } from "@/components/base/buttons/button";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fileUrl } from "@/lib/files";
import { aiConfigured } from "@/lib/ai/claude";
import { computeFinAccountBalance } from "@/lib/financial/balance";
import { computeBrokerageAccountValue } from "@/lib/financial/brokerage-holdings";
import { setFinAccountReplacedBy } from "@/lib/actions/financial-accounts";
import { fetchAlpacaPortfolio } from "@/lib/actions/financial-alpaca";
import { formatCurrency, formatDate } from "@/lib/financial/format";
import { formatDateOnly } from "@/lib/dates";
import { Card, EmptyRow, SectionHeader, Stat } from "../../_components/financial-ui";
import { FlowTimelineChart } from "../../_components/flow-timeline-chart";
import { StatementUploadButton } from "../../_components/statement-upload-button";
import { StatementHistory, type DetailStatement } from "../../_components/statement-history";
import { ReplacementLink, type ReplacementOption } from "../../_components/replacement-link";
import { InstitutionLogo } from "../../_components/institution-logo";
import { MerchantLogo } from "../../_components/merchant-logo";
import { institutionLogoSrc } from "@/lib/financial/institution-logos";
import { HoldingsSection, type HoldingRow } from "../holdings-section";
import { BrokerageControls } from "../brokerage-controls";
import { AlpacaPortfolio } from "../alpaca-portfolio";
import { AccountDetailControls } from "./account-detail-controls";

const accountLabel = (a: { nickname: string | null; institution: string | null; institutionRef?: { name: string } | null }) =>
    a.nickname || a.institutionRef?.name || a.institution || "Account";

const KIND_LABEL: Record<string, string> = { CHECKING: "Checking", SAVINGS: "Savings", MONEY_MARKET: "Money market", CD: "Certificate of deposit", BROKERAGE: "Brokerage", LOAN: "Loan", OTHER: "Other" };

const BALANCE_SOURCE_LABEL: Record<string, string> = {
    alpaca: "Live Alpaca equity",
    holdings: "Sum of holdings",
    statement: "From latest statement",
    none: "No value yet",
};

export default async function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const user = await requireUser();
    const account = await db.finAccount.findFirst({
        where: { id, userId: user.id },
        include: {
            institutionRef: { select: { id: true, name: true, website: true, logoKey: true } },
            owners: { select: { id: true, displayName: true, avatarKey: true } },
            transactions: { orderBy: { date: "desc" }, take: 50, include: { category: true } },
            statements: { orderBy: { periodEnd: "desc" } },
            holdings: { orderBy: { symbol: "asc" } },
            replacedBy: { include: { institutionRef: { select: { name: true } } } },
            replaces: { include: { institutionRef: { select: { name: true } } } },
            plaidAccount: { include: { plaidItem: { select: { institutionName: true, lastSyncedAt: true } } } },
        },
    });
    if (!account) notFound();

    const isBrokerage = account.kind === "BROKERAGE";

    // Brokerage value derives from Alpaca equity (when linked) → holdings → statement.
    const brokerageValue = isBrokerage ? await computeBrokerageAccountValue(account.id) : null;
    const derivedBalance = brokerageValue ? brokerageValue.value : await computeFinAccountBalance(account.id);

    // Live Alpaca portfolio. We auto-surface the paper/live portfolio for the user's
    // PRIMARY (earliest-created) brokerage account whenever an AlpacaConnection exists,
    // even if the account hasn't been manually linked yet — so a connected user sees
    // their portfolio without toggling. (This only affects the read-only panel below;
    // net-worth math in computeBrokerageAccountValue still keys off account.alpacaLinked,
    // so nothing is double-counted.)
    const alpacaConn = isBrokerage ? await db.alpacaConnection.findUnique({ where: { userId: user.id }, select: { id: true } }) : null;

    // The earliest-created brokerage account is treated as primary for auto-surfacing.
    const primaryBrokerageId = isBrokerage
        ? (await db.finAccount.findFirst({
              where: { userId: user.id, kind: "BROKERAGE" },
              orderBy: { createdAt: "asc" },
              select: { id: true },
          }))?.id ?? null
        : null;

    const isPrimaryBrokerage = isBrokerage && primaryBrokerageId === account.id;

    // Show the read-only portfolio when this account is explicitly linked, OR when it is
    // the user's primary brokerage account and a connection exists (auto-surface).
    const showAlpacaPortfolio = isBrokerage && Boolean(alpacaConn) && (account.alpacaLinked || isPrimaryBrokerage);

    const alpacaPortfolio = showAlpacaPortfolio ? await fetchAlpacaPortfolio().catch(() => null) : null;

    const holdings: HoldingRow[] = account.holdings.map((h) => ({
        id: h.id,
        symbol: h.symbol,
        shares: Number(h.shares),
        costBasisPerShare: h.costBasisPerShare != null ? Number(h.costBasisPerShare) : null,
        currentPrice: h.currentPrice != null ? Number(h.currentPrice) : null,
        asOf: h.asOf?.toISOString() ?? null,
    }));

    const otherAccounts = await db.finAccount.findMany({
        where: { userId: user.id, id: { not: account.id } },
        orderBy: [{ archived: "asc" }, { createdAt: "desc" }],
        select: { id: true, nickname: true, institution: true, institutionRef: { select: { name: true } } },
    });
    const [institutions, contacts, accountTransactions] = await Promise.all([
        db.institution.findMany({ where: { userId: user.id }, orderBy: { name: "asc" }, select: { id: true, name: true, website: true, logoKey: true } }),
        db.socialContact.findMany({ where: { userId: user.id, active: true }, orderBy: { displayName: "asc" }, select: { id: true, displayName: true, avatarKey: true } }),
        db.finTransaction.findMany({
            where: { userId: user.id, finAccountId: account.id },
            orderBy: { date: "asc" },
            select: { date: true, amount: true },
        }),
    ]);

    const label = accountLabel(account);
    const statements: DetailStatement[] = account.statements.map((s) => ({
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

    const replacedBy: ReplacementOption | null = account.replacedBy ? { id: account.replacedBy.id, label: accountLabel(account.replacedBy) } : null;
    const replaces: ReplacementOption[] = account.replaces.map((r) => ({ id: r.id, label: accountLabel(r) }));
    const options: ReplacementOption[] = otherAccounts.map((a) => ({ id: a.id, label: accountLabel(a) }));
    const isAsset = account.kind !== "LOAN" && account.isAsset;
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const isClosed = Boolean(account.closedAt && account.closedAt <= today);
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    let monthInflow = 0;
    let monthOutflow = 0;
    let largestOutflow = 0;
    for (const txn of accountTransactions) {
        const amount = Number(txn.amount);
        if (txn.date >= monthStart) {
            if (amount >= 0) monthInflow += amount;
            else monthOutflow += Math.abs(amount);
        }
        if (amount < 0) largestOutflow = Math.max(largestOutflow, Math.abs(amount));
    }
    const flowTransactions = accountTransactions.map((txn) => ({ date: txn.date.toISOString().slice(0, 10), amount: Number(txn.amount) }));
    const logo = account.institutionRef ? institutionLogoSrc(account.institutionRef) : null;

    return (
        <div className="flex flex-col gap-6">
            <Button color="link-gray" iconLeading={<ArrowLeft data-icon className="size-4" />} href="/financial/accounts" className="self-start">
                Back to accounts
            </Button>

            <SectionHeader
                title={label}
                description={KIND_LABEL[account.kind] ?? account.kind}
                action={
                    <AccountDetailControls
                        account={{
                            id: account.id,
                            kind: account.kind,
                            institutionId: account.institutionId,
                            nickname: account.nickname,
                            last4: account.last4,
                            branchLocation: account.branchLocation,
                            openedAt: account.openedAt?.toISOString().slice(0, 10) ?? null,
                            closedAt: account.closedAt?.toISOString().slice(0, 10) ?? null,
                            includeInNetWorth: account.includeInNetWorth,
                            notes: account.notes,
                            archived: account.archived,
                            owners: account.owners.map((o) => ({ id: o.id, name: o.displayName, avatarUrl: o.avatarKey ? fileUrl(o.avatarKey) : null })),
                        }}
                        institutions={institutions}
                        contacts={contacts.map((c) => ({ id: c.id, name: c.displayName, avatarUrl: c.avatarKey ? fileUrl(c.avatarKey) : null }))}
                    />
                }
            />

            <Card className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                    {account.institutionRef ? <InstitutionLogo src={logo} name={account.institutionRef.name} size="md" /> : <span className="flex size-10 items-center justify-center rounded-lg bg-secondary text-fg-quaternary"><Bank className="size-5" /></span>}
                    <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-primary">{account.institutionRef?.name ?? account.institution ?? "No institution"}</p>
                        <p className="text-xs text-tertiary">
                            {account.last4 ? `Ending in ${account.last4}` : "No account ending stored"}
                            {account.plaidAccount ? ` · Plaid: ${account.plaidAccount.name}` : " · Manual account"}
                        </p>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button size="sm" color="secondary" href="/settings/integrations">
                        Manage Plaid link
                    </Button>
                    <Button size="sm" color="secondary" href={`/financial/transactions?account=${account.id}`}>
                        Search transactions
                    </Button>
                </div>
            </Card>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Stat
                    label={isBrokerage ? "Account value" : "Current balance"}
                    value={formatCurrency(derivedBalance)}
                    sub={
                        isBrokerage
                            ? BALANCE_SOURCE_LABEL[brokerageValue?.source ?? "none"]
                            : account.statements.some((s) => s.endingBalance != null)
                              ? "From latest statement"
                              : "Sum of transactions"
                    }
                />
                {isBrokerage ? <Stat label="Holdings" value={holdings.length} /> : <Stat label="Transactions" value={accountTransactions.length} />}
                <Stat label="Statements" value={account.statements.length} />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                <Stat label="This month in" value={formatCurrency(monthInflow)} tone="success" />
                <Stat label="This month out" value={formatCurrency(monthOutflow)} tone="error" />
                <Stat label="This month net" value={formatCurrency(monthInflow - monthOutflow)} />
                <Stat label="Largest debit" value={formatCurrency(largestOutflow)} />
            </div>

            {flowTransactions.length > 0 && (
                <Card className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-md font-semibold text-primary">Account cashflow</h3>
                        <Button size="sm" color="link-color" href={`/financial/transactions?account=${account.id}`}>
                            Open ledger
                        </Button>
                    </div>
                    <FlowTimelineChart transactions={flowTransactions} emptyLabel="No deposits or withdrawals match this filter" />
                </Card>
            )}

            {/* Account details */}
            <Card className="flex flex-col gap-4">
                <h3 className="text-md font-semibold text-primary">Details</h3>
                <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                    <Detail label="Institution">
                        {account.institutionRef ? (
                            <Link
                                href="/financial/institutions"
                                className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary hover:bg-secondary_hover hover:text-primary"
                            >
                                <Bank className="size-3.5 text-fg-quaternary" /> {account.institutionRef.name}
                            </Link>
                        ) : account.institution ? (
                            <span className="text-sm text-secondary">{account.institution}</span>
                        ) : (
                            <span className="text-tertiary">—</span>
                        )}
                    </Detail>
                    <Detail label="Account ending">
                        <span className="font-mono text-sm tabular-nums text-secondary">{account.last4 ? `•••• ${account.last4}` : "—"}</span>
                    </Detail>
                    <Detail label="Branch location">
                        {account.branchLocation ? (
                            <span className="inline-flex items-center gap-1.5 text-sm text-secondary">
                                <MarkerPin01 className="size-3.5 text-fg-quaternary" /> {account.branchLocation}
                            </span>
                        ) : (
                            <span className="text-tertiary">—</span>
                        )}
                    </Detail>
                    <Detail label="Opening date">
                        <span className="text-sm text-secondary">{account.openedAt ? formatDateOnly(account.openedAt.toISOString().slice(0, 10)) : "-"}</span>
                    </Detail>
                    <Detail label="Closing date">
                        <span className="text-sm text-secondary">{account.closedAt ? formatDateOnly(account.closedAt.toISOString().slice(0, 10)) : "-"}</span>
                    </Detail>
                    <Detail label="Net worth">
                        <span className="text-sm text-secondary">
                            {isClosed ? "Closed" : `${account.includeInNetWorth ? "Included" : "Excluded"} · ${isAsset ? "Asset" : "Liability"}`}
                        </span>
                    </Detail>
                    <Detail label="Owners">
                        {account.owners.length === 0 ? (
                            <span className="text-tertiary">—</span>
                        ) : (
                            <div className="flex flex-wrap gap-1.5">
                                {account.owners.map((o) => (
                                    <Link
                                        key={o.id}
                                        href={`/social/contacts/${o.id}`}
                                        className="inline-flex items-center gap-1.5 rounded-full bg-secondary py-0.5 pr-2.5 pl-0.5 text-xs font-medium text-secondary hover:bg-secondary_hover hover:text-primary"
                                    >
                                        <Avatar size="xs" src={o.avatarKey ? fileUrl(o.avatarKey) : undefined} alt={o.displayName} initials={o.displayName.slice(0, 2).toUpperCase()} />
                                        {o.displayName}
                                    </Link>
                                ))}
                            </div>
                        )}
                    </Detail>
                </dl>
                {account.notes && (
                    <div className="border-t border-secondary pt-3">
                        <p className="text-sm whitespace-pre-wrap text-tertiary">{account.notes}</p>
                    </div>
                )}
            </Card>

            <ReplacementLink id={account.id} kind="account" replacedBy={replacedBy} replaces={replaces} options={options} setReplacedBy={setFinAccountReplacedBy} />

            {isBrokerage && (
                <>
                    <BrokerageControls
                        finAccountId={account.id}
                        alpacaLinked={account.alpacaLinked}
                        alpacaConnected={Boolean(alpacaConn)}
                        aiConfigured={aiConfigured()}
                        hasStatements={account.statements.length > 0}
                    />

                    {showAlpacaPortfolio && <AlpacaPortfolio initial={alpacaPortfolio} />}

                    <HoldingsSection
                        finAccountId={account.id}
                        holdings={holdings}
                        readOnlyNote={account.alpacaLinked ? "Holdings mirror your live Alpaca positions; manual edits are overwritten on the next sync." : undefined}
                    />
                </>
            )}

            <Card>
                <h3 className="mb-4 text-md font-semibold text-primary">Recent transactions</h3>
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
                            {account.transactions.length === 0 && <EmptyRow colSpan={4} label="No transactions yet." />}
                            {account.transactions.map((t) => (
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
            </Card>

            <div className="flex flex-col gap-3">
                <SectionHeader
                    title="Statements"
                    description="Upload a statement to auto-extract transactions and track balance over time."
                    action={<StatementUploadButton finAccountId={account.id} targetLabel={label} aiConfigured={aiConfigured()} />}
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
