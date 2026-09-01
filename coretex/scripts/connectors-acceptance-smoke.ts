import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
    connectorCredentialEnvironment,
    connectorRuntimeServerIds,
    effectiveConnectorIds,
    EXPLICIT_NONE_CONNECTOR_ID,
    resolveConnectorToolBinding,
    resolveConnectorToolCall,
} from "../src/connectors/access.js";
import { connectorRuntimeMatches, connectorRuntimeSpec } from "../src/connectors/runtime-catalog.js";
import { agentPolicyHooks } from "../src/agents/claude-runtime.js";
import { KeyVaultStore, sanitizeIntegration } from "../src/keyvault/store.js";
import type { ServiceConnection } from "../src/types.js";

function connection(id: string, serviceId: string, patch: Partial<ServiceConnection> = {}): ServiceConnection {
    return {
        id,
        serviceId,
        serviceName: serviceId === "twilio" ? "Twilio" : serviceId,
        serviceDomain: `${serviceId}.example`,
        category: "communication",
        status: "connecting",
        authType: "basic",
        connectedAs: `${serviceId}-${id}`,
        connectedAt: Date.now(),
        lastSyncedAt: null,
        mcpEnabled: false,
        mcpTools: [],
        stats: [],
        color: "#334455",
        requireConfirmWrites: true,
        agentEnabled: true,
        verification: "unverified",
        ...patch,
    };
}

