"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { bool, num, parseDateTime, parseOptionalDateTime, str } from "./financial-shared";

export async function createIncomeStream(fd: FormData) {
    const user = await requireUser();
    const name = str(fd, "name");
    if (!name) throw new Error("Name is required");
    try {
        await db.incomeStream.create({
            data: { userId: user.id, name, kind: str(fd, "kind"), notes: str(fd, "notes") },
        });
    } catch {
        throw new Error("A stream with that name already exists");
    }
    revalidatePath("/financial/income");
    revalidatePath("/financial");
}

export async function updateIncomeStream(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const existing = await db.incomeStream.findFirst({ where: { id, userId: user.id } });
    if (!existing) throw new Error("Not found");
    const name = str(fd, "name");
    if (!name) throw new Error("Name is required");
    await db.incomeStream.update({
        where: { id },
        data: { name, kind: str(fd, "kind"), notes: str(fd, "notes"), archived: bool(fd, "archived") },
    });
    revalidatePath("/financial/income");
    revalidatePath("/financial");
}

export async function deleteIncomeStream(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.incomeStream.deleteMany({ where: { id, userId: user.id } });
    revalidatePath("/financial/income");
    revalidatePath("/financial");
}

export async function createIncomeEntry(fd: FormData) {
    const user = await requireUser();
    const streamId = str(fd, "streamId");
    if (!streamId) throw new Error("Missing stream");
    const stream = await db.incomeStream.findFirst({ where: { id: streamId, userId: user.id } });
    if (!stream) throw new Error("Stream not found");
    const amount = num(fd, "amount");
    if (amount === null) throw new Error("Amount is required");
    await db.incomeEntry.create({
        data: {
            userId: user.id,
            streamId,
            amount,
            receivedAt: parseDateTime(str(fd, "receivedAt")),
            notes: str(fd, "notes"),
        },
    });
    revalidatePath("/financial/income");
    revalidatePath("/financial");
}

export async function updateIncomeEntry(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const existing = await db.incomeEntry.findFirst({ where: { id, userId: user.id } });
    if (!existing) throw new Error("Not found");
    const amount = num(fd, "amount");
    if (amount === null) throw new Error("Amount is required");
    // Allow re-assigning to another stream, but only one the user owns.
    let streamId = str(fd, "streamId") || existing.streamId;
    if (streamId !== existing.streamId) {
        const stream = await db.incomeStream.findFirst({ where: { id: streamId, userId: user.id } });
        if (!stream) throw new Error("Stream not found");
    }
    await db.incomeEntry.update({
        where: { id },
        data: {
            streamId,
            amount,
            // Preserve the original date when the form omits it.
            receivedAt: parseOptionalDateTime(str(fd, "receivedAt")) ?? existing.receivedAt,
            notes: str(fd, "notes"),
        },
    });
    revalidatePath("/financial/income");
    revalidatePath("/financial");
}

export async function deleteIncomeEntry(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.incomeEntry.deleteMany({ where: { id, userId: user.id } });
    revalidatePath("/financial/income");
    revalidatePath("/financial");
}
