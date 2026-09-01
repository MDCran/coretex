"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseForm, zId } from "@/lib/learning/zod";

/**
 * Public view-only sharing for a note or the user's flashcard deck.
 * A share is identified by an unguessable token, resolved by /share/learning/[token].
 */

function newToken(): string {
    return randomUUID().replace(/-/g, "");
}

/** Create (or reuse) a public link for a note. Returns the share token. */
export async function shareNote(fd: FormData): Promise<{ token: string }> {
    const user = await requireUser();
    const { noteId } = parseForm(z.object({ noteId: zId }), fd);

    const note = await db.learningNote.findFirst({ where: { id: noteId, userId: user.id }, select: { id: true } });
    if (!note) throw new Error("Note not found.");

    const existing = await db.learningShare.findFirst({ where: { userId: user.id, kind: "note", noteId } });
    const token = existing?.token ?? newToken();
    if (!existing) await db.learningShare.create({ data: { userId: user.id, kind: "note", noteId, token } });

    revalidatePath("/learning/notes");
    return { token };
}

/** Revoke a note's public link. */
export async function unshareNote(fd: FormData): Promise<void> {
    const user = await requireUser();
    const { noteId } = parseForm(z.object({ noteId: zId }), fd);
    await db.learningShare.deleteMany({ where: { userId: user.id, kind: "note", noteId } });
    revalidatePath("/learning/notes");
}

/** Create (or reuse) a public link for the user's whole flashcard deck. Returns the token. */
export async function shareDeck(): Promise<{ token: string }> {
    const user = await requireUser();
    const existing = await db.learningShare.findFirst({ where: { userId: user.id, kind: "deck" } });
    const token = existing?.token ?? newToken();
    if (!existing) await db.learningShare.create({ data: { userId: user.id, kind: "deck", token } });
    revalidatePath("/learning/flashcards");
    return { token };
}

/** Revoke the flashcard deck's public link. */
export async function unshareDeck(): Promise<void> {
    const user = await requireUser();
    await db.learningShare.deleteMany({ where: { userId: user.id, kind: "deck" } });
    revalidatePath("/learning/flashcards");
}
