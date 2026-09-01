import { useMemo, useState, type FC, type FormEvent, type ReactNode } from "react";
import {
  Activity,
  ActivityHeart,
  BarChartSquare02,
  BookOpen01,
  Calendar,
  Camera01,
  Check,
  CheckCircle,
  Droplets01,
  Edit01,
  FileHeart01,
  Heart,
  LineChartUp02,
  Moon01,
  Plus,
  Scale01,
  ShieldTick,
  Target04,
  Thermometer01,
  Trash01,
  X,
} from "@untitledui/icons";
import { RichSelect } from "@/components/base/select/rich-select";
import { Button } from "@/components/base/buttons/button";
import {
  formatHeight,
  formatVolume,
  formatWeight,
  heightToDisplay,
  heightUnit,
  parseHeightInput,
  parseVolumeInput,
  parseWeightInput,
  volumeToDisplay,
  volumeUnit,
  weightToDisplay,
  weightUnit,
  type UnitSystem,
} from "@/lib/units";
import type { NavTarget } from "../nav";
import { HabitHeatmap } from "./health/habits/habit-heatmap";
import { FormModal } from "./health/_components/form-modal";
import { TrendChart, type TrendPoint } from "./health/_components/trend-chart";
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

const HEALTH_TABS = [
  { id: "overview", label: "Overview", query: "health:getOverview" },
  { id: "metrics", label: "Metrics", query: "health:getMetrics" },
  { id: "goals", label: "Goals", query: "health:getGoals" },
  { id: "vitals", label: "Vitals", query: "health:getVitals" },
  { id: "sleep", label: "Sleep", query: "health:getSleep" },
  { id: "habits", label: "Habits", query: "health:getHabits" },
  { id: "journal", label: "Journal", query: "health:getJournal" },
  { id: "medical", label: "Medical", query: "health:getMedical" },
  { id: "photos", label: "Photos", query: "health:getPhotos" },
  { id: "sobriety", label: "Sobriety", query: "health:getSobriety" },
  { id: "peptides", label: "Peptides", query: "health:getPeptides" },
  { id: "medications", label: "Medications", query: "health:getMedications" },
] as const;

type HealthTabId = (typeof HEALTH_TABS)[number]["id"];
type NullableNumber = number | null;

interface OverviewData {
  unitSystem: string;
  latestWeight: {
    valueKg: number;
    measuredAt: string;
    goalWeightKg: NullableNumber;
  } | null;
  lastSleep: {
    date: string;
    totalMinutes: NullableNumber;
    sleepQuality: NullableNumber;
    feelRested: NullableNumber;
  } | null;
  nutrition: {
    totals: {
      calories: number;
      proteinG: number;
      carbsG: number;
      fatG: number;
    };
    goal: { calories: NullableNumber } | null;
  };
  water: { amountMl: number; goalMl: number };
  habits: {
    completed: number;
    total: number;
    items: Array<{ id: string; name: string; completed: boolean }>;
  };
  sobriety: {
    counters: Array<{ id: string; name: string; currentDays: number }>;
    longest: { name: string; currentDays: number } | null;
  };
  trends: {
    weight: Array<{ date: string; valueKg: number }>;
    sleep: Array<{
      date: string;
      hours: NullableNumber;
      quality: NullableNumber;
    }>;
  };
}

interface GoalsData {
  unitSystem: string;
  profile: {
    gender: string | null;
    birthdate: string | null;
    age: NullableNumber;
    heightCm: NullableNumber;
    activityLevel: string | null;
    dietGoal: string | null;
    targetWeeklyChangeKg: NullableNumber;
    goalWeightKg: NullableNumber;
    goalBodyFatPct: NullableNumber;
    goalTargetDate: string | null;
    waterGoalMl: number;
  } | null;
  nutritionGoal: {
    calories: NullableNumber;
    proteinG: NullableNumber;
    carbsG: NullableNumber;
    fatG: NullableNumber;
    fiberG: NullableNumber;
    updatedAt: string;
  } | null;
  current: {
    weightKg: NullableNumber;
    bodyFatPct: NullableNumber;
    bmi: NullableNumber;
    measuredAt: string | null;
  };
  readiness: {
    complete: boolean;
    completedFields: number;
    totalFields: number;
    missingFields: string[];
  };
}

interface HabitsData {
  habits: Array<{
    id: string;
    name: string;
    description: string | null;
    category: string | null;
    frequency: string | null;
    priority: string | null;
    habitType?: string | null;
    color?: string | null;
    targetCount?: number | null;
    targetDays?: number | null;
    daysOfWeek?: string[];
    icon?: string | null;
    cue?: string | null;
    routine?: string | null;
    reward?: string | null;
    stackAfterHabitId?: string | null;
    difficulty?: string | null;
    reminderTime?: string | null;
    createdAt?: string;
    active: boolean;
    completedToday: boolean;
    logDates: string[];
    logs?: Array<{ date: string; count: number; notes: string | null }>;
    milestones: Array<{
      id: string;
      milestoneDate: string;
      description: string | null;
    }>;
  }>;
  summary: {
    total: number;
    active: number;
    completedToday: number;
    completionRateToday: number;
    checkInsInWindow: number;
  };
}

interface JournalData {
  entries: Array<{
    id: string;
    date: string;
    reflection: string | null;
    gratitude: string | null;
    overallRating: NullableNumber;
    realmRatings: Array<{ realm: string; rating: number }>;
  }>;
  summary: {
    entries: number;
    averageRating: NullableNumber;
    gratitudeEntries: number;
    latestDate: string | null;
    realmAverages: Array<{ realm: string; average: number }>;
  };
}

interface MedicalData {
  records: Array<{
    id: string;
    name: string;
    recordDate: string | null;
    notes: string | null;
    fileName: string | null;
    fileUrl: string | null;
    mimeType?: string | null;
    fileSize?: number | null;
    providerId?: string | null;
    doctorId?: string | null;
    eventId?: string | null;
    providerName: string | null;
    doctorName: string | null;
    extractedItems: Array<{
      id: string;
      label: string;
      value: string | null;
      unit: string | null;
    }>;
  }>;
  providers: Array<{
    id: string;
    name: string;
    address: string | null;
    phone: string | null;
    website: string | null;
    notes: string | null;
  }>;
  doctors: Array<{
    id: string;
    name: string;
    profession: string | null;
    location: string | null;
    phone: string | null;
    email: string | null;
    notes?: string | null;
    providerId?: string | null;
  }>;
  appointments: Array<{
    id: string;
    title: string;
    description: string | null;
    location: string | null;
    startsAt: string;
    endsAt: string | null;
    visitNotes: string | null;
    providerId: string | null;
    doctorId: string | null;
    providerName: string | null;
    doctorName: string | null;
    records: Array<{ id: string; name: string }>;
  }>;
  summary: {
    records: number;
    providers: number;
    doctors: number;
    extractedItems: number;
    latestRecordDate: string | null;
  };
}

interface MedicationItem {
  id: string;
  name: string;
  dosageAmount: NullableNumber;
  dosageUnit: string | null;
  frequency: string | null;
  notes: string | null;
  active: boolean;
}
interface DoseItem {
  id: string;
  scheduleName: string;
  scheduleKind: string;
  dosage: string | null;
  scheduledAt: string;
  loggedAt: string | null;
  skippedAt: string | null;
  status: string;
}
interface MedicationsData {
  timeZone?: string;
  medications: MedicationItem[];
  supplements: MedicationItem[];
  schedules: Array<{
    id: string;
    kind: string;
    name: string;
    dosage: string | null;
    notes?: string | null;
    pattern: string;
    everyN?: number | null;
    daysOfWeek: string[];
    timesOfDay: string[];
    startDate?: string | null;
    endDate?: string | null;
  }>;
  doses: DoseItem[];
  doseHistory30: DoseItem[];
  logs: Array<{
    id: string;
    therapeuticKind: string;
    name: string | null;
    doseAmount: NullableNumber;
    doseUnit: string | null;
    loggedAt: string;
    notes?: string | null;
  }>;
  adherence: {
    scheduled: number;
    taken: number;
    skipped: number;
    missed: number;
    percentage: NullableNumber;
  };
  summary: {
    activeMedications: number;
    activeSupplements: number;
    activeSchedules: number;
    upcomingDoses: number;
  };
}

interface MetricsData {
  unitSystem?: string;
  weightSeries?: Array<{
    day: string;
    kg: number;
    source: "body_measurement" | "health_metric";
  }>;
  metrics: Array<{
    id: string;
    metricType: string;
    customName: string | null;
    value: number;
    unit: string | null;
    measuredAt: string;
    notes: string | null;
  }>;
  girths: Array<{ label: string; cm: number }>;
  girthDate: string | null;
  latestByType: Array<{
    id: string;
    type: string;
    value: number;
    unit: string | null;
    measuredAt: string;
  }>;
  summary: {
    totalEntries: number;
    metricTypes: number;
    latestWeightKg: NullableNumber;
    latestBodyFatPct: NullableNumber;
  };
}

interface PeptidesData {
  peptides: Array<{
    id: string;
    name: string;
    vialMg: number;
    doseUnit: string;
    waterMl: number;
    concentrationMgPerMl: NullableNumber;
    syringeUnitsPerMl?: number;
    vialsOwned: number;
    vialsOpened?: number;
    activeVialRemainingMl: number;
    cycleStartDate: string | null;
    currentWeek: NullableNumber;
    blocks: Array<{
      id: string;
      startWeek: number;
      endWeek: number;
      dosePerAdmin: number;
      dosesPerWeek: number;
      note: string | null;
      order?: number;
    }>;
    logs: Array<{
      id: string;
      blockId?: string | null;
      date: string;
      dose: number;
      units?: number;
      mlUsed?: number;
      site: string | null;
    }>;
    lastDose: { date: string; dose: number; site: string | null } | null;
  }>;
  summary: {
    peptides: number;
    activeCycles: number;
    vialsOwned: number;
    dosesLogged: number;
  };
}

interface PhotosData {
  photos: Array<{
    id: string;
    url: string | null;
    originalUrl: string | null;
    assetKey: string;
    angle: string | null;
    phase: string | null;
    weightKg: NullableNumber;
    notes: string | null;
    takenAt: string;
    processed: boolean;
    workout: { id: string; name: string; date: string } | null;
  }>;
  workoutOptions: Array<{ id: string; name: string; date: string }>;
  unitSystem: "IMPERIAL" | "METRIC";
  summary: {
    photos: number;
    processed: number;
    linkedToWorkout: number;
    angles: { front: number; side: number; back: number };
  };
}

interface SleepData {
  entries: Array<{
    id: string;
    date: string;
    bedtime: string | null;
    wakeTime: string | null;
    totalMinutes: NullableNumber;
    sleepQuality: NullableNumber;
    feelRested: NullableNumber;
    sleepLatencyMin: NullableNumber;
    restingHrBpm: NullableNumber;
    hrvMs: NullableNumber;
    notes: string | null;
    interruptions: Array<{
      reason: string | null;
      durationMinutes: NullableNumber;
    }>;
  }>;
  summary: {
    entries: number;
    latestDate: string | null;
    averageMinutes: NullableNumber;
    averageQuality: NullableNumber;
    averageRested: NullableNumber;
    averageLatencyMin: NullableNumber;
    interruptions: number;
  };
}

interface SobrietyData {
  counters: Array<{
    id: string;
    name: string;
    description: string | null;
    color?: string | null;
    icon?: string | null;
    startedAt: string;
    archived: boolean;
    currentStreakDays: number;
    bestStreakDays: number;
    relapses: Array<{ id: string; relapsedAt: string; notes: string | null }>;
  }>;
  substanceLogs: Array<{
    id: string;
    substanceType: string;
    amount: NullableNumber;
    unit: string | null;
    loggedAt: string;
    notes: string | null;
  }>;
  customTypes: Array<{ id: string; name: string }>;
  summary: {
    activeCounters: number;
    longestCurrentDays: number;
    longestBestDays: number;
    substanceLogs: number;
    relapses: number;
  };
}

interface VitalsData {
  unitSystem?: string;
  vitals: Array<{
    id: string;
    vitalType: string;
    customName: string | null;
    value: NullableNumber;
    value2: NullableNumber;
    unit: string | null;
    measuredAt: string;
    notes: string | null;
    fields: Array<{ label: string; value: number; unit: string | null }>;
  }>;
  latestByType: Array<{
    id: string;
    type: string;
    value: NullableNumber;
    value2: NullableNumber;
    unit: string | null;
    measuredAt: string;
  }>;
  summary: {
    readings: number;
    vitalTypes: number;
    readingsLast30Days: number;
    latestMeasuredAt: string | null;
  };
}

type HealthResult =
  | OverviewData
  | GoalsData
  | HabitsData
  | JournalData
  | MedicalData
  | MedicationsData
  | MetricsData
  | PeptidesData
  | PhotosData
  | SleepData
  | SobrietyData
  | VitalsData;

export interface HealthViewProps {
  client: LifeOSClient;
  onNavigate: (
    target: NavTarget | ((previous: NavTarget) => NavTarget),
  ) => void;
  state?: unknown;
  actions?: unknown;
}

function valueOrDash(value: number | null | undefined, suffix = ""): string {
  return value == null || !Number.isFinite(value)
    ? "—"
    : `${Math.round(value * 10) / 10}${suffix}`;
}

function formatDecimal(value: number | null | undefined, maximumFractionDigits = 4): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString(undefined, { maximumFractionDigits });
}

