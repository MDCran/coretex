"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Coins01, SearchLg, Stars02 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Badge } from "@/components/base/badges/badges";
import { analyzeSkillsGap, benchmarkSalary, type SalaryBenchmark, type SkillsGapResult } from "@/lib/actions/career-ai";

export function SkillsGapPanel({ enabled }: { enabled: boolean }) {
    const [pending, start] = useTransition();
    const [result, setResult] = useState<SkillsGapResult | null>(null);

    return (
        <div className="flex flex-col gap-3">
            <Button
                color="primary"
                size="sm"
                iconLeading={Stars02}
                isLoading={pending}
                showTextWhileLoading
                isDisabled={pending || !enabled}
                onClick={() =>
                    start(async () => {
                        try {
                            setResult(await analyzeSkillsGap());
                        } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Analysis failed.");
                        }
                    })
                }
            >
                {result ? "Re-run analysis" : "Analyze skills gap"}
            </Button>
            {!enabled && <p className="text-xs text-tertiary">Archive a few job descriptions (paste JDs into applications) to enable this.</p>}

            {result && (
                <div className="flex flex-col gap-3">
                    <p className="text-xs text-tertiary">Across {result.jdsAnalyzed} saved job descriptions.</p>
                    {result.missing.length > 0 && (
                        <div>
                            <div className="mb-1 text-xs font-semibold text-quaternary uppercase">Gaps to close</div>
                            <div className="flex flex-col gap-1.5">
                                {result.missing.map((m) => (
                                    <div key={m.skill} className="flex items-start gap-2 text-sm">
                                        <Badge color={m.importance === "high" ? "error" : m.importance === "medium" ? "warning" : "gray"} size="sm" type="pill-color">
                                            {m.skill}
                                        </Badge>
                                        <span className="text-tertiary">{m.note}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    {result.strong.length > 0 && (
                        <div>
                            <div className="mb-1 text-xs font-semibold text-quaternary uppercase">Strengths</div>
                            <div className="flex flex-wrap gap-1">
                                {result.strong.map((s) => (
                                    <Badge key={s} color="success" size="sm" type="pill-color">
                                        {s}
                                    </Badge>
                                ))}
                            </div>
                        </div>
                    )}
                    {result.recommendations.length > 0 && (
                        <ul className="flex list-disc flex-col gap-1 pl-4 text-sm text-secondary">
                            {result.recommendations.map((r, i) => (
                                <li key={i}>{r}</li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}

function money(n: number | null, currency: string) {
    if (n == null) return "—";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD", maximumFractionDigits: 0 }).format(n);
}

export function SalaryBenchmarkPanel({ enabled, defaultRole = "", defaultLocation = "" }: { enabled: boolean; defaultRole?: string; defaultLocation?: string }) {
    const [pending, start] = useTransition();
    const [role, setRole] = useState(defaultRole);
    const [location, setLocation] = useState(defaultLocation);
    const [result, setResult] = useState<SalaryBenchmark | null>(null);

    return (
        <div className="flex flex-col gap-3">
            <div className="grid gap-2 sm:grid-cols-2">
                <Input aria-label="Role" size="sm" value={role} onChange={(v) => setRole(typeof v === "string" ? v : "")} placeholder="Role (e.g. Software Engineer)" />
                <Input aria-label="Location" size="sm" value={location} onChange={(v) => setLocation(typeof v === "string" ? v : "")} placeholder="Location (e.g. San Francisco)" />
            </div>
            <Button
                color="primary"
                size="sm"
                iconLeading={SearchLg}
                isLoading={pending}
                showTextWhileLoading
                isDisabled={pending || !enabled || !role.trim()}
                onClick={() =>
                    start(async () => {
                        try {
                            setResult(await benchmarkSalary(role, location));
                        } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Benchmark failed.");
                        }
                    })
                }
            >
                Benchmark salary (live)
            </Button>
            {!enabled && <p className="text-xs text-tertiary">Set ANTHROPIC_API_KEY to enable live benchmarking.</p>}

            {result && (
                <div className="rounded-lg bg-secondary p-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-primary">
                        <Coins01 className="size-4 text-fg-quaternary" />
                        {result.role}
                        <span className="text-tertiary">· {result.location}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-3 text-center">
                        <div>
                            <div className="text-xs text-tertiary">Low</div>
                            <div className="text-sm font-semibold text-primary tabular-nums">{money(result.low, result.currency)}</div>
                        </div>
                        <div>
                            <div className="text-xs text-tertiary">Median</div>
                            <div className="text-md font-bold text-brand-secondary tabular-nums">{money(result.median, result.currency)}</div>
                        </div>
                        <div>
                            <div className="text-xs text-tertiary">High</div>
                            <div className="text-sm font-semibold text-primary tabular-nums">{money(result.high, result.currency)}</div>
                        </div>
                    </div>
                    {result.notes && <p className="mt-2 text-xs text-tertiary">{result.notes}</p>}
                </div>
            )}
        </div>
    );
}
