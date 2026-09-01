"use client";

// Coretex Relay — Rendering & compat settings (§9). Graphics backend + text-shaping
// knobs persist straight through to CoretexConfig.rendering. The Maintenance block
// clears local web caches and offers a full reset to defaults via the Brain.
import { useState } from "react";
import type { CoretexConfig } from "@repo/coretex/types";
import { Monitor01, RefreshCcw01, Trash01 } from "@untitledui/icons";
import { useConfirm } from "@/components/application/confirm-dialog/confirm-dialog";
import { Button } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import type { CoretexActions, CoretexState } from "../../use-coretex";
import { SettingSelect, SettingToggle, SettingsSection } from "../controls";
import { SettingsPageHeader, SettingsTwoColumn } from "../settings-shell";

export const RenderingPage = ({ settings, actions }: { settings: CoretexConfig; state: CoretexState; actions: CoretexActions }) => {
    const [keepChecked, setKeepChecked] = useState(true);
    const [cacheNote, setCacheNote] = useState<string | null>(null);
    const [resetNote, setResetNote] = useState<string | null>(null);
    const cacheConfirmation = useConfirm();
    const resetConfirmation = useConfirm();

    const clearCache = () => {
        if (typeof window === "undefined") return;
        try {
            window.localStorage.clear();
            window.sessionStorage.clear();
            setCacheNote("Local cache cleared. Some changes take effect after the next reload.");
        } catch {
            setCacheNote("Could not clear cache — storage is unavailable in this context.");
        }
    };

    const requestClearCache = () => {
        cacheConfirmation.confirm({
            title: "Clear local cache?",
            description: "This clears local and session storage for the app. Settings stored on disk are not affected.",
            confirmLabel: "Clear cache",
            onConfirm: clearCache,
        });
    };

    const resetSettings = () => {
        actions.resetSettings(keepChecked);
        setResetNote("Settings restored to defaults.");
    };

    const requestResetSettings = () => {
        const detail = keepChecked ? "Profiles and custom color schemes will be kept." : "Everything, including profiles and color schemes, will be reset.";
        resetConfirmation.confirm({
            title: "Reset all settings?",
            description: `Every setting returns to its shipped default. ${detail}`,
            confirmLabel: "Reset settings",
            onConfirm: resetSettings,
        });
    };

    const renderingSection = (
        <SettingsSection title="Rendering" description="How terminals and panes are drawn. Restart any open windows after switching the graphics backend.">
            <SettingSelect
                settings={settings}
                actions={actions}
                path="rendering.render.graphicsApi"
                label="Graphics API"
                description="Backend used to composite the UI and terminal surfaces."
                options={[
                    { label: "Automatic", value: "auto" },
                    { label: "Direct3D 11", value: "d3d11" },
                    { label: "Direct3D 12", value: "d3d12" },
                    { label: "OpenGL", value: "opengl" },
                    { label: "Software", value: "software" },
                ]}
            />
            <SettingToggle
                settings={settings}
                actions={actions}
                path="rendering.render.disablePartialSwapchain"
                label="Disable partial swapchain"
                description="Workaround for flicker or stale regions on some GPUs and remote desktops."
            />
            <SettingToggle
                settings={settings}
                actions={actions}
                path="rendering.render.softwareRendering"
                label="Force software rendering"
                description="Skip the GPU entirely. Slower, but the most compatible fallback."
            />
            <SettingToggle
                settings={settings}
                actions={actions}
                path="rendering.render.fontLigatures"
                label="Font ligatures"
                description="Render programming ligatures (e.g. => and !==) when the font provides them."
            />
            <SettingSelect
                settings={settings}
                actions={actions}
                path="rendering.render.antialiasing"
                label="Antialiasing"
                description="Glyph smoothing strategy. ClearType is sharpest on opaque, non-rotated text."
                options={[
                    { label: "Grayscale", value: "grayscale" },
                    { label: "ClearType / Subpixel", value: "subpixel" },
                    { label: "None", value: "none" },
                ]}
            />
        </SettingsSection>
    );

    const compatSection = (
        <SettingsSection title="Compatibility" description="Behaviour and text-shaping options for unusual environments.">
            <SettingToggle
                settings={settings}
                actions={actions}
                path="rendering.compat.runInBackground"
                label="Run in background"
                description="Keep Coretex and your agents running when all windows are closed."
            />
            <SettingSelect
                settings={settings}
                actions={actions}
                path="rendering.compat.textMeasurement"
                label="Text measurement"
                description="How character cell widths are computed for alignment of wide and combining glyphs."
                options={[
                    { label: "Grapheme clusters (recommended)", value: "grapheme" },
                    { label: "wcswidth", value: "wcswidth" },
                    { label: "Windows Console", value: "console" },
                ]}
            />
        </SettingsSection>
    );

    const maintenanceSection = (
        <SettingsSection title="Maintenance" description="Clear cached UI state or return every setting to its shipped default.">
            <div className="flex flex-col gap-2 py-3.5 first:pt-0">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="min-w-0">
                        <p className="text-sm font-medium text-primary">Clear cache</p>
                        <p className="mt-0.5 text-xs text-tertiary">
                            Empties localStorage and sessionStorage for this app. Your settings on disk are not affected.
                        </p>
                    </div>
                    <div className="shrink-0">
                        <Button size="sm" color="primary-destructive" iconLeading={Trash01} onClick={requestClearCache}>
                            Clear cache
                        </Button>
                    </div>
                </div>
                {cacheNote && (
                    <p role="status" className="text-xs text-quaternary">
                        {cacheNote}
                    </p>
                )}
            </div>

            <div className="flex flex-col gap-2 py-3.5 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="min-w-0">
                        <p className="text-sm font-medium text-primary">Reset to default settings</p>
                        <p className="mt-0.5 text-xs text-tertiary">Restores every option on every page to its factory value. This cannot be undone.</p>
                    </div>
                    <div className="shrink-0">
                        <Button size="sm" color="primary-destructive" iconLeading={RefreshCcw01} onClick={requestResetSettings}>
                            Reset to defaults
                        </Button>
                    </div>
                </div>
                <Checkbox isSelected={keepChecked} onChange={(v) => setKeepChecked(v)} label="Keep my profiles and custom color schemes" />
                {resetNote && (
                    <p role="status" className="text-xs text-quaternary">
                        {resetNote}
                    </p>
                )}
            </div>
        </SettingsSection>
    );

    return (
        <div className="flex flex-col gap-6">
            {cacheConfirmation.dialog}
            {resetConfirmation.dialog}
            <SettingsPageHeader
                icon={Monitor01}
                title="Rendering & compatibility"
                subtitle="Graphics backend, text shaping, compatibility options, and maintenance tools."
            />
            <SettingsTwoColumn
                left={
                    <>
                        {renderingSection}
                        {compatSection}
                    </>
                }
                right={maintenanceSection}
            />
        </div>
    );
};
