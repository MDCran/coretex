import { spawn } from "node:child_process";
import { access, cp, mkdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";

const projectRoot = process.cwd();
const candidates = [
    join(projectRoot, "server.js"),
    join(projectRoot, ".next", "standalone", "server.js"),
    join(projectRoot, ".next", "standalone", basename(projectRoot), "server.js"),
];

let serverPath;
for (const candidate of candidates) {
    try {
        await access(candidate);
        serverPath = candidate;
        break;
    } catch {
        // Try the next supported standalone output layout.
    }
}

if (!serverPath) {
    throw new Error("Standalone output was not found. Run `npm run build` before `npm start`.");
}

const standaloneRoot = dirname(serverPath);
const copyDirectory = async (source, target) => {
    if (resolve(source) === resolve(target)) return;
    try {
        await access(source);
    } catch {
        return;
    }
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target, { recursive: true, force: true });
};

// Next's standalone output intentionally omits public/static assets. Copy them
// beside the generated server so local `npm start` matches the Docker runtime.
await copyDirectory(join(projectRoot, "public"), join(standaloneRoot, "public"));
await copyDirectory(join(projectRoot, ".next", "static"), join(standaloneRoot, ".next", "static"));

const child = spawn(process.execPath, [serverPath], {
    cwd: standaloneRoot,
    env: process.env,
    stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => child.kill(signal));
}

child.once("error", (error) => {
    console.error(error);
    process.exitCode = 1;
});

child.once("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 1);
});
