// @ts-nocheck
// Coretex — terminal log registry. Each live XtermTerm registers a reader that
// serializes its current scrollback + viewport to plain text, keyed by session id.
// The dock's tab context menu and the per-project terminals tab use this to
// "Export log" (save the terminal output to a .log file) without reaching into
// the xterm instance directly.

type LogReader = () => string;

const readers = new Map<string, LogReader>();

export function registerTerminalReader(id: string, reader: LogReader): void {
    readers.set(id, reader);
}

export function unregisterTerminalReader(id: string): void {
    readers.delete(id);
}

/** Serialized scrollback+viewport text for a session, or null when no live terminal is registered. */
export function readTerminalLog(id: string): string | null {
    const reader = readers.get(id);
    if (!reader) return null;
    try {
        return reader();
    } catch {
        return null;
    }
}

export function hasTerminalReader(id: string): boolean {
    return readers.has(id);
}

/** Trigger a browser/desktop download of `text` as a file. */
export function downloadTextFile(filename: string, text: string): void {
    if (typeof document === "undefined") return;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke on the next tick so the click's navigation has committed.
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Filesystem-safe log filename from a terminal title + timestamp. */
export function terminalLogFilename(title: string): string {
    const safe = (title || "terminal").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "terminal";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    return `${safe}-${stamp}.log`;
}
