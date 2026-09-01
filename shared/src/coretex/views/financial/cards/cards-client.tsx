// @ts-nocheck




import { InstitutionOption, InstitutionSelect } from "../_components/institution-select";
import { InstitutionLogo } from "../_components/institution-logo";
import { FormModal } from "../_components/form-modal";
import { SectionHeader, Stat, Card, EmptyState, Field, NativeInput, NativeSelect, NativeTextarea } from "../_components/financial-ui";
import { useConfirm } from "../_components/confirm-modal";
import { formatCurrency } from "../../personal/personal-ui";
import { toast } from "sonner";
import { Button, ProgressBar, Checkbox } from "react-aria-components";
import { useState, useMemo } from "react";
import { Plus, CreditCard02, Repeat01, Eye, Edit01, RefreshCw01, Archive, Trash02 } from "@untitledui/icons";
import { Badge } from "@/components/base/badges/badges";
import { OwnerMultiSelect, type OwnerOption } from "../_components/owner-multi-select";
import { formatRewardChip, rewardSortKey, type RewardType } from "../_components/reward-format";
import { CARD_STYLE_OPTIONS, CardPreview } from "./card-preview";

interface RewardSummary {
    category: string;
    type: RewardType;
    rate: number;
}

export interface CreditCardRow {
    id: string;
    institution: string | null;
    institutionId: string | null;
    issuer: string | null;
    nickname: string | null;
    cardType: string;
    productName: string | null;
    expMonth: number | null;
    expYear: number | null;
    branchLocation: string | null;
    openedAt: string | null;
    closedAt: string | null;
    last4: string | null;
    apr: number | null;
    creditLimit: number | null;
    currentBalance: number;
    cardStyle: string | null;
    cardImageUrl: string | null;
    minimumPayment: number | null;
    paymentDueAt: string | null;
    paymentOverdue: boolean;
    lastPaymentAmount: number | null;
    lastStatementBalance: number | null;
    latestStatementName: string | null;
    latestStatementStart: string | null;
    latestStatementEnd: string | null;
    rewardsNotes: string | null;
    notes: string | null;
    archived: boolean;
    owners: OwnerOption[];
    rewards: RewardSummary[];
    perkCount: number;
    replacedById: string | null;
    replacedByLabel: string | null;
    replacesLabels: string[];
}

const CARD_TYPES = [
    { value: "CREDIT", label: "Credit" },
    { value: "DEBIT", label: "Debit" },
    { value: "CHARGE", label: "Charge" },
    { value: "PREPAID", label: "Prepaid" },
    { value: "OTHER", label: "Other" },
];

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const YEARS = Array.from({ length: 16 }, (_, i) => new Date().getFullYear() + i);

function cardName(c: CreditCardRow) {
    return c.nickname || c.productName || c.institution || c.issuer || "Card";
}
function utilization(c: CreditCardRow) {
    if (!c.creditLimit || c.creditLimit <= 0) return null;
    return c.currentBalance / c.creditLimit;
}

