"use client";

import { useState } from "react";
import { Eye, Pencil01 } from "@untitledui/icons";
import { cx } from "@/utils/cx";
import { NativeTextarea } from "../../_components/learning-ui";
import { Markdown } from "../../_components/markdown";

interface MarkdownFieldProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    rows?: number;
    "aria-label"?: string;
}

/** Markdown textarea with a live preview toggle. */
export function MarkdownField({ value, onChange, placeholder, rows = 3, ...rest }: MarkdownFieldProps) {
    const [preview, setPreview] = useState(false);
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex justify-end">
                <button
                    type="button"
                    onClick={() => setPreview((p) => !p)}
                    className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-tertiary transition duration-100 ease-linear hover:bg-primary_hover hover:text-secondary"
                >
                    {preview ? <Pencil01 className="size-3.5" aria-hidden="true" /> : <Eye className="size-3.5" aria-hidden="true" />}
                    {preview ? "Edit" : "Preview"}
                </button>
            </div>
            {preview ? (
                <div className={cx("min-h-20 rounded-lg bg-secondary px-3 py-2 ring-1 ring-secondary ring-inset")}>
                    {value.trim() ? <Markdown>{value}</Markdown> : <p className="text-sm text-placeholder">Nothing to preview.</p>}
                </div>
            ) : (
                <NativeTextarea
                    aria-label={rest["aria-label"]}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                    rows={rows}
                />
            )}
        </div>
    );
}
