"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Edit01, Plus, Tag01, Trash02 } from "@untitledui/icons";
import { toast } from "sonner";
import { Button } from "@/components/base/buttons/button";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { cx } from "@/utils/cx";
import { IconPicker } from "@/components/application/icon-picker/icon-picker";
import { resolveIcon } from "@/components/application/icon-picker/icon-registry";
import { Card, Field, FormModal, NativeInput, categoryColor, CATEGORY_COLOR_NAMES } from "../_components/calendar-ui";
import { createCategory, deleteCategory, updateCategory } from "@/lib/actions/calendar";

interface CategoryRow {
    id: string;
    name: string;
    color: string;
    icon: string | null;
    eventCount: number;
}

async function run(action: (fd: FormData) => Promise<void>, fd: FormData, ok = "Saved") {
    try {
        await action(fd);
        toast.success(ok);
        return true;
    } catch (e) {
        toast.error(e instanceof Error ? e.message : "Something went wrong");
        return false;
    }
}

export function CategoriesClient({ categories }: { categories: CategoryRow[] }) {
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<CategoryRow | null>(null);
    const [color, setColor] = useState("neutral");
    const [icon, setIcon] = useState<string>("Calendar");

    function openNew() {
        setEditing(null);
        setColor("neutral");
        setIcon("Calendar");
        setOpen(true);
    }
    function openEdit(c: CategoryRow) {
        setEditing(c);
        setColor(c.color);
        setIcon(c.icon ?? "Calendar");
        setOpen(true);
    }

    return (
        <div className="flex flex-col gap-6">
            <Button size="sm" color="link-gray" iconLeading={ArrowLeft} href="/calendar" className="self-start">Back to calendar</Button>
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                    <h2 className="text-lg font-semibold text-primary">Event categories</h2>
                    <p className="text-sm text-tertiary">Colour-code and label your calendar so every event is easy to scan.</p>
                </div>
                <Button size="md" iconLeading={Plus} onClick={openNew}>Add category</Button>
            </div>

            {categories.length === 0 ? (
                <Card className="flex flex-col items-center gap-3 py-10 text-center">
                    <FeaturedIcon icon={Tag01} color="brand" theme="light" size="lg" />
                    <div className="flex max-w-sm flex-col gap-1">
                        <p className="text-md font-semibold text-primary">Organise your calendar with categories</p>
                        <p className="text-sm text-tertiary">Create colour-coded labels like Work, Health or Personal, then assign them to events for an at-a-glance overview.</p>
                    </div>
                    <Button size="sm" iconLeading={Plus} onClick={openNew}>Add your first category</Button>
                </Card>
            ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {categories.map((c) => {
                        const Icon = resolveIcon(c.icon);
                        const col = categoryColor(c.color);
                        return (
                            <Card key={c.id} className="flex items-center justify-between gap-3">
                                <div className="flex min-w-0 items-center gap-3">
                                    <span className={cx("flex size-9 shrink-0 items-center justify-center rounded-lg", col.chip)}>
                                        <Icon className="size-4.5" aria-hidden="true" />
                                    </span>
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className={cx("size-2.5 shrink-0 rounded-full", col.dot)} />
                                            <p className="truncate text-sm font-medium text-primary">{c.name}</p>
                                        </div>
                                        <p className="text-xs text-tertiary">{c.eventCount} event{c.eventCount === 1 ? "" : "s"}</p>
                                    </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                    <Button size="sm" color="tertiary" iconLeading={Edit01} aria-label="Edit" onClick={() => openEdit(c)} />
                                    <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} aria-label="Delete" onClick={() => { const fd = new FormData(); fd.set("id", c.id); run(deleteCategory, fd, "Deleted"); }} />
                                </div>
                            </Card>
                        );
                    })}
                </div>
            )}

            <p className="text-sm text-tertiary">
                Need more? Create as many categories as you like. <Link href="/calendar" className="text-brand-secondary hover:underline">Open the calendar</Link> to assign them to events.
            </p>

            <FormModal isOpen={open} onOpenChange={setOpen} title={editing ? "Edit category" : "Add category"}>
                <form action={async (fd) => { fd.set("color", color); fd.set("icon", icon); const ok = await run(editing ? updateCategory : createCategory, fd, editing ? "Updated" : "Added"); if (ok) setOpen(false); }} className="flex flex-col gap-4">
                    {editing && <input type="hidden" name="id" value={editing.id} />}
                    <Field label="Name" htmlFor="name"><NativeInput id="name" name="name" defaultValue={editing?.name} required /></Field>
                    <Field label="Color">
                        <div className="flex flex-wrap gap-2">
                            {CATEGORY_COLOR_NAMES.map((co) => (
                                <button
                                    key={co}
                                    type="button"
                                    aria-label={co}
                                    aria-pressed={color === co}
                                    onClick={() => setColor(co)}
                                    className={cx("flex size-8 items-center justify-center rounded-full ring-2 ring-inset transition", color === co ? "ring-brand" : "ring-transparent hover:ring-secondary")}
                                >
                                    <span className={cx("size-5 rounded-full", categoryColor(co).dot)} />
                                </button>
                            ))}
                        </div>
                    </Field>
                    <Field label="Icon" hint="Pick an icon to show on event pills and filters.">
                        <IconPicker value={icon} onChange={setIcon} />
                    </Field>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setOpen(false)}>Cancel</Button>
                        <Button type="submit">{editing ? "Save" : "Add"}</Button>
                    </div>
                </form>
            </FormModal>
        </div>
    );
}
