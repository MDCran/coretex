import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { IncomeClient, type EntryRow, type StreamRow } from "./income-client";

export default async function IncomePage() {
    const user = await requireUser();
    const [streams, entries] = await Promise.all([
        db.incomeStream.findMany({ where: { userId: user.id }, orderBy: { name: "asc" } }),
        db.incomeEntry.findMany({ where: { userId: user.id }, orderBy: { receivedAt: "desc" }, take: 500 }),
    ]);

    const streamRows: StreamRow[] = streams.map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.kind,
        notes: s.notes,
        archived: s.archived,
    }));
    const entryRows: EntryRow[] = entries.map((e) => ({
        id: e.id,
        streamId: e.streamId,
        amount: Number(e.amount),
        receivedAt: e.receivedAt.toISOString(),
        notes: e.notes,
    }));

    return <IncomeClient streams={streamRows} entries={entryRows} />;
}
