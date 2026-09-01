"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Bank, ChevronDown, CreditCard02, Edit01, Gift01, LineChartUp03, Plus, Target04, Trash02, XClose } from "@untitledui/icons";
import { toast } from "sonner";
import type { CardType, FinAccountKind, FinancialPlanKind, FinancialPlanStatus } from "@prisma/client";
import { Badge, BadgeWithDot, BadgeWithIcon } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { FormDateInput } from "@/components/base/input/form-date-input";
import { createPlan, deletePlan, dismissPlan, openPlan, updatePlan } from "@/lib/actions/financial-plans";
import { formatCurrency } from "@/lib/financial/format";
import { formatDate, formatRelative } from "@/lib/dates";
import { Card, Field, NativeInput, NativeSelect, NativeTextarea, SectionHeader } from "../_components/financial-ui";
import { FormModal } from "../_components/form-modal";
import { useConfirm } from "../_components/confirm-modal";
import { cx } from "@/utils/cx";

export interface PlanRow {
    id: string;
    kind: FinancialPlanKind;
    name: string;
    institutionName: string | null;
    accountKind: FinAccountKind | null;
    cardType: CardType | null;
    targetDate: string | null;
    reason: string | null;
    expectedAnnualFee: number | null;
    expectedBonus: string | null;
    notes: string | null;
    status: FinancialPlanStatus;
    opened: { kind: "card" | "account"; id: string; name: string | null; href: string } | null;
}

/**
 * The create/edit form uses one "type" segmented control that maps a friendly
 * choice to the underlying (kind, accountKind, cardType) triple.
 */
const PLAN_TYPES = [
    { value: "CARD", label: "Card", kind: "CARD" as FinancialPlanKind, accountKind: null, cardType: "CREDIT" as CardType | null },
    { value: "CHECKING", label: "Checking", kind: "ACCOUNT" as FinancialPlanKind, accountKind: "CHECKING" as FinAccountKind, cardType: null },
    { value: "SAVINGS", label: "Savings", kind: "ACCOUNT" as FinancialPlanKind, accountKind: "SAVINGS" as FinAccountKind, cardType: null },
    { value: "MONEY_MARKET", label: "Money market", kind: "ACCOUNT" as FinancialPlanKind, accountKind: "MONEY_MARKET" as FinAccountKind, cardType: null },
    { value: "CD", label: "CD", kind: "ACCOUNT" as FinancialPlanKind, accountKind: "CD" as FinAccountKind, cardType: null },
    { value: "BROKERAGE", label: "Brokerage", kind: "BROKERAGE" as FinancialPlanKind, accountKind: "BROKERAGE" as FinAccountKind, cardType: null },
    { value: "OTHER", label: "Other", kind: "OTHER" as FinancialPlanKind, accountKind: "OTHER" as FinAccountKind, cardType: null },
] as const;

type PlanTypeValue = (typeof PLAN_TYPES)[number]["value"];

const CARD_TYPES: { value: CardType; label: string }[] = [
    { value: "CREDIT", label: "Credit" },
    { value: "DEBIT", label: "Debit" },
    { value: "CHARGE", label: "Charge" },
    { value: "PREPAID", label: "Prepaid" },
    { value: "OTHER", label: "Other" },
];

const ACCOUNT_KIND_LABELS: Record<string, string> = {
    CHECKING: "Checking",
    SAVINGS: "Savings",
    MONEY_MARKET: "Money market",
    CD: "CD",
    BROKERAGE: "Brokerage",
    LOAN: "Loan",
    OTHER: "Other",
};

/** Map an existing plan back to the segmented "type" value used in the form. */
function planTypeOf(p: PlanRow): PlanTypeValue {
    if (p.kind === "CARD") return "CARD";
    if (p.kind === "BROKERAGE") return "BROKERAGE";
    if (p.kind === "OTHER") return "OTHER";
    const match = PLAN_TYPES.find((t) => t.accountKind === p.accountKind);
    return (match?.value ?? "CHECKING") as PlanTypeValue;
}

