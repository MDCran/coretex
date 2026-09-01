// @ts-nocheck
"use client";

// Coretex settings — Terminal autocomplete. Fish-style inline ghost text plus a
// completion dropdown, powered by the pure-TS CompletionEngine. Every row is
// schema-driven and round-trips through actions.setSetting against the live
// CoretexConfig at autocomplete.*. Provider toggles + ghost/dropdown surfaces
// gate off the master switch; HelpTooltips clarify the non-obvious controls.

import { MessageTextSquare02 } from "@untitledui/icons";
import { SettingsSection, SettingToggle, SettingSelect, SettingSlider } from "../controls";
import type { SettingsPageProps } from "../settings-window";
import { SettingsPageHeader, SettingsStatusBadge, SettingsTwoColumn } from "../settings-shell";

export const AutocompletePage = ({ settings, actions }: SettingsPageProps) => {
    const ac = settings.autocomplete;
    const enabled = ac?.enabled === true;
    const disabledReason = enabled ? undefined : "Enable autocomplete to change this.";
    // Builtins always run in the engine; count only the user-toggleable sources.
    const activeSources = [
        ac?.providers?.history && "history",
        ac?.providers?.path && "paths",
        ac?.providers?.specs && "specs",
        ac?.providers?.pathExecutables && "PATH",
    ].filter(Boolean) as string[];
    const providerCount = activeSources.length;

    const surfaceSection = (
        <SettingsSection title="Autocomplete" description="Turn terminal autocomplete on and choose how suggestions surface.">
            <SettingToggle
                settings={settings}
                actions={actions}
                path="autocomplete.enabled"
                label="Enable autocomplete"
                description="Compute completions as you type and offer them inline or in a dropdown."
            />
            <SettingToggle
                settings={settings}
                actions={actions}
                path="autocomplete.ghostText"
                label="Inline ghost text"
                description="Show the top suggestion as dimmed text after your cursor — accept it with Right arrow or End."
                disabled={!enabled}
                disabledReason={disabledReason}
            />
            <SettingToggle
                settings={settings}
                actions={actions}
                path="autocomplete.dropdown"
                label="Completion dropdown"
                description="Show a list of ranked completions you can navigate with the arrow keys."
                disabled={!enabled}
                disabledReason={disabledReason}
            />
        </SettingsSection>
    );

    const providersSection = (
        <SettingsSection title="Providers" description="Which sources feed the completion engine. History is the most reliable; AI is off by default.">
            <SettingToggle
                settings={settings}
                actions={actions}
                path="autocomplete.providers.history"
                label="Command history"
                description="Fish-style: the most recent matching command becomes the top suggestion."
                disabled={!enabled}
                disabledReason={disabledReason}
            />
            <SettingToggle
                settings={settings}
                actions={actions}
                path="autocomplete.providers.path"
                label="Paths & files"
                description="Complete file and folder names from the current directory."
                disabled={!enabled}
                disabledReason={disabledReason}
            />
            <SettingToggle
                settings={settings}
                actions={actions}
                path="autocomplete.providers.specs"
                label="Command specs"
                description="Complete flags, subcommands, and arguments from the built-in command spec database."
                disabled={!enabled}
                disabledReason={disabledReason}
            />
            <SettingToggle
                settings={settings}
                actions={actions}
                path="autocomplete.providers.pathExecutables"
                label="Executables on PATH"
                description="Complete the first word from the live executable scan of your PATH."
                disabled={!enabled}
                disabledReason={disabledReason}
            />
        </SettingsSection>
    );

    const behaviorSection = (
        <SettingsSection title="Behavior" description="How autocomplete interacts with the shell and how quickly it reacts.">
            <SettingSelect
                settings={settings}
                actions={actions}
                path="autocomplete.nativeTabFallback"
                label="Native Tab fallback"
                description="When to let Tab fall through to the shell's own completion instead of accepting a suggestion."
                disabled={!enabled}
                disabledReason={disabledReason}
                options={[
                    { label: "Never (always use autocomplete)", value: "never" },
                    { label: "When there's no suggestion", value: "when-no-suggestion" },
                    { label: "Always (Tab is the shell's)", value: "always" },
                ]}
            />
            <SettingSlider
                settings={settings}
                actions={actions}
                path="autocomplete.debounceMs"
                label="Debounce"
                description="How long to wait after a keystroke before recomputing suggestions."
                disabled={!enabled}
                disabledReason={disabledReason}
                min={0}
                max={500}
                step={10}
                unit="ms"
            />
        </SettingsSection>
    );

    return (
        <div className="flex flex-col gap-6">
            <SettingsPageHeader
                icon={MessageTextSquare02}
                title="Autocomplete"
                subtitle="Fish-style inline suggestions and a completion dropdown as you type in the terminal."
                badges={
                    enabled ? (
                        <SettingsStatusBadge
                            label={providerCount > 0 ? `On · ${activeSources.join(" · ")}` : "On · builtins only"}
                            color="success"
                        />
                    ) : (
                        <SettingsStatusBadge label="Disabled" color="gray" />
                    )
                }
            />
            <SettingsTwoColumn
                left={
                    <>
                        {surfaceSection}
                        {behaviorSection}
                    </>
                }
                right={providersSection}
            />
        </div>
    );
};
