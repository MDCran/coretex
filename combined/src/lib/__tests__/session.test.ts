import { describe, expect, it } from "vitest";
import { sessionOptionsForEnvironment } from "../session";

describe("session configuration", () => {
    it("uses an isolated development fallback", () => {
        const options = sessionOptionsForEnvironment({ NODE_ENV: "development" });
        expect(options.cookieOptions?.secure).toBe(false);
        expect(String(options.password).length).toBeGreaterThanOrEqual(32);
    });

    it("requires a unique production secret", () => {
        expect(() => sessionOptionsForEnvironment({ NODE_ENV: "production" })).toThrow(/SESSION_SECRET/);
        expect(() => sessionOptionsForEnvironment({
            NODE_ENV: "production",
            SESSION_SECRET: "change-me-to-a-32+-char-random-string!!",
        })).toThrow(/SESSION_SECRET/);
    });

    it("accepts a strong production secret and enables secure cookies", () => {
        const options = sessionOptionsForEnvironment({
            NODE_ENV: "production",
            SESSION_SECRET: "a-unique-production-secret-that-is-long-enough",
        });
        expect(options.cookieOptions?.secure).toBe(true);
    });
});
