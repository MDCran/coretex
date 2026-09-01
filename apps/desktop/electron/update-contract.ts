export const UPDATE_IPC = {
    getState: "updates:get-state",
    status: "updates:status",
    check: "updates:check",
    download: "updates:download",
    install: "updates:install",
    getPreferences: "updates:get-preferences",
    setPreferences: "updates:set-preferences",
    setLegacyChannel: "updates:set-channel",
    getReleases: "updates:get-releases",
    openExternal: "updates:open-external",
} as const;

export type DesktopUpdateChannel = "stable" | "beta" | "nightly";
export type DesktopUpdateTrigger = "manual" | "background" | "automatic";

export interface DesktopUpdatePreferences {
    channel: DesktopUpdateChannel;
    automaticChecks: boolean;
    autoDownload: boolean;
}

export type DesktopUpdatePreferencePatch = Partial<DesktopUpdatePreferences>;

export interface DesktopUpdateContext {
    currentVersion: string;
    channel: DesktopUpdateChannel;
    native: true;
    packaged: boolean;
    operationId: string | null;
    trigger: DesktopUpdateTrigger | null;
    automaticChecks: boolean;
    autoDownload: boolean;
    lastCheckedAt?: number;
    nextCheckAt?: number;
    checkIntervalMs: number;
}

export type DesktopUpdateStatus = DesktopUpdateContext &
    (
        | { state: "idle" }
        | { state: "development"; reason: string }
        | { state: "checking" }
        | { state: "current"; checkedAt: number; latest: string }
        | {
              state: "available";
              canDownload: true;
              checkedAt: number;
              version: string;
              url: string;
              name?: string;
              releaseNotes?: string;
          }
        | {
              state: "downloading";
              version: string;
              percent: number;
              transferred: number;
              total: number;
              bytesPerSecond: number;
          }
        | { state: "ready"; version: string; releaseNotes?: string }
        | { state: "error"; checkedAt: number; reason: string }
    );

export interface DesktopReleaseHistoryItem {
    version: string;
    name: string;
    publishedAt: string | null;
    channel: DesktopUpdateChannel;
    notes: string[];
    url: string;
    current: boolean;
    prerelease: boolean;
}

export type DesktopReleaseHistoryResult =
    | {
          ok: true;
          fetchedAt: number;
          sourceUrl: string;
          releases: DesktopReleaseHistoryItem[];
      }
    | { ok: false; fetchedAt: number; sourceUrl: string; reason: string };

export type DesktopUpdateExternalTarget = "releases" | "source" | "changelog" | "third-party-notices";

/** Normalizes renderer input and migrates the retired RC stream to beta. */
export function normalizeUpdateChannel(value: unknown): DesktopUpdateChannel {
    if (value === "nightly") return "nightly";
    if (value === "beta" || value === "release-candidate" || value === "rc") return "beta";
    return "stable";
}

export function parseUpdatePreferencePatch(value: unknown): DesktopUpdatePreferencePatch {
    if (value === undefined) return {};
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("Update preferences must be an object.");
    }
    const source = value as Record<string, unknown>;
    const allowed = new Set(["channel", "automaticChecks", "autoDownload"]);
    if (Object.keys(source).some((key) => !allowed.has(key))) {
        throw new TypeError("Update preferences contained an unsupported field.");
    }
    const patch: DesktopUpdatePreferencePatch = {};
    if ("channel" in source) {
        if (source.channel !== "stable" && source.channel !== "beta" && source.channel !== "nightly") {
            throw new TypeError("The update channel must be stable, beta, or nightly.");
        }
        patch.channel = source.channel;
    }
    if ("automaticChecks" in source) {
        if (typeof source.automaticChecks !== "boolean") {
            throw new TypeError("automaticChecks must be a boolean.");
        }
        patch.automaticChecks = source.automaticChecks;
    }
    if ("autoDownload" in source) {
        if (typeof source.autoDownload !== "boolean") throw new TypeError("autoDownload must be a boolean.");
        patch.autoDownload = source.autoDownload;
    }
    return patch;
}

export function parseUpdateCheckChannel(value: unknown): DesktopUpdateChannel | undefined {
    if (value === undefined) return undefined;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("The update check payload must be an object.");
    }
    const source = value as Record<string, unknown>;
    if (Object.keys(source).some((key) => key !== "channel")) {
        throw new TypeError("The update check payload contained an unsupported field.");
    }
    if (!("channel" in source)) return undefined;
    if (source.channel !== "stable" && source.channel !== "beta" && source.channel !== "nightly") {
        throw new TypeError("The update channel must be stable, beta, or nightly.");
    }
    return source.channel;
}

