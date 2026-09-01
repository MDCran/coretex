"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Activity, ChevronDown, Lock01, LockUnlocked01, Scales01, Target04, Zap } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Slider } from "@/components/base/slider/slider";
import { Select } from "@/components/base/select/select";
import { Card, Field, NativeInput } from "../_components/health-ui";
import { ControlledDateInput } from "@/components/base/input/form-date-input";
import { toDateInput } from "@/lib/jobs/format";
import { cx } from "@/utils/cx";
import { applyCalculatedGoals } from "@/lib/actions/health-nutrition";
import {
    ACTIVITY_LABELS,
    ACTIVITY_MULTIPLIERS,
    computeGoalPlan,
    macroSplit,
    targetBodyFatFromWeight,
    targetWeightFromBodyFat,
    waterTargetMl,
    dailyCalorieDeltaFromWeeklyChange,
    weeklyChangeCalorieHint,
    KCAL_PER_KG,
    KCAL_PER_LB,
} from "@/lib/nutrition-calc";
import type { GoalCalcData } from "@/lib/actions/health-nutrition";
import {
    type UnitSystem,
    weightUnit,
    volumeUnit,
    weightToDisplay,
    volumeToDisplay,
    parseWeightInput,
    parseVolumeInput,
} from "@/lib/units";

interface Props {
    unitSystem: UnitSystem;
    data: GoalCalcData;
}

const ACTIVITY_OPTIONS = (Object.keys(ACTIVITY_MULTIPLIERS) as (keyof typeof ACTIVITY_MULTIPLIERS)[]).map((k) => ({
    value: k,
    label: `${ACTIVITY_LABELS[k]} (×${ACTIVITY_MULTIPLIERS[k]})`,
}));
const WEEKLY_PRESETS: Record<UnitSystem, number[]> = {
    METRIC: [0.25, 0.5, 0.75, 1],
    IMPERIAL: [0.5, 1, 1.5, 2],
};

const DIET_OPTIONS = [
    { value: "lose", label: "Lose weight (cut)" },
    { value: "maintain", label: "Maintain" },
    { value: "gain", label: "Gain weight (bulk)" },
    { value: "recomp", label: "Body recomposition" },
];

