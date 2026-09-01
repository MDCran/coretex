"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Edit01, Plus, RefreshCw01, Trash02 } from "@untitledui/icons";
import { toast } from "sonner";
import { Button } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import {
    createCreditCard,
    deleteCreditCard,
    refreshCreditCardBalance,
    setCreditCardArchived,
    updateCreditCard,
} from "@/lib/actions/financial-cards";
import { formatCurrency } from "@/lib/financial/format";
import { useConfirm } from "../../_components/confirm-modal";
import { Field, NativeInput, NativeSelect, NativeTextarea } from "../../_components/financial-ui";
import { FormModal } from "../../_components/form-modal";
import { InstitutionSelect, type InstitutionOption } from "../../_components/institution-select";
import { OwnerMultiSelect, type OwnerOption } from "../../_components/owner-multi-select";
import { CARD_STYLE_OPTIONS } from "../card-preview";

const CARD_TYPES = [
    { value: "CREDIT", label: "Credit" },
    { value: "DEBIT", label: "Debit" },
    { value: "CHARGE", label: "Charge" },
    { value: "PREPAID", label: "Prepaid" },
    { value: "OTHER", label: "Other" },
];

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const YEARS = Array.from({ length: 16 }, (_, i) => new Date().getFullYear() + i);

export interface CardDetailFormValue {
    id: string;
    institutionId: string | null;
    nickname: string | null;
    cardType: string;
    productName: string | null;
    last4: string | null;
    expMonth: number | null;
    expYear: number | null;
    branchLocation: string | null;
    openedAt: string | null;
    closedAt: string | null;
    apr: number | null;
    creditLimit: number | null;
    cardStyle: string | null;
    cardImageUrl: string | null;
    minimumPayment: number | null;
    paymentDueAt: string | null;
    paymentOverdue: boolean;
    lastPaymentAmount: number | null;
    lastStatementBalance: number | null;
    rewardsNotes: string | null;
    notes: string | null;
    archived: boolean;
    owners: OwnerOption[];
}

