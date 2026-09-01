// @ts-nocheck
"use client";

// Coretex — renders an agent's VisualIdentity: an Untitled UI icon, an uploaded
// logo, or a brand mark, inside a circle tinted/ringed by the theme color.

import * as UntitledIcons from "@untitledui/icons";
import type { ComponentType } from "react";
import type { VisualIdentity } from "@repo/coretex/types";
import { BrandLogo } from "./brand-logo";
import { cx } from "@/utils/cx";

type IconComponent = ComponentType<{ className?: string }>;

function resolveIcon(name: string): IconComponent | undefined {
    return (UntitledIcons as unknown as Record<string, IconComponent | undefined>)[name];
}

function initials(name: string): string {
    return (
        name
            .split(/\s+/)
            .filter(Boolean)
            .map((w) => w[0])
            .join("")
            .slice(0, 2)
            .toUpperCase() || "AG"
    );
}

interface Props {
    identity?: VisualIdentity;
    /** Fallbacks when identity is absent. */
    name?: string;
    avatarUrl?: string;
    size?: number;
    className?: string;
}

export const IdentityAvatar = ({ identity, name = "", avatarUrl, size = 40, className }: Props) => {
    const color = identity?.themeColor || "var(--brand)";
    const ring = identity?.themeColor ? { boxShadow: `0 0 0 2px ${identity.themeColor}` } : undefined;
    const dim = { width: size, height: size } as const;

    // Guard `icon` itself — a present-but-partial identity (themeColor set before an icon
    // was chosen) has icon === undefined, and `identity.icon.kind` would THROW and (with no
    // boundary above) blank the whole app. Fall through to the initials fallback instead.
    const icon = identity?.icon;

    // Uploaded logo (explicit identity upload OR legacy avatarUrl).
    const uploadUrl = icon?.kind === "upload" ? icon.url : avatarUrl;
    if (uploadUrl) {
        return <img src={uploadUrl} alt={name} className={cx("shrink-0 rounded-full object-cover", className)} style={{ ...dim, ...ring }} />;
    }

    if (icon?.kind === "brand") {
        return <BrandLogo domain={icon.domain} name={name} size={size} className={className} />;
    }

    if (icon?.kind === "untitled-ui") {
        const Cmp = resolveIcon(icon.name);
        if (Cmp) {
            // The icon inherits `currentColor`, so set color on the wrapper.
            return (
                <span
                    className={cx("flex shrink-0 items-center justify-center rounded-full", className)}
                    style={{ ...dim, ...ring, background: color + "22", color }}
                    aria-label={name}
                >
                    <Cmp className="size-1/2" />
                </span>
            );
        }
    }

    // Fallback: initials in a tinted circle.
    return (
        <span
            className={cx("flex shrink-0 items-center justify-center rounded-full bg-brand-secondary", className)}
            style={{ ...dim, ...ring }}
        >
            <span className="text-xs font-semibold text-brand-secondary">{initials(name)}</span>
        </span>
    );
};
