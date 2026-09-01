import { describe, expect, it } from "vitest";
import { spotifyApiUrl } from "@/lib/spotify-url";

describe("Spotify API URL construction", () => {
    it("keeps valid paths on the fixed Spotify v1 origin", () => {
        expect(spotifyApiUrl("/me/player?limit=20").href).toBe("https://api.spotify.com/v1/me/player?limit=20");
        expect(spotifyApiUrl("/playlists/a%2Fb/tracks").origin).toBe("https://api.spotify.com");
    });

    it.each([
        "https://evil.test/steal",
        "//evil.test/steal",
        "/../oauth/token",
        "/%2e%2e/oauth/token",
        "/me\\@evil.test",
        "/me#fragment",
        "/me\r\nX-Test: injected",
    ])("rejects an authority or path escape: %s", (path) => {
        expect(() => spotifyApiUrl(path)).toThrow("Invalid Spotify API");
    });
});
