"use client";

import { useState } from "react";
import { Building07 } from "@untitledui/icons";
import { Select } from "@/components/base/select/select";
import { CompanyLogo } from "@/components/jobs/company-logo";
import type { CompanyLogoSources } from "@/lib/jobs/logos";

type CompanyOption = { id: string; name: string; logo?: CompanyLogoSources };

/**
 * Searchable company picker that posts the selected id under `name` via a hidden
 * input. Options (and the selected value) show the company logo with the usual
 * uploaded → LogoKit → favicon → monogram fallback chain.
 */
export function CompanyCombobox({
    name,
    label,
    companies,
    defaultValue,
    isRequired,
}: {
    name: string;
    label?: string;
    companies: CompanyOption[];
    defaultValue?: string | null;
    isRequired?: boolean;
}) {
    const [value, setValue] = useState<string>(defaultValue ?? "");

    const items = companies.map((c) => ({
        id: c.id,
        label: c.name,
        icon: (
            <span
                data-icon
                aria-hidden="true"
                className="flex items-center justify-center overflow-hidden rounded-sm bg-primary ring-1 ring-secondary ring-inset"
            >
                <CompanyLogo src={c.logo ?? null} alt="" name={c.name} className="size-full object-contain" iconClassName="text-[8px]" />
            </span>
        ),
    }));

    return (
        <div className="flex flex-col gap-1.5">
            <input type="hidden" name={name} value={value} required={isRequired} />
            <Select.ComboBox
                label={label}
                icon={Building07}
                placeholder="Search companies…"
                isRequired={isRequired}
                shortcut={false}
                selectedKey={value || null}
                onSelectionChange={(key) => setValue(key ? String(key) : "")}
                items={items}
            >
                {(item) => (
                    <Select.Item id={item.id} icon={item.icon}>
                        {item.label}
                    </Select.Item>
                )}
            </Select.ComboBox>
        </div>
    );
}
