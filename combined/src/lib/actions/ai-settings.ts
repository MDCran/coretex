"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";

/**
 * Toggle the master AI switch. When disabled, all AI features across the app are
 * paused regardless of any per-feature configuration.
 */
export async function setAiEnabled(enabled: boolean) {
    const user = await requireUser();
    await db.settings.upsert({
        where: { userId: user.id },
        update: { aiEnabled: enabled },
        create: { userId: user.id, aiEnabled: enabled },
    });
    revalidatePath("/settings/ai");
}

/**
 * Hard cap on AI spend per calendar month, in USD. Pass `null` to remove the cap.
 * Stored as a Prisma Decimal (string).
 */
export async function setAiMonthlyLimit(usd: number | null) {
    const user = await requireUser();
    const value = usd != null && Number.isFinite(usd) && usd > 0 ? usd.toString() : null;
    await db.settings.upsert({
        where: { userId: user.id },
        update: { aiMonthlyLimitUsd: value },
        create: { userId: user.id, aiMonthlyLimitUsd: value },
    });
    revalidatePath("/settings/ai");
}

/**
 * Hard cap on AI spend per single search/run, in USD. Pass `null` to remove the cap.
 * Stored as a Prisma Decimal (string).
 */
export async function setAiPerSearchLimit(usd: number | null) {
    const user = await requireUser();
    const value = usd != null && Number.isFinite(usd) && usd > 0 ? usd.toString() : null;
    await db.settings.upsert({
        where: { userId: user.id },
        update: { aiPerSearchLimitUsd: value },
        create: { userId: user.id, aiPerSearchLimitUsd: value },
    });
    revalidatePath("/settings/ai");
}
