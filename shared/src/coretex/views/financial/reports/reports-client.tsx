// @ts-nocheck

import { formatCurrency } from "../../personal/personal-ui";
import { toast } from "sonner";
import { Button } from "react-aria-components";
import { useState, useMemo } from "react";
import { Download01, FileDownload03, ChevronLeft, ChevronRight } from "@untitledui/icons";
import { Card, Field, NativeSelect, Stat } from "../_components/financial-ui";
import { TrendChart } from "../_components/trend-chart";
import { ControlledDateInput } from "@/components/base/input/form-date-input";
import type { LifeOSClient } from "../../personal/use-lifeos-query";

export interface ReportRow {
    id: string;
    date: string; // yyyy-mm-dd
    merchant: string;
    category: string;
    account: string;
    amount: number;
}

export interface MonthlyRow {
    id: string;
    month: string; // YYYY-MM
    income: number;
    spending: number;
    netCashFlow: number;
}

function isoDaysAgo(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
}

function monthLabel(key: string): string {
    const [y, m] = key.split("-").map(Number);
    if (!y || !m) return key;
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: "short", year: "2-digit", timeZone: "UTC" });
}

function monthBoundsFor(key: string): { from: string; to: string } {
    const [y, m] = key.split("-").map(Number);
    const from = `${y}-${String(m).padStart(2, "0")}-01`;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const to = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    return { from, to };
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

/** Trailing cash-flow chart with a scrubbable 12-month window; clicking a month focuses the ledger below on it. */
function CashFlowSection({ monthly, onFocusMonth, focusedMonth }: { monthly: MonthlyRow[]; onFocusMonth: (month: string | null) => void; focusedMonth: string | null }) {
    const windowSize = 12;
    const maxOffset = Math.max(0, monthly.length - windowSize);
    const [offset, setOffset] = useState(maxOffset);
    const slice = monthly.slice(Math.max(0, offset), Math.max(0, offset) + windowSize);
    const chartData = slice.map((row) => ({ label: monthLabel(row.month), month: row.month, Income: row.income, Spending: row.spending, Net: row.netCashFlow }));
    const labelStart = slice[0]?.month ? monthLabel(slice[0].month) : "—";
    const labelEnd = slice[slice.length - 1]?.month ? monthLabel(slice[slice.length - 1].month) : "—";

    if (monthly.length === 0) return null;

    return (
        <Card className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h3 className="text-sm font-semibold text-primary">Cash flow over time</h3>
                    <p className="text-xs text-tertiary">Income, spending and net across {labelStart} – {labelEnd}. Select a bar to focus the ledger.</p>
                </div>
                <div className="flex items-center gap-1.5">
                    <button type="button" className="grid size-8 place-items-center rounded-lg border border-secondary text-tertiary transition hover:bg-secondary disabled:opacity-40" disabled={offset <= 0} onClick={() => setOffset((o) => Math.max(0, o - 1))} aria-label="Earlier months">
                        <ChevronLeft className="size-4" />
                    </button>
                    <button type="button" className="grid size-8 place-items-center rounded-lg border border-secondary text-tertiary transition hover:bg-secondary disabled:opacity-40" disabled={offset >= maxOffset} onClick={() => setOffset((o) => Math.min(maxOffset, o + 1))} aria-label="Later months">
                        <ChevronRight className="size-4" />
                    </button>
                </div>
            </div>
            <TrendChart
                data={chartData}
                series={[{ key: "Income", name: "Income", color: "var(--color-success-solid)" }, { key: "Spending", name: "Spending", color: "var(--color-error-solid)" }, { key: "Net", name: "Net", color: "var(--color-brand-500)" }]}
                type="bar"
                height={260}
                money
                emptyLabel="No cash-flow history yet"
                onPointClick={(point) => onFocusMonth(typeof point.month === "string" ? point.month : null)}
            />
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-tertiary">Focus a month:</span>
                <NativeSelect
                    value={focusedMonth ?? ""}
                    onChange={(e) => onFocusMonth(e.target.value || null)}
                    className="w-40"
                >
                    <option value="">All months</option>
                    {slice.map((row) => (
                        <option key={row.month} value={row.month}>
                            {monthLabel(row.month)}
                        </option>
                    ))}
                </NativeSelect>
                {focusedMonth && (
                    <Button size="sm" color="link-gray" onClick={() => onFocusMonth(null)}>
                        Clear focus
                    </Button>
                )}
            </div>
        </Card>
    );
}

const PAGE_SIZE = 100;

export function ReportsClient({ client: _client, rows, monthly = [] }: { client: LifeOSClient; rows: ReportRow[]; monthly?: MonthlyRow[] }) {
    const [from, setFrom] = useState(isoDaysAgo(90));
    const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
    const [category, setCategory] = useState("all");
    const [account, setAccount] = useState("all");
    const [focusedMonth, setFocusedMonth] = useState<string | null>(null);
    const [page, setPage] = useState(1);

    function onFocusMonth(month: string | null) {
        setFocusedMonth(month);
        setPage(1);
        if (month) {
            const bounds = monthBoundsFor(month);
            setFrom(bounds.from);
            setTo(bounds.to);
        }
    }

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
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const safePage = Math.min(page, totalPages);
    const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

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
            <CashFlowSection monthly={monthly} onFocusMonth={onFocusMonth} focusedMonth={focusedMonth} />

            <Card className="flex flex-col gap-4">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Field label="From">
                        <ControlledDateInput
                            variant="date"
                            value={from || null}
                            onChange={(v) => {
                                setFrom(v);
                                setFocusedMonth(null);
                                setPage(1);
                            }}
                            className="w-full"
                        />
                    </Field>
                    <Field label="To">
                        <ControlledDateInput
                            variant="date"
                            value={to || null}
                            onChange={(v) => {
                                setTo(v);
                                setFocusedMonth(null);
                                setPage(1);
                            }}
                            className="w-full"
                        />
                    </Field>
                    <Field label="Category">
                        <NativeSelect value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}>
                            <option value="all">All categories</option>
                            {categories.map((c) => (
                                <option key={c} value={c}>
                                    {c}
                                </option>
                            ))}
                        </NativeSelect>
                    </Field>
                    <Field label="Account">
                        <NativeSelect value={account} onChange={(e) => { setAccount(e.target.value); setPage(1); }}>
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
                    <p className="text-sm font-medium text-secondary">Top spending categories{focusedMonth ? ` — ${monthLabel(focusedMonth)}` : ""}</p>
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

            <Card className="flex flex-col gap-4 p-0">
                <div className="flex items-center justify-between gap-3 px-5 pt-5">
                    <div>
                        <h3 className="text-sm font-semibold text-primary">Transactions</h3>
                        <p className="text-xs text-tertiary">{filtered.length.toLocaleString()} matching rows</p>
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-sm">
                        <thead>
                            <tr className="border-b border-secondary text-left text-tertiary">
                                <th className="px-5 py-3 font-medium">Date</th>
                                <th className="px-5 py-3 font-medium">Merchant</th>
                                <th className="px-5 py-3 font-medium">Category</th>
                                <th className="px-5 py-3 font-medium">Account</th>
                                <th className="px-5 py-3 text-right font-medium">Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            {pageRows.length === 0 ? (
                                <tr><td colSpan={5} className="px-5 py-10 text-center text-tertiary">No transactions match these filters.</td></tr>
                            ) : pageRows.map((row) => (
                                <tr key={row.id} className="border-b border-secondary last:border-0">
                                    <td className="px-5 py-3 text-tertiary tabular-nums">{row.date}</td>
                                    <td className="px-5 py-3 font-medium text-primary">{row.merchant}</td>
                                    <td className="px-5 py-3 text-secondary">{row.category}</td>
                                    <td className="px-5 py-3 text-secondary">{row.account}</td>
                                    <td className={`px-5 py-3 text-right font-medium tabular-nums ${row.amount >= 0 ? "text-success-primary" : "text-primary"}`}>{formatCurrency(row.amount)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {filtered.length > PAGE_SIZE && (
                    <div className="flex items-center justify-end gap-2 border-t border-secondary px-5 py-4">
                        <Button size="sm" color="secondary" isDisabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>Previous</Button>
                        <span className="text-xs text-tertiary">Page {safePage} of {totalPages}</span>
                        <Button size="sm" color="secondary" isDisabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>Next</Button>
                    </div>
                )}
            </Card>
        </div>
    );
}
