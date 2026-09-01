// @ts-nocheck

import { cx } from "@/utils/cx";
import { NativeInput } from "./financial-ui";
import { TrendChart, type TrendPoint } from "./trend-chart";
import { useId, useState, useMemo } from "react";
import { Button } from "react-aria-components";
import { formatCurrency } from "../../personal/personal-ui";

export interface FlowTimelineTransaction {
    date: string;
    amount: number;
}

type FlowMode = "both" | "deposits" | "withdrawals";

const MODES: Array<{ id: FlowMode; label: string }> = [
    { id: "both", label: "Both" },
    { id: "deposits", label: "Deposits" },
    { id: "withdrawals", label: "Withdrawals" },
];

function monthKey(date: string): string {
    const m = date.match(/^(\d{4})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}`;
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return "Unknown";
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function FlowTimelineChart({
    transactions,
    depositLabel = "Deposits",
    withdrawalLabel = "Withdrawals",
    emptyLabel = "No matching transactions",
    height = 240,
}: {
    transactions: FlowTimelineTransaction[];
    depositLabel?: string;
    withdrawalLabel?: string;
    emptyLabel?: string;
    height?: number;
}) {
    const modeName = useId();
    const [mode, setMode] = useState<FlowMode>("both");
    const [minimum, setMinimum] = useState("");
    const minimumAmount = Math.max(0, Number(minimum) || 0);

    const { data, count } = useMemo(() => {
        const buckets = new Map<string, { deposits: number; withdrawals: number; net: number; count: number }>();

        for (const tx of transactions) {
            const amount = Number(tx.amount);
            if (!Number.isFinite(amount)) continue;

            const isDeposit = amount >= 0;
            if (mode === "deposits" && !isDeposit) continue;
            if (mode === "withdrawals" && isDeposit) continue;
            if (minimumAmount > 0 && Math.abs(amount) < minimumAmount) continue;

            const key = monthKey(tx.date);
            const bucket = buckets.get(key) ?? { deposits: 0, withdrawals: 0, net: 0, count: 0 };
            if (isDeposit) bucket.deposits += amount;
            else bucket.withdrawals += Math.abs(amount);
            bucket.net += amount;
            bucket.count += 1;
            buckets.set(key, bucket);
        }

        const rows: TrendPoint[] = [...buckets.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .slice(-12)
            .map(([label, value]) => ({
                label,
                deposits: value.deposits,
                withdrawals: value.withdrawals,
                net: value.net,
            }));

        return { data: rows, count: [...buckets.values()].reduce((sum, b) => sum + b.count, 0) };
    }, [minimumAmount, mode, transactions]);

    const series = useMemo(() => {
        if (mode === "deposits") return [{ key: "deposits", name: depositLabel, color: "var(--color-success-solid)" }];
        if (mode === "withdrawals") return [{ key: "withdrawals", name: withdrawalLabel, color: "var(--color-error-solid)" }];
        return [
            { key: "deposits", name: depositLabel, color: "var(--color-success-solid)" },
            { key: "withdrawals", name: withdrawalLabel, color: "var(--color-error-solid)" },
            { key: "net", name: "Net", color: "var(--color-brand-500)" },
        ];
    }, [depositLabel, mode, withdrawalLabel]);

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                    <div role="radiogroup" aria-label="Timeline flow" className="inline-flex rounded-lg bg-secondary p-1 ring-1 ring-secondary ring-inset">
                        {MODES.map((item) => (
                            <label
                                key={item.id}
                                className={cx(
                                    "cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition duration-100 ease-linear",
                                    mode === item.id ? "bg-primary text-primary shadow-xs" : "text-tertiary hover:text-primary",
                                )}
                            >
                                <input
                                    type="radio"
                                    name={modeName}
                                    value={item.id}
                                    checked={mode === item.id}
                                    onChange={() => setMode(item.id)}
                                    className="sr-only"
                                />
                                {item.id === "deposits" ? depositLabel : item.id === "withdrawals" ? withdrawalLabel : item.label}
                            </label>
                        ))}
                    </div>
                    <p className="text-xs text-tertiary">
                        {count} {count === 1 ? "transaction" : "transactions"}
                        {minimumAmount > 0 ? ` over ${formatCurrency(minimumAmount)}` : ""}
                    </p>
                </div>
                <div className="flex w-full flex-col gap-1.5 sm:max-w-52">
                    <label htmlFor="flow-minimum" className="text-xs font-medium text-tertiary">
                        Minimum amount
                    </label>
                    <div className="flex gap-2">
                        <NativeInput
                            id="flow-minimum"
                            type="number"
                            min={0}
                            step="0.01"
                            value={minimum}
                            onChange={(event) => setMinimum(event.currentTarget.value)}
                            placeholder="0.00"
                        />
                        {minimum && (
                            <Button size="sm" color="secondary" type="button" onClick={() => setMinimum("")}>
                                Clear
                            </Button>
                        )}
                    </div>
                </div>
            </div>
            <TrendChart data={data} type="bar" series={series} height={height} emptyLabel={emptyLabel} />
        </div>
    );
}
