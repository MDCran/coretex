// @ts-nocheck
import { Archive } from "@untitledui/icons";
import { useTransition } from "react";
import { Button } from "react-aria-components";
import { toast } from "sonner";

const useRouter = () => ({ push: () => {}, replace: () => {} }); const useSearchParams = () => ({ get: () => null });


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
