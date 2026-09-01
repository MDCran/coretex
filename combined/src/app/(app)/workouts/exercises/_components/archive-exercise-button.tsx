"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Archive } from "@untitledui/icons";
import { toast } from "sonner";
import { Button } from "@/components/base/buttons/button";
import { archiveExercise } from "@/lib/actions/workouts-exercises";

export const ArchiveExerciseButton = ({ exerciseId, archived }: { exerciseId: string; archived: boolean }) => {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    return (
        <Button
            size="md"
            color="secondary"
            iconLeading={Archive}
            isLoading={pending}
            onClick={() =>
                startTransition(async () => {
                    try {
                        await archiveExercise(exerciseId, !archived);
                        toast.success(archived ? "Exercise restored" : "Exercise archived");
                        router.refresh();
                    } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Failed");
                    }
                })
            }
        >
            {archived ? "Restore" : "Archive"}
        </Button>
    );
};
