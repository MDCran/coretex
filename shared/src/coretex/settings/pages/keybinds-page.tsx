"use client";

// Coretex — Actions & keybinds (§8). Lists every app shortcut that has a live dispatcher with its chord
// chips and an enable toggle. Chord chips are click-to-record: clicking one arms
// a window keydown listener that captures the next non-modifier keystroke and
// rewrites that chord in place. All writes replace the whole keybinds array via
// actions.updateSettings (arrays are replaced wholesale by the Brain).
import { useEffect, useState } from "react";
import type { CoretexConfig } from "@repo/coretex/types";
import { Command, SearchMd } from "@untitledui/icons";
import { Badge } from "@/components/base/badges/badges";
import { Input } from "@/components/base/input/input";
import { Toggle } from "@/components/base/toggle/toggle";
import { cx } from "@/utils/cx";
import { titleCase } from "../../labels";
import type { CoretexActions, CoretexState } from "../../use-coretex";
import { SettingsSection } from "../controls";
import { SettingsPageHeader, SettingsStatusBadge } from "../settings-shell";

// KeyBinding isn't re-exported from @repo/coretex/types, so derive its shape
// from the live config tree to stay strictly typed.
type KeyBinding = CoretexConfig["keybinds"][number];

interface KeybindsPageProps {
    settings: CoretexConfig;
    state: CoretexState;
    actions: CoretexActions;
}

/** Which chord chip is currently armed for recording. */
interface Recording {
    actionId: string;
    chordIndex: number;
}

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "OS", "AltGraph", "Dead"]);

// Keep the editor aligned with app-shell's global dispatcher. Other schema
// entries remain dormant until their corresponding runtime action ships.
const SUPPORTED_ACTION_IDS = new Set([
    "toggle-terminal",
    "new-tab",
    "next-tab",
    "previous-tab",
    "open-settings",
    "open-file-manager",
    "open-ai-pane",
]);

/** Per-action category + one-line description so the list reads as grouped, self-explaining shortcuts. */
const ACTION_META: Record<string, { category: string; description: string }> = {
    "toggle-terminal": { category: "App & navigation", description: "Show or hide the terminal dock." },
    "clear-buffer": { category: "Terminal", description: "Clear the active terminal's scrollback." },
    "close-pane": { category: "Panes & splits", description: "Close the focused terminal pane." },
    copy: { category: "Clipboard & editing", description: "Copy the current terminal selection." },
    paste: { category: "Clipboard & editing", description: "Paste clipboard contents into the terminal." },
    "select-all": { category: "Clipboard & editing", description: "Select all text in the terminal." },
    find: { category: "Clipboard & editing", description: "Search within the terminal buffer." },
    "font-size-increase": { category: "Appearance", description: "Increase the terminal font size." },
    "font-size-decrease": { category: "Appearance", description: "Decrease the terminal font size." },
    "new-tab": { category: "Tabs", description: "Open a new terminal tab." },
    "duplicate-tab": { category: "Tabs", description: "Duplicate the current tab (same shell & folder)." },
    "duplicate-pane": { category: "Panes & splits", description: "Duplicate the focused pane beside it." },
    "split-down": { category: "Panes & splits", description: "Split the pane and stack a new one below." },
    "split-right": { category: "Panes & splits", description: "Split the pane and add a new one to the right." },
    "next-tab": { category: "Tabs", description: "Switch to the next tab." },
    "previous-tab": { category: "Tabs", description: "Switch to the previous tab." },
    "move-focus-left": { category: "Panes & splits", description: "Move focus to the pane on the left." },
    "move-focus-right": { category: "Panes & splits", description: "Move focus to the pane on the right." },
    "move-focus-up": { category: "Panes & splits", description: "Move focus to the pane above." },
    "move-focus-down": { category: "Panes & splits", description: "Move focus to the pane below." },
    "scroll-up": { category: "Navigation", description: "Scroll the terminal buffer up." },
    "scroll-down": { category: "Navigation", description: "Scroll the terminal buffer down." },
    "command-palette": { category: "App & navigation", description: "Open the command palette." },
    "open-settings": { category: "App & navigation", description: "Open Settings." },
    "toggle-fullscreen": { category: "App & navigation", description: "Toggle fullscreen mode." },
    "reopen-closed-tab": { category: "Tabs", description: "Reopen the most recently closed tab." },
    "ai-command-bar": { category: "AI", description: "Open the AI command bar." },
    "open-ai-pane": { category: "AI", description: "Open the AI chat pane." },
    "open-browser-pane": { category: "App & navigation", description: "Open the embedded browser pane." },
    "open-file-manager": { category: "App & navigation", description: "Open the Files manager." },
    "quick-ssh-connect": { category: "App & navigation", description: "Quick-connect to a saved SSH host." },
    "global-node-search": { category: "Navigation", description: "Search across all indexed files/nodes." },
};

