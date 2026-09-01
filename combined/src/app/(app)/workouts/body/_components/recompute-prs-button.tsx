"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { RefreshCcw01 } from "@untitledui/icons";
import { toast } from "sonner";
import { Button } from "@/components/base/buttons/button";
import { recomputeAllPRs } from "@/lib/actions/workouts-metrics";

/** Recomputes all personal records from full set history on demand. */
export function RecomputePrsButton() {
    const router = useRouter();
    const [pending, startTransition] = useTransition();

    const recompute = () =>
        startTransition(async () => {
            try {
                const touched = await recomputeAllPRs();
                toast.success(touched > 0 ? `Updated ${touched} personal record${touched === 1 ? "" : "s"}.` : "Personal records are already up to date.");
                router.refresh();
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed to recompute PRs");
            }
        });

    return (
        <Button size="sm" color="secondary" iconLeading={RefreshCcw01} onClick={recompute} isLoading={pending}>
            Recompute PRs
        </Button>
    );
}
