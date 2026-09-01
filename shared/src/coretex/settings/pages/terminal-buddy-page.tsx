// @ts-nocheck
"use client";

// Coretex settings — Terminal Buddy. The shell-aware command assistant that
// attaches to terminals (suggest commands, recover from failures, probe the
// environment). Every row is schema-driven and round-trips through
// actions.setSetting against the live CoretexConfig at terminalBuddy.*. The
// default-provider picker is built from the user's configured AI providers so
// it never hardcodes a list; HelpTooltips clarify the non-obvious controls.

import { MessageSmileCircle } from "@untitledui/icons";
import type { ReactNode } from "react";
import { cx } from "@/utils/cx";
import { SettingsSection, SettingToggle, SettingSelect, SettingNumber } from "../controls";
import { HelpTooltip } from "../../ui/help-tooltip";
import { SettingsProviderSelect, SettingsModelSelect } from "../rich-selects";
import { isProviderReady } from "../../provider-meta";
import type { SettingsPageProps } from "../settings-window";
import { SettingsPageHeader, SettingsStatusBadge, SettingsTwoColumn } from "../settings-shell";

/**
 * A custom settings row that mirrors the controls' Row layout but exposes a
 * HelpTooltip beside the label and an arbitrary control on the right. Used for
 * the provider Select, which isn't expressible through SettingSelect (its
 * options are derived from live state, not a static enum).
 */
const TooltipRow = ({ label, help, description, children }: { label: string; help: string; description?: string; children: ReactNode }) => (
    <div className="flex items-center justify-between gap-6 py-4 first:pt-0 last:pb-0">
        <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-medium text-primary">
                {label}
                <HelpTooltip text={help} />
            </p>
            {description && <p className="mt-0.5 text-xs text-tertiary">{description}</p>}
        </div>
        <div className="shrink-0">{children}</div>
    </div>
);

