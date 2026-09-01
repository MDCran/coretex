// @ts-nocheck
"use client";

// Coretex — React error boundary. The shell root is transparent over a fixed body
// bloom-field, so WITHOUT this any thrown render/effect error unmounts the whole tree
// and the user sees only the background ("flash then blank"). This catches the throw,
// keeps the app from disappearing, and shows the actual error + a recover/reload path.
// Two scopes are used: a top-level backstop around the shell, and a granular one around
// the main view (so a single view crashing keeps the sidebar + chrome usable).

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCcw01, RefreshCcw05 } from "@untitledui/icons";

interface Props {
    children: ReactNode;
    /** Short scope label shown in the fallback (e.g. "view"). */
    label?: string;
    /** When this value changes, the boundary resets and retries rendering its children
     *  (e.g. pass the active nav key so navigating away from a crashed view recovers). */
    resetKey?: string | number;
}

interface State {
    error: Error | null;
}

export class AppErrorBoundary extends Component<Props, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo): void {
        // Surface for debugging — visible in the browser/Electron console.
        // eslint-disable-next-line no-console
        console.error("[Coretex] UI error caught by boundary:", error, info?.componentStack);
    }

    componentDidUpdate(prev: Props): void {
        // Reset on resetKey change so recovery (e.g. navigating away) re-renders children.
        if (this.state.error && prev.resetKey !== this.props.resetKey) {
            this.setState({ error: null });
        }
    }

    private reset = (): void => this.setState({ error: null });

    render(): ReactNode {
        const { error } = this.state;
        if (!error) return this.props.children;

        const isView = this.props.label === "view";
        return (
            <div
                role="alert"
                className={isView ? "flex min-h-0 flex-1 items-center justify-center p-6" : "flex h-dvh w-full items-center justify-center p-6"}
                style={{ background: isView ? "transparent" : "var(--app-bg, #0a0c10)" }}
            >
                <div
                    className="flex w-full max-w-lg flex-col gap-4 rounded-2xl p-6 shadow-2xl"
                    style={{ background: "var(--surface, #14171d)", border: "1px solid var(--c-border, #232830)" }}
                >
                    <div className="flex items-center gap-3">
                        <span
                            className="flex size-10 shrink-0 items-center justify-center rounded-full"
                            style={{ background: "color-mix(in srgb, var(--c-error, #f04438) 16%, transparent)", color: "var(--c-error, #f04438)" }}
                        >
                            <AlertTriangle className="size-5" />
                        </span>
                        <div className="min-w-0">
                            <p className="text-md font-semibold" style={{ color: "var(--c-text-primary, #f5f6f8)" }}>
                                {isView ? "This screen hit an error" : "Coretex hit an error"}
                            </p>
                            <p className="text-sm" style={{ color: "var(--c-text-secondary, #9ba0a8)" }}>
                                {isView ? "The rest of the app is still usable — try again or switch screens." : "The interface stopped rendering. Your data is safe; reload to recover."}
                            </p>
                        </div>
                    </div>

                    <pre
                        className="max-h-48 overflow-auto rounded-lg p-3 font-mono text-xs whitespace-pre-wrap"
                        style={{ background: "var(--surface-2, #1a1e25)", color: "var(--c-text-secondary, #9ba0a8)", border: "1px solid var(--c-border, #232830)" }}
                    >
                        {error.message || String(error)}
                    </pre>

                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={this.reset}
                            className="inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition hover:brightness-110"
                            style={{ background: "var(--surface-2, #1a1e25)", color: "var(--c-text-primary, #f5f6f8)", border: "1px solid var(--c-border, #232830)" }}
                        >
                            <RefreshCcw05 className="size-4" /> Try again
                        </button>
                        <button
                            type="button"
                            onClick={() => { if (typeof window !== "undefined") window.location.reload(); }}
                            className="inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold text-white transition hover:brightness-110"
                            style={{ background: "var(--brand, #ef4242)" }}
                        >
                            <RefreshCcw01 className="size-4" /> Reload app
                        </button>
                    </div>
                </div>
            </div>
        );
    }
}
