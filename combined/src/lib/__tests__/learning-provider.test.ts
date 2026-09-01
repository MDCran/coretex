import { describe, expect, it } from "vitest";
import { detectLearningProvider } from "@/lib/learning/provider";

describe("learning provider detection", () => {
    it.each([
        ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube"],
        ["https://player.youtube-nocookie.com/embed/dQw4w9WgXcQ", "youtube"],
        ["https://business.udemy.com/course/security", "udemy"],
        ["https://www.coursera.org/learn/security", "coursera"],
    ])("classifies %s", (url, provider) => {
        expect(detectLearningProvider(url)).toBe(provider);
    });

    it.each([
        "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
        "https://youtube.com@evil.test/watch?v=dQw4w9WgXcQ",
        "javascript:https://udemy.com/course/security",
        "not a url containing coursera.org",
    ])("rejects spoofed or non-web input: %s", (url) => {
        expect(detectLearningProvider(url)).toBe("other");
    });
});