const CATEGORY_ORDER = ["App & navigation", "AI", "Tabs", "Panes & splits", "Clipboard & editing", "Navigation", "Appearance", "Terminal", "Other"];

/** Resolve category + description for an action, including the numbered switch-tab / profile families. */
function actionMeta(actionId: string): { category: string; description: string } {
    if (ACTION_META[actionId]) return ACTION_META[actionId];
    const sw = /^switch-tab-(\d+)$/.exec(actionId);
    if (sw) return { category: "Tabs", description: `Jump directly to tab ${sw[1]}.` };
    const np = /^new-tab-profile-(\d+)$/.exec(actionId);
    if (np) return { category: "Tabs", description: `Open a new tab using saved profile ${np[1]}.` };
    return { category: "Other", description: "" };
}

function displayActionName(actionId: string): string {
    return titleCase(actionId.replace(/-/g, " ")).replace(/\bAi\b/g, "AI").replace(/\bSsh\b/g, "SSH");
}

/** Normalize a KeyboardEvent.key into a stable, display-friendly token. */
function normalizeKey(key: string): string {
    if (key === " " || key === "Spacebar") return "Space";
    if (key === "Escape") return "Esc";
    if (key === "ArrowUp") return "Up";
    if (key === "ArrowDown") return "Down";
    if (key === "ArrowLeft") return "Left";
    if (key === "ArrowRight") return "Right";
    if (key.length === 1) return key.toUpperCase();
    return key;
}

/** Build a chord string like "Ctrl+Shift+K" from a keydown event. */
function chordFromEvent(event: KeyboardEvent): string {
    const parts: string[] = [];
    if (event.ctrlKey) parts.push("Ctrl");
    if (event.shiftKey) parts.push("Shift");
    if (event.altKey) parts.push("Alt");
    if (event.metaKey) parts.push("Meta");
    parts.push(normalizeKey(event.key));
    return parts.join("+");
}

