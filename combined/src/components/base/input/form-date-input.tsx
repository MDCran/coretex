"use client";

import { useId, useMemo, useState } from "react";
import {
    CalendarDate,
    CalendarDateTime,
    parseDate,
    parseDateTime,
} from "@internationalized/date";
import type { DateValue } from "react-aria-components";
import { InputDate } from "@/components/base/input/input-date";
import { Input } from "@/components/base/input/input";

type FormDateVariant = "date" | "datetime" | "time";

interface FormDateInputProps {
    /** The form field name posted in FormData (as an ISO string). */
    name: string;
    /** Variant of the picker. */
    variant?: FormDateVariant;
    /** Label rendered above the field. */
    label?: string;
    /** Helper text below the field. */
    hint?: string;
    /** Whether the field is required (renders the asterisk + sets validity). */
    isRequired?: boolean;
    /** Initial value as an ISO string (`yyyy-mm-dd`, `yyyy-mm-ddThh:mm`, or `hh:mm`). */
    defaultValue?: string | null;
    /** Disabled state. */
    isDisabled?: boolean;
    /** Optional id (defaults to a generated id). */
    id?: string;
    size?: "sm" | "md" | "lg";
    className?: string;
}

/** Safely parse an ISO string into the right DateValue for date/datetime variants. */
function parseInitial(variant: Exclude<FormDateVariant, "time">, value?: string | null): DateValue | null {
    if (!value) return null;
    try {
        if (variant === "datetime") {
            // Accept both "yyyy-mm-dd" and "yyyy-mm-ddThh:mm[...]".
            if (value.includes("T")) return parseDateTime(value.slice(0, 16));
            return parseDateTime(`${value}T00:00`);
        }
        // date — strip any time component.
        return parseDate(value.slice(0, 10));
    } catch {
        return null;
    }
}

/** Serialise the picker's DateValue back to an ISO string for FormData. */
function serialize(variant: Exclude<FormDateVariant, "time">, value: DateValue | null): string {
    if (!value) return "";
    if (variant === "datetime") {
        const d = value as unknown as CalendarDateTime;
        const date = `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
        const time = `${String(d.hour ?? 0).padStart(2, "0")}:${String(d.minute ?? 0).padStart(2, "0")}`;
        return `${date}T${time}`;
    }
    const d = value as unknown as CalendarDate;
    return `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

/**
 * A date / datetime / time picker that posts an ISO string via FormData so
 * server actions that read `formData.get(name)` keep working unchanged.
 *
 * It wraps the library segmented date field (`InputDate`) for the `date` and
 * `datetime` variants and a library-styled time input for `time`, mirroring the
 * selected value into a hidden named input.
 */
export function FormDateInput({
    name,
    variant = "date",
    label,
    hint,
    isRequired,
    defaultValue,
    isDisabled,
    id,
    size = "sm",
    className,
}: FormDateInputProps) {
    const generatedId = useId();
    const fieldId = id ?? generatedId;

    if (variant === "time") {
        // `time` uses a library-styled native time input directly (the input
        // itself carries the name, so no hidden mirror is needed).
        return (
            <Input
                id={fieldId}
                name={name}
                type="time"
                label={label}
                hint={hint}
                isRequired={isRequired}
                isDisabled={isDisabled}
                defaultValue={defaultValue ?? undefined}
                size={size}
                wrapperClassName={className}
            />
        );
    }

    return <DateTimePicker {...{ name, variant, label, hint, isRequired, isDisabled, defaultValue, fieldId, size, className }} />;
}

function DateTimePicker({
    name,
    variant,
    label,
    hint,
    isRequired,
    isDisabled,
    defaultValue,
    fieldId,
    size,
    className,
}: {
    name: string;
    variant: Exclude<FormDateVariant, "time">;
    label?: string;
    hint?: string;
    isRequired?: boolean;
    isDisabled?: boolean;
    defaultValue?: string | null;
    fieldId: string;
    size: "sm" | "md" | "lg";
    className?: string;
}) {
    const initial = useMemo(() => parseInitial(variant, defaultValue), [variant, defaultValue]);
    const [value, setValue] = useState<DateValue | null>(initial);
    const serialized = serialize(variant, value);

    return (
        <>
            <InputDate
                id={fieldId}
                label={label}
                hint={hint}
                isRequired={isRequired}
                isDisabled={isDisabled}
                granularity={variant === "datetime" ? "minute" : "day"}
                hourCycle={24}
                value={value}
                onChange={setValue}
                size={size}
                wrapperClassName={className}
            />
            <input type="hidden" name={name} value={serialized} />
        </>
    );
}

/**
 * A controlled date/datetime picker for state-driven (non-FormData) usage —
 * e.g. filters and toolbars. Mirrors the library segmented `InputDate` while
 * exposing a plain ISO-string value/onChange API (yyyy-mm-dd, or
 * yyyy-mm-ddThh:mm for datetime), so callers keep using ISO strings in state.
 */
export function ControlledDateInput({
    value,
    onChange,
    variant = "date",
    label,
    hint,
    isRequired,
    isDisabled,
    id,
    size = "sm",
    className,
}: {
    value: string | null;
    onChange: (value: string) => void;
    variant?: Exclude<FormDateVariant, "time">;
    label?: string;
    hint?: string;
    isRequired?: boolean;
    isDisabled?: boolean;
    id?: string;
    size?: "sm" | "md" | "lg";
    className?: string;
}) {
    const generatedId = useId();
    const fieldId = id ?? generatedId;
    const parsed = useMemo(() => parseInitial(variant, value), [variant, value]);

    return (
        <InputDate
            id={fieldId}
            label={label}
            hint={hint}
            isRequired={isRequired}
            isDisabled={isDisabled}
            granularity={variant === "datetime" ? "minute" : "day"}
            hourCycle={24}
            value={parsed}
            onChange={(v) => onChange(serialize(variant, v))}
            size={size}
            wrapperClassName={className}
        />
    );
}

export default FormDateInput;