function formatMinutes(minutes: NullableNumber): string {
  if (minutes == null) return "—";
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatDose(item: {
  dosageAmount: NullableNumber;
  dosageUnit: string | null;
}): string {
  return item.dosageAmount == null
    ? "—"
    : `${item.dosageAmount}${item.dosageUnit ? ` ${item.dosageUnit}` : ""}`;
}

function formatVital(reading: {
  value: NullableNumber;
  value2: NullableNumber;
  unit: string | null;
}): string {
  const main =
    reading.value == null
      ? "—"
      : reading.value2 == null
        ? `${reading.value}`
        : `${reading.value}/${reading.value2}`;
  return `${main}${reading.unit ? ` ${reading.unit}` : ""}`;
}

function celsiusToFahrenheit(value: number): number {
  return Math.round((value * 1.8 + 32) * 10) / 10;
}

function temperatureToDisplay(
  value: NullableNumber,
  unitSystem: UnitSystem,
): NullableNumber {
  return value == null || unitSystem === "METRIC"
    ? value
    : celsiusToFahrenheit(value);
}

function temperatureUnit(unitSystem: UnitSystem): "°C" | "°F" {
  return unitSystem === "METRIC" ? "°C" : "°F";
}

function formatVitalForDisplay(
  reading: {
    value: NullableNumber;
    value2: NullableNumber;
    unit: string | null;
  },
  vitalType: string,
  unitSystem: UnitSystem,
): string {
  if (vitalType !== "temperature") return formatVital(reading);
  return formatVital({
    value: temperatureToDisplay(reading.value, unitSystem),
    value2: temperatureToDisplay(reading.value2, unitSystem),
    unit: temperatureUnit(unitSystem),
  });
}

const HEALTH_FIELD_CLASS =
  "w-full min-w-0 rounded-lg border border-secondary bg-primary px-3 py-2 text-sm text-primary outline-none focus:border-brand";
const asUnitSystem = (value: string | undefined): UnitSystem =>
  value === "METRIC" ? "METRIC" : "IMPERIAL";

function displayWeight(valueKg: number | null | undefined, unitSystem: string | undefined) {
  return formatWeight(valueKg, asUnitSystem(unitSystem));
}
const HEALTH_BUTTON_CLASS =
  "rounded-lg bg-brand-solid px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50";

function shortDate(value: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function startOfLocalDay(value: string | Date): Date {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function dateKey(value: string | Date): string {
  return localDateKey(startOfLocalDay(value));
}

function HealthChartCard({
  title,
  description,
  icon: Icon,
  action,
  children,
  className = "",
}: {
  title: string;
  description: string;
  icon: FC<{ className?: string }>;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`min-w-0 overflow-hidden rounded-xl border border-secondary bg-primary shadow-xs ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-secondary px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-secondary text-brand-secondary">
            <Icon className="size-4.5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-md font-semibold text-primary">{title}</h2>
            <p className="mt-0.5 text-xs text-tertiary">{description}</p>
          </div>
        </div>
        {action && <div className="min-w-0 max-w-full sm:shrink-0">{action}</div>}
      </div>
      <div className="min-w-0 p-4 sm:p-5">{children}</div>
    </section>
  );
}

function LegendPill({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary">
      <span className="size-2 rounded-full" style={{ backgroundColor: color }} />
      {children}
    </span>
  );
}

function RowActions({
  onEdit,
  onDelete,
  editLabel = "Edit",
  deleteLabel = "Delete",
  children,
}: {
  onEdit?: () => void;
  onDelete?: () => void;
  editLabel?: string;
  deleteLabel?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center justify-end gap-1">
      {children}
      {onEdit && (
        <button type="button" onClick={onEdit} aria-label={editLabel} title={editLabel} className="rounded-md p-1.5 text-fg-quaternary hover:bg-primary_hover hover:text-fg-secondary">
          <Edit01 className="size-4" />
        </button>
      )}
      {onDelete && (
        <button type="button" onClick={onDelete} aria-label={deleteLabel} title={deleteLabel} className="rounded-md p-1.5 text-fg-quaternary hover:bg-error-primary hover:text-error-primary">
          <Trash01 className="size-4" />
        </button>
      )}
    </div>
  );
}

function confirmRemove(label: string): boolean {
  return window.confirm(`Delete ${label}? This cannot be undone.`);
}

function completionActivity(
  dates: string[],
  days: number,
): Array<{ label: string; completed: number }> {
  const counts = new Map<string, number>();
  dates.forEach((date) => counts.set(date.slice(0, 10), (counts.get(date.slice(0, 10)) ?? 0) + 1));
  return Array.from({ length: days }, (_, index) => {
    const day = new Date();
    day.setHours(12, 0, 0, 0);
    day.setDate(day.getDate() - (days - index - 1));
    const key = localDateKey(day);
    return { label: shortDate(key), completed: counts.get(key) ?? 0 };
  });
}

function todayInput(): string {
  return localDateKey();
}

function useHealthMutation(client: LifeOSClient, onMutated: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const run = async (
    type: string,
    payload: Record<string, unknown>,
    message = "Saved",
  ): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    setSuccess(null);
    const requestId = `health_mutation_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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
  return { run, busy, error, success };
}

function MutationNote({
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

function MetricLogForm({
  client,
  onMutated,
  unitSystem,
}: {
  client: LifeOSClient;
  onMutated: () => void;
  unitSystem?: string;
}) {
  const [metricType, setMetricType] = useState("weight");
  const [customName, setCustomName] = useState("");
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState(unitSystem === "METRIC" ? "kg" : "lb");
  const mutation = useHealthMutation(client, onMutated);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await mutation.run(
      "health:createMetric",
      { metricType, customName, value, unit },
      "Metric logged",
    );
    if (saved) setValue("");
  };
  return (
    <PersonalCard title="Log a body metric">
      <form
        onSubmit={submit}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
      >
        <RichSelect
          aria-label="Metric type"
          value={metricType}
          onChange={(event) => {
            const next = event.target.value;
            setMetricType(next);
            if (next === "weight") setUnit(unitSystem === "METRIC" ? "kg" : "lb");
            if (next === "waist") setUnit(unitSystem === "METRIC" ? "cm" : "in");
            if (next === "body_fat_pct") setUnit("%");
            if (next === "resting_heart_rate") setUnit("bpm");
          }}
          options={[{ value: "weight", label: "Weight" }, { value: "body_fat_pct", label: "Body fat" }, { value: "waist", label: "Waist" }, { value: "resting_heart_rate", label: "Resting heart rate" }, { value: "custom", label: "Custom" }]}
        />
        {metricType === "custom" ? (
          <input
            aria-label="Custom metric name"
            value={customName}
            onChange={(event) => setCustomName(event.target.value)}
            placeholder="Metric name"
            required
            maxLength={100}
            className={HEALTH_FIELD_CLASS}
          />
        ) : (
          <div className="hidden lg:block" />
        )}
        <input
          aria-label="Metric value"
          type="number"
          step="any"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Value"
          required
          className={HEALTH_FIELD_CLASS}
        />
        <input
          aria-label="Metric unit"
          value={unit}
          onChange={(event) => setUnit(event.target.value)}
          placeholder="Unit"
          maxLength={30}
          className={HEALTH_FIELD_CLASS}
        />
        <button disabled={mutation.busy} className={HEALTH_BUTTON_CLASS}>
          {mutation.busy ? "Saving…" : "Log metric"}
        </button>
      </form>
      <MutationNote error={mutation.error} success={mutation.success} />
    </PersonalCard>
  );
}

function VitalLogForm({
  client,
  onMutated,
  unitSystem,
}: {
  client: LifeOSClient;
  onMutated: () => void;
  unitSystem?: string;
}) {
  const units = asUnitSystem(unitSystem);
  const [vitalType, setVitalType] = useState("blood_pressure");
  const [customName, setCustomName] = useState("");
  const [value, setValue] = useState("");
  const [value2, setValue2] = useState("");
  const [unit, setUnit] = useState("mmHg");
  const mutation = useHealthMutation(client, onMutated);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await mutation.run(
      "health:createVital",
      { vitalType, customName, value, value2, unit },
      "Vital logged",
    );
    if (saved) {
      setValue("");
      setValue2("");
    }
  };
  return (
    <PersonalCard title="Log a vital reading">
      <form
        onSubmit={submit}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6"
      >
        <RichSelect
          aria-label="Vital type"
          value={vitalType}
          onChange={(event) => {
            const next = event.target.value;
            setVitalType(next);
            setUnit(
              next === "blood_pressure"
                ? "mmHg"
                : next === "heart_rate"
                  ? "bpm"
                  : next === "temperature"
                    ? temperatureUnit(units)
                    : next === "spo2"
                      ? "%"
                      : "",
            );
          }}
          options={[{ value: "blood_pressure", label: "Blood pressure" }, { value: "heart_rate", label: "Heart rate" }, { value: "temperature", label: "Temperature" }, { value: "spo2", label: "Blood oxygen" }, { value: "respiratory_rate", label: "Respiratory rate" }, { value: "blood_glucose", label: "Blood glucose" }, { value: "custom", label: "Custom" }]}
        />
        {vitalType === "custom" ? (
          <input
            aria-label="Custom vital name"
            value={customName}
            onChange={(event) => setCustomName(event.target.value)}
            placeholder="Vital name"
            required
            maxLength={100}
            className={HEALTH_FIELD_CLASS}
          />
        ) : (
          <div className="hidden lg:block" />
        )}
        <input
          aria-label="Primary vital value"
          type="number"
          step="any"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={vitalType === "blood_pressure" ? "Systolic" : "Value"}
          required
          className={HEALTH_FIELD_CLASS}
        />
        <input
          aria-label="Secondary vital value"
          type="number"
          step="any"
          value={value2}
          onChange={(event) => setValue2(event.target.value)}
          placeholder={
            vitalType === "blood_pressure" ? "Diastolic" : "Optional second"
          }
          className={HEALTH_FIELD_CLASS}
        />
        <input
          aria-label="Vital unit"
          value={unit}
          onChange={(event) => setUnit(event.target.value)}
          readOnly={vitalType === "temperature"}
          placeholder="Unit"
          maxLength={30}
          className={HEALTH_FIELD_CLASS}
        />
        <button disabled={mutation.busy} className={HEALTH_BUTTON_CLASS}>
          {mutation.busy ? "Saving…" : "Log vital"}
        </button>
      </form>
      <MutationNote error={mutation.error} success={mutation.success} />
    </PersonalCard>
  );
}

function SleepLogForm({
  client,
  onMutated,
  entries,
  onEditExisting,
}: {
  client: LifeOSClient;
  onMutated: () => void;
  entries: SleepData["entries"];
  onEditExisting: (entry: SleepData["entries"][number]) => void;
}) {
  const [date, setDate] = useState(todayInput);
  const [totalMinutes, setTotalMinutes] = useState("480");
  const [sleepQuality, setSleepQuality] = useState("3");
  const [feelRested, setFeelRested] = useState("3");
  const [notes, setNotes] = useState("");
  const mutation = useHealthMutation(client, onMutated);
  return (
    <PersonalCard title="Log sleep">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const existing = entries.find((entry) => entry.date.slice(0, 10) === date);
          if (existing) {
            onEditExisting(existing);
            return;
          }
          void mutation.run(
            "health:upsertSleep",
            { date, totalMinutes, sleepQuality, feelRested, notes },
            "Sleep saved",
          );
        }}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
      >
        <input
          aria-label="Sleep date"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          required
          className={HEALTH_FIELD_CLASS}
        />
        <input
          aria-label="Total sleep minutes"
          type="number"
          min="0"
          max="1440"
          value={totalMinutes}
          onChange={(event) => setTotalMinutes(event.target.value)}
          placeholder="Minutes"
          required
          className={HEALTH_FIELD_CLASS}
        />
        <RichSelect
          aria-label="Sleep quality"
          value={sleepQuality}
          onChange={(event) => setSleepQuality(event.target.value)}
          options={[1, 2, 3, 4, 5].map((score) => ({ value: String(score), label: `Quality ${score}/5` }))}
        />
        <RichSelect
          aria-label="Rested score"
          value={feelRested}
          onChange={(event) => setFeelRested(event.target.value)}
          options={[1, 2, 3, 4, 5].map((score) => ({ value: String(score), label: `Rested ${score}/5` }))}
        />
        <button disabled={mutation.busy} className={HEALTH_BUTTON_CLASS}>
          {mutation.busy ? "Saving…" : "Save sleep"}
        </button>
        <textarea
          aria-label="Sleep notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Optional notes"
          maxLength={2000}
          className={`${HEALTH_FIELD_CLASS} sm:col-span-2 lg:col-span-5`}
        />
      </form>
      <MutationNote error={mutation.error} success={mutation.success} />
    </PersonalCard>
  );
}

function JournalEntryForm({
  client,
  onMutated,
}: {
  client: LifeOSClient;
  onMutated: () => void;
}) {
  const [date, setDate] = useState(todayInput);
  const [reflection, setReflection] = useState("");
  const [gratitude, setGratitude] = useState("");
  const [overallRating, setOverallRating] = useState("7");
  const [preview, setPreview] = useState(false);
  const mutation = useHealthMutation(client, onMutated);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await mutation.run(
      "health:upsertJournal",
      { date, reflection, gratitude, overallRating },
      "Journal entry saved",
    );
    if (saved) {
      setReflection("");
      setGratitude("");
    }
  };
  return (
    <PersonalCard title="Write a journal entry" action={<button type="button" onClick={() => setPreview((value) => !value)} className="rounded-lg border border-secondary px-3 py-1.5 text-xs font-semibold text-secondary">{preview ? "Continue writing" : "Preview markdown"}</button>}>
      <form onSubmit={submit} className="grid gap-3 lg:grid-cols-6">
        <input
          aria-label="Journal date"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          required
          className={HEALTH_FIELD_CLASS}
        />
        <RichSelect
          aria-label="Overall rating"
          value={overallRating}
          onChange={(event) => setOverallRating(event.target.value)}
          options={Array.from({ length: 10 }, (_, index) => index + 1).map((score) => ({ value: String(score), label: `${score}/10` }))}
        />
        {!preview ? <><textarea
          aria-label="Reflection"
          value={reflection}
          onChange={(event) => setReflection(event.target.value)}
          placeholder="Reflection — headings, lists, and quotes are supported"
          maxLength={10000}
          rows={10}
          className={`${HEALTH_FIELD_CLASS} lg:col-span-3`}
        />
        <textarea
          aria-label="Gratitude"
          value={gratitude}
          onChange={(event) => setGratitude(event.target.value)}
          placeholder="Gratitude"
          maxLength={5000}
          rows={10}
          className={`${HEALTH_FIELD_CLASS} lg:col-span-3`}
        />
        </> : <div className="grid gap-4 rounded-xl border border-secondary bg-secondary_subtle p-4 lg:col-span-6 lg:grid-cols-2"><div><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-quaternary">Reflection preview</p><JournalMarkdown text={reflection} empty="Nothing written yet." /></div><div><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-quaternary">Gratitude preview</p><JournalMarkdown text={gratitude} empty="Nothing written yet." /></div></div>}
        <button disabled={mutation.busy} className={HEALTH_BUTTON_CLASS}>
          {mutation.busy ? "Saving…" : "Save entry"}
        </button>
      </form>
      <p className="mt-2 text-xs text-quaternary">Markdown: use # headings, - lists, and &gt; quotes.</p>
      <MutationNote error={mutation.error} success={mutation.success} />
    </PersonalCard>
  );
}

function JournalMarkdown({ text, empty = "—" }: { text: string; empty?: string }) {
  if (!text.trim()) return <p className="text-sm text-tertiary">{empty}</p>;
  return <div className="space-y-1.5 text-sm text-secondary">{text.split(/\r?\n/).map((line, index) => {
    if (line.startsWith("### ")) return <h4 key={index} className="font-semibold text-primary">{line.slice(4)}</h4>;
    if (line.startsWith("## ")) return <h3 key={index} className="text-md font-semibold text-primary">{line.slice(3)}</h3>;
    if (line.startsWith("# ")) return <h2 key={index} className="text-lg font-semibold text-primary">{line.slice(2)}</h2>;
    if (/^[-*] /.test(line)) return <p key={index} className="pl-4 before:mr-2 before:content-['•']">{line.slice(2)}</p>;
    if (line.startsWith("> ")) return <blockquote key={index} className="border-l-2 border-brand pl-3 italic text-tertiary">{line.slice(2)}</blockquote>;
    return line ? <p key={index}>{line}</p> : <div key={index} className="h-2" />;
  })}</div>;
}

function MedicationLogForm({
  client,
  onMutated,
}: {
  client: LifeOSClient;
  onMutated: () => void;
}) {
  const [name, setName] = useState("");
  const [dosageAmount, setDosageAmount] = useState("");
  const [dosageUnit, setDosageUnit] = useState("mg");
  const [frequency, setFrequency] = useState("");
  const mutation = useHealthMutation(client, onMutated);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await mutation.run(
      "health:saveMedication",
      { name, dosageAmount, dosageUnit, frequency, active: true },
      "Medication saved",
    );
    if (saved) {
      setName("");
      setDosageAmount("");
      setFrequency("");
    }
  };
  return (
    <PersonalCard title="Add a medication">
      <form
        onSubmit={submit}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
      >
        <input
          aria-label="Medication name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Medication"
          required
          maxLength={150}
          className={HEALTH_FIELD_CLASS}
        />
        <input
          aria-label="Dose amount"
          type="number"
          min="0"
          step="any"
          value={dosageAmount}
          onChange={(event) => setDosageAmount(event.target.value)}
          placeholder="Dose"
          className={HEALTH_FIELD_CLASS}
        />
        <input
          aria-label="Dose unit"
          value={dosageUnit}
          onChange={(event) => setDosageUnit(event.target.value)}
          placeholder="Unit"
          maxLength={30}
          className={HEALTH_FIELD_CLASS}
        />
        <input
          aria-label="Medication frequency"
          value={frequency}
          onChange={(event) => setFrequency(event.target.value)}
          placeholder="e.g. once daily"
          maxLength={100}
          className={HEALTH_FIELD_CLASS}
        />
        <button disabled={mutation.busy} className={HEALTH_BUTTON_CLASS}>
          {mutation.busy ? "Saving…" : "Add medication"}
        </button>
      </form>
      <MutationNote error={mutation.error} success={mutation.success} />
    </PersonalCard>
  );
}

function HabitControls({
  client,
  data,
  onMutated,
}: {
  client: LifeOSClient;
  data: HabitsData;
  onMutated: () => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const mutation = useHealthMutation(client, onMutated);
  const create = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await mutation.run(
      "health:createHabit",
      { name, category },
      "Habit created",
    );
    if (saved) {
      setName("");
      setCategory("");
    }
  };
  return (
    <>
      <PersonalCard title="Add a daily habit">
        <form
          onSubmit={create}
          className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]"
        >
          <input
            aria-label="Habit name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Habit name"
            required
            maxLength={120}
            className={HEALTH_FIELD_CLASS}
          />
          <input
            aria-label="Habit category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            placeholder="Category"
            maxLength={80}
            className={HEALTH_FIELD_CLASS}
          />
          <button disabled={mutation.busy} className={HEALTH_BUTTON_CLASS}>
            {mutation.busy ? "Saving…" : "Add habit"}
          </button>
        </form>
        <MutationNote error={mutation.error} success={mutation.success} />
      </PersonalCard>
      <PersonalCard title="Today's check-ins">
        {data.habits.filter((habit) => habit.active).length === 0 ? (
          <EmptyMessage>No active habits to check in.</EmptyMessage>
        ) : (
          <div className="flex flex-wrap gap-2">
            {data.habits
              .filter((habit) => habit.active)
              .map((habit) => (
                <button
                  key={habit.id}
                  type="button"
                  disabled={mutation.busy}
                  onClick={() =>
                    void mutation.run(
                      "health:toggleHabit",
                      { habitId: habit.id, date: todayInput() },
                      habit.completedToday
                        ? "Check-in removed"
                        : "Habit checked in",
                    )
                  }
                  className={`rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-50 ${habit.completedToday ? "border-success bg-success-secondary text-success-primary" : "border-secondary bg-primary text-secondary hover:bg-secondary"}`}
                >
                  {habit.completedToday ? "✓ " : "+ "}
                  {habit.name}
                </button>
              ))}
          </div>
        )}
      </PersonalCard>
    </>
  );
}

function OverviewSection({ data, client, onMutated }: { data: OverviewData; client: LifeOSClient; onMutated: () => void }) {
  const mutation = useHealthMutation(client, onMutated);
  const units = asUnitSystem(data.unitSystem);
  const weightTrend = useMemo<TrendPoint[]>(
    () =>
      data.trends.weight.slice(-30).map((row) => ({
        label: shortDate(row.date),
        weight: weightToDisplay(row.valueKg, units),
      })),
    [data.trends.weight, units],
  );
  const sleepTrend = useMemo<TrendPoint[]>(
    () =>
      data.trends.sleep.slice(-30).map((row) => ({
        label: shortDate(row.date),
        hours: row.hours,
        quality: row.quality,
      })),
    [data.trends.sleep],
  );
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PersonalCard title="Measurement preferences">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-tertiary">Imperial is the default. Choose metric only when you want kg and cm.</p>
          <div className="w-full sm:w-48"><RichSelect aria-label="Unit system" value={data.unitSystem === "METRIC" ? "METRIC" : "IMPERIAL"} onChange={(event) => void mutation.run("health:setUnitSystem", { unitSystem: event.target.value }, "Unit system updated")} options={[{ value: "IMPERIAL", label: "Imperial (lb / in)" }, { value: "METRIC", label: "Metric (kg / cm)" }]} /></div>
        </div>
        <MutationNote error={mutation.error} success={mutation.success} />
      </PersonalCard>
      <StatGrid
        stats={[
          {
            label: "Latest weight",
            value: displayWeight(data.latestWeight?.valueKg, data.unitSystem),
            detail: data.latestWeight
              ? formatDate(data.latestWeight.measuredAt)
              : "No weight logged",
          },
          {
            label: "Last sleep",
            value: formatMinutes(data.lastSleep?.totalMinutes ?? null),
            detail: data.lastSleep
              ? formatDate(data.lastSleep.date)
              : "No sleep logged",
          },
          {
            label: "Calories today",
            value: Math.round(data.nutrition.totals.calories),
            detail: data.nutrition.goal?.calories
              ? `of ${Math.round(data.nutrition.goal.calories)} kcal`
              : "No calorie goal",
          },
          {
            label: "Habits done",
            value: `${data.habits.completed}/${data.habits.total}`,
            detail: "Today",
          },
        ]}
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <PersonalCard title="Water today">
          <p className="mb-3 text-sm text-secondary">
            {formatVolume(data.water.amountMl, units)} /{" "}
            {formatVolume(data.water.goalMl, units)}
          </p>
          <ProgressMeter
            value={data.water.amountMl}
            max={data.water.goalMl}
            label="Daily goal"
          />
        </PersonalCard>
        <PersonalCard title="Daily nutrition">
          <div className="space-y-3">
            <div>
              <div className="mb-1.5 flex items-center justify-between text-xs text-tertiary">
                <span>Calories</span>
                <span>{Math.round(data.nutrition.totals.calories).toLocaleString()} kcal</span>
              </div>
              <ProgressMeter value={data.nutrition.totals.calories} max={data.nutrition.goal?.calories ?? 0} />
            </div>
            <div className="grid grid-cols-3 gap-2 border-t border-secondary pt-3 text-center">
              {[
                ["Protein", data.nutrition.totals.proteinG],
                ["Carbs", data.nutrition.totals.carbsG],
                ["Fat", data.nutrition.totals.fatG],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <p className="text-xs text-tertiary">{label}</p>
                  <p className="mt-0.5 text-sm font-semibold text-primary">{Math.round(Number(value))} g</p>
                </div>
              ))}
            </div>
          </div>
        </PersonalCard>
        <PersonalCard title="Habits due">
          {data.habits.items.length === 0 ? (
            <EmptyMessage>No active habits yet.</EmptyMessage>
          ) : (
            <ul className="space-y-2 text-sm">
              {data.habits.items.slice(0, 6).map((habit) => (
                <li
                  key={habit.id}
                  className="flex items-center gap-2 text-secondary"
                >
                  <span
                    className={
                      habit.completed
                        ? "text-success-primary"
                        : "text-quaternary"
                    }
                  >
                    {habit.completed ? "✓" : "○"}
                  </span>
                  <span
                    className={habit.completed ? "line-through opacity-60" : ""}
                  >
                    {habit.name}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </PersonalCard>
      </div>
      <PersonalCard title="Recovery & consistency">
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-quaternary">Habits today</p>
            <p className="mt-2 text-2xl font-semibold text-primary">{data.habits.completed}/{data.habits.total}</p>
            <p className="mt-1 text-xs text-tertiary">{data.habits.total ? Math.round((data.habits.completed / data.habits.total) * 100) : 0}% complete</p>
          </div>
          <div className="border-t border-secondary pt-4 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-quaternary">Longest sober streak</p>
          {data.sobriety.longest ? (
            <>
              <p className="mt-2 text-2xl font-semibold text-primary">
                {data.sobriety.longest.currentDays} days
              </p>
              <p className="mt-1 text-sm text-tertiary">
                {data.sobriety.longest.name}
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-tertiary">No active sobriety counters.</p>
          )}
          </div>
        </div>
      </PersonalCard>
      <div className="grid gap-5 lg:grid-cols-2">
        <HealthChartCard
          title="Weight trend"
          description={`Last ${weightTrend.length || 0} readings · ${weightUnit(units)}`}
          icon={Scale01}
          action={<LegendPill color="var(--color-brand-500)">Weight</LegendPill>}
        >
          <TrendChart data={weightTrend} series={[{ key: "weight", name: `Weight (${weightUnit(units)})` }]} type="area" fitDomain emptyLabel="No weight history yet" />
        </HealthChartCard>
        <HealthChartCard
          title="Sleep trend"
          description={`Last ${sleepTrend.length || 0} nights · duration and quality`}
          icon={Moon01}
          action={<div className="flex flex-wrap gap-1.5"><LegendPill color="var(--color-brand-500)">Hours</LegendPill><LegendPill color="var(--color-utility-blue-500)">Quality</LegendPill></div>}
        >
          <TrendChart data={sleepTrend} series={[{ key: "hours", name: "Hours" }, { key: "quality", name: "Quality (/5)" }]} type="line" fitDomain emptyLabel="No sleep history yet" />
        </HealthChartCard>
      </div>
    </div>
  );
}

function GoalsSection({
  data,
  client,
  onMutated,
}: {
  data: GoalsData;
  client: LifeOSClient;
  onMutated: () => void;
}) {
  const goals = data.nutritionGoal;
  const profile = data.profile;
  const units = asUnitSystem(data.unitSystem);
  const mutation = useHealthMutation(client, onMutated);
  const [calories, setCalories] = useState(goals?.calories == null ? "" : String(goals.calories));
  const [protein, setProtein] = useState(goals?.proteinG == null ? "" : String(goals.proteinG));
  const [carbs, setCarbs] = useState(goals?.carbsG == null ? "" : String(goals.carbsG));
  const [fat, setFat] = useState(goals?.fatG == null ? "" : String(goals.fatG));
  const [fiber, setFiber] = useState(goals?.fiberG == null ? "" : String(goals.fiberG));
  const [water, setWater] = useState(String(volumeToDisplay(profile?.waterGoalMl ?? 2500, units)));
  const [birthdate, setBirthdate] = useState(profile?.birthdate?.slice(0, 10) ?? "");
  const [gender, setGender] = useState(profile?.gender ?? "unspecified");
  const [height, setHeight] = useState(profile?.heightCm == null ? "" : String(heightToDisplay(profile.heightCm, units)));
  const [activityLevel, setActivityLevel] = useState(() => {
    const stored = profile?.activityLevel?.toLowerCase();
    return stored === "active" ? "very_active" : stored ?? "moderate";
  });
  const [dietGoal, setDietGoal] = useState(profile?.dietGoal ?? "maintain");
  const [goalWeight, setGoalWeight] = useState(profile?.goalWeightKg == null ? "" : String(weightToDisplay(profile.goalWeightKg, units)));
  const [weeklyChange, setWeeklyChange] = useState(profile?.targetWeeklyChangeKg == null ? "" : String(weightToDisplay(profile.targetWeeklyChangeKg, units)));
  const [goalBodyFat, setGoalBodyFat] = useState(profile?.goalBodyFatPct == null ? "" : String(profile.goalBodyFatPct));
  const [goalTargetDate, setGoalTargetDate] = useState(profile?.goalTargetDate?.slice(0, 10) ?? "");
  const macroCalories = {
    protein: (goals?.proteinG ?? 0) * 4,
    carbs: (goals?.carbsG ?? 0) * 4,
    fat: (goals?.fatG ?? 0) * 9,
  };
  const allocatedCalories = macroCalories.protein + macroCalories.carbs + macroCalories.fat;
  return (
    <div className="flex flex-col gap-5">
      <StatGrid
        stats={[
          {
            label: "Current weight",
            value: displayWeight(data.current.weightKg, data.unitSystem),
            detail: data.current.measuredAt
              ? formatDate(data.current.measuredAt)
              : "No measurement",
          },
          {
            label: "Goal weight",
            value: displayWeight(data.profile?.goalWeightKg, data.unitSystem),
            detail: data.profile?.goalTargetDate
              ? `Target ${formatDate(data.profile.goalTargetDate)}`
              : "No target date",
          },
          {
            label: "Body fat",
            value: valueOrDash(data.current.bodyFatPct, "%"),
            detail: data.profile?.goalBodyFatPct
              ? `Goal ${data.profile.goalBodyFatPct}%`
              : "No goal set",
          },
          {
            label: "BMI",
            value: valueOrDash(data.current.bmi),
            detail: `${data.readiness.completedFields}/${data.readiness.totalFields} calculator fields ready`,
          },
        ]}
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <PersonalCard title="Daily nutrition & hydration targets">
          <form
            className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
            onSubmit={(event) => {
              event.preventDefault();
              void mutation.run(
                "health:updateGoals",
                {
                  calories: calories.trim() ? calories : null,
                  proteinG: protein.trim() ? protein : null,
                  carbsG: carbs.trim() ? carbs : null,
                  fatG: fat.trim() ? fat : null,
                  fiberG: fiber.trim() ? fiber : null,
                  waterGoalMl: water.trim() ? parseVolumeInput(water, units) : null,
                },
                "Daily goals updated",
              );
            }}
          >
            {[
              { label: "Calories", value: calories, setter: setCalories, suffix: "kcal", step: "1" },
              { label: "Protein", value: protein, setter: setProtein, suffix: "g", step: "0.1" },
              { label: "Carbohydrates", value: carbs, setter: setCarbs, suffix: "g", step: "0.1" },
              { label: "Fat", value: fat, setter: setFat, suffix: "g", step: "0.1" },
              { label: "Fiber", value: fiber, setter: setFiber, suffix: "g", step: "0.1" },
              { label: "Water", value: water, setter: setWater, suffix: volumeUnit(units), step: "0.1" },
            ].map(({ label, value, setter, suffix, step }) => (
              <label key={label} className="text-xs font-medium text-secondary">
                {label} ({suffix})
                <input
                  type="number"
                  min={label === "Water" ? volumeToDisplay(250, units) : 0}
                  step={step}
                  value={value}
                  onChange={(event) => setter(event.target.value)}
                  className={`${HEALTH_FIELD_CLASS} mt-1.5`}
                  placeholder="Not set"
                />
              </label>
            ))}
            <p className="text-xs text-tertiary sm:col-span-2 xl:col-span-3">
              Clear Water to restore the default {formatVolume(2500, units)} (2,500 ml).
            </p>
            <div className="flex items-end sm:col-span-2 xl:col-span-3">
              <Button type="submit" size="sm" iconLeading={Target04} isLoading={mutation.busy}>Save daily targets</Button>
            </div>
          </form>
        </PersonalCard>
        <PersonalCard title="Profile & outcome targets">
          <p className="mb-4 text-sm text-tertiary">Customize the profile, body-composition goal, pace, and target date used throughout Health.</p>
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              void mutation.run(
                "health:updateGoals",
                {
                  birthdate,
                  gender,
                  heightCm: parseHeightInput(height, units),
                  activityLevel,
                  dietGoal,
                  goalWeightKg: goalWeight.trim() ? parseWeightInput(goalWeight, units) : null,
                  targetWeeklyChangeKg: weeklyChange.trim() ? parseWeightInput(weeklyChange, units) : 0,
                  goalBodyFatPct: goalBodyFat.trim() ? goalBodyFat : null,
                  goalTargetDate: goalTargetDate || null,
                },
                "Profile and outcome goals saved",
              );
            }}
          >
            <label className="text-xs font-medium text-secondary">Birthdate<input type="date" required value={birthdate} onChange={(event) => setBirthdate(event.target.value)} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
            <label className="text-xs font-medium text-secondary">Gender<RichSelect aria-label="Gender" value={gender.toLowerCase()} onChange={(event) => setGender(event.target.value)} options={[{ value: "unspecified", label: "Prefer not to say" }, { value: "female", label: "Female" }, { value: "male", label: "Male" }, { value: "other", label: "Other / nonbinary" }]} /></label>
            <label className="text-xs font-medium text-secondary">Height ({heightUnit(units)})<input type="number" required min={units === "IMPERIAL" ? 30 : 75} max={units === "IMPERIAL" ? 108 : 275} step="0.1" value={height} onChange={(event) => setHeight(event.target.value)} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
            <label className="text-xs font-medium text-secondary">Activity level<RichSelect aria-label="Activity level" value={activityLevel.toLowerCase()} onChange={(event) => setActivityLevel(event.target.value)} options={[{ value: "sedentary", label: "Sedentary" }, { value: "light", label: "Lightly active" }, { value: "moderate", label: "Moderately active" }, { value: "very_active", label: "Very active" }, { value: "extreme", label: "Athlete / extremely active" }]} /></label>
            <label className="text-xs font-medium text-secondary">Direction<RichSelect aria-label="Goal direction" value={dietGoal.toLowerCase()} onChange={(event) => setDietGoal(event.target.value)} options={[{ value: "maintain", label: "Maintain weight" }, { value: "lose", label: "Lose weight" }, { value: "gain", label: "Gain weight" }]} /></label>
            <label className="text-xs font-medium text-secondary">Goal weight ({weightUnit(units)})<input type="number" min="1" step="0.1" value={goalWeight} onChange={(event) => setGoalWeight(event.target.value)} className={`${HEALTH_FIELD_CLASS} mt-1.5`} placeholder="Optional" /></label>
            <label className="text-xs font-medium text-secondary">Weekly change ({weightUnit(units)}, signed)<input type="number" min={weightToDisplay(-5, units)} max={weightToDisplay(5, units)} step="0.05" value={weeklyChange} onChange={(event) => setWeeklyChange(event.target.value)} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
            <label className="text-xs font-medium text-secondary">Goal body fat (%)<input type="number" min="1" max="80" step="0.1" value={goalBodyFat} onChange={(event) => setGoalBodyFat(event.target.value)} className={`${HEALTH_FIELD_CLASS} mt-1.5`} placeholder="Optional" /></label>
            <label className="text-xs font-medium text-secondary">Target date<input type="date" value={goalTargetDate} onChange={(event) => setGoalTargetDate(event.target.value)} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
            <div className="flex items-end sm:col-span-2"><Button type="submit" size="sm" iconLeading={ActivityHeart} isLoading={mutation.busy}>Save profile goals</Button></div>
          </form>
          {!data.readiness.complete && (
            <p className="mt-4 rounded-lg bg-warning-primary p-3 text-xs text-warning-primary">
              Missing for goal calculations:{" "}
              {data.readiness.missingFields.map(titleCase).join(", ")}.
            </p>
          )}
        </PersonalCard>
      </div>
      <MutationNote error={mutation.error} success={mutation.success} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.7fr)]">
        <HealthChartCard title="Macro calorie allocation" description="Calculated directly from your saved gram targets" icon={BarChartSquare02}>
          <TrendChart
            data={goals && allocatedCalories > 0 ? [{ label: "Daily target", protein: macroCalories.protein, carbs: macroCalories.carbs, fat: macroCalories.fat }] : []}
            series={[{ key: "protein", name: "Protein kcal" }, { key: "carbs", name: "Carb kcal" }, { key: "fat", name: "Fat kcal" }]}
            type="bar"
            height={220}
            emptyLabel="Set macro targets to see their allocation"
          />
        </HealthChartCard>
        <PersonalCard title="Goal snapshot">
          <div className="space-y-4 text-sm">
            <div className="flex items-center justify-between gap-3"><span className="text-tertiary">Current weight</span><strong className="text-primary">{displayWeight(data.current.weightKg, data.unitSystem)}</strong></div>
            <div className="flex items-center justify-between gap-3"><span className="text-tertiary">Goal weight</span><strong className="text-primary">{displayWeight(profile?.goalWeightKg, data.unitSystem)}</strong></div>
            <div className="flex items-center justify-between gap-3"><span className="text-tertiary">Height</span><strong className="text-primary">{formatHeight(profile?.heightCm, units)}</strong></div>
            <div className="flex items-center justify-between gap-3"><span className="text-tertiary">Water</span><strong className="text-primary">{formatVolume(profile?.waterGoalMl, units)}</strong></div>
            <div className="flex items-center justify-between gap-3 border-t border-secondary pt-4"><span className="text-tertiary">Macro calories</span><strong className="text-primary">{allocatedCalories ? `${Math.round(allocatedCalories).toLocaleString()} kcal` : "—"}</strong></div>
            {goals?.calories != null && allocatedCalories > 0 && <p className="text-xs text-quaternary">Macros account for {Math.round((allocatedCalories / goals.calories) * 100)}% of the calorie target.</p>}
          </div>
        </PersonalCard>
      </div>
    </div>
  );
}

