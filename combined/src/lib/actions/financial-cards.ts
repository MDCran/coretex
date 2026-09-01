"use server";

import { revalidatePath } from "next/cache";
import type { CardRewardType, CardType } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { uploadUserRasterImage } from "@/lib/uploads";
import { deleteObject } from "@/lib/s3";
import { recomputeCreditCardBalance } from "@/lib/financial/balance";
import { bool, int, num, parseOptionalDateOnly, str } from "./financial-shared";

async function ownCard(userId: string, cardId: string) {
    const card = await db.creditCard.findFirst({ where: { id: cardId, userId } });
    if (!card) throw new Error("Card not found");
    return card;
}

const CARD_TYPES: CardType[] = ["CREDIT", "DEBIT", "CHARGE", "PREPAID", "OTHER"];
function cardType(fd: FormData): CardType {
    const v = str(fd, "cardType");
    return CARD_TYPES.includes(v as CardType) ? (v as CardType) : "CREDIT";
}

/** Accept only the display-safe last four; PAN and CVV are never stored. */
function lastFour(value: string | null): string | null {
    if (!value) return null;
    const digits = value.replace(/\D/g, "");
    if (digits.length !== 4) throw new Error("Last 4 must contain exactly four digits");
    return digits;
}

async function institutionId(userId: string, fd: FormData): Promise<string | null> {
    const id = str(fd, "institutionId");
    if (!id) return null;
    const inst = await db.institution.findFirst({ where: { id, userId }, select: { id: true } });
    return inst?.id ?? null;
}

async function ownerIds(userId: string, fd: FormData): Promise<{ id: string }[]> {
    const ids = fd.getAll("ownerIds").filter((v): v is string => typeof v === "string" && v.length > 0);
    if (ids.length === 0) return [];
    const owned = await db.socialContact.findMany({ where: { id: { in: ids }, userId }, select: { id: true } });
    return owned.map((o) => ({ id: o.id }));
}

async function cardImageKey(userId: string, fd: FormData): Promise<string | undefined> {
    const file = fd.get("cardImage");
    if (!(file instanceof File) || file.size === 0) return undefined;
    const stored = await uploadUserRasterImage(userId, "financial", file);
    return stored.fileKey;
}

export async function createCreditCard(fd: FormData) {
    const user = await requireUser();
    const last4 = lastFour(str(fd, "last4"));
    const imageKey = await cardImageKey(user.id, fd);
    let card: Awaited<ReturnType<typeof ownCard>>;
    try {
        card = await db.creditCard.create({
            data: {
                userId: user.id,
                institutionId: await institutionId(user.id, fd),
                nickname: str(fd, "nickname"),
                cardType: cardType(fd),
                expMonth: int(fd, "expMonth"),
                expYear: int(fd, "expYear"),
                branchLocation: str(fd, "branchLocation"),
                openedAt: parseOptionalDateOnly(str(fd, "openedAt")),
                closedAt: parseOptionalDateOnly(str(fd, "closedAt")),
                productName: str(fd, "productName"),
                last4,
                apr: num(fd, "apr"),
                creditLimit: num(fd, "creditLimit"),
                currentBalance: 0,
                cardStyle: str(fd, "cardStyle"),
                ...(imageKey ? { cardImageKey: imageKey } : {}),
                minimumPayment: num(fd, "minimumPayment"),
                paymentDueAt: parseOptionalDateOnly(str(fd, "paymentDueAt")),
                lastPaymentAmount: num(fd, "lastPaymentAmount"),
                paymentOverdue: bool(fd, "paymentOverdue"),
                lastStatementBalance: num(fd, "lastStatementBalance"),
                rewardsNotes: str(fd, "rewardsNotes"),
                notes: str(fd, "notes"),
                owners: { connect: await ownerIds(user.id, fd) },
            },
        });
    } catch (error) {
        if (imageKey) await deleteObject(imageKey).catch(() => {});
        throw error;
    }
    revalidatePath("/financial/cards");
    revalidatePath("/financial");
    return { id: card.id };
}

