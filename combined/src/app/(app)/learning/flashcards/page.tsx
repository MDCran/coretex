import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { FlashcardsClient } from "./flashcards-client";

export default async function FlashcardsPage() {
    const user = await requireUser();
    // Review order: soonest-due first (never-scheduled cards sort first via nulls).
    const [cards, deckShare] = await Promise.all([
        db.flashcard.findMany({
            where: { userId: user.id },
            orderBy: [{ dueDate: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
        }),
        db.learningShare.findFirst({ where: { userId: user.id, kind: "deck" }, select: { token: true } }),
    ]);

    return (
        <FlashcardsClient
            deckShareToken={deckShare?.token ?? null}
            cards={cards.map((c) => ({
                id: c.id,
                front: c.front,
                back: c.back,
                reviewCount: c.reviewCount,
                lastReviewedAt: c.lastReviewedAt?.toISOString() ?? null,
                dueDate: c.dueDate?.toISOString() ?? null,
                intervalDays: c.intervalDays,
            }))}
        />
    );
}
