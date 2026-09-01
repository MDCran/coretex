// @ts-nocheck
import { useCallback, useEffect, useRef, useState } from "react";
import {
    Check,
    Laptop01,
    Monitor01,
    Phone01,
    Speaker01,
    VolumeMax,
    VolumeMin,
    VolumeX,
} from "@untitledui/icons";
import { toast } from "sonner";
import { Button } from "@/components/base/buttons/button";
import { Slider } from "@/components/base/slider/slider";
import { fetchDevices, setPlayerVolume, transferPlayback } from "@/lib/actions/spotify";
import type { SpotifyDevice } from "@/lib/spotify-shared";
import { cx } from "@/utils/cx";

/** Debounce window for committing volume changes to Spotify while dragging. */
const VOLUME_COMMIT_MS = 300;

function deviceTypeIcon(type: string) {
    const t = type.toLowerCase();
    if (t.includes("phone") || t.includes("tablet")) return Phone01;
    if (t.includes("computer") || t.includes("laptop")) return Laptop01;
    if (t.includes("tv") || t.includes("monitor")) return Monitor01;
    return Speaker01;
}

function volumeIcon(volume: number) {
    if (volume <= 0) return VolumeX;
    if (volume < 50) return VolumeMin;
    return VolumeMax;
}

/**
 * Shared Spotify output controls: a device picker (Spotify Connect transfer) and a
 * volume slider. Both read from a single devices fetch so the active device's name
 * and current volume stay in sync. `onChanged` fires after a transfer so the parent
 * can re-poll playback.
 *
 * `variant="bar"` lays the device button and volume slider out as two rows (sidebars,
 * the floating widget). `variant="compact"` collapses them into two icon buttons with
 * popovers for tight headers.
 */