type HabitEditorState =
  | { kind: "habit"; habit: HabitsData["habits"][number] }
  | { kind: "milestone"; habit: HabitsData["habits"][number] };

function HabitsSection({
  data,
  client,
  onMutated,
}: {
  data: HabitsData;
  client: LifeOSClient;
  onMutated: () => void;
}) {
  const lifecycle = useHealthMutation(client, onMutated);
  const [editor, setEditor] = useState<HabitEditorState | null>(null);
  const activity = useMemo(
    () => completionActivity(data.habits.flatMap((habit) => habit.logDates), 28),
    [data.habits],
  );
  return (
    <div className="flex flex-col gap-5">
      <FormModal isOpen={Boolean(editor)} onOpenChange={(open) => { if (!open) setEditor(null); }} title={editor?.kind === "milestone" ? "Add habit milestone" : "Edit habit"} description={editor?.kind === "milestone" ? "Capture a meaningful consistency or outcome milestone." : "Update the habit details without losing check-in history."}>
        {editor?.kind === "habit" && <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); const values = new FormData(event.currentTarget); void lifecycle.run("health:updateHabit", { id: editor.habit.id, name: values.get("name"), description: values.get("description"), category: values.get("category"), frequency: values.get("frequency"), priority: values.get("priority"), active: values.get("active") === "true", habitType: editor.habit.habitType?.toLowerCase() === "bad" ? "bad" : "good", targetCount: editor.habit.targetCount ?? 1, targetDays: editor.habit.targetDays, daysOfWeek: editor.habit.daysOfWeek ?? [], color: editor.habit.color && /^#[0-9a-f]{6}$/i.test(editor.habit.color) ? editor.habit.color : null, icon: editor.habit.icon, cue: editor.habit.cue, routine: editor.habit.routine, reward: editor.habit.reward, stackAfterHabitId: editor.habit.stackAfterHabitId, difficulty: editor.habit.difficulty, reminderTime: editor.habit.reminderTime }, "Habit updated").then((ok) => { if (ok) setEditor(null); }); }}>
          <label className="text-xs font-medium text-secondary">Name<input name="name" required defaultValue={editor.habit.name} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <label className="text-xs font-medium text-secondary">Description<textarea name="description" rows={3} defaultValue={editor.habit.description ?? ""} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium text-secondary">Category<input name="category" defaultValue={editor.habit.category ?? ""} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label><label className="text-xs font-medium text-secondary">Frequency<RichSelect aria-label="Habit frequency" name="frequency" defaultValue={editor.habit.frequency ?? "daily"} options={[{ value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }, { value: "custom", label: "Custom" }]} /></label></div>
          <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium text-secondary">Priority<input name="priority" defaultValue={editor.habit.priority ?? ""} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label><label className="text-xs font-medium text-secondary">Status<RichSelect aria-label="Habit status" name="active" defaultValue={String(editor.habit.active)} options={[{ value: "true", label: "Active" }, { value: "false", label: "Inactive" }]} /></label></div>
          <div className="flex justify-end gap-2"><Button color="secondary" onClick={() => setEditor(null)}>Cancel</Button><Button type="submit" isLoading={lifecycle.busy}>Save habit</Button></div>
        </form>}
        {editor?.kind === "milestone" && <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); const values = new FormData(event.currentTarget); void lifecycle.run("health:addHabitMilestone", { habitId: editor.habit.id, milestoneDate: values.get("milestoneDate"), description: values.get("description") }, "Milestone added").then((ok) => { if (ok) setEditor(null); }); }}>
          <div className="rounded-lg bg-secondary p-3"><p className="text-xs text-tertiary">Habit</p><p className="mt-1 font-semibold text-primary">{editor.habit.name}</p></div>
          <label className="text-xs font-medium text-secondary">Date<input name="milestoneDate" type="date" required defaultValue={todayInput()} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <label className="text-xs font-medium text-secondary">Milestone<textarea name="description" rows={4} required className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <div className="flex justify-end gap-2"><Button color="secondary" onClick={() => setEditor(null)}>Cancel</Button><Button type="submit" isLoading={lifecycle.busy}>Add milestone</Button></div>
        </form>}
      </FormModal>
      <HabitControls client={client} data={data} onMutated={onMutated} />
      <StatGrid
        stats={[
          {
            label: "Active habits",
            value: data.summary.active,
            detail: `${data.summary.total} total`,
          },
          {
            label: "Done today",
            value: data.summary.completedToday,
            detail: `${data.summary.completionRateToday}% completion`,
          },
          {
            label: "Recent check-ins",
            value: data.summary.checkInsInWindow,
            detail: "Last 200 days",
          },
          {
            label: "Milestones",
            value: data.habits.reduce(
              (sum, habit) => sum + habit.milestones.length,
              0,
            ),
          },
        ]}
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <HealthChartCard title="Completion activity" description="All habit check-ins across the last 28 days" icon={CheckCircle}>
          <TrendChart data={data.summary.checkInsInWindow ? activity : []} series={[{ key: "completed", name: "Check-ins" }]} type="bar" height={230} emptyLabel="No recent habit activity" />
        </HealthChartCard>
        <HealthChartCard title="Consistency map" description="Sixteen weeks of real check-in history for each habit" icon={Calendar}>
          {data.habits.length === 0 ? (
            <EmptyMessage>Create a habit to start building a consistency map.</EmptyMessage>
          ) : (
            <div className="max-h-72 space-y-4 overflow-y-auto pr-1">
              {data.habits.map((habit) => (
                <div key={habit.id} className="grid gap-2 border-b border-secondary pb-4 last:border-0 last:pb-0 sm:grid-cols-[minmax(120px,0.35fr)_minmax(0,1fr)] sm:items-center">
                  <div>
                    <p className="truncate text-sm font-medium text-primary">{habit.name}</p>
                    <p className="text-xs text-tertiary">{habit.logDates.length} check-ins</p>
                  </div>
                  <HabitHeatmap
                    logDates={new Set(habit.logDates)}
                    color={habit.color ?? "brand"}
                    variant={habit.habitType?.toLowerCase() === "bad" ? "break" : "build"}
                    sinceKey={habit.createdAt?.slice(0, 10)}
                  />
                </div>
              ))}
            </div>
          )}
        </HealthChartCard>
      </div>
      <PersonalCard title="Habit roster">
        <PersonalTable
          rows={data.habits}
          empty="No habits have been created."
          columns={[
            {
              key: "name",
              label: "Habit",
              render: (row) => (
                <div>
                  <p className="font-medium text-primary">{row.name}</p>
                  {row.description && (
                    <p className="mt-0.5 text-xs text-tertiary">
                      {row.description}
                    </p>
                  )}
                </div>
              ),
            },
            {
              key: "category",
              label: "Category",
              render: (row) => titleCase(row.category),
            },
            {
              key: "frequency",
              label: "Cadence",
              render: (row) => titleCase(row.frequency),
            },
            {
              key: "logs",
              label: "Check-ins",
              align: "right",
              render: (row) => row.logDates.length,
            },
            {
              key: "today",
              label: "Today",
              align: "right",
              render: (row) =>
                row.completedToday ? "Done" : row.active ? "Open" : "Inactive",
            },
            { key: "actions", label: "", align: "right", render: (row) => <RowActions onEdit={() => setEditor({ kind: "habit", habit: row })} onDelete={() => { if (confirmRemove(`habit “${row.name}” and its check-in history`)) void lifecycle.run("health:deleteHabit", { id: row.id }, "Habit deleted"); }}><button type="button" onClick={() => setEditor({ kind: "milestone", habit: row })} className="rounded-md px-2 py-1 text-xs font-semibold text-brand-secondary hover:bg-brand-secondary">Milestone</button></RowActions> },
          ]}
        />
      </PersonalCard>
      <PersonalCard title="Habit milestones">
        {data.habits.every((habit) => habit.milestones.length === 0) ? <EmptyMessage>No milestones recorded yet.</EmptyMessage> : <div className="grid gap-3 sm:grid-cols-2">{data.habits.flatMap((habit) => habit.milestones.map((milestone) => ({ ...milestone, habitName: habit.name }))).sort((left, right) => right.milestoneDate.localeCompare(left.milestoneDate)).map((milestone) => <div key={milestone.id} className="flex items-start justify-between gap-3 rounded-lg border border-secondary p-3"><div><p className="text-sm font-medium text-primary">{milestone.habitName}</p><p className="text-xs text-tertiary">{formatDate(milestone.milestoneDate)}</p>{milestone.description && <p className="mt-1 text-xs text-secondary">{milestone.description}</p>}</div><RowActions onDelete={() => { if (confirmRemove("this milestone")) void lifecycle.run("health:deleteHabitMilestone", { id: milestone.id }, "Milestone deleted"); }} /></div>)}</div>}
      </PersonalCard>
      <MutationNote error={lifecycle.error} success={lifecycle.success} />
    </div>
  );
}

