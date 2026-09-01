// Coretex — the file-search index. Walks a set of user-chosen locations (a folder or a
// whole drive) and records every entry's name+path so the Files area can do a fast global
// "search everything" (distinct from the recursive search of the current folder). Persists
// to ~/.coretex/file-index.json. A live watcher (index-watcher.ts) keeps it fresh by
// applying incremental add/remove as files change on disk.

import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { IndexedEntry, IndexState } from "../types.js";

// Lifted from the old 120k/60s caps so a whole drive/volume can be indexed; the live
// watcher then keeps it current without a full re-crawl.
const MAX_ENTRIES = 500_000;
const REINDEX_BUDGET_MS = 300_000;
// Directory names skipped while indexing — pure noise that bloats the index.
const SKIP_DIRS = new Set(["node_modules", ".git", "$recycle.bin", "system volume information", ".cache"]);

/** Progress callback: (running entry count, the directory currently being walked, done). */
export type IndexProgress = (count: number, current: string, done: boolean) => void;

export class FileIndexStore {
    private locations: string[] = [];
    private entries: IndexedEntry[] = [];
    /** Fast membership set mirroring `entries` (for incremental add dedup). */
    private pathSet = new Set<string>();
    private indexedAt = 0;
    private indexing = false;
    private watching = false;
    private saveTimer: ReturnType<typeof setTimeout> | undefined;
    private readonly file: string;

    constructor(dataDir: string) {
        this.file = path.join(dataDir, "file-index.json");
    }

    async load(): Promise<void> {
        try {
            const raw = JSON.parse(await readFile(this.file, "utf8")) as Partial<{ locations: string[]; entries: IndexedEntry[]; indexedAt: number }>;
            this.locations = Array.isArray(raw.locations) ? raw.locations : [];
            this.entries = Array.isArray(raw.entries) ? raw.entries : [];
            this.indexedAt = Number(raw.indexedAt) || 0;
        } catch {
            this.locations = [];
            this.entries = [];
            this.indexedAt = 0;
        }
        this.pathSet = new Set(this.entries.map((e) => e.path));
    }

    state(): IndexState {
        return { locations: this.locations.slice(), count: this.entries.length, indexedAt: this.indexedAt, indexing: this.indexing, watching: this.watching };
    }

    getLocations(): string[] {
        return this.locations.slice();
    }

    setWatching(on: boolean): void {
        this.watching = on;
    }

    async addLocation(p: string): Promise<void> {
        const abs = path.resolve(p);
        if (!this.locations.includes(abs)) {
            this.locations.push(abs);
            await this.save();
        }
    }

    async removeLocation(p: string): Promise<void> {
        const abs = path.resolve(p);
        const prefix = abs + path.sep;
        this.locations = this.locations.filter((x) => x !== abs);
        // Separator-bounded so removing "/a/b" doesn't also strip entries under a sibling "/a/be".
        this.entries = this.entries.filter((e) => e.path !== abs && !e.path.startsWith(prefix));
        this.pathSet = new Set(this.entries.map((e) => e.path));
        await this.save();
    }

    isIndexing(): boolean {
        return this.indexing;
    }

    /** Rebuild the index by walking every location (bounded by count + wall-clock). Streams progress. */
    async reindex(onProgress?: IndexProgress): Promise<void> {
        if (this.indexing) return;
        this.indexing = true;
        const out: IndexedEntry[] = [];
        const seen = new Set<string>();
        const deadline = Date.now() + REINDEX_BUDGET_MS;
        let lastTick = 0;
        const walk = async (dir: string): Promise<void> => {
            if (out.length >= MAX_ENTRIES || Date.now() > deadline) return;
            let dirents;
            try {
                dirents = await readdir(dir, { withFileTypes: true });
            } catch {
                return;
            }
            for (const d of dirents) {
                if (out.length >= MAX_ENTRIES || Date.now() > deadline) return;
                const full = path.join(dir, d.name);
                out.push({ name: d.name, path: full, isDir: d.isDirectory() });
                seen.add(full);
                if (onProgress) {
                    const now = Date.now();
                    if (out.length % 2000 === 0 || now - lastTick > 400) {
                        lastTick = now;
                        onProgress(out.length, dir, false);
                    }
                }
                if (d.isDirectory() && !SKIP_DIRS.has(d.name.toLowerCase())) await walk(full);
            }
        };
        try {
            for (const loc of this.locations) await walk(path.resolve(loc));
        } finally {
            this.entries = out;
            this.pathSet = seen;
            this.indexedAt = Date.now();
            this.indexing = false;
            await this.save();
            onProgress?.(out.length, "", true);
        }
    }

    /** Name-substring search over the whole index, capped. */
    search(query: string, limit = 500): IndexedEntry[] {
        const q = query.trim().toLowerCase();
        if (!q) return [];
        const hits: IndexedEntry[] = [];
        for (const e of this.entries) {
            if (e.name.toLowerCase().includes(q)) {
                hits.push(e);
                if (hits.length >= limit) break;
            }
        }
        return hits;
    }

    // ---- Incremental updates (driven by the live watcher) ----

    /** Is this path under a watched/indexed location? */
    underLocation(p: string): boolean {
        const abs = path.resolve(p);
        return this.locations.some((l) => abs === l || abs.startsWith(l + path.sep));
    }

    /** Add a single path if not already present; returns true if the index changed. */
    addPath(p: string, isDir: boolean): boolean {
        const abs = path.resolve(p);
        if (this.pathSet.has(abs) || this.entries.length >= MAX_ENTRIES) return false;
        this.entries.push({ name: path.basename(abs), path: abs, isDir });
        this.pathSet.add(abs);
        this.scheduleSave();
        return true;
    }

    /** Remove a path (and anything beneath it, for a removed folder); returns true if changed. */
    removePath(p: string): boolean {
        const abs = path.resolve(p);
        const prefix = abs + path.sep;
        const before = this.entries.length;
        this.entries = this.entries.filter((e) => e.path !== abs && !e.path.startsWith(prefix));
        if (this.entries.length === before) return false;
        for (const k of [...this.pathSet]) {
            if (k === abs || k.startsWith(prefix)) this.pathSet.delete(k);
        }
        this.scheduleSave();
        return true;
    }

    private scheduleSave(): void {
        if (this.saveTimer) clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => void this.save(), 1500);
    }

    private async save(): Promise<void> {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = undefined;
        }
        await mkdir(path.dirname(this.file), { recursive: true });
        await writeFile(this.file, JSON.stringify({ locations: this.locations, entries: this.entries, indexedAt: this.indexedAt }), "utf8");
    }
}
