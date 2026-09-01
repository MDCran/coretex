import { type SessionOptions, getIronSession } from "iron-session";
import { cookies } from "next/headers";

export type SessionData = {
    userId?: string;
};

const DEVELOPMENT_SESSION_SECRET = "dev-only-secret-change-me-32-chars!!";
const KNOWN_INSECURE_SECRETS = new Set([
    DEVELOPMENT_SESSION_SECRET,
    "change-me-to-a-32+-char-random-string!!",
]);

export function sessionOptionsForEnvironment(environment: NodeJS.ProcessEnv = process.env): SessionOptions {
    const configured = environment.SESSION_SECRET?.trim();
    if (configured && configured.length < 32) {
        throw new Error("SESSION_SECRET must contain at least 32 characters.");
    }
    if (environment.NODE_ENV === "production" && (!configured || KNOWN_INSECURE_SECRETS.has(configured))) {
        throw new Error("Set a unique 32+ character SESSION_SECRET before starting LifeOS in production.");
    }

    return {
        password: configured || DEVELOPMENT_SESSION_SECRET,
        cookieName: "lifeos_session",
        cookieOptions: {
            httpOnly: true,
            sameSite: "lax",
            secure: environment.NODE_ENV === "production",
            maxAge: 60 * 60 * 24 * 30, // 30 days
        },
    };
}

export async function getSession() {
    return getIronSession<SessionData>(await cookies(), sessionOptionsForEnvironment());
}
