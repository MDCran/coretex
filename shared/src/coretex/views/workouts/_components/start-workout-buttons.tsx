// @ts-nocheck
const useRouter = () => ({ push: () => {}, replace: () => {} }); const useSearchParams = () => ({ get: () => null });


import { toast } from "sonner";
import { Button, ModalOverlay, Modal, Dialog } from "react-aria-components";
import { useTransition, useState } from "react";
import { Plus } from "@untitledui/icons";
import { Field, NativeSelect } from "./workouts-ui";

export const StartWorkoutButtons = ({ templates, dateKey }: { templates: { id: string; name: string }[]; dateKey?: string }) => {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const [open, setOpen] = useState(false);
    const [templateId, setTemplateId] = useState("");
    const date = dateKey ?? toDateKey(new Date());

    const startBlank = () => {
        startTransition(async () => {
            try {
                const id = await createBlankWorkout(date);
                router.push(`/workouts/session/${id}`);
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed to start workout");
            }
        });
    };

    const startFromTemplate = () => {
        if (!templateId) {
            toast.error("Pick a template first");
            return;
        }
        startTransition(async () => {
            try {
                const id = await createWorkoutFromTemplate(templateId, date);
                router.push(`/workouts/session/${id}`);
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed to start workout");
            }
        });
    };

    return (
        <div className="flex flex-wrap gap-2">
            <Button size="md" color="secondary" iconLeading={Plus} onClick={startBlank} isLoading={pending}>
                Empty workout
            </Button>
            <Button size="md" color="primary" iconLeading={Plus} onClick={() => setOpen(true)} isDisabled={templates.length === 0}>
                From template
            </Button>

            <ModalOverlay isOpen={open} onOpenChange={setOpen}>
                <Modal className="max-w-md">
                    <Dialog aria-label="Start from template">
                        <div className="w-full rounded-2xl bg-primary p-6 shadow-xl ring-1 ring-secondary">
                            <h2 className="text-lg font-semibold text-primary">Start from template</h2>
                            <p className="mt-1 text-sm text-tertiary">Exercises and target sets are copied and progression applied.</p>
                            <div className="mt-4">
                                <Field label="Template">
                                    <NativeSelect value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                                        <option value="">Select a template…</option>
                                        {templates.map((t) => (
                                            <option key={t.id} value={t.id}>
                                                {t.name}
                                            </option>
                                        ))}
                                    </NativeSelect>
                                </Field>
                            </div>
                            <div className="mt-6 flex justify-end gap-2">
                                <Button color="secondary" onClick={() => setOpen(false)}>
                                    Cancel
                                </Button>
                                <Button color="primary" onClick={startFromTemplate} isLoading={pending}>
                                    Start
                                </Button>
                            </div>
                        </div>
                    </Dialog>
                </Modal>
            </ModalOverlay>
        </div>
    );
};
