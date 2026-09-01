"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { Coins01, CpuChip01, Hourglass03, SearchLg, StopCircle } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Badge } from "@/components/base/badges/badges";
import { SuggestedRolesTable, type LeadRow } from "@/components/career/suggested-roles-table";
import {
    cancelJobSearchRun,
    runNextPass,
    startCompanyJobScan,
    type InsertedLead,
} from "@/lib/actions/job-search";

/** Map a freshly-inserted lead (from a scan pass) into the table's row shape. */
function insertedToRow(l: InsertedLead, companyId: string): LeadRow {
    return {
        id: l.id,
        title: l.title,
        level: l.level,
        // The scan force-attaches every lead to THIS company, so wire the id through
        // for the company link + Add → applications routing.
        companyId,
        companyName: l.companyName,
        companyDomain: l.companyDomain,
        applicationUrl: l.applicationUrl,
        salaryMin: l.salaryMin,
        salaryMax: l.salaryMax,
        salaryCurrency: l.salaryCurrency,
        deadline: null,
        locationText: l.locationText,
        isRemote: l.isRemote,
        nearestLabel: null,
        distanceMiles: null,
        matchScore: l.matchScore,
        matchReason: l.matchReason,
    };
}

function fmtCost(usd: number): string {
    if (!Number.isFinite(usd)) return "$0.00";
    if (usd > 0 && usd < 0.01) return "<$0.01";
    return `$${usd.toFixed(2)}`;
}

function fmtEta(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds <= 0) return "—";
    if (seconds < 60) return `~${Math.round(seconds)}s`;
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return s ? `~${m}m ${s}s` : `~${m}m`;
}

interface ScanState {
    running: boolean;
    runId: string | null;
    passesDone: number;
    totalPasses: number;
    found: number;
    cost: number;
    tokens: number;
    etaSeconds: number;
}

const IDLE: ScanState = { running: false, runId: null, passesDone: 0, totalPasses: 0, found: 0, cost: 0, tokens: 0, etaSeconds: 0 };

interface CompanyJobScanProps {
    companyId: string;
    companyName: string;
    /** Server-rendered NEW leads already attached to this company. */
    initialLeads: LeadRow[];
    /** True when AI is unavailable (key missing or turned off in Settings). */
    disabled?: boolean;
}

/**
 * Per-company "Scan for jobs with AI" panel. Mirrors JobSearchRunControls' client-driven
 * run loop, but scoped to ONE company: startCompanyJobScan(companyId) then runNextPass(runId)
 * until done/cancelled/budget/fatal. Each pass's new leads stream into a live, separate
 * suggested-roles table seeded with the company's existing NEW leads. The engine dedupes
 * across leads/applications/backups; we also guard the UI list by id.
 */
