"use client";

import Link from "next/link";
import type { JobStatus, WorkType } from "@prisma/client";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { CompanyLogo } from "@/components/jobs/company-logo";
import type { CompanyLogoSources } from "@/lib/jobs/logos";
import { Star01 } from "@untitledui/icons";
import { StatusBadge } from "@/components/jobs/status-badge";
import { Badge, BadgeWithDot } from "@/components/base/badges/badges";
import { WORK_TYPE_LABELS } from "@/lib/jobs/enums";
import { fmtDate, fmtSalary } from "@/lib/jobs/format";
import { ApplicationBulkBar } from "@/components/jobs/application-bulk-bar";
import { useRowSelection } from "@/components/jobs/use-row-selection";

export type AppRow = {
    id: string;
    role: string;
    status: JobStatus;
    workType: WorkType;
    companyName: string;
    companyLogo: CompanyLogoSources;
    location: string | null;
    dateApplied: Date | null;
    deadline: Date | null;
    salaryMin: number | null;
    salaryMax: number | null;
    salaryCurrency: string | null;
    phaseName: string | null;
    phaseArchived: boolean;
    priority: number;
    health: { score: number; label: string; color: "success" | "warning" | "error" | "gray" | "brand" };
};

export function ApplicationsTable({ rows }: { rows: AppRow[] }) {
    const sel = useRowSelection(rows.map((r) => r.id));

    return (
        <div className="flex flex-col">
            {sel.count > 0 && (
                <div className="border-b border-secondary p-3">
                    <ApplicationBulkBar ids={sel.ids} onClear={sel.clear} />
                </div>
            )}
            <div className="overflow-x-auto">
                <table className="w-full">
                    <thead className="border-b border-secondary bg-secondary">
                        <tr className="text-left text-xs font-semibold text-quaternary">
                            <th className="w-0 px-5 py-3">
                                <Checkbox aria-label="Select all applications" isSelected={sel.allOn} isIndeterminate={sel.someOn} onChange={sel.toggleAll} />
                            </th>
                            <th className="px-5 py-3">Role</th>
                            <th className="px-5 py-3">Status</th>
                            <th className="px-5 py-3">Health</th>
                            <th className="px-5 py-3">Phase</th>
                            <th className="px-5 py-3">Salary</th>
                            <th className="px-5 py-3">Applied</th>
                            <th className="px-5 py-3">Deadline</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((r) => {
                            const checked = sel.isSelected(r.id);
                            return (
                                <tr key={r.id} className={`border-b border-secondary transition last:border-0 ${checked ? "bg-secondary" : "hover:bg-secondary"}`}>
                                    <td className="px-5 py-3 align-middle">
                                        <Checkbox aria-label={`Select ${r.role}`} isSelected={checked} onChange={(on) => sel.toggle(r.id, on)} />
                                    </td>
                                    <td className="px-5 py-3">
                                        <Link href={`/career/applications/${r.id}`} className="flex items-center gap-3">
                                            <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary p-1 ring-1 ring-secondary">
                                                <CompanyLogo
                                                    src={r.companyLogo}
                                                    alt={`${r.companyName} logo`}
                                                    name={r.companyName}
                                                    className="size-full object-contain"
                                                    iconClassName="text-xs"
                                                />
                                            </span>
                                            <span className="min-w-0">
                                                <span className="flex items-center gap-1.5 truncate text-sm font-medium text-primary">
                                                    {r.priority > 0 && (
                                                        <span className="flex shrink-0 items-center" aria-label={`Priority ${r.priority}`}>
                                                            {Array.from({ length: r.priority }).map((_, i) => (
                                                                <Star01 key={i} className="size-3 fill-current text-yellow-400" />
                                                            ))}
                                                        </span>
                                                    )}
                                                    {r.role}
                                                </span>
                                                <span className="block truncate text-xs text-tertiary">
                                                    {r.companyName}
                                                    {r.location ? ` · ${r.location}` : ""} · {WORK_TYPE_LABELS[r.workType]}
                                                </span>
                                            </span>
                                        </Link>
                                    </td>
                                    <td className="px-5 py-3">
                                        <StatusBadge status={r.status} />
                                    </td>
                                    <td className="px-5 py-3">
                                        {r.health.label === "Closed" ? (
                                            <span className="text-sm text-tertiary">—</span>
                                        ) : (
                                            <BadgeWithDot color={r.health.color} type="pill-color" size="sm">
                                                {r.health.score}
                                            </BadgeWithDot>
                                        )}
                                    </td>
                                    <td className="px-5 py-3">
                                        {r.phaseName ? (
                                            <Badge color={r.phaseArchived ? "gray" : "brand"} size="sm" type="color">
                                                {r.phaseName}
                                            </Badge>
                                        ) : (
                                            <span className="text-sm text-tertiary">—</span>
                                        )}
                                    </td>
                                    <td className="px-5 py-3 text-sm text-tertiary">{fmtSalary(r.salaryMin, r.salaryMax, r.salaryCurrency)}</td>
                                    <td className="px-5 py-3 text-sm text-tertiary">{fmtDate(r.dateApplied)}</td>
                                    <td className="px-5 py-3 text-sm text-tertiary">{fmtDate(r.deadline)}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
