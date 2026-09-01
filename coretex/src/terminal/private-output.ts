// Coretex — backend broadcast suppression for commands the Brain injects into a live
// PTY (environment probes, shell integration, and Terminal Buddy steps).
//
// The capture path still receives the raw bytes. This filter is used only for the
// terminal:data broadcast, so private command source/output never becomes visible
// in xterm. A private command ends with an OSC 7337 CTXB sentinel carrying its
// unique token and exit code. Everything after that sentinel is ordinary terminal
// output again and must be forwarded byte-for-byte.

const OSC = "\x1b]";
const BEL = "\x07";
const ST = "\x1b\\";

/** Keep enough partial data to recognize a split prefix, exit code, and terminator. */
const MAX_PENDING = 512;

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The exact private-capture end marker (apart from its numeric exit code). */
export function privateEndPrefix(token: string): string {
    return `${OSC}7337;CTXB;${token};E;`;
}

/** cmd.exe cannot reliably emit OSC, so its capture wrapper uses a text sentinel. */
export function privateTextEndPrefix(token: string): string {
    return `__CTXB_E_${token}_`;
}

export interface PrivateFilterResult {
    /** Bytes safe to broadcast to xterm. */
    visible: string;
    /** True once the matching end marker has been consumed. */
    complete: boolean;
}

/**
 * Streaming filter for one private PTY transaction.
 *
 * While active, bytes are intentionally discarded rather than buffered: they are
 * the injected command echo and its captured output. Only a short look-behind is
 * retained so a marker split across arbitrary node-pty chunks is still detected.
 */
export class PrivateOutputFilter {
    private readonly endPattern: RegExp;
    private pending = "";
    private finished = false;

    constructor(token: string) {
        const oscPrefix = escapeRegex(privateEndPrefix(token));
        const textPrefix = escapeRegex(privateTextEndPrefix(token));
        const oscEnd = `${oscPrefix}-?\\d+(?:${escapeRegex(BEL)}|${escapeRegex(ST)})`;
        const textEnd = `${textPrefix}-?\\d+__`;
        this.endPattern = new RegExp(`(?:${oscEnd}|${textEnd})`);
    }

    get complete(): boolean {
        return this.finished;
    }

    push(chunk: string): PrivateFilterResult {
        if (this.finished) return { visible: chunk, complete: true };

        this.pending += chunk;
        const match = this.endPattern.exec(this.pending);
        if (match) {
            const markerEnd = match.index + match[0].length;
            const visible = this.pending.slice(markerEnd);
            this.pending = "";
            this.finished = true;
            return { visible, complete: true };
        }

        // The private body can be arbitrarily large. Retaining only the tail keeps
        // memory bounded while preserving every possible split end marker.
        if (this.pending.length > MAX_PENDING) this.pending = this.pending.slice(-MAX_PENDING);
        return { visible: "", complete: false };
    }

    /** Release a timed-out/aborted transaction without leaking its partial bytes. */
    abort(): void {
        this.pending = "";
        this.finished = true;
    }
}
