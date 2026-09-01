import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isTerminalExclusive } from "../../shared/src/coretex/terminal/terminal-layout.js";
import { TerminalManager } from "../src/terminal/manager.js";
import { PrivateOutputFilter, privateEndPrefix, privateTextEndPrefix } from "../src/terminal/private-output.js";

const sourceAt = (relative: string): string => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

function testExclusiveLayoutTruthTable(): void {
    assert.equal(isTerminalExclusive(false, false), false);
    assert.equal(isTerminalExclusive(false, true), false, "a remembered fullscreen preference must not hide the shell while the dock is closed");
    assert.equal(isTerminalExclusive(true, false), false, "docked Terminal must coexist with the workspace shell");
    assert.equal(isTerminalExclusive(true, true), true, "only an open fullscreen Terminal owns the complete app surface");
}

function testFullscreenCompositionContract(): void {
    const appShell = sourceAt("../../shared/src/coretex/app-shell.tsx");
    const terminalDock = sourceAt("../../shared/src/coretex/terminal/terminal-dock.tsx");

    assert.match(appShell, /const \[terminalFullscreen, setTerminalFullscreen\] = useState\(true\)/, "newly opened terminals must begin fullscreen without a split-frame flash");
    assert.match(appShell, /if \(!dockOpen\) setTerminalFullscreen\(true\)/, "closing the dock must restore the fullscreen default for the next open");
    assert.match(appShell, /const terminalExclusive = isTerminalExclusive\(dockOpen, terminalFullscreen\)/, "AppShell must derive exclusivity from the tested truth table");

    const exclusiveWrapper = /aria-hidden=\{terminalExclusive \|\| undefined\}[\s\S]*?inert=\{terminalExclusive\}[\s\S]*?display: terminalExclusive \? "none" : "contents"/g;
    assert.equal((appShell.match(exclusiveWrapper) ?? []).length, 2, "workspace chrome and global overlays must each use an inert, hidden fullscreen composition wrapper");

    const firstWrapper = appShell.indexOf("aria-hidden={terminalExclusive || undefined}");
    const dockStart = appShell.indexOf("{dockOpen && (");
    const secondWrapper = appShell.indexOf("aria-hidden={terminalExclusive || undefined}", firstWrapper + 1);
    assert.ok(firstWrapper >= 0 && dockStart > firstWrapper && secondWrapper > dockStart, "Terminal must render between the two hidden shell composition groups");

    const workspaceComposition = appShell.slice(firstWrapper, dockStart);
    for (const [surface, label] of [
        [/<Sidebar/, "sidebar"],
        [/<AppErrorBoundary label="view"/, "workspace page"],
        [/dockOverlay && \(browserSessions\.length > 0 \|\| dockOpen\)/, "dock scrim"],
        [/browserSessions\.length > 0 && \(/, "browser dock"],
    ] as const) {
        assert.match(workspaceComposition, surface, `${label} must stay inside the hidden/inert workspace group so its state survives fullscreen`);
    }

    const overlayComposition = appShell.slice(secondWrapper);
    for (const [surface, label] of [
        [/showStatusBar && <StatusCluster/, "status cluster"],
        [/<CommandPalette/, "global command palette"],
        [/<CoretexTour/, "tour overlay"],
        [/<Toaster/, "toast overlay"],
    ] as const) {
        assert.match(overlayComposition, surface, `${label} must stay inside the hidden/inert global-overlay group`);
    }

    const dockEnd = appShell.indexOf("{/* Bottom-right status cluster", dockStart);
    assert.ok(dockStart >= 0 && dockEnd > dockStart, "TerminalDock composition block must remain discoverable");
    const dockComposition = appShell.slice(dockStart, dockEnd);
    assert.doesNotMatch(dockComposition, /!terminalExclusive/, "fullscreen exclusivity must never unmount the Terminal itself");
    assert.match(dockComposition, /defaultFullscreen/, "TerminalDock must be explicitly opened fullscreen");
    assert.match(dockComposition, /onFullscreenChange=\{setTerminalFullscreen\}/, "TerminalDock must report fullscreen transitions to AppShell");

    assert.match(terminalDock, /onFullscreenChange\?: \(fullscreen: boolean\) => void/, "TerminalDock must expose its fullscreen composition state");
    assert.match(terminalDock, /useState<boolean>\(defaultFullscreen\)/, "TerminalDock state must honor the fullscreen default");
    assert.match(terminalDock, /onFullscreenChange\?\.\(fullscreen\)/, "initial and toggled fullscreen state must be reported through the callback");
    assert.match(terminalDock, /fullscreen && "fixed inset-0 z-\[90\]"/, "fullscreen Terminal must cover the complete viewport");
    assert.match(terminalDock, /fullscreen\s*\? "100vw"/, "fullscreen Terminal must not preserve a sidebar-width offset");
    assert.match(terminalDock, /title=\{fullscreen \? "Dock to side" : "Full page"\}/, "fullscreen control must explain the resulting layout");
}

const privateMarker = (token: string, code = 0, terminator: "bel" | "st" = "bel"): string =>
    `${privateEndPrefix(token)}${code}${terminator === "bel" ? "\x07" : "\x1b\\"}`;

function testPrivateOutputSameChunk(): void {
    const token = "probe_same_chunk";
    const filter = new PrivateOutputFilter(token);
    assert.equal(filter.complete, false);
    const privateBytes = `echo injected command\r\nsecret probe output${privateMarker(token)}`;
    const suffix = `\x1b[32mPS C:\\workspace>\x1b[0m 😀\r\n`;
    assert.deepEqual(filter.push(privateBytes + suffix), { visible: suffix, complete: true }, "same-chunk prompt suffix must survive byte-for-byte");
    assert.equal(filter.complete, true);
    const ordinary = "npm test\r\n";
    assert.deepEqual(filter.push(ordinary), { visible: ordinary, complete: true }, "completed filters must become transparent");
}

function testPrivateOutputFragmentation(): void {
    const token = "probe.fragment[1]";
    const transaction = `private source\r\nprivate output${privateMarker(token, -17, "st")}`;
    const suffix = "prompt> ";

    for (let split = 0; split <= transaction.length; split += 1) {
        const filter = new PrivateOutputFilter(token);
        const first = filter.push(transaction.slice(0, split));
        assert.equal(first.visible, "", `split ${split}: private prefix must stay hidden`);
        const second = filter.push(transaction.slice(split) + suffix);
        assert.equal(second.visible, suffix, `split ${split}: suffix must survive`);
        assert.equal(second.complete, true, `split ${split}: ST-terminated marker must complete`);
    }

    const bytewise = new PrivateOutputFilter(token);
    const visible: string[] = [];
    for (const unit of transaction + suffix) visible.push(bytewise.push(unit).visible);
    assert.equal(visible.join(""), suffix, "a marker split at every UTF-16 code unit must still be recognized");
    assert.equal(bytewise.complete, true);
}

function testCmdPrivateOutputFragmentation(): void {
    const token = "cmd_token";
    const transaction = `echoed command\r\nprivate cmd output${privateTextEndPrefix(token)}-3__`;
    const suffix = "C:\\workspace> ";
    for (let split = 0; split <= transaction.length; split += 1) {
        const filter = new PrivateOutputFilter(token);
        const first = filter.push(transaction.slice(0, split));
        assert.equal(first.visible, "");
        assert.equal(first.complete, split === transaction.length, `cmd marker split ${split}: completion must reflect whether the full marker arrived`);
        assert.deepEqual(
            filter.push(transaction.slice(split) + suffix),
            { visible: suffix, complete: true },
            `cmd marker split ${split}: prompt suffix must survive`,
        );
    }
}

function testPrivateOutputBoundAndAbort(): void {
    const token = "bounded_probe";
    const filter = new PrivateOutputFilter(token);
    const privateBody = "x".repeat(2 * 1024 * 1024);
    assert.deepEqual(filter.push(privateBody), { visible: "", complete: false }, "large private output must remain silent");
    assert.deepEqual(filter.push(privateMarker("wrong_token") + "still private"), { visible: "", complete: false }, "a different transaction token must not release the filter");
    assert.deepEqual(filter.push(privateMarker(token) + "ready> "), { visible: "ready> ", complete: true }, "bounded lookbehind must retain enough of the matching marker");

    const aborted = new PrivateOutputFilter("aborted_probe");
    assert.deepEqual(aborted.push("partial private bytes"), { visible: "", complete: false });
    aborted.abort();
    assert.equal(aborted.complete, true);
    assert.deepEqual(aborted.push("user output after release"), { visible: "user output after release", complete: true }, "abort must discard pending private data and release later output");
}

function testSequentialPrivateFilters(): void {
    const first = new PrivateOutputFilter("first");
    const second = new PrivateOutputFilter("second");
    assert.deepEqual(first.push(`first secret${privateMarker("first")}first prompt`), { visible: "first prompt", complete: true });
    assert.deepEqual(second.push("second secret"), { visible: "", complete: false });
    assert.deepEqual(second.push(`${privateMarker("second", 1)}second prompt`), { visible: "second prompt", complete: true });
    assert.deepEqual(first.push("ordinary first output"), { visible: "ordinary first output", complete: true }, "later transactions must not reactivate completed filter instances");
}

interface FakeManagerSession {
    meta: { status: string };
    outputReplay: string;
    pty: { write: (data: string) => void; kill: () => void };
    parser: { onInput: (data: string) => void };
    privateOutput?: {
        filter: PrivateOutputFilter;
        queuedInput: string[];
        queuedInputSize: number;
        controller: AbortController;
    };
}

interface TerminalManagerHarness {
    sessions: Map<string, FakeManagerSession>;
    taps: Map<string, Set<(data: string) => void>>;
    privateOutputQueues: Map<string, Promise<void>>;
    emitPtyData: (id: string, data: string) => void;
}

async function testManagerPrivateRouting(): Promise<void> {
    const manager = new TerminalManager();
    const harness = manager as unknown as TerminalManagerHarness;
    const writes: string[] = [];
    const parserInputs: string[] = [];
    const renderer: string[] = [];
    const captureTap: string[] = [];
    const ordering: string[] = [];
    const session: FakeManagerSession = {
        meta: { status: "running" },
        outputReplay: "",
        pty: {
            write: (data) => {
                writes.push(data);
                ordering.push(`write:${data}`);
            },
            kill: () => ordering.push("kill"),
        },
        parser: {
            onInput: (data) => {
                parserInputs.push(data);
                ordering.push(`input:${data}`);
            },
        },
    };
    harness.sessions.set("fixture", session);
    manager.setHandlers((_id, data) => {
        renderer.push(data);
        ordering.push(`visible:${data}`);
    }, () => undefined);
    manager.tap("fixture", (data) => {
        captureTap.push(data);
        ordering.push(`tap:${data}`);
    });

    const token = "manager_route";
    const rawPrivate = "private probe output";
    const rawEndAndPrompt = `${privateMarker(token)}prompt> `;
    await manager.runPrivateOutput("fixture", token, async (write) => {
        write("private command\r");
        manager.input("fixture", "user chunk one");
        manager.input("fixture", " + two\r");
        harness.emitPtyData("fixture", rawPrivate);
        harness.emitPtyData("fixture", rawEndAndPrompt);
    });

    assert.deepEqual(renderer, ["prompt> "], "renderer must receive only the same-chunk suffix after the private sentinel");
    assert.equal(manager.replayOf("fixture"), "prompt> ", "a late xterm attachment must receive the renderer-safe prompt replay");
    assert.deepEqual(captureTap, [rawPrivate, rawEndAndPrompt], "capture taps must receive the complete raw stream, including private markers");
    assert.deepEqual(writes, ["private command\r", "user chunk one", " + two\r"], "queued user input must flush in original chunk order");
    assert.deepEqual(parserInputs, ["user chunk one", " + two\r"], "parser input must be deferred until queued bytes are actually written");
    assert.ok(
        ordering.indexOf("visible:prompt> ") < ordering.indexOf("write:user chunk one"),
        "same-chunk visible suffix must be delivered before queued user input is flushed",
    );

    manager.input("fixture", "ordinary input\r");
    assert.equal(writes.at(-1), "ordinary input\r");
    assert.equal(parserInputs.at(-1), "ordinary input\r");
    manager.kill("fixture");
}

async function testPrivateTransactionSerialization(): Promise<void> {
    const manager = new TerminalManager();
    const harness = manager as unknown as TerminalManagerHarness;
    harness.sessions.set("serialized", {
        meta: { status: "running" },
        outputReplay: "",
        pty: { write: () => undefined, kill: () => undefined },
        parser: { onInput: () => undefined },
    });

    const events: string[] = [];
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
    });
    const first = manager.runPrivateOutput("serialized", "first_serial", async () => {
        events.push("first:start");
        await gate;
        events.push("first:end");
    });
    const second = manager.runPrivateOutput("serialized", "second_serial", async () => {
        events.push("second:start");
        events.push("second:end");
    });

    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(events, ["first:start"], "a second private transaction must wait for the first transaction on the same session");
    releaseFirst();
    await Promise.all([first, second]);
    assert.deepEqual(events, ["first:start", "first:end", "second:start", "second:end"]);
    manager.kill("serialized");
}

