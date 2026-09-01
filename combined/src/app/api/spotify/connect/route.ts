import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { oauthRequestOrigin } from "@/lib/oauth-request-origin";
import { buildAuthorizeUrl, spotifyConfigured, spotifyOAuthOrigin } from "@/lib/spotify";

/** Begin the Spotify OAuth flow: stores a state nonce and redirects to authorize. */
export async function GET(request: NextRequest) {
    const origin = oauthRequestOrigin(request);

    if (!spotifyConfigured()) {
        return NextResponse.redirect(new URL("/settings/integrations?spotify=unconfigured", origin));
    }

    // Spotify calls back to the registered redirect URI's origin (e.g. 127.0.0.1).
    // The OAuth `state` cookie is host-bound, so it must be SET on that same origin or
    // the callback can't read it back (→ invalid_state, the "URI connection" failure).
    // When the browser is on a different host (e.g. localhost), bounce the whole flow —
    // login included — onto the canonical origin first so cookie host == callback host.
    const canonicalOrigin = spotifyOAuthOrigin(origin);
    if (canonicalOrigin !== origin) {
        return NextResponse.redirect(new URL("/api/spotify/connect", canonicalOrigin));
    }

    const user = await getCurrentUser();
    if (!user) {
        const login = new URL("/login", origin);
        login.searchParams.set("next", "/api/spotify/connect");
        return NextResponse.redirect(login);
    }

    const url = await buildAuthorizeUrl(origin);
    return NextResponse.redirect(url);
}
