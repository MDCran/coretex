/**
 * Shared helpers for the LifeOS data-migration ETL scripts.
 *
 * All source data is migrated into ONE target LifeOS user account (the
 * `--user-email` account). Every source migration:
 *   - looks up that user (fails if missing),
 *   - copies S3 objects from the source bucket into the target `lifeos` bucket
 *     under a normalized key,
 *   - records an idempotency marker (a SYSTEM Notification) and skips on re-run
 *     unless `--force` is passed,
 *   - supports `--dry-run` to print per-table row counts without writing.
 *
 * Source Prisma DBs (apptracker / peptide / workout) are queried with a second
 * PrismaClient pointed at the source URL via `$queryRawUnsafe` — the source apps'
 * generated clients are not available here, so we use raw SQL with minimal row
 * types. Column identifiers created by Prisma are camelCase and case-sensitive,
 * so they MUST be double-quoted in raw SQL (e.g. SELECT "logoKey" FROM "Company").
 */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
    CopyObjectCommand,
    GetObjectCommand,
    PutObjectCommand,
    S3Client,
} from "@aws-sdk/client-s3";

// ---------------------------------------------------------------------------
// Target clients
// ---------------------------------------------------------------------------

/** Target combined-app DB. Uses the project's DATABASE_URL by default but the
 *  combined app's connection string is hard-defaulted so the script is runnable
 *  even without an env file. */
export const TARGET_DB_URL =
    process.env.LIFEOS_DATABASE_URL ??
    process.env.DATABASE_URL ??
    "postgresql://lifeos:lifeos@localhost:5450/lifeos";

export const prisma = new PrismaClient({
    datasources: { db: { url: TARGET_DB_URL } },
});

// Target MinIO (lifeos bucket).
export const TARGET_S3 = {
    endpoint: process.env.LIFEOS_S3_ENDPOINT ?? "http://localhost:9400",
    region: process.env.LIFEOS_S3_REGION ?? "us-east-1",
    accessKeyId: process.env.LIFEOS_S3_ACCESS_KEY ?? "minioadmin",
    secretAccessKey: process.env.LIFEOS_S3_SECRET_KEY ?? "minioadmin",
    bucket: process.env.LIFEOS_S3_BUCKET ?? "lifeos",
};

const targetS3Client = new S3Client({
    endpoint: TARGET_S3.endpoint,
    region: TARGET_S3.region,
    forcePathStyle: true,
    credentials: {
        accessKeyId: TARGET_S3.accessKeyId,
        secretAccessKey: TARGET_S3.secretAccessKey,
    },
});

// ---------------------------------------------------------------------------
// Source connection descriptors
// ---------------------------------------------------------------------------

export interface SourceS3 {
    endpoint: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
}

export const SOURCES = {
    apptracker: {
        db: "postgresql://apptracker:apptracker@localhost:5440/apptracker",
        s3: {
            endpoint: "http://localhost:9300",
            region: "us-east-1",
            accessKeyId: "minioadmin",
            secretAccessKey: "minioadmin",
            bucket: "attachments",
        } as SourceS3,
    },
    peptide: {
        db: "postgresql://peptide:peptide@localhost:5441/peptide",
        s3: null,
    },
    workout: {
        db: "postgresql://postgres:postgres@localhost:5434/workout",
        s3: {
            endpoint: "http://localhost:9000",
            region: "us-east-1",
            accessKeyId: "minioadmin",
            secretAccessKey: "minioadmin",
            bucket: "workout-media",
        } as SourceS3,
    },
    health: {
        db: "postgresql://health_user:health_dev_pass@localhost:5433/personal_health",
        s3: {
            endpoint: "http://localhost:4566",
            region: "us-east-1",
            accessKeyId: "test",
            secretAccessKey: "test",
            bucket: "health-tracker",
        } as SourceS3,
    },
} as const;

export type SourceName = keyof typeof SOURCES;

/** Build a PrismaClient pointed at a source Postgres for raw SELECTs. */
export function sourcePrisma(url: string): PrismaClient {
    return new PrismaClient({ datasources: { db: { url } } });
}

