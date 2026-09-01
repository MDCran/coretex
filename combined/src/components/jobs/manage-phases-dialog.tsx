"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, FolderPlus, LayersThree01, RefreshCw01, Trash01, X } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Badge, BadgeWithDot } from "@/components/base/badges/badges";
import { InputBase } from "@/components/base/input/input";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { TextInput, DateInput } from "@/components/jobs/fields";
import { createPhase, deletePhase, renamePhase, setPhaseArchived } from "@/lib/actions/jobs";

type PhaseRow = { id: string; name: string; archived: boolean; count: number };

export function ManagePhasesDialog({ phases }: { phases: PhaseRow[] }) {
    const [open, setOpen] = useState(false);
    const router = useRouter();
    const createRef = useRef<HTMLFormElement>(null);

    const active = phases.filter((p) => !p.archived);
    const old = phases.filter((p) => p.archived);

    return (
        <>
            <Button color="secondary" iconLeading={LayersThree01} onClick={() => setOpen(true)}>
                Phases
            </Button>

            <ModalOverlay isDismissable isOpen={open} onOpenChange={setOpen}>
                <Modal className="max-w-lg">
                    <Dialog aria-label="Manage phases">
                        <div className="flex max-h-[85vh] w-full flex-col rounded-2xl bg-primary shadow-xl ring-1 ring-secondary">
                            <div className="flex items-center justify-between border-b border-secondary px-5 py-4">
                                <h2 className="text-md font-semibold text-primary">Manage phases</h2>
                                <Button color="tertiary" size="sm" iconLeading={X} onClick={() => setOpen(false)} aria-label="Close" />
                            </div>

                            <div className="flex flex-col gap-5 overflow-y-auto p-5">
                                {/* Create */}
                                <form
                                    ref={createRef}
                                    action={async (fd) => {
                                        try {
                                            await createPhase(fd);
                                            createRef.current?.reset();
                                            router.refresh();
                                            toast.success("Phase created");
                                        } catch (e) {
                                            toast.error(e instanceof Error ? e.message : "Couldn't create phase.");
                                        }
                                    }}
                                    className="flex flex-col gap-2 rounded-lg bg-secondary p-3 sm:flex-row sm:items-end"
                                >
                                    <TextInput name="name" label="New phase" placeholder="Spring 2026 cycle" isRequired fieldClassName="flex-1" />
                                    <DateInput name="startedAt" label="Start date" fieldClassName="sm:w-40" />
                                    <Button type="submit" color="primary" iconLeading={FolderPlus} className="sm:w-auto">
                                        Add
                                    </Button>
                                </form>

                                {phases.length === 0 && <p className="py-2 text-sm text-tertiary">No phases yet. Create one above to group your applications.</p>}

                                {active.length > 0 && (
                                    <PhaseGroup label="Active" phases={active} router={router} />
                                )}
                                {old.length > 0 && (
                                    <PhaseGroup label="Old" phases={old} router={router} />
                                )}
                            </div>
                        </div>
                    </Dialog>
                </Modal>
            </ModalOverlay>
        </>
    );
}

function PhaseGroup({ label, phases, router }: { label: string; phases: PhaseRow[]; router: ReturnType<typeof useRouter> }) {
    return (
        <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold tracking-wide text-quaternary uppercase">{label}</p>
            <div className="flex flex-col gap-2">
                {phases.map((p) => (
                    <PhaseItem key={p.id} phase={p} router={router} />
                ))}
            </div>
        </div>
    );
}

function PhaseItem({ phase: p, router }: { phase: PhaseRow; router: ReturnType<typeof useRouter> }) {
    async function archived(next: boolean) {
        try {
            const fd = new FormData();
            fd.set("id", p.id);
            fd.set("archived", next ? "1" : "0");
            await setPhaseArchived(fd);
            router.refresh();
            toast.success(next ? "Marked as old" : "Marked as active");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't update phase.");
        }
    }

    return (
        <div className="flex flex-col gap-2.5 rounded-lg p-3 ring-1 ring-secondary ring-inset">
            {/* Rename */}
            <form
                action={async (fd) => {
                    try {
                        await renamePhase(fd);
                        router.refresh();
                        toast.success("Phase renamed");
                    } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Couldn't rename phase.");
                    }
                }}
                className="flex items-center gap-2"
            >
                <input type="hidden" name="id" value={p.id} />
                <InputBase name="name" defaultValue={p.name} size="sm" aria-label="Phase name" wrapperClassName="flex-1" />
                <Button type="submit" color="secondary" size="sm">
                    Save
                </Button>
            </form>

            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    {p.archived ? (
                        <Badge color="gray" size="sm" type="modern">
                            Old
                        </Badge>
                    ) : (
                        <BadgeWithDot color="success" size="sm" type="modern">
                            Active
                        </BadgeWithDot>
                    )}
                    <span className="text-xs text-tertiary tabular-nums">
                        {p.count} application{p.count === 1 ? "" : "s"}
                    </span>
                </div>
                <div className="flex items-center gap-1.5">
                    {p.archived ? (
                        <Button color="secondary" size="sm" iconLeading={<RefreshCw01 data-icon className="size-4" />} onClick={() => archived(false)}>
                            Mark active
                        </Button>
                    ) : (
                        <Button color="secondary" size="sm" iconLeading={<Archive data-icon className="size-4" />} onClick={() => archived(true)}>
                            Mark old
                        </Button>
                    )}
                    <form
                        action={async (fd) => {
                            try {
                                await deletePhase(fd);
                                router.refresh();
                                toast.success("Phase deleted");
                            } catch (e) {
                                toast.error(e instanceof Error ? e.message : "Couldn't delete phase.");
                            }
                        }}
                    >
                        <input type="hidden" name="id" value={p.id} />
                        <Button type="submit" color="tertiary-destructive" size="sm" iconLeading={Trash01} aria-label="Delete phase" />
                    </form>
                </div>
            </div>
        </div>
    );
}
