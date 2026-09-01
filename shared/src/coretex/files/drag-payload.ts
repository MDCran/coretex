// @ts-nocheck
// Coretex Files — a self-describing in-app drag payload. The dragged entry is written
// onto the native DataTransfer (not only held in one component's React state), so a drop
// target in another Files pane/instance can reconstruct it. Cross-OS-window moves still
// go through the Brain's relay clipboard (fs:copy/cut → fs:paste).

export const DRAG_MIME = "application/x-coretex-file";

export interface DragPayload {
    path: string;
    name: string;
    isDir: boolean;
    /** Where the entry lives — "local" (the Brain filesystem) or "remote" (an SFTP/FTP session). */
    origin?: "local" | "remote";
    /** Remote session id when origin === "remote" (for download routing). */
    sessionId?: string;
}

/** Stamp the dragged entry onto the DataTransfer (structured + plain-text path fallback). */
export function writeDragPayload(dt: DataTransfer, p: DragPayload): void {
    try {
        dt.setData(DRAG_MIME, JSON.stringify(p));
        dt.setData("text/plain", p.path);
    } catch {
        /* some environments restrict custom MIME types — text/plain still carries the path */
    }
}

/** Recover the dragged entry from a drop event's DataTransfer, or null if absent/malformed. */
export function readDragPayload(dt: DataTransfer): DragPayload | null {
    try {
        const raw = dt.getData(DRAG_MIME);
        if (raw) {
            const o = JSON.parse(raw) as Partial<DragPayload>;
            if (o && typeof o.path === "string") {
                return {
                    path: o.path,
                    name: String(o.name ?? o.path),
                    isDir: !!o.isDir,
                    origin: o.origin === "remote" ? "remote" : "local",
                    ...(o.sessionId ? { sessionId: o.sessionId } : {}),
                };
            }
        }
    } catch {
        /* not our payload */
    }
    return null;
}
