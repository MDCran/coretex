"use client";

// Coretex — Calendar categories manager. Full CRUD over the user's calendar
// categories (each drives the default color/label/icon for its events). Mirrors the
// Email categories manager: Untitled UI add button, per-row Edit/Delete, an
// IconPicker + ColorPicker in a modal. Persists by computing the whole next array →
// calendarSetCategories.

import { useState } from "react";
import type { CalendarCategory } from "@repo/coretex/types";
import { Lock01, Plus, Trash01, XClose } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { ProjectIcon } from "../ui/project-icon";
import { IconPicker } from "../ui/icon-picker";
import { ColorPicker } from "../ui/color-picker";
import type { CoretexActions } from "../use-coretex";
import { BUILTIN_CALENDAR_CATEGORY_IDS, MODULE_CALENDAR_CATEGORY_IDS } from "./categories";

function uid(): string {
    return `cat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export const CalendarCategoriesManager = ({ categories, actions }: { categories: CalendarCategory[]; actions: CoretexActions }) => {
    const [editing, setEditing] = useState<CalendarCategory | null>(null);
    const [isNew, setIsNew] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<CalendarCategory | null>(null);

    const write = (next: CalendarCategory[]): void => {
        actions.calendarSetCategories(next);
    };
    const save = (cat: CalendarCategory): void => {
        const exists = categories.some((c) => c.id === cat.id);
        write(exists ? categories.map((c) => (c.id === cat.id ? cat : c)) : [...categories, cat]);
        setEditing(null);
    };
    const remove = (id: string): void => write(categories.filter((c) => c.id !== id));

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
                {categories.length === 0 ? (
                    <p className="text-sm text-tertiary">No categories yet — add one to color your events.</p>
                ) : (
                    categories.map((c) => (
                        <div key={c.id} className="flex items-center gap-3 rounded-lg px-3 py-2" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}>
                            {c.icon ? <ProjectIcon icon={c.icon} color={c.color} size={28} /> : <span className="flex size-7 items-center justify-center rounded-md text-base" style={{ background: c.color + "22" }}>🏷️</span>}
                            <div className="min-w-0 flex-1">
                                <p className="flex items-center gap-1.5 truncate text-sm font-medium text-primary">{c.label}{MODULE_CALENDAR_CATEGORY_IDS.has(c.id) && <span title="Connected module calendar"><Lock01 className="size-3 text-quaternary" /></span>}</p>
                                {MODULE_CALENDAR_CATEGORY_IDS.has(c.id) && <p className="text-[11px] text-tertiary">Connected to a Coretex module</p>}
                            </div>
                            <span className="size-3 shrink-0 rounded-full" style={{ background: c.color }} />
                            {!MODULE_CALENDAR_CATEGORY_IDS.has(c.id) && <Button size="sm" color="link-color" onClick={() => { setIsNew(false); setEditing({ ...c }); }}>Edit</Button>}
                            {!BUILTIN_CALENDAR_CATEGORY_IDS.has(c.id) && <Button size="sm" color="tertiary-destructive" iconLeading={Trash01} onClick={() => setPendingDelete(c)}>Delete</Button>}
                        </div>
                    ))
                )}
            </div>
            <div>
                <Button size="sm" color="secondary" iconLeading={Plus} onClick={() => { setIsNew(true); setEditing({ id: uid(), label: "", color: "#ef4242", icon: "Calendar" }); }}>
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
                                <span className="text-xs font-medium text-secondary">Label</span>
                                <Input value={editing.label} placeholder="e.g. Travel" onChange={(v: string) => setEditing({ ...editing, label: v })} />
                            </label>
                            <div className="flex flex-col gap-1">
                                <span className="text-xs font-medium text-secondary">Icon</span>
                                <IconPicker value={editing.icon} color={editing.color} onChange={(name) => setEditing({ ...editing, icon: name })} />
                            </div>
                            <div className="flex flex-col gap-1">
                                <span className="text-xs font-medium text-secondary">Color</span>
                                <ColorPicker value={editing.color ?? ""} onChange={(c) => setEditing({ ...editing, color: c || "#ef4242" })} />
                            </div>
                        </div>
                        <div className="mt-5 flex justify-end gap-2">
                            <Button size="sm" color="secondary" onClick={() => setEditing(null)}>Cancel</Button>
                            <Button size="sm" color="primary" isDisabled={!editing.label.trim()} onClick={() => save(editing)}>{isNew ? "Add" : "Save"}</Button>
                        </div>
                    </div>
                </div>
            )}

            {pendingDelete && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay/70 p-4" onMouseDown={() => setPendingDelete(null)}>
                    <div className="w-full max-w-sm rounded-2xl border border-secondary bg-primary p-5 shadow-xl" onMouseDown={(event) => event.stopPropagation()}>
                        <div className="flex size-10 items-center justify-center rounded-full bg-error-primary"><Trash01 className="size-5 text-error-primary" /></div>
                        <h2 className="mt-3 text-md font-semibold text-primary">Delete “{pendingDelete.label}”?</h2>
                        <p className="mt-1 text-sm text-tertiary">Existing events keep their data, but this calendar will disappear from your managed list.</p>
                        <div className="mt-5 flex justify-end gap-2"><Button size="sm" color="secondary" onClick={() => setPendingDelete(null)}>Cancel</Button><Button size="sm" color="primary-destructive" onClick={() => { remove(pendingDelete.id); setPendingDelete(null); }}>Delete calendar</Button></div>
                    </div>
                </div>
            )}
        </div>
    );
};