const sourceS3Cache = new Map<string, S3Client>();
function sourceS3Client(cfg: SourceS3): S3Client {
    const key = `${cfg.endpoint}|${cfg.accessKeyId}|${cfg.bucket}`;
    let client = sourceS3Cache.get(key);
    if (!client) {
        client = new S3Client({
            endpoint: cfg.endpoint,
            region: cfg.region,
            forcePathStyle: true,
            credentials: {
                accessKeyId: cfg.accessKeyId,
                secretAccessKey: cfg.secretAccessKey,
            },
        });
        sourceS3Cache.set(key, client);
    }
    return client;
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

export interface CliArgs {
    userEmail: string;
    dryRun: boolean;
    force: boolean;
}

export function parseArgs(argv: string[] = process.argv.slice(2)): CliArgs {
    let userEmail = "";
    let dryRun = false;
    let force = false;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--user-email") {
            userEmail = argv[++i] ?? "";
        } else if (a.startsWith("--user-email=")) {
            userEmail = a.slice("--user-email=".length);
        } else if (a === "--dry-run") {
            dryRun = true;
        } else if (a === "--force") {
            force = true;
        }
    }
    if (!userEmail) {
        throw new Error(
            "Missing required --user-email <email> (the target LifeOS account that will own all migrated rows).",
        );
    }
    return { userEmail, dryRun, force };
}

/** Resolve the target user id from email; throws if not found. */
export async function resolveUserId(email: string): Promise<string> {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
        throw new Error(
            `Target user not found for email "${email}". Register the account first.`,
        );
    }
    return user.id;
}

// ---------------------------------------------------------------------------
// Id-map helper
// ---------------------------------------------------------------------------

/** Map<oldId, newId> with a typed get that throws on a missing required key. */
export class IdMap {
    private map = new Map<string, string>();
    constructor(public readonly label: string) {}

    set(oldId: string | number | bigint, newId: string): void {
        this.map.set(String(oldId), newId);
    }
    get(oldId: string | number | bigint | null | undefined): string | undefined {
        if (oldId === null || oldId === undefined) return undefined;
        return this.map.get(String(oldId));
    }
    require(oldId: string | number | bigint): string {
        const v = this.map.get(String(oldId));
        if (v === undefined) {
            throw new Error(`IdMap[${this.label}] missing mapping for ${oldId}`);
        }
        return v;
    }
    get size(): number {
        return this.map.size;
    }
}

// ---------------------------------------------------------------------------
// S3 copy helper
// ---------------------------------------------------------------------------

/** Sanitize a filename for use inside an object key. */
function safeName(name: string | null | undefined): string {
    if (!name) return randomUUID();
    return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180) || randomUUID();
}

/**
 * Copy an object from a source bucket to the target `lifeos` bucket under a
 * normalized key `u/{targetUserId}/{module}/{originalFileName-or-uuid}`.
 *
 * - GetObject from the source endpoint, PutObject to the target endpoint.
 * - Missing source objects are tolerated with a warning; returns the new key
 *   anyway so the row still points at a stable (if absent) location, EXCEPT
 *   when the source key is empty (returns null).
 * - Returns the new target key (or null when there was no source key).
 */
export async function copyObject(
    source: SourceS3,
    sourceKey: string | null | undefined,
    targetUserId: string,
    module: string,
    opts: { originalName?: string | null; dryRun?: boolean } = {},
): Promise<string | null> {
    if (!sourceKey) return null;

    const fileName = opts.originalName
        ? safeName(opts.originalName)
        : safeName(sourceKey.split("/").pop());
    const newKey = `u/${targetUserId}/${module}/${fileName}`;

    if (opts.dryRun) return newKey;

    const src = sourceS3Client(source);
    try {
        const got = await src.send(
            new GetObjectCommand({ Bucket: source.bucket, Key: sourceKey }),
        );
        const body = got.Body as unknown as
            | NodeJS.ReadableStream
            | Uint8Array
            | undefined;
        await targetS3Client.send(
            new PutObjectCommand({
                Bucket: TARGET_S3.bucket,
                Key: newKey,
                Body: body as never,
                ContentType: got.ContentType,
                ContentLength: got.ContentLength,
            }),
        );
    } catch (err) {
        console.warn(
            `  [s3] WARN: could not copy "${sourceKey}" from ${source.bucket} -> ${newKey}: ${(err as Error).message}`,
        );
    }
    return newKey;
}

/**
 * Same-endpoint server-side copy (unused by default; kept for parity / faster
 * intra-MinIO copies if source and target share an endpoint).
 */
export async function serverSideCopy(
    sourceBucket: string,
    sourceKey: string,
    newKey: string,
): Promise<void> {
    await targetS3Client.send(
        new CopyObjectCommand({
            Bucket: TARGET_S3.bucket,
            CopySource: `/${sourceBucket}/${sourceKey}`,
            Key: newKey,
        }),
    );
}

