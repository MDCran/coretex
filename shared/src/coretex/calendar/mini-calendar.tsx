// @ts-nocheck
"use client";

// Coretex — calendar sidebar mini-month navigator. Compact grid that fits inside
// the ~256px sidebar without day cells overflowing the card bounds.

import { useMemo } from "react";
import { CalendarDate, type DateValue, getLocalTimeZone, isToday } from "@internationalized/date";
import { ChevronLeft, ChevronRight } from "@untitledui/icons";
import {
    Calendar as AriaCalendar,
    CalendarGrid as AriaCalendarGrid,
    CalendarGridBody as AriaCalendarGridBody,
    CalendarGridHeader as AriaCalendarGridHeader,
    CalendarHeaderCell as AriaCalendarHeaderCell,
    CalendarCell as AriaCalendarCell,
    Heading as AriaHeading,
} from "react-aria-components";
import { Button } from "@/components/base/buttons/button";
import { cx } from "@/utils/cx";

/** Convert a JS Date to an @internationalized/date CalendarDate (local). */
export function toCalendarDate(d: Date): CalendarDate {
    return new CalendarDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** Convert an @internationalized/date DateValue back to a local JS Date. */
export function fromDateValue(v: DateValue): Date {
    const d = v.toDate(getLocalTimeZone());
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

interface Props {
    selected: Date;
    focused: Date;
    onSelect: (d: Date) => void;
    onFocusChange: (d: Date) => void;
    eventDays: Date[];
}

export const MiniCalendar = ({ selected, focused, onSelect, onFocusChange, eventDays }: Props) => {
    const value = useMemo(() => toCalendarDate(selected), [selected]);
    const focusedValue = useMemo(() => toCalendarDate(focused), [focused]);
    const highlighted = useMemo(() => {
        const set = new Set(eventDays.map((d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`));
        return set;
    }, [eventDays]);

    return (
        <AriaCalendar
            aria-label="Mini calendar"
            value={value}
            focusedValue={focusedValue}
            onChange={(v) => v && onSelect(fromDateValue(v))}
            onFocusChange={(v) => v && onFocusChange(fromDateValue(v))}
            className="flex w-full max-w-full flex-col gap-2 overflow-hidden"
        >
            <header className="flex items-center justify-between gap-1">
                <Button slot="previous" iconLeading={ChevronLeft} size="sm" color="tertiary" className="size-7 shrink-0" />
                <AriaHeading className="min-w-0 truncate text-center text-sm font-semibold text-secondary" />
                <Button slot="next" iconLeading={ChevronRight} size="sm" color="tertiary" className="size-7 shrink-0" />
            </header>

            <AriaCalendarGrid weekdayStyle="short" className="w-full table-fixed border-collapse">
                <AriaCalendarGridHeader>
                    {(day) => (
                        <AriaCalendarHeaderCell className="p-0">
                            <div className="flex h-6 w-full items-center justify-center text-[10px] font-medium text-tertiary">
                                {day.slice(0, 1)}
                            </div>
                        </AriaCalendarHeaderCell>
                    )}
                </AriaCalendarGridHeader>
                <AriaCalendarGridBody className="[&_td]:p-0.5 [&_td]:w-[14.28%]">
                    {(date) => {
                        const key = `${date.year}-${date.month}-${date.day}`;
                        const hasEvent = highlighted.has(key);
                        const today = isToday(date, getLocalTimeZone());
                        return (
                            <AriaCalendarCell
                                date={date}
                                className={({ isSelected, isOutsideMonth, isDisabled, isFocusVisible }) =>
                                    cx(
                                        "relative flex aspect-square w-full max-h-8 items-center justify-center rounded-full text-[11px] font-medium outline-hidden transition",
                                        isOutsideMonth && "opacity-35",
                                        isDisabled && "pointer-events-none opacity-30",
                                        isFocusVisible && "ring-2 ring-brand",
                                        isSelected
                                            ? "bg-brand-solid text-white"
                                            : today
                                              ? "bg-brand-primary text-brand-secondary"
                                              : "text-secondary hover:bg-secondary",
                                    )
                                }
                            >
                                {({ formattedDate, isSelected }) => (
                                    <span className="relative flex size-full items-center justify-center">
                                        {formattedDate}
                                        {hasEvent && !isSelected && (
                                            <span
                                                className="absolute bottom-0.5 size-1 rounded-full"
                                                style={{ background: "var(--brand)" }}
                                            />
                                        )}
                                    </span>
                                )}
                            </AriaCalendarCell>
                        );
                    }}
                </AriaCalendarGridBody>
            </AriaCalendarGrid>
        </AriaCalendar>
    );
};