async function testPrivateInterruptAndCleanup(): Promise<void> {
    const manager = new TerminalManager();
    const harness = manager as unknown as TerminalManagerHarness;
    const writes: string[] = [];
    const parserInputs: string[] = [];
    const visible: string[] = [];
    const raw: string[] = [];
    let killed = 0;
    harness.sessions.set("interrupt", {
        meta: { status: "running" },
        outputReplay: "",
        pty: { write: (data) => writes.push(data), kill: () => { killed += 1; } },
        parser: { onInput: (data) => parserInputs.push(data) },
    });
    manager.setHandlers((_id, data) => visible.push(data), () => undefined);
    manager.tap("interrupt", (data) => raw.push(data));

    let privateAbortObserved = false;
    const operation = manager.runPrivateOutput("interrupt", "interrupt_token", (write, privateSignal) => new Promise<void>((resolve) => {
        write("private command\r");
        privateSignal.addEventListener("abort", () => {
            privateAbortObserved = true;
            resolve();
        }, { once: true });
    }));
    await Promise.resolve();
    await Promise.resolve();
    manager.input("interrupt", "queued user text");
    manager.input("interrupt", "\x03");
    await operation;
    assert.equal(privateAbortObserved, true, "Ctrl+C must cancel the active capture instead of leaving later probes queued behind its timeout");
    assert.deepEqual(writes, ["private command\r", "\x03", "queued user text"], "Ctrl+C must interrupt private work before replaying preserved user input");
    assert.deepEqual(parserInputs, ["\x03", "queued user text"]);
    harness.emitPtyData("interrupt", "output after interrupt");
    assert.deepEqual(visible, ["output after interrupt"], "renderer output after Ctrl+C release must pass through normally");
    assert.deepEqual(raw, ["output after interrupt"]);

    // A new pending transaction verifies killAll clears every per-session gate.
    let releaseCleanup!: () => void;
    const cleanupGate = new Promise<void>((resolve) => { releaseCleanup = resolve; });
    const cleanup = manager.runPrivateOutput("interrupt", "cleanup_token", async () => cleanupGate);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(harness.privateOutputQueues.size, 1);
    assert.equal(harness.taps.size, 1);
    manager.killAll();
    assert.equal(killed, 1);
    assert.equal(harness.sessions.size, 0);
    assert.equal(harness.taps.size, 0, "killAll must release capture callbacks");
    assert.equal(harness.privateOutputQueues.size, 0, "killAll must release serialized private-operation queues");
    releaseCleanup();
    await cleanup;
}

