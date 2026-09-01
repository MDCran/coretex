"use server";

import { revalidatePath } from "next/cache";
import type { FinAccountKind } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { recomputeFinAccountBalance } from "@/lib/financial/balance";
import { extractHoldingsFromStatements, syncAlpacaHoldings } from "@/lib/financial/brokerage-holdings";
import { bool, num, parseOptionalDateOnly, parseOptionalDateTime, str } from "./financial-shared";

// LOAN is legacy — accepted from existing rows but never offered in the create UI.
// BROKERAGE + CD are first-class account kinds in the create/edit UI.
const KINDS: FinAccountKind[] = ["CHECKING", "SAVINGS", "MONEY_MARKET", "CD", "BROKERAGE", "LOAN", "OTHER"];
function kind(fd: FormData): FinAccountKind {
    const v = str(fd, "kind");
    return KINDS.includes(v as FinAccountKind) ? (v as FinAccountKind) : "CHECKING";
}

/** Read repeated owner ids and validate they belong to the user. */
async function ownerIds(userId: string, fd: FormData): Promise<{ id: string }[]> {
    const ids = fd.getAll("ownerIds").filter((v): v is string => typeof v === "string" && v.length > 0);
    if (ids.length === 0) return [];
    const owned = await db.socialContact.findMany({ where: { id: { in: ids }, userId }, select: { id: true } });
    return owned.map((o) => ({ id: o.id }));
}

/** Validate the chosen institution belongs to the user (or clear it). */
async function institutionId(userId: string, fd: FormData): Promise<string | null> {
    const id = str(fd, "institutionId");
    if (!id) return null;
    const inst = await db.institution.findFirst({ where: { id, userId }, select: { id: true } });
    return inst?.id ?? null;
}

export async function createFinAccount(fd: FormData) {
    const user = await requireUser();
    const k = kind(fd);
    // Balance is DERIVED (latest statement ending balance, else transaction sum) — no input.
    const account = await db.finAccount.create({
        data: {
            userId: user.id,
            kind: k,
            institutionId: await institutionId(user.id, fd),
            nickname: str(fd, "nickname"),
            branchLocation: str(fd, "branchLocation"),
            openedAt: parseOptionalDateOnly(str(fd, "openedAt")),
            closedAt: parseOptionalDateOnly(str(fd, "closedAt")),
            last4: lastFour(str(fd, "last4")),
            currentBalance: 0,
            isAsset: k !== "LOAN",
            includeInNetWorth: bool(fd, "includeInNetWorth"),
            notes: str(fd, "notes"),
            owners: { connect: await ownerIds(user.id, fd) },
        },
    });
    revalidatePath("/financial/accounts");
    revalidatePath("/financial");
    return { id: account.id };
}

export async function updateFinAccount(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const existing = await db.finAccount.findFirst({ where: { id, userId: user.id } });
    if (!existing) throw new Error("Not found");
    const k = kind(fd);
    await db.finAccount.update({
        where: { id },
        data: {
            kind: k,
            institutionId: await institutionId(user.id, fd),
            nickname: str(fd, "nickname"),
            branchLocation: str(fd, "branchLocation"),
            openedAt: parseOptionalDateOnly(str(fd, "openedAt")),
            closedAt: parseOptionalDateOnly(str(fd, "closedAt")),
            last4: lastFour(str(fd, "last4")) ?? existing.last4,
            isAsset: k !== "LOAN",
            includeInNetWorth: bool(fd, "includeInNetWorth"),
            notes: str(fd, "notes"),
            owners: { set: await ownerIds(user.id, fd) },
        },
    });
    revalidatePath("/financial/accounts");
    revalidatePath(`/financial/accounts/${id}`);
    revalidatePath("/financial");
}

/** Accept only the display-safe last four; full account credentials are never stored. */
function lastFour(value: string | null): string | null {
    if (!value) return null;
    const digits = value.replace(/\D/g, "");
    if (digits.length !== 4) throw new Error("Last 4 must contain exactly four digits");
    return digits;
}

export async function setFinAccountArchived(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.finAccount.updateMany({ where: { id, userId: user.id }, data: { archived: bool(fd, "archived") } });
    revalidatePath("/financial/accounts");
    revalidatePath(`/financial/accounts/${id}`);
    revalidatePath("/financial");
}

/** Toggle whether the account is included in net worth. */
export async function setFinAccountIncludeInNetWorth(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.finAccount.updateMany({ where: { id, userId: user.id }, data: { includeInNetWorth: bool(fd, "includeInNetWorth") } });
    revalidatePath("/financial/accounts");
    revalidatePath(`/financial/accounts/${id}`);
    revalidatePath("/financial");
}

/**
 * Link an account as "replaced by" another account (a re-issued / renumbered
 * account is the same logical account). Optionally archive the replaced account.
 * Pass an empty replacedById to clear the link.
 */
