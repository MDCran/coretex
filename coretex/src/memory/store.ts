// Coretex — user-owned memory store. Persists MemoryItems to
// ~/.coretex/memory.json (local, exportable, not vendor-locked).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MemoryItem } from "../types.js";

export class MemoryStore {
    private items: MemoryItem[] = [];
    private readonly file: string;

    constructor(dataDir: string) {
        this.file = path.join(dataDir, "memory.json");
    }

    async load(): Promise<void> {
        try {
            const raw = await readFile(this.file, "utf8");
            const parsed = JSON.parse(raw) as unknown;
            this.items = Array.isArray(parsed)
                ? (parsed as MemoryItem[])
                    .filter((item) => item && typeof item.id === "string" && typeof item.text === "string")
                    .map((item) => this.normalize(item))
                : [];
        } catch {
            this.items = [];
        }
    }

    /** Normalize legacy scopes and categories so older memory.json still works. */
    private normalize(item: MemoryItem): MemoryItem {
        const cats = new Set(["fact", "preference", "project", "person", "instruction", "other"]);
        let scope = (item.scope ?? "global").trim() || "global";
        // Legacy bare project ids → project:<id>
        if (scope && scope !== "global" && !scope.startsWith("agent:") && !scope.startsWith("project:")) {
            scope = `project:${scope}`;
        }
        const category = cats.has(item.category) ? item.category : "other";
        return {
            ...item,
            text: item.text.trim(),
            scope,
            category,
            enabled: item.enabled !== false,
            source: item.source === "generated" || item.source === "imported" ? item.source : "manual",
            createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now(),
        };
    }

    list(): MemoryItem[] {
        return this.items.slice().sort((a, b) => b.createdAt - a.createdAt);
    }

    /** Enabled global memories, as plain text lines (for the assistant context). */
    enabledGlobalText(): string[] {
        return this.items.filter((m) => m.enabled && m.scope === "global").map((m) => m.text);
    }

    /** Memories visible to one agent run: global + its project + memories saved directly to it. */
    enabledForAgentText(agentId: string, projectId?: string): string[] {
        const scopes = new Set(["global", `agent:${agentId}`]);
        if (projectId) {
            scopes.add(`project:${projectId}`);
            scopes.add(projectId); // legacy project-only scope written by older builds
        }
        return this.items.filter((m) => m.enabled && scopes.has(m.scope)).map((m) => m.text);
    }

    /** Memories visible to AI Chat for its current project/agent scope. */
    enabledForAssistantText(projectId?: string, agentId?: string): string[] {
        if (agentId) return this.enabledForAgentText(agentId, projectId);
        const scopes = new Set(["global"]);
        if (projectId) {
            scopes.add(`project:${projectId}`);
            scopes.add(projectId);
        }
        return this.items.filter((m) => m.enabled && scopes.has(m.scope)).map((m) => m.text);
    }

    async upsert(item: MemoryItem): Promise<void> {
        const clean = this.normalize({
            ...item,
            text: item.text.trim(),
            scope: item.scope?.trim() || "global",
        });
        if (!clean.text) return;
        const idx = this.items.findIndex((m) => m.id === item.id);
        if (idx === -1) this.items.push(clean);
        else this.items[idx] = clean;
        await this.save();
    }

    async remove(id: string): Promise<void> {
        this.items = this.items.filter((m) => m.id !== id);
        await this.save();
    }

    /** Add several generated items, skipping near-duplicate text. */
    async addMany(items: MemoryItem[]): Promise<number> {
        let added = 0;
        for (const item of items) {
            const clean = this.normalize(item);
            const norm = clean.text.toLowerCase();
            if (!norm) continue;
            if (this.items.some((m) => m.text.trim().toLowerCase() === norm)) continue;
            this.items.push(clean);
            added += 1;
        }
        if (added > 0) await this.save();
        return added;
    }

    private async save(): Promise<void> {
        await mkdir(path.dirname(this.file), { recursive: true });
        await writeFile(this.file, JSON.stringify(this.items, null, 2), "utf8");
    }
}
