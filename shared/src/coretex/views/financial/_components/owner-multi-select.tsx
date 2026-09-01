// @ts-nocheck
import { useMemo, useState } from "react";
import { Check, SearchLg, X } from "@untitledui/icons";
import { Avatar } from "@/components/base/avatar/avatar";
import { cx } from "@/utils/cx";

export interface OwnerOption {
    id: string;
    name: string;
    avatarUrl: string | null;
}

/**
 * Form-friendly multi-owner picker. Renders selected owners as removable avatar
 * chips and a searchable add list. Emits one hidden input per selected id under
 * `name` (default "ownerIds") so it submits with a plain <form action>.
 */
export function OwnerMultiSelect({
    options,
    defaultSelectedIds = [],
    name = "ownerIds",
    label = "Owners",
}: {
    options: OwnerOption[];
    defaultSelectedIds?: string[];
    name?: string;
    label?: string;
}) {
    const [selected, setSelected] = useState<string[]>(defaultSelectedIds);
    const [query, setQuery] = useState("");
    const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);

    const available = useMemo(() => {
        const q = query.trim().toLowerCase();
        return options.filter((o) => !selected.includes(o.id) && (!q || o.name.toLowerCase().includes(q)));
    }, [options, selected, query]);

    function add(id: string) {
        setSelected((s) => (s.includes(id) ? s : [...s, id]));
        setQuery("");
    }
    function remove(id: string) {
        setSelected((s) => s.filter((x) => x !== id));
    }

    return (
        <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-secondary">{label}</span>
            {selected.map((id) => (
                <input key={id} type="hidden" name={name} value={id} />
            ))}

            {selected.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {selected.map((id) => {
                        const o = byId.get(id);
                        if (!o) return null;
                        return (
                            <span key={id} className="inline-flex items-center gap-1.5 rounded-full bg-secondary py-1 pr-1 pl-1.5 text-xs font-medium text-secondary">
                                <Avatar size="xs" src={o.avatarUrl ?? undefined} alt={o.name} initials={o.name.slice(0, 2).toUpperCase()} />
                                {o.name}
                                <button type="button" aria-label={`Remove ${o.name}`} onClick={() => remove(id)} className="rounded-full p-0.5 hover:bg-secondary_hover">
                                    <X className="size-3.5 text-fg-quaternary" />
                                </button>
                            </span>
                        );
                    })}
                </div>
            )}

            {options.length === 0 ? (
                <p className="text-xs text-tertiary">No contacts yet — add people in Social to assign owners.</p>
            ) : (
                <div className="rounded-lg ring-1 ring-primary ring-inset">
                    <div className="flex items-center gap-2 border-b border-secondary px-3 py-2">
                        <SearchLg className="size-4 text-fg-quaternary" aria-hidden="true" />
                        <input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search contacts to add…"
                            className="w-full bg-transparent text-sm text-primary outline-hidden placeholder:text-placeholder"
                        />
                    </div>
                    <div className="max-h-40 overflow-y-auto p-1">
                        {available.length === 0 ? (
                            <p className="px-2 py-2 text-xs text-tertiary">{query ? "No matches." : "All contacts selected."}</p>
                        ) : (
                            available.map((o) => (
                                <button
                                    key={o.id}
                                    type="button"
                                    onClick={() => add(o.id)}
                                    className={cx(
                                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-primary transition duration-100 ease-linear hover:bg-primary_hover",
                                    )}
                                >
                                    <Avatar size="xs" src={o.avatarUrl ?? undefined} alt={o.name} initials={o.name.slice(0, 2).toUpperCase()} />
                                    <span className="flex-1 truncate">{o.name}</span>
                                    <Check className="size-4 text-fg-quaternary opacity-0" aria-hidden="true" />
                                </button>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
