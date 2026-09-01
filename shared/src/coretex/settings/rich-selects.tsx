// @ts-nocheck
"use client";

// Settings-row wrappers for AI provider and model pickers — logos, subtitles, ModelPicker.

import type { ReactNode } from "react";
import type { ModelInfo, ProviderConfigState, ProviderType } from "@repo/coretex/types";
import type { RichSelectOption } from "@/components/base/select/select-native";
import { RichSelect } from "@/components/base/select/rich-select";
import { cx } from "@/utils/cx";
import { ModelPicker } from "../ui/model-picker";
import { buildModelSelectOptions, buildProviderSelectOptions } from "./rich-select-options";

export const SettingsProviderSelect = ({
    value,
    onChange,
    providers,
    includeInherit,
    inheritLabel,
    inheritSubtitle,
    readyOnly,
    disabled,
    className,
    size = "sm",
}: {
    value: string;
    onChange: (value: string) => void;
    providers: ProviderConfigState[];
    includeInherit?: boolean;
    inheritLabel?: string;
    inheritSubtitle?: string;
    readyOnly?: boolean;
    disabled?: boolean;
    className?: string;
    size?: "sm" | "md" | "lg";
}) => {
    const options = buildProviderSelectOptions(providers, { includeInherit, inheritLabel, inheritSubtitle, readyOnly });
    return (
        <div className={cx(className ?? "w-72")}>
            <RichSelect
                aria-label="AI provider"
                size={size}
                options={options}
                value={value}
                disabled={disabled}
                rich
                onChange={(e) => onChange(e.target.value)}
            />
        </div>
    );
};

/** Model dropdown with rich rows, or fall back to ModelPicker when many models. */
export const SettingsModelSelect = ({
    value,
    onChange,
    models,
    includeInherit,
    pinnedId,
    disabled,
    className,
    usePickerMin = 8,
    onComparePricing,
}: {
    value: string;
    onChange: (value: string) => void;
    models: ModelInfo[];
    includeInherit?: boolean;
    pinnedId?: string;
    disabled?: boolean;
    className?: string;
    /** Use full ModelPicker when at least this many models (search + filters). */
    usePickerMin?: number;
    onComparePricing?: () => void;
}) => {
    const options = buildModelSelectOptions(models, { includeInherit, pinnedId });
    if (models.length >= usePickerMin && !includeInherit) {
        const current = models.find((m) => m.id === value);
        const provider = current?.provider ?? models[0]?.provider;
        if (provider) {
            return (
                <div className={cx(className ?? "w-72")}>
                    <ModelPicker
                        models={models}
                        value={value && provider ? { provider, id: value } : null}
                        onChange={(_p, id) => onChange(id)}
                        capability="chat"
                        placeholder="Select a model"
                        compact
                        onComparePricing={onComparePricing}
                    />
                </div>
            );
        }
    }

    return (
        <div className={cx(className ?? "w-72")}>
            <RichSelect
                aria-label="AI model"
                size="sm"
                options={options}
                value={value}
                disabled={disabled}
                rich
                onChange={(e) => onChange(e.target.value)}
            />
        </div>
    );
};

export const SettingsModelPicker = ({
    models,
    provider,
    model,
    onChange,
    disabled,
    className,
    onComparePricing,
}: {
    models: ModelInfo[];
    provider: ProviderType | "";
    model: string;
    onChange: (provider: ProviderType, model: string) => void;
    disabled?: boolean;
    className?: string;
    onComparePricing?: () => void;
}) => (
    <div className={cx(className ?? "w-72", disabled && "pointer-events-none opacity-50")}>
        <ModelPicker
            models={models}
            value={provider && model ? { provider, id: model } : null}
            onChange={onChange}
            capability="chat"
            placeholder="Select a model"
            compact
            onComparePricing={onComparePricing}
        />
    </div>
);

export function richSelectRow(control: ReactNode, width = "w-72"): ReactNode {
    return <div className={width}>{control}</div>;
}

export type { RichSelectOption };
