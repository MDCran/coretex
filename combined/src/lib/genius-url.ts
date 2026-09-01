const MAX_GENIUS_PAGE_URL_LENGTH = 2_048;
const GENIUS_PAGE_HOSTS = new Set(["genius.com", "www.genius.com"]);

export const GENIUS_FETCH_REDIRECT = "error" as const;

/** Parse an API-provided Genius page URL without allowing an arbitrary network target. */
export function geniusPageUrl(value: string): URL {
    if (
        !value ||
        value.length > MAX_GENIUS_PAGE_URL_LENGTH ||
        value !== value.trim() ||
        /[\u0000-\u001f\u007f]/.test(value)
    ) {
        throw new Error("Invalid Genius page URL");
    }

    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error("Invalid Genius page URL");
    }

    if (
        url.protocol !== "https:" ||
        !GENIUS_PAGE_HOSTS.has(url.hostname) ||
        url.username ||
        url.password ||
        url.port ||
        url.href.length > MAX_GENIUS_PAGE_URL_LENGTH
    ) {
        throw new Error("Invalid Genius page URL");
    }

    return url;
}

export function safeGeniusPageUrl(value: string | null | undefined): URL | null {
    if (!value) return null;
    try {
        return geniusPageUrl(value);
    } catch {
        return null;
    }
}
