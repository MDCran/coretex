"use client";

// Coretex Relay — Terminal Profiles settings (§6).
// Profiles are an ARRAY collection in CoretexConfig, so every mutation computes
// the WHOLE updated array and calls actions.updateSettings({ profiles }).
// Default profile is startup.defaultProfileId — new tabs use it.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { CoretexConfig } from "@repo/coretex/types";
import { CheckCircle, Copy01, Plus, Star01, Terminal, Trash01 } from "@untitledui/icons";
import { useConfirm } from "@/components/application/confirm-dialog/confirm-dialog";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { RichSelect } from "@/components/base/select/rich-select";
import { Toggle } from "@/components/base/toggle/toggle";
import { cx } from "@/utils/cx";
import { ColorPicker } from "../../ui/color-picker";
import type { CoretexActions, CoretexState } from "../../use-coretex";
import { SettingsSection } from "../controls";
import { SettingsPageHeader, SettingsStatusBadge } from "../settings-shell";

type TerminalProfile = CoretexConfig["profiles"][number];

interface ProfilesPageProps {
    settings: CoretexConfig;
    state: CoretexState;
    actions: CoretexActions;
}

const FONT_WEIGHT_OPTIONS: { label: string; value: string }[] = [
    { label: "Normal", value: "normal" },
    { label: "Medium", value: "medium" },
    { label: "Bold", value: "bold" },
];

const CURSOR_SHAPE_OPTIONS: { label: string; value: string }[] = [
    { label: "Bar", value: "bar" },
    { label: "Block", value: "block" },
    { label: "Underline", value: "underline" },
];

