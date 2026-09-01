// @ts-nocheck


import { Card, EmptyState, Field, NativeInput, NativeSelect, NativeTextarea } from "./financial-ui";
import { DeltaBadge } from "./delta-badge";
import { TrendChart, type TrendPoint } from "./trend-chart";
import { FormModal } from "./form-modal";
import { Badge } from "@/components/base/badges/badges";
import FormDateInput from "@/components/base/input/form-date-input";
import { useRouter } from "@react-aria/utils";
import { Plus, Edit01, Trash02, Speedometer03 } from "@untitledui/icons";
import { useMemo, useState } from "react";
import { Button } from "react-aria-components";
import { toast } from "sonner";

const BUREAU_LABELS: Record<string, string> = { EQUIFAX: "Equifax", EXPERIAN: "Experian", TRANSUNION: "TransUnion" };

export interface CreditScoreEntry {
    id: string;
    label: string;
    value: number;
    scoreDate: string; // YYYY-MM-DD
    bureau: "EQUIFAX" | "EXPERIAN" | "TRANSUNION" | null;
    notes: string | null;
}

function creditDelta(entry: CreditScoreEntry, all: CreditScoreEntry[]): number | null {
    const prior = all
        .filter((e) => e.bureau === entry.bureau && e.scoreDate < entry.scoreDate)
        .sort((a, b) => b.scoreDate.localeCompare(a.scoreDate))[0];
    if (!prior) return null;
    return entry.value - prior.value;
}

/** Latest-vs-previous delta for a bureau key (a real bureau, or null = unspecified). */
function latestBureauDelta(bureau: CreditScoreEntry["bureau"], all: CreditScoreEntry[]): number | null {
    const rows = all.filter((e) => e.bureau === bureau).sort((a, b) => b.scoreDate.localeCompare(a.scoreDate));
    if (rows.length < 2) return null;
    return rows[0].value - rows[1].value;
}

function scoreBand(score: number): string {
    if (score >= 800) return "Exceptional";
    if (score >= 740) return "Very good";
    if (score >= 670) return "Good";
    if (score >= 580) return "Fair";
    return "Needs work";
}

/**
 * Shared credit-scores section. Rendered both inside the /financial Overview and
 * on the dedicated /financial/credit page so the two stay identical.
 */
