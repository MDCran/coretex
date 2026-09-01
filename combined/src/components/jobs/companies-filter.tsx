"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { SearchLg } from "@untitledui/icons";
import { Input } from "@/components/base/input/input";
import { SelectInput } from "@/components/jobs/fields";

export function CompaniesFilter({ industries }: { industries: string[] }) {
    const router = useRouter();
    const sp = useSearchParams();

    function set(key: string, value: string) {
        const next = new URLSearchParams(sp.toString());
        if (value) next.set(key, value);
        else next.delete(key);
        router.push(`/career/companies?${next.toString()}`);
    }

    return (
        <div className="grid gap-3 sm:grid-cols-2 lg:max-w-xl">
            <Input
                aria-label="Search companies"
                icon={SearchLg}
                placeholder="Search companies…"
                defaultValue={sp.get("q") ?? ""}
                onBlur={(e) => set("q", (e.target as HTMLInputElement).value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter") set("q", (e.target as HTMLInputElement).value);
                }}
            />
            <SelectInput
                aria-label="Industry"
                placeholder="All industries"
                value={sp.get("industry") ?? ""}
                onChange={(e) => set("industry", e.target.value)}
                options={industries.map((i) => ({ value: i, label: i }))}
            />
        </div>
    );
}
