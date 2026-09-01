"use client";

import { useMemo, useState } from "react";
import { Edit01, LayersThree01, Plus, RefreshCw01, Trash02 } from "@untitledui/icons";
import { toast } from "sonner";
import { Button } from "@/components/base/buttons/button";
import { Card, EmptyState, Field, NativeTextarea, SectionHeader } from "../_components/learning-ui";
import { FormModal } from "../_components/form-modal";
import { formatDate } from "@/lib/dates";
import { createFlashcard, deleteFlashcard, reviewFlashcard, updateFlashcard } from "@/lib/actions/learning";
import { shareDeck, unshareDeck } from "@/lib/actions/learning-share";
import { ShareControl } from "../_components/share-control";
import { isDue, type RecallGrade } from "@/lib/learning/srs";

export interface CardRow {
    id: string;
    front: string;
    back: string;
    reviewCount: number;
    lastReviewedAt: string | null;
    dueDate: string | null;
    intervalDays: number;
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

export function FlashcardsClient({ cards, deckShareToken }: { cards: CardRow[]; deckShareToken: string | null }) {
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<CardRow | null>(null);
    const [review, setReview] = useState(false);

    // Review queue = cards that are due now (SM-2). Cards are already sorted soonest-due first.
    const dueCards = useMemo(() => cards.filter((c) => isDue(c.dueDate ? new Date(c.dueDate) : null)), [cards]);
    const queue = useMemo(() => dueCards.map((c) => c.id), [dueCards]);
    const [idx, setIdx] = useState(0);
    const [flipped, setFlipped] = useState(false);

    const current = cards.find((c) => c.id === queue[idx]) ?? null;

    function next() {
        setFlipped(false);
        setIdx((i) => (i + 1) % Math.max(1, queue.length));
    }

    async function grade(g: RecallGrade) {
        if (!current) return;
        const fd = new FormData();
        fd.set("id", current.id);
        fd.set("grade", g);
        await run(reviewFlashcard, fd, g === "again" ? "We'll show it again soon" : "Scheduled");
        next();
    }

    return (
        <div className="flex flex-col gap-6">
            <SectionHeader
                title="Flashcards"
                description={cards.length ? `${cards.length} card${cards.length === 1 ? "" : "s"} · ${dueCards.length} due now — spaced repetition (SM-2) schedules each card for you.` : "Build a deck and turn study notes into long-term memory."}
                action={
                    <div className="flex flex-wrap gap-2">
                        {cards.length > 0 && (
                            <ShareControl token={deckShareToken} onShare={() => shareDeck()} onRevoke={() => unshareDeck()} label="Share deck" size="md" />
                        )}
                        <Button size="md" color="secondary" iconLeading={RefreshCw01} isDisabled={dueCards.length === 0} onClick={() => { setIdx(0); setFlipped(false); setReview(true); }}>
                            {dueCards.length ? `Review ${dueCards.length} due` : "All caught up"}
                        </Button>
                        <Button size="md" iconLeading={Plus} onClick={() => { setEditing(null); setOpen(true); }}>Add card</Button>
                    </div>
                }
            />

            {cards.length === 0 ? (
                <Card>
                    <EmptyState
                        icon={LayersThree01}
                        title="Your deck is empty"
                        description="Create your first flashcard, then review with spaced repetition to remember more with less effort."
                        action={<Button size="md" iconLeading={Plus} onClick={() => { setEditing(null); setOpen(true); }}>Add your first card</Button>}
                    />
                </Card>
            ) : (
                <Card className="overflow-x-auto p-0">
                    <table className="w-full min-w-[640px] text-sm">
                        <thead>
                            <tr className="border-b border-secondary text-left text-tertiary">
                                <th className="px-5 py-3 font-medium">Front</th>
                                <th className="px-5 py-3 font-medium">Back</th>
                                <th className="px-5 py-3 font-medium">Reviews</th>
                                <th className="px-5 py-3 font-medium">Last reviewed</th>
                                <th className="px-5 py-3" />
                            </tr>
                        </thead>
                        <tbody>
                            {cards.map((c) => (
                                <tr key={c.id} className="border-b border-secondary transition duration-100 ease-linear last:border-0 hover:bg-secondary_hover">
                                    <td className="max-w-[240px] truncate px-5 py-3 text-primary">{c.front}</td>
                                    <td className="max-w-[240px] truncate px-5 py-3 text-tertiary">{c.back}</td>
                                    <td className="px-5 py-3 text-tertiary tabular-nums">{c.reviewCount}</td>
                                    <td className="px-5 py-3 text-tertiary">{c.lastReviewedAt ? formatDate(c.lastReviewedAt) : "Never"}</td>
                                    <td className="px-5 py-3 text-right">
                                        <div className="flex justify-end gap-1">
                                            <Button size="sm" color="tertiary" iconLeading={Edit01} aria-label="Edit" onClick={() => { setEditing(c); setOpen(true); }} />
                                            <Button
                                                size="sm"
                                                color="tertiary-destructive"
                                                iconLeading={Trash02}
                                                aria-label="Delete"
                                                onClick={() => {
                                                    const fd = new FormData();
                                                    fd.set("id", c.id);
                                                    run(deleteFlashcard, fd, "Deleted");
                                                }}
                                            />
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </Card>
            )}

            {/* Create / edit modal */}
            <FormModal isOpen={open} onOpenChange={setOpen} title={editing ? "Edit card" : "Add card"}>
                <form
                    action={async (fd) => {
                        const ok = await run(editing ? updateFlashcard : createFlashcard, fd, editing ? "Updated" : "Added");
                        if (ok) setOpen(false);
                    }}
                    className="flex flex-col gap-4"
                >
                    {editing && <input type="hidden" name="id" value={editing.id} />}
                    <Field label="Front" htmlFor="front"><NativeTextarea id="front" name="front" defaultValue={editing?.front} required /></Field>
                    <Field label="Back" htmlFor="back"><NativeTextarea id="back" name="back" defaultValue={editing?.back} required /></Field>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setOpen(false)}>Cancel</Button>
                        <Button type="submit">{editing ? "Save" : "Add"}</Button>
                    </div>
                </form>
            </FormModal>

            {/* Review mode modal */}
            <FormModal isOpen={review} onOpenChange={setReview} title="Review" description={current ? `Card ${idx + 1} of ${queue.length}` : undefined}>
                {current ? (
                    <div className="flex flex-col gap-4">
                        <button
                            type="button"
                            onClick={() => setFlipped((f) => !f)}
                            className="flex min-h-40 items-center justify-center rounded-xl bg-secondary p-6 text-center ring-1 ring-secondary ring-inset transition hover:bg-secondary_hover"
                        >
                            <div>
                                <p className="mb-1 text-xs font-medium tracking-wide text-tertiary uppercase">{flipped ? "Back" : "Front"}</p>
                                <p className="text-lg font-medium text-primary whitespace-pre-wrap">{flipped ? current.back : current.front}</p>
                                {!flipped && <p className="mt-3 text-xs text-tertiary">Tap to flip</p>}
                            </div>
                        </button>
                        {flipped ? (
                            <div className="grid grid-cols-4 gap-2">
                                <Button size="sm" color="secondary-destructive" onClick={() => grade("again")}>Again</Button>
                                <Button size="sm" color="secondary" onClick={() => grade("hard")}>Hard</Button>
                                <Button size="sm" color="secondary" onClick={() => grade("good")}>Good</Button>
                                <Button size="sm" onClick={() => grade("easy")}>Easy</Button>
                            </div>
                        ) : (
                            <Button color="secondary" onClick={() => setFlipped(true)}>Show answer</Button>
                        )}
                    </div>
                ) : (
                    <p className="py-6 text-center text-sm text-tertiary">No cards to review.</p>
                )}
            </FormModal>
        </div>
    );
}
