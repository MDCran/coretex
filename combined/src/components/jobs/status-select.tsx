"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { JobStatus } from "@prisma/client";
import { updateStatus } from "@/lib/actions/jobs";
import { STATUS_ORDER } from "@/lib/jobs/enums";
import { SelectInput } from "@/components/jobs/fields";
import { STATUS_LABELS } from "@/lib/jobs/enums";

/** Inline status changer that writes an audit event via the server action. */
export function StatusSelect({ id, status }: { id: string; status: JobStatus }) {
    const [value, setValue] = useState<JobStatus>(status);
    const [pending, startTransition] = useTransition();

    function onChange(next: string) {
        const prev = value;
        setValue(next as JobStatus);
        startTransition(async () => {
            try {
                await updateStatus(id, next as JobStatus);
                toast.success(`Status set to ${STATUS_LABELS[next as JobStatus]}`);
            } catch {
                setValue(prev);
                toast.error("Failed to update status");
            }
        });
    }

    return (
        <SelectInput
            aria-label="Status"
            value={value}
            disabled={pending}
            onChange={(e) => onChange(e.target.value)}
            options={STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
            className="w-auto min-w-44"
        />
    );
}