const numStr = (n: number | null | undefined) => (n == null ? "" : String(n));
const numOrNull = (v: string): number | null => {
    if (v.trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

export function GoalsClient({ unitSystem, data }: Props) {
    const router = useRouter();
    const [unit, setUnit] = useState<UnitSystem>(unitSystem);
    const [pending, setPending] = useState(false);
    const [showMath, setShowMath] = useState(false);

    // ── Editable inputs (the calc is live off these) ─────────────────────────────
    const [activity, setActivity] = useState(data.activityLevel ?? data.suggestedActivity);
    const [diet, setDiet] = useState(data.dietGoal ?? "maintain");
    const [weeklyChange, setWeeklyChange] = useState(numStr(data.targetWeeklyChangeKg != null ? Math.abs(data.targetWeeklyChangeKg) : null));
    const [fatPct, setFatPct] = useState(35); // % of non-protein calories from fat

    // Bidirectional weight ↔ body-fat target. `lock` = which field the user drives.
    const [lock, setLock] = useState<"weight" | "bodyfat">("weight");
    const [goalWeight, setGoalWeight] = useState(numStr(data.goalWeightKg != null ? weightToDisplay(data.goalWeightKg, unitSystem) : null));
    const [goalBodyFat, setGoalBodyFat] = useState(numStr(data.goalBodyFatPct));
    const [goalDate, setGoalDate] = useState<string | null>(toDateInput(data.goalTargetDate) || null);

    // Current values are metric; weeklyChange is entered in the display unit's mass.
    const currentWeightKg = data.currentWeightKg;
    const currentBodyFatPct = data.currentBodyFatPct;

    // ── Live plan ────────────────────────────────────────────────────────────────
    const plan = useMemo(
        () =>
            computeGoalPlan({
                gender: data.gender,
                age: data.age,
                heightCm: data.heightCm,
                weightKg: currentWeightKg,
                activityLevel: activity,
                dietGoal: diet,
                // weeklyChange is a mass in the display unit → convert to kg.
                targetWeeklyChangeKg: parseWeightInput(weeklyChange || "0", unit),
                fatPctOfRemaining: fatPct / 100,
            }),
        [data.gender, data.age, data.heightCm, currentWeightKg, activity, diet, weeklyChange, unit, fatPct],
    );

    // ── Bidirectional target derivation ──────────────────────────────────────────
    function onGoalWeightChange(displayVal: string) {
        setGoalWeight(displayVal);
        if (lock !== "weight") return;
        const kg = parseWeightInput(displayVal || "", unit);
        const impliedBf = targetBodyFatFromWeight(currentWeightKg, currentBodyFatPct, kg);
        setGoalBodyFat(impliedBf != null ? String(impliedBf) : "");
    }
    function onGoalBodyFatChange(val: string) {
        setGoalBodyFat(val);
        if (lock !== "bodyfat") return;
        const bf = numOrNull(val);
        const impliedKg = targetWeightFromBodyFat(currentWeightKg, currentBodyFatPct, bf);
        setGoalWeight(impliedKg != null ? String(weightToDisplay(impliedKg, unit)) : "");
    }

    function switchUnit(next: UnitSystem) {
        if (next === unit) return;
        const wKg = parseWeightInput(goalWeight, unit);
        const wcKg = parseWeightInput(weeklyChange, unit);
        setGoalWeight(numStr(wKg != null ? weightToDisplay(wKg, next) : null));
        setWeeklyChange(numStr(wcKg != null ? weightToDisplay(wcKg, next) : null));
        setUnit(next);
    }

    function applySuggestedActivity() {
        setActivity(data.suggestedActivity);
        toast.success(`Activity set to ${ACTIVITY_LABELS[data.suggestedActivity as keyof typeof ACTIVITY_LABELS] ?? data.suggestedActivity}`);
    }

    // Live macro grams off the (possibly adjusted) calorie + protein targets.
    const macros = useMemo(() => macroSplit(plan.calories, plan.proteinG, fatPct / 100), [plan.calories, plan.proteinG, fatPct]);
    const suggestedWaterMl = waterTargetMl(currentWeightKg);

    const missingProfile = data.heightCm == null || data.age == null || currentWeightKg == null;
    const massUnit = weightUnit(unit) as "kg" | "lb";
    const weeklyChangeNum = numOrNull(weeklyChange) ?? 0;
    const dailyDeltaFromWeekly = dailyCalorieDeltaFromWeeklyChange(weeklyChangeNum, massUnit);

    async function onApply() {
        if (plan.calories == null) {
            toast.error("Add your height, birthdate and a recent weight first.");
            return;
        }
        const fd = new FormData();
        fd.set("unitSystem", unit);
        fd.set("calories", String(plan.calories));
        fd.set("proteinG", numStr(plan.proteinG));
        if (macros) {
            fd.set("carbsG", String(macros.carbsG));
            fd.set("fatG", String(macros.fatG));
        }
        // Profile goal fields.
        fd.set("activityLevel", activity);
        fd.set("dietGoal", diet);
        const wcKg = parseWeightInput(weeklyChange || "0", unit);
        fd.set("targetWeeklyChangeKg", wcKg != null ? String(wcKg) : "");
        const gwKg = parseWeightInput(goalWeight, unit);
        fd.set("goalWeightKg", gwKg != null ? String(gwKg) : "");
        fd.set("goalBodyFatPct", goalBodyFat || "");
        fd.set("goalTargetDate", goalDate ?? "");
        // Water goal: suggested unless the user has none yet, else keep theirs.
        fd.set("waterGoalMl", String(suggestedWaterMl ?? data.waterGoalMl ?? 2500));

        setPending(true);
        try {
            await applyCalculatedGoals(fd);
            toast.success("Goals applied to nutrition + profile");
            router.refresh();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        } finally {
            setPending(false);
        }
    }

    return (
        <div className="flex w-full flex-col gap-6">
            {/* Units */}
            <Card>
                <h2 className="text-lg font-semibold text-primary">Units</h2>
                <p className="mt-0.5 text-sm text-tertiary">How measurements are displayed. Stored data is unaffected.</p>
                <div role="radiogroup" aria-label="Unit system" className="mt-3 inline-flex w-max gap-0.5 rounded-lg bg-secondary p-0.5 ring-1 ring-secondary ring-inset">
                    {(["METRIC", "IMPERIAL"] as const).map((u) => (
                        <button
                            key={u}
                            type="button"
                            role="radio"
                            aria-checked={unit === u}
                            onClick={() => switchUnit(u)}
                            className={cx(
                                "cursor-pointer rounded-md px-4 py-1.5 text-sm font-medium transition duration-100 ease-linear outline-focus-ring focus-visible:outline-2 focus-visible:outline-offset-2",
                                unit === u ? "bg-primary text-primary shadow-xs ring-1 ring-secondary ring-inset" : "text-tertiary hover:bg-primary_hover hover:text-secondary",
                            )}
                        >
                            {u === "METRIC" ? "Metric (kg, cm)" : "Imperial (lb, in)"}
                        </button>
                    ))}
                </div>
            </Card>

            {missingProfile && (
                <div className="flex items-start gap-2 rounded-xl bg-warning-secondary p-4 text-sm text-warning-primary ring-1 ring-secondary ring-inset">
                    <Activity className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
                    <span>
                        Some calculations need your <strong>height</strong>, <strong>birthdate</strong> (in Settings) and a recent <strong>weight</strong> (log one in Health → Metrics or Workouts → Body). Values below fill in as that data appears.
                    </span>
                </div>
            )}

            {/* Snapshot */}
            <Card>
                <div className="flex items-center gap-2">
                    <Scales01 className="size-5 text-fg-quaternary" aria-hidden="true" />
                    <h2 className="text-lg font-semibold text-primary">Where you are now</h2>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <Snapshot label="Weight" value={currentWeightKg != null ? `${weightToDisplay(currentWeightKg, unit)} ${weightUnit(unit)}` : "—"} />
                    <Snapshot
                        label="Body fat"
                        value={currentBodyFatPct != null ? `${currentBodyFatPct}%` : "—"}
                        sub={data.bodyFatMethod === "navy" ? "Navy tape method" : data.bodyFatMethod === "bmi" ? "BMI estimate (rough)" : undefined}
                    />
                    <Snapshot label="Age" value={data.age != null ? `${data.age}` : "—"} />
                    <Snapshot label="BMR" value={plan.bmr != null ? `${plan.bmr} kcal` : "—"} sub="Mifflin–St Jeor" />
                </div>
            </Card>

            {/* Activity (workout integration) */}
            <Card>
                <div className="flex items-center gap-2">
                    <Activity className="size-5 text-fg-quaternary" aria-hidden="true" />
                    <h2 className="text-lg font-semibold text-primary">Activity level</h2>
                </div>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <Field label="Activity">
                        <Select
                            selectedKey={activity}
                            onSelectionChange={(k) => setActivity(String(k))}
                            items={ACTIVITY_OPTIONS.map((o) => ({ id: o.value, label: o.label }))}
                            size="sm"
                            aria-label="Activity level"
                        >
                            {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                        </Select>
                    </Field>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-brand-secondary p-3 ring-1 ring-secondary ring-inset">
                    <div className="flex items-center gap-2 text-sm text-secondary">
                        <Zap className="size-4 text-fg-brand-primary" aria-hidden="true" />
                        <span>
                            You averaged <strong className="text-primary">{data.avgWorkoutsPerWeek}</strong> workouts/week (last 4 weeks) — suggested level:{" "}
                            <strong className="text-primary">{ACTIVITY_LABELS[data.suggestedActivity as keyof typeof ACTIVITY_LABELS] ?? data.suggestedActivity}</strong>.
                        </span>
                    </div>
                    <Button size="sm" color="secondary" onClick={applySuggestedActivity} isDisabled={activity === data.suggestedActivity}>Apply</Button>
                </div>
            </Card>

            {/* Diet goal + rate */}
            <Card>
                <div className="flex items-center gap-2">
                    <Target04 className="size-5 text-fg-quaternary" aria-hidden="true" />
                    <h2 className="text-lg font-semibold text-primary">Diet goal</h2>
                </div>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <Field label="Goal">
                        <Select
                            selectedKey={diet}
                            onSelectionChange={(k) => setDiet(String(k))}
                            items={DIET_OPTIONS.map((o) => ({ id: o.value, label: o.label }))}
                            size="sm"
                            aria-label="Diet goal"
                        >
                            {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                        </Select>
                    </Field>
                    {(diet === "lose" || diet === "gain") && (
                        <div className="flex flex-col gap-2">
                            <Field label={`Weekly change (${massUnit}/week)`} htmlFor="weeklyChange" hint={weeklyChangeCalorieHint(massUnit)}>
                                <NativeInput id="weeklyChange" type="number" step="any" min={0} value={weeklyChange} onChange={(e) => setWeeklyChange(e.target.value)} />
                            </Field>
                            {weeklyChangeNum > 0 && dailyDeltaFromWeekly > 0 && (
                                <p className="text-xs text-secondary">
                                    ≈ <strong className="text-primary">{Math.round(dailyDeltaFromWeekly)} kcal/day</strong>{" "}
                                    {diet === "lose" ? "deficit" : "surplus"} from weekly rate
                                </p>
                            )}
                            <div className="flex flex-wrap gap-1.5">
                                {WEEKLY_PRESETS[unit].map((preset) => (
                                    <Button key={preset} size="sm" color="secondary" type="button" onClick={() => setWeeklyChange(String(preset))}>
                                        {preset} {massUnit}/wk
                                    </Button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </Card>

            {/* Bidirectional target weight ↔ body fat */}
            <Card>
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <Scales01 className="size-5 text-fg-quaternary" aria-hidden="true" />
                        <h2 className="text-lg font-semibold text-primary">Target weight & body fat</h2>
                    </div>
                </div>
                <p className="mt-0.5 text-sm text-tertiary">
                    Set the value you want to drive; the other is implied assuming your lean mass stays constant. Lock the field you control.
                </p>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <LockableField
                        label={`Target weight (${weightUnit(unit)})`}
                        locked={lock === "weight"}
                        onLock={() => setLock("weight")}
                        id="goalWeight"
                        value={goalWeight}
                        onChange={onGoalWeightChange}
                        disabled={lock !== "weight" && currentBodyFatPct != null}
                    />
                    <LockableField
                        label="Target body fat (%)"
                        locked={lock === "bodyfat"}
                        onLock={() => setLock("bodyfat")}
                        id="goalBodyFat"
                        value={goalBodyFat}
                        onChange={onGoalBodyFatChange}
                        disabled={lock !== "bodyfat" && currentBodyFatPct != null}
                    />
                </div>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <Field label="Target date" htmlFor="goalTargetDate">
                        <ControlledDateInput value={goalDate} onChange={(v) => setGoalDate(v)} />
                    </Field>
                </div>
                {currentBodyFatPct == null && (
                    <p className="mt-2 text-xs text-tertiary">Log girths (neck/waist{(data.gender ?? "").toLowerCase() === "female" ? "/hip" : ""}) in Workouts → Body to enable the two-way body-fat calc.</p>
                )}
            </Card>

            {/* Calculated targets */}
            <Card>
                <div className="flex items-center gap-2">
                    <Zap className="size-5 text-fg-brand-primary" aria-hidden="true" />
                    <h2 className="text-lg font-semibold text-primary">Your calculated targets</h2>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-4 lg:grid-cols-4">
                    <Snapshot label="TDEE" value={plan.tdee != null ? `${plan.tdee} kcal` : "—"} sub="maintenance" />
                    <Snapshot label="Calories" value={plan.calories != null ? `${plan.calories} kcal` : "—"} emphasize />
                    <Snapshot label="Protein" value={plan.proteinG != null ? `${plan.proteinG} g` : "—"} sub={`${plan.proteinPerKg} g/kg`} emphasize />
                    <Snapshot label="Water" value={suggestedWaterMl != null ? `${volumeToDisplay(suggestedWaterMl, unit)} ${volumeUnit(unit)}` : "—"} sub="~35 ml/kg" />
                </div>

                <div className="mt-4">
                    <Field label={`Fat share of non-protein calories: ${fatPct}%`} hint="Protein is fixed; the rest splits between carbs and fat.">
                        <Slider
                            aria-label="Fat share of non-protein calories"
                            minValue={20}
                            maxValue={50}
                            value={fatPct}
                            onChange={(v) => setFatPct(Array.isArray(v) ? v[0] : v)}
                            labelPosition="bottom"
                            formatOptions={{ style: "decimal", maximumFractionDigits: 0 }}
                            labelFormatter={(v) => `${v}%`}
                        />
                    </Field>
                    {macros && (
                        <div className="mt-2 grid grid-cols-3 gap-3">
                            <Snapshot label="Protein" value={`${macros.proteinG} g`} />
                            <Snapshot label="Carbs" value={`${macros.carbsG} g`} />
                            <Snapshot label="Fat" value={`${macros.fatG} g`} />
                        </div>
                    )}
                </div>

                {/* How we calculated this */}
                <button
                    type="button"
                    onClick={() => setShowMath((s) => !s)}
                    className="mt-4 flex items-center gap-1.5 text-sm font-medium text-brand-secondary"
                    aria-expanded={showMath}
                >
                    <ChevronDown className={cx("size-4 transition-transform", showMath && "rotate-180")} aria-hidden="true" />
                    How we calculated this
                </button>
                {showMath && (
                    <div className="mt-3 flex flex-col gap-1.5 rounded-lg bg-secondary_subtle p-4 text-sm text-tertiary">
                        <MathRow label="BMR (Mifflin–St Jeor)" value={plan.bmr != null ? `${plan.bmr} kcal` : "—"} />
                        <MathRow label={`TDEE = BMR × ${plan.activityMultiplier} (${ACTIVITY_LABELS[plan.activityKey as keyof typeof ACTIVITY_LABELS] ?? plan.activityKey})`} value={plan.tdee != null ? `${plan.tdee} kcal` : "—"} />
                        {(diet === "lose" || diet === "gain") && weeklyChangeNum > 0 && (
                            <MathRow
                                label={`Weekly change = ${weeklyChangeNum} ${massUnit}/wk → ${Math.round(dailyDeltaFromWeekly)} kcal/day ${diet === "lose" ? "deficit" : "surplus"}`}
                                value={massUnit === "lb" ? `(${KCAL_PER_LB.toLocaleString()} kcal/lb)` : `(${KCAL_PER_KG.toLocaleString()} kcal/kg)`}
                            />
                        )}
                        <MathRow
                            label={diet === "lose" ? "Calorie target = TDEE − deficit" : diet === "gain" ? "Calorie target = TDEE + surplus" : "Calorie target = TDEE (maintain)"}
                            value={plan.calories != null ? `${plan.calories} kcal` : "—"}
                        />
                        <MathRow label={`Protein = ${plan.proteinPerKg} g/kg × bodyweight`} value={plan.proteinG != null ? `${plan.proteinG} g` : "—"} />
                        <MathRow label="Water ≈ 35 ml/kg bodyweight" value={suggestedWaterMl != null ? `${suggestedWaterMl} ml` : "—"} />
                        {currentBodyFatPct != null && (
                            <MathRow label={`Body fat (${data.bodyFatMethod === "navy" ? "Navy tape" : "BMI estimate"})`} value={`${currentBodyFatPct}%`} />
                        )}
                    </div>
                )}

                <div className="mt-5 flex justify-end">
                    <Button onClick={onApply} isLoading={pending} showTextWhileLoading iconLeading={Target04} isDisabled={plan.calories == null}>
                        Apply to nutrition goals
                    </Button>
                </div>
            </Card>
        </div>
    );
}

function Snapshot({ label, value, sub, emphasize }: { label: string; value: string; sub?: string; emphasize?: boolean }) {
    return (
        <div
            className={cx(
                "flex flex-col gap-0.5 rounded-lg p-3 ring-1 ring-secondary ring-inset",
                emphasize ? "border-l-[3px] border-l-brand-solid bg-secondary_subtle" : "bg-primary",
            )}
        >
            <p className="text-xs font-medium text-tertiary">{label}</p>
            <p className="text-lg font-semibold text-primary">{value}</p>
            {sub && <p className="text-xs text-tertiary">{sub}</p>}
        </div>
    );
}

function MathRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-baseline justify-between gap-3">
            <span>{label}</span>
            <span className="font-medium text-secondary">{value}</span>
        </div>
    );
}

function LockableField({
    label,
    locked,
    onLock,
    id,
    value,
    onChange,
    disabled,
}: {
    label: string;
    locked: boolean;
    onLock: () => void;
    id: string;
    value: string;
    onChange: (v: string) => void;
    disabled?: boolean;
}) {
    return (
        <Field label={label} htmlFor={id}>
            <div className="flex items-center gap-2">
                <NativeInput
                    id={id}
                    type="number"
                    step="any"
                    min={0}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    disabled={disabled}
                    className="flex-1"
                />
                <button
                    type="button"
                    onClick={onLock}
                    aria-label={locked ? `${label} is the driver` : `Make ${label} the driver`}
                    aria-pressed={locked}
                    className={cx(
                        "flex size-10 shrink-0 items-center justify-center rounded-lg ring-1 ring-secondary ring-inset transition",
                        locked ? "bg-brand-secondary text-brand-secondary" : "bg-primary text-fg-quaternary hover:text-fg-secondary",
                    )}
                >
                    {locked ? <Lock01 className="size-4" /> : <LockUnlocked01 className="size-4" />}
                </button>
            </div>
        </Field>
    );
}
