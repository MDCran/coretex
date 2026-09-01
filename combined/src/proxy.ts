import { type NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/signup"];
const PUBLIC_API_PATHS = new Set(["/api/plaid/webhook"]);

/** OAuth routes handle their own auth + redirect to login with a return path. */
const OAUTH_API_PATHS = ["/api/spotify/connect", "/api/spotify/callback", "/api/genius/connect", "/api/genius/callback"];

export function isPublicApiPath(pathname: string): boolean {
    return PUBLIC_API_PATHS.has(pathname) || OAUTH_API_PATHS.includes(pathname);
}

export function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;
    const hasSession = request.cookies.has("lifeos_session");
    const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

    if (isPublicApiPath(pathname)) {
        return NextResponse.next();
    }

    // Unauthenticated users are sent to login (cookie validity is verified server-side).
    if (!hasSession && !isPublic) {
        const url = request.nextUrl.clone();
        url.pathname = "/login";
        return NextResponse.redirect(url);
    }

    return NextResponse.next();
}

export const config = {
    // Everything except Next internals, static files, and the file-streaming API
    matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|.*\\.(?:svg|png|jpg|jpeg|webp|css|js)).*)"],
};