// ---------------------------------------------------------------------------
// Idempotency marker
// ---------------------------------------------------------------------------

const SOURCE_LABELS: Record<SourceName, string> = {
    apptracker: "Application Tracker",
    peptide: "Peptide Tracker",
    workout: "Workout Tracker",
    health: "Health Tracker",
};

export function markerTitle(source: SourceName): string {
    return `${SOURCE_LABELS[source]} data imported`;
}

/** Legacy marker title (pre-rename) — still honored for idempotency. */
function legacyMarkerTitle(source: SourceName): string {
    return `migration:${source} completed`;
}

/** "FoodEntry" + 5 → "5 food entries" */
function humanizeCount(model: string, n: number): string {
    const words = model
        .replace(/_/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .toLowerCase();
    if (n === 1) return `1 ${words}`;
    const plural = words.endsWith("y") ? `${words.slice(0, -1)}ies` : words.endsWith("s") ? words : `${words}s`;
    return `${n} ${plural}`;
}

/** Human-readable one-liner of non-zero migrated counts (notification body). */
export function readableCounts(counts: Record<string, number>): string {
    const parts = Object.entries(counts)
        .filter(([, n]) => n > 0)
        .map(([table, n]) => humanizeCount(table, n));
    if (!parts.length) return "There was nothing to import — the source app was empty.";
    if (parts.length === 1) return `Brought over ${parts[0]} from the old app.`;
    const last = parts.pop();
    return `Brought over ${parts.join(", ")} and ${last} from the old app.`;
}

/** True if the source has already been migrated for this user. */
export async function alreadyMigrated(
    userId: string,
    source: SourceName,
): Promise<boolean> {
    const existing = await prisma.notification.findFirst({
        where: { userId, kind: "SYSTEM", title: { in: [markerTitle(source), legacyMarkerTitle(source)] } },
    });
    return existing !== null;
}

/** Write the completion marker (skipped in dry-run). */
export async function writeMarker(
    userId: string,
    source: SourceName,
    counts: Record<string, number>,
    dryRun: boolean,
): Promise<void> {
    if (dryRun) return;
    await prisma.notification.create({
        data: {
            userId,
            kind: "SYSTEM",
            severity: "SUCCESS",
            title: markerTitle(source),
            body: readableCounts(counts),
        },
    });
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

/** Parse "YYYY-MM-DD" (or "") into a Date or null. */
export function parseDateOnly(s: string | null | undefined): Date | null {
    if (!s) return null;
    const trimmed = s.trim();
    if (!trimmed) return null;
    const d = new Date(`${trimmed}T00:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : d;
}

/** Coerce a possibly-null DB value into a Date or null. */
export function toDate(v: unknown): Date | null {
    if (v === null || v === undefined) return null;
    if (v instanceof Date) return v;
    const d = new Date(v as string);
    return Number.isNaN(d.getTime()) ? null : d;
}

/** Coerce a Prisma Decimal / numeric / string into a JS number or null. */
export function toNum(v: unknown): number | null {
    if (v === null || v === undefined) return null;
    const n = typeof v === "number" ? v : Number(v.toString());
    return Number.isNaN(n) ? null : n;
}

/** Integer cents -> dollar number (Decimal-compatible). 12345 -> 123.45. */
export function centsToDollars(cents: unknown): number {
    const n = toNum(cents);
    return n === null ? 0 : n / 100;
}

/** BigInt cents -> dollar number. */
export function bigCentsToDollars(cents: unknown): number {
    if (cents === null || cents === undefined) return 0;
    if (typeof cents === "bigint") return Number(cents) / 100;
    const n = toNum(cents);
    return n === null ? 0 : n / 100;
}

/** Map an array of objects to a count-by progress logger. */
export function logCount(table: string, n: number): void {
    console.log(`  - ${table}: ${n}`);
}

/** Pretty-print a counts summary block. */
export function printCounts(label: string, counts: Record<string, number>): void {
    console.log(`\n[${label}] row counts:`);
    for (const [k, v] of Object.entries(counts)) {
        console.log(`  ${k.padEnd(32)} ${v}`);
    }
}

/** Disconnect a source client, ignoring errors. */
export async function safeDisconnect(client: PrismaClient): Promise<void> {
    try {
        await client.$disconnect();
    } catch {
        /* ignore */
    }
}
