import { describe, expect, it } from "vitest";
import { oauthOriginForRequestUrl } from "../oauth-request-origin";
import { safeNextPath } from "../safe-next-path";

describe("OAuth request origin", () => {
    it("uses only the configured production origin", () => {
        expect(oauthOriginForRequestUrl("https://evil.example/callback", {
            NODE_ENV: "production",
            NEXT_PUBLIC_APP_URL: "https://app.example",
        })).toBe("https://app.example");
        expect(() => oauthOriginForRequestUrl("https://evil.example", { NODE_ENV: "production" })).toThrow(/NEXT_PUBLIC_APP_URL/);
    });

    it("preserves loopback hosts in development without trusting remote hosts", () => {
        expect(oauthOriginForRequestUrl("http://127.0.0.1:3200/api/spotify/connect", { NODE_ENV: "development" })).toBe("http://127.0.0.1:3200");
        expect(oauthOriginForRequestUrl("https://evil.example", { NODE_ENV: "development" })).toBe("http://localhost:3000");
    });
});

describe("safe post-login path", () => {
    it("preserves normal same-origin paths", () => {
        expect(safeNextPath("/settings/integrations?spotify=connected#status")).toBe("/settings/integrations?spotify=connected#status");
    });

    for (const value of ["//evil.example", "/\\evil.example", "/%5cevil.example", "/%255cevil.example", "https://evil.example", "/\u0000evil"]) {
        it(`rejects ${JSON.stringify(value)}`, () => expect(safeNextPath(value)).toBe("/dashboard"));
    }
});
