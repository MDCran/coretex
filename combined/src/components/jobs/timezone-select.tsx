"use client";

import { useMemo } from "react";
import { SelectInput } from "@/components/jobs/fields";

/** IANA timezone picker backed by Intl.supportedValuesOf. */
export function TimezoneSelect({ name, label, defaultValue }: { name: string; label?: string; defaultValue?: string | null }) {
    const zones = useMemo(() => {
        try {
            return (Intl.supportedValuesOf?.("timeZone") as string[] | undefined) ?? [];
        } catch {
            return [];
        }
    }, []);

    return (
        <SelectInput
            name={name}
            label={label}
            placeholder="—"
            defaultValue={defaultValue ?? ""}
            options={zones.map((z) => ({ value: z, label: z.replace(/_/g, " ") }))}
        />
    );
}
