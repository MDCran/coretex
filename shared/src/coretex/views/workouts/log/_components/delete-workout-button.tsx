// @ts-nocheck

import { useConfirm } from "@/components/application/confirm-dialog/confirm-dialog";
import { toast } from "sonner";
import { useTransition } from "react";
import { Trash01 } from "@untitledui/icons";
import { ButtonUtility } from "@/components/base/buttons/button-utility";

export const DeleteWorkoutButton = ({ workoutId }: { workoutId: string }) => {
    const [pending, startTransition] = useTransition();
    const { confirm, dialog } = useConfirm();
    return (
        <>
            <ButtonUtility
                size="sm"
                color="tertiary"
                icon={Trash01}
                isDisabled={pending}
                tooltip="Delete workout"
                onClick={() =>
                    confirm({
                        title: "Delete this workout? This cannot be undone.",
                        destructive: true,
                        confirmLabel: "Delete",
                        onConfirm: () =>
                            startTransition(async () => {
                                try {
                                    await deleteWorkout(workoutId);
                                    toast.success("Workout deleted");
                                } catch (e) {
                                    toast.error(e instanceof Error ? e.message : "Failed to delete");
                                }
                            }),
                    })
                }
            />
            {dialog}
        </>
    );
};
