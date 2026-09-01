const FALLBACK_PATH = "/dashboard";
const BASE_ORIGIN = "https://coretex.invalid";

/** Accept only an inert same-origin path for post-login navigation. */
export function safeNextPath(value: unknown, fallback = FALLBACK_PATH): string {
    if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.length > 2_048) return fallback;
    if (/[\\\u0000-\u001f\u007f]/.test(value)) return fallback;

    let decoded = value;
    try {
        for (let pass = 0; pass < 2; pass += 1) decoded = decodeURIComponent(decoded);
    } catch {
        return fallback;
    }
    if (!decoded.startsWith("/") || decoded.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(decoded)) return fallback;

    try {
        const parsed = new URL(value, BASE_ORIGIN);
        if (parsed.origin !== BASE_ORIGIN || parsed.username || parsed.password) return fallback;
        return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
        return fallback;
    }
}
