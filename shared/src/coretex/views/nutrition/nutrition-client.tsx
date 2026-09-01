// @ts-nocheck
import { DeltaBadge } from "@/components/foundations/delta-badge";
import { Apple } from "@/components/foundations/social-icons";
import { UnitSystem, volumeToDisplay, volumeUnit } from "@/lib/units";
import { cx } from "@/utils/cx";
import { useRouter } from "@react-aria/utils";
import { Sunrise, Sun, Moon01, Star06, List, Edit01, Target04, Droplets01, Plus, Star01, BookmarkAdd, MagicWand01, Camera01, Stars01, InfoCircle, Database01, Trash02, Save01 } from "@untitledui/icons";
import { formatDate } from "../personal/personal-ui";
import { useEffect, useRef, useState } from "react";
import { Calendar, Button, ProgressBar, Tooltip, TooltipTrigger } from "react-aria-components";
import { toast } from "sonner";
import { NativeInput, SectionHeader, Field, NativeSelect, NativeTextarea } from "../financial/_components/financial-ui";
import { FormModal } from "../financial/_components/form-modal";
import { Card } from "../social/ui";
import { formatMacroValue, MacroStat, MacroChip } from "./_components/macro-stat";
import { NutritionDayNav, NutritionMonthNav } from "./_components/nutrition-date-nav";
import { NutritionFactsCard } from "./_components/nutrition-facts-card";
import { ChatLogTarget, QuickLogAi } from "./_components/quick-log-ai";






export interface EntryRow {
    id: string;
    description: string;
    servingSize: string | null;
    quantity: number | null;
    unit: string | null;
    calories: number | null;
    proteinG: number | null;
    carbsG: number | null;
    fatG: number | null;
    fiberG: number | null;
    sugarG: number | null;
    sodiumMg: number | null;
    cholesterolMg: number | null;
    saturatedFatG: number | null;
    transFatG: number | null;
    potassiumMg: number | null;
    isFavorite: boolean;
    aiAnalyzed: boolean;
    imageUrl: string | null;
    aiPrompt: string | null;
}
export interface DaySummary {
    date: string;
    calories: number;
    protein: number;
    mealCount: number;
}
export interface MealGroup {
    mealType: string;
    entries: EntryRow[];
}
export interface ProductRow {
    id: string;
    name: string;
    quantity: number | null;
    unit: string | null;
    calories: number | null;
    proteinG: number | null;
    carbsG: number | null;
    fatG: number | null;
    barcode: string | null;
}
export interface SavedMealRow {
    id: string;
    name: string;
    mealType: string | null;
    itemCount: number;
}
export interface Goal {
    calories: number | null;
    proteinG: number | null;
    carbsG: number | null;
    fatG: number | null;
    fiberG: number | null;
}

const MEAL_TYPES = ["BREAKFAST", "LUNCH", "DINNER", "SNACK"] as const;
type MealType = (typeof MEAL_TYPES)[number];
const MEAL_LABEL: Record<string, string> = { BREAKFAST: "Breakfast", LUNCH: "Lunch", DINNER: "Dinner", SNACK: "Snack" };
const MEAL_ICON: Record<string, typeof Sunrise> = { BREAKFAST: Sunrise, LUNCH: Sun, DINNER: Moon01, SNACK: Star06 };
const SAFE_FOOD_PHOTO_TYPES = new Set(["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"]);
const SAFE_FOOD_PHOTO_ACCEPT = Array.from(SAFE_FOOD_PHOTO_TYPES).join(",");
const MAX_FOOD_PHOTO_SIZE = 25 * 1024 * 1024;

/** Parse a casual water amount ("16 oz", "500ml", "2") into ml. */
function parseWaterFromText(text: string, unitSystem: UnitSystem): number | null {
    const t = text.trim().toLowerCase();
    if (!t) return null;
    const numMatch = t.match(/([\d.]+)/);
    if (!numMatch) return null;
    const n = parseFloat(numMatch[1]);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (t.includes("oz") || t.includes("ounce")) return Math.round(ozToMl(n));
    if (/\bl\b/.test(t) && !t.includes("ml")) return Math.round(n * 1000);
    if (t.includes("cup")) return Math.round(n * 236.588);
    if (t.includes("ml") || t.includes("milliliter")) return Math.round(n);
    return Math.round(unitSystem === "IMPERIAL" ? ozToMl(n) : n);
}

function sum(entries: EntryRow[], key: keyof EntryRow) {
    return entries.reduce((acc, e) => acc + (typeof e[key] === "number" ? (e[key] as number) : 0), 0);
}

interface DraftItem extends AnalyzedItem {
    _key: string;
}

interface ConfirmState {
    /** Default/target meal. For chat mode each item may override via item.mealType. */
    mealType: string;
    items: DraftItem[];
    raw: string;
    imageUrl?: string | null;
    imageKey?: string;
    /** "chat" routes per-item meals + water via saveChatEntries; else single meal. */
    mode: "single" | "chat";
    /** Editable water amount (ml) for the chat flow. */
    waterMl?: number | null;
}

let _draftSeq = 0;
function toDrafts(items: AnalyzedItem[]): DraftItem[] {
    return items.map((i) => ({ ...i, _key: `d${_draftSeq++}` }));
}

