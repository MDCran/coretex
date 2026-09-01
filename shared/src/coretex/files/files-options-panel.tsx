// @ts-nocheck
"use client";

// Coretex Files — in-page explorer options. Mirrors Settings → File manager so layout,
// visibility, navigation, and editor prefs can be tuned without leaving the Files pane.

import type { ReactNode } from "react";
import type { CoretexConfig } from "@repo/coretex/types";
import { ArrowRight, Sliders02 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { NativeSelect } from "@/components/base/select/select-native";
import { Slider } from "@/components/base/slider/slider";
import { Toggle } from "@/components/base/toggle/toggle";
import { SlideoutMenu } from "@/components/application/slideout-menus/slideout-menu";
import { cx } from "@/utils/cx";
import type { NavTarget } from "../nav";
import { richEnumOptions } from "../settings/rich-select-options";

type Fv = CoretexConfig["filesView"];

const Row = ({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) => (
    <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
        <div className="min-w-0">
            <p className="text-sm font-medium text-primary">{label}</p>
            {hint && <p className="mt-0.5 text-xs text-tertiary">{hint}</p>}
        </div>
        <div className="shrink-0">{children}</div>
    </div>
);

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
    <div className="border-t border-[color:var(--c-divider,color-mix(in_srgb,var(--c-text-muted)_22%,transparent))] pt-5 first:border-t-0 first:pt-0">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-quaternary">{title}</h3>
        <div className="flex flex-col divide-y divide-[color:var(--c-divider,color-mix(in_srgb,var(--c-text-muted)_22%,transparent))]">
            {children}
        </div>
    </div>
);

export const FilesOptionsPanel = ({
    open,
    onClose,
    fv,
    set,
    onNavigate,
}: {
    open: boolean;
    onClose: () => void;
    fv: Fv;
    set: <K extends keyof Fv>(path: K, value: Fv[K]) => void;
    onNavigate?: (t: NavTarget) => void;
}) => {
    return (
        <SlideoutMenu isOpen={open} onOpenChange={(v) => !v && onClose()} isDismissable dialogClassName="gap-0">
            <SlideoutMenu.Header onClose={onClose}>
                <div className="flex items-center gap-2">
                    <Sliders02 className="size-5 text-brand-secondary" />
                    <div>
                        <p className="text-md font-semibold text-primary">Explorer options</p>
                        <p className="text-xs text-tertiary">Customize how this file manager looks and behaves.</p>
                    </div>
                </div>
            </SlideoutMenu.Header>

            <SlideoutMenu.Content className="py-6">
                <Section title="Layout">
                    <Row label="Default view" hint="Columns, table, or grid when opening folders.">
                        <div className="w-56">
                            <NativeSelect
                                rich
                                options={richEnumOptions("filesView.defaultView") ?? []}
                                value={fv.defaultView}
                                onChange={(e) => set("defaultView", e.target.value as Fv["defaultView"])}
                            />
                        </div>
                    </Row>
                    <Row label="Density" hint="Comfortable or compact row spacing.">
                        <div className="w-56">
                            <NativeSelect
                                rich
                                options={richEnumOptions("filesView.density") ?? []}
                                value={fv.density}
                                onChange={(e) => set("density", e.target.value as Fv["density"])}
                            />
                        </div>
                    </Row>
                    <Row label="Grid tile size" hint={`${fv.gridSize}px thumbnails in grid view.`}>
                        <div className="flex w-44 items-center gap-2">
                            <Slider
                                aria-label="Grid tile size"
                                value={fv.gridSize}
                                minValue={48}
                                maxValue={256}
                                step={8}
                                onChange={(v) => set("gridSize", Array.isArray(v) ? v[0] : v)}
                            />
                            <span className="w-10 text-right text-xs tabular-nums text-secondary">{fv.gridSize}</span>
                        </div>
                    </Row>
                    <Row label="Sidebar width" hint="Locations rail width in pixels.">
                        <div className="flex w-44 items-center gap-2">
                            <Slider
                                aria-label="Sidebar width"
                                value={fv.sidebarWidth}
                                minValue={160}
                                maxValue={360}
                                step={8}
                                onChange={(v) => set("sidebarWidth", Array.isArray(v) ? v[0] : v)}
                            />
                            <span className="w-10 text-right text-xs tabular-nums text-secondary">{fv.sidebarWidth}</span>
                        </div>
                    </Row>
                    <Row label="Listing with editor" hint="File list width when Monaco is open.">
                        <div className="flex w-44 items-center gap-2">
                            <Slider
                                aria-label="Listing width with editor"
                                value={fv.listingWidthWhenEditorOpen}
                                minValue={260}
                                maxValue={560}
                                step={20}
                                onChange={(v) => set("listingWidthWhenEditorOpen", Array.isArray(v) ? v[0] : v)}
                            />
                            <span className="w-10 text-right text-xs tabular-nums text-secondary">{fv.listingWidthWhenEditorOpen}</span>
                        </div>
                    </Row>
                </Section>

                <Section title="Sorting & columns">
                    <Row label="Sort by">
                        <div className="w-56">
                            <NativeSelect
                                rich
                                options={richEnumOptions("filesView.sortBy") ?? []}
                                value={fv.sortBy}
                                onChange={(e) => set("sortBy", e.target.value as Fv["sortBy"])}
                            />
                        </div>
                    </Row>
                    <Row label="Sort direction">
                        <div className="w-56">
                            <NativeSelect
                                rich
                                options={richEnumOptions("filesView.sortDir") ?? []}
                                value={fv.sortDir}
                                onChange={(e) => set("sortDir", e.target.value as Fv["sortDir"])}
                            />
                        </div>
                    </Row>
                    <Row label="Type column">
                        <Toggle isSelected={fv.showTypeColumn} onChange={(v) => set("showTypeColumn", v)} />
                    </Row>
                    <Row label="Size column">
                        <Toggle isSelected={fv.showSizeColumn} onChange={(v) => set("showSizeColumn", v)} />
                    </Row>
                    <Row label="Modified column">
                        <Toggle isSelected={fv.showModifiedColumn} onChange={(v) => set("showModifiedColumn", v)} />
                    </Row>
                </Section>

                <Section title="Navigation & search">
                    <Row label="Open items on">
                        <div className="w-56">
                            <NativeSelect
                                rich
                                options={richEnumOptions("filesView.openOn") ?? []}
                                value={fv.openOn}
                                onChange={(e) => set("openOn", e.target.value as Fv["openOn"])}
                            />
                        </div>
                    </Row>
                    <Row label="Search scope">
                        <div className="w-56">
                            <NativeSelect
                                rich
                                options={richEnumOptions("filesView.defaultSearchScope") ?? []}
                                value={fv.defaultSearchScope}
                                onChange={(e) => set("defaultSearchScope", e.target.value as Fv["defaultSearchScope"])}
                            />
                        </div>
                    </Row>
                    <Row label="Quick Look (Space)" hint="Preview overlay for the selected item.">
                        <Toggle isSelected={fv.enableQuickLook} onChange={(v) => set("enableQuickLook", v)} />
                    </Row>
                </Section>

                <Section title="Visibility">
                    <Row label="Show hidden files" hint="Dotfiles and names starting with a period.">
                        <Toggle isSelected={fv.showHidden} onChange={(v) => set("showHidden", v)} />
                    </Row>
                    <Row label="Hide build folders" hint="node_modules, .git, dist, build, …">
                        <Toggle isSelected={fv.hideSystemFolders} onChange={(v) => set("hideSystemFolders", v)} />
                    </Row>
                    <Row label="Hide patterns" hint="Comma-separated globs (e.g. *.log, .DS_Store).">
                        <input
                            type="text"
                            value={fv.hidePatterns}
                            onChange={(e) => set("hidePatterns", e.target.value)}
                            placeholder="*.log, .DS_Store"
                            className={cx(
                                "w-44 rounded-lg px-2.5 py-1.5 text-xs text-primary outline-none focus:ring-2 focus:ring-brand",
                            )}
                            style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}
                        />
                    </Row>
                    <Row label="Git status badges">
                        <Toggle isSelected={fv.showGitStatus} onChange={(v) => set("showGitStatus", v)} />
                    </Row>
                </Section>

                <Section title="Editor">
                    <Row label="Word wrap">
                        <Toggle isSelected={fv.editorWordWrap} onChange={(v) => set("editorWordWrap", v)} />
                    </Row>
                    <Row label="Font size">
                        <div className="flex w-44 items-center gap-2">
                            <Slider
                                aria-label="Editor font size"
                                value={fv.editorFontSize}
                                minValue={10}
                                maxValue={22}
                                step={1}
                                onChange={(v) => set("editorFontSize", Array.isArray(v) ? v[0] : v)}
                            />
                            <span className="w-8 text-right text-xs tabular-nums text-secondary">{fv.editorFontSize}</span>
                        </div>
                    </Row>
                    <Row label="Minimap">
                        <Toggle isSelected={fv.editorMinimap} onChange={(v) => set("editorMinimap", v)} />
                    </Row>
                </Section>

                <Section title="Safety">
                    <Row label="Confirm before delete">
                        <Toggle isSelected={fv.confirmDelete} onChange={(v) => set("confirmDelete", v)} />
                    </Row>
                </Section>
            </SlideoutMenu.Content>

            <SlideoutMenu.Footer className="flex w-full items-center justify-between gap-2">
                <p className="text-xs text-quaternary">Changes apply immediately and sync to Settings.</p>
                {onNavigate && (
                    <Button
                        size="sm"
                        color="secondary"
                        iconTrailing={ArrowRight}
                        onClick={() => {
                            onClose();
                            onNavigate({ kind: "settings", page: "files" });
                        }}
                    >
                        All file settings
                    </Button>
                )}
            </SlideoutMenu.Footer>
        </SlideoutMenu>
    );
};