export async function setFinAccountReplacedBy(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const existing = await db.finAccount.findFirst({ where: { id, userId: user.id } });
    if (!existing) throw new Error("Not found");

    const replacedById = str(fd, "replacedById");
    if (replacedById) {
        if (replacedById === id) throw new Error("An account cannot replace itself");
        const target = await db.finAccount.findFirst({ where: { id: replacedById, userId: user.id } });
        if (!target) throw new Error("Replacement account not found");
        // prevent a simple two-node cycle
        if (target.replacedById === id) throw new Error("That account is already marked as replaced by this one");
    }

    await db.finAccount.update({ where: { id }, data: { replacedById: replacedById ?? null } });
    if (replacedById && bool(fd, "archiveReplaced")) {
        await db.finAccount.update({ where: { id }, data: { archived: true } });
    }
    revalidatePath("/financial/accounts");
    revalidatePath(`/financial/accounts/${id}`);
    revalidatePath("/financial");
}

export async function deleteFinAccount(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.finAccount.deleteMany({ where: { id, userId: user.id } });
    revalidatePath("/financial/accounts");
    revalidatePath("/financial");
}

/** Recompute and persist an account's derived balance cache. */
export async function refreshFinAccountBalance(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const owned = await db.finAccount.findFirst({ where: { id, userId: user.id } });
    if (!owned) throw new Error("Not found");
    const balance = await recomputeFinAccountBalance(id);
    revalidatePath("/financial/accounts");
    revalidatePath(`/financial/accounts/${id}`);
    revalidatePath("/financial");
    return { balance };
}

// --- Brokerage: per-account Alpaca linking + holdings ---

/** Verify the account belongs to the user and is a brokerage account. */
async function ownBrokerage(userId: string, id: string) {
    const acct = await db.finAccount.findFirst({ where: { id, userId } });
    if (!acct) throw new Error("Account not found");
    if (acct.kind !== "BROKERAGE") throw new Error("Not a brokerage account");
    return acct;
}

/**
 * Toggle whether this brokerage account mirrors the user's live Alpaca portfolio.
 * On link, holdings are seeded from current Alpaca positions; balance is recomputed
 * so the live equity flows into net worth.
 */
export async function setFinAccountAlpacaLinked(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await ownBrokerage(user.id, id);
    const linked = bool(fd, "alpacaLinked");
    await db.finAccount.update({ where: { id }, data: { alpacaLinked: linked } });
    if (linked) await syncAlpacaHoldings(id).catch(() => null);
    await recomputeFinAccountBalance(id);
    revalidatePath("/financial/accounts");
    revalidatePath(`/financial/accounts/${id}`);
    revalidatePath("/financial");
    return { linked };
}

/** Pull current Alpaca positions onto this account's holdings (read-only). */
export async function refreshAlpacaHoldings(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await ownBrokerage(user.id, id);
    const synced = await syncAlpacaHoldings(id);
    await recomputeFinAccountBalance(id);
    revalidatePath(`/financial/accounts/${id}`);
    revalidatePath("/financial");
    return { synced };
}

/** Run AI holdings extraction over the account's uploaded brokerage statement PDFs. */
export async function extractHoldings(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await ownBrokerage(user.id, id);
    const result = await extractHoldingsFromStatements(id, user.id);
    await recomputeFinAccountBalance(id);
    revalidatePath(`/financial/accounts/${id}`);
    revalidatePath("/financial");
    return result;
}

export async function createAccountHolding(fd: FormData) {
    const user = await requireUser();
    const finAccountId = str(fd, "finAccountId");
    if (!finAccountId) throw new Error("Missing account");
    await ownBrokerage(user.id, finAccountId);
    const symbol = str(fd, "symbol");
    const shares = num(fd, "shares");
    if (!symbol || shares === null) throw new Error("Symbol and shares are required");
    await db.holding.create({
        data: {
            finAccountId,
            symbol: symbol.toUpperCase(),
            shares,
            costBasisPerShare: num(fd, "costBasisPerShare"),
            currentPrice: num(fd, "currentPrice"),
            asOf: parseOptionalDateTime(str(fd, "asOf")) ?? new Date(),
        },
    });
    await recomputeFinAccountBalance(finAccountId);
    revalidatePath(`/financial/accounts/${finAccountId}`);
    revalidatePath("/financial");
}

export async function updateAccountHolding(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const holding = await db.holding.findUnique({ where: { id }, include: { finAccount: true } });
    if (!holding || !holding.finAccount || holding.finAccount.userId !== user.id) throw new Error("Not found");
    const symbol = str(fd, "symbol");
    const shares = num(fd, "shares");
    if (!symbol || shares === null) throw new Error("Symbol and shares are required");
    await db.holding.update({
        where: { id },
        data: {
            symbol: symbol.toUpperCase(),
            shares,
            costBasisPerShare: num(fd, "costBasisPerShare"),
            currentPrice: num(fd, "currentPrice"),
            asOf: parseOptionalDateTime(str(fd, "asOf")) ?? new Date(),
        },
    });
    await recomputeFinAccountBalance(holding.finAccount.id);
    revalidatePath(`/financial/accounts/${holding.finAccount.id}`);
    revalidatePath("/financial");
}

export async function deleteAccountHolding(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const holding = await db.holding.findUnique({ where: { id }, include: { finAccount: true } });
    if (!holding || !holding.finAccount || holding.finAccount.userId !== user.id) throw new Error("Not found");
    const finAccountId = holding.finAccount.id;
    await db.holding.delete({ where: { id } });
    await recomputeFinAccountBalance(finAccountId);
    revalidatePath(`/financial/accounts/${finAccountId}`);
    revalidatePath("/financial");
}