function JournalSection({
  data,
  client,
  onMutated,
}: {
  data: JournalData;
  client: LifeOSClient;
  onMutated: () => void;
}) {
  const [page, setPage] = useState(0);
  const lifecycle = useHealthMutation(client, onMutated);
  const [editingEntry, setEditingEntry] = useState<JournalData["entries"][number] | null>(null);
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(data.entries.length / pageSize));
  const visibleEntries = data.entries.slice(page * pageSize, (page + 1) * pageSize);
  const ratingTrend = useMemo<TrendPoint[]>(
    () => [...data.entries].reverse().filter((entry) => entry.overallRating != null).slice(-45).map((entry) => ({ label: shortDate(entry.date), rating: entry.overallRating })),
    [data.entries],
  );
  const realmSummary = useMemo<TrendPoint[]>(
    () => data.summary.realmAverages.map((realm) => ({ label: titleCase(realm.realm), rating: realm.average })),
    [data.summary.realmAverages],
  );
  return (
    <div className="flex flex-col gap-5">
      <JournalEntryForm client={client} onMutated={onMutated} />
      <FormModal isOpen={Boolean(editingEntry)} onOpenChange={(open) => { if (!open) setEditingEntry(null); }} title="Edit journal entry" description="Update the reflection, gratitude, or overall rating.">
        {editingEntry && <form className="grid gap-4" onSubmit={(event) => {
          event.preventDefault();
          const values = new FormData(event.currentTarget);
          void lifecycle.run("health:upsertJournal", {
            id: editingEntry.id,
            date: editingEntry.date,
            reflection: values.get("reflection"),
            gratitude: values.get("gratitude"),
            overallRating: values.get("overallRating"),
            realmRatings: editingEntry.realmRatings,
          }, "Journal entry updated").then((ok) => { if (ok) setEditingEntry(null); });
        }}>
          <div className="rounded-lg bg-secondary p-3"><p className="text-xs text-tertiary">Entry date</p><p className="mt-1 font-semibold text-primary">{formatDate(editingEntry.date)}</p></div>
          <label className="text-xs font-medium text-secondary">Overall rating<RichSelect aria-label="Overall rating" name="overallRating" defaultValue={String(editingEntry.overallRating ?? "")} placeholder="Not rated" options={Array.from({ length: 10 }, (_, index) => ({ value: String(index + 1), label: `${index + 1}/10` }))} /></label>
          <label className="text-xs font-medium text-secondary">Reflection<textarea name="reflection" rows={7} defaultValue={editingEntry.reflection ?? ""} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <label className="text-xs font-medium text-secondary">Gratitude<textarea name="gratitude" rows={5} defaultValue={editingEntry.gratitude ?? ""} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <div className="flex justify-end gap-2"><Button color="secondary" onClick={() => setEditingEntry(null)}>Cancel</Button><Button type="submit" isLoading={lifecycle.busy}>Save entry</Button></div>
        </form>}
      </FormModal>
      <StatGrid
        stats={[
          { label: "Journal entries", value: data.summary.entries },
          {
            label: "Average rating",
            value: valueOrDash(data.summary.averageRating, "/10"),
          },
          { label: "Gratitude entries", value: data.summary.gratitudeEntries },
          {
            label: "Latest entry",
            value: data.summary.latestDate
              ? formatDate(data.summary.latestDate)
              : "—",
          },
        ]}
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <HealthChartCard title="Wellbeing trend" description="Overall journal rating across your latest entries" icon={LineChartUp02}>
          <TrendChart data={ratingTrend} series={[{ key: "rating", name: "Overall rating (/10)" }]} type="area" fitDomain height={230} emptyLabel="Add ratings to see your wellbeing trend" />
        </HealthChartCard>
        <HealthChartCard title="Realm balance" description="Average recorded score for each life realm" icon={BookOpen01}>
          <TrendChart data={realmSummary} series={[{ key: "rating", name: "Average (/10)" }]} type="bar" height={230} emptyLabel="No realm ratings have been logged" />
        </HealthChartCard>
      </div>
      {data.summary.realmAverages.length > 0 && (
        <PersonalCard title="Realm averages">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {data.summary.realmAverages.map((realm) => (
              <div key={realm.realm} className="rounded-lg bg-secondary p-3">
                <p className="text-xs text-tertiary">
                  {titleCase(realm.realm)}
                </p>
                <p className="mt-1 font-semibold text-primary">
                  {realm.average}/10
                </p>
              </div>
            ))}
          </div>
        </PersonalCard>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {data.entries.length === 0 ? (
          <div className="lg:col-span-2">
            <EmptyMessage>No journal entries yet.</EmptyMessage>
          </div>
        ) : (
          visibleEntries.map((entry) => (
            <PersonalCard
              key={entry.id}
              title={formatDate(entry.date)}
              action={
                <div className="flex items-center gap-2">
                  {entry.overallRating != null && <span className="text-sm font-semibold text-brand-secondary">{entry.overallRating}/10</span>}
                  <RowActions onEdit={() => setEditingEntry(entry)} onDelete={() => { if (confirmRemove(`journal entry from ${formatDate(entry.date)}`)) void lifecycle.run("health:deleteJournal", { id: entry.id }, "Journal entry deleted"); }} />
                </div>
              }
            >
              {entry.reflection && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-quaternary">
                    Reflection
                  </p>
                  <div className="mt-1"><JournalMarkdown text={entry.reflection} /></div>
                </div>
              )}
              {entry.gratitude && (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-quaternary">
                    Gratitude
                  </p>
                  <div className="mt-1"><JournalMarkdown text={entry.gratitude} /></div>
                </div>
              )}
              {!entry.reflection && !entry.gratitude && (
                <p className="text-sm text-tertiary">Ratings only.</p>
              )}
            </PersonalCard>
          ))
        )}
      </div>
      {pageCount > 1 && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-secondary bg-primary px-4 py-3"><p className="text-xs text-tertiary">Page {page + 1} of {pageCount} · {data.entries.length} entries</p><div className="flex gap-2"><button type="button" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))} className="rounded-lg border border-secondary px-3 py-1.5 text-xs font-semibold text-secondary disabled:opacity-40">Previous</button><button type="button" disabled={page >= pageCount - 1} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} className="rounded-lg border border-secondary px-3 py-1.5 text-xs font-semibold text-secondary disabled:opacity-40">Next</button></div></div>}
      <MutationNote error={lifecycle.error} success={lifecycle.success} />
    </div>
  );
}

function MedicalSectionLegacy({ data }: { data: MedicalData }) {
  return (
    <div className="flex flex-col gap-5">
      <StatGrid
        stats={[
          {
            label: "Medical records",
            value: data.summary.records,
            detail: data.summary.latestRecordDate
              ? `Latest ${formatDate(data.summary.latestRecordDate)}`
              : "None uploaded",
          },
          { label: "Providers", value: data.summary.providers },
          { label: "Doctors", value: data.summary.doctors },
        ]}
      />
      <PersonalCard title="Records">
        <PersonalTable
          rows={data.records}
          empty="No medical records found."
          columns={[
            {
              key: "name",
              label: "Record",
              render: (row) => (
                <div>
                  <p className="font-medium text-primary">{row.name}</p>
                  {row.fileName && (row.fileUrl ? (
                    <a href={row.fileUrl} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand-secondary hover:underline">{row.fileName}</a>
                  ) : <p className="text-xs text-tertiary">{row.fileName}</p>)}
                </div>
              ),
            },
            {
              key: "date",
              label: "Date",
              render: (row) => formatDate(row.recordDate),
            },
            {
              key: "provider",
              label: "Provider",
              render: (row) => row.providerName ?? "—",
            },
            {
              key: "doctor",
              label: "Doctor",
              render: (row) => row.doctorName ?? "—",
            },
          ]}
        />
      </PersonalCard>
      <div className="grid gap-5 lg:grid-cols-2">
        <PersonalCard title="Care providers">
          <PersonalTable
            rows={data.providers}
            empty="No providers saved."
            columns={[
              { key: "name", label: "Provider", render: (row) => row.name },
              {
                key: "phone",
                label: "Phone",
                render: (row) => row.phone ?? "—",
              },
              {
                key: "address",
                label: "Address",
                render: (row) => row.address ?? "—",
              },
            ]}
          />
        </PersonalCard>
        <PersonalCard title="Doctors">
          <PersonalTable
            rows={data.doctors}
            empty="No doctors saved."
            columns={[
              { key: "name", label: "Doctor", render: (row) => row.name },
              {
                key: "profession",
                label: "Specialty",
                render: (row) => row.profession ?? "—",
              },
              {
                key: "location",
                label: "Location",
                render: (row) => row.location ?? "—",
              },
            ]}
          />
        </PersonalCard>
      </div>
    </div>
  );
}

type MedicalEditorState = { kind: "record" | "provider" | "doctor" | "appointment"; row: any | null };

function medicalDateTimeValue(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function MedicalEditor({ editor, data, mutation, onClose }: { editor: MedicalEditorState; data: MedicalData; mutation: ReturnType<typeof useHealthMutation>; onClose: () => void }) {
  const { kind, row } = editor;
  const linkedEventId = row?.eventId ?? data.appointments.find((appointment) => appointment.records.some((record) => record.id === row?.id))?.id ?? "";
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = Object.fromEntries(values.entries());
    if (row?.id) payload.id = row.id;
    const file = values.get("file");
    delete payload.file;
    if (file instanceof File && file.size) {
      if (file.size > 25 * 1024 * 1024) { window.alert("Medical files must be 25 MB or smaller."); return; }
      payload.fileName = file.name;
      payload.mimeType = file.type;
      payload.base64 = await healthImageDataUrl(file);
    }
    const command = { record: "health:saveMedicalRecord", provider: "health:saveProvider", doctor: "health:saveDoctor", appointment: "health:saveAppointment" }[kind];
    if (await mutation.run(command, payload, `${titleCase(kind)} saved`)) onClose();
  };
  const title = `${row ? "Edit" : "Add"} ${kind}`;
  return <PersonalCard title={title} action={<button type="button" className="rounded-lg border border-secondary px-3 py-1.5 text-xs font-semibold text-secondary" onClick={onClose}>Close</button>}>
    <form onSubmit={(event) => void submit(event)} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {kind === "provider" && <>
        <label className="text-xs font-medium text-secondary">Provider name<input name="name" required defaultValue={row?.name ?? ""} className={HEALTH_FIELD_CLASS} /></label>
        <label className="text-xs font-medium text-secondary">Phone<input name="phone" defaultValue={row?.phone ?? ""} className={HEALTH_FIELD_CLASS} /></label>
        <label className="text-xs font-medium text-secondary">Website<input name="website" type="url" defaultValue={row?.website ?? ""} className={HEALTH_FIELD_CLASS} /></label>
        <label className="text-xs font-medium text-secondary sm:col-span-2">Office location(s)<textarea name="address" rows={3} defaultValue={row?.address ?? ""} className={HEALTH_FIELD_CLASS} /></label>
        <label className="text-xs font-medium text-secondary sm:col-span-2">Notes<textarea name="notes" rows={3} defaultValue={row?.notes ?? ""} className={HEALTH_FIELD_CLASS} /></label>
      </>}
      {kind === "doctor" && <>
        <label className="text-xs font-medium text-secondary">Doctor name<input name="name" required defaultValue={row?.name ?? ""} className={HEALTH_FIELD_CLASS} /></label>
        <label className="text-xs font-medium text-secondary">Specialty<input name="profession" defaultValue={row?.profession ?? ""} className={HEALTH_FIELD_CLASS} /></label>
        <label className="text-xs font-medium text-secondary">Provider<RichSelect aria-label="Doctor's provider" name="providerId" defaultValue={row?.providerId ?? ""} placeholder="Independent" options={data.providers.map((item) => ({ value: item.id, label: item.name }))} /></label>
        <label className="text-xs font-medium text-secondary">Phone<input name="phone" defaultValue={row?.phone ?? ""} className={HEALTH_FIELD_CLASS} /></label>
        <label className="text-xs font-medium text-secondary">Email<input name="email" type="email" defaultValue={row?.email ?? ""} className={HEALTH_FIELD_CLASS} /></label>
        <label className="text-xs font-medium text-secondary sm:col-span-2">Office location(s)<textarea name="location" rows={3} defaultValue={row?.location ?? ""} className={HEALTH_FIELD_CLASS} /></label>
        <label className="text-xs font-medium text-secondary sm:col-span-2">Care notes<textarea name="notes" rows={3} defaultValue={row?.notes ?? ""} className={HEALTH_FIELD_CLASS} /></label>
      </>}
      {kind === "appointment" && <>
        <label className="text-xs font-medium text-secondary">Title<input name="title" required defaultValue={row?.title ?? ""} className={HEALTH_FIELD_CLASS} /></label>
        <label className="text-xs font-medium text-secondary">Starts<input name="startsAt" type="datetime-local" required defaultValue={medicalDateTimeValue(row?.startsAt)} className={HEALTH_FIELD_CLASS} /></label>
        <label className="text-xs font-medium text-secondary">Ends<input name="endsAt" type="datetime-local" defaultValue={medicalDateTimeValue(row?.endsAt)} className={HEALTH_FIELD_CLASS} /></label>
        <label className="text-xs font-medium text-secondary">Location<input name="location" defaultValue={row?.location ?? ""} className={HEALTH_FIELD_CLASS} /></label>
        <label className="text-xs font-medium text-secondary">Provider<RichSelect aria-label="Appointment provider" name="providerId" defaultValue={row?.providerId ?? ""} placeholder="No provider" options={data.providers.map((item) => ({ value: item.id, label: item.name }))} /></label>
        <label className="text-xs font-medium text-secondary">Doctor<RichSelect aria-label="Appointment doctor" name="doctorId" defaultValue={row?.doctorId ?? ""} placeholder="No doctor" options={data.doctors.map((item) => ({ value: item.id, label: item.name }))} /></label>
        <label className="text-xs font-medium text-secondary sm:col-span-2">Purpose / preparation<textarea name="description" rows={3} defaultValue={row?.description ?? ""} className={HEALTH_FIELD_CLASS} /></label>
        <label className="text-xs font-medium text-secondary sm:col-span-2 lg:col-span-4">Visit notes<textarea name="visitNotes" rows={6} defaultValue={row?.visitNotes ?? ""} className={HEALTH_FIELD_CLASS} placeholder="Questions, discussion notes, and follow-up…" /></label>
      </>}
      {kind === "record" && <>
        <label className="text-xs font-medium text-secondary">Record title<input name="name" required defaultValue={row?.name ?? ""} className={HEALTH_FIELD_CLASS} /></label>
        <label className="text-xs font-medium text-secondary">Date<input name="recordDate" type="date" defaultValue={row?.recordDate?.slice(0, 10) ?? todayInput()} className={HEALTH_FIELD_CLASS} /></label>
        <label className="text-xs font-medium text-secondary">Provider<RichSelect aria-label="Medical record provider" name="providerId" defaultValue={row?.providerId ?? ""} placeholder="No provider" options={data.providers.map((item) => ({ value: item.id, label: item.name }))} /></label>
        <label className="text-xs font-medium text-secondary">Doctor<RichSelect aria-label="Medical record doctor" name="doctorId" defaultValue={row?.doctorId ?? ""} placeholder="No doctor" options={data.doctors.map((item) => ({ value: item.id, label: item.name }))} /></label>
        <label className="text-xs font-medium text-secondary">Appointment<RichSelect aria-label="Linked appointment" name="eventId" defaultValue={linkedEventId} placeholder="No appointment" options={data.appointments.map((item) => ({ value: item.id, label: `${formatDate(item.startsAt)} · ${item.title}` }))} /></label>
        <label className="text-xs font-medium text-secondary sm:col-span-2">File<input name="file" type="file" className={HEALTH_FIELD_CLASS} /><span className="mt-1 block font-normal text-tertiary">{row?.fileName ? `Current: ${row.fileName}` : "PDF, image, or document up to 25 MB"}</span></label>
        <label className="text-xs font-medium text-secondary sm:col-span-2 lg:col-span-4">Notes<textarea name="notes" rows={5} defaultValue={row?.notes ?? ""} className={HEALTH_FIELD_CLASS} /></label>
      </>}
      <div className="flex justify-end sm:col-span-2 lg:col-span-4"><button type="submit" disabled={mutation.busy} className={HEALTH_BUTTON_CLASS}>{mutation.busy ? "Saving…" : title}</button></div>
    </form>
  </PersonalCard>;
}

function MedicalSection({ data, client, onMutated }: { data: MedicalData; client: LifeOSClient; onMutated: () => void }) {
  const mutation = useHealthMutation(client, onMutated);
  const [editor, setEditor] = useState<MedicalEditorState | null>(null);
  const recordActivity = useMemo<TrendPoint[]>(() => {
    const counts = new Map<string, number>();
    data.records.forEach((record) => {
      if (!record.recordDate) return;
      const date = new Date(record.recordDate);
      if (Number.isNaN(date.getTime())) return;
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)).slice(-12).map(([month, records]) => ({ label: shortDate(`${month}-01`), records }));
  }, [data.records]);
  const nextAppointment = useMemo(
    () => data.appointments.filter((appointment) => new Date(appointment.startsAt).getTime() >= Date.now()).sort((left, right) => left.startsAt.localeCompare(right.startsAt))[0] ?? null,
    [data.appointments],
  );
  const remove = (command: string, id: string, label: string) => { if (window.confirm(`Remove ${label}?`)) void mutation.run(command, { id }, `${titleCase(label)} removed`); };
  const actionClass = "rounded-md border border-secondary px-2 py-1 text-xs font-semibold text-secondary hover:bg-secondary";
  return <div className="flex flex-col gap-5">
    <StatGrid stats={[{ label: "Medical records", value: data.summary.records, detail: data.summary.latestRecordDate ? `Latest ${formatDate(data.summary.latestRecordDate)}` : "None uploaded" }, { label: "Appointments", value: data.appointments.length }, { label: "Providers", value: data.summary.providers }, { label: "Doctors", value: data.summary.doctors }]} />
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]">
      <HealthChartCard title="Record activity" description="Medical documents saved by month" icon={FileHeart01}>
        <TrendChart data={recordActivity} series={[{ key: "records", name: "Records" }]} type="bar" height={210} emptyLabel="No dated medical records yet" />
      </HealthChartCard>
      <PersonalCard title="Next appointment">
        {nextAppointment ? <div className="flex h-full flex-col justify-center">
          <span className="mb-3 flex size-10 items-center justify-center rounded-lg bg-brand-secondary text-brand-secondary"><Calendar className="size-5" /></span>
          <p className="font-semibold text-primary">{nextAppointment.title}</p>
          <p className="mt-1 text-sm text-secondary">{new Date(nextAppointment.startsAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</p>
          <p className="mt-2 text-xs text-tertiary">{[nextAppointment.doctorName, nextAppointment.providerName, nextAppointment.location].filter(Boolean).join(" · ") || "No care-team details"}</p>
        </div> : <EmptyMessage>No upcoming appointments.</EmptyMessage>}
      </PersonalCard>
    </div>
    <div className="flex flex-wrap gap-2">{(["appointment", "record", "provider", "doctor"] as const).map((kind) => <button key={kind} type="button" onClick={() => setEditor({ kind, row: null })} className="inline-flex items-center gap-1.5 rounded-lg border border-secondary bg-primary px-3 py-2 text-sm font-semibold text-secondary hover:bg-secondary"><Plus className="size-4" />Add {kind}</button>)}</div>
    {mutation.error && <p className="rounded-lg bg-error-primary p-3 text-sm text-error-primary">{mutation.error}</p>}
    {mutation.success && <p className="rounded-lg bg-success-primary p-3 text-sm text-success-primary">{mutation.success}</p>}
    {editor && <MedicalEditor editor={editor} data={data} mutation={mutation} onClose={() => setEditor(null)} />}
    <PersonalCard title="Appointments"><PersonalTable rows={data.appointments} empty="No medical appointments scheduled." columns={[
      { key: "appointment", label: "Appointment", render: (row) => <div><p className="font-medium text-primary">{row.title}</p><p className="text-xs text-tertiary">{new Date(row.startsAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</p></div> },
      { key: "care", label: "Care team", render: (row) => [row.doctorName, row.providerName].filter(Boolean).join(" · ") || "—" },
      { key: "location", label: "Location", render: (row) => row.location || "—" },
      { key: "notes", label: "Visit notes", render: (row) => row.visitNotes ? <span className="line-clamp-2 whitespace-pre-wrap">{row.visitNotes}</span> : "—" },
      { key: "actions", label: "", align: "right", render: (row) => <div className="flex justify-end gap-1"><button type="button" className={actionClass} onClick={() => setEditor({ kind: "appointment", row })}>Edit</button><button type="button" className="px-2 py-1 text-xs font-semibold text-error-primary" onClick={() => remove("health:deleteAppointment", row.id, "appointment")}>Remove</button></div> },
    ]} /></PersonalCard>
    <PersonalCard title="Medical records"><PersonalTable rows={data.records} empty="No medical records found." columns={[
      { key: "record", label: "Record", render: (row) => <div><p className="font-medium text-primary">{row.name}</p>{row.notes && <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-xs text-tertiary">{row.notes}</p>}{row.fileUrl && <span className="mt-1 flex gap-2 text-xs font-semibold"><a href={row.fileUrl} target="_blank" rel="noreferrer" className="text-brand-secondary">Preview</a><a href={row.fileUrl} download={row.fileName ?? undefined} className="text-brand-secondary">Download</a></span>}</div> },
      { key: "date", label: "Date", render: (row) => formatDate(row.recordDate) }, { key: "provider", label: "Provider", render: (row) => row.providerName || "—" }, { key: "doctor", label: "Doctor", render: (row) => row.doctorName || "—" },
      { key: "actions", label: "", align: "right", render: (row) => <div className="flex justify-end gap-1"><button type="button" className={actionClass} onClick={() => setEditor({ kind: "record", row })}>Edit</button><button type="button" className="px-2 py-1 text-xs font-semibold text-error-primary" onClick={() => remove("health:deleteMedicalRecord", row.id, "record")}>Remove</button></div> },
    ]} /></PersonalCard>
    <div className="grid gap-5 lg:grid-cols-2"><PersonalCard title="Care providers"><div className="space-y-2">{data.providers.length ? data.providers.map((row) => <div key={row.id} className="flex items-start justify-between gap-3 rounded-lg border border-secondary p-3"><div><p className="text-sm font-semibold text-primary">{row.name}</p><p className="whitespace-pre-wrap text-xs text-tertiary">{[row.phone, row.address].filter(Boolean).join(" · ") || "No contact details"}</p></div><div className="flex gap-1"><button type="button" className={actionClass} onClick={() => setEditor({ kind: "provider", row })}>Edit</button><button type="button" className="text-xs font-semibold text-error-primary" onClick={() => remove("health:deleteProvider", row.id, "provider")}>Archive</button></div></div>) : <EmptyMessage>No providers saved.</EmptyMessage>}</div></PersonalCard><PersonalCard title="Doctors / care team"><div className="space-y-2">{data.doctors.length ? data.doctors.map((row) => <div key={row.id} className="flex items-start justify-between gap-3 rounded-lg border border-secondary p-3"><div><p className="text-sm font-semibold text-primary">{row.name}</p><p className="whitespace-pre-wrap text-xs text-tertiary">{[row.profession, row.location, row.phone, row.email].filter(Boolean).join(" · ") || "No contact details"}</p></div><div className="flex gap-1"><button type="button" className={actionClass} onClick={() => setEditor({ kind: "doctor", row })}>Edit</button><button type="button" className="text-xs font-semibold text-error-primary" onClick={() => remove("health:deleteDoctor", row.id, "doctor")}>Archive</button></div></div>) : <EmptyMessage>No doctors saved.</EmptyMessage>}</div></PersonalCard></div>
  </div>;
}

function MedicationTable({
  title,
  rows,
  onEdit,
  onDelete,
}: {
  title: string;
  rows: MedicationItem[];
  onEdit: (row: MedicationItem) => void;
  onDelete: (row: MedicationItem) => void;
}) {
  return (
    <PersonalCard title={title}>
      <PersonalTable
        rows={rows}
        empty={`No ${title.toLowerCase()} found.`}
        columns={[
          {
            key: "name",
            label: "Name",
            render: (row) => (
              <span className="font-medium text-primary">{row.name}</span>
            ),
          },
          { key: "dose", label: "Dose", render: (row) => formatDose(row) },
          {
            key: "frequency",
            label: "Frequency",
            render: (row) => row.frequency ?? "—",
          },
          {
            key: "status",
            label: "Status",
            align: "right",
            render: (row) => (row.active ? "Active" : "Inactive"),
          },
          { key: "actions", label: "", align: "right", render: (row) => <RowActions onEdit={() => onEdit(row)} onDelete={() => onDelete(row)} /> },
        ]}
      />
    </PersonalCard>
  );
}

type TherapeuticEditorState =
  | { kind: "medication" | "supplement"; item: MedicationItem | null }
  | { kind: "schedule"; schedule: MedicationsData["schedules"][number] | null }
  | { kind: "log" };

function MedicationsSection({
  data,
  client,
  onMutated,
}: {
  data: MedicationsData;
  client: LifeOSClient;
  onMutated: () => void;
}) {
  const mutation = useHealthMutation(client, onMutated);
  const [editor, setEditor] = useState<TherapeuticEditorState | null>(null);
  const adherenceTrend = useMemo<TrendPoint[]>(() => {
    const byDay = new Map<string, { taken: number; skipped: number; missed: number }>();
    data.doseHistory30.forEach((dose) => {
      const key = dateKey(dose.scheduledAt);
      const current = byDay.get(key) ?? { taken: 0, skipped: 0, missed: 0 };
      const status = dose.status.toUpperCase();
      if (status === "TAKEN") current.taken += 1;
      else if (status === "SKIPPED") current.skipped += 1;
      else if (status === "MISSED") current.missed += 1;
      byDay.set(key, current);
    });
    return Array.from({ length: 30 }, (_, index) => {
      const day = new Date();
      day.setHours(12, 0, 0, 0);
      day.setDate(day.getDate() - (29 - index));
      const key = localDateKey(day);
      return { label: shortDate(key), ...(byDay.get(key) ?? { taken: 0, skipped: 0, missed: 0 }) };
    });
  }, [data.doseHistory30]);
  return (
    <div className="flex flex-col gap-5">
      <FormModal isOpen={Boolean(editor)} onOpenChange={(open) => { if (!open) setEditor(null); }} title={editor?.kind === "schedule" ? `${editor.schedule ? "Edit" : "Add"} therapeutic schedule` : editor?.kind === "log" ? "Log an unscheduled dose" : `${editor?.item ? "Edit" : "Add"} ${editor?.kind ?? "therapeutic"}`} description={editor?.kind === "schedule" ? "Schedule generation updates automatically when the cadence changes." : "Keep dosage, cadence, and status current."}>
        {(editor?.kind === "medication" || editor?.kind === "supplement") && <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => {
          event.preventDefault(); const values = new FormData(event.currentTarget);
          const command = editor.kind === "medication" ? "health:saveMedication" : "health:saveSupplement";
          void mutation.run(command, { id: editor.item?.id, name: values.get("name"), dosageAmount: values.get("dosageAmount"), dosageUnit: values.get("dosageUnit"), frequency: values.get("frequency"), notes: values.get("notes"), active: values.get("active") === "true" }, `${titleCase(editor.kind)} saved`).then((ok) => { if (ok) setEditor(null); });
        }}>
          <label className="text-xs font-medium text-secondary sm:col-span-2">Name<input name="name" required defaultValue={editor.item?.name ?? ""} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <label className="text-xs font-medium text-secondary">Dose amount<input name="dosageAmount" type="number" min="0" step="any" defaultValue={editor.item?.dosageAmount ?? ""} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <label className="text-xs font-medium text-secondary">Dose unit<input name="dosageUnit" defaultValue={editor.item?.dosageUnit ?? "mg"} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <label className="text-xs font-medium text-secondary">Frequency<input name="frequency" defaultValue={editor.item?.frequency ?? ""} placeholder="e.g. once daily" className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <label className="text-xs font-medium text-secondary">Status<RichSelect aria-label={`${titleCase(editor.kind)} status`} name="active" defaultValue={String(editor.item?.active ?? true)} options={[{ value: "true", label: "Active" }, { value: "false", label: "Inactive" }]} /></label>
          <label className="text-xs font-medium text-secondary sm:col-span-2">Notes<textarea name="notes" rows={3} defaultValue={editor.item?.notes ?? ""} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <div className="flex justify-end gap-2 sm:col-span-2"><Button color="secondary" onClick={() => setEditor(null)}>Cancel</Button><Button type="submit" isLoading={mutation.busy}>Save {editor.kind}</Button></div>
        </form>}
        {editor?.kind === "schedule" && <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => {
          event.preventDefault(); const values = new FormData(event.currentTarget);
          const daysOfWeek = String(values.get("daysOfWeek") ?? "").split(",").map((value) => value.trim().toUpperCase()).filter(Boolean);
          const timesOfDay = String(values.get("timesOfDay") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
          void mutation.run("health:saveTherapeuticSchedule", { id: editor.schedule?.id, kind: values.get("kind"), name: values.get("name"), dosage: values.get("dosage"), notes: values.get("notes"), pattern: values.get("pattern"), everyN: values.get("everyN"), daysOfWeek, timesOfDay, startDate: values.get("startDate"), endDate: values.get("endDate") }, "Schedule saved").then((ok) => { if (ok) setEditor(null); });
        }}>
          <label className="text-xs font-medium text-secondary">Kind<RichSelect aria-label="Therapeutic kind" name="kind" defaultValue={editor.schedule?.kind ?? "MEDICATION"} options={[{ value: "MEDICATION", label: "Medication" }, { value: "SUPPLEMENT", label: "Supplement" }, { value: "PEPTIDE", label: "Peptide" }, { value: "OTHER", label: "Other" }]} /></label>
          <label className="text-xs font-medium text-secondary">Name<input name="name" required defaultValue={editor.schedule?.name ?? ""} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <label className="text-xs font-medium text-secondary">Dosage<input name="dosage" defaultValue={editor.schedule?.dosage ?? ""} placeholder="e.g. 10 mg" className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <label className="text-xs font-medium text-secondary">Pattern<RichSelect aria-label="Therapeutic schedule pattern" name="pattern" defaultValue={editor.schedule?.pattern ?? "DAILY"} options={[{ value: "DAILY", label: "Daily" }, { value: "EVERY_N_DAYS", label: "Every N days" }, { value: "WEEKLY_DOW", label: "Selected weekdays" }, { value: "WEEKLY_ONCE", label: "Weekly from start date" }]} /></label>
          <label className="text-xs font-medium text-secondary">Every N days<input name="everyN" type="number" min="1" step="1" defaultValue={editor.schedule?.everyN ?? ""} className={`${HEALTH_FIELD_CLASS} mt-1.5`} placeholder="Only for every-N pattern" /></label>
          <label className="text-xs font-medium text-secondary">Weekdays<input name="daysOfWeek" defaultValue={editor.schedule?.daysOfWeek.join(", ") ?? ""} className={`${HEALTH_FIELD_CLASS} mt-1.5`} placeholder="MON, WED, FRI" /></label>
          <label className="text-xs font-medium text-secondary">Times<input name="timesOfDay" required defaultValue={editor.schedule?.timesOfDay.join(", ") ?? "08:00"} className={`${HEALTH_FIELD_CLASS} mt-1.5`} placeholder="08:00, 20:00" /></label>
          <label className="text-xs font-medium text-secondary">Start date<input name="startDate" type="date" required defaultValue={editor.schedule?.startDate ?? todayInput()} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <label className="text-xs font-medium text-secondary">End date<input name="endDate" type="date" defaultValue={editor.schedule?.endDate ?? ""} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <label className="text-xs font-medium text-secondary sm:col-span-2">Notes<textarea name="notes" rows={3} defaultValue={editor.schedule?.notes ?? ""} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <div className="flex justify-end gap-2 sm:col-span-2"><Button color="secondary" onClick={() => setEditor(null)}>Cancel</Button><Button type="submit" isLoading={mutation.busy}>Save schedule</Button></div>
        </form>}
        {editor?.kind === "log" && <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => {
          event.preventDefault(); const values = new FormData(event.currentTarget);
          void mutation.run("health:logTherapeutic", { therapeuticKind: values.get("therapeuticKind"), name: values.get("name"), doseAmount: values.get("doseAmount"), doseUnit: values.get("doseUnit"), loggedAt: values.get("loggedAt"), notes: values.get("notes") }, "Dose logged").then((ok) => { if (ok) setEditor(null); });
        }}>
          <label className="text-xs font-medium text-secondary">Kind<RichSelect aria-label="Therapeutic kind" name="therapeuticKind" defaultValue="OTHER" options={[{ value: "MEDICATION", label: "Medication" }, { value: "SUPPLEMENT", label: "Supplement" }, { value: "PEPTIDE", label: "Peptide" }, { value: "OTHER", label: "Other" }]} /></label>
          <label className="text-xs font-medium text-secondary">Name<input name="name" required className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <label className="text-xs font-medium text-secondary">Dose amount<input name="doseAmount" type="number" min="0" step="any" className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <label className="text-xs font-medium text-secondary">Unit<input name="doseUnit" defaultValue="mg" className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <label className="text-xs font-medium text-secondary sm:col-span-2">Logged at<input name="loggedAt" type="datetime-local" required defaultValue={medicalDateTimeValue(new Date().toISOString())} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <label className="text-xs font-medium text-secondary sm:col-span-2">Notes<textarea name="notes" rows={3} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <div className="flex justify-end gap-2 sm:col-span-2"><Button color="secondary" onClick={() => setEditor(null)}>Cancel</Button><Button type="submit" isLoading={mutation.busy}>Log dose</Button></div>
        </form>}
      </FormModal>
      <MedicationLogForm client={client} onMutated={onMutated} />
      <div className="flex flex-wrap items-center gap-2"><Button size="sm" color="secondary" iconLeading={Plus} onClick={() => setEditor({ kind: "supplement", item: null })}>Add supplement</Button><Button size="sm" color="secondary" iconLeading={Calendar} onClick={() => setEditor({ kind: "schedule", schedule: null })}>Add schedule</Button><Button size="sm" color="secondary" iconLeading={Check} onClick={() => setEditor({ kind: "log" })}>Log unscheduled dose</Button><span className="text-xs text-tertiary">Schedule times use {data.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone}.</span></div>
      <StatGrid
        stats={[
          {
            label: "Active medications",
            value: data.summary.activeMedications,
          },
          {
            label: "Active supplements",
            value: data.summary.activeSupplements,
          },
          { label: "Schedules", value: data.summary.activeSchedules },
          {
            label: "30-day adherence",
            value:
              data.adherence.percentage == null
                ? "—"
                : `${data.adherence.percentage}%`,
            detail: `${data.adherence.taken}/${data.adherence.scheduled} taken`,
          },
        ]}
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.65fr)]">
        <HealthChartCard
          title="30-day adherence"
          description="Scheduled doses grouped by outcome"
          icon={ShieldTick}
          action={<div className="flex flex-wrap gap-1.5"><LegendPill color="var(--color-brand-500)">Taken</LegendPill><LegendPill color="var(--color-utility-blue-500)">Skipped</LegendPill><LegendPill color="var(--color-utility-pink-500)">Missed</LegendPill></div>}
        >
          <TrendChart data={data.doseHistory30.length ? adherenceTrend : []} series={[{ key: "taken", name: "Taken" }, { key: "skipped", name: "Skipped" }, { key: "missed", name: "Missed" }]} type="bar" height={230} emptyLabel="No scheduled dose history" />
        </HealthChartCard>
        <PersonalCard title="Adherence breakdown">
          <div className="space-y-4">
            <div className="flex items-end justify-between gap-3"><div><p className="text-xs text-tertiary">Completed as planned</p><p className="mt-1 text-3xl font-semibold text-primary">{data.adherence.percentage == null ? "—" : `${data.adherence.percentage}%`}</p></div><CheckCircle className="size-7 text-success-primary" /></div>
            <ProgressMeter value={data.adherence.taken} max={data.adherence.scheduled} label={`${data.adherence.taken} of ${data.adherence.scheduled} taken`} />
            <div className="grid grid-cols-3 gap-2 border-t border-secondary pt-4 text-center">
              {[['Taken', data.adherence.taken], ['Skipped', data.adherence.skipped], ['Missed', data.adherence.missed]].map(([label, value]) => <div key={String(label)}><p className="text-xs text-tertiary">{label}</p><p className="mt-1 font-semibold text-primary">{value}</p></div>)}
            </div>
          </div>
        </PersonalCard>
      </div>
      <PersonalCard title="Next seven days">
        <PersonalTable
          rows={data.doses}
          empty="No scheduled doses in the next seven days."
          columns={[
            {
              key: "name",
              label: "Therapeutic",
              render: (row) => (
                <div>
                  <p className="font-medium text-primary">{row.scheduleName}</p>
                  <p className="text-xs text-tertiary">
                    {titleCase(row.scheduleKind)}
                  </p>
                </div>
              ),
            },
            { key: "dose", label: "Dose", render: (row) => row.dosage ?? "—" },
            {
              key: "time",
              label: "Scheduled",
              render: (row) => new Date(row.scheduledAt).toLocaleString(),
            },
            {
              key: "status",
              label: "Status",
              align: "right",
              render: (row) => <div className="flex items-center justify-end gap-1"><span className="mr-1 text-xs text-tertiary">{titleCase(row.status)}</span>{row.status === "TAKEN" || row.status === "SKIPPED" ? <button type="button" onClick={() => void mutation.run("health:setTherapeuticDoseStatus", { id: row.id, status: "PENDING" }, "Dose reset to pending")} className="rounded-md px-2 py-1 text-xs font-semibold text-secondary hover:bg-secondary">Reset</button> : <><button type="button" onClick={() => void mutation.run("health:setTherapeuticDoseStatus", { id: row.id, status: "TAKEN" }, "Dose marked taken")} className="rounded-md bg-success-secondary px-2 py-1 text-xs font-semibold text-success-primary">Taken</button><button type="button" onClick={() => void mutation.run("health:setTherapeuticDoseStatus", { id: row.id, status: "SKIPPED" }, "Dose skipped")} className="rounded-md px-2 py-1 text-xs font-semibold text-tertiary hover:bg-secondary">Skip</button></>}</div>,
            },
          ]}
        />
      </PersonalCard>
      <div className="grid gap-5 lg:grid-cols-2">
        <MedicationTable title="Medications" rows={data.medications} onEdit={(item) => setEditor({ kind: "medication", item })} onDelete={(item) => { if (confirmRemove(`medication “${item.name}”`)) void mutation.run("health:deleteMedication", { id: item.id }, "Medication deleted"); }} />
        <MedicationTable title="Supplements" rows={data.supplements} onEdit={(item) => setEditor({ kind: "supplement", item })} onDelete={(item) => { if (confirmRemove(`supplement “${item.name}”`)) void mutation.run("health:deleteSupplement", { id: item.id }, "Supplement deleted"); }} />
      </div>
      <PersonalCard title="Active schedules">
        <PersonalTable
          rows={data.schedules}
          empty="No therapeutic schedules configured."
          columns={[
            { key: "name", label: "Name", render: (row) => row.name },
            {
              key: "kind",
              label: "Kind",
              render: (row) => titleCase(row.kind),
            },
            {
              key: "pattern",
              label: "Pattern",
              render: (row) => titleCase(row.pattern),
            },
            {
              key: "times",
              label: "Times",
              align: "right",
              render: (row) => row.timesOfDay.join(", ") || "—",
            },
            { key: "actions", label: "", align: "right", render: (row) => <RowActions onEdit={() => setEditor({ kind: "schedule", schedule: row })} onDelete={() => { if (window.confirm(`Archive the “${row.name}” schedule? Future pending doses will be removed.`)) void mutation.run("health:deleteTherapeuticSchedule", { id: row.id }, "Schedule archived"); }} deleteLabel="Archive schedule" /> },
          ]}
        />
      </PersonalCard>
      <PersonalCard title="Recent dose history">
        <PersonalTable
          rows={data.doseHistory30.slice(0, 30)}
          empty="No scheduled dose history in the last 30 days."
          columns={[
            { key: "name", label: "Therapeutic", render: (row) => <span className="font-medium text-primary">{row.scheduleName}</span> },
            { key: "dose", label: "Dose", render: (row) => row.dosage ?? "—" },
            { key: "scheduled", label: "Scheduled", render: (row) => new Date(row.scheduledAt).toLocaleString() },
            { key: "status", label: "Outcome", align: "right", render: (row) => titleCase(row.status) },
          ]}
        />
      </PersonalCard>
      <PersonalCard title="Unscheduled therapeutic log">
        <PersonalTable rows={data.logs.slice(0, 100)} empty="No unscheduled doses logged in the last 30 days." columns={[
          { key: "name", label: "Therapeutic", render: (row) => <div><p className="font-medium text-primary">{row.name ?? "Therapeutic"}</p><p className="text-xs text-tertiary">{titleCase(row.therapeuticKind)}</p></div> },
          { key: "dose", label: "Dose", render: (row) => row.doseAmount == null ? "—" : `${row.doseAmount}${row.doseUnit ? ` ${row.doseUnit}` : ""}` },
          { key: "logged", label: "Logged", render: (row) => new Date(row.loggedAt).toLocaleString() },
          { key: "actions", label: "", align: "right", render: (row) => <RowActions onDelete={() => { if (confirmRemove(`${row.name ?? "therapeutic"} log`)) void mutation.run("health:deleteTherapeutic", { id: row.id }, "Therapeutic log deleted"); }} /> },
        ]} />
      </PersonalCard>
      <MutationNote error={mutation.error} success={mutation.success} />
    </div>
  );
}

function MetricsSection({
  data,
  client,
  onMutated,
}: {
  data: MetricsData;
  client: LifeOSClient;
  onMutated: () => void;
}) {
  const units = asUnitSystem(data.unitSystem);
  const lifecycle = useHealthMutation(client, onMutated);
  const [editingMetric, setEditingMetric] = useState<MetricsData["metrics"][number] | null>(null);
  const metricOptions = useMemo(
    () => data.latestByType.map((metric) => ({ value: metric.type, label: titleCase(metric.type) })),
    [data.latestByType],
  );
  const [selectedType, setSelectedType] = useState(metricOptions.find((option) => option.value === "weight")?.value ?? metricOptions[0]?.value ?? "weight");
  const selectedMetric = data.latestByType.find((metric) => metric.type === selectedType);
  const metricDisplayValue = (metric: { metricType?: string; type?: string; value: number; unit: string | null }) =>
    (metric.metricType ?? metric.type) === "weight"
      ? weightToDisplay(metric.value, units)
      : (metric.metricType ?? metric.type) === "waist"
        ? heightToDisplay(metric.value, units)
        : metric.value;
  const metricDisplayUnit = (metric: { metricType?: string; type?: string; value: number; unit: string | null }) =>
    (metric.metricType ?? metric.type) === "weight"
      ? weightUnit(units)
      : (metric.metricType ?? metric.type) === "waist"
        ? heightUnit(units)
        : metric.unit ?? "";
  const metricTrend = useMemo<TrendPoint[]>(() => {
    if (selectedType === "weight" && data.weightSeries?.length) {
      return data.weightSeries.slice(-90).map((point) => ({ label: shortDate(point.day), value: weightToDisplay(point.kg, units) }));
    }
    return data.metrics
      .filter((metric) => (metric.metricType === "custom" ? metric.customName ?? "custom" : metric.metricType) === selectedType)
      .slice(0, 90)
      .reverse()
      .map((metric) => ({ label: shortDate(metric.measuredAt), value: metricDisplayValue(metric) }));
  }, [data.metrics, data.weightSeries, selectedType, units]);
  const selectedUnit = selectedType === "weight" ? weightUnit(units) : selectedType === "waist" ? heightUnit(units) : selectedMetric?.unit ?? "value";
  return (
    <div className="flex flex-col gap-5">
      <MetricLogForm client={client} onMutated={onMutated} unitSystem={data.unitSystem} />
      <FormModal isOpen={Boolean(editingMetric)} onOpenChange={(open) => { if (!open) setEditingMetric(null); }} title="Edit health metric" description="Correct the reading, source unit, timestamp, or notes.">
        {editingMetric && <form className="grid gap-4" onSubmit={(event) => {
          event.preventDefault();
          const values = new FormData(event.currentTarget);
          void lifecycle.run("health:updateMetric", {
            id: editingMetric.id,
            metricType: values.get("metricType"),
            customName: values.get("customName"),
            value: values.get("value"),
            unit: values.get("unit"),
            measuredAt: values.get("measuredAt"),
            notes: values.get("notes"),
          }, "Metric updated").then((ok) => { if (ok) setEditingMetric(null); });
        }}>
          <label className="text-xs font-medium text-secondary">Metric type<RichSelect aria-label="Metric type" name="metricType" defaultValue={editingMetric.metricType} options={[{ value: "weight", label: "Weight" }, { value: "body_fat_pct", label: "Body fat" }, { value: "bmi", label: "BMI" }, { value: "waist", label: "Waist" }, { value: "resting_heart_rate", label: "Resting heart rate" }, { value: "custom", label: "Custom" }]} /></label>
          <label className="text-xs font-medium text-secondary">Custom name<input name="customName" defaultValue={editingMetric.customName ?? ""} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium text-secondary">Value<input name="value" type="number" step="any" required defaultValue={metricDisplayValue(editingMetric)} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label><label className="text-xs font-medium text-secondary">Unit<input name="unit" defaultValue={metricDisplayUnit(editingMetric)} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label></div>
          <label className="text-xs font-medium text-secondary">Measured at<input name="measuredAt" type="datetime-local" required defaultValue={medicalDateTimeValue(editingMetric.measuredAt)} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <label className="text-xs font-medium text-secondary">Notes<textarea name="notes" rows={3} defaultValue={editingMetric.notes ?? ""} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <div className="flex justify-end gap-2"><Button color="secondary" onClick={() => setEditingMetric(null)}>Cancel</Button><Button type="submit" isLoading={lifecycle.busy}>Save metric</Button></div>
        </form>}
      </FormModal>
      <StatGrid
        stats={[
          { label: "Metric entries", value: data.summary.totalEntries },
          { label: "Metric types", value: data.summary.metricTypes },
          {
            label: "Latest weight",
            value: displayWeight(data.summary.latestWeightKg, data.unitSystem),
          },
          {
            label: "Latest body fat",
            value: valueOrDash(data.summary.latestBodyFatPct, "%"),
          },
        ]}
      />
      <HealthChartCard
        title="Metric trend"
        description={`${titleCase(selectedType)} across the latest ${metricTrend.length} readings · ${selectedUnit}`}
        icon={LineChartUp02}
        action={metricOptions.length ? <div className="w-full sm:w-48"><RichSelect aria-label="Chart metric" value={selectedType} onChange={(event) => setSelectedType(event.target.value)} options={metricOptions} /></div> : undefined}
      >
        <TrendChart data={metricTrend} series={[{ key: "value", name: `${titleCase(selectedType)} (${selectedUnit})` }]} type="area" fitDomain height={260} emptyLabel="Log this metric to see its trend" />
      </HealthChartCard>
      {data.latestByType.length > 0 && (
        <PersonalCard title="Latest by metric">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {data.latestByType.slice(0, 12).map((metric) => (
              <button type="button" key={metric.type} onClick={() => setSelectedType(metric.type)} className={`rounded-lg border p-3 text-left transition ${selectedType === metric.type ? "border-brand bg-brand-secondary" : "border-secondary bg-primary hover:bg-primary_hover"}`}>
                <p className="text-xs text-tertiary">{titleCase(metric.type)}</p>
                <p className="mt-1 font-semibold text-primary">{metricDisplayValue(metric)}{metricDisplayUnit(metric) ? ` ${metricDisplayUnit(metric)}` : ""}</p>
                <p className="mt-1 text-xs text-quaternary">{formatDate(metric.measuredAt)}</p>
              </button>
            ))}
          </div>
        </PersonalCard>
      )}
      {data.girths.length > 0 && (
        <PersonalCard
          title={`Body measurements${data.girthDate ? ` · ${formatDate(data.girthDate)}` : ""}`}
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {data.girths.map((girth) => (
              <div key={girth.label} className="rounded-lg bg-secondary p-3">
                <p className="text-xs text-tertiary">{girth.label}</p>
                <p className="mt-1 font-semibold text-primary">{heightToDisplay(girth.cm, units)} {heightUnit(units)}</p>
              </div>
            ))}
          </div>
        </PersonalCard>
      )}
      <PersonalCard title="Health metrics">
        <PersonalTable
          rows={data.metrics}
          empty="No health metrics have been logged."
          columns={[
            {
              key: "metric",
              label: "Metric",
              render: (row) => (
                <span className="font-medium text-primary">
                  {row.customName ?? titleCase(row.metricType)}
                </span>
              ),
            },
            {
              key: "value",
              label: "Value",
              render: (row) => `${metricDisplayValue(row)}${metricDisplayUnit(row) ? ` ${metricDisplayUnit(row)}` : ""}`,
            },
            {
              key: "date",
              label: "Measured",
              render: (row) => new Date(row.measuredAt).toLocaleString(),
            },
            { key: "notes", label: "Notes", render: (row) => row.notes ?? "—" },
            { key: "actions", label: "", align: "right", render: (row) => <RowActions onEdit={() => setEditingMetric(row)} onDelete={() => { if (confirmRemove(`${row.customName ?? titleCase(row.metricType)} reading`)) void lifecycle.run("health:deleteMetric", { id: row.id }, "Metric deleted"); }} /> },
          ]}
        />
      </PersonalCard>
      <MutationNote error={lifecycle.error} success={lifecycle.success} />
    </div>
  );
}

type PeptideEditorState =
  | { kind: "peptide"; peptide: PeptidesData["peptides"][number] }
  | { kind: "block"; peptide: PeptidesData["peptides"][number]; block: PeptidesData["peptides"][number]["blocks"][number] | null }
  | { kind: "dose"; peptide: PeptidesData["peptides"][number]; log: PeptidesData["peptides"][number]["logs"][number] };

function PeptidesSection({ data, client, onMutated }: { data: PeptidesData; client: LifeOSClient; onMutated: () => void }) {
  const mutation = useHealthMutation(client, onMutated);
  const [editor, setEditor] = useState<PeptideEditorState | null>(null);
  const [selectedPeptideId, setSelectedPeptideId] = useState(data.peptides[0]?.id ?? "");
  const selectedPeptide = data.peptides.find((peptide) => peptide.id === selectedPeptideId) ?? data.peptides[0];
  const doseTrend = useMemo<TrendPoint[]>(
    () => selectedPeptide ? [...selectedPeptide.logs].reverse().map((log) => ({ label: shortDate(log.date), dose: log.dose })) : [],
    [selectedPeptide],
  );
  const inventory = useMemo<TrendPoint[]>(
    () => data.peptides.map((peptide) => ({ label: peptide.name, remaining: peptide.activeVialRemainingMl })),
    [data.peptides],
  );
  return (
    <div className="flex flex-col gap-5">
      <FormModal isOpen={Boolean(editor)} onOpenChange={(open) => { if (!open) setEditor(null); }} title={editor?.kind === "peptide" ? "Edit peptide" : editor?.kind === "block" ? `${editor.block ? "Edit" : "Add"} cycle block` : "Edit dose"} description={editor?.kind === "block" ? "Define the week range, dose, and weekly cadence." : editor?.kind === "dose" ? "Inventory is automatically reconciled when the used volume changes." : "Update vial, inventory, and cycle details."}>
        {editor?.kind === "peptide" && <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => {
          event.preventDefault(); const values = new FormData(event.currentTarget);
          void mutation.run("health:savePeptide", { id: editor.peptide.id, name: values.get("name"), vialMg: values.get("vialMg"), waterMl: values.get("waterMl"), doseUnit: values.get("doseUnit"), syringeUnitsPerMl: values.get("syringeUnitsPerMl"), vialsOwned: values.get("vialsOwned"), vialsOpened: values.get("vialsOpened"), activeVialRemainingMl: values.get("activeVialRemainingMl"), cycleStartDate: values.get("cycleStartDate") }, "Peptide updated").then((ok) => { if (ok) setEditor(null); });
        }}>
          <label className="text-xs font-medium text-secondary sm:col-span-2">Name<input name="name" required defaultValue={editor.peptide.name} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <label className="text-xs font-medium text-secondary">Vial amount (mg)<input name="vialMg" type="number" min="0.000001" step="any" required defaultValue={editor.peptide.vialMg} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <label className="text-xs font-medium text-secondary">Reconstitution (ml)<input name="waterMl" type="number" min="0.000001" step="any" required defaultValue={editor.peptide.waterMl} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <label className="text-xs font-medium text-secondary">Dose unit<RichSelect aria-label="Peptide dose unit" name="doseUnit" defaultValue={editor.peptide.doseUnit} options={[{ value: "mg", label: "mg" }, { value: "mcg", label: "mcg" }, { value: "units", label: "Units" }, { value: "iu", label: "IU" }]} /></label>
          <label className="text-xs font-medium text-secondary">Syringe units / ml<input name="syringeUnitsPerMl" type="number" min="1" step="1" required defaultValue={editor.peptide.syringeUnitsPerMl ?? 100} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <label className="text-xs font-medium text-secondary">Vials owned<input name="vialsOwned" type="number" min="0" step="any" required defaultValue={editor.peptide.vialsOwned} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <label className="text-xs font-medium text-secondary">Vials opened<input name="vialsOpened" type="number" min="0" step="1" required defaultValue={editor.peptide.vialsOpened ?? 0} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <label className="text-xs font-medium text-secondary">Open vial remaining (ml)<input name="activeVialRemainingMl" type="number" min="0" step="any" required defaultValue={editor.peptide.activeVialRemainingMl} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <label className="text-xs font-medium text-secondary">Cycle start<input name="cycleStartDate" type="date" defaultValue={editor.peptide.cycleStartDate ?? ""} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <div className="flex justify-end gap-2 sm:col-span-2"><Button color="secondary" onClick={() => setEditor(null)}>Cancel</Button><Button type="submit" isLoading={mutation.busy}>Save peptide</Button></div>
        </form>}
        {editor?.kind === "block" && <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => {
          event.preventDefault(); const values = new FormData(event.currentTarget);
          void mutation.run("health:savePeptideBlock", { id: editor.block?.id, peptideId: editor.peptide.id, startWeek: values.get("startWeek"), endWeek: values.get("endWeek"), dosePerAdmin: values.get("dosePerAdmin"), dosesPerWeek: values.get("dosesPerWeek"), note: values.get("note"), order: editor.block?.order ?? editor.peptide.blocks.length }, "Cycle block saved").then((ok) => { if (ok) setEditor(null); });
        }}>
          <label className="text-xs font-medium text-secondary">Start week<input name="startWeek" type="number" min="1" step="1" required defaultValue={editor.block?.startWeek ?? Math.max(1, (editor.peptide.blocks.at(-1)?.endWeek ?? 0) + 1)} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <label className="text-xs font-medium text-secondary">End week<input name="endWeek" type="number" min="1" step="1" required defaultValue={editor.block?.endWeek ?? Math.max(1, (editor.peptide.blocks.at(-1)?.endWeek ?? 0) + 4)} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <label className="text-xs font-medium text-secondary">Dose per administration<input name="dosePerAdmin" type="number" min="0.000001" step="any" required defaultValue={editor.block?.dosePerAdmin ?? ""} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <label className="text-xs font-medium text-secondary">Doses per week<input name="dosesPerWeek" type="number" min="0.01" step="any" required defaultValue={editor.block?.dosesPerWeek ?? ""} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <label className="text-xs font-medium text-secondary sm:col-span-2">Notes<textarea name="note" rows={3} defaultValue={editor.block?.note ?? ""} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <div className="flex justify-end gap-2 sm:col-span-2"><Button color="secondary" onClick={() => setEditor(null)}>Cancel</Button><Button type="submit" isLoading={mutation.busy}>Save block</Button></div>
        </form>}
        {editor?.kind === "dose" && <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => {
          event.preventDefault(); const values = new FormData(event.currentTarget);
          void mutation.run("health:updatePeptideDose", { id: editor.log.id, blockId: values.get("blockId"), dose: values.get("dose"), units: values.get("units"), mlUsed: values.get("mlUsed"), date: values.get("date"), site: values.get("site") }, "Dose updated").then((ok) => { if (ok) setEditor(null); });
        }}>
          <label className="text-xs font-medium text-secondary sm:col-span-2">Cycle block<RichSelect aria-label="Cycle block" name="blockId" defaultValue={editor.log.blockId ?? ""} placeholder="No cycle block" options={editor.peptide.blocks.map((block) => ({ value: block.id, label: `Weeks ${block.startWeek}–${block.endWeek}` }))} /></label>
          <label className="text-xs font-medium text-secondary">Dose ({editor.peptide.doseUnit})<input name="dose" type="number" min="0.000001" step="any" required defaultValue={editor.log.dose} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <label className="text-xs font-medium text-secondary">Syringe units<input name="units" type="number" min="0" step="any" required defaultValue={editor.log.units ?? editor.log.dose} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <label className="text-xs font-medium text-secondary">Volume used (ml)<input name="mlUsed" type="number" min="0" step="any" required defaultValue={editor.log.mlUsed ?? 0} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <label className="text-xs font-medium text-secondary">Date<input name="date" type="date" required defaultValue={editor.log.date.slice(0, 10)} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <label className="text-xs font-medium text-secondary sm:col-span-2">Injection site<input name="site" defaultValue={editor.log.site ?? ""} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <div className="flex justify-end gap-2 sm:col-span-2"><Button color="secondary" onClick={() => setEditor(null)}>Cancel</Button><Button type="submit" isLoading={mutation.busy}>Save dose</Button></div>
        </form>}
      </FormModal>
      <PersonalCard title="Add peptide or log a dose">
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-quaternary">New peptide</p>
          <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); const waterMl = Number(values.get("waterMl") || 0); void mutation.run("health:createPeptide", { name: values.get("name"), vialMg: Number(values.get("vialMg") || 0), waterMl, doseUnit: values.get("doseUnit") || "mg", syringeUnitsPerMl: Number(values.get("syringeUnitsPerMl") || 100), vialsOwned: Number(values.get("vialsOwned") || 1), vialsOpened: 1, activeVialRemainingMl: waterMl }, "Peptide added").then((ok) => { if (ok) form.reset(); }); }}>
            <label className="text-xs font-medium text-secondary">Name<input name="name" required placeholder="Peptide name" className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
            <label className="text-xs font-medium text-secondary">Vial amount (mg)<input name="vialMg" type="number" step="any" min="0.000001" required placeholder="10" className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
            <label className="text-xs font-medium text-secondary">Reconstitution (ml)<input name="waterMl" type="number" step="any" min="0.000001" required placeholder="2" className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
            <label className="text-xs font-medium text-secondary">Dose unit<RichSelect aria-label="Peptide dose unit" name="doseUnit" defaultValue="mg" options={[{ value: "mg", label: "mg" }, { value: "mcg", label: "mcg" }, { value: "units", label: "Units" }, { value: "iu", label: "IU" }]} /></label>
            <label className="text-xs font-medium text-secondary">Vials owned<input name="vialsOwned" type="number" step="1" min="1" required defaultValue="1" className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
            <label className="text-xs font-medium text-secondary">Syringe units / ml<input name="syringeUnitsPerMl" type="number" step="1" min="1" required defaultValue="100" className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
            <div className="flex justify-end sm:col-span-2 lg:col-span-3"><button className={`${HEALTH_BUTTON_CLASS} w-full sm:w-auto`} disabled={mutation.busy}>Add peptide</button></div>
          </form>
        </div>
        {data.peptides.length > 0 && <div className="mt-5 border-t border-secondary pt-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-quaternary">Log dose</p>
          <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); const mlUsed = String(values.get("mlUsed") ?? "").trim(); void mutation.run("health:logPeptideDose", { peptideId: selectedPeptide?.id, blockId: values.get("blockId"), dose: Number(values.get("dose") || 0), units: Number(values.get("units") || 0), mlUsed: mlUsed ? Number(mlUsed) : null, date: values.get("date"), site: values.get("site") }, "Dose logged").then((ok) => { if (ok) form.reset(); }); }}>
            <label className="text-xs font-medium text-secondary">Peptide<RichSelect aria-label="Peptide to log" value={selectedPeptide?.id ?? ""} onChange={(event) => setSelectedPeptideId(event.target.value)} options={data.peptides.map((peptide) => ({ value: peptide.id, label: peptide.name }))} /></label>
            <label className="text-xs font-medium text-secondary">Cycle block<RichSelect aria-label="Cycle block" name="blockId" placeholder="No cycle block" options={(selectedPeptide?.blocks ?? []).map((block) => ({ value: block.id, label: `Weeks ${block.startWeek}–${block.endWeek}` }))} /></label>
            <label className="text-xs font-medium text-secondary">Dose ({selectedPeptide?.doseUnit ?? "units"})<input name="dose" type="number" step="any" min="0.000001" required placeholder="Dose amount" className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
            <label className="text-xs font-medium text-secondary">Syringe units<input name="units" type="number" step="any" min="0" required placeholder="0" className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
            <label className="text-xs font-medium text-secondary">Volume used (ml)<input name="mlUsed" type="number" step="any" min="0" placeholder="Auto from syringe units" className={`${HEALTH_FIELD_CLASS} mt-1.5`} /><span className="mt-1 block font-normal text-quaternary">Leave blank to calculate from syringe units.</span></label>
            <label className="text-xs font-medium text-secondary">Date<input name="date" type="date" required defaultValue={todayInput()} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
            <label className="text-xs font-medium text-secondary sm:col-span-2 lg:col-span-3">Injection site<input name="site" placeholder="Optional" className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
            <div className="flex justify-end sm:col-span-2 lg:col-span-3"><button className={`${HEALTH_BUTTON_CLASS} w-full sm:w-auto`} disabled={mutation.busy}>Log dose</button></div>
          </form>
        </div>}
        <MutationNote error={mutation.error} success={mutation.success} />
      </PersonalCard>
      <StatGrid
        stats={[
          { label: "Peptides", value: data.summary.peptides },
          { label: "Active cycles", value: data.summary.activeCycles },
          { label: "Vials owned", value: data.summary.vialsOwned },
          {
            label: "Recent doses",
            value: data.summary.dosesLogged,
            detail: "Up to 90 per peptide",
          },
        ]}
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <HealthChartCard
          title="Dose history"
          description={selectedPeptide ? `${selectedPeptide.name} · ${selectedPeptide.doseUnit}` : "Choose a peptide"}
          icon={Activity}
          action={data.peptides.length ? <div className="w-full sm:w-44"><RichSelect aria-label="Dose history peptide" value={selectedPeptide?.id ?? ""} onChange={(event) => setSelectedPeptideId(event.target.value)} options={data.peptides.map((peptide) => ({ value: peptide.id, label: peptide.name }))} /></div> : undefined}
        >
          <TrendChart data={doseTrend} series={[{ key: "dose", name: `Dose (${selectedPeptide?.doseUnit ?? "units"})` }]} type="area" fitDomain height={230} emptyLabel="No doses logged for this peptide" />
        </HealthChartCard>
        <HealthChartCard title="Open-vial inventory" description="Remaining reconstituted volume for each active vial" icon={Droplets01}>
          <TrendChart data={inventory} series={[{ key: "remaining", name: "Remaining (ml)" }]} type="bar" height={230} emptyLabel="No peptide inventory configured" />
        </HealthChartCard>
      </div>
      <PersonalCard title="Peptide inventory">
        <PersonalTable
          rows={data.peptides}
          empty="No peptides have been configured."
          columns={[
            {
              key: "name",
              label: "Peptide",
              render: (row) => (
                <div>
                  <p className="font-medium text-primary">{row.name}</p>
                  <p className="text-xs text-tertiary">
                    {row.vialMg} mg / {row.waterMl} ml
                  </p>
                </div>
              ),
            },
            {
              key: "cycle",
              label: "Cycle",
              render: (row) =>
                row.currentWeek ? `Week ${row.currentWeek}` : "Not started",
            },
            {
              key: "inventory",
              label: "Inventory",
              render: (row) =>
                `${formatDecimal(row.vialsOwned, 2)} vials · ${formatDecimal(row.activeVialRemainingMl)} ml open`,
            },
            {
              key: "last",
              label: "Last dose",
              render: (row) =>
                row.lastDose
                  ? `${row.lastDose.dose} ${row.doseUnit} · ${formatDate(row.lastDose.date)}`
                  : "—",
            },
            {
              key: "blocks",
              label: "Blocks",
              align: "right",
              render: (row) => row.blocks.length,
            },
            { key: "actions", label: "", align: "right", render: (row) => <RowActions onEdit={() => setEditor({ kind: "peptide", peptide: row })} onDelete={() => { if (confirmRemove(`peptide “${row.name}” and its dose history`)) void mutation.run("health:deletePeptide", { id: row.id }, "Peptide deleted"); }}><button type="button" onClick={() => { setSelectedPeptideId(row.id); setEditor({ kind: "block", peptide: row, block: null }); }} className="rounded-md px-2 py-1 text-xs font-semibold text-brand-secondary hover:bg-brand-secondary">Add block</button></RowActions> },
          ]}
        />
      </PersonalCard>
      <div className="grid gap-5 lg:grid-cols-2">
        <PersonalCard title={selectedPeptide ? `${selectedPeptide.name} cycle blocks` : "Cycle blocks"} action={selectedPeptide ? <Button size="xs" color="secondary" iconLeading={Plus} onClick={() => setEditor({ kind: "block", peptide: selectedPeptide, block: null })}>Add block</Button> : undefined}>
          {selectedPeptide ? <PersonalTable rows={selectedPeptide.blocks} empty="No cycle blocks configured." columns={[
            { key: "weeks", label: "Weeks", render: (row) => `${row.startWeek}–${row.endWeek}` },
            { key: "dose", label: "Dose", render: (row) => `${row.dosePerAdmin} ${selectedPeptide.doseUnit}` },
            { key: "cadence", label: "Cadence", render: (row) => `${row.dosesPerWeek}× / week` },
            { key: "actions", label: "", align: "right", render: (row) => <RowActions onEdit={() => setEditor({ kind: "block", peptide: selectedPeptide, block: row })} onDelete={() => { if (confirmRemove(`weeks ${row.startWeek}–${row.endWeek} cycle block`)) void mutation.run("health:deletePeptideBlock", { id: row.id }, "Cycle block deleted"); }} /> },
          ]} /> : <EmptyMessage>Add a peptide to build a cycle.</EmptyMessage>}
        </PersonalCard>
        <PersonalCard title={selectedPeptide ? `${selectedPeptide.name} dose log` : "Dose log"}>
          {selectedPeptide ? <PersonalTable rows={selectedPeptide.logs} empty="No doses logged." columns={[
            { key: "date", label: "Date", render: (row) => formatDate(row.date) },
            { key: "dose", label: "Dose", render: (row) => `${row.dose} ${selectedPeptide.doseUnit}` },
            { key: "site", label: "Site", render: (row) => row.site ?? "—" },
            { key: "actions", label: "", align: "right", render: (row) => <RowActions onEdit={() => setEditor({ kind: "dose", peptide: selectedPeptide, log: row })} onDelete={() => { if (confirmRemove(`dose from ${formatDate(row.date)}`)) void mutation.run("health:deletePeptideDose", { id: row.id }, "Dose deleted and inventory restored"); }} /> },
          ]} /> : <EmptyMessage>Add a peptide to log doses.</EmptyMessage>}
        </PersonalCard>
      </div>
    </div>
  );
}

function healthImageDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

function inferredImageMime(file: File): string {
  if (file.type) return file.type;
  const extension = file.name.toLowerCase().split(".").pop();
  return extension === "png" ? "image/png" : extension === "gif" ? "image/gif" : extension === "webp" ? "image/webp" : "image/jpeg";
}

function HealthPhotoUpload({ data, client, onMutated }: { data: PhotosData; client: LifeOSClient; onMutated: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [date, setDate] = useState(todayInput());
  const [angle, setAngle] = useState("");
  const [phase, setPhase] = useState("");
  const [weight, setWeight] = useState("");
  const [workoutId, setWorkoutId] = useState("");
  const [notes, setNotes] = useState("");
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const mutation = useHealthMutation(client, onMutated);
  const weightUnit = data.unitSystem === "METRIC" ? "kg" : "lb";
  const minimumWeight = weightUnit === "lb" ? 2.3 : 1;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setPrepareError(null);
    if (!file) return setPrepareError("Choose a progress image first.");
    if (file.size > 25 * 1024 * 1024) return setPrepareError("Progress photos must be 25 MB or smaller.");
    const enteredWeight = weight.trim() ? Number(weight) : null;
    const enteredWeightKg = enteredWeight === null ? null : weightUnit === "lb" ? enteredWeight / 2.2046226218 : enteredWeight;
    if (enteredWeightKg !== null && (!Number.isFinite(enteredWeightKg) || enteredWeightKg < 1)) return setPrepareError(`Enter at least ${minimumWeight} ${weightUnit}, or leave weight blank.`);
    try {
      const saved = await mutation.run("health:createProgressPhoto", {
        fileName: file.name,
        mimeType: inferredImageMime(file),
        base64: await healthImageDataUrl(file),
        takenAt: date,
        angle: angle || null,
        phase: phase || null,
        weightKg: enteredWeightKg,
        workoutId: workoutId || null,
        notes: notes.trim() || null,
      }, "Progress photo uploaded");
      if (!saved) return;
      form.reset();
      setFile(null); setDate(todayInput()); setAngle(""); setPhase(""); setWeight(""); setWorkoutId(""); setNotes("");
    } catch (error) {
      setPrepareError(error instanceof Error ? error.message : "Could not prepare the image.");
    }
  };
  return (
    <PersonalCard title="Add progress photo">
      <form onSubmit={(event) => void submit(event)} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1.5 text-xs font-medium text-secondary sm:col-span-2">Image<input type="file" required accept="image/jpeg,image/png,image/gif,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className={HEALTH_FIELD_CLASS} /></label>
        <label className="flex flex-col gap-1.5 text-xs font-medium text-secondary">Date<input type="date" required value={date} onChange={(event) => setDate(event.target.value)} className={HEALTH_FIELD_CLASS} /></label>
        <label className="flex flex-col gap-1.5 text-xs font-medium text-secondary">Weight ({weightUnit})<input type="number" min={minimumWeight} step="0.1" value={weight} onChange={(event) => setWeight(event.target.value)} placeholder="Optional" className={HEALTH_FIELD_CLASS} /></label>
        <label className="flex flex-col gap-1.5 text-xs font-medium text-secondary">Angle<RichSelect aria-label="Progress photo angle" value={angle} onChange={(event) => setAngle(event.target.value)} placeholder="Untagged" options={[{ value: "FRONT", label: "Front" }, { value: "SIDE", label: "Side" }, { value: "BACK", label: "Back" }]} /></label>
        <label className="flex flex-col gap-1.5 text-xs font-medium text-secondary">Phase<RichSelect aria-label="Progress photo phase" value={phase} onChange={(event) => setPhase(event.target.value)} placeholder="Untagged" options={[{ value: "BULK", label: "Bulk" }, { value: "CUT", label: "Cut" }, { value: "MAINTAIN", label: "Maintain" }]} /></label>
        <label className="flex flex-col gap-1.5 text-xs font-medium text-secondary sm:col-span-2">Workout<RichSelect aria-label="Linked workout" value={workoutId} onChange={(event) => setWorkoutId(event.target.value)} placeholder="No linked workout" options={data.workoutOptions.map((workout) => ({ value: workout.id, label: `${workout.name} · ${formatDate(workout.date)}` }))} /></label>
        <label className="flex flex-col gap-1.5 text-xs font-medium text-secondary sm:col-span-2 lg:col-span-3">Notes<input value={notes} maxLength={4000} onChange={(event) => setNotes(event.target.value)} placeholder="Optional context" className={HEALTH_FIELD_CLASS} /></label>
        <div className="flex items-end justify-end"><button type="submit" disabled={mutation.busy} className={HEALTH_BUTTON_CLASS}>{mutation.busy ? "Uploading…" : "Upload photo"}</button></div>
      </form>
      {prepareError && <p role="alert" className="mt-3 text-sm text-error-primary">{prepareError}</p>}
      <MutationNote error={mutation.error} success={mutation.success} />
    </PersonalCard>
  );
}