export const KeybindsPage = ({ settings, actions }: KeybindsPageProps) => {
    const [query, setQuery] = useState("");
    const [recording, setRecording] = useState<Recording | null>(null);

    const keybinds: KeyBinding[] = Array.isArray(settings.keybinds) ? settings.keybinds : [];

    // While a chip is armed, capture the next non-modifier keystroke, write it
    // into the matching binding's chords array, and disarm.
    useEffect(() => {
        if (!recording) return;

        const onKeyDown = (event: KeyboardEvent) => {
            // Ignore lone modifier presses — wait for a real key.
            if (MODIFIER_KEYS.has(event.key)) return;

            event.preventDefault();
            event.stopPropagation();

            // A bare Escape cancels recording without rebinding.
            if (event.key === "Escape" && !event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey) {
                setRecording(null);
                return;
            }

            const chord = chordFromEvent(event);
            const updated = keybinds.map((kb) => {
                if (kb.actionId !== recording.actionId) return kb;
                const chords = kb.chords.slice();
                if (recording.chordIndex >= 0 && recording.chordIndex < chords.length) {
                    chords[recording.chordIndex] = chord;
                }
                return { ...kb, chords };
            });

            actions.updateSettings({ keybinds: updated });
            setRecording(null);
        };

        window.addEventListener("keydown", onKeyDown, true);
        return () => {
            window.removeEventListener("keydown", onKeyDown, true);
        };
    }, [recording, keybinds, actions]);

    const toggleEnabled = (actionId: string) => {
        const updated = keybinds.map((kb) => (kb.actionId === actionId ? { ...kb, enabled: !kb.enabled } : kb));
        actions.updateSettings({ keybinds: updated });
    };

    const startRecording = (actionId: string, chordIndex: number) => {
        setRecording((prev) => (prev && prev.actionId === actionId && prev.chordIndex === chordIndex ? null : { actionId, chordIndex }));
    };

    const needle = query.trim().toLowerCase();
    const matches = (kb: KeyBinding): boolean => {
        if (!needle) return true;
        const meta = actionMeta(kb.actionId);
        const name = displayActionName(kb.actionId);
        return (
            kb.actionId.toLowerCase().includes(needle) ||
            name.toLowerCase().includes(needle) ||
            meta.description.toLowerCase().includes(needle) ||
            meta.category.toLowerCase().includes(needle) ||
            kb.chords.some((c) => c.toLowerCase().includes(needle))
        );
    };
    const configurableKeybinds = keybinds.filter((kb) => SUPPORTED_ACTION_IDS.has(kb.actionId));
    const visible = configurableKeybinds.filter(matches);

    // Group visible actions by category, in a stable curated order.
    const groups = CATEGORY_ORDER.map((category) => ({
        category,
        items: visible.filter((kb) => actionMeta(kb.actionId).category === category),
    })).filter((g) => g.items.length > 0);

    const enabledCount = configurableKeybinds.filter((kb) => kb.enabled).length;

    const ChordRow = ({ kb }: { kb: KeyBinding }) => {
        const name = displayActionName(kb.actionId);
        const meta = actionMeta(kb.actionId);
        return (
            <div className={cx("flex items-start gap-3 px-4 py-3", !kb.enabled && "opacity-60")}>
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-primary">{name}</p>
                    {meta.description && <p className="mt-0.5 text-xs text-tertiary">{meta.description}</p>}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {kb.chords.length === 0 && <span className="text-xs text-quaternary italic">No chord</span>}
                        {kb.chords.map((chord, chordIndex) => {
                            const isRecording = recording?.actionId === kb.actionId && recording.chordIndex === chordIndex;
                            return (
                                <button
                                    key={chordIndex}
                                    type="button"
                                    onClick={() => startRecording(kb.actionId, chordIndex)}
                                    title={isRecording ? "Press a key to bind (Esc to cancel)" : "Click to rebind"}
                                    className={cx(
                                        "rounded-md outline-focus-ring transition focus-visible:outline-2 focus-visible:outline-offset-2",
                                        isRecording && "ring-1 ring-brand-solid",
                                    )}
                                >
                                    <Badge size="sm" color={isRecording ? "brand" : "gray"} className="font-mono">
                                        {isRecording ? "Press a key…" : chord}
                                    </Badge>
                                </button>
                            );
                        })}
                    </div>
                </div>
                <Toggle aria-label={`Enable ${name}`} isSelected={kb.enabled} onChange={() => toggleEnabled(kb.actionId)} className="mt-0.5 shrink-0" />
            </div>
        );
    };

    return (
        <div className="flex flex-col gap-6">
            <SettingsPageHeader
                icon={Command}
                title="Actions & keybinds"
                subtitle="Available app shortcuts apply immediately; on conflict the last binding wins."
                badges={<SettingsStatusBadge label={`${enabledCount} of ${configurableKeybinds.length} enabled`} color={enabledCount > 0 ? "success" : "gray"} />}
            />

            <SettingsSection title="Keyboard shortcuts" description="Search by action, category, or chord. Click a chord to record its replacement.">
                <div className="flex flex-col gap-5 pt-0">
                    <div className="w-full max-w-md">
                        <Input
                            aria-label="Search keyboard shortcuts"
                            value={query}
                            placeholder="Search actions, categories, or keys…"
                            onChange={(v: string) => setQuery(v)}
                            icon={SearchMd}
                            size="sm"
                        />
                    </div>

                    {groups.length === 0 ? (
                        <p
                            className="rounded-xl px-5 py-8 text-center text-sm text-tertiary"
                            style={{ background: "var(--surface-2)", border: "1px dashed var(--c-border)" }}
                        >
                            {configurableKeybinds.length === 0 ? "No app shortcuts are bound yet." : "No actions match your search."}
                        </p>
                    ) : (
                        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
                            {groups.map(({ category, items }) => {
                                const catEnabled = items.filter((kb) => kb.enabled).length;
                                return (
                                    <section
                                        key={category}
                                        className="overflow-hidden rounded-xl"
                                        style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}
                                    >
                                        <div className="flex items-center justify-between gap-2 border-b px-4 py-3" style={{ borderColor: "var(--c-border)" }}>
                                            <h3 className="text-sm font-semibold text-primary">{category}</h3>
                                            <span className="text-xs text-quaternary tabular-nums">
                                                {catEnabled}/{items.length}
                                            </span>
                                        </div>
                                        <div className="flex flex-col divide-y divide-[var(--c-border)]">
                                            {items.map((kb) => (
                                                <ChordRow key={kb.actionId} kb={kb} />
                                            ))}
                                        </div>
                                    </section>
                                );
                            })}
                        </div>
                    )}

                    <p className="text-xs text-quaternary">Recorded chords are persisted to settings; on conflict the last binding wins.</p>
                </div>
            </SettingsSection>
        </div>
    );
};
