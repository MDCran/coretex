"use client";

// Coretex Relay — schema-driven settings controls. Each control reads its value
// from the live CoretexConfig at a dot-path and writes back via actions.setSetting,
// which round-trips through the Brain (persist + apply + broadcast). Dependent
// controls grey out with an explanatory tooltip (the §14 dependency map).

import { useEffect, useState, type ReactNode } from "react";
import type { CoretexConfig } from "@repo/coretex/types";
import { Toggle } from "@/components/base/toggle/toggle";
import type { RichSelectOption } from "@/components/base/select/select-native";
import { RichSelect } from "@/components/base/select/rich-select";
import { Slider } from "@/components/base/slider/slider";
import { Input } from "@/components/base/input/input";
import { cx } from "@/utils/cx";
import type { CoretexActions } from "../use-coretex";
import { richEnumOptions } from "./rich-select-options";

function normalizeSelectOptions(path: string, options: RichSelectOption[]): RichSelectOption[] {
    return richEnumOptions(path) ?? options;
}

function isRichOptions(options: RichSelectOption[]): boolean {
    return options.some((o) => Boolean(o.supportingText || o.detailText || o.icon || o.avatarUrl));
}

export function getByPath(obj: unknown, path: string): unknown {
    return path.split(".").reduce<unknown>((acc, key) => {
        if (acc !== null && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
            return (acc as Record<string, unknown>)[key];
        }
        return undefined;
    }, obj);
}

interface BaseProps {
    settings: CoretexConfig;
    actions: CoretexActions;
    path: string;
    label: string;
    description?: string;
    disabled?: boolean;
    disabledReason?: string;
}

export const SettingsSection = ({ title, description, children }: { title: string; description?: string; children: ReactNode }) => (
    <section className="rounded-xl p-5 sm:p-6" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}>
        <div className="mb-5">
            <h2 className="text-md font-semibold text-primary">{title}</h2>
            {description && <p className="mt-1 text-sm text-tertiary">{description}</p>}
        </div>
        {/* Soft divider — muted mix, not harsh white hairlines */}
        <div className="flex flex-col [&>*+*]:border-t [&>*+*]:border-[color:var(--c-divider,color-mix(in_srgb,var(--c-text-muted)_22%,transparent))]">
            {children}
        </div>
    </section>
);

const Row = ({ label, description, disabled, disabledReason, control }: { label: string; description?: string; disabled?: boolean; disabledReason?: string; control: ReactNode }) => (
    <div className={cx("flex flex-col items-stretch justify-between gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-6", disabled && "opacity-50")} title={disabled ? disabledReason : undefined}>
        <div className="min-w-0 flex-1">
            <p className="break-words text-sm font-medium text-primary">{label}</p>
            {description && <p className="mt-0.5 break-words text-xs text-tertiary">{description}</p>}
            {disabled && disabledReason && <p className="mt-0.5 break-words text-xs italic text-quaternary">{disabledReason}</p>}
        </div>
        <div className={cx("min-w-0 shrink-0", disabled && "pointer-events-none")}>{control}</div>
    </div>
);

export const SettingToggle = ({ settings, actions, path, label, description, disabled, disabledReason }: BaseProps) => {
    const value = getByPath(settings, path) === true;
    return (
        <Row
            label={label}
            description={description}
            disabled={disabled}
            disabledReason={disabledReason}
            control={<Toggle aria-label={label} isSelected={value} isDisabled={disabled} onChange={(v: boolean) => actions.setSetting(path, v)} />}
        />
    );
};

interface SelectProps extends BaseProps {
    options: RichSelectOption[];
}

export const SettingSelect = ({ settings, actions, path, label, description, disabled, disabledReason, options }: SelectProps) => {
    const value = String(getByPath(settings, path) ?? "");
    const resolved = normalizeSelectOptions(path, options);
    const rich = isRichOptions(resolved);
    return (
        <Row
            label={label}
            description={description}
            disabled={disabled}
            disabledReason={disabledReason}
            control={
                <div className={rich ? "w-full sm:w-80 2xl:w-96" : "w-full sm:w-72 2xl:w-80"}>
                    <RichSelect
                        aria-label={label}
                        options={resolved}
                        value={value}
                        disabled={disabled}
                        rich={rich}
                        onChange={(e) => actions.setSetting(path, e.target.value)}
                    />
                </div>
            }
        />
    );
};

interface SliderProps extends BaseProps {
    min: number;
    max: number;
    step?: number;
    unit?: string;
}

export const SettingSlider = ({ settings, actions, path, label, description, disabled, disabledReason, min, max, step = 1, unit }: SliderProps) => {
    const raw = getByPath(settings, path);
    const value = typeof raw === "number" ? raw : min;
    return (
        <Row
            label={label}
            description={description}
            disabled={disabled}
            disabledReason={disabledReason}
            control={
                <div className="flex w-full items-center gap-3 sm:w-56">
                    <div className="flex-1">
                        <Slider
                            aria-label={label}
                            isDisabled={disabled}
                            value={value}
                            minValue={min}
                            maxValue={max}
                            step={step}
                            onChange={(v) => actions.setSetting(path, Array.isArray(v) ? v[0] : v)}
                        />
                    </div>
                    <span className="w-14 text-right text-sm font-medium text-secondary tabular-nums">
                        {value}
                        {unit ?? ""}
                    </span>
                </div>
            }
        />
    );
};

interface NumberProps extends BaseProps {
    min?: number;
    max?: number;
}

export const SettingNumber = ({ settings, actions, path, label, description, disabled, disabledReason, min, max }: NumberProps) => {
    const raw = getByPath(settings, path);
    const value = typeof raw === "number" ? String(raw) : "";
    const [draft, setDraft] = useState(value);
    useEffect(() => setDraft(value), [value]);

    const commit = () => {
        if (draft.trim() === "") {
            setDraft(value);
            return;
        }
        let next = Number(draft);
        if (!Number.isFinite(next)) {
            setDraft(value);
            return;
        }
        if (typeof min === "number") next = Math.max(min, next);
        if (typeof max === "number") next = Math.min(max, next);
        setDraft(String(next));
        if (next !== raw) actions.setSetting(path, next);
    };
    return (
        <Row
            label={label}
            description={description}
            disabled={disabled}
            disabledReason={disabledReason}
            control={
                <div className="w-full sm:w-32">
                    <Input
                        aria-label={label}
                        type="number"
                        value={draft}
                        isDisabled={disabled}
                        onChange={setDraft}
                        onBlur={commit}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") {
                                commit();
                                event.currentTarget.blur();
                            } else if (event.key === "Escape") {
                                setDraft(value);
                                event.currentTarget.blur();
                            }
                        }}
                    />
                </div>
            }
        />
    );
};

interface TextProps extends BaseProps {
    placeholder?: string;
    mono?: boolean;
}

export const SettingText = ({ settings, actions, path, label, description, disabled, disabledReason, placeholder }: TextProps) => {
    const value = String(getByPath(settings, path) ?? "");
    return (
        <Row
            label={label}
            description={description}
            disabled={disabled}
            disabledReason={disabledReason}
            control={
                <div className="w-full sm:w-80 2xl:w-96">
                    <Input aria-label={label} value={value} placeholder={placeholder} isDisabled={disabled} onChange={(v: string) => actions.setSetting(path, v)} />
                </div>
            }
        />
    );
};
