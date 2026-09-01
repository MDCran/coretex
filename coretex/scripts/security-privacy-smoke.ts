import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ConfigStore } from "../src/config/store.js";
import { EnvManagerStore } from "../src/env/store.js";
import { KeyVaultStore } from "../src/keyvault/store.js";
import { LocalDiagnostics } from "../src/security/local-diagnostics.js";
import { readProtectedJson } from "../src/security/protected-file.js";
import { processEnvironmentSecretValues, REDACTED, SecretRedactor } from "../src/security/redaction.js";
import type { APIKey, Environment } from "../src/types.js";

const temp = await mkdtemp(path.join(os.tmpdir(), "coretex-security-"));
const knownSecret = "secret-value-123456";

try {
    const config = new ConfigStore(temp);
    await config.load();
    await config.setSecret("provider.test.apiKey", knownSecret);
    assert.equal(config.secretStoreStatus().itemCount, 1);
    assert.equal(config.secretStoreStatus().encryptedAtRest, process.platform === "win32");
    assert.deepEqual(config.secretValues(), [knownSecret]);
    assert.doesNotMatch(await readFile(path.join(temp, "secrets.json"), "utf8"), new RegExp(knownSecret));

    const envStore = new EnvManagerStore(temp);
    await envStore.load();
    const environment: Environment = {
        id: "env_test",
        projectId: "project_test",
        name: "Test",
        kind: "local",
        color: "#000000",
        isDefault: true,
        variables: [{ id: "var_test", name: "TOKEN", value: "environment-secret-98765", category: "auth", tags: [] }],
        updatedAt: Date.now(),
    };
    await envStore.upsertEnvironment(environment);
    assert.doesNotMatch(await readFile(path.join(temp, "envmanager.json"), "utf8"), /environment-secret-98765/);
    const reloadedEnv = new EnvManagerStore(temp);
    await reloadedEnv.load();
    assert.deepEqual(reloadedEnv.secretValues(), ["environment-secret-98765"]);

    const vault = new KeyVaultStore(temp);
    await vault.load();
    const apiKey: APIKey = {
        id: "key_test",
        serviceId: "example",
        serviceName: "Example",
        serviceDomain: "example.com",
        nickname: "Test key",
        keyValue: "vault-secret-24680", // gitleaks:allow -- synthetic value used to verify encrypted persistence.
        keyPreview: "",
        category: "development",
        environment: "testing",
        status: "unverified",
        expiresAt: null,
        lastUsed: null,
        lastTested: null,
        testStatus: "untested",
        aiAgentAccess: false,
        aiAccessScope: "read",
        projectId: null,
        scopes: [],
        note: "",
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
    await vault.upsertKey(apiKey);
    assert.doesNotMatch(await readFile(path.join(temp, "keyvault.json"), "utf8"), /vault-secret-24680/);
    const reloadedVault = new KeyVaultStore(temp);
    await reloadedVault.load();
    assert.deepEqual(reloadedVault.secretValues(), ["vault-secret-24680"]);

    let redactionEnabled = true;
    const redactor = new SecretRedactor(
        () => redactionEnabled,
        [() => config.secretValues(), () => reloadedEnv.secretValues(), () => reloadedVault.secretValues()],
    );
    const sourceEvent = {
        type: "chat:history",
        messages: [{ content: `credential=${knownSecret} Authorization: Bearer abcdefghijklmnop` }],
    };
    const sanitized = redactor.redactOutboundEvent(sourceEvent);
    assert.notEqual(sanitized, sourceEvent, "redaction must not mutate the stored/source event");
    assert.equal(sourceEvent.messages[0]?.content.includes(knownSecret), true);
    assert.equal(sanitized.messages[0]?.content.includes(knownSecret), false);
    assert.match(sanitized.messages[0]?.content ?? "", new RegExp(REDACTED.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    let redactionSourceReads = 0;
    const bulkRedactor = new SecretRedactor(
        () => true,
        [() => {
            redactionSourceReads += 1;
            return [knownSecret];
        }],
    );
    const bulkSanitized = bulkRedactor.redactOutboundEvent({
        type: "financial:getTransactions",
        result: Array.from({ length: 1_000 }, (_, index) => ({ id: `row_${index}`, merchant: `Merchant ${index}`, notes: index === 999 ? knownSecret : "safe" })),
    });
    assert.equal(redactionSourceReads, 1, "secret sources must be read once per top-level redaction walk");
    assert.equal(bulkSanitized.result[999]?.notes, REDACTED, "the cached secret snapshot must redact every nested row");
    const explicitSecretState = { type: "keyvault:state", state: { value: knownSecret } };
    assert.equal(redactor.redactOutboundEvent(explicitSecretState), explicitSecretState, "dedicated secret management state stays usable");
    assert.deepEqual(processEnvironmentSecretValues({ PUBLIC_VALUE: "visible", SERVICE_TOKEN: "process-secret" }), ["process-secret"]);
    redactionEnabled = false;
    assert.equal(redactor.redactOutboundEvent(sourceEvent), sourceEvent, "the opt-out must take effect immediately");
    redactionEnabled = true;

    const diagnostics = new LocalDiagnostics(temp, () => true, () => true, redactor);
    await diagnostics.load();
    diagnostics.recordCommand("chat:send");
    await diagnostics.captureCrash(new Error(`failure with ${knownSecret}`), "smoke");
    await diagnostics.stop();
    const diagnosticState = diagnostics.status();
    assert.equal(diagnosticState.localOnly, true);
    assert.equal(diagnosticState.telemetryEventCount, 1);
    assert.equal(diagnosticState.storedCrashCount, 1);
    const rawDiagnostics = await readFile(path.join(temp, "diagnostics.json"), "utf8");
    assert.doesNotMatch(rawDiagnostics, new RegExp(knownSecret));
    const protectedDiagnostics = await readProtectedJson<{ crashes: Array<{ message: string }> }>(path.join(temp, "diagnostics.json"));
    assert.doesNotMatch(protectedDiagnostics.value.crashes[0]?.message ?? "", new RegExp(knownSecret));
    assert.equal(await diagnostics.clear(), 2);
    assert.equal(diagnostics.status().telemetryEventCount, 0);
    assert.equal(diagnostics.status().storedCrashCount, 0);

    const disabledDiagnostics = new LocalDiagnostics(temp, () => false, () => false, redactor);
    await disabledDiagnostics.load();
    disabledDiagnostics.recordCommand("task:create");
    await disabledDiagnostics.captureCrash(new Error("must not be retained"), "smoke");
    assert.equal(disabledDiagnostics.status().telemetryEventCount, 0, "telemetry is opt-in");
    assert.equal(disabledDiagnostics.status().storedCrashCount, 0, "crash capture is opt-in");
    await disabledDiagnostics.stop();

    const orchestratorSource = await readFile(new URL("../src/orchestrator.ts", import.meta.url), "utf8");
    const bridgeSource = await readFile(new URL("../src/bridge/server.ts", import.meta.url), "utf8");
    assert.match(orchestratorSource, /case "security:get"/);
    assert.match(orchestratorSource, /case "security:clearSecrets"/);
    assert.match(orchestratorSource, /case "security:clearDiagnostics"/);
    assert.match(bridgeSource, /this\.encode\(event\)/, "all outbound bridge events use the redaction boundary");

    assert.equal(await config.clearSecrets(), 1);
    assert.equal(await reloadedEnv.clearSecrets(), 1);
    assert.equal(await reloadedVault.clearSecrets(), 1);
    assert.equal(config.secretStoreStatus().itemCount, 0);
    assert.deepEqual(reloadedEnv.secretValues(), []);
    assert.deepEqual(reloadedVault.secretValues(), []);

    console.log("Security/privacy smoke checks passed.");
} finally {
    await rm(temp, { recursive: true, force: true });
}
