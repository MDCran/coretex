// @ts-nocheck


import { cx } from "@/utils/cx";
import { BloomCard, Card, Field, NativeInput, SectionHeader, Stat } from "../_components/financial-ui";
import { TrendDown02 } from "@untitledui/icons";
import { useState, useMemo } from "react";
import { formatCurrency } from "../../personal/personal-ui";

function monthsLabel(m: number): string {
    if (m <= 0) return "—";
    const y = Math.floor(m / 12);
    const mo = m % 12;
    return [y > 0 ? `${y} yr` : "", mo > 0 ? `${mo} mo` : ""].filter(Boolean).join(" ") || "0 mo";
}

export function DebtPayoffPlanner({ debts }: { debts: PayoffDebt[] }) {
    const [extra, setExtra] = useState(200);
    const [strategy, setStrategy] = useState<PayoffStrategy>("avalanche");

    const totalBalance = debts.reduce((s, d) => s + d.balance, 0);

    const snowball = useMemo(() => simulatePayoff(debts, "snowball", extra), [debts, extra]);
    const avalanche = useMemo(() => simulatePayoff(debts, "avalanche", extra), [debts, extra]);
    // Baseline = minimums only (no extra), to show interest/time saved.
    const baseline = useMemo(() => simulatePayoff(debts, "avalanche", 0), [debts]);

    if (debts.length === 0) {
        return (
            <Card>
                <SectionHeader title="Payoff planner" description="Add debts or carry a card balance to simulate snowball vs avalanche payoff." />
            </Card>
        );
    }

    const recommended = avalanche.totalInterest <= snowball.totalInterest ? "avalanche" : "snowball";
    const active = strategy === "avalanche" ? avalanche : snowball;
    const interestSaved = Math.max(0, baseline.totalInterest - active.totalInterest);
    const monthsSaved = Math.max(0, baseline.months - active.months);

    const StrategyCard = ({ kind, result }: { kind: PayoffStrategy; result: typeof snowball }) => {
        const isRec = recommended === kind;
        return (
            <button
                type="button"
                onClick={() => setStrategy(kind)}
                className={cx(
                    "flex flex-col items-start gap-1 rounded-xl p-4 text-left ring-1 ring-inset transition",
                    strategy === kind ? "bg-secondary ring-brand" : "bg-primary ring-secondary hover:bg-primary_hover",
                )}
            >
                <div className="flex w-full items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-primary capitalize">{kind}</span>
                    {isRec && <span className="rounded-full bg-success-secondary px-2 py-0.5 text-xs font-medium text-success-primary">Lowest interest</span>}
                </div>
                <span className="text-xs text-tertiary">{kind === "avalanche" ? "Highest APR first" : "Smallest balance first"}</span>
                <div className="mt-2 flex w-full items-baseline justify-between gap-2">
                    <span className="text-display-xs font-semibold text-primary">{monthsLabel(result.months)}</span>
                    <span className="text-sm text-tertiary">{formatCurrency(result.totalInterest)} interest</span>
                </div>
                {result.impossible && <span className="text-xs font-medium text-error-primary">Payments don&apos;t cover interest — increase the extra payment.</span>}
            </button>
        );
    };

    return (
        <div className="flex flex-col gap-4">
            <SectionHeader title="Payoff planner" description="Compare the snowball and avalanche strategies and see how extra payments accelerate your debt-free date." />

            <Card className="flex flex-col gap-4">
                <Field label={`Extra monthly payment — ${formatCurrency(extra)}`} hint="On top of all minimum payments, applied to the target debt.">
                    <input
                        type="range"
                        min={0}
                        max={2000}
                        step={25}
                        value={extra}
                        onChange={(e) => setExtra(Number(e.target.value))}
                        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-quaternary accent-brand-solid"
                    />
                </Field>
                <div className="flex items-center gap-3">
                    <NativeInput type="number" min={0} step={25} value={extra} onChange={(e) => setExtra(Math.max(0, Number(e.target.value) || 0))} className="max-w-32" />
                    <span className="text-sm text-tertiary">Total balance: {formatCurrency(totalBalance)}</span>
                </div>
            </Card>

            <div className="grid gap-4 sm:grid-cols-2">
                <StrategyCard kind="avalanche" result={avalanche} />
                <StrategyCard kind="snowball" result={snowball} />
            </div>

            {(interestSaved > 0 || monthsSaved > 0) && (
                <BloomCard bloom="success">
                    <div className="flex items-center gap-3">
                        <TrendDown02 className="size-5 text-fg-success-primary" />
                        <p className="text-sm text-secondary">
                            With <span className="font-semibold text-primary">{formatCurrency(extra)}/mo</span> extra on the {strategy} plan you&apos;re debt-free{" "}
                            <span className="font-semibold text-primary">{monthsLabel(monthsSaved)}</span> sooner and save{" "}
                            <span className="font-semibold text-success-primary">{formatCurrency(interestSaved)}</span> in interest vs minimum payments only.
                        </p>
                    </div>
                </BloomCard>
            )}

            <Card className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-secondary capitalize">{strategy} payoff order</p>
                    <p className="text-xs text-tertiary">{formatCurrency(active.totalPaid)} paid total</p>
                </div>
                <ol className="flex flex-col divide-y divide-secondary">
                    {active.order.map((o, i) => (
                        <li key={o.id} className="flex items-center justify-between gap-3 py-2.5">
                            <div className="flex min-w-0 items-center gap-3">
                                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary tabular-nums">{i + 1}</span>
                                <span className="truncate text-sm text-primary">{o.name}</span>
                            </div>
                            <div className="shrink-0 text-right">
                                <p className="text-sm font-medium text-primary">Paid off {monthsLabel(o.payoffMonth)}</p>
                                <p className="text-xs text-tertiary">{formatCurrency(o.interestPaid)} interest</p>
                            </div>
                        </li>
                    ))}
                </ol>
            </Card>
        </div>
    );
}
