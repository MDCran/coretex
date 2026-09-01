"use client";

// Coretex Relay — notifications (§6). Desktop permission + test, category
// matrix with presets, delivery controls (sound, focus mode, quiet hours,
// digest). Only controls backed by the desktop notification runtime are shown.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CoretexConfig } from "@repo/coretex/types";
import { AlertCircle, Bell01, BellRinging01, CheckCircle, Clock, LayersThree01, Monitor01, Moon01, SearchMd, VolumeMax, Zap } from "@untitledui/icons";
import { Badge, BadgeWithDot } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Toggle } from "@/components/base/toggle/toggle";
import { cx } from "@/utils/cx";
import { HelpTooltip } from "../../ui/help-tooltip";
import {
    type NotifyPermission,
    enqueueDigest,
    flushDigestNow,
    getDigestQueueLength,
    isInQuietHours,
    notifyPermission,
    playNotificationSound,
    requestNotify,
} from "../../ui/notify";
import type { CoretexActions, CoretexState } from "../../use-coretex";
import { SettingNumber, SettingToggle, SettingsSection } from "../controls";
import { SettingsColumnHeader, SettingsPageHeader, SettingsStatusBadge, SettingsToggleCard } from "../settings-shell";

type CategoryGroup = "agents" | "work" | "system";

interface CategoryDef {
    key: string;
    label: string;
    help: string;
    group: CategoryGroup;
    critical?: boolean;
}

const CATEGORIES: CategoryDef[] = [
    {
        key: "taskDone",
        label: "Agent finished a task",
        help: "When an agent completes its assigned task.",
        group: "agents",
    },
    {
        key: "taskStarted",
        label: "Agent started a task",
        help: "When an agent picks up a task from the queue.",
        group: "agents",
    },
    {
        key: "approvalNeeded",
        label: "Agent needs approval",
        help: "When an action is waiting for your confirmation.",
        group: "agents",
        critical: true,
    },
    {
        key: "agentError",
        label: "Agent errored or was halted",
        help: "When an agent fails or is stopped.",
        group: "agents",
        critical: true,
    },
    {
        key: "agentIdle",
        label: "Agent went idle",
        help: "When an agent has no more work queued.",
        group: "agents",
    },
    {
        key: "agentPaused",
        label: "Agent paused / resumed",
        help: "When an agent is paused or woken from pause.",
        group: "agents",
    },
    {
        key: "mentionInChat",
        label: "Mentioned in chat",
        help: "When an agent addresses you directly.",
        group: "work",
    },
    {
        key: "chatReply",
        label: "AI chat reply ready",
        help: "When a background Ask AI / chat response finishes.",
        group: "work",
    },
    {
        key: "emailSorted",
        label: "Email sorter finished",
        help: "When the AI email sorter completes a run.",
        group: "work",
    },
    {
        key: "scheduleReminder",
        label: "Calendar reminder",
        help: "Reminders for upcoming calendar events.",
        group: "work",
    },
    {
        key: "deployFinished",
        label: "Deploy finished",
        help: "When a deployment or CI pipeline completes.",
        group: "work",
    },
    {
        key: "budget",
        label: "Budget threshold hit",
        help: "When spend reaches a configured limit.",
        group: "system",
        critical: true,
    },
    {
        key: "serverDown",
        label: "Server up / down",
        help: "When a detected running server changes state.",
        group: "system",
    },
    {
        key: "mcpError",
        label: "MCP server error",
        help: "When a connected MCP server fails or disconnects.",
        group: "system",
        critical: true,
    },
    {
        key: "updateAvailable",
        label: "App update available",
        help: "When a Coretex update is ready to install.",
        group: "system",
    },
    {
        key: "fileWatch",
        label: "Watched file changed",
        help: "When a file watcher picks up a change in a watched path.",
        group: "system",
    },
];

const GROUP_META: Record<CategoryGroup, { label: string; description: string }> = {
    agents: {
        label: "Agents",
        description: "Task lifecycle, approvals, and agent state",
    },
    work: { label: "Work", description: "Chat, email, calendar, and deploys" },
    system: {
        label: "System",
        description: "Budget, infrastructure, and product updates",
    },
};

type PresetId = "essential" | "critical" | "everything" | "muted" | "custom";