export const TerminalBuddyPage = ({ settings, state, actions }: SettingsPageProps) => {
    const tb = settings.terminalBuddy;
    const enabled = tb?.enabled === true;

    // Build the default-provider options from the user's configured providers.
    // Always offer "inherit the global default" as the first, empty-string choice.
    const readyProviders = (settings.aiProviders ?? []).filter((provider) =>
        isProviderReady(provider, state.health.find((health) => health.provider === provider.provider)),
    );
    const currentProvider = String(tb?.defaultProvider ?? "");
    const currentModel = String(tb?.defaultModel ?? "");

    const modelPool = (state.models ?? []).filter((m) =>
        currentProvider ? m.provider === currentProvider : readyProviders.some((p) => p.provider === m.provider),
    );

    const disabledReason = enabled ? undefined : "Enable Terminal Buddy to change this.";

    const mainSection = (
            <SettingsSection title="Terminal Buddy" description="Turn the assistant on and choose how it behaves by default in every terminal.">
                <SettingToggle
                    settings={settings}
                    actions={actions}
                    path="terminalBuddy.enabled"
                    label="Enable Terminal Buddy"
                    description="Attach the command assistant to your terminals."
                />
                <SettingSelect
                    settings={settings}
                    actions={actions}
                    path="terminalBuddy.defaultMode"
                    label="Default mode"
                    description="Suggest waits for review. Auto runs only when the global Security policy permits it, and still obeys every command guardrail."
                    disabled={!enabled}
                    disabledReason={disabledReason}
                    options={[
                        { label: "Suggest", value: "suggest" },
                        { label: "Auto", value: "auto" },
                    ]}
                />
                <SettingSelect
                    settings={settings}
                    actions={actions}
                    path="terminalBuddy.buddyBarPosition"
                    label="Buddy bar position"
                    description="Where the assistant's bar docks relative to the terminal."
                    disabled={!enabled}
                    disabledReason={disabledReason}
                    options={[
                        { label: "Bottom", value: "bottom" },
                        { label: "Side", value: "side" },
                    ]}
                />
            </SettingsSection>
    );

    const modelSection = (
            <SettingsSection title="Model" description="Which model the buddy reasons with. Leave on the global default to follow your main model.">
                <TooltipRow
                    label="Default provider"
                    help="The AI provider Terminal Buddy uses by default. Only providers you've configured in AI providers appear here. Leave on Use global default to follow your main model's provider."
                    description="Choose from your configured AI providers, or inherit the global default."
                >
                    <div className={cx(!enabled && "pointer-events-none opacity-50")} title={disabledReason}>
                        <SettingsProviderSelect
                            value={currentProvider}
                            onChange={(v) => actions.setSetting("terminalBuddy.defaultProvider", v)}
                            providers={readyProviders}
                            includeInherit
                            readyOnly
                            disabled={!enabled}
                        />
                    </div>
                </TooltipRow>
                <TooltipRow
                    label="Default model"
                    help="The specific model Terminal Buddy uses by default. Leave on Use provider default to follow the chosen provider's default model. The per-terminal model picker in the buddy bar still overrides this for individual terminals."
                    description="Pick a model from the chosen provider, or inherit the provider's default."
                >
                    <div className={cx(!enabled && "pointer-events-none opacity-50")} title={disabledReason}>
                        <SettingsModelSelect
                            value={currentModel}
                            onChange={(v) => actions.setSetting("terminalBuddy.defaultModel", v)}
                            models={modelPool}
                            includeInherit
                            pinnedId={currentModel}
                            disabled={!enabled}
                        />
                    </div>
                </TooltipRow>
            </SettingsSection>
    );

    const behaviorSection = (
            <SettingsSection title="Behavior" description="How aggressively the buddy acts, and the safety rails around it.">
                <SettingNumber
                    settings={settings}
                    actions={actions}
                    path="terminalBuddy.maxRetries"
                    label="Max retries"
                    description="How many times the buddy may automatically retry a failing step before handing it back to you."
                    disabled={!enabled}
                    disabledReason={disabledReason}
                    min={0}
                    max={10}
                />
                <SettingToggle
                    settings={settings}
                    actions={actions}
                    path="terminalBuddy.webSearch"
                    label="Web-search fallback"
                    description="Let the buddy search the web when it can't resolve a command or error on its own."
                    disabled={!enabled}
                    disabledReason={disabledReason}
                />
                <SettingToggle
                    settings={settings}
                    actions={actions}
                    path="terminalBuddy.alwaysConfirmDestructive"
                    label="Always confirm destructive commands"
                    description="Require explicit confirmation for risky commands even in Auto mode. Built-in catastrophic-command blocks can never be approved around."
                    disabled={!enabled}
                    disabledReason={disabledReason}
                />
                <SettingToggle
                    settings={settings}
                    actions={actions}
                    path="terminalBuddy.probeOnStart"
                    label="Probe environment on start"
                    description="Inspect the shell, OS, and available tools when a terminal opens so suggestions fit your environment."
                    disabled={!enabled}
                    disabledReason={disabledReason}
                />
            </SettingsSection>
    );

    return (
        <div className="flex flex-col gap-6">
            <SettingsPageHeader
                icon={MessageSmileCircle}
                title="Terminal Buddy"
                subtitle="A shell-aware assistant that suggests commands, recovers from failures, and learns your environment."
                badges={
                    <>
                        {enabled ? (
                            <SettingsStatusBadge label={tb?.defaultMode === "auto" ? "Auto mode" : "Suggest mode"} color="success" />
                        ) : (
                            <SettingsStatusBadge label="Disabled" color="gray" />
                        )}
                        <SettingsStatusBadge
                            label={settings.security.autonomousTerminal === "off" ? "Security blocks automation" : settings.security.autonomousTerminal === "approval" ? "Security requires approval" : "Security allows auto"}
                            color={settings.security.autonomousTerminal === "off" ? "gray" : settings.security.autonomousTerminal === "approval" ? "warning" : "success"}
                        />
                    </>
                }
            />
            <SettingsTwoColumn
                left={
                    <>
                        {mainSection}
                        {behaviorSection}
                    </>
                }
                right={modelSection}
            />
        </div>
    );
};
