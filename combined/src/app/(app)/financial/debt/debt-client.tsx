"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Edit01, Plus, Trash02, TrendDown01 } from "@untitledui/icons";
import { toast } from "sonner";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { createDebt, deleteDebt, updateDebt } from "@/lib/actions/financial-debt";
import { formatCurrency, formatDate } from "@/lib/financial/format";
import { Card, EmptyRow, Field, NativeInput, NativeSelect, ProgressBar, SectionHeader, Stat, TableCard } from "../_components/financial-ui";
import { FormModal } from "../_components/form-modal";
import { useConfirm } from "../_components/confirm-modal";
import { FormDateInput } from "@/components/base/input/form-date-input";

/**
 * Simulate fixed-payment amortization. Returns the number of months to clear the
 * balance (capped), or null when the payment never reduces the balance.
 */
function monthsToPayoff(balance: number, annualRatePct: number, monthlyPayment: number): { months: number; totalInterest: number } | null {
    if (balance <= 0) return { months: 0, totalInterest: 0 };
    if (monthlyPayment <= 0) return null;
    const r = annualRatePct / 100 / 12;
    let bal = balance;
    let interest = 0;
    let months = 0;
    const CAP = 1200; // 100 years
    while (bal > 0.01 && months < CAP) {
        const i = bal * r;
        // If payment can't cover the monthly interest, payoff is impossible.
        if (monthlyPayment <= i) return null;
        interest += i;
        bal = bal + i - monthlyPayment;
        months++;
    }
    return months >= CAP ? null : { months, totalInterest: interest };
}

function monthsLabel(m: number): string {
    if (m <= 0) return "Paid off";
    const y = Math.floor(m / 12);
    const mo = m % 12;
    if (y === 0) return `${mo} mo`;
    if (mo === 0) return `${y} yr`;
    return `${y} yr ${mo} mo`;
}

/** Interactive payoff projection card with an extra-payment slider. */
function PayoffProjection({ debt }: { debt: DebtRow }) {
    const [extra, setExtra] = useState(0);
    const balance = debt.principalRemaining ?? 0;
    const apr = debt.apr ?? 0;
    const min = debt.minimumPayment ?? 0;

    const base = useMemo(() => monthsToPayoff(balance, apr, min), [balance, apr, min]);
    const boosted = useMemo(() => monthsToPayoff(balance, apr, min + extra), [balance, apr, min, extra]);

    if (balance <= 0) return null;

    return (
        <Card className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
                <TrendDown01 aria-hidden="true" className="size-4 text-fg-brand-primary" />
                <h4 className="text-sm font-semibold text-primary">{debt.name} — payoff projection</h4>
            </div>
            {min <= 0 ? (
                <p className="text-sm text-tertiary">Set a minimum payment to project a payoff timeline.</p>
            ) : base === null ? (
                <p className="text-sm text-error-primary">At {formatCurrency(min)}/mo the minimum payment doesn’t cover interest — the balance won’t shrink.</p>
            ) : (
                <>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-lg bg-secondary p-3">
                            <p className="text-xs text-tertiary">At minimum ({formatCurrency(min)}/mo)</p>
                            <p className="text-md font-semibold text-primary">{monthsLabel(base.months)}</p>
                            <p className="text-xs text-tertiary">{formatCurrency(base.totalInterest)} interest</p>
                        </div>
                        <div className="rounded-lg bg-brand-secondary p-3">
                            <p className="text-xs text-tertiary">With +{formatCurrency(extra)}/mo</p>
                            <p className="text-md font-semibold text-primary">{boosted ? monthsLabel(boosted.months) : "—"}</p>
                            <p className="text-xs text-tertiary">{boosted ? `${formatCurrency(boosted.totalInterest)} interest` : "—"}</p>
                        </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <div className="flex justify-between text-xs text-tertiary">
                            <span>Extra monthly payment</span>
                            <span className="font-medium text-primary">{formatCurrency(extra)}</span>
                        </div>
                        <input
                            type="range"
                            min={0}
                            max={Math.max(50, Math.round(min * 3))}
                            step={5}
                            value={extra}
                            onChange={(e) => setExtra(Number(e.target.value))}
                            aria-label={`Extra monthly payment for ${debt.name}`}
                            className="w-full accent-[var(--color-bg-brand-solid)]"
                        />
                        {base && boosted && boosted.months < base.months && (
                            <p className="text-xs text-success-primary">
                                Saves {monthsLabel(base.months - boosted.months)} and {formatCurrency(base.totalInterest - boosted.totalInterest)} in interest.
                            </p>
                        )}
                    </div>
                </>
            )}
        </Card>
    );
}

