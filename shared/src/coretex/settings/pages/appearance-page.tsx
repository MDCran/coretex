"use client";

// Coretex — Appearance settings (§5). Application theme, tab strip, window chrome,
// the notification-area tray, and the Coretex sidebar/opacity surface. Every row
// persists through the schema-driven controls; the master theme row additionally
// drives the live ThemeProvider so the whole app flips instantly.
import { useEffect } from "react";
import type { CoretexConfig } from "@repo/coretex/types";
import { Palette } from "@untitledui/icons";
import { ThemeToggle, useTheme } from "../../theme";
import { ColorPicker } from "../../ui/color-picker";
import type { CoretexActions, CoretexState } from "../../use-coretex";
import { BadgeColorSettings } from "../badge-colors";
import { SettingSelect, SettingSlider, SettingToggle, SettingsSection } from "../controls";
import { SettingsPageHeader, SettingsStatusBadge, SettingsTwoColumn } from "../settings-shell";

interface AppearancePageProps {
    settings: CoretexConfig;
    state: CoretexState;
    actions: CoretexActions;
}

export const AppearancePage = ({ settings, actions }: AppearancePageProps) => {
    const t = useTheme();

    // Bridge the segmented ThemeToggle (which only flips the live ThemeProvider via
    // useTheme().setMode) back into the persisted schema path. Whenever the live mode
    // changes and no longer matches the stored value, mirror it so the master theme row
    // keeps persisting appearance.application.theme exactly as the old NativeSelect did.
    useEffect(() => {
        if (settings.appearance.application.theme !== t.mode) {
            actions.setSetting("appearance.application.theme", t.mode);
        }
    }, [t.mode, settings.appearance.application.theme, actions]);

    const acrylicOn = settings.appearance.tabs.acrylic === true;
    const trayIconOn = settings.appearance.tray.alwaysShowIcon === true;

    const leftColumn = (
        <>
            <SettingsSection title="Application" description="Theme, accent color, and where newly opened tabs appear.">
                {/* Custom master theme row — the brand segmented ThemeToggle flips the
                    live ThemeProvider, and the effect above mirrors it into the persisted
                    appearance.application.theme so the whole shell updates immediately. */}
                <div className="flex flex-wrap items-center justify-between gap-4 py-4 first:pt-0">
                    <div className="min-w-0">
                        <p className="text-sm font-medium text-primary">Application theme</p>
                        <p className="mt-0.5 text-xs text-tertiary">The master light/dark toggle — drives the whole app instantly.</p>
                    </div>
                    <div className="shrink-0">
                        <ThemeToggle />
                    </div>
                </div>

                <SettingSelect
                    settings={settings}
                    actions={actions}
                    path="appearance.application.newTabPosition"
                    label="New tab position"
                    options={[
                        { label: "After the last tab", value: "end" },
                        { label: "After current tab", value: "after-current" },
                        { label: "At the start", value: "start" },
                    ]}
                />

                {/* Accent color — full-width so swatches + hex aren't crushed beside the label. */}
                <div className="flex flex-col gap-3 py-4">
                    <div className="min-w-0">
                        <p className="text-sm font-medium text-primary">Accent color</p>
                        <p className="mt-0.5 text-xs text-tertiary">Brand highlight across the app. Defaults to Coretex red when cleared.</p>
                    </div>
                    <ColorPicker
                        value={settings.appearance.application.accent ?? ""}
                        onChange={(value) => actions.setSetting("appearance.application.accent", value)}
                        allowNone
                    />
                </div>
            </SettingsSection>

            <SettingsSection title="Tabs" description="Visibility, sizing, and visual treatment of the terminal tab strip.">
                <SettingToggle settings={settings} actions={actions} path="appearance.tabs.alwaysShow" label="Always show the tab bar" />
                <SettingToggle settings={settings} actions={actions} path="appearance.tabs.showInFullScreen" label="Show tabs in full screen" />
                <SettingToggle
                    settings={settings}
                    actions={actions}
                    path="appearance.tabs.acrylic"
                    label="Acrylic tab row"
                    description="Translucent, blurred background behind the tab strip."
                />
                <SettingSelect
                    settings={settings}
                    actions={actions}
                    path="appearance.tabs.widthMode"
                    label="Tab width"
                    options={[
                        { label: "Equal", value: "equal" },
                        { label: "Title length", value: "title" },
                        { label: "Compact", value: "compact" },
                    ]}
                />
                <SettingToggle settings={settings} actions={actions} path="appearance.tabs.titleFromActiveTerminal" label="Title from active terminal" />
            </SettingsSection>

            <SettingsSection title="Window" description="Desktop window chrome, focus behavior, and animation preferences.">
                <SettingToggle
                    settings={settings}
                    actions={actions}
                    path="appearance.window.hideTitleBar"
                    label="Hide the title bar"
                    description="Desktop app only — hides the window menu bar."
                />
                <SettingToggle
                    settings={settings}
                    actions={actions}
                    path="appearance.window.alwaysOnTop"
                    label="Always on top"
                    description="Desktop app only — keeps the Coretex window above other windows."
                />
                <SettingToggle
                    settings={settings}
                    actions={actions}
                    path="appearance.window.paneAnimations"
                    label="Pane animations"
                    description="Turn off to disable transition animations across the app."
                />
                <SettingToggle
                    settings={settings}
                    actions={actions}
                    path="appearance.window.autoHideOnBlur"
                    label="Auto-hide on blur"
                    description="Desktop app only — hide the window when it loses focus."
                />
                <SettingToggle
                    settings={settings}
                    actions={actions}
                    path="appearance.window.adminShield"
                    label="Admin shield"
                    description="Visual marker when a window is running elevated."
                />
                <SettingToggle
                    settings={settings}
                    actions={actions}
                    path="appearance.window.acrylicWhenUnfocused"
                    label="Acrylic when unfocused"
                    disabled={!acrylicOn}
                    disabledReason="Requires acrylic tab row"
                />
            </SettingsSection>
        </>
    );

    const rightColumn = (
        <>
            <SettingsSection title="Notification area" description="Control the desktop tray icon and minimize behavior.">
                <SettingToggle settings={settings} actions={actions} path="appearance.tray.alwaysShowIcon" label="Always show the tray icon" />
                <SettingToggle
                    settings={settings}
                    actions={actions}
                    path="appearance.tray.minimizeToTray"
                    label="Minimize to the tray"
                    disabled={!trayIconOn}
                    disabledReason="Requires the tray icon"
                />
            </SettingsSection>

            <SettingsSection title="Sidebar" description="Layout and density of the project sidebar.">
                <SettingSelect
                    settings={settings}
                    actions={actions}
                    path="appearance.coretex.sidebarDensity"
                    label="Density"
                    description="Compact tightens row heights and spacing to fit more in view."
                    options={[
                        { label: "Comfortable", value: "comfortable" },
                        { label: "Compact", value: "compact" },
                    ]}
                />
                <SettingToggle
                    settings={settings}
                    actions={actions}
                    path="appearance.coretex.sidebarShowProjects"
                    label="Show project list"
                    description="Display the list of projects in the sidebar."
                />
                <SettingSlider
                    settings={settings}
                    actions={actions}
                    path="appearance.coretex.sidebarWidth"
                    label="Sidebar width"
                    min={160}
                    max={420}
                    unit="px"
                />
                <SettingSelect
                    settings={settings}
                    actions={actions}
                    path="appearance.coretex.sidebarCollapse"
                    label="Collapse mode"
                    options={[
                        { label: "Expand on hover", value: "hover" },
                        { label: "Always expanded", value: "expanded" },
                        { label: "Always collapsed", value: "collapsed" },
                        { label: "Manual", value: "manual" },
                    ]}
                />
            </SettingsSection>

            <SettingsSection title="Coretex" description="Status bar visibility and translucent-window effects.">
                <SettingToggle settings={settings} actions={actions} path="appearance.coretex.statusBar" label="Status bar" />
                <SettingSlider
                    settings={settings}
                    actions={actions}
                    path="appearance.coretex.windowOpacity"
                    label="Window opacity"
                    description="Desktop app only — makes the whole window translucent."
                    min={20}
                    max={100}
                    unit="%"
                />
                <SettingSlider
                    settings={settings}
                    actions={actions}
                    path="appearance.coretex.blurRadius"
                    label="Blur radius"
                    min={0}
                    max={64}
                    unit="px"
                    disabled={!acrylicOn}
                    disabledReason="Requires acrylic tab row"
                />
            </SettingsSection>

            <BadgeColorSettings settings={settings} actions={actions} />
        </>
    );

    return (
        <div className="flex flex-col gap-6">
            <SettingsPageHeader
                icon={Palette}
                title="Appearance"
                subtitle="Theme, tabs, window chrome, sidebar density, and accent colors across the app."
                badges={
                    <>
                        <SettingsStatusBadge label={t.mode === "dark" ? "Dark mode" : "Light mode"} color="gray" />
                        {acrylicOn && <SettingsStatusBadge label="Acrylic tabs" color="brand" />}
                    </>
                }
            />
            <SettingsTwoColumn left={leftColumn} right={rightColumn} />
        </div>
    );
};
