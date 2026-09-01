"use client";

import type { ReactNode } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/base/badges/badges";
import { Field, NativeInput, NativeSelect } from "../../_components/learning-ui";

/** Run a server action with toast feedback; returns success boolean. */
export async function run(action: (fd: FormData) => Promise<void>, fd: FormData, ok = "Saved") {
    try {
        await action(fd);
        toast.success(ok);
        return true;
    } catch (e) {
        toast.error(e instanceof Error ? e.message : "Something went wrong");
        return false;
    }
}

export const GRADE_LEVEL_LABEL: Record<string, string> = {
    HIGH_SCHOOL: "High school",
    UNDERGRAD: "Undergrad",
    GRAD: "Grad",
};

export const CLASS_STATUS_LABEL: Record<string, string> = {
    ACTIVE: "Active",
    COMPLETED: "Completed",
    DROPPED: "Dropped",
};

export const CLASS_STATUS_COLOR: Record<string, "gray" | "brand" | "success" | "error"> = {
    ACTIVE: "brand",
    COMPLETED: "success",
    DROPPED: "gray",
};

export const HOMEWORK_STATUS_LABEL: Record<string, string> = {
    NOT_STARTED: "Not started",
    IN_PROGRESS: "In progress",
    SUBMITTED: "Submitted",
    GRADED: "Graded",
};

/** Color a grade percent: success ≥87, warning 70-86, error <70. */
export function gradeColor(percent: number | null): "success" | "warning" | "error" | "gray" {
    if (percent == null) return "gray";
    if (percent >= 87) return "success";
    if (percent >= 70) return "warning";
    return "error";
}

export function gradeTextClass(percent: number | null): string {
    const c = gradeColor(percent);
    if (c === "success") return "text-success-primary";
    if (c === "warning") return "text-warning-primary";
    if (c === "error") return "text-error-primary";
    return "text-tertiary";
}

export interface ClassFormValues {
    id?: string;
    name?: string;
    gradeLevel?: string;
    creditHours?: number | null;
    term?: string | null;
    instructor?: string | null;
    color?: string | null;
    status?: string;
    absenceLimit?: number | null;
}

/** Shared form body for create/edit class. Caller wraps it in a <form> and renders submit buttons. */
export function ClassFormFields({ editing }: { editing?: ClassFormValues | null }) {
    return (
        <>
            {editing?.id && <input type="hidden" name="id" value={editing.id} />}
            <Field label="Class name" htmlFor="name" required>
                <NativeInput id="name" name="name" defaultValue={editing?.name ?? ""} required />
            </Field>
            <div className="grid grid-cols-2 gap-4">
                <Field label="Level" htmlFor="gradeLevel">
                    <NativeSelect id="gradeLevel" name="gradeLevel" defaultValue={editing?.gradeLevel ?? "UNDERGRAD"}>
                        <option value="HIGH_SCHOOL">High school</option>
                        <option value="UNDERGRAD">Undergrad</option>
                        <option value="GRAD">Grad</option>
                    </NativeSelect>
                </Field>
                <Field label="Status" htmlFor="status">
                    <NativeSelect id="status" name="status" defaultValue={editing?.status ?? "ACTIVE"}>
                        <option value="ACTIVE">Active</option>
                        <option value="COMPLETED">Completed</option>
                        <option value="DROPPED">Dropped</option>
                    </NativeSelect>
                </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
                <Field label="Term" htmlFor="term">
                    <NativeInput id="term" name="term" defaultValue={editing?.term ?? ""} placeholder="Fall 2026" />
                </Field>
                <Field label="Credit hours" htmlFor="creditHours">
                    <NativeInput id="creditHours" name="creditHours" type="number" step="0.5" min="0" defaultValue={editing?.creditHours ?? ""} />
                </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
                <Field label="Instructor" htmlFor="instructor">
                    <NativeInput id="instructor" name="instructor" defaultValue={editing?.instructor ?? ""} />
                </Field>
                <Field label="Absence limit" htmlFor="absenceLimit" hint="Drop threshold">
                    <NativeInput id="absenceLimit" name="absenceLimit" type="number" min="0" defaultValue={editing?.absenceLimit ?? ""} />
                </Field>
            </div>
            <Field label="Color" htmlFor="color" hint="Hex like #7f56d9 — used in planner & cards">
                <NativeInput id="color" name="color" defaultValue={editing?.color ?? ""} placeholder="#7f56d9" />
            </Field>
        </>
    );
}

/** A small dot using an arbitrary class color (hex) or a fallback brand dot. */
export function ColorDot({ color, className }: { color?: string | null; className?: string }) {
    return (
        <span
            aria-hidden="true"
            className={"inline-block size-2.5 shrink-0 rounded-full " + (color ? "" : "bg-brand-solid ") + (className ?? "")}
            style={color ? { backgroundColor: color } : undefined}
        />
    );
}

export function StatusBadge({ status }: { status: string }): ReactNode {
    return (
        <Badge color={CLASS_STATUS_COLOR[status] ?? "gray"} size="sm">
            {CLASS_STATUS_LABEL[status] ?? status}
        </Badge>
    );
}
