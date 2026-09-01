// @ts-nocheck
"use client";

// Coretex — speech-to-text helpers. Mirrors notify.ts: permission probe + request,
// feature detection for the Web Speech API, and a small recognition session helper.
// Works in Chromium / Electron; Safari uses webkitSpeechRecognition.

export type MicPermission = "prompt" | "granted" | "denied" | "unsupported";

type SpeechRecognitionLike = {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
    onerror: ((ev: { error?: string }) => void) | null;
    onend: (() => void) | null;
    start: () => void;
    stop: () => void;
    abort: () => void;
};

type SpeechRecognitionEventLike = {
    resultIndex: number;
    results: ArrayLike<{
        isFinal: boolean;
        0: { transcript: string };
        length: number;
    }>;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
    if (typeof window === "undefined") return null;
    const w = window as unknown as {
        SpeechRecognition?: SpeechRecognitionCtor;
        webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechRecognitionSupported(): boolean {
    return getSpeechRecognitionCtor() !== null;
}

/** Probe microphone permission via Permissions API when available. */
export async function micPermission(): Promise<MicPermission> {
    if (typeof window === "undefined" || typeof navigator === "undefined") return "unsupported";
    if (!navigator.mediaDevices?.getUserMedia) return "unsupported";
    try {
        const perms = navigator.permissions;
        if (perms?.query) {
            const status = await perms.query({ name: "microphone" as PermissionName });
            if (status.state === "granted") return "granted";
            if (status.state === "denied") return "denied";
            return "prompt";
        }
    } catch {
        // Permissions API may reject "microphone" on some browsers — fall through.
    }
    return "prompt";
}

/** Request mic access (opens the browser/Electron permission prompt). */
export async function requestMicPermission(): Promise<MicPermission> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return "unsupported";
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        for (const track of stream.getTracks()) track.stop();
        return "granted";
    } catch (err) {
        const name = err instanceof DOMException ? err.name : "";
        if (name === "NotAllowedError" || name === "PermissionDeniedError") return "denied";
        if (name === "NotFoundError" || name === "DevicesNotFoundError") return "unsupported";
        return "denied";
    }
}

export interface StartRecognitionOpts {
    language?: string;
    continuous?: boolean;
    onInterim?: (text: string) => void;
    onFinal?: (text: string) => void;
    onError?: (reason: string) => void;
    onEnd?: () => void;
}

export interface RecognitionSession {
    stop: () => void;
    abort: () => void;
}

/**
 * Start a Web Speech recognition session. Caller must stop()/abort() when done.
 * Requires HTTPS or Electron secure context + microphone permission.
 */
export function startSpeechRecognition(opts: StartRecognitionOpts = {}): RecognitionSession | null {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
        opts.onError?.("Speech recognition is not supported in this browser.");
        return null;
    }

    let rec: SpeechRecognitionLike;
    try {
        rec = new Ctor();
    } catch {
        opts.onError?.("Could not start speech recognition.");
        return null;
    }

    rec.continuous = opts.continuous ?? true;
    rec.interimResults = true;
    if (opts.language?.trim()) rec.lang = opts.language.trim();

    rec.onresult = (ev) => {
        let interim = "";
        let finals = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
            const row = ev.results[i];
            const piece = row?.[0]?.transcript ?? "";
            if (row.isFinal) finals += piece;
            else interim += piece;
        }
        if (finals) opts.onFinal?.(finals);
        if (interim) opts.onInterim?.(interim);
    };

    rec.onerror = (ev) => {
        const code = ev.error ?? "error";
        if (code === "aborted" || code === "no-speech") return;
        const friendly: Record<string, string> = {
            "not-allowed": "Microphone permission denied. Enable it in Settings → Microphone.",
            "service-not-allowed": "Speech service blocked. Check OS / browser microphone settings.",
            "audio-capture": "No microphone found.",
            network: "Speech recognition needs a network connection in this browser.",
        };
        opts.onError?.(friendly[code] ?? `Speech recognition error: ${code}`);
    };

    rec.onend = () => opts.onEnd?.();

    try {
        rec.start();
    } catch {
        opts.onError?.("Microphone is already in use or recognition failed to start.");
        return null;
    }

    return {
        stop: () => {
            try {
                rec.stop();
            } catch {
                /* ignore */
            }
        },
        abort: () => {
            try {
                rec.abort();
            } catch {
                /* ignore */
            }
        },
    };
}

/** Merge a new transcript into existing field text with optional spacing. */
export function appendTranscript(current: string, next: string, autoSpace = true): string {
    const piece = next.trim();
    if (!piece) return current;
    if (!current.trim()) return piece;
    if (!autoSpace) return current + piece;
    const needsSpace = !/\s$/.test(current) && !/^[.,!?;:]/.test(piece);
    return current + (needsSpace ? " " : "") + piece;
}