export function CardDetailControls({
    card,
    institutions,
    contacts,
}: {
    card: CardDetailFormValue;
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
                await updateCreditCard(fd);
                toast.success("Card updated");
            } else {
                const created = await createCreditCard(fd);
                toast.success("Card added");
                router.push(`/financial/cards/${created.id}`);
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
            fd.set("id", card.id);
            const res = await refreshCreditCardBalance(fd);
            toast.success(`Balance refreshed: ${formatCurrency(res.balance)}`);
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
            fd.set("id", card.id);
            fd.set("archived", card.archived ? "false" : "true");
            await setCreditCardArchived(fd);
            toast.success(card.archived ? "Card restored" : "Card archived");
            router.refresh();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not update card");
        } finally {
            setArchiving(false);
        }
    }

    function onDelete() {
        confirm({
            title: "Delete card?",
            description: "This deletes the card, number history, statements, and transactions attached to it. This cannot be undone.",
            confirmLabel: "Delete",
            onConfirm: async () => {
                const fd = new FormData();
                fd.set("id", card.id);
                await deleteCreditCard(fd);
                toast.success("Card deleted");
                router.push("/financial/cards");
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
                <Button size="sm" color="secondary" iconLeading={card.archived ? RefreshCw01 : Archive} onClick={onArchive} isLoading={archiving}>
                    {card.archived ? "Restore" : "Archive"}
                </Button>
                <Button size="sm" color="secondary-destructive" iconLeading={Trash02} onClick={onDelete}>
                    Delete
                </Button>
            </div>

            <FormModal isOpen={mode !== null} onOpenChange={(open) => !open && setMode(null)} title={mode === "edit" ? "Edit card" : "Add card"}>
                <form action={onSubmit} className="flex flex-col gap-4" key={mode ?? "closed"}>
                    {mode === "edit" && <input type="hidden" name="id" value={card.id} />}

                    <InstitutionSelect institutions={institutions} defaultValue={mode === "edit" ? card.institutionId ?? "" : ""} />
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Field label="Nickname" htmlFor="nickname">
                            <NativeInput id="nickname" name="nickname" defaultValue={mode === "edit" ? card.nickname ?? "" : ""} placeholder="Travel card" />
                        </Field>
                        <Field label="Card type" htmlFor="cardType">
                            <NativeSelect id="cardType" name="cardType" defaultValue={mode === "edit" ? card.cardType : "CREDIT"}>
                                {CARD_TYPES.map((t) => (
                                    <option key={t.value} value={t.value}>
                                        {t.label}
                                    </option>
                                ))}
                            </NativeSelect>
                        </Field>
                    </div>
                    <Field label="Product name" htmlFor="productName">
                        <NativeInput id="productName" name="productName" defaultValue={mode === "edit" ? card.productName ?? "" : ""} />
                    </Field>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Field label="Card style" htmlFor="cardStyle">
                            <NativeSelect id="cardStyle" name="cardStyle" defaultValue={mode === "edit" ? card.cardStyle ?? "brand-dark" : "brand-dark"}>
                                {CARD_STYLE_OPTIONS.map((style) => (
                                    <option key={style.value} value={style.value}>
                                        {style.label}
                                    </option>
                                ))}
                            </NativeSelect>
                        </Field>
                        <Field label="Custom card image" htmlFor="cardImage" hint="Optional image used instead of generated card art.">
                            <NativeInput id="cardImage" name="cardImage" type="file" accept="image/*" />
                        </Field>
                    </div>
                    {mode === "edit" && card.cardImageUrl && <Checkbox name="removeCardImage" label="Remove custom card image" />}
                    <Field label="Last 4 digits" htmlFor="last4" hint="Only these four display digits are stored. Never enter the full card number or CVV.">
                        <NativeInput
                            id="last4"
                            name="last4"
                            defaultValue={mode === "edit" ? card.last4 ?? "" : ""}
                            inputMode="numeric"
                            maxLength={4}
                            pattern="[0-9]{4}"
                            placeholder="1111"
                            autoComplete="off"
                        />
                    </Field>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Field label="Exp. month" htmlFor="expMonth">
                            <NativeSelect id="expMonth" name="expMonth" defaultValue={mode === "edit" && card.expMonth ? String(card.expMonth) : ""}>
                                <option value="">-</option>
                                {MONTHS.map((m) => (
                                    <option key={m} value={m}>
                                        {String(m).padStart(2, "0")}
                                    </option>
                                ))}
                            </NativeSelect>
                        </Field>
                        <Field label="Exp. year" htmlFor="expYear">
                            <NativeSelect id="expYear" name="expYear" defaultValue={mode === "edit" && card.expYear ? String(card.expYear) : ""}>
                                <option value="">-</option>
                                {YEARS.map((y) => (
                                    <option key={y} value={y}>
                                        {y}
                                    </option>
                                ))}
                            </NativeSelect>
                        </Field>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Field label="APR %" htmlFor="apr">
                            <NativeInput id="apr" name="apr" type="number" step="0.001" defaultValue={mode === "edit" ? card.apr ?? "" : ""} />
                        </Field>
                        <Field label="Credit limit" htmlFor="creditLimit">
                            <NativeInput id="creditLimit" name="creditLimit" type="number" step="0.01" defaultValue={mode === "edit" ? card.creditLimit ?? "" : ""} />
                        </Field>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Field label="Payment due date" htmlFor="paymentDueAt">
                            <NativeInput id="paymentDueAt" name="paymentDueAt" type="date" defaultValue={mode === "edit" ? card.paymentDueAt ?? "" : ""} />
                        </Field>
                        <Field label="Minimum payment" htmlFor="minimumPayment">
                            <NativeInput id="minimumPayment" name="minimumPayment" type="number" step="0.01" defaultValue={mode === "edit" ? card.minimumPayment ?? "" : ""} />
                        </Field>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Field label="Last statement balance" htmlFor="lastStatementBalance">
                            <NativeInput id="lastStatementBalance" name="lastStatementBalance" type="number" step="0.01" defaultValue={mode === "edit" ? card.lastStatementBalance ?? "" : ""} />
                        </Field>
                        <Field label="Last payment amount" htmlFor="lastPaymentAmount">
                            <NativeInput id="lastPaymentAmount" name="lastPaymentAmount" type="number" step="0.01" defaultValue={mode === "edit" ? card.lastPaymentAmount ?? "" : ""} />
                        </Field>
                    </div>
                    <Checkbox name="paymentOverdue" defaultSelected={mode === "edit" ? card.paymentOverdue : false} label="Payment is overdue" />
                    <Field label="Branch location" htmlFor="branchLocation">
                        <NativeInput id="branchLocation" name="branchLocation" defaultValue={mode === "edit" ? card.branchLocation ?? "" : ""} />
                    </Field>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Field label="Opening date" htmlFor="openedAt">
                            <NativeInput id="openedAt" name="openedAt" type="date" defaultValue={mode === "edit" ? card.openedAt ?? "" : ""} />
                        </Field>
                        <Field label="Closing date" htmlFor="closedAt">
                            <NativeInput id="closedAt" name="closedAt" type="date" defaultValue={mode === "edit" ? card.closedAt ?? "" : ""} />
                        </Field>
                    </div>
                    <OwnerMultiSelect options={contacts} defaultSelectedIds={mode === "edit" ? card.owners.map((o) => o.id) : []} />
                    <Field label="Rewards notes" htmlFor="rewardsNotes">
                        <NativeTextarea id="rewardsNotes" name="rewardsNotes" defaultValue={mode === "edit" ? card.rewardsNotes ?? "" : ""} />
                    </Field>
                    <Field label="Notes" htmlFor="notes">
                        <NativeTextarea id="notes" name="notes" defaultValue={mode === "edit" ? card.notes ?? "" : ""} />
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
