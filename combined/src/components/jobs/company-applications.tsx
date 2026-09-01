"use client";

import Link from "next/link";
import type { JobStatus, WorkType } from "@prisma/client";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { CompanyLogo } from "@/components/jobs/company-logo";
import type { CompanyLogoSources } from "@/lib/jobs/logos";
import { StatusBadge } from "@/components/jobs/status-badge";
import { WORK_TYPE_LABELS } from "@/lib/jobs/enums";
import { fmtDate } from "@/lib/jobs/format";
import { ApplicationBulkBar } from "@/components/jobs/application-bulk-bar";
import { useRowSelection } from "@/components/jobs/use-row-selection";

export type CompanyAppRow = {
    id: string;
    role: string;
    status: JobStatus;
    workType: WorkType;
    dateApplied: Date | null;
};

/** Selectable applications list for a company detail page, with bulk status / delete. */
export function CompanyApplicationsList({ rows, companyLogo, companyName }: { rows: CompanyAppRow[]; companyLogo: CompanyLogoSources; companyName: string }) {
    const sel = useRowSelection(rows.map((r) => r.id));

    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
                <Checkbox aria-label="Select all applications" isSelected={sel.allOn} isIndeterminate={sel.someOn} onChange={sel.toggleAll} label="Select all" size="sm" />
            </div>

            {sel.count > 0 && <ApplicationBulkBar ids={sel.ids} onClear={sel.clear} />}

            <ul className="flex flex-col divide-y divide-secondary">
                {rows.map((a) => {
                    const checked = sel.isSelected(a.id);
                    return (
                        <li key={a.id} className="flex items-center gap-3">
                            <Checkbox aria-label={`Select ${a.role}`} isSelected={checked} onChange={(on) => sel.toggle(a.id, on)} />
                            <Link href={`/career/applications/${a.id}`} className="flex min-w-0 flex-1 items-center justify-between gap-3 py-2.5 hover:opacity-80">
                                <div className="flex min-w-0 items-center gap-3">
                                    <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-primary p-1 ring-1 ring-secondary">
                                        <CompanyLogo src={companyLogo} alt={companyName} name={companyName} className="size-full object-contain" iconClassName="text-xs" />
                                    </span>
                                    <div className="min-w-0">
                                        <div className="truncate text-sm font-medium text-primary">{a.role}</div>
                                        <div className="text-xs text-tertiary">
                                            {WORK_TYPE_LABELS[a.workType]} · Applied {fmtDate(a.dateApplied)}
                                        </div>
                                    </div>
                                </div>
                                <StatusBadge status={a.status} />
                            </Link>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
