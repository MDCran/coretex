// @ts-nocheck
"use client";

// Coretex — a single live terminal rendered with xterm.js, bound to a Brain PTY
// session. Output streams via client.onAny (bypassing React state for the
// high-frequency data path); keystrokes go back as terminal:input; the view
// fits its container and reports cols/rows as terminal:resize.
//
// STAGE 3 (additive): fish-style inline GHOST TEXT. xterm has no native ghost
// text, so we render a positioned <span> overlay at the cursor cell (measured
// from xterm geometry) showing the top completion's remainder, dimmed. Tab / →
// accept it (write the remainder to the PTY), Ctrl+→ accepts one word, Esc
// dismisses. The whole feature is gated on the autocomplete settings and never
// alters the raw PTY passthrough, copy/paste, or fit behavior.

import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { BridgeClient } from "@repo/coretex/client";
import type { ColorScheme, OrchestratorEvent, CoretexConfig, FsEntry } from "@repo/coretex/types";
import type { CoretexActions } from "../use-coretex";
import { computeCompletions, makeContext, type Completion, type CompletionDeps, type DirEntry } from "./completion-engine";
import { registerTerminalReader, unregisterTerminalReader } from "./terminal-registry";

interface Props {
    sessionId: string;
    client: BridgeClient;
    actions: CoretexActions;
    /** Theme tokens resolved to concrete colors for xterm. */
    dark?: boolean;
    /** Active color scheme — its full 16-color ANSI palette drives the terminal theme. */
    scheme?: ColorScheme | null;
    /** Read-only consoles (agent runs) render the stream but accept no input/resize/paste. */
    readOnly?: boolean;
    className?: string;
    onFocus?: () => void;
}

function readToken(name: string, fallback: string): string {
    if (typeof window === "undefined") return fallback;
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
}

/**
 * Build a full xterm ITheme from a Coretex color scheme (purple→magenta naming).
 * `colorSelectedText` (interaction.linksSelection.colorSelectedText) gates whether the
 * scheme's selectionForeground is honored — when off, we omit it so xterm keeps the
 * cell's own foreground under the selection (Windows-Terminal "don't recolor" behavior).
 */
function themeFromScheme(s: ColorScheme, colorSelectedText: boolean): Record<string, string> {
    return {
        background: s.background,
        foreground: s.foreground,
        cursor: s.cursor,
        cursorAccent: s.cursorAccent,
        selectionBackground: s.selectionBackground,
        ...(colorSelectedText ? { selectionForeground: s.selectionForeground } : {}),
        black: s.black, red: s.red, green: s.green, yellow: s.yellow,
        blue: s.blue, magenta: s.purple, cyan: s.cyan, white: s.white,
        brightBlack: s.brightBlack, brightRed: s.brightRed, brightGreen: s.brightGreen, brightYellow: s.brightYellow,
        brightBlue: s.brightBlue, brightMagenta: s.brightPurple, brightCyan: s.brightCyan, brightWhite: s.brightWhite,
    };
}

/** Effective autocomplete config when the Brain hasn't sent settings yet (sane fish-style defaults). */
const DEFAULT_AUTOCOMPLETE: CoretexConfig["autocomplete"] = {
    enabled: true,
    ghostText: true,
    dropdown: true,
    providers: { history: true, path: true, specs: true, pathExecutables: true, ai: false },
    nativeTabFallback: "when-no-suggestion",
    debounceMs: 120,
};

/** Effective interaction config until the Brain sends settings (mirrors config/defaults.ts). */
const DEFAULT_INTERACTION: CoretexConfig["interaction"] = {
    clipboard: {
        autoCopySelection: false,
        copyFormats: "plain",
        trimBlockSelection: true,
        trimOnPaste: true,
        wordDelimiters: "/\\()\"'-,.;<>~!@#$%^&",
    },
    windowPanes: {
        snapToGrid: true,
        tabSwitcherStyle: "strip",
        focusFollowsMouse: false,
        ctrlScrollFontSize: true,
        ctrlShiftScrollOpacity: true,
    },
    linksSelection: { detectUrls: true, searchUrlTemplate: "https://www.bing.com/search?q=%s", colorSelectedText: false },
    ai: { assistOnError: true, commandBar: true, smartPasteGuard: true },
};

/** Effective rendering config until the Brain sends settings (mirrors config/defaults.ts). */
const DEFAULT_RENDERING: CoretexConfig["rendering"] = {
    render: {
        graphicsApi: "auto",
        disablePartialSwapchain: false,
        softwareRendering: false,
        webglTerminals: true,
        fontLigatures: true,
        antialiasing: "grayscale",
    },
    compat: { runInBackground: true, textMeasurement: "grapheme" },
};

/** Default startup IME mode until the Brain sends settings (mirrors config/defaults.ts). */
const DEFAULT_IME_MODE = "alphanumeric";

/** Heuristic for interaction.ai.smartPasteGuard — flags obviously destructive shells. */
function looksRiskyPaste(text: string): boolean {
    const t = text.toLowerCase();
    if (/\brm\s+-[a-z]*[rf]|\bmkfs\b|\bdd\s+if=|>\s*\/dev\/|format\s+[a-z]:|invoke-expression|\biex\s/.test(t)) return true;
    return t.includes("\n") && t.split("\n").length > 12;
}

/** Map config textMeasurement → an xterm unicode version. "grapheme"/"wcswidth" → v11 (full-width aware); "console" → v6 (legacy wcwidth). */
function unicodeVersionFor(mode: CoretexConfig["rendering"]["compat"]["textMeasurement"]): string {
    return mode === "console" ? "6" : "11";
}

/** Environment used to build a CompletionContext from the live session/shell. */
interface ShellEnv {
    cwd: string;
    shell: string;
    shellVersion?: string;
    os: string;
    isWSL?: boolean;
}

/** Read the rendered cell size (css px) from xterm geometry; falls back to measuring the element. */
function measureCell(term: Terminal): { width: number; height: number } {
    // Preferred: the render service's computed CSS cell size (allowProposedApi gives us the core).
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dims = (term as any)?._core?._renderService?.dimensions?.css?.cell;
        if (dims && Number.isFinite(dims.width) && Number.isFinite(dims.height) && dims.width > 0 && dims.height > 0) {
            return { width: dims.width, height: dims.height };
        }
    } catch {
        /* fall through to element measurement */
    }
    // Fallback: divide the rendered viewport by the grid size.
    const el = term.element?.querySelector(".xterm-screen") as HTMLElement | null;
    const host = el ?? term.element ?? null;
    if (host && term.cols > 0 && term.rows > 0) {
        const w = host.clientWidth / term.cols;
        const h = host.clientHeight / term.rows;
        if (w > 0 && h > 0) return { width: w, height: h };
    }
    return { width: 0, height: 0 };
}

