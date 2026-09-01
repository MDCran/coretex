// @ts-nocheck
"use client";

// Coretex — Email categories manager. Full CRUD over the user's mail categories
// (the AI sorter classifies into exactly this set). Each category has a name, color,
// an Untitled UI icon (preferred) or emoji, and an optional description that guides
// the classifier. Persists by computing the whole next array → emailSetCategories.

import { useState } from "react";
import type { EmailCategory } from "@repo/coretex/types";
import { Plus, Trash01, XClose } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { ProjectIcon } from "../ui/project-icon";
import { IconPicker } from "../ui/icon-picker";
import { ColorPicker } from "../ui/color-picker";
import type { CoretexActions } from "../use-coretex";

function uid(): string {
    return `cat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export const EmailCategoriesManager = ({ categories, actions }: { categories: EmailCategory[]; actions: CoretexActions }) => {
    const [editing, setEditing] = useState<EmailCategory | null>(null);
    const [isNew, setIsNew] = useState(false);

    const write = (next: EmailCategory[]): void => {
        actions.emailSetCategories(next);
    };
    const save = (cat: EmailCategory): void => {
        const exists = categories.some((c) => c.id === cat.id);
        write(exists ? categories.map((c) => (c.id === cat.id ? cat : c)) : [...categories, cat]);
        setEditing(null);
    };
    const remove = (id: string): void => write(categories.filter((c) => c.id !== id));

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
                {categories.length === 0 ? (
                    <p className="text-sm text-tertiary">No categories yet — add one for the AI sorter to use.</p>
                ) : (
                    categories.map((c) => (
                        <div key={c.id} className="flex items-center gap-3 rounded-lg px-3 py-2" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}>
                            {c.icon ? <ProjectIcon icon={c.icon} color={c.color} size={28} /> : <span className="flex size-7 items-center justify-center rounded-md text-base" style={{ background: c.color + "22" }}>{c.emoji || "🏷️"}</span>}
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium text-primary">{c.name}</p>
                                {c.description && <p className="truncate text-xs text-tertiary">{c.description}</p>}
                            </div>
                            <span className="size-3 shrink-0 rounded-full" style={{ background: c.color }} />
                            <Button size="sm" color="link-color" onClick={() => { setIsNew(false); setEditing({ ...c }); }}>Edit</Button>
                            <Button size="sm" color="tertiary-destructive" iconLeading={Trash01} onClick={() => remove(c.id)}>Delete</Button>
                        </div>
                    ))
                )}
            </div>
            <div>
                <Button size="sm" color="secondary" iconLeading={Plus} onClick={() => { setIsNew(true); setEditing({ id: uid(), name: "", color: "#7f56d9", emoji: "", icon: "Tag01", description: "" }); }}>
                    Add category
                </Button>
            </div>

            {editing && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }} onMouseDown={() => setEditing(null)}>
                    <div className="w-full max-w-md rounded-2xl p-5 shadow-xl" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }} onMouseDown={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-2">
                            <h2 className="text-sm font-semibold text-primary">{isNew ? "Add category" : "Edit category"}</h2>
                            <button type="button" onClick={() => setEditing(null)} className="ml-auto rounded p-1 text-quaternary hover:bg-[var(--surface-2)]"><XClose className="size-4" /></button>
                        </div>
                        <div className="mt-4 flex flex-col gap-3">
                            <label className="flex flex-col gap-1">
                                <span className="text-xs font-medium text-secondary">Name</span>
                                <Input value={editing.name} placeholder="e.g. Finance" onChange={(v: string) => setEditing({ ...editing, name: v })} />
                            </label>
                            <label className="flex flex-col gap-1">
                                <span className="text-xs font-medium text-secondary">Description (guides the AI sorter)</span>
                                <Input value={editing.description ?? ""} placeholder="Invoices, receipts, billing…" onChange={(v: string) => setEditing({ ...editing, description: v })} />
                            </label>
                            <div className="flex flex-col gap-1">
                                <span className="text-xs font-medium text-secondary">Icon</span>
                                <IconPicker value={editing.icon} color={editing.color} onChange={(name) => setEditing({ ...editing, icon: name })} />
                            </div>
                            <div className="flex items-center gap-4">
                                <div className="flex flex-col gap-1">
                                    <span className="text-xs font-medium text-secondary">Color</span>
                                    <ColorPicker value={editing.color ?? ""} onChange={(c) => setEditing({ ...editing, color: c || "#7f56d9" })} />
                                </div>
                                <label className="flex flex-col gap-1">
                                    <span className="text-xs font-medium text-secondary">Emoji (fallback)</span>
                                    <Input value={editing.emoji} placeholder="💰" onChange={(v: string) => setEditing({ ...editing, emoji: v })} className="w-24" />
                                </label>
                            </div>
                        </div>
                        <div className="mt-5 flex justify-end gap-2">
                            <Button size="sm" color="secondary" onClick={() => setEditing(null)}>Cancel</Button>
                            <Button size="sm" color="primary" isDisabled={!editing.name.trim()} onClick={() => save(editing)}>{isNew ? "Add" : "Save"}</Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
