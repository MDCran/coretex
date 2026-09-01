import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { buildAuthorizeUrl, geniusConfigured } from "@/lib/genius";
import { oauthRequestOrigin } from "@/lib/oauth-request-origin";

/** Begin the Genius OAuth flow. */
export async function GET(request: NextRequest) {
    const origin = oauthRequestOrigin(request);

    const user = await getCurrentUser();
    if (!user) {
        const login = new URL("/login", origin);
        login.searchParams.set("next", "/api/genius/connect");
        return NextResponse.redirect(login);
    }
    if (!geniusConfigured()) {
        return NextResponse.redirect(new URL("/settings/integrations?genius=unconfigured", origin));
    }

    const url = await buildAuthorizeUrl();
    return NextResponse.redirect(url);
}