function PhotosSection({ data, client, onMutated }: { data: PhotosData; client: LifeOSClient; onMutated: () => void }) {
  const mutation = useHealthMutation(client, onMutated);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [editingPhoto, setEditingPhoto] = useState<PhotosData["photos"][number] | null>(null);
  const units = asUnitSystem(data.unitSystem);
  const photoWeightTrend = useMemo<TrendPoint[]>(
    () => [...data.photos].reverse().filter((photo) => photo.weightKg != null).map((photo) => ({ label: shortDate(photo.takenAt), weight: weightToDisplay(photo.weightKg as number, units) })),
    [data.photos, units],
  );
  const angleCoverage = useMemo<TrendPoint[]>(
    () => [{ label: "Front", photos: data.summary.angles.front }, { label: "Side", photos: data.summary.angles.side }, { label: "Back", photos: data.summary.angles.back }],
    [data.summary.angles],
  );
  return (
    <div className="flex flex-col gap-5">
      <FormModal isOpen={Boolean(editingPhoto)} onOpenChange={(open) => { if (!open) setEditingPhoto(null); }} title="Edit progress photo" description="Update private metadata without replacing the original image.">
        {editingPhoto && <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); const values = new FormData(event.currentTarget); void mutation.run("health:updateProgressPhoto", { id: editingPhoto.id, takenAt: values.get("takenAt"), angle: values.get("angle"), phase: values.get("phase"), weightKg: String(values.get("weight") ?? "").trim() ? parseWeightInput(String(values.get("weight")), units) : null, workoutId: values.get("workoutId"), notes: values.get("notes") }, "Photo details updated").then((ok) => { if (ok) setEditingPhoto(null); }); }}>
          <label className="text-xs font-medium text-secondary">Date<input name="takenAt" type="date" required defaultValue={editingPhoto.takenAt.slice(0, 10)} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <label className="text-xs font-medium text-secondary">Weight ({weightUnit(units)})<input name="weight" type="number" min={units === "IMPERIAL" ? 2.3 : 1} step="0.1" defaultValue={editingPhoto.weightKg == null ? "" : weightToDisplay(editingPhoto.weightKg, units)} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <label className="text-xs font-medium text-secondary">Angle<RichSelect aria-label="Progress photo angle" name="angle" defaultValue={editingPhoto.angle ?? ""} placeholder="Untagged" options={[{ value: "FRONT", label: "Front" }, { value: "SIDE", label: "Side" }, { value: "BACK", label: "Back" }]} /></label>
          <label className="text-xs font-medium text-secondary">Phase<RichSelect aria-label="Progress photo phase" name="phase" defaultValue={editingPhoto.phase ?? ""} placeholder="Untagged" options={[{ value: "BULK", label: "Bulk" }, { value: "CUT", label: "Cut" }, { value: "MAINTAIN", label: "Maintain" }]} /></label>
          <label className="text-xs font-medium text-secondary sm:col-span-2">Workout<RichSelect aria-label="Linked workout" name="workoutId" defaultValue={editingPhoto.workout?.id ?? ""} placeholder="No linked workout" options={data.workoutOptions.map((workout) => ({ value: workout.id, label: `${workout.name} · ${formatDate(workout.date)}` }))} /></label>
          <label className="text-xs font-medium text-secondary sm:col-span-2">Notes<textarea name="notes" rows={4} defaultValue={editingPhoto.notes ?? ""} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <div className="flex justify-end gap-2 sm:col-span-2"><Button color="secondary" onClick={() => setEditingPhoto(null)}>Cancel</Button><Button type="submit" isLoading={mutation.busy}>Save details</Button></div>
        </form>}
      </FormModal>
      <StatGrid
        stats={[
          { label: "Progress photos", value: data.summary.photos },
          { label: "Processed", value: data.summary.processed },
          { label: "Workout-linked", value: data.summary.linkedToWorkout },
          {
            label: "Angles",
            value: `${data.summary.angles.front}/${data.summary.angles.side}/${data.summary.angles.back}`,
            detail: "Front / side / back",
          },
        ]}
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <HealthChartCard title="Photo check-in weight" description={`Weight recorded alongside progress photos · ${weightUnit(units)}`} icon={Scale01}>
          <TrendChart data={photoWeightTrend} series={[{ key: "weight", name: `Weight (${weightUnit(units)})` }]} type="area" fitDomain height={220} emptyLabel="Add weight to progress photos to see this trend" />
        </HealthChartCard>
        <HealthChartCard title="Angle coverage" description="Front, side, and back photos captured" icon={Camera01}>
          <TrendChart data={data.summary.photos ? angleCoverage : []} series={[{ key: "photos", name: "Photos" }]} type="bar" height={220} emptyLabel="No progress photos yet" />
        </HealthChartCard>
      </div>
      <HealthPhotoUpload data={data} client={client} onMutated={onMutated} />
      {data.photos.length === 0 ? (
        <EmptyMessage>No progress photos found.</EmptyMessage>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {data.photos.map((photo) => (
            <PersonalCard key={photo.id}>
              {photo.url ? (
                <img
                  src={photo.url}
                  alt={`${titleCase(photo.angle)} progress`}
                  className={`aspect-[4/5] w-full rounded-lg object-cover transition-[filter] ${revealed[photo.id] ? "" : "blur-md"}`}
                  onError={(event) => { event.currentTarget.style.display = "none"; }}
                />
              ) : (
                <div className="flex aspect-[4/5] items-center justify-center rounded-lg bg-secondary px-4 text-center text-xs text-tertiary">
                  Preview unavailable for this stored asset
                </div>
              )}
              {photo.url && !revealed[photo.id] && <button type="button" onClick={() => setRevealed((current) => ({ ...current, [photo.id]: true }))} className="mt-2 w-full rounded-lg border border-secondary bg-primary px-3 py-2 text-xs font-semibold text-secondary hover:bg-primary_hover">Reveal photo</button>}
              <div className="mt-3 flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-primary">
                    {titleCase(photo.angle)}
                  </p>
                  <p className="text-xs text-tertiary">
                    {formatDate(photo.takenAt)} · {titleCase(photo.phase)}
                  </p>
                </div>
                {photo.weightKg != null && (
                  <span className="text-xs text-secondary">
                    {displayWeight(photo.weightKg, data.unitSystem)}
                  </span>
                )}
              </div>
              {photo.workout && (
                <p className="mt-2 text-xs text-tertiary">
                  {photo.workout.name}
                </p>
              )}
              {photo.notes && <p className="mt-2 line-clamp-2 text-xs text-secondary">{photo.notes}</p>}
              <div className="mt-3 flex items-center justify-between gap-2">
                {photo.originalUrl ? <a href={photo.originalUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold text-brand-secondary hover:underline">Open original</a> : <span />}
                <RowActions onEdit={() => setEditingPhoto(photo)} onDelete={() => {
                  if (window.confirm(`Delete the progress photo from ${formatDate(photo.takenAt)}?`)) void mutation.run("health:deleteProgressPhoto", { id: photo.id }, "Progress photo deleted");
                }} />
              </div>
            </PersonalCard>
          ))}
        </div>
      )}
      <MutationNote error={mutation.error} success={mutation.success} />
    </div>
  );
}

