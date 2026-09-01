import path from "node:path";
import { readProtectedJson, writeProtectedJson } from "./protected-file.js";
import type { SecretRedactor } from "./redaction.js";

interface LocalCrashRecord {
    id: string;
    at: number;
    origin: string;
    name: string;
    message: string;
    stack?: string;
}

interface PersistedDiagnostics {
    version: 1;
    telemetry: {
        eventCount: number;
        byCommand: Record<string, number>;
        lastEventAt?: number;
    };
    crashes: LocalCrashRecord[];
}

export interface LocalDiagnosticsStatus {
    localOnly: true;
    telemetryEnabled: boolean;
    crashReportsEnabled: boolean;
    telemetryEventCount: number;
    storedCrashCount: number;
    lastCrashAt?: number;
}

const EMPTY_STATE = (): PersistedDiagnostics => ({
    version: 1,
    telemetry: { eventCount: 0, byCommand: {} },
    crashes: [],
});

/**
 * Opt-in, local-only operational diagnostics. Nothing in this class performs
 * network I/O: telemetry is limited to command-name counters, while crashes are
 * stored in the same protected local-file format as other sensitive data.
 */
export class LocalDiagnostics {
    private readonly file: string;
    private state: PersistedDiagnostics = EMPTY_STATE();
    private saveQueue: Promise<void> = Promise.resolve();
    private saveTimer: ReturnType<typeof setTimeout> | undefined;
    private crashMonitor: ((error: Error, origin: string) => void) | undefined;

    constructor(
        dataDir: string,
        private readonly telemetryEnabled: () => boolean,
        private readonly crashReportsEnabled: () => boolean,
        private readonly redactor: SecretRedactor,
    ) {
        this.file = path.join(dataDir, "diagnostics.json");
    }

    async load(): Promise<void> {
        try {
            const loaded = await readProtectedJson<Partial<PersistedDiagnostics>>(this.file);
            const telemetry = loaded.value.telemetry;
            this.state = {
                version: 1,
                telemetry: {
                    eventCount: typeof telemetry?.eventCount === "number" ? Math.max(0, Math.round(telemetry.eventCount)) : 0,
                    byCommand: telemetry?.byCommand && typeof telemetry.byCommand === "object" ? telemetry.byCommand : {},
                    lastEventAt: typeof telemetry?.lastEventAt === "number" ? telemetry.lastEventAt : undefined,
                },
                crashes: Array.isArray(loaded.value.crashes) ? loaded.value.crashes.slice(0, 20) : [],
            };
            if (loaded.needsMigration) await this.persist();
        } catch {
            this.state = EMPTY_STATE();
        }
    }

    status(): LocalDiagnosticsStatus {
        return {
            localOnly: true,
            telemetryEnabled: this.telemetryEnabled(),
            crashReportsEnabled: this.crashReportsEnabled(),
            telemetryEventCount: this.state.telemetry.eventCount,
            storedCrashCount: this.state.crashes.length,
            ...(this.state.crashes[0] ? { lastCrashAt: this.state.crashes[0].at } : {}),
        };
    }

    recordCommand(commandType: string): void {
        if (!this.telemetryEnabled()) return;
        const safeType = /^[a-z][a-z0-9:_-]{0,100}$/i.test(commandType) ? commandType : "unknown";
        this.state.telemetry.eventCount += 1;
        this.state.telemetry.byCommand[safeType] = (this.state.telemetry.byCommand[safeType] ?? 0) + 1;
        this.state.telemetry.lastEventAt = Date.now();
        this.scheduleSave();
    }

    async captureCrash(error: unknown, origin = "process"): Promise<void> {
        if (!this.crashReportsEnabled()) return;
        const source = error instanceof Error ? error : new Error(String(error));
        const message = this.redactor.redactText(source.message).slice(0, 4_000);
        const stack = source.stack ? this.redactor.redactText(source.stack).slice(0, 12_000) : undefined;
        this.state.crashes.unshift({
            id: `crash_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
            at: Date.now(),
            origin: this.redactor.redactText(origin).slice(0, 200),
            name: source.name.slice(0, 200),
            message,
            ...(stack ? { stack } : {}),
        });
        if (this.state.crashes.length > 20) this.state.crashes.length = 20;
        await this.persist();
    }

    /** Clear both local counters and stored crash records. */
    async clear(): Promise<number> {
        const cleared = this.state.telemetry.eventCount + this.state.crashes.length;
        this.state = EMPTY_STATE();
        await this.persist();
        return cleared;
    }

    installCrashMonitor(): void {
        if (this.crashMonitor) return;
        this.crashMonitor = (error: Error, origin: string): void => {
            void this.captureCrash(error, origin).catch(() => undefined);
        };
        process.on("uncaughtExceptionMonitor", this.crashMonitor);
    }

    async stop(): Promise<void> {
        if (this.crashMonitor) {
            process.off("uncaughtExceptionMonitor", this.crashMonitor);
            this.crashMonitor = undefined;
        }
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = undefined;
            await this.persist();
        } else {
            await this.saveQueue;
        }
    }

    private scheduleSave(): void {
        if (this.saveTimer) return;
        this.saveTimer = setTimeout((): void => {
            this.saveTimer = undefined;
            void this.persist().catch(() => undefined);
        // Batch command counters so Windows DPAPI does not spawn a protection
        // process for every individual UI command.
        }, 5_000);
        this.saveTimer.unref?.();
    }

    private async persist(): Promise<void> {
        const snapshot = structuredClone(this.state);
        this.saveQueue = this.saveQueue
            .catch(() => undefined)
            .then(() => writeProtectedJson(this.file, snapshot));
        await this.saveQueue;
    }
}
