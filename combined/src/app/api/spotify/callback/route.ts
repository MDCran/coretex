import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { oauthRequestOrigin } from "@/lib/oauth-request-origin";
import { consumeState, exchangeCodeAndConnect, spotifyConfigured } from "@/lib/spotify";

function errorRedirect(origin: string, reason: string) {
    const url = new URL("/settings/integrations", origin);
    url.searchParams.set("spotify", "error");
    url.searchParams.set("reason", reason);
    return NextResponse.redirect(url);
}

/** OAuth callback: verify state, exchange the code, persist the connection. */
export async function GET(request: NextRequest) {
    const origin = oauthRequestOrigin(request);

    const user = await getCurrentUser();
    if (!user) {
        const login = new URL("/login", origin);
        login.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
        return NextResponse.redirect(login);
    }
    if (!spotifyConfigured()) {
        return NextResponse.redirect(new URL("/settings/integrations?spotify=unconfigured", origin));
    }

    const params = request.nextUrl.searchParams;
    const spotifyError = params.get("error");
    if (spotifyError) {
        return errorRedirect(origin, spotifyError);
    }

    const code = params.get("code");
    const state = params.get("state");
    const validState = await consumeState(state);
    if (!code) {
        return errorRedirect(origin, "missing_code");
    }
    if (!validState) {
        return errorRedirect(origin, "invalid_state");
    }

    try {
        await exchangeCodeAndConnect({ userId: user.id, code, requestOrigin: origin });
    } catch (e) {
        console.error("[spotify callback]", e);
        return errorRedirect(origin, "token_exchange");
    }

    return NextResponse.redirect(new URL("/settings/integrations?spotify=connected", origin));
}
