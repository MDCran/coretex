/**
 * Synthetic checks for critical flows — run in CI/cron against a deployed instance.
 *
 *   SYNTHETIC_BASE_URL=https://app.example.com npx tsx scripts/synthetic-checks.ts
 *
 * Exits non-zero if any check fails. Authenticated checks run only when a session
 * cookie is supplied via SYNTHETIC_SESSION_COOKIE (e.g. "lifeos_session=...").
 */

const BASE = (process.env.SYNTHETIC_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const COOKIE = process.env.SYNTHETIC_SESSION_COOKIE ?? "";

interface CheckResult {
    name: string;
    ok: boolean;
    ms: number;
    detail: string;
}

async function check(name: string, run: () => Promise<string>): Promise<CheckResult> {
    const start = Date.now();
    try {
        const detail = await run();
        return { name, ok: true, ms: Date.now() - start, detail };
    } catch (e) {
        return { name, ok: false, ms: Date.now() - start, detail: e instanceof Error ? e.message : String(e) };
    }
}

async function main() {
    const results: CheckResult[] = [];

    results.push(
        await check("Health endpoint", async () => {
            const res = await fetch(`${BASE}/api/health`, { cache: "no-store" });
            const body = (await res.json()) as { status?: string };
            if (res.status >= 500) throw new Error(`HTTP ${res.status} (status=${body.status})`);
            if (body.status === "down") throw new Error("reported status=down");
            return `status=${body.status}`;
        }),
    );

    results.push(
        await check("Login page renders", async () => {
            const res = await fetch(`${BASE}/login`, { redirect: "manual" });
            if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
            return "200";
        }),
    );

    if (COOKIE) {
        const authed: Array<[string, string]> = [
            ["Dashboard loads (authed)", "/dashboard"],
            ["Financial transactions (authed)", "/financial/transactions"],
        ];
        for (const [name, path] of authed) {
            results.push(
                await check(name, async () => {
                    const res = await fetch(`${BASE}${path}`, { headers: { cookie: COOKIE }, redirect: "manual" });
                    if (res.status === 307 || res.status === 302) throw new Error("redirected (session invalid?)");
                    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
                    return "200";
                }),
            );
        }
    } else {
        console.log("• Skipping authed checks (set SYNTHETIC_SESSION_COOKIE to enable).");
    }

    let failed = 0;
    for (const r of results) {
        const mark = r.ok ? "PASS" : "FAIL";
        if (!r.ok) failed++;
        console.log(`[${mark}] ${r.name} — ${r.detail} (${r.ms}ms)`);
    }

    console.log(`\n${results.length - failed}/${results.length} checks passed against ${BASE}`);
    if (failed > 0) process.exit(1);
}

main().catch((e) => {
    console.error("Synthetic checks crashed:", e);
    process.exit(1);
});
