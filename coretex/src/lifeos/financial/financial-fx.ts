// @ts-nocheck
"use server";

import { revalidatePath } from "next/cache";
import { db } from "../../db/prisma.js";
import { requireUser } from "@/lib/auth";
import { fetchUsdRates } from "@/lib/financial/fx";

/** Refresh stored USD exchange rates from the live source. Rates are global (not per-user). */
export async function refreshExchangeRates(): Promise<{ count: number }> {
    await requireUser();
    const rates = await fetchUsdRates();
    const asOf = new Date();
    for (const r of rates) {
        await db.exchangeRate.upsert({
            where: { code: r.code },
            create: { code: r.code, rateToUsd: r.rateToUsd, asOf },
            update: { rateToUsd: r.rateToUsd, asOf },
        });
    }
    revalidatePath("/financial/currencies");
    revalidatePath("/financial/net-worth");
    return { count: rates.length };
}
