// Coretex — Browser control service (#16). Owns the server-side model of each embedded
// browser session so agents (and the command router) can drive the in-app browser.
//
// HONEST host limits:
//   • navigate(sessionId, url) — REAL in every host. We set the session's controlledUrl
//     and broadcast a browser:event; the Relay folds that into the BrowserView's
//     `controlledUrl` prop, which actually loads the page (iframe OR Electron <webview>).
//   • readDom / click — require a same-process page bridge. ONLY the Electron
//     <webview>.executeJavaScript() upgrade can satisfy these. In the web/iframe host the
//     page is cross-origin and sandboxed, so we CANNOT read or script it — we return a
//     clear { ok:false, error:"not available in this host …" } result instead of crashing
//     or pretending. When an Electron host is present it performs the action and reports
//     the result back over `browser:resultReport`, which we resolve here.

import type { BrowserActionKind, BrowserControlResult, BrowserPageInfo, OrchestratorEvent } from "../types.js";
import { normalizeBrowserUrl } from "./url.js";

type Emit = (ev: OrchestratorEvent) => void;

interface SessionState {
    url: string;
    title?: string;
    controllerAgentId?: string;
}

/** Reply text used whenever a DOM-level action is attempted without the Electron bridge. */
const NO_BRIDGE =
    "not available in this host: DOM read/click need the Electron <webview> bridge (navigation works everywhere).";

export class BrowserControlService {
    private readonly sessions = new Map<string, SessionState>();
    /** Pending DOM round-trips awaiting a host (Electron) report, keyed by requestId. */
    private readonly pending = new Map<string, { sessionId: string; action: BrowserActionKind; resolve: (r: BrowserControlResult) => void; timer: ReturnType<typeof setTimeout> }>();
    /**
     * Whether ANY connected host can perform same-process page scripting (Electron <webview>).
     * The web/iframe Relay leaves this false, so DOM actions fail fast & honestly. A future
     * Electron host flips this true (e.g. via a `browser:report` carrying a capability flag).
     */
    private hostCanScript = false;
    /** How long to wait for a host to report a DOM result before giving up. */
    private static readonly REPORT_TIMEOUT_MS = 8000;
    private seq = 0;

    constructor(private readonly emit: Emit) {}

    /** Mark that a scripting-capable (Electron) host is connected. */
    setHostCanScript(can: boolean): void {
        this.hostCanScript = can;
    }

    private state(sessionId: string): SessionState {
        let s = this.sessions.get(sessionId);
        if (!s) {
            s = { url: "" };
            this.sessions.set(sessionId, s);
        }
        return s;
    }

    private pageInfo(sessionId: string): BrowserPageInfo {
        const s = this.state(sessionId);
        return {
            sessionId,
            url: s.url,
            title: s.title,
            aiControlled: !!s.controllerAgentId,
            controllerAgentId: s.controllerAgentId,
        };
    }

    private broadcastPage(sessionId: string): void {
        this.emit({ type: "browser:event", info: this.pageInfo(sessionId) });
    }

    private result(sessionId: string, action: BrowserActionKind, ok: boolean, valueOrError: string, requestId?: string): BrowserControlResult {
        const r: BrowserControlResult = ok
            ? { sessionId, action, ok, value: valueOrError, requestId }
            : { sessionId, action, ok, error: valueOrError, requestId };
        this.emit({ type: "browser:result", result: r });
        return r;
    }

    // ---- AI ownership (drives the "AI controlled" badge) ----

    /** Claim a session for an agent — flips the badge on and remembers the controller. */
    claim(sessionId: string, agentId: string): void {
        this.state(sessionId).controllerAgentId = agentId;
        this.broadcastPage(sessionId);
    }

    /** Release a session an agent owned (badge off). */
    release(sessionId: string, agentId?: string): void {
        const state = this.state(sessionId);
        if (agentId && state.controllerAgentId !== agentId) return;
        state.controllerAgentId = undefined;
        this.broadcastPage(sessionId);
    }

    controllerOf(sessionId: string): string | undefined {
        return this.state(sessionId).controllerAgentId;
    }

