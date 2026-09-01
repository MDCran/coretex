"use client";

import { useMemo, useState } from "react";
import { Plus, Trash02, Edit01, Scales01 } from "@untitledui/icons";
import { toast } from "sonner";
import { Button } from "@/components/base/buttons/button";
import { Select } from "@/components/base/select/select";
import { Card, Field, NativeInput, NativeSelect, NativeTextarea, SectionHeader } from "../_components/health-ui";
import { HealthEmptyState } from "../_components/empty-state";
import { FormModal } from "../_components/form-modal";
import { FormDateInput } from "@/components/base/input/form-date-input";
import { TrendChart, type TrendPoint } from "../_components/trend-chart";
import { DeltaBadge } from "@/components/foundations/delta-badge";
import { createBodyMetric, deleteBodyMetric, updateBodyMetric } from "@/lib/actions/health-metrics";
import { type UnitSystem, heightToDisplay, heightUnit, parseWeightInput, weightToDisplay, weightUnit } from "@/lib/units";

export interface MetricRow {
    id: string;
    metricType: string;
    customName: string | null;
    value: number;
    unit: string | null;
    measuredAt: string; // ISO
    notes: string | null;
}

export interface GirthRow {
    label: string;
    cm: number;
}

/** One unified weight point (kg, metric) — mirrors body-bridge WeightPoint. */
export interface WeightPoint {
    day: string; // yyyy-mm-dd
    kg: number;
}

const TYPES = [
    { value: "weight", label: "Weight", unit: "kg" },
    { value: "body_fat_pct", label: "Body fat %", unit: "%" },
    { value: "custom", label: "Custom", unit: "" },
];

/** Metrics where a lower number is the improvement (color the down-arrow green). */
const LOWER_IS_BETTER = new Set(["weight", "body_fat_pct"]);

function typeKey(row: MetricRow) {
    return row.metricType === "custom" ? `custom:${row.customName ?? ""}` : row.metricType;
}

function typeLabel(row: MetricRow) {
    if (row.metricType === "custom") return row.customName || "Custom";
    return TYPES.find((t) => t.value === row.metricType)?.label ?? row.metricType;
}

