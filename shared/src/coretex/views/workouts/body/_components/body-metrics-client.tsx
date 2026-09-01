// @ts-nocheck

const useRouter = () => ({ push: () => {}, replace: () => {} }); const useSearchParams = () => ({ get: () => null });



import { toast } from "sonner";
import { Button, ModalOverlay, Modal, Dialog } from "react-aria-components";
import { useTransition, useState, useRef, useMemo } from "react";
import { Plus, LinkExternal02, Edit01, Trash01, Scale01 } from "@untitledui/icons";
import { UnitSystem } from "@/lib/units";
import { TrendPoint, TrendChart } from "@/coretex/views/financial/_components/trend-chart";
import { DeltaBadge } from "@/components/foundations/delta-badge";
import { InputNumber } from "@/components/base/input/input-number";
import { ControlledDateInput } from "@/components/base/input/form-date-input";
import { ButtonUtility } from "@/components/base/buttons/button-utility";
import { Badge } from "@/components/base/badges/badges";
import { useConfirm } from "@/components/application/confirm-dialog/confirm-dialog";
import { Card, Field, NativeTextarea, SectionHeader, Stat } from "../../_components/workouts-ui";
import { cx } from "@/utils/cx";

export type BodyMeasurementRow = {
    id: string;
    date: string;
    weightKg: number | null;
    bodyFatPct: number | null;
    chestCm: number | null;
    waistCm: number | null;
    neckCm: number | null;
    hipCm: number | null;
    armLCm: number | null;
    armRCm: number | null;
    legLCm: number | null;
    legRCm: number | null;
    note: string | null;
};

type WeightPoint = { day: string; kg: number };

const GIRTH_KEYS = ["chestCm", "waistCm", "neckCm", "hipCm", "armLCm", "armRCm", "legLCm", "legRCm"] as const;
type GirthKey = (typeof GIRTH_KEYS)[number];

const CHART_METRICS = [
    { key: "Weight", label: "Weight" },
    { key: "Body fat %", label: "Body fat %" },
    { key: "Waist", label: "Waist" },
    { key: "Chest", label: "Chest" },
] as const;

function deltaBadge(current: number | null, previous: number | null, unit: string, lowerIsBetter = false) {
    if (current == null || previous == null) return null;
    return <DeltaBadge delta={current - previous} unit={unit} precision={1} tone={lowerIsBetter ? "inverse" : "directional"} hideWhenEven />;
}

