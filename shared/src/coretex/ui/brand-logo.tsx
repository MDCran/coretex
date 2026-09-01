// @ts-nocheck
"use client";

// Coretex — brand logos via LogoKit (publishable key). Renders a company logo by
// domain and falls back gracefully to a monogram tile if the image fails (offline
// / unknown brand), so a missing logo never breaks layout. The browser caches the
// image; a disk cache (~/.coretex/logos) is a packaged-app enhancement.

import { useState } from "react";
import { cx } from "@/utils/cx";

// LogoKit publishable key (the `pk_` prefix denotes a client-safe token). Public
// source clones must provide their own quota/domain-restricted key; no maintainer
// token is bundled in the repository.
const ENV_LOGOKIT_KEY =
    typeof process !== "undefined" ? (process.env?.NEXT_PUBLIC_LOGOKIT_KEY as string | undefined) : undefined;
export const LOGOKIT_KEY = ENV_LOGOKIT_KEY?.trim() || "";

/** Brand → domain map used across providers, harnesses, and integrations. */
export const BRAND_DOMAINS: Record<string, string> = {
    anthropic: "anthropic.com",
    claude: "anthropic.com",
    openai: "openai.com",
    codex: "openai.com",
    gemini: "gemini.google.com",
    google: "google.com",
    ollama: "ollama.com",
    lmstudio: "lmstudio.ai",
    openrouter: "openrouter.ai",
    openclaw: "openclaw.ai",
    opencode: "opencode.ai",
    perplexity: "perplexity.ai",
    elevenlabs: "elevenlabs.io",
    higgsfield: "higgsfield.ai",
    retellai: "retellai.com",
    vercel: "vercel.com",
    supabase: "supabase.com",
    railway: "railway.app",
    aws: "aws.amazon.com",
    twilio: "twilio.com",
    sendgrid: "sendgrid.com",
    mongodb: "mongodb.com",
    github: "github.com",
};

export function brandDomain(key: string): string {
    return BRAND_DOMAINS[key] ?? (key.includes(".") ? key : `${key}.com`);
}

/**
 * Provider key → domain LogoKit serves the mark for. One source of truth shared by
 * the providers strip, AI-providers settings, and the model-pricing table so the
 * Gemini mark (and every other) is consistent everywhere.
 */
export const PROVIDER_DOMAIN: Record<string, string> = {
    anthropic: "anthropic.com",
    openai: "openai.com",
    ollama: "ollama.com",
    lmstudio: "lmstudio.ai",
    gemini: "gemini.google.com",
    openrouter: "openrouter.ai",
    openclaw: "openclaw.ai",
};

interface Props {
    /** A company domain ("openai.com") or a known brand key ("ollama"). */
    domain: string;
    name?: string;
    size?: number;
    className?: string;
    /** Tile background for the logo (logos often need a light/neutral chip). */
    chip?: boolean;
    /**
     * Chip fill. Defaults to a neutral, theme-aware surface (not a glaring white
     * square in dark mode). Pass an explicit value to override per usage.
     */
    chipBg?: string;
}

export const BrandLogo = ({ domain, name, size = 24, className, chip = true, chipBg = "var(--surface-2)" }: Props) => {
    const [failed, setFailed] = useState(false);
    const resolved = brandDomain(domain);
    const label = name ?? resolved.replace(/\..*$/, "");
    const initial = label.slice(0, 1).toUpperCase();

    const tile = (inner: React.ReactNode, bg: string, bordered = false) => (
        <span
            className={cx("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md", className)}
            style={{ width: size, height: size, background: bg, ...(bordered ? { border: "1px solid var(--c-border)" } : null) }}
        >
            {inner}
        </span>
    );

    if (failed || !LOGOKIT_KEY) {
        return tile(<span className="text-[11px] font-semibold text-secondary">{initial}</span>, "var(--surface-2)");
    }

    const img = (
        <img
            src={`https://img.logokit.com/${resolved}?token=${LOGOKIT_KEY}`}
            alt={label}
            width={size - (chip ? 8 : 0)}
            height={size - (chip ? 8 : 0)}
            loading="lazy"
            onError={() => setFailed(true)}
            className="object-contain"
            style={{ maxWidth: "100%", maxHeight: "100%" }}
        />
    );

    return chip ? tile(img, chipBg, true) : tile(img, "transparent");
};
