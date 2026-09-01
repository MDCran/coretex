import { readFileSync } from "node:fs";

/**
 * Resolve the build's version metadata. CI/release injects APP_VERSION / GIT_SHA /
 * APP_CHANNEL; locally we fall back to package.json and a "dev" channel. These are
 * exposed as NEXT_PUBLIC_* so both server and client can read them (see lib/version).
 */
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

function channelFromVersion(v) {
    if (/-alpha/i.test(v)) return "alpha";
    if (/-beta/i.test(v)) return "beta";
    if (/-rc/i.test(v)) return "rc";
    if (/^\d+\.\d+\.\d+$/.test(v)) return "stable";
    return "dev";
}

const APP_VERSION = process.env.APP_VERSION || pkg.version;
const APP_CHANNEL = process.env.APP_CHANNEL || channelFromVersion(APP_VERSION);
const GIT_SHA = process.env.GIT_SHA || process.env.GITHUB_SHA || "";
const BUILD_TIME = process.env.BUILD_TIME || new Date().toISOString();

/** @type {import('next').NextConfig} */
const nextConfig = {
    output: "standalone",
    serverExternalPackages: ["jspdf", "jspdf-autotable"],
    // localhost and 127.0.0.1 are different origins in dev — allow both so client JS loads on either.
    allowedDevOrigins: ["127.0.0.1", "localhost"],
    experimental: {
        optimizePackageImports: ["@untitledui/icons"],
        // Upload batches allow five files, 25 MiB each and 50 MiB total,
        // with bounded room for multipart fields and headers.
        serverActions: { bodySizeLimit: "55mb" },
    },
    env: {
        NEXT_PUBLIC_APP_VERSION: APP_VERSION,
        NEXT_PUBLIC_APP_CHANNEL: APP_CHANNEL,
        NEXT_PUBLIC_GIT_SHA: GIT_SHA,
        NEXT_PUBLIC_BUILD_TIME: BUILD_TIME,
    },
};

export default nextConfig;
