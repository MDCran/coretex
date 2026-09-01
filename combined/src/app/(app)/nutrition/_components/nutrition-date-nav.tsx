"use client";

import { parseDate } from "@internationalized/date";
import { Calendar, ChevronLeft, ChevronRight } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { DatePicker } from "@/components/application/date-picker/date-picker";
import { formatMonthYear } from "@/lib/dates";
import { cx } from "@/utils/cx";

const pad = (n: number) => String(n).padStart(2, "0");

function todayKey(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function thisMonthKey(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

/** Day navigation: formatted label + prev / today / next controls. */
export function NutritionDayNav({
    date,
    onDateChange,
    onShiftDay,
}: {
    date: string;
    onDateChange: (iso: string) => void;
    onShiftDay: (delta: number) => void;
}) {
    const isToday = date === todayKey();

    return (
        // One cohesive day-navigation cluster: jump-to-day picker + prev / Today / next.
        <div className="flex flex-wrap items-center gap-2">
            {/* Jump to any day with the Untitled UI date picker (matched sm height). */}
            <DatePicker
                size="sm"
                value={parseDate(date)}
                onChange={(v) => {
                    if (v) onDateChange(`${v.year}-${pad(v.month)}-${pad(v.day)}`);
                }}
            />

            {/* Segmented prev / Today / next control — heights match the picker. */}
            <div className="flex items-center gap-0.5 rounded-lg bg-secondary p-0.5 ring-1 ring-secondary ring-inset">
                <Button size="sm" color="tertiary" iconLeading={ChevronLeft} onClick={() => onShiftDay(-1)} aria-label="Previous day" />
                <Button
                    size="sm"
                    color={isToday ? "primary" : "tertiary"}
                    onClick={() => onDateChange(todayKey())}
                    aria-pressed={isToday}
                    className={cx(isToday && "shadow-xs")}
                >
                    Today
                </Button>
                <Button size="sm" color="tertiary" iconLeading={ChevronRight} onClick={() => onShiftDay(1)} aria-label="Next day" />
            </div>
        </div>
    );
}

/** Month navigation for the nutrition month grid view. */
export function NutritionMonthNav({
    year,
    month,
    onShiftMonth,
    onJumpMonth,
}: {
    year: number;
    month: number;
    onShiftMonth: (delta: number) => void;
    onJumpMonth: (iso: string) => void;
}) {
    const current = new Date();
    const isThisMonth = year === current.getFullYear() && month === current.getMonth();

    return (
        <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
                <Calendar className="size-5 shrink-0 text-fg-quaternary" aria-hidden="true" />
                <h2 className="text-lg font-semibold text-primary">{formatMonthYear(new Date(year, month, 1))}</h2>
            </div>

            <div className="flex items-center gap-0.5 rounded-lg bg-secondary p-0.5 ring-1 ring-secondary ring-inset">
                <Button size="sm" color="tertiary" iconLeading={ChevronLeft} onClick={() => onShiftMonth(-1)} aria-label="Previous month" />
                <Button
                    size="sm"
                    color={isThisMonth ? "primary" : "tertiary"}
                    onClick={() => onJumpMonth(thisMonthKey())}
                    aria-pressed={isThisMonth}
                    className={cx(isThisMonth && "shadow-xs")}
                >
                    This month
                </Button>
                <Button size="sm" color="tertiary" iconLeading={ChevronRight} onClick={() => onShiftMonth(1)} aria-label="Next month" />
            </div>
        </div>
    );
}
