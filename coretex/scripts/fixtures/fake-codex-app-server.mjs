import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin });

const thread = (id, status = { type: "notLoaded" }, turns = []) => ({
    id,
    sessionId: id,
    name: id === "thread-1" ? "Coretex bridge test" : null,
    preview: id === "thread-1" ? "Inspect the provider bridge" : "",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 1_725_000_000,
    updatedAt: 1_725_000_060,
    status,
    cwd: "L:\\agents",
    source: "appServer",
    turns,
});

function send(message) {
    process.stdout.write(`${JSON.stringify(message)}\n`);
}

function fail(id, message) {
    send({ id, error: { code: -32602, message } });
}

rl.on("line", (line) => {
    const message = JSON.parse(line);
    const { id, method, params = {} } = message;
    if (id === undefined) return;
    if (id === "approval-1" && method === undefined) {
        if (message.error?.code !== -32601 || message.result !== undefined) return fail(id, "approval was not denied");
        const turn = { id: "turn-new", status: "completed", items: [], error: null };
        send({ method: "turn/completed", params: { threadId: "thread-1", turn } });
        return;
    }
    switch (method) {
        case "initialize":
            if (params.clientInfo?.name !== "coretex") return fail(id, "missing client metadata");
            send({ id, result: { userAgent: "fake", platformFamily: "windows", platformOs: "windows" } });
            return;
        case "account/read":
            // Extra secret-like fields prove the normalizer does not forward unknown auth data.
            send({ id, result: { account: { type: "chatgpt", email: "private@example.test", planType: "pro", accessToken: "secret-token" }, requiresOpenaiAuth: true } });
            return;
        case "account/rateLimits/read":
            send({ id, result: { rateLimits: { primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1_725_010_000 }, secondary: null, planType: "pro", rateLimitReachedType: null, credits: { hasCredits: true, unlimited: false, balance: "5" } }, rateLimitResetCredits: { availableCount: 2, credits: null } } });
            return;
        case "model/list":
            send({ id, result: { data: [{ id: "gpt-test", model: "gpt-test", displayName: "GPT Test", description: "Fixture model", hidden: false, defaultReasoningEffort: "low", supportedReasoningEfforts: [{ reasoningEffort: "low", description: "Fast" }], inputModalities: ["text", "image"], supportsPersonality: true, isDefault: true }], nextCursor: null } });
            return;
        case "thread/list":
            if (params.useStateDbOnly !== true) return fail(id, "state DB mode required");
            if (JSON.stringify(params.sourceKinds) !== JSON.stringify(["cli", "vscode", "exec", "appServer"])) return fail(id, "interactive source filter required");
            send({ id, result: { data: [thread("thread-1")], nextCursor: null } });
            return;
        case "thread/loaded/list":
            send({ id, result: { data: ["thread-1"], nextCursor: null } });
            return;
        case "thread/read":
            if (params.threadId === "thread-paginated" && params.includeTurns !== false) {
                return fail(id, "paginated threads do not support thread/read(includeTurns=true)");
            }
            send({
                id,
                result: {
                    thread: thread(params.threadId, { type: "idle" }, params.includeTurns === false ? [] : [{
                        id: "turn-old",
                        status: "completed",
                        startedAt: 1_725_000_000,
                        completedAt: 1_725_000_001,
                        durationMs: 1_000,
                        items: [
                            { type: "userMessage", id: "user-1", content: [{ type: "text", text: "hello", text_elements: [] }] },
                            { type: "commandExecution", id: "cmd-1", command: "curl -H 'Authorization: Bearer secret-token'", aggregatedOutput: "secret-token", status: "completed", durationMs: 10, exitCode: 0 }, // gitleaks:allow -- synthetic redaction fixture.
                            { type: "agentMessage", id: "agent-1", text: "world" },
                        ],
                    }]),
                },
            });
            return;
        case "thread/start":
            if (params.modelProvider !== "openai" || params.approvalsReviewer !== "user" || params.sandbox !== "read-only" || params.threadSource !== "coretex" || params.config?.model_reasoning_effort !== "low") {
                return fail(id, "unsafe or incomplete thread/start settings");
            }
            send({ id, result: { thread: thread("thread-new", { type: "idle" }), model: params.model ?? "gpt-test", modelProvider: "openai" } });
            send({ method: "thread/started", params: { thread: thread("thread-new", { type: "idle" }) } });
            send({ method: "thread/status/changed", params: { threadId: "thread-new", status: { type: "systemError" } } });
            return;
        case "thread/resume":
            if (params.config?.model_reasoning_effort !== "low" || params.approvalsReviewer !== "user" || params.sandbox !== "read-only") return fail(id, "unsafe or incomplete resume settings");
            send({ id, result: { thread: thread(params.threadId, { type: "idle" }), model: params.model ?? "gpt-test", modelProvider: "openai" } });
            return;
        case "turn/start": {
            if (params.approvalsReviewer !== "user" || params.approvalPolicy !== "never" || params.sandboxPolicy?.type !== "readOnly" || params.sandboxPolicy?.networkAccess !== false) {
                return fail(id, "unsafe turn/start settings");
            }
            const turn = { id: "turn-new", status: "inProgress", items: [], error: null };
            send({ id, result: { turn } });
            send({ method: "turn/started", params: { threadId: params.threadId, turn } });
            send({ method: "item/agentMessage/delta", params: { threadId: params.threadId, turnId: turn.id, itemId: "agent-new", delta: "OK" } });
            // The bridge must fail closed: only complete this fixture turn after
            // it rejects the server-initiated approval request with an RPC error.
            send({ id: "approval-1", method: "item/commandExecution/requestApproval", params: { threadId: params.threadId, turnId: turn.id, command: "unsafe fixture command" } });
            return;
        }
        case "account/login/start":
            send({ id, result: params.type === "chatgptDeviceCode" ? { type: "chatgptDeviceCode", loginId: "login-1", verificationUrl: "https://example.test/device", userCode: "ABCD" } : { type: "chatgpt", loginId: "login-1", authUrl: "https://example.test/login" } });
            return;
        case "account/login/cancel":
        case "account/logout":
            send({ id, result: {} });
            return;
        default:
            fail(id, `unsupported fixture method: ${method}`);
    }
});
