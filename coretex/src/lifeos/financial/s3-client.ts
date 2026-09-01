// Minimal S3/MinIO client for statement extraction and file previews.
// Avoids a hard @aws-sdk dependency by reusing the presigned-fetch helpers in assets.

import { getObjectBytes, isObjectStorageKey, presignedObjectUrl } from "../assets.js";

export { getObjectBytes, isObjectStorageKey, presignedObjectUrl };

/** Shape-compatible with the Combined app's getObjectStream for extract pipelines. */
export async function getObjectStream(key: string): Promise<{ Body: { transformToByteArray(): Promise<Uint8Array> } }> {
    const buffer = await getObjectBytes(key);
    return {
        Body: {
            async transformToByteArray() {
                return new Uint8Array(buffer);
            },
        },
    };
}
