"use client";

// Coretex settings — Startup (§2). Scalar keys only, so every row
// is a schema-driven control that round-trips through actions.setSetting.
import type { CoretexConfig } from "@repo/coretex/types";
import { Lightning01 } from "@untitledui/icons";
import type { CoretexActions, CoretexState } from "../../use-coretex";
import { SettingNumber, SettingSelect, SettingText, SettingToggle, SettingsSection } from "../controls";
import { profileRichOption } from "../rich-select-options";
import { SettingsPageHeader, SettingsStatusBadge, SettingsTwoColumn } from "../settings-shell";

export const StartupPage = ({ settings, actions }: { settings: CoretexConfig; state: CoretexState; actions: CoretexActions }) => {
    const profileOptions =
        settings.profiles.length > 0
            ? settings.profiles.map(profileRichOption)
            : [{ label: "No profiles yet", value: "", supportingText: "Create a terminal profile first" }];

    const launchOnLogin = settings.startup.launchOnLogin === true;
    const restoreSession = settings.startup.onStart === "restore";

    const startupSection = (
        <SettingsSection title="Startup behavior" description="Choose what Coretex opens and how new terminal instances behave.">
            <SettingSelect
                settings={settings}
                actions={actions}
                path="startup.defaultProfileId"
                label="Default profile"
                description="The profile opened in new tabs and windows."
                options={profileOptions}
            />
            <SettingSelect
                settings={settings}
                actions={actions}
                path="startup.language"
                label="Language"
                options={[
                    { label: "Use system default", value: "system" },
                    { label: "English", value: "en" },
                ]}
            />
            <SettingSelect
                settings={settings}
                actions={actions}
                path="startup.imeMode"
                label="IME mode"
                options={[
                    { label: "Alphanumeric", value: "alphanumeric" },
                    { label: "Native", value: "native" },
                ]}
            />
            <SettingToggle settings={settings} actions={actions} path="startup.launchOnLogin" label="Launch on login" />
            <SettingSelect
                settings={settings}
                actions={actions}
                path="startup.onStart"
                label="When Terminal starts"
                description="Start fresh or reopen the previous terminal session."
                options={[
                    { label: "Open a new tab", value: "new-tab" },
                    { label: "Restore previous session", value: "restore" },
                ]}
            />
            <SettingSelect
                settings={settings}
                actions={actions}
                path="startup.newInstance"
                label="New instance behavior"
                options={[
                    { label: "Open a new window", value: "window" },
                    { label: "Open a new tab", value: "tab" },
                    { label: "Focus existing", value: "focus" },
                ]}
            />
        </SettingsSection>
    );

    const launchSection = (
        <SettingsSection title="Launch window" description="Initial terminal dimensions and optional command-line arguments.">
            <SettingNumber settings={settings} actions={actions} path="startup.launchCols" label="Launch columns" min={20} max={500} />
            <SettingNumber settings={settings} actions={actions} path="startup.launchRows" label="Launch rows" min={20} max={500} />
            <SettingText settings={settings} actions={actions} path="startup.launchArgs" label="Launch arguments" placeholder="--maximized" />
        </SettingsSection>
    );

    return (
        <div className="flex flex-col gap-6">
            <SettingsPageHeader
                icon={Lightning01}
                title="Startup"
                subtitle="How Coretex opens, which profile it uses, and what happens when you start a new session."
                badges={
                    <>
                        {launchOnLogin && <SettingsStatusBadge label="Launch on login" color="brand" />}
                        {restoreSession && <SettingsStatusBadge label="Restore session" color="success" />}
                    </>
                }
            />
            <SettingsTwoColumn
                left={startupSection}
                right={launchSection}
            />
        </div>
    );
};
