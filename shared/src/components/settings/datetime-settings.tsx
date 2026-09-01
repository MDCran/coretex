// @ts-nocheck
/**
 * Settings section for the global "Date & time format" preference.
 *
 * Matches the house style of `appearance-client.tsx` (SettingsCard / SettingsHeading,
 * segmented radio buttons, mounted-guard to avoid hydration flash). Persists the
 * choice via `writeDateTimePrefs` (cookie + localStorage) so server components can
 * read it too.
 */

import { useEffect, useState } from "react";
import { Calendar, Check, Clock } from "@untitledui/icons";
import { toast } from "sonner";
import { SettingsCard, SettingsHeading } from "@/components/settings/settings-ui";
import {
    DATE_FORMAT_OPTIONS,
    DEFAULT_DATE_FORMAT,
    DEFAULT_TIME_FORMAT,
    TIME_FORMAT_OPTIONS,
    formatDateTimeWith,
    type DateFormatId,
    type TimeFormatId,
} from "@/lib/datetime-format";
import { DEFAULT_DATETIME_PREFS, readClientDateTimePrefs, writeDateTimePrefs } from "@/lib/datetime-prefs";
import { cx } from "@/utils/cx";

export function DateTimeSettings() {
    const [mounted, setMounted] = useState(false);
    const [date, setDate] = useState<DateFormatId>(DEFAULT_DATE_FORMAT);
    const [time, setTime] = useState<TimeFormatId>(DEFAULT_TIME_FORMAT);

    useEffect(() => {
        const prefs = readClientDateTimePrefs();
        setDate(prefs.date);
        setTime(prefs.time);
        setMounted(true);
    }, []);

    const update = (next: { date?: DateFormatId; time?: TimeFormatId }) => {
        const resolved = { date: next.date ?? date, time: next.time ?? time };
        setDate(resolved.date);
        setTime(resolved.time);
        writeDateTimePrefs(resolved);
        toast.success("Date & time format updated");
    };

    // Render a stable default before mount so SSR and first client paint match.
    const activeDate = mounted ? date : DEFAULT_DATETIME_PREFS.date;
    const activeTime = mounted ? time : DEFAULT_DATETIME_PREFS.time;
    const preview = formatDateTimeWith(new Date(), activeDate, activeTime);

    return (
        <SettingsCard bloom="brand">
            <SettingsHeading title="Date & time" description="Choose how dates and times appear across LifeOS. Saved for this browser and used on the server too." />

            {/* Date format */}
            <div className="mt-5">
                <span className="flex items-center gap-2 text-sm font-medium text-secondary">
                    <Calendar className="size-4 text-fg-quaternary" aria-hidden="true" />
                    Date format
                </span>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Date format">
                    {DATE_FORMAT_OPTIONS.map((option) => {
                        const selected = activeDate === option.id;
                        return (
                            <button
                                key={option.id}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                onClick={() => update({ date: option.id })}
                                className={cx(
                                    "group flex items-center justify-between gap-3 rounded-xl p-4 text-left ring-1 ring-inset outline-focus-ring transition duration-100 ease-linear focus-visible:outline-2 focus-visible:outline-offset-2",
                                    selected ? "bg-brand-primary/40 ring-2 ring-brand" : "bg-secondary_subtle ring-secondary hover:bg-secondary_hover",
                                )}
                            >
                                <span className="min-w-0">
                                    <span className={cx("block text-sm font-semibold", selected ? "text-brand-secondary" : "text-secondary")}>{option.label}</span>
                                    <span className="mt-0.5 block text-xs text-tertiary">{option.example}</span>
                                </span>
                                {selected && <Check className="size-4 shrink-0 text-fg-brand-primary" aria-hidden="true" />}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Time format */}
            <div className="mt-6">
                <span className="flex items-center gap-2 text-sm font-medium text-secondary">
                    <Clock className="size-4 text-fg-quaternary" aria-hidden="true" />
                    Time format
                </span>
                <div className="mt-3 inline-flex rounded-lg bg-secondary p-0.5 ring-1 ring-secondary ring-inset" role="radiogroup" aria-label="Time format">
                    {TIME_FORMAT_OPTIONS.map((option) => {
                        const selected = activeTime === option.id;
                        return (
                            <button
                                key={option.id}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                onClick={() => update({ time: option.id })}
                                className={cx(
                                    "cursor-pointer rounded-md px-4 py-2 text-sm font-medium transition duration-100 ease-linear outline-focus-ring focus-visible:outline-2 focus-visible:outline-offset-2",
                                    selected ? "bg-primary text-primary shadow-xs ring-1 ring-secondary ring-inset" : "text-tertiary hover:text-secondary",
                                )}
                            >
                                {option.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Live preview */}
            <p className="mt-5 text-xs text-tertiary">
                Preview: <span className="font-medium text-secondary">{preview}</span>
            </p>
        </SettingsCard>
    );
}
