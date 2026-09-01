// @ts-nocheck
import FormDateInput from "@/components/base/input/form-date-input";
import { formatDateTime } from "@/coretex/use-coretex";
import { formatDateShort } from "@/lib/dates";
import { cx } from "@/utils/cx";
import { Plus, LayoutGrid01, LineChartUp01, List, Edit01, Trash02, X } from "@untitledui/icons";
import { useState, useMemo, Activity } from "react";
import { Button, Select } from "react-aria-components";
import { toast } from "sonner";
import { HealthEmptyState } from "../_components/empty-state";
import { FormModal } from "../_components/form-modal";
import { SectionHeader, Card, Field, NativeInput, NativeTextarea } from "../_components/health-ui";
import { TrendPoint, TrendChart } from "../_components/trend-chart";



export interface VitalField {
    label: string;
    unit: string | null;
    value: number;
}
export interface VitalRow {
    id: string;
    vitalType: string;
    customName: string | null;
    value: number | null;
    value2: number | null;
    unit: string | null;
    measuredAt: string;
    notes: string | null;
    fields: VitalField[];
}

const TYPES = [
    { value: "blood_pressure", label: "Blood pressure", unit: "mmHg", dual: true },
    { value: "heart_rate", label: "Heart rate", unit: "bpm", dual: false },
    { value: "temperature", label: "Temperature", unit: "°C", dual: false },
    { value: "spo2", label: "SpO₂", unit: "%", dual: false },
    { value: "custom", label: "Custom", unit: "", dual: false },
];

