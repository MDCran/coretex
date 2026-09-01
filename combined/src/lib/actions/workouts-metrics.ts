"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { recomputeAllPersonalRecords } from "@/lib/workouts-prs";

/**
 * Recompute personal records across all of the user's exercises from their full
 * set history. Backs the "Recompute PRs" button on /workouts/body and is also
 * used as an auto-backfill. Returns the number of PR rows created/updated.
 */
export async function recomputeAllPRs(): Promise<number> {
    const user = await requireUser();
    const touched = await recomputeAllPersonalRecords(user.id);
    revalidatePath("/workouts/body");
    revalidatePath("/workouts");
    return touched;
}
