// @ts-nocheck
import { useCallback, useEffect, useState } from "react";
import { Check, Droplets01, Moon01, Plus, Scales01 } from "@untitledui/icons";
import { toast } from "sonner";
import { Button } from "@/components/base/buttons/button";
import { cx } from "@/utils/cx";
import { addWater } from "@/lib/actions/health-nutrition";
import { createBodyMetric } from "@/lib/actions/health-metrics";
import { toggleHabitLog } from "@/lib/actions/health-habits";
import { getHealthWidgetSnapshot, type HealthWidgetSnapshot } from "@/lib/actions/widget-snapshots";
import { parseWeightInput, volumeToDisplay, volumeUnit, waterQuickAdds, weightToDisplay, weightUnit } from "@/lib/units";

const POLL_MS = 60_000;

/** UTC YYYY-MM-DD — matches the server's parseDateOnly (Date.UTC) day key so widget
 *  writes (water/habits) land on the same @db.Date the snapshot reads back. */
function localDateKey(): string {
    return new Date().toISOString().slice(0, 10);
}

function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtSleep(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function HealthWidgetPanel() {
    const [data, setData] = useState<HealthWidgetSnapshot | null>(null);
    const [busy, setBusy] = useState(false);
    const [weightInput, setWeightInput] = useState("");

    const load = useCallback(async () => {
        try {
            setData(await getHealthWidgetSnapshot());
        } catch {
            /* ignore */
        }
    }, []);
    useEffect(() => {
        void load();
        const id = setInterval(() => void load(), POLL_MS);
        return () => clearInterval(id);
    }, [load]);

    if (!data) return <div className="flex flex-1 items-center justify-center p-6 text-sm text-tertiary">Loading…</div>;

    const unit = data.unitSystem;
    const waterPct = data.waterGoalMl && data.waterGoalMl > 0 ? Math.min(100, (data.waterMl / data.waterGoalMl) * 100) : 0;

    async function logWater(ml: number) {
        setBusy(true);
        try {
            const fd = new FormData();
            fd.set("date", localDateKey());
            fd.set("amountMl", String(ml));
            await addWater(fd);
            await load();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't log water");
        } finally {
            setBusy(false);
        }
    }

    async function logWeight() {
        const kg = parseWeightInput(weightInput, unit);
        if (kg == null) {
            toast.error("Enter a valid weight");
            return;
        }
        setBusy(true);
        try {
            const fd = new FormData();
            fd.set("metricType", "weight");
            fd.set("value", String(kg));
            fd.set("unit", "kg");
            await createBodyMetric(fd);
            setWeightInput("");
            toast.success("Weight logged");
            await load();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't log weight");
        } finally {
            setBusy(false);
        }
    }

    async function toggleHabit(id: string) {
        setBusy(true);
        try {
            const fd = new FormData();
            fd.set("habitId", id);
            fd.set("logDate", localDateKey());
            await toggleHabitLog(fd);
            await load();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't update habit");
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            {/* At-a-glance stats */}
            <div className="grid grid-cols-2 gap-2">
                <Stat
                    icon={<Scales01 className="size-3.5" aria-hidden="true" />}
                    label="Weight"
                    value={data.latestWeightKg != null ? `${weightToDisplay(data.latestWeightKg, unit)} ${weightUnit(unit)}` : "—"}
                    sub={data.latestWeightAt ? fmtDate(data.latestWeightAt) : data.latestBodyFatPct != null ? `${data.latestBodyFatPct.toFixed(1)}% bf` : undefined}
                />
                <Stat
                    icon={<Moon01 className="size-3.5" aria-hidden="true" />}
                    label="Last sleep"
                    value={data.lastSleepMinutes != null ? fmtSleep(data.lastSleepMinutes) : "—"}
                    sub={data.lastSleepQuality != null ? `Quality ${data.lastSleepQuality}/5` : data.lastSleepDate ? fmtDate(data.lastSleepDate) : undefined}
                />
            </div>

            {/* Water with quick-add */}
            <div className="rounded-xl bg-secondary_subtle p-3 ring-1 ring-inset ring-secondary">
                <div className="flex items-center justify-between">
                    <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-tertiary uppercase">
                        <Droplets01 className="size-3.5" aria-hidden="true" /> Water
                    </p>
                    <p className="text-xs tabular-nums text-tertiary">
                        {volumeToDisplay(data.waterMl, unit)}
                        {data.waterGoalMl != null ? ` / ${volumeToDisplay(data.waterGoalMl, unit)}` : ""} {volumeUnit(unit)}
                    </p>
                </div>
                {data.waterGoalMl != null && (
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-quaternary">
                        <div className="h-full rounded-full bg-brand-solid" style={{ width: `${waterPct}%` }} />
                    </div>
                )}
                <div className="mt-2 flex gap-2">
                    {waterQuickAdds(unit).map((q) => (
                        <Button key={q.label} size="sm" color="secondary" className="flex-1" isDisabled={busy} onClick={() => void logWater(q.ml)}>
                            {q.label}
                        </Button>
                    ))}
                </div>
            </div>

            {/* Weight quick-log */}
            <div className="rounded-xl bg-secondary_subtle p-3 ring-1 ring-inset ring-secondary">
                <p className="text-xs font-semibold tracking-wide text-tertiary uppercase">Log weight</p>
                <div className="mt-2 flex gap-2">
                    <input
                        value={weightInput}
                        onChange={(e) => setWeightInput(e.target.value.replace(/[^\d.]/g, ""))}
                        inputMode="decimal"
                        placeholder={`Weight (${weightUnit(unit)})`}
                        className="h-9 min-w-0 flex-1 rounded-md bg-primary px-2.5 text-sm tabular-nums text-primary ring-1 ring-primary ring-inset outline-none placeholder:text-placeholder focus:outline-2 focus:-outline-offset-2 focus:outline-brand"
                        onKeyDown={(e) => {
                            if (e.key === "Enter") void logWeight();
                        }}
                    />
                    <Button size="sm" color="primary" iconLeading={Plus} isDisabled={busy || !weightInput} onClick={() => void logWeight()}>
                        Log
                    </Button>
                </div>
            </div>

            {/* Habits */}
            {data.habitsTotal > 0 && (
                <div className="rounded-xl bg-secondary_subtle p-3 ring-1 ring-inset ring-secondary">
                    <p className="text-xs font-semibold tracking-wide text-tertiary uppercase">
                        Habits · {data.habitsDone}/{data.habitsTotal}
                    </p>
                    <ul className="mt-2 flex flex-col gap-1">
                        {data.habits.map((h) => (
                            <li key={h.id}>
                                <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => void toggleHabit(h.id)}
                                    className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm transition hover:bg-primary_hover disabled:opacity-50"
                                >
                                    <span
                                        className={cx(
                                            "flex size-5 shrink-0 items-center justify-center rounded-md ring-1 ring-inset transition",
                                            h.done ? "bg-success-solid text-white ring-transparent" : "bg-primary text-transparent ring-primary",
                                        )}
                                    >
                                        <Check className="size-3.5" aria-hidden="true" />
                                    </span>
                                    <span className={cx("truncate", h.done ? "text-tertiary line-through" : "text-primary")}>{h.name}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <Button href="/health" size="sm" color="link-color" className="mt-auto self-start">
                Open Health
            </Button>
        </div>
    );
}

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
    return (
        <div className="rounded-xl bg-secondary_subtle p-3 ring-1 ring-inset ring-secondary">
            <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-tertiary uppercase">
                {icon} {label}
            </p>
            <p className="mt-1 text-lg font-semibold text-primary">{value}</p>
            {sub && <p className="text-xs text-tertiary">{sub}</p>}
        </div>
    );
}
