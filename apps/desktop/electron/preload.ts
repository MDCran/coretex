import { contextBridge, ipcRenderer } from "electron";
import { isAllowedDesktopIpcChannel } from "./ipc-security";
import {
    UPDATE_IPC,
    type DesktopReleaseHistoryResult,
    type DesktopUpdateChannel,
    type DesktopUpdateExternalTarget,
    type DesktopUpdatePreferences,
    type DesktopUpdateStatus,
} from "./update-contract";

const updates = {
    getState: (): Promise<DesktopUpdateStatus> => ipcRenderer.invoke(UPDATE_IPC.getState),
    getPreferences: (): Promise<DesktopUpdatePreferences> => ipcRenderer.invoke(UPDATE_IPC.getPreferences),
    setPreferences: (patch: Partial<DesktopUpdatePreferences>): Promise<DesktopUpdatePreferences> =>
        ipcRenderer.invoke(UPDATE_IPC.setPreferences, patch),
    check: (channel: DesktopUpdateChannel): Promise<DesktopUpdateStatus> =>
        ipcRenderer.invoke(UPDATE_IPC.check, { channel }),
    download: (): Promise<DesktopUpdateStatus> => ipcRenderer.invoke(UPDATE_IPC.download),
    install: (): Promise<{ ok: boolean; reason?: string }> => ipcRenderer.invoke(UPDATE_IPC.install),
    getReleases: (options?: { refresh?: boolean; channel?: DesktopUpdateChannel }): Promise<DesktopReleaseHistoryResult> =>
        ipcRenderer.invoke(UPDATE_IPC.getReleases, options),
    openExternal: (target: DesktopUpdateExternalTarget): Promise<{ ok: boolean; reason?: string }> =>
        ipcRenderer.invoke(UPDATE_IPC.openExternal, { target }),
    onStatus: (listener: (status: DesktopUpdateStatus) => void): (() => void) => {
        const subscription = (_event: Electron.IpcRendererEvent, status: DesktopUpdateStatus) => listener(status);
        ipcRenderer.on(UPDATE_IPC.status, subscription);
        return () => ipcRenderer.removeListener(UPDATE_IPC.status, subscription);
    },
};

contextBridge.exposeInMainWorld("electronAPI", {
    isElectron: true,
    platform: process.platform,
    versions: process.versions,
    updates,
    getBridgeConnection: (): Promise<{ url: string; token: string } | null> =>
        ipcRenderer.invoke("bridge:getConnection"),
    send: (channel: string, data?: unknown) => {
        if (!isAllowedDesktopIpcChannel("send", channel)) return;
        ipcRenderer.send(channel, data);
    },
    on: (channel: string, func: (...args: unknown[]) => void) => {
        if (!isAllowedDesktopIpcChannel("receive", channel)) return () => undefined;
        const subscription = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => func(...args);
        ipcRenderer.on(channel, subscription);
        return () => ipcRenderer.removeListener(channel, subscription);
    },
    invoke: (channel: string, data?: unknown) => {
        if (!isAllowedDesktopIpcChannel("invoke", channel)) {
            return Promise.reject(new Error("Desktop IPC channel is not available."));
        }
        return ipcRenderer.invoke(channel, data);
    },
});
