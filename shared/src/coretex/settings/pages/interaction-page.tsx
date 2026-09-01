"use client";

// Coretex — Interaction settings (§4). Clipboard, window/pane behavior,
// link & selection handling, and terminal safeguards. Every row here writes a
// scalar key via the schema-driven controls (actions.setSetting).
import type { CoretexConfig } from "@repo/coretex/types";
import { Cursor04 } from "@untitledui/icons";
import type { CoretexActions, CoretexState } from "../../use-coretex";
import { SettingSelect, SettingText, SettingToggle, SettingsSection } from "../controls";
import { SettingsPageHeader, SettingsStatusBadge, SettingsTwoColumn } from "../settings-shell";

export const InteractionPage = ({ settings, actions }: { settings: CoretexConfig; state: CoretexState; actions: CoretexActions }) => {
    const safeguardCount = [settings.interaction.ai.assistOnError, settings.interaction.ai.smartPasteGuard].filter(Boolean).length;

    const clipboardSection = (
        <SettingsSection title="Clipboard" description="How selections are copied and how pasted text is cleaned up.">
            <SettingToggle
                settings={settings}
                actions={actions}
                path="interaction.clipboard.autoCopySelection"
                label="Copy on select"
                description="Automatically copy text to the clipboard as soon as it is selected."
            />
            <SettingSelect
                settings={settings}
                actions={actions}
                path="interaction.clipboard.copyFormats"
                label="Copy formats"
                description="Which representations are placed on the clipboard when copying."
                options={[
                    { label: "Plain text only", value: "plain" },
                    { label: "Plain + HTML", value: "plain-html" },
                    { label: "Plain + RTF", value: "plain-rtf" },
                ]}
            />
            <SettingToggle
                settings={settings}
                actions={actions}
                path="interaction.clipboard.trimBlockSelection"
                label="Trim block selection"
                description="Strip trailing whitespace from each line of a block selection when copying."
            />
            <SettingToggle
                settings={settings}
                actions={actions}
                path="interaction.clipboard.trimOnPaste"
                label="Trim on paste"
                description="Remove leading and trailing whitespace from pasted text."
            />
            <SettingText
                settings={settings}
                actions={actions}
                path="interaction.clipboard.wordDelimiters"
                label="Word delimiters"
                description="Characters that mark word boundaries for double-click selection."
                placeholder="e.g. /\()&quot;'-,.;"
            />
        </SettingsSection>
    );

    const windowSection = (
        <SettingsSection title="Window and panes" description="Pane layout, tab switching, and focus behavior.">
            <SettingToggle
                settings={settings}
                actions={actions}
                path="interaction.windowPanes.snapToGrid"
                label="Snap to grid"
                description="Snap pane edges to a grid when dragging splits."
            />
            <SettingSelect
                settings={settings}
                actions={actions}
                path="interaction.windowPanes.tabSwitcherStyle"
                label="Tab switcher order"
                description="The order tabs appear when cycling with the keyboard switcher."
                options={[
                    { label: "In tab strip order", value: "strip" },
                    { label: "Most recently used", value: "mru" },
                ]}
            />
            <SettingToggle
                settings={settings}
                actions={actions}
                path="interaction.windowPanes.focusFollowsMouse"
                label="Focus follows mouse"
                description="Focus the pane under the pointer without clicking."
            />
            <SettingToggle
                settings={settings}
                actions={actions}
                path="interaction.windowPanes.ctrlScrollFontSize"
                label="Ctrl+scroll adjusts font size"
                description="Hold Ctrl and scroll to zoom the active terminal's font."
            />
            <SettingToggle
                settings={settings}
                actions={actions}
                path="interaction.windowPanes.ctrlShiftScrollOpacity"
                label="Ctrl+Shift+scroll adjusts opacity"
                description="Hold Ctrl+Shift and scroll to change window opacity."
            />
        </SettingsSection>
    );

    const linksSection = (
        <SettingsSection title="Links and selection" description="URL detection and how selected text searches the web.">
            <SettingToggle
                settings={settings}
                actions={actions}
                path="interaction.linksSelection.detectUrls"
                label="Detect URLs"
                description="Underline URLs in output and make them clickable."
            />
            <SettingText
                settings={settings}
                actions={actions}
                path="interaction.linksSelection.searchUrlTemplate"
                label="Search URL template"
                description="Used when searching the web for selected text. %s is replaced by the selection."
                placeholder="https://www.bing.com/search?q=%s"
            />
            <SettingToggle
                settings={settings}
                actions={actions}
                path="interaction.linksSelection.colorSelectedText"
                label="Color selected text"
                description="Apply the selection foreground color to highlighted text."
            />
        </SettingsSection>
    );

    const aiSection = (
        <SettingsSection title="Terminal safeguards" description="Local notifications and paste checks that help catch common terminal mistakes.">
            <SettingToggle
                settings={settings}
                actions={actions}
                path="interaction.ai.assistOnError"
                label="Error notifications"
                description="Show a desktop notification when a terminal command exits with an error."
            />
            <SettingToggle
                settings={settings}
                actions={actions}
                path="interaction.ai.smartPasteGuard"
                label="Smart paste guard"
                description="Warn before pasting text that matches risky or destructive command patterns."
            />
        </SettingsSection>
    );

    return (
        <div className="flex flex-col gap-6">
            <SettingsPageHeader
                icon={Cursor04}
                title="Interaction"
                subtitle="Clipboard, pane layout, link detection, and terminal safeguards."
                badges={<SettingsStatusBadge label={`${safeguardCount} safeguards on`} color={safeguardCount > 0 ? "success" : "gray"} />}
            />
            <SettingsTwoColumn
                left={
                    <>
                        {clipboardSection}
                        {windowSection}
                    </>
                }
                right={
                    <>
                        {linksSection}
                        {aiSection}
                    </>
                }
            />
        </div>
    );
};
