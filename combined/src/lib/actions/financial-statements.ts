"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { deleteObject } from "@/lib/s3";
import { MAX_USER_FILE_SIZE, uploadUserMediaFile } from "@/lib/uploads";
import { CHEAP_CLAUDE_MODEL, aiConfigured, runClaude } from "@/lib/ai/claude";
import { processStatement } from "@/lib/financial/statement-extract";
import { recomputeOwnerBalance } from "@/lib/financial/balance";
import { fileExtension, fullStatementFileName } from "@/lib/financial/statement-name";
import { num, parseOptionalDateTime, str } from "./financial-shared";

/** Validate that the chosen owner (account/card/brokerage) belongs to the user. */
async function assertOwner(userId: string, finAccountId: string | null, creditCardId: string | null, brokerageAccountId: string | null) {
    if (finAccountId) {
        const a = await db.finAccount.findFirst({ where: { id: finAccountId, userId } });
        if (!a) throw new Error("Account not found");
    }
    if (creditCardId) {
        const c = await db.creditCard.findFirst({ where: { id: creditCardId, userId } });
        if (!c) throw new Error("Card not found");
    }
    if (brokerageAccountId) {
        const b = await db.brokerageAccount.findFirst({ where: { id: brokerageAccountId, userId } });
        if (!b) throw new Error("Brokerage account not found");
    }
}

function ownerWhere(finAccountId: string | null, creditCardId: string | null, brokerageAccountId: string | null) {
    return finAccountId ? { finAccountId } : creditCardId ? { creditCardId } : brokerageAccountId ? { brokerageAccountId } : {};
}

async function fileSha256(file: File): Promise<string> {
    const bytes = Buffer.from(await file.arrayBuffer());
    return createHash("sha256").update(bytes).digest("hex");
}

async function ownerNameParts(userId: string, finAccountId: string | null, creditCardId: string | null, brokerageAccountId: string | null): Promise<{ label: string; last4: string | null }> {
    if (finAccountId) {
        const account = await db.finAccount.findFirst({
            where: { id: finAccountId, userId },
            select: { nickname: true, institution: true, last4: true, institutionRef: { select: { name: true } } },
        });
        return {
            label: account?.nickname || account?.institutionRef?.name || account?.institution || "Account",
            last4: account?.last4 ?? null,
        };
    }
    if (creditCardId) {
        const card = await db.creditCard.findFirst({
            where: { id: creditCardId, userId },
            select: { nickname: true, productName: true, issuer: true, last4: true, institutionRef: { select: { name: true } } },
        });
        return {
            label: card?.nickname || card?.productName || card?.institutionRef?.name || card?.issuer || "Card",
            last4: card?.last4 ?? null,
        };
    }
    if (brokerageAccountId) {
        const brokerage = await db.brokerageAccount.findFirst({ where: { id: brokerageAccountId, userId }, select: { accountName: true, brokerage: true } });
        return { label: brokerage?.accountName || brokerage?.brokerage || "Brokerage", last4: null };
    }
    return { label: "Statement", last4: null };
}

async function uniqueStatementFileName(userId: string, proposed: string, excludeId?: string): Promise<string> {
    const ext = fileExtension(proposed);
    const base = ext ? proposed.slice(0, -(ext.length + 1)) : proposed;
    let candidate = proposed;
    for (let i = 2; i < 100; i++) {
        const existing = await db.finStatement.findFirst({
            where: { userId, fileName: candidate, ...(excludeId ? { id: { not: excludeId } } : {}) },
            select: { id: true },
        });
        if (!existing) return candidate;
        candidate = ext ? `${base}_${i}.${ext}` : `${base}_${i}`;
    }
    return `${base}_${Date.now()}${ext ? `.${ext}` : ""}`;
}

