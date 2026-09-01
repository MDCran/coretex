"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Archive, Bank, Edit01, Eye, Plus, RefreshCw01, SearchRefraction, Trash02, X } from "@untitledui/icons";
import { toast } from "sonner";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { createFinAccount, deleteFinAccount, setFinAccountArchived, updateFinAccount } from "@/lib/actions/financial-accounts";
import { formatCurrency, formatDate } from "@/lib/financial/format";
import { formatDateOnly } from "@/lib/dates";
import { AccountKindSelect } from "../_components/account-kind-select";
import { Card, EmptyRow, Field, NativeInput, NativeSelect, NativeTextarea, SectionHeader, Stat, TableCard, TableHeaderHelp } from "../_components/financial-ui";
import { FormModal } from "../_components/form-modal";
import { useConfirm } from "../_components/confirm-modal";
import { InstitutionSelect, type InstitutionOption } from "../_components/institution-select";
import { InstitutionLogo } from "../_components/institution-logo";
import { institutionLogoSrc } from "@/lib/financial/institution-logos";
import { OwnerMultiSelect, type OwnerOption } from "../_components/owner-multi-select";

export interface AccountRow {
    id: string;
    kind: string;
    institution: string | null;
    institutionId: string | null;
    nickname: string | null;
    branchLocation: string | null;
    openedAt: string | null;
    closedAt: string | null;
    last4: string | null;
    currentBalance: number;
    lastBalanceAt: string | null;
    isAsset: boolean;
    includeInNetWorth: boolean;
    notes: string | null;
    archived: boolean;
    owners: OwnerOption[];
    transactionCount: number;
    statementCount: number;
}

// Create UI excludes LOAN (legacy). Existing LOAN rows still render fine.
const KINDS = [
    { value: "CHECKING", label: "Checking" },
    { value: "SAVINGS", label: "Savings" },
    { value: "MONEY_MARKET", label: "Money market" },
    { value: "CD", label: "Certificate of deposit (CD)" },
    { value: "BROKERAGE", label: "Brokerage" },
    { value: "OTHER", label: "Other" },
];

function kindLabel(k: string) {
    if (k === "LOAN") return "Loan";
    return KINDS.find((x) => x.value === k)?.label ?? k;
}

function isClosedAccount(closedAt: string | null): boolean {
    if (!closedAt) return false;
    return closedAt <= new Date().toISOString().slice(0, 10);
}

