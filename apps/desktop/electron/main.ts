import { electronApp, optimizer } from "@electron-toolkit/utils";
import { Orchestrator } from "@repo/coretex/orchestrator";
import { app, BrowserWindow, ipcMain, Menu, net, protocol, session, shell, Tray } from "electron";
import { readFileSync } from "fs";
import { connect } from "net";
import { homedir } from "os";
import { dirname, isAbsolute, join, relative, resolve as resolvePath } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import {
    isSafeWebviewUrl,
    isTrustedRendererUrl as matchesTrustedRendererUrl,
    safeExternalUrl,
} from "./navigation-security";
import { createDesktopUpdater } from "./update-manager";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const isDevelopmentApp = !app.isPackaged;
const brainPort = isDevelopmentApp ? 8766 : 8765;
const brainDataDir = join(homedir(), isDevelopmentApp ? ".coretex-dev" : ".coretex");
const appDisplayName = isDevelopmentApp ? "Coretex Dev" : "Coretex";
const packagedRendererPath = join(__dirname, "../dist/index.html");
const browserPartition = "persist:coretex-browser";
const browserVisibleAssetExtensions = new Set([
    ".avif",
    ".bmp",
    ".gif",
    ".ico",
    ".jpeg",
    ".jpg",
    ".pdf",
    ".png",
    ".svg",
    ".webp",
]);

function isTrustedRendererUrl(url: string): boolean {
    return matchesTrustedRendererUrl(url, {
        development: isDevelopmentApp,
        devServerUrl: process.env["VITE_DEV_SERVER_URL"],
        packagedEntryPath: packagedRendererPath,
    });
}

protocol.registerSchemesAsPrivileged([
    {
        scheme: "coretex-asset",
        // This scheme is for <img>/<video>/PDF display only. Deliberately omit
        // supportFetchAPI/corsEnabled so renderer JavaScript cannot read files.
        privileges: { standard: true, secure: true, stream: true },
    },
]);

function allowedAssetRoots(): string[] {
    const roots = [join(homedir(), ".coretex"), join(homedir(), ".coretex-dev"), brainDataDir];
    if (isDevelopmentApp) roots.push(resolvePath(app.getAppPath(), "..", ".."));
    return [...new Set(roots.map((root) => resolvePath(root)))];
}

function decodedAssetPath(rawUrl: string): string | null {
    try {
        const url = new URL(rawUrl);
        if (url.protocol !== "coretex-asset:" || url.hostname !== "local") return null;
        const candidate = resolvePath(Buffer.from(decodeURIComponent(url.pathname.slice(1)), "base64url").toString("utf8"));
        const extension = candidate.slice(candidate.lastIndexOf(".")).toLowerCase();
        if (!browserVisibleAssetExtensions.has(extension)) return null;
        const allowed = allowedAssetRoots().some((root) => {
            const nested = relative(root, candidate);
            return nested === "" || (!nested.startsWith("..") && !isAbsolute(nested));
        });
        return allowed ? candidate : null;
    } catch {
        return null;
    }
}

function registerAssetProtocol(): void {
    protocol.handle("coretex-asset", (request) => {
        const filePath = decodedAssetPath(request.url);
        if (!filePath) return new Response("Asset not found", { status: 404 });
        return net.fetch(pathToFileURL(filePath).toString());
    });
}

