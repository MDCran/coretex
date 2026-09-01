import { DeleteObjectCommand, DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";

export const S3_BUCKET = process.env.S3_BUCKET ?? "lifeos";

export const s3 = new S3Client({
    region: "us-east-1",
    endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9400",
    forcePathStyle: true, // required for MinIO
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY ?? "minioadmin",
        secretAccessKey: process.env.S3_SECRET_KEY ?? "minioadmin",
    },
});

/** Build a namespaced object key: u/{userId}/{module}/{filename} */
export function objectKey(userId: string, module: string, filename: string) {
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    return `u/${userId}/${module}/${randomUUID()}-${safe}`;
}

export async function uploadObject(
    key: string,
    body: Buffer | Uint8Array,
    contentType: string,
    metadata?: Record<string, string>,
) {
    await s3.send(new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, Body: body, ContentType: contentType, Metadata: metadata }));
    return key;
}

export async function getObjectStream(key: string) {
    return s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
}

export async function deleteObject(key: string) {
    await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
}

/** Delete every object owned by a user, including abandoned uploads. */
export async function deleteUserObjects(userId: string) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(userId)) throw new Error("Invalid user id");
    const prefix = `u/${userId}/`;
    let continuationToken: string | undefined;
    do {
        const page = await s3.send(new ListObjectsV2Command({
            Bucket: S3_BUCKET,
            Prefix: prefix,
            ContinuationToken: continuationToken,
        }));
        const objects = (page.Contents ?? []).flatMap(({ Key }) => (Key ? [{ Key }] : []));
        if (objects.length > 0) {
            await s3.send(new DeleteObjectsCommand({ Bucket: S3_BUCKET, Delete: { Objects: objects, Quiet: true } }));
        }
        continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);
}

export async function presignedGetUrl(key: string, expiresIn = 900) {
    return getSignedUrl(s3, new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }), { expiresIn });
}
