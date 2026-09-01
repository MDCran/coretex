// @ts-nocheck
"use client";

// Coretex — lightweight toast surface. Shows the most recent Brain "notice" event
// (e.g. "Connect Gmail needs credentials", "Connection verified") and auto-dismisses.
// One toast at a time; re-firing replaces it. Glassy to match the app's bloom surfaces.

import { useEffect, useState } from "react";
import { CheckCircle, AlertTriangle, AlertCircle, InfoCircle, X } from "@untitledui/icons";

type Notice = { level: "info" | "success" | "warning" | "error"; message: string; at: number } | null;

// Fully tokenized so toasts track the brand (RED) + semantic theme tokens — no stray blue.
const META: Record<NonNullable<Notice>["level"], { color: string; Icon: typeof InfoCircle }> = {
    info: { color: "var(--brand)", Icon: InfoCircle },
    success: { color: "var(--c-success)", Icon: CheckCircle },
    warning: { color: "var(--c-warning)", Icon: AlertTriangle },
    error: { color: "var(--c-error)", Icon: AlertCircle },
};

export const Toaster = ({ notice }: { notice: Notice }) => {
    const [shown, setShown] = useState<Notice>(null);

    useEffect(() => {
        if (!notice) return;
        setShown(notice);
        const t = window.setTimeout(() => setShown(null), 6000);
        return () => window.clearTimeout(t);
    }, [notice?.at]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!shown) return null;
    const m = META[shown.level];

    return (
        <div className="fixed bottom-4 left-1/2 z-[60] -translate-x-1/2">
            <div
                className="glass accent-glow flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 shadow-2xl"
                role="status"
                style={{ borderColor: `color-mix(in srgb, ${m.color} 38%, transparent)` }}
            >
                <m.Icon className="size-4 shrink-0" style={{ color: m.color }} />
                <span className="max-w-md text-sm text-primary">{shown.message}</span>
                <button type="button" onClick={() => setShown(null)} className="ml-1 rounded p-0.5 text-quaternary hover:text-secondary">
                    <X className="size-3.5" />
                </button>
            </div>
        </div>
    );
};
