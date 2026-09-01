"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { str, int, date } from "@/lib/actions/social-shared";

/** Log (or upsert) the social battery level for a given day. */
export async function logBattery(formData: FormData) {
    const user = await requireUser();
    const energyLevel = int(formData, "energyLevel", 1, 10);
    if (energyLevel === null) throw new Error("Energy level is required");
    const day = date(formData, "date") ?? new Date(new Date().setHours(0, 0, 0, 0));
    const notes = str(formData, "notes");

    await db.socialBattery.upsert({
        where: { userId_date: { userId: user.id, date: day } },
        create: { userId: user.id, date: day, energyLevel, notes },
        update: { energyLevel, notes },
    });
    revalidatePath("/social");
    revalidatePath("/social/calendar");
    revalidatePath("/calendar");
}

/**
 * Create or update a battery log for an explicit date (full CRUD entry point).
 * One row per day via the unique constraint — same date edits the existing row.
 */
export async function saveBattery(formData: FormData) {
    const user = await requireUser();
    const energyLevel = int(formData, "energyLevel", 1, 10);
    if (energyLevel === null) throw new Error("Energy level is required");
    const day = date(formData, "date");
    if (!day) throw new Error("Date is required");
    const notes = str(formData, "notes");

    await db.socialBattery.upsert({
        where: { userId_date: { userId: user.id, date: day } },
        create: { userId: user.id, date: day, energyLevel, notes },
        update: { energyLevel, notes },
    });
    revalidatePath("/social");
    revalidatePath("/social/calendar");
    revalidatePath("/calendar");
}

/** Delete a battery log by id (must belong to the user). */
export async function deleteBattery(formData: FormData) {
    const user = await requireUser();
    const id = String(formData.get("id"));
    const row = await db.socialBattery.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!row) throw new Error("Not found");
    await db.socialBattery.delete({ where: { id } });
    revalidatePath("/social");
    revalidatePath("/social/calendar");
    revalidatePath("/calendar");
}