// A distinct userData directory gives the live and installed apps independent
// single-instance locks, Chromium storage, updater preferences, and caches.
if (isDevelopmentApp) {
    app.setName(appDisplayName);
    app.setPath("userData", join(app.getPath("appData"), "Coretex Dev"));
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let brain: Orchestrator | null = null;
let bridgeAuthToken: string | null = null;

interface BridgeSessionFile {
    version?: number;
    port?: number;
    token?: string;
}

function readBridgeSessionToken(): string | null {
    try {
        const session = JSON.parse(readFileSync(join(brainDataDir, "bridge-session.json"), "utf8")) as BridgeSessionFile;
        if (session.version !== 1 || session.port !== brainPort || !/^[A-Za-z0-9_-]{43,128}$/.test(session.token ?? "")) {
            return null;
        }
        return session.token ?? null;
    } catch {
        return null;
    }
}

async function waitForBridgeSessionToken(): Promise<string | null> {
    for (let attempt = 0; attempt < 40; attempt += 1) {
        const token = readBridgeSessionToken();
        if (token) return token;
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return null;
}

function isBrainReachable(port = brainPort): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = connect({ host: "127.0.0.1", port });
        const finish = (reachable: boolean) => {
            socket.removeAllListeners();
            socket.destroy();
            resolve(reachable);
        };
        socket.setTimeout(500);
        socket.once("connect", () => finish(true));
        socket.once("timeout", () => finish(false));
        socket.once("error", () => finish(false));
    });
}

