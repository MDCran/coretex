// @ts-nocheck
"use client";

// Coretex — renders a project's display icon (an @untitledui/icons name) tinted
// with its accent color, in a rounded tile. Falls back to a Folder icon + the
// brand color so every project always has a sensible default.

import type { ComponentType, CSSProperties } from "react";
import * as UntitledIcons from "@untitledui/icons";
import { Folder } from "@untitledui/icons";
import { cx } from "@/utils/cx";

type IconComponent = ComponentType<{ className?: string; style?: CSSProperties }>;

export function resolveProjectIcon(name?: string): IconComponent {
    if (!name) return Folder;
    const mod = UntitledIcons as unknown as Record<string, IconComponent | undefined>;
    return mod[name] ?? Folder;
}

interface Props {
    icon?: string;
    color?: string;
    size?: number;
    /** Render as a filled tile (with a tinted background) vs. a bare icon. */
    tile?: boolean;
    className?: string;
}

export const ProjectIcon = ({ icon, color, size = 20, tile = true, className }: Props) => {
    const Icon = resolveProjectIcon(icon);
    const accent = color || "var(--brand)";
    if (!tile) {
        return <Icon className={cx("shrink-0", className)} style={{ width: size, height: size, color: accent }} />;
    }
    return (
        <span
            className={cx("inline-flex shrink-0 items-center justify-center rounded-md", className)}
            style={{ width: size, height: size, background: typeof accent === "string" && accent.startsWith("#") ? accent + "26" : "var(--surface-2)" }}
        >
            <Icon style={{ width: size * 0.6, height: size * 0.6, color: accent }} />
        </span>
    );
};
