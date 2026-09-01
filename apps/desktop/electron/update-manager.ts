import { app, BrowserWindow, ipcMain, net, shell } from "electron";
import electronUpdater, { type ProgressInfo, type UpdateInfo } from "electron-updater";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
    defaultUpdateChannelForVersion,
    normalizeUpdateChannel,
    parseReleaseHistoryOptions,
    parseUpdateCheckChannel,
    parseUpdatePreferencePatch,
    providerUpdateChannel,
    releaseChannelFromVersion,
    releaseMatchesUpdateStream,
    sanitizeReleaseNotes,
    UPDATE_IPC,
    type DesktopReleaseHistoryItem,
    type DesktopReleaseHistoryResult,
    type DesktopUpdateChannel,
    type DesktopUpdateExternalTarget,
    type DesktopUpdatePreferencePatch,
    type DesktopUpdatePreferences,
    type DesktopUpdateStatus,
    type DesktopUpdateTrigger,
} from "./update-contract";

export type {
    DesktopReleaseHistoryItem,
    DesktopReleaseHistoryResult,
    DesktopUpdateChannel,
    DesktopUpdateExternalTarget,
    DesktopUpdatePreferences,
    DesktopUpdateStatus,
    DesktopUpdateTrigger,
} from "./update-contract";

const { autoUpdater } = electronUpdater;

export interface DesktopUpdater {
    getStatus: () => DesktopUpdateStatus;
    getPreferences: () => DesktopUpdatePreferences;
    startBackgroundChecks: () => void;
    stop: () => void;
}

interface DesktopUpdaterOptions {
    beforeInstall: () => void;
    isTrustedRendererUrl: (url: string) => boolean;
}

interface UpdateOperation {
    id: string;
    kind: "check" | "download";
    channel: DesktopUpdateChannel;
    trigger: DesktopUpdateTrigger;
}

interface AvailableUpdate {
    info: UpdateInfo;
    channel: DesktopUpdateChannel;
    operationId: string;
    trigger: DesktopUpdateTrigger;
}

interface GithubRelease {
    tag_name?: unknown;
    name?: unknown;
    body?: unknown;
    html_url?: unknown;
    published_at?: unknown;
    prerelease?: unknown;
    draft?: unknown;
}

const REPOSITORY_URL = "https://github.com/MDCran/coretex";
const RELEASES_URL = `${REPOSITORY_URL}/releases`;
const CHANGELOG_URL = `${REPOSITORY_URL}/blob/main/CHANGELOG.md`;
const RELEASES_API_URL = "https://api.github.com/repos/MDCran/coretex/releases?per_page=50";
const BACKGROUND_CHECK_DELAY_MS = 15_000;
const BACKGROUND_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1_000;
const RELEASE_CACHE_MS = 5 * 60 * 1_000;
const RELEASE_REQUEST_TIMEOUT_MS = 12_000;
const MAX_RELEASE_RESPONSE_LENGTH = 2 * 1024 * 1024;
const DEVELOPMENT_REASON =
    "This is the live development app. Vite applies code changes automatically; packaged installer updates are only checked, downloaded, and installed by a packaged build.";
const DEFAULT_PREFERENCES: DesktopUpdatePreferences = {
    channel: "stable",
    automaticChecks: true,
    autoDownload: false,
};

function readSavedPreferences(file: string, installedVersion: string): DesktopUpdatePreferences {
    try {
        const parsed = JSON.parse(readFileSync(file, "utf8")) as {
            channel?: unknown;
            automaticChecks?: unknown;
            autoDownload?: unknown;
        };
        const automaticChecks =
            typeof parsed.automaticChecks === "boolean" ? parsed.automaticChecks : DEFAULT_PREFERENCES.automaticChecks;
        const channel =
            parsed.channel === "stable" || parsed.channel === "beta" || parsed.channel === "nightly"
                ? parsed.channel
                : parsed.channel === "release-candidate" || parsed.channel === "rc"
                  ? "beta"
                  : defaultUpdateChannelForVersion(installedVersion);
        return {
            channel,
            automaticChecks,
            autoDownload:
                automaticChecks && typeof parsed.autoDownload === "boolean"
                    ? parsed.autoDownload
                    : DEFAULT_PREFERENCES.autoDownload,
        };
    } catch {
        return { ...DEFAULT_PREFERENCES, channel: defaultUpdateChannelForVersion(installedVersion) };
    }
}

