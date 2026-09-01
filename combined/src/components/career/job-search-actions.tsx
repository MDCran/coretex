"use client";

import { useCallback, useContext, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Building07, Check, Coins01, CpuChip01, Hourglass03, Plus, RefreshCw02, SearchLg, StopCircle, Trash01, X } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Badge } from "@/components/base/badges/badges";
import { LeadRowRemovalContext, type LeadRow } from "@/components/career/suggested-roles-table";
import {
    addLeadToApplications,
    addSuggestedCompany,
    cancelJobSearchRun,
    dismissLead,
    dismissSuggestedCompany,
    estimateJobSearch,
    generateLeads,
    generateLeadsForExistingCompanies,
    regenerateCompanyLeads,
    runNextPass,
    startJobSearchRun,
    type InsertedLead,
    type JobSearchEstimate,
} from "@/lib/actions/job-search";

/** Run the global web search and report how many roles came back. */
export function GenerateLeadsButton({ disabled, label = "Run job search" }: { disabled?: boolean; label?: string }) {
    const [pending, start] = useTransition();
    return (
        <Button
            color="primary"
            isLoading={pending}
            showTextWhileLoading
            isDisabled={disabled}
            iconLeading={<SearchLg data-icon className="size-4" />}
            onClick={() =>
                start(async () => {
                    try {
                        const { found, searches } = await generateLeads();
                        toast.success(found ? `Found ${found} role${found === 1 ? "" : "s"} across ${searches} search${searches === 1 ? "" : "es"}.` : "No new roles found this time.");
                    } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Search failed.");
                    }
                })
            }
        >
            {pending ? "Searching the web…" : label}
        </Button>
    );
}

/** Search all tracked companies for current openings around the saved locations / remote. */
export function GenerateExistingCompaniesButton({ disabled, companyCount }: { disabled?: boolean; companyCount: number }) {
    const [pending, start] = useTransition();
    const noCompanies = companyCount === 0;
    return (
        <Button
            color="secondary"
            isLoading={pending}
            showTextWhileLoading
            isDisabled={disabled || noCompanies}
            iconLeading={<Building07 data-icon className="size-4" />}
            onClick={() =>
                start(async () => {
                    try {
                        const { found, companies } = await generateLeadsForExistingCompanies();
                        toast.success(
                            found
                                ? `Found ${found} role${found === 1 ? "" : "s"} across ${companies} of your compan${companies === 1 ? "y" : "ies"}.`
                                : "No current openings found at your companies.",
                        );
                    } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Search failed.");
                    }
                })
            }
        >
            {pending ? "Searching your companies…" : "Find roles at my companies"}
        </Button>
    );
}

