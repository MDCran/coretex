import "server-only";

import { headers } from "next/headers";

/** Origin of the incoming request (e.g. http://localhost:3000). */
export async function getRequestOrigin(): Promise<string> {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    const proto = h.get("x-forwarded-proto") ?? (process.env.NODE_ENV === "production" ? "https" : "http");
    if (host) return `${proto}://${host}`;
    const fallback = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
    return fallback || "http://localhost:3000";
}
