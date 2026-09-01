// Coretex — app version, release channels, changelog, and update checks.
// Surfaced in Settings → About & updates and the account menu. Checks GitHub
// Releases for UPDATE_REPO and compares against CORETEX_VERSION.

declare const __CORETEX_VERSION__: string | undefined;

// Electron injects the desktop package version at build time. The fallback keeps
// the shared web build usable when it is compiled without that desktop constant.
export const CORETEX_VERSION = typeof __CORETEX_VERSION__ === "string" ? __CORETEX_VERSION__ : "0.1.0";

export type UpdateChannel = "stable" | "beta" | "nightly";

export const UPDATE_CHANNELS: { id: UpdateChannel; label: string; description: string }[] = [
    { id: "stable", label: "Stable", description: "Production-ready releases. Recommended for everyday use." },
    { id: "beta", label: "Beta", description: "Early access to new features — expect rough edges." },
    { id: "nightly", label: "Nightly", description: "Latest automated builds for testing — may be unstable." },
];

export const DEFAULT_UPDATE_CHANNEL: UpdateChannel = "stable";

const CHANNEL_STORAGE_KEY = "coretex.updateChannel";

export function channelLabel(c: UpdateChannel): string {
    return UPDATE_CHANNELS.find((x) => x.id === c)?.label ?? c;
}

export function loadUpdateChannel(): UpdateChannel {
    if (typeof window === "undefined") return DEFAULT_UPDATE_CHANNEL;
    try {
        const raw = window.localStorage.getItem(CHANNEL_STORAGE_KEY);
        if (raw === "stable" || raw === "beta" || raw === "nightly") return raw;
        // Migrate the retired release-candidate stream without losing the user's
        // preference for prerelease builds.
        if (raw === "release-candidate" || raw === "rc") return "beta";
    } catch {
        /* ignore */
    }
    return DEFAULT_UPDATE_CHANNEL;
}

export function saveUpdateChannel(channel: UpdateChannel): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(CHANNEL_STORAGE_KEY, channel);
        const bridge = electronBridge();
        if (bridge?.updates?.setPreferences) void bridge.updates.setPreferences({ channel }).catch(() => undefined);
        else bridge?.send?.("updates:set-channel", { channel });
    } catch {
        /* ignore */
    }
}

/** GitHub repo releases are pulled from (owner/repo). */
export const UPDATE_REPO = "MDCran/coretex";
export const RELEASES_URL = `https://github.com/${UPDATE_REPO}/releases`;
export const REPO_URL = `https://github.com/${UPDATE_REPO}`;

export interface ChangelogEntry {
    version: string;
    /** ISO date (YYYY-MM-DD). */
    date: string;
    channel: UpdateChannel;
    title: string;
    notes: string[];
}

// Newest first. Channel marks which stream each build shipped to.
export const CHANGELOG: ChangelogEntry[] = [
    {
        version: "0.1.0",
        date: "2026-09-01",
        channel: "stable",
        title: "Initial desktop release",
        notes: [
            "Coretex Windows desktop workspace with the local Brain service, agents, projects, tasks, terminal, database, Docker, email, calendar, health, workouts, nutrition, finance, and social workspaces.",
            "Native NSIS installer packaging and release-based update delivery.",
            "Consistent Untitled UI patterns, responsive navigation, contextual action docks, and clearer empty states.",
            "Improved database recovery, terminal privacy, calendar editing, nutrition and workout tracking, and Docker action feedback.",
        ],
    },
    {
        version: "0.0.9",
        date: "2026-06-12",
        channel: "beta",
        title: "Council, Calendar & Analytics",
        notes: [
            "Multi-agent Council with sequential, debate, and orchestrator topologies.",
            "Full calendar manager with reminders, categories, and week/day/month views.",
            "Usage & Analytics dashboard with cost, token, and success-rate charts.",
        ],
    },
    {
        version: "0.0.8",
        date: "2026-06-06",
        channel: "beta",
        title: "Infrastructure surfaces",
        notes: [
            "Live Docker control (containers, images, volumes, networks).",
            "Running-server detection with tiered relevance and an embedded browser.",
            "Environment Variable manager and API Key vault with leak scanning.",
        ],
    },
    {
        version: "0.0.7",
        date: "2026-05-30",
        channel: "beta",
        title: "Terminal multiplexer",
        notes: [
            "Real PTY terminals via node-pty + xterm.js, with grids, rename, recolor, and pop-out.",
            "MCP host: connect stdio servers, list tools, and run them with confirmation.",
        ],
    },
];

