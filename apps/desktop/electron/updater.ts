import { app, BrowserWindow, ipcMain } from "electron";
import electronUpdater, { type ProgressInfo, type UpdateInfo } from "electron-updater";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { autoUpdater } = electronUpdater;

export type DesktopUpdateChannel = "stable" | "beta" | "release-candidate";

export type DesktopUpdateStatus =
    | { state: "idle"; currentVersion: string; channel: DesktopUpdateChannel; native: true }
    | {
          state: "development";
          currentVersion: string;
          channel: DesktopUpdateChannel;
          native: true;
          reason: string;
      }
    | { state: "checking"; currentVersion: string; channel: DesktopUpdateChannel; native: true }
    | {
          state: "current";
          currentVersion: string;
          channel: DesktopUpdateChannel;
          native: true;
          checkedAt: number;
          latest: string;
      }
    | {
          state: "available";
          currentVersion: string;
          channel: DesktopUpdateChannel;
          native: true;
          canDownload: true;
          checkedAt: number;
          version: string;
          url: string;
          name?: string;
          releaseNotes?: string;
      }
    | {
          state: "downloading";
          currentVersion: string;
          channel: DesktopUpdateChannel;
          native: true;
          version: string;
          percent: number;
          transferred: number;
          total: number;
          bytesPerSecond: number;
      }
    | {
          state: "ready";
          currentVersion: string;
          channel: DesktopUpdateChannel;
          native: true;
          version: string;
          releaseNotes?: string;
      }
    | {
          state: "error";
          currentVersion: string;
          channel: DesktopUpdateChannel;
          native: true;
          checkedAt: number;
          reason: string;
      };

export interface DesktopUpdater {
    getStatus: () => DesktopUpdateStatus;
    startBackgroundChecks: () => void;
    stop: () => void;
}

interface DesktopUpdaterOptions {
    beforeInstall: () => void;
}

const RELEASES_URL = "https://github.com/MDCran/coretex/releases";
const BACKGROUND_CHECK_DELAY_MS = 15_000;
const BACKGROUND_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1_000;

function validChannel(value: unknown): DesktopUpdateChannel {
    return value === "beta" || value === "release-candidate" ? value : "stable";
}

function readSavedChannel(file: string): DesktopUpdateChannel {
    try {
        const parsed = JSON.parse(readFileSync(file, "utf8")) as { channel?: unknown };
        return validChannel(parsed.channel);
    } catch {
        return "stable";
    }
}

function providerChannel(channel: DesktopUpdateChannel): string {
    if (channel === "release-candidate") return "rc";
    if (channel === "beta") return "beta";
    return "latest";
}

function releaseUrl(version?: string): string {
    return version ? `${RELEASES_URL}/tag/v${version}` : RELEASES_URL;
}

function releaseNotes(value: UpdateInfo["releaseNotes"]): string | undefined {
    if (typeof value === "string") return value;
    if (!Array.isArray(value)) return undefined;
    const notes = value
        .map((entry) => (entry && typeof entry.note === "string" ? entry.note.trim() : ""))
        .filter(Boolean);
    return notes.length > 0 ? notes.join("\n\n") : undefined;
}

function readableUpdaterError(error: unknown): string {
    const raw = error instanceof Error ? error.message : String(error);
    if (/404|latest\.yml|cannot find latest/i.test(raw)) {
        return "No published Windows update was found. Publish the installer and latest.yml in a GitHub Release, then try again.";
    }
    if (/net::|ENOTFOUND|ECONN|network|timed?\s*out/i.test(raw)) {
        return "Coretex could not reach GitHub Releases. Check your connection and try again.";
    }
    return raw || "The update could not be completed.";
}

