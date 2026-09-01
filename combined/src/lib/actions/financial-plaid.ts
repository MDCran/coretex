"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { CountryCode } from "plaid";
import { createLinkToken, plaidClient, plaidConfigured } from "@/lib/plaid";
import { provisionPlaidAccounts, syncPlaidItemFull } from "@/lib/financial/plaid-sync";
import { openSecret, sealSecret } from "@/lib/secret-box";

export interface PlaidItemView {
    id: string;
    itemId: string;
    institutionName: string | null;
    lastSyncedAt: string | null;
    status: string;
    accountCount: number;
    accounts: Array<{
        id: string;
        name: string;
        mask: string | null;
        type: string;
        subtype: string | null;
        finAccountId: string | null;
        creditCardId: string | null;
        linkedLabel: string | null;
        balanceCurrent: number | null;
        balanceAvailable: number | null;
        balanceLimit: number | null;
        lastBalanceSyncAt: string | null;
    }>;
}

export interface PlaidLinkOption {
    value: string;
    label: string;
    kind: "account" | "card";
}

function revalidateFinancial() {
    revalidatePath("/settings/integrations");
    revalidatePath("/financial");
    revalidatePath("/financial/accounts");
    revalidatePath("/financial/cards");
    revalidatePath("/financial/transactions");
    revalidatePath("/calendar");
}

export async function getPlaidLinkToken(): Promise<{ linkToken: string }> {
    const user = await requireUser();
    if (!plaidConfigured()) throw new Error("Plaid is not configured on the server.");
    const linkToken = await createLinkToken(user.id);
    return { linkToken };
}

export async function getPlaidItemsView(userId: string): Promise<PlaidItemView[]> {
    const items = await db.plaidItem.findMany({
        where: { userId },
        include: {
            accounts: {
                include: {
                    finAccount: { select: { nickname: true, kind: true } },
                    creditCard: { select: { nickname: true, productName: true } },
                },
            },
        },
        orderBy: { createdAt: "desc" },
    });

    return items.map((item) => ({
        id: item.id,
        itemId: item.itemId,
        institutionName: item.institutionName,
        lastSyncedAt: item.lastSyncedAt?.toISOString() ?? null,
        status: item.status,
        accountCount: item.accounts.length,
        accounts: item.accounts.map((a) => ({
            id: a.id,
            name: a.officialName || a.name,
            mask: a.mask,
            type: a.type,
            subtype: a.subtype,
            finAccountId: a.finAccountId,
            creditCardId: a.creditCardId,
            linkedLabel: a.finAccount
                ? `${a.finAccount.nickname ?? a.finAccount.kind}`
                : a.creditCard
                  ? `${a.creditCard.nickname ?? a.creditCard.productName ?? "Card"}`
                  : null,
            balanceCurrent: a.balanceCurrent != null ? Number(a.balanceCurrent) : null,
            balanceAvailable: a.balanceAvailable != null ? Number(a.balanceAvailable) : null,
            balanceLimit: a.balanceLimit != null ? Number(a.balanceLimit) : null,
            lastBalanceSyncAt: a.lastBalanceSyncAt?.toISOString() ?? null,
        })),
    }));
}

async function resolveInstitution(userId: string, name: string | null | undefined): Promise<string | null> {
    const trimmed = name?.trim();
    if (!trimmed) return null;
    const existing = await db.institution.findFirst({ where: { userId, name: trimmed }, select: { id: true } });
    if (existing) return existing.id;
    const created = await db.institution.create({ data: { userId, name: trimmed } });
    return created.id;
}

/** Exchange a Link public_token, provision/link accounts, and run initial transaction sync. */
export async function exchangePlaidPublicToken(publicToken: string): Promise<{ itemId: string; sync: { added: number; updated: number; linked: number } }> {
    const user = await requireUser();
    if (!plaidConfigured()) throw new Error("Plaid is not configured on the server.");

    const client = plaidClient();
    const exchange = await client.itemPublicTokenExchange({ public_token: publicToken });
    const accessToken = exchange.data.access_token;
    const itemId = exchange.data.item_id;

    const existing = await db.plaidItem.findUnique({ where: { itemId } });
    if (existing && existing.userId !== user.id) throw new Error("This bank connection belongs to another user.");

    const itemMeta = await client.itemGet({ access_token: accessToken });
    const institutionId = itemMeta.data.item.institution_id ?? null;
    let institutionName: string | null = null;
    if (institutionId) {
        try {
            const inst = await client.institutionsGetById({
                institution_id: institutionId,
                country_codes: [CountryCode.Us],
            });
            institutionName = inst.data.institution.name;
        } catch {
            institutionName = null;
        }
    }

    const accountsRes = await client.accountsGet({ access_token: accessToken });
    const accounts = accountsRes.data.accounts;

    const plaidItem = existing
        ? await db.plaidItem.update({
              where: { id: existing.id },
              data: {
                  accessToken: sealSecret(accessToken, { provider: "plaid", userId: user.id, field: "accessToken" }),
                  institutionId,
                  institutionName,
                  status: "good",
                  errorCode: null,
              },
          })
        : await db.plaidItem.create({
              data: {
                  userId: user.id,
                  itemId,
                  accessToken: sealSecret(accessToken, { provider: "plaid", userId: user.id, field: "accessToken" }),
                  institutionId,
                  institutionName,
              },
          });

    await provisionPlaidAccounts(user.id, plaidItem.id, accounts, institutionName);

    let sync = { added: 0, updated: 0, linked: 0, removed: 0, skipped: 0, accounts: 0, liabilityCards: 0 };
    try {
        sync = await syncPlaidItemFull(plaidItem.id);
    } catch (e) {
        // First sync can lag right after Link — user can retry manually.
        console.warn("[plaid] initial sync deferred:", e);
    }

    revalidateFinancial();
    return { itemId, sync: { added: sync.added, updated: sync.updated, linked: sync.linked } };
}