function readSavedLastCheckedAt(file: string): number | undefined {
    try {
        const value = (JSON.parse(readFileSync(file, "utf8")) as { lastCheckedAt?: unknown }).lastCheckedAt;
        return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
    } catch {
        return undefined;
    }
}

function releaseUrl(version?: string): string {
    return version ? `${RELEASES_URL}/tag/v${encodeURIComponent(version)}` : RELEASES_URL;
}

function releaseNotes(value: UpdateInfo["releaseNotes"]): string | undefined {
    const raw =
        typeof value === "string"
            ? value
            : Array.isArray(value)
              ? value.map((entry) => (entry && typeof entry.note === "string" ? entry.note : "")).join("\n")
              : "";
    const notes = sanitizeReleaseNotes(raw);
    return notes.length > 0 ? notes.join("\n") : undefined;
}

function boundedReleaseName(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const note = sanitizeReleaseNotes(`- ${value}`)[0];
    if (!note) return undefined;
    return note.length > 160 ? `${note.slice(0, 157).trimEnd()}...` : note;
}

function normalizedPublishedAt(value: unknown): string | null {
    if (typeof value !== "string" || value.length > 64) return null;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function safeRepositoryUrl(value: unknown): string | null {
    if (typeof value !== "string" || value.length > 2_048) return null;
    try {
        const url = new URL(value);
        const repositoryPath = "/MDCran/coretex".toLowerCase();
        const path = url.pathname.toLowerCase();
        if (
            url.protocol !== "https:" ||
            url.hostname.toLowerCase() !== "github.com" ||
            (path !== repositoryPath && !path.startsWith(`${repositoryPath}/`))
        ) {
            return null;
        }
        return url.toString();
    } catch {
        return null;
    }
}

function readableUpdaterError(error: unknown, channel: DesktopUpdateChannel): string {
    const raw = error instanceof Error ? error.message : String(error);
    if (/404|\.yml|channel file|cannot find/i.test(raw)) {
        return `No ${providerUpdateChannel(channel)} update metadata was found. Publish the installer, blockmap, and ${providerUpdateChannel(channel)}.yml in the matching release, then try again.`;
    }
    if (/net::|ENOTFOUND|ECONN|network|timed?\s*out|ERR_INTERNET/i.test(raw)) {
        return "Coretex could not reach the update service. Check your connection and try again.";
    }
    if (/signature|code signing|sha512|checksum/i.test(raw)) {
        return "The downloaded update could not be verified and was not installed.";
    }
    return "The update could not be completed. Try again, or review the release history for a manual installer.";
}

function versionFromTag(tag: string): string {
    return tag.trim().replace(/^v/i, "");
}

function releaseMatchesStream(item: DesktopReleaseHistoryItem, channel: DesktopUpdateChannel): boolean {
    return releaseMatchesUpdateStream(item.channel, channel);
}

function releaseHistoryError(error: unknown): string {
    const raw = error instanceof Error ? error.message : String(error);
    if (/abort/i.test(raw)) return "The release history request timed out. Try again.";
    if (/403|rate limit/i.test(raw)) return "The release service rate limit was reached. Try again in a few minutes.";
    if (/404/i.test(raw)) return "No release history is available from the configured source.";
    if (/ENOTFOUND|ECONN|network|net::|internet/i.test(raw)) {
        return "Coretex could not reach the release service. Check your connection and try again.";
    }
    return "Coretex could not load release history. Try again later.";
}

function isUpdaterCancellation(error: unknown): boolean {
    return (
        error instanceof Error &&
        (error.name === "CancellationError" || /\bcancel(?:l)?ed\b/i.test(error.message))
    );
}

export function createDesktopUpdater({ beforeInstall, isTrustedRendererUrl }: DesktopUpdaterOptions): DesktopUpdater {
    const currentVersion = app.getVersion();
    const preferenceFile = join(app.getPath("userData"), "update-preferences.json");
    let preferences = readSavedPreferences(preferenceFile, currentVersion);
    let lastCheckedAt = readSavedLastCheckedAt(preferenceFile);
    let nextCheckAt: number | undefined;
    let activeCheck: UpdateOperation | null = null;
    let activeDownload: UpdateOperation | null = null;
    let availableUpdate: AvailableUpdate | null = null;
    let checkPromise: Promise<DesktopUpdateStatus> | null = null;
    let downloadPromise: Promise<DesktopUpdateStatus> | null = null;
    let backgroundTimer: NodeJS.Timeout | null = null;
    let releaseCache: { fetchedAt: number; releases: DesktopReleaseHistoryItem[] } | null = null;

    const context = (
        channel = preferences.channel,
        operation: Pick<UpdateOperation, "id" | "trigger"> | null = null,
    ) => ({
        currentVersion,
        channel,
        native: true as const,
        packaged: app.isPackaged,
        operationId: operation?.id ?? null,
        trigger: operation?.trigger ?? null,
        automaticChecks: preferences.automaticChecks,
        autoDownload: preferences.autoDownload,
        ...(lastCheckedAt === undefined ? {} : { lastCheckedAt }),
        ...(nextCheckAt === undefined ? {} : { nextCheckAt }),
        checkIntervalMs: BACKGROUND_CHECK_INTERVAL_MS,
    });

    let status: DesktopUpdateStatus = app.isPackaged
        ? { state: "idle", ...context() }
        : { state: "development", reason: DEVELOPMENT_REASON, ...context() };

    // Downloads are orchestrated here so automatic and manual downloads share
    // the same operation IDs, state transitions, and error handling.
    autoUpdater.autoDownload = false;
    // Installing always requires the explicit Restart and install action.
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.fullChangelog = false;

    const publish = (next: DesktopUpdateStatus): DesktopUpdateStatus => {
        status = next;
        for (const window of BrowserWindow.getAllWindows()) {
            if (!window.isDestroyed() && isTrustedRendererUrl(window.webContents.getURL())) {
                window.webContents.send(UPDATE_IPC.status, status);
            }
        }
        return status;
    };

    const requireTrustedSender = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): void => {
        const senderUrl = event.senderFrame?.url ?? event.sender.getURL();
        if (!isTrustedRendererUrl(senderUrl)) throw new Error("Updater IPC rejected an untrusted renderer.");
    };

    const republishContext = (): DesktopUpdateStatus =>
        publish({
            ...status,
            ...context(
                status.channel,
                status.operationId ? { id: status.operationId, trigger: status.trigger ?? "manual" } : null,
            ),
        } as DesktopUpdateStatus);

    const persistPreferences = (
        next: DesktopUpdatePreferences = preferences,
        strict = false,
    ): void => {
        try {
            mkdirSync(app.getPath("userData"), { recursive: true });
            writeFileSync(preferenceFile, `${JSON.stringify({ ...next, lastCheckedAt }, null, 2)}\n`, "utf8");
        } catch (error) {
            console.warn("[updater] could not persist update preferences", error);
            if (strict) throw new Error("Coretex could not save update preferences.");
        }
    };

    const configureProvider = (channel: DesktopUpdateChannel): void => {
        autoUpdater.channel = providerUpdateChannel(channel);
        autoUpdater.allowPrerelease = channel !== "stable";
        // Setting a channel enables downgrades internally. A stream change must
        // never replace an installed build with an older version.
        autoUpdater.allowDowngrade = false;
    };

    configureProvider(preferences.channel);

    const clearBackgroundTimer = (): void => {
        if (backgroundTimer) clearTimeout(backgroundTimer);
        backgroundTimer = null;
        nextCheckAt = undefined;
    };

    const nextBackgroundDelay = (): number => {
        if (lastCheckedAt === undefined) return BACKGROUND_CHECK_DELAY_MS;
        const remaining = BACKGROUND_CHECK_INTERVAL_MS - Math.max(0, Date.now() - lastCheckedAt);
        return Math.max(BACKGROUND_CHECK_DELAY_MS, remaining);
    };

    let check: (channel: DesktopUpdateChannel, trigger?: DesktopUpdateTrigger) => Promise<DesktopUpdateStatus>;

    const scheduleBackgroundCheck = (delayMs: number): void => {
        clearBackgroundTimer();
        if (!app.isPackaged || !preferences.automaticChecks) {
            republishContext();
            return;
        }
        nextCheckAt = Date.now() + delayMs;
        backgroundTimer = setTimeout(() => {
            backgroundTimer = null;
            nextCheckAt = undefined;
            republishContext();
            void (async () => {
                if (status.state !== "downloading" && status.state !== "ready") {
                    await check(preferences.channel, "background");
                }
                if (preferences.automaticChecks && status.state !== "ready") {
                    scheduleBackgroundCheck(BACKGROUND_CHECK_INTERVAL_MS);
                }
            })();
        }, delayMs);
        backgroundTimer.unref();
        republishContext();
    };

    const applyPreferences = (patch: DesktopUpdatePreferencePatch): DesktopUpdatePreferences => {
        const previous = preferences;
        let automaticChecks = patch.automaticChecks ?? previous.automaticChecks;
        let autoDownload = patch.autoDownload ?? previous.autoDownload;
        if (patch.autoDownload === true) automaticChecks = true;
        if (!automaticChecks) autoDownload = false;
        const next: DesktopUpdatePreferences = {
            channel: patch.channel ?? previous.channel,
            automaticChecks,
            autoDownload,
        };
        const channelChanged = next.channel !== previous.channel;
        if (
            channelChanged &&
            (activeCheck || activeDownload || status.state === "checking" || status.state === "downloading" || status.state === "ready")
        ) {
            throw new Error("Wait for the current update operation to finish before changing streams.");
        }
        // Persist first so a failed write cannot leave runtime and UI state ahead
        // of what will be restored on the next launch.
        persistPreferences(next, true);
        preferences = next;

        if (channelChanged) {
            configureProvider(preferences.channel);
            availableUpdate = null;
            publish(
                app.isPackaged
                    ? { state: "idle", ...context() }
                    : { state: "development", reason: DEVELOPMENT_REASON, ...context() },
            );
        } else {
            republishContext();
        }

        if (channelChanged && preferences.automaticChecks) {
            scheduleBackgroundCheck(BACKGROUND_CHECK_DELAY_MS);
        } else if (preferences.automaticChecks !== previous.automaticChecks) {
            if (preferences.automaticChecks) scheduleBackgroundCheck(nextBackgroundDelay());
            else {
                clearBackgroundTimer();
                republishContext();
            }
        }

        if (preferences.autoDownload && !previous.autoDownload && status.state === "available") {
            void download("automatic");
        }
        return { ...preferences };
    };

    const eventOperation = (): UpdateOperation | null => activeDownload ?? activeCheck;

    const rejectMismatchedCandidate = (operation: UpdateOperation, info: UpdateInfo): boolean => {
        const actualChannel = releaseChannelFromVersion(info.version, info.version.includes("-"));
        if (actualChannel && releaseMatchesUpdateStream(actualChannel, operation.channel)) return false;
        availableUpdate = null;
        const checkedAt = Date.now();
        lastCheckedAt = checkedAt;
        persistPreferences();
        const safeVersion = String(info.version || "unknown").slice(0, 80);
        publish({
            state: "error",
            ...context(operation.channel, operation),
            checkedAt,
            reason: `The ${operation.channel} stream returned incompatible metadata for v${safeVersion}. No update was downloaded.`,
        });
        if (preferences.automaticChecks && operation.trigger === "manual") {
            scheduleBackgroundCheck(BACKGROUND_CHECK_INTERVAL_MS);
        }
        return true;
    };

    autoUpdater.on("checking-for-update", () => {
        const operation = activeCheck;
        if (operation) publish({ state: "checking", ...context(operation.channel, operation) });
    });

    autoUpdater.on("update-available", (info) => {
        const operation = activeCheck;
        if (!operation) return;
        if (rejectMismatchedCandidate(operation, info)) return;
        availableUpdate = {
            info,
            channel: operation.channel,
            operationId: operation.id,
            trigger: operation.trigger,
        };
        const checkedAt = Date.now();
        lastCheckedAt = checkedAt;
        persistPreferences();
        publish({
            state: "available",
            ...context(operation.channel, operation),
            canDownload: true,
            checkedAt,
            version: info.version,
            url: releaseUrl(info.version),
            name: boundedReleaseName(info.releaseName),
            releaseNotes: releaseNotes(info.releaseNotes),
        });
        if (preferences.automaticChecks && operation.trigger === "manual") {
            scheduleBackgroundCheck(BACKGROUND_CHECK_INTERVAL_MS);
        }
    });

    autoUpdater.on("update-not-available", (info) => {
        const operation = activeCheck;
        if (!operation) return;
        if (rejectMismatchedCandidate(operation, info)) return;
        availableUpdate = null;
        const checkedAt = Date.now();
        lastCheckedAt = checkedAt;
        persistPreferences();
        publish({
            state: "current",
            ...context(operation.channel, operation),
            checkedAt,
            latest: info.version || currentVersion,
        });
        if (preferences.automaticChecks && operation.trigger === "manual") {
            scheduleBackgroundCheck(BACKGROUND_CHECK_INTERVAL_MS);
        }
    });

    autoUpdater.on("download-progress", (progress: ProgressInfo) => {
        const operation = activeDownload;
        if (!operation) return;
        publish({
            state: "downloading",
            ...context(operation.channel, operation),
            version: availableUpdate?.info.version ?? currentVersion,
            percent: Math.max(0, Math.min(100, Number.isFinite(progress.percent) ? progress.percent : 0)),
            transferred: Math.max(0, Number.isFinite(progress.transferred) ? progress.transferred : 0),
            total: Math.max(0, Number.isFinite(progress.total) ? progress.total : 0),
            bytesPerSecond: Math.max(0, Number.isFinite(progress.bytesPerSecond) ? progress.bytesPerSecond : 0),
        });
    });

    autoUpdater.on("update-downloaded", (info) => {
        const operation = activeDownload;
        if (!operation) return;
        clearBackgroundTimer();
        publish({
            state: "ready",
            ...context(operation.channel, operation),
            version: availableUpdate?.info.version ?? currentVersion,
            releaseNotes: releaseNotes(info.releaseNotes),
        });
    });

    autoUpdater.on("update-cancelled", (info) => {
        const operation = activeDownload;
        if (!operation) return;
        publish({
            state: "available",
            ...context(operation.channel, operation),
            canDownload: true,
            checkedAt: lastCheckedAt ?? Date.now(),
            version: availableUpdate?.info.version ?? currentVersion,
            url: releaseUrl(availableUpdate?.info.version),
            name: boundedReleaseName(availableUpdate?.info.releaseName),
            releaseNotes: releaseNotes(info.releaseNotes),
        });
    });

    autoUpdater.on("error", (error) => {
        const operation = eventOperation();
        if (isUpdaterCancellation(error) && (operation?.kind === "download" || status.state === "available")) {
            if (availableUpdate && status.state !== "available" && operation) {
                publish({
                    state: "available",
                    ...context(operation.channel, operation),
                    canDownload: true,
                    checkedAt: lastCheckedAt ?? Date.now(),
                    version: availableUpdate.info.version,
                    url: releaseUrl(availableUpdate.info.version),
                    name: boundedReleaseName(availableUpdate.info.releaseName),
                    releaseNotes: releaseNotes(availableUpdate.info.releaseNotes),
                });
            }
            return;
        }
        const failedChannel = operation?.channel ?? preferences.channel;
        const checkedAt = Date.now();
        if (operation?.kind === "check") {
            lastCheckedAt = checkedAt;
            persistPreferences();
        }
        publish({
            state: "error",
            ...context(failedChannel, operation),
            checkedAt,
            reason: readableUpdaterError(error, failedChannel),
        });
        if (preferences.automaticChecks && operation?.kind === "check" && operation.trigger === "manual") {
            scheduleBackgroundCheck(BACKGROUND_CHECK_INTERVAL_MS);
        }
    });

    check = async (
        requestedChannel: DesktopUpdateChannel,
        trigger: DesktopUpdateTrigger = "manual",
    ): Promise<DesktopUpdateStatus> => {
        if (status.state === "downloading" || status.state === "ready") return status;
        if (checkPromise) {
            if (activeCheck?.channel === requestedChannel) return checkPromise;
            const pending = checkPromise;
            return pending.then(() => check(requestedChannel, trigger));
        }
        if (requestedChannel !== preferences.channel) applyPreferences({ channel: requestedChannel });
        if (!app.isPackaged) {
            return publish({ state: "development", reason: DEVELOPMENT_REASON, ...context(requestedChannel) });
        }

        const operation: UpdateOperation = {
            id: randomUUID(),
            kind: "check",
            channel: requestedChannel,
            trigger,
        };
        activeCheck = operation;
        configureProvider(requestedChannel);
        publish({ state: "checking", ...context(requestedChannel, operation) });

        checkPromise = (async () => {
            let failed = false;
            try {
                await autoUpdater.checkForUpdates();
            } catch (error) {
                failed = true;
                const currentStatus = status as DesktopUpdateStatus;
                if (currentStatus.state !== "error" || currentStatus.operationId !== operation.id) {
                    const checkedAt = Date.now();
                    lastCheckedAt = checkedAt;
                    persistPreferences();
                    publish({
                        state: "error",
                        ...context(requestedChannel, operation),
                        checkedAt,
                        reason: readableUpdaterError(error, requestedChannel),
                    });
                    if (preferences.automaticChecks && operation.trigger === "manual") {
                        scheduleBackgroundCheck(BACKGROUND_CHECK_INTERVAL_MS);
                    }
                }
            } finally {
                activeCheck = null;
                checkPromise = null;
            }
            if (
                !failed &&
                preferences.autoDownload &&
                preferences.channel === requestedChannel &&
                status.state === "available" &&
                status.channel === requestedChannel
            ) {
                // download() publishes its initial state synchronously before the
                // returned promise yields, so this check resolves to the newest
                // correlated status instead of overwriting it with "available".
                void download("automatic");
            }
            return status;
        })();
        return checkPromise;
    };

    async function download(trigger: DesktopUpdateTrigger = "manual"): Promise<DesktopUpdateStatus> {
        if (!app.isPackaged) {
            return publish({ state: "development", reason: DEVELOPMENT_REASON, ...context() });
        }
        if (status.state === "ready" || status.state === "downloading") return status;
        if (!availableUpdate || status.state !== "available") {
            return publish({
                state: "error",
                ...context(),
                checkedAt: Date.now(),
                reason: "Check for an update before downloading it.",
            });
        }
        if (downloadPromise) return downloadPromise;

        const operation: UpdateOperation = {
            id: randomUUID(),
            kind: "download",
            channel: availableUpdate.channel,
            trigger,
        };
        activeDownload = operation;
        publish({
            state: "downloading",
            ...context(operation.channel, operation),
            version: availableUpdate.info.version,
            percent: 0,
            transferred: 0,
            total: 0,
            bytesPerSecond: 0,
        });

        downloadPromise = (async () => {
            try {
                await autoUpdater.downloadUpdate();
                return status;
            } catch (error) {
                if (isUpdaterCancellation(error)) {
                    const cancelledStatus = status as DesktopUpdateStatus;
                    if (cancelledStatus.state === "available") return cancelledStatus;
                    return publish({
                        state: "available",
                        ...context(operation.channel, operation),
                        canDownload: true,
                        checkedAt: lastCheckedAt ?? Date.now(),
                        version: availableUpdate.info.version,
                        url: releaseUrl(availableUpdate.info.version),
                        name: boundedReleaseName(availableUpdate.info.releaseName),
                        releaseNotes: releaseNotes(availableUpdate.info.releaseNotes),
                    });
                }
                const currentStatus = status as DesktopUpdateStatus;
                if (currentStatus.state === "error" && currentStatus.operationId === operation.id) return currentStatus;
                return publish({
                    state: "error",
                    ...context(operation.channel, operation),
                    checkedAt: Date.now(),
                    reason: readableUpdaterError(error, operation.channel),
                });
            } finally {
                activeDownload = null;
                downloadPromise = null;
            }
        })();
        return downloadPromise;
    }

    const getReleaseHistory = async (payload?: {
        refresh?: boolean;
        channel?: DesktopUpdateChannel;
    }): Promise<DesktopReleaseHistoryResult> => {
        const fetchedAt = Date.now();
        try {
            let releases: DesktopReleaseHistoryItem[];
            if (!payload?.refresh && releaseCache && fetchedAt - releaseCache.fetchedAt < RELEASE_CACHE_MS) {
                releases = releaseCache.releases;
            } else {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), RELEASE_REQUEST_TIMEOUT_MS);
                timeout.unref();
                try {
                    const response = await net.fetch(RELEASES_API_URL, {
                        headers: {
                            Accept: "application/vnd.github+json",
                            "User-Agent": `Coretex/${currentVersion}`,
                            "X-GitHub-Api-Version": "2022-11-28",
                        },
                        signal: controller.signal,
                    });
                    if (!response.ok) throw new Error(`Release history request failed with ${response.status}.`);
                    const declaredLength = Number(response.headers.get("content-length"));
                    if (Number.isFinite(declaredLength) && declaredLength > MAX_RELEASE_RESPONSE_LENGTH) {
                        throw new Error("Release history response was too large.");
                    }
                    const rawBody = await response.text();
                    if (rawBody.length > MAX_RELEASE_RESPONSE_LENGTH) {
                        throw new Error("Release history response was too large.");
                    }
                    const body = JSON.parse(rawBody) as unknown;
                    if (!Array.isArray(body)) throw new Error("Release history response was not an array.");
                    releases = body.slice(0, 50).flatMap((raw): DesktopReleaseHistoryItem[] => {
                        const item = raw as GithubRelease;
                        if (
                            item.draft !== false ||
                            typeof item.prerelease !== "boolean" ||
                            typeof item.tag_name !== "string" ||
                            item.tag_name.length > 90
                        ) {
                            return [];
                        }
                        const version = versionFromTag(item.tag_name);
                        const prerelease = item.prerelease;
                        const releaseChannel = releaseChannelFromVersion(version, prerelease);
                        const url = safeRepositoryUrl(item.html_url);
                        if (!releaseChannel || !url) return [];
                        return [
                            {
                                version,
                                name: boundedReleaseName(item.name) ?? `Coretex ${version}`,
                                publishedAt: normalizedPublishedAt(item.published_at),
                                channel: releaseChannel,
                                notes: sanitizeReleaseNotes(item.body),
                                url,
                                current: version === currentVersion,
                                prerelease,
                            },
                        ];
                    });
                    releaseCache = { fetchedAt, releases };
                } finally {
                    clearTimeout(timeout);
                }
            }

            const channel = payload?.channel ?? null;
            return {
                ok: true,
                fetchedAt: releaseCache?.fetchedAt ?? fetchedAt,
                sourceUrl: RELEASES_URL,
                releases: channel ? releases.filter((item) => releaseMatchesStream(item, channel)) : releases,
            };
        } catch (error) {
            return { ok: false, fetchedAt, sourceUrl: RELEASES_URL, reason: releaseHistoryError(error) };
        }
    };

    const openExternal = async (
        target: DesktopUpdateExternalTarget,
    ): Promise<{ ok: true } | { ok: false; reason: string }> => {
        if (target === "third-party-notices") {
            const noticePath = app.isPackaged
                ? join(process.resourcesPath, "THIRD-PARTY-NOTICES.md")
                : resolve(app.getAppPath(), "..", "..", "THIRD-PARTY-NOTICES.md");
            if (!existsSync(noticePath)) return { ok: false, reason: "Third-party notices were not included in this build." };
            const error = await shell.openPath(noticePath);
            return error ? { ok: false, reason: error } : { ok: true };
        }

        const fixedTargets: Record<Exclude<DesktopUpdateExternalTarget, "third-party-notices">, string> = {
            releases: RELEASES_URL,
            source: REPOSITORY_URL,
            changelog: CHANGELOG_URL,
        };
        const url = fixedTargets[target];
        if (!url) return { ok: false, reason: "That update resource is not available." };
        const parsed = new URL(url);
        if (parsed.protocol !== "https:" || parsed.hostname !== "github.com" || !parsed.pathname.startsWith("/MDCran/coretex")) {
            return { ok: false, reason: "That update resource is not allowlisted." };
        }
        await shell.openExternal(parsed.toString());
        return { ok: true };
    };

    ipcMain.handle(UPDATE_IPC.getState, (event) => {
        requireTrustedSender(event);
        return status;
    });
    ipcMain.handle(UPDATE_IPC.getPreferences, (event) => {
        requireTrustedSender(event);
        return { ...preferences };
    });
    ipcMain.handle(UPDATE_IPC.setPreferences, (event, payload?: unknown) => {
        requireTrustedSender(event);
        return applyPreferences(parseUpdatePreferencePatch(payload));
    });
    ipcMain.handle(UPDATE_IPC.check, (event, payload?: unknown) => {
        requireTrustedSender(event);
        return check(parseUpdateCheckChannel(payload) ?? preferences.channel);
    });
    ipcMain.handle(UPDATE_IPC.download, (event) => {
        requireTrustedSender(event);
        return download();
    });
    ipcMain.handle(UPDATE_IPC.getReleases, (event, payload?: unknown) => {
        requireTrustedSender(event);
        return getReleaseHistory(parseReleaseHistoryOptions(payload));
    });
    ipcMain.handle(UPDATE_IPC.openExternal, (event, payload?: unknown) => {
        requireTrustedSender(event);
        const target = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as { target?: unknown }).target : undefined;
        if (target !== "releases" && target !== "source" && target !== "changelog" && target !== "third-party-notices") {
            return { ok: false, reason: "That update resource is not available." };
        }
        return openExternal(target);
    });
    // Compatibility for renderers from the previous channel-only contract.
    ipcMain.on(UPDATE_IPC.setLegacyChannel, (event, payload?: unknown) => {
        try {
            requireTrustedSender(event);
        } catch {
            return;
        }
        if (!payload || typeof payload !== "object" || Array.isArray(payload) || !("channel" in payload)) return;
        const raw = (payload as { channel?: unknown }).channel;
        if (raw !== "stable" && raw !== "beta" && raw !== "nightly" && raw !== "release-candidate" && raw !== "rc") {
            return;
        }
        try {
            applyPreferences({ channel: normalizeUpdateChannel(raw) });
        } catch (error) {
            console.warn("[updater] ignored a legacy channel change while an update operation was active", error);
        }
    });
    ipcMain.handle(UPDATE_IPC.install, (event) => {
        requireTrustedSender(event);
        if (!app.isPackaged) return { ok: false, reason: "Installer updates are disabled in the live development app." };
        if (status.state !== "ready") return { ok: false, reason: "No downloaded update is ready." };
        beforeInstall();
        autoUpdater.quitAndInstall(false, true);
        return { ok: true };
    });

    const startBackgroundChecks = (): void => {
        if (!app.isPackaged || !preferences.automaticChecks || backgroundTimer) return;
        // Reconcile electron-updater's cached candidate on every launch. An
        // available or downloaded update is otherwise memory-only here, and a
        // recent persisted lastCheckedAt could hide it until the four-hour tick.
        scheduleBackgroundCheck(BACKGROUND_CHECK_DELAY_MS);
    };

    const stop = (): void => {
        clearBackgroundTimer();
    };

    return {
        getStatus: () => status,
        getPreferences: () => ({ ...preferences }),
        startBackgroundChecks,
        stop,
    };
}