export interface UpdatePreferences {
    channel: UpdateChannel;
    automaticChecks: boolean;
    autoDownload: boolean;
}

export interface ReleaseHistoryItem {
    version: string;
    name: string;
    publishedAt: string | null;
    channel: UpdateChannel;
    notes: string[];
    url: string;
    current: boolean;
    prerelease: boolean;
}

export type ReleaseHistoryResult =
    | { ok: true; fetchedAt: number; sourceUrl: string; releases: ReleaseHistoryItem[] }
    | { ok: false; fetchedAt: number; sourceUrl: string; reason: string };

export type UpdateExternalTarget = "releases" | "source" | "changelog" | "third-party-notices";

interface NativeUpdateContext {
    packaged?: boolean;
    operationId?: string | null;
    trigger?: "manual" | "background" | "automatic" | null;
    automaticChecks?: boolean;
    autoDownload?: boolean;
    lastCheckedAt?: number;
    nextCheckAt?: number;
    checkIntervalMs?: number;
}

export type UpdateStatus = NativeUpdateContext &
    (
    | { state: "idle"; currentVersion?: string; channel?: UpdateChannel; native?: boolean }
    | { state: "checking"; currentVersion?: string; channel?: UpdateChannel; native?: boolean }
    | { state: "development"; currentVersion: string; channel: UpdateChannel; native: true; reason: string }
    | { state: "current"; checkedAt: number; latest: string; currentVersion?: string; channel?: UpdateChannel; native?: boolean }
    | {
          state: "available";
          checkedAt: number;
          version: string;
          url: string;
          name?: string;
          releaseNotes?: string;
          currentVersion?: string;
          channel?: UpdateChannel;
          native?: boolean;
          canDownload?: boolean;
      }
    | {
          state: "downloading";
          version: string;
          percent: number;
          transferred: number;
          total: number;
          bytesPerSecond: number;
          currentVersion: string;
          channel: UpdateChannel;
          native: true;
      }
    | {
          state: "ready";
          version: string;
          releaseNotes?: string;
          currentVersion: string;
          channel: UpdateChannel;
          native: true;
      }
    | { state: "error"; checkedAt: number; reason: string; currentVersion?: string; channel?: UpdateChannel; native?: boolean }
    );

interface ElectronUpdateBridge {
    invoke?: (channel: string, data?: unknown) => Promise<unknown>;
    send?: (channel: string, data?: unknown) => void;
    on?: (channel: string, func: (...args: unknown[]) => void) => (() => void) | void;
    updates?: {
        getState?: () => Promise<unknown>;
        getPreferences?: () => Promise<unknown>;
        setPreferences?: (patch: Partial<UpdatePreferences>) => Promise<unknown>;
        check?: (channel: UpdateChannel) => Promise<unknown>;
        download?: () => Promise<unknown>;
        install?: () => Promise<unknown>;
        getReleases?: (options?: { refresh?: boolean; channel?: UpdateChannel }) => Promise<unknown>;
        openExternal?: (target: UpdateExternalTarget) => Promise<unknown>;
        onStatus?: (listener: (status: unknown) => void) => (() => void) | void;
    };
}

function electronBridge(): ElectronUpdateBridge | undefined {
    if (typeof window === "undefined") return undefined;
    return (window as unknown as { electronAPI?: ElectronUpdateBridge }).electronAPI;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function boundedString(value: unknown, maxLength: number, allowEmpty = false): value is string {
    return (
        typeof value === "string" &&
        value.length <= maxLength &&
        (allowEmpty || value.trim().length > 0)
    );
}

function finiteNumber(value: unknown, minimum = 0): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= minimum;
}

function validUpdateChannel(value: unknown): value is UpdateChannel {
    return value === "stable" || value === "beta" || value === "nightly";
}

function safeCoretexUrl(value: unknown): value is string {
    if (!boundedString(value, 2_048)) return false;
    try {
        const url = new URL(value);
        const repositoryPath = `/${UPDATE_REPO}`.toLowerCase();
        const path = url.pathname.toLowerCase();
        return (
            url.protocol === "https:" &&
            url.hostname.toLowerCase() === "github.com" &&
            (path === repositoryPath || path.startsWith(`${repositoryPath}/`))
        );
    } catch {
        return false;
    }
}