export async function updateCreditCard(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const existing = await ownCard(user.id, id);
    const last4 = lastFour(str(fd, "last4")) ?? existing.last4;
    const imageKey = await cardImageKey(user.id, fd);
    const removeCardImage = bool(fd, "removeCardImage") && !imageKey;
    try {
        await db.creditCard.update({
            where: { id },
            data: {
                institutionId: await institutionId(user.id, fd),
                nickname: str(fd, "nickname"),
                cardType: cardType(fd),
                expMonth: int(fd, "expMonth"),
                expYear: int(fd, "expYear"),
                branchLocation: str(fd, "branchLocation"),
                openedAt: parseOptionalDateOnly(str(fd, "openedAt")),
                closedAt: parseOptionalDateOnly(str(fd, "closedAt")),
                productName: str(fd, "productName"),
                last4,
                apr: num(fd, "apr"),
                creditLimit: num(fd, "creditLimit"),
                cardStyle: str(fd, "cardStyle"),
                ...(imageKey ? { cardImageKey: imageKey } : removeCardImage ? { cardImageKey: null } : {}),
                minimumPayment: num(fd, "minimumPayment"),
                paymentDueAt: parseOptionalDateOnly(str(fd, "paymentDueAt")),
                lastPaymentAmount: num(fd, "lastPaymentAmount"),
                paymentOverdue: bool(fd, "paymentOverdue"),
                lastStatementBalance: num(fd, "lastStatementBalance"),
                rewardsNotes: str(fd, "rewardsNotes"),
                notes: str(fd, "notes"),
                owners: { set: await ownerIds(user.id, fd) },
            },
        });
    } catch (error) {
        if (imageKey) await deleteObject(imageKey).catch(() => {});
        throw error;
    }
    if ((imageKey || removeCardImage) && existing.cardImageKey) await deleteObject(existing.cardImageKey).catch(() => {});
    revalidatePath("/financial/cards");
    revalidatePath(`/financial/cards/${id}`);
    revalidatePath("/financial");
}

export async function setCreditCardArchived(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.creditCard.updateMany({ where: { id, userId: user.id }, data: { archived: bool(fd, "archived") } });
    revalidatePath("/financial/cards");
    revalidatePath(`/financial/cards/${id}`);
    revalidatePath("/financial");
}

export async function deleteCreditCard(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const existing = await ownCard(user.id, id);
    await db.creditCard.delete({ where: { id } });
    if (existing.cardImageKey) await deleteObject(existing.cardImageKey).catch(() => {});
    revalidatePath("/financial/cards");
    revalidatePath("/financial");
}

/**
 * Link a card as "replaced by" another card (in addition to the per-card
 * CardNumber history). Optionally archive the replaced card.
 */
export async function setCreditCardReplacedBy(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await ownCard(user.id, id);

    const replacedById = str(fd, "replacedById");
    if (replacedById) {
        if (replacedById === id) throw new Error("A card cannot replace itself");
        const target = await db.creditCard.findFirst({ where: { id: replacedById, userId: user.id } });
        if (!target) throw new Error("Replacement card not found");
        if (target.replacedById === id) throw new Error("That card is already marked as replaced by this one");
    }

    await db.creditCard.update({ where: { id }, data: { replacedById: replacedById ?? null } });
    if (replacedById && bool(fd, "archiveReplaced")) {
        await db.creditCard.update({ where: { id }, data: { archived: true } });
    }
    revalidatePath("/financial/cards");
    revalidatePath(`/financial/cards/${id}`);
    revalidatePath("/financial");
}

/** Recompute and persist a card's derived balance from its statements/transactions. */
export async function refreshCreditCardBalance(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await ownCard(user.id, id);
    const balance = await recomputeCreditCardBalance(id);
    revalidatePath("/financial/cards");
    revalidatePath(`/financial/cards/${id}`);
    revalidatePath("/financial");
    return { balance };
}

// --- Card numbers (history) ---

function cardNumberLast4(fd: FormData): string {
    const digits = str(fd, "last4")?.replace(/\D/g, "") ?? "";
    if (digits.length !== 4) throw new Error("Last 4 must be exactly 4 digits");
    return digits;
}

export async function createCardNumber(fd: FormData) {
    const user = await requireUser();
    const creditCardId = str(fd, "creditCardId");
    if (!creditCardId) throw new Error("Missing card");
    await ownCard(user.id, creditCardId);
    const isCurrent = bool(fd, "isCurrent");
    if (isCurrent) {
        await db.cardNumber.updateMany({ where: { creditCardId }, data: { isCurrent: false } });
    }
    const last4 = cardNumberLast4(fd);
    await db.cardNumber.create({
        data: {
            creditCardId,
            last4,
            validFrom: parseOptionalDateOnly(str(fd, "validFrom")),
            validTo: parseOptionalDateOnly(str(fd, "validTo")),
            isCurrent,
            notes: str(fd, "notes"),
        },
    });
    if (isCurrent) await db.creditCard.update({ where: { id: creditCardId }, data: { last4 } });
    revalidateCard(creditCardId);
}

export async function updateCardNumber(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const cn = await db.cardNumber.findUnique({ where: { id }, include: { creditCard: true } });
    if (!cn || cn.creditCard.userId !== user.id) throw new Error("Not found");

    const last4 = cardNumberLast4(fd);
    const isCurrent = bool(fd, "isCurrent");
    await db.$transaction(async (tx) => {
        if (isCurrent) {
            await tx.cardNumber.updateMany({ where: { creditCardId: cn.creditCardId, id: { not: id } }, data: { isCurrent: false } });
        }
        await tx.cardNumber.update({
            where: { id },
            data: {
                last4,
                validFrom: parseOptionalDateOnly(str(fd, "validFrom")),
                validTo: parseOptionalDateOnly(str(fd, "validTo")),
                isCurrent,
                notes: str(fd, "notes"),
            },
        });
        if (isCurrent) {
            await tx.creditCard.update({ where: { id: cn.creditCardId }, data: { last4 } });
        }
    });
    revalidateCard(cn.creditCardId);
}

