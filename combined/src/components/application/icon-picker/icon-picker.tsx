"use client";

import { useMemo, useState } from "react";
import { SearchLg } from "@untitledui/icons";
import { cx } from "@/utils/cx";
import { ICON_KEYWORDS, ICON_NAMES, ICON_REGISTRY } from "./icon-registry";

interface IconPickerProps {
    /** Currently-selected icon name (a key of ICON_REGISTRY), or null. */
    value: string | null | undefined;
    /** Called with the chosen icon name. */
    onChange: (name: string) => void;
    /** Override the searchable name list (defaults to the full shared registry). */
    names?: string[];
    /** Number of grid columns. */
    columns?: number;
    /** Extra classes for the scrollable grid container. */
    gridClassName?: string;
    placeholder?: string;
}

/**
 * Searchable icon-picker grid backed by the shared icon registry. Selection is
 * the icon NAME string so it can be persisted and cross the RSC boundary.
 */
export function IconPicker({
    value,
    onChange,
    names = ICON_NAMES,
    columns = 8,
    gridClassName,
    placeholder = "Search icons…",
}: IconPickerProps) {
    const [query, setQuery] = useState("");

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return names;
        return names.filter((n) => n.toLowerCase().includes(q) || (ICON_KEYWORDS[n] ?? "").includes(q));
    }, [query, names]);

    return (
        <div className="flex flex-col gap-2">
            <div className="relative grid items-center">
                <SearchLg aria-hidden="true" className="pointer-events-none absolute left-2.5 z-1 size-4 text-fg-quaternary" />
                <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={placeholder}
                    aria-label="Search icons"
                    className="w-full rounded-lg bg-primary py-2 pr-3 pl-8 text-sm text-primary shadow-xs ring-1 ring-primary transition duration-100 ease-linear ring-inset placeholder:text-placeholder focus:outline-2 focus:-outline-offset-2 focus:outline-brand"
                />
            </div>
            <div
                className={cx("grid max-h-44 gap-1.5 overflow-y-auto rounded-lg bg-secondary p-2", gridClassName)}
                style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
            >
                {filtered.map((name) => {
                    const Icon = ICON_REGISTRY[name];
                    const selected = value === name;
                    return (
                        <button
                            key={name}
                            type="button"
                            title={name}
                            aria-label={name}
                            aria-pressed={selected}
                            onClick={() => onChange(name)}
                            className={cx(
                                "flex aspect-square items-center justify-center rounded-md transition duration-100 ease-linear",
                                selected ? "bg-brand-solid text-white" : "bg-primary text-fg-secondary hover:bg-primary_hover",
                            )}
                        >
                            <Icon className="size-4" aria-hidden="true" />
                        </button>
                    );
                })}
                {filtered.length === 0 && (
                    <p className="py-3 text-center text-xs text-tertiary" style={{ gridColumn: `1 / -1` }}>
                        No icons match.
                    </p>
                )}
            </div>
        </div>
    );
}