    releaseByAgent(agentId: string): void {
        for (const [sessionId, state] of this.sessions) {
            if (state.controllerAgentId === agentId) this.release(sessionId, agentId);
        }
    }

    releaseAll(): void {
        for (const sessionId of this.sessions.keys()) this.release(sessionId);
    }

    /** Human takeover cancels host round-trips for the session and releases AI ownership. */
    takeOver(sessionId: string): string | undefined {
        const controller = this.controllerOf(sessionId);
        for (const [requestId, pending] of this.pending) {
            if (pending.sessionId !== sessionId) continue;
            clearTimeout(pending.timer);
            this.pending.delete(requestId);
            pending.resolve(this.result(sessionId, pending.action, false, "Stopped because the user took control of this browser tab.", requestId));
        }
        this.release(sessionId);
        return controller;
    }

    /** The Relay reports the page's live url/title (from the iframe/webview onUrlChange). */
    report(sessionId: string, url: string, title?: string): void {
        const s = this.state(sessionId);
        s.url = url;
        if (title !== undefined) s.title = title;
        this.broadcastPage(sessionId);
    }

    // ---- Actions ----

    /** REAL in every host: set the controlled URL and push it to the view. */
    navigate(sessionId: string, url: string, requestId?: string): BrowserControlResult {
        const normalized = normalizeBrowserUrl(url);
        if (!normalized) return this.result(sessionId, "navigate", false, "Only valid HTTP(S) browser URLs are allowed.", requestId);
        const s = this.state(sessionId);
        s.url = normalized;
        // browser:event carries the new url → the Relay drives BrowserView via controlledUrl.
        this.broadcastPage(sessionId);
        return this.result(sessionId, "navigate", true, normalized, requestId);
    }

    /** Best-effort: only an Electron <webview> host can read the DOM. */
    async readDom(sessionId: string, requestId?: string): Promise<BrowserControlResult> {
        if (!this.hostCanScript) return this.result(sessionId, "readDom", false, NO_BRIDGE, requestId);
        return this.dispatchToHost(sessionId, "readDom", requestId);
    }

    /** Best-effort: only an Electron <webview> host can click. */
    async click(sessionId: string, selector: string, requestId?: string): Promise<BrowserControlResult> {
        if (!this.hostCanScript) return this.result(sessionId, "click", false, NO_BRIDGE, requestId);
        return this.dispatchToHost(sessionId, "click", requestId, selector);
    }

    /** Retained for protocol compatibility; arbitrary page JavaScript is disabled. */
    async evalJs(sessionId: string, js: string, requestId?: string): Promise<BrowserControlResult> {
        void js;
        return this.result(sessionId, "eval", false, "JavaScript evaluation is disabled by the browser security policy.", requestId);
    }

    /** Hand a DOM request to the (Electron) host and await its browser:resultReport. */
    private dispatchToHost(sessionId: string, action: BrowserActionKind, requestId?: string, selector?: string): Promise<BrowserControlResult> {
        const id = requestId ?? `brq_${++this.seq}_${Date.now().toString(36)}`;
        return new Promise<BrowserControlResult>((resolve) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                resolve(this.result(sessionId, action, false, "host did not respond (browser bridge timed out)", id));
            }, BrowserControlService.REPORT_TIMEOUT_MS);
            this.pending.set(id, { sessionId, action, resolve, timer });
            // Tell the (Electron) host to run this against the live <webview>. It executes via
            // webview.executeJavaScript and reports back over browser:resultReport → resolveReport().
            this.emit({ type: "browser:command", command: { sessionId, action, requestId: id, selector } });
        });
    }

    /** The Electron host reports the outcome of a DOM round-trip. */
    resolveReport(result: BrowserControlResult): void {
        if (!result.requestId) return;
        const p = this.pending.get(result.requestId);
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(result.requestId);
        this.emit({ type: "browser:result", result });
        p.resolve(result);
    }

    /** Snapshot used to seed a freshly-connected client. */
    snapshot(): BrowserPageInfo[] {
        return [...this.sessions.keys()].map((id) => this.pageInfo(id));
    }
}