export function SpotifyOutputControls({
    variant = "bar",
    onChanged,
    className,
}: {
    variant?: "bar" | "compact";
    onChanged?: () => void;
    className?: string;
}) {
    const [devices, setDevices] = useState<SpotifyDevice[]>([]);
    const [loading, setLoading] = useState(false);
    const [transferringId, setTransferringId] = useState<string | null>(null);
    const [panel, setPanel] = useState<"none" | "devices" | "volume">("none");
    const [volume, setVolume] = useState(0);
    const [volumeReady, setVolumeReady] = useState(false);
    const lastSentVolume = useRef<number | null>(null);
    const preMuteVolume = useRef(50);
    const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);

    const activeDevice = devices.find((d) => d.isActive) ?? null;
    const canVolume = Boolean(activeDevice && !activeDevice.isRestricted && activeDevice.volumePercent != null);

    const loadDevices = useCallback(async () => {
        setLoading(true);
        try {
            const list = await fetchDevices();
            setDevices(list);
            const active = list.find((d) => d.isActive);
            if (active?.volumePercent != null) {
                setVolume(active.volumePercent);
                lastSentVolume.current = active.volumePercent;
                if (active.volumePercent > 0) preMuteVolume.current = active.volumePercent;
            }
            setVolumeReady(true);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't load devices");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadDevices();
    }, [loadDevices]);

    // Close any open popover on outside click / Escape.
    useEffect(() => {
        if (panel === "none") return;
        const onPointerDown = (e: PointerEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setPanel("none");
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") setPanel("none");
        };
        document.addEventListener("pointerdown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("pointerdown", onPointerDown);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [panel]);

    useEffect(() => {
        return () => {
            if (commitTimer.current) clearTimeout(commitTimer.current);
        };
    }, []);

    function togglePanel(next: "devices" | "volume") {
        setPanel((current) => {
            const opening = current !== next;
            if (opening && next === "devices") void loadDevices();
            return opening ? next : "none";
        });
    }

    async function onSelectDevice(device: SpotifyDevice) {
        if (!device.id || device.isRestricted || transferringId) return;
        setTransferringId(device.id);
        try {
            await transferPlayback(device.id, true);
            toast.success(`Playing on ${device.name}`);
            setPanel("none");
            onChanged?.();
            await loadDevices();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't switch device");
        } finally {
            setTransferringId(null);
        }
    }

    const commitVolume = useCallback((value: number) => {
        if (commitTimer.current) clearTimeout(commitTimer.current);
        commitTimer.current = setTimeout(() => {
            if (lastSentVolume.current === value) return;
            lastSentVolume.current = value;
            void setPlayerVolume(value).catch((e) => {
                toast.error(e instanceof Error ? e.message : "Couldn't set volume");
            });
        }, VOLUME_COMMIT_MS);
    }, []);

    function onVolumeChange(value: number) {
        setVolume(value);
        if (value > 0) preMuteVolume.current = value;
        commitVolume(value);
    }

    function toggleMute() {
        if (!canVolume) return;
        const next = volume > 0 ? 0 : preMuteVolume.current || 50;
        onVolumeChange(next);
    }

    const deviceList = (
        <div className="space-y-1">
            {loading && devices.length === 0 ? (
                <p className="px-1 py-2 text-sm text-tertiary">Loading devices…</p>
            ) : devices.length === 0 ? (
                <p className="px-1 py-2 text-sm text-tertiary">
                    No devices found. Open Spotify on a phone, computer, or speaker, then refresh.
                </p>
            ) : (
                devices.map((device) => {
                    const Icon = deviceTypeIcon(device.type);
                    const disabled = !device.id || device.isRestricted || transferringId != null;
                    return (
                        <button
                            key={device.id ?? device.name}
                            type="button"
                            disabled={disabled}
                            onClick={() => void onSelectDevice(device)}
                            className={cx(
                                "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition duration-100 ease-linear",
                                device.isActive ? "bg-active" : "hover:bg-primary_hover",
                                disabled && "cursor-not-allowed opacity-50",
                            )}
                        >
                            <Icon className="size-5 shrink-0 text-fg-quaternary" aria-hidden="true" />
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium text-primary">{device.name}</p>
                                <p className="truncate text-xs text-tertiary capitalize">
                                    {device.isActive ? "Active now" : device.type}
                                    {device.isRestricted ? " · restricted" : ""}
                                </p>
                            </div>
                            {device.isActive && <Check className="size-4 shrink-0 text-success-primary" aria-hidden="true" />}
                        </button>
                    );
                })
            )}
            <div className="flex justify-end border-t border-secondary pt-2">
                <Button size="sm" color="link-gray" onClick={() => void loadDevices()} isLoading={loading} showTextWhileLoading>
                    Refresh
                </Button>
            </div>
        </div>
    );

    const devicePopover = panel === "devices" && (
        <div className="absolute right-0 bottom-full z-10 mb-2 w-72 rounded-xl bg-primary p-2 shadow-lg ring-1 ring-secondary_alt">
            <p className="px-1 pt-1 pb-2 text-xs font-semibold tracking-wide text-tertiary uppercase">Play on device</p>
            {deviceList}
        </div>
    );

    const VolIcon = volumeIcon(volume);

    if (variant === "compact") {
        return (
            <div ref={rootRef} className={cx("flex items-center gap-1", className)}>
                <div className="relative">
                    <Button
                        size="sm"
                        color="tertiary"
                        iconLeading={VolIcon}
                        aria-label="Volume"
                        aria-expanded={panel === "volume"}
                        isDisabled={!canVolume}
                        onClick={() => togglePanel("volume")}
                    />
                    {panel === "volume" && (
                        <div className="absolute right-0 bottom-full z-10 mb-2 w-56 rounded-xl bg-primary p-3 shadow-lg ring-1 ring-secondary_alt">
                            <div className="flex items-center gap-3">
                                <Button size="sm" color="tertiary" iconLeading={VolIcon} aria-label={volume > 0 ? "Mute" : "Unmute"} onClick={toggleMute} />
                                <Slider
                                    aria-label="Volume"
                                    value={[volume]}
                                    onChange={(v) => onVolumeChange(Array.isArray(v) ? v[0] : v)}
                                    isDisabled={!volumeReady}
                                    className="flex-1"
                                />
                                <span className="w-8 text-right text-xs tabular-nums text-tertiary">{Math.round(volume)}%</span>
                            </div>
                        </div>
                    )}
                </div>
                <div className="relative">
                    <Button
                        size="sm"
                        color="tertiary"
                        iconLeading={activeDevice ? deviceTypeIcon(activeDevice.type) : Speaker01}
                        aria-label="Choose playback device"
                        aria-expanded={panel === "devices"}
                        onClick={() => togglePanel("devices")}
                    />
                    {devicePopover}
                </div>
            </div>
        );
    }

    return (
        <div ref={rootRef} className={cx("flex w-full flex-col gap-2", className)}>
            <div className="relative">
                <Button
                    size="sm"
                    color="secondary"
                    iconLeading={activeDevice ? deviceTypeIcon(activeDevice.type) : Speaker01}
                    aria-label="Choose playback device"
                    aria-expanded={panel === "devices"}
                    onClick={() => togglePanel("devices")}
                    className="w-full justify-start"
                >
                    <span className="truncate">{activeDevice ? activeDevice.name : "Choose device"}</span>
                </Button>
                {devicePopover}
            </div>
            <div className="flex items-center gap-2">
                <Button
                    size="sm"
                    color="tertiary"
                    iconLeading={VolIcon}
                    aria-label={volume > 0 ? "Mute" : "Unmute"}
                    isDisabled={!canVolume}
                    onClick={toggleMute}
                />
                <Slider
                    aria-label="Volume"
                    value={[volume]}
                    onChange={(v) => onVolumeChange(Array.isArray(v) ? v[0] : v)}
                    isDisabled={!canVolume}
                    className="flex-1"
                />
                <span className="w-8 text-right text-[11px] tabular-nums text-tertiary">{Math.round(volume)}%</span>
            </div>
        </div>
    );
}
