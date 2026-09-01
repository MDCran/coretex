import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { attachmentHeader, canServeInline, safeContentType } from "@/lib/file-response";
import { getObjectStream } from "@/lib/s3";

/**
 * Streams S3 (MinIO) objects through the app for same-origin loading and printing.
 * Query params: key (required), download=1 (attachment disposition), name (download filename).
 * Users may only read keys under their own namespace (u/{userId}/...) or global/ assets.
 */
export async function GET(request: NextRequest) {
    const user = await getCurrentUser();
    if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const key = request.nextUrl.searchParams.get("key");
    if (!key) {
        return NextResponse.json({ error: "Missing key" }, { status: 400 });
    }

    const allowed = key.startsWith(`u/${user.id}/`) || key.startsWith("global/");
    if (!allowed) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    try {
        const object = await getObjectStream(key);
        const body = object.Body;
        if (!body) {
            return NextResponse.json({ error: "Not found" }, { status: 404 });
        }

        const headers = new Headers();
        const contentType = safeContentType(object.ContentType);
        headers.set("Content-Type", contentType);
        if (object.ContentLength !== undefined) headers.set("Content-Length", String(object.ContentLength));
        headers.set("Cache-Control", "private, no-store");
        headers.set("Content-Security-Policy", "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'");
        headers.set("Cross-Origin-Resource-Policy", "same-origin");
        headers.set("Referrer-Policy", "no-referrer");
        headers.set("X-Content-Type-Options", "nosniff");

        if (request.nextUrl.searchParams.get("download") === "1" || !canServeInline(contentType)) {
            const name = request.nextUrl.searchParams.get("name") ?? key.split("/").pop() ?? "file";
            headers.set("Content-Disposition", attachmentHeader(name));
        }

        return new NextResponse(body.transformToWebStream(), { headers });
    } catch {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
}
