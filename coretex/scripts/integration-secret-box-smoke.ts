import assert from "node:assert/strict";
import {
    isSealedIntegrationSecret,
    openIntegrationSecret,
    sealIntegrationSecret,
} from "../src/security/integration-secret-box.js";

const originalKey = process.env["DATA_ENCRYPTION_KEY"];
const context = { provider: "spotify", userId: "user-a", field: "accessToken" } as const;
try {
    process.env["DATA_ENCRYPTION_KEY"] = Buffer.alloc(32, 9).toString("base64");
    const first = sealIntegrationSecret("sensitive-token-value", context);
    const second = sealIntegrationSecret("sensitive-token-value", context);
    assert.equal(isSealedIntegrationSecret(first), true);
    assert.notEqual(first, second);
    assert.equal(first.includes("sensitive-token-value"), false);
    assert.equal(openIntegrationSecret(first, context), "sensitive-token-value");
    assert.throws(() => openIntegrationSecret(first, { ...context, userId: "user-b" }), /could not be decrypted/);
    assert.throws(() => openIntegrationSecret(first, { ...context, field: "refreshToken" }), /could not be decrypted/);
    assert.throws(() => openIntegrationSecret("legacy-plaintext", context), /must be migrated/);
    assert.throws(() => openIntegrationSecret("enc:v2:bad:bad:bad", context), /invalid format/);

    const parts = first.split(":");
    parts[4] = `${parts[4]!.slice(0, -2)}AA`;
    assert.throws(() => openIntegrationSecret(parts.join(":"), context), /could not be decrypted/);
    process.stdout.write("Integration secret-box smoke passed.\n");
} finally {
    if (originalKey === undefined) delete process.env["DATA_ENCRYPTION_KEY"];
    else process.env["DATA_ENCRYPTION_KEY"] = originalKey;
}
