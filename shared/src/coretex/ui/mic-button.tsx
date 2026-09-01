// @ts-nocheck
"use client";

// Coretex — shared push-to-talk / toggle mic button for speech-to-text.
// Uses the Web Speech API via speech.ts. Shows listening state + permission
// feedback. Compact icon button matching AiComposer / Ask AI chrome.

import { useCallback, useEffect, useRef, useState } from "react";
import { Microphone01, MicrophoneOff01 } from "@untitledui/icons";
import { cx } from "@/utils/cx";
import {
    appendTranscript,
    micPermission,
    requestMicPermission,
    speechRecognitionSupported,
    startSpeechRecognition,
    type MicPermission,
    type RecognitionSession,
} from "./speech";

export interface MicButtonProps {
    /** Called with final (committed) transcript chunks. */
    onTranscript?: (text: string) => void;
    /** Optional live interim text (for ghost preview). */
    onInterim?: (text: string) => void;
    /** Current field value — used when callers want MicButton to merge for them. */
    value?: string;
    /** When set with value, MicButton merges + calls this instead of onTranscript alone. */
    onChange?: (next: string) => void;
    language?: string;
    /** Hold mouse/space to talk when true; click toggle when false. */
    pushToTalk?: boolean;
    autoSpace?: boolean;
    disabled?: boolean;
    className?: string;
    /** Visual size. */
    size?: "sm" | "md";
    title?: string;
}

export function MicButton({
    onTranscript,
    onInterim,
    value,
    onChange,
    language = "",
    pushToTalk = false,
    autoSpace = true,
    disabled,
    className,
    size = "md",
    title,
}: MicButtonProps) {
    const [listening, setListening] = useState(false);
    const [perm, setPerm] = useState<MicPermission>("prompt");
    const [error, setError] = useState<string | null>(null);
    const sessionRef = useRef<RecognitionSession | null>(null);
    const valueRef = useRef(value ?? "");
    valueRef.current = value ?? "";

    const supported = speechRecognitionSupported();

    useEffect(() => {
        void micPermission().then(setPerm);
        return () => {
            sessionRef.current?.abort();
            sessionRef.current = null;
        };
    }, []);

    const emit = useCallback(
        (piece: string) => {
            onTranscript?.(piece);
            if (onChange) {
                onChange(appendTranscript(valueRef.current, piece, autoSpace));
            } else if (!onTranscript) {
                /* no-op */
            }
        },
        [autoSpace, onChange, onTranscript],
    );

    const stop = useCallback(() => {
        sessionRef.current?.stop();
        sessionRef.current = null;
        setListening(false);
    }, []);

    const start = useCallback(async () => {
        setError(null);
        if (!supported) {
            setError("Speech recognition isn’t available here. Use Chrome, Edge, or Electron.");
            return;
        }
        let p = perm;
        if (p !== "granted") {
            p = await requestMicPermission();
            setPerm(p);
            if (p !== "granted") {
                setError(p === "unsupported" ? "No microphone found." : "Microphone access denied — enable it in Settings → Microphone.");
                return;
            }
        }

        sessionRef.current?.abort();
        const session = startSpeechRecognition({
            language: language || undefined,
            continuous: !pushToTalk,
            onInterim: (t) => onInterim?.(t),
            onFinal: (t) => emit(t),
            onError: (reason) => {
                setError(reason);
                setListening(false);
                sessionRef.current = null;
            },
            onEnd: () => {
                setListening(false);
                sessionRef.current = null;
            },
        });
        if (!session) return;
        sessionRef.current = session;
        setListening(true);
    }, [emit, language, onInterim, perm, pushToTalk, supported]);

    const toggle = useCallback(() => {
        if (disabled) return;
        if (listening) stop();
        else void start();
    }, [disabled, listening, start, stop]);

    const dim = size === "sm" ? "size-7" : "size-8";
    const icon = size === "sm" ? "size-3.5" : "size-4.5";

    if (!supported && perm === "unsupported") {
        return (
            <button
                type="button"
                disabled
                title="Speech recognition not supported"
                aria-label="Speech recognition not supported"
                className={cx("flex shrink-0 cursor-not-allowed items-center justify-center rounded-full text-quaternary opacity-40", dim, className)}
            >
                <MicrophoneOff01 className={icon} />
            </button>
        );
    }

    const tip =
        error ??
        title ??
        (listening
            ? pushToTalk
                ? "Release to stop"
                : "Listening — click to stop"
            : pushToTalk
              ? "Hold to talk"
              : "Click to dictate");

    return (
        <button
            type="button"
            disabled={disabled}
            aria-pressed={listening}
            aria-label={listening ? "Stop listening" : "Start dictation"}
            title={tip}
            onClick={(e) => {
                e.stopPropagation();
                if (pushToTalk) return;
                toggle();
            }}
            onPointerDown={(e) => {
                if (!pushToTalk || disabled) return;
                e.preventDefault();
                e.stopPropagation();
                void start();
            }}
            onPointerUp={(e) => {
                if (!pushToTalk) return;
                e.stopPropagation();
                stop();
            }}
            onPointerLeave={() => {
                if (pushToTalk && listening) stop();
            }}
            onPointerCancel={() => {
                if (pushToTalk) stop();
            }}
            className={cx(
                "flex shrink-0 cursor-pointer items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-40",
                dim,
                listening
                    ? "text-[var(--c-error,#ef4444)]"
                    : "text-quaternary hover:bg-secondary hover:text-primary",
                className,
            )}
            style={
                listening
                    ? {
                          background: "color-mix(in srgb, var(--c-error, #ef4444) 14%, transparent)",
                          boxShadow: "0 0 0 1px color-mix(in srgb, var(--c-error, #ef4444) 35%, transparent)",
                      }
                    : undefined
            }
        >
            {listening ? <Microphone01 className={cx(icon, "animate-pulse")} /> : <Microphone01 className={icon} />}
        </button>
    );
}