export function CompanyJobScan({ companyId, companyName, initialLeads, disabled }: CompanyJobScanProps) {
    const [scan, setScan] = useState<ScanState>(IDLE);
    // Leads streamed in live by the loop (cumulative); the table merges + flashes them.
    const [liveLeads, setLiveLeads] = useState<LeadRow[]>([]);
    const [count, setCount] = useState(initialLeads.length);

    // Mutable refs the loop / halt read directly (avoids stale closures on state).
    const haltRef = useRef(false);
    const startTimeRef = useRef(0);
    const runIdRef = useRef<string | null>(null);
    // Guard against ever queuing the same id twice into the live list.
    const seenIds = useRef(new Set<string>(initialLeads.map((l) => l.id)));

    const appendLeads = useCallback((rows: LeadRow[]) => {
        const fresh = rows.filter((r) => !seenIds.current.has(r.id));
        if (fresh.length === 0) return;
        for (const r of fresh) seenIds.current.add(r.id);
        setLiveLeads((prev) => [...prev, ...fresh]);
    }, []);

    const halt = useCallback(async () => {
        haltRef.current = true;
        const id = runIdRef.current;
        if (id) {
            try {
                await cancelJobSearchRun(id);
            } catch {
                /* halt is best-effort; the loop also stops via haltRef */
            }
        }
        setScan((prev) => ({ ...prev, running: false }));
        toast.message(`Halting scan of ${companyName}…`, { description: "No further searches will run." });
    }, [companyName]);

    const start = useCallback(async () => {
        haltRef.current = false;
        startTimeRef.current = Date.now();
        try {
            const { runId, totalPasses } = await startCompanyJobScan(companyId);
            runIdRef.current = runId;
            setScan({ running: true, runId, passesDone: 0, totalPasses, found: 0, cost: 0, tokens: 0, etaSeconds: 0 });

            let passesDone = 0;
            let found = 0;
            for (let i = 0; i < totalPasses; i++) {
                if (haltRef.current) break;

                const result = await runNextPass(runId);

                if (result.error) {
                    // Fatal errors (AI off / budget / auth) stop the scan; a single failed pass is
                    // skipped server-side, so we surface it but keep going through the rest.
                    toast.error(result.fatal ? result.error : `A search pass failed (${result.error}) — continuing.`);
                    if (result.fatal) break;
                }

                if (result.newLeads.length > 0) {
                    appendLeads(result.newLeads.map((l) => insertedToRow(l, companyId)));
                }

                passesDone = result.passesDone;
                found = result.totalFound;

                // ETA: average elapsed per completed pass × remaining passes.
                const elapsed = (Date.now() - startTimeRef.current) / 1000;
                const avgPerPass = passesDone > 0 ? elapsed / passesDone : 0;
                const remaining = Math.max(0, result.totalPasses - passesDone);

                setScan({
                    running: !(result.done || result.cancelled || result.budgetExceeded),
                    runId,
                    passesDone,
                    totalPasses: result.totalPasses,
                    found,
                    cost: result.costSoFar,
                    tokens: result.totalTokens,
                    etaSeconds: avgPerPass * remaining,
                });

                if (result.cancelled) {
                    toast.message(`Scan of ${companyName} halted.`, {
                        description: `${found} role${found === 1 ? "" : "s"} found · spent ${fmtCost(result.costSoFar)}.`,
                    });
                    break;
                }
                if (result.budgetExceeded) {
                    toast.warning("Budget reached — scan stopped.", {
                        description: `${found} role${found === 1 ? "" : "s"} found at ${companyName} · spent ${fmtCost(result.costSoFar)}.`,
                    });
                    break;
                }
                if (result.done) {
                    const roles = found ? `Found ${found} role${found === 1 ? "" : "s"} at ${companyName}` : `No new roles found at ${companyName}`;
                    const tokens = result.totalTokens > 0 ? ` · ${result.totalTokens.toLocaleString()} tokens` : "";
                    toast.success(`${roles} · spent ${fmtCost(result.costSoFar)}${tokens}.`);
                    break;
                }
            }
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Scan failed.");
        } finally {
            haltRef.current = false;
            runIdRef.current = null;
            setScan((prev) => ({ ...prev, running: false }));
        }
    }, [appendLeads, companyId, companyName]);

    const pct = scan.totalPasses > 0 ? Math.round((scan.passesDone / scan.totalPasses) * 100) : 0;

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-3">
                    {scan.running ? (
                        <Button color="primary-destructive" iconLeading={<StopCircle data-icon className="size-4" />} onClick={halt}>
                            Halt
                        </Button>
                    ) : (
                        <Button color="primary" isDisabled={disabled} iconLeading={<SearchLg data-icon className="size-4" />} onClick={start}>
                            Scan {companyName} for jobs
                        </Button>
                    )}
                    {!scan.running && scan.passesDone === 0 && (
                        <p className="text-xs text-tertiary">Claude searches the live web for current openings at {companyName} near your saved locations.</p>
                    )}
                </div>

                {/* Live readout while scanning (and the final summary right after). */}
                {(scan.running || scan.passesDone > 0) && (
                    <div className="flex flex-col gap-2 rounded-lg bg-secondary p-3 ring-1 ring-secondary ring-inset">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <span className="text-xs font-medium text-secondary">
                                Pass {scan.passesDone} / {scan.totalPasses} · {pct}%
                            </span>
                            <div className="flex flex-wrap items-center gap-3 text-xs text-tertiary">
                                <span className="inline-flex items-center gap-1">
                                    <Badge color="brand" size="sm" type="pill-color">
                                        {scan.found}
                                    </Badge>
                                    found
                                </span>
                                <span className="inline-flex items-center gap-1">
                                    <Coins01 className="size-3.5 text-fg-quaternary" aria-hidden="true" />
                                    {scan.running ? "spent" : "Spent"} {fmtCost(scan.cost)}
                                </span>
                                <span className="inline-flex items-center gap-1">
                                    <CpuChip01 className="size-3.5 text-fg-quaternary" aria-hidden="true" />
                                    {scan.tokens.toLocaleString()} tokens
                                </span>
                                {scan.running && (
                                    <span className="inline-flex items-center gap-1">
                                        <Hourglass03 className="size-3.5 text-fg-quaternary" aria-hidden="true" />
                                        {fmtEta(scan.etaSeconds)}
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-quaternary">
                            <div
                                className="h-full rounded-full bg-brand-solid transition-[width] duration-300 ease-out motion-reduce:transition-none"
                                style={{ width: `${pct}%` }}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* The company's AI-suggested roles: separate, live table seeded with existing NEW leads. */}
            <div className="overflow-hidden rounded-lg ring-1 ring-secondary ring-inset">
                <div className="flex items-center justify-between gap-3 border-b border-secondary bg-secondary px-4 py-2.5">
                    <span className="text-xs font-semibold text-secondary">Suggested roles ({count})</span>
                </div>
                <SuggestedRolesTable rows={initialLeads} liveLeads={liveLeads} showCompany={false} onTotalChange={setCount} />
            </div>
        </div>
    );
}
