import { CoretexApp, AppErrorBoundary } from "@/coretex";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const dynamic = "force-dynamic";

function localBridgeConnection(): { url: string; token: string } | null {
    const url = process.env.CORETEX_BRAIN_URL ?? "ws://localhost:8765";
    const explicitToken = process.env.CORETEX_BRIDGE_TOKEN?.trim();
    if (explicitToken && /^[A-Za-z0-9_-]{43,128}$/.test(explicitToken)) return { url, token: explicitToken };
    try {
        const dataDir = process.env.CORETEX_DATA_DIR?.trim() || join(homedir(), ".coretex");
        const session = JSON.parse(readFileSync(join(dataDir, "bridge-session.json"), "utf8")) as {
            version?: number;
            port?: number;
            token?: string;
        };
        const expectedPort = Number(new URL(url).port || (url.startsWith("wss:") ? 443 : 80));
        if (session.version !== 1 || session.port !== expectedPort || !/^[A-Za-z0-9_-]{43,128}$/.test(session.token ?? "")) {
            return null;
        }
        return { url, token: session.token! };
    } catch {
        return null;
    }
}

export default function Page() {
    const connection = localBridgeConnection();
    if (!connection) {
        return (
            <main className="flex h-dvh items-center justify-center bg-primary px-6 text-center text-sm text-tertiary">
                Start the local Coretex Brain, then refresh to open this authenticated workspace.
            </main>
        );
    }
    return (
        <AppErrorBoundary>
            <CoretexApp url={connection.url} authToken={connection.token} />
        </AppErrorBoundary>
    );
}
