"use client";

import type { ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Building07, Flag01, MarkerPin01, SearchLg, SwitchVertical01 } from "@untitledui/icons";
import { Input } from "@/components/base/input/input";
import { Select, type SelectItemType } from "@/components/base/select/select";
import { CompanyLogo } from "@/components/jobs/company-logo";
import type { CompanyLogoSources } from "@/lib/jobs/logos";
import { STATUS_HEX, STATUS_LABELS, STATUS_ORDER } from "@/lib/jobs/enums";

type CompanyOption = { id: string; name: string; logo: CompanyLogoSources };
type PhaseOption = { id: string; name: string; archived: boolean };
type LocationOption = { id: string; name: string };

/** Small colored status dot rendered in the select trigger + options. */
function statusDot(hex: string): ReactNode {
    return (
        <span data-icon aria-hidden="true" className="flex items-center justify-center">
            <span className="size-2 rounded-full" style={{ backgroundColor: hex }} />
        </span>
    );
}

/** Tiny framed company logo (with monogram fallback) for select options. */
function companyIcon(c: CompanyOption): ReactNode {
    return (
        <span data-icon aria-hidden="true" className="flex items-center justify-center overflow-hidden rounded-sm bg-primary ring-1 ring-secondary ring-inset">
            <CompanyLogo src={c.logo} alt="" name={c.name} className="size-full object-contain" iconClassName="text-[8px]" />
        </span>
    );
}

/**
 * Rich filter bar for /career/applications. All four dropdowns are Untitled UI
 * Selects (logo / status-dot / archived-state aware) but still write the same
 * URL params, so filtering stays fully server-side.
 */
export function ApplicationsFilter({ companies, phases, locations = [] }: { companies: CompanyOption[]; phases: PhaseOption[]; locations?: LocationOption[] }) {
    const router = useRouter();
    const sp = useSearchParams();

    function set(key: string, value: string) {
        const next = new URLSearchParams(sp.toString());
        if (value) next.set(key, value);
        else next.delete(key);
        router.push(`/career/applications?${next.toString()}`);
    }

    const statusItems: SelectItemType[] = [
        { id: "all", label: "All statuses", icon: statusDot("var(--color-fg-quaternary)") },
        ...STATUS_ORDER.map((s) => ({ id: s, label: STATUS_LABELS[s], icon: statusDot(STATUS_HEX[s]) })),
    ];

    const companyItems: SelectItemType[] = [
        { id: "all", label: "All companies", icon: Building07 },
        ...companies.map((c) => ({ id: c.id, label: c.name, icon: companyIcon(c) })),
    ];

    const phaseItems: SelectItemType[] = [
        { id: "active", label: "Active phases" },
        { id: "archived", label: "Archived phases" },
        { id: "none", label: "No phase" },
        { id: "all", label: "All phases" },
        ...phases.map((p) => ({ id: p.id, label: p.name, supportingText: p.archived ? "Archived" : undefined })),
    ];

    const sortItems: SelectItemType[] = [
        { id: "recent", label: "Recently added" },
        { id: "applied", label: "Date applied" },
        { id: "deadline", label: "Deadline" },
        { id: "role", label: "Role A–Z" },
    ];

    const locationItems: SelectItemType[] = [
        { id: "all", label: "All locations" },
        { id: "remote", label: "Remote" },
        { id: "none", label: "Unassigned" },
        ...locations.map((l) => ({ id: l.id, label: l.name })),
    ];

    const hasLocations = locations.length > 0;

    return (
        <div className="flex flex-col gap-3">
            <Input
                aria-label="Search applications"
                icon={SearchLg}
                placeholder="Search by role, company or location…"
                defaultValue={sp.get("q") ?? ""}
                onBlur={(e) => set("q", (e.target as HTMLInputElement).value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter") set("q", (e.currentTarget as HTMLInputElement).value);
                }}
            />
            <div className={hasLocations ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-5" : "grid gap-3 sm:grid-cols-2 lg:grid-cols-4"}>
            <Select
                aria-label="Filter by status"
                size="sm"
                items={statusItems}
                selectedKey={sp.get("status") || "all"}
                onSelectionChange={(key) => set("status", key === "all" ? "" : String(key ?? ""))}
            >
                {(item) => (
                    <Select.Item id={item.id} icon={item.icon}>
                        {item.label}
                    </Select.Item>
                )}
            </Select>

            <Select
                aria-label="Filter by company"
                size="sm"
                items={companyItems}
                selectedKey={sp.get("companyId") || "all"}
                onSelectionChange={(key) => set("companyId", key === "all" ? "" : String(key ?? ""))}
            >
                {(item) => (
                    <Select.Item id={item.id} icon={item.icon}>
                        {item.label}
                    </Select.Item>
                )}
            </Select>

            <Select
                aria-label="Filter by phase"
                size="sm"
                icon={Flag01}
                items={phaseItems}
                selectedKey={sp.get("phase") || "active"}
                onSelectionChange={(key) => set("phase", key === "active" ? "" : String(key ?? ""))}
            >
                {(item) => (
                    <Select.Item id={item.id} supportingText={item.supportingText}>
                        {item.label}
                    </Select.Item>
                )}
            </Select>

            {hasLocations && (
                <Select
                    aria-label="Filter by location"
                    size="sm"
                    icon={MarkerPin01}
                    items={locationItems}
                    selectedKey={sp.get("location") || "all"}
                    onSelectionChange={(key) => set("location", key === "all" ? "" : String(key ?? ""))}
                >
                    {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                </Select>
            )}

            <Select
                aria-label="Sort applications"
                size="sm"
                icon={SwitchVertical01}
                items={sortItems}
                selectedKey={sp.get("sort") || "recent"}
                onSelectionChange={(key) => set("sort", key === "recent" ? "" : String(key ?? ""))}
            >
                {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
            </Select>
            </div>
        </div>
    );
}