export async function uploadStatement(fd: FormData) {
    const user = await requireUser();
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new Error("A file is required");
    if (file.size > MAX_USER_FILE_SIZE) throw new Error("Statement exceeds 25 MB limit");

    const finAccountId = str(fd, "finAccountId");
    const creditCardId = str(fd, "creditCardId");
    const brokerageAccountId = str(fd, "brokerageAccountId");
    await assertOwner(user.id, finAccountId, creditCardId, brokerageAccountId);

    const hash = await fileSha256(file);
    const exactDuplicate = await db.finStatement.findFirst({
        where: { userId: user.id, fileSha256: hash },
        select: { fileName: true },
    });
    if (exactDuplicate) throw new Error(`Duplicate statement file: ${exactDuplicate.fileName}`);

    const periodStart = parseOptionalDateTime(str(fd, "periodStart"));
    const periodEnd = parseOptionalDateTime(str(fd, "periodEnd"));
    if ((finAccountId || creditCardId || brokerageAccountId) && periodStart && periodEnd) {
        const samePeriod = await db.finStatement.findFirst({
            where: {
                userId: user.id,
                ...ownerWhere(finAccountId, creditCardId, brokerageAccountId),
                periodStart,
                periodEnd,
                processingStatus: { not: "FAILED" },
            },
            select: { fileName: true },
        });
        if (samePeriod) throw new Error(`A statement for that account and period already exists: ${samePeriod.fileName}`);
    }

    const uploaded = await uploadUserMediaFile(user.id, "financial", file);
    const statement = await (async () => {
        const owner = await ownerNameParts(user.id, finAccountId, creditCardId, brokerageAccountId);
        const initialFileName =
            periodStart || periodEnd
                ? await uniqueStatementFileName(
                      user.id,
                      fullStatementFileName({
                          entityLabel: owner.label,
                          last4: owner.last4,
                          periodStart,
                          periodEnd,
                          extension: fileExtension(uploaded.fileName),
                      }),
                  )
                : uploaded.fileName;
        return db.finStatement.create({
            data: {
                userId: user.id,
                finAccountId,
                creditCardId,
                brokerageAccountId,
                fileKey: uploaded.fileKey,
                fileName: initialFileName,
                fileSha256: hash,
                mimeType: uploaded.mimeType,
                fileSize: uploaded.fileSize,
                periodStart,
                periodEnd,
                endingBalance: num(fd, "endingBalance"),
                processingStatus: "PENDING",
            },
        });
    })().catch(async (error) => {
        await deleteObject(uploaded.fileKey).catch(() => {});
        throw error;
    });

    revalidatePath("/financial/statements");
    revalidatePath("/financial");

    // Auto-trigger AI extraction for PDFs when configured (best-effort; errors are
    // captured on the statement as FAILED and surfaced in the UI).
    const isPdf = (uploaded.mimeType ?? "").includes("pdf") || uploaded.fileName.toLowerCase().endsWith(".pdf");
    if (isPdf && aiConfigured()) {
        try {
            await processStatement(statement.id, user.id);
        } catch {
            // processStatement already records FAILED + processingError on the statement.
        }
        revalidatePath("/financial/statements");
        revalidatePath("/financial");
    }

    return { id: statement.id };
}

/** Re-run (or first-run) the AI extraction pipeline for a statement. */
export async function reprocessStatement(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const result = await processStatement(id, user.id);
    const stmt = await db.finStatement.findFirst({ where: { id, userId: user.id }, select: { finAccountId: true, creditCardId: true, brokerageAccountId: true } });
    revalidatePath("/financial/statements");
    revalidatePath("/financial");
    if (stmt?.finAccountId) revalidatePath(`/financial/accounts/${stmt.finAccountId}`);
    if (stmt?.creditCardId) revalidatePath(`/financial/cards/${stmt.creditCardId}`);
    if (stmt?.brokerageAccountId) revalidatePath(`/financial/brokerage/${stmt.brokerageAccountId}`);
    return result;
}

export async function updateStatement(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const existing = await db.finStatement.findFirst({ where: { id, userId: user.id } });
    if (!existing) throw new Error("Not found");
    const periodStart = parseOptionalDateTime(str(fd, "periodStart"));
    const periodEnd = parseOptionalDateTime(str(fd, "periodEnd"));
    if ((existing.finAccountId || existing.creditCardId || existing.brokerageAccountId) && periodStart && periodEnd) {
        const samePeriod = await db.finStatement.findFirst({
            where: {
                userId: user.id,
                id: { not: id },
                ...ownerWhere(existing.finAccountId, existing.creditCardId, existing.brokerageAccountId),
                periodStart,
                periodEnd,
                processingStatus: { not: "FAILED" },
            },
            select: { fileName: true },
        });
        if (samePeriod) throw new Error(`A statement for that account and period already exists: ${samePeriod.fileName}`);
    }
    await db.finStatement.update({
        where: { id },
        data: {
            periodStart,
            periodEnd,
            endingBalance: num(fd, "endingBalance"),
        },
    });
    revalidatePath("/financial/statements");
    revalidatePath("/financial");
}

