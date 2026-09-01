import type { NextRequest } from "next/server";

function parsedHttpOrigin(value: string | undefined): URL | null {
    if (!value) return null;
    try {
        const parsed = new URL(value);
        if (!(["http:", "https:"] as string[]).includes(parsed.protocol) || parsed.username || parsed.password) return null;
        return parsed;
    } catch {
        return null;
    }
}

function isLoopback(hostname: string): boolean {
    const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function oauthOriginForRequestUrl(requestUrl: string, environment: NodeJS.ProcessEnv = process.env): string {
    const configured = parsedHttpOrigin(environment.NEXT_PUBLIC_APP_URL?.trim());
    if (configured && configured.protocol === "http:" && !isLoopback(configured.hostname)) {
        throw new Error("NEXT_PUBLIC_APP_URL must use HTTPS outside localhost.");
    }

    if (environment.NODE_ENV === "production") {
        if (!configured) throw new Error("Set NEXT_PUBLIC_APP_URL to the canonical application origin.");
        return configured.origin;
    }

    const requested = parsedHttpOrigin(requestUrl);
    if (requested && isLoopback(requested.hostname)) return requested.origin;
    return configured?.origin ?? "http://localhost:3000";
}

/** Canonical browser origin for OAuth redirects; never trusts forwarded Host headers. */
export function oauthRequestOrigin(request: NextRequest): string {
    return oauthOriginForRequestUrl(request.nextUrl.href);
}