const PRESETS: {
    id: Exclude<PresetId, "custom">;
    label: string;
    description: string;
    keys: string[] | "all" | "critical" | "none";
}[] = [
    {
        id: "essential",
        label: "Essential",
        description: "Approvals, errors, budgets, task done, mentions",
        keys: ["approvalNeeded", "agentError", "budget", "mcpError", "taskDone", "mentionInChat", "deployFinished", "scheduleReminder"],
    },
    {
        id: "critical",
        label: "Critical only",
        description: "Approvals, errors, budgets, and MCP failures",
        keys: "critical",
    },
    {
        id: "everything",
        label: "Everything",
        description: "All categories enabled",
        keys: "all",
    },
    {
        id: "muted",
        label: "Muted",
        description: "Silence all categories (keep delivery rules)",
        keys: "none",
    },
];

const DIGEST_PRESETS = [15, 30, 60, 120] as const;

function permissionLabel(perm: NotifyPermission): {
    label: string;
    color: "success" | "error" | "warning" | "gray";
} {
    if (perm === "granted") return { label: "Granted", color: "success" };
    if (perm === "denied") return { label: "Blocked", color: "error" };
    if (perm === "unsupported") return { label: "Unsupported", color: "gray" };
    return { label: "Not enabled", color: "warning" };
}

function formatQuietWindow(start: string, end: string): string {
    return `${start} – ${end}`;
}

function categoryMapFromPreset(keys: string[] | "all" | "critical" | "none"): Record<string, boolean> {
    const next: Record<string, boolean> = {};
    for (const c of CATEGORIES) {
        if (keys === "all") next[c.key] = true;
        else if (keys === "none") next[c.key] = false;
        else if (keys === "critical") next[c.key] = Boolean(c.critical);
        else next[c.key] = keys.includes(c.key);
    }
    return next;
}

function detectPreset(categories: Record<string, boolean> | undefined): PresetId {
    const map = categories ?? {};
    for (const p of PRESETS) {
        const expected = categoryMapFromPreset(p.keys);
        if (CATEGORIES.every((c) => (map[c.key] === true) === expected[c.key])) return p.id;
    }
    return "custom";
}

