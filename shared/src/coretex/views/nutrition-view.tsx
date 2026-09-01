import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity,
  BookmarkAdd,
  Camera01,
  CheckCircle,
  Droplets01,
  Edit01,
  Edit05,
  MagicWand01,
  Minus,
  Moon01,
  Plus,
  Save01,
  Scan,
  SearchLg,
  Settings01,
  Star01,
  Star06,
  Sun,
  Sunrise,
  Target04,
  Trash01,
  UploadCloud02,
} from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { RichSelect } from "@/components/base/select/rich-select";
import {
  formatVolume,
  formatWeight,
  parseVolumeInput,
  volumeToDisplay,
  volumeUnit,
  waterQuickAdds,
  type UnitSystem,
} from "@/lib/units";
import type { NavTarget } from "../nav";
import {
  EmptyMessage,
  PersonalCard,
  PersonalModuleShell,
  PersonalTable,
  ProgressMeter,
  QueryBoundary,
  StatGrid,
  formatDate,
  localDateKey,
  titleCase,
} from "./personal/personal-ui";
import {
  useLifeOSQuery,
  type LifeOSClient,
} from "./personal/use-lifeos-query";

const SAFE_FOOD_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

interface MacroTotals {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
}

interface MacroGoals {
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  updatedAt: string;
}

interface FoodEntry {
  id: string;
  productId?: string | null;
  description: string;
  imageKey: string | null;
  imageUrl: string | null;
  servingSize: string | null;
  quantity: number | null;
  unit: string | null;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  source: string;
  isFavorite: boolean;
}

interface NutritionData {
  date: string;
  navigation: {
    previousDate: string;
    nextDate: string;
    today: string;
    isToday: boolean;
  };
  notes: string | null;
  totals: MacroTotals;
  progress: {
    calories: number | null;
    proteinG: number | null;
    carbsG: number | null;
    fatG: number | null;
    fiberG: number | null;
  };
  meals: Array<{
    id: string;
    mealType: string;
    name: string | null;
    loggedAt: string | null;
    totals: MacroTotals;
    entries: FoodEntry[];
  }>;
  water: {
    amountMl: number;
    goalMl: number;
    progress: number;
    updatedAt: string | null;
  };
  goal: MacroGoals | null;
  goalProfile: {
    gender: string | null;
    birthdate: string | null;
    heightCm: number | null;
    activityLevel: string | null;
    dietGoal: string | null;
    goalWeightKg: number | null;
    targetWeeklyChangeKg: number | null;
    currentWeightKg: number | null;
    currentWeightDate: string | null;
  };
  products: Array<{
    id: string;
    name: string;
    quantity: number | null;
    unit: string | null;
    calories: number | null;
    proteinG: number | null;
    carbsG: number | null;
    fatG: number | null;
    fiberG: number | null;
    barcode: string | null;
    usageCount: number;
  }>;
  productSummary: { count: number; usedProducts: number; barcoded: number };
  savedMeals: Array<{
    id: string;
    name: string;
    mealType: string | null;
    itemCount: number;
    totals: MacroTotals;
    items: Array<{
      id: string;
      position?: number;
      productId?: string | null;
      description: string;
      source?: string;
      servingSize?: string | null;
      quantity?: number | null;
      unit?: string | null;
      calories?: number | null;
      proteinG?: number | null;
      carbsG?: number | null;
      fatG?: number | null;
      fiberG?: number | null;
    }>;
  }>;
  savedMealSummary: { count: number; items: number };
  favorites: Array<{
    id: string;
    productId?: string | null;
    description: string;
    servingSize: string | null;
    quantity: number | null;
    unit: string | null;
    calories: number | null;
    proteinG: number | null;
    carbsG: number | null;
    fatG: number | null;
    fiberG: number | null;
    source?: string;
  }>;
  favoriteSummary: { count: number };
  unitSystem: string;
  month: {
    year: number;
    month: number;
    loggedDays: number;
    averageCalories: number;
    totalProteinG: number;
    days: Array<{ date: string } & MacroTotals>;
  };
}

export interface NutritionViewProps {
  client: LifeOSClient;
  onNavigate: (
    target: NavTarget | ((previous: NavTarget) => NavTarget),
  ) => void;
  state?: unknown;
  actions?: unknown;
}

function rounded(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value)
    ? "—"
    : Math.round(value).toLocaleString();
}

function serving(entry: {
  servingSize: string | null;
  quantity: number | null;
  unit: string | null;
}): string {
  if (entry.servingSize) return entry.servingSize;
  if (entry.quantity != null)
    return `${entry.quantity}${entry.unit ? ` ${entry.unit}` : ""}`;
  return "Serving not specified";
}

const NUTRITION_FIELD_CLASS =
  "h-10 w-full rounded-lg border border-secondary bg-primary px-3 py-2 text-sm text-primary shadow-xs outline-none transition placeholder:text-placeholder focus:border-brand focus:ring-1 focus:ring-brand";
const NUTRITION_BUTTON_CLASS =
  "rounded-lg bg-brand-solid px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50";

const FOOD_UNIT_OPTIONS = [
  { value: "serving", label: "serving" },
  { value: "g", label: "g" },
  { value: "kg", label: "kg" },
  { value: "oz", label: "oz" },
  { value: "lb", label: "lb" },
  { value: "ml", label: "ml" },
  { value: "fl oz", label: "fl oz" },
  { value: "cup", label: "cup" },
  { value: "tbsp", label: "tbsp" },
  { value: "tsp", label: "tsp" },
  { value: "piece", label: "piece" },
  { value: "slice", label: "slice" },
  { value: "scoop", label: "scoop" },
  { value: "bowl", label: "bowl" },
  { value: "plate", label: "plate" },
  { value: "container", label: "container" },
  { value: "bottle", label: "bottle" },
] as const;

const MEAL_TYPES = ["BREAKFAST", "LUNCH", "DINNER", "SNACK"] as const;
type MealType = (typeof MEAL_TYPES)[number];

const MEAL_STYLE: Record<
  MealType,
  {
    label: string;
    icon: typeof Sunrise;
    rail: string;
    card: string;
    soft: string;
    text: string;
    ring: string;
  }
> = {
  BREAKFAST: {
    label: "Breakfast",
    icon: Sunrise,
    rail: "bg-utility-yellow-500",
    card: "border-utility-yellow-500/30",
    soft: "bg-utility-yellow-500/10",
    text: "text-utility-yellow-500",
    ring: "ring-utility-yellow-500/30",
  },
  LUNCH: {
    label: "Lunch",
    icon: Sun,
    rail: "bg-utility-sky-500",
    card: "border-utility-sky-500/30",
    soft: "bg-utility-sky-500/10",
    text: "text-utility-sky-500",
    ring: "ring-utility-sky-500/30",
  },
  DINNER: {
    label: "Dinner",
    icon: Moon01,
    rail: "bg-utility-indigo-500",
    card: "border-utility-indigo-500/30",
    soft: "bg-utility-indigo-500/10",
    text: "text-utility-indigo-500",
    ring: "ring-utility-indigo-500/30",
  },
  SNACK: {
    label: "Snack",
    icon: Star06,
    rail: "bg-utility-pink-500",
    card: "border-utility-pink-500/30",
    soft: "bg-utility-pink-500/10",
    text: "text-utility-pink-500",
    ring: "ring-utility-pink-500/30",
  },
};

function asMealType(value: string | null | undefined): MealType {
  return MEAL_TYPES.includes(value as MealType) ? (value as MealType) : "SNACK";
}

function MealIconBadge({ mealType, className = "" }: { mealType: MealType; className?: string }) {
  const style = MEAL_STYLE[mealType];
  const Icon = style.icon;
  return (
    <span
      className={`grid size-8 shrink-0 place-items-center rounded-lg ring-1 ring-inset ${style.soft} ${style.text} ${style.ring} ${className}`}
      aria-hidden="true"
    >
      <Icon className="size-4" />
    </span>
  );
}