/** The px offset of the terminal screen content relative to the host container (xterm padding/viewport). */
function screenOrigin(term: Terminal, host: HTMLDivElement): { left: number; top: number } {
    const screen = (term.element?.querySelector(".xterm-screen") as HTMLElement | null) ?? term.element ?? null;
    if (!screen) return { left: 0, top: 0 };
    const sRect = screen.getBoundingClientRect();
    const hRect = host.getBoundingClientRect();
    return { left: sRect.left - hRect.left, top: sRect.top - hRect.top };
}

export const XtermTerm = ({ sessionId, client, actions, dark = true, scheme, readOnly = false, className, onFocus }: Props) => {
    const hostRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitRef = useRef<FitAddon | null>(null);
    // Re-instantiate the terminal when the scheme changes (xterm theme is set at construction).
    const schemeSig = scheme ? scheme.name : "";

    // Expose this terminal's scrollback to the "Export log" affordances (dock tab menu /
    // project terminals list). The reader reads termRef live, so it survives scheme-driven
    // terminal re-instantiation without re-registering.
    useEffect(() => {
        registerTerminalReader(sessionId, () => {
            const term = termRef.current;
            if (!term) return "";
            const buf = term.buffer.active;
            const lines: string[] = [];
            for (let i = 0; i < buf.length; i++) lines.push(buf.getLine(i)?.translateToString(true) ?? "");
            while (lines.length && lines[lines.length - 1] === "") lines.pop();
            return lines.join("\n");
        });
        return () => unregisterTerminalReader(sessionId);
    }, [sessionId]);

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;

        // Live config sections (folded from settings:state; defaults until it arrives).
        // The terminal is constructed with defaults; settings:state re-applies the dynamic
        // ones (font size, word separator, link provider, ligatures, unicode) on arrival.
        let icfg: CoretexConfig["interaction"] = DEFAULT_INTERACTION;
        let rcfg: CoretexConfig["rendering"] = DEFAULT_RENDERING;
        let imeMode = DEFAULT_IME_MODE;

        const bg = readToken("--surface", dark ? "#0b0b0c" : "#ffffff");
        const fg = readToken("--c-text-primary", dark ? "#e7e7e9" : "#1a1a1e");
        const theme = scheme
            ? themeFromScheme(scheme, icfg.linksSelection.colorSelectedText)
            : { background: bg, foreground: fg, cursor: readToken("--brand", "#ef4444"), selectionBackground: "rgba(120,120,140,0.35)" };
        const term = new Terminal({
            convertEol: false,
            cursorBlink: !readOnly,
            disableStdin: readOnly,
            fontFamily: "'JetBrains Mono', 'Cascadia Code', ui-monospace, monospace",
            fontSize: 13,
            lineHeight: 1.2,
            scrollback: 5000,
            allowProposedApi: true,
            // Double-click word selection honors the configured delimiters (interaction.clipboard.wordDelimiters):
            // xterm splits words on any char in wordSeparator, so the delimiter set IS the word boundary set.
            wordSeparator: icfg.clipboard.wordDelimiters,
            theme,
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        // Unicode/cell-width handling from rendering.compat.textMeasurement (requires allowProposedApi).
        try {
            term.unicode.activeVersion = unicodeVersionFor(rcfg.compat.textMeasurement);
        } catch {
            /* unicode addon/version unavailable; xterm falls back to its default */
        }
        term.open(host);

        /** Fit only when the host has real geometry; clamp cols/rows so PTY resize never gets 0. */
        const safeFit = (report = false) => {
            // isConnected is false after unmount — skip to avoid racing dispose.
            if (typeof (host as HTMLElement & { isConnected?: boolean }).isConnected === "boolean"
                && !(host as HTMLElement & { isConnected?: boolean }).isConnected) return;
            if (host.clientWidth < 24 || host.clientHeight < 24) return;
            try {
                fit.fit();
            } catch {
                return;
            }
            if (report && !readOnly && term.cols >= 2 && term.rows >= 2) {
                actions.terminalResize(sessionId, Math.max(2, term.cols), Math.max(2, term.rows));
            }
        };
        safeFit(false);
        termRef.current = term;
        fitRef.current = fit;

        // ---- Renderer: optional WebGL (rendering.render.webglTerminals) ------
        // The WebGL renderer ships as @xterm/addon-webgl, which is NOT a current dependency
        // (NO new deps). We attempt a guarded dynamic import so it lights up if/when the dep
        // is added, and silently fall back to the DOM renderer otherwise. We dispose it on
        // cleanup. The flag is read live so a settings change re-applies via the reload path.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let webglAddon: { dispose: () => void } | null = null;
        const loadWebgl = () => {
            if (webglAddon || !rcfg.render.webglTerminals) return;
            // TODO(brain/deps): @xterm/addon-webgl is not installed (NO new deps rule). This dynamic
            // import resolves to nothing today, so webglTerminals=true currently has no effect — the
            // DOM renderer is used. Add the dep + a static import to actually enable GPU rendering.
            void (async () => {
                try {
                    // Computed specifier so the type resolver doesn't require the (intentionally absent)
                    // module at build time; resolves to null today, lights up if the dep is later added.
                    const spec = "@xterm/addon-webgl";
                    const dynImport = new Function("s", "return import(s).catch(() => null)") as (s: string) => Promise<any>;
                    const mod = await dynImport(spec);
                    if (!mod?.WebglAddon || webglAddon) return;
                    const addon = new mod.WebglAddon();
                    term.loadAddon(addon);
                    webglAddon = addon;
                } catch {
                    /* WebGL renderer unavailable — keep the DOM renderer. */
                }
            })();
        };
        if (rcfg.render.webglTerminals) loadWebgl();

        // ---- Ligatures (rendering.render.fontLigatures) ----------------------
        // The dedicated @xterm/addon-ligatures is not a dependency (NO new deps), so we enable
        // OpenType ligatures via the terminal's font-feature-settings AND register a character
        // joiner so xterm renders contiguous runs as a single shaped glyph cluster. Both are
        // native to xterm core; no addon required.
        let ligatureJoinerId: number | null = null;
        const applyLigatures = () => {
            const xtermEl = term.element as HTMLElement | null;
            const on = !!rcfg.render.fontLigatures;
            if (xtermEl) {
                xtermEl.style.fontFeatureSettings = on ? '"liga" 1, "calt" 1' : '"liga" 0, "calt" 0';
                xtermEl.style.fontVariantLigatures = on ? "contextual common-ligatures" : "none";
            }
            if (on && ligatureJoinerId === null) {
                // Join maximal runs of non-space, letting the font's shaper produce ligatures within them.
                ligatureJoinerId = term.registerCharacterJoiner((text) => {
                    const ranges: [number, number][] = [];
                    const re = /\S{2,}/g;
                    let m: RegExpExecArray | null;
                    while ((m = re.exec(text))) ranges.push([m.index, m.index + m[0].length]);
                    return ranges;
                });
            } else if (!on && ligatureJoinerId !== null) {
                term.deregisterCharacterJoiner(ligatureJoinerId);
                ligatureJoinerId = null;
            }
        };
        applyLigatures();

        // ---- URL detection (interaction.linksSelection.detectUrls) -----------
        // Uses xterm's native registerLinkProvider (no @xterm/addon-web-links dependency).
        // Opens matched URLs via actions/window on activate; (de)registered with the flag.
        const URL_RE = /(https?:\/\/|www\.)[^\s<>"')\]]+/g;
        let linkProviderDisposable: { dispose: () => void } | null = null;
        const applyUrlDetection = () => {
            const want = icfg.linksSelection.detectUrls;
            if (want && !linkProviderDisposable) {
                linkProviderDisposable = term.registerLinkProvider({
                    provideLinks: (line, cb) => {
                        const buf = term.buffer.active;
                        const row = buf.getLine(line - 1 + buf.viewportY);
                        if (!row) return cb(undefined);
                        const text = row.translateToString(true);
                        const links: Array<{ range: { start: { x: number; y: number }; end: { x: number; y: number } }; text: string; activate: (e: MouseEvent, t: string) => void; decorations: { pointerCursor: boolean; underline: boolean } }> = [];
                        let m: RegExpExecArray | null;
                        URL_RE.lastIndex = 0;
                        while ((m = URL_RE.exec(text))) {
                            const startX = m.index + 1;
                            const endX = m.index + m[0].length;
                            links.push({
                                range: { start: { x: startX, y: line }, end: { x: endX, y: line } },
                                text: m[0],
                                decorations: { pointerCursor: true, underline: true },
                                activate: (_e, t) => {
                                    const url = t.startsWith("www.") ? `https://${t}` : t;
                                    try { window.open(url, "_blank", "noopener,noreferrer"); } catch { /* blocked */ }
                                },
                            });
                        }
                        cb(links.length ? (links as unknown as never[]) : undefined);
                    },
                });
            } else if (!want && linkProviderDisposable) {
                linkProviderDisposable.dispose();
                linkProviderDisposable = null;
            }
        };
        applyUrlDetection();

        // ---- Focus follows mouse (interaction.windowPanes.focusFollowsMouse) ----
        const onMouseEnter = () => {
            if (!icfg.windowPanes.focusFollowsMouse) return;
            term.focus();
            onFocus?.();
        };
        host.addEventListener("mouseenter", onMouseEnter);

        // ---- Search selected text (interaction.linksSelection.searchUrlTemplate) ----
        const onContextMenu = (ev: MouseEvent) => {
            const sel = term.getSelection()?.trim();
            if (!sel) return;
            const tpl = icfg.linksSelection.searchUrlTemplate || "https://www.bing.com/search?q=%s";
            // Offer search when holding Alt (keeps default context menu otherwise).
            if (!ev.altKey) return;
            ev.preventDefault();
            const url = tpl.replace("%s", encodeURIComponent(sel));
            try { window.open(url, "_blank", "noopener,noreferrer"); } catch { /* blocked */ }
        };
        host.addEventListener("contextmenu", onContextMenu);

        // ---- IME mode (startup.imeMode) --------------------------------------
        // xterm routes input through a hidden <textarea>. We hint the platform IME via
        // inputmode/lang/enterkeyhint so e.g. "alphanumeric" suppresses CJK/IME composition
        // while other modes let the system IME engage. Re-applied when settings arrive.
        const applyImeMode = () => {
            const ta = term.textarea;
            if (!ta) return;
            // "alphanumeric" → Latin/no-IME; anything else → let the system IME compose.
            const alnum = imeMode === "alphanumeric" || imeMode === "";
            ta.setAttribute("inputmode", alnum ? "text" : "text");
            ta.lang = alnum ? "en" : "";
            // autocapitalize/autocorrect off keeps the terminal raw regardless of mode.
            ta.setAttribute("autocapitalize", "off");
            ta.setAttribute("autocorrect", "off");
            // Best-effort: signal the desired composition mode via the legacy CSS ime-mode
            // property (non-standard; ignored where unsupported). Cast since it's not in the lib types.
            (ta.style as unknown as Record<string, string>)["imeMode"] = alnum ? "disabled" : "auto";
        };
        if (!readOnly) applyImeMode();

        // ---- Ghost-text state (interactive terminals only) -------------------
        // host must be positioned so the absolute ghost overlay anchors to it.
        if (!readOnly) host.style.position = host.style.position || "relative";

        // Live autocomplete config (folded from settings:state; defaults until it arrives).
        let acfg: CoretexConfig["autocomplete"] = DEFAULT_AUTOCOMPLETE;
        // Live shell environment for the completion context (folded from terminal:shellInfo).
        const env: ShellEnv = { cwd: "", shell: "unknown", os: "unknown" };
        // Command history ring (most-recent LAST), folded from completed terminal:block events.
        const history: string[] = [];
        const HISTORY_MAX = 500;

        // Fallback current-line tracking: printable chars typed since the last prompt/Enter.
        // (Shell-integration's authoritative current line lives on the Brain; the Relay buffers
        // keystrokes here as a robust, self-contained fallback that works for every shell.)
        let lineBuf = "";

        // The ghost suggestion currently shown: the remainder string + the line it was computed for.
        let ghost = "";
        let ghostForLine = "";

        // The overlay element (created lazily, only for interactive terminals).
        const ghostEl = document.createElement("span");
        ghostEl.setAttribute("aria-hidden", "true");
        ghostEl.style.position = "absolute";
        ghostEl.style.pointerEvents = "none";
        ghostEl.style.whiteSpace = "pre";
        ghostEl.style.zIndex = "5";
        ghostEl.style.color = readToken("--c-text-muted", "rgba(140,140,150,0.7)");
        ghostEl.style.opacity = "0.55";
        ghostEl.style.fontFamily = "'JetBrains Mono', 'Cascadia Code', ui-monospace, monospace";
        ghostEl.style.fontSize = "13px";
        ghostEl.style.lineHeight = "1.2";
        ghostEl.style.display = "none";
        if (!readOnly) host.appendChild(ghostEl);

        const clearGhost = () => {
            ghost = "";
            ghostForLine = "";
            ghostEl.style.display = "none";
            ghostEl.textContent = "";
        };

        /** Position + show the ghost overlay at the current cursor cell. */
        const renderGhost = () => {
            if (readOnly || !acfg.enabled || !acfg.ghostText || !ghost) {
                ghostEl.style.display = "none";
                return;
            }
            const cell = measureCell(term);
            if (cell.width <= 0 || cell.height <= 0) {
                ghostEl.style.display = "none";
                return;
            }
            const origin = screenOrigin(term, host);
            const buf = term.buffer.active;
            const left = origin.left + buf.cursorX * cell.width;
            const top = origin.top + buf.cursorY * cell.height;
            ghostEl.style.left = `${left}px`;
            ghostEl.style.top = `${top}px`;
            ghostEl.style.height = `${cell.height}px`;
            ghostEl.textContent = ghost;
            ghostEl.style.display = "block";
        };

        // listDir wired to the Brain fs service: send fs:listDir, resolve on the matching fs:dirListing.
        const dirWaiters = new Map<string, Array<(entries: DirEntry[]) => void>>();
        const listDir = (dir: string): Promise<DirEntry[]> =>
            new Promise<DirEntry[]>((resolve) => {
                const key = dir;
                const arr = dirWaiters.get(key) ?? [];
                arr.push(resolve);
                dirWaiters.set(key, arr);
                // Safety: never hang the completion pipeline if the listing never comes back.
                window.setTimeout(() => {
                    const waiters = dirWaiters.get(key);
                    if (waiters && waiters.includes(resolve)) {
                        dirWaiters.set(key, waiters.filter((w) => w !== resolve));
                        resolve([]);
                    }
                }, 600);
                actions.fsListDir(dir);
            });

        // Executable names on PATH — populated from the Brain's terminal:pathExecutables
        // broadcast (folded in the onAny handler below); the provider no-ops until it arrives.
        let pathExecutables: string[] = [];

        // Debounced recompute of the ghost suggestion + dropdown candidates for the line.
        let debounceTimer: number | undefined;
        const recompute = () => {
            // Both surfaces are off → nothing to compute.
            if (readOnly || !acfg.enabled || (!acfg.ghostText && !acfg.dropdown)) {
                clearGhost();
                closeMenu();
                return;
            }
            const line = lineBuf;
            if (line.trim() === "") {
                clearGhost();
                closeMenu();
                return;
            }
            const deps: CompletionDeps = {
                history,
                listDir,
                pathExecutables,
                providers: acfg.providers,
            };
            const ctx = makeContext(line, line.length, {
                cwd: env.cwd,
                shell: env.shell,
                shellVersion: env.shellVersion,
                os: env.os,
                isWSL: env.isWSL,
            });
            void computeCompletions(ctx, deps)
                .then((results) => {
                    // Line may have changed while awaiting listDir; only apply if still current.
                    if (line !== lineBuf) return;
                    // Ghost (top suggestion) — only when ghostText is enabled.
                    const top = results[0];
                    if (acfg.ghostText && top && top.insert) {
                        ghost = top.insert;
                        ghostForLine = line;
                        renderGhost();
                    } else {
                        clearGhost();
                    }
                    // Dropdown — only when enabled AND there's more than one real candidate.
                    if (acfg.dropdown && results.length > 0) {
                        menuItems = results.slice(0, DROPDOWN_CAP);
                        menuForLine = line;
                        menuIndex = 0;
                        renderMenu();
                    } else {
                        closeMenu();
                    }
                })
                .catch(() => {
                    clearGhost();
                    closeMenu();
                });
        };
        const scheduleRecompute = () => {
            if (debounceTimer !== undefined) window.clearTimeout(debounceTimer);
            const wait = Math.max(0, acfg.debounceMs ?? DEFAULT_AUTOCOMPLETE.debounceMs);
            debounceTimer = window.setTimeout(recompute, wait);
        };

        /** Accept the ghost: write `chars` to the PTY and trim them from the front of the ghost. */
        const acceptGhost = (chars: string) => {
            if (!chars) return;
            actions.terminalInput(sessionId, chars);
            // Optimistically advance the local line buffer (the echoed bytes also arrive via PTY).
            lineBuf += chars;
            if (chars.length >= ghost.length) {
                clearGhost();
            } else {
                ghost = ghost.slice(chars.length);
                ghostForLine = lineBuf;
                renderGhost();
            }
        };

        /** The first "word" of the ghost (run of non-space, then the trailing spaces) — for Ctrl+→. */
        const firstWordOfGhost = (): string => {
            const m = /^(\s*\S+\s*)/.exec(ghost);
            return m ? m[1] : ghost;
        };

        // ---- Completion DROPDOWN (additive; Untitled-UI styled, imperative DOM) ----
        // xterm has no React tree for us to attach to on the hot path, so the dropdown is
        // a positioned popover built with the same imperative approach as the ghost overlay.
        // It anchors to the cursor cell, lists ranked completions with a kind icon +
        // description, and is driven entirely by the custom key handler (xterm steals focus).
        const DROPDOWN_MAX_ROWS = 8; // visible window (the list scrolls/virtualizes beyond this)
        const DROPDOWN_CAP = 50; // hard cap on candidates we keep in memory
        let menuItems: Completion[] = [];
        let menuIndex = 0;
        let menuForLine = "";

        // One-line SVG glyph per completion kind (16px, currentColor). Mirrors the kinds the
        // engine emits; keeps the dropdown self-contained without React icon components.
        const KIND_GLYPH: Record<Completion["kind"], string> = {
            command: '<path d="M4 17l6-6-6-6M12 19h8"/>',
            subcommand: '<path d="M9 6l6 6-6 6"/>',
            flag: '<path d="M4 21V4h11l-1.5 4L15 12H4"/>',
            path: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>',
            arg: '<path d="M4 7h16M4 12h10M4 17h7"/>',
            builtin: '<path d="M5 7h14v10H5zM8 11l2 2-2 2M13 15h3"/>',
            history: '<path d="M3 3v5h5M3.05 13a9 9 0 102.5-7.4L3 8M12 7v5l3 2"/>',
            ai: '<path d="M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',
        };
        const kindIconSvg = (kind: Completion["kind"]): string =>
            `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${KIND_GLYPH[kind] ?? KIND_GLYPH.command}</svg>`;

        // The popover container (created lazily, only for interactive terminals).
        const menuEl = document.createElement("div");
        menuEl.setAttribute("role", "listbox");
        menuEl.setAttribute("aria-label", "Completions");
        menuEl.style.position = "absolute";
        menuEl.style.zIndex = "20";
        menuEl.style.minWidth = "220px";
        menuEl.style.maxWidth = "min(520px, 90%)";
        menuEl.style.maxHeight = `${DROPDOWN_MAX_ROWS * 28}px`;
        menuEl.style.overflowY = "auto";
        menuEl.style.padding = "4px";
        menuEl.style.borderRadius = readToken("--radius-lg", "10px");
        menuEl.style.border = `1px solid ${readToken("--c-border-secondary", "rgba(120,120,140,0.25)")}`;
        menuEl.style.background = readToken("--c-bg-primary", dark ? "#16161a" : "#ffffff");
        menuEl.style.boxShadow = "0 12px 24px -6px rgba(0,0,0,0.35), 0 4px 8px -4px rgba(0,0,0,0.25)";
        menuEl.style.fontFamily = "'JetBrains Mono', 'Cascadia Code', ui-monospace, monospace";
        menuEl.style.fontSize = "12px";
        menuEl.style.lineHeight = "1.2";
        menuEl.style.display = "none";
        if (!readOnly) host.appendChild(menuEl);

        const menuVisible = () => menuEl.style.display !== "none";

        const closeMenu = () => {
            menuItems = [];
            menuForLine = "";
            menuIndex = 0;
            menuEl.style.display = "none";
            menuEl.replaceChildren();
        };

        /** Paint the rows + highlight the active index, then position near the cursor. */
        const renderMenu = () => {
            if (readOnly || !acfg.enabled || !acfg.dropdown || menuItems.length === 0) {
                menuEl.style.display = "none";
                return;
            }
            const accent = readToken("--brand", "#ef4242");
            const fgPrimary = readToken("--c-text-primary", dark ? "#e7e7e9" : "#1a1a1e");
            const fgMuted = readToken("--c-text-muted", "rgba(140,140,150,0.85)");
            const activeBg = readToken("--c-bg-active", dark ? "rgba(239,66,66,0.16)" : "rgba(239,66,66,0.1)");

            menuEl.replaceChildren();
            for (let i = 0; i < menuItems.length; i++) {
                const item = menuItems[i];
                const row = document.createElement("div");
                row.setAttribute("role", "option");
                row.setAttribute("aria-selected", i === menuIndex ? "true" : "false");
                row.style.display = "flex";
                row.style.alignItems = "center";
                row.style.gap = "8px";
                row.style.padding = "4px 8px";
                row.style.borderRadius = readToken("--radius-md", "6px");
                row.style.cursor = "pointer";
                row.style.whiteSpace = "nowrap";
                row.style.background = i === menuIndex ? activeBg : "transparent";

                const icon = document.createElement("span");
                icon.style.display = "inline-flex";
                icon.style.flex = "0 0 auto";
                icon.style.color = i === menuIndex ? accent : fgMuted;
                icon.innerHTML = kindIconSvg(item.kind);

                const label = document.createElement("span");
                label.textContent = item.display;
                label.style.color = fgPrimary;
                label.style.fontWeight = i === menuIndex ? "600" : "400";
                label.style.flex = "0 1 auto";
                label.style.overflow = "hidden";
                label.style.textOverflow = "ellipsis";

                row.append(icon, label);

                if (item.description) {
                    const desc = document.createElement("span");
                    desc.textContent = item.description;
                    desc.style.color = fgMuted;
                    desc.style.marginLeft = "auto";
                    desc.style.paddingLeft = "12px";
                    desc.style.flex = "0 1 auto";
                    desc.style.overflow = "hidden";
                    desc.style.textOverflow = "ellipsis";
                    desc.style.fontSize = "11px";
                    row.append(desc);
                }

                // Mouse: clicking a row accepts it (mousedown to beat xterm's focus handling).
                row.addEventListener("mousedown", (ev) => {
                    ev.preventDefault();
                    menuIndex = i;
                    acceptMenuSelection();
                });
                menuEl.appendChild(row);
            }

            const cell = measureCell(term);
            const origin = screenOrigin(term, host);
            const buf = term.buffer.active;
            // Anchor below the cursor row by default; flip above if it would overflow the host.
            const left = origin.left + buf.cursorX * cell.width;
            const belowTop = origin.top + (buf.cursorY + 1) * cell.height + 2;
            menuEl.style.left = `${Math.max(0, Math.min(left, host.clientWidth - 220))}px`;
            menuEl.style.top = `${belowTop}px`;
            menuEl.style.display = "block";
            // Flip above the cursor if the menu would spill past the host bottom edge.
            const menuH = menuEl.offsetHeight;
            if (belowTop + menuH > host.clientHeight && origin.top + buf.cursorY * cell.height - menuH - 2 > 0) {
                menuEl.style.top = `${origin.top + buf.cursorY * cell.height - menuH - 2}px`;
            }
            // Keep the active row visible (virtualization via native scroll).
            const activeRow = menuEl.children[menuIndex] as HTMLElement | undefined;
            activeRow?.scrollIntoView({ block: "nearest" });
        };

        /** Insert the highlighted completion's `insert` text into the PTY, then close. */
        const acceptMenuSelection = () => {
            const item = menuItems[menuIndex];
            if (!item) {
                closeMenu();
                return;
            }
            if (item.insert) {
                actions.terminalInput(sessionId, item.insert);
                lineBuf += item.insert;
            }
            clearGhost();
            closeMenu();
        };

        const moveMenu = (delta: number) => {
            if (menuItems.length === 0) return;
            menuIndex = (menuIndex + delta + menuItems.length) % menuItems.length;
            renderMenu();
        };

        // ---- Clipboard helpers (honor interaction.clipboard.*) ---------------
        /** Trim trailing per-line whitespace when trimBlockSelection is on (rectangular/block copies). */
        const formatSelectionText = (sel: string): string =>
            icfg.clipboard.trimBlockSelection
                ? sel.split("\n").map((l) => l.replace(/[ \t]+$/, "")).join("\n")
                : sel;

        /**
         * Copy the current selection, honoring interaction.clipboard.copyFormats:
         *  - "plain"      → text/plain only
         *  - "plain-html" → text/plain + a <pre> text/html flavor
         *  - "plain-rtf"  → text/plain + a monospace RTF flavor (text/rtf)
         * Falls back to writeText when the async ClipboardItem API is unavailable.
         */
        const copySelectionToClipboard = (raw: string) => {
            const text = formatSelectionText(raw);
            if (!text) return;
            const fmt = icfg.clipboard.copyFormats;
            const nav = navigator.clipboard;
            if (fmt !== "plain" && nav && typeof window.ClipboardItem !== "undefined") {
                const items: Record<string, Blob> = { "text/plain": new Blob([text], { type: "text/plain" }) };
                if (fmt === "plain-html") {
                    const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
                    items["text/html"] = new Blob([`<pre style="font-family:monospace;white-space:pre">${esc}</pre>`], { type: "text/html" });
                } else if (fmt === "plain-rtf") {
                    // Minimal RTF: monospace, escape backslash/braces, CRLF → \line.
                    const rtfBody = text.replace(/[\\{}]/g, (c) => `\\${c}`).replace(/\n/g, "\\line ");
                    const rtf = `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Consolas;}}\\f0 ${rtfBody}}`;
                    // Use text/rtf so paste targets that accept rich text get the monospace flavor.
                    items["text/rtf"] = new Blob([rtf], { type: "text/rtf" });
                }
                void nav.write([new window.ClipboardItem(items)]).catch(() => void nav.writeText?.(text));
                return;
            }
            void nav?.writeText?.(text);
        };

        // Auto-copy on selection (interaction.clipboard.autoCopySelection) — fires whenever the
        // selection changes; copies the trimmed/formatted selection without needing Ctrl+Shift+C.
        const selectionSub = term.onSelectionChange(() => {
            if (!icfg.clipboard.autoCopySelection) return;
            const sel = term.getSelection();
            if (sel) copySelectionToClipboard(sel);
        });

        // Ctrl+scroll font-size zoom (interaction.windowPanes.ctrlScrollFontSize). xterm doesn't
        // do this natively; we add a wheel handler on the host that adjusts term.options.fontSize.
        const onWheel = (ev: WheelEvent) => {
            if (!ev.ctrlKey || !icfg.windowPanes.ctrlScrollFontSize) return;
            ev.preventDefault();
            const cur = term.options.fontSize ?? 13;
            const next = Math.max(6, Math.min(48, cur + (ev.deltaY < 0 ? 1 : -1)));
            if (next !== cur) {
                term.options.fontSize = next;
                ghostEl.style.fontSize = `${next}px`;
                try { fit.fit(); } catch { /* not measured */ }
            }
        };
        host.addEventListener("wheel", onWheel, { passive: false });

        // ---- Copy / paste + acceptance custom key handler --------------------
        // Returning false swallows the event (we handled it); true lets xterm/PTY process it.
        term.attachCustomKeyEventHandler((e) => {
            if (e.type !== "keydown") return true;

            // Copy (Ctrl+Shift+C) — and paste (Ctrl+Shift+V) for interactive terminals only.
            if (e.ctrlKey && e.shiftKey && e.code === "KeyC") {
                const sel = term.getSelection();
                if (sel) copySelectionToClipboard(sel);
                return false;
            }
            if (!readOnly && e.ctrlKey && e.shiftKey && e.code === "KeyV") {
                void navigator.clipboard?.readText().then((t) => {
                    // interaction.clipboard.trimOnPaste — strip leading/trailing whitespace before injecting.
                    let out = icfg.clipboard.trimOnPaste ? t.trim() : t;
                    // Smart paste guard — warn before pasting risky / destructive commands.
                    if (icfg.ai.smartPasteGuard && looksRiskyPaste(out)) {
                        const ok = window.confirm("This paste looks potentially destructive. Paste anyway?\n\n" + out.slice(0, 280));
                        if (!ok) return;
                    }
                    actions.terminalInput(sessionId, out);
                });
                // A paste is not faithfully reconstructible by the keystroke mirror; abandon
                // the local line so the next recompute doesn't run against a stale prefix.
                lineBuf = "";
                clearGhost();
                closeMenu();
                return false;
            }

            // Ghost-text acceptance (interactive + enabled + a live suggestion only).
            const hasGhost = !readOnly && acfg.enabled && acfg.ghostText && !!ghost && ghostForLine === lineBuf;
            // Dropdown navigation is active when the menu is open for the current line.
            const hasMenu = !readOnly && acfg.enabled && acfg.dropdown && menuVisible() && menuForLine === lineBuf && menuItems.length > 0;

            // ---- Dropdown keys (take priority when the menu is open) ----
            if (hasMenu) {
                if (e.key === "ArrowDown" && !e.ctrlKey && !e.altKey && !e.metaKey) {
                    moveMenu(1);
                    return false;
                }
                if (e.key === "ArrowUp" && !e.ctrlKey && !e.altKey && !e.metaKey) {
                    moveMenu(-1);
                    return false;
                }
                if (e.key === "Enter") {
                    acceptMenuSelection();
                    return false; // don't submit the line; the user picked a completion
                }
                if ((e.key === "Tab" || e.key === "ArrowRight") && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
                    acceptMenuSelection();
                    return false;
                }
                if (e.key === "Escape") {
                    closeMenu();
                    clearGhost();
                    return false;
                }
            }

            // Esc dismisses the suggestion (and is swallowed so it doesn't reach the shell).
            if (e.key === "Escape") {
                if (hasGhost) {
                    clearGhost();
                    return false;
                }
                return true;
            }

            // Ctrl+→ accepts one word.
            if (e.key === "ArrowRight" && e.ctrlKey && !e.altKey && !e.metaKey) {
                if (hasGhost) {
                    acceptGhost(firstWordOfGhost());
                    return false;
                }
                return true;
            }

            // → / End (at end of line) accept the whole suggestion; otherwise normal cursor move.
            if ((e.key === "ArrowRight" || e.key === "End") && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
                if (hasGhost) {
                    acceptGhost(ghost);
                    return false;
                }
                return true;
            }

            // Tab accepts the whole suggestion EXCEPT when nativeTabFallback==='always',
            // where Tab is always the shell's own completion (even with a live ghost).
            // "never" swallows Tab entirely; "when-no-suggestion" accepts the ghost if present
            // and otherwise falls through.
            if (e.key === "Tab" && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
                if (!readOnly && acfg.enabled && acfg.nativeTabFallback === "always") {
                    return true; // Tab belongs to the shell regardless of any suggestion
                }
                if (hasGhost) {
                    acceptGhost(ghost);
                    return false;
                }
                if (!readOnly && acfg.enabled && acfg.nativeTabFallback === "never") {
                    return false; // suppress native completion entirely
                }
                return true; // fall through to the shell's own Tab completion
            }

            return true;
        });

        // Send keystrokes to the PTY (interactive terminals only) + track the local line buffer.
        const dataSub = readOnly
            ? null
            : term.onData((data) => {
                  actions.terminalInput(sessionId, data);
                  // PASTE GUARD: a paste (xterm delivers it as one multi-char chunk, or wrapped in
                  // bracketed-paste markers ESC[200~ … ESC[201~) cannot be faithfully mirrored into
                  // the keystroke buffer. Reconstructing it char-by-char below would leave lineBuf
                  // holding the paste body (incl. the wrapper bytes), so the next recompute would run
                  // against a bogus prefix. Abandon the local line on any paste and let shell-integration
                  // re-seed the authoritative line. We still pass the data straight through to the PTY.
                  const isBracketedPaste = data.includes("\x1b[200~") || data.includes("\x1b[201~");
                  // A genuine single keystroke is one printable char (or one control byte). Anything
                  // longer that isn't a known multi-byte control sequence (e.g. an arrow = ESC[C) is a paste.
                  const looksLikePaste = isBracketedPaste || (data.length > 1 && data.charCodeAt(0) !== 0x1b && !/^[\r\n\x7f\b\x03\x15]+$/.test(data));
                  if (looksLikePaste) {
                      lineBuf = "";
                      clearGhost();
                      closeMenu();
                      return;
                  }
                  // Maintain the fallback current-line from the bytes the user types.
                  for (const ch of data) {
                      if (ch === "\r" || ch === "\n") {
                          const cmd = lineBuf.trim();
                          if (cmd) {
                              // Record into the local history ring (newest last), deduping the immediate repeat.
                              if (history[history.length - 1] !== cmd) {
                                  history.push(cmd);
                                  if (history.length > HISTORY_MAX) history.shift();
                              }
                          }
                          lineBuf = "";
                          clearGhost();
                          closeMenu();
                      } else if (ch === "\x7f" || ch === "\b") {
                          lineBuf = lineBuf.slice(0, -1);
                          // Editing invalidates the suggestion + menu until recomputed.
                          if (ghostForLine !== lineBuf) clearGhost();
                          closeMenu();
                          scheduleRecompute();
                      } else if (ch === "\x03" || ch === "\x15") {
                          // Ctrl+C / Ctrl+U — line is abandoned/cleared.
                          lineBuf = "";
                          clearGhost();
                          closeMenu();
                      } else if (ch >= " ") {
                          lineBuf += ch;
                          // A live ghost that no longer prefixes-match the new char is stale.
                          if (ghost && !ghost.startsWith(ch)) clearGhost();
                          else if (ghost) {
                              ghost = ghost.slice(1);
                              ghostForLine = lineBuf;
                              renderGhost();
                          }
                          // The open menu is for the previous line; hide until recompute repopulates.
                          closeMenu();
                          scheduleRecompute();
                      } else {
                          // Other control sequences (arrows, etc.) — don't trust the local buffer; clear ghost+menu.
                          clearGhost();
                          closeMenu();
                      }
                  }
              });

        // Keep the overlay + menu glued to the cursor as the buffer scrolls / cursor moves.
        const cursorSub = readOnly ? null : term.onCursorMove(() => { if (ghost) renderGhost(); if (menuVisible()) renderMenu(); });
        const renderSub = readOnly ? null : term.onRender(() => { if (ghost) renderGhost(); if (menuVisible()) renderMenu(); });

        // Report size changes to the PTY (interactive terminals only).
        const resizeSub = readOnly
            ? null
            : term.onResize(({ cols, rows }) => {
                if (cols < 2 || rows < 2) return;
                actions.terminalResize(sessionId, Math.max(2, cols), Math.max(2, rows));
            });

        // A shell can print its first prompt before React has mounted xterm. Ask the
        // Brain for its bounded renderer-safe replay after subscribing, and ignore
        // earlier live frames until that ordered reply arrives (the replay includes
        // every frame sent before it on the same WebSocket).
        let replayReady = false;
        let replayRetryTimer: number | undefined;
        let replayFallbackTimer: number | undefined;

        // Stream PTY output in (out-of-band; no React re-render per chunk) + fold the
        // Stage-1 shell-integration signals (shellInfo/blocks) and settings for autocomplete.
        const off = client.onAny((event: OrchestratorEvent) => {
            if (event.type === "terminal:data" && event.id === sessionId) {
                if (replayReady) term.write(event.data);
                return;
            }
            if (event.type === "terminal:replay" && event.id === sessionId) {
                if (replayReady) return;
                replayReady = true;
                if (replayRetryTimer !== undefined) window.clearInterval(replayRetryTimer);
                if (replayFallbackTimer !== undefined) window.clearTimeout(replayFallbackTimer);
                if (event.data) {
                    term.write(event.data);
                } else {
                    term.write(
                        readOnly
                            ? "\x1b[90mCoretex: Console attached; waiting for output…\x1b[0m\r\n"
                            : "\x1b[90mCoretex: Shell started; waiting for its first prompt…\x1b[0m\r\n",
                    );
                }
                return;
            }
            if (readOnly) return;
            switch (event.type) {
                case "settings:state": {
                    if (event.config?.autocomplete) {
                        acfg = event.config.autocomplete;
                        if (!acfg.enabled || !acfg.ghostText) clearGhost();
                        if (!acfg.enabled || !acfg.dropdown) closeMenu();
                    }
                    // Interaction config → word delimiters, URL detection, selection-recolor theme.
                    if (event.config?.interaction) {
                        const prev = icfg;
                        icfg = event.config.interaction;
                        if (icfg.clipboard.wordDelimiters !== prev.clipboard.wordDelimiters) {
                            term.options.wordSeparator = icfg.clipboard.wordDelimiters;
                        }
                        applyUrlDetection();
                        // selectionForeground recolor toggle → rebuild the theme (only when a scheme is active).
                        if (scheme && icfg.linksSelection.colorSelectedText !== prev.linksSelection.colorSelectedText) {
                            term.options.theme = themeFromScheme(scheme, icfg.linksSelection.colorSelectedText);
                        }
                    }
                    // Rendering config → WebGL renderer, ligatures, unicode/cell-width.
                    if (event.config?.rendering) {
                        rcfg = event.config.rendering;
                        loadWebgl();
                        applyLigatures();
                        try {
                            const v = unicodeVersionFor(rcfg.compat.textMeasurement);
                            if (term.unicode.activeVersion !== v) term.unicode.activeVersion = v;
                        } catch { /* unicode version unavailable */ }
                    }
                    // Startup config → IME mode on the input element.
                    if (event.config?.startup) {
                        imeMode = event.config.startup.imeMode || DEFAULT_IME_MODE;
                        applyImeMode();
                    }
                    return;
                }
                case "terminal:shellInfo":
                    if (event.info.sessionId === sessionId) {
                        env.cwd = event.info.cwd || env.cwd;
                        env.shell = event.info.shell || env.shell;
                        env.shellVersion = event.info.version;
                        env.os = event.info.os || env.os;
                        env.isWSL = event.info.isWSL;
                    }
                    return;
                case "terminal:block":
                    // A completed command from shell-integration → authoritative history (newest last).
                    if (event.block.sessionId === sessionId) {
                        const cmd = event.block.command.trim();
                        if (cmd && history[history.length - 1] !== cmd) {
                            history.push(cmd);
                            if (history.length > HISTORY_MAX) history.shift();
                        }
                        // Keep cwd fresh from where the command ran.
                        if (event.block.cwd) env.cwd = event.block.cwd;
                        // Assist on error — surface a notification when a command exits non-zero.
                        if (icfg.ai.assistOnError && typeof event.block.exitCode === "number" && event.block.exitCode !== 0) {
                            actions.notify(
                                "agentError",
                                "Command failed",
                                `${cmd.slice(0, 80) || "Command"} exited with code ${event.block.exitCode}`,
                            );
                        }
                        // A completed block is an authoritative command boundary: the shell has
                        // executed the line and is back at a fresh prompt. Reconcile the keystroke
                        // mirror so a paste/shell-line-edit divergence can't leave a stale prefix.
                        lineBuf = "";
                        clearGhost();
                        closeMenu();
                    }
                    return;
                case "terminal:pathExecutables":
                    // Real $PATH executable names from the Brain → feed the autocomplete engine.
                    if (event.sessionId === sessionId) {
                        pathExecutables = event.names;
                        if (lineBuf.trim()) scheduleRecompute();
                    }
                    return;
                case "fs:dirListing": {
                    // Resolve any pending listDir() waiters for this path.
                    const waiters = dirWaiters.get(event.path);
                    if (waiters && waiters.length) {
                        dirWaiters.delete(event.path);
                        const entries: DirEntry[] = (event.entries as FsEntry[] | undefined ?? []).map((e) => ({ name: e.name, isDir: e.isDir }));
                        for (const w of waiters) w(entries);
                    }
                    return;
                }
                default:
                    return;
            }
        });

        const requestReplay = (): void => {
            if (!replayReady) client.send({ type: "terminal:replay", id: sessionId });
        };
        requestReplay();
        replayRetryTimer = window.setInterval(requestReplay, 500);
        replayFallbackTimer = window.setTimeout(() => {
            if (replayReady) return;
            replayReady = true;
            if (replayRetryTimer !== undefined) window.clearInterval(replayRetryTimer);
            term.write("\x1b[33mCoretex: Terminal output is delayed. You can still type, or reopen this terminal if the shell does not respond.\x1b[0m\r\n");
        }, 2_500);

        // Pull current settings immediately so autocomplete reflects them without waiting for a broadcast.
        if (!readOnly) actions.getSettings();

        // Initial resize so the PTY matches the rendered grid (retry once if first paint is 0×0).
        const initial = window.setTimeout(() => {
            safeFit(true);
            if (host.clientWidth < 24 || host.clientHeight < 24) {
                window.setTimeout(() => safeFit(true), 120);
            }
            if (!readOnly) term.focus();
        }, 40);

        // Refit on container resize (debounce tiny intermediate frames during fullscreen open).
        let roTimer: number | undefined;
        const ro = new ResizeObserver(() => {
            if (roTimer !== undefined) window.clearTimeout(roTimer);
            roTimer = window.setTimeout(() => {
                safeFit(true);
                if (ghost) renderGhost();
                // A resize repositions everything; the open menu's anchor is stale, so dismiss it.
                if (menuVisible()) closeMenu();
            }, 16);
        });
        ro.observe(host);

        return () => {
            window.clearTimeout(initial);
            if (replayRetryTimer !== undefined) window.clearInterval(replayRetryTimer);
            if (replayFallbackTimer !== undefined) window.clearTimeout(replayFallbackTimer);
            if (roTimer !== undefined) window.clearTimeout(roTimer);
            if (debounceTimer !== undefined) window.clearTimeout(debounceTimer);
            ro.disconnect();
            off();
            host.removeEventListener("wheel", onWheel);
            host.removeEventListener("mouseenter", onMouseEnter);
            host.removeEventListener("contextmenu", onContextMenu);
            selectionSub.dispose();
            linkProviderDisposable?.dispose();
            if (ligatureJoinerId !== null) {
                try { term.deregisterCharacterJoiner(ligatureJoinerId); } catch { /* already gone */ }
            }
            webglAddon?.dispose();
            dataSub?.dispose();
            cursorSub?.dispose();
            renderSub?.dispose();
            resizeSub?.dispose();
            ghostEl.remove();
            menuEl.remove();
            term.dispose();
            termRef.current = null;
            fitRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId, client, schemeSig, readOnly]);

    return <div ref={hostRef} className={className} onMouseDown={onFocus} style={{ width: "100%", height: "100%" }} />;
};
