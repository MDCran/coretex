import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const coretexDir = join(repoRoot, "coretex");
const composeFile = join(repoRoot, "combined", "docker-compose.yml");
const require = createRequire(import.meta.url);
const prismaCli = require.resolve("prisma/build/index.js");
const databaseUrl =
    process.env.DATABASE_URL ?? "postgresql://lifeos:lifeos@localhost:5450/lifeos?schema=public";

function command(name, args, options = {}) {
    return spawnSync(name, args, {
        cwd: repoRoot,
        encoding: "utf8",
        windowsHide: true,
        ...options,
    });
}

function dockerReady() {
    return command("docker", ["info", "--format", "{{.ServerVersion}}"]).status === 0;
}

function startDockerDesktop() {
    if (process.platform !== "win32") return false;

    const candidates = [
        process.env.ProgramFiles && join(process.env.ProgramFiles, "Docker", "Docker", "Docker Desktop.exe"),
        process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Docker", "Docker Desktop.exe"),
    ].filter(Boolean);
    const executable = candidates.find((candidate) => existsSync(candidate));

    if (executable) {
        const child = spawn(executable, [], {
            detached: true,
            stdio: "ignore",
            windowsHide: true,
        });
        child.unref();
        return true;
    }

    // Recent Docker Desktop releases expose a CLI start command. Keep this as
    // a fallback for installations outside the standard Windows directories.
    const result = command("docker", ["desktop", "start"], { timeout: 20_000 });
    return result.status === 0 || result.error?.code === "ETIMEDOUT";
}

async function waitForDocker(timeoutMs = 120_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (dockerReady()) return;
        await delay(1_000);
    }
    throw new Error("Docker Desktop did not become ready within 2 minutes.");
}

function postgresHealth() {
    const result = command("docker", [
        "inspect",
        "--format",
        "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}",
        "lifeos-postgres",
    ]);
    return result.status === 0 ? result.stdout.trim() : "missing";
}

async function waitForPostgres(timeoutMs = 90_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const health = postgresHealth();
        if (health === "healthy" || health === "running") return;
        if (health === "unhealthy" || health === "exited" || health === "dead") {
            throw new Error(`lifeos-postgres entered the ${health} state.`);
        }
        await delay(1_000);
    }
    throw new Error("Postgres did not become healthy within 90 seconds.");
}

function runChecked(name, args, options = {}) {
    const result = command(name, args, { stdio: "inherit", ...options });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`${name} exited with status ${result.status ?? "unknown"}.`);
    }
}

async function main() {
    if (!existsSync(composeFile)) {
        throw new Error(`LifeOS compose file was not found at ${composeFile}.`);
    }

    if (!dockerReady()) {
        process.stdout.write("[lifeos-db] Starting Docker Desktop...\n");
        if (!startDockerDesktop()) {
            throw new Error("Docker is unavailable. Install or start Docker Desktop, then retry.");
        }
        await waitForDocker();
    }

    process.stdout.write("[lifeos-db] Ensuring Postgres is running...\n");
    runChecked("docker", ["compose", "-f", composeFile, "up", "-d", "db"]);
    await waitForPostgres();

    process.stdout.write("[lifeos-db] Applying pending Prisma migrations...\n");
    runChecked(process.execPath, [
        prismaCli,
        "migrate",
        "deploy",
        "--schema",
        "prisma/schema.prisma",
    ], {
        cwd: coretexDir,
        env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    process.stdout.write("[lifeos-db] Postgres is healthy and the schema is current.\n");
}

main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[lifeos-db] ${message}\n`);
    process.exitCode = 1;
});