export function parseReleaseHistoryOptions(value: unknown): {
    refresh?: boolean;
    channel?: DesktopUpdateChannel;
} {
    if (value === undefined) return {};
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("Release history options must be an object.");
    }
    const source = value as Record<string, unknown>;
    if (Object.keys(source).some((key) => key !== "refresh" && key !== "channel")) {
        throw new TypeError("Release history options contained an unsupported field.");
    }
    const options: { refresh?: boolean; channel?: DesktopUpdateChannel } = {};
    if ("refresh" in source) {
        if (typeof source.refresh !== "boolean") throw new TypeError("refresh must be a boolean.");
        options.refresh = source.refresh;
    }
    if ("channel" in source) {
        if (source.channel !== "stable" && source.channel !== "beta" && source.channel !== "nightly") {
            throw new TypeError("The release history channel must be stable, beta, or nightly.");
        }
        options.channel = source.channel;
    }
    return options;
}

export function providerUpdateChannel(channel: DesktopUpdateChannel): string {
    if (channel === "nightly") return "nightly";
    if (channel === "beta") return "beta";
    return "latest";
}

export function releaseChannelFromVersion(version: string, prerelease: boolean): DesktopUpdateChannel | null {
    if (typeof version !== "string" || version.length === 0 || version.length > 80) return null;
    const match = version.match(
        /^\d+\.\d+\.\d+(?:-(?:(beta|rc)\.(\d+)|(nightly)\.(\d+(?:\.\d+)*)))?$/i,
    );
    if (!match) return null;
    const numericParts = version.match(/\d+/g) ?? [];
    if (numericParts.some((part) => !Number.isSafeInteger(Number(part)))) return null;
    const identifier = (match[1] ?? match[3])?.toLowerCase();
    if (!identifier) return prerelease ? null : "stable";
    if (!prerelease) return null;
    if (identifier === "nightly") return "nightly";
    return "beta";
}

export function defaultUpdateChannelForVersion(version: string): DesktopUpdateChannel {
    return releaseChannelFromVersion(version, version.includes("-")) ?? "stable";
}

export function releaseMatchesUpdateStream(
    releaseChannel: DesktopUpdateChannel,
    stream: DesktopUpdateChannel,
): boolean {
    if (stream === "stable") return releaseChannel === "stable";
    // electron-updater's GitHub beta stream may advance users to a newer stable build.
    if (stream === "beta") return releaseChannel === "stable" || releaseChannel === "beta";
    return releaseChannel === "nightly";
}

/** Convert untrusted release markdown into short, inert list items for the UI. */
function stripMarkupTags(value: string): string {
    let output = "";
    for (let index = 0; index < value.length;) {
        if (value[index] !== "<") {
            output += value[index];
            index += 1;
            continue;
        }

        let cursor = index + 1;
        if (value[cursor] === "/") cursor += 1;
        if (!/[a-z]/i.test(value[cursor] ?? "")) {
            output += "<";
            index += 1;
            continue;
        }

        let quote: "'" | '"' | null = null;
        let tagEnd = -1;
        for (; cursor < value.length; cursor += 1) {
            const character = value[cursor];
            if (quote) {
                if (character === quote) quote = null;
            } else if (character === "'" || character === '"') {
                quote = character;
            } else if (character === ">") {
                tagEnd = cursor;
                break;
            }
        }

        if (tagEnd < 0) {
            output += "<";
            index += 1;
        } else {
            index = tagEnd + 1;
        }
    }
    return output;
}

export function sanitizeReleaseNotes(value: unknown): string[] {
    if (typeof value !== "string" || !value.trim()) return [];
    const notes: string[] = [];
    let insideCodeBlock = false;
    for (const rawLine of value.split(/\r?\n/)) {
        const trimmed = rawLine.trim();
        if (/^```/.test(trimmed)) {
            insideCodeBlock = !insideCodeBlock;
            continue;
        }
        if (insideCodeBlock || !trimmed || /^#{1,6}\s/.test(trimmed)) continue;
        const markdownText = trimmed
            .replace(/^[-*+]\s+/, "")
            .replace(/^\d+[.)]\s+/, "")
            .replace(/^>+\s*/, "")
            .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
            .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
        // A single tag-shaped replacement can expose nested markup. This linear
        // pass discards every bracketed section without reinterpreting its output.
        const text = stripMarkupTags(markdownText)
            .replace(/[`*_~]/g, "")
            .replace(/\s+/g, " ")
            .trim();
        if (!text) continue;
        const compact = text.length > 240 ? `${text.slice(0, 237).trimEnd()}...` : text;
        if (!notes.includes(compact)) notes.push(compact);
        if (notes.length === 8) break;
    }
    return notes;
}
