import { EventEmitter } from "eventemitter3";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CostEntry, CostSummary, ProviderType } from "../types.js";

/** Return the YYYY-MM-DD day portion of an ISO-8601 timestamp string. */
function dayKey(ts: string): string {
    return ts.slice(0, 10);
}

/** Generate an id of the form "cost_<epochMillis>_<rand>". */
function generateId(): string {
    const epochMillis = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    return `cost_${epochMillis}_${rand}`;
}

export class CostTracker extends EventEmitter {
    private entries: CostEntry[] = [];
    private dailyCostLimitUSD: number;
    private readonly file: string | null;
    private saveTimer: ReturnType<typeof setTimeout> | null = null;
    /** Cap persisted history so the file can't grow without bound. */
    private static readonly MAX_PERSISTED = 20000;

    constructor(dailyCostLimitUSD: number = 0, dataDir?: string) {
        super();
        this.dailyCostLimitUSD = dailyCostLimitUSD;
        this.file = dataDir ? path.join(dataDir, "cost.json") : null;
    }

    /** Load persisted spend history (call once at startup) so totals survive restarts. */
    async load(): Promise<void> {
        if (!this.file) return;
        try {
            const raw = JSON.parse(await readFile(this.file, "utf8")) as { entries?: CostEntry[] };
            if (Array.isArray(raw.entries)) this.entries = raw.entries;
        } catch {
            /* no file yet */
        }
    }

    private _persist(): void {
        if (!this.file) return;
        if (this.saveTimer) clearTimeout(this.saveTimer);
        const file = this.file;
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            const kept = this.entries.slice(-CostTracker.MAX_PERSISTED);
            const payload = JSON.stringify({ entries: kept });
            void mkdir(path.dirname(file), { recursive: true })
                .then(() => writeFile(file, payload, "utf8"))
                .catch((err: unknown) => this.emit("persist:error", err));
        }, 500);
    }

    setDailyLimit(usd: number): void {
        this.dailyCostLimitUSD = usd;
    }

    record(input: {
        agentId: string;
        taskId?: string;
        projectId?: string;
        provider: ProviderType;
        model: string;
        promptTokens: number;
        completionTokens: number;
        cost: number;
    }): CostEntry {
        const entry: CostEntry = {
            id: generateId(),
            agentId: input.agentId,
            taskId: input.taskId,
            projectId: input.projectId,
            provider: input.provider,
            model: input.model,
            promptTokens: input.promptTokens,
            completionTokens: input.completionTokens,
            cost: input.cost,
            timestamp: new Date().toISOString()
        };
        this.entries.push(entry);
        this._persist();

        const summary = this.summary();
        this.emit("cost:update", summary);
        if (this.dailyCostLimitUSD > 0 && summary.totalCostToday >= this.dailyCostLimitUSD) {
            this.emit("cost:limit:hit", summary);
        }
        return entry;
    }

    today(): CostEntry[] {
        const todayKey = dayKey(new Date().toISOString());
        return this.entries.filter((entry) => dayKey(entry.timestamp) === todayKey);
    }

    byAgent(id: string): CostEntry[] {
        return this.entries.filter((entry) => entry.agentId === id);
    }

    byTask(id: string): CostEntry[] {
        return this.entries.filter((entry) => entry.taskId === id);
    }

    byProject(id: string): CostEntry[] {
        return this.entries.filter((entry) => entry.projectId === id);
    }

    isDailyLimitHit(): boolean {
        if (this.dailyCostLimitUSD <= 0) {
            return false;
        }
        const todayCost = this.today().reduce((sum, entry) => sum + entry.cost, 0);
        return todayCost >= this.dailyCostLimitUSD;
    }

    summary(): CostSummary {
        const todayKey = dayKey(new Date().toISOString());

        let totalCostAllTime = 0;
        let totalCostToday = 0;
        let totalTokensAllTime = 0;
        let totalTokensToday = 0;
        const byProvider: Partial<Record<ProviderType, { cost: number; tokens: number }>> = {};
        const byAgent: Record<string, { cost: number; tokens: number; costToday: number; tokensToday: number }> = {};
        const byModel: Record<string, { cost: number; tokens: number; provider: ProviderType; model: string; calls: number }> = {};

        for (const entry of this.entries) {
            const tokens = entry.promptTokens + entry.completionTokens;
            const isToday = dayKey(entry.timestamp) === todayKey;

            totalCostAllTime += entry.cost;
            totalTokensAllTime += tokens;
            if (isToday) {
                totalCostToday += entry.cost;
                totalTokensToday += tokens;
            }

            const providerBucket = byProvider[entry.provider] ?? { cost: 0, tokens: 0 };
            providerBucket.cost += entry.cost;
            providerBucket.tokens += tokens;
            byProvider[entry.provider] = providerBucket;

            const agentBucket = byAgent[entry.agentId] ?? { cost: 0, tokens: 0, costToday: 0, tokensToday: 0 };
            agentBucket.cost += entry.cost;
            agentBucket.tokens += tokens;
            if (isToday) {
                agentBucket.costToday += entry.cost;
                agentBucket.tokensToday += tokens;
            }
            byAgent[entry.agentId] = agentBucket;

            const modelKey = `${entry.provider}::${entry.model || "unknown"}`;
            const modelBucket = byModel[modelKey] ?? {
                cost: 0,
                tokens: 0,
                provider: entry.provider,
                model: entry.model || "unknown",
                calls: 0,
            };
            modelBucket.cost += entry.cost;
            modelBucket.tokens += tokens;
            modelBucket.calls += 1;
            byModel[modelKey] = modelBucket;
        }

        const dailyLimit = this.dailyCostLimitUSD;
        const dailyLimitRemaining =
            this.dailyCostLimitUSD > 0 ? Math.max(0, this.dailyCostLimitUSD - totalCostToday) : Infinity;

        return {
            totalCostAllTime,
            totalCostToday,
            totalTokensAllTime,
            totalTokensToday,
            byProvider,
            byAgent,
            byModel,
            recent: [...this.entries].slice(-80).reverse(),
            dailyLimit,
            dailyLimitRemaining
        };
    }

    exportCSV(): string {
        const header = "id,agentId,taskId,projectId,provider,model,promptTokens,completionTokens,cost,timestamp";
        const lines = this.entries.map((entry) => {
            return [
                entry.id,
                entry.agentId,
                entry.taskId ?? "",
                entry.projectId ?? "",
                entry.provider,
                entry.model,
                String(entry.promptTokens),
                String(entry.completionTokens),
                String(entry.cost),
                entry.timestamp
            ].join(",");
        });
        return [header, ...lines].join("\n");
    }

    clear(): void {
        this.entries = [];
        this._persist();
    }
}
