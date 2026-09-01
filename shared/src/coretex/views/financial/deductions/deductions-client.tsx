// @ts-nocheck

import { formatCurrency } from "../../personal/personal-ui";
import { toast } from "sonner";
import { Button, Checkbox } from "react-aria-components";
import { useMemo, useState } from "react";
import { Download01 } from "@untitledui/icons";
import { Card, NativeInput, NativeSelect, SectionHeader, Stat } from "../_components/financial-ui";
import { MerchantLogo } from "../_components/merchant-logo";
import { useLifeOSMutation } from "../../personal/use-lifeos-mutation";
import type { LifeOSClient } from "../../personal/use-lifeos-query";

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

const PAGE_SIZE = 100;

export function DeductionsClient({
    client,
    rows,
    year,
    years,
    scheduleCCategories = [],
    onYearChange,
}: {
    client: LifeOSClient;
    rows: DeductionRow[];
    year: number;
    years: number[];
    scheduleCCategories?: string[];
    onYearChange?: (year: number) => void;
}) {
    const [query, setQuery] = useState("");
    const [onlyDeductible, setOnlyDeductible] = useState(false);
    const [page, setPage] = useState(1);
    // Optimistic local overlay so toggles feel instant.
    const [overrides, setOverrides] = useState<Record<string, { deductible: boolean; deductionCategory: string | null }>>({});

    const setDeductibleMutation = useLifeOSMutation(client, "financial:setDeductible");

    const merged = useMemo(
        () => rows.map((r) => ({ ...r, ...(overrides[r.id] ?? {}) })),
        [rows, overrides],
    );

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return merged.filter((r) => (!onlyDeductible || r.deductible) && (!q || r.merchant.toLowerCase().includes(q) || (r.category ?? "").toLowerCase().includes(q)));
    }, [merged, query, onlyDeductible]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const safePage = Math.min(page, totalPages);
    const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

    const deductibleRows = merged.filter((r) => r.deductible);
    const total = deductibleRows.reduce((s, r) => s + Math.abs(r.amount), 0);
    const byCategory = useMemo(() => {
        const map = new Map<string, number>();
        for (const r of deductibleRows) map.set(r.deductionCategory ?? "Uncategorized", (map.get(r.deductionCategory ?? "Uncategorized") ?? 0) + Math.abs(r.amount));
        return [...map.entries()].sort((a, b) => b[1] - a[1]);
    }, [deductibleRows]);

    function update(row: DeductionRow, deductible: boolean, category: string | null) {
        setOverrides((o) => ({ ...o, [row.id]: { deductible, deductionCategory: category } }));
        setDeductibleMutation.mutate({ id: row.id, deductible, category }).catch(() => {
            toast.error("Couldn't update — try again.");
            setOverrides((o) => {
                const next = { ...o };
                delete next[row.id];
                return next;
            });
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
                description="Tag deductible transactions by Schedule C category and generate a year-end summary."
                action={
                    <NativeSelect value={String(year)} onChange={(e) => onYearChange?.(Number(e.target.value))} className="w-32">
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
                        <p className="text-sm font-medium text-secondary">By Schedule C category</p>
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
                    <NativeInput
                        placeholder="Search transactions…"
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            setPage(1);
                        }}
                        className="max-w-xs"
                    />
                    <Checkbox
                        isSelected={onlyDeductible}
                        onChange={(v) => {
                            setOnlyDeductible(v);
                            setPage(1);
                        }}
                        label="Deductible only"
                        size="sm"
                    />
                    <span className="ml-auto text-xs text-tertiary">{filtered.length.toLocaleString()} shown</span>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] text-sm">
                        <thead>
                            <tr className="border-b border-secondary text-left text-tertiary">
                                <th className="px-3 py-2 font-medium">Deductible</th>
                                <th className="px-3 py-2 font-medium">Date</th>
                                <th className="px-3 py-2 font-medium">Merchant</th>
                                <th className="px-3 py-2 font-medium">Schedule C category</th>
                                <th className="px-3 py-2 text-right font-medium">Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            {pageRows.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="px-3 py-8 text-center text-tertiary">
                                        No transactions {onlyDeductible ? "tagged deductible" : "found"} for {year}.
                                    </td>
                                </tr>
                            )}
                            {pageRows.map((r) => (
                                <tr key={r.id} className="border-b border-secondary last:border-0">
                                    <td className="px-3 py-2">
                                        <Checkbox aria-label={`Mark ${r.merchant} deductible`} isSelected={r.deductible} onChange={(on) => update(r, on, on ? r.deductionCategory ?? scheduleCCategories[0] ?? "Other expenses" : null)} size="sm" />
                                    </td>
                                    <td className="px-3 py-2 text-tertiary tabular-nums">{r.date}</td>
                                    <td className="px-3 py-2 text-primary">
                                        <span className="flex min-w-0 items-center gap-2">
                                            <MerchantLogo merchant={r.merchant} size="xs" />
                                            <span className="truncate">{r.merchant}</span>
                                        </span>
                                    </td>
                                    <td className="px-3 py-2">
                                        {r.deductible ? (
                                            <NativeSelect value={r.deductionCategory ?? scheduleCCategories[0] ?? ""} onChange={(e) => update(r, true, e.target.value)} className="w-56">
                                                {scheduleCCategories.map((c) => (
                                                    <option key={c} value={c}>
                                                        {c}
                                                    </option>
                                                ))}
                                            </NativeSelect>
                                        ) : (
                                            <span className="text-quaternary">—</span>
                                        )}
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                        <span className="flex items-center justify-end gap-2">
                                            <span className="font-medium text-primary tabular-nums">{formatCurrency(Math.abs(r.amount))}</span>
                                            {r.deductible && <span className="rounded-full bg-success-primary px-2 py-0.5 text-xs font-medium text-success-primary">Deductible</span>}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {filtered.length > PAGE_SIZE && (
                    <div className="flex items-center justify-end gap-2 border-t border-secondary pt-4">
                        <Button size="sm" color="secondary" isDisabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>
                            Previous
                        </Button>
                        <span className="text-xs text-tertiary">
                            Page {safePage} of {totalPages}
                        </span>
                        <Button size="sm" color="secondary" isDisabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>
                            Next
                        </Button>
                    </div>
                )}
            </Card>
        </div>
    );
}