function toLocalInput(iso: string) {
    const d = new Date(iso);
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

export function MetricsClient({ metrics, weightSeries, unitSystem, girths, girthDate }: { metrics: MetricRow[]; weightSeries: WeightPoint[]; unitSystem: UnitSystem; girths: GirthRow[]; girthDate: string | null }) {
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<MetricRow | null>(null);
    const [metricType, setMetricType] = useState("weight");
    const [filterType, setFilterType] = useState("weight");

    // Weight is stored as kg; render in the user's unit. Other metrics pass through.
    const isWeight = (type: string) => type === "weight";
    const displayValue = (row: MetricRow) => (isWeight(row.metricType) ? weightToDisplay(row.value, unitSystem) : row.value);
    const displayUnit = (row: MetricRow) => (isWeight(row.metricType) ? weightUnit(unitSystem) : row.unit ?? "");

    const groups = useMemo(() => {
        const set = new Map<string, string>();
        for (const m of metrics) set.set(m.metricType === "custom" ? `custom:${m.customName ?? ""}` : m.metricType, typeLabel(m));
        return Array.from(set.entries()).map(([key, label]) => ({ key, label }));
    }, [metrics]);

    const latestByType = useMemo(() => {
        const map = new Map<string, MetricRow>();
        for (const m of [...metrics].sort((a, b) => +new Date(b.measuredAt) - +new Date(a.measuredAt))) {
            const key = typeKey(m);
            if (!map.has(key)) map.set(key, m);
        }
        return Array.from(map.values());
    }, [metrics]);

    // Second-most-recent reading per type, used to show the change vs the latest.
    const prevByType = useMemo(() => {
        const counts = new Map<string, number>();
        const prev = new Map<string, MetricRow>();
        for (const m of [...metrics].sort((a, b) => +new Date(b.measuredAt) - +new Date(a.measuredAt))) {
            const key = typeKey(m);
            const seen = counts.get(key) ?? 0;
            if (seen === 1) prev.set(key, m);
            counts.set(key, seen + 1);
        }
        return prev;
    }, [metrics]);

    const chartData: TrendPoint[] = useMemo(() => {
        // Weight uses the unified series (shared with the workouts body chart) so
        // both pages render the SAME line — see lib/body-bridge.getWeightSeries.
        if (filterType === "weight") {
            return weightSeries.map((p) => ({
                label: new Date(`${p.day}T00:00:00.000Z`).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
                value: weightToDisplay(p.kg, unitSystem),
            }));
        }
        const rows = metrics
            .filter((m) => (m.metricType === "custom" ? `custom:${m.customName ?? ""}` : m.metricType) === filterType)
            .slice()
            .sort((a, b) => +new Date(a.measuredAt) - +new Date(b.measuredAt));
        return rows.map((m) => ({ label: new Date(m.measuredAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }), value: displayValue(m) }));
    }, [metrics, weightSeries, filterType, unitSystem]);

    function openCreate() {
        setEditing(null);
        setMetricType("weight");
        setOpen(true);
    }
    function openEdit(row: MetricRow) {
        setEditing(row);
        setMetricType(row.metricType);
        setOpen(true);
    }

    async function onSubmit(fd: FormData) {
        // Weight is entered in the display unit; convert to kg before storing.
        if (isWeight(metricType)) {
            const kg = parseWeightInput((fd.get("value") as string) ?? "", unitSystem);
            if (kg != null) fd.set("value", String(kg));
            fd.set("unit", "kg");
        }
        try {
            if (editing) await updateBodyMetric(fd);
            else await createBodyMetric(fd);
            toast.success(editing ? "Metric updated" : "Metric logged");
            setOpen(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        }
    }

    async function onDelete(id: string) {
        const fd = new FormData();
        fd.set("id", id);
        try {
            await deleteBodyMetric(fd);
            toast.success("Deleted");
        } catch {
            toast.error("Failed to delete");
        }
    }

    return (
        <div className="flex flex-col gap-6">
            <SectionHeader
                title="Body metrics"
                description="Track weight, body fat and custom measurements."
                action={<Button size="md" iconLeading={Plus} onClick={openCreate}>Log metric</Button>}
            />

            {latestByType.length > 0 && (
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    {latestByType.map((m) => {
                        const prev = prevByType.get(typeKey(m));
                        const delta = prev ? displayValue(m) - displayValue(prev) : null;
                        return (
                            <button
                                key={m.id}
                                type="button"
                                onClick={() => setFilterType(typeKey(m))}
                                className="flex flex-col gap-0.5 rounded-xl bg-primary p-4 text-left ring-1 ring-secondary ring-inset transition duration-100 ease-linear hover:bg-secondary_hover"
                            >
                                <span className="text-xs font-medium text-tertiary">{typeLabel(m)}</span>
                                <span className="text-display-xs font-semibold text-primary">
                                    {displayValue(m)}
                                    {displayUnit(m) ? ` ${displayUnit(m)}` : ""}
                                </span>
                                <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                                    <span className="text-xs text-quaternary">{new Date(m.measuredAt).toLocaleDateString()}</span>
                                    <DeltaBadge
                                        delta={delta}
                                        unit={displayUnit(m)}
                                        precision={1}
                                        tone={LOWER_IS_BETTER.has(m.metricType) ? "inverse" : "neutral"}
                                        hideWhenEven
                                    />
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}

            <Card>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-md font-semibold text-primary">Trend</h3>
                    {groups.length > 0 && (
                        <div className="w-full min-w-[12rem] sm:w-56">
                            <Select
                                selectedKey={filterType}
                                onSelectionChange={(k) => setFilterType(String(k))}
                                items={groups.map((g) => ({ id: g.key, label: g.label }))}
                                size="sm"
                                aria-label="Filter metric type"
                            >
                                {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                            </Select>
                        </div>
                    )}
                </div>
                <TrendChart data={chartData} series={[{ key: "value", name: "Value" }]} type="area" fitDomain emptyLabel="No metrics yet" />
            </Card>

            {metrics.length === 0 ? (
                <Card className="p-0">
                    <HealthEmptyState
                        icon={Scales01}
                        title="Log your first measurement"
                        description="Track weight, body fat or any custom metric. Once you have a few entries, your trend chart comes to life."
                        actionLabel="Log metric"
                        onAction={openCreate}
                    />
                </Card>
            ) : (
            <Card className="overflow-x-auto p-0">
                <table className="w-full min-w-[640px] text-sm">
                    <thead>
                        <tr className="border-b border-secondary text-left text-tertiary">
                            <th className="px-5 py-3 font-medium">Type</th>
                            <th className="px-5 py-3 font-medium">Value</th>
                            <th className="px-5 py-3 font-medium">Date</th>
                            <th className="px-5 py-3 font-medium">Notes</th>
                            <th className="px-5 py-3" />
                        </tr>
                    </thead>
                    <tbody>
                        {metrics.map((m) => (
                            <tr key={m.id} className="border-b border-secondary last:border-0">
                                <td className="px-5 py-3 font-medium text-primary">{typeLabel(m)}</td>
                                <td className="px-5 py-3 text-secondary">
                                    {displayValue(m)}
                                    {displayUnit(m) ? ` ${displayUnit(m)}` : ""}
                                </td>
                                <td className="px-5 py-3 text-tertiary">{new Date(m.measuredAt).toLocaleString()}</td>
                                <td className="max-w-[200px] truncate px-5 py-3 text-tertiary">{m.notes}</td>
                                <td className="px-5 py-3">
                                    <div className="flex justify-end gap-1">
                                        <Button size="sm" color="tertiary" iconLeading={Edit01} onClick={() => openEdit(m)} aria-label="Edit" />
                                        <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} onClick={() => onDelete(m.id)} aria-label="Delete" />
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </Card>
            )}

            {girths.length > 0 && (
                <Card>
                    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                        <h3 className="text-md font-semibold text-primary">Girths from workouts</h3>
                        <span className="text-xs text-tertiary">
                            Latest body log{girthDate ? ` · ${new Date(girthDate).toLocaleDateString()}` : ""} · edit in Workouts → Body
                        </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {girths.map((g) => (
                            <div key={g.label} className="flex flex-col gap-0.5 rounded-lg p-3 ring-1 ring-secondary ring-inset">
                                <span className="text-xs text-tertiary">{g.label}</span>
                                <span className="text-sm font-semibold text-primary">
                                    {heightToDisplay(g.cm, unitSystem)} {heightUnit(unitSystem)}
                                </span>
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            <FormModal isOpen={open} onOpenChange={setOpen} title={editing ? "Edit metric" : "Log metric"}>
                <form action={onSubmit} className="flex flex-col gap-4">
                    {editing && <input type="hidden" name="id" value={editing.id} />}
                    <Field label="Type" htmlFor="metricType">
                        <NativeSelect id="metricType" name="metricType" value={metricType} onChange={(e) => setMetricType(e.target.value)}>
                            {TYPES.map((t) => (
                                <option key={t.value} value={t.value}>
                                    {t.label}
                                </option>
                            ))}
                        </NativeSelect>
                    </Field>
                    {metricType === "custom" && (
                        <Field label="Custom name" htmlFor="customName">
                            <NativeInput id="customName" name="customName" defaultValue={editing?.customName ?? ""} placeholder="e.g. Waist circumference" />
                        </Field>
                    )}
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Value" htmlFor="value" required>
                            <NativeInput
                                key={`val-${editing?.id ?? "new"}-${metricType}`}
                                id="value"
                                name="value"
                                type="number"
                                step="any"
                                required
                                defaultValue={editing ? (isWeight(metricType) ? weightToDisplay(editing.value, unitSystem) : editing.value) : ""}
                            />
                        </Field>
                        {isWeight(metricType) ? (
                            <Field label="Unit">
                                {/* Weight always stored as kg; shown/entered in the chosen unit. */}
                                <NativeInput value={weightUnit(unitSystem)} readOnly aria-label="Unit" />
                            </Field>
                        ) : (
                            <Field label="Unit" htmlFor="unit">
                                <NativeInput
                                    key={`unit-${editing?.id ?? "new"}-${metricType}`}
                                    id="unit"
                                    name="unit"
                                    defaultValue={editing?.unit ?? TYPES.find((t) => t.value === metricType)?.unit ?? ""}
                                    placeholder="%, cm…"
                                />
                            </Field>
                        )}
                    </div>
                    <FormDateInput name="measuredAt" label="Date & time" variant="datetime" defaultValue={editing ? toLocalInput(editing.measuredAt) : toLocalInput(new Date().toISOString())} />
                    <Field label="Notes" htmlFor="notes">
                        <NativeTextarea id="notes" name="notes" defaultValue={editing?.notes ?? ""} />
                    </Field>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" onClick={() => setOpen(false)} type="button">
                            Cancel
                        </Button>
                        <Button type="submit">{editing ? "Save" : "Log"}</Button>
                    </div>
                </form>
            </FormModal>
        </div>
    );
}
