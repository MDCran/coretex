/**
 * Authenticated smoke test: creates/repairs a test user, mints a valid iron-session
 * cookie, then requests every module route and reports non-200 responses.
 *
 * Usage: npx tsx scripts/smoke-test.ts http://localhost:3004
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { sealData } from "iron-session";
import { randomUUID } from "node:crypto";

const target = new URL(process.argv[2] ?? "http://localhost:3200");
if (target.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) || target.username || target.password) {
    throw new Error("Route smoke tests are restricted to a local HTTP server.");
}
const BASE = target.origin;
function sessionSecret(): string {
    const value = process.env.SESSION_SECRET?.trim();
    if (!value || value.length < 32) throw new Error("Set a unique SESSION_SECRET of at least 32 characters before running route smokes.");
    return value;
}

const SECRET = sessionSecret();

const ROUTES = [
    "/dashboard",
    "/career", "/career/applications", "/career/applications/new", "/career/companies", "/career/companies/new",
    "/career/contacts", "/career/contacts/new", "/career/documents",
    "/career/salary", "/career/resume",
    "/nutrition",
    "/health", "/health/metrics", "/health/goals", "/health/vitals", "/health/sleep",
    "/health/habits", "/health/journal", "/health/medical", "/health/photos",
    "/health/sobriety",
    "/health/peptides", "/health/medications",
    "/workouts", "/workouts/log", "/workouts/schedule", "/workouts/exercises", "/workouts/exercises/new",
    "/workouts/templates", "/workouts/templates/new", "/workouts/body", "/workouts/progress",
    "/financial", "/financial/accounts", "/financial/cards", "/financial/institutions", "/financial/transactions",
    "/financial/statements", "/financial/subscriptions", "/financial/income", "/financial/budget",
    "/financial/tax",
    "/social", "/social/contacts", "/social/contacts/new", "/social/drafts", "/social/events",
    "/learning", "/learning/courses", "/learning/flashcards", "/learning/quizzes", "/learning/notes",
    "/learning/sessions", "/learning/goals",
    "/calendar", "/calendar/categories", "/calendar/reminders",
    "/focus", "/todos", "/notifications",
    "/settings", "/settings/account", "/settings/ai", "/settings/integrations",
];

async function main() {
    const db = new PrismaClient();
    let smokeUserId: string | null = null;
    try {
        const nonce = randomUUID();
        const passwordHash = await bcrypt.hash(randomUUID(), 10);
        const user = await db.user.create({
            data: {
                email: `route-smoke-${nonce}@example.invalid`,
                name: "Route smoke test",
                passwordHash,
                profile: { create: {} },
                settings: { create: {} },
            },
        });
        smokeUserId = user.id;

        const sealed = await sealData({ userId: user.id }, { password: SECRET, ttl: 15 * 60 });
        const cookie = `lifeos_session=${sealed}`;

        let pass = 0;
        const failures: Array<{ route: string; status: number; detail?: string }> = [];
        for (const route of ROUTES) {
            try {
                const res = await fetch(BASE + route, {
                    headers: { cookie },
                    redirect: "manual",
                    signal: AbortSignal.timeout(20_000),
                });
                const body = await res.text();
                const errorPage = /Application error: a client-side exception|Internal Server Error|This page could not be found/i.test(body);
                if (res.status === 200 && !errorPage) {
                    pass++;
                } else {
                    failures.push({ route, status: res.status, detail: errorPage ? "error page content" : undefined });
                }
            } catch (error) {
                failures.push({ route, status: -1, detail: error instanceof Error ? error.message : "request failed" });
            }
        }

        console.log(`${pass}/${ROUTES.length} routes rendered without a server error`);
        if (failures.length) {
            for (const failure of failures) console.log(`${failure.status} ${failure.route}${failure.detail ? ` — ${failure.detail}` : ""}`);
            throw new Error(`${failures.length} route smoke test(s) failed`);
        }
    } finally {
        if (smokeUserId) await db.user.deleteMany({ where: { id: smokeUserId } });
        await db.$disconnect();
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Route smoke failed");
    process.exitCode = 1;
});
