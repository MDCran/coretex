import { describe, expect, it } from "vitest";
import {
    MAX_MULTI_UPLOAD_FILES,
    MAX_MULTI_UPLOAD_TOTAL_SIZE,
    MAX_USER_FILE_SIZE,
    validateUploadBatch,
} from "../upload-limits";

describe("multi-file upload limits", () => {
    it("accepts a bounded valid batch", () => {
        expect(() => validateUploadBatch([{ size: MAX_USER_FILE_SIZE }, { size: MAX_USER_FILE_SIZE }])).not.toThrow();
    });

    it("rejects excessive count, individual size, aggregate size, and empty files", () => {
        expect(() => validateUploadBatch(Array.from({ length: MAX_MULTI_UPLOAD_FILES + 1 }, () => ({ size: 1 })))).toThrow(/no more/);
        expect(() => validateUploadBatch([{ size: MAX_USER_FILE_SIZE + 1 }])).toThrow(/25 MB/);
        const thirdPlusOne = Math.floor(MAX_MULTI_UPLOAD_TOTAL_SIZE / 3) + 1;
        expect(() => validateUploadBatch([{ size: thirdPlusOne }, { size: thirdPlusOne }, { size: thirdPlusOne }])).toThrow(/50 MB/);
        expect(() => validateUploadBatch([{ size: 0 }])).toThrow(/Empty/);
    });
});
