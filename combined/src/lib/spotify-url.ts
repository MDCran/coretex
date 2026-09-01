const API_ORIGIN = "https://api.spotify.com";
const API_BASE = "https://api.spotify.com/v1";

/** Resolve a Spotify API path without allowing caller data to select an authority. */
export function spotifyApiUrl(path: string): URL {
    if (
        !path.startsWith("/") ||
        path.startsWith("//") ||
        path.includes("\\") ||
        path.includes("#") ||
        /[\u0000-\u001f\u007f]/.test(path)
    ) {
        throw new Error("Invalid Spotify API path.");
    }

    const queryStart = path.indexOf("?");
    const pathname = queryStart === -1 ? path : path.slice(0, queryStart);
    const search = queryStart === -1 ? "" : path.slice(queryStart);
    const url = new URL(API_BASE);
    url.pathname = `${url.pathname}${pathname}`;
    url.search = search;
    if (
        url.protocol !== "https:" ||
        url.hostname !== "api.spotify.com" ||
        url.port !== "" ||
        url.origin !== API_ORIGIN ||
        !url.pathname.startsWith("/v1/")
    ) {
        throw new Error("Invalid Spotify API URL.");
    }
    return url;
}
