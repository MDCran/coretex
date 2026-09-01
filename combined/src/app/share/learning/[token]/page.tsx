import { notFound } from "next/navigation";
import { GraduationHat01, LayersThree01 } from "@untitledui/icons";
import { db } from "@/lib/db";
import { Markdown } from "@/app/(app)/learning/_components/markdown";

export const dynamic = "force-dynamic";

/**
 * Public, view-only page for a shared learning note or flashcard deck.
 * Lives outside the (app) route group, so it requires no authentication —
 * anyone with the unguessable token link can read it.
 */
export default async function SharedLearningPage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    const share = await db.learningShare.findUnique({ where: { token } });
    if (!share) notFound();

    const owner = await db.user.findUnique({ where: { id: share.userId }, select: { name: true } });
    const sharedBy = owner?.name ? `Shared by ${owner.name}` : "Shared with you";

    return (
        <div className="min-h-screen bg-secondary">
            <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10">
                <header className="flex items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-lg bg-brand-secondary">
                        {share.kind === "deck" ? (
                            <LayersThree01 className="size-5 text-fg-brand-primary" aria-hidden="true" />
                        ) : (
                            <GraduationHat01 className="size-5 text-fg-brand-primary" aria-hidden="true" />
                        )}
                    </span>
                    <div>
                        <p className="text-xs font-medium tracking-wide text-tertiary uppercase">View-only · {sharedBy}</p>
                        <h1 className="text-lg font-semibold text-primary">{share.kind === "deck" ? "Flashcard deck" : "Shared note"}</h1>
                    </div>
                </header>

                {share.kind === "note" ? <SharedNote shareUserId={share.userId} noteId={share.noteId} /> : <SharedDeck userId={share.userId} />}

                <footer className="pt-4 text-center text-xs text-tertiary">Shared from LifeOS Learning · read-only</footer>
            </div>
        </div>
    );
}

async function SharedNote({ shareUserId, noteId }: { shareUserId: string; noteId: string | null }) {
    if (!noteId) notFound();
    const note = await db.learningNote.findFirst({ where: { id: noteId, userId: shareUserId } });
    if (!note) notFound();
    return (
        <article className="rounded-xl bg-primary p-6 ring-1 ring-secondary ring-inset">
            <h2 className="mb-3 text-xl font-semibold text-primary">{note.title}</h2>
            {note.content ? <Markdown>{note.content}</Markdown> : <p className="text-sm text-tertiary">This note is empty.</p>}
        </article>
    );
}

async function SharedDeck({ userId }: { userId: string }) {
    const cards = await db.flashcard.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, take: 500 });
    if (!cards.length) return <p className="text-sm text-tertiary">This deck has no cards.</p>;
    return (
        <div className="flex flex-col gap-3">
            <p className="text-sm text-tertiary">{cards.length} card{cards.length === 1 ? "" : "s"}</p>
            {cards.map((c) => (
                <div key={c.id} className="rounded-xl bg-primary p-4 ring-1 ring-secondary ring-inset">
                    <p className="text-sm font-medium whitespace-pre-wrap text-primary">{c.front}</p>
                    <hr className="my-3 border-secondary" />
                    <p className="text-sm whitespace-pre-wrap text-secondary">{c.back}</p>
                </div>
            ))}
        </div>
    );
}
