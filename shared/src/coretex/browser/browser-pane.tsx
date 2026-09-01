// @ts-nocheck
"use client";

// Coretex — single embedded browser session (toolbar + viewport + per-session history).
// Fills its parent container; layout/tabs/pop-out are owned by BrowserDock.
//
// HOST-AWARE viewport:
//   • Electron host → a real <webview>. It supports executeJavaScript (so the Brain's
//     browser_read_dom / click tools actually work via the host bridge) and does
//     NOT enforce X-Frame-Options the way an <iframe> does. On mount the view declares
//     hostCanScript=true to the Brain and then services `command` requests, replying over
//     browser:resultReport (onResult).
//   • Web host → the original sandboxed <iframe>, with the honest "DOM control not available
//     in this host" path (it never declares scripting capability, so DOM actions fail fast).
// AI navigation is driven via the `controlledUrl` prop in BOTH hosts.

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Copy01, LinkExternal01, RefreshCcw01, SearchLg } from "@untitledui/icons";
import { cx } from "@/utils/cx";
import type { BrowserControlResult, BrowserHostCommand } from "@repo/coretex/types";
import { normalizeBrowserUrl } from "@repo/coretex/browser-url";

// React already declares the <webview> intrinsic element (WebViewHTMLAttributes). The web
// build never renders it; only the Electron host does, where it is a real, scriptable guest.

export function normalizeUrl(input: string): string {
    return normalizeBrowserUrl(input) ?? "";
}