export async function deleteStatement(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const existing = await db.finStatement.findFirst({ where: { id, userId: user.id }, select: { fileKey: true } });
    const deleted = await db.finStatement.deleteMany({ where: { id, userId: user.id } });
    if (deleted.count > 0 && existing?.fileKey) await deleteObject(existing.fileKey).catch(() => {});
    revalidatePath("/financial/statements");
    revalidatePath("/financial");
}

/** Force-rename the stored file name of a statement (preserves its extension). */
export async function renameStatement(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const existing = await db.finStatement.findFirst({ where: { id, userId: user.id } });
    if (!existing) throw new Error("Not found");
    let name = str(fd, "fileName");
    if (!name) throw new Error("A file name is required");
    // Preserve the original extension if the user dropped it.
    const ext = fileExtension(existing.fileName);
    if (ext && !new RegExp(`\\.${ext}$`, "i").test(name)) name = `${name}.${ext}`;
    name = await uniqueStatementFileName(user.id, name, id);
    await db.finStatement.update({ where: { id }, data: { fileName: name } });
    revalidatePath("/financial/statements");
    if (existing.finAccountId) revalidatePath(`/financial/accounts/${existing.finAccountId}`);
    if (existing.creditCardId) revalidatePath(`/financial/cards/${existing.creditCardId}`);
    revalidatePath("/financial");
}

/** Link an unowned statement to an account/card/brokerage and recompute balances. */
export async function assignStatementOwner(fd: FormData) {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const existing = await db.finStatement.findFirst({ where: { id, userId: user.id } });
    if (!existing) throw new Error("Not found");

    const owner = str(fd, "owner"); // "kind:id"
    let finAccountId: string | null = null;
    let creditCardId: string | null = null;
    let brokerageAccountId: string | null = null;
    if (owner) {
        const [kind, ownerId] = owner.split(":");
        if (kind === "account") finAccountId = ownerId;
        if (kind === "card") creditCardId = ownerId;
        if (kind === "brokerage") brokerageAccountId = ownerId;
    }
    await assertOwner(user.id, finAccountId, creditCardId, brokerageAccountId);

    await db.finStatement.update({
        where: { id },
        data: {
            finAccountId,
            creditCardId,
            brokerageAccountId,
            // re-point any extracted transactions to the new owner
            transactions: { updateMany: { where: {}, data: { finAccountId, creditCardId } } },
        },
    });

    // recompute balances for old and new owners
    await recomputeOwnerBalance(existing.finAccountId, existing.creditCardId).catch(() => undefined);
    await recomputeOwnerBalance(finAccountId, creditCardId).catch(() => undefined);

    revalidatePath("/financial/statements");
    revalidatePath("/financial");
    return { ok: true };
}

interface SuggestResult {
    ownerKind: "account" | "card" | "brokerage" | "none";
    ownerId: string;
    reason: string;
    confidence: "high" | "medium" | "low";
}

const SUGGEST_SCHEMA: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    properties: {
        ownerKind: { type: "string", enum: ["account", "card", "brokerage", "none"] },
        ownerId: { type: "string", description: "The id of the best-matching account/card/brokerage, or empty if none." },
        reason: { type: "string" },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
    },
    required: ["ownerKind", "ownerId", "reason", "confidence"],
};

/**
 * Recommend which account/card/brokerage a statement belongs to, using the cheap
 * extracted institution/last4 hints (from rawExtraction) matched against the
 * user's entities. Falls back to a Claude call when hints are ambiguous.
 */
