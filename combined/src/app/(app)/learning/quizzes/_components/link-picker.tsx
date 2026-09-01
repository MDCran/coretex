"use client";

import { Check } from "@untitledui/icons";
import { cx } from "@/utils/cx";
import type { PickerOption } from "./quiz-shared";

interface LinkPickerProps {
    label: string;
    options: PickerOption[];
    selected: string[];
    onChange: (ids: string[]) => void;
    emptyHint: string;
}

/** Compact multi-select of the user's flashcards / notes shown as toggleable chips. */
export function LinkPicker({ label, options, selected, onChange, emptyHint }: LinkPickerProps) {
    const toggle = (id: string) => {
        onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
    };
    return (
        <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-secondary">
                {label} {selected.length > 0 && <span className="text-tertiary">({selected.length})</span>}
            </span>
            {options.length === 0 ? (
                <p className="text-xs text-tertiary">{emptyHint}</p>
            ) : (
                <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto rounded-lg p-2 ring-1 ring-secondary ring-inset">
                    {options.map((o) => {
                        const active = selected.includes(o.id);
                        return (
                            <button
                                key={o.id}
                                type="button"
                                onClick={() => toggle(o.id)}
                                className={cx(
                                    "flex max-w-full items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ring-1 transition duration-100 ease-linear ring-inset",
                                    active
                                        ? "bg-brand-primary text-brand-secondary ring-brand"
                                        : "text-tertiary ring-secondary hover:bg-primary_hover hover:text-secondary",
                                )}
                            >
                                {active && <Check className="size-3 shrink-0" aria-hidden="true" />}
                                <span className="truncate">{o.label}</span>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
