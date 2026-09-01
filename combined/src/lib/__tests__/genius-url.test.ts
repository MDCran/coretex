import { describe, expect, it } from "vitest";
import { GENIUS_FETCH_REDIRECT, geniusPageUrl, safeGeniusPageUrl } from "@/lib/genius-url";

describe("Genius page URL validation", () => {
    it.each([
        ["https://genius.com/Radiohead-creep-lyrics", "genius.com"],
        ["https://www.genius.com/artists/Radiohead", "www.genius.com"],
        ["https://genius.com:443/search?q=radiohead", "genius.com"],
    ])("accepts a supported HTTPS Genius page: %s", (value, hostname) => {
        const parsed = geniusPageUrl(value);
        expect(parsed.protocol).toBe("https:");
        expect(parsed.hostname).toBe(hostname);
    });

    it.each([
        "http://genius.com/Radiohead-creep-lyrics",
        "https://evil.test/Radiohead-creep-lyrics",
        "https://genius.com.evil.test/Radiohead-creep-lyrics",
        "https://notgenius.com/Radiohead-creep-lyrics",
        "https://genius.com@evil.test/Radiohead-creep-lyrics",
        "https://evil.test@genius.com/Radiohead-creep-lyrics",
        "https://user:password@genius.com/Radiohead-creep-lyrics",
        "https://genius.com:8443/Radiohead-creep-lyrics",
        "//genius.com/Radiohead-creep-lyrics",
        " https://genius.com/Radiohead-creep-lyrics",
        `https://genius.com/${"a".repeat(2_048)}`,
    ])("rejects a hostile or ambiguous URL: %s", (value) => {
        expect(() => geniusPageUrl(value)).toThrow("Invalid Genius page URL");
        expect(safeGeniusPageUrl(value)).toBeNull();
    });

    it("requires fetch callers to reject redirects", () => {
        expect(GENIUS_FETCH_REDIRECT).toBe("error");
    });
});
