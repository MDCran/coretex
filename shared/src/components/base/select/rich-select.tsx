// @ts-nocheck
"use client";

// RichSelect is the form-friendly Untitled UI replacement for a native select.
// It preserves the small event-shaped onChange API used throughout the personal
// modules and mirrors its value into a hidden input when a form name is supplied.

import { Select } from "./select";
import type { RichSelectOption } from "./select-native";
import { cx } from "@/utils/cx";
import { useEffect, useState } from "react";

// React Aria collection keys cannot be empty strings. Keep the sentinel printable
// so source tooling and generated bundles never contain an embedded NUL byte.
const EMPTY_KEY = "__coretex_empty_select_value__";
const toKey = (value: string) => (value === "" ? EMPTY_KEY : value);
const fromKey = (key: unknown) => {
    if (key == null) return "";
    const value = String(key);
    return value === EMPTY_KEY ? "" : value;
};

interface RichSelectProps {
    options: RichSelectOption[];
    value?: string;
    defaultValue?: string;
    onChange?: (event: { target: { value: string } }) => void;
    size?: "sm" | "md" | "lg";
    disabled?: boolean;
    rich?: boolean;
    placeholder?: string;
    className?: string;
    popoverClassName?: string;
    id?: string;
    name?: string;
    "aria-label"?: string;
}

export const RichSelect = ({
    options,
    value,
    defaultValue,
    onChange,
    size = "sm",
    disabled,
    rich = false,
    placeholder = "Select",
    className,
    popoverClassName,
    id,
    name,
    "aria-label": ariaLabel,
}: RichSelectProps) => {
    const controlled = value !== undefined;
    const [internalValue, setInternalValue] = useState(defaultValue ?? "");
    useEffect(() => {
        if (controlled) setInternalValue(value ?? "");
    }, [controlled, value]);
    const selectedValue = controlled ? value ?? "" : internalValue;
    const items = options.map((option) => ({
        id: toKey(option.value),
        label: option.label,
        supportingText: option.supportingText,
        icon: option.icon,
        avatarUrl: option.avatarUrl,
        isDisabled: option.disabled,
        title: option.hint,
    }));

    return (
        <>
            {name ? <input type="hidden" name={name} value={selectedValue} /> : null}
            <Select
                id={id}
                aria-label={ariaLabel}
                size={size}
                items={items}
                placeholder={placeholder}
                isDisabled={disabled}
                selectedKey={toKey(selectedValue)}
                className={cx("w-full", className)}
                popoverClassName={popoverClassName}
                onSelectionChange={(key) => {
                    const next = fromKey(key);
                    if (!controlled) setInternalValue(next);
                    onChange?.({ target: { value: next } });
                }}
            >
                {(item) => (
                    <Select.Item
                        id={item.id}
                        label={item.label}
                        supportingText={item.supportingText}
                        icon={item.icon}
                        avatarUrl={item.avatarUrl}
                        isDisabled={item.isDisabled}
                        title={item.title}
                        supportingTextPosition={rich ? "below" : "inline"}
                    />
                )}
            </Select>
        </>
    );
};
