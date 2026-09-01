// @ts-nocheck
import type { FC, SVGProps } from "react";
import { Globe01 } from "@untitledui/icons";
import {
    Instagram,
    Discord,
    YouTube,
    TikTok,
    Snapchat,
    LinkedIn,
    X,
    Facebook,
    Reddit,
    GitHub,
    Telegram,
    Signal,
    Pinterest,
} from "@/components/foundations/social-icons";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

/** Map platform key → brand icon. Falls back to a globe for anything custom. */
const ICONS: Record<string, FC<IconProps>> = {
    Instagram,
    Discord,
    YouTube,
    TikTok,
    Snapchat,
    LinkedIn,
    X,
    Twitter: X,
    Facebook,
    Reddit,
    GitHub,
    Telegram,
    Signal,
    Pinterest,
    // Twitch / Threads / WhatsApp have no brand glyph in the foundation set —
    // they render the globe fallback, which is fine and still clearly a link.
};

export function PlatformIcon({ platform, className }: { platform: string | null | undefined; className?: string }) {
    const Icon = (platform && ICONS[platform]) || Globe01;
    return <Icon className={className} aria-hidden="true" />;
}