export function NutritionClient({
    date,
    meals,
    water,
    waterGoalMl,
    goal,
    products,
    savedMeals,
    favorites,
    unitSystem,
    aiConfigured,
    month,
    goalFromCalculator,
}: {
    date: string;
    meals: MealGroup[];
    water: number;
    waterGoalMl: number;
    goal: Goal;
    products: ProductRow[];
    savedMeals: SavedMealRow[];
    favorites: EntryRow[];
    unitSystem: UnitSystem;
    aiConfigured: boolean;
    month: { year: number; month: number; days: DaySummary[] };
    /** True when the current targets were produced by the /health/goals calculator. */
    goalFromCalculator: boolean;
}) {
    const router = useRouter();
    const [view, setView] = useState<"day" | "month">("day");
    const [chatText, setChatText] = useState("");
    const [chatBusy, setChatBusy] = useState(false);
    /** AUTO = AI infers meal; WATER = water-only quick log. */
    const [chatTarget, setChatTarget] = useState<ChatLogTarget>("AUTO");
    const [infoEntry, setInfoEntry] = useState<EntryRow | null>(null);
    const [addOpen, setAddOpen] = useState<string | null>(null);
    const [editEntry, setEditEntry] = useState<EntryRow | null>(null);
    const [goalOpen, setGoalOpen] = useState(false);
    const [productOpen, setProductOpen] = useState(false);
    const [editProduct, setEditProduct] = useState<ProductRow | null>(null);
    const [dbOpen, setDbOpen] = useState(false);

    // AI flows
    const [textOpen, setTextOpen] = useState<string | null>(null); // mealType
    const [photoOpen, setPhotoOpen] = useState<string | null>(null); // mealType
    const [analyzing, setAnalyzing] = useState(false);
    const [confirm, setConfirm] = useState<ConfirmState | null>(null);
    const [savingConfirm, setSavingConfirm] = useState(false);
    const photoPreviewUrlRef = useRef<string | null>(null);

    useEffect(() => () => {
        if (photoPreviewUrlRef.current) URL.revokeObjectURL(photoPreviewUrlRef.current);
    }, []);

    function releasePhotoPreview(expectedUrl?: string) {
        const currentUrl = photoPreviewUrlRef.current;
        if (!currentUrl || (expectedUrl && currentUrl !== expectedUrl)) return;
        URL.revokeObjectURL(currentUrl);
        photoPreviewUrlRef.current = null;
    }

    function clearConfirm() {
        releasePhotoPreview();
        setConfirm(null);
    }

    const allEntries = meals.flatMap((m) => m.entries);
    const totals = {
        calories: sum(allEntries, "calories"),
        proteinG: sum(allEntries, "proteinG"),
        carbsG: sum(allEntries, "carbsG"),
        fatG: sum(allEntries, "fatG"),
        fiberG: sum(allEntries, "fiberG"),
    };

    // Previous day's totals (from the month summaries) to show change vs yesterday
    // on calories + protein, the two macros tracked per-day server-side.
    const yesterdayKey = (() => {
        const d = new Date(date + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() - 1);
        return d.toISOString().slice(0, 10);
    })();
    const prevDay = month.days.find((d) => d.date === yesterdayKey) ?? null;
    const deltaVsYesterday = (macroKey: string): number | null => {
        if (!prevDay) return null;
        if (macroKey === "calories") return totals.calories - prevDay.calories;
        if (macroKey === "protein") return totals.proteinG - prevDay.protein;
        return null;
    };

    function shiftDate(days: number) {
        const d = new Date(date + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() + days);
        router.push(`/nutrition?date=${d.toISOString().slice(0, 10)}`);
    }

    /** Jump to the 1st of the adjacent month (keeps month view stable). */
    function shiftMonth(delta: number) {
        const d = new Date(Date.UTC(month.year, month.month + delta, 1));
        router.push(`/nutrition?date=${d.toISOString().slice(0, 10)}`);
    }

    async function wrap(fn: () => Promise<void>, ok: string, onDone?: () => void) {
        try {
            await fn();
            toast.success(ok);
            onDone?.();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        }
    }

    function mealEntries(mt: string) {
        return meals.find((m) => m.mealType === mt)?.entries ?? [];
    }

    async function runTextAnalyze(fd: FormData) {
        const mt = textOpen ?? "SNACK";
        setAnalyzing(true);
        try {
            const res = await analyzeFoodText(fd);
            setTextOpen(null);
            setConfirm({ mealType: mt, items: toDrafts(res.items), raw: res.raw, mode: "single" });
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't analyze that");
        } finally {
            setAnalyzing(false);
        }
    }

    async function runPhotoAnalyze(fd: FormData) {
        const mt = photoOpen ?? "SNACK";
        const file = fd.get("photo");
        if (!(file instanceof File) || file.size === 0) {
            toast.error("Choose a non-empty food photo.");
            return;
        }
        if (file.size > MAX_FOOD_PHOTO_SIZE) {
            toast.error("Food photo must be 25 MB or smaller.");
            return;
        }
        if (!SAFE_FOOD_PHOTO_TYPES.has(file.type.toLowerCase())) {
            toast.error("Choose an AVIF, GIF, JPEG, PNG, or WebP image.");
            return;
        }

        releasePhotoPreview();
        const preview = encodeURI(URL.createObjectURL(file));
        photoPreviewUrlRef.current = preview;
        setAnalyzing(true);
        try {
            const res = await analyzeFoodPhoto(fd);
            setPhotoOpen(null);
            setConfirm({ mealType: mt, items: toDrafts(res.items), raw: res.raw, imageUrl: preview, imageKey: res.imageKey, mode: "single" });
        } catch (e) {
            releasePhotoPreview(preview);
            toast.error(e instanceof Error ? e.message : "Couldn't analyze that photo");
        } finally {
            setAnalyzing(false);
        }
    }

    async function runChatAnalyze() {
        const text = chatText.trim();
        if (!text) {
            toast.error(chatTarget === "WATER" ? "Enter how much water you drank" : "Describe what you ate or drank");
            return;
        }

        const defaultMeal = chatTarget !== "AUTO" && chatTarget !== "WATER" ? chatTarget : "SNACK";

        // Water-only: try a fast local parse before calling AI.
        if (chatTarget === "WATER") {
            const ml = parseWaterFromText(text, unitSystem);
            if (ml) {
                setConfirm({ mealType: defaultMeal, items: [], raw: text, mode: "chat", waterMl: ml });
                setChatText("");
                return;
            }
        }

        setChatBusy(true);
        try {
            const fd = new FormData();
            fd.set("description", text);
            if (chatTarget !== "AUTO" && chatTarget !== "WATER") fd.set("defaultMealType", chatTarget);
            if (chatTarget === "WATER") fd.set("waterOnly", "true");
            const res = await analyzeFoodChat(fd);
            const fallbackMeal = chatTarget !== "AUTO" && chatTarget !== "WATER" ? chatTarget : "SNACK";
            const drafts = toDrafts(res.items).map((it) => ({
                ...it,
                mealType: it.mealType ?? (chatTarget !== "AUTO" && chatTarget !== "WATER" ? chatTarget : it.mealType),
            }));
            setConfirm({
                mealType: fallbackMeal,
                items: drafts,
                raw: res.raw,
                mode: "chat",
                waterMl: res.waterMl ?? (chatTarget === "WATER" ? parseWaterFromText(text, unitSystem) : null),
            });
            setChatText("");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't read that");
        } finally {
            setChatBusy(false);
        }
    }

    function updateDraft(key: string, patch: Partial<DraftItem>) {
        setConfirm((c) => (c ? { ...c, items: c.items.map((it) => (it._key === key ? { ...it, ...patch } : it)) } : c));
    }

    function removeDraft(key: string) {
        setConfirm((c) => (c ? { ...c, items: c.items.filter((it) => it._key !== key) } : c));
    }

    function num(v: string): number | null {
        if (v.trim() === "") return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }

    async function saveConfirm() {
        if (!confirm) return;
        const water = confirm.mode === "chat" ? confirm.waterMl ?? 0 : 0;
        if (confirm.items.length === 0 && water <= 0) {
            toast.error("Nothing to save");
            return;
        }
        const fd = new FormData();
        fd.set("date", date);
        fd.set("raw", confirm.raw);
        const itemsJson = JSON.stringify(
            confirm.items.map(({ _key, ...rest }) => rest), // eslint-disable-line @typescript-eslint/no-unused-vars
        );
        fd.set("items", itemsJson);
        setSavingConfirm(true);
        try {
            if (confirm.mode === "chat") {
                fd.set("defaultMealType", confirm.mealType);
                if (water > 0) fd.set("waterMl", String(water));
                await saveChatEntries(fd);
                const parts: string[] = [];
                if (confirm.items.length) parts.push(`${confirm.items.length} item${confirm.items.length === 1 ? "" : "s"}`);
                if (water > 0) parts.push(`${volumeToDisplay(water, unitSystem)} ${volumeUnit(unitSystem)} water`);
                toast.success(`Logged ${parts.join(" + ")}`);
            } else {
                fd.set("mealType", confirm.mealType);
                if (confirm.imageKey) fd.set("imageKey", confirm.imageKey);
                await saveAnalyzedEntries(fd);
                toast.success(`Added ${confirm.items.length} item${confirm.items.length === 1 ? "" : "s"}`);
            }
            clearConfirm();
            router.refresh();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't save");
        } finally {
            setSavingConfirm(false);
        }
    }

    async function saveAsProduct(entryId: string) {
        const fd = new FormData();
        fd.set("id", entryId);
        await wrap(() => saveEntryAsProduct(fd), "Saved to food DB");
    }

    // Custom water amount, entered in the display unit (oz / ml), stored as ml.
    const [customWater, setCustomWater] = useState("");
    const waterUnitLabel = volumeUnit(unitSystem);
    async function addCustomWater() {
        const n = Number(customWater);
        if (!Number.isFinite(n) || n <= 0) {
            toast.error(`Enter a positive amount in ${waterUnitLabel}`);
            return;
        }
        const ml = Math.round(unitSystem === "IMPERIAL" ? ozToMl(n) : n);
        const fd = new FormData();
        fd.set("date", date);
        fd.set("amountMl", String(ml));
        await wrap(() => addWater(fd), `Added ${formatMacroValue(n, waterUnitLabel as "fl oz" | "ml")} ${waterUnitLabel}`, () => setCustomWater(""));
    }

    const aiTooltip = "Requires ANTHROPIC_API_KEY on the server.";

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                {view === "day" ? (
                    <NutritionDayNav
                        date={date}
                        onDateChange={(v) => router.push(`/nutrition?date=${v}`)}
                        onShiftDay={shiftDate}
                    />
                ) : (
                    <NutritionMonthNav
                        year={month.year}
                        month={month.month}
                        onShiftMonth={shiftMonth}
                        onJumpMonth={(v) => router.push(`/nutrition?date=${v}`)}
                    />
                )}
                <div className="flex gap-2">
                    {/* Day / Month view toggle */}
                    <div role="radiogroup" aria-label="View" className="inline-flex gap-0.5 rounded-lg bg-secondary p-0.5 ring-1 ring-secondary ring-inset">
                        {([["day", "Day", List], ["month", "Month", Calendar]] as const).map(([v, label, Icon]) => (
                            <button
                                key={v}
                                type="button"
                                role="radio"
                                aria-checked={view === v}
                                onClick={() => setView(v)}
                                className={cx(
                                    "flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition duration-100 ease-linear outline-focus-ring focus-visible:outline-2 focus-visible:outline-offset-2",
                                    view === v ? "bg-primary text-primary shadow-xs ring-1 ring-secondary ring-inset" : "text-tertiary hover:text-secondary",
                                )}
                            >
                                <Icon className="size-4" aria-hidden="true" />
                                {label}
                            </button>
                        ))}
                    </div>
                    <Button size="sm" color="secondary" iconLeading={Apple} onClick={() => setDbOpen(true)}>Food DB</Button>
                </div>
            </div>

            {view === "month" ? (
                <MonthGrid month={month} goalCalories={goal.calories} unitSystem={unitSystem} onPick={(d) => { router.push(`/nutrition?date=${d}`); setView("day"); }} />
            ) : (
            <>
            {/* Daily targets + AI quick log side by side — a two-column workspace header. */}
            <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
            {/* Unified goals banner — totals vs the single NutritionGoal/UserProfile source */}
            <Card>
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-md font-semibold text-primary">Daily targets</h3>
                    <div className="flex items-center gap-2">
                        <Button size="sm" color="secondary" iconLeading={Edit01} onClick={() => setGoalOpen(true)}>Quick adjust</Button>
                        <Button size="sm" color="primary" iconLeading={Target04} href="/health/goals">Set goals</Button>
                    </div>
                </div>
                {goalFromCalculator ? (
                    <p className="mb-4 text-xs text-tertiary">
                        Calculated from your health goals.{" "}
                        <Button size="sm" color="link-color" href="/health/goals" className="text-xs">Recalculate</Button>
                    </p>
                ) : (
                    <p className="mb-4 text-xs text-tertiary">No calculated plan yet — use Set goals to derive targets from your profile.</p>
                )}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {([
                        ["Calories", totals.calories, goal.calories, "kcal", "calories"],
                        ["Protein", totals.proteinG, goal.proteinG, "g", "protein"],
                        ["Carbs", totals.carbsG, goal.carbsG, "g", "carbs"],
                        ["Fat", totals.fatG, goal.fatG, "g", "fat"],
                        ["Fiber", totals.fiberG, goal.fiberG, "g", "fiber"],
                        ["Water", volumeToDisplay(water, unitSystem), volumeToDisplay(waterGoalMl, unitSystem), volumeUnit(unitSystem) as "fl oz" | "ml", "water"],
                    ] as const).map(([label, val, target, unit, macroKey]) => {
                        const over = target != null && target > 0 && val > target;
                        const macro = MACRO_COLORS[macroKey as MacroKey];
                        const dVsY = deltaVsYesterday(macroKey);
                        return (
                            <div
                                key={label}
                                className="flex flex-col gap-1.5 rounded-lg bg-secondary_subtle p-2.5 ring-1 ring-secondary ring-inset"
                            >
                                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                                    <span className="flex items-center gap-1.5 text-sm font-medium text-secondary">
                                        <span className={cx("size-2 shrink-0 rounded-full", macro.dot)} aria-hidden="true" />
                                        {label}
                                    </span>
                                    <MacroStat size="xs" value={val} goal={target} unit={unit} />
                                </div>
                                {/* Over-target keeps the amber warning fill; otherwise use the macro accent. */}
                                <ProgressBar
                                    value={val}
                                    max={target ?? val ?? 1}
                                    color={over ? "warning" : "brand"}
                                    fillClassName={over ? undefined : macro.bar}
                                />
                                {dVsY != null && (
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[10px] tracking-wide text-quaternary uppercase">vs yest.</span>
                                        <DeltaBadge delta={dVsY} unit={unit as string} precision={0} tone="neutral" hideWhenEven />
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </Card>

            <div id="nutrition-quick-log" className="scroll-mt-24">
                <Card>
                    <QuickLogAi
                        chatTarget={chatTarget}
                        onChatTargetChange={setChatTarget}
                        chatText={chatText}
                        onChatTextChange={setChatText}
                        chatBusy={chatBusy}
                        aiConfigured={aiConfigured}
                        aiTooltip={aiTooltip}
                        unitSystem={unitSystem}
                        onSubmit={() => void runChatAnalyze()}
                    />
                </Card>
            </div>
            </div>

            <NutritionFactsCard meals={meals} />

            {/* Water tracker */}
            <Card>
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <Droplets01 className={cx("size-5", MACRO_COLORS.water.text)} aria-hidden="true" />
                        <h3 className="text-md font-semibold text-primary">Water</h3>
                        <MacroStat value={volumeToDisplay(water, unitSystem)} goal={volumeToDisplay(waterGoalMl, unitSystem)} unit={waterUnitLabel as "fl oz" | "ml"} />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {/* Quick-adds adapt to the unit system (oz vs ml); stored as ml. */}
                        {waterQuickAdds(unitSystem).map((qa) => (
                            <form key={qa.label} action={(fd) => wrap(() => addWater(fd), qa.label)}>
                                <input type="hidden" name="date" value={date} />
                                <input type="hidden" name="amountMl" value={qa.ml} />
                                <Button size="sm" color="secondary" type="submit" iconLeading={Plus}>
                                    {qa.label.replace("+", "")}
                                </Button>
                            </form>
                        ))}
                        <div className="flex items-center gap-1.5">
                            <NativeInput
                                aria-label={`Custom amount (${waterUnitLabel})`}
                                type="number"
                                step="any"
                                min={0}
                                placeholder={waterUnitLabel}
                                value={customWater}
                                onChange={(e) => setCustomWater(e.target.value)}
                                className="w-24"
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        e.preventDefault();
                                        void addCustomWater();
                                    }
                                }}
                            />
                            <Button size="sm" color="secondary" onClick={addCustomWater} isDisabled={!customWater.trim()}>Add</Button>
                        </div>
                        <form action={(fd) => wrap(() => setWater(fd), "Water reset")}>
                            <input type="hidden" name="date" value={date} />
                            <input type="hidden" name="amountMl" value={0} />
                            <Button size="sm" color="tertiary" type="submit">Reset</Button>
                        </form>
                    </div>
                </div>
                <div className="mt-4 flex items-center gap-3">
                    <div className="flex-1">
                        <ProgressBar value={water} max={waterGoalMl} color="brand" fillClassName={MACRO_COLORS.water.bar} />
                    </div>
                    <span className="shrink-0 text-xs font-medium text-tertiary tabular-nums">
                        {waterGoalMl > 0 ? Math.min(100, Math.round((water / waterGoalMl) * 100)) : 0}%
                    </span>
                </div>
            </Card>

            {/* Favorites quick add */}
            {favorites.length > 0 && (
                <Card>
                    <h3 className="mb-3 text-md font-semibold text-primary">Favorites</h3>
                    <div className="flex flex-wrap gap-2">
                        {favorites.map((f) => (
                            <form
                                key={f.id}
                                action={(fd) => {
                                    fd.set("description", f.description);
                                    if (f.calories != null) fd.set("calories", String(f.calories));
                                    if (f.proteinG != null) fd.set("proteinG", String(f.proteinG));
                                    if (f.carbsG != null) fd.set("carbsG", String(f.carbsG));
                                    if (f.fatG != null) fd.set("fatG", String(f.fatG));
                                    return wrap(() => addFoodEntry(fd), "Added");
                                }}
                            >
                                <input type="hidden" name="date" value={date} />
                                <input type="hidden" name="mealType" value="SNACK" />
                                <Button size="sm" color="secondary" type="submit" iconLeading={Star01}>
                                    {f.description}
                                </Button>
                            </form>
                        ))}
                    </div>
                </Card>
            )}

            {/* Meals */}
            {MEAL_TYPES.map((mt) => {
                const entries = mealEntries(mt);
                const MealIcon = MEAL_ICON[mt];
                const meal = MEAL_COLORS[mt];
                return (
                    <Card key={mt} className="overflow-hidden p-0">
                        {/* Header: meal accent + icon + name + subtotal stat | add actions */}
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-secondary px-5 py-3.5">
                            <div className="flex min-w-0 items-center gap-2.5">
                                {/* Thin meal-color accent rail. */}
                                <span className={cx("h-5 w-1 shrink-0 rounded-full", meal.bar)} aria-hidden="true" />
                                <MealIcon className={cx("size-5 shrink-0", meal.icon)} aria-hidden="true" />
                                <h3 className="text-md font-semibold text-primary">{MEAL_LABEL[mt]}</h3>
                                {entries.length > 0 && (
                                    <div className="flex items-center gap-1.5">
                                        <MacroStat value={sum(entries, "calories")} unit="kcal" />
                                        <span className="hidden items-center gap-1 md:flex">
                                            <MacroChip label="P" value={sum(entries, "proteinG")} unit="g" />
                                            <MacroChip label="C" value={sum(entries, "carbsG")} unit="g" />
                                            <MacroChip label="F" value={sum(entries, "fatG")} unit="g" />
                                        </span>
                                    </div>
                                )}
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                                {entries.length > 0 && (
                                    <form action={(fd) => wrap(() => saveMealAsTemplate(fd), "Saved as template")}>
                                        <input type="hidden" name="date" value={date} />
                                        <input type="hidden" name="mealType" value={mt} />
                                        <input type="hidden" name="name" value={`${MEAL_LABEL[mt]} template`} />
                                        <Button size="sm" color="tertiary" type="submit" iconLeading={BookmarkAdd} aria-label="Save as template" />
                                    </form>
                                )}
                                <AiActionButton
                                    configured={aiConfigured}
                                    tooltip={aiTooltip}
                                    icon={MagicWand01}
                                    label="Describe food with AI"
                                    onClick={() => setTextOpen(mt)}
                                />
                                <AiActionButton
                                    configured={aiConfigured}
                                    tooltip={aiTooltip}
                                    icon={Camera01}
                                    label="Analyze food photo with AI"
                                    onClick={() => setPhotoOpen(mt)}
                                />
                                <Button size="sm" color="secondary" iconLeading={Plus} onClick={() => setAddOpen(mt)}>Add</Button>
                            </div>
                        </div>
                        {/* Body: entry rows — description | macro chips | hover-revealed actions */}
                        <div className="flex flex-col gap-0.5 p-2">
                            {entries.length === 0 && <p className="px-3 py-5 text-center text-sm text-tertiary">Nothing logged</p>}
                            {entries.map((e) => (
                                <div
                                    key={e.id}
                                    className="group/entry flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg px-3 py-2 transition duration-100 ease-linear hover:bg-secondary_subtle"
                                >
                                    {e.imageUrl && (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={e.imageUrl} alt={e.description} className="size-10 shrink-0 rounded-md object-cover ring-1 ring-secondary ring-inset" />
                                    )}
                                    <div className="min-w-0 flex-1 basis-48">
                                        <p className="flex items-center gap-1.5 text-sm font-medium text-primary">
                                            <span className="truncate">{e.description}</span>
                                            {e.aiAnalyzed && (
                                                <Tooltip title="Estimated by AI">
                                                    <TooltipTrigger className="shrink-0">
                                                        <Stars01 className="size-3.5 text-fg-brand-primary" aria-label="AI estimated" />
                                                    </TooltipTrigger>
                                                </Tooltip>
                                            )}
                                        </p>
                                        {(e.quantity != null || e.servingSize) && (
                                            <p className="truncate text-xs text-tertiary">
                                                {e.quantity != null ? `${e.quantity}${e.unit ? ` ${e.unit}` : ""}` : e.servingSize}
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                                        <MacroChip value={e.calories} unit="kcal" />
                                        <MacroChip label="P" value={e.proteinG} unit="g" />
                                        <MacroChip label="C" value={e.carbsG} unit="g" />
                                        <MacroChip label="F" value={e.fatG} unit="g" />
                                    </div>
                                    {/* Actions stay in flow (no layout shift) and fade in on hover/focus; always visible on touch layouts. */}
                                    <div className="flex shrink-0 items-center gap-0.5 opacity-100 transition duration-100 ease-linear sm:opacity-0 sm:group-focus-within/entry:opacity-100 sm:group-hover/entry:opacity-100">
                                        {e.aiAnalyzed && (
                                            <Button size="sm" color="tertiary" iconLeading={InfoCircle} onClick={() => setInfoEntry(e)} aria-label="AI details" />
                                        )}
                                        <Tooltip title="Save to food DB">
                                            <TooltipTrigger>
                                                <Button size="sm" color="tertiary" iconLeading={Database01} onClick={() => saveAsProduct(e.id)} aria-label="Save to food DB" />
                                            </TooltipTrigger>
                                        </Tooltip>
                                        <form action={(fd) => wrap(() => toggleFavoriteEntry(fd), e.isFavorite ? "Unfavorited" : "Favorited")}>
                                            <input type="hidden" name="id" value={e.id} />
                                            <Button size="sm" color="tertiary" type="submit" iconLeading={Star01} aria-label="Favorite" className={e.isFavorite ? "text-warning-primary" : ""} />
                                        </form>
                                        <Button size="sm" color="tertiary" iconLeading={Edit01} onClick={() => setEditEntry(e)} aria-label="Edit" />
                                        <form action={(fd) => wrap(() => deleteFoodEntry(fd), "Deleted")}>
                                            <input type="hidden" name="id" value={e.id} />
                                            <Button size="sm" color="tertiary-destructive" type="submit" iconLeading={Trash02} aria-label="Delete" />
                                        </form>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </Card>
                );
            })}

            {/* Saved meals */}
            <Card>
                <SectionHeader title="Saved meals" description="Apply a saved meal template to today." />
                <div className="mt-3 flex flex-col gap-2">
                    {savedMeals.length === 0 && <p className="text-sm text-tertiary">No saved meals yet. Use the bookmark icon on a meal to save it.</p>}
                    {savedMeals.map((sm) => (
                        <div key={sm.id} className="flex items-center justify-between gap-3 rounded-lg p-2.5 ring-1 ring-secondary ring-inset">
                            <div>
                                <p className="text-sm font-medium text-primary">{sm.name}</p>
                                <p className="text-xs text-tertiary">{sm.itemCount} items{sm.mealType ? ` · ${MEAL_LABEL[sm.mealType]}` : ""}</p>
                            </div>
                            <div className="flex gap-1">
                                <form action={(fd) => wrap(() => applySavedMeal(fd), "Applied")}>
                                    <input type="hidden" name="savedMealId" value={sm.id} />
                                    <input type="hidden" name="date" value={date} />
                                    <input type="hidden" name="mealType" value={sm.mealType ?? "SNACK"} />
                                    <Button size="sm" color="secondary" type="submit" iconLeading={Plus}>Apply</Button>
                                </form>
                                <form action={(fd) => wrap(() => deleteSavedMeal(fd), "Deleted")}>
                                    <input type="hidden" name="id" value={sm.id} />
                                    <Button size="sm" color="tertiary-destructive" type="submit" iconLeading={Trash02} aria-label="Delete" />
                                </form>
                            </div>
                        </div>
                    ))}
                </div>
            </Card>
            </>
            )}

            {/* Add / edit food entry modal */}
            <FormModal isOpen={!!addOpen || !!editEntry} onOpenChange={(o) => { if (!o) { setAddOpen(null); setEditEntry(null); } }} title={editEntry ? "Edit food" : `Add to ${addOpen ? MEAL_LABEL[addOpen] : ""}`}>
                <form
                    action={(fd) => wrap(() => (editEntry ? updateFoodEntry(fd) : addFoodEntry(fd)), editEntry ? "Updated" : "Added", () => { setAddOpen(null); setEditEntry(null); })}
                    className="flex flex-col gap-4"
                >
                    {editEntry && <input type="hidden" name="id" value={editEntry.id} />}
                    {!editEntry && <input type="hidden" name="date" value={date} />}
                    {!editEntry && <input type="hidden" name="mealType" value={addOpen ?? "SNACK"} />}

                    {!editEntry && products.length > 0 && (
                        <Field label="From food product (optional)" htmlFor="productPick">
                            <NativeSelect
                                id="productPick"
                                defaultValue=""
                                onChange={(e) => {
                                    const p = products.find((x) => x.id === e.target.value);
                                    if (!p) return;
                                    const form = e.target.form!;
                                    (form.elements.namedItem("description") as HTMLInputElement).value = p.name;
                                    (form.elements.namedItem("productId") as HTMLInputElement).value = p.id;
                                    (form.elements.namedItem("calories") as HTMLInputElement).value = p.calories?.toString() ?? "";
                                    (form.elements.namedItem("proteinG") as HTMLInputElement).value = p.proteinG?.toString() ?? "";
                                    (form.elements.namedItem("carbsG") as HTMLInputElement).value = p.carbsG?.toString() ?? "";
                                    (form.elements.namedItem("fatG") as HTMLInputElement).value = p.fatG?.toString() ?? "";
                                }}
                            >
                                <option value="">—</option>
                                {products.map((p) => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </NativeSelect>
                        </Field>
                    )}
                    <input type="hidden" name="productId" defaultValue="" />

                    <Field label="Description" htmlFor="description">
                        <NativeInput id="description" name="description" required defaultValue={editEntry?.description ?? ""} />
                    </Field>
                    <div className="grid grid-cols-3 gap-3">
                        <Field label="Serving" htmlFor="servingSize">
                            <NativeInput id="servingSize" name="servingSize" defaultValue={editEntry?.servingSize ?? ""} />
                        </Field>
                        <Field label="Qty" htmlFor="quantity">
                            <NativeInput id="quantity" name="quantity" type="number" step="any" defaultValue={editEntry?.quantity ?? ""} />
                        </Field>
                        <Field label="Unit" htmlFor="unit">
                            <NativeInput id="unit" name="unit" defaultValue={editEntry?.unit ?? ""} />
                        </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Calories" htmlFor="calories"><NativeInput id="calories" name="calories" type="number" step="any" defaultValue={editEntry?.calories ?? ""} /></Field>
                        <Field label="Protein (g)" htmlFor="proteinG"><NativeInput id="proteinG" name="proteinG" type="number" step="any" defaultValue={editEntry?.proteinG ?? ""} /></Field>
                        <Field label="Carbs (g)" htmlFor="carbsG"><NativeInput id="carbsG" name="carbsG" type="number" step="any" defaultValue={editEntry?.carbsG ?? ""} /></Field>
                        <Field label="Fat (g)" htmlFor="fatG"><NativeInput id="fatG" name="fatG" type="number" step="any" defaultValue={editEntry?.fatG ?? ""} /></Field>
                        <Field label="Fiber (g)" htmlFor="fiberG"><NativeInput id="fiberG" name="fiberG" type="number" step="any" defaultValue={editEntry?.fiberG ?? ""} /></Field>
                        <Field label="Sugar (g)" htmlFor="sugarG"><NativeInput id="sugarG" name="sugarG" type="number" step="any" defaultValue={editEntry?.sugarG ?? ""} /></Field>
                        <Field label="Sodium (mg)" htmlFor="sodiumMg"><NativeInput id="sodiumMg" name="sodiumMg" type="number" step="any" defaultValue={editEntry?.sodiumMg ?? ""} /></Field>
                        <Field label="Cholesterol (mg)" htmlFor="cholesterolMg"><NativeInput id="cholesterolMg" name="cholesterolMg" type="number" step="any" defaultValue={editEntry?.cholesterolMg ?? ""} /></Field>
                        <Field label="Sat fat (g)" htmlFor="saturatedFatG"><NativeInput id="saturatedFatG" name="saturatedFatG" type="number" step="any" defaultValue={editEntry?.saturatedFatG ?? ""} /></Field>
                        <Field label="Trans fat (g)" htmlFor="transFatG"><NativeInput id="transFatG" name="transFatG" type="number" step="any" defaultValue={editEntry?.transFatG ?? ""} /></Field>
                        <Field label="Potassium (mg)" htmlFor="potassiumMg"><NativeInput id="potassiumMg" name="potassiumMg" type="number" step="any" defaultValue={editEntry?.potassiumMg ?? ""} /></Field>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => { setAddOpen(null); setEditEntry(null); }}>Cancel</Button>
                        <Button type="submit">{editEntry ? "Save" : "Add"}</Button>
                    </div>
                </form>
            </FormModal>

            {/* Quick adjust goals — writes the SAME NutritionGoal + UserProfile.waterGoalMl
                rows the /health/goals calculator writes, so there is no forked goal state. */}
            <FormModal
                isOpen={goalOpen}
                onOpenChange={setGoalOpen}
                title="Quick adjust goals"
                description="Direct overrides of your unified targets — shared with Health → Goals. Use Set goals to recalculate from your profile."
            >
                <form
                    action={(fd) => {
                        // Water is entered in the display unit; persist as ml.
                        const disp = fd.get("waterGoalDisplay");
                        fd.delete("waterGoalDisplay");
                        if (typeof disp === "string" && disp.trim()) {
                            const n = Number(disp);
                            if (Number.isFinite(n) && n > 0) {
                                fd.set("waterGoalMl", String(Math.round(unitSystem === "IMPERIAL" ? ozToMl(n) : n)));
                            }
                        }
                        return wrap(() => saveNutritionGoal(fd), "Goals updated", () => setGoalOpen(false));
                    }}
                    className="flex flex-col gap-4"
                >
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Calories (kcal)" htmlFor="g_calories"><NativeInput id="g_calories" name="calories" type="number" step="any" defaultValue={goal.calories ?? ""} /></Field>
                        <Field label="Protein (g)" htmlFor="g_proteinG"><NativeInput id="g_proteinG" name="proteinG" type="number" step="any" defaultValue={goal.proteinG ?? ""} /></Field>
                        <Field label="Carbs (g)" htmlFor="g_carbsG"><NativeInput id="g_carbsG" name="carbsG" type="number" step="any" defaultValue={goal.carbsG ?? ""} /></Field>
                        <Field label="Fat (g)" htmlFor="g_fatG"><NativeInput id="g_fatG" name="fatG" type="number" step="any" defaultValue={goal.fatG ?? ""} /></Field>
                        <Field label="Fiber (g)" htmlFor="g_fiberG"><NativeInput id="g_fiberG" name="fiberG" type="number" step="any" defaultValue={goal.fiberG ?? ""} /></Field>
                        <Field label={`Water (${waterUnitLabel})`} htmlFor="g_water">
                            <NativeInput id="g_water" name="waterGoalDisplay" type="number" step="any" min={0} defaultValue={volumeToDisplay(waterGoalMl, unitSystem)} />
                        </Field>
                    </div>
                    {goalFromCalculator && (
                        <p className="text-xs text-tertiary">
                            These values were calculated from your health goals — saving here overrides them until you{" "}
                            <Button size="sm" color="link-color" href="/health/goals" className="text-xs">recalculate</Button>.
                        </p>
                    )}
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setGoalOpen(false)}>Cancel</Button>
                        <Button type="submit" iconLeading={Save01}>Save</Button>
                    </div>
                </form>
            </FormModal>

            {/* Food DB modal */}
            <FormModal isOpen={dbOpen} onOpenChange={setDbOpen} title="Food products">
                <div className="flex flex-col gap-4">
                    <Button size="sm" iconLeading={Plus} className="self-start" onClick={() => { setEditProduct(null); setProductOpen(true); }}>
                        Add product
                    </Button>
                    <div className="flex flex-col gap-2">
                        {products.length === 0 && <p className="text-sm text-tertiary">No products yet.</p>}
                        {products.map((p) => (
                            <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg p-2.5 ring-1 ring-secondary ring-inset">
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-medium text-primary">{p.name}</p>
                                    <div className="mt-0.5 flex flex-wrap items-center gap-1">
                                        <MacroChip value={p.calories} unit="kcal" />
                                        <MacroChip label="P" value={p.proteinG} unit="g" />
                                        <MacroChip label="C" value={p.carbsG} unit="g" />
                                        <MacroChip label="F" value={p.fatG} unit="g" />
                                    </div>
                                </div>
                                <div className="flex gap-1">
                                    <Button size="sm" color="tertiary" iconLeading={Edit01} onClick={() => { setEditProduct(p); setProductOpen(true); }} aria-label="Edit" />
                                    <form action={(fd) => wrap(() => deleteFoodProduct(fd), "Deleted")}>
                                        <input type="hidden" name="id" value={p.id} />
                                        <Button size="sm" color="tertiary-destructive" type="submit" iconLeading={Trash02} aria-label="Delete" />
                                    </form>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </FormModal>

            {/* Product edit modal */}
            <FormModal isOpen={productOpen} onOpenChange={setProductOpen} title={editProduct ? "Edit product" : "Add product"}>
                <form action={(fd) => wrap(() => upsertFoodProduct(fd), "Saved", () => setProductOpen(false))} className="flex flex-col gap-4">
                    {editProduct && <input type="hidden" name="id" value={editProduct.id} />}
                    <Field label="Name" htmlFor="pr_name"><NativeInput id="pr_name" name="name" required defaultValue={editProduct?.name ?? ""} /></Field>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Quantity" htmlFor="pr_quantity"><NativeInput id="pr_quantity" name="quantity" type="number" step="any" defaultValue={editProduct?.quantity ?? ""} /></Field>
                        <Field label="Unit" htmlFor="pr_unit"><NativeInput id="pr_unit" name="unit" defaultValue={editProduct?.unit ?? ""} /></Field>
                        <Field label="Calories" htmlFor="pr_calories"><NativeInput id="pr_calories" name="calories" type="number" step="any" defaultValue={editProduct?.calories ?? ""} /></Field>
                        <Field label="Protein (g)" htmlFor="pr_proteinG"><NativeInput id="pr_proteinG" name="proteinG" type="number" step="any" defaultValue={editProduct?.proteinG ?? ""} /></Field>
                        <Field label="Carbs (g)" htmlFor="pr_carbsG"><NativeInput id="pr_carbsG" name="carbsG" type="number" step="any" defaultValue={editProduct?.carbsG ?? ""} /></Field>
                        <Field label="Fat (g)" htmlFor="pr_fatG"><NativeInput id="pr_fatG" name="fatG" type="number" step="any" defaultValue={editProduct?.fatG ?? ""} /></Field>
                    </div>
                    <Field label="Barcode" htmlFor="pr_barcode"><NativeInput id="pr_barcode" name="barcode" defaultValue={editProduct?.barcode ?? ""} /></Field>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setProductOpen(false)}>Cancel</Button>
                        <Button type="submit">Save</Button>
                    </div>
                </form>
            </FormModal>

            {/* AI: describe food */}
            <FormModal
                isOpen={!!textOpen}
                onOpenChange={(o) => { if (!o) setTextOpen(null); }}
                title="Describe food with AI"
                description={`Estimate nutrition for ${textOpen ? MEAL_LABEL[textOpen] : ""} from a free-text description.`}
            >
                <form action={runTextAnalyze} className="flex flex-col gap-4">
                    <Field label="What did you eat?" htmlFor="ai_description" hint="e.g. “2 scrambled eggs, a slice of sourdough toast with butter, and a banana”">
                        <NativeTextarea id="ai_description" name="description" rows={4} required placeholder="Describe your meal in plain language…" />
                    </Field>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setTextOpen(null)}>Cancel</Button>
                        <Button type="submit" iconLeading={Stars01} isLoading={analyzing} showTextWhileLoading>Analyze</Button>
                    </div>
                </form>
            </FormModal>

            {/* AI: food photo */}
            <FormModal
                isOpen={!!photoOpen}
                onOpenChange={(o) => { if (!o) setPhotoOpen(null); }}
                title="Analyze food photo with AI"
                description={`Estimate nutrition for ${photoOpen ? MEAL_LABEL[photoOpen] : ""} from a photo.`}
            >
                <form action={runPhotoAnalyze} className="flex flex-col gap-4">
                    <Field label="Food photo" htmlFor="ai_photo" hint="AVIF, GIF, JPEG, PNG or WebP, up to 25 MB.">
                        <NativeInput id="ai_photo" name="photo" type="file" accept={SAFE_FOOD_PHOTO_ACCEPT} required />
                    </Field>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setPhotoOpen(null)}>Cancel</Button>
                        <Button type="submit" iconLeading={Camera01} isLoading={analyzing} showTextWhileLoading>Analyze</Button>
                    </div>
                </form>
            </FormModal>

            {/* AI: confirm analyzed items */}
            <FormModal
                isOpen={!!confirm}
                onOpenChange={(o) => { if (!o && !savingConfirm) clearConfirm(); }}
                title="Review AI estimate"
                description={confirm ? (confirm.mode === "chat" ? "Adjust before logging. Each item can go to a different meal." : `Adjust the values before adding to ${MEAL_LABEL[confirm.mealType]}.`) : undefined}
            >
                {confirm && (
                    <div className="flex flex-col gap-4">
                        {confirm.imageUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={confirm.imageUrl} alt="Food" className="max-h-48 w-full rounded-lg object-cover ring-1 ring-secondary ring-inset" />
                        )}
                        {confirm.items.length === 0 && <p className="text-sm text-tertiary">No items left. Add some manually or cancel.</p>}
                        {confirm.items.map((it) => (
                            <div key={it._key} className="flex flex-col gap-3 rounded-lg p-3 ring-1 ring-secondary ring-inset">
                                <div className="flex items-start gap-2">
                                    <Field label="Description" htmlFor={`d_${it._key}`} className="flex-1">
                                        <NativeInput id={`d_${it._key}`} value={it.description} onChange={(e) => updateDraft(it._key, { description: e.target.value })} />
                                    </Field>
                                    <Button size="sm" color="tertiary-destructive" type="button" iconLeading={Trash02} aria-label="Remove item" className="mt-6" onClick={() => removeDraft(it._key)} />
                                </div>
                                {confirm.mode === "chat" && (
                                    <Field label="Meal" htmlFor={`m_${it._key}`}>
                                        <NativeSelect id={`m_${it._key}`} value={(it.mealType ?? confirm.mealType) as string} onChange={(e) => updateDraft(it._key, { mealType: e.target.value })}>
                                            {MEAL_TYPES.map((mt) => (
                                                <option key={mt} value={mt}>{MEAL_LABEL[mt]}</option>
                                            ))}
                                        </NativeSelect>
                                    </Field>
                                )}
                                <div className="grid grid-cols-3 gap-2">
                                    <Field label="Qty" htmlFor={`q_${it._key}`}>
                                        <NativeInput id={`q_${it._key}`} type="number" step="any" value={it.quantity ?? ""} onChange={(e) => updateDraft(it._key, { quantity: num(e.target.value) })} />
                                    </Field>
                                    <Field label="Unit" htmlFor={`u_${it._key}`}>
                                        <NativeInput id={`u_${it._key}`} value={it.unit ?? ""} onChange={(e) => updateDraft(it._key, { unit: e.target.value || null })} />
                                    </Field>
                                    <Field label="Calories" htmlFor={`c_${it._key}`}>
                                        <NativeInput id={`c_${it._key}`} type="number" step="any" value={it.calories ?? ""} onChange={(e) => updateDraft(it._key, { calories: num(e.target.value) })} />
                                    </Field>
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                    <Field label="Protein (g)" htmlFor={`p_${it._key}`}>
                                        <NativeInput id={`p_${it._key}`} type="number" step="any" value={it.proteinG ?? ""} onChange={(e) => updateDraft(it._key, { proteinG: num(e.target.value) })} />
                                    </Field>
                                    <Field label="Carbs (g)" htmlFor={`cb_${it._key}`}>
                                        <NativeInput id={`cb_${it._key}`} type="number" step="any" value={it.carbsG ?? ""} onChange={(e) => updateDraft(it._key, { carbsG: num(e.target.value) })} />
                                    </Field>
                                    <Field label="Fat (g)" htmlFor={`f_${it._key}`}>
                                        <NativeInput id={`f_${it._key}`} type="number" step="any" value={it.fatG ?? ""} onChange={(e) => updateDraft(it._key, { fatG: num(e.target.value) })} />
                                    </Field>
                                    <Field label="Fiber (g)" htmlFor={`fi_${it._key}`}>
                                        <NativeInput id={`fi_${it._key}`} type="number" step="any" value={it.fiberG ?? ""} onChange={(e) => updateDraft(it._key, { fiberG: num(e.target.value) })} />
                                    </Field>
                                    <Field label="Sugar (g)" htmlFor={`sg_${it._key}`}>
                                        <NativeInput id={`sg_${it._key}`} type="number" step="any" value={it.sugarG ?? ""} onChange={(e) => updateDraft(it._key, { sugarG: num(e.target.value) })} />
                                    </Field>
                                    <Field label="Sodium (mg)" htmlFor={`so_${it._key}`}>
                                        <NativeInput id={`so_${it._key}`} type="number" step="any" value={it.sodiumMg ?? ""} onChange={(e) => updateDraft(it._key, { sodiumMg: num(e.target.value) })} />
                                    </Field>
                                </div>
                            </div>
                        ))}
                        {confirm.mode === "chat" && (
                            <div className="flex items-center gap-3 rounded-lg p-3 ring-1 ring-secondary ring-inset">
                                <Droplets01 className="size-5 shrink-0 text-fg-quaternary" aria-hidden="true" />
                                <Field label={`Water (${volumeUnit(unitSystem)})`} htmlFor="confirm_water" className="flex-1">
                                    <NativeInput
                                        id="confirm_water"
                                        type="number"
                                        step="any"
                                        value={confirm.waterMl != null ? volumeToDisplay(confirm.waterMl, unitSystem) : ""}
                                        onChange={(e) => {
                                            const disp = num(e.target.value);
                                            // Store metric (ml): display value → ml.
                                            const ml = disp == null ? null : Math.round(unitSystem === "IMPERIAL" ? ozToMl(disp) : disp);
                                            setConfirm((c) => (c ? { ...c, waterMl: ml } : c));
                                        }}
                                    />
                                </Field>
                            </div>
                        )}
                        <div className="flex items-start gap-2 rounded-lg bg-secondary_subtle p-3 text-xs text-tertiary">
                            <Stars01 className="size-4 shrink-0 text-fg-brand-primary" aria-hidden="true" />
                            <span>These are AI estimates — review and adjust before saving. Saved items are tagged as AI-analyzed.</span>
                        </div>
                        <div className="flex justify-end gap-2 pt-1">
                            <Button color="secondary" type="button" onClick={clearConfirm} isDisabled={savingConfirm}>Cancel</Button>
                            <Button type="button" iconLeading={Plus} onClick={saveConfirm} isLoading={savingConfirm} showTextWhileLoading isDisabled={confirm.items.length === 0 && (confirm.mode !== "chat" || !confirm.waterMl)}>
                                {confirm.mode === "chat" ? "Log" : `Add ${confirm.items.length} item${confirm.items.length === 1 ? "" : "s"}`}
                            </Button>
                        </div>
                    </div>
                )}
            </FormModal>

            {/* AI entry detail popover */}
            <FormModal isOpen={!!infoEntry} onOpenChange={(o) => { if (!o) setInfoEntry(null); }} title="AI entry details" description="What the AI saw and what it parsed.">
                {infoEntry && (
                    <div className="flex flex-col gap-4">
                        {infoEntry.imageUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={infoEntry.imageUrl} alt={infoEntry.description} className="max-h-48 w-full rounded-lg object-cover ring-1 ring-secondary ring-inset" />
                        )}
                        {infoEntry.aiPrompt && (
                            <div className="flex flex-col gap-1">
                                <p className="text-sm font-medium text-secondary">Your description</p>
                                <p className="rounded-lg bg-secondary_subtle p-3 text-sm text-tertiary italic">“{infoEntry.aiPrompt}”</p>
                            </div>
                        )}
                        <div className="flex flex-col gap-1">
                            <p className="text-sm font-medium text-secondary">Parsed values</p>
                            <div className="grid grid-cols-2 gap-2 rounded-lg p-3 text-sm ring-1 ring-secondary ring-inset">
                                <span className="text-tertiary">Item</span><span className="text-primary">{infoEntry.description}</span>
                                {infoEntry.quantity != null && (<><span className="text-tertiary">Quantity</span><span className="text-primary">{infoEntry.quantity}{infoEntry.unit ? ` ${infoEntry.unit}` : ""}</span></>)}
                                <span className="text-tertiary">Calories</span><MacroStat value={infoEntry.calories} unit="kcal" />
                                <span className="text-tertiary">Protein</span><MacroStat value={infoEntry.proteinG} unit="g" />
                                <span className="text-tertiary">Carbs</span><MacroStat value={infoEntry.carbsG} unit="g" />
                                <span className="text-tertiary">Fat</span><MacroStat value={infoEntry.fatG} unit="g" />
                            </div>
                        </div>
                        <div className="flex items-start gap-2 rounded-lg bg-secondary_subtle p-3 text-xs text-tertiary">
                            <Stars01 className="size-4 shrink-0 text-fg-brand-primary" aria-hidden="true" />
                            <span>Estimated by AI. Use Edit to adjust, or Save to food DB to reuse it.</span>
                        </div>
                        <div className="flex justify-end gap-2 pt-1">
                            <Button color="secondary" type="button" onClick={() => saveAsProduct(infoEntry.id)} iconLeading={Database01}>Save to food DB</Button>
                            <Button type="button" iconLeading={Edit01} onClick={() => { setEditEntry(infoEntry); setInfoEntry(null); }}>Edit</Button>
                        </div>
                    </div>
                )}
            </FormModal>
        </div>
    );
}

/** Calendar-grid month view: each day cell shows calories + a bar coloured vs goal. */
function MonthGrid({
    month,
    goalCalories,
    unitSystem,
    onPick,
}: {
    month: { year: number; month: number; days: DaySummary[] };
    goalCalories: number | null;
    unitSystem: UnitSystem;
    onPick: (date: string) => void;
}) {
    const byDate = new Map(month.days.map((d) => [d.date, d]));
    const firstDow = new Date(Date.UTC(month.year, month.month, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(month.year, month.month + 1, 0)).getUTCDate();
    const todayKey = new Date().toISOString().slice(0, 10);

    const cells: ({ day: number; key: string } | null)[] = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
        const key = `${month.year}-${String(month.month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        cells.push({ day: d, key });
    }

    function color(cals: number): "success" | "warning" | "error" | "brand" {
        if (!goalCalories) return "brand";
        const ratio = cals / goalCalories;
        if (ratio > 1.1) return "error";
        if (ratio > 0.9) return "warning"; // near/at goal
        return "success"; // comfortably under
    }

    return (
        <Card>
            <div className="grid grid-cols-7 gap-1.5">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                    <div key={d} className="pb-1 text-center text-xs font-medium text-tertiary">{d}</div>
                ))}
                {cells.map((cell, i) => {
                    if (!cell) return <div key={`e${i}`} />;
                    const summary = byDate.get(cell.key);
                    const cals = summary?.calories ?? 0;
                    const isToday = cell.key === todayKey;
                    return (
                        <button
                            key={cell.key}
                            type="button"
                            onClick={() => onPick(cell.key)}
                            aria-label={`${formatDate(cell.key + "T00:00:00")}${summary ? `, ${formatMacroValue(cals, "kcal")} kcal` : ", no log"}`}
                            className={cx(
                                "flex aspect-square cursor-pointer flex-col justify-between overflow-hidden rounded-lg p-1.5 text-left ring-1 ring-inset transition duration-100 ease-linear outline-focus-ring hover:bg-secondary_hover focus-visible:outline-2 focus-visible:outline-offset-2",
                                isToday ? "bg-brand-primary_alt ring-2 ring-brand" : "ring-secondary",
                            )}
                        >
                            <span
                                className={cx(
                                    "text-xs font-medium",
                                    isToday
                                        ? "flex size-5 items-center justify-center rounded-full bg-brand-solid text-white"
                                        : "text-secondary",
                                )}
                            >
                                {cell.day}
                            </span>
                            {summary ? (
                                <div className="flex min-w-0 flex-col gap-1">
                                    <MacroStat size="xs" value={cals} unit="kcal" className="min-w-0 truncate" />
                                    <ProgressBar value={cals} max={goalCalories ?? cals ?? 1} color={color(cals)} />
                                </div>
                            ) : (
                                <span className="text-xs text-quaternary">—</span>
                            )}
                        </button>
                    );
                })}
            </div>
            {goalCalories ? (
                <p className="mt-3 text-xs text-tertiary">
                    Bar colour vs your {formatMacroValue(goalCalories, "kcal")} kcal goal: green = under, amber = near, red = over.
                </p>
            ) : (
                <p className="mt-3 text-xs text-tertiary">Set a calorie goal to colour days by how you tracked. Volume shown in {unitSystem === "IMPERIAL" ? "fluid ounces" : "millilitres"} elsewhere.</p>
            )}
        </Card>
    );
}

function AiActionButton({
    configured,
    tooltip,
    icon,
    label,
    onClick,
}: {
    configured: boolean;
    tooltip: string;
    icon: typeof Stars01;
    label: string;
    onClick: () => void;
}) {
    if (configured) {
        return <Button size="sm" color="tertiary" iconLeading={icon} onClick={onClick} aria-label={label} />;
    }
    return (
        <Tooltip title={label} description={tooltip}>
            <TooltipTrigger>
                <Button size="sm" color="tertiary" iconLeading={icon} isDisabled aria-label={label} />
            </TooltipTrigger>
        </Tooltip>
    );
}