function SleepSection({
  data,
  client,
  onMutated,
}: {
  data: SleepData;
  client: LifeOSClient;
  onMutated: () => void;
}) {
  const lifecycle = useHealthMutation(client, onMutated);
  const [editingSleep, setEditingSleep] = useState<SleepData["entries"][number] | null>(null);
  const sleepTrend = useMemo<TrendPoint[]>(
    () => [...data.entries].reverse().slice(-60).map((entry) => ({
      label: shortDate(entry.date),
      hours: entry.totalMinutes == null ? null : Math.round((entry.totalMinutes / 60) * 10) / 10,
      quality: entry.sleepQuality,
      rested: entry.feelRested,
      hrv: entry.hrvMs,
      restingHr: entry.restingHrBpm,
    })),
    [data.entries],
  );
  return (
    <div className="flex flex-col gap-5">
      <SleepLogForm client={client} onMutated={onMutated} entries={data.entries} onEditExisting={setEditingSleep} />
      <FormModal isOpen={Boolean(editingSleep)} onOpenChange={(open) => { if (!open) setEditingSleep(null); }} title="Edit sleep entry" description="Update recovery metrics for this calendar night.">
        {editingSleep && <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => {
          event.preventDefault();
          const values = new FormData(event.currentTarget);
          void lifecycle.run("health:upsertSleep", {
            date: editingSleep.date,
            bedtime: values.get("bedtime"),
            wakeTime: values.get("wakeTime"),
            totalMinutes: values.get("totalMinutes"),
            sleepQuality: values.get("sleepQuality"),
            feelRested: values.get("feelRested"),
            sleepLatencyMin: values.get("sleepLatencyMin"),
            restingHrBpm: values.get("restingHrBpm"),
            hrvMs: values.get("hrvMs"),
            notes: values.get("notes"),
          }, "Sleep entry updated").then((ok) => { if (ok) setEditingSleep(null); });
        }}>
          <div className="rounded-lg bg-secondary p-3 sm:col-span-2"><p className="text-xs text-tertiary">Night</p><p className="mt-1 font-semibold text-primary">{formatDate(editingSleep.date)}</p></div>
          <label className="text-xs font-medium text-secondary">Bedtime<input name="bedtime" type="datetime-local" defaultValue={medicalDateTimeValue(editingSleep.bedtime)} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <label className="text-xs font-medium text-secondary">Wake time<input name="wakeTime" type="datetime-local" defaultValue={medicalDateTimeValue(editingSleep.wakeTime)} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <label className="text-xs font-medium text-secondary">Duration (minutes)<input name="totalMinutes" type="number" min="0" max="1440" defaultValue={editingSleep.totalMinutes ?? ""} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <label className="text-xs font-medium text-secondary">Latency (minutes)<input name="sleepLatencyMin" type="number" min="0" max="600" defaultValue={editingSleep.sleepLatencyMin ?? ""} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <label className="text-xs font-medium text-secondary">Quality<RichSelect aria-label="Sleep quality" name="sleepQuality" defaultValue={String(editingSleep.sleepQuality ?? "")} placeholder="Not rated" options={[1, 2, 3, 4, 5].map((score) => ({ value: String(score), label: `${score}/5` }))} /></label>
          <label className="text-xs font-medium text-secondary">Rested<RichSelect aria-label="How rested you feel" name="feelRested" defaultValue={String(editingSleep.feelRested ?? "")} placeholder="Not rated" options={[1, 2, 3, 4, 5].map((score) => ({ value: String(score), label: `${score}/5` }))} /></label>
          <label className="text-xs font-medium text-secondary">Resting HR (bpm)<input name="restingHrBpm" type="number" min="20" max="300" defaultValue={editingSleep.restingHrBpm ?? ""} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <label className="text-xs font-medium text-secondary">HRV (ms)<input name="hrvMs" type="number" min="0" max="1000" defaultValue={editingSleep.hrvMs ?? ""} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <label className="text-xs font-medium text-secondary sm:col-span-2">Notes<textarea name="notes" rows={3} defaultValue={editingSleep.notes ?? ""} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <div className="flex justify-end gap-2 sm:col-span-2"><Button color="secondary" onClick={() => setEditingSleep(null)}>Cancel</Button><Button type="submit" isLoading={lifecycle.busy}>Save sleep</Button></div>
        </form>}
      </FormModal>
      <StatGrid
        stats={[
          {
            label: "Average sleep",
            value: formatMinutes(data.summary.averageMinutes),
            detail: "Last 30 entries",
          },
          {
            label: "Average quality",
            value: valueOrDash(data.summary.averageQuality, "/5"),
          },
          {
            label: "Sleep latency",
            value: valueOrDash(data.summary.averageLatencyMin, " min"),
          },
          {
            label: "Interruptions",
            value: data.summary.interruptions,
            detail: "Last 30 entries",
          },
        ]}
      />
      <div className="grid gap-5 xl:grid-cols-3">
        <HealthChartCard title="Sleep duration" description="Hours asleep per night" icon={Moon01}>
          <TrendChart data={sleepTrend.filter((point) => typeof point.hours === "number")} series={[{ key: "hours", name: "Sleep (hours)" }]} type="area" fitDomain height={220} emptyLabel="No sleep duration history" />
        </HealthChartCard>
        <HealthChartCard title="Sleep quality" description="Quality and rested scores out of five" icon={CheckCircle}>
          <TrendChart data={sleepTrend.filter((point) => typeof point.quality === "number" || typeof point.rested === "number")} series={[{ key: "quality", name: "Quality (/5)" }, { key: "rested", name: "Rested (/5)" }]} type="line" fitDomain height={220} emptyLabel="No sleep quality history" />
        </HealthChartCard>
        <HealthChartCard title="Nightly recovery" description="HRV and resting heart rate when recorded" icon={ActivityHeart}>
          <TrendChart data={sleepTrend.filter((point) => typeof point.hrv === "number" || typeof point.restingHr === "number")} series={[{ key: "hrv", name: "HRV (ms)" }, { key: "restingHr", name: "Resting HR (bpm)" }]} type="line" fitDomain height={220} emptyLabel="No HRV or heart-rate history" />
        </HealthChartCard>
      </div>
      <PersonalCard title="Sleep history">
        <PersonalTable
          rows={data.entries}
          empty="No sleep entries found."
          columns={[
            {
              key: "date",
              label: "Date",
              render: (row) => formatDate(row.date),
            },
            {
              key: "duration",
              label: "Duration",
              render: (row) => formatMinutes(row.totalMinutes),
            },
            {
              key: "quality",
              label: "Quality",
              render: (row) => valueOrDash(row.sleepQuality, "/5"),
            },
            {
              key: "rested",
              label: "Rested",
              render: (row) => valueOrDash(row.feelRested, "/5"),
            },
            {
              key: "heart",
              label: "Resting HR",
              render: (row) => valueOrDash(row.restingHrBpm, " bpm"),
            },
            {
              key: "interruptions",
              label: "Interruptions",
              align: "right",
              render: (row) => row.interruptions.length,
            },
            { key: "actions", label: "", align: "right", render: (row) => <RowActions onEdit={() => setEditingSleep(row)} onDelete={() => { if (confirmRemove(`sleep entry for ${formatDate(row.date)}`)) void lifecycle.run("health:deleteSleep", { id: row.id }, "Sleep entry deleted"); }} /> },
          ]}
        />
      </PersonalCard>
      <MutationNote error={lifecycle.error} success={lifecycle.success} />
    </div>
  );
}

type SobrietyEditorState = {
  kind: "counter" | "relapse";
  counter: SobrietyData["counters"][number];
};

