// @ts-nocheck
"use client";

// Coretex — desktop notifications via the browser/Electron Notification API.
// Honors the per-category prefs + quiet/background settings supplied by callers.

export type NotifyPermission = "default" | "granted" | "denied" | "unsupported";

export function notifyPermission(): NotifyPermission {
    if (typeof window === "undefined" || typeof Notification === "undefined") return "unsupported";
    return Notification.permission as NotifyPermission;
}

export async function requestNotify(): Promise<NotifyPermission> {
    if (typeof Notification === "undefined") return "unsupported";
    if (Notification.permission === "default") {
        try {
            return (await Notification.requestPermission()) as NotifyPermission;
        } catch {
            return "denied";
        }
    }
    return Notification.permission as NotifyPermission;
}

export function fireNotification(title: string, body?: string, opts?: { silent?: boolean; tag?: string; onClick?: () => void }): boolean {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
    try {
        const silent = opts?.silent ?? true;
        const n = new Notification(title, { body, silent: true, tag: opts?.tag });
        if (!silent) playNotificationSound();
        if (opts?.onClick) n.onclick = () => { window.focus(); opts.onClick?.(); };
        return true;
    } catch {
        return false;
    }
}

/** Short alert chime — used when notifications.sound is on (settings preview + live alerts). */
export function playNotificationSound(): void {
    if (typeof window === "undefined") return;
    try {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) return;
        const ctx = new Ctx();
        const now = ctx.currentTime;
        const master = ctx.createGain();
        master.gain.setValueAtTime(0.0001, now);
        master.gain.exponentialRampToValueAtTime(0.22, now + 0.02);
        master.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
        master.connect(ctx.destination);

        const tone = (freq: number, start: number, dur: number) => {
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            osc.type = "sine";
            osc.frequency.setValueAtTime(freq, start);
            g.gain.setValueAtTime(0.0001, start);
            g.gain.exponentialRampToValueAtTime(0.9, start + 0.012);
            g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
            osc.connect(g);
            g.connect(master);
            osc.start(start);
            osc.stop(start + dur + 0.02);
        };

        tone(880, now, 0.12);
        tone(1174.66, now + 0.1, 0.18);
        window.setTimeout(() => void ctx.close(), 500);
    } catch {
        // Autoplay policy or missing Web Audio — ignore.
    }
}

/** True when the local clock sits inside a quiet-hours window (handles overnight wrap). */
export function isInQuietHours(start: string, end: string, now = new Date()): boolean {
    const toMins = (hhmm: string) => {
        const [h, m] = hhmm.split(":").map((x) => Number(x));
        if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
        return h * 60 + m;
    };
    const cur = now.getHours() * 60 + now.getMinutes();
    const s = toMins(start);
    const e = toMins(end);
    if (s === e) return false;
    // Overnight window (e.g. 22:00 → 07:00).
    if (s > e) return cur >= s || cur < e;
    return cur >= s && cur < e;
}

type DigestItem = { category: string; title: string; body?: string; at: number };
let digestQueue: DigestItem[] = [];
let digestTimer: ReturnType<typeof setTimeout> | null = null;
let digestIntervalMins = 30;

/** Buffer a non-critical alert into the digest queue and schedule a flush. */
export function enqueueDigest(category: string, title: string, body: string | undefined, everyMinutes: number): void {
    digestIntervalMins = Math.max(5, Math.min(240, everyMinutes || 30));
    digestQueue.push({ category: category, title, body, at: Date.now() });
    if (digestTimer) return;
    digestTimer = setTimeout(flushDigest, digestIntervalMins * 60_000);
}

/** Pending digest items waiting for the next flush. */
export function getDigestQueueLength(): number {
    return digestQueue.length;
}

/** Configured digest interval (minutes). */
export function getDigestIntervalMinutes(): number {
    return digestIntervalMins;
}

/** Force-flush the digest now (settings preview / “Send digest now”). */
export function flushDigestNow(): boolean {
    if (digestTimer) {
        clearTimeout(digestTimer);
        digestTimer = null;
    }
    if (digestQueue.length === 0) return false;
    flushDigest();
    return true;
}

function flushDigest(): void {
    digestTimer = null;
    if (digestQueue.length === 0) return;
    const items = digestQueue;
    digestQueue = [];
    const count = items.length;
    const preview = items.slice(0, 3).map((i) => i.title).join(" · ");
    const more = count > 3 ? ` (+${count - 3} more)` : "";
    fireNotification(`Coretex digest · ${count} update${count === 1 ? "" : "s"}`, `${preview}${more}`);
}
