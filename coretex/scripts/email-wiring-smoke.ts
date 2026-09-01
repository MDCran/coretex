import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { ConfigStore } from "../src/config/store.js";
import { bridgeAuthProtocols, isTrustedOrigin } from "../src/bridge/server.js";
import { EmailStore } from "../src/email/store.js";
import { PROVIDER_PRESETS, resolveEndpoint, testConnection, testSmtpConnection } from "../src/email/imap.js";
import { Orchestrator } from "../src/orchestrator.js";
import type { EmailAccount, EmailMessage } from "../src/types.js";

const temp = await mkdtemp(path.join(os.tmpdir(), "coretex-email-smoke-"));

async function freePort(): Promise<number> {
    return await new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (!address || typeof address === "string") return reject(new Error("Could not allocate a test port."));
            server.close((error) => error ? reject(error) : resolve(address.port));
        });
    });
}

async function nextMessage(socket: WebSocket, predicate: (value: any) => boolean): Promise<any> {
    return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timed out waiting for bridge state.")), 5000);
        const onMessage = (data: WebSocket.RawData) => {
            const value = JSON.parse(data.toString());
            if (!predicate(value)) return;
            clearTimeout(timer);
            socket.off("message", onMessage);
            resolve(value);
        };
        socket.on("message", onMessage);
    });
}

