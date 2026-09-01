"use client";

import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { ChevronDown } from "@untitledui/icons";
import { Label } from "@/components/base/input/label";
import { InputBase } from "@/components/base/input/input";
import { FormDateInput } from "@/components/base/input/form-date-input";
import { TextAreaBase } from "@/components/base/textarea/textarea";
import { cx } from "@/utils/cx";

/** Shared select ring + bg styling matching Untitled UI primitives. */
const baseField =
    "w-full rounded-lg bg-primary text-primary shadow-xs ring-1 ring-primary outline-hidden transition duration-100 ease-linear ring-inset placeholder:text-placeholder focus:ring-2 focus:ring-brand disabled:cursor-not-allowed disabled:opacity-50";

/** A labelled field wrapper. */
export function Field({
    label,
    htmlFor,
    isRequired,
    hint,
    className,
    children,
}: {
    label?: string;
    htmlFor?: string;
    isRequired?: boolean;
    hint?: string;
    className?: string;
    children: ReactNode;
}) {
    return (
        <div className={cx("flex flex-col gap-1.5", className)}>
            {label && (
                <Label htmlFor={htmlFor} isRequired={isRequired}>
                    {label}
                </Label>
            )}
            {children}
            {hint && <p className="text-sm text-tertiary">{hint}</p>}
        </div>
    );
}

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    isRequired?: boolean;
    hint?: string;
    fieldClassName?: string;
}

/** Library-backed text/date/datetime/number input that posts via FormData. */
export function TextInput({ label, isRequired, hint, id, className, fieldClassName, size: _size, ...props }: TextFieldProps) {
    return (
        <Field label={label} htmlFor={id} isRequired={isRequired} hint={hint} className={fieldClassName}>
            <InputBase id={id} size="sm" isRequired={isRequired} wrapperClassName={cx("w-full", className)} {...props} />
        </Field>
    );
}

interface DateFieldProps {
    name: string;
    label?: string;
    isRequired?: boolean;
    hint?: string;
    fieldClassName?: string;
    defaultValue?: string | null;
    variant?: "date" | "datetime" | "time";
    id?: string;
}

/** Library date/time picker that posts an ISO string via FormData. */
export function DateInput({ label, isRequired, hint, name, id, fieldClassName, defaultValue, variant = "date" }: DateFieldProps) {
    return (
        <FormDateInput
            name={name}
            id={id}
            label={label}
            isRequired={isRequired}
            hint={hint}
            variant={variant}
            defaultValue={defaultValue}
            className={fieldClassName}
        />
    );
}

interface TextareaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
    label?: string;
    isRequired?: boolean;
    hint?: string;
    fieldClassName?: string;
}

export function TextareaInput({ label, isRequired, hint, id, className, fieldClassName, rows = 4, ...props }: TextareaFieldProps) {
    return (
        <Field label={label} htmlFor={id} isRequired={isRequired} hint={hint} className={fieldClassName}>
            <TextAreaBase id={id} rows={rows} required={isRequired} size="sm" className={cx("w-full", className)} {...props} />
        </Field>
    );
}

interface SelectFieldProps extends Omit<InputHTMLAttributes<HTMLSelectElement>, "size"> {
    label?: string;
    isRequired?: boolean;
    hint?: string;
    fieldClassName?: string;
    placeholder?: string;
    options: { value: string; label: string }[];
    children?: ReactNode;
}

/** Library-backed native select that posts via FormData (works inside server-action forms). */
export function SelectInput({ label, isRequired, hint, id, className, fieldClassName, placeholder, options, value, defaultValue, ...props }: SelectFieldProps) {
    return (
        <Field label={label} htmlFor={id} isRequired={isRequired} hint={hint} className={fieldClassName}>
            <div className="relative grid w-full items-center">
                <select
                    id={id}
                    required={isRequired}
                    value={value}
                    defaultValue={defaultValue}
                    className={cx(baseField, "appearance-none px-3 py-2 pr-9 text-sm font-medium", className)}
                    {...props}
                >
                    {placeholder && <option value="">{placeholder}</option>}
                    {options.map((o) => (
                        <option key={o.value} value={o.value}>
                            {o.label}
                        </option>
                    ))}
                </select>
                <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 size-4 stroke-[2.25px] text-fg-quaternary" />
            </div>
        </Field>
    );
}
