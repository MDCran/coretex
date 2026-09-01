import "server-only";

import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { db } from "@/lib/db";
import { s3, S3_BUCKET } from "@/lib/s3";
import { aiConfigured } from "@/lib/ai/claude";

export type HealthStatus = "ok" | "degraded" | "down" | "not_configured";

export interface ComponentHealth {
    name: string;
    status: HealthStatus;
    /** Round-trip time for actively probed components, else null. */
    latencyMs: number | null;
    detail?: string;
}

export interface SystemHealth {
    status: HealthStatus;
    components: ComponentHealth[];
    checkedAt: string;
}

const PROBE_TIMEOUT_MS = 3000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
        p,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms)),
    ]);
}

async function probe(name: string, fn: () => Promise<void>): Promise<ComponentHealth> {
    const start = performance.now();
    try {
        await withTimeout(fn(), PROBE_TIMEOUT_MS);
        return { name, status: "ok", latencyMs: Math.round(performance.now() - start) };
    } catch (e) {
        return { name, status: "down", latencyMs: Math.round(performance.now() - start), detail: e instanceof Error ? e.message.slice(0, 160) : "Unknown error" };
    }
}

/**
 * Probe the systems LifeOS depends on. DB and object storage are actively pinged;
 * AI and the (planned) job queue are reported from configuration. Overall status is
 * the worst of the actively-probed components — "not_configured" never marks the
 * platform down.
 */
export async function probeSystems(): Promise<SystemHealth> {
    const [database, storage] = await Promise.all([
        probe("Database", async () => {
            await db.$queryRaw`SELECT 1`;
        }),
        probe("Object storage", async () => {
            await s3.send(new HeadBucketCommand({ Bucket: S3_BUCKET }));
        }),
    ]);

    const ai: ComponentHealth = {
        name: "AI (Claude)",
        status: aiConfigured() ? "ok" : "not_configured",
        latencyMs: null,
        detail: aiConfigured() ? "API key present" : "ANTHROPIC_API_KEY not set",
    };

    const queue: ComponentHealth = {
        name: "Background jobs (Redis)",
        status: "not_configured",
        latencyMs: null,
        detail: process.env.REDIS_URL ? "REDIS_URL set — worker not yet wired" : "REDIS_URL not set",
    };

    const components = [database, storage, ai, queue];
    const status: HealthStatus = components.some((c) => c.status === "down")
        ? "down"
        : components.some((c) => c.status === "degraded")
          ? "degraded"
          : "ok";

    return { status, components, checkedAt: new Date().toISOString() };
}
