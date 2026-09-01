// Coretex — live file-watcher that keeps the FileIndexStore fresh. Watches the indexed
// locations with chokidar and applies incremental add/remove as files appear/disappear, so
// global search stays accurate without a full re-crawl. Watching is opt-in (the user toggles
// it) because recursively watching a whole drive is resource-intensive.

import chokidar, { type FSWatcher } from "chokidar";
import type { FileIndexStore } from "./index-store.js";

// Skip the same noise the crawler skips (plus OS junk), matched anywhere in the path.
const IGNORED = /(^|[/\\])(node_modules|\.git|\$recycle\.bin|System Volume Information|\.cache|\.Trash)([/\\]|$)/i;

export class IndexWatcher {
    private watcher: FSWatcher | null = null;
    private notifyTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(
        private readonly store: FileIndexStore,
        /** Called (debounced) whenever the index changed, so the orchestrator can re-broadcast state. */
        private readonly onChange: () => void,
    ) {}

    isWatching(): boolean {
        return this.watcher !== null;
    }

    /** (Re)start watching the given locations. Safe to call repeatedly. */
    start(locations: string[]): void {
        this.stop();
        if (locations.length === 0) return;
        this.watcher = chokidar.watch(locations, {
            ignored: IGNORED,
            ignoreInitial: true,
            persistent: true,
            ignorePermissionErrors: true,
            awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
        });
        this.watcher
            .on("add", (p) => this._apply(this.store.addPath(p, false)))
            .on("addDir", (p) => this._apply(this.store.addPath(p, true)))
            .on("unlink", (p) => this._apply(this.store.removePath(p)))
            .on("unlinkDir", (p) => this._apply(this.store.removePath(p)))
            .on("error", () => undefined);
    }

    stop(): void {
        if (this.notifyTimer) {
            clearTimeout(this.notifyTimer);
            this.notifyTimer = undefined;
        }
        if (this.watcher) {
            void this.watcher.close();
            this.watcher = null;
        }
    }

    private _apply(changed: boolean): void {
        if (!changed) return;
        // Debounce the state broadcast — bursts of file events should yield one update.
        if (this.notifyTimer) clearTimeout(this.notifyTimer);
        this.notifyTimer = setTimeout(() => this.onChange(), 800);
    }
}