function validStatusContext(candidate: Record<string, unknown>): boolean {
    // Values crossing the desktop bridge must carry the complete native
    // context. Browser-only fallback statuses are constructed locally and do
    // not pass through this validator.
    if (candidate.native !== true) return false;
    if (!boundedString(candidate.currentVersion, 80) || !validUpdateChannel(candidate.channel)) return false;
    if (typeof candidate.packaged !== "boolean") return false;
    if (candidate.operationId !== null && !boundedString(candidate.operationId, 128)) return false;
    if (
        candidate.trigger !== null &&
        candidate.trigger !== "manual" &&
        candidate.trigger !== "background" &&
        candidate.trigger !== "automatic"
    ) {
        return false;
    }
    if (typeof candidate.automaticChecks !== "boolean" || typeof candidate.autoDownload !== "boolean") return false;
    if (candidate.automaticChecks === false && candidate.autoDownload === true) return false;
    if (candidate.lastCheckedAt !== undefined && !finiteNumber(candidate.lastCheckedAt, 1)) return false;
    if (candidate.nextCheckAt !== undefined && !finiteNumber(candidate.nextCheckAt, 1)) return false;
    if (!finiteNumber(candidate.checkIntervalMs, 1)) return false;
    return (candidate.operationId === null) === (candidate.trigger === null);
}

function updateStatus(value: unknown): value is UpdateStatus {
    if (!isRecord(value) || !validStatusContext(value)) return false;
    switch (value.state) {
        case "idle":
        case "checking":
            return true;
        case "development":
            return (
                value.packaged === false &&
                value.operationId === null &&
                boundedString(value.reason, 2_000)
            );
        case "current":
            return finiteNumber(value.checkedAt, 1) && boundedString(value.latest, 80);
        case "available":
            return (
                finiteNumber(value.checkedAt, 1) &&
                boundedString(value.version, 80) &&
                safeCoretexUrl(value.url) &&
                (value.name === undefined || boundedString(value.name, 240)) &&
                (value.releaseNotes === undefined || boundedString(value.releaseNotes, 2_000)) &&
                (value.canDownload === undefined || typeof value.canDownload === "boolean")
            );
        case "downloading":
            return (
                boundedString(value.version, 80) &&
                finiteNumber(value.percent) &&
                value.percent <= 100 &&
                finiteNumber(value.transferred) &&
                finiteNumber(value.total) &&
                finiteNumber(value.bytesPerSecond)
            );
        case "ready":
            return (
                boundedString(value.version, 80) &&
                (value.releaseNotes === undefined || boundedString(value.releaseNotes, 2_000))
            );
        case "error":
            return finiteNumber(value.checkedAt, 1) && boundedString(value.reason, 2_000);
        default:
            return false;
    }
}

function updatePreferences(value: unknown): value is UpdatePreferences {
    if (!isRecord(value)) return false;
    const candidate = value as Partial<UpdatePreferences>;
    return (
        validUpdateChannel(candidate.channel) &&
        typeof candidate.automaticChecks === "boolean" &&
        typeof candidate.autoDownload === "boolean" &&
        (candidate.automaticChecks || !candidate.autoDownload)
    );
}

function releaseHistory(value: unknown): value is ReleaseHistoryResult {
    if (!isRecord(value) || typeof value.ok !== "boolean") return false;
    if (!finiteNumber(value.fetchedAt, 1) || !safeCoretexUrl(value.sourceUrl)) return false;
    if (value.ok === false) return boundedString(value.reason, 2_000);
    if (!Array.isArray(value.releases) || value.releases.length > 50) return false;
    return value.releases.every((release) => {
        if (!isRecord(release)) return false;
        if (!boundedString(release.version, 80)) return false;
        const parsedVersion = parseUpdateVersion(release.version);
        if (!parsedVersion) return false;
        return (
            boundedString(release.name, 240) &&
            (release.publishedAt === null ||
                (boundedString(release.publishedAt, 64) &&
                    Number.isFinite(Date.parse(release.publishedAt)) &&
                    new Date(Date.parse(release.publishedAt)).toISOString() === release.publishedAt)) &&
            validUpdateChannel(release.channel) &&
            release.channel === parsedVersion.channel &&
            Array.isArray(release.notes) &&
            release.notes.length <= 8 &&
            release.notes.every((note) => boundedString(note, 240)) &&
            safeCoretexUrl(release.url) &&
            typeof release.current === "boolean" &&
            typeof release.prerelease === "boolean" &&
            release.prerelease === (parsedVersion.prerelease !== null)
        );
    });
}