export function CardsClient({ cards, institutions, contacts }: { cards: CreditCardRow[]; institutions: InstitutionOption[]; contacts: OwnerOption[] }) {
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<CreditCardRow | null>(null);
    const { confirm, dialog } = useConfirm();
    const institutionById = useMemo(() => new Map(institutions.map((i) => [i.id, i])), [institutions]);

    // Overall utilization only counts cards that have a known limit — otherwise a card
    // with a balance but no limit on file would inflate the ratio (balance ÷ smaller-limit).
    const activeCards = cards.filter((c) => !c.archived);
    const measuredCards = activeCards.filter((c) => c.creditLimit != null && c.creditLimit > 0);
    const totalBalance = activeCards.reduce((s, c) => s + c.currentBalance, 0);
    const totalLimit = measuredCards.reduce((s, c) => s + (c.creditLimit ?? 0), 0);
    const overall = totalLimit > 0 ? totalBalance / totalLimit : null;

    function openCreate() {
        setEditing(null);
        setOpen(true);
    }
    function openEdit(c: CreditCardRow) {
        setEditing(c);
        setOpen(true);
    }

    async function onSubmit(fd: FormData) {
        try {
            if (editing) await updateCreditCard(fd);
            else await createCreditCard(fd);
            toast.success(editing ? "Card updated" : "Card added");
            setOpen(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        }
    }
    async function onArchive(c: CreditCardRow) {
        const fd = new FormData();
        fd.set("id", c.id);
        fd.set("archived", c.archived ? "false" : "true");
        try {
            await setCreditCardArchived(fd);
            toast.success(c.archived ? "Restored" : "Archived");
        } catch {
            toast.error("Failed");
        }
    }
    function onDelete(id: string) {
        confirm({
            title: "Delete card?",
            description: "This deletes the card and its number history. This can’t be undone.",
            confirmLabel: "Delete",
            onConfirm: async () => {
                const fd = new FormData();
                fd.set("id", id);
                try {
                    await deleteCreditCard(fd);
                    toast.success("Deleted");
                } catch {
                    toast.error("Failed to delete");
                }
            },
        });
    }

    const expLabel = (c: CreditCardRow) => (c.expMonth && c.expYear ? `${String(c.expMonth).padStart(2, "0")}/${String(c.expYear).slice(-2)}` : "");

    return (
        <div className="flex flex-col gap-6">
            <SectionHeader
                title="Cards"
                description="Credit, debit and charge cards — balances, limits and utilization."
                action={
                    <Button size="md" iconLeading={Plus} onClick={openCreate}>
                        Add card
                    </Button>
                }
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Stat label="Total balance" value={formatCurrency(totalBalance)} />
                <Stat label="Total limit" value={formatCurrency(totalLimit)} />
                <Stat label="Overall utilization" value={overall != null ? formatPercent(overall) : "—"} tone={overall != null && overall > 0.3 ? "error" : undefined} />
            </div>

            {cards.length === 0 ? (
                <Card className="p-0">
                    <EmptyState
                        icon={CreditCard02}
                        title="Add a card to track utilization"
                        description="Keep credit, debit and charge cards in one place — balances, limits and utilization that protect your credit score."
                        action={
                            <Button size="sm" iconLeading={Plus} onClick={openCreate}>
                                Add card
                            </Button>
                        }
                    />
                </Card>
            ) : (
                <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
                    {cards.map((c) => {
                        const util = utilization(c);
                        return (
                            <Card key={c.id} className="flex flex-col gap-4">
                                <CardPreview
                                    width={300}
                                    imageUrl={c.cardImageUrl}
                                    styleValue={c.cardStyle}
                                    archived={c.archived}
                                    company={c.institution || c.issuer || "Card"}
                                    cardHolder={c.owners[0]?.name || c.productName || ""}
                                    cardNumber={`•••• •••• •••• ${c.last4 ?? "••••"}`}
                                    cardExpiration={expLabel(c)}
                                />
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex items-start gap-2.5">
                                        {c.institutionId && institutionById.get(c.institutionId) && (
                                            <InstitutionLogo
                                                src={institutionLogoSrc(institutionById.get(c.institutionId)!)}
                                                name={c.institution ?? "Institution"}
                                            />
                                        )}
                                        <div>
                                        <p className="font-semibold text-primary">{cardName(c)}</p>
                                        <p className="text-xs text-tertiary">
                                            {CARD_TYPES.find((t) => t.value === c.cardType)?.label ?? c.cardType}
                                            {c.cardType === "CREDIT" ? ` · ${c.apr != null ? `${c.apr}% APR` : "APR —"}` : ""}
                                        </p>
                                        </div>
                                    </div>
                                    {c.archived && (
                                        <Badge size="sm" color="gray">
                                            Archived
                                        </Badge>
                                    )}
                                </div>
                                {(c.rewards.length > 0 || c.perkCount > 0) && (
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        {[...c.rewards]
                                            .sort((a, b) => rewardSortKey(b) - rewardSortKey(a))
                                            .slice(0, 3)
                                            .map((r, i) => (
                                                <Badge key={`${r.category}-${i}`} size="sm" color="brand">
                                                    {formatRewardChip(r)}
                                                </Badge>
                                            ))}
                                        {c.rewards.length > 3 && (
                                            <Badge size="sm" color="gray">
                                                +{c.rewards.length - 3} more
                                            </Badge>
                                        )}
                                        {c.perkCount > 0 && (
                                            <Badge size="sm" color="gray">
                                                +{c.perkCount} {c.perkCount === 1 ? "perk" : "perks"}
                                            </Badge>
                                        )}
                                    </div>
                                )}
                                <div className="flex flex-col gap-1.5">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-tertiary">Balance</span>
                                        <span className="font-medium text-primary">{formatCurrency(c.currentBalance)}</span>
                                    </div>
                                    {util != null && (
                                        <>
                                            <ProgressBar value={c.currentBalance} max={c.creditLimit ?? 0} color={util > 0.7 ? "error" : util > 0.3 ? "warning" : "success"} />
                                            <p className={`text-xs ${util > 0.7 ? "font-medium text-error-primary" : util > 0.3 ? "font-medium text-warning-primary" : "text-tertiary"}`}>
                                                {formatPercent(util)} utilization
                                                {util > 0.7 ? " — high, may hurt your score" : util > 0.3 ? " — above the 30% guideline" : ""}
                                            </p>
                                        </>
                                    )}
                                </div>
                                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-secondary pt-3 text-xs">
                                    <div>
                                        <dt className="text-tertiary">Due date</dt>
                                        <dd className={c.paymentOverdue ? "font-medium text-error-primary" : "font-medium text-primary"}>
                                            {c.paymentDueAt ? formatDateOnly(c.paymentDueAt) : "—"}
                                            {c.paymentOverdue ? " overdue" : ""}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt className="text-tertiary">Minimum</dt>
                                        <dd className="font-medium text-primary">{c.minimumPayment != null ? formatCurrency(c.minimumPayment) : "—"}</dd>
                                    </div>
                                    <div>
                                        <dt className="text-tertiary">Opened</dt>
                                        <dd className="font-medium text-primary">{c.openedAt ? formatDateOnly(c.openedAt) : "-"}</dd>
                                    </div>
                                    <div>
                                        <dt className="text-tertiary">Closed</dt>
                                        <dd className="font-medium text-primary">{c.closedAt ? formatDateOnly(c.closedAt) : "-"}</dd>
                                    </div>
                                    <div>
                                        <dt className="text-tertiary">Statement</dt>
                                        <dd className="font-medium text-primary">
                                            {c.latestStatementEnd ? formatDateOnly(c.latestStatementEnd) : c.lastStatementBalance != null ? "Latest" : "—"}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt className="text-tertiary">Statement balance</dt>
                                        <dd className="font-medium text-primary">{c.lastStatementBalance != null ? formatCurrency(c.lastStatementBalance) : "—"}</dd>
                                    </div>
                                </dl>
                                {/* Replacement chain indicators */}
                                {(c.replacedById || c.replacesLabels.length > 0) && (
                                    <div className="flex flex-wrap gap-1">
                                        {c.replacedById && (
                                            <Badge size="sm" color="warning">
                                                <Repeat01 className="size-3 mr-1" aria-hidden="true" />
                                                Replaced by {c.replacedByLabel ?? "another card"}
                                            </Badge>
                                        )}
                                        {c.replacesLabels.map((label) => (
                                            <Badge key={label} size="sm" color="gray">
                                                Replaces {label}
                                            </Badge>
                                        ))}
                                    </div>
                                )}
                                <div className="mt-auto flex flex-wrap gap-1">
                                    <Button size="sm" color="secondary" iconLeading={Eye} href={`/financial/cards/${c.id}`}>
                                        Details
                                    </Button>
                                    <Button size="sm" color="secondary" href={`/financial/transactions?account=${c.id}`}>
                                        Transactions
                                    </Button>
                                    <Button size="sm" color="tertiary" iconLeading={Edit01} onClick={() => openEdit(c)} aria-label="Edit" />
                                    <Button size="sm" color="tertiary" iconLeading={c.archived ? RefreshCw01 : Archive} onClick={() => onArchive(c)} aria-label="Archive" />
                                    <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} onClick={() => onDelete(c.id)} aria-label="Delete" />
                                </div>
                            </Card>
                        );
                    })}
                </div>
            )}

            <FormModal isOpen={open} onOpenChange={setOpen} title={editing ? "Edit card" : "Add card"}>
                <form action={onSubmit} className="flex flex-col gap-4" key={editing?.id ?? "new"}>
                    {editing && <input type="hidden" name="id" value={editing.id} />}

                    <InstitutionSelect institutions={institutions} defaultValue={editing?.institutionId ?? ""} />

                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Nickname" htmlFor="nickname">
                            <NativeInput id="nickname" name="nickname" defaultValue={editing?.nickname ?? ""} placeholder="e.g. Travel card" />
                        </Field>
                        <Field label="Card type" htmlFor="cardType">
                            <NativeSelect id="cardType" name="cardType" defaultValue={editing?.cardType ?? "CREDIT"}>
                                {CARD_TYPES.map((t) => (
                                    <option key={t.value} value={t.value}>
                                        {t.label}
                                    </option>
                                ))}
                            </NativeSelect>
                        </Field>
                    </div>
                    <Field label="Product name" htmlFor="productName">
                        <NativeInput id="productName" name="productName" defaultValue={editing?.productName ?? ""} placeholder="e.g. Sapphire Preferred" />
                    </Field>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Field label="Card style" htmlFor="cardStyle">
                            <NativeSelect id="cardStyle" name="cardStyle" defaultValue={editing?.cardStyle ?? "brand-dark"}>
                                {CARD_STYLE_OPTIONS.map((style) => (
                                    <option key={style.value} value={style.value}>
                                        {style.label}
                                    </option>
                                ))}
                            </NativeSelect>
                        </Field>
                        <Field label="Custom card image" htmlFor="cardImage" hint="Optional image used instead of the generated card art.">
                            <NativeInput id="cardImage" name="cardImage" type="file" accept="image/*" />
                        </Field>
                    </div>
                    {editing?.cardImageUrl && <Checkbox name="removeCardImage" label="Remove custom card image" />}
                    <Field label="Last 4 digits" htmlFor="last4" hint="Only these four display digits are stored. Never enter the full card number or CVV.">
                        <NativeInput
                            id="last4"
                            name="last4"
                            defaultValue={editing?.last4 ?? ""}
                            inputMode="numeric"
                            maxLength={4}
                            pattern="[0-9]{4}"
                            placeholder="1111"
                            autoComplete="off"
                        />
                    </Field>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Field label="Exp. month" htmlFor="expMonth">
                            <NativeSelect id="expMonth" name="expMonth" defaultValue={editing?.expMonth ? String(editing.expMonth) : ""}>
                                <option value="">—</option>
                                {MONTHS.map((m) => (
                                    <option key={m} value={m}>
                                        {String(m).padStart(2, "0")}
                                    </option>
                                ))}
                            </NativeSelect>
                        </Field>
                        <Field label="Exp. year" htmlFor="expYear">
                            <NativeSelect id="expYear" name="expYear" defaultValue={editing?.expYear ? String(editing.expYear) : ""}>
                                <option value="">—</option>
                                {YEARS.map((y) => (
                                    <option key={y} value={y}>
                                        {y}
                                    </option>
                                ))}
                            </NativeSelect>
                        </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="APR %" htmlFor="apr">
                            <NativeInput id="apr" name="apr" type="number" step="0.001" defaultValue={editing?.apr ?? ""} />
                        </Field>
                        <Field label="Credit limit" htmlFor="creditLimit">
                            <NativeInput id="creditLimit" name="creditLimit" type="number" step="0.01" defaultValue={editing?.creditLimit ?? ""} />
                        </Field>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Field label="Payment due date" htmlFor="paymentDueAt">
                            <NativeInput id="paymentDueAt" name="paymentDueAt" type="date" defaultValue={editing?.paymentDueAt ?? ""} />
                        </Field>
                        <Field label="Minimum payment" htmlFor="minimumPayment">
                            <NativeInput id="minimumPayment" name="minimumPayment" type="number" step="0.01" defaultValue={editing?.minimumPayment ?? ""} />
                        </Field>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Field label="Last statement balance" htmlFor="lastStatementBalance">
                            <NativeInput id="lastStatementBalance" name="lastStatementBalance" type="number" step="0.01" defaultValue={editing?.lastStatementBalance ?? ""} />
                        </Field>
                        <Field label="Last payment amount" htmlFor="lastPaymentAmount">
                            <NativeInput id="lastPaymentAmount" name="lastPaymentAmount" type="number" step="0.01" defaultValue={editing?.lastPaymentAmount ?? ""} />
                        </Field>
                    </div>
                    <Checkbox name="paymentOverdue" defaultSelected={editing?.paymentOverdue ?? false} label="Payment is overdue" />
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

                    <p className="rounded-lg bg-secondary px-3 py-2 text-xs text-tertiary">Balance is derived from the latest statement, or the sum of transactions.</p>
                    <Field label="Rewards notes" htmlFor="rewardsNotes">
                        <NativeTextarea id="rewardsNotes" name="rewardsNotes" defaultValue={editing?.rewardsNotes ?? ""} placeholder="e.g. 3x dining, 2x travel" />
                    </Field>
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
