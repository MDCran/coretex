"use client";

import { useState } from "react";
import { LinkExternal01 } from "@untitledui/icons";
import { Select } from "@/components/base/select/select";
import { Field } from "@/components/jobs/fields";
import { HEARD_FROM_SOURCES } from "@/lib/jobs/enums";

/** Logo tile with a lettered fallback if LogoKit has no image. */
function SourceLogo({ domain, label }: { domain: string | null; label: string }) {
    const [failed, setFailed] = useState(false);

    if (!domain || failed) {
        return (
            <span
                data-icon
                aria-hidden="true"
                className="flex size-5 shrink-0 items-center justify-center rounded-sm bg-secondary text-[9px] font-bold text-tertiary ring-1 ring-secondary ring-inset"
            >
                {label[0]}
            </span>
        );
    }

    return (
        <span
            data-icon
            aria-hidden="true"
            className="flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-white ring-1 ring-secondary ring-inset"
        >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                src={`https://img.logokit.com/${domain}`}
                alt=""
                className="size-full object-contain"
                onError={() => setFailed(true)}
            />
        </span>
    );
}

// Pre-build items with logo elements baked in so SelectItemType isn't extended.
const ITEMS = HEARD_FROM_SOURCES.map((s) => ({
    id: s.id,
    label: s.label,
    icon: <SourceLogo domain={s.domain as string | null} label={s.label} />,
}));

/**
 * Source / "heard via" combobox for job applications.
 * Presets have logos; any free-text custom value is also accepted.
 * Posts the display label (e.g. "LinkedIn") or the custom string.
 */
export function SourcePicker({
    name,
    label,
    defaultValue,
}: {
    name: string;
    label?: string;
    defaultValue?: string | null;
}) {
    // Map legacy enum keys ("LINKEDIN") to their display label ("LinkedIn").
    const initialDisplay = HEARD_FROM_SOURCES.find((s) => s.id === defaultValue)?.label ?? (defaultValue ?? "");

    const [formValue, setFormValue] = useState(initialDisplay);

    return (
        <Field label={label}>
            <input type="hidden" name={name} value={formValue} />
            <Select.ComboBox
                allowsCustomValue
                defaultInputValue={initialDisplay}
                onInputChange={setFormValue}
                icon={LinkExternal01}
                placeholder="LinkedIn, company site, referral…"
                shortcut={false}
                items={ITEMS}
            >
                {(item) => (
                    <Select.Item id={item.id} icon={item.icon}>
                        {item.label}
                    </Select.Item>
                )}
            </Select.ComboBox>
        </Field>
    );
}
