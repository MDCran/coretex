"use server";

import { revalidatePath } from "next/cache";
import type { SubscriptionCadence, SubscriptionStatus } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { num, parseOptionalDateTime, str } from "./financial-shared";

/** Marker prefix stored in a CANCELLED subscription's notes to record a dismissed detection. */
const DISMISS_MARKER = "[[detect-dismissed:";

/** Normalize a merchant string into a stable grouping key (lowercase, collapse digits/punct/whitespace). */
function merchantKey(raw: string | null | undefined): string {
    return (raw ?? "")
        .toLowerCase()
        .replace(/[0-9]+/g, " ")
        .replace(/[^a-z\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

const CADENCES: SubscriptionCadence[] = ["MONTHLY", "YEARLY", "WEEKLY", "OTHER"];
const STATUSES: SubscriptionStatus[] = ["ACTIVE", "CANCELLED", "PAUSED"];
function cadence(fd: FormData): SubscriptionCadence {
    const v = str(fd, "cadence");
    return CADENCES.includes(v as SubscriptionCadence) ? (v as SubscriptionCadence) : "MONTHLY";
}
function status(fd: FormData): SubscriptionStatus {
    const v = str(fd, "status");
    return STATUSES.includes(v as SubscriptionStatus) ? (v as SubscriptionStatus) : "ACTIVE";
}

export async function createSubscription(fd: FormData) {
    const user = await requireUser();
    const merchant = str(fd, "merchant");
    if (!merchant) throw new Error("Merchant is required");
    await db.finSubscription.create({
        data: {
            userId: user.id,
            name: str(fd, "name"),
            merchant,
            cadence: cadence(fd),
            amount: num(fd, "amount") ?? 0,
            status: status(fd),
            startedOn: parseOptionalDateTime(str(fd, "startedOn")),
            nextChargeOn: parseOptionalDateTime(str(fd, "nextChargeOn")),
            cancelledOn: status(fd) === "CANCELLED" ? (parseOptionalDateTime(str(fd, "cancelledOn")) ?? new Date()) : null,
            notes: str(fd, "notes"),
        },
    });
    revalidatePath("/financial/subscriptions");
    revalidatePath("/financial");
}

export async function updateSubscription(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const existing = await db.finSubscription.findFirst({ where: { id, userId: user.id } });
    if (!existing) throw new Error("Not found");
    const merchant = str(fd, "merchant");
    if (!merchant) throw new Error("Merchant is required");
    const st = status(fd);
    await db.finSubscription.update({
        where: { id },
        data: {
            name: str(fd, "name"),
            merchant,
            cadence: cadence(fd),
            amount: num(fd, "amount") ?? 0,
            status: st,
            startedOn: parseOptionalDateTime(str(fd, "startedOn")),
            nextChargeOn: parseOptionalDateTime(str(fd, "nextChargeOn")),
            cancelledOn: st === "CANCELLED" ? (existing.cancelledOn ?? new Date()) : null,
            notes: str(fd, "notes"),
        },
    });
    revalidatePath("/financial/subscriptions");
    revalidatePath("/financial");
}

export async function deleteSubscription(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.finSubscription.deleteMany({ where: { id, userId: user.id } });
    revalidatePath("/financial/subscriptions");
    revalidatePath("/financial");
}

// ============================================================
// Recurring-charge detection
// ============================================================

export interface DetectedSubscription {
    /** Stable grouping key (also used to persist dismissals). */
    key: string;
    /** Human-friendly merchant label (most common original spelling). */
    merchant: string;
    cadence: SubscriptionCadence;
    /** Estimated per-charge amount (positive dollars). */
    amount: number;
    /** Number of transactions backing the proposal. */
    evidenceCount: number;
    /** ISO date of the most recent matching charge. */
    lastSeen: string;
    /** Estimated next charge ISO date based on cadence + last seen. */
    nextChargeOn: string;
    /** IDs of the matching transactions (linked on accept). */
    transactionIds: string[];
}

const MS_DAY = 24 * 60 * 60 * 1000;

/** Median of a numeric array (returns 0 for empty). */
function median(values: number[]): number {
    if (!values.length) return 0;
    const s = [...values].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Classify an average interval (in days) into a cadence, or null if it matches none. */
function classifyCadence(avgDays: number): SubscriptionCadence | null {
    if (avgDays >= 5 && avgDays <= 10) return "WEEKLY";
    if (avgDays >= 24 && avgDays <= 37) return "MONTHLY";
    if (avgDays >= 330 && avgDays <= 400) return "YEARLY";
    return null;
}

function cadenceDays(c: SubscriptionCadence): number {
    if (c === "WEEKLY") return 7;
    if (c === "YEARLY") return 365;
    return 30;
}

/**
 * Scan the user's outflow transactions and propose recurring subscriptions.
 *
 * Algorithm:
 *  1. Group all outflows (amount < 0) by a normalized merchant key.
 *  2. For each group with >= 2 charges, take the median absolute amount and keep only
 *     charges within +/-10% of it (rejecting one-off purchases at the same merchant).
 *  3. Sort the kept charges by date and measure the gaps between consecutive charges.
 *     The average gap is classified as weekly (~7d), monthly (~30d) or yearly (~365d).
 *  4. Require >= 2 charges that fit a recognized cadence to emit a proposal.
 *  5. Exclude merchants already represented by an existing subscription (active OR a
 *     persisted dismissal marker), so accepted/dismissed proposals don't reappear.
 */
export async function detectSubscriptions(): Promise<DetectedSubscription[]> {
    const user = await requireUser();

    const [txns, existingSubs] = await Promise.all([
        db.finTransaction.findMany({
            where: { userId: user.id, amount: { lt: 0 }, subscriptionId: null },
            select: { id: true, date: true, amount: true, merchant: true, rawDescription: true },
            orderBy: { date: "asc" },
        }),
        db.finSubscription.findMany({ where: { userId: user.id }, select: { merchant: true, notes: true } }),
    ]);

    // Build the set of merchant keys to suppress: existing subscriptions + dismissals.
    const suppressed = new Set<string>();
    for (const s of existingSubs) {
        suppressed.add(merchantKey(s.merchant));
        const note = s.notes ?? "";
        const idx = note.indexOf(DISMISS_MARKER);
        if (idx >= 0) {
            const end = note.indexOf("]]", idx);
            if (end > idx) suppressed.add(note.slice(idx + DISMISS_MARKER.length, end));
        }
    }

    // Group transactions by normalized merchant key.
    const groups = new Map<string, { id: string; date: Date; amount: number; label: string }[]>();
    for (const t of txns) {
        const label = t.merchant || t.rawDescription || "";
        const key = merchantKey(label);
        if (!key) continue;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push({ id: t.id, date: t.date, amount: Math.abs(Number(t.amount)), label });
    }

    const proposals: DetectedSubscription[] = [];
    for (const [key, items] of groups) {
        if (suppressed.has(key) || items.length < 2) continue;

        // Keep only charges near the median amount (+/-10%).
        const med = median(items.map((i) => i.amount));
        if (med <= 0) continue;
        const near = items.filter((i) => Math.abs(i.amount - med) <= med * 0.1 + 0.01);
        if (near.length < 2) continue;

        // Measure gaps between consecutive charges (already date-ascending).
        const gaps: number[] = [];
        for (let i = 1; i < near.length; i++) {
            const days = (near[i].date.getTime() - near[i - 1].date.getTime()) / MS_DAY;
            if (days >= 1) gaps.push(days);
        }
        if (!gaps.length) continue;
        const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
        const cadence = classifyCadence(avgGap);
        if (!cadence) continue;

        // Most common original label spelling for display.
        const labelCounts = new Map<string, number>();
        for (const i of near) if (i.label) labelCounts.set(i.label, (labelCounts.get(i.label) ?? 0) + 1);
        const merchant = [...labelCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? key;

        const last = near[near.length - 1];
        const nextCharge = new Date(last.date.getTime() + cadenceDays(cadence) * MS_DAY);

        proposals.push({
            key,
            merchant,
            cadence,
            amount: Math.round(med * 100) / 100,
            evidenceCount: near.length,
            lastSeen: last.date.toISOString(),
            nextChargeOn: nextCharge.toISOString(),
            transactionIds: near.map((i) => i.id),
        });
    }

    // Most evidence first, then most recent.
    proposals.sort((a, b) => b.evidenceCount - a.evidenceCount || b.lastSeen.localeCompare(a.lastSeen));
    return proposals;
}

/** Accept a detected proposal: create the subscription and link its matching transactions. */
export async function acceptDetectedSubscription(payload: {
    key: string;
    merchant: string;
    cadence: SubscriptionCadence;
    amount: number;
    nextChargeOn: string | null;
    transactionIds: string[];
}) {
    const user = await requireUser();
    const merchant = payload.merchant?.trim();
    if (!merchant) throw new Error("Merchant is required");

    const created = await db.finSubscription.create({
        data: {
            userId: user.id,
            merchant,
            cadence: CADENCES.includes(payload.cadence) ? payload.cadence : "MONTHLY",
            amount: Number.isFinite(payload.amount) ? payload.amount : 0,
            status: "ACTIVE",
            nextChargeOn: parseOptionalDateTime(payload.nextChargeOn),
            startedOn: new Date(),
            notes: "Auto-detected from recurring charges.",
        },
    });

    // Link only the user's own, still-unlinked transactions.
    if (payload.transactionIds.length) {
        await db.finTransaction.updateMany({
            where: { id: { in: payload.transactionIds }, userId: user.id, subscriptionId: null },
            data: { subscriptionId: created.id },
        });
    }

    revalidatePath("/financial/subscriptions");
    revalidatePath("/financial");
    return { id: created.id };
}

/**
 * Run subscription detection and stamp Settings.lastSubscriptionScanAt.
 * Returns the detected proposals so the client can display them.
 */
export async function runSubscriptionScan(): Promise<DetectedSubscription[]> {
    const user = await requireUser();
    const proposals = await detectSubscriptions();
    await db.settings.upsert({
        where: { userId: user.id },
        create: { userId: user.id, lastSubscriptionScanAt: new Date() },
        update: { lastSubscriptionScanAt: new Date() },
    });
    revalidatePath("/financial/subscriptions");
    return proposals;
}

/** Dismiss a detected proposal so it stops being suggested (persisted, no schema change). */
export async function dismissDetectedSubscription(payload: { key: string; merchant: string }) {
    const user = await requireUser();
    const key = payload.key?.trim();
    if (!key) throw new Error("Missing key");
    await db.finSubscription.create({
        data: {
            userId: user.id,
            merchant: payload.merchant?.trim() || key,
            status: "CANCELLED",
            cancelledOn: new Date(),
            amount: 0,
            notes: `${DISMISS_MARKER}${key}]] Dismissed subscription suggestion.`,
        },
    });
    revalidatePath("/financial/subscriptions");
    return { ok: true };
}