export function CreditSection({ scores }: { scores: CreditScoreEntry[] }) {
    const router = useRouter();
    const sortedScores = useMemo(
        () => [...scores].sort((a, b) => a.scoreDate.localeCompare(b.scoreDate) || a.id.localeCompare(b.id)),
        [scores],
    );

    // Latest entry keyed by bureau (and an "UNSPECIFIED" bucket for null-bureau entries).
    const latestPerBureau = useMemo(() => {
        const byBureau: Record<string, CreditScoreEntry> = {};
        for (const s of sortedScores) {
            const key = s.bureau ?? "UNSPECIFIED";
            byBureau[key] = s; // entries are asc by date → last wins
        }
        return byBureau;
    }, [sortedScores]);

    const hasUnspecified = "UNSPECIFIED" in latestPerBureau;

    // Pivot credit scores by date — one row per date, columns per bureau.
    const creditChartData = useMemo(() => {
        const byDate = new Map<string, TrendPoint>();
        for (const s of sortedScores) {
            const key = s.scoreDate;
            const row = byDate.get(key) ?? { label: formatDateOnly(s.scoreDate) };
            if (s.bureau === "EQUIFAX") row.equifax = s.value;
            else if (s.bureau === "EXPERIAN") row.experian = s.value;
            else if (s.bureau === "TRANSUNION") row.transunion = s.value;
            else if (!s.bureau) row.unspecified = s.value;
            byDate.set(key, row);
        }
        return [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, row]) => row);
    }, [sortedScores]);

    const creditTableRows = useMemo(
        () => [...sortedScores].sort((a, b) => b.scoreDate.localeCompare(a.scoreDate) || b.id.localeCompare(a.id)),
        [sortedScores],
    );
    const latestOverall = sortedScores.at(-1) ?? null;
    const highScore = sortedScores.length ? sortedScores.reduce((best, s) => (s.value > best.value ? s : best), sortedScores[0]) : null;
    const lowScore = sortedScores.length ? sortedScores.reduce((low, s) => (s.value < low.value ? s : low), sortedScores[0]) : null;

    // One series per bureau, but only those that actually have data — drives both
    // the chart and its legend so the lines are identifiable.
    const creditSeries = useMemo(() => {
        const defs = [
            { key: "equifax", name: "Equifax", color: "var(--color-utility-blue-500)" },
            { key: "experian", name: "Experian", color: "var(--color-utility-emerald-500)" },
            { key: "transunion", name: "TransUnion", color: "var(--color-utility-orange-500)" },
            { key: "unspecified", name: "Unspecified", color: "var(--color-brand-500)" },
        ];
        return defs.filter((d) => creditChartData.some((p) => p[d.key] != null));
    }, [creditChartData]);

    const [creditOpen, setCreditOpen] = useState(false);
    const [creditEditing, setCreditEditing] = useState<CreditScoreEntry | null>(null);

    // Per-bureau tiles: the three real bureaus, plus an "Unspecified" tile when
    // there are null-bureau entries so a score logged without a bureau is visible.
    const tiles: { key: string; label: string; bureau: CreditScoreEntry["bureau"] }[] = [
        { key: "EQUIFAX", label: BUREAU_LABELS.EQUIFAX, bureau: "EQUIFAX" },
        { key: "EXPERIAN", label: BUREAU_LABELS.EXPERIAN, bureau: "EXPERIAN" },
        { key: "TRANSUNION", label: BUREAU_LABELS.TRANSUNION, bureau: "TRANSUNION" },
        ...(hasUnspecified ? [{ key: "UNSPECIFIED", label: "Overall / Unspecified", bureau: null }] : []),
    ];

    return (
        <Card className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="text-md font-semibold text-primary">Credit scores</h3>
                <Button
                    size="sm"
                    iconLeading={Plus}
                    className="w-full sm:w-auto"
                    onClick={() => {
                        setCreditEditing(null);
                        setCreditOpen(true);
                    }}
                >
                    Log score
                </Button>
            </div>

            {latestOverall && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="rounded-xl bg-secondary p-4">
                        <p className="text-xs font-semibold tracking-wide text-tertiary uppercase">Latest</p>
                        <p className="mt-1 text-display-xs font-semibold text-primary">{latestOverall.value}</p>
                        <p className="text-xs text-tertiary">
                            {scoreBand(latestOverall.value)} - {formatDateOnly(latestOverall.scoreDate)}
                        </p>
                    </div>
                    <div className="rounded-xl bg-secondary p-4">
                        <p className="text-xs font-semibold tracking-wide text-tertiary uppercase">Highest</p>
                        <p className="mt-1 text-display-xs font-semibold text-primary">{highScore?.value ?? "-"}</p>
                        <p className="text-xs text-tertiary">{highScore ? formatDateOnly(highScore.scoreDate) : "-"}</p>
                    </div>
                    <div className="rounded-xl bg-secondary p-4">
                        <p className="text-xs font-semibold tracking-wide text-tertiary uppercase">Lowest</p>
                        <p className="mt-1 text-display-xs font-semibold text-primary">{lowScore?.value ?? "-"}</p>
                        <p className="text-xs text-tertiary">{lowScore ? formatDateOnly(lowScore.scoreDate) : "-"}</p>
                    </div>
                </div>
            )}

            {/* Latest per bureau (+ an Unspecified tile when null-bureau scores exist) */}
            <div className={hasUnspecified ? "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" : "grid grid-cols-1 gap-4 sm:grid-cols-3"}>
                {tiles.map((t) => {
                    const entry = latestPerBureau[t.key];
                    const delta = latestBureauDelta(t.bureau, scores);
                    return (
                        <div key={t.key} className="flex flex-col gap-2 rounded-xl bg-secondary p-4">
                            <p className="text-xs font-semibold tracking-wide text-tertiary uppercase">{t.label}</p>
                            {entry ? (
                                <>
                                    <p className="text-display-xs font-semibold text-primary">{entry.value}</p>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <p className="text-xs text-tertiary">{formatDateOnly(entry.scoreDate)}</p>
                                        <DeltaBadge delta={delta} unit="pts" />
                                    </div>
                                </>
                            ) : (
                                <p className="text-sm text-tertiary">Not logged yet</p>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Combined line chart — one series per bureau (+ unspecified when present) */}
            {creditChartData.length > 0 && (
                <div className="flex flex-col gap-3 rounded-xl bg-secondary/40 p-3 ring-1 ring-secondary ring-inset sm:p-4">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1">
                        {creditSeries.map((s) => (
                            <span key={s.key} className="flex items-center gap-1.5 text-xs font-medium text-tertiary">
                                <span className="size-2.5 rounded-full" style={{ background: s.color }} aria-hidden="true" />
                                {s.name}
                            </span>
                        ))}
                    </div>
                    <TrendChart
                        data={creditChartData}
                        series={creditSeries}
                        type="line"
                        fitDomain
                        money={false}
                        unit="pts"
                        height={200}
                        emptyLabel="No credit scores yet"
                    />
                </div>
            )}

            {/* CRUD table — flush to the card edges with a divider (no nested ring) */}
            {scores.length > 0 && (
                <div className="-mx-5 -mb-5 overflow-x-auto border-t border-secondary">
                    <table className="w-full text-sm" style={{ minWidth: 400 }}>
                    <thead>
                        <tr className="border-b border-secondary text-left text-tertiary">
                            <th className="px-5 py-3 font-medium">Date</th>
                            <th className="px-5 py-3 font-medium">Bureau</th>
                            <th className="px-5 py-3 text-right font-medium">Score</th>
                            <th className="px-5 py-3 font-medium">Change</th>
                            <th className="px-5 py-3 font-medium">Notes</th>
                            <th className="px-5 py-3" />
                        </tr>
                    </thead>
                    <tbody>
                        {creditTableRows.slice(0, 30).map((e) => (
                            <tr key={e.id} className="border-b border-secondary last:border-0">
                                <td className="px-5 py-3 text-tertiary">{formatDateOnly(e.scoreDate)}</td>
                                <td className="px-5 py-3">
                                    {e.bureau ? (
                                        <Badge size="sm" type="color" color={e.bureau === "EQUIFAX" ? "blue" : e.bureau === "EXPERIAN" ? "success" : "orange"}>
                                            {BUREAU_LABELS[e.bureau]}
                                        </Badge>
                                    ) : (
                                        <Badge size="sm" type="modern" color="gray">
                                            Unspecified
                                        </Badge>
                                    )}
                                </td>
                                <td className="px-5 py-3 text-right font-medium text-primary">{e.value} pts</td>
                                <td className="px-5 py-3">
                                    <DeltaBadge delta={creditDelta(e, scores)} unit="pts" />
                                </td>
                                <td className="px-5 py-3 text-xs text-tertiary">{e.notes ?? "—"}</td>
                                <td className="px-5 py-3">
                                    <div className="flex justify-end gap-1">
                                        <Button
                                            size="sm"
                                            color="tertiary"
                                            iconLeading={Edit01}
                                            aria-label="Edit"
                                            onClick={() => {
                                                setCreditEditing(e);
                                                setCreditOpen(true);
                                            }}
                                        />
                                        <Button
                                            size="sm"
                                            color="tertiary-destructive"
                                            iconLeading={Trash02}
                                            aria-label="Delete"
                                            onClick={async () => {
                                                const fd = new FormData();
                                                fd.set("id", e.id);
                                                try {
                                                    await deleteCreditScore(fd);
                                                    toast.success("Deleted");
                                                    router.refresh();
                                                } catch {
                                                    toast.error("Failed");
                                                }
                                            }}
                                        />
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                    </table>
                </div>
            )}
            {scores.length === 0 && (
                <EmptyState
                    icon={Speedometer03}
                    title="Track your credit like a pro"
                    description="Log scores from Equifax, Experian and TransUnion to watch trends, catch dips early and know exactly where you stand."
                    action={
                        <Button
                            size="sm"
                            iconLeading={Plus}
                            onClick={() => {
                                setCreditEditing(null);
                                setCreditOpen(true);
                            }}
                        >
                            Log score
                        </Button>
                    }
                />
            )}

            {/* Log/edit modal */}
            <FormModal isOpen={creditOpen} onOpenChange={setCreditOpen} title={creditEditing ? "Edit credit score" : "Log credit score"}>
                <form
                    action={async (fd) => {
                        try {
                            if (creditEditing) {
                                fd.set("id", creditEditing.id);
                                await updateCreditScore(fd);
                                toast.success("Score updated");
                            } else {
                                await createCreditScore(fd);
                                toast.success("Score logged");
                            }
                            setCreditOpen(false);
                            setCreditEditing(null);
                            router.refresh();
                        } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Something went wrong");
                        }
                    }}
                    className="flex flex-col gap-4"
                >
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Score" htmlFor="score">
                            <NativeInput id="score" name="score" type="number" min={300} max={850} required defaultValue={creditEditing?.value ?? ""} placeholder="720" />
                        </Field>
                        <FormDateInput name="scoreDate" label="Date" defaultValue={creditEditing?.scoreDate ?? new Date().toISOString().slice(0, 10)} />
                    </div>
                    <Field label="Bureau" htmlFor="bureau">
                        <NativeSelect id="bureau" name="bureau" defaultValue={creditEditing?.bureau ?? ""}>
                            <option value="">Unspecified</option>
                            <option value="EQUIFAX">Equifax</option>
                            <option value="EXPERIAN">Experian</option>
                            <option value="TRANSUNION">TransUnion</option>
                        </NativeSelect>
                    </Field>
                    <Field label="Notes" htmlFor="notes">
                        <NativeTextarea id="notes" name="notes" defaultValue={creditEditing?.notes ?? ""} placeholder="Optional notes…" />
                    </Field>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button
                            color="secondary"
                            type="button"
                            onClick={() => {
                                setCreditOpen(false);
                                setCreditEditing(null);
                            }}
                        >
                            Cancel
                        </Button>
                        <Button type="submit">{creditEditing ? "Save" : "Log"}</Button>
                    </div>
                </form>
            </FormModal>
        </Card>
    );
}