export async function getDesktopUpdateStatus(): Promise<UpdateStatus | null> {
    const api = electronBridge();
    if (!api?.updates?.getState && !api?.invoke) return null;
    try {
        const result = api.updates?.getState ? await api.updates.getState() : await api.invoke?.("updates:get-state");
        return updateStatus(result) ? result : null;
    } catch {
        return null;
    }
}

export function subscribeToDesktopUpdateStatus(listener: (status: UpdateStatus) => void): () => void {
    const api = electronBridge();
    if (api?.updates?.onStatus) {
        const unsubscribe = api.updates.onStatus((value) => {
            if (updateStatus(value)) listener(value);
        });
        return typeof unsubscribe === "function" ? unsubscribe : () => undefined;
    }
    if (!api?.on) return () => undefined;
    const unsubscribe = api.on("updates:status", (value) => {
        if (updateStatus(value)) listener(value);
    });
    return typeof unsubscribe === "function" ? unsubscribe : () => undefined;
}

export async function getUpdatePreferences(): Promise<UpdatePreferences> {
    const fallback: UpdatePreferences = {
        channel: loadUpdateChannel(),
        automaticChecks: true,
        autoDownload: false,
    };
    const api = electronBridge();
    if (!api?.updates?.getPreferences && !api?.invoke) return fallback;
    try {
        const result = api.updates?.getPreferences
            ? await api.updates.getPreferences()
            : await api.invoke?.("updates:get-preferences");
        return updatePreferences(result) ? result : fallback;
    } catch {
        return fallback;
    }
}

export async function setUpdatePreferences(patch: Partial<UpdatePreferences>): Promise<UpdatePreferences> {
    const previous = await getUpdatePreferences();
    const fallback: UpdatePreferences = {
        channel: patch.channel ?? previous.channel,
        automaticChecks: patch.automaticChecks ?? previous.automaticChecks,
        autoDownload: patch.autoDownload ?? previous.autoDownload,
    };
    const api = electronBridge();
    if (!api?.updates?.setPreferences && !api?.invoke) {
        if (typeof window !== "undefined") {
            try {
                window.localStorage.setItem(CHANNEL_STORAGE_KEY, fallback.channel);
            } catch {
                /* ignore */
            }
        }
        return fallback;
    }
    try {
        const result = api.updates?.setPreferences
            ? await api.updates.setPreferences(patch)
            : await api.invoke?.("updates:set-preferences", patch);
        if (!updatePreferences(result)) throw new Error("The desktop updater returned invalid preferences.");
        if (typeof window !== "undefined") {
            try {
                window.localStorage.setItem(CHANNEL_STORAGE_KEY, result.channel);
            } catch {
                /* The desktop preference is authoritative. */
            }
        }
        return result;
    } catch (error) {
        throw error instanceof Error ? error : new Error("The desktop app could not save update preferences.");
    }
}

export async function getReleaseHistory(options?: {
    refresh?: boolean;
    channel?: UpdateChannel;
}): Promise<ReleaseHistoryResult> {
    const fallback: ReleaseHistoryResult = {
        ok: false,
        fetchedAt: Date.now(),
        sourceUrl: RELEASES_URL,
        reason: "Release history is only available in the desktop app.",
    };
    const api = electronBridge();
    if (!api?.updates?.getReleases && !api?.invoke) return fallback;
    try {
        const result = api.updates?.getReleases
            ? await api.updates.getReleases(options)
            : await api.invoke?.("updates:get-releases", options);
        return releaseHistory(result) ? result : { ...fallback, reason: "The desktop updater returned an unexpected release history response." };
    } catch {
        return { ...fallback, reason: "The desktop app could not load release history." };
    }
}

export async function openUpdateExternal(
    target: UpdateExternalTarget,
): Promise<{ ok: boolean; reason?: string }> {
    const api = electronBridge();
    if (!api?.updates?.openExternal && !api?.invoke) {
        return { ok: false, reason: "This resource can only be opened by the desktop app." };
    }
    try {
        const result = api.updates?.openExternal
            ? await api.updates.openExternal(target)
            : await api.invoke?.("updates:open-external", { target });
        if (result && typeof result === "object" && typeof (result as { ok?: unknown }).ok === "boolean") {
            return result as { ok: boolean; reason?: string };
        }
        return { ok: false, reason: "The desktop app returned an unexpected response." };
    } catch {
        return { ok: false, reason: "The desktop app could not open that resource." };
    }
}

