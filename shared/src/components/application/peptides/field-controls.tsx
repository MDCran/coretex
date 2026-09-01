// @ts-nocheck
import type { ComponentType, HTMLAttributes, ReactNode } from "react";
import { useEffect, useState } from "react";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { cx } from "@/utils/cx";

/** Label wrapper used across peptide editor fields. */
export function Field({
    label,
    warn,
    required,
    className,
    children,
}: {
    label: string;
    warn?: string;
    required?: boolean;
    className?: string;
    children: ReactNode;
}) {
    return (
        <div className={className}>
            <label className="mb-1.5 block text-xs font-medium text-tertiary">
                {label}
                {required && (
                    <span className="ml-0.5 text-brand-tertiary" aria-hidden="true">
                        *
                    </span>
                )}
                {warn && <span className="ml-1 font-normal text-error-primary">{warn}</span>}
            </label>
            {children}
        </div>
    );
}

interface NumberInputProps {
    value: number;
    onChange: (value: number) => void;
    min?: number;
    max?: number;
    step?: number;
    className?: string;
    size?: "sm" | "md" | "lg";
    icon?: ComponentType<HTMLAttributes<HTMLOrSVGElement>>;
    suffix?: string;
    isInvalid?: boolean;
    "aria-label"?: string;
}

/**
 * A controlled numeric input built on the library Input. Keeps a free-text
 * editing buffer so partial entries (e.g. "1." or "") don't fight the value.
 */
export function NumberInput({ value, onChange, min, max, step, className, size = "sm", icon, suffix, isInvalid, "aria-label": ariaLabel }: NumberInputProps) {
    const [text, setText] = useState(String(value));

    useEffect(() => {
        if (Number(text) !== value) setText(String(value));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    const commit = (raw: string) => {
        setText(raw);
        if (raw === "" || raw === "-" || raw === "." || raw.endsWith(".")) return;
        let n = Number(raw);
        if (!isFinite(n)) return;
        if (min !== undefined) n = Math.max(min, n);
        if (max !== undefined) n = Math.min(max, n);
        onChange(n);
    };

    const blur = () => {
        if (text === "" || isNaN(Number(text))) {
            const fallback = min ?? 0;
            setText(String(fallback));
            onChange(fallback);
        } else {
            setText(String(value));
        }
    };

    return (
        <Input
            type="text"
            inputMode="decimal"
            aria-label={ariaLabel}
            value={text}
            size={size}
            icon={icon}
            isInvalid={isInvalid}
            onChange={commit}
            onBlur={blur}
            inputClassName="font-mono tabular-nums"
            wrapperClassName={className}
            // Trailing suffix (units) rendered via a shortcut-style addon.
            {...(suffix ? { shortcut: suffix } : {})}
        />
    );
}

interface TextInputProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    type?: "text" | "date";
    className?: string;
    size?: "sm" | "md" | "lg";
    icon?: ComponentType<HTMLAttributes<HTMLOrSVGElement>>;
    "aria-label"?: string;
}

export function FieldInput({ value, onChange, placeholder, type = "text", className, size = "sm", icon, "aria-label": ariaLabel }: TextInputProps) {
    return (
        <Input
            type={type}
            aria-label={ariaLabel}
            value={value}
            size={size}
            icon={icon}
            placeholder={placeholder}
            onChange={onChange}
            inputClassName={type === "date" ? "font-mono" : undefined}
            wrapperClassName={className}
        />
    );
}

interface FieldSelectProps {
    value: string;
    onChange: (value: string) => void;
    options: { value: string; label: string }[];
    className?: string;
    size?: "sm" | "md" | "lg";
    "aria-label"?: string;
}

export function FieldSelect({ value, onChange, options, className, size = "sm", "aria-label": ariaLabel }: FieldSelectProps) {
    return (
        <Select
            aria-label={ariaLabel}
            size={size}
            className={className}
            selectedKey={value}
            onSelectionChange={(key) => key != null && onChange(String(key))}
            items={options.map((o) => ({ id: o.value, label: o.label }))}
        >
            {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
        </Select>
    );
}

/** Small readout tile for concentration / per-unit / vial figures. */
export function Readout({ label, value, accent }: { label: string; value: string; accent?: "error" | "success" }) {
    return (
        <div className="flex flex-col gap-1 bg-secondary p-3">
            <span className="text-[10px] tracking-wider text-tertiary uppercase">{label}</span>
            <span
                className={cx(
                    "font-mono text-lg tabular-nums",
                    accent === "error" ? "text-error-primary" : accent === "success" ? "text-success-primary" : "text-primary",
                )}
            >
                {value}
            </span>
        </div>
    );
}