function MetricForm({
    unitSystem,
    initial,
    onDone,
}: {
    unitSystem: UnitSystem;
    initial?: BodyMeasurementRow | null;
    onDone: () => void;
}) {
    const [pending, startTransition] = useTransition();
    const wU = weightUnit(unitSystem);
    const lU = heightUnit(unitSystem);

    const [date, setDate] = useState(initial?.date ?? toDateKey(new Date()));
    const [weight, setWeight] = useState<number | null>(initial?.weightKg != null ? weightToDisplay(initial.weightKg, unitSystem) : null);
    const [bf, setBf] = useState<number | null>(initial?.bodyFatPct ?? null);
    const [girths, setGirths] = useState<Record<GirthKey, number | null>>(() => {
        const out = {} as Record<GirthKey, number | null>;
        for (const k of GIRTH_KEYS) out[k] = initial?.[k] != null ? heightToDisplay(initial[k]!, unitSystem) : null;
        return out;
    });
    const [note, setNote] = useState(initial?.note ?? "");

    const submit = () => {
        const form = new FormData();
        form.set("date", date);
        form.set("weightKg", weight != null ? String(parseWeightInput(String(weight), unitSystem)) : "");
        form.set("bodyFatPct", bf != null ? String(bf) : "");
        for (const k of GIRTH_KEYS) {
            const v = girths[k];
            form.set(k, v != null ? String(parseHeightInput(String(v), unitSystem)) : "");
        }
        form.set("note", note);

        startTransition(async () => {
            try {
                if (initial) await updateBodyMeasurement(initial.id, form);
                else await createBodyMeasurement(form);
                toast.success(initial ? "Measurement updated" : "Measurement logged");
                onDone();
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed to save");
            }
        });
    };

    const girthLabel: Record<GirthKey, string> = {
        chestCm: `Chest (${lU})`,
        waistCm: `Waist (${lU})`,
        neckCm: `Neck (${lU})`,
        hipCm: `Hip (${lU})`,
        armLCm: `Arm L (${lU})`,
        armRCm: `Arm R (${lU})`,
        legLCm: `Leg L (${lU})`,
        legRCm: `Leg R (${lU})`,
    };

    return (
        <div className="flex flex-col gap-4">
            <Field label="Date">
                <ControlledDateInput variant="date" value={date} onChange={(v) => setDate(v)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
                <InputNumber label={`Weight (${wU})`} value={weight ?? undefined} onChange={setWeight} minValue={0} step={unitSystem === "IMPERIAL" ? 0.5 : 0.1} />
                <InputNumber label="Body fat %" value={bf ?? undefined} onChange={setBf} minValue={0} maxValue={100} step={0.1} />
                {GIRTH_KEYS.map((k) => (
                    <InputNumber key={k} label={girthLabel[k]} value={girths[k] ?? undefined} onChange={(v) => setGirths((g) => ({ ...g, [k]: v }))} minValue={0} step={0.1} />
                ))}
            </div>
            <Field label="Note">
                <NativeTextarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
            </Field>
            <Button color="primary" isLoading={pending} onClick={submit}>
                {initial ? "Save changes" : "Save measurement"}
            </Button>
        </div>
    );
}

export function BodyMetricsClient({
    measurements,
    weightSeries,
    unitSystem,
}: {
    measurements: BodyMeasurementRow[];
    weightSeries: WeightPoint[];
    unitSystem: UnitSystem;
}) {
    const wU = weightUnit(unitSystem);
    const lU = heightUnit(unitSystem);
    const [chartMetric, setChartMetric] = useState<(typeof CHART_METRICS)[number]["key"]>("Weight");
    const router = useRouter();
    const [editModal, setEditModal] = useState<BodyMeasurementRow | null>(null);
    const [createFormKey, setCreateFormKey] = useState(0);
    const [quickWeight, setQuickWeight] = useState<number | null>(null);
    const [pending, startTransition] = useTransition();
    const { confirm, dialog } = useConfirm();
    const formAnchor = useRef<HTMLDivElement>(null);

    const sorted = useMemo(() => [...measurements].sort((a, b) => b.date.localeCompare(a.date)), [measurements]);
    const latest = sorted[0];
    const prev = sorted[1];

    const chartData: TrendPoint[] = useMemo(() => {
        const byDay = new Map(measurements.map((m) => [m.date, m]));
        if (chartMetric === "Weight") {
            return weightSeries.map((p) => ({
                label: new Date(`${p.day}T00:00:00.000Z`).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
                Weight: weightToDisplay(p.kg, unitSystem),
            }));
        }
        return measurements
            .slice()
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((m) => {
                let value: number | null = null;
                if (chartMetric === "Body fat %") value = m.bodyFatPct;
                else if (chartMetric === "Waist") value = m.waistCm != null ? heightToDisplay(m.waistCm, unitSystem) : null;
                else if (chartMetric === "Chest") value = m.chestCm != null ? heightToDisplay(m.chestCm, unitSystem) : null;
                return {
                    label: new Date(`${m.date}T00:00:00.000Z`).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
                    [chartMetric]: value,
                };
            });
    }, [measurements, weightSeries, chartMetric, unitSystem]);

    const quickLogWeight = () => {
        if (quickWeight == null) {
            toast.error("Enter a weight");
            return;
        }
        const form = new FormData();
        form.set("date", toDateKey(new Date()));
        form.set("weightKg", String(parseWeightInput(String(quickWeight), unitSystem)));
        startTransition(async () => {
            try {
                await createBodyMeasurement(form);
                toast.success("Weight logged");
                setQuickWeight(null);
                router.refresh();
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed to log");
            }
        });
    };

    const openCreate = () => formAnchor.current?.scrollIntoView({ behavior: "smooth" });

    const doneForm = () => {
        setCreateFormKey((k) => k + 1);
        router.refresh();
    };

    const openEdit = (row: BodyMeasurementRow) => setEditModal(row);

    const requestDelete = (row: BodyMeasurementRow) =>
        confirm({
            title: "Delete this measurement?",
            destructive: true,
            confirmLabel: "Delete",
            onConfirm: () =>
                startTransition(async () => {
                    await deleteBodyMeasurement(row.id);
                    toast.success("Deleted");
                    router.refresh();
                }),
        });

    const fmtW = (n: number | null) => (n == null ? "—" : `${weightToDisplay(n, unitSystem)} ${wU}`);
    const fmtL = (n: number | null) => (n == null ? "—" : `${heightToDisplay(n, unitSystem)} ${lU}`);
    const fmtPct = (n: number | null) => (n == null ? "—" : `${n}%`);

    return (
        <div className="flex flex-col gap-6">
            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat
                    label={`Weight (${wU})`}
                    value={latest?.weightKg != null ? weightToDisplay(latest.weightKg, unitSystem) : "—"}
                    sub={
                        <div className="flex flex-wrap items-center gap-1.5">
                            {latest && <span className="text-quaternary">{new Date(latest.date).toLocaleDateString()}</span>}
                            {deltaBadge(
                                latest?.weightKg != null ? weightToDisplay(latest.weightKg, unitSystem) : null,
                                prev?.weightKg != null ? weightToDisplay(prev.weightKg, unitSystem) : null,
                                wU,
                            )}
                        </div>
                    }
                />
                <Stat
                    label="Body fat"
                    value={latest?.bodyFatPct != null ? `${latest.bodyFatPct}%` : "—"}
                    sub={deltaBadge(latest?.bodyFatPct ?? null, prev?.bodyFatPct ?? null, "%", true)}
                />
                <Stat
                    label={`Waist (${lU})`}
                    value={latest?.waistCm != null ? heightToDisplay(latest.waistCm, unitSystem) : "—"}
                    sub={deltaBadge(
                        latest?.waistCm != null ? heightToDisplay(latest.waistCm, unitSystem) : null,
                        prev?.waistCm != null ? heightToDisplay(prev.waistCm, unitSystem) : null,
                        lU,
                        true,
                    )}
                />
                <Stat
                    label={`Chest (${lU})`}
                    value={latest?.chestCm != null ? heightToDisplay(latest.chestCm, unitSystem) : "—"}
                    sub={deltaBadge(
                        latest?.chestCm != null ? heightToDisplay(latest.chestCm, unitSystem) : null,
                        prev?.chestCm != null ? heightToDisplay(prev.chestCm, unitSystem) : null,
                        lU,
                    )}
                />
            </div>

            {/* Quick weight log */}
            <Card className="relative overflow-hidden">
                <div className="pointer-events-none absolute -top-8 -right-8 size-32 rounded-full bg-brand-solid/10 blur-2xl" />
                <div className="relative flex flex-wrap items-end gap-3">
                    <FeaturedIconWrap />
                    <div className="min-w-[140px] flex-1">
                        <InputNumber
                            label={`Quick log weight (${wU})`}
                            value={quickWeight ?? undefined}
                            onChange={setQuickWeight}
                            minValue={0}
                            step={unitSystem === "IMPERIAL" ? 0.5 : 0.1}
                        />
                    </div>
                    <Button color="primary" iconLeading={Plus} isLoading={pending} onClick={quickLogWeight}>
                        Log today
                    </Button>
                    <Button color="secondary" onClick={openCreate}>
                        Full entry
                    </Button>
                </div>
            </Card>

            {/* Chart + form */}
            <div id="measurement-form" ref={formAnchor} className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                    <SectionHeader
                        title="Trends"
                        description="Interactive charts — weight syncs with Health metrics."
                        action={
                            <a href="#">
                                Health metrics
                                <LinkExternal02 className="size-3.5" aria-hidden="true" />
                            </a>
                        }
                    />
                    <div className="mt-3 flex flex-wrap gap-2">
                        {CHART_METRICS.map((m) => (
                            <button
                                key={m.key}
                                type="button"
                                onClick={() => setChartMetric(m.key)}
                                className={cx(
                                    "rounded-full px-3 py-1 text-xs font-medium transition duration-100",
                                    chartMetric === m.key ? "bg-brand-solid text-white" : "bg-secondary text-secondary hover:bg-secondary_hover",
                                )}
                            >
                                {m.label}
                            </button>
                        ))}
                    </div>
                    <div className="mt-4">
                        <TrendChart
                            data={chartData}
                            series={[{ key: chartMetric, name: chartMetric === "Weight" ? `Weight (${wU})` : chartMetric === "Body fat %" ? "Body fat %" : `${chartMetric} (${lU})` }]}
                            fitDomain
                            emptyLabel="No data for this metric yet"
                        />
                    </div>
                </Card>

                <Card>
                    <SectionHeader title="Log measurement" description={`Units: ${unitSystem === "IMPERIAL" ? "lb & in" : "kg & cm"} — change in Health → Goals.`} />
                    <div className="mt-4">
                        <MetricForm key={createFormKey} unitSystem={unitSystem} onDone={doneForm} />
                    </div>
                </Card>
            </div>

            {/* History table */}
            <Card>
                <SectionHeader title="Measurement log" description={`${sorted.length} entries — color-coded changes vs previous log.`} />

                {/* Mobile: stacked card per measurement (< 640px) */}
                <ul className="mt-4 flex flex-col gap-3 sm:hidden">
                    {sorted.length === 0 ? (
                        <li className="py-8 text-center text-sm text-tertiary">No measurements yet — use quick log or full entry above.</li>
                    ) : (
                        sorted.map((m, i) => {
                            const older = sorted[i + 1];
                            return (
                                <li key={m.id} className="rounded-lg bg-primary p-3 ring-1 ring-secondary ring-inset">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            <span className="font-medium text-primary">{new Date(m.date).toLocaleDateString()}</span>
                                            {i === 0 && (
                                                <Badge color="brand" size="sm">
                                                    Latest
                                                </Badge>
                                            )}
                                        </div>
                                        <MeasurementActions row={m} onEdit={openEdit} onDelete={requestDelete} />
                                    </div>
                                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                                        <div className="flex flex-col gap-1">
                                            <dt className="text-xs text-tertiary">Weight</dt>
                                            <dd className="flex flex-col gap-1">
                                                <span className="font-mono text-primary tabular-nums">{fmtW(m.weightKg)}</span>
                                                {deltaBadge(
                                                    m.weightKg != null ? weightToDisplay(m.weightKg, unitSystem) : null,
                                                    older?.weightKg != null ? weightToDisplay(older.weightKg, unitSystem) : null,
                                                    wU,
                                                )}
                                            </dd>
                                        </div>
                                        <div className="flex flex-col gap-1">
                                            <dt className="text-xs text-tertiary">Body fat</dt>
                                            <dd className="flex flex-col gap-1">
                                                <span className="tabular-nums">{fmtPct(m.bodyFatPct)}</span>
                                                {deltaBadge(m.bodyFatPct, older?.bodyFatPct ?? null, "%", true)}
                                            </dd>
                                        </div>
                                        <div className="flex flex-col gap-1">
                                            <dt className="text-xs text-tertiary">Chest</dt>
                                            <dd className="font-mono tabular-nums">{fmtL(m.chestCm)}</dd>
                                        </div>
                                        <div className="flex flex-col gap-1">
                                            <dt className="text-xs text-tertiary">Waist</dt>
                                            <dd className="flex flex-col gap-1">
                                                <span className="font-mono tabular-nums">{fmtL(m.waistCm)}</span>
                                                {deltaBadge(
                                                    m.waistCm != null ? heightToDisplay(m.waistCm, unitSystem) : null,
                                                    older?.waistCm != null ? heightToDisplay(older.waistCm, unitSystem) : null,
                                                    lU,
                                                    true,
                                                )}
                                            </dd>
                                        </div>
                                        <div className="flex flex-col gap-1">
                                            <dt className="text-xs text-tertiary">Neck / Hip</dt>
                                            <dd className="text-xs">
                                                {fmtL(m.neckCm)} / {fmtL(m.hipCm)}
                                            </dd>
                                        </div>
                                        <div className="flex flex-col gap-1">
                                            <dt className="text-xs text-tertiary">Arms L/R</dt>
                                            <dd className="text-xs">
                                                {fmtL(m.armLCm)} / {fmtL(m.armRCm)}
                                            </dd>
                                        </div>
                                        <div className="flex flex-col gap-1">
                                            <dt className="text-xs text-tertiary">Legs L/R</dt>
                                            <dd className="text-xs">
                                                {fmtL(m.legLCm)} / {fmtL(m.legRCm)}
                                            </dd>
                                        </div>
                                        <div className="col-span-2 flex flex-col gap-1">
                                            <dt className="text-xs text-tertiary">Note</dt>
                                            <dd className="text-xs text-tertiary">{m.note ?? "—"}</dd>
                                        </div>
                                    </dl>
                                </li>
                            );
                        })
                    )}
                </ul>

                {/* Tablet/desktop: table (>= 640px) */}
                <div className="mt-4 hidden overflow-x-auto sm:block">
                    <table className="w-full min-w-[960px] text-sm">
                        <thead>
                            <tr className="border-b border-secondary text-left text-xs text-tertiary">
                                <th className="py-2 pr-3 font-medium">Date</th>
                                <th className="py-2 pr-3 font-medium">Weight</th>
                                <th className="py-2 pr-3 font-medium">BF%</th>
                                <th className="py-2 pr-3 font-medium">Chest</th>
                                <th className="py-2 pr-3 font-medium">Waist</th>
                                <th className="py-2 pr-3 font-medium">Neck / Hip</th>
                                <th className="py-2 pr-3 font-medium">Arms L/R</th>
                                <th className="py-2 pr-3 font-medium">Legs L/R</th>
                                <th className="py-2 pr-3 font-medium">Note</th>
                                <th className="py-2" />
                            </tr>
                        </thead>
                        <tbody>
                            {sorted.length === 0 ? (
                                <tr>
                                    <td colSpan={10} className="py-8 text-center text-tertiary">
                                        No measurements yet — use quick log or full entry above.
                                    </td>
                                </tr>
                            ) : (
                                sorted.map((m, i) => {
                                    const older = sorted[i + 1];
                                    return (
                                        <tr key={m.id} className="border-b border-secondary text-secondary transition hover:bg-secondary_subtle">
                                            <td className="py-2.5 pr-3">
                                                <div className="flex flex-col gap-1">
                                                    <span className="font-medium text-primary">{new Date(m.date).toLocaleDateString()}</span>
                                                    {i === 0 && (
                                                        <Badge color="brand" size="sm">
                                                            Latest
                                                        </Badge>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="py-2.5 pr-3">
                                                <div className="flex flex-col gap-1">
                                                    <span className="font-mono text-primary tabular-nums">{fmtW(m.weightKg)}</span>
                                                    {deltaBadge(
                                                        m.weightKg != null ? weightToDisplay(m.weightKg, unitSystem) : null,
                                                        older?.weightKg != null ? weightToDisplay(older.weightKg, unitSystem) : null,
                                                        wU,
                                                    )}
                                                </div>
                                            </td>
                                            <td className="py-2.5 pr-3">
                                                <div className="flex flex-col gap-1">
                                                    <span className="tabular-nums">{fmtPct(m.bodyFatPct)}</span>
                                                    {deltaBadge(m.bodyFatPct, older?.bodyFatPct ?? null, "%", true)}
                                                </div>
                                            </td>
                                            <td className="py-2.5 pr-3 font-mono tabular-nums">{fmtL(m.chestCm)}</td>
                                            <td className="py-2.5 pr-3">
                                                <div className="flex flex-col gap-1">
                                                    <span className="font-mono tabular-nums">{fmtL(m.waistCm)}</span>
                                                    {deltaBadge(
                                                        m.waistCm != null ? heightToDisplay(m.waistCm, unitSystem) : null,
                                                        older?.waistCm != null ? heightToDisplay(older.waistCm, unitSystem) : null,
                                                        lU,
                                                        true,
                                                    )}
                                                </div>
                                            </td>
                                            <td className="py-2.5 pr-3 text-xs">
                                                {fmtL(m.neckCm)} / {fmtL(m.hipCm)}
                                            </td>
                                            <td className="py-2.5 pr-3 text-xs">
                                                {fmtL(m.armLCm)} / {fmtL(m.armRCm)}
                                            </td>
                                            <td className="py-2.5 pr-3 text-xs">
                                                {fmtL(m.legLCm)} / {fmtL(m.legRCm)}
                                            </td>
                                            <td className="max-w-[120px] truncate py-2.5 pr-3 text-xs text-tertiary">{m.note ?? "—"}</td>
                                            <td className="py-2.5 text-right">
                                                <div className="flex justify-end">
                                                    <MeasurementActions row={m} onEdit={openEdit} onDelete={requestDelete} />
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </Card>

            {editModal && (
                <ModalOverlay isOpen onOpenChange={(v) => !v && setEditModal(null)}>
                    <Modal className="max-w-lg">
                        <Dialog aria-label="Edit measurement">
                            <div className="rounded-2xl bg-primary p-5 ring-1 ring-secondary">
                                <MetricForm
                                    unitSystem={unitSystem}
                                    initial={editModal}
                                    onDone={() => {
                                        setEditModal(null);
                                        router.refresh();
                                    }}
                                />
                            </div>
                        </Dialog>
                    </Modal>
                </ModalOverlay>
            )}

            {dialog}
        </div>
    );
}

function MeasurementActions({
    row,
    onEdit,
    onDelete,
}: {
    row: BodyMeasurementRow;
    onEdit: (row: BodyMeasurementRow) => void;
    onDelete: (row: BodyMeasurementRow) => void;
}) {
    return (
        <div className="flex gap-0.5">
            <ButtonUtility size="xs" color="tertiary" icon={Edit01} tooltip="Edit" onClick={() => onEdit(row)} />
            <ButtonUtility size="xs" color="tertiary" icon={Trash01} tooltip="Delete" onClick={() => onDelete(row)} />
        </div>
    );
}

function FeaturedIconWrap() {
    return (
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-secondary text-brand-primary">
            <Scale01 className="size-5" aria-hidden="true" />
        </div>
    );
}
