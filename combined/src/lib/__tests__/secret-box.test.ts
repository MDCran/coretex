import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isSealedSecret, openSecret, sealSecret } from "../secret-box";

const KEY = Buffer.alloc(32, 7).toString("base64");
const originalKey = process.env.DATA_ENCRYPTION_KEY;
const CONTEXT = { provider: "spotify", userId: "user-a", field: "accessToken" } as const;

describe("integration secret encryption", () => {
    beforeEach(() => {
        process.env.DATA_ENCRYPTION_KEY = KEY;
    });

    afterEach(() => {
        if (originalKey === undefined) delete process.env.DATA_ENCRYPTION_KEY;
        else process.env.DATA_ENCRYPTION_KEY = originalKey;
    });

    it("round-trips without retaining plaintext", () => {
        const sealed = sealSecret("sensitive-token-value", CONTEXT);
        expect(isSealedSecret(sealed)).toBe(true);
        expect(sealed).not.toContain("sensitive-token-value");
        expect(openSecret(sealed, CONTEXT)).toBe("sensitive-token-value");
    });

    it("uses a fresh nonce for every persisted copy", () => {
        expect(sealSecret("same-token", CONTEXT)).not.toBe(sealSecret("same-token", CONTEXT));
    });

    it("does not mistake a credential with the envelope prefix for ciphertext", () => {
        const token = "enc:v2:not-an-envelope";
        const sealed = sealSecret(token, CONTEXT);
        expect(sealed).not.toBe(token);
        expect(openSecret(sealed, CONTEXT)).toBe(token);
    });

    it("rejects malformed encrypted envelopes instead of treating them as legacy plaintext", () => {
        expect(isSealedSecret("enc:v2:bad:bad:bad")).toBe(false);
        expect(() => openSecret("enc:v2:bad:bad:bad", CONTEXT)).toThrow("invalid format");
    });

    it("fails closed on legacy plaintext in every runtime mode", () => {
        expect(() => openSecret("legacy-plaintext-token", CONTEXT)).toThrow("must be migrated");
    });

    it("binds ciphertext to provider, user, and field", () => {
        const sealed = sealSecret("sensitive-token-value", CONTEXT);
        expect(() => openSecret(sealed, { ...CONTEXT, userId: "user-b" })).toThrow("could not be decrypted");
        expect(() => openSecret(sealed, { ...CONTEXT, field: "refreshToken" })).toThrow("could not be decrypted");
        expect(() => openSecret(sealed, { provider: "genius", userId: CONTEXT.userId, field: CONTEXT.field })).toThrow("could not be decrypted");
    });

    it("detects tampering", () => {
        const parts = sealSecret("sensitive-token-value", CONTEXT).split(":");
        const ciphertext = Buffer.from(parts[4], "base64url");
        ciphertext[0] ^= 1;
        parts[4] = ciphertext.toString("base64url");
        expect(() => openSecret(parts.join(":"), CONTEXT)).toThrow("could not be decrypted");
    });

    it("fails closed without a valid key", () => {
        delete process.env.DATA_ENCRYPTION_KEY;
        expect(() => sealSecret("token", CONTEXT)).toThrow("DATA_ENCRYPTION_KEY is required");
    });
});
