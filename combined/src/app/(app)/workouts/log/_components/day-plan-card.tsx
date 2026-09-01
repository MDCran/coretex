"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { CalendarCheck01, PlayCircle, SkipForward } from "@untitledui/icons";
import { toast } from "sonner";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { setScheduleSkipped, startScheduledWorkout } from "@/lib/actions/workouts-schedule";
import { type AdherenceStatus, STATUS_COLOR, STATUS_LABEL } from "@/lib/workouts-schedule";

type DayPlan = {
    id: string;
    name: string | null;
    templateName: string | null;
    notes: string | null;
    workoutId: string | null;
    skipped: boolean;
    status: AdherenceStatus;
};

export function DayPlanCard({ plans }: { plans: DayPlan[] }) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();

    if (plans.length === 0) return null;

    const onStart = (id: string) =>
        startTransition(async () => {
            try {
                const wid = await startScheduledWorkout(id);
                router.push(`/workouts/session/${wid}`);
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed to start");
            }
        });

    const onSkip = (p: DayPlan) =>
        startTransition(async () => {
            await setScheduleSkipped(p.id, !p.skipped);
            toast.success(p.skipped ? "Plan un-skipped" : "Plan skipped");
            router.refresh();
        });

    return (
        <div className="rounded-xl bg-brand-section_subtle p-5 ring-1 ring-secondary ring-inset">
            <div className="flex items-center gap-2">
                <CalendarCheck01 className="size-5 text-fg-brand-primary" />
                <h2 className="text-lg font-semibold text-primary">Planned for today</h2>
            </div>
            <div className="mt-4 flex flex-col gap-2">
                {plans.map((p) => (
                    <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-primary p-3 ring-1 ring-secondary ring-inset">
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                                <p className="truncate text-sm font-semibold text-primary">{p.name || p.templateName || "Workout"}</p>
                                <Badge color={STATUS_COLOR[p.status]} size="sm">
                                    {STATUS_LABEL[p.status]}
                                </Badge>
                            </div>
                            {(p.templateName || p.notes) && (
                                <p className="mt-0.5 truncate text-xs text-tertiary">
                                    {[p.name && p.templateName ? p.templateName : null, p.notes].filter(Boolean).join(" · ")}
                                </p>
                            )}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                            {p.workoutId ? (
                                <Button size="sm" color="link-color" href={`/workouts/session/${p.workoutId}`}>
                                    View session
                                </Button>
                            ) : (
                                <>
                                    <Button size="sm" color="primary" iconLeading={PlayCircle} isDisabled={pending} onClick={() => onStart(p.id)}>
                                        Start planned workout
                                    </Button>
                                    <Button size="sm" color="secondary" iconLeading={SkipForward} isDisabled={pending} onClick={() => onSkip(p)}>
                                        {p.skipped ? "Un-skip" : "Skip"}
                                    </Button>
                                </>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