async function main(): Promise<void> {
    const temp = await mkdtemp(path.join(os.tmpdir(), "coretex-connectors-"));
    const originalFetch = globalThis.fetch;
    try {
        const vault = new KeyVaultStore(temp);
        await vault.load();

        const first = await vault.connectIntegration(connection("acct-a", "twilio"), [
            { label: "Account SID", value: "AC-first", linkedEnvVarName: "TWILIO_ACCOUNT_SID", primary: true },
            { label: "Auth Token", value: "token-first", linkedEnvVarName: "TWILIO_AUTH_TOKEN" },
        ]);
        assert.equal(first.integration.status, "partial", "unsupported verifier must never claim connected");
        assert.equal(first.integration.verification, "unverified");
        assert.equal(first.credentialIds.length, 2, "every credential field must persist");
        const firstKeys = vault.state().keys.filter((key) => key.integrationId === "acct-a");
        assert.deepEqual(firstKeys.map((key) => key.credentialLabel), ["Account SID", "Auth Token"]);
        assert.deepEqual(firstKeys.map((key) => key.linkedEnvVarName), ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"]);

        const second = await vault.connectIntegration(connection("acct-b", "twilio"), [
            { label: "Account SID", value: "AC-second", linkedEnvVarName: "TWILIO_ACCOUNT_SID", primary: true },
            { label: "Auth Token", value: "token-second", linkedEnvVarName: "TWILIO_AUTH_TOKEN" },
        ]);
        assert.equal(second.credentialIds.length, 2);
        const disconnected = await vault.disconnectIntegration("acct-a");
        assert.ok(disconnected);
        assert.equal(disconnected.integration.status, "disconnected");
        assert.equal(vault.state().keys.some((key) => key.integrationId === "acct-a"), false, "disconnect removes only the selected account's keys");
        assert.equal(vault.state().keys.filter((key) => key.integrationId === "acct-b").length, 2, "another account's keys must survive");

        const authorization: string[] = [];
        let responseMode: "ok" | "slack-error" | "graphql-error" = "ok";
        globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
            const header = new Headers(init?.headers).get("authorization");
            if (header) authorization.push(header);
            if (responseMode === "slack-error") return new Response(JSON.stringify({ ok: false, error: "invalid_auth" }), { status: 200, headers: { "content-type": "application/json" } });
            if (responseMode === "graphql-error") return new Response(JSON.stringify({ errors: [{ message: "invalid token" }] }), { status: 200, headers: { "content-type": "application/json" } });
            return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
        }) as typeof fetch;

        await vault.connectIntegration(connection("github-a", "github", { authType: "api_key", category: "development" }), [
            { label: "API key", value: "github-token-a", primary: true },
        ]);
        await vault.connectIntegration(connection("github-b", "github", { authType: "api_key", category: "development" }), [
            { label: "API key", value: "github-token-b", primary: true },
        ]);
        authorization.length = 0;
        await vault.verifyIntegration("github-a");
        assert.deepEqual(authorization, ["Bearer github-token-a"], "verification must use the exact account-linked primary credential");

        responseMode = "slack-error";
        const slack = await vault.connectIntegration(connection("slack-error", "slack", { authType: "api_key" }), [
            { label: "Bot token", value: "xoxb-invalid", primary: true },
        ]);
        assert.equal(slack.integration.status, "error", "Slack HTTP 200 with ok:false must fail verification");
        responseMode = "graphql-error";
        const linear = await vault.connectIntegration(connection("linear-error", "linear", { authType: "api_key" }), [
            { label: "API key", value: "linear-invalid", primary: true },
        ]);
        assert.equal(linear.integration.status, "error", "GraphQL HTTP 200 with errors must fail verification");
        responseMode = "ok";

        const runtimeA = connection("runtime-a", "github", {
            status: "partial",
            verification: "unverified",
            mcpEnabled: true,
            runtimeServerId: "vault-github-runtime-a",
        });
        const runtimeB = connection("runtime-b", "slack", {
            status: "connected",
            verification: "verified",
            mcpEnabled: true,
            runtimeServerId: "vault-slack-runtime-b",
        });
        const disabled = connection("runtime-disabled", "notion", {
            status: "connected",
            verification: "verified",
            mcpEnabled: true,
            runtimeServerId: "vault-notion-runtime-disabled",
            agentEnabled: false,
        });
        const integrations = [runtimeA, runtimeB, disabled];

        assert.deepEqual(
            effectiveConnectorIds({ integrations, projectTask: true, projectConnectorIds: [runtimeA.id, runtimeB.id], agentConnectorIds: [] }),
            [runtimeA.id, runtimeB.id],
            "an empty agent list inherits the project's explicit allowlist",
        );
        assert.deepEqual(
            effectiveConnectorIds({ integrations, projectTask: true, projectConnectorIds: undefined, agentConnectorIds: [] }),
            [],
            "project tasks require a project connector allowlist",
        );
        assert.deepEqual(
            effectiveConnectorIds({ integrations, projectTask: true, projectConnectorIds: [runtimeA.id, runtimeB.id], agentConnectorIds: [runtimeB.id] }),
            [runtimeB.id],
            "agent selection narrows project access",
        );
        assert.deepEqual(
            effectiveConnectorIds({ integrations, projectTask: false, agentConnectorIds: [EXPLICIT_NONE_CONNECTOR_ID] }),
            [],
            "explicit none never inherits",
        );
        assert.deepEqual(
            connectorRuntimeServerIds(integrations, [runtimeB.id]),
            ["vault-slack-runtime-b"],
            "connector account selection must gate the actual MCP runtime",
        );

        const vaultBeforeEnv = vault.state();
        const env = connectorCredentialEnvironment(vaultBeforeEnv.keys, vaultBeforeEnv.integrations, ["acct-b"]);
        assert.deepEqual(env, { TWILIO_ACCOUNT_SID: "AC-second", TWILIO_AUTH_TOKEN: "token-second" });
        const ownedKey = vaultBeforeEnv.keys.find((key) => key.integrationId === "acct-b");
        assert.ok(ownedKey);
        assert.equal(connectorCredentialEnvironment([
            ...vaultBeforeEnv.keys,
            { ...ownedKey, id: "forged-key", linkedEnvVarName: "NODE_OPTIONS", keyValue: "--require=malware.js" },
        ], vaultBeforeEnv.integrations, ["acct-b"]).NODE_OPTIONS, undefined, "a key must be linked from both sides before entering an agent environment");
        await vault.upsertKey({ ...ownedKey, linkedEnvVarName: "NODE_OPTIONS", credentialLabel: "forged" });
        const afterOwnedKeyEdit = vault.state();
        assert.equal(
            connectorCredentialEnvironment(afterOwnedKeyEdit.keys, afterOwnedKeyEdit.integrations, ["acct-b"]).NODE_OPTIONS,
            undefined,
            "renderer key edits cannot change store-owned connector environment linkage",
        );

        const forged = sanitizeIntegration(connection("forged", "custom", { status: "connected", verification: "unverified" }));
        assert.equal(forged.status, "partial", "renderer metadata cannot manufacture a verified connection");

        assert.deepEqual(connectorRuntimeSpec("github"), {
            command: "docker",
            args: "run -i --rm -e GITHUB_PERSONAL_ACCESS_TOKEN ghcr.io/github/github-mcp-server",
            envKeys: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
        }, "GitHub must use the reviewed official Docker adapter");
        assert.deepEqual(connectorRuntimeSpec("notion"), {
            command: "npx",
            args: "-y @notionhq/notion-mcp-server",
            envKeys: ["NOTION_TOKEN"],
        }, "Notion must use its reviewed maintained npm adapter");
        assert.equal(connectorRuntimeSpec("slack"), undefined, "Slack is credential-only until a supported hosted OAuth/HTTP runtime exists");
        assert.equal(connectorRuntimeSpec("custom"), undefined, "unknown services can never supply an executable adapter");
        assert.equal(connectorRuntimeMatches("github", {
            transport: "stdio",
            command: "node",
            args: "malware.js",
            envKeys: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
        }), false, "renderer-supplied connector commands must not cross the executable boundary");
        assert.equal(connectorRuntimeMatches("github", {
            transport: "stdio",
            command: "docker",
            args: "run -i --rm -e GITHUB_PERSONAL_ACCESS_TOKEN ghcr.io/github/github-mcp-server",
            envKeys: ["GITHUB_PERSONAL_ACCESS_TOKEN", "NODE_OPTIONS"],
        }), false, "renderer-supplied connector environment keys must match the reviewed adapter exactly");

        const policyRuntimeId = "vault-github-policy-account";
        const policyConnection = await vault.connectIntegration(connection("policy-account", "github", {
            authType: "api_key",
            category: "development",
            mcpEnabled: true,
            agentEnabled: true,
            runtimeServerId: policyRuntimeId,
            requireConfirmWrites: true,
            mcpTools: [
                { id: "policy-read", name: "Get File", description: "Read a file", permission: "read", requiresConfirmation: false, usageLimit: 2, callsToday: 0 },
                { id: "policy-write", name: "Create Issue", description: "Create an issue", permission: "write", requiresConfirmation: true, usageLimit: 1, callsToday: 0 },
                { id: "policy-zero", name: "List Issues", description: "List issues", permission: "read", requiresConfirmation: false, usageLimit: 0, callsToday: 0 },
                { id: "policy-parallel", name: "Search Code", description: "Search code", permission: "read", requiresConfirmation: false, usageLimit: 1, callsToday: 0 },
            ],
        }), [
            { label: "Personal access token", value: "github-policy-secret", linkedEnvVarName: "GITHUB_PERSONAL_ACCESS_TOKEN", primary: true },
        ]);
        assert.equal(policyConnection.integration.status, "connected");
        await vault.reconcileConnectorTools("policy-account", policyRuntimeId, [
            "get_file",
            "create_issue",
            "list_issues",
            "search_code",
            "unreviewed_tool",
            "nested__runtime_tool",
        ]);
        const policyIntegration = vault.state().integrations.find((integration) => integration.id === "policy-account");
        assert.ok(policyIntegration);
        assert.equal(resolveConnectorToolBinding(policyIntegration, policyRuntimeId, "get_file")?.id, "policy-read", "a conservative normalized preset match may claim an exact runtime name");
        assert.equal(resolveConnectorToolBinding(policyIntegration, policyRuntimeId, "unreviewed_tool")?.permission, "disabled", "newly discovered tools must fail closed");
        assert.deepEqual(resolveConnectorToolCall(
            [policyIntegration],
            `mcp__${policyRuntimeId}__nested__runtime_tool`,
        ), {
            integrationId: "policy-account",
            runtimeServerId: policyRuntimeId,
            runtimeName: "nested__runtime_tool",
        }, "exact FQN resolution must preserve the complete runtime name with hyphenated account runtime ids");
        assert.equal(resolveConnectorToolCall([
            policyIntegration,
            { ...policyIntegration, id: "duplicate-policy-account" },
        ], `mcp__${policyRuntimeId}__get_file`), null, "ambiguous duplicate runtime ids must fail closed");

        const policyBase = {
            integrationId: "policy-account",
            effectiveConnectorIds: ["policy-account"],
            runtimeServerId: policyRuntimeId,
            globalReadOnly: false,
            effectivePolicy: "auto" as const,
            agentId: "outer-agent",
            taskId: "outer-task",
            projectId: "outer-project",
        };
        const planDenied = await vault.authorizeAndReserveConnectorTool({ ...policyBase, runtimeName: "get_file", effectivePolicy: "plan-only" });
        assert.equal(planDenied.authorized ? "authorized" : planDenied.code, "execution_policy_plan_only");
        const confirmDenied = await vault.authorizeAndReserveConnectorTool({ ...policyBase, runtimeName: "get_file", effectivePolicy: "confirm" });
        assert.equal(confirmDenied.authorized ? "authorized" : confirmDenied.code, "approval_required");
        const scopeDenied = await vault.authorizeAndReserveConnectorTool({ ...policyBase, runtimeName: "get_file", effectiveConnectorIds: [] });
        assert.equal(scopeDenied.authorized ? "authorized" : scopeDenied.code, "connector_not_allowed");
        const unknownDenied = await vault.authorizeAndReserveConnectorTool({ ...policyBase, runtimeName: "not_from_tools_list" });
        assert.equal(unknownDenied.authorized ? "authorized" : unknownDenied.code, "tool_unknown");
        const disabledDenied = await vault.authorizeAndReserveConnectorTool({ ...policyBase, runtimeName: "unreviewed_tool" });
        assert.equal(disabledDenied.authorized ? "authorized" : disabledDenied.code, "tool_disabled");
        const readOnlyDenied = await vault.authorizeAndReserveConnectorTool({ ...policyBase, runtimeName: "create_issue", globalReadOnly: true });
        assert.equal(readOnlyDenied.authorized ? "authorized" : readOnlyDenied.code, "global_read_only");
        const approvalDenied = await vault.authorizeAndReserveConnectorTool({ ...policyBase, runtimeName: "create_issue" });
        assert.equal(approvalDenied.authorized ? "authorized" : approvalDenied.code, "approval_required");
        const zeroDenied = await vault.authorizeAndReserveConnectorTool({ ...policyBase, runtimeName: "list_issues" });
        assert.equal(zeroDenied.authorized ? "authorized" : zeroDenied.code, "usage_limit_reached", "zero is an enforceable daily limit, not unlimited");

        const dayOne = Date.UTC(2026, 7, 25, 12);
        const readOne = await vault.authorizeAndReserveConnectorTool({ ...policyBase, runtimeName: "get_file", now: dayOne });
        const readTwo = await vault.authorizeAndReserveConnectorTool({ ...policyBase, runtimeName: "get_file", now: dayOne + 1 });
        const readThree = await vault.authorizeAndReserveConnectorTool({ ...policyBase, runtimeName: "get_file", now: dayOne + 2 });
        assert.equal(readOne.authorized, true);
        assert.equal(readTwo.authorized, true);
        assert.equal(readThree.authorized ? "authorized" : readThree.code, "usage_limit_reached");
        const nextDay = await vault.authorizeAndReserveConnectorTool({ ...policyBase, runtimeName: "get_file", now: dayOne + 86_400_000 });
        assert.equal(nextDay.authorized, true, "daily counters must roll over by UTC day");

        const parallel = await Promise.all(Array.from({ length: 4 }, (_, index) =>
            vault.authorizeAndReserveConnectorTool({ ...policyBase, runtimeName: "search_code", now: dayOne + index }),
        ));
        assert.equal(parallel.filter((result) => result.authorized).length, 1, "parallel reservations must not oversubscribe a one-call quota");

        const afterReservation = vault.state().integrations.find((integration) => integration.id === "policy-account");
        assert.ok(afterReservation);
        const reservedCount = resolveConnectorToolBinding(afterReservation, policyRuntimeId, "get_file")?.callsToday;
        await vault.upsertIntegration({
            ...afterReservation,
            runtimeServerId: "attacker-controlled-runtime",
            mcpTools: afterReservation.mcpTools.map((binding) => ({ ...binding, callsToday: 0, callsDay: "1970-01-01" })),
        });
        const afterRendererReset = vault.state().integrations.find((integration) => integration.id === "policy-account");
        assert.ok(afterRendererReset);
        assert.equal(afterRendererReset.runtimeServerId, policyRuntimeId, "renderer metadata cannot replace store-owned connector runtime identity");
        assert.equal(resolveConnectorToolBinding(afterRendererReset, policyRuntimeId, "get_file")?.callsToday, reservedCount, "renderer metadata cannot reset connector quota counters");
        assert.equal(JSON.stringify(vault.state().audit).includes("github-policy-secret"), false, "connector authorization audits must never contain credentials");

        const guardedFqn = `mcp__${policyRuntimeId}__create_issue`;
        const hookCalls: string[] = [];
        const hooks = agentPolicyHooks(undefined, async (toolName) => {
            hookCalls.push(toolName);
            if (toolName === guardedFqn) return { allowed: false, reason: "Approval required by connector policy." };
            return null;
        });
        const connectorHook = hooks?.PreToolUse?.find((matcher) => matcher.matcher === undefined);
        assert.ok(connectorHook, "connector policy must use a generic PreToolUse hook with no SDK matcher");
        const hookOutput = await connectorHook.hooks[0]({
            hook_event_name: "PreToolUse",
            tool_name: guardedFqn,
            tool_input: { body: "must not enter policy audit" },
            tool_use_id: "sdk-provided-call-id",
            session_id: "sdk-session",
            transcript_path: "",
            cwd: "",
            permission_mode: "default",
        }, "sdk-provided-call-id", { signal: new AbortController().signal });
        assert.equal((hookOutput as { hookSpecificOutput?: { permissionDecision?: string } }).hookSpecificOutput?.permissionDecision, "deny", "recognized connector calls must receive an explicit hook decision");
        assert.deepEqual(hookCalls, [guardedFqn]);

        console.log("Connector acceptance smoke passed.");
    } finally {
        globalThis.fetch = originalFetch;
        await rm(temp, { recursive: true, force: true });
    }
}

await main();
