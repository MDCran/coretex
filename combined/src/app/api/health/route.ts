import { NextResponse } from "next/server";
import { probeSystems } from "@/lib/health";

export const dynamic = "force-dynamic";

/**
 * Public liveness/readiness probe for uptime monitors and load balancers.
 * Returns 200 when serviceable (ok/degraded), 503 when a core dependency is down.
 * Exposes only component names + status — never secrets.
 */
export async function GET() {
    const health = await probeSystems();
    return NextResponse.json(health, { status: health.status === "down" ? 503 : 200 });
}
