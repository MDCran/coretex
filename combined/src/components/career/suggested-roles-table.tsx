"use client";

import { createContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { JobLevel } from "@prisma/client";
import { Globe01, LayoutGrid01, LinkExternal01, MarkerPin01, SearchLg, Star01 } from "@untitledui/icons";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { Badge, BadgeWithDot } from "@/components/base/badges/badges";
import { CompanyLogo } from "@/components/jobs/company-logo";
import { companyLogoSrc } from "@/lib/jobs/logos";
import { fmtDate, fmtSalary } from "@/lib/jobs/format";
import { JOB_LEVEL_BADGE_COLOR, JOB_LEVEL_LABELS } from "@/lib/jobs/enums";
import { LeadButtons } from "@/components/career/job-search-actions";
import { EmptyState } from "@/components/career/career-ui";
import { cx } from "@/utils/cx";

export interface LeadRow {
    id: string;
    title: string;
    level: JobLevel;
    companyId: string | null;
    companyName: string;
    companyDomain: string | null;
    applicationUrl: string | null;
    salaryMin: number | null;
    salaryMax: number | null;
    salaryCurrency: string | null;
    deadline: Date | null;
    locationText: string | null;
    isRemote: boolean;
    nearestLabel: string | null;
    distanceMiles: number | null;
    matchScore: number | null;
    matchReason: string | null;
}

/**
 * Lets a row's action buttons (LeadButtons) optimistically drop the row from the live table
 * the moment an Add / Dismiss succeeds — so the row disappears without waiting for the server
 * revalidation round-trip. No-op outside the table (e.g. on the company page).
 */
export const LeadRowRemovalContext = createContext<(id: string) => void>(() => {});

function matchColor(score: number): "success" | "brand" | "warning" | "gray" {
    if (score >= 75) return "success";
    if (score >= 55) return "brand";
    if (score >= 35) return "warning";
    return "gray";
}

/** Render a role's location: nearest saved location + distance, or a Remote badge. */
function LocationCell({ row }: { row: LeadRow }) {
    if (row.isRemote) {
        return (
            <Badge color="blue" size="sm" type="pill-color">
                Remote
            </Badge>
        );
    }
    if (!row.locationText) return <span className="text-sm text-tertiary">—</span>;
    return (
        <div className="min-w-0">
            <div className="flex items-center gap-1 text-sm text-secondary">
                <MarkerPin01 className="size-3.5 shrink-0 text-fg-quaternary" />
                <span className="truncate">{row.locationText}</span>
            </div>
            {row.nearestLabel && row.distanceMiles != null && (
                <div className="truncate text-xs text-tertiary">
                    {Math.round(row.distanceMiles)} mi from {row.nearestLabel}
                </div>
            )}
        </div>
    );
}

type GroupMode = "none" | "company" | "location";
type LevelFilter = "all" | JobLevel | "REMOTE";

const ALL = "__all__";
const REMOTE_KEY = "__remote__";

/** Stable display label for a row's location used by both the location filter and grouping. */
function locationKey(row: LeadRow): string {
    if (row.isRemote) return "Remote";
    return row.locationText?.trim() || "Unspecified";
}

/** A single rendered table row, with an optional "new" flash on freshly-added leads. */
function RoleRow({ row, showCompany, isNew }: { row: LeadRow; showCompany: boolean; isNew: boolean }) {
    return (
        <tr
            className={cx(
                "border-b border-secondary align-top last:border-0 transition-colors duration-700 ease-out motion-reduce:transition-none",
                isNew && "bg-success-primary",
            )}
        >
            <td className="px-4 py-3">
                <div className="flex items-start gap-2">
                    {row.applicationUrl ? (
                        <a
                            href={row.applicationUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-brand-secondary hover:underline"
                        >
                            {row.title}
                            <LinkExternal01 className="size-3.5 text-fg-quaternary" />
                        </a>
                    ) : (
                        <span className="text-sm font-medium text-primary">{row.title}</span>
                    )}
                    {isNew && (
                        <Badge color="success" size="sm" type="pill-color">
                            New
                        </Badge>
                    )}
                </div>
                <div className="mt-1 flex items-center gap-2">
                    <Badge color={JOB_LEVEL_BADGE_COLOR[row.level]} size="sm" type="color">
                        {JOB_LEVEL_LABELS[row.level]}
                    </Badge>
                </div>
                {row.matchReason && <p className="mt-1 max-w-xs text-xs text-tertiary">{row.matchReason}</p>}
            </td>

            {showCompany && (
                <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                        <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-primary p-1 ring-1 ring-secondary">
                            <CompanyLogo
                                src={companyLogoSrc({ logoKey: null, websiteDomain: row.companyDomain, name: row.companyName }, { fallbackUrl: row.applicationUrl })}
                                alt={row.companyName}
                                name={row.companyName}
                                className="size-full object-contain"
                                iconClassName="text-[10px]"
                            />
                        </span>
                        {row.companyId ? (
                            <Link href={`/career/companies/${row.companyId}`} className="truncate text-sm text-secondary hover:text-primary hover:underline">
                                {row.companyName}
                            </Link>
                        ) : (
                            <span className="truncate text-sm text-secondary">{row.companyName}</span>
                        )}
                    </div>
                </td>
            )}

            <td className="px-4 py-3">
                <LocationCell row={row} />
            </td>
            <td className="px-4 py-3 text-sm text-tertiary">{fmtSalary(row.salaryMin, row.salaryMax, row.salaryCurrency)}</td>
            <td className="px-4 py-3 text-sm text-tertiary">{fmtDate(row.deadline)}</td>
            <td className="px-4 py-3">
                {row.matchScore != null ? (
                    <BadgeWithDot color={matchColor(row.matchScore)} type="pill-color" size="sm">
                        {row.matchScore}
                    </BadgeWithDot>
                ) : (
                    <Star01 className="size-4 text-fg-quaternary" />
                )}
            </td>
            <td className="px-4 py-3">
                <LeadButtons id={row.id} />
            </td>
        </tr>
    );
}

interface TableProps {
    /** Server-rendered initial rows. */
    rows: LeadRow[];
    showCompany?: boolean;
    /**
     * Leads appended live by the run loop (newest passes last). When provided, the table
     * lifts its own merged state and flashes the freshly-added rows.
     */
    liveLeads?: LeadRow[];
    /** Reports the current total number of merged rows (server + live), e.g. for a card title. */
    onTotalChange?: (total: number) => void;
}

export function SuggestedRolesTable({ rows, showCompany = true, liveLeads, onTotalChange }: TableProps) {
    // Lift rows into state so the run loop can append without a page refresh. We seed from
    // the server rows and merge any live leads (deduped by id), tracking which ids are "new".
    const [allRows, setAllRows] = useState<LeadRow[]>(rows);
    const [newIds, setNewIds] = useState<Set<string>>(() => new Set());
    const flashTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
    // Ids the user has optimistically added/dismissed — kept out of the table even if a stale
    // server render still includes them, until the revalidation catches up.
    const removedIds = useRef(new Set<string>());

    // Drop a row immediately when its Add / Dismiss action succeeds.
    const removeRow = useCallback((id: string) => {
        removedIds.current.add(id);
        setAllRows((prev) => prev.filter((r) => r.id !== id));
        setNewIds((prev) => {
            if (!prev.has(id)) return prev;
            const next = new Set(prev);
            next.delete(id);
            return next;
        });
        const t = flashTimers.current.get(id);
        if (t) {
            clearTimeout(t);
            flashTimers.current.delete(id);
        }
    }, []);

    // Keep state in sync if the server rows change (e.g. revalidation after add/dismiss).
    const serverKey = useMemo(() => rows.map((r) => r.id).join("|"), [rows]);
    useEffect(() => {
        setAllRows((prev) => {
            // Preserve any live-appended rows not yet present in the new server set.
            const serverIds = new Set(rows.map((r) => r.id));
            const extras = prev.filter((r) => !serverIds.has(r.id) && newIds.has(r.id) && !removedIds.current.has(r.id));
            const merged = [...rows, ...extras];
            // Honor optimistic removals the server hasn't dropped yet.
            return merged.filter((r) => !removedIds.current.has(r.id));
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [serverKey]);

    // Merge any newly-arrived live leads into state and flash ONLY the ones we haven't seen.
    // liveLeads is cumulative across passes, so we dedup against current rows + removals and
    // only add / flash the genuinely-new ids (older rows never re-flash on later passes).
    const mergedIds = useRef(new Set<string>());
    useEffect(() => {
        if (!liveLeads || liveLeads.length === 0) return;
        const additions = liveLeads.filter((l) => !mergedIds.current.has(l.id) && !removedIds.current.has(l.id));
        if (additions.length === 0) return;
        for (const l of additions) mergedIds.current.add(l.id);

        setAllRows((prev) => {
            const seen = new Set(prev.map((r) => r.id));
            const fresh = additions.filter((l) => !seen.has(l.id));
            if (fresh.length === 0) return prev;
            // Newest leads first so they surface at the top of the list.
            return [...fresh, ...prev];
        });
        setNewIds((prev) => {
            const next = new Set(prev);
            for (const l of additions) {
                next.add(l.id);
                const existing = flashTimers.current.get(l.id);
                if (existing) clearTimeout(existing);
                const t = setTimeout(() => {
                    setNewIds((cur) => {
                        if (!cur.has(l.id)) return cur;
                        const n = new Set(cur);
                        n.delete(l.id);
                        return n;
                    });
                    flashTimers.current.delete(l.id);
                }, 6000);
                flashTimers.current.set(l.id, t);
            }
            return next;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [liveLeads]);

    useEffect(() => {
        const timers = flashTimers.current;
        return () => {
            for (const t of timers.values()) clearTimeout(t);
            timers.clear();
        };
    }, []);

    // Keep an external count (e.g. a card title) in sync with the merged row total.
    useEffect(() => {
        onTotalChange?.(allRows.length);
    }, [allRows.length, onTotalChange]);

    const [query, setQuery] = useState("");
    const [companyFilter, setCompanyFilter] = useState<string>(ALL);
    const [locationFilter, setLocationFilter] = useState<string>(ALL);
    const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
    const [groupMode, setGroupMode] = useState<GroupMode>("none");

    // Build filter option lists from the live data.
    const companyOptions = useMemo(() => {
        const names = Array.from(new Set(allRows.map((r) => r.companyName))).sort((a, b) => a.localeCompare(b));
        return [{ id: ALL, label: "All companies" }, ...names.map((n) => ({ id: n, label: n }))];
    }, [allRows]);

    const locationOptions = useMemo(() => {
        const set = new Set<string>();
        let hasRemote = false;
        for (const r of allRows) {
            if (r.isRemote) hasRemote = true;
            else set.add(locationKey(r));
        }
        const names = Array.from(set).sort((a, b) => a.localeCompare(b));
        return [
            { id: ALL, label: "All locations" },
            ...(hasRemote ? [{ id: REMOTE_KEY, label: "Remote" }] : []),
            ...names.map((n) => ({ id: n, label: n })),
        ];
    }, [allRows]);

    const levelOptions = useMemo(() => {
        const present = Array.from(new Set(allRows.map((r) => r.level)));
        const hasRemote = allRows.some((r) => r.isRemote);
        return [
            { id: "all", label: "All levels" },
            ...(hasRemote ? [{ id: "REMOTE", label: "Remote only" }] : []),
            ...present.map((lvl) => ({ id: lvl, label: JOB_LEVEL_LABELS[lvl] })),
        ];
    }, [allRows]);

    const groupOptions = [
        { id: "none", label: "Group: None" },
        { id: "company", label: "Group: Company" },
        { id: "location", label: "Group: Location" },
    ];

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return allRows.filter((r) => {
            if (companyFilter !== ALL && r.companyName !== companyFilter) return false;
            if (locationFilter === REMOTE_KEY) {
                if (!r.isRemote) return false;
            } else if (locationFilter !== ALL) {
                if (r.isRemote || locationKey(r) !== locationFilter) return false;
            }
            if (levelFilter === "REMOTE") {
                if (!r.isRemote) return false;
            } else if (levelFilter !== "all") {
                if (r.level !== levelFilter) return false;
            }
            if (q && ![r.title, r.companyName, JOB_LEVEL_LABELS[r.level], r.locationText, r.matchReason].some((v) => v?.toLowerCase().includes(q))) {
                return false;
            }
            return true;
        });
    }, [allRows, query, companyFilter, locationFilter, levelFilter]);

    // Group the filtered rows when a group mode is active.
    const groups = useMemo(() => {
        if (groupMode === "none") return null;
        const map = new Map<string, LeadRow[]>();
        for (const r of filtered) {
            const key = groupMode === "company" ? r.companyName : locationKey(r);
            const arr = map.get(key);
            if (arr) arr.push(r);
            else map.set(key, [r]);
        }
        return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    }, [filtered, groupMode]);

    if (allRows.length === 0) {
        return (
            <EmptyState icon={SearchLg} title="Let Claude surface your next role">
                Run a live web search above and tailored, scored job matches near your saved locations will land right here — ready to add in one click.
            </EmptyState>
        );
    }

    const colSpan = showCompany ? 7 : 6;

    return (
        <LeadRowRemovalContext.Provider value={removeRow}>
        <div className="flex flex-col">
            <div className="flex flex-col gap-3 p-4">
                <Input
                    aria-label="Search AI suggestions"
                    icon={SearchLg}
                    size="sm"
                    placeholder="Search suggestions by role, company or location…"
                    value={query}
                    onChange={(value) => setQuery(typeof value === "string" ? value : "")}
                />
                <div className="flex flex-wrap items-center gap-3">
                    <div className="w-44">
                        <Select
                            aria-label="Filter by company"
                            size="sm"
                            icon={LayoutGrid01}
                            selectedKey={companyFilter}
                            onSelectionChange={(k) => setCompanyFilter(String(k))}
                            items={companyOptions}
                        >
                            {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                        </Select>
                    </div>
                    <div className="w-44">
                        <Select
                            aria-label="Filter by location"
                            size="sm"
                            icon={MarkerPin01}
                            selectedKey={locationFilter}
                            onSelectionChange={(k) => setLocationFilter(String(k))}
                            items={locationOptions}
                        >
                            {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                        </Select>
                    </div>
                    <div className="w-44">
                        <Select
                            aria-label="Filter by level"
                            size="sm"
                            icon={Globe01}
                            selectedKey={levelFilter}
                            onSelectionChange={(k) => setLevelFilter(k as LevelFilter)}
                            items={levelOptions}
                        >
                            {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                        </Select>
                    </div>
                    <div className="w-44">
                        <Select
                            aria-label="Group results"
                            size="sm"
                            selectedKey={groupMode}
                            onSelectionChange={(k) => setGroupMode(k as GroupMode)}
                            items={groupOptions}
                        >
                            {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                        </Select>
                    </div>
                </div>
            </div>

            {filtered.length === 0 ? (
                <EmptyState icon={SearchLg} title="No matching suggestions">
                    Nothing matches your filters. Clear them to see every role.
                </EmptyState>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="border-b border-secondary bg-secondary">
                            <tr className="text-left text-xs font-semibold text-quaternary">
                                <th className="px-4 py-3">Role</th>
                                {showCompany && <th className="px-4 py-3">Company</th>}
                                <th className="px-4 py-3">Location</th>
                                <th className="px-4 py-3">Salary</th>
                                <th className="px-4 py-3">Deadline</th>
                                <th className="px-4 py-3">Match</th>
                                <th className="px-4 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        {groups ? (
                            groups.map(([groupName, groupRows]) => (
                                <tbody key={groupName}>
                                    <tr className="border-b border-secondary bg-secondary_subtle">
                                        <td colSpan={colSpan} className="px-4 py-2">
                                            <div className="flex items-center gap-2 text-xs font-semibold text-secondary">
                                                {groupMode === "company" ? (
                                                    <LayoutGrid01 className="size-3.5 text-fg-quaternary" />
                                                ) : (
                                                    <MarkerPin01 className="size-3.5 text-fg-quaternary" />
                                                )}
                                                <span className="truncate">{groupName}</span>
                                                <Badge color="gray" size="sm" type="pill-color">
                                                    {groupRows.length}
                                                </Badge>
                                            </div>
                                        </td>
                                    </tr>
                                    {groupRows.map((r) => (
                                        <RoleRow key={r.id} row={r} showCompany={showCompany} isNew={newIds.has(r.id)} />
                                    ))}
                                </tbody>
                            ))
                        ) : (
                            <tbody>
                                {filtered.map((r) => (
                                    <RoleRow key={r.id} row={r} showCompany={showCompany} isNew={newIds.has(r.id)} />
                                ))}
                            </tbody>
                        )}
                    </table>
                </div>
            )}
        </div>
        </LeadRowRemovalContext.Provider>
    );
}
