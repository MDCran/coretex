export type DesktopIpcDirection = "send" | "receive" | "invoke";

const IPC_CHANNELS: Record<DesktopIpcDirection, ReadonlySet<string>> = {
    send: new Set([
        "config:apply",
        "os:setDefaultTerminal",
        "os:setLoginItem",
        "updates:set-channel",
        "window:apply",
    ]),
    receive: new Set([
        "app:new-tab",
        "updates:status",
    ]),
    invoke: new Set([
        "bridge:getConnection",
        "updates:check",
        "updates:download",
        "updates:get-preferences",
        "updates:get-releases",
        "updates:get-state",
        "updates:install",
        "updates:open-external",
        "updates:set-preferences",
    ]),
};

/** Keep the renderer bridge limited to the desktop operations it actually uses. */
export function isAllowedDesktopIpcChannel(direction: DesktopIpcDirection, channel: unknown): channel is string {
    return typeof channel === "string" && IPC_CHANNELS[direction].has(channel);
}
