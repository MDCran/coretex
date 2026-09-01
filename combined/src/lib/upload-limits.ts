export const MAX_USER_FILE_SIZE = 25 * 1024 * 1024;
export const MAX_MULTI_UPLOAD_FILES = 5;
export const MAX_MULTI_UPLOAD_TOTAL_SIZE = 50 * 1024 * 1024;

type FileSize = { size: number };

/** Validate a bounded upload batch before any object or database write occurs. */
export function validateUploadBatch(files: readonly FileSize[]): void {
    if (files.length > MAX_MULTI_UPLOAD_FILES) {
        throw new Error(`Choose no more than ${MAX_MULTI_UPLOAD_FILES} files at a time.`);
    }
    if (files.some((file) => file.size <= 0)) throw new Error("Empty files cannot be uploaded.");
    if (files.some((file) => file.size > MAX_USER_FILE_SIZE)) throw new Error("Each file must be 25 MB or smaller.");
    if (files.reduce((total, file) => total + file.size, 0) > MAX_MULTI_UPLOAD_TOTAL_SIZE) {
        throw new Error("The selected files must total 50 MB or less.");
    }
}
