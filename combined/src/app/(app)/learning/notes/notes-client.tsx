"use client";

import { useState } from "react";
import { Edit01, FileSearch02, Plus, StickerSquare, Trash02 } from "@untitledui/icons";
import { toast } from "sonner";
import { Button } from "@/components/base/buttons/button";
import { Card, EmptyState, Field, NativeInput, NativeTextarea, SectionHeader } from "../_components/learning-ui";
import { FormModal } from "../_components/form-modal";
import { Markdown } from "../_components/markdown";
import { ShareControl } from "../_components/share-control";
import { formatDate } from "@/lib/dates";
import { createNote, deleteNote, updateNote } from "@/lib/actions/learning";
import { shareNote, unshareNote } from "@/lib/actions/learning-share";

export interface NoteRow {
    id: string;
    title: string;
    content: string | null;
    updatedAt: string;
    shareToken: string | null;
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

export function NotesClient({ notes }: { notes: NoteRow[] }) {
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<NoteRow | null>(null);
    const [selected, setSelected] = useState<NoteRow | null>(notes[0] ?? null);

    const active = notes.find((n) => n.id === selected?.id) ?? null;

    return (
        <div className="flex flex-col gap-6">
            <SectionHeader title="Notes" description="Capture and revisit study notes for everything you're learning." action={<Button size="md" iconLeading={Plus} onClick={() => { setEditing(null); setOpen(true); }}>New note</Button>} />

            {notes.length === 0 ? (
                <Card>
                    <EmptyState
                        icon={StickerSquare}
                        title="No notes yet"
                        description="Jot down key takeaways, summaries, and ideas as you study so nothing slips through the cracks."
                        action={<Button size="md" iconLeading={Plus} onClick={() => { setEditing(null); setOpen(true); }}>Write your first note</Button>}
                    />
                </Card>
            ) : (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                    <Card className="lg:col-span-1">
                        <div className="flex flex-col gap-2">
                            {notes.map((n) => (
                                <button
                                    key={n.id}
                                    type="button"
                                    onClick={() => setSelected(n)}
                                    className={
                                        "flex flex-col gap-0.5 rounded-lg p-3 text-left ring-1 ring-inset transition duration-100 ease-linear " +
                                        (active?.id === n.id ? "bg-secondary ring-brand" : "ring-secondary hover:bg-secondary_hover")
                                    }
                                >
                                    <span className="truncate text-sm font-medium text-primary">{n.title}</span>
                                    <span className="text-xs text-tertiary">{formatDate(n.updatedAt)}</span>
                                </button>
                            ))}
                        </div>
                    </Card>

                    <Card className="lg:col-span-2">
                        {active ? (
                            <div className="flex flex-col gap-3">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <h2 className="text-lg font-semibold text-primary">{active.title}</h2>
                                    <div className="flex items-center gap-1">
                                        <ShareControl
                                            token={active.shareToken}
                                            onShare={() => { const fd = new FormData(); fd.set("noteId", active.id); return shareNote(fd); }}
                                            onRevoke={() => { const fd = new FormData(); fd.set("noteId", active.id); return unshareNote(fd); }}
                                        />
                                        <Button size="sm" color="tertiary" iconLeading={Edit01} aria-label="Edit" onClick={() => { setEditing(active); setOpen(true); }} />
                                        <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} aria-label="Delete" onClick={() => { const fd = new FormData(); fd.set("id", active.id); run(deleteNote, fd, "Deleted"); setSelected(null); }} />
                                    </div>
                                </div>
                                {active.content ? <Markdown>{active.content}</Markdown> : <p className="text-sm text-tertiary">No content.</p>}
                            </div>
                        ) : (
                            <EmptyState
                                icon={FileSearch02}
                                title="Select a note to read"
                                description="Pick a note from the list, or create a new one to get started."
                                action={<Button size="sm" color="secondary" iconLeading={Plus} onClick={() => { setEditing(null); setOpen(true); }}>New note</Button>}
                                compact
                            />
                        )}
                    </Card>
                </div>
            )}

            <FormModal isOpen={open} onOpenChange={setOpen} title={editing ? "Edit note" : "New note"}>
                <form action={async (fd) => { const ok = await run(editing ? updateNote : createNote, fd, editing ? "Updated" : "Created"); if (ok) setOpen(false); }} className="flex flex-col gap-4">
                    {editing && <input type="hidden" name="id" value={editing.id} />}
                    <Field label="Title" htmlFor="title"><NativeInput id="title" name="title" defaultValue={editing?.title} required /></Field>
                    <Field label="Content" htmlFor="content"><NativeTextarea id="content" name="content" defaultValue={editing?.content ?? ""} className="min-h-48" /></Field>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setOpen(false)}>Cancel</Button>
                        <Button type="submit">{editing ? "Save" : "Create"}</Button>
                    </div>
                </form>
            </FormModal>
        </div>
    );
}