/** Start the local Brain unless a separately managed dev Brain already owns the bridge. */
async function ensureBrain(): Promise<void> {
    // In live development the standalone Brain starts alongside Electron and
    // watches coretex/src. Give it a brief head start so it owns the bridge and
    // backend edits can restart independently. Packaged startup stays immediate.
    const reachabilityAttempts = app.isPackaged ? 1 : 20;
    for (let attempt = 0; attempt < reachabilityAttempts; attempt += 1) {
        if (await isBrainReachable()) {
            bridgeAuthToken = await waitForBridgeSessionToken();
            if (!bridgeAuthToken) {
                throw new Error("The local Coretex Brain did not publish an authenticated bridge session.");
            }
            console.info(`[desktop] using the existing Coretex Brain on ws://localhost:${brainPort}`);
            return;
        }
        if (attempt < reachabilityAttempts - 1) {
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
    }

    process.env.CORETEX_DATA_DIR = brainDataDir;
    if (process.env["VITE_DEV_SERVER_URL"]) {
        process.env.CORETEX_BRIDGE_ALLOWED_ORIGINS = new URL(process.env["VITE_DEV_SERVER_URL"]).origin;
    }
    const localBrain = new Orchestrator({ wsPort: brainPort });
    try {
        await localBrain.start();
        brain = localBrain;
        bridgeAuthToken = localBrain.getBridgeAuthToken();
        console.info("[desktop] embedded Coretex Brain started");
    } catch (error) {
        // In the root dev command the standalone Brain and Electron start in
        // parallel. If it won the port race, use it instead of failing launch.
        if (await isBrainReachable()) {
            localBrain.stop();
            bridgeAuthToken = await waitForBridgeSessionToken();
            if (!bridgeAuthToken) {
                throw new Error("The standalone Coretex Brain did not publish an authenticated bridge session.");
            }
            console.info("[desktop] standalone Coretex Brain won the startup race");
            return;
        }
        localBrain.stop();
        throw error;
    }
}

ipcMain.handle("bridge:getConnection", (event) => {
    const senderUrl = event.senderFrame?.url ?? event.sender.getURL();
    if (!isTrustedRendererUrl(senderUrl)) throw new Error("Untrusted renderer requested bridge credentials.");
    // A watched standalone Brain gets a fresh token after every restart. Refresh
    // from its protected session file so the renderer can remount and reconnect.
    bridgeAuthToken = readBridgeSessionToken() ?? bridgeAuthToken;
    if (!bridgeAuthToken) return null;
    return { url: `ws://localhost:${brainPort}`, token: bridgeAuthToken };
});

// ---- Launch-time config -------------------------------------------------------
// A handful of settings (software rendering, graphics API, swapchain) must be
// applied via app.commandLine / app.disableHardwareAcceleration() BEFORE the app
// is ready — far too early for the renderer's IPC push (window:apply) to reach us.
// So we read the persisted settings.json (~/.coretex/settings.json) synchronously
// here. Runtime-mutable settings (login item, tray, hide-on-blur, run-in-background,
// new-instance routing) are kept live via IPC + cached config below.
//
// Shape mirrors the subset of CoretexConfig (coretex/src/config/schema.ts) we read.
interface LaunchConfig {
    startup?: {
        launchOnLogin?: boolean;
        defaultTerminalApp?: boolean;
        newInstance?: "window" | "tab" | "focus";
    };
    appearance?: {
        tray?: { alwaysShowIcon?: boolean; minimizeToTray?: boolean };
        window?: { autoHideOnBlur?: boolean };
    };
    rendering?: {
        render?: {
            graphicsApi?: "auto" | "d3d11" | "d3d12" | "opengl" | "software";
            disablePartialSwapchain?: boolean;
            softwareRendering?: boolean;
        };
        compat?: { runInBackground?: boolean };
    };
}

function objectValue(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function sanitizeLaunchConfig(value: unknown): LaunchConfig | null {
    const source = objectValue(value);
    if (!source) return null;
    const startupSource = objectValue(source.startup);
    const appearanceSource = objectValue(source.appearance);
    const traySource = objectValue(appearanceSource?.tray);
    const windowSource = objectValue(appearanceSource?.window);
    const renderingSource = objectValue(source.rendering);
    const renderSource = objectValue(renderingSource?.render);
    const compatSource = objectValue(renderingSource?.compat);
    const config: LaunchConfig = {};

    if (startupSource) {
        const startup: NonNullable<LaunchConfig["startup"]> = {};
        if (typeof startupSource.launchOnLogin === "boolean") startup.launchOnLogin = startupSource.launchOnLogin;
        if (typeof startupSource.defaultTerminalApp === "boolean") startup.defaultTerminalApp = startupSource.defaultTerminalApp;
        if (startupSource.newInstance === "window" || startupSource.newInstance === "tab" || startupSource.newInstance === "focus") {
            startup.newInstance = startupSource.newInstance;
        }
        config.startup = startup;
    }
    if (traySource || windowSource) {
        config.appearance = {};
        if (traySource) {
            config.appearance.tray = {};
            if (typeof traySource.alwaysShowIcon === "boolean") config.appearance.tray.alwaysShowIcon = traySource.alwaysShowIcon;
            if (typeof traySource.minimizeToTray === "boolean") config.appearance.tray.minimizeToTray = traySource.minimizeToTray;
        }
        if (windowSource) {
            config.appearance.window = {};
            if (typeof windowSource.autoHideOnBlur === "boolean") config.appearance.window.autoHideOnBlur = windowSource.autoHideOnBlur;
        }
    }
    if (renderSource || compatSource) {
        config.rendering = {};
        if (renderSource) {
            config.rendering.render = {};
            if (
                renderSource.graphicsApi === "auto" ||
                renderSource.graphicsApi === "d3d11" ||
                renderSource.graphicsApi === "d3d12" ||
                renderSource.graphicsApi === "opengl" ||
                renderSource.graphicsApi === "software"
            ) {
                config.rendering.render.graphicsApi = renderSource.graphicsApi;
            }
            if (typeof renderSource.disablePartialSwapchain === "boolean") {
                config.rendering.render.disablePartialSwapchain = renderSource.disablePartialSwapchain;
            }
            if (typeof renderSource.softwareRendering === "boolean") {
                config.rendering.render.softwareRendering = renderSource.softwareRendering;
            }
        }
        if (compatSource) {
            config.rendering.compat = {};
            if (typeof compatSource.runInBackground === "boolean") config.rendering.compat.runInBackground = compatSource.runInBackground;
        }
    }
    return config;
}

function readPersistedConfig(): LaunchConfig {
    try {
        const file = join(brainDataDir, "settings.json");
        const raw = readFileSync(file, "utf8");
        const parsed = JSON.parse(raw) as { config?: unknown };
        // The store writes { version, config }, but tolerate a bare config object too.
        return sanitizeLaunchConfig(parsed.config ?? parsed) ?? {};
    } catch {
        return {};
    }
}

// Cached snapshot of the persisted config, refreshed by IPC pushes from the renderer
// so runtime handlers (tray/blur/new-instance/quit) always honor the latest values.
let cfg: LaunchConfig = readPersistedConfig();

// ---- Apply launch-time rendering switches (must run before app.whenReady) -----
const render = cfg.rendering?.render;
if (render?.softwareRendering || render?.graphicsApi === "software") {
    app.disableHardwareAcceleration();
}
if (render?.graphicsApi && render.graphicsApi !== "auto" && render.graphicsApi !== "software") {
    // Map the user-facing graphics API choice onto Chromium's ANGLE backend switch.
    const angleBackend = render.graphicsApi === "opengl" ? "gl" : render.graphicsApi; // d3d11 | d3d12 | gl
    app.commandLine.appendSwitch("use-angle", angleBackend);
}
if (render?.disablePartialSwapchain) {
    // Disable partial-swap presentation to work around stale/torn frames on some GPUs.
    app.commandLine.appendSwitch("disable-partial-raster");
    app.commandLine.appendSwitch("disable-gpu-vsync");
}

// Single-instance: required so startup.newInstance ("focus"/"tab") can route a second
// launch into the existing window instead of spawning a duplicate process.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
    app.quit();
} else {
    // A second launch (clicking the launcher again, or `npm run dev` while the app is
    // resident in the tray) should restore/focus the existing window rather than silently
    // failing to get the single-instance lock and leaving the user with no visible window.
    app.on("second-instance", () => showMainWindow());
}

function trustedSenderWindow(event: Electron.IpcMainEvent): BrowserWindow | null {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    const senderUrl = event.senderFrame?.url ?? event.sender.getURL();
    return senderWindow && isTrustedRendererUrl(senderUrl) ? senderWindow : null;
}

// Apply live window-chrome settings from the renderer (Appearance settings).
ipcMain.on("window:apply", (event, value: unknown) => {
    const senderWindow = trustedSenderWindow(event);
    const opts = objectValue(value);
    if (!senderWindow || !opts) return;
    if (typeof opts.alwaysOnTop === "boolean") senderWindow.setAlwaysOnTop(opts.alwaysOnTop);
    if (typeof opts.opacity === "number" && Number.isFinite(opts.opacity)) {
        senderWindow.setOpacity(Math.max(0.2, Math.min(1, opts.opacity / 100)));
    }
    // The OS title bar can't be toggled after creation on Windows; the menu bar is the live equivalent.
    if (typeof opts.hideTitleBar === "boolean") senderWindow.setMenuBarVisibility(!opts.hideTitleBar);
});

// Startup → "Launch on login". Bound to app.setLoginItemSettings so the OS auto-starts
// Coretex when the user signs in. Renderer pushes the toggle via os:setLoginItem.
ipcMain.on("os:setLoginItem", (event, value: unknown) => {
    if (!trustedSenderWindow(event)) return;
    const opts = objectValue(value);
    if (!opts || typeof opts.openAtLogin !== "boolean") return;
    const openAtLogin = Boolean(opts?.openAtLogin);
    if (!cfg.startup) cfg.startup = {};
    cfg.startup.launchOnLogin = openAtLogin;
    app.setLoginItemSettings({ openAtLogin });
});

// Windows "default terminal application" registration is persisted + acknowledged here.
// Full OS registration (windows-terminal.json / protocol) ships with the packaged installer;
// this keeps the setting live so the preference is ready when that hook lands.
ipcMain.on("os:setDefaultTerminal", (event, value: unknown) => {
    if (!trustedSenderWindow(event)) return;
    const opts = objectValue(value);
    if (!opts || typeof opts.enabled !== "boolean") return;
    if (!cfg.startup) cfg.startup = {};
    cfg.startup.defaultTerminalApp = Boolean(opts?.enabled);
});

// Live config push: the renderer mirrors the relevant settings subtree here so runtime
// handlers (tray, hide-on-blur, run-in-background, new-instance) honor edits without a
// restart. Each push merges into the cached snapshot and re-applies tray state.
ipcMain.on("config:apply", (event, value: unknown) => {
    if (!trustedSenderWindow(event)) return;
    const next = sanitizeLaunchConfig(value);
    if (!next) return;
    cfg = {
        startup: { ...cfg.startup, ...next.startup },
        appearance: {
            tray: { ...cfg.appearance?.tray, ...next.appearance?.tray },
            window: { ...cfg.appearance?.window, ...next.appearance?.window },
        },
        rendering: {
            render: { ...cfg.rendering?.render, ...next.rendering?.render },
            compat: { ...cfg.rendering?.compat, ...next.rendering?.compat },
        },
    };
    syncTray();
});

function showMainWindow(): void {
    if (!mainWindow) {
        createWindow();
        return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
}

// ---- Tray ---------------------------------------------------------------------
// Created when appearance.tray.alwaysShowIcon is set (or needed for minimize-to-tray),
// destroyed otherwise. Clicking the tray icon restores/focuses the window.
function syncTray(): void {
    const wantTray = Boolean(cfg.appearance?.tray?.alwaysShowIcon);
    if (wantTray && !tray) {
        tray = new Tray(join(__dirname, "../dist/coretex-icon.png"));
        tray.setToolTip("Coretex");
        tray.setContextMenu(
            Menu.buildFromTemplate([
                { label: "Show Coretex", click: () => showMainWindow() },
                { type: "separator" },
                {
                    label: "Quit",
                    click: () => {
                        // Force a real quit even when run-in-background is set.
                        isQuitting = true;
                        app.quit();
                    },
                },
            ]),
        );
        tray.on("click", () => showMainWindow());
    } else if (!wantTray && tray) {
        tray.destroy();
        tray = null;
    }
}

// Tracks an explicit quit (tray "Quit" / app.quit) so the close/minimize hide-to-tray
// interception knows when to actually let the window close.
let isQuitting = false;
const desktopUpdater = createDesktopUpdater({
    beforeInstall: () => {
        // quitAndInstall closes windows before Electron's normal before-quit hook.
        // Mark this as an intentional quit so minimize-to-tray cannot intercept it.
        isQuitting = true;
        brain?.stop();
        brain = null;
    },
    isTrustedRendererUrl,
});

app.on("before-quit", () => {
    isQuitting = true;
    desktopUpdater.stop();
    brain?.stop();
    brain = null;
});

function createWindow(): void {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        show: false,
        title: appDisplayName,
        icon: join(__dirname, "../dist/coretex-icon.png"),
        titleBarStyle: "hiddenInset",
        autoHideMenuBar: true,
        webPreferences: {
            preload: join(__dirname, "preload.cjs"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
            allowRunningInsecureContent: false,
            // Enable <webview> so the in-app browser pane can host a real, scriptable page
            // (executeJavaScript for browser_read_dom / click / eval, #16 follow-up).
            webviewTag: true,
        },
    });

    const win = mainWindow;

    // A compromised renderer must not be able to attach a privileged guest by
    // smuggling preload/node flags through a dynamically-created <webview>.
    win.webContents.on("will-attach-webview", (event, webPreferences, params) => {
        if (!isSafeWebviewUrl(params.src || "about:blank")) {
            event.preventDefault();
            return;
        }
        delete webPreferences.preload;
        webPreferences.nodeIntegration = false;
        webPreferences.nodeIntegrationInSubFrames = false;
        webPreferences.contextIsolation = true;
        webPreferences.sandbox = true;
        webPreferences.webSecurity = true;
        webPreferences.allowRunningInsecureContent = false;
        webPreferences.webviewTag = false;
        webPreferences.partition = browserPartition;
    });

    win.on("ready-to-show", () => {
        win.show();
    });

    win.webContents.setWindowOpenHandler((details) => {
        const externalUrl = safeExternalUrl(details.url);
        if (externalUrl) void shell.openExternal(externalUrl);
        return { action: "deny" };
    });

    // The preload bridge is available only to the app's exact renderer origin.
    // Block a main-frame navigation before a remote page can inherit that bridge.
    win.webContents.on("will-navigate", (event, url) => {
        if (!isTrustedRendererUrl(url)) event.preventDefault();
    });
    win.webContents.on("will-redirect", (event, url) => {
        if (!isTrustedRendererUrl(url)) event.preventDefault();
    });

    // Hide-to-tray on minimize when appearance.tray.minimizeToTray is set.
    win.on("minimize", () => {
        if (cfg.appearance?.tray?.minimizeToTray) {
            win.hide();
        }
    });

    // Hide the window when it loses focus, if appearance.window.autoHideOnBlur is set.
    win.on("blur", () => {
        if (cfg.appearance?.window?.autoHideOnBlur) {
            // Never hide while a dev tools / child window steals focus, or while quitting.
            if (!isQuitting && !win.webContents.isDevToolsFocused()) {
                win.hide();
            }
        }
    });

    // When minimize-to-tray is active, intercept close to hide instead of destroy
    // (unless the user is explicitly quitting). This keeps the app resident in the tray.
    win.on("close", (event) => {
        if (!isQuitting && cfg.appearance?.tray?.minimizeToTray) {
            event.preventDefault();
            win.hide();
        }
    });

    if (process.env["VITE_DEV_SERVER_URL"]) {
        win.loadURL(process.env["VITE_DEV_SERVER_URL"]);
    } else {
        win.loadFile(join(__dirname, "../dist/index.html"));
    }
}

// Second launch / second-instance: route per startup.newInstance.
//   "window" → spawn a fresh BrowserWindow.
//   "tab"    → focus the existing window; the renderer opens a new tab on the
//              new-instance signal (no native tabs on Windows, so a tab is renderer-side).
//   "focus"  → just focus the existing window.
app.on("second-instance", () => {
    const mode = cfg.startup?.newInstance ?? "focus";
    if (mode === "window") {
        createWindow();
    } else {
        showMainWindow();
        if (mode === "tab") {
            // Ask the renderer to open a new in-app tab in the focused window.
            mainWindow?.webContents.send("app:new-tab");
        }
    }
});

if (gotSingleInstanceLock) {
    app.whenReady().then(async () => {
        registerAssetProtocol();
        const browserSession = session.fromPartition(browserPartition);
        browserSession.setPermissionCheckHandler(() => false);
        browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
        await ensureBrain().catch((error) => {
            console.error("[desktop] failed to start the embedded Coretex Brain", error);
        });
        electronApp.setAppUserModelId(isDevelopmentApp ? "com.coretex.app.dev" : "com.coretex.app");

        // Honor the persisted "launch on login" preference at startup so the OS setting
        // stays in sync even if the renderer never pushes os:setLoginItem this session.
        if (typeof cfg.startup?.launchOnLogin === "boolean") {
            app.setLoginItemSettings({ openAtLogin: cfg.startup.launchOnLogin });
        }

        app.on("browser-window-created", (_, window) => {
            optimizer.watchWindowShortcuts(window);
        });

        // <webview> guests: keep them lean (no nodeIntegration) and route popups to the system
        // browser, mirroring the main window. executeJavaScript on the guest is what powers the
        // Brain's browser_read_dom / click / eval over the host bridge (#16 follow-up).
        app.on("web-contents-created", (_e, contents) => {
            if (contents.getType() === "webview") {
                const blockPrivilegedNavigation = (event: Electron.Event, url: string) => {
                    if (!isSafeWebviewUrl(url)) event.preventDefault();
                };
                contents.on("will-navigate", blockPrivilegedNavigation);
                contents.on("will-redirect", blockPrivilegedNavigation);
                contents.setWindowOpenHandler((details) => {
                    const externalUrl = safeExternalUrl(details.url);
                    if (externalUrl) void shell.openExternal(externalUrl);
                    return { action: "deny" };
                });
            }
        });

        syncTray();
        createWindow();
        desktopUpdater.startBackgroundChecks();

        app.on("activate", function () {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
        });
    });
}

app.on("window-all-closed", () => {
    // Keep the process resident when run-in-background (or a live tray) is set — only
    // then can hide-to-tray / background work survive every window closing.
    if (cfg.rendering?.compat?.runInBackground || cfg.appearance?.tray?.alwaysShowIcon) {
        return;
    }
    if (process.platform !== "darwin") {
        app.quit();
    }
});
