// @ts-nocheck




import { Card, EmptyState, SectionHeader } from "../../_components/workouts-ui";
import { StartWorkoutButtons } from "../../_components/start-workout-buttons";
import { TemplateActions } from "../_components/template-actions";
import { Badge } from "@/components/base/badges/badges";
import { db } from "@/lib/db";
import { Edit01 } from "@untitledui/icons";
import { Button } from "react-aria-components";
import { notFound } from "next/navigation";

const SCHEME_LABEL: Record<string, string> = { NONE: "No progression", LINEAR: "Linear", DOUBLE: "Double progression", FIVETHREEONE: "5/3/1" };

export default async function TemplateDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const user = await requireUser();
    const { id } = await params;

    const [template, settings] = await Promise.all([
        db.template.findFirst({
            where: { id, userId: user.id },
            include: { exercises: { orderBy: { order: "asc" }, include: { exercise: { select: { name: true, slug: true } }, sets: { orderBy: { order: "asc" } } } } },
        }),
        db.settings.findUnique({ where: { userId: user.id } }),
    ]);
    if (!template) notFound();
    const unitSystem = settings?.unitSystem ?? "IMPERIAL";

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                        <h1 className="text-display-xs font-semibold text-primary">{template.name}</h1>
                        <Badge color={template.progression === "NONE" ? "gray" : "brand"} size="md">
                            {SCHEME_LABEL[template.progression]}
                        </Badge>
                    </div>
                    {template.note && <p className="text-md text-tertiary">{template.note}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <StartWorkoutButtons templates={[{ id: template.id, name: template.name }]} />
                    <Button size="md" color="secondary" iconLeading={<Edit01 data-icon className="size-4" />} href={`/workouts/templates/${template.id}/edit`}>
                        Edit
                    </Button>
                    <TemplateActions templateId={template.id} archived={template.archived} />
                </div>
            </div>

            {template.progression === "FIVETHREEONE" && (
                <Card className="bg-secondary_subtle">
                    <p className="text-sm text-secondary">
                        Current cycle week: <span className="font-semibold text-primary">{template.cycleWeek ?? 1}</span> · advances automatically each session.
                    </p>
                </Card>
            )}

            <Card>
                <SectionHeader
                    title="Exercises"
                    description={
                        template.exercises.length > 0
                            ? `${template.exercises.length} exercises · ~${estimateTemplateMinutes(
                                  template.exercises.map((te) => ({ targetSets: te.targetSets, restSec: te.restSec, perSetMode: te.perSetMode, setCount: te.sets.length })),
                              )} min`
                            : undefined
                    }
                />
                <div className="mt-4 flex flex-col gap-4">
                    {template.exercises.map((te, i) => {
                        // Build display rows: explicit sets in perSetMode, else synthesized uniform rows.
                        type Row = { label: string; reps: string; weight: string; rpe: string; tag: string | null };
                        let rows: Row[] = [];
                        const repsRange =
                            te.targetRepsMin != null && te.targetRepsMax != null ? `${te.targetRepsMin}–${te.targetRepsMax}` : te.targetReps != null ? String(te.targetReps) : "—";
                        if (te.perSetMode && te.sets.length > 0) {
                            rows = te.sets.map((s, si) => ({
                                label: s.isWarmup ? "W" : String(si + 1 - te.sets.slice(0, si).filter((x) => x.isWarmup).length),
                                reps:
                                    s.targetRepsMin != null && s.targetRepsMax != null
                                        ? `${s.targetRepsMin}–${s.targetRepsMax}${s.isAmrap ? "+" : ""}`
                                        : `${s.targetReps ?? "—"}${s.isAmrap ? "+" : ""}`,
                                weight: s.targetWeight != null ? formatWeight(s.targetWeight, unitSystem) : "—",
                                rpe: s.targetRpe != null ? String(s.targetRpe) : "—",
                                tag: s.isWarmup ? "Warmup" : s.isAmrap ? "AMRAP" : null,
                            }));
                        } else if (te.targetSets != null && te.targetSets > 0) {
                            const w =
                                template.progression === "FIVETHREEONE" && te.trainingMaxKg != null
                                    ? `TM ${formatWeight(te.trainingMaxKg, unitSystem)}`
                                    : te.targetWeight != null
                                      ? formatWeight(te.targetWeight, unitSystem)
                                      : "—";
                            rows = Array.from({ length: te.targetSets }, (_, si) => ({
                                label: String(si + 1),
                                reps: repsRange,
                                weight: w,
                                rpe: te.targetRpe != null ? String(te.targetRpe) : "—",
                                tag: null,
                            }));
                        }

                        return (
                            <div key={te.id} className="rounded-lg ring-1 ring-secondary ring-inset">
                                <div className="flex items-center justify-between gap-2 border-b border-secondary px-4 py-3">
                                    <p className="text-sm font-semibold text-primary">
                                        {i + 1}. {te.exercise.name}
                                    </p>
                                    <div className="flex items-center gap-1.5">
                                        {te.groupKey && (
                                            <Badge color="purple" size="sm">
                                                SS {te.groupKey}
                                            </Badge>
                                        )}
                                        {te.tempo && (
                                            <Badge color="gray" size="sm" type="modern">
                                                {te.tempo}
                                            </Badge>
                                        )}
                                        {te.restSec != null && <span className="text-xs text-tertiary">{formatRest(te.restSec)}</span>}
                                    </div>
                                </div>
                                {rows.length > 0 ? (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr className="text-[10px] font-semibold tracking-wider text-quaternary uppercase">
                                                    <th className="px-4 py-1.5 text-left font-semibold">Set</th>
                                                    <th className="px-4 py-1.5 text-left font-semibold">Reps</th>
                                                    <th className="px-4 py-1.5 text-left font-semibold">Weight</th>
                                                    <th className="px-4 py-1.5 text-left font-semibold">RPE</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {rows.map((r, ri) => (
                                                    <tr key={ri} className="border-t border-secondary">
                                                        <td className="px-4 py-1.5 font-medium text-secondary">
                                                            {r.label}
                                                            {r.tag && <span className="ml-1.5 text-[10px] font-semibold tracking-wide text-quaternary uppercase">{r.tag}</span>}
                                                        </td>
                                                        <td className="px-4 py-1.5 font-mono tabular-nums text-primary">{r.reps}</td>
                                                        <td className="px-4 py-1.5 font-mono tabular-nums text-primary">{r.weight}</td>
                                                        <td className="px-4 py-1.5 font-mono tabular-nums text-tertiary">{r.rpe}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    <p className="px-4 py-3 text-xs text-tertiary">No set targets defined.</p>
                                )}
                                {te.note && <p className="border-t border-secondary px-4 py-2 text-xs text-tertiary">{te.note}</p>}
                            </div>
                        );
                    })}
                    {template.exercises.length === 0 && <p className="text-sm text-tertiary">No exercises in this template.</p>}
                </div>
            </Card>
        </div>
    );
}