export async function syncPlaidItem(itemDbId: string) {
    const user = await requireUser();
    const item = await db.plaidItem.findFirst({ where: { id: itemDbId, userId: user.id } });
    if (!item) throw new Error("Plaid item not found");
    const result = await syncPlaidItemFull(item.id);
    revalidateFinancial();
    return result;
}

export async function syncAllPlaidItems() {
    const user = await requireUser();
    const items = await db.plaidItem.findMany({ where: { userId: user.id }, select: { id: true } });
    let added = 0;
    let updated = 0;
    let linked = 0;
    let removed = 0;
    for (const item of items) {
        const r = await syncPlaidItemFull(item.id);
        added += r.added;
        updated += r.updated;
        linked += r.linked;
        removed += r.removed;
    }
    revalidateFinancial();
    return { added, updated, linked, removed, items: items.length };
}

export async function linkPlaidAccountToOwner(plaidAccountDbId: string, owner: string): Promise<{ ok: true }> {
    const user = await requireUser();
    const plaidAccount = await db.plaidAccount.findFirst({
        where: { id: plaidAccountDbId, userId: user.id },
        include: { plaidItem: { select: { institutionName: true } } },
    });
    if (!plaidAccount) throw new Error("Plaid account not found");

    let finAccountId: string | null = null;
    let creditCardId: string | null = null;
    const [kind, id] = owner ? owner.split(":") : ["", ""];
    const institutionId = await resolveInstitution(user.id, plaidAccount.plaidItem.institutionName);

    if (kind === "account" && id) {
        if (plaidAccount.type === "credit") throw new Error("Plaid credit accounts must be linked to Cards, not Accounts.");
        const account = await db.finAccount.findFirst({ where: { id, userId: user.id }, select: { id: true } });
        if (!account) throw new Error("Account not found");
        finAccountId = account.id;
    } else if (kind === "card" && id) {
        if (plaidAccount.type !== "credit") throw new Error("Only Plaid credit accounts can be linked to Cards.");
        const card = await db.creditCard.findFirst({ where: { id, userId: user.id }, select: { id: true } });
        if (!card) throw new Error("Card not found");
        creditCardId = card.id;
    } else if (owner) {
        throw new Error("Invalid Plaid link target");
    }

    await db.$transaction(async (tx) => {
        if (finAccountId) {
            await tx.plaidAccount.updateMany({ where: { userId: user.id, finAccountId, id: { not: plaidAccount.id } }, data: { finAccountId: null } });
            await tx.finAccount.update({
                where: { id: finAccountId },
                data: {
                    institutionId,
                    last4: plaidAccount.mask ?? undefined,
                    ...(plaidAccount.balanceCurrent != null ? { currentBalance: plaidAccount.balanceCurrent, lastBalanceAt: new Date() } : {}),
                },
            });
        }
        if (creditCardId) {
            await tx.plaidAccount.updateMany({ where: { userId: user.id, creditCardId, id: { not: plaidAccount.id } }, data: { creditCardId: null } });
            await tx.creditCard.update({
                where: { id: creditCardId },
                data: {
                    institutionId,
                    last4: plaidAccount.mask ?? undefined,
                    ...(plaidAccount.balanceCurrent != null ? { currentBalance: Math.abs(Number(plaidAccount.balanceCurrent)) } : {}),
                    ...(plaidAccount.balanceLimit != null ? { creditLimit: plaidAccount.balanceLimit } : {}),
                },
            });
        }
        await tx.plaidAccount.update({
            where: { id: plaidAccount.id },
            data: { finAccountId, creditCardId },
        });
    });

    revalidateFinancial();
    if (finAccountId) revalidatePath(`/financial/accounts/${finAccountId}`);
    if (creditCardId) revalidatePath(`/financial/cards/${creditCardId}`);
    return { ok: true };
}

export async function disconnectPlaidItem(itemDbId: string) {
    const user = await requireUser();
    const item = await db.plaidItem.findFirst({ where: { id: itemDbId, userId: user.id } });
    if (!item) throw new Error("Plaid item not found");

    try {
        const client = plaidClient();
        await client.itemRemove({
            access_token: openSecret(item.accessToken, { provider: "plaid", userId: item.userId, field: "accessToken" }),
        });
    } catch {
        // Item may already be removed on Plaid's side.
    }

    await db.plaidItem.delete({ where: { id: item.id } });
    revalidateFinancial();
}
