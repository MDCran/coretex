import { describe, expect, it } from "vitest";
import { attachmentHeader, canServeInline, safeContentType } from "@/lib/file-response";

describe("file response hardening", () => {
    it("normalizes valid MIME values and rejects malformed header values", () => {
        expect(safeContentType(" Image/PNG; charset=binary ")).toBe("image/png");
        expect(safeContentType("text/html\r\nX-Evil: yes")).toBe("application/octet-stream");
        expect(safeContentType(undefined)).toBe("application/octet-stream");
    });

    it("only permits the explicit passive inline allowlist", () => {
        expect(canServeInline("image/webp")).toBe(true);
        expect(canServeInline("application/pdf")).toBe(true);
        expect(canServeInline("image/svg+xml")).toBe(false);
        expect(canServeInline("text/html")).toBe(false);
    });

    it("builds a safe attachment header for Unicode, CRLF, and lone surrogates", () => {
        const header = attachmentHeader(`${"a".repeat(299)}😀\r\n\ud800.txt`);
        expect(header).toContain('filename="');
        expect(header).toContain("filename*=UTF-8''");
        expect(header).not.toContain("\r");
        expect(header).not.toContain("\n");
        expect(() => decodeURIComponent(header.split("UTF-8''")[1] ?? "")).not.toThrow();
    });
});
