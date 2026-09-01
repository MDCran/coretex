import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

/** Resolve bridge credentials without putting the bearer token in URLs or logs. */
export async function bridgeProtocols(url) {
    const explicit = process.env.CORETEX_BRIDGE_TOKEN?.trim();
    if (explicit) {
        if (!TOKEN_PATTERN.test(explicit)) throw new Error("CORETEX_BRIDGE_TOKEN is not valid base64url.");
        return ["coretex-v1", `coretex-auth.${explicit}`];
    }

    const parsed = new URL(url);
    const port = Number(parsed.port || (parsed.protocol === "wss:" ? 443 : 80));
    const defaultDir = port === 8766 ? ".coretex-dev" : ".coretex";
    const dataDir = process.env.CORETEX_DATA_DIR?.trim() || join(homedir(), defaultDir);
    let session;
    try {
        session = JSON.parse(await readFile(join(dataDir, "bridge-session.json"), "utf8"));
    } catch {
        throw new Error("No authenticated Coretex bridge session was found. Start the Brain or set CORETEX_BRIDGE_TOKEN.");
    }
    if (session?.version !== 1 || session?.port !== port || !TOKEN_PATTERN.test(session?.token ?? "")) {
        throw new Error("The Coretex bridge session does not match the requested server.");
    }
    return ["coretex-v1", `coretex-auth.${session.token}`];
}