function typeLabel(row: VitalRow) {
    if (row.vitalType === "custom") return row.customName || "Custom";
    return TYPES.find((t) => t.value === row.vitalType)?.label ?? row.vitalType;
}
function valueDisplay(row: VitalRow) {
    if (row.vitalType === "blood_pressure") return `${row.value ?? "?"}/${row.value2 ?? "?"}${row.unit ? ` ${row.unit}` : ""}`;
    if (row.vitalType === "custom") return row.fields.map((f) => `${f.label}: ${f.value}${f.unit ? ` ${f.unit}` : ""}`).join(", ");
    return `${row.value ?? "?"}${row.unit ? ` ${row.unit}` : ""}`;
}
function toLocalInput(iso: string) {
    const d = new Date(iso);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

type ViewMode = "grid" | "charts" | "table";

export function VitalsClient({ vitals }: { vitals: VitalRow[] }) {
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<VitalRow | null>(null);
    const [vitalType, setVitalType] = useState("heart_rate");
    const [customFields, setCustomFields] = useState<VitalField[]>([{ label: "", unit: "", value: 0 }]);
    const [filterType, setFilterType] = useState("heart_rate");
    const [viewMode, setViewMode] = useState<ViewMode>("grid");

    const def = TYPES.find((t) => t.value === vitalType);

    const filterTypes = useMemo(() => {
        const set = new Set(vitals.map((v) => v.vitalType));
        return TYPES.filter((t) => set.has(t.value));
    }, [vitals]);

    const latestByType = useMemo(() => {
        const map = new Map<string, VitalRow>();
        for (const v of [...vitals].sort((a, b) => +new Date(b.measuredAt) - +new Date(a.measuredAt))) {
            const key = v.vitalType === "custom" ? `custom:${v.customName ?? ""}` : v.vitalType;
            if (!map.has(key)) map.set(key, v);
        }
        return Array.from(map.values());
    }, [vitals]);

    const chartForType = (type: string) => {
        const rows = vitals
            .filter((v) => v.vitalType === type)
            .slice()
            .sort((a, b) => +new Date(a.measuredAt) - +new Date(b.measuredAt));
        return rows.map((v) => ({
            label: formatDateShort(v.measuredAt),
            value: v.value ?? 0,
            ...(type === "blood_pressure" ? { value2: v.value2 ?? 0 } : {}),
        }));
    };

    const chartData: TrendPoint[] = useMemo(() => {
        const rows = vitals
            .filter((v) => v.vitalType === filterType)
            .slice()
            .sort((a, b) => +new Date(a.measuredAt) - +new Date(b.measuredAt));
        return rows.map((v) => ({
            label: formatDateShort(v.measuredAt),
            value: v.value ?? 0,
            ...(filterType === "blood_pressure" ? { value2: v.value2 ?? 0 } : {}),
        }));
    }, [vitals, filterType]);

    const chartSeries =
        filterType === "blood_pressure"
            ? [
                  { key: "value", name: "Systolic" },
                  { key: "value2", name: "Diastolic", color: "var(--color-utility-blue-500)" },
              ]
            : [{ key: "value", name: TYPES.find((t) => t.value === filterType)?.label ?? "Value" }];

    function openCreate() {
        setEditing(null);
        setVitalType("heart_rate");
        setCustomFields([{ label: "", unit: "", value: 0 }]);
        setOpen(true);
    }
    function openEdit(row: VitalRow) {
        setEditing(row);
        setVitalType(row.vitalType);
        setCustomFields(row.fields.length ? row.fields.map((f) => ({ ...f, unit: f.unit ?? "" })) : [{ label: "", unit: "", value: 0 }]);
        setOpen(true);
    }

    async function onSubmit(fd: FormData) {
        if (vitalType === "custom") fd.set("customFields", JSON.stringify(customFields));
        try {
            if (editing) await updateVital(fd);
            else await createVital(fd);
            toast.success(editing ? "Vital updated" : "Vital logged");
            setOpen(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        }
    }
    async function onDelete(id: string) {
        const fd = new FormData();
        fd.set("id", id);
        try {
            await deleteVital(fd);
            toast.success("Deleted");
        } catch {
            toast.error("Failed to delete");
        }
    }

    return (
        <div className="flex flex-col gap-6">
            <SectionHeader title="Vitals" description="Blood pressure, heart rate, temperature, SpO₂ and custom readings." action={<Button size="md" iconLeading={Plus} onClick={openCreate}>Log vital</Button>} />

            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex gap-1 rounded-lg bg-secondary p-1">
                    {([
                        { id: "grid" as const, label: "Overview", icon: LayoutGrid01 },
                        { id: "charts" as const, label: "Trends", icon: LineChartUp01 },
                        { id: "table" as const, label: "Log", icon: List },
                    ]).map((v) => {
                        const Icon = v.icon;
                        const active = viewMode === v.id;
                        return (
                            <button
                                key={v.id}
                                type="button"
                                aria-pressed={active}
                                onClick={() => setViewMode(v.id)}
                                className={cx(
                                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition duration-100 ease-linear",
                                    active ? "bg-primary text-primary shadow-xs ring-1 ring-secondary ring-inset" : "text-tertiary hover:text-secondary",
                                )}
                            >
                                <Icon className="size-4" aria-hidden="true" />
                                {v.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            {viewMode === "grid" && (
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    {latestByType.length === 0 ? (
                        <Card className="col-span-full p-0">
                            <HealthEmptyState
                                icon={Activity}
                                title="Start tracking your vitals"
                                description="Log blood pressure, heart rate, temperature or SpO₂ — then spot the trends that matter for your health."
                                actionLabel="Log vital"
                                onAction={openCreate}
                            />
                        </Card>
                    ) : (
                        latestByType.map((v) => (
                            <button
                                key={v.id}
                                type="button"
                                onClick={() => {
                                    setFilterType(v.vitalType);
                                    setViewMode("charts");
                                }}
                                className="flex flex-col gap-0.5 rounded-xl bg-primary p-4 text-left ring-1 ring-secondary ring-inset transition duration-100 ease-linear hover:bg-secondary_hover"
                            >
                                <span className="text-xs font-medium text-tertiary">{typeLabel(v)}</span>
                                <span className="text-display-xs font-semibold text-primary">{valueDisplay(v)}</span>
                                <span className="text-xs text-quaternary">{formatDateTime(v.measuredAt)}</span>
                            </button>
                        ))
                    )}
                </div>
            )}

            {viewMode === "charts" && (
                <div className="flex flex-col gap-4">
                    {filterTypes.length > 1 && (
                        <div className="w-full min-w-[12rem] sm:w-56">
                            <Select
                                selectedKey={filterType}
                                onSelectionChange={(k) => setFilterType(String(k))}
                                items={filterTypes.map((t) => ({ id: t.value, label: t.label }))}
                                size="sm"
                                aria-label="Filter vital type"
                            >
                                {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                            </Select>
                        </div>
                    )}
                    {filterTypes.length > 1 ? (
                        <div className="grid gap-4 lg:grid-cols-2">
                            {filterTypes.map((t) => {
                                const series =
                                    t.value === "blood_pressure"
                                        ? [
                                              { key: "value", name: "Systolic" },
                                              { key: "value2", name: "Diastolic", color: "var(--color-utility-blue-500)" },
                                          ]
                                        : [{ key: "value", name: t.label }];
                                return (
                                    <Card key={t.value} className="overflow-hidden">
                                        <h3 className="mb-3 text-sm font-semibold text-primary">{t.label}</h3>
                                        <TrendChart data={chartForType(t.value)} series={series} fitDomain height={200} emptyLabel={`No ${t.label.toLowerCase()} yet`} />
                                    </Card>
                                );
                            })}
                        </div>
                    ) : (
                        <Card className="overflow-hidden">
                            <h3 className="mb-4 text-md font-semibold text-primary">Trend</h3>
                            <TrendChart data={chartData} series={chartSeries} fitDomain emptyLabel="No vitals yet" />
                        </Card>
                    )}
                </div>
            )}

            {viewMode === "table" && (
                vitals.length === 0 ? (
                    <Card className="p-0">
                        <HealthEmptyState
                            icon={Activity}
                            title="No readings logged yet"
                            description="Log blood pressure, heart rate, temperature or SpO₂ to build your vitals history."
                            actionLabel="Log vital"
                            onAction={openCreate}
                        />
                    </Card>
                ) : (
            <Card className="overflow-x-auto p-0">
                <table className="w-full min-w-[640px] text-sm">
                    <thead>
                        <tr className="border-b border-secondary text-left text-tertiary">
                            <th className="px-5 py-3 font-medium">Type</th>
                            <th className="px-5 py-3 font-medium">Reading</th>
                            <th className="px-5 py-3 font-medium">Date</th>
                            <th className="px-5 py-3" />
                        </tr>
                    </thead>
                    <tbody>
                        {vitals.map((v) => (
                            <tr key={v.id} className="border-b border-secondary last:border-0">
                                <td className="px-5 py-3 font-medium text-primary">{typeLabel(v)}</td>
                                <td className="px-5 py-3 text-secondary">{valueDisplay(v)}</td>
                                <td className="px-5 py-3 text-tertiary">{formatDateTime(v.measuredAt)}</td>
                                <td className="px-5 py-3">
                                    <div className="flex justify-end gap-1">
                                        <Button size="sm" color="tertiary" iconLeading={Edit01} onClick={() => openEdit(v)} aria-label="Edit" />
                                        <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} onClick={() => onDelete(v.id)} aria-label="Delete" />
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </Card>
                )
            )}

            <FormModal isOpen={open} onOpenChange={setOpen} title={editing ? "Edit vital" : "Log vital"}>
                <form action={onSubmit} className="flex flex-col gap-4">
                    {editing && <input type="hidden" name="id" value={editing.id} />}
                    <input type="hidden" name="vitalType" value={vitalType} />
                    <Field label="Type">
                        <Select
                            selectedKey={vitalType}
                            onSelectionChange={(k) => setVitalType(String(k))}
                            items={TYPES.map((t) => ({ id: t.value, label: t.label }))}
                            size="sm"
                            aria-label="Vital type"
                        >
                            {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                        </Select>
                    </Field>

                    {vitalType === "custom" ? (
                        <>
                            <Field label="Custom name" htmlFor="customName">
                                <NativeInput id="customName" name="customName" defaultValue={editing?.customName ?? ""} placeholder="e.g. Blood glucose panel" />
                            </Field>
                            <div className="flex flex-col gap-2">
                                <span className="text-sm font-medium text-secondary">Fields</span>
                                {customFields.map((f, i) => (
                                    <div key={i} className="flex items-end gap-2">
                                        <NativeInput placeholder="Label" value={f.label} onChange={(e) => setCustomFields((p) => p.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                                        <NativeInput type="number" step="any" placeholder="Value" value={Number.isFinite(f.value) ? f.value : ""} onChange={(e) => setCustomFields((p) => p.map((x, j) => (j === i ? { ...x, value: Number(e.target.value) } : x)))} />
                                        <NativeInput placeholder="Unit" className="w-24" value={f.unit ?? ""} onChange={(e) => setCustomFields((p) => p.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))} />
                                        <Button type="button" size="sm" color="tertiary-destructive" iconLeading={X} aria-label="Remove" onClick={() => setCustomFields((p) => p.filter((_, j) => j !== i))} />
                                    </div>
                                ))}
                                <Button type="button" size="sm" color="secondary" iconLeading={Plus} onClick={() => setCustomFields((p) => [...p, { label: "", unit: "", value: 0 }])}>
                                    Add field
                                </Button>
                            </div>
                        </>
                    ) : (
                        <div className="grid grid-cols-2 gap-4">
                            <Field label={def?.dual ? "Systolic" : "Value"} htmlFor="value">
                                <NativeInput id="value" name="value" type="number" step="any" required defaultValue={editing?.value ?? ""} />
                            </Field>
                            {def?.dual ? (
                                <Field label="Diastolic" htmlFor="value2">
                                    <NativeInput id="value2" name="value2" type="number" step="any" defaultValue={editing?.value2 ?? ""} />
                                </Field>
                            ) : (
                                <Field label="Unit" htmlFor="unit">
                                    <NativeInput id="unit" name="unit" defaultValue={editing?.unit ?? def?.unit ?? ""} />
                                </Field>
                            )}
                            {def?.dual && (
                                <Field label="Unit" htmlFor="unit" className="col-span-2">
                                    <NativeInput id="unit" name="unit" defaultValue={editing?.unit ?? def?.unit ?? "mmHg"} />
                                </Field>
                            )}
                        </div>
                    )}

                    <FormDateInput name="measuredAt" label="Date & time" variant="datetime" defaultValue={editing ? toLocalInput(editing.measuredAt) : toLocalInput(new Date().toISOString())} />
                    <Field label="Notes" htmlFor="notes">
                        <NativeTextarea id="notes" name="notes" defaultValue={editing?.notes ?? ""} />
                    </Field>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="submit">{editing ? "Save" : "Log"}</Button>
                    </div>
                </form>
            </FormModal>
        </div>
    );
}
