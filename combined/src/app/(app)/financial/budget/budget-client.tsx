"use client";

import { useMemo, useState } from "react";
import { Edit01, PieChart03, Plus, Trash02 } from "@untitledui/icons";
import { toast } from "sonner";
import { Button } from "@/components/base/buttons/button";
import { createBudgetCategory, deleteBudgetCategory, setGenericBudgetTotal, updateBudgetCategory } from "@/lib/actions/financial-budget";
import { categoryIcon } from "@/lib/financial/category-icons";
import { formatCurrency } from "@/lib/financial/format";
import { BloomCard, Card, EmptyState, Field, NativeInput, NativeSelect, ProgressBar, SectionHeader } from "../_components/financial-ui";
import { AmountBadge } from "../_components/amount-badge";
import { DonutChart, TrendChart, type TrendPoint } from "../_components/trend-chart";
import { FormModal } from "../_components/form-modal";
import { useConfirm } from "../_components/confirm-modal";

export interface CategoryRow {
    id: string;
    name: string;
    parentId: string | null;
    monthlyBudget: number | null;
    color: string | null;
    spent: number;
}

/** 12 curated category colors as hex values. */
const PALETTE = [
    "#7C3AED", // purple / brand
    "#3B82F6", // blue
    "#06B6D4", // cyan
    "#14B8A6", // teal
    "#22C55E", // green
    "#EAB308", // yellow
    "#F97316", // orange
    "#EF4444", // red
    "#EC4899", // pink
    "#F43F5E", // rose
    "#8B5CF6", // violet
    "#6B7280", // gray
];

function ColorPicker({ defaultValue }: { defaultValue: string | null }) {
    const [selected, setSelected] = useState<string>(defaultValue ?? PALETTE[0]);
    return (
        <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-secondary">Color</label>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Category color">
                {PALETTE.map((color) => (
                    <button
                        key={color}
                        type="button"
                        role="radio"
                        aria-checked={selected === color}
                        aria-label={color}
                        onClick={() => setSelected(color)}
                        className="size-7 rounded-full transition-transform duration-100 ease-linear hover:scale-110"
                        style={{
                            backgroundColor: color,
                            outline: selected === color ? `2px solid ${color}` : "none",
                            outlineOffset: 2,
                        }}
                    />
                ))}
            </div>
            <input type="hidden" name="color" value={selected} />
        </div>
    );
}

/** Colored dot used in category chips. */
export function CategoryDot({ color }: { color: string | null }) {
    return (
        <span
            className="inline-block size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: color ?? "#6B7280" }}
            aria-hidden="true"
        />
    );
}

type Mode = "category" | "generic";

export interface CategoryTxnRow {
    id: string;
    date: string;
    amount: number;
    merchant: string;
}

