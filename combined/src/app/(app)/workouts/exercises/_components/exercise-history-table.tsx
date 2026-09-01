"use client";

import Link from "next/link";
import { BarChartSquare02, Trophy01 } from "@untitledui/icons";
import { Badge, BadgeWithIcon } from "@/components/base/badges/badges";
import { formatMeters, formatSeconds } from "@/lib/workouts";
import { formatWeight, type UnitSystem } from "@/lib/units";
import { EmptyState } from "../../_components/workouts-ui";

export type HistoryRow = {
    id: string;
    date: string;
    workoutId: string;
    workoutName: string | null;
    setOrder: number;
    reps: number | null;
    weightKg: number | null;
    seconds: number | null;
    meters: number | null;
    rpe: number | null;
    isWarmup: boolean;
    isQuickLog?: boolean;
    isPr?: boolean;
};

function formatSet(row: HistoryRow, unitSystem: UnitSystem): string {
    const parts: string[] = [];
    if (row.weightKg != null) parts.push(formatWeight(row.weightKg, unitSystem));
    if (row.reps != null) parts.push(`${row.reps} reps`);
    if (row.seconds != null) parts.push(formatSeconds(row.seconds));
    if (row.meters != null) parts.push(formatMeters(row.meters));
    if (row.rpe != null) parts.push(`RPE ${row.rpe}`);
    return parts.length ? parts.join(" · ") : "—";
}

function SourceCell({ row }: { row: HistoryRow }) {
    if (row.isQuickLog) {
        return <span className="font-medium text-secondary">Standalone attempt</span>;
    }
    return (
        <Link href={`/workouts/session/${row.workoutId}`} className="font-medium text-brand-secondary hover:underline">
            {row.workoutName ?? "Workout"}
        </Link>
    );
}

function TagsCell({ row }: { row: HistoryRow }) {
    return (
        <div className="flex flex-wrap gap-1">
            {row.isPr && (
                <BadgeWithIcon iconLeading={Trophy01} color="warning" size="sm">
                    PR
                </BadgeWithIcon>
            )}
            {row.isQuickLog && (
                <Badge color="gray" size="sm" type="pill-color">
                    Attempt
                </Badge>
            )}
            {row.isWarmup ? (
                <Badge color="gray" size="sm">
                    Warmup
                </Badge>
            ) : (
                <Badge color="gray" size="sm" type="modern">
                    Working
                </Badge>
            )}
        </div>
    );
}

export function ExerciseHistoryTable({ rows, unitSystem }: { rows: HistoryRow[]; unitSystem: UnitSystem }) {
    if (rows.length === 0) {
        return (
            <EmptyState
                icon={BarChartSquare02}
                title="No sets logged yet"
                description="Completed sets from your workouts and standalone attempts will appear here."
                className="py-8"
            />
        );
    }

    return (
        <>
            {/* Mobile: stacked card per row (< 640px) */}
            <ul className="flex flex-col gap-3 sm:hidden">
                {rows.map((row) => (
                    <li key={row.id} className="rounded-lg bg-primary p-3 ring-1 ring-secondary ring-inset">
                        <div className="flex items-start justify-between gap-2">
                            <span className="text-xs text-tertiary">{new Date(row.date).toLocaleDateString()}</span>
                            <span className="font-mono text-xs text-secondary tabular-nums">Set {row.setOrder + 1}</span>
                        </div>
                        <p className="mt-1.5 font-mono text-sm text-primary tabular-nums">{formatSet(row, unitSystem)}</p>
                        <div className="mt-1.5 text-sm">
                            <SourceCell row={row} />
                        </div>
                        <div className="mt-2">
                            <TagsCell row={row} />
                        </div>
                    </li>
                ))}
            </ul>

            {/* Tablet/desktop: table (>= 640px) */}
            <div className="hidden overflow-x-auto sm:block">
                <table className="w-full min-w-[720px] text-sm">
                    <thead>
                        <tr className="border-b border-secondary text-left text-xs text-tertiary">
                            <th className="py-2 pr-3 font-medium">Date</th>
                            <th className="py-2 pr-3 font-medium">Source</th>
                            <th className="py-2 pr-3 font-medium">Set</th>
                            <th className="py-2 pr-3 font-medium">Performance</th>
                            <th className="py-2 font-medium">Tags</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => (
                            <tr key={row.id} className="border-b border-secondary last:border-0">
                                <td className="py-2.5 pr-3 text-tertiary">{new Date(row.date).toLocaleDateString()}</td>
                                <td className="py-2.5 pr-3">
                                    <SourceCell row={row} />
                                </td>
                                <td className="py-2.5 pr-3 font-mono text-secondary tabular-nums">{row.setOrder + 1}</td>
                                <td className="py-2.5 pr-3 font-mono text-primary tabular-nums">{formatSet(row, unitSystem)}</td>
                                <td className="py-2.5">
                                    <TagsCell row={row} />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </>
    );
}
