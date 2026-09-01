import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ uploadObject: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/s3", () => ({
    objectKey: (_userId: string, _module: string, fileName: string) => `u/test/${fileName}`,
    uploadObject: mocks.uploadObject,
}));

import { assertUserUploadKey, uploadUserFile, uploadUserMediaFile, uploadUserRasterImage } from "@/lib/uploads";

beforeEach(() => mocks.uploadObject.mockReset());

describe("server-side upload hardening", () => {
    it("decodes and re-encodes raster images as metadata-free WebP", async () => {
        const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: "#ff0000" } })
            .withMetadata({ exif: { IFD0: { Artist: "private metadata" } } })
            .png()
            .toBuffer();
        const file = new File([new Uint8Array(png)], "avatar.png", { type: "image/png" });

        const stored = await uploadUserRasterImage("user", "profile", file);

        expect(stored.fileName).toBe("avatar.webp");
        expect(stored.mimeType).toBe("image/webp");
        const metadata = await sharp(stored.processedBuffer).metadata();
        expect(metadata.format).toBe("webp");
        expect(metadata.exif).toBeUndefined();
        expect(metadata.icc).toBeUndefined();
        expect(metadata.xmp).toBeUndefined();
        expect(mocks.uploadObject).toHaveBeenCalledWith(
            "u/test/avatar.webp",
            expect.any(Buffer),
            "image/webp",
            { "coretex-verified-raster": "1" },
        );
    });

    it("rejects active content even when the client claims it is a PNG", async () => {
        const file = new File(["<svg><script>alert(1)</script></svg>"], "avatar.png", { type: "image/png" });
        await expect(uploadUserRasterImage("user", "profile", file)).rejects.toThrow("invalid raster image");
        expect(mocks.uploadObject).not.toHaveBeenCalled();
    });

    it("stores active or unverified generic uploads as octet-stream", async () => {
        const html = new File(["<script>alert(1)</script>"], "report.html", { type: "text/html" });
        const fakeImage = new File(["not an image"], "photo.png", { type: "image/png" });

        expect((await uploadUserFile("user", "docs", html)).mimeType).toBe("application/octet-stream");
        expect((await uploadUserFile("user", "docs", fakeImage)).mimeType).toBe("application/octet-stream");
    });

    it("sanitizes every image-routed mixed-media upload", async () => {
        const fakeImage = new File(["not an image"], "certificate.png", { type: "image/png" });
        await expect(uploadUserMediaFile("user", "docs", fakeImage)).rejects.toThrow("invalid raster image");

        const png = await sharp({ create: { width: 1, height: 1, channels: 4, background: "#00ff00" } }).png().toBuffer();
        const stored = await uploadUserMediaFile("user", "docs", new File([new Uint8Array(png)], "certificate.png", { type: "image/png" }));
        expect(stored.mimeType).toBe("image/webp");
        expect(stored).not.toHaveProperty("processedBuffer");
    });

    it("accepts only client-round-tripped keys from the exact user module", () => {
        expect(() => assertUserUploadKey("user-1", "nutrition", "u/user-1/nutrition/id-photo.webp")).not.toThrow();
        expect(() => assertUserUploadKey("user-1", "nutrition", "u/user-2/nutrition/id-photo.webp")).toThrow();
        expect(() => assertUserUploadKey("user-1", "nutrition", "u/user-1/receipts/id-photo.webp")).toThrow();
        expect(() => assertUserUploadKey("user-1", "nutrition", "u/user-1/nutrition/bad\r\nkey.webp")).toThrow();
    });
});
