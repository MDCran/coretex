"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download01 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { DEDUCTION_CATEGORIES } from "@/lib/financial/deductions";
import { setTransactionDeductible } from "@/lib/actions/financial-deductions";
import { formatCurrency } from "@/lib/financial/format";
import { Card, NativeInput, NativeSelect, SectionHeader, Stat } from "../_components/financial-ui";

export interface DeductionRow {
    id: string;
    date: string;
    merchant: string;
    category: string | null;
    amount: number;
    deductible: boolean;
    deductionCategory: string | null;
    note: string | null;
}

function download(filename: string, content: string) {
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

export function DeductionsClient({ rows, year, years }: { rows: DeductionRow[]; year: number; years: number[] }) {
    const router = useRouter();
    const [pending, start] = useTransition();
    const [query, setQuery] = useState("");
    const [onlyDeductible, setOnlyDeductible] = useState(false);
    // Optimistic local overlay so toggles feel instant.
    const [overrides, setOverrides] = useState<Record<string, { deductible: boolean; category: string | null }>>({});

    const merged = useMemo(
        () => rows.map((r) => ({ ...r, ...(overrides[r.id] ?? {}) })),
        [rows, overrides],
    );

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return merged.filter((r) => (!onlyDeductible || r.deductible) && (!q || r.merchant.toLowerCase().includes(q) || (r.category ?? "").toLowerCase().includes(q)));
    }, [merged, query, onlyDeductible]);

    const deductibleRows = merged.filter((r) => r.deductible);
    const total = deductibleRows.reduce((s, r) => s + Math.abs(r.amount), 0);
    const byCategory = useMemo(() => {
        const map = new Map<string, number>();
        for (const r of deductibleRows) map.set(r.deductionCategory ?? "Uncategorized", (map.get(r.deductionCategory ?? "Uncategorized") ?? 0) + Math.abs(r.amount));
        return [...map.entries()].sort((a, b) => b[1] - a[1]);
    }, [deductibleRows]);

    function update(row: DeductionRow & { deductible: boolean; deductionCategory: string | null }, deductible: boolean, category: string | null) {
        setOverrides((o) => ({ ...o, [row.id]: { deductible, category } }));
        start(async () => {
            try {
                await setTransactionDeductible(row.id, deductible, category);
            } catch {
                toast.error("Couldn't update — try again.");
                setOverrides((o) => {
                    const next = { ...o };
                    delete next[row.id];
                    return next;
                });
            }
        });
    }

    function exportCsv() {
        const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
        const lines = [
            ["Date", "Merchant", "Deduction category", "Spending category", "Amount"].join(","),
            ...deductibleRows.map((r) => [r.date, esc(r.merchant), esc(r.deductionCategory ?? "Uncategorized"), esc(r.category ?? ""), Math.abs(r.amount).toFixed(2)].join(",")),
        ];
        download(`deductions_${year}.csv`, lines.join("\n"));
        toast.success(`Exported ${deductibleRows.length} deductible items`);
    }

    return (
        <div className="flex flex-col gap-6">
            <SectionHeader
                title="Tax deductions"
                description="Tag deductible transactions and generate a year-end summary by deduction category."
                action={
                    <NativeSelect value={String(year)} onChange={(e) => router.push(`/financial/deductions?year=${e.target.value}`)} className="w-32">
                        {years.map((y) => (
                            <option key={y} value={y}>
                                {y}
                            </option>
                        ))}
                    </NativeSelect>
                }
            />

            <div className="grid gap-4 sm:grid-cols-3">
                <Stat label={`${year} deductible total`} value={formatCurrency(total)} tone="success" />
                <Stat label="Tagged items" value={String(deductibleRows.length)} />
                <Stat label="Categories" value={String(byCategory.length)} />
            </div>

            {byCategory.length > 0 && (
                <Card className="flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-secondary">By deduction category</p>
                        <Button color="secondary" size="sm" iconLeading={<Download01 data-icon className="size-4" />} onClick={exportCsv}>
                            Export CSV
                        </Button>
                    </div>
                    <ul className="flex flex-col divide-y divide-secondary">
                        {byCategory.map(([name, amt]) => (
                            <li key={name} className="flex items-center justify-between gap-3 py-2 text-sm">
                                <span className="text-secondary">{name}</span>
                                <span className="font-medium text-primary tabular-nums">{formatCurrency(amt)}</span>
                            </li>
                        ))}
                    </ul>
                </Card>
            )}

            <Card className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-3">
                    <NativeInput placeholder="Search transactions…" value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-xs" />
                    <Checkbox isSelected={onlyDeductible} onChange={setOnlyDeductible} label="Deductible only" size="sm" />
                    <span className="ml-auto text-xs text-tertiary">{filtered.length} shown</span>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full min-w-[680px] text-sm">
                        <thead>
                            <tr className="border-b border-secondary text-left text-tertiary">
                                <th className="px-3 py-2 font-medium">Deductible</th>
                                <th className="px-3 py-2 font-medium">Date</th>
                                <th className="px-3 py-2 font-medium">Merchant</th>
                                <th className="px-3 py-2 font-medium">Deduction category</th>
                                <th className="px-3 py-2 text-right font-medium">Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="px-3 py-8 text-center text-tertiary">
                                        No transactions {onlyDeductible ? "tagged deductible" : "found"} for {year}.
                                    </td>
                                </tr>
                            )}
                            {filtered.map((r) => (
                                <tr key={r.id} className="border-b border-secondary last:border-0">
                                    <td className="px-3 py-2">
                                        <Checkbox aria-label={`Mark ${r.merchant} deductible`} isSelected={r.deductible} onChange={(on) => update(r, on, on ? r.deductionCategory ?? "Business" : null)} size="sm" />
                                    </td>
                                    <td className="px-3 py-2 text-tertiary tabular-nums">{r.date}</td>
                                    <td className="px-3 py-2 text-primary">{r.merchant}</td>
                                    <td className="px-3 py-2">
                                        {r.deductible ? (
                                            <NativeSelect value={r.deductionCategory ?? "Business"} onChange={(e) => update(r, true, e.target.value)} className="w-48" disabled={pending}>
                                                {DEDUCTION_CATEGORIES.map((c) => (
                                                    <option key={c} value={c}>
                                                        {c}
                                                    </option>
                                                ))}
                                            </NativeSelect>
                                        ) : (
                                            <span className="text-quaternary">—</span>
                                        )}
                                    </td>
                                    <td className="px-3 py-2 text-right font-medium text-primary tabular-nums">{formatCurrency(Math.abs(r.amount))}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
}