export const NotificationsPage = ({ settings, actions }: { settings: CoretexConfig; state: CoretexState; actions: CoretexActions }) => {
    const notif = settings.notifications;
    const quiet = notif.quietHours ?? {
        enabled: false,
        start: "22:00",
        end: "07:00",
    };
    const digest = notif.digest ?? { enabled: false, everyMinutes: 30 };

    const [perm, setPerm] = useState<NotifyPermission>("default");
    const [testNote, setTestNote] = useState<string | null>(null);
    const [digestNote, setDigestNote] = useState<string | null>(null);
    const [digestPending, setDigestPending] = useState(0);
    const [filter, setFilter] = useState("");
    const [groupFilter, setGroupFilter] = useState<"all" | CategoryGroup>("all");
    const [quietNow, setQuietNow] = useState(false);

    const refreshSideState = useCallback(() => {
        setPerm(notifyPermission());
        setDigestPending(getDigestQueueLength());
        setQuietNow(quiet.enabled && isInQuietHours(quiet.start, quiet.end));
    }, [quiet.enabled, quiet.start, quiet.end]);

    useEffect(() => {
        refreshSideState();
        const id = window.setInterval(refreshSideState, 15_000);
        return () => window.clearInterval(id);
    }, [refreshSideState]);

    const ask = async () => {
        const next = await requestNotify();
        setPerm(next);
        if (next === "granted") {
            actions.setSetting("notifications.desktopEnabled", true);
            setTestNote("Permission granted. Desktop alerts are ready.");
        } else if (next === "denied") {
            setTestNote("Permission blocked. Enable notifications in your OS / browser settings.");
        }
    };

    const sendTest = () => {
        if (perm !== "granted") {
            setTestNote("Allow desktop notifications first, then try again.");
            return;
        }
        const ok = actions.notify("test", "Coretex", "Test notification — delivery is working.");
        if (ok) setTestNote("Test sent. Check your system notification tray.");
        else setTestNote("Couldn't deliver a test alert. Check OS notification settings.");
        refreshSideState();
    };

    const enqueueDigestSample = () => {
        enqueueDigest("taskStarted", "Digest sample", "Sample item queued for the next digest.", digest.everyMinutes);
        setDigestPending(getDigestQueueLength());
        setDigestNote("Sample queued into the digest.");
    };

    const sendDigestNow = () => {
        const ok = flushDigestNow();
        setDigestPending(getDigestQueueLength());
        setDigestNote(ok ? "Digest sent." : "Nothing in the digest queue yet — queue a sample first.");
    };

    const enabledCount = CATEGORIES.filter((c) => notif.categories?.[c.key] === true).length;
    const activePreset = detectPreset(notif.categories);

    const applyPreset = (id: Exclude<PresetId, "custom">) => {
        const preset = PRESETS.find((p) => p.id === id);
        if (!preset) return;
        const next = {
            ...(notif.categories ?? {}),
            ...categoryMapFromPreset(preset.keys),
        };
        actions.setSetting("notifications.categories", next);
    };

    const setGroupEnabled = (group: CategoryGroup, on: boolean) => {
        const next = { ...(notif.categories ?? {}) };
        for (const c of CATEGORIES) {
            if (c.group === group) next[c.key] = on;
        }
        actions.setSetting("notifications.categories", next);
    };

    const filtered = useMemo(() => {
        const q = filter.trim().toLowerCase();
        return CATEGORIES.filter((c) => {
            if (groupFilter !== "all" && c.group !== groupFilter) return false;
            if (!q) return true;
            return c.label.toLowerCase().includes(q) || c.help.toLowerCase().includes(q) || c.key.toLowerCase().includes(q);
        });
    }, [filter, groupFilter]);

    const byGroup = useMemo(() => {
        const map: Record<CategoryGroup, CategoryDef[]> = {
            agents: [],
            work: [],
            system: [],
        };
        for (const c of filtered) map[c.group].push(c);
        return map;
    }, [filtered]);

    const permMeta = permissionLabel(perm);
    const deliveryReady = perm === "granted" && notif.desktopEnabled;

    return (
        <div className="flex flex-col gap-6">
            <SettingsPageHeader
                icon={Bell01}
                title="Notifications"
                subtitle="Control native alerts, quiet hours, digests, and event categories on this device."
                badges={
                    <>
                        <SettingsStatusBadge label={deliveryReady ? "Desktop ready" : "Desktop not ready"} color={deliveryReady ? "success" : "warning"} />
                        {quietNow && <SettingsStatusBadge label="Quiet hours active" color="brand" />}
                        {digest.enabled && <SettingsStatusBadge label={`Digest · ${digestPending} queued`} color="gray" />}
                    </>
                }
            />

            <div className="flex min-w-0 flex-col gap-6">
                {/* ---- Desktop column ---- */}
                <div className="flex min-w-0 flex-col gap-6">
                    <SettingsColumnHeader icon={Monitor01} title="Desktop" subtitle="Native alerts on this machine" />

                    {/* Delivery status + permission */}
                    <SettingsSection
                        title="Desktop delivery"
                        description={
                            perm === "granted"
                                ? "OS permission is granted. Use the master switch and categories below to control what fires."
                                : perm === "denied"
                                  ? "Notifications are blocked by the OS or browser. Allow Coretex in system settings, then send a test."
                                  : perm === "unsupported"
                                    ? "This environment does not support native notifications."
                                    : "Grant permission so Coretex can surface agent approvals, errors, and digests."
                        }
                    >
                        <div className="flex flex-col gap-5">
                            <div className="flex flex-wrap items-start justify-between gap-4">
                                <div className="min-w-0 flex-1">
                                    <BadgeWithDot type="pill-color" size="sm" color={permMeta.color}>
                                        {permMeta.label}
                                    </BadgeWithDot>
                                    {testNote && (
                                        <p
                                            className={cx(
                                                "mt-2 flex items-start gap-1.5 text-xs",
                                                testNote.includes("Couldn't") ||
                                                    testNote.includes("blocked") ||
                                                    testNote.includes("Allow") ||
                                                    testNote.includes("Turn on")
                                                    ? "text-warning-primary"
                                                    : "text-success-primary",
                                            )}
                                        >
                                            {testNote.includes("Couldn't") ||
                                            testNote.includes("blocked") ||
                                            testNote.includes("Allow") ||
                                            testNote.includes("Turn on") ? (
                                                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                                            ) : (
                                                <CheckCircle className="mt-0.5 size-3.5 shrink-0" />
                                            )}
                                            {testNote}
                                        </p>
                                    )}
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    {perm !== "granted" && perm !== "unsupported" && (
                                        <Button size="sm" color="primary" iconLeading={Bell01} onClick={ask}>
                                            Enable notifications
                                        </Button>
                                    )}
                                    <Button size="sm" color="secondary" iconLeading={BellRinging01} isDisabled={perm !== "granted"} onClick={sendTest}>
                                        Send test
                                    </Button>
                                </div>
                            </div>

                            <div className="border-t border-secondary pt-1">
                                <SettingToggle
                                    settings={settings}
                                    actions={actions}
                                    path="notifications.desktopEnabled"
                                    label="Enable desktop notifications"
                                    description="Master switch for all native desktop alerts. Permission can stay granted while this is off."
                                    disabled={perm === "unsupported"}
                                    disabledReason={perm === "unsupported" ? "Notifications aren't available here." : undefined}
                                />
                            </div>
                        </div>
                    </SettingsSection>

                    {/* Delivery rules */}
                    <SettingsSection title="Delivery rules" description="How and when alerts reach you. Critical events always bypass quiet hours and digests.">
                        <div className="grid grid-cols-1 gap-3 py-4">
                            <SettingsToggleCard
                                icon={VolumeMax}
                                title="Play sound"
                                description="Audible chime with each delivered alert."
                                active={notif.sound}
                                control={
                                    <Toggle
                                        aria-label="Play notification sounds"
                                        isSelected={notif.sound}
                                        isDisabled={!notif.desktopEnabled}
                                        onChange={(v) => {
                                            actions.setSetting("notifications.sound", v);
                                            if (v) playNotificationSound();
                                        }}
                                    />
                                }
                            />
                            <SettingsToggleCard
                                icon={Zap}
                                title="Background only"
                                description="Suppress alerts while Coretex is focused."
                                active={notif.backgroundOnly}
                                control={
                                    <Toggle
                                        aria-label="Show notifications only in the background"
                                        isSelected={notif.backgroundOnly}
                                        isDisabled={!notif.desktopEnabled}
                                        onChange={(v) => actions.setSetting("notifications.backgroundOnly", v)}
                                    />
                                }
                            />
                        </div>

                        {/* Quiet hours */}
                        <div
                            className="rounded-xl px-4 py-4"
                            style={{
                                background: "var(--surface-2)",
                                border: "1px solid var(--c-border)",
                            }}
                        >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="flex min-w-0 items-start gap-3">
                                    <span
                                        className="grid size-9 shrink-0 place-items-center rounded-lg"
                                        style={{
                                            background: "var(--surface)",
                                            border: "1px solid var(--c-border)",
                                        }}
                                    >
                                        <Moon01 className="size-4 text-secondary" />
                                    </span>
                                    <div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="text-sm font-semibold text-primary">Quiet hours</p>
                                            {quiet.enabled && (
                                                <BadgeWithDot type="pill-color" size="sm" color={quietNow ? "brand" : "gray"}>
                                                    {quietNow ? "Active now" : "Scheduled"}
                                                </BadgeWithDot>
                                            )}
                                        </div>
                                        <p className="mt-0.5 text-xs text-tertiary">
                                            Mute non-critical alerts overnight. Approvals, errors, budgets, and MCP failures still come through.
                                        </p>
                                    </div>
                                </div>
                                <Toggle
                                    aria-label="Enable quiet hours"
                                    isSelected={quiet.enabled}
                                    isDisabled={!notif.desktopEnabled}
                                    onChange={(v) => actions.setSetting("notifications.quietHours.enabled", v)}
                                />
                            </div>
                            {quiet.enabled && (
                                <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-secondary pt-4">
                                    <label className="flex flex-col gap-1.5">
                                        <span className="text-xs font-medium text-secondary">Starts</span>
                                        <input
                                            type="time"
                                            value={quiet.start}
                                            onChange={(e) => actions.setSetting("notifications.quietHours.start", e.target.value)}
                                            className="rounded-lg px-3 py-2 text-sm text-primary outline-none"
                                            style={{
                                                background: "var(--surface)",
                                                border: "1px solid var(--c-border)",
                                            }}
                                        />
                                    </label>
                                    <span className="pb-2.5 text-xs text-quaternary">to</span>
                                    <label className="flex flex-col gap-1.5">
                                        <span className="text-xs font-medium text-secondary">Ends</span>
                                        <input
                                            type="time"
                                            value={quiet.end}
                                            onChange={(e) => actions.setSetting("notifications.quietHours.end", e.target.value)}
                                            className="rounded-lg px-3 py-2 text-sm text-primary outline-none"
                                            style={{
                                                background: "var(--surface)",
                                                border: "1px solid var(--c-border)",
                                            }}
                                        />
                                    </label>
                                    <p className="ml-auto flex items-center gap-1.5 pb-2.5 text-xs text-tertiary">
                                        <Clock className="size-3.5" />
                                        Window {formatQuietWindow(quiet.start, quiet.end)}
                                        {quiet.start > quiet.end ? " (overnight)" : ""}
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Digest */}
                        <div
                            className="mt-3 rounded-xl px-4 py-4"
                            style={{
                                background: "var(--surface-2)",
                                border: "1px solid var(--c-border)",
                            }}
                        >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="flex min-w-0 items-start gap-3">
                                    <span
                                        className="grid size-9 shrink-0 place-items-center rounded-lg"
                                        style={{
                                            background: "var(--surface)",
                                            border: "1px solid var(--c-border)",
                                        }}
                                    >
                                        <LayersThree01 className="size-4 text-secondary" />
                                    </span>
                                    <div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="text-sm font-semibold text-primary">Digest batching</p>
                                            {digest.enabled && (
                                                <Badge size="sm" color="gray">
                                                    {digestPending} queued
                                                </Badge>
                                            )}
                                        </div>
                                        <p className="mt-0.5 text-xs text-tertiary">
                                            Roll routine alerts into a periodic summary. Critical events still fire immediately.
                                        </p>
                                    </div>
                                </div>
                                <Toggle
                                    aria-label="Enable digest batching"
                                    isSelected={digest.enabled}
                                    isDisabled={!notif.desktopEnabled}
                                    onChange={(v) => actions.setSetting("notifications.digest.enabled", v)}
                                />
                            </div>
                            {digest.enabled && (
                                <div className="mt-4 flex flex-col gap-3 border-t border-secondary pt-4">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-xs font-medium text-secondary">Interval</span>
                                        {DIGEST_PRESETS.map((mins) => (
                                            <button
                                                key={mins}
                                                type="button"
                                                onClick={() => actions.setSetting("notifications.digest.everyMinutes", mins)}
                                                className={cx(
                                                    "rounded-lg px-3 py-1 text-xs font-medium transition",
                                                    digest.everyMinutes === mins ? "bg-[var(--brand)] text-white" : "text-secondary hover:brightness-110",
                                                )}
                                                style={
                                                    digest.everyMinutes === mins
                                                        ? undefined
                                                        : {
                                                              background: "var(--surface)",
                                                              border: "1px solid var(--c-border)",
                                                          }
                                                }
                                            >
                                                {mins < 60 ? `${mins}m` : `${mins / 60}h`}
                                            </button>
                                        ))}
                                    </div>
                                    <SettingNumber
                                        settings={settings}
                                        actions={actions}
                                        path="notifications.digest.everyMinutes"
                                        label="Custom interval (minutes)"
                                        description="Between 5 and 240 minutes."
                                        min={5}
                                        max={240}
                                    />
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Button size="sm" color="secondary" onClick={enqueueDigestSample}>
                                            Queue sample
                                        </Button>
                                        <Button size="sm" color="secondary" iconLeading={BellRinging01} onClick={sendDigestNow} isDisabled={perm !== "granted"}>
                                            Send digest now
                                        </Button>
                                        {digestNote && <span className="text-xs text-tertiary">{digestNote}</span>}
                                    </div>
                                </div>
                            )}
                        </div>
                    </SettingsSection>

                    {/* Categories */}
                    <SettingsSection
                        title="Event categories"
                        description={`${enabledCount} of ${CATEGORIES.length} enabled${
                            activePreset !== "custom" ? ` · ${PRESETS.find((p) => p.id === activePreset)?.label} preset` : " · Custom mix"
                        }`}
                    >
                        <div className="flex flex-col gap-5">
                            <div className="flex flex-wrap gap-1.5">
                                {PRESETS.map((p) => (
                                    <button
                                        key={p.id}
                                        type="button"
                                        title={p.description}
                                        onClick={() => applyPreset(p.id)}
                                        disabled={!notif.desktopEnabled}
                                        className={cx(
                                            "rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-40",
                                            activePreset === p.id ? "bg-[var(--brand)] text-white" : "text-secondary hover:brightness-110",
                                        )}
                                        style={
                                            activePreset === p.id
                                                ? undefined
                                                : {
                                                      background: "var(--surface-2)",
                                                      border: "1px solid var(--c-border)",
                                                  }
                                        }
                                    >
                                        {p.label}
                                    </button>
                                ))}
                                {activePreset === "custom" && (
                                    <Badge size="sm" color="brand" type="pill-color">
                                        Custom
                                    </Badge>
                                )}
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                                <div className="min-w-[200px] flex-1">
                                    <Input aria-label="Filter notification events" value={filter} onChange={setFilter} placeholder="Filter events…" icon={SearchMd} />
                                </div>
                                {(["all", "agents", "work", "system"] as const).map((g) => (
                                    <button
                                        key={g}
                                        type="button"
                                        onClick={() => setGroupFilter(g)}
                                        className={cx(
                                            "rounded-lg px-3 py-2 text-xs font-medium capitalize transition",
                                            groupFilter === g ? "text-primary" : "text-tertiary hover:text-secondary",
                                        )}
                                        style={{
                                            background: groupFilter === g ? "var(--surface-2)" : "transparent",
                                            border: groupFilter === g ? "1px solid var(--c-border)" : "1px solid transparent",
                                        }}
                                    >
                                        {g === "all" ? "All" : GROUP_META[g].label}
                                    </button>
                                ))}
                            </div>

                            <div className={cx("flex flex-col gap-5", !notif.desktopEnabled && "opacity-50")}>
                                {(Object.keys(GROUP_META) as CategoryGroup[]).map((group) => {
                                    const items = byGroup[group];
                                    if (items.length === 0) return null;
                                    const onCount = items.filter((c) => notif.categories?.[c.key] === true).length;
                                    const allOn = onCount === items.length;
                                    return (
                                        <div key={group}>
                                            <div className="mb-2 flex items-center justify-between gap-3">
                                                <div>
                                                    <p className="text-xs font-semibold tracking-wider text-quaternary uppercase">{GROUP_META[group].label}</p>
                                                    <p className="text-xs text-tertiary">{GROUP_META[group].description}</p>
                                                </div>
                                                <Button
                                                    size="sm"
                                                    color="tertiary"
                                                    isDisabled={!notif.desktopEnabled}
                                                    onClick={() => setGroupEnabled(group, !allOn)}
                                                >
                                                    {allOn ? "Disable group" : "Enable group"}
                                                </Button>
                                            </div>
                                            <div className="overflow-hidden rounded-xl" style={{ border: "1px solid var(--c-border)" }}>
                                                {items.map((c, i) => (
                                                    <div
                                                        key={c.key}
                                                        className={cx(
                                                            "flex items-center justify-between gap-4 px-4 py-3.5",
                                                            i > 0 && "border-t border-secondary",
                                                        )}
                                                        style={{ background: "var(--surface-2)" }}
                                                    >
                                                        <div className="min-w-0">
                                                            <div className="flex flex-wrap items-center gap-1.5">
                                                                <p className="text-sm font-medium text-primary">{c.label}</p>
                                                                {c.critical && (
                                                                    <Badge size="sm" color="warning" type="pill-color">
                                                                        Critical
                                                                    </Badge>
                                                                )}
                                                                <HelpTooltip text={c.help} />
                                                            </div>
                                                            <p className="mt-0.5 text-xs text-tertiary">{c.help}</p>
                                                        </div>
                                                        <Toggle
                                                            aria-label={`Enable ${c.label} notifications`}
                                                            isSelected={notif.categories?.[c.key] === true}
                                                            isDisabled={!notif.desktopEnabled}
                                                            onChange={(v) => actions.setSetting(`notifications.categories.${c.key}`, v)}
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                                {filtered.length === 0 && <p className="py-6 text-center text-sm text-tertiary">No events match that filter.</p>}
                            </div>
                        </div>
                    </SettingsSection>
                </div>

            </div>
        </div>
    );
};