function testPrivateOutputWiringContract(): void {
    const manager = sourceAt("../src/terminal/manager.ts");
    const capture = sourceAt("../src/terminal/buddy-exec.ts");
    const environmentProbe = sourceAt("../src/terminal/buddy-probe.ts");
    const routeStart = manager.indexOf("private emitPtyData");
    const routeEnd = manager.indexOf("private flushQueuedInput", routeStart);
    assert.ok(routeStart >= 0 && routeEnd > routeStart, "private PTY routing implementation must remain discoverable");
    const route = manager.slice(routeStart, routeEnd);
    assert.match(route, /transaction\.filter\.push\(data\)/, "renderer routing must pass raw chunks through the private filter");
    assert.match(route, /this\.broadcastVisibleData\(id, filtered\.visible\)/, "only filtered bytes may reach terminal:data and the late-attach replay");
    assert.match(route, /this\.emitToTaps\(id, data\)/, "capture taps must receive the unfiltered raw chunk");
    assert.match(manager, /s\.parser\.feed\(d\)/, "shell integration must parse raw PTY bytes even while the renderer is filtered");
    assert.match(manager, /void runCaptured\(this, opts\.id, kind, command, \{ timeoutMs: 3_000 \}\)/, "startup integration and version probing must use a bounded silent capture path");
    assert.match(manager, /replayOf\(id: string\): string[\s\S]*?outputReplay/, "the terminal manager must expose bounded renderer-safe output for late xterm mounts");
    const xterm = sourceAt("../../shared/src/coretex/terminal/xterm-term.tsx");
    assert.match(xterm, /client\.send\(\{ type: "terminal:replay", id: sessionId \}\)/, "xterm must request its output replay only after subscribing");
    assert.match(xterm, /event\.type === "terminal:replay"[\s\S]*?term\.write\(event\.data\)/, "xterm must render the replay before accepting subsequent live frames");
    assert.match(capture, /return manager\.runPrivateOutput\(sessionId, token,/, "every captured Buddy/probe command must enter the serialized private-output gate");
    assert.match(environmentProbe, /await runCaptured\(manager, sessionId, kind, probeScript\(kind\),/, "the full Terminal Buddy environment probe must use the same silent capture gate");
    assert.match(manager, /transaction\.queuedInput[\s\S]*?session\.pty\?\.write\(data\)[\s\S]*?session\.parser\?\.onInput\(data\)/, "queued input and parser state must flush together in order");
    assert.match(manager, /MAX_QUEUED_PRIVATE_INPUT = 1024 \* 1024/, "queued input must have a hard memory bound");
    assert.match(manager, /if \(data\.includes\("\\x03"\)\)[\s\S]*?transaction\.controller\.abort\(\)[\s\S]*?this\.releasePrivateOutput\(s, transaction\)[\s\S]*?s\.pty\.write\(data\)[\s\S]*?this\.writeUserInput\(s, queued\)/, "Ctrl+C must cancel capture, interrupt first, then replay queued input");
    assert.match(manager, /killAll\(\): void[\s\S]*?filter\.abort\(\)[\s\S]*?this\.taps\.clear\(\)[\s\S]*?this\.privateOutputQueues\.clear\(\)/, "killAll must clear filters, capture taps, and serialization queues");
}

async function main(): Promise<void> {
    testExclusiveLayoutTruthTable();
    testFullscreenCompositionContract();
    testPrivateOutputSameChunk();
    testPrivateOutputFragmentation();
    testCmdPrivateOutputFragmentation();
    testPrivateOutputBoundAndAbort();
    testSequentialPrivateFilters();
    await testManagerPrivateRouting();
    await testPrivateTransactionSerialization();
    await testPrivateInterruptAndCleanup();
    testPrivateOutputWiringContract();
    console.log("Terminal regression smoke passed: fullscreen composition and private-output stream filtering.");
    console.log("No terminal session, PTY, shell, or user process was opened or modified.");
}

void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
