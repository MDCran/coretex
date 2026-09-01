// Coretex — model catalog cache. Persists the last-good model list per provider to
// ~/.coretex/models.json so the catalog survives restarts and stays usable when a
// provider is offline (served back with a `stale` flag). Offline-first: the UI shows
// cached models immediately, then live discovery refreshes them.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ModelInfo, ProviderType } from "../types.js";

export class ModelCache {
    private byProvider: Record<string, ModelInfo[]> = {};
    private fetchedAt = 0;
    private readonly file: string;

    constructor(dataDir: string) {
        this.file = path.join(dataDir, "models.json");
    }

    async load(): Promise<void> {
        try {
            const raw = JSON.parse(await readFile(this.file, "utf8")) as { byProvider?: Record<string, ModelInfo[]>; fetchedAt?: number };
            this.byProvider = raw.byProvider && typeof raw.byProvider === "object" ? raw.byProvider : {};
            this.fetchedAt = Number(raw.fetchedAt) || 0;
        } catch {
            this.byProvider = {};
            this.fetchedAt = 0;
        }
    }

    /** Cached models for a provider, flagged stale (for offline fallback). */
    stale(provider: ProviderType): ModelInfo[] {
        return (this.byProvider[provider] ?? []).map((m) => ({ ...m, stale: true }));
    }

    /** Record a provider's fresh (live) model list. */
    set(provider: ProviderType, models: ModelInfo[]): void {
        this.byProvider[provider] = models.map((m) => ({ ...m, stale: false }));
        this.fetchedAt = Date.now();
    }

    /** The whole cached catalog (flagged stale — for the offline-first initial broadcast). */
    all(): ModelInfo[] {
        return Object.keys(this.byProvider).flatMap((p) => this.stale(p as ProviderType));
    }

    getFetchedAt(): number {
        return this.fetchedAt;
    }

    async save(): Promise<void> {
        await mkdir(path.dirname(this.file), { recursive: true });
        await writeFile(this.file, JSON.stringify({ byProvider: this.byProvider, fetchedAt: this.fetchedAt }), "utf8");
    }
}
