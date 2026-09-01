// @ts-nocheck
"use client";

// Coretex — alert history primitives. The durable notification feed (Brain notices +
// connection transitions) lives here as a reusable hook + list, and is surfaced as an
// "Alerts" chip in the bottom-right StatusCluster (next to Agents/Terminals). Fully
// tokenized to the RED brand + semantic tokens — no stray blue.

import { useEffect, useRef, useState } from "react";
import { CheckCircle, AlertTriangle, AlertCircle, InfoCircle, XClose, Inbox01 } from "@untitledui/icons";

type Level = "info" | "success" | "warning" | "error";
type Notice = { level: Level; message: string; at: number } | null;

export interface AlertItem {
    id: string;
    level: Level;
    title?: string;
    message: string;
    at: number;
    read: boolean;
}

const META: Record<Level, { color: string; Icon: typeof InfoCircle }> = {
    info: { color: "var(--brand)", Icon: InfoCircle },
    success: { color: "var(--c-success)", Icon: CheckCircle },
    warning: { color: "var(--c-warning)", Icon: AlertTriangle },
    error: { color: "var(--c-error)", Icon: AlertCircle },
};

function relTime(at: number): string {
    const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
    if (s < 5) return "just now";
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}

let _seq = 0;
const nextId = (): string => `al_${Date.now()}_${_seq++}`;

export interface AlertHistory {
    items: AlertItem[];
    unread: number;
    dismiss: (id: string) => void;
    clearAll: () => void;
    markAllRead: () => void;
}

/** Accumulates Brain notices + connection transitions into a durable, capped session feed. */
export function useAlertHistory(notice: Notice, connected: boolean): AlertHistory {
    const [items, setItems] = useState<AlertItem[]>([]);
    const lastAt = useRef(0);
    const wasConnected = useRef<boolean | null>(null);

    useEffect(() => {
        if (!notice || notice.at === lastAt.current) return;
        lastAt.current = notice.at;
        setItems((prev) => [{ id: nextId(), level: notice.level, message: notice.message, at: notice.at, read: false }, ...prev].slice(0, 60));
    }, [notice?.at]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (wasConnected.current === null) { wasConnected.current = connected; return; }
        if (connected === wasConnected.current) return;
        wasConnected.current = connected;
        setItems((prev) => [{
            id: nextId(),
            level: (connected ? "success" : "warning") as Level,
            title: connected ? "Reconnected" : "Connection lost",
            message: connected ? "Live connection to the Brain restored." : "Reconnecting to the Brain…",
            at: Date.now(),
            read: false,
        }, ...prev].slice(0, 60));
    }, [connected]);

    return {
        items,
        unread: items.filter((i) => !i.read).length,
        dismiss: (id) => setItems((prev) => prev.filter((i) => i.id !== id)),
        clearAll: () => setItems([]),
        markAllRead: () => setItems((prev) => prev.map((i) => ({ ...i, read: true }))),
    };
}

/** The notification list body (rows + empty state). "Clear all" lives in the host panel header, next to close. */
export const AlertList = ({ items, onDismiss }: { items: AlertItem[]; onDismiss: (id: string) => void; onClear?: () => void }) => {
    const [, force] = useState(0);
    useEffect(() => {
        const t = window.setInterval(() => force((n) => n + 1), 15000);
        return () => window.clearInterval(t);
    }, []);

    return (
        <div>
            {items.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
                    <span className="flex size-9 items-center justify-center rounded-full" style={{ background: "var(--surface-2)" }}>
                        <Inbox01 className="size-4.5 text-quaternary" />
                    </span>
                    <p className="text-sm font-medium text-secondary">You're all caught up</p>
                    <p className="text-xs text-quaternary">Provider, connection & task alerts land here.</p>
                </div>
            ) : (
                items.map((it) => {
                    const m = META[it.level];
                    return (
                        <div key={it.id} className="group flex items-start gap-2.5 rounded-lg px-2 py-2 transition hover:bg-[var(--surface-2)]">
                            <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full" style={{ background: `color-mix(in srgb, ${m.color} 16%, transparent)` }}>
                                <m.Icon className="size-3.5" style={{ color: m.color }} />
                            </span>
                            <div className="min-w-0 flex-1">
                                {it.title && <p className="truncate text-sm font-medium text-primary">{it.title}</p>}
                                <p className={it.title ? "text-xs text-tertiary" : "text-sm text-secondary"}>{it.message}</p>
                                <p className="mt-0.5 text-[11px] text-quaternary">{relTime(it.at)}</p>
                            </div>
                            <button type="button" onClick={() => onDismiss(it.id)} title="Dismiss" className="shrink-0 rounded p-0.5 text-quaternary opacity-0 transition hover:text-secondary group-hover:opacity-100">
                                <XClose className="size-3.5" />
                            </button>
                        </div>
                    );
                })
            )}
        </div>
    );
};
