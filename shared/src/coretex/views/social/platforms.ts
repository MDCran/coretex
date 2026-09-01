// @ts-nocheck
/**
 * Social platform registry for ContactHandle (the "Socials" section).
 * Pure data only (server-safe) — icon rendering lives in the client
 * `<PlatformIcon>` component so we never pass icon functions across the RSC
 * boundary.
 */

export type PlatformKey =
    | "Instagram"
    | "Discord"
    | "YouTube"
    | "TikTok"
    | "Snapchat"
    | "LinkedIn"
    | "X"
    | "Facebook"
    | "Reddit"
    | "GitHub"
    | "Twitch"
    | "Threads"
    | "Telegram"
    | "WhatsApp"
    | "Signal"
    | "Pinterest"
    | "Other";

type PlatformDef = {
    /** Base profile URL; a bare handle (sans @) is appended. */
    base?: string;
    /** Strip a leading @ from the handle when building a URL. */
    stripAt?: boolean;
};

/** Ordered preset list shown in the platform combobox. */
export const PLATFORM_PRESETS: PlatformKey[] = [
    "Instagram",
    "Discord",
    "YouTube",
    "TikTok",
    "Snapchat",
    "LinkedIn",
    "X",
    "Facebook",
    "Reddit",
    "GitHub",
    "Twitch",
    "Threads",
    "Telegram",
    "WhatsApp",
    "Signal",
    "Pinterest",
    "Other",
];

const DEFS: Record<string, PlatformDef> = {
    Instagram: { base: "https://instagram.com/", stripAt: true },
    Discord: {},
    YouTube: { base: "https://youtube.com/@", stripAt: true },
    TikTok: { base: "https://tiktok.com/@", stripAt: true },
    Snapchat: { base: "https://snapchat.com/add/", stripAt: true },
    LinkedIn: { base: "https://linkedin.com/in/", stripAt: true },
    X: { base: "https://x.com/", stripAt: true },
    Twitter: { base: "https://x.com/", stripAt: true },
    Facebook: { base: "https://facebook.com/", stripAt: true },
    Reddit: { base: "https://reddit.com/user/", stripAt: true },
    GitHub: { base: "https://github.com/", stripAt: true },
    Twitch: { base: "https://twitch.tv/", stripAt: true },
    Threads: { base: "https://threads.net/@", stripAt: true },
    Telegram: { base: "https://t.me/", stripAt: true },
    Pinterest: { base: "https://pinterest.com/", stripAt: true },
};

/** True when the handle is already a full URL. */
function isUrl(handle: string): boolean {
    return /^https?:\/\//i.test(handle.trim());
}

/**
 * Build a clickable URL for a handle on a platform. If the handle is already a
 * URL we return it untouched; otherwise we map it onto the platform's base.
 * Returns null when no sensible link can be built (e.g. Discord tags).
 */
export function platformUrl(platform: string | null | undefined, handle: string): string | null {
    const h = handle.trim();
    if (!h) return null;
    if (isUrl(h)) return h;
    const def = platform ? DEFS[platform] : undefined;
    if (!def?.base) return null;
    const clean = def.stripAt ? h.replace(/^@+/, "") : h;
    return def.base + encodeURIComponent(clean).replace(/%2F/gi, "/");
}

/** Human display for a handle (keeps @ for handle-style platforms). */
export function platformDisplay(handle: string): string {
    return handle.trim();
}