function SobrietySection({ data, client, onMutated }: { data: SobrietyData; client: LifeOSClient; onMutated: () => void }) {
  const mutation = useHealthMutation(client, onMutated);
  const [editor, setEditor] = useState<SobrietyEditorState | null>(null);
  const substanceOptions = useMemo(
    () => Array.from(new Set([
      "Alcohol",
      "Nicotine",
      "Cannabis",
      "Caffeine",
      ...data.customTypes.map((custom) => custom.name),
      ...data.substanceLogs.map((log) => titleCase(log.substanceType)),
    ])).sort((left, right) => left.localeCompare(right)),
    [data.customTypes, data.substanceLogs],
  );
  const streakData = useMemo<TrendPoint[]>(
    () => data.counters.map((counter) => ({ label: counter.name, current: counter.currentStreakDays, best: counter.bestStreakDays })),
    [data.counters],
  );
  const logActivity = useMemo(
    () => completionActivity(data.substanceLogs.map((log) => dateKey(log.loggedAt)), 30),
    [data.substanceLogs],
  );
  return (
    <div className="flex flex-col gap-5">
      <FormModal isOpen={Boolean(editor)} onOpenChange={(open) => { if (!open) setEditor(null); }} title={editor?.kind === "relapse" ? "Record a reset" : "Edit sobriety counter"} description={editor?.kind === "relapse" ? "Record the event and choose when the new streak begins." : "Update the counter details or archive it without deleting history."}>
        {editor?.kind === "counter" && <form className="grid gap-4" onSubmit={(event) => {
          event.preventDefault();
          const values = new FormData(event.currentTarget);
          void mutation.run("health:updateSobrietyCounter", { id: editor.counter.id, name: values.get("name"), description: values.get("description"), color: values.get("color"), startedAt: values.get("startedAt"), archived: values.get("archived") === "true" }, "Counter updated").then((ok) => { if (ok) setEditor(null); });
        }}>
          <label className="text-xs font-medium text-secondary">Name<input name="name" required defaultValue={editor.counter.name} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <label className="text-xs font-medium text-secondary">Description<textarea name="description" rows={3} defaultValue={editor.counter.description ?? ""} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium text-secondary">Current streak began<input name="startedAt" type="date" required defaultValue={editor.counter.startedAt.slice(0, 10)} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label><label className="text-xs font-medium text-secondary">Color<input name="color" type="color" defaultValue={editor.counter.color ?? "#f43f5e"} className={`${HEALTH_FIELD_CLASS} mt-1.5 h-10 p-1`} /></label></div>
          <label className="text-xs font-medium text-secondary">Status<RichSelect aria-label="Sobriety counter status" name="archived" defaultValue={String(editor.counter.archived)} options={[{ value: "false", label: "Active" }, { value: "true", label: "Archived" }]} /></label>
          <div className="flex justify-end gap-2"><Button color="secondary" onClick={() => setEditor(null)}>Cancel</Button><Button type="submit" isLoading={mutation.busy}>Save counter</Button></div>
        </form>}
        {editor?.kind === "relapse" && <form className="grid gap-4" onSubmit={(event) => {
          event.preventDefault();
          const values = new FormData(event.currentTarget);
          void mutation.run("health:logRelapse", { counterId: editor.counter.id, relapsedAt: values.get("relapsedAt"), restartAt: values.get("restartAt"), notes: values.get("notes") }, "Reset recorded").then((ok) => { if (ok) setEditor(null); });
        }}>
          <div className="rounded-lg bg-secondary p-3"><p className="text-xs text-tertiary">Counter</p><p className="mt-1 font-semibold text-primary">{editor.counter.name}</p></div>
          <label className="text-xs font-medium text-secondary">Event time<input name="relapsedAt" type="datetime-local" required defaultValue={medicalDateTimeValue(new Date().toISOString())} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <label className="text-xs font-medium text-secondary">Restart streak at<input name="restartAt" type="datetime-local" required defaultValue={medicalDateTimeValue(new Date().toISOString())} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <label className="text-xs font-medium text-secondary">Private notes<textarea name="notes" rows={4} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <div className="flex justify-end gap-2"><Button color="secondary" onClick={() => setEditor(null)}>Cancel</Button><Button type="submit" color="primary-destructive" isLoading={mutation.busy}>Record reset</Button></div>
        </form>}
      </FormModal>
      <PersonalCard title="Start a sobriety counter or log a substance">
        <div className="grid gap-4 lg:grid-cols-2">
          <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); void mutation.run("health:createSobrietyCounter", { name: values.get("name"), description: values.get("description"), startedAt: values.get("startedAt") }, "Counter created").then((ok) => { if (ok) form.reset(); }); }}>
            <input name="name" required placeholder="Counter name" className={HEALTH_FIELD_CLASS} />
            <input name="startedAt" type="date" defaultValue={todayInput()} className={HEALTH_FIELD_CLASS} />
            <button className={HEALTH_BUTTON_CLASS} disabled={mutation.busy}>Start counter</button>
          </form>
          <form className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); void mutation.run("health:logSubstance", { substanceType: values.get("substanceType"), amount: values.get("amount"), unit: values.get("unit"), loggedAt: values.get("loggedAt"), notes: values.get("notes") }, "Substance logged").then((ok) => { if (ok) form.reset(); }); }}>
            <div><input name="substanceType" list="health-substance-options" required placeholder="Substance" className={HEALTH_FIELD_CLASS} /><datalist id="health-substance-options">{substanceOptions.map((option) => <option key={option} value={option} />)}</datalist></div>
            <input name="amount" type="number" step="any" placeholder="Amount / optional" className={HEALTH_FIELD_CLASS} />
            <input name="unit" placeholder="Unit (drinks, mg, etc.)" className={HEALTH_FIELD_CLASS} />
            <input name="loggedAt" type="datetime-local" defaultValue={medicalDateTimeValue(new Date().toISOString())} className={HEALTH_FIELD_CLASS} />
            <input name="notes" maxLength={2000} placeholder="Context or notes" className={HEALTH_FIELD_CLASS} />
            <button className={HEALTH_BUTTON_CLASS} disabled={mutation.busy}>Log use</button>
          </form>
        </div>
        <MutationNote error={mutation.error} success={mutation.success} />
      </PersonalCard>
      <StatGrid
        stats={[
          { label: "Active counters", value: data.summary.activeCounters },
          {
            label: "Longest current",
            value: `${data.summary.longestCurrentDays} days`,
          },
          {
            label: "Personal best",
            value: `${data.summary.longestBestDays} days`,
          },
          {
            label: "Substance logs",
            value: data.summary.substanceLogs,
            detail: `${data.summary.relapses} relapses recorded`,
          },
        ]}
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <HealthChartCard title="Streak progress" description="Current streak compared with your personal best" icon={ShieldTick}>
          <TrendChart data={streakData} series={[{ key: "current", name: "Current days" }, { key: "best", name: "Best days" }]} type="bar" height={240} emptyLabel="Start a counter to track streak progress" />
        </HealthChartCard>
        <HealthChartCard title="Substance log activity" description="Recorded events across the last 30 days" icon={Activity}>
          <TrendChart data={data.substanceLogs.length ? logActivity : []} series={[{ key: "completed", name: "Logged events" }]} type="bar" height={240} emptyLabel="No substance log activity" />
        </HealthChartCard>
      </div>
      <PersonalCard title="Sobriety counters">
        <PersonalTable
          rows={data.counters}
          empty="No sobriety counters found."
          columns={[
            {
              key: "name",
              label: "Counter",
              render: (row) => (
                <div>
                  <p className="font-medium text-primary">{row.name}</p>
                  {row.description && (
                    <p className="text-xs text-tertiary">{row.description}</p>
                  )}
                </div>
              ),
            },
            {
              key: "started",
              label: "Current since",
              render: (row) => formatDate(row.startedAt),
            },
            {
              key: "current",
              label: "Current",
              align: "right",
              render: (row) => `${row.currentStreakDays} days`,
            },
            {
              key: "best",
              label: "Best",
              align: "right",
              render: (row) => `${row.bestStreakDays} days`,
            },
            {
              key: "status",
              label: "Status",
              align: "right",
              render: (row) => (row.archived ? "Archived" : "Active"),
            },
            { key: "actions", label: "", align: "right", render: (row) => <RowActions onEdit={() => setEditor({ kind: "counter", counter: row })} onDelete={() => { if (confirmRemove(`sobriety counter “${row.name}”`)) void mutation.run("health:deleteSobrietyCounter", { id: row.id }, "Counter deleted"); }}><button type="button" onClick={() => setEditor({ kind: "relapse", counter: row })} className="rounded-md px-2 py-1 text-xs font-semibold text-error-primary hover:bg-error-primary">Reset</button></RowActions> },
          ]}
        />
      </PersonalCard>
      <PersonalCard title="Reset history">
        {data.counters.every((counter) => counter.relapses.length === 0) ? <EmptyMessage>No resets recorded.</EmptyMessage> : <div className="space-y-3">{data.counters.flatMap((counter) => counter.relapses.map((relapse) => ({ ...relapse, counterName: counter.name }))).sort((left, right) => right.relapsedAt.localeCompare(left.relapsedAt)).map((relapse) => <div key={relapse.id} className="flex items-start justify-between gap-3 rounded-lg border border-secondary p-3"><div><p className="text-sm font-medium text-primary">{relapse.counterName}</p><p className="mt-0.5 text-xs text-tertiary">{new Date(relapse.relapsedAt).toLocaleString()}</p>{relapse.notes && <p className="mt-1 text-xs text-secondary">{relapse.notes}</p>}</div><RowActions onDelete={() => { if (confirmRemove("this reset record")) void mutation.run("health:deleteRelapse", { id: relapse.id }, "Reset record deleted"); }} /></div>)}</div>}
      </PersonalCard>
      <PersonalCard title="Substance log">
        <PersonalTable
          rows={data.substanceLogs.slice(0, 100)}
          empty="No substance logs found."
          columns={[
            {
              key: "type",
              label: "Substance",
              render: (row) => titleCase(row.substanceType),
            },
            {
              key: "amount",
              label: "Amount",
              render: (row) =>
                row.amount == null
                  ? "—"
                  : `${row.amount}${row.unit ? ` ${row.unit}` : ""}`,
            },
            {
              key: "date",
              label: "Logged",
              render: (row) => new Date(row.loggedAt).toLocaleString(),
            },
            { key: "notes", label: "Notes", render: (row) => row.notes ?? "—" },
            { key: "actions", label: "", align: "right", render: (row) => <RowActions onDelete={() => { if (confirmRemove(`${titleCase(row.substanceType)} log`)) void mutation.run("health:deleteSubstance", { id: row.id }, "Substance log deleted"); }} /> },
          ]}
        />
      </PersonalCard>
      <PersonalCard title="Custom substances">
        <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); void mutation.run("health:createCustomSubstance", { name: values.get("name") }, "Custom substance added").then((ok) => { if (ok) form.reset(); }); }}><input name="name" required placeholder="Custom substance name" className={`${HEALTH_FIELD_CLASS} max-w-sm`} /><Button type="submit" iconLeading={Plus} isLoading={mutation.busy}>Add</Button></form>
        {data.customTypes.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{data.customTypes.map((custom) => <span key={custom.id} className="inline-flex items-center gap-1 rounded-full bg-secondary py-1 pl-2.5 pr-1 text-xs font-medium text-secondary">{custom.name}<button type="button" aria-label={`Delete ${custom.name}`} onClick={() => { if (confirmRemove(`custom substance “${custom.name}”`)) void mutation.run("health:deleteCustomSubstance", { id: custom.id }, "Custom substance removed"); }} className="rounded-full p-1 hover:bg-primary_hover"><X className="size-3" /></button></span>)}</div>}
      </PersonalCard>
    </div>
  );
}

function VitalsSection({
  data,
  client,
  onMutated,
}: {
  data: VitalsData;
  client: LifeOSClient;
  onMutated: () => void;
}) {
  const lifecycle = useHealthMutation(client, onMutated);
  const units = asUnitSystem(data.unitSystem);
  const [editingVital, setEditingVital] = useState<VitalsData["vitals"][number] | null>(null);
  const vitalOptions = useMemo(
    () => data.latestByType.map((reading) => ({ value: reading.type, label: titleCase(reading.type) })),
    [data.latestByType],
  );
  const [selectedType, setSelectedType] = useState(vitalOptions.find((option) => option.value === "blood_pressure")?.value ?? vitalOptions[0]?.value ?? "blood_pressure");
  const selectedReadings = useMemo(
    () => data.vitals.filter((reading) => (reading.vitalType === "custom" ? reading.customName ?? "custom" : reading.vitalType) === selectedType).slice(0, 120).reverse(),
    [data.vitals, selectedType],
  );
  const vitalTrend = useMemo<TrendPoint[]>(
    () => selectedReadings.map((reading) => ({
      label: shortDate(reading.measuredAt),
      primary: selectedType === "temperature"
        ? temperatureToDisplay(reading.value ?? reading.fields[0]?.value ?? null, units)
        : reading.value ?? reading.fields[0]?.value ?? null,
      secondary: selectedType === "temperature"
        ? temperatureToDisplay(reading.value2 ?? reading.fields[1]?.value ?? null, units)
        : reading.value2 ?? reading.fields[1]?.value ?? null,
    })),
    [selectedReadings, selectedType, units],
  );
  const selectedUnit = selectedType === "temperature"
    ? temperatureUnit(units)
    : selectedReadings.at(-1)?.unit ?? selectedReadings.at(-1)?.fields[0]?.unit ?? "";
  const pressure = selectedType === "blood_pressure";
  return (
    <div className="flex flex-col gap-5">
      <VitalLogForm client={client} onMutated={onMutated} unitSystem={data.unitSystem} />
      <FormModal isOpen={Boolean(editingVital)} onOpenChange={(open) => { if (!open) setEditingVital(null); }} title="Edit vital reading" description="Update the reading while retaining any structured custom fields.">
        {editingVital && <form className="grid gap-4" onSubmit={(event) => {
          event.preventDefault();
          const values = new FormData(event.currentTarget);
          void lifecycle.run("health:updateVital", {
            id: editingVital.id,
            vitalType: values.get("vitalType"),
            customName: values.get("customName"),
            value: values.get("value"),
            value2: values.get("value2"),
            unit: values.get("unit"),
            measuredAt: values.get("measuredAt"),
            notes: values.get("notes"),
            fields: editingVital.fields,
          }, "Vital updated").then((ok) => { if (ok) setEditingVital(null); });
        }}>
          <label className="text-xs font-medium text-secondary">Vital type<input value={editingVital.customName ?? titleCase(editingVital.vitalType)} readOnly className={`${HEALTH_FIELD_CLASS} mt-1.5`} /><input type="hidden" name="vitalType" value={editingVital.vitalType} /></label>
          {editingVital.vitalType === "custom" && <label className="text-xs font-medium text-secondary">Custom name<input name="customName" defaultValue={editingVital.customName ?? ""} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>}
          <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium text-secondary">Primary value<input name="value" type="number" step="any" defaultValue={editingVital.vitalType === "temperature" ? temperatureToDisplay(editingVital.value, units) ?? "" : editingVital.value ?? ""} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label><label className="text-xs font-medium text-secondary">Secondary value<input name="value2" type="number" step="any" defaultValue={editingVital.vitalType === "temperature" ? temperatureToDisplay(editingVital.value2, units) ?? "" : editingVital.value2 ?? ""} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label></div>
          <label className="text-xs font-medium text-secondary">Unit<input name="unit" defaultValue={editingVital.vitalType === "temperature" ? temperatureUnit(units) : editingVital.unit ?? ""} readOnly={editingVital.vitalType === "temperature"} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <label className="text-xs font-medium text-secondary">Measured at<input name="measuredAt" type="datetime-local" required defaultValue={medicalDateTimeValue(editingVital.measuredAt)} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <label className="text-xs font-medium text-secondary">Notes<textarea name="notes" rows={3} defaultValue={editingVital.notes ?? ""} className={`${HEALTH_FIELD_CLASS} mt-1.5`} /></label>
          <div className="flex justify-end gap-2"><Button color="secondary" onClick={() => setEditingVital(null)}>Cancel</Button><Button type="submit" isLoading={lifecycle.busy}>Save vital</Button></div>
        </form>}
      </FormModal>
      <StatGrid
        stats={[
          { label: "Vital readings", value: data.summary.readings },
          { label: "Vital types", value: data.summary.vitalTypes },
          { label: "Last 30 days", value: data.summary.readingsLast30Days },
          {
            label: "Latest reading",
            value: data.summary.latestMeasuredAt
              ? formatDate(data.summary.latestMeasuredAt)
              : "—",
          },
        ]}
      />
      <HealthChartCard
        title="Vital trend"
        description={`${titleCase(selectedType)} across the latest ${vitalTrend.length} readings${selectedUnit ? ` · ${selectedUnit}` : ""}`}
        icon={selectedType === "temperature" ? Thermometer01 : ActivityHeart}
        action={vitalOptions.length ? <div className="w-full sm:w-52"><RichSelect aria-label="Chart vital" value={selectedType} onChange={(event) => setSelectedType(event.target.value)} options={vitalOptions} /></div> : undefined}
      >
        <TrendChart
          data={vitalTrend}
          series={pressure
            ? [{ key: "primary", name: "Systolic" }, { key: "secondary", name: "Diastolic" }]
            : [{ key: "primary", name: titleCase(selectedType) }, ...(vitalTrend.some((point) => typeof point.secondary === "number") ? [{ key: "secondary", name: "Secondary" }] : [])]}
          type="line"
          fitDomain
          height={270}
          emptyLabel="Log this vital to see its trend"
        />
      </HealthChartCard>
      {data.latestByType.length > 0 && (
        <PersonalCard title="Latest by type">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {data.latestByType.map((reading) => (
              <button type="button" onClick={() => setSelectedType(reading.type)} key={reading.type} className={`rounded-lg border p-3 text-left transition ${selectedType === reading.type ? "border-brand bg-brand-secondary" : "border-transparent bg-secondary hover:border-secondary"}`}>
                <p className="text-xs text-tertiary">
                  {titleCase(reading.type)}
                </p>
                <p className="mt-1 font-semibold text-primary">
                  {formatVitalForDisplay(reading, reading.type, units)}
                </p>
                <p className="mt-1 text-xs text-quaternary">
                  {formatDate(reading.measuredAt)}
                </p>
              </button>
            ))}
          </div>
        </PersonalCard>
      )}
      <PersonalCard title="Vital history">
        <PersonalTable
          rows={data.vitals}
          empty="No vital readings found."
          columns={[
            {
              key: "type",
              label: "Vital",
              render: (row) => row.customName ?? titleCase(row.vitalType),
            },
            {
              key: "value",
              label: "Reading",
              render: (row) =>
                row.fields.length > 0
                  ? row.fields
                      .map(
                        (field) =>
                          row.vitalType === "temperature"
                            ? `${field.label}: ${temperatureToDisplay(field.value, units)} ${temperatureUnit(units)}`
                            : `${field.label}: ${field.value}${field.unit ? ` ${field.unit}` : ""}`,
                      )
                      .join(" · ")
                  : formatVitalForDisplay(row, row.vitalType, units),
            },
            {
              key: "date",
              label: "Measured",
              render: (row) => new Date(row.measuredAt).toLocaleString(),
            },
            { key: "notes", label: "Notes", render: (row) => row.notes ?? "—" },
            { key: "actions", label: "", align: "right", render: (row) => <RowActions onEdit={() => setEditingVital(row)} onDelete={() => { if (confirmRemove(`${row.customName ?? titleCase(row.vitalType)} reading`)) void lifecycle.run("health:deleteVital", { id: row.id }, "Vital deleted"); }} /> },
          ]}
        />
      </PersonalCard>
      <MutationNote error={lifecycle.error} success={lifecycle.success} />
    </div>
  );
}

function HealthSection({
  tab,
  data,
  client,
  onMutated,
}: {
  tab: HealthTabId;
  data: HealthResult;
  client: LifeOSClient;
  onMutated: () => void;
}) {
  switch (tab) {
    case "overview":
      return <OverviewSection data={data as OverviewData} client={client} onMutated={onMutated} />;
    case "goals":
      return <GoalsSection data={data as GoalsData} client={client} onMutated={onMutated} />;
    case "habits":
      return (
        <HabitsSection
          data={data as HabitsData}
          client={client}
          onMutated={onMutated}
        />
      );
    case "journal":
      return (
        <JournalSection
          data={data as JournalData}
          client={client}
          onMutated={onMutated}
        />
      );
    case "medical":
      return <MedicalSection data={data as MedicalData} client={client} onMutated={onMutated} />;
    case "medications":
      return (
        <MedicationsSection
          data={data as MedicationsData}
          client={client}
          onMutated={onMutated}
        />
      );
    case "metrics":
      return (
        <MetricsSection
          data={data as MetricsData}
          client={client}
          onMutated={onMutated}
        />
      );
    case "peptides":
      return <PeptidesSection data={data as PeptidesData} client={client} onMutated={onMutated} />;
    case "photos":
      return <PhotosSection data={data as PhotosData} client={client} onMutated={onMutated} />;
    case "sleep":
      return (
        <SleepSection
          data={data as SleepData}
          client={client}
          onMutated={onMutated}
        />
      );
    case "sobriety":
      return <SobrietySection data={data as SobrietyData} client={client} onMutated={onMutated} />;
    case "vitals":
      return (
        <VitalsSection
          data={data as VitalsData}
          client={client}
          onMutated={onMutated}
        />
      );
  }
}

export function HealthView({ client }: HealthViewProps) {
  const [activeTab, setActiveTab] = useState<HealthTabId>("overview");
  const active =
    HEALTH_TABS.find((tab) => tab.id === activeTab) ?? HEALTH_TABS[0];
  const query = useLifeOSQuery<HealthResult>(client, active.query);

  return (
    <PersonalModuleShell
      title="Health"
      description="A native view of your goals, care records, therapeutics, recovery, and health trends."
      icon={Heart}
      tabs={HEALTH_TABS.map(({ id, label }) => ({ id, label }))}
      activeTab={activeTab}
      onTabChange={(tab) => setActiveTab(tab as HealthTabId)}
      hero={{
        gradient: "linear-gradient(120deg, #e11d48 0%, #f43f5e 50%, #fb7185 100%)",
        eyebrow: "Health & wellbeing",
        actions: [
          { label: "Log metric", icon: Plus, variant: "primary", onClick: () => setActiveTab("metrics") },
          { label: "Track habit", icon: Activity, onClick: () => setActiveTab("habits") },
        ],
      }}
    >
      <style>{`
        [data-personal-module="health"] > nav {
          width: 100%;
          min-width: 0;
          max-width: 100%;
          overscroll-behavior-x: contain;
        }
      `}</style>
      <QueryBoundary
        loading={query.loading}
        error={query.error}
        onRetry={query.refresh}
      >
        {query.data ? (
          <HealthSection
            tab={activeTab}
            data={query.data}
            client={client}
            onMutated={query.refresh}
          />
        ) : (
          <EmptyMessage>No health data was returned.</EmptyMessage>
        )}
      </QueryBoundary>
    </PersonalModuleShell>
  );
}