try {
    assert.equal(PROVIDER_PRESETS.gmail.imapHost, "imap.gmail.com");
    assert.equal(PROVIDER_PRESETS.gmail.smtpPort, 465);
    assert.equal(PROVIDER_PRESETS.outlook.smtpPort, 587);
    assert.equal(resolveEndpoint("custom", { imapHost: "in.example.test", smtpHost: "out.example.test", smtpPort: 587 }).smtpSecure, false);
    assert.equal(resolveEndpoint("gmail", { smtpPort: 587, smtpSecure: false }).smtpSecure, false);
    assert.equal(isTrustedOrigin("https://attacker.example"), false);
    assert.equal(isTrustedOrigin("http://localhost:5173", ["http://localhost:5173"]), true);
    assert.equal(isTrustedOrigin("http://localhost:5174", ["http://localhost:5173"]), false);
    assert.equal(isTrustedOrigin(undefined), true);

    const config = new ConfigStore(temp);
    await config.load();
    await config.setSecret("email.account.test.password", "smoke-secret-not-real");
    const rawSecrets = await readFile(path.join(temp, "secrets.json"), "utf8");
    assert.equal(rawSecrets.includes("smoke-secret-not-real"), false, "secret file must not contain plaintext");
    const reloadedConfig = new ConfigStore(temp);
    await reloadedConfig.load();
    assert.equal(reloadedConfig.getSecret("email.account.test.password"), "smoke-secret-not-real");

    const store = new EmailStore(temp);
    await store.load();
    assert.equal(store.state().messages.length, 12);
    assert.equal(store.state().agent.autoSortOnReceive, true);
    const account: EmailAccount = {
        id: "acct_smoke",
        email: "smoke@example.test",
        name: "Smoke",
        avatar: "",
        connected: true,
        kind: "imap",
        provider: "custom",
        imapHost: "imap.example.test",
        smtpHost: "smtp.example.test",
    };
    await store.addImapAccount(account);
    const message: EmailMessage = {
        id: "acct_smoke:1",
        threadId: "acct_smoke:1",
        accountId: "acct_smoke",
        from: { name: "Sender", email: "sender@example.test" },
        to: [{ name: "Smoke", email: "smoke@example.test" }],
        cc: [],
        subject: "Smoke",
        bodyHtml: "<p>Smoke</p>",
        bodyText: "Smoke",
        snippet: "Smoke",
        attachments: [],
        folder: "inbox",
        labels: [],
        aiCategory: null,
        isRead: false,
        isStarred: false,
        timestamp: Date.now(),
        inReplyTo: null,
    };
    await store.setAccountMessages(account.id, [message]);
    await store.move(message.id, "archive");
    const rawMail = await readFile(path.join(temp, "email.json"), "utf8");
    assert.equal(rawMail.includes("sender@example.test"), false, "cached mail must not contain plaintext");
    const reloadedStore = new EmailStore(temp);
    await reloadedStore.load();
    assert.equal(reloadedStore.getMessage(message.id)?.folder, "archive");

    const imapError = await testConnection({ host: "127.0.0.1", port: 1, secure: false, user: "x", pass: "x" });
    assert.ok(imapError, "unreachable IMAP must fail");
    const smtpError = await testSmtpConnection({ host: "127.0.0.1", port: 1, secure: false, user: "x", pass: "x", fromName: "x", fromEmail: "x@example.test" });
    assert.ok(smtpError, "unreachable SMTP must fail");

    const previousDataDir = process.env.CORETEX_DATA_DIR;
    const previousBridgeToken = process.env.CORETEX_BRIDGE_TOKEN;
    const previousBridgeOrigins = process.env.CORETEX_BRIDGE_ALLOWED_ORIGINS;
    const bridgeDir = path.join(temp, "bridge");
    process.env.CORETEX_DATA_DIR = bridgeDir;
    process.env.CORETEX_BRIDGE_TOKEN = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    process.env.CORETEX_BRIDGE_ALLOWED_ORIGINS = "http://localhost:5173";
    const port = await freePort();
    const orchestrator = new Orchestrator({ wsPort: port, tickIntervalMs: 1000 });
    await orchestrator.start();
    try {
        await new Promise<void>((resolve, reject) => {
            const hostile = new WebSocket(
                `ws://127.0.0.1:${port}`,
                bridgeAuthProtocols(process.env.CORETEX_BRIDGE_TOKEN!),
                { origin: "https://attacker.example" },
            );
            hostile.once("open", () => reject(new Error("Hostile browser Origin was accepted.")));
            hostile.once("unexpected-response", (_request, response) => {
                assert.equal(response.statusCode, 403);
                response.resume();
                resolve();
            });
            hostile.once("error", () => undefined);
        });

        const socket = new WebSocket(`ws://127.0.0.1:${port}`, bridgeAuthProtocols(process.env.CORETEX_BRIDGE_TOKEN!));
        await new Promise<void>((resolve, reject) => {
            socket.once("open", resolve);
            socket.once("error", reject);
        });
        socket.send(JSON.stringify({ type: "email:get" }));
        const initial = await nextMessage(socket, (value) => value.type === "email:state");
        const beforeCount = initial.state.messages.length;
        const requestId = "email_send_smoke";
        socket.send(JSON.stringify({ type: "email:send", requestId, to: "nobody@example.test", subject: "Smoke", body: "Smoke" }));
        const failed = await nextMessage(socket, (value) => value.type === "email:state" && value.state.sending?.requestId === requestId && value.state.sending.status === "error");
        assert.equal(failed.state.messages.length, beforeCount, "failed send must not create a Sent item");
        socket.close();
    } finally {
        orchestrator.stop();
        if (previousDataDir === undefined) delete process.env.CORETEX_DATA_DIR;
        else process.env.CORETEX_DATA_DIR = previousDataDir;
        if (previousBridgeToken === undefined) delete process.env.CORETEX_BRIDGE_TOKEN;
        else process.env.CORETEX_BRIDGE_TOKEN = previousBridgeToken;
        if (previousBridgeOrigins === undefined) delete process.env.CORETEX_BRIDGE_ALLOWED_ORIGINS;
        else process.env.CORETEX_BRIDGE_ALLOWED_ORIGINS = previousBridgeOrigins;
    }

    console.log("Email wiring smoke passed: presets, protected storage, persistence, bridge security, and transactional failure paths.");
} finally {
    await rm(temp, { recursive: true, force: true });
}
