// @ts-nocheck
"use client";

// Coretex — searchable @untitledui/icons picker. Renders a filterable grid of
// curated Untitled UI icons; selecting one returns its name (stored on an
// agent's VisualIdentity as { kind: 'untitled-ui', name }).

import { useMemo, useState, type ComponentType } from "react";
import * as UntitledIcons from "@untitledui/icons";
import { Input } from "@/components/base/input/input";
import { SearchLg } from "@untitledui/icons";
import { cx } from "@/utils/cx";

type IconComponent = ComponentType<{ className?: string }>;

/** Curated icon names (all verified to exist in @untitledui/icons). */
export const CURATED_ICONS: string[] = [
    "Cube01", "Stars01", "Rocket01", "Zap", "Lightning01", "Atom01", "Beaker01", "CpuChip01",
    "Code02", "CodeBrowser", "Terminal", "GitBranch01", "GitCommit", "GitMerge", "GitPullRequest",
    "Server01", "Server04", "Database01", "Globe01", "Wifi", "Cloud01", "HardDrive",
    "SearchLg", "BarChart01", "BarChartSquare02", "Activity", "Target04", "Compass", "Map01", "PieChart01",
    "CheckCircle", "ShieldTick", "Eye", "Key01", "Lock01", "Fingerprint01",
    "Edit05", "Feather", "Brush01", "Image01", "Camera01", "PlayCircle", "Microphone01", "Palette",
    "MessageChatCircle", "Users01", "User01", "Bell01", "Flag01", "Bookmark", "Tag01", "Star01", "Heart", "Diamond01",
    "Package", "Box", "Grid01", "Folder", "FolderCode", "File01", "FileCode02", "Briefcase01", "Wallet01", "Coins01",
    "Calendar", "Clock", "Lightbulb01", "Tool01", "Tool02", "Settings01", "Anchor", "Hash01", "Sun", "Moon01",
    "Building01", "Home01", "Truck01", "Passcode", "MagicWand01", "PuzzlePiece01", "LayersThree01",
];

function resolve(name: string): IconComponent | undefined {
    const mod = UntitledIcons as unknown as Record<string, IconComponent | undefined>;
    return mod[name];
}

interface Props {
    value?: string;
    onChange: (name: string) => void;
    color?: string;
    /** Larger scrollable grid for project settings. */
    density?: "compact" | "comfortable";
}

export const IconPicker = ({ value, onChange, color, density = "compact" }: Props) => {
    const [query, setQuery] = useState("");

    const icons = useMemo(() => {
        const seen = new Set<string>();
        const out: { name: string; Cmp: IconComponent }[] = [];
        for (const name of CURATED_ICONS) {
            if (seen.has(name)) continue;
            seen.add(name);
            const Cmp = resolve(name);
            if (Cmp) out.push({ name, Cmp });
        }
        const q = query.trim().toLowerCase();
        return q ? out.filter((i) => i.name.toLowerCase().includes(q)) : out;
    }, [query]);

    const cols = density === "comfortable" ? "grid-cols-10" : "grid-cols-8";
    const maxH = density === "comfortable" ? "max-h-64" : "max-h-44";

    return (
        <div className="flex flex-col gap-2">
            <Input value={query} onChange={setQuery} placeholder="Search icons" icon={SearchLg} size="sm" />
            <div
                className={cx("grid gap-1 overflow-y-auto rounded-lg p-2", cols, maxH)}
                style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}
            >
                {icons.map(({ name, Cmp }) => {
                    const selected = value === name;
                    return (
                        <button
                            key={name}
                            type="button"
                            onClick={() => onChange(name)}
                            title={name}
                            className={cx(
                                "flex aspect-square items-center justify-center rounded-md transition",
                                selected ? "" : "hover:bg-[var(--surface)]",
                            )}
                            style={selected ? { background: (color || "var(--brand)") + "22", boxShadow: `inset 0 0 0 1.5px ${color || "var(--brand)"}` } : undefined}
                        >
                            <Cmp className="size-4 text-secondary" />
                        </button>
                    );
                })}
                {icons.length === 0 && <p className="col-span-full px-1 py-3 text-center text-xs text-quaternary">No icons match “{query}”.</p>}
            </div>
            {value && <p className="text-[11px] text-quaternary">Selected: <span className="font-mono text-tertiary">{value}</span></p>}
        </div>
    );
};
