import assert from "node:assert/strict";
import { BridgeClient } from "../src/bridge/client.js";

type OpenHandler = ((event: Event) => unknown) | null;
type MessageHandler = ((event: MessageEvent) => unknown) | null;
type CloseHandler = ((event: CloseEvent) => unknown) | null;

class FakeWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    static readonly instances: FakeWebSocket[] = [];

    readyState = FakeWebSocket.CONNECTING;
    onopen: OpenHandler = null;
    onmessage: MessageHandler = null;
    onclose: CloseHandler = null;
    onerror: OpenHandler = null;

    constructor(_url: string, _protocols?: string | string[]) {
        FakeWebSocket.instances.push(this);
    }

    send(_data: string): void {}

    close(): void {
        if (this.readyState < FakeWebSocket.CLOSING) this.readyState = FakeWebSocket.CLOSING;
    }

    open(): void {
        this.readyState = FakeWebSocket.OPEN;
        this.onopen?.(new Event("open"));
    }

    finishClose(): void {
        this.readyState = FakeWebSocket.CLOSED;
        this.onclose?.(new Event("close") as CloseEvent);
    }
}

const originalWebSocket = globalThis.WebSocket;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
const scheduled = new Map<number, () => void>();
let timerSequence = 0;

globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
globalThis.setTimeout = ((callback: TimerHandler) => {
    const id = ++timerSequence;
    scheduled.set(id, callback as () => void);
    return id;
}) as unknown as typeof setTimeout;
globalThis.clearTimeout = ((id: ReturnType<typeof setTimeout>) => {
    scheduled.delete(id as unknown as number);
}) as typeof clearTimeout;

try {
    const client = new BridgeClient("ws://127.0.0.1:1");
    let opens = 0;
    const unsubscribeOpen = client.onConnect(() => { opens += 1; });

    client.connect();
    const retired = FakeWebSocket.instances[0]!;
    client.disconnect();
    client.connect();
    const current = FakeWebSocket.instances[1]!;

    retired.finishClose();
    assert.equal(scheduled.size, 0, "a retired socket's late close must not schedule a parallel reconnect");

    unsubscribeOpen();
    current.open();
    assert.equal(opens, 0, "connection listeners must be removable during React effect cleanup");

    client.connect();
    assert.equal(FakeWebSocket.instances.length, 2, "connect must be idempotent while a socket is already open");

    current.finishClose();
    assert.equal(scheduled.size, 1, "the active socket should schedule exactly one reconnect");
    const reconnect = [...scheduled.values()][0]!;
    scheduled.clear();
    reconnect();
    assert.equal(FakeWebSocket.instances.length, 3, "the active socket should still reconnect after an unexpected close");

    client.disconnect();
} finally {
    globalThis.WebSocket = originalWebSocket;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
}

console.log("Bridge client lifecycle smoke passed: cleanup, stale-close suppression, and single reconnect chain.");
