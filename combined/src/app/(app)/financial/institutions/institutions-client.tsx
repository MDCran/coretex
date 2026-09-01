"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import {
    ArrowUpRight,
    Bank,
    Calendar,
    ChevronDown,
    CreditCard02,
    Edit01,
    FileCheck02,
    Globe01,
    Mail01,
    Phone,
    Plus,
    Receipt,
    Trash02,
    User01,
    Users01,
} from "@untitledui/icons";
import { toast } from "sonner";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { createInstitution, deleteInstitution, updateInstitution } from "@/lib/actions/financial-institutions";
import { formatDateOnly } from "@/lib/dates";
import { formatCurrency, formatDate } from "@/lib/financial/format";
import { institutionLogoSrc } from "@/lib/financial/institution-logos";
import { Card, EmptyRow, SectionHeader, TableCard } from "../_components/financial-ui";
import { InstitutionLogo } from "../_components/institution-logo";
import { FormModal } from "../_components/form-modal";
import { useConfirm } from "../_components/confirm-modal";
import { InstitutionFormFields } from "../_components/institution-form";
import { cx } from "@/utils/cx";

interface OwnerSummary {
    id: string;
    name: string;
    avatarUrl: string | null;
}

interface InstitutionAccountRow {
    id: string;
    kind: string;
    nickname: string | null;
    branchLocation: string | null;
    openedAt: string | null;
    closedAt: string | null;
    last4: string | null;
    currency: string;
    currentBalance: number;
    lastBalanceAt: string | null;
    isAsset: boolean;
    includeInNetWorth: boolean;
    archived: boolean;
    owners: OwnerSummary[];
    transactionCount: number;
    statementCount: number;
}

interface InstitutionCardRow {
    id: string;
    nickname: string | null;
    productName: string | null;
    cardType: string;
    last4: string | null;
    openedAt: string | null;
    closedAt: string | null;
    expMonth: number | null;
    expYear: number | null;
    apr: number | null;
    creditLimit: number | null;
    currentBalance: number;
    minimumPayment: number | null;
    paymentDueAt: string | null;
    paymentOverdue: boolean;
    lastStatementBalance: number | null;
    archived: boolean;
    owners: OwnerSummary[];
    transactionCount: number;
    statementCount: number;
}

export interface InstitutionRow {
    id: string;
    name: string;
    website: string | null;
    notes: string | null;
    logoKey: string | null;
    phones: { id: string; label: string; phone: string }[];
    emails: { id: string; label: string; email: string }[];
    people: { id: string; name: string; role: string | null; phone: string | null; email: string | null; notes: string | null }[];
    accounts: InstitutionAccountRow[];
    cards: InstitutionCardRow[];
}

const ACCOUNT_KIND_LABELS: Record<string, string> = {
    CHECKING: "Checking",
    SAVINGS: "Savings",
    MONEY_MARKET: "Money market",
    CD: "Certificate of deposit",
    BROKERAGE: "Brokerage",
    LOAN: "Loan",
    OTHER: "Other",
};

const CARD_TYPE_LABELS: Record<string, string> = {
    CREDIT: "Credit",
    DEBIT: "Debit",
    CHARGE: "Charge",
    PREPAID: "Prepaid",
    OTHER: "Other",
};

function accountKindLabel(kind: string): string {
    return ACCOUNT_KIND_LABELS[kind] ?? kind;
}

function cardTypeLabel(type: string): string {
    return CARD_TYPE_LABELS[type] ?? type;
}

function isClosed(closedAt: string | null): boolean {
    return Boolean(closedAt && closedAt <= new Date().toISOString().slice(0, 10));
}

function dateRange(openedAt: string | null, closedAt: string | null): string {
    if (!openedAt && !closedAt) return "No dates";
    if (closedAt) return `${openedAt ? formatDateOnly(openedAt) : "Opened unknown"} - ${formatDateOnly(closedAt)}`;
    return `Opened ${formatDateOnly(openedAt)}`;
}

function expiration(month: number | null, year: number | null): string | null {
    if (!month && !year) return null;
    const mm = month ? String(month).padStart(2, "0") : "--";
    return `${mm}/${year ?? "----"}`;
}

function pct(value: number | null): string {
    return value == null ? "—" : `${value.toFixed(2).replace(/\.?0+$/, "")}%`;
}

function linkedContactCount(inst: InstitutionRow): number {
    return inst.phones.length + inst.emails.length + inst.people.length;
}

