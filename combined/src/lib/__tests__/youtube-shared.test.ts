import { describe, expect, it } from "vitest";
import { decodeXml, parsePlaylistId, parseVideoId } from "@/lib/learning/youtube-shared";

describe("YouTube URL trust boundaries", () => {
    const id = "dQw4w9WgXcQ";

    it("accepts supported URL shapes and raw IDs", () => {
        expect(parseVideoId(id)).toBe(id);
        expect(parseVideoId(`https://www.youtube.com/watch?v=${id}`)).toBe(id);
        expect(parseVideoId(`https://m.youtube.com/shorts/${id}`)).toBe(id);
        expect(parseVideoId(`https://www.youtube-nocookie.com/embed/${id}`)).toBe(id);
        expect(parseVideoId(`https://youtu.be/${id}?si=abc`)).toBe(id);
    });

    it("rejects hostile hosts, schemes, userinfo, and arbitrary text", () => {
        expect(parseVideoId(`https://youtube.com.evil.test/watch?v=${id}`)).toBeNull();
        expect(parseVideoId(`https://youtube.com@evil.test/watch?v=${id}`)).toBeNull();
        expect(parseVideoId(`javascript:https://youtube.com/watch?v=${id}`)).toBeNull();
        expect(parseVideoId(`watch this ${id} now`)).toBeNull();
        expect(parseVideoId(`https://youtube.com/watch?v=${id}x`)).toBeNull();
    });

    it("only accepts playlists from YouTube or a valid raw list id", () => {
        const playlist = "PL1234_abcd-XYZ";
        expect(parsePlaylistId(playlist)).toBe(playlist);
        expect(parsePlaylistId(`https://youtube.com/playlist?list=${playlist}`)).toBe(playlist);
        expect(parsePlaylistId(`https://youtube.com.evil.test/playlist?list=${playlist}`)).toBeNull();
        expect(parsePlaylistId("https://youtube.com/playlist?list=bad%20id")).toBeNull();
    });
});

describe("XML entity decoding", () => {
    it("decodes one source layer without double-unescaping nested markup", () => {
        expect(decodeXml("Tom &amp; Jerry &lt;3")) .toBe("Tom & Jerry <3");
        expect(decodeXml("&amp;lt;script&amp;gt;")) .toBe("&lt;script&gt;");
    });
});
