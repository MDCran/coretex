"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Edit01, Plus, RefreshCw01, Trash02 } from "@untitledui/icons";
import { toast } from "sonner";
import { Button } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import {
    createFinAccount,
    deleteFinAccount,
    refreshFinAccountBalance,
    setFinAccountArchived,
    updateFinAccount,
} from "@/lib/actions/financial-accounts";
import { AccountKindSelect } from "../../_components/account-kind-select";
import { useConfirm } from "../../_components/confirm-modal";
import { Field, NativeInput, NativeTextarea } from "../../_components/financial-ui";
import { FormModal } from "../../_components/form-modal";
import { InstitutionSelect, type InstitutionOption } from "../../_components/institution-select";
import { OwnerMultiSelect, type OwnerOption } from "../../_components/owner-multi-select";

export interface AccountDetailFormValue {
    id: string;
    kind: string;
    institutionId: string | null;
    nickname: string | null;
    last4: string | null;
    branchLocation: string | null;
    openedAt: string | null;
    closedAt: string | null;
    includeInNetWorth: boolean;
    notes: string | null;
    archived: boolean;
    owners: OwnerOption[];
}

export function AccountDetailControls({
    account,
    institutions,
    contacts,
}: {
    account: AccountDetailFormValue;
    institutions: InstitutionOption[];
    contacts: OwnerOption[];
}) {
    const router = useRouter();
    const [mode, setMode] = useState<"create" | "edit" | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [archiving, setArchiving] = useState(false);
    const { confirm, dialog } = useConfirm();

    async function onSubmit(fd: FormData) {
        try {
            if (mode === "edit") {
                await updateFinAccount(fd);
                toast.success("Account updated");
            } else {
                const created = await createFinAccount(fd);
                toast.success("Account added");
                router.push(`/financial/accounts/${created.id}`);
            }
            setMode(null);
            router.refresh();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        }
    }

    async function onRefresh() {
        setRefreshing(true);
        try {
            const fd = new FormData();
            fd.set("id", account.id);
            const res = await refreshFinAccountBalance(fd);
            toast.success(`Balance refreshed: ${res.balance.toLocaleString()}`);
            router.refresh();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not refresh balance");
        } finally {
            setRefreshing(false);
        }
    }

    async function onArchive() {
        setArchiving(true);
        try {
            const fd = new FormData();
            fd.set("id", account.id);
            fd.set("archived", account.archived ? "false" : "true");
            await setFinAccountArchived(fd);
            toast.success(account.archived ? "Account restored" : "Account archived");
            router.refresh();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not update account");
        } finally {
            setArchiving(false);
        }
    }

    function onDelete() {
        confirm({
            title: "Delete account?",
            description: "This deletes the account, statements, and transactions attached to it. This cannot be undone.",
            confirmLabel: "Delete",
            onConfirm: async () => {
                const fd = new FormData();
                fd.set("id", account.id);
                await deleteFinAccount(fd);
                toast.success("Account deleted");
                router.push("/financial/accounts");
            },
        });
    }

    return (
        <>
            <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" color="secondary" iconLeading={Edit01} onClick={() => setMode("edit")}>
                    Edit
                </Button>
                <Button size="sm" color="secondary" iconLeading={Plus} onClick={() => setMode("create")}>
                    Add
                </Button>
                <Button size="sm" color="secondary" iconLeading={RefreshCw01} onClick={onRefresh} isLoading={refreshing}>
                    Refresh
                </Button>
                <Button size="sm" color="secondary" iconLeading={account.archived ? RefreshCw01 : Archive} onClick={onArchive} isLoading={archiving}>
                    {account.archived ? "Restore" : "Archive"}
                </Button>
                <Button size="sm" color="secondary-destructive" iconLeading={Trash02} onClick={onDelete}>
                    Delete
                </Button>
            </div>

            <FormModal isOpen={mode !== null} onOpenChange={(open) => !open && setMode(null)} title={mode === "edit" ? "Edit account" : "Add account"}>
                <form action={onSubmit} className="flex flex-col gap-4" key={mode ?? "closed"}>
                    {mode === "edit" && <input type="hidden" name="id" value={account.id} />}
                    <AccountKindSelect defaultValue={mode === "edit" ? account.kind : "CHECKING"} includeLoan={mode === "edit" && account.kind === "LOAN"} />
                    <InstitutionSelect institutions={institutions} defaultValue={mode === "edit" ? account.institutionId ?? "" : ""} />
                    <Field label="Nickname" htmlFor="nickname">
                        <NativeInput id="nickname" name="nickname" defaultValue={mode === "edit" ? account.nickname ?? "" : ""} placeholder="Main checking" />
                    </Field>
                    <Field label="Last 4 digits" htmlFor="last4" hint="Only these four display digits are stored.">
                        <NativeInput
                            id="last4"
                            name="last4"
                            defaultValue={mode === "edit" ? account.last4 ?? "" : ""}
                            inputMode="numeric"
                            maxLength={4}
                            pattern="[0-9]{4}"
                            placeholder="6789"
                        />
                    </Field>
                    <Field label="Branch location" htmlFor="branchLocation">
                        <NativeInput id="branchLocation" name="branchLocation" defaultValue={mode === "edit" ? account.branchLocation ?? "" : ""} />
                    </Field>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Field label="Opening date" htmlFor="openedAt">
                            <NativeInput id="openedAt" name="openedAt" type="date" defaultValue={mode === "edit" ? account.openedAt ?? "" : ""} />
                        </Field>
                        <Field label="Closing date" htmlFor="closedAt">
                            <NativeInput id="closedAt" name="closedAt" type="date" defaultValue={mode === "edit" ? account.closedAt ?? "" : ""} />
                        </Field>
                    </div>
                    <OwnerMultiSelect options={contacts} defaultSelectedIds={mode === "edit" ? account.owners.map((o) => o.id) : []} />
                    <Checkbox name="includeInNetWorth" defaultSelected={mode === "edit" ? account.includeInNetWorth : true} label="Include in net worth" />
                    <Field label="Notes" htmlFor="notes">
                        <NativeTextarea id="notes" name="notes" defaultValue={mode === "edit" ? account.notes ?? "" : ""} />
                    </Field>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setMode(null)}>
                            Cancel
                        </Button>
                        <Button type="submit">{mode === "edit" ? "Save" : "Add"}</Button>
                    </div>
                </form>
            </FormModal>
            {dialog}
        </>
    );
}