export function createDesktopUpdater({ beforeInstall }: DesktopUpdaterOptions): DesktopUpdater {
    const currentVersion = app.getVersion();
    const preferenceFile = join(app.getPath("userData"), "update-preferences.json");
    let channel: DesktopUpdateChannel = readSavedChannel(preferenceFile);
    let status: DesktopUpdateStatus = app.isPackaged
        ? { state: "idle", currentVersion, channel, native: true }
        : {
              state: "development",
              currentVersion,
              channel,
              native: true,
              reason: "This is the live development app. Vite applies your UI code changes automatically; installer updates are only used by the packaged app.",
          };
    let availableInfo: UpdateInfo | null = null;
    let checkPromise: Promise<DesktopUpdateStatus> | null = null;
    let downloadPromise: Promise<DesktopUpdateStatus> | null = null;
    let startupTimer: NodeJS.Timeout | null = null;
    let intervalTimer: NodeJS.Timeout | null = null;

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.fullChangelog = true;

    const publish = (next: DesktopUpdateStatus): DesktopUpdateStatus => {
        status = next;
        for (const window of BrowserWindow.getAllWindows()) {
            if (!window.isDestroyed()) window.webContents.send("updates:status", status);
        }
        return status;
    };

    const base = () => ({ currentVersion, channel, native: true as const });

    const configureChannel = (next: DesktopUpdateChannel): void => {
        channel = next;
        try {
            mkdirSync(app.getPath("userData"), { recursive: true });
            writeFileSync(preferenceFile, `${JSON.stringify({ channel }, null, 2)}\n`, "utf8");
        } catch (error) {
            console.warn("[updater] could not persist the release channel", error);
        }
        autoUpdater.channel = providerChannel(next);
        autoUpdater.allowPrerelease = next !== "stable";
        // Selecting a channel makes electron-updater enable downgrades. Coretex only
        // accepts monotonically newer builds, even when moving between channels.
        autoUpdater.allowDowngrade = false;
    };

    autoUpdater.on("checking-for-update", () => {
        publish({ state: "checking", ...base() });
    });

    autoUpdater.on("update-available", (info) => {
        availableInfo = info;
        publish({
            state: "available",
            ...base(),
            canDownload: true,
            checkedAt: Date.now(),
            version: info.version,
            url: releaseUrl(info.version),
            name: info.releaseName ?? undefined,
            releaseNotes: releaseNotes(info.releaseNotes),
        });
    });

    autoUpdater.on("update-not-available", (info) => {
        availableInfo = null;
        publish({
            state: "current",
            ...base(),
            checkedAt: Date.now(),
            latest: info.version || currentVersion,
        });
    });

    autoUpdater.on("download-progress", (progress: ProgressInfo) => {
        publish({
            state: "downloading",
            ...base(),
            version: availableInfo?.version ?? currentVersion,
            percent: Math.max(0, Math.min(100, progress.percent)),
            transferred: progress.transferred,
            total: progress.total,
            bytesPerSecond: progress.bytesPerSecond,
        });
    });

    autoUpdater.on("update-downloaded", (info) => {
        availableInfo = info;
        publish({
            state: "ready",
            ...base(),
            version: info.version,
            releaseNotes: releaseNotes(info.releaseNotes),
        });
    });

    autoUpdater.on("error", (error) => {
        publish({
            state: "error",
            ...base(),
            checkedAt: Date.now(),
            reason: readableUpdaterError(error),
        });
    });

    const check = async (requestedChannel: DesktopUpdateChannel): Promise<DesktopUpdateStatus> => {
        if (!app.isPackaged) {
            channel = requestedChannel;
            return publish({
                state: "development",
                ...base(),
                reason: "This is the live development app. Vite applies your UI code changes automatically; installer updates are only used by the packaged app.",
            });
        }
        if (status.state === "downloading" || status.state === "ready") return status;
        if (checkPromise) return checkPromise;

        checkPromise = (async () => {
            configureChannel(requestedChannel);
            publish({ state: "checking", ...base() });
            try {
                await autoUpdater.checkForUpdates();
                return status;
            } catch (error) {
                return publish({
                    state: "error",
                    ...base(),
                    checkedAt: Date.now(),
                    reason: readableUpdaterError(error),
                });
            } finally {
                checkPromise = null;
            }
        })();
        return checkPromise;
    };

    const download = async (): Promise<DesktopUpdateStatus> => {
        if (!app.isPackaged) return status;
        if (status.state === "ready" || status.state === "downloading") return status;
        if (!availableInfo || status.state !== "available") {
            return publish({
                state: "error",
                ...base(),
                checkedAt: Date.now(),
                reason: "Check for an update before downloading it.",
            });
        }
        if (downloadPromise) return downloadPromise;

        downloadPromise = (async () => {
            publish({
                state: "downloading",
                ...base(),
                version: availableInfo?.version ?? currentVersion,
                percent: 0,
                transferred: 0,
                total: 0,
                bytesPerSecond: 0,
            });
            try {
                await autoUpdater.downloadUpdate();
                return status;
            } catch (error) {
                return publish({
                    state: "error",
                    ...base(),
                    checkedAt: Date.now(),
                    reason: readableUpdaterError(error),
                });
            } finally {
                downloadPromise = null;
            }
        })();
        return downloadPromise;
    };

    ipcMain.handle("updates:get-state", () => status);
    ipcMain.handle("updates:check", (_event, payload?: { channel?: unknown }) => check(validChannel(payload?.channel)));
    ipcMain.handle("updates:download", () => download());
    ipcMain.on("updates:set-channel", (_event, payload?: { channel?: unknown }) => {
        configureChannel(validChannel(payload?.channel));
        if (status.state === "idle" || status.state === "current" || status.state === "error") {
            publish({ state: "idle", ...base() });
        }
    });
    ipcMain.handle("updates:install", () => {
        if (!app.isPackaged || status.state !== "ready") return { ok: false, reason: "No downloaded update is ready." };
        beforeInstall();
        autoUpdater.quitAndInstall(false, true);
        return { ok: true };
    });

    const startBackgroundChecks = (): void => {
        if (!app.isPackaged || startupTimer || intervalTimer) return;
        startupTimer = setTimeout(() => {
            startupTimer = null;
            void check(channel);
        }, BACKGROUND_CHECK_DELAY_MS);
        startupTimer.unref();

        intervalTimer = setInterval(() => {
            if (status.state !== "downloading" && status.state !== "ready") void check(channel);
        }, BACKGROUND_CHECK_INTERVAL_MS);
        intervalTimer.unref();
    };

    const stop = (): void => {
        if (startupTimer) clearTimeout(startupTimer);
        if (intervalTimer) clearInterval(intervalTimer);
        startupTimer = null;
        intervalTimer = null;
    };

    return { getStatus: () => status, startBackgroundChecks, stop };
}
