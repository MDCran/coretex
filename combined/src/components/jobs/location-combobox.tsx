"use client";

import { useState } from "react";
import { MarkerPin01 } from "@untitledui/icons";
import { Select } from "@/components/base/select/select";
import { Field } from "@/components/jobs/fields";

export type SavedLocation = { id: string; label: string; shortLabel: string | null };

/**
 * Combobox for the application location field.
 * Prepopulates the dropdown with the user's saved job-search locations,
 * but also allows typing a fully custom value (allowsCustomValue).
 * Posts plain text (not an id) under `name`.
 */
export function LocationCombobox({
    name,
    label,
    defaultValue,
    savedLocations,
}: {
    name: string;
    label?: string;
    defaultValue?: string | null;
    savedLocations: SavedLocation[];
}) {
    const [formValue, setFormValue] = useState(defaultValue ?? "");

    const items = savedLocations.map((loc) => ({
        id: loc.id,
        label: loc.shortLabel ?? loc.label,
    }));

    return (
        <Field label={label}>
            {/* Hidden input carries the plain-text value into FormData */}
            <input type="hidden" name={name} value={formValue} />
            <Select.ComboBox
                allowsCustomValue
                defaultInputValue={defaultValue ?? ""}
                onInputChange={setFormValue}
                icon={MarkerPin01}
                placeholder="City, state, remote…"
                shortcut={false}
                items={items}
            >
                {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
            </Select.ComboBox>
        </Field>
    );
}