export interface DebtRow {
    id: string;
    name: string;
    kind: string | null;
    principalOriginal: number | null;
    principalRemaining: number | null;
    apr: number | null;
    minimumPayment: number | null;
    payoffGoalDate: string | null;
    strategy: string | null;
}

const STRATEGIES = [
    { value: "", label: "None" },
    { value: "avalanche", label: "Avalanche (highest APR first)" },
    { value: "snowball", label: "Snowball (smallest balance first)" },
];

export interface CardDebtRow {
    id: string;
    label: string;
    balance: number;
    apr: number | null;
}

export function DebtClient({ debts, cards = [] }: { debts: DebtRow[]; cards?: CardDebtRow[] }) {
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<DebtRow | null>(null);
    const { confirm, dialog } = useConfirm();

    const cardTotal = cards.reduce((s, c) => s + c.balance, 0);
    const totalRemaining = debts.reduce((s, d) => s + (d.principalRemaining ?? 0), 0) + cardTotal;
    const totalMinPayment = debts.reduce((s, d) => s + (d.minimumPayment ?? 0), 0);
    const paid = debts.reduce((s, d) => s + Math.max(0, (d.principalOriginal ?? 0) - (d.principalRemaining ?? 0)), 0);

    function openCreate() {
        setEditing(null);
        setOpen(true);
    }
    function openEdit(d: DebtRow) {
        setEditing(d);
        setOpen(true);
    }

    async function onSubmit(fd: FormData) {
        try {
            if (editing) await updateDebt(fd);
            else await createDebt(fd);
            toast.success(editing ? "Debt updated" : "Debt added");
            setOpen(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        }
    }
    function onDelete(id: string) {
        confirm({
            title: "Delete this debt?",
            destructive: true,
            confirmLabel: "Delete",
            onConfirm: async () => {
                const fd = new FormData();
                fd.set("id", id);
                try {
                    await deleteDebt(fd);
                    toast.success("Deleted");
                } catch {
                    toast.error("Failed");
                }
            },
        });
    }

    return (
        <div className="flex flex-col gap-6">
            <SectionHeader
                title="Debt"
                description="Loans and balances with payoff strategy."
                action={
                    <Button size="md" iconLeading={Plus} onClick={openCreate}>
                        Add debt
                    </Button>
                }
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Stat label="Total remaining" value={formatCurrency(totalRemaining)} tone="error" />
                <Stat label="Paid off" value={formatCurrency(paid)} tone="success" />
                <Stat label="Min. monthly payment" value={formatCurrency(totalMinPayment)} />
            </div>

            <TableCard minWidth={860}>
                <thead>
                    <tr className="border-b border-secondary text-left text-tertiary">
                        <th className="px-5 py-3 font-medium">Debt</th>
                        <th className="px-5 py-3 text-right font-medium">Remaining</th>
                        <th className="px-5 py-3 font-medium">Progress</th>
                        <th className="px-5 py-3 text-right font-medium">APR</th>
                        <th className="px-5 py-3 text-right font-medium">Min payment</th>
                        <th className="px-5 py-3 font-medium">Payoff goal</th>
                        <th className="px-5 py-3" />
                    </tr>
                </thead>
                <tbody>
                    {debts.length === 0 && (
                        <EmptyRow
                            colSpan={7}
                            icon={TrendDown01}
                            title="Build your payoff plan"
                            description="Track loans and balances, then let avalanche or snowball strategies map the fastest route to debt-free."
                            action={
                                <Button size="sm" iconLeading={Plus} onClick={openCreate}>
                                    Add debt
                                </Button>
                            }
                        />
                    )}
                    {debts.map((d) => {
                        const orig = d.principalOriginal ?? 0;
                        const rem = d.principalRemaining ?? 0;
                        const paidOff = Math.max(0, orig - rem);
                        return (
                            <tr key={d.id} className="border-b border-secondary last:border-0">
                                <td className="px-5 py-3">
                                    <p className="font-medium text-primary">{d.name}</p>
                                    <div className="mt-0.5 flex gap-1">
                                        {d.kind && (
                                            <Badge size="sm" color="gray">
                                                {d.kind}
                                            </Badge>
                                        )}
                                        {d.strategy && (
                                            <Badge size="sm" color="brand">
                                                {d.strategy}
                                            </Badge>
                                        )}
                                    </div>
                                </td>
                                <td className="px-5 py-3 text-right font-medium text-primary">{formatCurrency(rem)}</td>
                                <td className="px-5 py-3">
                                    {orig > 0 ? (
                                        <div className="flex w-32 flex-col gap-1">
                                            <ProgressBar value={paidOff} max={orig} color="success" />
                                            <span className="text-xs text-tertiary">{Math.round((paidOff / orig) * 100)}% paid</span>
                                        </div>
                                    ) : (
                                        <span className="text-tertiary">—</span>
                                    )}
                                </td>
                                <td className="px-5 py-3 text-right text-secondary">{d.apr != null ? `${d.apr}%` : "—"}</td>
                                <td className="px-5 py-3 text-right text-secondary">{d.minimumPayment != null ? formatCurrency(d.minimumPayment) : "—"}</td>
                                <td className="px-5 py-3 text-tertiary">{formatDate(d.payoffGoalDate)}</td>
                                <td className="px-5 py-3">
                                    <div className="flex justify-end gap-1">
                                        <Button size="sm" color="tertiary" iconLeading={Edit01} onClick={() => openEdit(d)} aria-label="Edit" />
                                        <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} onClick={() => onDelete(d.id)} aria-label="Delete" />
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </TableCard>

            {cards.length > 0 && (
                <Card className="flex flex-col gap-3 p-0">
                    <div className="flex items-center justify-between border-b border-secondary px-5 py-4">
                        <h3 className="text-md font-semibold text-primary">Credit cards (liabilities)</h3>
                        <Button size="sm" color="link-color" href="/financial/cards">
                            Manage cards
                        </Button>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[480px] text-sm">
                            <tbody>
                                {cards.map((c) => (
                                    <tr key={c.id} className="border-b border-secondary last:border-0">
                                        <td className="px-5 py-3">
                                            <Link href={`/financial/cards/${c.id}`} className="font-medium text-primary hover:text-brand-secondary">
                                                {c.label}
                                            </Link>
                                        </td>
                                        <td className="px-5 py-3 text-right text-tertiary">{c.apr != null ? `${c.apr}% APR` : "—"}</td>
                                        <td className="px-5 py-3 text-right font-medium text-error-primary">{formatCurrency(c.balance)}</td>
                                    </tr>
                                ))}
                                <tr className="border-t border-secondary">
                                    <td className="px-5 py-3 font-medium text-secondary">Total card debt</td>
                                    <td />
                                    <td className="px-5 py-3 text-right font-semibold text-error-primary">{formatCurrency(cardTotal)}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </Card>
            )}

            {debts.some((d) => (d.principalRemaining ?? 0) > 0) && (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {debts
                        .filter((d) => (d.principalRemaining ?? 0) > 0)
                        .map((d) => (
                            <PayoffProjection key={d.id} debt={d} />
                        ))}
                </div>
            )}

            <FormModal isOpen={open} onOpenChange={setOpen} title={editing ? "Edit debt" : "Add debt"}>
                <form action={onSubmit} className="flex flex-col gap-4">
                    {editing && <input type="hidden" name="id" value={editing.id} />}
                    <Field label="Name" htmlFor="name">
                        <NativeInput id="name" name="name" required defaultValue={editing?.name ?? ""} placeholder="e.g. Student loan" />
                    </Field>
                    <Field label="Kind" htmlFor="kind">
                        <NativeInput id="kind" name="kind" defaultValue={editing?.kind ?? ""} placeholder="e.g. student, auto, mortgage" />
                    </Field>
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Original principal" htmlFor="principalOriginal">
                            <NativeInput id="principalOriginal" name="principalOriginal" type="number" step="0.01" defaultValue={editing?.principalOriginal ?? ""} />
                        </Field>
                        <Field label="Remaining principal" htmlFor="principalRemaining">
                            <NativeInput id="principalRemaining" name="principalRemaining" type="number" step="0.01" defaultValue={editing?.principalRemaining ?? ""} />
                        </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="APR %" htmlFor="apr">
                            <NativeInput id="apr" name="apr" type="number" step="0.001" defaultValue={editing?.apr ?? ""} />
                        </Field>
                        <Field label="Min payment" htmlFor="minimumPayment">
                            <NativeInput id="minimumPayment" name="minimumPayment" type="number" step="0.01" defaultValue={editing?.minimumPayment ?? ""} />
                        </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <FormDateInput name="payoffGoalDate" label="Payoff goal date" defaultValue={editing?.payoffGoalDate ? editing.payoffGoalDate.slice(0, 10) : ""} />
                        <Field label="Strategy" htmlFor="strategy">
                            <NativeSelect id="strategy" name="strategy" defaultValue={editing?.strategy ?? ""}>
                                {STRATEGIES.map((s) => (
                                    <option key={s.value} value={s.value}>
                                        {s.label}
                                    </option>
                                ))}
                            </NativeSelect>
                        </Field>
                    </div>
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