function MealTargetSelect({
  value,
  onChange,
  ariaLabel,
  compact = false,
}: {
  value: MealType;
  onChange: (value: MealType) => void;
  ariaLabel: string;
  compact?: boolean;
}) {
  const style = MEAL_STYLE[value];
  const Icon = style.icon;
  return (
    <span className={`relative inline-flex min-w-0 items-center rounded-lg ${style.soft}`}>
      <Icon className={`pointer-events-none absolute left-2.5 z-10 size-4 ${style.text}`} aria-hidden="true" />
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(asMealType(event.target.value))}
        className={`w-full min-w-0 appearance-none rounded-lg border border-secondary bg-transparent pl-8 pr-7 font-medium shadow-xs outline-none transition focus:border-brand focus:ring-1 focus:ring-brand ${style.text} ${compact ? "h-9 py-1.5 text-xs" : "h-10 py-2 text-sm"}`}
      >
        {MEAL_TYPES.map((mealType) => (
          <option key={mealType} value={mealType}>
            {MEAL_STYLE[mealType].label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2.5 text-[10px] text-tertiary">▼</span>
    </span>
  );
}

function FormField({
  label,
  hint,
  className = "",
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <span className="text-xs font-medium text-secondary">{label}</span>
      {children}
      {hint ? <span className="text-xs text-quaternary">{hint}</span> : null}
    </label>
  );
}

function NumberWithUnit({
  label,
  unit,
  value,
  onChange,
  min = 0,
  step = "any",
}: {
  label: string;
  unit: string;
  value: string;
  onChange: (value: string) => void;
  min?: number;
  step?: number | "any";
}) {
  return (
    <FormField label={label}>
      <span className="relative block">
        <input
          aria-label={`${label} in ${unit}`}
          type="number"
          min={min}
          step={step}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`${NUTRITION_FIELD_CLASS} pr-14`}
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-tertiary">
          {unit}
        </span>
      </span>
    </FormField>
  );
}

function useNutritionMutation(client: LifeOSClient, onMutated: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const run = async (
    type: string,
    payload: Record<string, unknown>,
    message: string,
  ): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    setSuccess(null);
    const requestId = `nutrition_mutation_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          client.offMessage(onMessage);
          reject(new Error("The local Coretex service did not answer."));
        }, 15_000);
        function onMessage(response: any) {
          if (
            !response ||
            response.type !== type ||
            response.requestId !== requestId
          )
            return;
          window.clearTimeout(timeout);
          client.offMessage(onMessage);
          if (response.error) reject(new Error(String(response.error)));
          else resolve();
        }
        client.onMessage(onMessage);
        if (!client.send({ type, requestId, payload })) {
          window.clearTimeout(timeout);
          client.offMessage(onMessage);
          reject(new Error("The Coretex service is offline."));
        }
      });
      setSuccess(message);
      onMutated();
      return true;
    } catch (mutationError) {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : "Unable to save.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  };
  const request = async <T,>(type: string, payload: Record<string, unknown>): Promise<T | null> => {
    if (busy) return null;
    setBusy(true);
    setError(null);
    setSuccess(null);
    const requestId = `nutrition_request_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    try {
      return await new Promise<T>((resolve, reject) => {
        const timeout = window.setTimeout(() => { client.offMessage(onMessage); reject(new Error("The local Coretex service did not answer.")); }, 35_000);
        function onMessage(response: any) {
          if (!response || response.type !== type || response.requestId !== requestId) return;
          window.clearTimeout(timeout);
          client.offMessage(onMessage);
          if (response.error) reject(new Error(String(response.error)));
          else resolve(response.result as T);
        }
        client.onMessage(onMessage);
        if (!client.send({ type, requestId, payload })) { window.clearTimeout(timeout); client.offMessage(onMessage); reject(new Error("The Coretex service is offline.")); }
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to analyze food.");
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { run, request, busy, error, success };
}

function NutritionMutationNote({
  error,
  success,
}: {
  error: string | null;
  success: string | null;
}) {
  if (!error && !success) return null;
  return (
    <p
      role="status"
      className={`mt-3 text-sm ${error ? "text-error-primary" : "text-success-primary"}`}
    >
      {error ?? success}
    </p>
  );
}

function WaterActions({
  data,
  client,
  onMutated,
}: {
  data: NutritionData;
  client: LifeOSClient;
  onMutated: () => void;
}) {
  const unitSystem: UnitSystem = data.unitSystem === "METRIC" ? "METRIC" : "IMPERIAL";
  const displayUnit = volumeUnit(unitSystem);
  const maxDisplayAmount = unitSystem === "IMPERIAL"
    ? Math.floor(volumeToDisplay(20_000, unitSystem) * 10) / 10
    : volumeToDisplay(20_000, unitSystem);
  const presets = waterQuickAdds(unitSystem);
  const subtractAmount = presets[0];
  const [amount, setAmount] = useState(() => String(volumeToDisplay(data.water.amountMl, unitSystem)));
  const [inputError, setInputError] = useState<string | null>(null);
  const mutation = useNutritionMutation(client, onMutated);
  const remaining = Math.max(0, data.water.goalMl - data.water.amountMl);
  const complete = data.water.amountMl >= data.water.goalMl && data.water.goalMl > 0;

  useEffect(() => {
    setAmount(String(volumeToDisplay(data.water.amountMl, unitSystem)));
    setInputError(null);
  }, [data.date, data.water.amountMl, unitSystem]);

  const setDailyTotal = (event: FormEvent) => {
    event.preventDefault();
    const parsedAmountMl = parseVolumeInput(amount, unitSystem);
    if (parsedAmountMl == null || Number(amount) < 0 || Number(amount) > maxDisplayAmount) {
      setInputError(`Enter a total between 0 and ${maxDisplayAmount.toLocaleString()} ${displayUnit}.`);
      return;
    }
    const amountMl = Math.min(20_000, parsedAmountMl);
    setInputError(null);
    void mutation.run(
      "nutrition:setWater",
      { date: data.date, amountMl },
      `Daily total set to ${formatVolume(amountMl, unitSystem)}`,
    );
  };

  return (
    <PersonalCard>
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="flex min-w-0 items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-utility-blue-50 text-utility-blue-600 ring-1 ring-utility-blue-200 ring-inset">
            <Droplets01 className="size-6" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-tertiary">Water</p>
            <p className="mt-0.5 text-2xl font-semibold text-primary">
              {volumeToDisplay(data.water.amountMl, unitSystem).toLocaleString()}{" "}
              <span className="text-base font-medium text-tertiary">
                / {volumeToDisplay(data.water.goalMl, unitSystem).toLocaleString()} {displayUnit}
              </span>
            </p>
            <p className="mt-1 text-xs text-tertiary">
              {complete
                ? "Daily goal reached"
                : `${formatVolume(remaining, unitSystem)} remaining`}
            </p>
          </div>
        </div>
        <div className="w-full max-w-xs sm:w-56">
          <div className="h-2.5 overflow-hidden rounded-full bg-utility-blue-50">
            <div
              className="h-full rounded-full bg-utility-blue-600 transition-[width]"
              style={{
                width: `${Math.max(0, Math.min(100, data.water.progress))}%`,
              }}
            />
          </div>
          <p className="mt-1.5 text-right text-xs text-tertiary">
            {data.water.progress}% complete
          </p>
        </div>
      </div>
      <div className="mt-5 grid gap-4 border-t border-secondary pt-4">
        <div>
          <p className="mb-2 text-xs font-medium text-secondary">Quick add</p>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            {presets.map((preset) => (
              <Button
                key={preset.ml}
                type="button"
                color="secondary"
                size="sm"
                iconLeading={Plus}
                isDisabled={mutation.busy}
                onClick={() =>
                  void mutation.run(
                    "nutrition:addWater",
                    { date: data.date, amountMl: preset.ml },
                    `Added ${preset.label}`,
                  )
                }
                className="w-full sm:w-auto"
              >
                {preset.label}
              </Button>
            ))}
            <Button
              type="button"
              color="tertiary"
              size="sm"
              iconLeading={Minus}
              isDisabled={mutation.busy || data.water.amountMl <= 0}
              onClick={() =>
                void mutation.run(
                  "nutrition:setWater",
                  { date: data.date, amountMl: Math.max(0, data.water.amountMl - subtractAmount.ml) },
                  `Removed ${subtractAmount.label}`,
                )
              }
              className="w-full sm:w-auto"
            >
              {subtractAmount.label}
            </Button>
          </div>
        </div>
        <form className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" onSubmit={setDailyTotal}>
          <FormField label="Set daily total" hint={`Stored securely in milliliters; shown in ${displayUnit}.`}>
            <span className="relative block">
              <input
                aria-label={`Daily water total in ${displayUnit}`}
                type="number"
                min="0"
                max={maxDisplayAmount}
                step={unitSystem === "IMPERIAL" ? "0.1" : "1"}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className={`${NUTRITION_FIELD_CLASS} pr-16`}
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-tertiary">
                {displayUnit}
              </span>
            </span>
          </FormField>
          <Button
            type="submit"
            size="sm"
            iconLeading={Droplets01}
            isLoading={mutation.busy}
            className="w-full sm:mb-[1.375rem] sm:w-auto"
          >
            Set total
          </Button>
        </form>
      </div>
      <NutritionMutationNote
        error={inputError ?? mutation.error}
        success={mutation.success}
      />
    </PersonalCard>
  );
}

function FoodLogForm({
  date,
  products,
  client,
  onMutated,
}: {
  date: string;
  products: NutritionData["products"];
  client: LifeOSClient;
  onMutated: () => void;
}) {
  type FoodLogMethod = "manual" | "ai" | "photo" | "barcode";
  type Estimate = {
    description: string;
    servingSize: string | null;
    quantity?: number | null;
    unit?: string | null;
    calories: number | null;
    proteinG: number | null;
    carbsG: number | null;
    fatG: number | null;
    fiberG?: number | null;
    source: string;
    model: string | null;
    productId?: string | null;
    nutritionBasis?: "estimated-serving" | "saved-serving" | "serving" | "100g";
    attribution?: string | { provider: string; url: string | null } | null;
  };

  const [method, setMethod] = useState<FoodLogMethod>("manual");
  const [mealType, setMealType] = useState<MealType>("BREAKFAST");
  const [description, setDescription] = useState("");
  const [servingSize, setServingSize] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("serving");
  const [calories, setCalories] = useState("");
  const [proteinG, setProteinG] = useState("");
  const [carbsG, setCarbsG] = useState("");
  const [fatG, setFatG] = useState("");
  const [fiberG, setFiberG] = useState("");
  const [aiDescription, setAiDescription] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [barcode, setBarcode] = useState("");
  const [productId, setProductId] = useState<string | null>(null);
  const [estimateReady, setEstimateReady] = useState(false);
  const [estimateMeta, setEstimateMeta] = useState<{ label: string; url: string | null } | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const saveMutation = useNutritionMutation(client, onMutated);
  const analysisMutation = useNutritionMutation(client, onMutated);

  useEffect(() => {
    if (!photo) {
      setPhotoPreview(null);
      return;
    }
    const url = encodeURI(URL.createObjectURL(photo));
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const setSelectedPhoto = (file: File | null) => {
    setInputError(null);
    setEstimateReady(false);
    setPhotoBase64(null);
    if (!file) {
      setPhoto(null);
      return;
    }
    if (!SAFE_FOOD_PHOTO_TYPES.has(file.type.toLowerCase())) {
      setPhoto(null);
      setInputError("Choose a JPEG, PNG, or WebP food photo.");
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setPhoto(null);
      setInputError("That photo is larger than 12 MB. Choose a smaller image.");
      return;
    }
    setPhoto(file);
  };

  const normalizeServingUnit = (value: string | null | undefined): string => {
    const normalized = value?.trim().toLowerCase().replace(/\.$/, "") ?? "";
    const aliases: Record<string, string> = {
      gram: "g",
      grams: "g",
      kilogram: "kg",
      kilograms: "kg",
      ounce: "oz",
      ounces: "oz",
      pound: "lb",
      pounds: "lb",
      milliliter: "ml",
      milliliters: "ml",
      millilitre: "ml",
      millilitres: "ml",
      "fluid ounce": "fl oz",
      "fluid ounces": "fl oz",
      cups: "cup",
      tablespoons: "tbsp",
      tablespoon: "tbsp",
      teaspoons: "tsp",
      teaspoon: "tsp",
      pieces: "piece",
      slices: "slice",
      scoops: "scoop",
      servings: "serving",
      bowls: "bowl",
      plates: "plate",
      containers: "container",
      bottles: "bottle",
    };
    const candidate = aliases[normalized] ?? normalized;
    return FOOD_UNIT_OPTIONS.some((option) => option.value === candidate) ? candidate : "serving";
  };

  const applyEstimate = (estimate: Estimate) => {
    setDescription(estimate.description || "Food");
    setServingSize(estimate.servingSize ?? "");
    if (estimate.quantity != null) {
      setQuantity(String(estimate.quantity));
      setUnit(normalizeServingUnit(estimate.unit));
    } else {
      const servingMatch = estimate.servingSize?.trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*(.*)$/);
      if (servingMatch) {
        setQuantity(servingMatch[1]);
        setUnit(normalizeServingUnit(servingMatch[2]));
      }
    }
    setCalories(estimate.calories == null ? "" : String(estimate.calories));
    setProteinG(estimate.proteinG == null ? "" : String(estimate.proteinG));
    setCarbsG(estimate.carbsG == null ? "" : String(estimate.carbsG));
    setFatG(estimate.fatG == null ? "" : String(estimate.fatG));
    setFiberG(estimate.fiberG == null ? "" : String(estimate.fiberG));
    setProductId(estimate.productId ?? null);
    setEstimateReady(true);
    const attribution = typeof estimate.attribution === "string"
      ? { label: estimate.attribution, url: null }
      : estimate.attribution
        ? { label: estimate.attribution.provider, url: estimate.attribution.url }
        : estimate.model
          ? { label: `Estimated locally with ${estimate.model}`, url: null }
          : { label: "Result found — review the nutrition values before saving", url: null };
    const basisLabel = estimate.nutritionBasis === "100g"
      ? " · values per 100 g"
      : estimate.nutritionBasis === "serving"
        ? " · values per labeled serving"
        : "";
    setEstimateMeta({ ...attribution, label: `${attribution.label}${basisLabel}` });
  };

  const analyzeText = async () => {
    if (!aiDescription.trim()) return;
    setInputError(null);
    setEstimateReady(false);
    const estimate = await analysisMutation.request<Estimate>("nutrition:analyzeFood", { description: aiDescription });
    if (estimate) applyEstimate(estimate);
  };

  const analyzePhoto = async () => {
    if (!photo) return;
    setInputError(null);
    setEstimateReady(false);
    try {
      const base64 = await nutritionFileBase64(photo);
      setPhotoBase64(base64);
      const estimate = await analysisMutation.request<Estimate>("nutrition:analyzeFoodPhoto", {
        description: aiDescription,
        base64,
        mimeType: photo.type,
      });
      if (estimate) applyEstimate(estimate);
    } catch (error) {
      setInputError(error instanceof Error ? error.message : "Could not read that food photo.");
    }
  };

  const lookupBarcode = async (requestedCode = barcode.trim()) => {
    const code = requestedCode.replace(/\D/g, "");
    if (!/^\d{8,14}$/.test(code)) {
      setInputError("Enter the 8–14 digits printed below the product barcode.");
      return;
    }
    setInputError(null);
    setEstimateReady(false);
    setBarcode(code);
    const local = products.find((product) => product.barcode === code);
    if (local) {
      applyEstimate({
        description: local.name,
        servingSize: local.quantity == null ? null : `${local.quantity}${local.unit ? ` ${local.unit}` : ""}`,
        quantity: local.quantity,
        unit: local.unit,
        calories: local.calories,
        proteinG: local.proteinG,
        carbsG: local.carbsG,
        fatG: local.fatG,
        fiberG: local.fiberG,
        source: "BARCODE",
        model: null,
        attribution: "Found in your saved foods",
      });
      return;
    }
    const estimate = await analysisMutation.request<Estimate>("nutrition:lookupBarcode", { barcode: code });
    if (estimate) applyEstimate(estimate);
  };

  const scanBarcodeImage = async (file: File | null) => {
    if (!file) return;
    try {
      setInputError(null);
      const Detector = (window as typeof window & { BarcodeDetector?: new (options: { formats: string[] }) => { detect: (source: ImageBitmap) => Promise<Array<{ rawValue?: string }>> } }).BarcodeDetector;
      if (!Detector) throw new Error("Camera barcode detection is unavailable here. Enter the digits printed below the barcode instead.");
      const bitmap = await createImageBitmap(file);
      const results = await new Detector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"] }).detect(bitmap);
      bitmap.close();
      if (!results[0]?.rawValue) throw new Error("No barcode was found in that image. Try a closer, well-lit photo.");
      await lookupBarcode(String(results[0].rawValue));
    } catch (error) {
      setInputError(error instanceof Error ? error.message : "Could not scan that barcode.");
    }
  };

  const resetFoodForm = () => {
    setDescription("");
    setServingSize("");
    setQuantity("1");
    setUnit("serving");
    setCalories("");
    setProteinG("");
    setCarbsG("");
    setFatG("");
    setFiberG("");
    setAiDescription("");
    setPhoto(null);
    setPhotoBase64(null);
    setBarcode("");
    setProductId(null);
    setEstimateReady(false);
    setEstimateMeta(null);
    setInputError(null);
    if (photoInputRef.current) photoInputRef.current.value = "";
    if (barcodeInputRef.current) barcodeInputRef.current.value = "";
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const source = method === "ai" ? "TEXT" : method === "photo" ? "VISION" : method === "barcode" ? "BARCODE" : "MANUAL";
    const numericQuantity = quantity.trim() ? Number(quantity) : null;
    const resolvedServingSize = servingSize.trim() || (numericQuantity == null ? "" : `${quantity} ${unit}`);
    const saved = await saveMutation.run(
      "nutrition:logFood",
      {
        date,
        mealType,
        description,
        servingSize: resolvedServingSize,
        quantity: numericQuantity,
        unit,
        calories,
        proteinG,
        carbsG,
        fatG,
        fiberG,
        source,
        productId,
        ...(source === "VISION" && photoBase64 ? { photoBase64, mimeType: photo?.type } : {}),
      },
      "Food logged",
    );
    if (saved) resetFoodForm();
  };

  const modeOptions: Array<{
    id: FoodLogMethod;
    label: string;
    description: string;
    icon: typeof Edit05;
  }> = [
    { id: "manual", label: "Manual", description: "Enter nutrition", icon: Edit05 },
    { id: "ai", label: "Describe with AI", description: "Use natural language", icon: MagicWand01 },
    { id: "photo", label: "Food photo", description: "Analyze a meal", icon: Camera01 },
    { id: "barcode", label: "Barcode", description: "Scan a product", icon: Scan },
  ];

  return (
    <PersonalCard title="Log food">
      <div role="tablist" aria-label="Food logging method" className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {modeOptions.map((option) => {
          const active = method === option.id;
          return (
            <button
              key={option.id}
              id={`food-log-tab-${option.id}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`food-log-panel-${option.id}`}
              onClick={() => {
                setMethod(option.id);
                setInputError(null);
                setEstimateReady(false);
                setEstimateMeta(null);
                setProductId(null);
              }}
              className={`group flex min-h-16 items-center gap-3 rounded-xl border p-3 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                active
                  ? "border-brand bg-brand-primary shadow-xs"
                  : "border-secondary bg-primary hover:border-primary_hover hover:bg-primary_hover"
              }`}
            >
              <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${active ? "bg-brand-solid text-white" : "bg-secondary text-tertiary group-hover:text-secondary"}`}>
                <option.icon className="size-4.5" />
              </span>
              <span className="min-w-0">
                <span className={`block text-sm font-semibold ${active ? "text-brand-secondary" : "text-secondary"}`}>{option.label}</span>
                <span className="mt-0.5 hidden text-xs text-tertiary xl:block">{option.description}</span>
              </span>
            </button>
          );
        })}
      </div>

      {method === "manual" ? (
        <div id="food-log-panel-manual" role="tabpanel" aria-labelledby="food-log-tab-manual" className="mb-4 flex items-center gap-3 rounded-xl border border-secondary bg-secondary/50 px-4 py-3">
          <Edit05 className="size-5 shrink-0 text-brand-secondary" />
          <p className="text-sm text-tertiary"><span className="font-medium text-secondary">Add food details directly.</span> Use the serving amount and unit that match the label or portion.</p>
        </div>
      ) : null}

      {method === "ai" ? (
        <div id="food-log-panel-ai" role="tabpanel" aria-labelledby="food-log-tab-ai" className="mb-4 rounded-xl border border-brand bg-primary p-4">
          <div className="mb-3 flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-primary text-brand-secondary"><MagicWand01 className="size-4.5" /></span>
            <div><p className="text-sm font-semibold text-primary">Describe your meal naturally</p><p className="mt-0.5 text-xs text-tertiary">Coretex uses your local AI model, then lets you review every value.</p></div>
          </div>
          <textarea
            value={aiDescription}
            onChange={(event) => setAiDescription(event.target.value)}
            className={`${NUTRITION_FIELD_CLASS} min-h-24 resize-y py-2.5`}
            placeholder="Example: Two scrambled eggs, sourdough toast with butter, and a medium banana"
            maxLength={2_000}
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {["Greek yogurt, berries, and granola", "Turkey sandwich with a side salad", "Chicken, rice, and roasted vegetables"].map((example) => (
              <button key={example} type="button" onClick={() => setAiDescription(example)} className="rounded-full border border-brand bg-primary px-2.5 py-1 text-xs text-tertiary transition hover:text-secondary">{example}</button>
            ))}
            <Button type="button" size="sm" iconLeading={MagicWand01} isLoading={analysisMutation.busy} isDisabled={!aiDescription.trim()} onClick={() => void analyzeText()} className="ml-auto w-full sm:w-auto">
              Estimate nutrition
            </Button>
          </div>
        </div>
      ) : null}

      {method === "photo" ? (
        <div id="food-log-panel-photo" role="tabpanel" aria-labelledby="food-log-tab-photo" className="mb-4 grid gap-4 rounded-xl border border-secondary bg-secondary/50 p-4 lg:grid-cols-[minmax(13rem,0.8fr)_minmax(0,1.2fr)]">
          <input ref={photoInputRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={(event) => setSelectedPhoto(event.target.files?.[0] ?? null)} />
          {photo && photoPreview ? (
            <div className="relative overflow-hidden rounded-xl border border-secondary bg-primary">
              <img src={photoPreview} alt="Selected food" className="h-40 w-full object-cover" />
              <div className="flex items-center justify-between gap-2 p-3">
                <div className="min-w-0"><p className="truncate text-sm font-medium text-secondary">{photo.name}</p><p className="text-xs text-quaternary">{(photo.size / 1024 / 1024).toFixed(1)} MB</p></div>
                <div className="flex shrink-0 gap-1">
                  <Button type="button" color="tertiary" size="sm" iconLeading={UploadCloud02} onClick={() => photoInputRef.current?.click()} aria-label="Replace photo" />
                  <Button type="button" color="tertiary-destructive" size="sm" iconLeading={Trash01} onClick={() => setSelectedPhoto(null)} aria-label="Remove photo" />
                </div>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => photoInputRef.current?.click()} className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed border-primary bg-primary px-5 py-6 text-center transition hover:border-brand hover:bg-brand-primary">
              <span className="grid size-11 place-items-center rounded-xl bg-brand-primary text-brand-secondary"><Camera01 className="size-5" /></span>
              <span className="mt-3 text-sm font-semibold text-secondary">Take or choose a food photo</span>
              <span className="mt-1 text-xs text-quaternary">JPEG, PNG, or WebP · up to 12 MB</span>
            </button>
          )}
          <div className="flex min-w-0 flex-col justify-between gap-4">
            <div><p className="text-sm font-semibold text-primary">Estimate from a meal photo</p><p className="mt-1 text-xs text-tertiary">Use a clear, well-lit photo. Add a hint when ingredients or portion size are hard to see.</p></div>
            <FormField label="Optional description or portion hint">
              <input value={aiDescription} onChange={(event) => setAiDescription(event.target.value)} className={NUTRITION_FIELD_CLASS} placeholder="e.g. 10-inch plate, homemade chicken curry" maxLength={500} />
            </FormField>
            <Button type="button" size="sm" iconLeading={Camera01} isLoading={analysisMutation.busy} isDisabled={!photo} onClick={() => void analyzePhoto()} className="w-full sm:self-end sm:w-auto">
              Analyze photo
            </Button>
          </div>
        </div>
      ) : null}

      {method === "barcode" ? (
        <div id="food-log-panel-barcode" role="tabpanel" aria-labelledby="food-log-tab-barcode" className="mb-4 rounded-xl border border-secondary bg-secondary/50 p-4">
          <input ref={barcodeInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(event) => void scanBarcodeImage(event.target.files?.[0] ?? null)} />
          <div className="grid gap-4 lg:grid-cols-[0.8fr_auto_1.2fr] lg:items-center">
            <Button type="button" color="secondary" size="md" iconLeading={Scan} isDisabled={analysisMutation.busy} onClick={() => barcodeInputRef.current?.click()} className="w-full">
              Scan barcode with camera
            </Button>
            <div className="flex items-center gap-3 lg:flex-col"><span className="h-px flex-1 bg-border-secondary lg:h-7 lg:w-px" /><span className="text-xs font-medium text-quaternary">or</span><span className="h-px flex-1 bg-border-secondary lg:h-7 lg:w-px" /></div>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <FormField label="Enter barcode digits">
                <input inputMode="numeric" value={barcode} onChange={(event) => setBarcode(event.target.value.replace(/\D/g, "").slice(0, 14))} className={NUTRITION_FIELD_CLASS} placeholder="012345678905" />
              </FormField>
              <Button type="button" color="primary" size="sm" iconLeading={SearchLg} isLoading={analysisMutation.busy} isDisabled={!barcode.trim()} onClick={() => void lookupBarcode()} className="w-full sm:mt-[1.375rem] sm:w-auto">
                Look up food
              </Button>
            </div>
          </div>
          <p className="mt-3 text-xs text-quaternary">Looks in your saved foods first, then checks the free Open Food Facts product database.</p>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-secondary bg-primary">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-secondary bg-secondary/40 px-4 py-3">
          <div><p className="text-sm font-semibold text-primary">{method === "manual" ? "Food details" : "Review nutrition"}</p><p className="mt-0.5 text-xs text-tertiary">{method === "manual" ? "Enter values for the amount you ate." : "Generated values are estimates—adjust them before logging."}</p></div>
          {method !== "manual" ? (
            estimateReady ? <span className="inline-flex items-center gap-1.5 rounded-full bg-success-primary px-2.5 py-1 text-xs font-medium text-success-primary"><CheckCircle className="size-3.5" />Estimate ready</span> : <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-tertiary">Waiting for analysis</span>
          ) : null}
        </div>
      <form
        onSubmit={submit}
          className="grid gap-4 p-4"
      >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[9rem_minmax(12rem,2fr)_7rem_8rem]">
            <FormField label="Meal">
              <MealTargetSelect value={mealType} onChange={setMealType} ariaLabel="Meal type" />
            </FormField>
            <FormField label="Food name">
              <input aria-label="Food name" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What did you eat?" required maxLength={250} className={NUTRITION_FIELD_CLASS} />
            </FormField>
            <NumberWithUnit label="Amount" unit="×" value={quantity} onChange={setQuantity} step="any" />
            <FormField label="Serving unit" hint={servingSize && servingSize !== `${quantity} ${unit}` ? servingSize : undefined}>
              <RichSelect aria-label="Serving unit" value={unit} onChange={(event) => setUnit(event.target.value)} options={FOOD_UNIT_OPTIONS.map((option) => ({ ...option }))} popoverClassName="min-w-36" />
            </FormField>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <NumberWithUnit label="Energy" unit="kcal" value={calories} onChange={setCalories} />
            <NumberWithUnit label="Protein" unit="g" value={proteinG} onChange={setProteinG} />
            <NumberWithUnit label="Carbohydrates" unit="g" value={carbsG} onChange={setCarbsG} />
            <NumberWithUnit label="Fat" unit="g" value={fatG} onChange={setFatG} />
            <NumberWithUnit label="Fiber" unit="g" value={fiberG} onChange={setFiberG} />
          </div>
          <div className="flex flex-col gap-3 border-t border-secondary pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-tertiary">
              {estimateMeta ? (
                <>{estimateMeta.label}{estimateMeta.url ? <> · <a href={estimateMeta.url} target="_blank" rel="noreferrer" className="font-medium text-brand-secondary hover:underline">View source</a></> : null}</>
              ) : method === "manual" ? "All nutrition fields are for the serving amount above." : "Analyze first, then review the populated values."}
            </p>
            <Button type="submit" size="md" iconLeading={Plus} isLoading={saveMutation.busy} isDisabled={!description.trim() || (method !== "manual" && !estimateReady)} className="w-full sm:w-auto">
              Log to {mealType.toLowerCase()}
            </Button>
          </div>
      </form>
      </div>
      <NutritionMutationNote
        error={inputError ?? analysisMutation.error ?? saveMutation.error}
        success={saveMutation.success}
      />
    </PersonalCard>
  );
}

function GoalForm({
  data,
  client,
  onMutated,
}: {
  data: NutritionData;
  client: LifeOSClient;
  onMutated: () => void;
}) {
  const unitSystem: UnitSystem = data.unitSystem === "METRIC" ? "METRIC" : "IMPERIAL";
  const waterDisplayUnit = volumeUnit(unitSystem);
  const [calories, setCalories] = useState(
    data.goal?.calories?.toString() ?? "",
  );
  const [proteinG, setProteinG] = useState(
    data.goal?.proteinG?.toString() ?? "",
  );
  const [carbsG, setCarbsG] = useState(data.goal?.carbsG?.toString() ?? "");
  const [fatG, setFatG] = useState(data.goal?.fatG?.toString() ?? "");
  const [fiberG, setFiberG] = useState(data.goal?.fiberG?.toString() ?? "");
  const [waterGoal, setWaterGoal] = useState(String(volumeToDisplay(data.water.goalMl, unitSystem)));
  const mutation = useNutritionMutation(client, onMutated);

  useEffect(() => {
    setCalories(data.goal?.calories?.toString() ?? "");
    setProteinG(data.goal?.proteinG?.toString() ?? "");
    setCarbsG(data.goal?.carbsG?.toString() ?? "");
    setFatG(data.goal?.fatG?.toString() ?? "");
    setFiberG(data.goal?.fiberG?.toString() ?? "");
    setWaterGoal(String(volumeToDisplay(data.water.goalMl, unitSystem)));
  }, [data.goal?.updatedAt, data.water.goalMl, unitSystem]);

  return (
    <PersonalCard title="Custom daily goals">
      <div className="mb-4 flex items-start gap-3 rounded-xl bg-brand-primary_alt p-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-secondary text-brand-secondary">
          <Target04 className="size-4.5" />
        </span>
        <div>
          <p className="text-sm font-medium text-primary">Fine-tune your targets</p>
          <p className="mt-0.5 text-xs leading-5 text-tertiary">These values override calculated targets. Leave a macro blank to remove only that goal.</p>
        </div>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const waterGoalMl = parseVolumeInput(waterGoal, unitSystem);
          void mutation.run(
            "nutrition:updateGoals",
            {
              calories: calories.trim() === "" ? null : calories,
              proteinG: proteinG.trim() === "" ? null : proteinG,
              carbsG: carbsG.trim() === "" ? null : carbsG,
              fatG: fatG.trim() === "" ? null : fatG,
              fiberG: fiberG.trim() === "" ? null : fiberG,
              waterGoalMl,
            },
            "Nutrition goals updated",
          );
        }}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        <NumberWithUnit label="Calories" unit="kcal" value={calories} onChange={setCalories} />
        <NumberWithUnit label="Protein" unit="g" value={proteinG} onChange={setProteinG} />
        <NumberWithUnit label="Carbohydrates" unit="g" value={carbsG} onChange={setCarbsG} />
        <NumberWithUnit label="Fat" unit="g" value={fatG} onChange={setFatG} />
        <NumberWithUnit label="Fiber" unit="g" value={fiberG} onChange={setFiberG} />
        <NumberWithUnit label="Water" unit={waterDisplayUnit} value={waterGoal} onChange={setWaterGoal} min={volumeToDisplay(250, unitSystem)} step={unitSystem === "IMPERIAL" ? 0.1 : 1} />
        <div className="flex justify-end sm:col-span-2 lg:col-span-3">
          <Button type="submit" size="sm" iconLeading={Save01} isLoading={mutation.busy}>Save custom goals</Button>
        </div>
      </form>
      <NutritionMutationNote
        error={mutation.error}
        success={mutation.success}
      />
    </PersonalCard>
  );
}

function MacroCard({
  label,
  value,
  goal,
  progress,
  unit,
}: {
  label: string;
  value: number;
  goal: number | null;
  progress: number | null;
  unit: string;
}) {
  return (
    <PersonalCard>
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="text-sm text-tertiary">{label}</p>
          <p className="mt-1 text-2xl font-semibold text-primary">
            {rounded(value)}{" "}
            <span className="text-sm font-medium text-tertiary">{unit}</span>
          </p>
        </div>
        <span className="text-xs text-quaternary">
          {goal == null ? "No goal" : `${rounded(goal)} ${unit}`}
        </span>
      </div>
      <div className="mt-4">
        <ProgressMeter
          value={value}
          max={goal ?? 0}
          label={
            progress == null
              ? "Goal not set"
              : `${rounded(Math.max(0, (goal ?? 0) - value))} ${unit} remaining`
          }
        />
      </div>
    </PersonalCard>
  );
}

function DateNavigation({
  data,
  onChange,
}: {
  data: NutritionData;
  onChange: (date: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-secondary bg-primary p-3 shadow-xs">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(data.navigation.previousDate)}
          className="rounded-lg border border-secondary px-3 py-2 text-sm font-medium text-secondary hover:bg-secondary"
          aria-label="Previous day"
        >
          ←
        </button>
        <input
          type="date"
          value={data.date}
          onChange={(event) =>
            event.target.value && onChange(event.target.value)
          }
          className="min-w-0 max-w-full rounded-lg border border-secondary bg-primary px-3 py-2 text-sm font-medium text-primary outline-none focus:border-brand"
        />
        <button
          type="button"
          onClick={() => onChange(data.navigation.nextDate)}
          className="rounded-lg border border-secondary px-3 py-2 text-sm font-medium text-secondary hover:bg-secondary"
          aria-label="Next day"
        >
          →
        </button>
      </div>
      <div className="flex items-center gap-3">
        <p className="text-sm text-tertiary">
          {new Date(`${data.date}T12:00:00`).toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </p>
        {!data.navigation.isToday && (
          <button
            type="button"
            onClick={() => onChange(data.navigation.today)}
            className="rounded-lg bg-brand-solid px-3 py-2 text-sm font-semibold text-white"
          >
            Today
          </button>
        )}
      </div>
    </div>
  );
}

function MealsSection({
  data,
  client,
  onMutated,
}: {
  data: NutritionData;
  client: LifeOSClient;
  onMutated: () => void;
}) {
  const mutation = useNutritionMutation(client, onMutated);
  const [savingMealId, setSavingMealId] = useState<string | null>(null);
  const [savedMealName, setSavedMealName] = useState("");
  const [savedMealType, setSavedMealType] = useState<MealType>("SNACK");

  const startSavingMeal = (meal: NutritionData["meals"][number]) => {
    const type = asMealType(meal.mealType);
    setSavingMealId(meal.id);
    setSavedMealType(type);
    setSavedMealName(`${MEAL_STYLE[type].label} favorites`);
  };

  const saveMeal = async (event: FormEvent, mealId: string) => {
    event.preventDefault();
    const saved = await mutation.run(
      "nutrition:createSavedMeal",
      { sourceMealId: mealId, name: savedMealName, mealType: savedMealType },
      "Meal saved for reuse",
    );
    if (saved) {
      setSavingMealId(null);
      setSavedMealName("");
    }
  };

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      {MEAL_TYPES.map((mealType) => {
        const meal = data.meals.find((candidate) => candidate.mealType === mealType);
        const style = MEAL_STYLE[mealType];
        const entries = meal?.entries ?? [];
        return (
          <section key={mealType} className={`overflow-hidden rounded-xl border bg-primary shadow-xs ${style.card}`}>
            <header className={`relative flex flex-wrap items-center justify-between gap-3 border-b border-secondary px-5 py-4 ${style.soft}`}>
              <span className={`absolute inset-y-0 left-0 w-1 ${style.rail}`} aria-hidden="true" />
              <div className="flex min-w-0 items-center gap-3">
                <MealIconBadge mealType={mealType} />
                <div className="min-w-0">
                  <h3 className="truncate text-md font-semibold text-primary">
                    {meal?.name?.trim() || style.label}
                  </h3>
                  <p className="mt-0.5 text-xs text-tertiary">
                    {entries.length} {entries.length === 1 ? "food" : "foods"} · {rounded(meal?.totals.calories ?? 0)} kcal
                  </p>
                </div>
              </div>
              {meal && entries.length > 0 ? (
                <Button
                  type="button"
                  size="xs"
                  color="secondary"
                  iconLeading={BookmarkAdd}
                  onClick={() => startSavingMeal(meal)}
                  isDisabled={mutation.busy}
                >
                  Save meal
                </Button>
              ) : null}
            </header>

            <div className="p-4">
              {entries.length === 0 ? (
                <div className="rounded-xl border border-dashed border-secondary px-4 py-7 text-center">
                  <style.icon className={`mx-auto size-5 ${style.text}`} />
                  <p className="mt-2 text-sm text-tertiary">Nothing logged for {style.label.toLowerCase()}.</p>
                </div>
              ) : (
                <div className="divide-y divide-secondary">
                  {entries.map((entry) => (
                    <div key={entry.id} className="group flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                      {entry.imageUrl ? (
                        <img
                          src={entry.imageUrl}
                          alt=""
                          loading="lazy"
                          className="size-11 shrink-0 rounded-lg object-cover ring-1 ring-secondary ring-inset"
                          onError={(event) => { event.currentTarget.style.display = "none"; }}
                        />
                      ) : (
                        <MealIconBadge mealType={mealType} className="size-11" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-primary">{entry.description}</p>
                        <p className="mt-0.5 truncate text-xs text-tertiary">
                          {serving(entry)} · {titleCase(entry.source)}
                        </p>
                      </div>
                      <div className="hidden shrink-0 text-right sm:block">
                        <p className="text-sm font-medium text-secondary">{rounded(entry.calories)} kcal</p>
                        <p className="mt-0.5 text-xs text-quaternary">
                          P {rounded(entry.proteinG)} · C {rounded(entry.carbsG)} · F {rounded(entry.fatG)}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="xs"
                        color="tertiary"
                        iconLeading={Star01}
                        aria-label={entry.isFavorite ? `Remove ${entry.description} from favorites` : `Add ${entry.description} to favorites`}
                        title={entry.isFavorite ? "Remove from favorites" : "Add to favorites"}
                        className={entry.isFavorite ? "text-warning-primary" : ""}
                        isDisabled={mutation.busy}
                        onClick={() => void mutation.run(
                          "nutrition:setFoodFavorite",
                          { entryId: entry.id, isFavorite: !entry.isFavorite },
                          entry.isFavorite ? "Removed from favorites" : "Added to favorites",
                        )}
                      />
                    </div>
                  ))}
                </div>
              )}

              {meal && savingMealId === meal.id ? (
                <form onSubmit={(event) => void saveMeal(event, meal.id)} className={`mt-4 grid gap-3 rounded-xl p-3 ring-1 ring-inset sm:grid-cols-[minmax(10rem,1fr)_auto] ${style.soft} ${style.ring}`}>
                  <FormField label="Saved meal name">
                    <input
                      required
                      maxLength={120}
                      value={savedMealName}
                      onChange={(event) => setSavedMealName(event.target.value)}
                      className={NUTRITION_FIELD_CLASS}
                      placeholder="e.g. Weekday breakfast"
                    />
                  </FormField>
                  <FormField label="Default meal">
                    <MealTargetSelect value={savedMealType} onChange={setSavedMealType} ariaLabel="Default meal for saved meal" />
                  </FormField>
                  <div className="flex flex-wrap justify-end gap-2 sm:col-span-2">
                    <Button type="button" size="xs" color="secondary" onClick={() => setSavingMealId(null)} isDisabled={mutation.busy}>Cancel</Button>
                    <Button type="submit" size="xs" iconLeading={BookmarkAdd} isLoading={mutation.busy}>Save reusable meal</Button>
                  </div>
                </form>
              ) : null}
            </div>
          </section>
        );
      })}
      <div className="xl:col-span-2">
        <NutritionMutationNote error={mutation.error} success={mutation.success} />
      </div>
    </div>
  );
}

function GoalSummary({
  data,
  client,
  onMutated,
}: {
  data: NutritionData;
  client: LifeOSClient;
  onMutated: () => void;
}) {
  const goal = data.goal;
  const unitSystem: UnitSystem = data.unitSystem === "METRIC" ? "METRIC" : "IMPERIAL";
  const waterDisplayUnit = volumeUnit(unitSystem);
  const [editing, setEditing] = useState(false);
  const [calories, setCalories] = useState(goal?.calories?.toString() ?? "");
  const [proteinG, setProteinG] = useState(goal?.proteinG?.toString() ?? "");
  const [carbsG, setCarbsG] = useState(goal?.carbsG?.toString() ?? "");
  const [fatG, setFatG] = useState(goal?.fatG?.toString() ?? "");
  const [fiberG, setFiberG] = useState(goal?.fiberG?.toString() ?? "");
  const [waterGoal, setWaterGoal] = useState(String(volumeToDisplay(data.water.goalMl, unitSystem)));
  const mutation = useNutritionMutation(client, onMutated);

  const resetFields = () => {
    setCalories(goal?.calories?.toString() ?? "");
    setProteinG(goal?.proteinG?.toString() ?? "");
    setCarbsG(goal?.carbsG?.toString() ?? "");
    setFatG(goal?.fatG?.toString() ?? "");
    setFiberG(goal?.fiberG?.toString() ?? "");
    setWaterGoal(String(volumeToDisplay(data.water.goalMl, unitSystem)));
  };

  useEffect(() => {
    if (!editing) resetFields();
  }, [goal?.updatedAt, data.water.goalMl, unitSystem, editing]);

  const saveGoals = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await mutation.run(
      "nutrition:updateGoals",
      {
        calories: calories.trim() === "" ? null : calories,
        proteinG: proteinG.trim() === "" ? null : proteinG,
        carbsG: carbsG.trim() === "" ? null : carbsG,
        fatG: fatG.trim() === "" ? null : fatG,
        fiberG: fiberG.trim() === "" ? null : fiberG,
        waterGoalMl: parseVolumeInput(waterGoal, unitSystem),
      },
      "Daily goals saved",
    );
    if (saved) setEditing(false);
  };

  return (
    <PersonalCard
      title="Nutrition goals"
      action={
        !editing ? (
          <Button size="xs" color="secondary" iconLeading={Edit01} onClick={() => setEditing(true)}>
            {goal ? "Customize" : "Set goals"}
          </Button>
        ) : null
      }
    >
      {editing ? (
        <form onSubmit={saveGoals} className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl bg-brand-primary_alt p-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-secondary text-brand-secondary">
              <Target04 className="size-4" />
            </span>
            <p className="text-xs leading-5 text-tertiary">
              Set the daily targets that work for you. Leave a macro blank to stop tracking a goal; logged food is never changed.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <NumberWithUnit label="Calories" unit="kcal" value={calories} onChange={setCalories} />
            <NumberWithUnit label="Protein" unit="g" value={proteinG} onChange={setProteinG} />
            <NumberWithUnit label="Carbohydrates" unit="g" value={carbsG} onChange={setCarbsG} />
            <NumberWithUnit label="Fat" unit="g" value={fatG} onChange={setFatG} />
            <NumberWithUnit label="Fiber" unit="g" value={fiberG} onChange={setFiberG} />
            <NumberWithUnit label="Water" unit={waterDisplayUnit} value={waterGoal} onChange={setWaterGoal} min={volumeToDisplay(250, unitSystem)} step={unitSystem === "IMPERIAL" ? 0.1 : 1} />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              size="sm"
              color="secondary"
              onClick={() => {
                resetFields();
                setEditing(false);
              }}
              isDisabled={mutation.busy}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" iconLeading={Save01} isLoading={mutation.busy}>
              Save goals
            </Button>
          </div>
        </form>
      ) : goal ? (
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-tertiary">Calories</dt>
            <dd className="mt-1 font-semibold text-primary">
              {rounded(goal.calories)} kcal
            </dd>
          </div>
          <div>
            <dt className="text-tertiary">Protein</dt>
            <dd className="mt-1 font-semibold text-primary">
              {rounded(goal.proteinG)} g
            </dd>
          </div>
          <div>
            <dt className="text-tertiary">Carbohydrates</dt>
            <dd className="mt-1 font-semibold text-primary">
              {rounded(goal.carbsG)} g
            </dd>
          </div>
          <div>
            <dt className="text-tertiary">Fat</dt>
            <dd className="mt-1 font-semibold text-primary">
              {rounded(goal.fatG)} g
            </dd>
          </div>
          <div>
            <dt className="text-tertiary">Fiber</dt>
            <dd className="mt-1 font-semibold text-primary">
              {rounded(goal.fiberG)} g
            </dd>
          </div>
          <div>
            <dt className="text-tertiary">Diet direction</dt>
            <dd className="mt-1 font-semibold text-primary">
              {titleCase(data.goalProfile.dietGoal)}
            </dd>
          </div>
        </dl>
      ) : (
        <div className="rounded-xl border border-dashed border-secondary px-4 py-8 text-center">
          <Target04 className="mx-auto size-6 text-brand-secondary" />
          <p className="mt-2 text-sm font-medium text-primary">Make the dashboard yours</p>
          <p className="mt-1 text-xs text-tertiary">Set custom calories, macros, fiber, and hydration targets.</p>
        </div>
      )}
      {!editing && (data.goalProfile.goalWeightKg != null ||
        data.goalProfile.targetWeeklyChangeKg != null) && (
        <p className="mt-4 text-xs text-tertiary">
          Weight goal:{" "}
          {data.goalProfile.goalWeightKg == null
            ? "—"
            : formatWeight(data.goalProfile.goalWeightKg, unitSystem)}{" "}
          · Weekly change:{" "}
          {data.goalProfile.targetWeeklyChangeKg == null
            ? "—"
            : formatWeight(data.goalProfile.targetWeeklyChangeKg, unitSystem)}
        </p>
      )}
      <NutritionMutationNote error={mutation.error} success={mutation.success} />
    </PersonalCard>
  );
}

function FavoriteSummary({
  data,
  client,
  onMutated,
}: {
  data: NutritionData;
  client: LifeOSClient;
  onMutated: () => void;
}) {
  const mutation = useNutritionMutation(client, onMutated);
  const [targets, setTargets] = useState<Record<string, MealType>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);

  const targetFor = (id: string) => targets[id] ?? "SNACK";
  const setTarget = (id: string, mealType: MealType) => {
    setTargets((current) => ({ ...current, [id]: mealType }));
  };
  const runFavoriteAction = async (
    id: string,
    type: string,
    payload: Record<string, unknown>,
    message: string,
  ) => {
    setPendingId(id);
    await mutation.run(type, payload, message);
    setPendingId(null);
  };

  return (
    <PersonalCard
      title="Favorite foods"
      action={
        <span className="text-xs text-tertiary">
          {data.favoriteSummary.count} saved
        </span>
      }
    >
      {data.favorites.length === 0 ? (
        <div className="rounded-xl border border-dashed border-secondary px-4 py-8 text-center">
          <Star01 className="mx-auto size-6 text-warning-primary" />
          <p className="mt-2 text-sm font-medium text-primary">Keep go-to foods one click away</p>
          <p className="mt-1 text-xs text-tertiary">Use the star beside any logged food to add it here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.favorites.slice(0, 8).map((favorite) => (
            <div
              key={favorite.id}
              className="rounded-xl border border-secondary bg-secondary/30 p-3"
            >
              <div className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-warning-secondary text-warning-primary ring-1 ring-warning ring-inset">
                  <Star01 className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-primary">{favorite.description}</p>
                  <p className="mt-0.5 truncate text-xs text-tertiary">
                    {serving(favorite)} · {rounded(favorite.calories)} kcal
                  </p>
                  <p className="mt-1 text-[11px] text-quaternary">
                    P {rounded(favorite.proteinG)} g · C {rounded(favorite.carbsG)} g · F {rounded(favorite.fatG)} g
                  </p>
                </div>
                <Button
                  type="button"
                  size="xs"
                  color="tertiary"
                  iconLeading={Trash01}
                  aria-label={`Remove ${favorite.description} from favorites`}
                  title="Remove from favorites"
                  isDisabled={mutation.busy}
                  onClick={() => void runFavoriteAction(
                    favorite.id,
                    "nutrition:setFoodFavorite",
                    { entryId: favorite.id, isFavorite: false },
                    "Removed from favorites",
                  )}
                />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-secondary pt-3">
                <MealTargetSelect
                  value={targetFor(favorite.id)}
                  onChange={(mealType) => setTarget(favorite.id, mealType)}
                  ariaLabel={`Meal for ${favorite.description}`}
                  compact
                />
                <Button
                  type="button"
                  size="xs"
                  iconLeading={Plus}
                  isLoading={mutation.busy && pendingId === favorite.id}
                  isDisabled={mutation.busy && pendingId !== favorite.id}
                  onClick={() => void runFavoriteAction(
                    favorite.id,
                    "nutrition:logFavorite",
                    { favoriteEntryId: favorite.id, date: data.date, mealType: targetFor(favorite.id) },
                    `${favorite.description} added to ${MEAL_STYLE[targetFor(favorite.id)].label.toLowerCase()}`,
                  )}
                  className="ml-auto"
                >
                  Log food
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <NutritionMutationNote error={mutation.error} success={mutation.success} />
    </PersonalCard>
  );
}

function SavedMealsSummary({
  data,
  client,
  onMutated,
}: {
  data: NutritionData;
  client: LifeOSClient;
  onMutated: () => void;
}) {
  const mutation = useNutritionMutation(client, onMutated);
  const [targets, setTargets] = useState<Record<string, MealType>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editMealType, setEditMealType] = useState<MealType>("SNACK");
  const [editItems, setEditItems] = useState<NutritionData["savedMeals"][number]["items"]>([]);

  const targetFor = (meal: NutritionData["savedMeals"][number]) =>
    targets[meal.id] ?? asMealType(meal.mealType);
  const setTarget = (id: string, mealType: MealType) => {
    setTargets((current) => ({ ...current, [id]: mealType }));
  };
  const startEdit = (meal: NutritionData["savedMeals"][number]) => {
    setEditingId(meal.id);
    setEditName(meal.name);
    setEditMealType(asMealType(meal.mealType));
    setEditItems(meal.items.map((item) => ({ ...item })));
  };
  const updateSavedMeal = async (event: FormEvent, savedMealId: string) => {
    event.preventDefault();
    const saved = await mutation.run(
      "nutrition:updateSavedMeal",
      {
        savedMealId,
        name: editName,
        mealType: editMealType,
        items: editItems.map((item) => ({
          productId: item.productId ?? null,
          description: item.description,
          source: item.source ?? "MANUAL",
          servingSize: item.servingSize ?? null,
          quantity: item.quantity ?? null,
          unit: item.unit ?? null,
          calories: item.calories ?? null,
          proteinG: item.proteinG ?? null,
          carbsG: item.carbsG ?? null,
          fatG: item.fatG ?? null,
          fiberG: item.fiberG ?? null,
        })),
      },
      "Saved meal updated",
    );
    if (saved) setEditingId(null);
  };
  const runSavedMealAction = async (
    id: string,
    type: string,
    payload: Record<string, unknown>,
    message: string,
  ) => {
    setPendingId(id);
    await mutation.run(type, payload, message);
    setPendingId(null);
  };

  return (
    <PersonalCard
      title="Saved meals"
      className="lg:col-span-2 2xl:col-span-1"
      action={
        <span className="text-xs text-tertiary">
          {data.savedMealSummary.count} saved · {data.savedMealSummary.items} food items
        </span>
      }
    >
      {data.savedMeals.length === 0 ? (
        <div className="rounded-xl border border-dashed border-secondary px-4 py-8 text-center">
          <BookmarkAdd className="mx-auto size-6 text-brand-secondary" />
          <p className="mt-2 text-sm font-medium text-primary">Build reusable meal routines</p>
          <p className="mt-1 text-xs text-tertiary">Log foods for a meal, then choose “Save meal” on its colored card.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.savedMeals.slice(0, 8).map((meal) => (
            <div
              key={meal.id}
              className={`rounded-xl border bg-primary p-3 ${MEAL_STYLE[targetFor(meal)].card}`}
            >
              {editingId === meal.id ? (
                <form onSubmit={(event) => void updateSavedMeal(event, meal.id)} className="grid gap-3">
                  <FormField label="Meal name">
                    <input
                      required
                      maxLength={120}
                      value={editName}
                      onChange={(event) => setEditName(event.target.value)}
                      className={NUTRITION_FIELD_CLASS}
                    />
                  </FormField>
                  <FormField label="Default destination">
                    <MealTargetSelect value={editMealType} onChange={setEditMealType} ariaLabel={`Default meal for ${meal.name}`} />
                  </FormField>
                  <fieldset className="grid gap-2">
                    <legend className="mb-1 text-xs font-medium text-secondary">Foods in this meal</legend>
                    {editItems.map((item, index) => (
                      <div key={item.id} className="flex items-center gap-2 rounded-lg border border-secondary bg-secondary/40 p-2">
                        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-primary text-[11px] font-semibold text-tertiary ring-1 ring-secondary ring-inset">
                          {index + 1}
                        </span>
                        <input
                          required
                          maxLength={250}
                          aria-label={`Food ${index + 1} name`}
                          value={item.description}
                          onChange={(event) => setEditItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, description: event.target.value } : candidate))}
                          className={`${NUTRITION_FIELD_CLASS} h-9 min-w-0 flex-1`}
                        />
                        <Button
                          type="button"
                          size="xs"
                          color="tertiary-destructive"
                          iconLeading={Trash01}
                          aria-label={`Remove ${item.description} from saved meal`}
                          title={editItems.length === 1 ? "A saved meal needs at least one food" : "Remove food"}
                          isDisabled={mutation.busy || editItems.length === 1}
                          onClick={() => setEditItems((current) => current.filter((candidate) => candidate.id !== item.id))}
                        />
                      </div>
                    ))}
                  </fieldset>
                  <div className="flex justify-end gap-2">
                    <Button type="button" size="xs" color="secondary" onClick={() => setEditingId(null)} isDisabled={mutation.busy}>Cancel</Button>
                    <Button type="submit" size="xs" iconLeading={Save01} isLoading={mutation.busy}>Save changes</Button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="flex items-start gap-3">
                    <MealIconBadge mealType={targetFor(meal)} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-primary">{meal.name}</p>
                      <p className="mt-0.5 text-xs text-tertiary">
                        {meal.itemCount} {meal.itemCount === 1 ? "food" : "foods"} · {rounded(meal.totals.calories)} kcal
                      </p>
                      {meal.items.length > 0 ? (
                        <p className="mt-1 truncate text-[11px] text-quaternary">
                          {meal.items.slice(0, 3).map((item) => item.description).join(" · ")}
                          {meal.items.length > 3 ? ` · +${meal.items.length - 3} more` : ""}
                        </p>
                      ) : null}
                    </div>
                    <Button type="button" size="xs" color="tertiary" iconLeading={Edit01} aria-label={`Edit ${meal.name}`} title="Edit saved meal" onClick={() => startEdit(meal)} isDisabled={mutation.busy} />
                    <Button
                      type="button"
                      size="xs"
                      color="tertiary-destructive"
                      iconLeading={Trash01}
                      aria-label={`Delete ${meal.name}`}
                      title="Delete saved meal"
                      isDisabled={mutation.busy}
                      onClick={() => {
                        if (!window.confirm(`Delete saved meal “${meal.name}”? Logged food will not be affected.`)) return;
                        void runSavedMealAction(meal.id, "nutrition:deleteSavedMeal", { savedMealId: meal.id }, "Saved meal deleted");
                      }}
                    />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-secondary pt-3">
                    <MealTargetSelect
                      value={targetFor(meal)}
                      onChange={(mealType) => setTarget(meal.id, mealType)}
                      ariaLabel={`Destination for ${meal.name}`}
                      compact
                    />
                    <Button
                      type="button"
                      size="xs"
                      iconLeading={Plus}
                      isLoading={mutation.busy && pendingId === meal.id}
                      isDisabled={mutation.busy && pendingId !== meal.id}
                      onClick={() => void runSavedMealAction(
                        meal.id,
                        "nutrition:logSavedMeal",
                        { savedMealId: meal.id, date: data.date, mealType: targetFor(meal) },
                        `${meal.name} logged to ${MEAL_STYLE[targetFor(meal)].label.toLowerCase()}`,
                      )}
                      className="ml-auto"
                    >
                      Log meal
                    </Button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      <NutritionMutationNote error={mutation.error} success={mutation.success} />
    </PersonalCard>
  );
}

function ProductsSummary({ data }: { data: NutritionData }) {
  return (
    <PersonalCard
      title="Food products"
      action={
        <span className="text-xs text-tertiary">
          {data.productSummary.usedProducts} used ·{" "}
          {data.productSummary.barcoded} barcoded
        </span>
      }
    >
      <PersonalTable
        rows={data.products.slice(0, 20)}
        empty="No reusable food products saved."
        columns={[
          {
            key: "name",
            label: "Product",
            render: (row) => (
              <span className="font-medium text-primary">{row.name}</span>
            ),
          },
          {
            key: "serving",
            label: "Serving",
            render: (row) =>
              row.quantity == null
                ? "—"
                : `${row.quantity}${row.unit ? ` ${row.unit}` : ""}`,
          },
          {
            key: "calories",
            label: "Calories",
            align: "right",
            render: (row) => `${rounded(row.calories)} kcal`,
          },
          {
            key: "usage",
            label: "Uses",
            align: "right",
            render: (row) => row.usageCount,
          },
        ]}
      />
      {data.products.length > 20 && (
        <p className="mt-3 text-xs text-tertiary">
          Showing 20 of {data.products.length} products.
        </p>
      )}
    </PersonalCard>
  );
}

function MonthSummary({
  data,
  onChange,
}: {
  data: NutritionData;
  onChange: (date: string) => void;
}) {
  const label = new Date(
    Date.UTC(data.month.year, data.month.month, 1),
  ).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return (
    <PersonalCard
      title={`${label} log`}
      action={
        <span className="text-xs text-tertiary">
          {data.month.loggedDays} logged days ·{" "}
          {rounded(data.month.averageCalories)} avg kcal
        </span>
      }
    >
      {data.month.days.length === 0 ? (
        <EmptyMessage>No nutrition days logged this month.</EmptyMessage>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {data.month.days.map((day) => (
            <button
              key={day.date}
              type="button"
              onClick={() => onChange(day.date)}
              className={`rounded-lg border p-2.5 text-left transition ${day.date === data.date ? "border-brand bg-brand-secondary" : "border-secondary bg-primary hover:bg-secondary"}`}
            >
              <p className="text-xs font-medium text-secondary">
                {new Date(`${day.date}T12:00:00`).toLocaleDateString(
                  undefined,
                  { month: "short", day: "numeric" },
                )}
              </p>
              <p className="mt-1 text-sm font-semibold text-primary">
                {rounded(day.calories)}
              </p>
              <p className="text-[11px] text-quaternary">kcal</p>
            </button>
          ))}
        </div>
      )}
    </PersonalCard>
  );
}

function NutritionDashboard({
  data,
  onDateChange,
  client,
  onMutated,
}: {
  data: NutritionData;
  onDateChange: (date: string) => void;
  client: LifeOSClient;
  onMutated: () => void;
}) {
  const unitSystem: UnitSystem = data.unitSystem === "METRIC" ? "METRIC" : "IMPERIAL";
  return (
    <div className="flex flex-col gap-5">
      <DateNavigation data={data} onChange={onDateChange} />
      <StatGrid
        stats={[
          {
            label: "Calories",
            value: rounded(data.totals.calories),
            detail:
              data.goal?.calories == null
                ? "No goal"
                : `${rounded(data.goal.calories)} kcal goal`,
          },
          {
            label: "Protein",
            value: `${rounded(data.totals.proteinG)} g`,
            detail:
              data.goal?.proteinG == null
                ? "No goal"
                : `${rounded(data.goal.proteinG)} g goal`,
          },
          {
            label: "Meals",
            value: data.meals.length,
            detail: `${data.meals.reduce((sum, meal) => sum + meal.entries.length, 0)} food entries`,
          },
          {
            label: "Water",
            value: formatVolume(data.water.amountMl, unitSystem),
            detail: `${data.water.progress}% of goal`,
          },
        ]}
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <MacroCard
          label="Calories"
          value={data.totals.calories}
          goal={data.goal?.calories ?? null}
          progress={data.progress.calories}
          unit="kcal"
        />
        <MacroCard
          label="Protein"
          value={data.totals.proteinG}
          goal={data.goal?.proteinG ?? null}
          progress={data.progress.proteinG}
          unit="g"
        />
        <MacroCard
          label="Carbohydrates"
          value={data.totals.carbsG}
          goal={data.goal?.carbsG ?? null}
          progress={data.progress.carbsG}
          unit="g"
        />
        <MacroCard
          label="Fat"
          value={data.totals.fatG}
          goal={data.goal?.fatG ?? null}
          progress={data.progress.fatG}
          unit="g"
        />
        <MacroCard
          label="Fiber"
          value={data.totals.fiberG}
          goal={data.goal?.fiberG ?? null}
          progress={data.progress.fiberG}
          unit="g"
        />
      </div>
      <div className="grid items-start gap-5 2xl:grid-cols-[minmax(18rem,0.7fr)_minmax(0,1.3fr)]">
        <div id="nutrition-water"><WaterActions data={data} client={client} onMutated={onMutated} /></div>
        <div id="nutrition-log-food"><FoodLogForm date={data.date} products={data.products} client={client} onMutated={onMutated} /></div>
      </div>
      {data.notes && (
        <PersonalCard title="Day notes">
          <p className="whitespace-pre-wrap text-sm text-secondary">
            {data.notes}
          </p>
        </PersonalCard>
      )}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-primary">Meals</h2>
        <MealsSection data={data} client={client} onMutated={onMutated} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-3">
        <GoalSummary data={data} client={client} onMutated={onMutated} />
        <FavoriteSummary data={data} client={client} onMutated={onMutated} />
        <SavedMealsSummary data={data} client={client} onMutated={onMutated} />
      </div>
      <ProductsSummary data={data} />
      <MonthSummary data={data} onChange={onDateChange} />
    </div>
  );
}

function NutritionProfileForm({ data, client, onMutated }: { data: NutritionData; client: LifeOSClient; onMutated: () => void }) {
  const imperial = data.unitSystem !== "METRIC";
  const profile = data.goalProfile;
  const [gender, setGender] = useState(profile.gender ?? "unspecified");
  const [birthdate, setBirthdate] = useState(profile.birthdate ?? "");
  const [height, setHeight] = useState(profile.heightCm == null ? "" : String(rounded(imperial ? profile.heightCm / 2.54 : profile.heightCm)));
  const [activityLevel, setActivityLevel] = useState(profile.activityLevel ?? "moderate");
  const [dietGoal, setDietGoal] = useState(profile.dietGoal ?? "maintain");
  const [goalWeight, setGoalWeight] = useState(profile.goalWeightKg == null ? "" : String(rounded(imperial ? profile.goalWeightKg * 2.2046226218 : profile.goalWeightKg)));
  const [weeklyChange, setWeeklyChange] = useState(profile.targetWeeklyChangeKg == null ? "0.25" : String(rounded(imperial ? profile.targetWeeklyChangeKg * 2.2046226218 : profile.targetWeeklyChangeKg)));
  const mutation = useNutritionMutation(client, onMutated);
  const currentWeight = profile.currentWeightKg == null ? null : rounded(imperial ? profile.currentWeightKg * 2.2046226218 : profile.currentWeightKg);
  return <PersonalCard title="Nutrition profile & calculated targets">
    <p className="mb-4 text-sm text-tertiary">Targets use your age, height, activity, latest Health/Workouts weight, and goal. You can still override individual macro values below.</p>
    <form onSubmit={(event) => { event.preventDefault(); void mutation.run("nutrition:updateProfileAndCalculate", { gender, birthdate, heightCm: Number(height) * (imperial ? 2.54 : 1), activityLevel, dietGoal, goalWeightKg: goalWeight ? Number(goalWeight) / (imperial ? 2.2046226218 : 1) : null, targetWeeklyChangeKg: weeklyChange ? Number(weeklyChange) / (imperial ? 2.2046226218 : 1) : 0 }, "Profile saved and targets recalculated"); }} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="text-xs font-medium text-secondary">Birthdate<input type="date" required value={birthdate} onChange={(event) => setBirthdate(event.target.value)} className={NUTRITION_FIELD_CLASS} /></label>
      <label className="text-xs font-medium text-secondary">Gender<RichSelect aria-label="Gender" value={gender} onChange={(event) => setGender(event.target.value)} options={[{ value: "unspecified", label: "Prefer not to say" }, { value: "female", label: "Female" }, { value: "male", label: "Male" }, { value: "other", label: "Other / nonbinary" }]} /></label>
      <label className="text-xs font-medium text-secondary">Height ({imperial ? "in" : "cm"})<input type="number" required min={imperial ? 30 : 75} max={imperial ? 108 : 275} step="0.1" value={height} onChange={(event) => setHeight(event.target.value)} className={NUTRITION_FIELD_CLASS} /></label>
      <div className="rounded-lg bg-secondary p-3"><p className="text-xs text-tertiary">Current weight</p><p className="mt-1 font-semibold text-primary">{currentWeight == null ? "Log weight in Health" : `${currentWeight} ${imperial ? "lb" : "kg"}`}</p>{profile.currentWeightDate && <p className="text-xs text-quaternary">{formatDate(profile.currentWeightDate)}</p>}</div>
      <label className="text-xs font-medium text-secondary">Activity level<RichSelect aria-label="Activity level" value={activityLevel} onChange={(event) => setActivityLevel(event.target.value)} options={[{ value: "sedentary", label: "Sedentary" }, { value: "light", label: "Lightly active" }, { value: "moderate", label: "Moderately active" }, { value: "active", label: "Very active" }, { value: "very_active", label: "Athlete / extremely active" }]} /></label>
      <label className="text-xs font-medium text-secondary">Goal<RichSelect aria-label="Nutrition goal" value={dietGoal} onChange={(event) => setDietGoal(event.target.value)} options={[{ value: "maintain", label: "Maintain weight" }, { value: "lose", label: "Lose weight" }, { value: "gain", label: "Gain weight" }]} /></label>
      <label className="text-xs font-medium text-secondary">Goal weight ({imperial ? "lb" : "kg"})<input type="number" min="1" step="0.1" value={goalWeight} onChange={(event) => setGoalWeight(event.target.value)} className={NUTRITION_FIELD_CLASS} /></label>
      <label className="text-xs font-medium text-secondary">Weekly change ({imperial ? "lb" : "kg"})<input type="number" min="0" step="0.05" value={weeklyChange} onChange={(event) => setWeeklyChange(event.target.value)} className={NUTRITION_FIELD_CLASS} /></label>
      <div className="flex items-end justify-end sm:col-span-2 lg:col-span-4"><button disabled={mutation.busy || currentWeight == null} className={NUTRITION_BUTTON_CLASS}>{mutation.busy ? "Calculating…" : "Save & recalculate targets"}</button></div>
    </form>
    <NutritionMutationNote error={mutation.error} success={mutation.success} />
  </PersonalCard>;
}

function NutritionSettings({ data, client, onMutated }: { data: NutritionData; client: LifeOSClient; onMutated: () => void }) {
  return <div className="flex flex-col gap-5"><NutritionProfileForm data={data} client={client} onMutated={onMutated} /><GoalForm data={data} client={client} onMutated={onMutated} /></div>;
}

function scrollToId(id: string) {
  if (typeof document === "undefined") return;
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function nutritionFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that image."));
    reader.onload = () => {
      const value = String(reader.result ?? "");
      resolve(value.includes(",") ? value.slice(value.indexOf(",") + 1) : value);
    };
    reader.readAsDataURL(file);
  });
}

export function NutritionView({ client }: NutritionViewProps) {
  const [date, setDate] = useState(() => localDateKey());
  const [activeTab, setActiveTab] = useState<"overview" | "settings">("overview");
  const query = useLifeOSQuery<NutritionData>(client, "nutrition:getOverview", {
    date,
  });
  const openOverviewSection = (id: string) => {
    setActiveTab("overview");
    window.setTimeout(() => scrollToId(id), 0);
  };

  return (
    <PersonalModuleShell
      title="Nutrition"
      description="Meals, macros, hydration, reusable foods, and saved meal patterns in one desktop dashboard."
      icon={Activity}
      tabs={[{ id: "overview", label: "Overview" }, { id: "settings", label: "Settings" }]}
      activeTab={activeTab}
      onTabChange={(tab) => setActiveTab(tab as "overview" | "settings")}
      hero={{
        gradient: "linear-gradient(120deg, #16a34a 0%, #65a30d 50%, #eab308 100%)",
        eyebrow: "Nutrition",
        actions: [
          { label: "Log food", icon: Plus, variant: "primary", onClick: () => openOverviewSection("nutrition-log-food") },
          { label: "Log water", icon: Droplets01, onClick: () => openOverviewSection("nutrition-water") },
          { label: "Nutrition settings", icon: Settings01, onClick: () => setActiveTab("settings") },
        ],
      }}
    >
      <QueryBoundary
        loading={query.loading}
        error={query.error}
        onRetry={query.refresh}
      >
        {query.data ? (
          activeTab === "overview" ? <NutritionDashboard
            data={query.data}
            onDateChange={setDate}
            client={client}
            onMutated={query.refresh}
          /> : <NutritionSettings data={query.data} client={client} onMutated={query.refresh} />
        ) : (
          <EmptyMessage>No nutrition data was returned.</EmptyMessage>
        )}
      </QueryBoundary>
    </PersonalModuleShell>
  );
}
