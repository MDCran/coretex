// @ts-nocheck
﻿





import { Card, EmptyState, SectionHeader } from "../../_components/workouts-ui";
import { ArchiveExerciseButton } from "../_components/archive-exercise-button";
import { LogAttemptButton } from "../_components/log-attempt-button";
import { ExerciseHistoryTable, type HistoryRow } from "../_components/exercise-history-table";
import { resolveExerciseImage } from "../_components/resolve-image";
import { Badge } from "@/components/base/badges/badges";
import { titleCase } from "@/coretex/labels";
import { TrendPoint, TrendChart } from "@/coretex/views/financial/_components/trend-chart";
import { db } from "@/lib/db";
import { Edit01, Trophy01 } from "@untitledui/icons";
import { Button } from "react-aria-components";
import { notFound } from "next/navigation";

function measureLabel(e: { tracksReps: boolean; tracksWeight: boolean; tracksTime: boolean; tracksDistance: boolean }) {
    const parts: string[] = [];
    if (e.tracksReps) parts.push("Reps");
    if (e.tracksWeight) parts.push("Weight");
    if (e.tracksTime) parts.push("Time");
    if (e.tracksDistance) parts.push("Distance");
    return parts.length ? parts.join(" + ") : "Custom";
}

export default async function ExerciseDetailPage({ params }: { params: Promise<{ slug: string }> }) {
    const user = await requireUser();
    const { slug } = await params;

    const exercise = await db.exercise.findFirst({
        where: { slug, OR: [{ userId: null }, { userId: user.id }] },
        include: { parent: { select: { name: true, slug: true } }, variations: { select: { name: true, slug: true } } },
    });
    if (!exercise) notFound();

    const mine = exercise.userId === user.id;
    const settings = await db.settings.findUnique({ where: { userId: user.id } });
    const unitSystem = settings?.unitSystem ?? "IMPERIAL";

    const [historySets, prs, currentPrsMap] = await Promise.all([
        db.setEntry.findMany({
            where: {
                completed: true,
                workoutExercise: { exerciseId: exercise.id, workout: { userId: user.id, deletedAt: null } },
            },
            include: { workoutExercise: { include: { workout: { select: { id: true, date: true, name: true, isQuickLog: true } } } } },
            orderBy: [{ workoutExercise: { workout: { date: "desc" } } }, { order: "asc" }],
            take: 200,
        }),
        db.personalRecord.findMany({ where: { userId: user.id, exerciseId: exercise.id }, orderBy: { recordType: "asc" } }),
        getCurrentPRs(user.id, [exercise.id]),
    ]);

    const currentPrs = currentPrsMap[exercise.id];

    const historyRows: HistoryRow[] = historySets.map((s) => ({
        id: s.id,
        date: s.workoutExercise.workout.date.toISOString().slice(0, 10),
        workoutId: s.workoutExercise.workout.id,
        workoutName: s.workoutExercise.workout.name,
        setOrder: s.order,
        reps: s.actualReps,
        weightKg: s.actualWeight,
        seconds: s.actualSeconds,
        meters: s.actualMeters,
        rpe: s.rpe,
        isWarmup: s.isWarmup,
        isQuickLog: s.workoutExercise.workout.isQuickLog,
        isPr: !s.isWarmup && isPrMatch(s, currentPrs),
    }));

    const lastSession = historyRows[0];

    // Weight chart: top weight + est 1RM per session day.
    const weightSets = historySets.filter((s) => !s.isWarmup && s.actualWeight != null && s.actualReps != null);
    const byDate = new Map<string, { topWeight: number; best1rm: number }>();
    for (const s of weightSets) {
        const key = s.workoutExercise.workout.date.toISOString().slice(0, 10);
        const est = epley1RM(s.actualWeight!, s.actualReps!);
        const cur = byDate.get(key) ?? { topWeight: 0, best1rm: 0 };
        cur.topWeight = Math.max(cur.topWeight, s.actualWeight!);
        cur.best1rm = Math.max(cur.best1rm, est);
        byDate.set(key, cur);
    }
    const weightPoints: TrendPoint[] = [...byDate.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, v]) => ({
            label: new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
            "Top weight": +v.topWeight.toFixed(1),
            "Est. 1RM": +v.best1rm.toFixed(1),
        }));

    // Time chart for cardio/timed exercises.
    const timeByDate = new Map<string, number>();
    for (const s of historySets.filter((x) => !x.isWarmup && x.actualSeconds != null)) {
        const key = s.workoutExercise.workout.date.toISOString().slice(0, 10);
        timeByDate.set(key, Math.max(timeByDate.get(key) ?? 0, s.actualSeconds!));
    }
    const timePoints: TrendPoint[] = [...timeByDate.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, sec]) => ({
            label: new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
            Seconds: sec,
        }));

    const images = exercise.images.map(resolveExerciseImage).filter((src): src is string => Boolean(src));
    if (exercise.mediaKey) images.unshift(fileUrl(exercise.mediaKey));
    if (exercise.mediaUrl) images.push(exercise.mediaUrl);

    const showWeightChart = exercise.tracksWeight && weightPoints.length > 0;
    const showTimeChart = exercise.tracksTime && timePoints.length > 0;

    return (
        <div className="flex flex-col gap-6">
            <Card className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <h1 className="text-display-xs font-semibold text-primary">{exercise.name}</h1>
                        <Badge color="gray" size="md" type="modern">
                            {measureLabel(exercise)}
                        </Badge>
                        {mine && (
                            <Badge color="brand" size="md">
                                Custom
                            </Badge>
                        )}
                        {exercise.archived && (
                            <Badge color="gray" size="md">
                                Archived
                            </Badge>
                        )}
                    </div>
                    {exercise.parent && (
                        <p className="text-sm text-tertiary">
                            Variation of{" "}
                            <a href="#">
                                {exercise.parent.name}
                            </a>
                        </p>
                    )}
                    {lastSession && (
                        <p className="text-sm text-secondary">
                            Last performed <span className="font-medium text-primary">{new Date(lastSession.date).toLocaleDateString()}</span>
                            {lastSession.isQuickLog ? (
                                <> as a standalone attempt</>
                            ) : (
                                lastSession.workoutName && (
                                    <>
                                        {" "}
                                        in{" "}
                                        <a href="#">
                                            {lastSession.workoutName}
                                        </a>
                                    </>
                                )
                            )}
                        </p>
                    )}
                </div>
                <div className="flex flex-wrap gap-2">
                    <LogAttemptButton
                        exercise={{
                            id: exercise.id,
                            name: exercise.name,
                            slug: exercise.slug,
                            tracksReps: exercise.tracksReps,
                            tracksWeight: exercise.tracksWeight,
                            tracksTime: exercise.tracksTime,
                            tracksDistance: exercise.tracksDistance,
                        }}
                        unitSystem={unitSystem}
                        currentPrs={currentPrs}
                    />
                    {mine && (
                        <>
                            <Button size="md" color="secondary" iconLeading={<Edit01 data-icon className="size-4" />} href={`/workouts/exercises/${slug}/edit`}>
                                Edit
                            </Button>
                            <ArchiveExerciseButton exerciseId={exercise.id} archived={exercise.archived} />
                        </>
                    )}
                </div>
            </Card>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                {(showWeightChart || showTimeChart) && (
                    <Card className="lg:col-span-2">
                        <SectionHeader
                            title={showWeightChart ? "Weight & estimated 1RM" : "Best time per session"}
                            description={showWeightChart ? "Top working set per session; 1RM via Epley." : "Longest duration logged each session."}
                        />
                        <div className="mt-4 overflow-hidden">
                            {showWeightChart ? (
                                <TrendChart
                                    data={weightPoints}
                                    series={[
                                        { key: "Top weight", name: "Top weight (kg)" },
                                        { key: "Est. 1RM", name: "Est. 1RM (kg)" },
                                    ]}
                                    fitDomain
                                    emptyLabel="No logged sets yet"
                                />
                            ) : (
                                <TrendChart data={timePoints} series={[{ key: "Seconds", name: "Seconds" }]} fitDomain emptyLabel="No time logged yet" />
                            )}
                        </div>
                    </Card>
                )}

                <div className="flex flex-col gap-4">
                    <Card>
                        <SectionHeader title="Personal records" />
                        {prs.length === 0 ? (
                            <EmptyState
                                icon={Trophy01}
                                color="warning"
                                title="No personal records yet"
                                description="Log a few sets and your bests will show up here automatically."
                                className="py-6"
                            />
                        ) : (
                            <div className="mt-3 flex flex-col gap-2">
                                {prs.map((pr) => (
                                    <div key={pr.id} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm odd:bg-secondary_subtle">
                                        <span className="text-tertiary">{titleCase(pr.recordType)}</span>
                                        <span className="font-semibold text-primary">
                                            {pr.recordType === "reps" ? `${pr.value} reps` : formatKg(pr.value)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Card>

                    <Card>
                        <SectionHeader title="Details" />
                        <dl className="mt-3 flex flex-col gap-2 text-sm">
                            <Row label="Muscles" value={exercise.muscles.map(titleCase).join(", ") || "—"} />
                            <Row label="Secondary" value={exercise.secondaryMuscles.map(titleCase).join(", ") || "—"} />
                            <Row label="Equipment" value={exercise.equipment.map(titleCase).join(", ") || "—"} />
                            <Row label="Category" value={exercise.category ?? "—"} />
                            <Row label="Level" value={titleCase(exercise.level) || "—"} />
                            <Row label="Mechanic" value={titleCase(exercise.mechanic) || "—"} />
                            <Row label="Force" value={titleCase(exercise.force) || "—"} />
                        </dl>
                    </Card>
                </div>
            </div>

            <Card>
                <SectionHeader title="Set history" description="Every completed set you've logged for this exercise." />
                <div className="mt-4">
                    <ExerciseHistoryTable rows={historyRows} unitSystem={unitSystem} />
                </div>
            </Card>

            {images.length > 0 && (
                <Card>
                    <SectionHeader title="Media" />
                    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {images.map((src, i) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img key={i} src={src} alt={`${exercise.name} ${i + 1}`} loading="lazy" className="aspect-square w-full rounded-lg object-cover ring-1 ring-secondary" />
                        ))}
                    </div>
                </Card>
            )}

            {exercise.instructions && (
                <Card>
                    <SectionHeader title="Instructions" />
                    <p className="mt-3 text-sm whitespace-pre-wrap text-secondary">{exercise.instructions}</p>
                </Card>
            )}

            {exercise.variations.length > 0 && (
                <Card>
                    <SectionHeader title="Variations" />
                    <div className="mt-3 flex flex-wrap gap-2">
                        {exercise.variations.map((v) => (
                            <Button key={v.slug} size="sm" color="secondary" href={`/workouts/exercises/${v.slug}`}>
                                {v.name}
                            </Button>
                        ))}
                    </div>
                </Card>
            )}
        </div>
    );
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 odd:bg-secondary_subtle">
            <dt className="text-tertiary">{label}</dt>
            <dd className="text-right font-medium text-primary capitalize">{value}</dd>
        </div>
    );
}
