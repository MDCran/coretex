"use client";

import { ChevronDown } from "@untitledui/icons";
import {
    Button as AriaButton,
    ListBox as AriaListBox,
    ListBoxItem as AriaListBoxItem,
    Popover as AriaPopover,
    Select as AriaSelect,
    SelectValue as AriaSelectValue,
} from "react-aria-components";
import { cx } from "@/utils/cx";
import type { OwnerOpt } from "./transactions-client";

/**
 * Custom rich listbox for picking an account/card. Native <select> can't render a
 * monogram + bold nickname + masked number underneath, so this uses React Aria's
 * Select/ListBox primitives to render each option richly while keeping a controlled
 * string value (id) compatible with the rest of the form.
 */

interface OwnerSelectProps {
    options: OwnerOpt[];
    value: string; // "" = none/all
    onChange: (value: string) => void;
    placeholder?: string;
    /** Adds an "All" sentinel option (used for filters). */
    allowAll?: boolean;
    allLabel?: string;
    "aria-label"?: string;
}

const NONE = "__none__";

function Monogram({ text }: { text: string }) {
    return (
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-brand-secondary text-xs font-semibold text-brand-secondary">
            {text}
        </span>
    );
}

function OptionRow({ opt }: { opt: OwnerOpt }) {
    return (
        <div className="flex items-center gap-2.5">
            <Monogram text={opt.monogram} />
            <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-semibold text-primary">{opt.nickname}</span>
                <span className="truncate text-xs text-tertiary">
                    {[opt.typeLabel, opt.masked].filter(Boolean).join(" · ") || (opt.kind === "card" ? "Card" : "Account")}
                </span>
            </div>
        </div>
    );
}

export function OwnerSelect({ options, value, onChange, placeholder = "Select…", allowAll = false, allLabel = "All", ...rest }: OwnerSelectProps) {
    const selected = options.find((o) => o.id === value) ?? null;

    return (
        <AriaSelect
            aria-label={rest["aria-label"] ?? placeholder}
            selectedKey={value === "" ? NONE : value}
            onSelectionChange={(key) => onChange(key === NONE ? "" : String(key))}
            className="relative w-full"
        >
            <AriaButton className="flex w-full items-center justify-between gap-2 rounded-lg bg-primary px-3 py-2 text-left shadow-xs ring-1 ring-primary ring-inset transition duration-100 ease-linear focus:outline-2 focus:-outline-offset-2 focus:outline-brand">
                <AriaSelectValue className="min-w-0 flex-1">
                    {() =>
                        selected ? (
                            <OptionRow opt={selected} />
                        ) : (
                            <span className="text-sm text-placeholder">{value === "" && allowAll ? allLabel : placeholder}</span>
                        )
                    }
                </AriaSelectValue>
                <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-fg-quaternary" />
            </AriaButton>
            <AriaPopover className="w-(--trigger-width) overflow-auto rounded-lg bg-primary py-1 shadow-lg ring-1 ring-secondary_alt ring-inset">
                <AriaListBox className="outline-hidden">
                    {(allowAll || true) && (
                        <AriaListBoxItem
                            id={NONE}
                            textValue={allowAll ? allLabel : "None"}
                            className={cx(
                                "flex cursor-pointer items-center px-3 py-2 text-sm text-secondary outline-hidden",
                                "data-[focused]:bg-primary_hover data-[selected]:bg-active",
                            )}
                        >
                            {allowAll ? allLabel : "— none —"}
                        </AriaListBoxItem>
                    )}
                    {options.map((opt) => (
                        <AriaListBoxItem
                            key={opt.id}
                            id={opt.id}
                            textValue={`${opt.nickname} ${opt.masked ?? ""}`}
                            className={cx(
                                "cursor-pointer px-3 py-2 outline-hidden",
                                "data-[focused]:bg-primary_hover data-[selected]:bg-active",
                            )}
                        >
                            <OptionRow opt={opt} />
                        </AriaListBoxItem>
                    ))}
                </AriaListBox>
            </AriaPopover>
        </AriaSelect>
    );
}
