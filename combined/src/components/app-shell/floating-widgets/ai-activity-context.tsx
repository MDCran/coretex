"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { listActiveJobSearchRuns, cancelJobSearchRun } from "@/lib/actions/job-search";

/** A single in-flight AI operation surfaced in the activity widget. */
export interface AiActivity {
    id: string;
    label: string;
    /** 0–100. Omitted for indeterminate work. */
    progress?: number;
}

interface AiActivityContextValue {
    /** Manual + auto-detected activities, merged for display. */
    activities: AiActivity[];
    /** Register a new manual operation (returns the id used). */
    begin: (op: AiActivity) => string;
    /** Patch a manual operation in place. */
    update: (id: string, patch: Partial<Omit<AiActivity, "id">>) => void;
    /** Remove a manual operation. */
    end: (id: string) => void;
    /** Halt a job-search run by its activity id (optimistically removes it). */
    haltRun: (activityId: string) => Promise<void>;
}

const AiActivityContext = createContext<AiActivityContextValue | null>(null);

const JOB_PREFIX = "job-search:";
const POLL_MS = 3000;

function readProgressPct(progress: unknown): { passesDone: number; totalPasses: number } | null {
    if (progress && typeof progress === "object") {
        const p = progress as Record<string, unknown>;
        const passesDone = typeof p.passesDone === "number" ? p.passesDone : null;
        const totalPasses = typeof p.totalPasses === "number" ? p.totalPasses : null;
        if (passesDone != null && totalPasses != null && totalPasses > 0) {
            return { passesDone, totalPasses };
        }
    }
    return null;
}

export function AiActivityProvider({ children }: { children: ReactNode }) {
    // Manually-registered operations (e.g. an inline AI generate call).
    const [manual, setManual] = useState<AiActivity[]>([]);
    // Auto-detected from running job-search runs via polling.
    const [jobActivities, setJobActivities] = useState<AiActivity[]>([]);

    const begin = useCallback((op: AiActivity) => {
        setManual((prev) => {
            const next = prev.filter((a) => a.id !== op.id);
            next.push(op);
            return next;
        });
        return op.id;
    }, []);

    const update = useCallback((id: string, patch: Partial<Omit<AiActivity, "id">>) => {
        setManual((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
    }, []);

    const end = useCallback((id: string) => {
        setManual((prev) => prev.filter((a) => a.id !== id));
    }, []);

    // Runs the user has already halted — optimistically excluded from the widget.
    const haltedIds = useRef(new Set<string>());

    const haltRun = useCallback(async (activityId: string) => {
        const runId = activityId.startsWith(JOB_PREFIX) ? activityId.slice(JOB_PREFIX.length) : activityId;
        haltedIds.current.add(runId);
        // Remove immediately from visible list so the widget hides without waiting for the next poll.
        setJobActivities((prev) => prev.filter((a) => a.id !== activityId));
        try {
            await cancelJobSearchRun(runId);
        } catch {
            // Halt failed — remove from optimistic set so it re-appears on the next poll.
            haltedIds.current.delete(runId);
        }
    }, []);

    // Poll for running job searches while mounted.
    const activeRef = useRef(true);
    useEffect(() => {
        activeRef.current = true;
        let timer: ReturnType<typeof setTimeout> | undefined;

        const tick = async () => {
            try {
                const runs = await listActiveJobSearchRuns();
                if (!activeRef.current) return;
                const mapped: AiActivity[] = runs
                    // Skip runs the user already halted (cancelRequested = being stopped) or we optimistically removed.
                    .filter((run) => !run.cancelRequested && !haltedIds.current.has(run.id))
                    .map((run) => {
                        const prog = readProgressPct(run.progress);
                        let label = "Job search";
                        let progress: number | undefined;
                        if (prog) {
                            label = `Job search — ${prog.passesDone}/${prog.totalPasses} passes`;
                            progress = Math.min(100, Math.round((prog.passesDone / prog.totalPasses) * 100));
                        } else if (run.targetCount > 0) {
                            label = `Job search — ${run.foundCount}/${run.targetCount} roles`;
                            progress = Math.min(100, Math.round((run.foundCount / run.targetCount) * 100));
                        }
                        return { id: `${JOB_PREFIX}${run.id}`, label, progress };
                    });
                setJobActivities(mapped);
            } catch {
                // Auth / network hiccups should never break the UI; just retry next tick.
                if (activeRef.current) setJobActivities([]);
            } finally {
                if (activeRef.current) timer = setTimeout(tick, POLL_MS);
            }
        };

        void tick();

        return () => {
            activeRef.current = false;
            if (timer) clearTimeout(timer);
        };
    }, []);

    const value = useMemo<AiActivityContextValue>(() => {
        // Manual ops first, then auto-detected job searches.
        const activities = [...manual, ...jobActivities];
        return { activities, begin, update, end, haltRun };
    }, [manual, jobActivities, begin, update, end, haltRun]);

    return <AiActivityContext.Provider value={value}>{children}</AiActivityContext.Provider>;
}

export function useAiActivity() {
    const ctx = useContext(AiActivityContext);
    if (!ctx) throw new Error("useAiActivity must be used within AiActivityProvider");
    return ctx;
}