export async function suggestStatementOwner(fd: FormData): Promise<SuggestResult & { label: string | null }> {
    const user = await requireUser();
    const id = str(fd, "id");
    if (!id) throw new Error("Missing id");
    const stmt = await db.finStatement.findFirst({ where: { id, userId: user.id } });
    if (!stmt) throw new Error("Not found");

    const [accounts, cards, brokerages] = await Promise.all([
        db.finAccount.findMany({
            where: { userId: user.id, archived: false },
            select: { id: true, nickname: true, institution: true, last4: true, institutionRef: { select: { name: true } } },
        }),
        db.creditCard.findMany({
            where: { userId: user.id, archived: false },
            select: { id: true, nickname: true, productName: true, issuer: true, last4: true, institutionRef: { select: { name: true } } },
        }),
        db.brokerageAccount.findMany({ where: { userId: user.id, archived: false }, select: { id: true, accountName: true, brokerage: true } }),
    ]);

    const raw = (stmt.rawExtraction ?? {}) as { institution?: string; accountLast4?: string };
    const hintInstitution = (raw.institution ?? "").toLowerCase();
    // last4 hint: prefer the extracted accountLast4; else try to mine 4 trailing
    // digits out of the (already normalized) file name (e.g. "..._4821_...").
    const last4Of = (s: string | null | undefined) => (s ? s.replace(/\D/g, "").slice(-4) : "");
    const hintLast4 =
        last4Of(raw.accountLast4) ||
        (stmt.fileName.match(/(?:ending|x|\*|_|#)\s*(\d{4})(?:\D|$)/i)?.[1] ?? "");

    type Cand = { kind: "account" | "card" | "brokerage"; id: string; label: string; institution: string; last4: string | null };
    const candidates: Cand[] = [
        ...accounts.map((a) => ({
            kind: "account" as const,
            id: a.id,
            label: a.nickname || a.institutionRef?.name || a.institution || "Account",
            institution: (a.institutionRef?.name || a.institution || "").toLowerCase(),
            last4: a.last4 ?? null,
        })),
        ...cards.map((c) => ({
            kind: "card" as const,
            id: c.id,
            label: c.nickname || c.productName || c.institutionRef?.name || c.issuer || "Card",
            institution: (c.institutionRef?.name || c.issuer || "").toLowerCase(),
            last4: c.last4 ?? null,
        })),
        ...brokerages.map((b) => ({
            kind: "brokerage" as const,
            id: b.id,
            label: b.accountName || b.brokerage || "Brokerage",
            institution: (b.brokerage || "").toLowerCase(),
            last4: null,
        })),
    ];

    if (candidates.length === 0) return { ownerKind: "none", ownerId: "", reason: "No accounts or cards to match.", confidence: "low", label: null };

    // Strongest cheap heuristic: unique last-4 match (account/card number ending).
    if (hintLast4) {
        const byLast4 = candidates.filter((c) => c.last4 && c.last4 === hintLast4);
        if (byLast4.length === 1) {
            const m = byLast4[0];
            return { ownerKind: m.kind, ownerId: m.id, reason: `Account ending in ${hintLast4} matches.`, confidence: "high", label: m.label };
        }
        // last-4 + institution narrows a multi-match down to one.
        if (byLast4.length > 1 && hintInstitution) {
            const narrowed = byLast4.filter((c) => c.institution && (hintInstitution.includes(c.institution) || c.institution.includes(hintInstitution)));
            if (narrowed.length === 1) {
                const m = narrowed[0];
                return { ownerKind: m.kind, ownerId: m.id, reason: `Account ending in ${hintLast4} at “${m.institution}”.`, confidence: "high", label: m.label };
            }
        }
    }

    // Next: unique institution name match.
    if (hintInstitution) {
        const matches = candidates.filter((c) => c.institution && (hintInstitution.includes(c.institution) || c.institution.includes(hintInstitution)));
        if (matches.length === 1) {
            const m = matches[0];
            return { ownerKind: m.kind, ownerId: m.id, reason: `Institution match on “${m.institution}”.`, confidence: "high", label: m.label };
        }
    }

    if (!aiConfigured()) {
        return { ownerKind: "none", ownerId: "", reason: "Couldn’t match by institution; add ANTHROPIC_API_KEY for AI suggestions.", confidence: "low", label: null };
    }

    const prompt = `A financial statement was uploaded. Pick which of the user's accounts/cards/brokerages it most likely belongs to.

Statement hints (from extraction): institution="${raw.institution ?? ""}", accountEndingIn="${hintLast4 || "?"}", fileName="${stmt.fileName}".

Candidates (id — type — label — institution — last4):
${candidates.map((c) => `${c.id} — ${c.kind} — ${c.label} — ${c.institution || "?"} — ${c.last4 ?? "?"}`).join("\n")}

Matching priority: a matching last-4 (accountEndingIn vs a candidate's last4) is the strongest signal, then institution name, then the file name. If nothing is a reasonable match, return ownerKind "none" and empty ownerId.`;

    const { data } = await runClaude<SuggestResult>({
        purpose: "statement-owner-suggest",
        userId: user.id,
        model: CHEAP_CLAUDE_MODEL,
        content: prompt,
        schema: SUGGEST_SCHEMA,
    });
    const chosen = candidates.find((c) => c.id === data.ownerId && c.kind === data.ownerKind);
    return { ...data, ownerId: chosen?.id ?? "", ownerKind: chosen?.kind ?? "none", label: chosen?.label ?? null };
}