export function BudgetClient({
    categories,
    uncategorizedSpend,
    monthPace,
    genericTotal,
    aiConfigured,
    transactionsByCategory = {},
    spendingTrends = {},
}: {
    categories: CategoryRow[];
    uncategorizedSpend: number;
    monthPace: number;
    genericTotal: number | null;
    aiConfigured: boolean;
    transactionsByCategory?: Record<string, CategoryTxnRow[]>;
    spendingTrends?: Record<string, TrendPoint[]>;
}) {
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<CategoryRow | null>(null);
    const [mode, setMode] = useState<Mode>(genericTotal != null ? "generic" : "category");
    const [genericOpen, setGenericOpen] = useState(false);
    const [drillCategory, setDrillCategory] = useState<CategoryRow | null>(null);
    const { confirm, dialog } = useConfirm();

    const perCategoryBudget = categories.reduce((s, c) => s + (c.monthlyBudget ?? 0), 0);
    const totalSpent = categories.reduce((s, c) => s + c.spent, 0) + uncategorizedSpend;
    const overallBudget = mode === "generic" && genericTotal != null ? genericTotal : perCategoryBudget;
    const pacePct = Math.round(monthPace * 100);
    const overallPct = overallBudget > 0 ? Math.round((totalSpent / overallBudget) * 100) : 0;

    // Donut: spending by category (only categories with spend), plus uncategorized.
    const donut = useMemo(() => {
        const data = categories.filter((c) => c.spent > 0).map((c) => ({ name: c.name, value: c.spent, color: c.color ?? undefined }));
        if (uncategorizedSpend > 0) data.push({ name: "Uncategorized", value: uncategorizedSpend, color: "#6B7280" });
        return data.sort((a, b) => b.value - a.value);
    }, [categories, uncategorizedSpend]);

    function openCreate() {
        setEditing(null);
        setOpen(true);
    }
    function openEdit(c: CategoryRow) {
        setEditing(c);
        setOpen(true);
    }

    async function onSubmit(fd: FormData) {
        try {
            if (editing) await updateBudgetCategory(fd);
            else await createBudgetCategory(fd);
            toast.success(editing ? "Category updated" : "Category added");
            setOpen(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        }
    }
    function onDelete(id: string) {
        confirm({
            title: "Delete this category? Transactions keep their data but lose this category.",
            destructive: true,
            confirmLabel: "Delete",
            onConfirm: async () => {
                const fd = new FormData();
                fd.set("id", id);
                try {
                    await deleteBudgetCategory(fd);
                    toast.success("Deleted");
                } catch {
                    toast.error("Failed");
                }
            },
        });
    }
    async function onGenericSubmit(fd: FormData) {
        try {
            await setGenericBudgetTotal(fd);
            toast.success("Monthly total saved");
            setGenericOpen(false);
            setMode("generic");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        }
    }

    const parentName = (id: string | null) => categories.find((c) => c.id === id)?.name;

    const drillTxns = drillCategory ? (transactionsByCategory[drillCategory.id] ?? []) : [];
    const drillTrend = drillCategory ? (spendingTrends[drillCategory.id] ?? []) : [];

    return (
        <div className="flex flex-col gap-6">
            <SectionHeader
                title="Budget"
                description="Monthly budgets vs. actual spending this month."
                action={
                    <div className="flex gap-2">
                        <Button size="md" color="secondary" onClick={() => setGenericOpen(true)}>
                            {genericTotal != null ? "Edit monthly total" : "Set monthly total"}
                        </Button>
                        <Button size="md" iconLeading={Plus} onClick={openCreate}>
                            Add category
                        </Button>
                    </div>
                }
            />

            {/* Mode toggle */}
            <div className="flex w-fit rounded-lg bg-secondary p-0.5 text-sm">
                <button
                    type="button"
                    onClick={() => setMode("category")}
                    className={`rounded-md px-3 py-1.5 font-medium transition duration-100 ease-linear ${mode === "category" ? "bg-primary text-primary shadow-xs" : "text-tertiary"}`}
                >
                    Per category
                </button>
                <button
                    type="button"
                    onClick={() => setMode("generic")}
                    className={`rounded-md px-3 py-1.5 font-medium transition duration-100 ease-linear ${mode === "generic" ? "bg-primary text-primary shadow-xs" : "text-tertiary"}`}
                >
                    Single total
                </button>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <BloomCard bloom="brand">
                    <p className="text-sm text-tertiary">{mode === "generic" ? "Monthly total" : "Total budget"}</p>
                    <p className="text-display-xs font-semibold text-primary">{overallBudget > 0 ? formatCurrency(overallBudget) : "Not set"}</p>
                    <p className="text-xs text-tertiary">USD</p>
                </BloomCard>
                <BloomCard bloom="error">
                    <p className="text-sm text-tertiary">Spent this month</p>
                    <p className={`text-display-xs font-semibold ${overallBudget > 0 && totalSpent > overallBudget ? "text-error-primary" : "text-primary"}`}>{formatCurrency(totalSpent)}</p>
                    <p className="text-xs text-tertiary">USD</p>
                </BloomCard>
                <BloomCard bloom="success">
                    <p className="text-sm text-tertiary">Remaining</p>
                    <p className="text-display-xs font-semibold text-primary">{formatCurrency(overallBudget - totalSpent)}</p>
                    <p className="text-xs text-tertiary">USD</p>
                </BloomCard>
            </div>

            {/* Overall month progress with pace marker */}
            <Card className="flex flex-col gap-3">
                <div className="flex items-baseline justify-between text-sm">
                    <span className="font-medium text-primary">Overall month progress</span>
                    <span className="text-tertiary">
                        {overallBudget > 0 ? `${overallPct}% of budget` : "no budget set"} · {pacePct}% through the month
                    </span>
                </div>
                {overallBudget > 0 && (
                    <div className="relative">
                        <ProgressBar value={totalSpent} max={overallBudget} color={totalSpent > overallBudget ? "error" : overallPct > 80 ? "warning" : "success"} />
                        <div
                            className="absolute top-1/2 h-3.5 w-0.5 -translate-y-1/2 rounded-full bg-primary-solid ring-1 ring-primary"
                            style={{ left: `${Math.min(100, pacePct)}%` }}
                            title={`Month pace: ${pacePct}%`}
                            aria-hidden="true"
                        />
                    </div>
                )}
            </Card>

            {uncategorizedSpend > 0 && (
                <Card className="flex flex-wrap items-center justify-between gap-2 border border-warning-secondary bg-warning-primary py-3">
                    <p className="text-sm text-warning-primary">
                        <span className="font-semibold">{formatCurrency(uncategorizedSpend)}</span> of spending this month isn’t in any budget category.
                    </p>
                    <Button size="sm" color="secondary" href="/financial/transactions" iconLeading={Plus}>
                        {aiConfigured ? "Categorize transactions" : "Categorize"}
                    </Button>
                </Card>
            )}

            {/* Spending donut */}
            {donut.length > 0 && (
                <BloomCard bloom="brand" className="flex flex-col gap-4 md:flex-row md:items-center">
                    <div className="md:w-1/2">
                        <h3 className="mb-2 text-sm font-semibold text-primary">Spending by category</h3>
                        <DonutChart data={donut.slice(0, 8)} height={220} />
                    </div>
                    <ul className="flex flex-1 flex-col gap-2">
                        {donut.slice(0, 8).map((d) => {
                            const Icon = categoryIcon(d.name);
                            return (
                                <li key={d.name} className="flex items-center gap-2 text-sm">
                                    <span
                                        className="flex size-6 shrink-0 items-center justify-center rounded-md"
                                        style={{ backgroundColor: d.color ? `${d.color}20` : undefined, color: d.color }}
                                    >
                                        <Icon className="size-3.5" aria-hidden="true" />
                                    </span>
                                    <span className="flex-1 truncate text-secondary">{d.name}</span>
                                    <span className="font-medium text-primary">{formatCurrency(d.value)}</span>
                                </li>
                            );
                        })}
                    </ul>
                </BloomCard>
            )}

            {mode === "category" ? (
                categories.length === 0 ? (
                    <Card className="p-0">
                        <EmptyState
                            icon={PieChart03}
                            title="Build a budget that sticks"
                            description="Create categories like Groceries, Rent and Dining, set monthly targets, and see exactly where your money goes before it's gone."
                            action={
                                <Button size="sm" iconLeading={Plus} onClick={openCreate}>
                                    Add category
                                </Button>
                            }
                        />
                    </Card>
                ) : (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        {categories.map((c) => {
                            const budget = c.monthlyBudget ?? 0;
                            const over = budget > 0 && c.spent > budget;
                            const pct = budget > 0 ? Math.round((c.spent / budget) * 100) : 0;
                            const Icon = categoryIcon(c.name);
                            return (
                                <div
                                    key={c.id}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => setDrillCategory(c)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" || e.key === " ") {
                                            e.preventDefault();
                                            setDrillCategory(c);
                                        }
                                    }}
                                    className="cursor-pointer rounded-xl transition duration-100 ease-linear hover:ring-2 hover:ring-brand"
                                >
                                <Card className="flex h-full flex-col gap-3">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex items-center gap-2.5">
                                            <span
                                                className="flex size-9 items-center justify-center rounded-lg bg-secondary"
                                                style={{
                                                    backgroundColor: c.color ? `${c.color}20` : undefined,
                                                    color: c.color ?? undefined,
                                                }}
                                            >
                                                <Icon className="size-5" aria-hidden="true" />
                                            </span>
                                            <div>
                                                <div className="flex items-center gap-1.5">
                                                    <CategoryDot color={c.color} />
                                                    <p className="font-semibold text-primary">{c.name}</p>
                                                </div>
                                                {c.parentId && <p className="text-xs text-tertiary">in {parentName(c.parentId) ?? "—"}</p>}
                                            </div>
                                        </div>
                                        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                                            <Button size="sm" color="tertiary" iconLeading={Edit01} onClick={() => openEdit(c)} aria-label="Edit" />
                                            <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} onClick={() => onDelete(c.id)} aria-label="Delete" />
                                        </div>
                                    </div>
                                    <div className="flex items-baseline justify-between text-sm">
                                        <span className={over ? "font-medium text-error-primary" : "font-medium text-primary"}>{formatCurrency(c.spent)}</span>
                                        <span className="text-tertiary">{budget > 0 ? `of ${formatCurrency(budget)}` : "no budget set"}</span>
                                    </div>
                                    {budget > 0 && (
                                        <div className="relative">
                                            <ProgressBar value={c.spent} max={budget} color={over ? "error" : pct > 80 ? "warning" : "success"} />
                                            <div
                                                className="absolute top-1/2 h-3.5 w-0.5 -translate-y-1/2 rounded-full bg-primary-solid ring-1 ring-primary"
                                                style={{ left: `${Math.min(100, pacePct)}%` }}
                                                title={`Month pace: ${pacePct}%`}
                                                aria-hidden="true"
                                            />
                                        </div>
                                    )}
                                    {budget > 0 && !over && c.spent > budget * monthPace && (
                                        <p className="text-xs text-warning-primary">Ahead of pace — spending faster than the month is progressing.</p>
                                    )}
                                    {over && <p className="text-xs text-error-primary">Over by {formatCurrency(c.spent - budget)}</p>}
                                    {(spendingTrends[c.id]?.length ?? 0) > 1 && (
                                        <div className="mt-1 h-16" onClick={(e) => e.stopPropagation()}>
                                            <TrendChart
                                                data={spendingTrends[c.id]!}
                                                series={[{ key: "Spending", name: "Spending (USD)", color: c.color ?? undefined }]}
                                                type="area"
                                                height={64}
                                                money
                                                emptyLabel=""
                                            />
                                        </div>
                                    )}
                                    <p className="text-xs text-brand-secondary">Click to view transactions & trend →</p>
                                </Card>
                                </div>
                            );
                        })}
                    </div>
                )
            ) : (
                <Card className="flex flex-col gap-2">
                    <p className="text-sm text-tertiary">
                        Single-total mode tracks all spending against one monthly number{genericTotal != null ? "" : " — set one to begin"}. Category budgets are kept and used again when you switch back.
                    </p>
                </Card>
            )}

            <FormModal isOpen={open} onOpenChange={setOpen} title={editing ? "Edit category" : "Add category"}>
                <form action={onSubmit} className="flex flex-col gap-4">
                    {editing && <input type="hidden" name="id" value={editing.id} />}
                    <Field label="Name" htmlFor="name">
                        <NativeInput id="name" name="name" required defaultValue={editing?.name ?? ""} placeholder="e.g. Groceries" />
                    </Field>
                    <ColorPicker key={editing?.id ?? "new"} defaultValue={editing?.color ?? null} />
                    <Field label="Parent category" htmlFor="parentId">
                        <NativeSelect id="parentId" name="parentId" defaultValue={editing?.parentId ?? ""}>
                            <option value="">— none —</option>
                            {categories
                                .filter((c) => c.id !== editing?.id)
                                .map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {c.name}
                                    </option>
                                ))}
                        </NativeSelect>
                    </Field>
                    <Field label="Monthly budget" htmlFor="monthlyBudget">
                        <NativeInput id="monthlyBudget" name="monthlyBudget" type="number" step="0.01" defaultValue={editing?.monthlyBudget ?? ""} />
                    </Field>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="submit">{editing ? "Save" : "Add"}</Button>
                    </div>
                </form>
            </FormModal>

            <FormModal isOpen={genericOpen} onOpenChange={setGenericOpen} title="Monthly budget total" description="A single spending target for the whole month.">
                <form action={onGenericSubmit} className="flex flex-col gap-4">
                    <Field label="Monthly total" htmlFor="total" hint="Leave empty and save to remove the single-total budget.">
                        <NativeInput id="total" name="total" type="number" step="0.01" defaultValue={genericTotal ?? ""} placeholder="e.g. 4000" />
                    </Field>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setGenericOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="submit">Save</Button>
                    </div>
                </form>
            </FormModal>

            <FormModal
                isOpen={!!drillCategory}
                onOpenChange={(o) => !o && setDrillCategory(null)}
                title={drillCategory?.name ?? "Category"}
                description={drillCategory ? `${formatCurrency(drillCategory.spent)} spent this month` : undefined}
            >
                {drillCategory && (
                    <div className="flex flex-col gap-4">
                        {drillCategory.monthlyBudget != null && drillCategory.monthlyBudget > 0 && (
                            <div className="flex flex-col gap-2">
                                <div className="flex items-baseline justify-between text-sm">
                                    <span className="font-medium text-primary">{formatCurrency(drillCategory.spent)}</span>
                                    <span className="text-tertiary">of {formatCurrency(drillCategory.monthlyBudget)} budgeted</span>
                                </div>
                                <ProgressBar
                                    value={drillCategory.spent}
                                    max={drillCategory.monthlyBudget}
                                    color={drillCategory.spent > drillCategory.monthlyBudget ? "error" : "success"}
                                />
                            </div>
                        )}
                        {drillTrend.length > 0 && (
                            <div>
                                <h4 className="mb-2 text-sm font-semibold text-primary">Spending over time (12 months)</h4>
                                <TrendChart
                                    data={drillTrend}
                                    series={[{ key: "Spending", name: "Spending (USD)", color: drillCategory.color ?? undefined }]}
                                    type="bar"
                                    height={200}
                                    money
                                    emptyLabel="No historical spending"
                                />
                            </div>
                        )}
                        {drillTxns.length === 0 ? (
                            <p className="py-6 text-center text-sm text-tertiary">No transactions in this category this month.</p>
                        ) : (
                            <ul className="flex max-h-80 flex-col divide-y divide-secondary overflow-y-auto">
                                {drillTxns.map((t) => (
                                    <li key={t.id} className="flex items-center justify-between gap-3 py-3">
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-medium text-primary">{t.merchant}</p>
                                            <p className="text-xs text-tertiary">{t.date}</p>
                                        </div>
                                        <AmountBadge amount={t.amount} />
                                    </li>
                                ))}
                            </ul>
                        )}
                        <div className="flex justify-end gap-2 pt-2">
                            <Button
                                size="sm"
                                color="secondary"
                                href={`/financial/transactions?category=${drillCategory.id}`}
                            >
                                View in transactions
                            </Button>
                            <Button size="sm" color="secondary" onClick={() => setDrillCategory(null)}>
                                Close
                            </Button>
                        </div>
                    </div>
                )}
            </FormModal>

            {dialog}
        </div>
    );
}
