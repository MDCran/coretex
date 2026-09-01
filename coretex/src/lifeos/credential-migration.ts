import { prisma } from "../db/prisma.js";
import {
    isSealedIntegrationSecret,
    isLegacySealedIntegrationSecret,
    openIntegrationSecret,
    openLegacyIntegrationSecretForMigration,
    sealIntegrationSecret,
    type IntegrationSecretContext,
} from "../security/integration-secret-box.js";

function sealIfNeeded(value: string, context: IntegrationSecretContext): string {
    if (isSealedIntegrationSecret(value)) {
        openIntegrationSecret(value, context);
        return value;
    }
    const plaintext = isLegacySealedIntegrationSecret(value) ? openLegacyIntegrationSecretForMigration(value) : value;
    if (plaintext.startsWith("enc:") && !isLegacySealedIntegrationSecret(value)) {
        throw new Error("Stored integration credential has an unsupported or malformed encrypted envelope.");
    }
    return sealIntegrationSecret(plaintext, context);
}

function sealOptionalIfNeeded(value: string | null | undefined, context: IntegrationSecretContext): string | null {
    return value ? sealIfNeeded(value, context) : null;
}

/** Idempotently upgrade legacy plaintext integration credentials in the local DB. */
export async function migrateLifeOSIntegrationSecrets(): Promise<number> {
    const [alpacaRows, plaidRows, spotifyRows, geniusRows] = await Promise.all([
        prisma.alpacaConnection.findMany(),
        prisma.plaidItem.findMany({ select: { id: true, userId: true, accessToken: true } }),
        prisma.spotifyConnection.findMany({ select: { id: true, userId: true, accessToken: true, refreshToken: true } }),
        prisma.geniusConnection.findMany({ select: { id: true, userId: true, accessToken: true } }),
    ]);

    let updated = 0;
    for (const row of alpacaRows) {
        const data = {
            paperApiKey: sealOptionalIfNeeded(row.paperApiKey, { provider: "alpaca" as const, userId: row.userId, field: "paperApiKey" }),
            paperApiSecret: sealOptionalIfNeeded(row.paperApiSecret, { provider: "alpaca" as const, userId: row.userId, field: "paperApiSecret" }),
            liveApiKey: sealOptionalIfNeeded(row.liveApiKey, { provider: "alpaca" as const, userId: row.userId, field: "liveApiKey" }),
            liveApiSecret: sealOptionalIfNeeded(row.liveApiSecret, { provider: "alpaca" as const, userId: row.userId, field: "liveApiSecret" }),
        };
        if (data.paperApiKey === row.paperApiKey && data.paperApiSecret === row.paperApiSecret &&
            data.liveApiKey === row.liveApiKey && data.liveApiSecret === row.liveApiSecret) continue;
        await prisma.alpacaConnection.update({
            where: { id: row.id },
            data,
        });
        updated++;
    }
    for (const row of plaidRows) {
        const accessToken = sealIfNeeded(row.accessToken, { provider: "plaid", userId: row.userId, field: "accessToken" });
        if (accessToken === row.accessToken) continue;
        await prisma.plaidItem.update({
            where: { id: row.id },
            data: { accessToken },
        });
        updated++;
    }
    for (const row of spotifyRows) {
        const accessToken = sealIfNeeded(row.accessToken, { provider: "spotify", userId: row.userId, field: "accessToken" });
        const refreshToken = row.refreshToken
            ? sealIfNeeded(row.refreshToken, { provider: "spotify", userId: row.userId, field: "refreshToken" })
            : "";
        if (accessToken === row.accessToken && refreshToken === row.refreshToken) continue;
        await prisma.spotifyConnection.update({
            where: { id: row.id },
            data: { accessToken, refreshToken },
        });
        updated++;
    }
    for (const row of geniusRows) {
        const accessToken = sealIfNeeded(row.accessToken, { provider: "genius", userId: row.userId, field: "accessToken" });
        if (accessToken === row.accessToken) continue;
        await prisma.geniusConnection.update({
            where: { id: row.id },
            data: { accessToken },
        });
        updated++;
    }
    return updated;
}
