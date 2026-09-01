/**
 * Single source of truth for the toggleable "areas of life".
 *
 * The user can turn areas on/off in Settings → Tracking. Hidden areas are
 * removed from the sidebar and the dashboard "Jump to" grid. The preference is
 * persisted as Settings.sidebarConfig = { hidden: AreaKey[] }.
 *
 * Dashboard, Notifications and Settings are always available (core) and are not
 * part of this list.
 */

export type AreaKey =
    | "career"
    | "health"
    | "nutrition"
    | "workouts"
    | "music"
    | "financial"
    | "social"
    | "learning"
    | "calendar"
    | "focus"
    | "todos";

export interface AreaDef {
    key: AreaKey;
    label: string;
    href: string;
    description: string;
}

export const TRACKABLE_AREAS: AreaDef[] = [
    { key: "career", label: "Career", href: "/career", description: "Applications, interviews & professional growth" },
    { key: "health", label: "Health", href: "/health", description: "Habits, metrics, sleep, vitals & medical" },
    { key: "nutrition", label: "Nutrition", href: "/nutrition", description: "Meals, calories & macros" },
    { key: "workouts", label: "Workouts", href: "/workouts", description: "Training sessions, exercises & progress" },
    { key: "music", label: "Music", href: "/music", description: "Spotify playback & AI playlists" },
    { key: "financial", label: "Financial", href: "/financial", description: "Accounts, transactions, budgets & net worth" },
    { key: "social", label: "Social", href: "/social", description: "Contacts, relationships & social events" },
    { key: "learning", label: "Learning", href: "/learning", description: "Courses, flashcards, quizzes & notes" },
    { key: "calendar", label: "Calendar", href: "/calendar", description: "Events & reminders" },
    { key: "focus", label: "Focus", href: "/focus", description: "Focus sessions & deep work" },
    { key: "todos", label: "Todos", href: "/todos", description: "Daily tasks & routines" },
];

export const TRACKABLE_AREA_KEYS: AreaKey[] = TRACKABLE_AREAS.map((a) => a.key);

/** Map of area root href → area key (used to filter nav/dashboard by href). */
export const AREA_BY_HREF: Record<string, AreaKey> = Object.fromEntries(
    TRACKABLE_AREAS.map((a) => [a.href, a.key]),
) as Record<string, AreaKey>;

function isAreaKey(value: unknown): value is AreaKey {
    return typeof value === "string" && (TRACKABLE_AREA_KEYS as string[]).includes(value);
}

/** Parse Settings.sidebarConfig JSON into the list of hidden area keys. */
export function parseHiddenAreas(sidebarConfig: unknown): AreaKey[] {
    if (!sidebarConfig || typeof sidebarConfig !== "object") return [];
    const hidden = (sidebarConfig as { hidden?: unknown }).hidden;
    if (!Array.isArray(hidden)) return [];
    return hidden.filter(isAreaKey);
}

/** True when the area at this root href is currently tracked (not hidden). */
export function isHrefEnabled(href: string | undefined, hidden: AreaKey[]): boolean {
    if (!href) return true;
    const key = AREA_BY_HREF[href];
    if (!key) return true; // core / non-trackable items are always shown
    return !hidden.includes(key);
}
