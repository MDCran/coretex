"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Edit01, Eye } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Markdown } from "@/components/jobs/markdown";
import { SubmitButton } from "@/components/jobs/submit-button";
import { cx } from "@/utils/cx";

/** Markdown notes with edit/preview tabs and a save action. */
export function NotesEditor({
    action,
    defaultValue,
    name = "notes",
}: {
    action: (formData: FormData) => void | Promise<void>;
    defaultValue: string;
    name?: string;
}) {
    const [value, setValue] = useState(defaultValue);
    const [mode, setMode] = useState<"edit" | "preview">(defaultValue ? "preview" : "edit");

    async function onSubmit(formData: FormData) {
        await action(formData);
        toast.success("Notes saved");
        setMode("preview");
    }

    return (
        <form action={onSubmit} className="flex flex-col gap-3">
            <div className="flex items-center gap-1 self-start rounded-lg bg-secondary p-0.5">
                <button
                    type="button"
                    onClick={() => setMode("edit")}
                    className={cx(
                        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium transition",
                        mode === "edit" ? "bg-primary text-primary shadow-xs" : "text-tertiary hover:text-secondary",
                    )}
                >
                    <Edit01 className="size-4" /> Edit
                </button>
                <button
                    type="button"
                    onClick={() => setMode("preview")}
                    className={cx(
                        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium transition",
                        mode === "preview" ? "bg-primary text-primary shadow-xs" : "text-tertiary hover:text-secondary",
                    )}
                >
                    <Eye className="size-4" /> Preview
                </button>
            </div>

            {mode === "edit" ? (
                <textarea
                    name={name}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    rows={8}
                    placeholder="Write notes in Markdown…"
                    className="w-full rounded-lg bg-primary p-3 font-mono text-sm text-primary shadow-xs ring-1 ring-primary outline-hidden transition ring-inset placeholder:text-placeholder focus:ring-2 focus:ring-brand"
                />
            ) : (
                <>
                    <input type="hidden" name={name} value={value} />
                    <div className="min-h-24 rounded-lg bg-secondary p-3">
                        {value.trim() ? <Markdown>{value}</Markdown> : <p className="text-sm text-tertiary">No notes yet.</p>}
                    </div>
                </>
            )}

            <div className="flex justify-end gap-2">
                {mode === "edit" && value !== defaultValue && (
                    <Button color="tertiary" onClick={() => setValue(defaultValue)}>
                        Reset
                    </Button>
                )}
                <SubmitButton color="primary">Save notes</SubmitButton>
            </div>
        </form>
    );
}