export async function downloadDesktopUpdate(): Promise<UpdateStatus> {
    const checkedAt = Date.now();
    const api = electronBridge();
    if (!api?.updates?.download && !api?.invoke) return { state: "error", checkedAt, reason: "Automatic downloads are only available in the installed desktop app." };
    try {
        const result = api.updates?.download ? await api.updates.download() : await api.invoke?.("updates:download");
        if (updateStatus(result)) return result;
        return { state: "error", checkedAt, reason: "The desktop updater returned an unexpected response." };
    } catch {
        return { state: "error", checkedAt, reason: "The desktop app could not start the update download." };
    }
}

export async function installDesktopUpdate(): Promise<{ ok: boolean; reason?: string }> {
    const api = electronBridge();
    if (!api?.updates?.install && !api?.invoke) return { ok: false, reason: "No desktop update is ready to install." };
    try {
        const result = api.updates?.install ? await api.updates.install() : await api.invoke?.("updates:install");
        if (result && typeof result === "object" && "ok" in result) return result as { ok: boolean; reason?: string };
        return { ok: false, reason: "The desktop updater returned an unexpected response." };
    } catch {
        return { ok: false, reason: "The desktop app could not restart into the installer." };
    }
}

interface GhRelease {
    tag_name: string;
    name: string | null;
    html_url: string;
    prerelease: boolean;
    draft: boolean;
    published_at: string | null;
}

interface ParsedUpdateVersion {
    normalized: string;
    core: [number, number, number];
    prerelease: string[] | null;
    channel: UpdateChannel;
}

function parseUpdateVersion(input: string): ParsedUpdateVersion | null {
    const normalized = String(input).trim().replace(/^v/i, "");
    if (normalized.length === 0 || normalized.length > 80) return null;
    const match = normalized.match(
        /^(\d+)\.(\d+)\.(\d+)(?:-(?:(beta|rc)\.(\d+)|(nightly)\.(\d+(?:\.\d+)*)))?$/i,
    );
    if (!match) return null;
    const numericParts = normalized.match(/\d+/g) ?? [];
    if (numericParts.some((part) => !Number.isSafeInteger(Number(part)))) return null;
    const core: [number, number, number] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (core.some((part) => !Number.isSafeInteger(part))) return null;
    if (match[4]) {
        const identifier = match[4].toLowerCase();
        return {
            normalized,
            core,
            prerelease: [identifier, match[5]],
            channel: "beta",
        };
    }
    if (match[6]) {
        return {
            normalized,
            core,
            prerelease: ["nightly", ...match[7].split(".")],
            channel: "nightly",
        };
    }
    return { normalized, core, prerelease: null, channel: "stable" };
}

/** Parse a Git tag / version string into [major, minor, patch] or null. */
export function parseSemver(input: string): [number, number, number] | null {
    return parseUpdateVersion(input)?.core ?? null;
}

/** Compare a.b.c versions. Returns >0 if a>b, <0 if a<b, 0 if equal / unparseable. */
export function compareSemver(a: string, b: string): number {
    const parsedA = parseUpdateVersion(a);
    const parsedB = parseUpdateVersion(b);
    const pa = parsedA?.core;
    const pb = parsedB?.core;
    if (!pa || !pb) return 0;
    for (let i = 0; i < 3; i++) {
        if (pa[i] !== pb[i]) return pa[i] - pb[i];
    }

    const preA = parsedA.prerelease;
    const preB = parsedB.prerelease;
    if (!preA && !preB) return 0;
    if (!preA) return 1;
    if (!preB) return -1;
    const length = Math.max(preA.length, preB.length);
    for (let i = 0; i < length; i++) {
        const left = preA[i];
        const right = preB[i];
        if (left === undefined) return -1;
        if (right === undefined) return 1;
        if (left === right) continue;
        const leftNumber = /^\d+$/.test(left) ? Number(left) : null;
        const rightNumber = /^\d+$/.test(right) ? Number(right) : null;
        if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;
        if (leftNumber !== null) return -1;
        if (rightNumber !== null) return 1;
        return left.localeCompare(right);
    }
    return 0;
}

