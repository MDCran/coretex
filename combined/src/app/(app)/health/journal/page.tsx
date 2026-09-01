import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { JournalClient, type JournalRow } from "./journal-client";

export default async function JournalPage() {
    const user = await requireUser();
    const entries = await db.journalEntry.findMany({
        where: { userId: user.id },
        orderBy: { date: "desc" },
        take: 180,
        include: { realmRatings: true },
    });

    const rows: JournalRow[] = entries.map((e) => ({
        id: e.id,
        date: e.date.toISOString().slice(0, 10),
        reflection: e.reflection,
        gratitude: e.gratitude,
        overallRating: e.overallRating,
        realmRatings: e.realmRatings.map((r) => ({ realm: r.realm, rating: r.rating })),
    }));

    return <JournalClient entries={rows} />;
}
