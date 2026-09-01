// @ts-nocheck
import type { FC } from "react";
import {
    ICON_KEYWORDS,
    ICON_NAMES,
    ICON_REGISTRY,
    resolveIcon,
} from "@/components/application/icon-picker/icon-registry";

/**
 * Reminders icon registry — now a thin re-export of the shared icon registry at
 * `@/components/application/icon-picker/icon-registry`. The original public API
 * (`REMINDER_ICONS`, `REMINDER_ICON_NAMES`, `REMINDER_ICON_KEYWORDS`,
 * `reminderIcon`) is preserved so existing imports keep working.
 */
export const REMINDER_ICONS: Record<string, FC<{ className?: string }>> = ICON_REGISTRY;

/** Names offered in the picker, in a sensible display order. */
export const REMINDER_ICON_NAMES: string[] = ICON_NAMES;

/** Human-friendly search keywords per icon, used by the picker filter. */
export const REMINDER_ICON_KEYWORDS: Record<string, string> = ICON_KEYWORDS;

/** Resolve a stored icon name to a component, falling back to Bell01. */
export function reminderIcon(name: string | null | undefined): FC<{ className?: string }> {
    return resolveIcon(name);
}
