// @ts-nocheck
"use server";

import { revalidatePath } from "next/cache";
import type { CardType, FinAccountKind, FinancialPlanKind } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { db } from "../../db/prisma.js";
import { num, parseOptionalDateOnly, str } from "./financial-shared.js";

const PLAN_KINDS: FinancialPlanKind[] = ["ACCOUNT", "CARD", "BROKERAGE", "OTHER"];
function planKind(fd: FormData): FinancialPlanKind {
    const v = str(fd, "kind");
    return PLAN_KINDS.includes(v as FinancialPlanKind) ? (v as FinancialPlanKind) : "CARD";
}

const ACCOUNT_KINDS: FinAccountKind[] = ["CHECKING", "SAVINGS", "MONEY_MARKET", "CD", "BROKERAGE", "LOAN", "OTHER"];
function accountKind(fd: FormData): FinAccountKind | null {
    const v = str(fd, "accountKind");
    return v && ACCOUNT_KINDS.includes(v as FinAccountKind) ? (v as FinAccountKind) : null;
}

const CARD_TYPES: CardType[] = ["CREDIT", "DEBIT", "CHARGE", "PREPAID", "OTHER"];
function cardType(fd: FormData): CardType | null {
    const v = str(fd, "cardType");
    return v && CARD_TYPES.includes(v as CardType) ? (v as CardType) : null;
}

/** Revalidate every surface that shows planned items or the products they become. */
function revalidateAll() {
    revalidatePath("/financial/planning");
    revalidatePath("/financial/accounts");
    revalidatePath("/financial/cards");
    revalidatePath("/financial");
}

/** Shared form → plan field mapping for create/update. */
function planData(fd: FormData) {
    const kind = planKind(fd);
    return {
        kind,
        name: str(fd, "name") ?? "Untitled plan",
        institutionName: str(fd, "institutionName"),
        // Only persist sub-kind that matches the chosen kind.
        accountKind: kind === "CARD" ? null : accountKind(fd),
        cardType: kind === "CARD" ? (cardType(fd) ?? "CREDIT") : null,
        targetDate: parseOptionalDateOnly(str(fd, "targetDate")),
        reason: str(fd, "reason"),
        expectedAnnualFee: num(fd, "expectedAnnualFee"),
        expectedBonus: str(fd, "expectedBonus"),
        notes: str(fd, "notes"),
    };
}

export async function createPlan(fd: FormData) {
    const user = await requireUser();
    const data = planData(fd);
    if (!str(fd, "name")) throw new Error("Name is required");
    await db.financialPlan.create({ data: { userId: user.id, status: "PLANNED", ...data } });
    revalidateAll();
}

export async function updatePlan(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const existing = await db.financialPlan.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!existing) throw new Error("Plan not found");
    if (!str(fd, "name")) throw new Error("Name is required");
    await db.financialPlan.update({ where: { id }, data: planData(fd) });
    revalidateAll();
}

export async function deletePlan(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    await db.financialPlan.deleteMany({ where: { id, userId: user.id } });
    revalidateAll();
}

export async function dismissPlan(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    // Toggle: a dismissed plan can be moved back to PLANNED.
    const plan = await db.financialPlan.findFirst({ where: { id, userId: user.id }, select: { status: true } });
    if (!plan) throw new Error("Plan not found");
    const next = plan.status === "DISMISSED" ? "PLANNED" : "DISMISSED";
    await db.financialPlan.update({ where: { id }, data: { status: next } });
    revalidateAll();
}

/**
 * Mark a plan as opened, creating the real product it became:
 *  - CARD  → a CreditCard (nickname=name, issuer=institutionName free-text, cardType)
 *  - other → a FinAccount (kind from accountKind, nickname=name, free-text institution)
 * Links the new product back to the plan and flips status to OPENED.
 * Returns where the created product lives so the UI can deep-link to it.
 */
export async function openPlan(fd: FormData): Promise<{ kind: "card" | "account"; id: string; href: string; name: string }> {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const plan = await db.financialPlan.findFirst({ where: { id, userId: user.id } });
    if (!plan) throw new Error("Plan not found");
    if (plan.status === "OPENED") throw new Error("This plan is already opened");

    if (plan.kind === "CARD") {
        const card = await db.creditCard.create({
            data: {
                userId: user.id,
                nickname: plan.name,
                issuer: plan.institutionName,
                cardType: plan.cardType ?? "CREDIT",
                currentBalance: 0,
                notes: plan.reason ?? plan.notes,
            },
            select: { id: true },
        });
        await db.financialPlan.update({ where: { id }, data: { status: "OPENED", creditCardId: card.id } });
        revalidateAll();
        return { kind: "card", id: card.id, href: `/financial/cards/${card.id}`, name: plan.name };
    }

    // ACCOUNT / BROKERAGE / OTHER → a FinAccount.
    const k: FinAccountKind = plan.accountKind ?? (plan.kind === "BROKERAGE" ? "BROKERAGE" : "CHECKING");
    const account = await db.finAccount.create({
        data: {
            userId: user.id,
            kind: k,
            nickname: plan.name,
            institution: plan.institutionName,
            currentBalance: 0,
            isAsset: k !== "LOAN",
            includeInNetWorth: true,
            notes: plan.reason ?? plan.notes,
        },
        select: { id: true },
    });
    await db.financialPlan.update({ where: { id }, data: { status: "OPENED", finAccountId: account.id } });
    revalidateAll();
    return { kind: "account", id: account.id, href: `/financial/accounts/${account.id}`, name: plan.name };
}