/** Map a freshly-inserted lead (from a run pass) into the table's row shape. */
function insertedToRow(l: InsertedLead): LeadRow {
    return {
        id: l.id,
        title: l.title,
        level: l.level,
        companyId: null,
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

interface RunState {
    running: boolean;
    runId: string | null;
    passesDone: number;
    totalPasses: number;
    found: number;
    cost: number;
    tokens: number;
    etaSeconds: number;
}

const IDLE: RunState = { running: false, runId: null, passesDone: 0, totalPasses: 0, found: 0, cost: 0, tokens: 0, etaSeconds: 0 };

/**
 * The live "Run job search" experience: estimate preview, target/budget inputs, a primary
 * run button that loops runNextPass sequentially (appending each pass's new leads into the
 * live table via onLeads), a progress bar + running counters/ETA, and a prominent Halt.
 */
export function JobSearchRunControls({ disabled, onLeads }: { disabled?: boolean; onLeads: (rows: LeadRow[]) => void }) {
    const [estimate, setEstimate] = useState<JobSearchEstimate | null>(null);
    const [estimating, setEstimating] = useState(false);
    const [run, setRun] = useState<RunState>(IDLE);
    const [targetInput, setTargetInput] = useState("");
    const [budgetInput, setBudgetInput] = useState("");

    // Mutable refs the loop / halt read directly (avoids stale closures on state).
    const haltRef = useRef(false);
    const startTimeRef = useRef(0);
    const runIdRef = useRef<string | null>(null);

    // Fetch a cheap, AI-free estimate on mount so the cost is visible before running.
    useEffect(() => {
        if (disabled) return;
        let cancelled = false;
        setEstimating(true);
        estimateJobSearch()
            .then((est) => {
                if (!cancelled) setEstimate(est);
            })
            .catch(() => {
                /* estimate is best-effort; the run still surfaces real errors */
            })
            .finally(() => {
                if (!cancelled) setEstimating(false);
            });
        return () => {
            cancelled = true;
        };
    }, [disabled]);

    const targetCap = (() => {
        const n = parseInt(targetInput.replace(/[^0-9]/g, ""), 10);
        return Number.isFinite(n) && n > 0 ? n : null;
    })();
    const budgetCap = (() => {
        const n = parseFloat(budgetInput.replace(/[^0-9.]/g, ""));
        return Number.isFinite(n) && n > 0 ? n : null;
    })();

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
        setRun((prev) => ({ ...prev, running: false }));
        toast.message("Halting job search…", { description: "No further searches will run." });
    }, []);

    const start = useCallback(async () => {
        haltRef.current = false;
        startTimeRef.current = Date.now();
        try {
            const { runId, totalPasses } = await startJobSearchRun();
            runIdRef.current = runId;
            setRun({ running: true, runId, passesDone: 0, totalPasses, found: 0, cost: 0, tokens: 0, etaSeconds: 0 });

            let passesDone = 0;
            let found = 0;
            for (let i = 0; i < totalPasses; i++) {
                if (haltRef.current) break;
                if (targetCap != null && found >= targetCap) break;

                const result = await runNextPass(runId);

                if (result.error) {
                    // Fatal errors (AI off / budget / auth) stop the run; a single failed pass is
                    // skipped server-side, so we surface it but keep going through the rest.
                    toast.error(result.fatal ? result.error : `A search pass failed (${result.error}) — continuing.`);
                    if (result.fatal) break;
                }

                if (result.newLeads.length > 0) {
                    onLeads(result.newLeads.map(insertedToRow));
                }

                passesDone = result.passesDone;
                found = result.totalFound;

                // ETA: average elapsed per completed pass × remaining passes.
                const elapsed = (Date.now() - startTimeRef.current) / 1000;
                const avgPerPass = passesDone > 0 ? elapsed / passesDone : 0;
                const remaining = Math.max(0, result.totalPasses - passesDone);
                const etaSeconds = avgPerPass * remaining;

                setRun({
                    running: !(result.done || result.cancelled || result.budgetExceeded),
                    runId,
                    passesDone,
                    totalPasses: result.totalPasses,
                    found,
                    cost: result.costSoFar,
                    tokens: result.totalTokens,
                    etaSeconds,
                });

                if (result.cancelled) {
                    toast.message("Job search halted.", { description: `${found} role${found === 1 ? "" : "s"} found · spent ${fmtCost(result.costSoFar)}.` });
                    break;
                }
                if (result.budgetExceeded) {
                    toast.warning("Budget reached — search stopped.", { description: `${found} role${found === 1 ? "" : "s"} found · spent ${fmtCost(result.costSoFar)}.` });
                    break;
                }
                if (budgetCap != null && result.costSoFar >= budgetCap) {
                    setRun((prev) => ({ ...prev, running: false }));
                    await halt();
                    break;
                }
                if (result.done) {
                    toast.success(
                        `${found ? `Found ${found} role${found === 1 ? "" : "s"}` : "No new roles found this time"} · spent ${fmtCost(result.costSoFar)}.`,
                    );
                    break;
                }
            }
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Search failed.");
        } finally {
            haltRef.current = false;
            runIdRef.current = null;
            setRun((prev) => ({ ...prev, running: false }));
        }
    }, [budgetCap, halt, onLeads, targetCap]);

    const pct = run.totalPasses > 0 ? Math.round((run.passesDone / run.totalPasses) * 100) : 0;

    // Reactive estimate: derive from whichever field the user filled.
    // - Target roles → estimated cost for that many.
    // - Max budget → estimated roles that budget buys.
    // - Neither → the base per-profile estimate.
    const costPerResult = estimate && estimate.estimatedResults > 0 ? estimate.estimatedCostUsd / estimate.estimatedResults : null;
    const derivedEstimate = (() => {
        if (!estimate) return null;
        if (targetCap != null && costPerResult != null) {
            return { results: targetCap, cost: targetCap * costPerResult, note: `for ${targetCap} target role${targetCap === 1 ? "" : "s"}` };
        }
        if (budgetCap != null && costPerResult != null) {
            const results = Math.max(1, Math.floor(budgetCap / costPerResult));
            return { results, cost: budgetCap, note: `within a ${fmtCost(budgetCap)} budget` };
        }
        return { results: estimate.estimatedResults, cost: estimate.estimatedCostUsd, note: `across ${estimate.passes} pass${estimate.passes === 1 ? "" : "es"}` };
    })();

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-3">
                <div className="w-36">
                    <Input
                        size="sm"
                        label="Target roles"
                        placeholder={estimate ? String(estimate.estimatedResults) : "Auto"}
                        value={targetInput}
                        isDisabled={run.running || disabled}
                        onChange={(v) => setTargetInput(typeof v === "string" ? v : "")}
                        inputMode="numeric"
                    />
                </div>
                <div className="w-36">
                    <Input
                        size="sm"
                        label="Max budget ($)"
                        placeholder={estimate ? estimate.estimatedCostUsd.toFixed(2) : "Auto"}
                        value={budgetInput}
                        isDisabled={run.running || disabled}
                        onChange={(v) => setBudgetInput(typeof v === "string" ? v : "")}
                        inputMode="decimal"
                    />
                </div>

                {run.running ? (
                    <Button
                        color="primary-destructive"
                        iconLeading={<StopCircle data-icon className="size-4" />}
                        onClick={halt}
                    >
                        Halt
                    </Button>
                ) : (
                    <Button
                        color="primary"
                        isDisabled={disabled}
                        iconLeading={<SearchLg data-icon className="size-4" />}
                        onClick={start}
                    >
                        Run job search
                    </Button>
                )}
            </div>

            {/* Estimate preview — reactive to whichever of Target / Budget you enter. */}
            {!run.running && (
                <p className="text-xs text-tertiary">
                    {estimating
                        ? "Estimating…"
                        : derivedEstimate
                          ? `~${derivedEstimate.results} role${derivedEstimate.results === 1 ? "" : "s"} · est. ${fmtCost(derivedEstimate.cost)} ${derivedEstimate.note}`
                          : "Set a target or budget to preview the estimate."}
                </p>
            )}

            {/* Live progress while running (and the final summary right after). */}
            {(run.running || run.passesDone > 0) && (
                <div className="flex flex-col gap-2 rounded-lg bg-secondary p-3 ring-1 ring-secondary ring-inset">
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-xs font-medium text-secondary">
                            Pass {run.passesDone} / {run.totalPasses} · {pct}%
                        </span>
                        <div className="flex items-center gap-3 text-xs text-tertiary">
                            <span className="inline-flex items-center gap-1">
                                <Badge color="brand" size="sm" type="pill-color">
                                    {run.found}
                                </Badge>
                                found
                            </span>
                            <span className="inline-flex items-center gap-1">
                                <Coins01 className="size-3.5 text-fg-quaternary" aria-hidden="true" />
                                {run.running ? "spent" : "Spent"} {fmtCost(run.cost)}
                            </span>
                            <span className="inline-flex items-center gap-1">
                                <CpuChip01 className="size-3.5 text-fg-quaternary" aria-hidden="true" />
                                {run.tokens.toLocaleString()} tokens
                            </span>
                            {run.running && (
                                <span className="inline-flex items-center gap-1">
                                    <Hourglass03 className="size-3.5 text-fg-quaternary" aria-hidden="true" />
                                    {fmtEta(run.etaSeconds)}
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
    );
}

/** Re-run the search scoped to a single tracked company (company page). */
export function RegenerateCompanyButton({ companyId }: { companyId: string }) {
    const [pending, start] = useTransition();
    return (
        <Button
            color="secondary"
            size="sm"
            isLoading={pending}
            showTextWhileLoading
            iconLeading={<RefreshCw02 data-icon className="size-4" />}
            onClick={() =>
                start(async () => {
                    try {
                        const fd = new FormData();
                        fd.set("companyId", companyId);
                        const { found } = await regenerateCompanyLeads(fd);
                        toast.success(found ? `Found ${found} opening${found === 1 ? "" : "s"}.` : "No current openings found.");
                    } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Search failed.");
                    }
                })
            }
        >
            {pending ? "Searching…" : "Regenerate"}
        </Button>
    );
}

function useAction(action: (fd: FormData) => Promise<void>, id: string, okMsg: string, onSuccess?: () => void) {
    const [pending, start] = useTransition();
    const run = () =>
        start(async () => {
            try {
                const fd = new FormData();
                fd.set("id", id);
                await action(fd);
                toast.success(okMsg);
                onSuccess?.();
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Something went wrong.");
            }
        });
    return { pending, run };
}

/** Add-to-applications + dismiss for a single AI role suggestion. */
export function LeadButtons({ id }: { id: string }) {
    // When rendered inside the live table, drop the row immediately on a successful action;
    // the server revalidation then confirms it. Outside the table this is a harmless no-op.
    const removeRow = useContext(LeadRowRemovalContext);
    const onDone = useCallback(() => removeRow(id), [removeRow, id]);
    const add = useAction(addLeadToApplications, id, "Added to your applications.", onDone);
    const skip = useAction(dismissLead, id, "Suggestion removed.", onDone);
    return (
        <div className="flex items-center justify-end gap-2">
            <Button color="secondary" size="sm" isLoading={add.pending} showTextWhileLoading iconLeading={<Plus data-icon className="size-4" />} onClick={add.run}>
                Add
            </Button>
            <Button color="tertiary" size="sm" isDisabled={skip.pending} iconLeading={<X data-icon className="size-4" />} aria-label="Dismiss" onClick={skip.run} />
        </div>
    );
}

/** Add-to-companies + dismiss for a single AI company suggestion. */
export function CompanySuggestionButtons({ id }: { id: string }) {
    const add = useAction(addSuggestedCompany, id, "Company added to your list.");
    const skip = useAction(dismissSuggestedCompany, id, "Company suggestion removed.");
    return (
        <div className="flex items-center gap-2">
            <Button color="secondary" size="sm" isLoading={add.pending} showTextWhileLoading iconLeading={<Check data-icon className="size-4" />} onClick={add.run}>
                Add company
            </Button>
            <Button color="tertiary-destructive" size="sm" isDisabled={skip.pending} iconLeading={<Trash01 data-icon className="size-4" />} aria-label="Dismiss company" onClick={skip.run} />
        </div>
    );
}
