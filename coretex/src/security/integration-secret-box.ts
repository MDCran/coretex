import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "enc:v2";
const LEGACY_AAD = Buffer.from("coretex:integration-secret:v1", "utf8");

export interface IntegrationSecretContext {
    provider: "alpaca" | "plaid" | "spotify" | "genius";
    userId: string;
    field: string;
}

function additionalData(context: IntegrationSecretContext): Buffer {
    if (!context.userId || !context.field) throw new Error("Integration credential encryption context is incomplete.");
    return Buffer.from(JSON.stringify(["coretex", "integration-secret", "v2", context.provider, context.userId, context.field]), "utf8");
}

function encryptionKey(): Buffer {
    const configured = process.env["DATA_ENCRYPTION_KEY"]?.trim();
    if (!configured) {
        throw new Error("The local integration encryption key is unavailable.");
    }

    const key = /^[0-9a-f]{64}$/i.test(configured)
        ? Buffer.from(configured, "hex")
        : Buffer.from(configured, "base64");
    if (key.length !== 32) {
        throw new Error("The local integration encryption key must decode to exactly 32 bytes.");
    }
    return key;
}

export function assertIntegrationSecretKey(): void {
    encryptionKey();
}

export function isSealedIntegrationSecret(value: string): boolean {
    const parts = value.split(":");
    if (parts.length !== 5 || parts[0] !== "enc" || parts[1] !== "v2") return false;
    try {
        return Buffer.from(parts[2], "base64url").length === 12 &&
            Buffer.from(parts[3], "base64url").length === 16 &&
            Buffer.from(parts[4], "base64url").length > 0;
    } catch {
        return false;
    }
}

export function isLegacySealedIntegrationSecret(value: string): boolean {
    const parts = value.split(":");
    if (parts.length !== 5 || parts[0] !== "enc" || parts[1] !== "v1") return false;
    try {
        return Buffer.from(parts[2]!, "base64url").length === 12 &&
            Buffer.from(parts[3]!, "base64url").length === 16 &&
            Buffer.from(parts[4]!, "base64url").length > 0;
    } catch {
        return false;
    }
}

/** Decrypt the pre-context v1 envelope only for the one-time migration path. */
export function openLegacyIntegrationSecretForMigration(value: string): string {
    if (!isLegacySealedIntegrationSecret(value)) throw new Error("Legacy integration credential has an invalid format.");
    const parts = value.split(":");
    try {
        const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(parts[2]!, "base64url"));
        decipher.setAAD(LEGACY_AAD);
        decipher.setAuthTag(Buffer.from(parts[3]!, "base64url"));
        return Buffer.concat([decipher.update(Buffer.from(parts[4]!, "base64url")), decipher.final()]).toString("utf8");
    } catch {
        throw new Error("Legacy integration credential could not be decrypted.");
    }
}

/** Encrypt a credential before it enters the LifeOS database. */
export function sealIntegrationSecret(value: string, context: IntegrationSecretContext): string {
    if (!value) return "";
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
    cipher.setAAD(additionalData(context));
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [PREFIX, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(":");
}

export function sealOptionalIntegrationSecret(value: string | null | undefined, context: IntegrationSecretContext): string | null {
    return value ? sealIntegrationSecret(value, context) : null;
}

/** Decrypt at the last responsible moment. Legacy plaintext always fails closed. */
export function openIntegrationSecret(value: string, context: IntegrationSecretContext): string {
    if (!value) return "";
    if (value.startsWith("enc:") && !value.startsWith(`${PREFIX}:`)) {
        throw new Error("Stored integration credential has an unsupported or invalid format.");
    }
    if (!value.startsWith(`${PREFIX}:`)) {
        throw new Error("A legacy plaintext integration credential must be migrated or reconnected.");
    }
    if (!isSealedIntegrationSecret(value)) {
        throw new Error("Stored integration credential has an invalid format.");
    }

    const parts = value.split(":");
    try {
        const iv = Buffer.from(parts[2]!, "base64url");
        const tag = Buffer.from(parts[3]!, "base64url");
        const ciphertext = Buffer.from(parts[4]!, "base64url");
        const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
        decipher.setAAD(additionalData(context));
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch {
        throw new Error("Stored integration credential could not be decrypted.");
    }
}

export function openOptionalIntegrationSecret(value: string | null | undefined, context: IntegrationSecretContext): string | null {
    return value ? openIntegrationSecret(value, context) : null;
}
