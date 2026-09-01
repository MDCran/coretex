import { isIP } from "node:net";
import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

export interface RendererTrustOptions {
    development: boolean;
    devServerUrl?: string;
    packagedEntryPath: string;
}

/**
 * Only the configured Vite origin (development) or the exact packaged entry
 * file may retain access to the preload bridge.
 */
export function isTrustedRendererUrl(rawUrl: string, options: RendererTrustOptions): boolean {
    try {
        const candidate = new URL(rawUrl);
        if (options.development) {
            if (!options.devServerUrl) return false;
            const devServer = new URL(options.devServerUrl);
            return (
                (candidate.protocol === "http:" || candidate.protocol === "https:") &&
                candidate.origin === devServer.origin
            );
        }

        if (candidate.protocol !== "file:") return false;
        const candidatePath = resolvePath(fileURLToPath(candidate));
        const expectedPath = resolvePath(options.packagedEntryPath);
        return process.platform === "win32"
            ? candidatePath.toLowerCase() === expectedPath.toLowerCase()
            : candidatePath === expectedPath;
    } catch {
        return false;
    }
}

function isPrivateNetworkHost(hostname: string): boolean {
    const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (
        normalized === "localhost" ||
        normalized.endsWith(".localhost") ||
        normalized.endsWith(".local") ||
        normalized.endsWith(".internal")
    ) {
        return true;
    }

    const ipVersion = isIP(normalized);
    if (ipVersion === 4) {
        const octets = normalized.split(".").map(Number);
        const [first = 0, second = 0] = octets;
        return (
            first === 0 ||
            first === 10 ||
            first === 127 ||
            (first === 100 && second >= 64 && second <= 127) ||
            (first === 169 && second === 254) ||
            (first === 172 && second >= 16 && second <= 31) ||
            (first === 192 && second === 168) ||
            first >= 224
        );
    }
    if (ipVersion === 6) {
        return (
            normalized === "::" ||
            normalized === "::1" ||
            normalized.startsWith("fc") ||
            normalized.startsWith("fd") ||
            /^fe[89ab]/.test(normalized) ||
            normalized.startsWith("ff") ||
            normalized.startsWith("::ffff:127.") ||
            normalized.startsWith("::ffff:10.") ||
            normalized.startsWith("::ffff:192.168.")
        );
    }
    return false;
}

/**
 * Popups leave Coretex for the system browser only when they use a normal web
 * URL with a public host, or a bounded mailto URL. File, script, custom-protocol,
 * localhost, and private-network targets stay blocked.
 */
export function safeExternalUrl(rawUrl: string): string | null {
    if (rawUrl.length === 0 || rawUrl.length > 2_048 || /[\r\n]/.test(rawUrl)) return null;
    try {
        const candidate = new URL(rawUrl);
        if (candidate.protocol === "mailto:") return candidate.toString();
        if (
            (candidate.protocol !== "https:" && candidate.protocol !== "http:") ||
            candidate.username !== "" ||
            candidate.password !== "" ||
            candidate.hostname === "" ||
            isPrivateNetworkHost(candidate.hostname)
        ) {
            return null;
        }
        return candidate.toString();
    } catch {
        return null;
    }
}

/** Embedded pages may browse the web, but never load privileged local schemes. */
export function isSafeWebviewUrl(rawUrl: string): boolean {
    if (rawUrl === "about:blank") return true;
    if (rawUrl.length === 0 || rawUrl.length > 8_192 || /[\r\n]/.test(rawUrl)) return false;
    try {
        const candidate = new URL(rawUrl);
        return (
            (candidate.protocol === "https:" || candidate.protocol === "http:") &&
            candidate.hostname.length > 0
        );
    } catch {
        return false;
    }
}
