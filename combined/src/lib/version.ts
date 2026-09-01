/**
 * Build version metadata, injected at build time via next.config `env` (which reads
 * APP_VERSION / APP_CHANNEL / GIT_SHA from CI, falling back to package.json + "dev").
 * Safe to import from both server and client components.
 */

export type ReleaseChannel = "stable" | "rc" | "beta" | "alpha" | "dev";

export function channelFromVersion(v: string): ReleaseChannel {
    if (/-alpha/i.test(v)) return "alpha";
    if (/-beta/i.test(v)) return "beta";
    if (/-rc/i.test(v)) return "rc";
    if (/^\d+\.\d+\.\d+$/.test(v)) return "stable";
    return "dev";
}

const rawVersion = process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0";
const rawChannel = process.env.NEXT_PUBLIC_APP_CHANNEL as ReleaseChannel | undefined;
const sha = process.env.NEXT_PUBLIC_GIT_SHA || "";

export const APP_VERSION = {
    /** Semver, e.g. "1.2.0" or "1.3.0-beta.2". */
    version: rawVersion,
    channel: rawChannel || channelFromVersion(rawVersion),
    /** Short git SHA, or "" when not built from CI. */
    commit: sha ? sha.slice(0, 7) : "",
    buildTime: process.env.NEXT_PUBLIC_BUILD_TIME || "",
} as const;

/** Display label, e.g. "v1.3.0-beta.2". */
export const versionLabel = `v${APP_VERSION.version}`;

export const CHANNEL_LABELS: Record<ReleaseChannel, string> = {
    stable: "Stable",
    rc: "Release candidate",
    beta: "Beta",
    alpha: "Alpha",
    dev: "Dev",
};

/** Untitled UI badge color per channel. */
export const CHANNEL_BADGE_COLOR: Record<ReleaseChannel, "success" | "brand" | "warning" | "orange" | "gray"> = {
    stable: "success",
    rc: "brand",
    beta: "warning",
    alpha: "orange",
    dev: "gray",
};
