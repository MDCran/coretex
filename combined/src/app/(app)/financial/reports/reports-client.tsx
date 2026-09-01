"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Download01, FileDownload03 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { formatCurrency } from "@/lib/financial/format";
import { Card, Field, NativeSelect, Stat } from "../_components/financial-ui";
import { ControlledDateInput } from "@/components/base/input/form-date-input";

export interface ReportRow {
    id: string;
    date: string; // yyyy-mm-dd
    merchant: string;
    category: string;
    account: string;
    amount: number;
}

function isoDaysAgo(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
}

function download(filename: string, content: string, type: string) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

export function ReportsClient({ rows }: { rows: ReportRow[] }) {
    const [from, setFrom] = useState(isoDaysAgo(90));
    const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
    const [category, setCategory] = useState("all");
    const [account, setAccount] = useState("all");

    const categories = useMemo(() => Array.from(new Set(rows.map((r) => r.category))).sort(), [rows]);
    const accounts = useMemo(() => Array.from(new Set(rows.map((r) => r.account))).sort(), [rows]);

    const filtered = useMemo(
        () =>
            rows.filter(
                (r) => r.date >= from && r.date <= to && (category === "all" || r.category === category) && (account === "all" || r.account === account),
            ),
        [rows, from, to, category, account],
    );

    const summary = useMemo(() => {
        let inflow = 0;
        let outflow = 0;
        const byCat = new Map<string, number>();
        for (const r of filtered) {
            if (r.amount >= 0) inflow += r.amount;
            else outflow += Math.abs(r.amount);
            if (r.amount < 0) byCat.set(r.category, (byCat.get(r.category) ?? 0) + Math.abs(r.amount));
        }
        const topCats = [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
        return { inflow, outflow, net: inflow - outflow, count: filtered.length, topCats };
    }, [filtered]);

    function exportCsv() {
        const header = ["Date", "Merchant", "Category", "Account", "Amount"];
        const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
        const lines = [
            header.join(","),
            ...filtered.map((r) => [r.date, escape(r.merchant), escape(r.category), escape(r.account), r.amount.toFixed(2)].join(",")),
        ];
        download(`transactions_${from}_to_${to}.csv`, lines.join("\n"), "text/csv;charset=utf-8");
        toast.success(`Exported ${filtered.length} transactions to CSV`);
    }

    async function exportPdf() {
        try {
            const { jsPDF } = await import("jspdf");
            const autoTable = (await import("jspdf-autotable")).default;
            const doc = new jsPDF();
            doc.setFontSize(16);
            doc.text("Financial report", 14, 18);
            doc.setFontSize(10);
            doc.setTextColor(110);
            doc.text(`${from} to ${to}${category !== "all" ? ` · ${category}` : ""}${account !== "all" ? ` · ${account}` : ""}`, 14, 25);
            doc.text(
                `In: ${formatCurrency(summary.inflow)}    Out: ${formatCurrency(summary.outflow)}    Net: ${formatCurrency(summary.net)}    (${summary.count} transactions)`,
                14,
                31,
            );
            autoTable(doc, {
                startY: 37,
                head: [["Date", "Merchant", "Category", "Account", "Amount"]],
                body: filtered.map((r) => [r.date, r.merchant, r.category, r.account, formatCurrency(r.amount)]),
                styles: { fontSize: 8 },
                headStyles: { fillColor: [127, 86, 217] },
            });
            doc.save(`transactions_${from}_to_${to}.pdf`);
            toast.success(`Exported ${filtered.length} transactions to PDF`);
        } catch {
            toast.error("Couldn't generate the PDF.");
        }
    }

    return (
        <div className="flex flex-col gap-6">
            <Card className="flex flex-col gap-4">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Field label="From">
                        <ControlledDateInput variant="date" value={from || null} onChange={setFrom} className="w-full" />
                    </Field>
                    <Field label="To">
                        <ControlledDateInput variant="date" value={to || null} onChange={setTo} className="w-full" />
                    </Field>
                    <Field label="Category">
                        <NativeSelect value={category} onChange={(e) => setCategory(e.target.value)}>
                            <option value="all">All categories</option>
                            {categories.map((c) => (
                                <option key={c} value={c}>
                                    {c}
                                </option>
                            ))}
                        </NativeSelect>
                    </Field>
                    <Field label="Account">
                        <NativeSelect value={account} onChange={(e) => setAccount(e.target.value)}>
                            <option value="all">All accounts</option>
                            {accounts.map((a) => (
                                <option key={a} value={a}>
                                    {a}
                                </option>
                            ))}
                        </NativeSelect>
                    </Field>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button color="secondary" size="sm" iconLeading={<Download01 data-icon className="size-4" />} onClick={exportCsv} isDisabled={filtered.length === 0}>
                        Export CSV
                    </Button>
                    <Button color="secondary" size="sm" iconLeading={<FileDownload03 data-icon className="size-4" />} onClick={exportPdf} isDisabled={filtered.length === 0}>
                        Export PDF
                    </Button>
                </div>
            </Card>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Transactions" value={summary.count.toLocaleString()} />
                <Stat label="Money in" value={formatCurrency(summary.inflow)} tone="success" />
                <Stat label="Money out" value={formatCurrency(summary.outflow)} tone="error" />
                <Stat label="Net" value={formatCurrency(summary.net)} tone={summary.net >= 0 ? "success" : "error"} />
            </div>

            {summary.topCats.length > 0 && (
                <Card className="flex flex-col gap-3">
                    <p className="text-sm font-medium text-secondary">Top spending categories</p>
                    <ul className="flex flex-col divide-y divide-secondary">
                        {summary.topCats.map(([name, amt]) => (
                            <li key={name} className="flex items-center justify-between gap-3 py-2 text-sm">
                                <span className="truncate text-secondary">{name}</span>
                                <span className="font-medium text-primary tabular-nums">{formatCurrency(amt)}</span>
                            </li>
                        ))}
                    </ul>
                </Card>
            )}
        </div>
    );
}
