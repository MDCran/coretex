// Coretex — calendar categories (colorized). Each event carries a category id
// that drives its default color + label; the color is overridable per event.

export interface CalendarCategory {
    id: string;
    label: string;
    color: string;
    icon: string;
}

export const CALENDAR_CATEGORIES: CalendarCategory[] = [
    { id: "work", label: "Work", color: "#3b82f6", icon: "Briefcase01" },
    { id: "meeting", label: "Meeting", color: "#8b5cf6", icon: "Users01" },
    { id: "personal", label: "Personal", color: "#22c55e", icon: "Heart" },
    { id: "deadline", label: "Deadline", color: "#ef4444", icon: "AlertTriangle" },
    { id: "reminder", label: "Reminder", color: "#14b8a6", icon: "BellRinging01" },
    // Module overlays (synthetic events derived from live workspace state)
    { id: "agents", label: "Agents", color: "#a855f7", icon: "Users01" },
    { id: "projects", label: "Projects", color: "#0ea5e9", icon: "FolderCode" },
    { id: "email", label: "Email", color: "#f59e0b", icon: "Mail01" },
    { id: "financial", label: "Financial", color: "#10b981", icon: "BankNote01" },
    { id: "social", label: "Social", color: "#ec4899", icon: "MessageChatCircle" },
    { id: "workouts", label: "Workouts", color: "#f97316", icon: "Activity" },
    { id: "nutrition", label: "Nutrition", color: "#84cc16", icon: "Beaker01" },
    { id: "health", label: "Health", color: "#06b6d4", icon: "ActivityHeart" },
    { id: "todos", label: "Todos", color: "#6366f1", icon: "CheckSquare" },
];

/** System-owned calendars backed by live Coretex modules; users may restyle but not delete them. */
export const MODULE_CALENDAR_CATEGORY_IDS = new Set(["agents", "projects", "email", "financial", "social", "workouts", "nutrition", "health", "todos"]);
export const BUILTIN_CALENDAR_CATEGORY_IDS = new Set(CALENDAR_CATEGORIES.map((category) => category.id));

/** Legend entries shown on the calendar page (always, even with zero counts). */
export const CALENDAR_LEGEND: CalendarCategory[] = CALENDAR_CATEGORIES;

export function categoryById(id: string): CalendarCategory {
    return CALENDAR_CATEGORIES.find((c) => c.id === id) ?? { id, label: titleCaseCategory(id), color: "#667085", icon: "Calendar" };
}

export function titleCaseCategory(id: string): string {
    return id
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** Common reminder offsets (minutes before start). */
export const REMINDER_OPTIONS: { label: string; value: number }[] = [
    { label: "At start time", value: 0 },
    { label: "5 minutes before", value: 5 },
    { label: "10 minutes before", value: 10 },
    { label: "15 minutes before", value: 15 },
    { label: "30 minutes before", value: 30 },
    { label: "1 hour before", value: 60 },
    { label: "2 hours before", value: 120 },
    { label: "12 hours before", value: 720 },
    { label: "1 day before", value: 1440 },
    { label: "2 days before", value: 2880 },
    { label: "1 week before", value: 10080 },
];

export function reminderLabel(minutes: number): string {
    const preset = REMINDER_OPTIONS.find((o) => o.value === minutes)?.label;
    if (preset) return preset;
    if (minutes % 10_080 === 0) return `${minutes / 10_080} week${minutes === 10_080 ? "" : "s"} before`;
    if (minutes % 1_440 === 0) return `${minutes / 1_440} day${minutes === 1_440 ? "" : "s"} before`;
    if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"} before`;
    return `${minutes} min before`;
}