function makeProfile(seed?: Partial<TerminalProfile>): TerminalProfile {
    const id = `profile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    return {
        id,
        name: seed?.name ?? "New profile",
        commandLine: seed?.commandLine ?? "",
        args: seed?.args ?? "",
        cwd: seed?.cwd ?? "",
        elevated: seed?.elevated ?? false,
        icon: seed?.icon ?? "",
        tabColor: seed?.tabColor ?? null,
        appearance: {
            colorScheme: "Default",
            fontFace: "JetBrains Mono",
            fontSize: 14,
            fontWeight: "normal",
            ligatures: true,
            cursorShape: "bar",
            cursorBlink: true,
            bgOpacity: 100,
            padding: "8",
            ...seed?.appearance,
        },
    };
}

const Field = ({ label, children, className }: { label: string; children: ReactNode; className?: string }) => (
    <label className={cx("flex flex-col gap-1.5", className)}>
        <span className="text-xs font-medium text-secondary">{label}</span>
        {children}
    </label>
);

const ToggleField = ({ label, description, value, onChange }: { label: string; description?: string; value: boolean; onChange: (v: boolean) => void }) => (
    <div className="flex items-center justify-between gap-4 py-2">
        <div className="min-w-0">
            <p className="text-sm font-medium text-primary">{label}</p>
            {description && <p className="mt-0.5 text-xs text-tertiary">{description}</p>}
        </div>
        <Toggle aria-label={label} isSelected={value} onChange={onChange} />
    </div>
);

export const ProfilesPage = ({ settings, actions }: ProfilesPageProps) => {
    const profiles = settings.profiles ?? [];
    const defaultId = settings.startup.defaultProfileId;
    const [selectedId, setSelectedId] = useState<string | null>(defaultId ?? profiles[0]?.id ?? null);
    const deletion = useConfirm();

    useEffect(() => {
        if (selectedId && profiles.some((p) => p.id === selectedId)) return;
        setSelectedId(defaultId && profiles.some((p) => p.id === defaultId) ? defaultId : (profiles[0]?.id ?? null));
    }, [profiles, selectedId, defaultId]);

    // Ensure there is always at least one profile, and a valid default.
    useEffect(() => {
        if (profiles.length === 0) {
            const p = makeProfile({ name: "Default" });
            actions.updateSettings({ profiles: [p] });
            actions.setSetting("startup.defaultProfileId", p.id);
            setSelectedId(p.id);
            return;
        }
        if (!defaultId || !profiles.some((p) => p.id === defaultId)) {
            actions.setSetting("startup.defaultProfileId", profiles[0].id);
        }
        // intentionally omit settings.startup — we only react to profile list / default id
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [profiles, defaultId, actions]);

    const selected = profiles.find((p) => p.id === selectedId) ?? null;
    const isDefault = selected != null && selected.id === defaultId;

    const schemeOptions: { label: string; value: string }[] = [
        { label: "Default", value: "Default" },
        ...(settings.colorSchemes ?? []).map((s) => ({ label: s.name, value: s.name })),
    ];

    const addProfile = () => {
        const p = makeProfile();
        actions.updateSettings({ profiles: [...profiles, p] });
        setSelectedId(p.id);
    };

    const duplicateSelected = () => {
        if (!selected) return;
        const p = makeProfile({ ...selected, name: `${selected.name} copy` });
        actions.updateSettings({ profiles: [...profiles, p] });
        setSelectedId(p.id);
    };

    const update = (patch: Partial<TerminalProfile>) => {
        if (!selected) return;
        const next = profiles.map((p) => (p.id === selected.id ? { ...p, ...patch } : p));
        actions.updateSettings({ profiles: next });
    };

    const updateAppearance = (patch: Partial<TerminalProfile["appearance"]>) => {
        if (!selected) return;
        const next = profiles.map((p) => (p.id === selected.id ? { ...p, appearance: { ...p.appearance, ...patch } } : p));
        actions.updateSettings({ profiles: next });
    };

    const setAsDefault = () => {
        if (!selected) return;
        actions.setSetting("startup.defaultProfileId", selected.id);
    };

    const removeSelected = () => {
        if (!selected) return;
        const next = profiles.filter((p) => p.id !== selected.id);
        const nextDefault = defaultId === selected.id ? (next[0]?.id ?? null) : defaultId;
        actions.updateSettings({
            profiles: next,
            startup: { ...settings.startup, defaultProfileId: nextDefault },
        });
        setSelectedId(next[0]?.id ?? null);
    };

    const requestRemoveSelected = () => {
        if (!selected || profiles.length <= 1) return;
        deletion.confirm({
            title: `Delete ${selected.name || "this profile"}?`,
            description: "This permanently removes the shell launch configuration. Other profiles and color schemes are not affected.",
            confirmLabel: "Delete profile",
            onConfirm: removeSelected,
        });
    };

    return (
        <div className="flex flex-col gap-6">
            {deletion.dialog}
            <SettingsPageHeader
                icon={Terminal}
                title="Profiles"
                subtitle="Shell launch configs for new tabs. The default profile is used whenever you open a terminal."
                badges={<SettingsStatusBadge label={`${profiles.length} profile${profiles.length === 1 ? "" : "s"}`} color="gray" />}
                actions={
                    <Button size="sm" color="primary" iconLeading={Plus} onClick={addProfile}>
                        New profile
                    </Button>
                }
            />

            <div className="grid grid-cols-1 items-start gap-6 @5xl/settings-page:grid-cols-[18rem_minmax(0,1fr)] @5xl/settings-page:gap-8">
                <SettingsSection title="Your profiles" description="Select a profile to edit it. The star marks the default.">
                    <div className="flex flex-col gap-4">
                        <div className="flex flex-col gap-1">
                            {profiles.length === 0 ? (
                                <p
                                    className="rounded-lg px-3 py-6 text-center text-xs text-quaternary"
                                    style={{ background: "var(--surface-2)", border: "1px dashed var(--c-border)" }}
                                >
                                    No profiles yet. Create one to get started.
                                </p>
                            ) : (
                                profiles.map((p) => {
                                    const active = p.id === selectedId;
                                    const def = p.id === defaultId;
                                    return (
                                        <button
                                            key={p.id}
                                            type="button"
                                            onClick={() => setSelectedId(p.id)}
                                            className={cx(
                                                "flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition",
                                                active ? "font-semibold" : "font-medium hover:bg-[var(--surface-2)]",
                                            )}
                                            style={{
                                                background: active ? "var(--sidebar-active-bg)" : undefined,
                                                color: active ? "var(--sidebar-active-fg)" : "var(--c-text-secondary)",
                                                border: active ? "1px solid var(--c-border)" : "1px solid transparent",
                                            }}
                                        >
                                            <span
                                                aria-hidden
                                                className="size-2.5 shrink-0 rounded-full"
                                                style={{ background: p.tabColor || "var(--brand)", border: "1px solid var(--c-border)" }}
                                            />
                                            <span className="min-w-0 flex-1 break-words text-sm leading-5" title={p.name || "Untitled profile"}>
                                                {p.name || "Untitled profile"}
                                            </span>
                                            {def && (
                                                <span title="Default profile" className="shrink-0">
                                                    <Star01 className="size-3.5" style={{ color: "var(--brand)" }} />
                                                </span>
                                            )}
                                            {p.elevated && <span className="shrink-0 text-[10px] text-quaternary uppercase">admin</span>}
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </SettingsSection>

                <SettingsSection
                    title={selected?.name || "Profile editor"}
                    description={
                        selected
                            ? "Configure how this shell launches and looks in a new terminal tab."
                            : "Choose a profile to configure its command, working directory, and appearance."
                    }
                >
                    {!selected ? (
                        <div className="flex h-full min-h-48 flex-col items-center justify-center gap-3 text-center">
                            <p className="text-sm font-medium text-secondary">No profile selected</p>
                            <p className="max-w-xs text-xs text-tertiary">
                                Create a profile to configure the command, working directory, and terminal appearance.
                            </p>
                            <Button size="sm" color="primary" iconLeading={Plus} onClick={addProfile}>
                                New profile
                            </Button>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-6">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    {isDefault && (
                                        <Badge size="sm" color="brand">
                                            Default profile
                                        </Badge>
                                    )}
                                </div>
                                <div className="flex flex-wrap items-center justify-end gap-2">
                                    {!isDefault && (
                                        <Button size="sm" color="secondary" iconLeading={CheckCircle} onClick={setAsDefault}>
                                            Set as default
                                        </Button>
                                    )}
                                    <Button size="sm" color="secondary" iconLeading={Copy01} onClick={duplicateSelected}>
                                        Duplicate
                                    </Button>
                                    <Button
                                        size="sm"
                                        color="primary-destructive"
                                        iconLeading={Trash01}
                                        onClick={requestRemoveSelected}
                                        isDisabled={profiles.length <= 1}
                                    >
                                        Delete
                                    </Button>
                                </div>
                            </div>

                            <div className="flex flex-col gap-4">
                                <h3 className="text-xs font-semibold tracking-wide text-quaternary uppercase">General</h3>
                                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                    <Field label="Name" className="sm:col-span-2">
                                        <Input aria-label="Profile name" value={selected.name} placeholder="My shell" onChange={(v: string) => update({ name: v })} />
                                    </Field>
                                    <Field label="Command line" className="sm:col-span-2">
                                        <Input
                                            aria-label="Command line"
                                            value={selected.commandLine}
                                            placeholder="powershell.exe · bash · cmd.exe (empty = system default)"
                                            onChange={(v: string) => update({ commandLine: v })}
                                        />
                                    </Field>
                                    <Field label="Arguments">
                                        <Input aria-label="Command arguments" value={selected.args} placeholder="-NoLogo" onChange={(v: string) => update({ args: v })} />
                                    </Field>
                                    <Field label="Starting directory">
                                        <Input aria-label="Starting directory" value={selected.cwd} placeholder="~" onChange={(v: string) => update({ cwd: v })} />
                                    </Field>
                                    <Field label="Tab color">
                                        <ColorPicker
                                            value={selected.tabColor ?? ""}
                                            onChange={(v: string) => update({ tabColor: v.trim() === "" ? null : v })}
                                        />
                                    </Field>
                                    <Field label="Icon">
                                        <Input aria-label="Profile icon" value={selected.icon} placeholder="terminal" onChange={(v: string) => update({ icon: v })} />
                                    </Field>
                                </div>
                                <div className="[&>*+*]:border-t [&>*+*]:border-[color:var(--c-divider)]">
                                    <ToggleField
                                        label="Run as administrator"
                                        description="Launches the shell elevated and shows the admin shield."
                                        value={selected.elevated}
                                        onChange={(v) => update({ elevated: v })}
                                    />
                                    <ToggleField
                                        label="Use as default profile"
                                        description="New terminal tabs and windows open with this profile."
                                        value={isDefault}
                                        onChange={(v) => {
                                            if (v) setAsDefault();
                                        }}
                                    />
                                </div>
                            </div>

                            <div className="flex flex-col gap-4">
                                <h3 className="text-xs font-semibold tracking-wide text-quaternary uppercase">Appearance</h3>
                                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                    <Field label="Color scheme">
                                        <RichSelect
                                            aria-label="Color scheme"
                                            options={schemeOptions}
                                            value={selected.appearance.colorScheme}
                                            onChange={(e) => updateAppearance({ colorScheme: e.target.value })}
                                        />
                                    </Field>
                                    <Field label="Font face">
                                        <Input
                                            aria-label="Font face"
                                            value={selected.appearance.fontFace}
                                            placeholder="JetBrains Mono"
                                            onChange={(v: string) => updateAppearance({ fontFace: v })}
                                        />
                                    </Field>
                                    <Field label="Font size">
                                        <Input
                                            aria-label="Font size"
                                            type="number"
                                            value={String(selected.appearance.fontSize)}
                                            onChange={(v: string) => {
                                                const n = Number(v);
                                                if (Number.isNaN(n)) return;
                                                updateAppearance({ fontSize: n });
                                            }}
                                        />
                                    </Field>
                                    <Field label="Font weight">
                                        <RichSelect
                                            aria-label="Font weight"
                                            options={FONT_WEIGHT_OPTIONS}
                                            value={selected.appearance.fontWeight}
                                            onChange={(e) => updateAppearance({ fontWeight: e.target.value as TerminalProfile["appearance"]["fontWeight"] })}
                                        />
                                    </Field>
                                    <Field label="Cursor shape">
                                        <RichSelect
                                            aria-label="Cursor shape"
                                            options={CURSOR_SHAPE_OPTIONS}
                                            value={selected.appearance.cursorShape}
                                            onChange={(e) => updateAppearance({ cursorShape: e.target.value as TerminalProfile["appearance"]["cursorShape"] })}
                                        />
                                    </Field>
                                    <Field label="Background opacity (%)">
                                        <Input
                                            aria-label="Background opacity percentage"
                                            type="number"
                                            value={String(selected.appearance.bgOpacity)}
                                            onChange={(v: string) => {
                                                const n = Number(v);
                                                if (Number.isNaN(n)) return;
                                                updateAppearance({ bgOpacity: Math.max(0, Math.min(100, n)) });
                                            }}
                                        />
                                    </Field>
                                </div>
                                <div className="[&>*+*]:border-t [&>*+*]:border-[color:var(--c-divider)]">
                                    <ToggleField
                                        label="Font ligatures"
                                        value={selected.appearance.ligatures}
                                        onChange={(v) => updateAppearance({ ligatures: v })}
                                    />
                                    <ToggleField
                                        label="Cursor blink"
                                        value={selected.appearance.cursorBlink}
                                        onChange={(v) => updateAppearance({ cursorBlink: v })}
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                </SettingsSection>
            </div>
        </div>
    );
};
