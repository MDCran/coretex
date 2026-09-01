import assert from "node:assert/strict";
import net from "node:net";
import { WebSocket } from "ws";
import {
    BRIDGE_PROTOCOL,
    BridgeServer,
    bridgeAuthProtocols,
    isTrustedOrigin,
} from "../src/bridge/server.js";

const TOKEN = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const WRONG_TOKEN = "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
const TRUSTED_ORIGIN = "http://localhost:4173";

async function freePort(): Promise<number> {
    return await new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once("error", reject);
        probe.listen(0, "127.0.0.1", () => {
            const address = probe.address();
            if (!address || typeof address === "string") return reject(new Error("Could not allocate a port."));
            probe.close((error) => error ? reject(error) : resolve(address.port));
        });
    });
}

async function expectRejected(socket: WebSocket, statusCode: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timed out waiting for HTTP ${statusCode}.`)), 3000);
        socket.once("open", () => reject(new Error("Rejected bridge client unexpectedly opened.")));
        socket.once("unexpected-response", (_request, response) => {
            clearTimeout(timer);
            assert.equal(response.statusCode, statusCode);
            response.resume();
            resolve();
        });
        socket.once("error", () => undefined);
    });
}

assert.equal(isTrustedOrigin(undefined, []), true, "native clients may omit Origin but must still authenticate");
assert.equal(isTrustedOrigin(TRUSTED_ORIGIN, [TRUSTED_ORIGIN]), true);
assert.equal(isTrustedOrigin("http://localhost:4174", [TRUSTED_ORIGIN]), false, "localhost ports are not interchangeable");
assert.equal(isTrustedOrigin("https://attacker.example", [TRUSTED_ORIGIN]), false);
assert.equal(isTrustedOrigin("http://localhost:4173/path", [TRUSTED_ORIGIN]), false);

const port = await freePort();
const bridge = new BridgeServer({ authToken: TOKEN, allowedOrigins: [TRUSTED_ORIGIN] });
let commandCount = 0;
bridge.on("command", () => { commandCount += 1; });
await bridge.start(port);

try {
    await expectRejected(new WebSocket(`ws://127.0.0.1:${port}`, { origin: TRUSTED_ORIGIN }), 401);
    await expectRejected(new WebSocket(`ws://127.0.0.1:${port}`, bridgeAuthProtocols(WRONG_TOKEN), { origin: TRUSTED_ORIGIN }), 401);
    await expectRejected(new WebSocket(`ws://127.0.0.1:${port}`, bridgeAuthProtocols(TOKEN), { origin: "https://attacker.example" }), 403);
    assert.equal(commandCount, 0, "rejected clients must not trigger status or command handling");

    const socket = new WebSocket(`ws://127.0.0.1:${port}`, bridgeAuthProtocols(TOKEN), { origin: TRUSTED_ORIGIN });
    await new Promise<void>((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
    });
    assert.equal(socket.protocol, BRIDGE_PROTOCOL, "the bearer token must not be reflected as the negotiated protocol");
    assert.equal(commandCount, 1, "an authenticated client receives the normal initial status request");

    const notice = new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Authenticated client did not receive a broadcast.")), 3000);
        socket.once("message", (raw) => {
            clearTimeout(timer);
            resolve(JSON.parse(raw.toString()) as Record<string, unknown>);
        });
    });
    bridge.broadcast({ type: "notice", level: "info", message: "authenticated" });
    assert.deepEqual(await notice, { type: "notice", level: "info", message: "authenticated" });

    socket.send(JSON.stringify({ type: "system:health_check" }));
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(commandCount, 2, "authenticated commands must continue through the normal bridge path");
    socket.close();
} finally {
    bridge.stop();
}

console.log("Bridge auth smoke passed: exact origins, token rejection, authenticated commands, and protected broadcasts.");