function kindBadge(p: PlanRow): { label: string; color: "brand" | "blue" | "purple" | "gray" } {
    if (p.kind === "CARD") {
        const ct = CARD_TYPES.find((t) => t.value === p.cardType)?.label ?? "Card";
        return { label: `${ct} card`, color: "brand" };
    }
    if (p.kind === "BROKERAGE") return { label: "Brokerage", color: "purple" };
    if (p.kind === "OTHER") return { label: "Other", color: "gray" };
    return { label: p.accountKind ? ACCOUNT_KIND_LABELS[p.accountKind] ?? "Account" : "Account", color: "blue" };
}

/** Pick a decorative icon for the plan kind (rendered client-side here). */
function PlanIcon({ p }: { p: PlanRow }) {
    const icon = p.kind === "CARD" ? CreditCard02 : p.kind === "BROKERAGE" ? LineChartUp03 : Bank;
    const color = p.kind === "CARD" ? "brand" : "gray";
    return <FeaturedIcon icon={icon} color={color} theme="light" size="md" />;
}

/** Days until a yyyy-mm-dd target date (local midnight), or null. */
function daysUntil(iso: string | null): number | null {
    if (!iso) return null;
    const [y, m, d] = iso.split("-").map(Number);
    if (!y || !m || !d) return null;
    const target = new Date(y, m - 1, d);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export function PlanningClient({ plans }: { plans: PlanRow[] }) {
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<PlanRow | null>(null);
    const [planType, setPlanType] = useState<PlanTypeValue>("CARD");
    const [openingId, setOpeningId] = useState<string | null>(null);
    const [showDismissed, setShowDismissed] = useState(false);
    const { confirm, dialog } = useConfirm();

    const { upcoming, opened, dismissed } = useMemo(() => {
        const upcoming = plans.filter((p) => p.status === "PLANNED");
        const opened = plans.filter((p) => p.status === "OPENED");
        const dismissed = plans.filter((p) => p.status === "DISMISSED");
        // Upcoming: sort by target date (no date last), then split into buckets.
        const sorted = [...upcoming].sort((a, b) => (a.targetDate ?? "9999").localeCompare(b.targetDate ?? "9999"));
        const overdue: PlanRow[] = [];
        const thisMonth: PlanRow[] = [];
        const later: PlanRow[] = [];
        for (const p of sorted) {
            const d = daysUntil(p.targetDate);
            if (d != null && d < 0) overdue.push(p);
            else if (d != null && d <= 30) thisMonth.push(p);
            else later.push(p);
        }
        return { upcoming: { overdue, thisMonth, later }, opened, dismissed };
    }, [plans]);

    function openCreate() {
        setEditing(null);
        setPlanType("CARD");
        setOpen(true);
    }
    function openEdit(p: PlanRow) {
        setEditing(p);
        setPlanType(planTypeOf(p));
        setOpen(true);
    }

    async function onSubmit(fd: FormData) {
        // Translate the segmented "type" choice into the schema fields.
        const t = PLAN_TYPES.find((x) => x.value === planType)!;
        fd.set("kind", t.kind);
        if (t.accountKind) fd.set("accountKind", t.accountKind);
        else fd.delete("accountKind");
        if (t.cardType == null) fd.delete("cardType"); // card type comes from its own select when kind=CARD
        try {
            if (editing) await updatePlan(fd);
            else await createPlan(fd);
            toast.success(editing ? "Plan updated" : "Plan added");
            setOpen(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        }
    }

    function onOpenPlan(p: PlanRow) {
        confirm({
            title: `Mark "${p.name}" as opened?`,
            description:
                p.kind === "CARD"
                    ? "This creates a real credit card from this plan. You can fill in the full details on the card after."
                    : "This creates a real account from this plan. You can fill in the full details on the account after.",
            confirmLabel: "Create it",
            destructive: false,
            onConfirm: async () => {
                setOpeningId(p.id);
                try {
                    const res = await openPlan(toFd({ id: p.id }));
                    toast.success(`Created ${res.name}`, {
                        action: { label: res.kind === "card" ? "View card" : "View account", onClick: () => (window.location.href = res.href) },
                    });
                } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Failed to open plan");
                } finally {
                    setOpeningId(null);
                }
            },
        });
    }

    function onDismiss(p: PlanRow) {
        void (async () => {
            try {
                await dismissPlan(toFd({ id: p.id }));
                toast.success(p.status === "DISMISSED" ? "Restored to upcoming" : "Dismissed");
            } catch {
                toast.error("Failed");
            }
        })();
    }

    function onDelete(p: PlanRow) {
        confirm({
            title: "Delete plan?",
            description: "This permanently removes the plan. Any product already created from it is kept.",
            confirmLabel: "Delete",
            onConfirm: async () => {
                try {
                    await deletePlan(toFd({ id: p.id }));
                    toast.success("Deleted");
                } catch {
                    toast.error("Failed to delete");
                }
            },
        });
    }

    const totalUpcoming = upcoming.overdue.length + upcoming.thisMonth.length + upcoming.later.length;

    return (
        <div className="flex flex-col gap-6">
            <SectionHeader
                title="Planning"
                description="Plan future credit cards and accounts, schedule when to open them, then convert a plan into the real product."
                action={
                    <Button size="md" iconLeading={Plus} onClick={openCreate}>
                        Add plan
                    </Button>
                }
            />

            {/* Upcoming */}
            <section className="flex flex-col gap-4">
                <div className="flex items-baseline gap-2">
                    <h3 className="text-md font-semibold text-primary">Upcoming</h3>
                    <span className="text-sm text-tertiary">{totalUpcoming}</span>
                </div>

                {totalUpcoming === 0 ? (
                    <Card>
                        <div className="flex flex-col items-center gap-3 py-10 text-center">
                            <FeaturedIcon icon={Target04} color="brand" theme="light" size="lg" />
                            <div>
                                <p className="font-medium text-primary">Nothing planned yet</p>
                                <p className="text-sm text-tertiary">Plan a future card or account and schedule when to open it.</p>
                            </div>
                            <Button size="sm" iconLeading={Plus} onClick={openCreate}>
                                Add plan
                            </Button>
                        </div>
                    </Card>
                ) : (
                    <div className="flex flex-col gap-5">
                        <PlanGroup label="Overdue" tone="error" plans={upcoming.overdue} onEdit={openEdit} onOpenPlan={onOpenPlan} onDismiss={onDismiss} onDelete={onDelete} openingId={openingId} />
                        <PlanGroup label="This month" tone="warning" plans={upcoming.thisMonth} onEdit={openEdit} onOpenPlan={onOpenPlan} onDismiss={onDismiss} onDelete={onDelete} openingId={openingId} />
                        <PlanGroup label="Later" tone="gray" plans={upcoming.later} onEdit={openEdit} onOpenPlan={onOpenPlan} onDismiss={onDismiss} onDelete={onDelete} openingId={openingId} />
                    </div>
                )}
            </section>

            {/* Opened */}
            {opened.length > 0 && (
                <section className="flex flex-col gap-4">
                    <div className="flex items-baseline gap-2">
                        <h3 className="text-md font-semibold text-primary">Opened</h3>
                        <span className="text-sm text-tertiary">{opened.length}</span>
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {opened.map((p) => (
                            <PlanCard key={p.id} p={p} onEdit={openEdit} onOpenPlan={onOpenPlan} onDismiss={onDismiss} onDelete={onDelete} openingId={openingId} />
                        ))}
                    </div>
                </section>
            )}

            {/* Dismissed (collapsed) */}
            {dismissed.length > 0 && (
                <section className="flex flex-col gap-4">
                    <button
                        type="button"
                        onClick={() => setShowDismissed((s) => !s)}
                        className="flex w-fit items-center gap-2 text-md font-semibold text-primary"
                        aria-expanded={showDismissed}
                    >
                        Dismissed
                        <span className="text-sm font-normal text-tertiary">{dismissed.length}</span>
                        <ChevronDown aria-hidden="true" className={cx("size-4 text-fg-quaternary transition-transform", showDismissed && "rotate-180")} />
                    </button>
                    {showDismissed && (
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                            {dismissed.map((p) => (
                                <PlanCard key={p.id} p={p} onEdit={openEdit} onOpenPlan={onOpenPlan} onDismiss={onDismiss} onDelete={onDelete} openingId={openingId} />
                            ))}
                        </div>
                    )}
                </section>
            )}

            {/* Create / edit modal */}
            <FormModal isOpen={open} onOpenChange={setOpen} title={editing ? "Edit plan" : "Add plan"}>
                <form action={onSubmit} className="flex flex-col gap-4" key={editing?.id ?? "new"}>
                    {editing && <input type="hidden" name="id" value={editing.id} />}

                    <Field label="Type">
                        <div className="flex flex-wrap gap-1.5">
                            {PLAN_TYPES.map((t) => (
                                <button
                                    key={t.value}
                                    type="button"
                                    onClick={() => setPlanType(t.value)}
                                    className={cx(
                                        "rounded-lg px-3 py-1.5 text-sm font-medium ring-1 transition duration-100 ease-linear ring-inset",
                                        planType === t.value
                                            ? "bg-brand-primary text-brand-secondary ring-brand"
                                            : "bg-primary text-secondary ring-primary hover:bg-primary_hover",
                                    )}
                                >
                                    {t.label}
                                </button>
                            ))}
                        </div>
                    </Field>

                    {planType === "CARD" && (
                        <Field label="Card type" htmlFor="cardType">
                            <NativeSelect id="cardType" name="cardType" defaultValue={editing?.cardType ?? "CREDIT"}>
                                {CARD_TYPES.map((t) => (
                                    <option key={t.value} value={t.value}>
                                        {t.label}
                                    </option>
                                ))}
                            </NativeSelect>
                        </Field>
                    )}

                    <Field label="Name" htmlFor="name" hint="e.g. Amex Platinum, Ally HYSA">
                        <NativeInput id="name" name="name" required defaultValue={editing?.name ?? ""} placeholder="What are you planning to open?" />
                    </Field>

                    <Field label="Institution" htmlFor="institutionName">
                        <NativeInput id="institutionName" name="institutionName" defaultValue={editing?.institutionName ?? ""} placeholder="e.g. American Express, Ally Bank" />
                    </Field>

                    <FormDateInput name="targetDate" label="Target date" hint="When do you plan to open it?" defaultValue={editing?.targetDate ?? ""} />

                    <Field label="Reason" htmlFor="reason">
                        <NativeInput id="reason" name="reason" defaultValue={editing?.reason ?? ""} placeholder="e.g. Sign-up bonus, emergency fund" />
                    </Field>

                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Expected annual fee" htmlFor="expectedAnnualFee">
                            <NativeInput id="expectedAnnualFee" name="expectedAnnualFee" type="number" step="0.01" min="0" defaultValue={editing?.expectedAnnualFee ?? ""} placeholder="0" />
                        </Field>
                        <Field label="Expected bonus" htmlFor="expectedBonus">
                            <NativeInput id="expectedBonus" name="expectedBonus" defaultValue={editing?.expectedBonus ?? ""} placeholder="e.g. 75k pts after $4k" />
                        </Field>
                    </div>

                    <Field label="Notes" htmlFor="notes">
                        <NativeTextarea id="notes" name="notes" defaultValue={editing?.notes ?? ""} />
                    </Field>

                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="submit">{editing ? "Save" : "Add plan"}</Button>
                    </div>
                </form>
            </FormModal>

            {dialog}
        </div>
    );
}

/** Build a FormData with simple string fields. */
function toFd(fields: Record<string, string>): FormData {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
}

interface PlanActions {
    onEdit: (p: PlanRow) => void;
    onOpenPlan: (p: PlanRow) => void;
    onDismiss: (p: PlanRow) => void;
    onDelete: (p: PlanRow) => void;
    openingId: string | null;
}

function PlanGroup({ label, tone, plans, ...actions }: { label: string; tone: "error" | "warning" | "gray"; plans: PlanRow[] } & PlanActions) {
    if (plans.length === 0) return null;
    const color = tone === "error" ? "error" : tone === "warning" ? "warning" : "gray";
    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
                <BadgeWithDot size="sm" color={color} type="modern">
                    {label}
                </BadgeWithDot>
                <span className="text-xs text-tertiary">
                    {plans.length} {plans.length === 1 ? "item" : "items"}
                </span>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {plans.map((p) => (
                    <PlanCard key={p.id} p={p} {...actions} />
                ))}
            </div>
        </div>
    );
}

