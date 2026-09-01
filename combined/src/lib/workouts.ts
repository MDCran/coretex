/**
 * Shared, framework-agnostic helpers for the Workouts module.
 * Weights are stored and displayed in kilograms throughout this module.
 */

/** Estimated one-rep max via the Epley formula. Returns kg, rounded to 0.5. */
export function epley1RM(weightKg: number, reps: number): number {
    if (weightKg <= 0 || reps <= 0) return 0;
    if (reps === 1) return weightKg;
    return Math.round(weightKg * (1 + reps / 30) * 2) / 2;
}

/** Format a kg weight for display, e.g. "82.5 kg". */
export function formatKg(kg: number | null | undefined): string {
    if (kg == null) return "—";
    return `${+kg.toFixed(1)} kg`;
}

/** Format seconds as a human duration, e.g. "1:05" or "45s". */
export function formatSeconds(sec: number | null | undefined): string {
    if (sec == null) return "—";
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
}

/** Format meters, switching to km past 1000m. */
export function formatMeters(m: number | null | undefined): string {
    if (m == null) return "—";
    if (m >= 1000) return `${+(m / 1000).toFixed(2)} km`;
    return `${+m.toFixed(0)} m`;
}

/** Default rest target between working sets of the same exercise (seconds). */
export const DEFAULT_SET_REST_SEC = 90;
/** Default rest target when moving on to the next exercise (seconds). */
export const DEFAULT_EXERCISE_REST_SEC = 180;

/** Resolve the rest target for a set: explicit per-exercise value, else default. */
export function resolveSetRest(restSec: number | null | undefined): number {
    return restSec != null && restSec > 0 ? restSec : DEFAULT_SET_REST_SEC;
}

/** Compact stopwatch label "m:ss" for elapsed seconds. */
export function formatStopwatch(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = Math.max(0, sec) % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
}

/** Rest-target label, e.g. "90s rest" / "2m rest". */
export function formatRest(sec: number | null | undefined): string {
    if (sec == null) return "";
    if (sec < 60) return `${sec}s rest`;
    const m = Math.floor(sec / 60);
    const r = sec % 60;
    return r === 0 ? `${m}m rest` : `${m}m ${r}s rest`;
}

/**
 * Rough estimated workout duration (minutes) for a template, from set count and
 * rest targets. Assumes ~40s of work per set plus the resolved rest after it.
 */
export function estimateTemplateMinutes(exercises: Array<{ targetSets: number | null; restSec: number | null; perSetMode: boolean; setCount: number }>): number {
    let sec = 0;
    for (const te of exercises) {
        const sets = te.perSetMode ? te.setCount : te.targetSets ?? 3;
        const rest = te.restSec != null && te.restSec > 0 ? te.restSec : DEFAULT_SET_REST_SEC;
        sec += sets * (40 + rest);
    }
    return Math.max(0, Math.round(sec / 60));
}

/** Total working volume (kg × reps) for a list of completed sets. */
export function setVolume(set: { actualReps: number | null; actualWeight: number | null }): number {
    if (set.actualReps == null || set.actualWeight == null) return 0;
    return set.actualReps * set.actualWeight;
}

/** Relative time, e.g. "3 days ago". */
export function timeAgo(date: Date | string): string {
    const d = typeof date === "string" ? new Date(date) : date;
    const diff = Date.now() - d.getTime();
    const day = 24 * 60 * 60 * 1000;
    const days = Math.floor(diff / day);
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 7) return `${days} days ago`;
    if (days < 30) return `${Math.floor(days / 7)} wk ago`;
    if (days < 365) return `${Math.floor(days / 30)} mo ago`;
    return `${Math.floor(days / 365)} yr ago`;
}

/** ISO yyyy-mm-dd for a Date, in local time (used for date-keyed records). */
export function toDateKey(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

/** Parse a yyyy-mm-dd string into a UTC-midnight Date (matches @db.Date storage). */
export function dateKeyToUtc(key: string): Date {
    return new Date(`${key}T00:00:00.000Z`);
}

export const MUSCLE_GROUPS = [
    "chest",
    "back",
    "shoulders",
    "biceps",
    "triceps",
    "forearms",
    "quadriceps",
    "hamstrings",
    "glutes",
    "calves",
    "abdominals",
    "traps",
    "lats",
    "neck",
    "cardio",
] as const;

export const EQUIPMENT_OPTIONS = [
    "barbell",
    "dumbbell",
    "machine",
    "cable",
    "kettlebell",
    "bodyweight",
    "bands",
    "smith machine",
    "ez bar",
    "other",
] as const;

/**
 * Title Case an exercise metadata token for display.
 * Handles raw enum values ("INTERMEDIATE"), equipment ("smith machine"),
 * muscle names ("lower back"), and kebab/underscore-separated values.
 * e.g. "intermediate" -> "Intermediate", "smith machine" -> "Smith Machine",
 *      "ez_bar" -> "Ez Bar", "lat-pulldown" -> "Lat Pulldown".
 */
export function titleCase(value: string | null | undefined): string {
    if (!value) return "";
    return value
        .replace(/[_-]+/g, " ")
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : word))
        .join(" ");
}

/** kebab-cased slug from a name, with a short random suffix for uniqueness. */
export function slugify(name: string): string {
    const base = name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    const suffix = Math.random().toString(36).slice(2, 7);
    return `${base || "exercise"}-${suffix}`;
}
