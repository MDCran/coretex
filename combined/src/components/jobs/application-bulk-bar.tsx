"use client";

import { type ReactNode, useState, useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, Trash01, X } from "@untitledui/icons";
import type { JobStatus } from "@prisma/client";
import { Button } from "@/components/base/buttons/button";
import { Select, type SelectItemType } from "@/components/base/select/select";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { STATUS_HEX, STATUS_LABELS, STATUS_ORDER } from "@/lib/jobs/enums";
import { bulkDeleteApplications, bulkUpdateApplicationStatus } from "@/lib/actions/jobs";

function statusDot(hex: string): ReactNode {
    return (
        <span data-icon aria-hidden="true" className="flex items-center justify-center">
            <span className="size-2 rounded-full" style={{ backgroundColor: hex }} />
        </span>
    );
}

/**
 * Action bar shown when one or more applications are selected. Offers "move status"
 * (any pipeline status) and "delete" across the whole selection. Used by both the
 * applications table and the per-company applications list.
 */
export function ApplicationBulkBar({ ids, onClear }: { ids: string[]; onClear: () => void }) {
    const [pending, start] = useTransition();
    const [confirm, setConfirm] = useState(false);
    const count = ids.length;

    const statusItems: SelectItemType[] = STATUS_ORDER.map((s) => ({ id: s, label: STATUS_LABELS[s], icon: statusDot(STATUS_HEX[s]) }));

    function move(status: JobStatus) {
        start(async () => {
            try {
                await bulkUpdateApplicationStatus(ids, status);
                toast.success(`Moved ${count} application${count === 1 ? "" : "s"} to ${STATUS_LABELS[status]}.`);
                onClear();
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Couldn't update the selection.");
            }
        });
    }

    function remove() {
        start(async () => {
            try {
                await bulkDeleteApplications(ids);
                toast.success(`Deleted ${count} application${count === 1 ? "" : "s"}.`);
                setConfirm(false);
                onClear();
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Couldn't delete the selection.");
            }
        });
    }

    return (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-secondary px-3 py-2 ring-1 ring-secondary ring-inset">
            <span className="text-sm font-medium text-secondary tabular-nums">
                {count} selected
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
                <Select
                    aria-label="Move selected to status"
                    size="sm"
                    placeholder="Move status…"
                    items={statusItems}
                    selectedKey={null}
                    isDisabled={pending}
                    className="w-44"
                    onSelectionChange={(key) => key && move(key as JobStatus)}
                >
                    {(item) => (
                        <Select.Item id={item.id} icon={item.icon}>
                            {item.label}
                        </Select.Item>
                    )}
                </Select>
                <Button color="secondary-destructive" size="sm" iconLeading={<Trash01 data-icon className="size-4" />} isDisabled={pending} onClick={() => setConfirm(true)}>
                    Delete
                </Button>
                <Button color="tertiary" size="sm" iconLeading={<X data-icon className="size-4" />} isDisabled={pending} onClick={onClear} aria-label="Clear selection" />
            </div>

            <ModalOverlay isDismissable isOpen={confirm} onOpenChange={setConfirm}>
                <Modal className="max-w-md">
                    <Dialog aria-label="Delete selected applications?">
                        <div className="w-full rounded-2xl bg-primary p-6 shadow-xl ring-1 ring-secondary">
                            <FeaturedIcon icon={AlertTriangle} color="error" theme="light" size="lg" />
                            <h2 className="mt-4 text-lg font-semibold text-primary">
                                Delete {count} application{count === 1 ? "" : "s"}?
                            </h2>
                            <p className="mt-1 text-sm text-tertiary">This permanently removes the selected applications and their history. This action cannot be undone.</p>
                            <div className="mt-6 flex justify-end gap-3">
                                <Button color="secondary" isDisabled={pending} onClick={() => setConfirm(false)}>
                                    Cancel
                                </Button>
                                <Button color="primary-destructive" isLoading={pending} showTextWhileLoading onClick={remove}>
                                    Delete
                                </Button>
                            </div>
                        </div>
                    </Dialog>
                </Modal>
            </ModalOverlay>
        </div>
    );
}
