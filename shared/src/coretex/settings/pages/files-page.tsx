// @ts-nocheck
"use client";

// Coretex settings — File manager. Schema-driven controls bound to filesView.*
// on the live CoretexConfig. Every row round-trips through actions.setSetting
// (persist + apply + broadcast). The Files pane reads these on mount: the default
// view + density + sort seed each folder, hidden files stay hidden unless toggled,
// and delete prompts are gated on confirmDelete. Additive — folder-local view
// overrides still win once the user picks a view in a folder.

import { Folder } from "@untitledui/icons";
import { SettingsSection, SettingToggle, SettingSelect, SettingSlider, SettingText } from "../controls";
import type { SettingsPageProps } from "../settings-window";
import { SettingsPageHeader, SettingsTwoColumn } from "../settings-shell";

export const FilesPage = ({ settings, actions }: SettingsPageProps) => {
    const layoutSection = (
        <SettingsSection title="Layout" description="How folders open, how dense listings are, and panel sizing.">
            <SettingSelect
                settings={settings}
                actions={actions}
                path="filesView.defaultView"
                label="Default view"
                description="How folders open by default. Picking a view inside a folder still overrides this for that folder."
                options={[
                    { label: "Columns", value: "columns" },
                    { label: "Table", value: "table" },
                    { label: "Grid", value: "grid" },
                ]}
            />
            <SettingSelect
                settings={settings}
                actions={actions}
                path="filesView.density"
                label="Density"
                description="Comfortable gives rows more breathing room; Compact fits more on screen."
                options={[
                    { label: "Comfortable", value: "comfortable" },
                    { label: "Compact", value: "compact" },
                ]}
            />
            <SettingSlider
                settings={settings}
                actions={actions}
                path="filesView.gridSize"
                label="Grid thumbnail size"
                description="Tile size for the grid view, in pixels."
                min={48}
                max={256}
                step={8}
                unit="px"
            />
            <SettingSlider
                settings={settings}
                actions={actions}
                path="filesView.sidebarWidth"
                label="Sidebar width"
                description="Width of the locations rail (Quick access, Drives, Starred)."
                min={160}
                max={360}
                step={8}
                unit="px"
            />
            <SettingSlider
                settings={settings}
                actions={actions}
                path="filesView.listingWidthWhenEditorOpen"
                label="Listing width with editor"
                description="How wide the file list stays when the Monaco editor panel is open."
                min={260}
                max={560}
                step={20}
                unit="px"
            />
        </SettingsSection>
    );

    const sortSection = (
        <SettingsSection title="Sorting" description="The order entries are listed in before you tweak it per folder.">
            <SettingSelect
                settings={settings}
                actions={actions}
                path="filesView.sortBy"
                label="Sort by"
                description="Which column entries are ordered by. Folders always group first."
                options={[
                    { label: "Name", value: "name" },
                    { label: "Date modified", value: "modified" },
                    { label: "Size", value: "size" },
                    { label: "Type", value: "type" },
                ]}
            />
            <SettingSelect
                settings={settings}
                actions={actions}
                path="filesView.sortDir"
                label="Direction"
                description="Ascending (A→Z, oldest, smallest) or descending."
                options={[
                    { label: "Ascending", value: "asc" },
                    { label: "Descending", value: "desc" },
                ]}
            />
        </SettingsSection>
    );

    const tableSection = (
        <SettingsSection title="Table columns" description="Default columns in table view. You can still toggle columns per session from the toolbar.">
            <SettingToggle
                settings={settings}
                actions={actions}
                path="filesView.showTypeColumn"
                label="Type column"
                description="Show the file extension / folder type column."
            />
            <SettingToggle
                settings={settings}
                actions={actions}
                path="filesView.showSizeColumn"
                label="Size column"
                description="Show file size (folders show —)."
            />
            <SettingToggle
                settings={settings}
                actions={actions}
                path="filesView.showModifiedColumn"
                label="Modified column"
                description="Show last-modified date and time."
            />
        </SettingsSection>
    );

    const navigationSection = (
        <SettingsSection title="Navigation & search" description="How you open items and where search starts.">
            <SettingSelect
                settings={settings}
                actions={actions}
                path="filesView.openOn"
                label="Open items on"
                description="Single-click opens like Finder; double-click selects first, then opens on the second click."
                options={[
                    { label: "Single click", value: "single-click" },
                    { label: "Double click", value: "double-click" },
                ]}
            />
            <SettingSelect
                settings={settings}
                actions={actions}
                path="filesView.defaultSearchScope"
                label="Default search scope"
                description="Folder searches recursively from the current directory; All searches indexed locations."
                options={[
                    { label: "Current folder", value: "folder" },
                    { label: "All indexed locations", value: "index" },
                ]}
            />
            <SettingToggle
                settings={settings}
                actions={actions}
                path="filesView.enableQuickLook"
                label="Quick Look preview"
                description="Press Space on a selected item to open the preview overlay."
            />
        </SettingsSection>
    );

    const visibilitySection = (
        <SettingsSection title="Visibility" description="What appears in folder listings and what stays out of the way.">
            <SettingToggle
                settings={settings}
                actions={actions}
                path="filesView.showHidden"
                label="Show hidden files"
                description="Include dotfiles and OS-hidden entries (names starting with a dot) in folder listings."
            />
            <SettingToggle
                settings={settings}
                actions={actions}
                path="filesView.hideSystemFolders"
                label="Hide system & build folders"
                description="Filter out node_modules, .git, dist, build, .next, coverage, and similar heavy directories."
            />
            <SettingText
                settings={settings}
                actions={actions}
                path="filesView.hidePatterns"
                label="Hide patterns"
                description="Comma- or newline-separated names or globs to exclude (e.g. *.log, .DS_Store, Thumbs.db)."
                placeholder="*.log, .DS_Store"
            />
        </SettingsSection>
    );

    const gitSection = (
        <SettingsSection title="Git & metadata" description="Repository indicators and version-control overlays.">
            <SettingToggle
                settings={settings}
                actions={actions}
                path="filesView.showGitStatus"
                label="Git status badges"
                description="Show modified, added, and conflict emblems when browsing inside a git repository."
            />
        </SettingsSection>
    );

    const editorSection = (
        <SettingsSection title="Editor" description="Monaco options when a file is opened in the Files pane.">
            <SettingToggle
                settings={settings}
                actions={actions}
                path="filesView.editorWordWrap"
                label="Word wrap"
                description="Wrap long lines instead of horizontal scrolling."
            />
            <SettingSlider
                settings={settings}
                actions={actions}
                path="filesView.editorFontSize"
                label="Font size"
                description="Editor monospace font size in pixels."
                min={10}
                max={22}
                step={1}
                unit="px"
            />
            <SettingToggle
                settings={settings}
                actions={actions}
                path="filesView.editorMinimap"
                label="Minimap"
                description="Show the code overview strip on the right edge of the editor."
            />
        </SettingsSection>
    );

    const safetySection = (
        <SettingsSection title="Safety" description="Destructive actions that should pause for confirmation.">
            <SettingToggle
                settings={settings}
                actions={actions}
                path="filesView.confirmDelete"
                label="Confirm before deleting"
                description="Ask for confirmation before deleting a file or folder. Off deletes immediately."
            />
        </SettingsSection>
    );

    return (
        <div className="flex flex-col gap-6">
            <SettingsPageHeader
                icon={Folder}
                title="File manager"
                subtitle="Defaults for the Files pane — layout, sorting, visibility, navigation, git overlays, and the built-in editor."
            />
            <SettingsTwoColumn
                left={
                    <>
                        {layoutSection}
                        {tableSection}
                        {visibilitySection}
                        {editorSection}
                    </>
                }
                right={
                    <>
                        {sortSection}
                        {navigationSection}
                        {gitSection}
                        {safetySection}
                    </>
                }
            />
        </div>
    );
};