/** Transport an untrusted selector using a syntax-inert lowercase hex alphabet. */
function selectorHex(value: string): string {
    const bytes = new TextEncoder().encode(value);
    if (bytes.length > 4096) throw new Error("Selector exceeds the 4 KB limit.");
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** True when running inside the Electron desktop host (preload bridge present). */
function isElectronHost(): boolean {
    return typeof window !== "undefined" && !!(window as unknown as { electronAPI?: unknown }).electronAPI;
}

/** Minimal shape of the Electron <webview> element we use for page control. */
interface WebviewElement extends HTMLElement {
    src: string;
    getURL(): string;
    getTitle(): string;
    reload(): void;
    executeJavaScript(code: string): Promise<unknown>;
}

interface BrowserViewProps {
    initialUrl: string;
    /** When this changes (e.g. AI/agent or external navigation), the view navigates to it. */
    controlledUrl?: string;
    /** Report the current URL upward (for the dock tab label + AI read-back). */
    onUrlChange?: (url: string) => void;
    /** Latest DOM/click/eval instruction the Brain wants this session's host to run (Electron only). */
    command?: BrowserHostCommand;
    /** Report the outcome of a host-run command back to the Brain (browser:resultReport). */
    onResult?: (result: BrowserControlResult) => void;
    /** Declare whether this view can script the page (true only for the Electron <webview>). */
    onHostCaps?: (canScript: boolean) => void;
}

export const BrowserView = ({ initialUrl, controlledUrl, onUrlChange, command, onResult, onHostCaps }: BrowserViewProps) => {
    const safeInitialUrl = normalizeUrl(initialUrl);
    const [url, setUrl] = useState(safeInitialUrl);
    const [input, setInput] = useState(safeInitialUrl);
    const [history, setHistory] = useState<string[]>(safeInitialUrl ? [safeInitialUrl] : []);
    const [idx, setIdx] = useState(0);
    const [loading, setLoading] = useState(true);
    const [reloadKey, setReloadKey] = useState(0);
    const [electron] = useState(isElectronHost);
    const webviewRef = useRef<WebviewElement | null>(null);

    const navigate = (raw: string): void => {
        const next = normalizeUrl(raw);
        if (!next) return;
        if (next === url) { setReloadKey((k) => k + 1); return; }
        setHistory((h) => [...h.slice(0, idx + 1), next]);
        setIdx((i) => i + 1);
        setUrl(next);
        setInput(next);
        setLoading(true);
        onUrlChange?.(next);
    };

    // External / AI-controlled navigation.
    useEffect(() => {
        if (controlledUrl && normalizeUrl(controlledUrl) !== url) navigate(controlledUrl);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [controlledUrl]);

    const go = (delta: number): void => {
        const next = idx + delta;
        if (next < 0 || next >= history.length) return;
        setIdx(next);
        setUrl(history[next]);
        setInput(history[next]);
        setLoading(true);
        onUrlChange?.(history[next]);
    };

    const reload = (): void => {
        if (electron && webviewRef.current) webviewRef.current.reload();
        else setReloadKey((k) => k + 1);
    };

    // Declare scripting capability to the Brain once per mount (Electron <webview> only).
    // The web/iframe host never calls this with true, so its DOM actions keep failing fast.
    useEffect(() => {
        if (electron) onHostCaps?.(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [electron]);

    // Wire the <webview> lifecycle: surface url/title + loading state to the dock/Brain.
    useEffect(() => {
        if (!electron) return;
        const el = webviewRef.current;
        if (!el) return;
        const onNav = (): void => {
            const live = normalizeUrl(el.getURL());
            if (live) { setUrl(live); setInput(live); onUrlChange?.(live); }
        };
        const onStart = (): void => setLoading(true);
        const onStop = (): void => { setLoading(false); onNav(); };
        el.addEventListener("did-start-loading", onStart);
        el.addEventListener("did-stop-loading", onStop);
        el.addEventListener("did-navigate", onNav as EventListener);
        el.addEventListener("did-navigate-in-page", onNav as EventListener);
        el.addEventListener("dom-ready", onStop);
        return () => {
            el.removeEventListener("did-start-loading", onStart);
            el.removeEventListener("did-stop-loading", onStop);
            el.removeEventListener("did-navigate", onNav as EventListener);
            el.removeEventListener("did-navigate-in-page", onNav as EventListener);
            el.removeEventListener("dom-ready", onStop);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [electron, reloadKey]);

    // Service DOM/click/eval requests from the Brain by running JS inside the <webview>,
    // then report the outcome back over browser:resultReport. Each command has a unique
    // requestId, so the effect only runs once per instruction.
    const lastReqRef = useRef<string | null>(null);
    useEffect(() => {
        if (!electron || !command || !onResult) return;
        if (command.requestId === lastReqRef.current) return;
        lastReqRef.current = command.requestId;
        const el = webviewRef.current;
        const reply = (ok: boolean, valueOrError: string): void =>
            onResult(ok
                ? { sessionId: command.sessionId, action: command.action, ok: true, value: valueOrError, requestId: command.requestId }
                : { sessionId: command.sessionId, action: command.action, ok: false, error: valueOrError, requestId: command.requestId });
        if (!el) { reply(false, "browser view not ready"); return; }

        const run = async (): Promise<void> => {
            try {
                if (command.action === "readDom") {
                    const html = await el.executeJavaScript("document.documentElement.outerHTML");
                    reply(true, typeof html === "string" ? html : String(html));
                } else if (command.action === "click") {
                    const encodedSelector = selectorHex(command.selector ?? "");
                    const clicked = await el.executeJavaScript(
                        `(() => { const h="${encodedSelector}"; const b=new Uint8Array((h.match(/../g)||[]).map(x=>parseInt(x,16))); const s=new TextDecoder().decode(b); const el=document.querySelector(s); if(!el)return false; el.click(); return true; })()`,
                    );
                    if (clicked) reply(true, "clicked");
                    else reply(false, `no element matched selector: ${command.selector ?? ""}`);
                } else {
                    reply(false, `unsupported host action: ${command.action}`);
                }
            } catch (err) {
                reply(false, err instanceof Error ? err.message : String(err));
            }
        };
        void run();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [command?.requestId, electron]);

    const iconBtn = "rounded-md p-1.5 transition hover:bg-[var(--surface-2)] disabled:opacity-30";
    // Re-validate at the DOM boundary as a defense against future state changes.
    const safeUrl = normalizeUrl(url);

    return (
        <div className="flex h-full min-h-0 flex-col" style={{ background: "var(--app-bg)" }}>
            {/* Toolbar */}
            <div className="flex items-center gap-1 px-2 py-2" style={{ borderBottom: "1px solid var(--c-border)", background: "var(--sidebar-bg)" }}>
                <button type="button" className={iconBtn} disabled={idx <= 0} onClick={() => go(-1)} title="Back" style={{ color: "var(--c-text-secondary)" }}>
                    <ArrowLeft className="size-4" />
                </button>
                <button type="button" className={iconBtn} disabled={idx >= history.length - 1} onClick={() => go(1)} title="Forward" style={{ color: "var(--c-text-secondary)" }}>
                    <ArrowRight className="size-4" />
                </button>
                <button type="button" className={iconBtn} onClick={reload} title="Reload" style={{ color: "var(--c-text-secondary)" }}>
                    <RefreshCcw01 className={cx("size-4", loading && "animate-spin")} />
                </button>

                <div className="mx-1 flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-1.5" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}>
                    <SearchLg className="size-3.5 shrink-0 text-quaternary" />
                    <input
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") navigate(input); }}
                        spellCheck={false}
                        placeholder="Enter a URL or localhost:port"
                        className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-quaternary"
                        style={{ color: "var(--c-text-primary)" }}
                    />
                </div>

                <button type="button" className={iconBtn} onClick={() => void navigator.clipboard?.writeText(url)} title="Copy URL" style={{ color: "var(--c-text-secondary)" }}>
                    <Copy01 className="size-4" />
                </button>
                <button type="button" className={iconBtn} onClick={() => window.open(url, "_blank", "noopener")} title="Open in external browser" style={{ color: "var(--c-text-secondary)" }}>
                    <LinkExternal01 className="size-4" />
                </button>
            </div>

            {/* Viewport */}
            <div className="relative min-h-0 flex-1" style={{ background: "#fff" }}>
                {loading && <div className="absolute inset-x-0 top-0 z-10 h-0.5 animate-pulse" style={{ background: "var(--brand)" }} />}
                {electron ? (
                    // Electron <webview>: real page control (executeJavaScript), no X-Frame-Options blocking.
                    // `as never` keeps React/TS happy about the Electron-only custom element + attributes.
                    <webview
                        key={`wv-${reloadKey}`}
                        ref={webviewRef as never}
                        src={safeUrl || "about:blank"}
                        allowpopups={true}
                        partition="persist:coretex-browser"
                        className="size-full border-0"
                        style={{ display: "inline-flex", width: "100%", height: "100%" }}
                    />
                ) : (
                    <iframe
                        key={`${url}-${reloadKey}`}
                        src={safeUrl || undefined}
                        title="Coretex browser"
                        onLoad={() => setLoading(false)}
                        className="size-full border-0"
                        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
                        referrerPolicy="no-referrer"
                    />
                )}
            </div>
        </div>
    );
};
