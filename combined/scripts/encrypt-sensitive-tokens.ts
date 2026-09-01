import { PrismaClient } from "@prisma/client";
import {
    isLegacySealedSecret,
    isSealedSecret,
    openSecret,
    openLegacySecretForMigration,
    sealSecret,
    type IntegrationSecretContext,
} from "../src/lib/secret-box";

const db = new PrismaClient();

function sealIfNeeded(value: string, context: IntegrationSecretContext): string {
    if (isSealedSecret(value)) {
        openSecret(value, context);
        return value;
    }
    const plaintext = isLegacySealedSecret(value) ? openLegacySecretForMigration(value) : value;
    if (plaintext.startsWith("enc:") && !isLegacySealedSecret(value)) {
        throw new Error("Stored integration credential has an unsupported or malformed encrypted envelope.");
    }
    return sealSecret(plaintext, context);
}

function sealOptionalIfNeeded(value: string | null | undefined, context: IntegrationSecretContext): string | null {
    return value ? sealIfNeeded(value, context) : null;
}

async function main() {
    const [alpacaRows, plaidRows, spotifyRows, geniusRows] = await Promise.all([
        db.alpacaConnection.findMany(),
        db.plaidItem.findMany({ select: { id: true, userId: true, accessToken: true } }),
        db.spotifyConnection.findMany({ select: { id: true, userId: true, accessToken: true, refreshToken: true } }),
        db.geniusConnection.findMany({ select: { id: true, userId: true, accessToken: true } }),
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
        await db.alpacaConnection.update({
            where: { id: row.id },
            data,
        });
        updated++;
    }
    for (const row of plaidRows) {
        const accessToken = sealIfNeeded(row.accessToken, { provider: "plaid", userId: row.userId, field: "accessToken" });
        if (accessToken === row.accessToken) continue;
        await db.plaidItem.update({
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
        await db.spotifyConnection.update({
            where: { id: row.id },
            data: { accessToken, refreshToken },
        });
        updated++;
    }
    for (const row of geniusRows) {
        const accessToken = sealIfNeeded(row.accessToken, { provider: "genius", userId: row.userId, field: "accessToken" });
        if (accessToken === row.accessToken) continue;
        await db.geniusConnection.update({
            where: { id: row.id },
            data: { accessToken },
        });
        updated++;
    }

    console.log(`Encrypted credential rows: ${updated}`);
}

main()
    .catch((error) => {
        console.error(error instanceof Error ? error.message : "Credential migration failed");
        process.exitCode = 1;
    })
    .finally(async () => db.$disconnect());
