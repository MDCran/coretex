// @ts-nocheck
const useRouter = () => ({ push: () => {}, replace: () => {} }); const useSearchParams = () => ({ get: () => null });


import { toast } from "sonner";
import { Button, ModalOverlay, Modal, Dialog } from "react-aria-components";
import { useTransition, useState, useRef } from "react";
import { Plus, Edit01, Trash01, X } from "@untitledui/icons";
import FormDateInput from "@/components/base/input/form-date-input";
import { ButtonUtility } from "@/components/base/buttons/button-utility";
import { Badge } from "@/components/base/badges/badges";
import { useConfirm } from "@/components/application/confirm-dialog/confirm-dialog";
import { Card, Field, NativeSelect, NativeTextarea, SectionHeader } from "../../_components/workouts-ui";

type Cycle = { id: string; phase: string; startDate: string; endDate: string | null; note: string | null };

const PHASE_COLOR: Record<string, "success" | "warning" | "brand"> = { BULK: "success", CUT: "warning", MAINTAIN: "brand" };

export const TrainingCycleManager = ({ cycles }: { cycles: Cycle[] }) => {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<Cycle | null>(null);
    const formRef = useRef<HTMLFormElement>(null);
    const { confirm, dialog } = useConfirm();

    const onSubmit = (form: FormData) => {
        startTransition(async () => {
            try {
                await createTrainingCycle(form);
                toast.success("Cycle added");
                formRef.current?.reset();
                setOpen(false);
                router.refresh();
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed");
            }
        });
    };

    const onUpdate = (id: string, form: FormData) => {
        startTransition(async () => {
            try {
                await updateTrainingCycle(id, form);
                toast.success("Cycle updated");
                setEditing(null);
                router.refresh();
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed");
            }
        });
    };

    const removeCycle = (id: string) => {
        confirm({
            title: "Delete this cycle?",
            destructive: true,
            confirmLabel: "Delete",
            onConfirm: () =>
                startTransition(async () => {
                    await deleteTrainingCycle(id);
                    toast.success("Deleted");
                    router.refresh();
                }),
        });
    };

    return (
        <Card>
            <SectionHeader
                title="Training cycles"
                description="Bulk / cut / maintain phases."
                action={
                    <Button size="sm" color="secondary" iconLeading={Plus} onClick={() => setOpen((o) => !o)}>
                        Add cycle
                    </Button>
                }
            />

            {open && (
                <form ref={formRef} action={onSubmit} className="mt-4 grid grid-cols-1 gap-3 rounded-lg bg-secondary p-4 sm:grid-cols-4">
                    <Field label="Phase">
                        <NativeSelect name="phase" defaultValue="BULK">
                            <option value="BULK">Bulk</option>
                            <option value="CUT">Cut</option>
                            <option value="MAINTAIN">Maintain</option>
                        </NativeSelect>
                    </Field>
                    <Field label="Start">
                        <FormDateInput name="startDate" variant="date" defaultValue={toDateKey(new Date())} />
                    </Field>
                    <Field label="End (optional)">
                        <FormDateInput name="endDate" variant="date" />
                    </Field>
                    <Field label="Note">
                        <NativeTextarea name="note" className="min-h-10" />
                    </Field>
                    <div className="sm:col-span-4">
                        <Button color="primary" type="submit" isLoading={pending}>
                            Save cycle
                        </Button>
                    </div>
                </form>
            )}

            <div className="mt-4 flex flex-col gap-2">
                {cycles.length === 0 ? (
                    <p className="text-sm text-tertiary">No cycles yet.</p>
                ) : (
                    cycles.map((c) => (
                        <div key={c.id} className="flex items-center justify-between gap-3 rounded-lg p-3 ring-1 ring-secondary ring-inset">
                            <div className="flex items-center gap-3">
                                <Badge color={PHASE_COLOR[c.phase]} size="md">
                                    {c.phase.charAt(0) + c.phase.slice(1).toLowerCase()}
                                </Badge>
                                <div>
                                    <p className="text-sm font-medium text-primary">
                                        {new Date(c.startDate).toLocaleDateString()} → {c.endDate ? new Date(c.endDate).toLocaleDateString() : "ongoing"}
                                    </p>
                                    {c.note && <p className="text-xs text-tertiary">{c.note}</p>}
                                </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                                <ButtonUtility size="xs" color="tertiary" icon={Edit01} tooltip="Edit" isDisabled={pending} onClick={() => setEditing(c)} />
                                <ButtonUtility size="xs" color="tertiary" icon={Trash01} tooltip="Delete" isDisabled={pending} onClick={() => removeCycle(c.id)} />
                            </div>
                        </div>
                    ))
                )}
            </div>
            {dialog}

            {/* Edit cycle modal */}
            {editing && (
                <EditCycleModal
                    cycle={editing}
                    pending={pending}
                    onClose={() => setEditing(null)}
                    onSave={(form) => onUpdate(editing.id, form)}
                />
            )}
        </Card>
    );
};

function EditCycleModal({
    cycle,
    pending,
    onClose,
    onSave,
}: {
    cycle: Cycle;
    pending: boolean;
    onClose: () => void;
    onSave: (form: FormData) => void;
}) {
    const formRef = useRef<HTMLFormElement>(null);

    const handleSubmit = () => {
        if (!formRef.current) return;
        const data = new FormData(formRef.current);
        onSave(data);
    };

    return (
        <ModalOverlay isOpen onOpenChange={(v) => !v && onClose()}>
            <Modal className="max-w-lg">
                <Dialog aria-label="Edit training cycle">
                    <div className="w-full rounded-2xl bg-primary p-6 shadow-xl ring-1 ring-secondary">
                        <div className="flex items-start justify-between gap-2">
                            <h2 className="text-lg font-semibold text-primary">Edit training cycle</h2>
                            <ButtonUtility size="sm" color="tertiary" icon={X} tooltip="Close" onClick={onClose} />
                        </div>
                        <form ref={formRef} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <Field label="Phase">
                                <NativeSelect name="phase" defaultValue={cycle.phase}>
                                    <option value="BULK">Bulk</option>
                                    <option value="CUT">Cut</option>
                                    <option value="MAINTAIN">Maintain</option>
                                </NativeSelect>
                            </Field>
                            <Field label="Start">
                                <FormDateInput name="startDate" variant="date" defaultValue={cycle.startDate} />
                            </Field>
                            <Field label="End (optional)">
                                <FormDateInput name="endDate" variant="date" defaultValue={cycle.endDate ?? ""} />
                            </Field>
                            <Field label="Note">
                                <NativeTextarea name="note" className="min-h-10" defaultValue={cycle.note ?? ""} />
                            </Field>
                        </form>
                        <div className="mt-6 flex justify-end gap-2">
                            <Button color="secondary" onClick={onClose}>
                                Cancel
                            </Button>
                            <Button color="primary" isLoading={pending} onClick={handleSubmit}>
                                Save
                            </Button>
                        </div>
                    </div>
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
}
