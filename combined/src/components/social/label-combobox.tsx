"use client";

import { useState } from "react";
import { Field } from "@/components/jobs/fields";
import { InputBase } from "@/components/base/input/input";
import { cx } from "@/utils/cx";

/**
 * A label picker that allows preset chips OR a custom free-text value.
 * Posts the chosen label as a plain text field named `name` so it works inside
 * server-action <form>s. Presets are quick-select chips; "Custom…" reveals a
 * text input. The stored String can be anything (schema is free text).
 */
export function LabelCombobox({
    name,
    label,
    presets,
    defaultValue = "",
    isRequired,
}: {
    name: string;
    label: string;
    presets: string[];
    defaultValue?: string;
    isRequired?: boolean;
}) {
    const isPreset = presets.includes(defaultValue);
    const [value, setValue] = useState(defaultValue);
    const [custom, setCustom] = useState(defaultValue !== "" && !isPreset);

    return (
        <Field label={label} isRequired={isRequired}>
            <div className="flex flex-wrap gap-1.5">
                {presets.map((p) => {
                    const active = !custom && value === p;
                    return (
                        <button
                            key={p}
                            type="button"
                            onClick={() => {
                                setCustom(false);
                                setValue(p);
                            }}
                            className={cx(
                                "rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition duration-100 ease-linear ring-inset",
                                active ? "bg-brand-primary text-brand-secondary ring-brand" : "bg-primary text-secondary ring-secondary hover:bg-secondary_hover",
                            )}
                        >
                            {p}
                        </button>
                    );
                })}
                <button
                    type="button"
                    onClick={() => {
                        setCustom(true);
                        if (presets.includes(value)) setValue("");
                    }}
                    className={cx(
                        "rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition duration-100 ease-linear ring-inset",
                        custom ? "bg-brand-primary text-brand-secondary ring-brand" : "bg-primary text-secondary ring-secondary hover:bg-secondary_hover",
                    )}
                >
                    Custom…
                </button>
            </div>
            {custom ? (
                <InputBase
                    size="sm"
                    name={name}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="Custom label"
                    aria-label={`${label} (custom)`}
                    wrapperClassName="mt-2 w-full"
                />
            ) : (
                <input type="hidden" name={name} value={value} />
            )}
        </Field>
    );
}
