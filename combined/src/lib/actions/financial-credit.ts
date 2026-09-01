"use server";

import { revalidatePath } from "next/cache";
import type { CreditBureau } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { int, parseDateOnly, str } from "./financial-shared";

const BUREAUS: CreditBureau[] = ["EQUIFAX", "EXPERIAN", "TRANSUNION"];

function bureau(fd: FormData): CreditBureau | null {
    const v = str(fd, "bureau");
    return BUREAUS.includes(v as CreditBureau) ? (v as CreditBureau) : null;
}

/** Reads + validates the score field. Credit scores live in the 300–850 range. */
function scoreOf(fd: FormData): number {
    const score = int(fd, "score");
    if (score === null) throw new Error("Score is required");
    if (score < 300 || score > 850) throw new Error("Score must be between 300 and 850");
    return score;
}

export async function createCreditScore(fd: FormData) {
    const user = await requireUser();
    const score = scoreOf(fd);
    const notes = str(fd, "notes");
    await db.creditScoreEntry.create({
        data: { userId: user.id, score, scoreDate: parseDateOnly(str(fd, "scoreDate")), bureau: bureau(fd), notes },
    });
    revalidatePath("/financial/credit");
    revalidatePath("/financial");
}

export async function updateCreditScore(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const existing = await db.creditScoreEntry.findFirst({ where: { id, userId: user.id } });
    if (!existing) throw new Error("Not found");
    const score = scoreOf(fd);
    const notes = str(fd, "notes");
    await db.creditScoreEntry.update({
        where: { id },
        data: { score, scoreDate: parseDateOnly(str(fd, "scoreDate")), bureau: bureau(fd), notes },
    });
    revalidatePath("/financial/credit");
    revalidatePath("/financial");
}

export async function deleteCreditScore(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.creditScoreEntry.deleteMany({ where: { id, userId: user.id } });
    revalidatePath("/financial/credit");
    revalidatePath("/financial");
}