export function releaseMatchesChannel(channel: UpdateChannel, tag: string, prerelease: boolean): boolean {
    const parsed = parseUpdateVersion(tag);
    if (!parsed || (parsed.prerelease !== null) !== prerelease) return false;
    if (channel === "stable") return parsed.channel === "stable";
    if (channel === "beta") return parsed.channel === "stable" || parsed.channel === "beta";
    return parsed.channel === "nightly";
}

/**
 * Check GitHub Releases for a newer build on the selected channel.
 * Uses the configured release API. Handles missing repositories and empty
 * channels honestly.
 */
export async function checkForUpdates(channel: UpdateChannel): Promise<UpdateStatus> {
    const checkedAt = Date.now();
    const api = electronBridge();
    if (api?.updates?.check || api?.invoke) {
        try {
            const result = api.updates?.check
                ? await api.updates.check(channel)
                : await api.invoke?.("updates:check", { channel });
            if (updateStatus(result)) return result;
            return { state: "error", checkedAt, reason: "The desktop updater returned an unexpected response." };
        } catch {
            return {
                state: "error",
                checkedAt,
                reason: "The desktop updater could not start. Restart Coretex and try again.",
            };
        }
    }

    const [owner, repo] = UPDATE_REPO.split("/");
    if (!owner || !repo) {
        return { state: "error", checkedAt, reason: "Update repository is not configured." };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
        const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases?per_page=30`, {
            headers: {
                Accept: "application/vnd.github+json",
                "User-Agent": `Coretex/${CORETEX_VERSION}`,
            },
            signal: controller.signal,
        });

        if (res.status === 404) {
            return {
                state: "error",
                checkedAt,
                reason: `No releases found for ${UPDATE_REPO}. Publish a GitHub Release to enable update checks.`,
            };
        }
        if (res.status === 403) {
            return {
                state: "error",
                checkedAt,
                reason: "GitHub rate limit reached. Try again in a few minutes, or open releases on GitHub.",
            };
        }
        if (!res.ok) {
            return {
                state: "error",
                checkedAt,
                reason: `GitHub returned ${res.status}. Open releases on GitHub to check manually.`,
            };
        }

        const responseText = await res.text();
        if (responseText.length > 1024 * 1024) {
            return { state: "error", checkedAt, reason: "The release history response was too large." };
        }
        const data = JSON.parse(responseText) as unknown;
        if (!Array.isArray(data)) {
            return { state: "error", checkedAt, reason: "Unexpected response from GitHub Releases." };
        }

        const onChannel = data
            .slice(0, 30)
            .filter((value): value is GhRelease => {
                if (!isRecord(value)) return false;
                return (
                    value.draft === false &&
                    typeof value.prerelease === "boolean" &&
                    boundedString(value.tag_name, 90) &&
                    releaseMatchesChannel(channel, value.tag_name, value.prerelease) &&
                    (value.name === null || boundedString(value.name, 240)) &&
                    safeCoretexUrl(value.html_url)
                );
            })
            .sort((left, right) => compareSemver(right.tag_name, left.tag_name));

        if (onChannel.length === 0) {
            return {
                state: "error",
                checkedAt,
                reason: `No ${channelLabel(channel).toLowerCase()} releases published yet. Check GitHub or try another channel.`,
            };
        }

        // Publication dates can be reordered; select the greatest valid SemVer.
        const latest = onChannel[0];
        const latestVer = parseUpdateVersion(latest.tag_name)?.normalized;
        if (!latestVer) {
            return { state: "error", checkedAt, reason: "The release source returned an invalid version." };
        }
        const newer = compareSemver(latestVer, CORETEX_VERSION) > 0;

        if (newer) {
            return {
                state: "available",
                checkedAt,
                version: latestVer,
                url: latest.html_url,
                name: latest.name ?? undefined,
            };
        }

        return { state: "current", checkedAt, latest: latestVer };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/abort|timeout/i.test(msg)) {
            return { state: "error", checkedAt, reason: "Timed out reaching GitHub. Check your connection and try again." };
        }
        return {
            state: "error",
            checkedAt,
            reason: "Couldn't reach GitHub Releases. Check your connection, then try again.",
        };
    } finally {
        clearTimeout(timer);
    }
}
