import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { CodexAppServerClient } from "../src/agents/codex-app-server.js";
import type { ProviderSessionLiveEvent } from "../src/types.js";

const fixture = fileURLToPath(new URL("./fixtures/fake-codex-app-server.mjs", import.meta.url));
const events: ProviderSessionLiveEvent[] = [];
const waitForEvent = async (predicate: (event: ProviderSessionLiveEvent) => boolean): Promise<void> => {
    const deadline = Date.now() + 1_000;
    while (!events.some(predicate)) {
        if (Date.now() >= deadline) assert.fail("Timed out waiting for a Codex App Server event.");
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
};
const client = new CodexAppServerClient({
    command: process.execPath,
    args: [fixture],
    requestTimeoutMs: 5_000,
    onSessionEvent: (event) => events.push(event),
});

try {
    const state = await client.getSessions();
    assert.equal(state.account.status, "connected");
    assert.equal(state.account.authMode, "chatgpt");
    assert.equal(state.account.plan, "pro");
    assert.equal("email" in state.account, false);
    assert.equal(state.usage?.primary?.usedPercent, 25);
    assert.equal(state.models[0]?.id, "gpt-test");
    assert.equal(state.sessions[0]?.isLoaded, true);
    assert.equal(JSON.stringify(state).includes("private@example.test"), false);
    assert.equal(JSON.stringify(state).includes("secret-token"), false);

    const opened = await client.readSession("thread-1", true);
    assert.equal(opened.turns[0]?.items[0]?.text, "hello");
    assert.equal(opened.turns[0]?.items[2]?.text, "world");
    assert.equal(JSON.stringify(opened).includes("Authorization"), false);
    assert.equal(JSON.stringify(opened).includes("secret-token"), false);

    const paginated = await client.readSession("thread-paginated", true);
    assert.match(paginated.historyWarning ?? "", /paginated history/);
    assert.equal(paginated.turns.length, 0);

    const started = await client.startSession({ model: "gpt-test", effort: "low", permissionMode: "read-only" });
    assert.equal(started.id, "thread-new");
    await waitForEvent((event) => event.kind === "threadStatus" && event.status === "error");
    await assert.rejects(
        client.startSession({ model: "gpt-test", permissionMode: "workspace-write" }),
        /explicit absolute project folder/,
    );
    await assert.rejects(
        client.startSession({ model: "gpt-test", cwd: "relative/project", permissionMode: "workspace-write" }),
        /explicit absolute project folder/,
    );
    const resumed = await client.resumeSession({ sessionId: "thread-1", model: "gpt-test", effort: "low", permissionMode: "read-only" });
    assert.equal(resumed.id, "thread-1");
    await assert.rejects(
        client.resumeSession({ sessionId: "thread-1", cwd: "relative/project", permissionMode: "workspace-write" }),
        /explicit absolute project folder/,
    );

    const prompted = await client.promptSession({ sessionId: "thread-1", prompt: "Reply OK", model: "gpt-test", effort: "low", permissionMode: "read-only" });
    assert.equal(prompted.turnId, "turn-new");
    await assert.rejects(
        client.promptSession({ sessionId: "thread-1", prompt: "unsafe", permissionMode: "workspace-write" }),
        /explicit absolute project folder/,
    );
    await waitForEvent((event) => event.kind === "messageDelta" && event.text === "OK");
    await waitForEvent((event) => event.kind === "turnCompleted" && event.status === "completed");

    const auth = await client.startLogin("browser");
    assert.equal(auth.login?.authUrl, "https://example.test/login");
    assert.equal(auth.login?.loginId, "login-1");
    console.log("Codex App Server bridge smoke passed.");
} finally {
    client.stop();
}
