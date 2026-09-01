// @ts-nocheck

import { InstitutionLogo } from "../_components/institution-logo";
import { FormModal } from "../_components/form-modal";
import { SectionHeader, Stat, Card, Field, NativeInput, NativeSelect, TableCard, TableHeaderHelp, EmptyRow, NativeTextarea } from "../_components/financial-ui";
import { useConfirm } from "../_components/confirm-modal";
import { AccountKindSelect } from "../_components/account-kind-select";
import { formatCurrency, formatDate } from "../../personal/personal-ui";
import { useLifeOSMutation } from "../../personal/use-lifeos-mutation";
import type { LifeOSClient } from "../../personal/use-lifeos-query";
import { toast } from "sonner";
import { Button, Checkbox } from "react-aria-components";
import { useMemo, useState } from "react";
import { Plus, X, Bank, SearchRefraction, Eye, Edit01, RefreshCw01, Archive, Trash02 } from "@untitledui/icons";
import { Badge } from "@/components/base/badges/badges";
import type { OwnerOption } from "../_components/owner-multi-select";

export interface AccountRow {
    id: string;
    kind: string;
    name: string;
    institution: string | null;
    institutionWebsite: string | null;
    openedAt: string | null;
    closedAt: string | null;
    last4: string | null;
    balance: number;
    lastUpdated: string | null;
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

export function AccountsClient({ accounts, client }: { accounts: AccountRow[]; client: LifeOSClient }) {
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<AccountRow | null>(null);
    const [search, setSearch] = useState("");
    const [kindFilter, setKindFilter] = useState("");
    const { confirm, dialog } = useConfirm();

    const { mutate: createAccount, pending: creating } = useLifeOSMutation(client, "financial:createAccount");
    const { mutate: updateAccount, pending: updating } = useLifeOSMutation(client, "financial:updateAccount");
    const { mutate: deleteAccountMutation } = useLifeOSMutation(client, "financial:deleteAccount");

    const totals = useMemo(() => {
        const active = accounts.filter((a) => !a.archived);
        let assets = 0;
        let liabilities = 0;
        for (const a of active) {
            if (!a.includeInNetWorth) continue;
            if (a.kind === "LOAN" || !a.isAsset) liabilities += Math.abs(a.balance);
            else assets += a.balance;
        }
        return { assets, liabilities, net: assets - liabilities };
    }, [accounts]);

    const filteredAccounts = useMemo(() => {
        const q = search.trim().toLowerCase();
        return accounts.filter((a) => {
            if (kindFilter && a.kind !== kindFilter) return false;
            if (!q) return true;
            const haystack = [
                a.name,
                a.institution,
                kindLabel(a.kind),
                a.last4,
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
        const payload = {
            kind: String(fd.get("kind") ?? "CHECKING"),
            nickname: String(fd.get("nickname") ?? ""),
            institution: String(fd.get("institution") ?? "") || undefined,
            last4: String(fd.get("last4") ?? "") || undefined,
            currentBalance: Number(fd.get("currentBalance") ?? 0),
            isAsset: fd.get("isAsset") === "true",
            includeInNetWorth: fd.get("includeInNetWorth") === "true",
            notes: String(fd.get("notes") ?? "") || undefined,
        };
        try {
            if (editing) await updateAccount({ id: editing.id, ...payload });
            else await createAccount(payload);
            toast.success(editing ? "Account updated" : "Account added");
            setOpen(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        }
    }
    async function onArchive(row: AccountRow) {
        try {
            await updateAccount({ id: row.id, archived: !row.archived });
            toast.success(row.archived ? "Restored" : "Archived");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed");
        }
    }
    function onDelete(id: string) {
        confirm({
            title: "Delete account?",
            description: "This deletes the account. Accounts with transaction or statement history can't be deleted — archive them instead.",
            confirmLabel: "Delete",
            onConfirm: async () => {
                try {
                    await deleteAccountMutation({ id });
                    toast.success("Deleted");
                } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Failed to delete");
                }
            },
        });
    }

    return (
        <div className="flex flex-col gap-6">
            <SectionHeader title="Accounts" description="Bank accounts that feed your net worth." />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Stat label="Assets" value={formatCurrency(totals.assets)} tone="success" />
                <Stat label="Liabilities" value={formatCurrency(totals.liabilities)} tone="error" />
                <Stat label="Net" value={formatCurrency(totals.net)} />
            </div>

            <Card className="flex flex-col gap-3">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto]">
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
                    <div className="flex items-end">
                        <Button size="md" iconLeading={Plus} onClick={openCreate} className="w-full md:w-auto">
                            Add account
                        </Button>
                    </div>
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
                            <TableHeaderHelp label="Activity" help="Counts of linked transactions and statement files." />
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
                                    {a.institution && (
                                        <InstitutionLogo institution={{ name: a.institution, website: a.institutionWebsite }} />
                                    )}
                                    <div>
                                        <button type="button" onClick={() => openEdit(a)} className="text-left font-medium text-primary hover:text-brand-secondary hover:underline">
                                            {a.name || a.institution || "Account"}
                                        </button>
                                        <p className="text-xs text-tertiary">
                                            {a.institution && a.name !== a.institution ? a.institution : ""} {a.last4 ? `••${a.last4}` : ""}
                                        </p>
                                    </div>
                                </div>
                            </td>
                            <td className="px-5 py-3 text-secondary">{kindLabel(a.kind)}</td>
                            <td className="px-5 py-3 text-tertiary">
                                <span className="block">Opened: {a.openedAt ? formatDate(a.openedAt) : "-"}</span>
                                <span className="block">Closed: {a.closedAt ? formatDate(a.closedAt) : "-"}</span>
                            </td>
                            <td className="px-5 py-3 text-tertiary">
                                {a.owners.length === 0 ? "—" : a.owners.map((o) => o.name).join(", ")}
                            </td>
                            <td className="px-5 py-3 font-medium text-primary">
                                {formatCurrency(a.balance)}
                                <span className="block text-xs font-normal text-tertiary">{formatDate(a.lastUpdated)}</span>
                            </td>
                            <td className="px-5 py-3">
                                <span>
                                    {a.transactionCount} {a.transactionCount === 1 ? "Transaction" : "Transactions"}
                                </span>
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
                    <AccountKindSelect defaultValue={editing?.kind ?? "CHECKING"} includeLoan={editing?.kind === "LOAN"} />

                    <Field label="Nickname" htmlFor="nickname">
                        <NativeInput id="nickname" name="nickname" defaultValue={editing?.name ?? ""} placeholder="e.g. Main checking" />
                    </Field>
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Institution" htmlFor="institution">
                            <NativeInput id="institution" name="institution" defaultValue={editing?.institution ?? ""} placeholder="e.g. Chase" />
                        </Field>
                        <Field label="Last 4 digits" htmlFor="last4">
                            <NativeInput id="last4" name="last4" defaultValue={editing?.last4 ?? ""} placeholder="1234" maxLength={4} />
                        </Field>
                    </div>
                    <Field label="Current balance" htmlFor="currentBalance">
                        <NativeInput id="currentBalance" name="currentBalance" type="number" step="0.01" defaultValue={editing?.balance ?? ""} placeholder="0.00" />
                    </Field>

                    <p className="rounded-lg bg-secondary px-3 py-2 text-xs text-tertiary">
                        The balance you enter here is a manual override — uploading a statement will update it from the ending balance instead.
                    </p>
                    <Checkbox name="isAsset" value="true" defaultSelected={editing ? editing.isAsset : true} label="This is an asset" hint="Turn off for loans or other liabilities." />
                    <Checkbox name="includeInNetWorth" value="true" defaultSelected={editing ? editing.includeInNetWorth : true} label="Include in net worth" hint="Bank, CD and brokerage accounts are counted by default." />
                    <Field label="Notes" htmlFor="notes">
                        <NativeTextarea id="notes" name="notes" defaultValue={editing?.notes ?? ""} />
                    </Field>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="submit" isLoading={creating || updating}>{editing ? "Save" : "Add"}</Button>
                    </div>
                </form>
            </FormModal>

            {dialog}
        </div>
    );
}
