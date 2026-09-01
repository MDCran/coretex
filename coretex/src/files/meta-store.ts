// Coretex — Files sidecar metadata store. Per-absolute-path customization
// (custom icon / color / emblems / tag ids), the tag database, and smart
// collections — kept out of the folders themselves (you can't always write
// metadata into them). Persists to ~/.coretex/files-meta.json. Empty path
// entries are pruned so the store stays tidy.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DriveMeta, FilePathMeta, FilePin, FilesMetaState, FileTag, SmartCollection } from "../types.js";

function genId(p: string): string {
    return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function isEmptyMeta(m: FilePathMeta | undefined): boolean {
    if (!m) return true;
    const hasIcon = m.icon && m.icon.kind !== "auto";
    return !hasIcon && !m.color && (!m.emblems || m.emblems.length === 0) && (!m.tagIds || m.tagIds.length === 0);
}

export class FilesMetaStore {
    private byPath: Record<string, FilePathMeta> = {};
    private tags: FileTag[] = [];
    private collections: SmartCollection[] = [];
    private pins: FilePin[] = [];
    private driveMeta: Record<string, DriveMeta> = {};
    private readonly file: string;

    constructor(dataDir: string) {
        this.file = path.join(dataDir, "files-meta.json");
    }

    async load(): Promise<void> {
        try {
            const raw = JSON.parse(await readFile(this.file, "utf8")) as Partial<FilesMetaState>;
            this.byPath = raw.byPath ?? {};
            this.tags = Array.isArray(raw.tags) ? raw.tags : [];
            this.collections = Array.isArray(raw.collections) ? raw.collections : [];
            this.pins = Array.isArray(raw.pins) ? raw.pins : [];
            this.driveMeta = raw.driveMeta && typeof raw.driveMeta === "object" ? raw.driveMeta : {};
        } catch {
            this.byPath = {};
            this.tags = [];
            this.collections = [];
            this.pins = [];
            this.driveMeta = {};
        }
    }

    state(): FilesMetaState {
        return { byPath: { ...this.byPath }, tags: this.tags.slice(), collections: this.collections.slice(), pins: this.pins.slice().sort((a, b) => a.order - b.order), driveMeta: { ...this.driveMeta } };
    }

    /** Merge a patch into a drive's meta (nickname/icon/color); prune when it becomes empty. */
    async setDriveMeta(p: string, patch: DriveMeta): Promise<void> {
        const merged: DriveMeta = { ...this.driveMeta[p], ...patch };
        const empty = !merged.nickname && (!merged.icon || merged.icon.kind === "auto") && !merged.color;
        if (empty) delete this.driveMeta[p];
        else this.driveMeta[p] = merged;
        await this.save();
    }

    /** Merge a patch into a path's meta; prune if it becomes empty. */
    async setPath(p: string, patch: FilePathMeta): Promise<void> {
        const merged: FilePathMeta = { ...this.byPath[p], ...patch };
        if (isEmptyMeta(merged)) delete this.byPath[p];
        else this.byPath[p] = merged;
        await this.save();
    }

    async clearPath(p: string): Promise<void> {
        delete this.byPath[p];
        await this.save();
    }

    /** Set the exact tag-id list on one or more paths. */
    async setPathTags(paths: string[], tagIds: string[]): Promise<void> {
        for (const p of paths) {
            const merged: FilePathMeta = { ...this.byPath[p], tagIds: tagIds.slice() };
            if (isEmptyMeta(merged)) delete this.byPath[p];
            else this.byPath[p] = merged;
        }
        await this.save();
    }

    async upsertTag(tag: FileTag): Promise<void> {
        if (!tag.id) tag.id = genId("tag");
        const idx = this.tags.findIndex((t) => t.id === tag.id);
        if (idx === -1) this.tags.push(tag);
        else this.tags[idx] = tag;
        await this.save();
    }

    async deleteTag(id: string): Promise<void> {
        this.tags = this.tags.filter((t) => t.id !== id);
        // Strip the tag from every path + collection.
        for (const [p, m] of Object.entries(this.byPath)) {
            if (m.tagIds?.includes(id)) {
                const merged: FilePathMeta = { ...m, tagIds: m.tagIds.filter((x) => x !== id) };
                if (isEmptyMeta(merged)) delete this.byPath[p];
                else this.byPath[p] = merged;
            }
        }
        this.collections = this.collections.map((c) => ({ ...c, tagIds: c.tagIds?.filter((x) => x !== id) }));
        await this.save();
    }

    async upsertCollection(c: SmartCollection): Promise<void> {
        if (!c.id) c.id = genId("col");
        const idx = this.collections.findIndex((x) => x.id === c.id);
        if (idx === -1) this.collections.push(c);
        else this.collections[idx] = c;
        await this.save();
    }

    async deleteCollection(id: string): Promise<void> {
        this.collections = this.collections.filter((c) => c.id !== id);
        await this.save();
    }

    async upsertPin(pin: FilePin): Promise<void> {
        if (!pin.id) pin.id = genId("pin");
        const idx = this.pins.findIndex((p) => p.id === pin.id);
        if (idx === -1) {
            // New pin lands at the end unless an order was supplied.
            if (pin.order === undefined || pin.order === null) pin.order = this.pins.length;
            this.pins.push(pin);
        } else {
            this.pins[idx] = { ...this.pins[idx], ...pin };
        }
        await this.save();
    }

    async deletePin(id: string): Promise<void> {
        this.pins = this.pins.filter((p) => p.id !== id);
        await this.save();
    }

    /** Replace the pin set (used for drag-reorder — `order` is taken from array index). */
    async setPins(pins: FilePin[]): Promise<void> {
        this.pins = pins.map((p, i) => ({ ...p, order: i }));
        await this.save();
    }

    /** Follow a move/rename: re-key path meta from `from` to `to`. */
    async movePath(from: string, to: string): Promise<void> {
        if (this.byPath[from]) {
            this.byPath[to] = this.byPath[from];
            delete this.byPath[from];
            await this.save();
        }
    }

    private async save(): Promise<void> {
        await mkdir(path.dirname(this.file), { recursive: true });
        await writeFile(this.file, JSON.stringify({ byPath: this.byPath, tags: this.tags, collections: this.collections, pins: this.pins, driveMeta: this.driveMeta }, null, 2), "utf8");
    }
}
