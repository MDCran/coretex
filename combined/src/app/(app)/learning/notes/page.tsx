import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { NotesClient } from "./notes-client";

export default async function NotesPage() {
    const user = await requireUser();
    const [notes, shares] = await Promise.all([
        db.learningNote.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" } }),
        db.learningShare.findMany({ where: { userId: user.id, kind: "note" }, select: { noteId: true, token: true } }),
    ]);
    const tokenByNote = new Map(shares.map((s) => [s.noteId, s.token]));

    return (
        <NotesClient
            notes={notes.map((n) => ({
                id: n.id,
                title: n.title,
                content: n.content,
                updatedAt: n.updatedAt.toISOString(),
                shareToken: tokenByNote.get(n.id) ?? null,
            }))}
        />
    );
}