export function InstitutionsClient({ institutions }: { institutions: InstitutionRow[] }) {
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<InstitutionRow | null>(null);
    const [expanded, setExpanded] = useState<string | null>(null);
    const { confirm, dialog } = useConfirm();

    function openCreate() {
        setEditing(null);
        setOpen(true);
    }
    function openEdit(row: InstitutionRow) {
        setEditing(row);
        setOpen(true);
    }

    async function onSubmit(fd: FormData) {
        try {
            if (editing) await updateInstitution(fd);
            else await createInstitution(fd);
            toast.success(editing ? "Institution updated" : "Institution added");
            setOpen(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        }
    }

    function onDelete(row: InstitutionRow) {
        const linked = row.accounts.length + row.cards.length;
        confirm({
            title: `Delete ${row.name}?`,
            description:
                linked > 0
                    ? `This institution is linked to ${row.accounts.length} account(s) and ${row.cards.length} card(s). They will be unlinked but not deleted.`
                    : "This removes the institution and all its contacts.",
            confirmLabel: "Delete",
            onConfirm: async () => {
                const fd = new FormData();
                fd.set("id", row.id);
                try {
                    await deleteInstitution(fd);
                    toast.success("Deleted");
                } catch {
                    toast.error("Failed to delete");
                }
            },
        });
    }

    return (
        <div className="flex flex-col gap-6">
            <SectionHeader
                title="Institutions"
                description="Banks and card issuers, with contacts, linked accounts, and linked cards."
                action={
                    <Button size="md" iconLeading={Plus} onClick={openCreate}>
                        Add institution
                    </Button>
                }
            />

            <TableCard minWidth={860}>
                <thead>
                    <tr className="border-b border-secondary text-left text-tertiary">
                        <th className="px-5 py-3 font-medium">Institution</th>
                        <th className="px-5 py-3 font-medium">Contacts</th>
                        <th className="px-5 py-3 font-medium">Linked products</th>
                        <th className="px-5 py-3" />
                    </tr>
                </thead>
                <tbody>
                    {institutions.length === 0 && (
                        <EmptyRow
                            colSpan={4}
                            icon={Bank}
                            title="Keep your banks and issuers organized"
                            description="Save institutions with labeled phone numbers, emails and contacts, then link them to accounts and cards."
                            action={
                                <Button size="sm" iconLeading={Plus} onClick={openCreate}>
                                    Add institution
                                </Button>
                            }
                        />
                    )}
                    {institutions.map((inst) => {
                        const isOpen = expanded === inst.id;
                        const contactCount = linkedContactCount(inst);
                        return (
                            <Fragment key={inst.id}>
                                <tr className="border-b border-secondary last:border-0">
                                    <td className="px-5 py-3">
                                        <button
                                            type="button"
                                            onClick={() => setExpanded(isOpen ? null : inst.id)}
                                            className="flex items-center gap-2 text-left font-medium text-primary hover:text-brand-secondary"
                                            aria-expanded={isOpen}
                                        >
                                            <ChevronDown aria-hidden="true" className={cx("size-4 text-fg-quaternary transition-transform", isOpen && "rotate-180")} />
                                            <InstitutionLogo src={institutionLogoSrc(inst)} name={inst.name} />
                                            {inst.name}
                                        </button>
                                        {inst.website && (
                                            <a
                                                href={inst.website}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="ml-6 inline-flex max-w-80 items-center gap-1 truncate text-xs text-tertiary hover:text-brand-secondary"
                                            >
                                                <Globe01 className="size-3 shrink-0" /> {inst.website.replace(/^https?:\/\//, "")}
                                            </a>
                                        )}
                                    </td>
                                    <td className="px-5 py-3 text-tertiary">
                                        <div className="flex flex-col gap-0.5">
                                            <span className="font-medium text-secondary">
                                                {contactCount === 0 ? "No contacts" : `${contactCount} contact${contactCount === 1 ? "" : "s"}`}
                                            </span>
                                            <span className="text-xs">
                                                {inst.phones[0]?.phone || inst.emails[0]?.email || inst.people[0]?.name || "Add phone, email, or person"}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-5 py-3">
                                        <div className="flex flex-wrap gap-1">
                                            <Badge size="sm" color="gray">
                                                {inst.accounts.length} {inst.accounts.length === 1 ? "account" : "accounts"}
                                            </Badge>
                                            <Badge size="sm" color="gray">
                                                {inst.cards.length} {inst.cards.length === 1 ? "card" : "cards"}
                                            </Badge>
                                        </div>
                                    </td>
                                    <td className="px-5 py-3">
                                        <div className="flex justify-end gap-1">
                                            <Button size="sm" color="tertiary" iconLeading={Edit01} onClick={() => openEdit(inst)} aria-label="Edit" />
                                            <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} onClick={() => onDelete(inst)} aria-label="Delete" />
                                        </div>
                                    </td>
                                </tr>
                                {isOpen && (
                                    <tr className="border-b border-secondary last:border-0">
                                        <td colSpan={4} className="bg-secondary px-5 py-4">
                                            <InstitutionDetail inst={inst} />
                                        </td>
                                    </tr>
                                )}
                            </Fragment>
                        );
                    })}
                </tbody>
            </TableCard>

            <FormModal isOpen={open} onOpenChange={setOpen} title={editing ? "Edit institution" : "Add institution"}>
                <form action={onSubmit} className="flex flex-col gap-4" encType="multipart/form-data">
                    {editing && <input type="hidden" name="id" value={editing.id} />}
                    <InstitutionFormFields
                        key={editing?.id ?? "new"}
                        initial={
                            editing
                                ? {
                                      name: editing.name,
                                      website: editing.website ?? "",
                                      notes: editing.notes ?? "",
                                      logoKey: editing.logoKey ?? null,
                                      phones: editing.phones.map((p) => ({ label: p.label, phone: p.phone })),
                                      emails: editing.emails.map((e) => ({ label: e.label, email: e.email })),
                                      people: editing.people.map((p) => ({
                                          name: p.name,
                                          role: p.role ?? "",
                                          phone: p.phone ?? "",
                                          email: p.email ?? "",
                                          notes: p.notes ?? "",
                                      })),
                                  }
                                : undefined
                        }
                    />
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="submit">{editing ? "Save" : "Add"}</Button>
                    </div>
                </form>
            </FormModal>

            {dialog}
        </div>
    );
}

function InstitutionDetail({ inst }: { inst: InstitutionRow }) {
    return (
        <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                <ContactPanel inst={inst} />
                <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
                    <AccountsPanel accounts={inst.accounts} />
                    <CardsPanel cards={inst.cards} />
                </div>
            </div>
        </div>
    );
}

function ContactPanel({ inst }: { inst: InstitutionRow }) {
    const hasContactInfo = inst.phones.length > 0 || inst.emails.length > 0 || inst.people.length > 0 || Boolean(inst.notes);
    return (
        <DetailPanel title="Contacts" icon={Users01} count={linkedContactCount(inst)}>
            {!hasContactInfo && <p className="text-sm text-tertiary">No phones, emails, people, or notes for this institution yet.</p>}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-1">
                {inst.phones.length > 0 && (
                    <ContactGroup title="Phones">
                        {inst.phones.map((p) => (
                            <a key={p.id} href={`tel:${p.phone}`} className="flex items-center gap-2 text-sm text-secondary hover:text-brand-secondary">
                                <Phone className="size-3.5 shrink-0 text-fg-quaternary" />
                                <span className="shrink-0 text-tertiary">{p.label}:</span>
                                <span className="truncate">{p.phone}</span>
                            </a>
                        ))}
                    </ContactGroup>
                )}

                {inst.emails.length > 0 && (
                    <ContactGroup title="Emails">
                        {inst.emails.map((e) => (
                            <a key={e.id} href={`mailto:${e.email}`} className="flex min-w-0 items-center gap-2 text-sm text-secondary hover:text-brand-secondary">
                                <Mail01 className="size-3.5 shrink-0 text-fg-quaternary" />
                                <span className="shrink-0 text-tertiary">{e.label}:</span>
                                <span className="truncate">{e.email}</span>
                            </a>
                        ))}
                    </ContactGroup>
                )}
            </div>

            {inst.people.length > 0 && (
                <ContactGroup title="People">
                    <div className="flex flex-col gap-2">
                        {inst.people.map((p) => (
                            <div key={p.id} className="rounded-lg bg-primary p-3 ring-1 ring-secondary ring-inset">
                                <div className="flex flex-wrap items-center gap-2">
                                    <User01 className="size-3.5 text-fg-quaternary" />
                                    <span className="text-sm font-medium text-primary">{p.name}</span>
                                    {p.role && (
                                        <Badge size="sm" color="brand">
                                            {p.role}
                                        </Badge>
                                    )}
                                </div>
                                <div className="mt-2 flex flex-col gap-1">
                                    {p.phone && (
                                        <a href={`tel:${p.phone}`} className="inline-flex items-center gap-2 text-sm text-secondary hover:text-brand-secondary">
                                            <Phone className="size-3.5 text-fg-quaternary" /> {p.phone}
                                        </a>
                                    )}
                                    {p.email && (
                                        <a href={`mailto:${p.email}`} className="inline-flex min-w-0 items-center gap-2 text-sm text-secondary hover:text-brand-secondary">
                                            <Mail01 className="size-3.5 shrink-0 text-fg-quaternary" />
                                            <span className="truncate">{p.email}</span>
                                        </a>
                                    )}
                                    {p.notes && <p className="text-xs whitespace-pre-wrap text-tertiary">{p.notes}</p>}
                                </div>
                            </div>
                        ))}
                    </div>
                </ContactGroup>
            )}

            {inst.notes && (
                <ContactGroup title="Institution notes">
                    <p className="text-sm whitespace-pre-wrap text-tertiary">{inst.notes}</p>
                </ContactGroup>
            )}
        </DetailPanel>
    );
}

function AccountsPanel({ accounts }: { accounts: InstitutionAccountRow[] }) {
    return (
        <DetailPanel title="Accounts" icon={Bank} count={accounts.length}>
            {accounts.length === 0 && <p className="text-sm text-tertiary">No accounts linked to this institution.</p>}
            <div className="flex flex-col gap-3">
                {accounts.map((account) => (
                    <AccountItem key={account.id} account={account} />
                ))}
            </div>
        </DetailPanel>
    );
}

function CardsPanel({ cards }: { cards: InstitutionCardRow[] }) {
    return (
        <DetailPanel title="Cards" icon={CreditCard02} count={cards.length}>
            {cards.length === 0 && <p className="text-sm text-tertiary">No cards linked to this institution.</p>}
            <div className="flex flex-col gap-3">
                {cards.map((card) => (
                    <CardItem key={card.id} card={card} />
                ))}
            </div>
        </DetailPanel>
    );
}

function AccountItem({ account }: { account: InstitutionAccountRow }) {
    const closed = isClosed(account.closedAt);
    const accountLabel = account.nickname || accountKindLabel(account.kind);
    return (
        <div className="rounded-lg bg-primary p-3 ring-1 ring-secondary ring-inset">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <Link href={`/financial/accounts/${account.id}`} className="inline-flex min-w-0 items-center gap-1.5 font-medium text-primary hover:text-brand-secondary">
                        <span className="truncate">{accountLabel}</span>
                        <ArrowUpRight className="size-3.5 shrink-0" aria-hidden="true" />
                    </Link>
                    <p className="text-xs text-tertiary">
                        {accountKindLabel(account.kind)}
                        {account.last4 ? ` ••••${account.last4}` : ""}
                    </p>
                </div>
                <StatusBadges closed={closed} archived={account.archived} extra={!closed && !account.includeInNetWorth ? "Excluded" : account.kind === "LOAN" || !account.isAsset ? "Liability" : "Asset"} />
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 text-xs">
                <DetailLine label="Balance" value={formatCurrency(account.currentBalance, account.currency)} strong />
                <DetailLine label="Last updated" value={formatDate(account.lastBalanceAt)} />
                <DetailLine label="Dates" value={dateRange(account.openedAt, account.closedAt)} />
                <DetailLine
                    label="Activity"
                    value={
                        <Link href={`/financial/transactions?account=${account.id}`} className="text-brand-secondary hover:underline">
                            {account.transactionCount} {account.transactionCount === 1 ? "Transaction" : "Transactions"}
                        </Link>
                    }
                    sub={`${account.statementCount} ${account.statementCount === 1 ? "Statement" : "Statements"}`}
                />
                <DetailLine label="Account ending" value={account.last4 ? <span className="font-mono tabular-nums">•••• {account.last4}</span> : "—"} />
                {account.branchLocation && <DetailLine label="Branch" value={account.branchLocation} />}
            </div>

            <OwnersList owners={account.owners} />
        </div>
    );
}

function CardItem({ card }: { card: InstitutionCardRow }) {
    const closed = isClosed(card.closedAt);
    const cardLabel = card.nickname || card.productName || `${cardTypeLabel(card.cardType)} card`;
    return (
        <div className="rounded-lg bg-primary p-3 ring-1 ring-secondary ring-inset">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <Link href={`/financial/cards/${card.id}`} className="inline-flex min-w-0 items-center gap-1.5 font-medium text-primary hover:text-brand-secondary">
                        <span className="truncate">{cardLabel}</span>
                        <ArrowUpRight className="size-3.5 shrink-0" aria-hidden="true" />
                    </Link>
                    <p className="text-xs text-tertiary">
                        {cardTypeLabel(card.cardType)}
                        {card.last4 ? ` ••••${card.last4}` : ""}
                        {expiration(card.expMonth, card.expYear) ? ` • Exp ${expiration(card.expMonth, card.expYear)}` : ""}
                    </p>
                </div>
                <StatusBadges closed={closed} archived={card.archived} extra={card.paymentOverdue && !closed ? "Overdue" : undefined} />
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 text-xs">
                <DetailLine label="Balance" value={formatCurrency(card.currentBalance)} strong />
                <DetailLine label="Credit limit" value={card.creditLimit == null ? "—" : formatCurrency(card.creditLimit)} />
                <DetailLine label="Card ending" value={card.last4 ? <span className="font-mono tabular-nums">•••• {card.last4}</span> : "—"} />
                <DetailLine label="APR" value={pct(card.apr)} />
                <DetailLine label="Due date" value={card.paymentDueAt ? formatDateOnly(card.paymentDueAt) : "—"} sub={card.minimumPayment == null ? undefined : `Minimum ${formatCurrency(card.minimumPayment)}`} />
                <DetailLine label="Statement balance" value={card.lastStatementBalance == null ? "—" : formatCurrency(card.lastStatementBalance)} />
                <DetailLine label="Dates" value={dateRange(card.openedAt, card.closedAt)} />
                <DetailLine
                    label="Activity"
                    value={
                        <Link href={`/financial/transactions?account=${card.id}`} className="text-brand-secondary hover:underline">
                            {card.transactionCount} {card.transactionCount === 1 ? "Transaction" : "Transactions"}
                        </Link>
                    }
                    sub={`${card.statementCount} ${card.statementCount === 1 ? "Statement" : "Statements"}`}
                />
            </div>

            <OwnersList owners={card.owners} />
        </div>
    );
}

function DetailPanel({
    title,
    icon: Icon,
    count,
    children,
}: {
    title: string;
    icon: typeof Bank;
    count: number;
    children: React.ReactNode;
}) {
    return (
        <Card className="flex min-w-0 flex-col gap-3 p-4">
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <Icon className="size-4 text-fg-quaternary" aria-hidden="true" />
                    <h3 className="text-sm font-semibold text-primary">{title}</h3>
                </div>
                <Badge size="sm" color="gray">
                    {count}
                </Badge>
            </div>
            {children}
        </Card>
    );
}

function ContactGroup({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="flex min-w-0 flex-col gap-1.5">
            <p className="text-xs font-medium tracking-wide text-quaternary uppercase">{title}</p>
            {children}
        </div>
    );
}

function DetailLine({
    label,
    value,
    sub,
    strong = false,
}: {
    label: string;
    value: React.ReactNode;
    sub?: React.ReactNode;
    strong?: boolean;
}) {
    return (
        <div className="min-w-0 rounded-md bg-secondary_subtle px-2.5 py-2">
            <p className="text-[11px] font-medium text-tertiary">{label}</p>
            <div className={cx("mt-0.5 min-w-0 break-words text-secondary", strong && "font-semibold text-primary")}>{value}</div>
            {sub && <p className="mt-0.5 break-words text-[11px] text-tertiary">{sub}</p>}
        </div>
    );
}

function OwnersList({ owners }: { owners: OwnerSummary[] }) {
    return (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-secondary pt-3">
            {owners.length === 0 ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-tertiary">
                    <Users01 className="size-3.5" aria-hidden="true" />
                    No linked contacts
                </span>
            ) : (
                owners.map((owner) => (
                    <Link
                        key={owner.id}
                        href={`/social/contacts/${owner.id}`}
                        className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-secondary px-2 py-1 text-xs font-medium text-secondary ring-1 ring-secondary ring-inset hover:text-brand-secondary"
                    >
                        {owner.avatarUrl ? (
                            <img src={owner.avatarUrl} alt="" className="size-4 rounded-full object-cover" />
                        ) : (
                            <span className="flex size-4 items-center justify-center rounded-full bg-quaternary text-[10px] text-tertiary">
                                {owner.name.slice(0, 1).toUpperCase()}
                            </span>
                        )}
                        <span className="truncate">{owner.name}</span>
                    </Link>
                ))
            )}
        </div>
    );
}

function StatusBadges({ closed, archived, extra }: { closed: boolean; archived: boolean; extra?: string }) {
    if (closed) {
        return (
            <Badge size="sm" color="gray">
                Closed
            </Badge>
        );
    }
    return (
        <div className="flex flex-wrap justify-end gap-1">
            {extra && (
                <Badge size="sm" color={extra === "Overdue" || extra === "Liability" ? "error" : extra === "Asset" ? "success" : "gray"}>
                    {extra}
                </Badge>
            )}
            {archived && (
                <Badge size="sm" color="gray">
                    Archived
                </Badge>
            )}
        </div>
    );
}