function PlanCard({ p, onEdit, onOpenPlan, onDismiss, onDelete, openingId }: { p: PlanRow } & PlanActions) {
    const badge = kindBadge(p);
    const d = daysUntil(p.targetDate);
    const isOpened = p.status === "OPENED";
    const isDismissed = p.status === "DISMISSED";

    return (
        <Card className={cx("flex flex-col gap-4", (isOpened || isDismissed) && "opacity-90")}>
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                    <PlanIcon p={p} />
                    <div className="flex flex-col gap-0.5">
                        <p className="font-semibold text-primary">{p.name}</p>
                        {p.institutionName && <p className="text-xs text-tertiary">{p.institutionName}</p>}
                    </div>
                </div>
                <Badge size="sm" color={badge.color}>
                    {badge.label}
                </Badge>
            </div>

            {p.targetDate && (
                <div className="flex items-center justify-between rounded-lg bg-secondary px-3 py-2 text-sm">
                    <span className="text-tertiary">Target</span>
                    <span className={cx("font-medium", d != null && d < 0 && !isOpened ? "text-error-primary" : "text-primary")}>
                        {formatDate(p.targetDate)} <span className="text-tertiary">· {formatRelative(p.targetDate)}</span>
                    </span>
                </div>
            )}

            {(p.reason || p.expectedAnnualFee != null || p.expectedBonus) && (
                <div className="flex flex-col gap-1.5 text-sm">
                    {p.reason && <p className="text-secondary">{p.reason}</p>}
                    <div className="flex flex-wrap gap-1.5">
                        {p.expectedAnnualFee != null && (
                            <Badge size="sm" color="gray">
                                Fee {formatCurrency(p.expectedAnnualFee)}/yr
                            </Badge>
                        )}
                        {p.expectedBonus && (
                            <BadgeWithIcon size="sm" color="success" iconLeading={Gift01}>
                                {p.expectedBonus}
                            </BadgeWithIcon>
                        )}
                    </div>
                </div>
            )}

            {p.notes && <p className="text-sm text-tertiary">{p.notes}</p>}

            {isOpened && p.opened && (
                <Link href={p.opened.href} className="flex items-center gap-1.5 text-sm font-medium text-brand-secondary hover:underline">
                    Opened — view {p.opened.kind === "card" ? "card" : "account"}
                    <ArrowUpRight aria-hidden="true" className="size-4" />
                </Link>
            )}

            <div className="mt-auto flex flex-wrap gap-1.5 border-t border-secondary pt-3">
                {!isOpened && (
                    <Button size="sm" color="primary" onClick={() => onOpenPlan(p)} isLoading={openingId === p.id}>
                        Mark opened
                    </Button>
                )}
                <Button size="sm" color="secondary" iconLeading={Edit01} onClick={() => onEdit(p)}>
                    Edit
                </Button>
                {!isOpened && (
                    <Button size="sm" color="tertiary" iconLeading={isDismissed ? Plus : XClose} onClick={() => onDismiss(p)}>
                        {isDismissed ? "Restore" : "Dismiss"}
                    </Button>
                )}
                <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} onClick={() => onDelete(p)} aria-label="Delete plan" />
            </div>
        </Card>
    );
}
