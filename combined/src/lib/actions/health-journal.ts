"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { int, parseDateOnly, str } from "./health-shared";

export const REALMS = ["physical_health", "mental_health", "relationships", "work", "finances", "growth"] as const;

export async function upsertJournalEntry(fd: FormData) {
    const user = await requireUser();
    const date = parseDateOnly(str(fd, "date"));

    const realmRatings = REALMS.map((realm) => ({ realm, rating: int(fd, `realm_${realm}`) })).filter((r) => r.rating != null) as { realm: string; rating: number }[];

    const data = {
        reflection: str(fd, "reflection"),
        gratitude: str(fd, "gratitude"),
        overallRating: int(fd, "overallRating"),
    };

    const existing = await db.journalEntry.findFirst({ where: { userId: user.id, date } });
    if (existing) {
        await db.$transaction([
            db.realmRating.deleteMany({ where: { entryId: existing.id } }),
            db.journalEntry.update({ where: { id: existing.id }, data: { ...data, realmRatings: { create: realmRatings } } }),
        ]);
    } else {
        await db.journalEntry.create({ data: { userId: user.id, date, ...data, realmRatings: { create: realmRatings } } });
    }
    revalidatePath("/health/journal");
    revalidatePath("/health");
}

export async function deleteJournalEntry(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.journalEntry.deleteMany({ where: { id, userId: user.id } });
    revalidatePath("/health/journal");
    revalidatePath("/health");
}
