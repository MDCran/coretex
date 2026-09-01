import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { consumeState, exchangeCodeAndConnect, geniusConfigured } from "@/lib/genius";
import { oauthRequestOrigin } from "@/lib/oauth-request-origin";

function errorRedirect(origin: string, reason: string) {
    const url = new URL("/settings/integrations", origin);
    url.searchParams.set("genius", "error");
    url.searchParams.set("reason", reason);
    return NextResponse.redirect(url);
}

/** OAuth callback: verify state, exchange code, persist connection. */
export async function GET(request: NextRequest) {
    const origin = oauthRequestOrigin(request);

    const user = await getCurrentUser();
    if (!user) {
        const login = new URL("/login", origin);
        login.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
        return NextResponse.redirect(login);
    }
    if (!geniusConfigured()) {
        return NextResponse.redirect(new URL("/settings/integrations?genius=unconfigured", origin));
    }

    const params = request.nextUrl.searchParams;
    const geniusError = params.get("error");
    if (geniusError) {
        return errorRedirect(origin, geniusError);
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
        await exchangeCodeAndConnect({ userId: user.id, code });
    } catch (e) {
        console.error("[genius callback]", e);
        return errorRedirect(origin, "token_exchange");
    }

    return NextResponse.redirect(new URL("/settings/integrations?genius=connected", origin));
}