export function AccountsClient({ accounts, institutions, contacts }: { accounts: AccountRow[]; institutions: InstitutionOption[]; contacts: OwnerOption[] }) {
    const institutionById = useMemo(() => new Map(institutions.map((i) => [i.id, i])), [institutions]);
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<AccountRow | null>(null);
    const [search, setSearch] = useState("");
    const [kindFilter, setKindFilter] = useState("");
    const { confirm, dialog } = useConfirm();

    const totals = useMemo(() => {
        const active = accounts.filter((a) => !a.archived);
        let assets = 0;
        let liabilities = 0;
        for (const a of active) {
            if (!a.includeInNetWorth) continue;
            if (a.kind === "LOAN" || !a.isAsset) liabilities += Math.abs(a.currentBalance);
            else assets += a.currentBalance;
        }
        return { assets, liabilities, net: assets - liabilities };
    }, [accounts]);

    const filteredAccounts = useMemo(() => {
        const q = search.trim().toLowerCase();
        return accounts.filter((a) => {
            if (kindFilter && a.kind !== kindFilter) return false;
            if (!q) return true;
            const haystack = [
                a.nickname,
                a.institution,
                kindLabel(a.kind),
                a.last4,
                a.branchLocation,
                a.openedAt,
                a.closedAt,
                a.owners.map((o) => o.name).join(" "),
                isClosedAccount(a.closedAt) ? "closed" : null,
                a.archived ? "archived" : "active",
                a.isAsset ? "asset" : "liability",
            ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();
            return haystack.includes(q);
        });
    }, [accounts, kindFilter, search]);
    const hasAccountFilters = Boolean(search || kindFilter);

    function openCreate() {
        setEditing(null);
        setOpen(true);
    }
    function openEdit(row: AccountRow) {
        setEditing(row);
        setOpen(true);
    }

    async function onSubmit(fd: FormData) {
        try {
            if (editing) await updateFinAccount(fd);
            else await createFinAccount(fd);
            toast.success(editing ? "Account updated" : "Account added");
            setOpen(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        }
    }
    async function onArchive(row: AccountRow) {
        const fd = new FormData();
        fd.set("id", row.id);
        fd.set("archived", row.archived ? "false" : "true");
        try {
            await setFinAccountArchived(fd);
            toast.success(row.archived ? "Restored" : "Archived");
        } catch {
            toast.error("Failed");
        }
    }
    function onDelete(id: string) {
        confirm({
            title: "Delete account?",
            description: "This deletes the account and all of its transactions and statements. This can’t be undone.",
            confirmLabel: "Delete",
            onConfirm: async () => {
                const fd = new FormData();
                fd.set("id", id);
                try {
                    await deleteFinAccount(fd);
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
                title="Accounts"
                description="Bank accounts that feed your net worth."
                action={
                    <Button size="md" iconLeading={Plus} onClick={openCreate}>
                        Add account
                    </Button>
                }
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Stat label="Assets" value={formatCurrency(totals.assets)} tone="success" />
                <Stat label="Liabilities" value={formatCurrency(totals.liabilities)} tone="error" />
                <Stat label="Net" value={formatCurrency(totals.net)} />
            </div>

            <Card className="flex flex-col gap-3">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
                    <Field label="Search accounts">
                        <NativeInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Bank, nickname, owner, last 4..." />
                    </Field>
                    <Field label="Type">
                        <NativeSelect value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
                            <option value="">All types</option>
                            {KINDS.map((k) => (
                                <option key={k.value} value={k.value}>
                                    {k.label}
                                </option>
                            ))}
                            <option value="LOAN">Loan</option>
                        </NativeSelect>
                    </Field>
                </div>
                {hasAccountFilters && (
                    <div>
                        <Button
                            size="sm"
                            color="link-gray"
                            iconLeading={X}
                            onClick={() => {
                                setSearch("");
                                setKindFilter("");
                            }}
                        >
                            Clear filters
                        </Button>
                    </div>
                )}
            </Card>

            <TableCard minWidth={1080}>
                <thead>
                    <tr className="border-b border-secondary text-left text-tertiary">
                        <th className="px-5 py-3 font-medium">
                            <TableHeaderHelp label="Account" help="The nickname, institution logo, bank name, and last four digits when available." />
                        </th>
                        <th className="px-5 py-3 font-medium">
                            <TableHeaderHelp label="Type" help="Checking, savings, brokerage, loan, or another account type used for reporting and net worth." />
                        </th>
                        <th className="px-5 py-3 font-medium">
                            <TableHeaderHelp label="Dates" help="Opening and closing dates for this account." />
                        </th>
                        <th className="px-5 py-3 font-medium">
                            <TableHeaderHelp label="Owners" help="People linked to this account for household tracking." />
                        </th>
                        <th className="px-5 py-3 font-medium">
                            <TableHeaderHelp label="Balance" help="Latest derived balance from statements, Plaid sync, holdings, or transactions." />
                        </th>
                        <th className="px-5 py-3 font-medium">
                            <TableHeaderHelp label="Activity" help="Counts of linked transactions and statement files. Click transactions to search this account." />
                        </th>
                        <th className="px-5 py-3 font-medium">
                            <TableHeaderHelp label="Flags" help="Asset/liability status, net-worth exclusion, and archived state." />
                        </th>
                        <th className="px-5 py-3" />
                    </tr>
                </thead>
                <tbody>
                    {accounts.length === 0 && (
                        <EmptyRow
                            colSpan={8}
                            icon={Bank}
                            title="Add your first account"
                            description="Checking, savings, loans and brokerage accounts feed straight into your net worth and cashflow."
                            action={
                                <Button size="sm" iconLeading={Plus} onClick={openCreate}>
                                    Add account
                                </Button>
                            }
                        />
                    )}
                    {accounts.length > 0 && filteredAccounts.length === 0 && (
                        <EmptyRow
                            colSpan={8}
                            icon={SearchRefraction}
                            title="No accounts match these filters"
                            description="Try searching by bank, owner, nickname, last four, or account type."
                            action={
                                <Button
                                    size="sm"
                                    color="secondary"
                                    iconLeading={X}
                                    onClick={() => {
                                        setSearch("");
                                        setKindFilter("");
                                    }}
                                >
                                    Clear filters
                                </Button>
                            }
                        />
                    )}
                    {filteredAccounts.map((a) => (
                        <tr key={a.id} className="border-b border-secondary last:border-0">
                            <td className="px-5 py-3">
                                <div className="flex items-center gap-2.5">
                                    {a.institutionId && institutionById.get(a.institutionId) && (
                                        <InstitutionLogo
                                            src={institutionLogoSrc(institutionById.get(a.institutionId)!)}
                                            name={a.institution ?? "Institution"}
                                        />
                                    )}
                                    <div>
                                        <Link href={`/financial/accounts/${a.id}`} className="font-medium text-primary hover:text-brand-secondary">
                                            {a.nickname || a.institution || "Account"}
                                        </Link>
                                        <p className="text-xs text-tertiary">
                                            {a.institution && a.nickname ? a.institution : ""} {a.last4 ? `••${a.last4}` : ""}
                                        </p>
                                    </div>
                                </div>
                            </td>
                            <td className="px-5 py-3 text-secondary">{kindLabel(a.kind)}</td>
                            <td className="px-5 py-3 text-tertiary">
                                <span className="block">Opened: {a.openedAt ? formatDateOnly(a.openedAt) : "-"}</span>
                                <span className="block">Closed: {a.closedAt ? formatDateOnly(a.closedAt) : "-"}</span>
                            </td>
                            <td className="px-5 py-3 text-tertiary">
                                {a.owners.length === 0 ? "—" : a.owners.map((o) => o.name).join(", ")}
                            </td>
                            <td className="px-5 py-3 font-medium text-primary">
                                {formatCurrency(a.currentBalance)}
                                <span className="block text-xs font-normal text-tertiary">{formatDate(a.lastBalanceAt)}</span>
                            </td>
                            <td className="px-5 py-3">
                                <Link href={`/financial/transactions?account=${a.id}`} className="font-medium text-brand-secondary hover:underline">
                                    {a.transactionCount} {a.transactionCount === 1 ? "Transaction" : "Transactions"}
                                </Link>
                                <p className="text-xs text-tertiary">
                                    {a.statementCount} {a.statementCount === 1 ? "Statement" : "Statements"}
                                </p>
                            </td>
                            <td className="px-5 py-3">
                                <div className="flex flex-wrap gap-1">
                                    {isClosedAccount(a.closedAt) ? (
                                        <Badge size="sm" color="gray">
                                            Closed
                                        </Badge>
                                    ) : (
                                        <>
                                            <Badge size="sm" color={a.kind === "LOAN" || !a.isAsset ? "error" : "success"}>
                                                {a.kind === "LOAN" || !a.isAsset ? "Liability" : "Asset"}
                                            </Badge>
                                            {!a.includeInNetWorth && (
                                                <Badge size="sm" color="gray">
                                                    Excluded
                                                </Badge>
                                            )}
                                            {a.archived && (
                                                <Badge size="sm" color="gray">
                                                    Archived
                                                </Badge>
                                            )}
                                        </>
                                    )}
                                </div>
                            </td>
                            <td className="px-5 py-3">
                                <div className="flex justify-end gap-1">
                                    <Button size="sm" color="tertiary" iconLeading={Eye} href={`/financial/accounts/${a.id}`} aria-label="View" />
                                    <Button size="sm" color="tertiary" iconLeading={Edit01} onClick={() => openEdit(a)} aria-label="Edit" />
                                    <Button size="sm" color="tertiary" iconLeading={a.archived ? RefreshCw01 : Archive} onClick={() => onArchive(a)} aria-label="Archive" />
                                    <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} onClick={() => onDelete(a.id)} aria-label="Delete" />
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </TableCard>

            <FormModal isOpen={open} onOpenChange={setOpen} title={editing ? "Edit account" : "Add account"}>
                <form action={onSubmit} className="flex flex-col gap-4" key={editing?.id ?? "new"}>
                    {editing && <input type="hidden" name="id" value={editing.id} />}
                    <AccountKindSelect defaultValue={editing?.kind ?? "CHECKING"} includeLoan={editing?.kind === "LOAN"} />

                    <InstitutionSelect institutions={institutions} defaultValue={editing?.institutionId ?? ""} />

                    <Field label="Nickname" htmlFor="nickname">
                        <NativeInput id="nickname" name="nickname" defaultValue={editing?.nickname ?? ""} placeholder="e.g. Main checking" />
                    </Field>
                    <Field label="Last 4 digits" htmlFor="last4" hint="Only these four display digits are stored.">
                        <NativeInput
                            id="last4"
                            name="last4"
                            defaultValue={editing?.last4 ?? ""}
                            inputMode="numeric"
                            maxLength={4}
                            pattern="[0-9]{4}"
                            placeholder="6789"
                        />
                    </Field>
                    <Field label="Branch location" htmlFor="branchLocation">
                        <NativeInput id="branchLocation" name="branchLocation" defaultValue={editing?.branchLocation ?? ""} placeholder="e.g. Downtown Seattle" />
                    </Field>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Field label="Opening date" htmlFor="openedAt">
                            <NativeInput id="openedAt" name="openedAt" type="date" defaultValue={editing?.openedAt ?? ""} />
                        </Field>
                        <Field label="Closing date" htmlFor="closedAt">
                            <NativeInput id="closedAt" name="closedAt" type="date" defaultValue={editing?.closedAt ?? ""} />
                        </Field>
                    </div>

                    <OwnerMultiSelect options={contacts} defaultSelectedIds={editing?.owners.map((o) => o.id) ?? []} />

                    <p className="rounded-lg bg-secondary px-3 py-2 text-xs text-tertiary">
                        Balance is derived automatically from the latest statement’s ending balance, or the sum of transactions. Upload a statement to set it.
                    </p>
                    <Checkbox name="includeInNetWorth" defaultSelected={editing ? editing.includeInNetWorth : true} label="Include in net worth" hint="Bank, CD and brokerage accounts are counted as assets by default." />
                    <Field label="Notes" htmlFor="notes">
                        <NativeTextarea id="notes" name="notes" defaultValue={editing?.notes ?? ""} />
                    </Field>
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