export async function markCardNumberCurrent(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const cn = await db.cardNumber.findUnique({ where: { id }, include: { creditCard: true } });
    if (!cn || cn.creditCard.userId !== user.id) throw new Error("Not found");
    await db.cardNumber.updateMany({ where: { creditCardId: cn.creditCardId }, data: { isCurrent: false } });
    await db.cardNumber.update({ where: { id }, data: { isCurrent: true } });
    await db.creditCard.update({ where: { id: cn.creditCardId }, data: { last4: cn.last4 } });
    revalidateCard(cn.creditCardId);
}

export async function deleteCardNumber(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const cn = await db.cardNumber.findUnique({ where: { id }, include: { creditCard: true } });
    if (!cn || cn.creditCard.userId !== user.id) throw new Error("Not found");
    await db.cardNumber.delete({ where: { id } });
    revalidateCard(cn.creditCardId);
}

// --- Rewards (per-category earn rates) ---

const REWARD_TYPES: CardRewardType[] = ["PERCENT", "POINTS", "MILES", "CASHBACK"];
function rewardType(fd: FormData): CardRewardType {
    const v = str(fd, "type");
    return REWARD_TYPES.includes(v as CardRewardType) ? (v as CardRewardType) : "PERCENT";
}

function revalidateCard(cardId: string) {
    revalidatePath("/financial/cards");
    revalidatePath(`/financial/cards/${cardId}`);
}

export async function addCardReward(fd: FormData) {
    const user = await requireUser();
    const creditCardId = str(fd, "creditCardId");
    if (!creditCardId) throw new Error("Missing card");
    await ownCard(user.id, creditCardId);
    const category = str(fd, "category");
    if (!category) throw new Error("Category is required");
    const rate = num(fd, "rate");
    if (rate === null) throw new Error("Rate is required");
    const max = await db.cardReward.aggregate({ where: { creditCardId }, _max: { order: true } });
    await db.cardReward.create({
        data: {
            creditCardId,
            category,
            type: rewardType(fd),
            rate,
            cap: str(fd, "cap"),
            notes: str(fd, "notes"),
            order: (max._max.order ?? -1) + 1,
        },
    });
    revalidateCard(creditCardId);
}

export async function updateCardReward(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const reward = await db.cardReward.findUnique({ where: { id }, include: { creditCard: { select: { userId: true } } } });
    if (!reward || reward.creditCard.userId !== user.id) throw new Error("Not found");
    const category = str(fd, "category");
    if (!category) throw new Error("Category is required");
    const rate = num(fd, "rate");
    if (rate === null) throw new Error("Rate is required");
    await db.cardReward.update({
        where: { id },
        data: { category, type: rewardType(fd), rate, cap: str(fd, "cap"), notes: str(fd, "notes") },
    });
    revalidateCard(reward.creditCardId);
}

export async function deleteCardReward(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const reward = await db.cardReward.findUnique({ where: { id }, include: { creditCard: { select: { userId: true } } } });
    if (!reward || reward.creditCard.userId !== user.id) throw new Error("Not found");
    await db.cardReward.delete({ where: { id } });
    revalidateCard(reward.creditCardId);
}

// --- Perks (general benefits) ---

export async function addCardPerk(fd: FormData) {
    const user = await requireUser();
    const creditCardId = str(fd, "creditCardId");
    if (!creditCardId) throw new Error("Missing card");
    await ownCard(user.id, creditCardId);
    const title = str(fd, "title");
    if (!title) throw new Error("Title is required");
    const max = await db.cardPerk.aggregate({ where: { creditCardId }, _max: { order: true } });
    await db.cardPerk.create({
        data: { creditCardId, title, description: str(fd, "description"), order: (max._max.order ?? -1) + 1 },
    });
    revalidateCard(creditCardId);
}

export async function updateCardPerk(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const perk = await db.cardPerk.findUnique({ where: { id }, include: { creditCard: { select: { userId: true } } } });
    if (!perk || perk.creditCard.userId !== user.id) throw new Error("Not found");
    const title = str(fd, "title");
    if (!title) throw new Error("Title is required");
    await db.cardPerk.update({ where: { id }, data: { title, description: str(fd, "description") } });
    revalidateCard(perk.creditCardId);
}

export async function deleteCardPerk(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const perk = await db.cardPerk.findUnique({ where: { id }, include: { creditCard: { select: { userId: true } } } });
    if (!perk || perk.creditCard.userId !== user.id) throw new Error("Not found");
    await db.cardPerk.delete({ where: { id } });
    revalidateCard(perk.creditCardId);
}
