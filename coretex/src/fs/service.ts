// Coretex — filesystem service for the editor + file explorer panes. Runs in the
// Brain (a Node process), so it has real fs access. All reads cap size and refuse
// binary files; writes go straight to disk (the "coretex-filesystem" path).

import { readdir, readFile, stat, writeFile, rename as fsRename, mkdir as fsMkdir, rm as fsRm, cp as fsCp, unlink, open } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import ffmpegStatic from "ffmpeg-static";
import type { DriveInfo, FsEntry, FileProperties } from "../types.js";

// ffmpeg-static types its `export =` oddly; at runtime this is the binary path (or null).
const FFMPEG_PATH = ffmpegStatic as unknown as string | null;

const IMAGE_THUMB_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "avif"]);
const VIDEO_THUMB_EXTS = new Set(["mp4", "mov", "mkv", "webm", "avi", "m4v", "wmv", "flv", "mpg", "mpeg", "3gp", "ogv"]);
// Windows executables/shortcuts whose real shell icon we extract (games, .lnk, .url, installers…).
const ASSOC_ICON_EXTS = new Set(["lnk", "exe", "msi", "scr", "com", "bat", "cmd", "appref-ms", "url"]);
// Archive formats we can extract; zip is handled in-process (adm-zip), the rest via system `tar`.
const ARCHIVE_EXTS = new Set(["zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar"]);
const TAR_EXTS = new Set(["tar", "gz", "tgz", "bz2", "xz"]);

const MAX_READ_BYTES = 2 * 1024 * 1024; // 2 MB editor cap

function detectEncoding(sample: Buffer): string {
    if (sample.length >= 3 && sample[0] === 0xef && sample[1] === 0xbb && sample[2] === 0xbf) return "UTF-8 with BOM";
    if (sample.length >= 2 && sample[0] === 0xff && sample[1] === 0xfe) return "UTF-16 LE";
    if (sample.length >= 2 && sample[0] === 0xfe && sample[1] === 0xff) return "UTF-16 BE";
    if (sample.includes(0)) return "Binary";
    const decoded = sample.toString("utf8");
    if (decoded.includes("\uFFFD")) return "Binary";
    return /^[\x00-\x7F]*$/.test(decoded) ? "ASCII / UTF-8" : "UTF-8";
}

function sha256File(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = createHash("sha256");
        const stream = createReadStream(filePath);
        stream.on("error", reject);
        stream.on("data", (chunk) => hash.update(chunk));
        stream.on("end", () => resolve(hash.digest("hex")));
    });
}

async function readSample(filePath: string, maxBytes = 64 * 1024): Promise<Buffer> {
    const handle = await open(filePath, "r");
    try {
        const buffer = Buffer.allocUnsafe(maxBytes);
        const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
        return buffer.subarray(0, bytesRead);
    } finally {
        await handle.close();
    }
}

export interface DirListing {
    path: string;
    parent: string | null;
    entries: FsEntry[];
}

export interface FileContent {
    path: string;
    content: string;
    truncated: boolean;
}

/** Bound expensive thumbnail work (ffmpeg spawns, in-process PDF rasterization). */
const HEAVY_THUMB_LIMIT = 3;
/** Refuse to ship a data URL larger than this over the WS bridge. */
const MAX_THUMB_DATA_URL = 8 * 1024 * 1024;
let loggedMissingFfmpeg = false;
let loggedMissingPdf = false;

export class FilesystemService {
    private heavyActive = 0;
    private readonly heavyQueue: Array<() => void> = [];

    /** Persistent (L2) thumbnail/icon cache dir under ~/.coretex, plus an in-memory (L1) layer. */
    private readonly thumbCacheDir: string | null;
    private readonly thumbMem = new Map<string, string>();
    private readonly thumbInflight = new Map<string, Promise<string | null>>();
    private thumbWrites = 0;
    private pruning = false;

    constructor(dataDir?: string) {
        this.thumbCacheDir = dataDir ? path.join(dataDir, "thumb-cache") : null;
    }

    /** Run `fn` under a small concurrency cap so a folder of videos/PDFs can't fork-bomb the Brain. */
    private limitHeavy<T>(fn: () => Promise<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const start = () => {
                this.heavyActive++;
                fn().then(resolve, reject).finally(() => {
                    this.heavyActive--;
                    this.heavyQueue.shift()?.();
                });
            };
            if (this.heavyActive < HEAVY_THUMB_LIMIT) start();
            else this.heavyQueue.push(start);
        });
    }

    async list(dirPath: string): Promise<DirListing> {
        const abs = path.resolve(dirPath);
        const dirents = await readdir(abs, { withFileTypes: true });
        const entries: FsEntry[] = [];
        for (const d of dirents) {
            const full = path.join(abs, d.name);
            let size = 0;
            let modified = 0;
            let readOnly = false;
            try {
                const s = await stat(full);
                size = s.size;
                modified = s.mtimeMs;
                // Owner-write bit unset → read-only (works for files on Win + POSIX).
                readOnly = !d.isDirectory() && (s.mode & 0o200) === 0;
            } catch {
                // unreadable entry (permissions, junctions) — list it with zeros
            }
            entries.push({ name: d.name, path: full, isDir: d.isDirectory(), size, modified, readOnly });
        }
        entries.sort((a, b) => {
            if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
            return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
        });
        const parent = path.dirname(abs);
        return { path: abs, parent: parent === abs ? null : parent, entries };
    }

    async read(filePath: string): Promise<FileContent> {
        const abs = path.resolve(filePath);
        const s = await stat(abs);
        if (s.size > MAX_READ_BYTES) {
            const buf = await readFile(abs);
            const slice = buf.subarray(0, MAX_READ_BYTES);
            if (this.looksBinary(slice)) throw new Error("Binary file — cannot open in the editor.");
            return { path: abs, content: slice.toString("utf8"), truncated: true };
        }
        const buf = await readFile(abs);
        if (this.looksBinary(buf.subarray(0, 8192))) throw new Error("Binary file — cannot open in the editor.");
        return { path: abs, content: buf.toString("utf8"), truncated: false };
    }

    async write(filePath: string, content: string): Promise<void> {
        const abs = path.resolve(filePath);
        await writeFile(abs, content, "utf8");
    }

    /**
     * A lightweight text peek for the Space-to-preview pane: reads up to PEEK_BYTES,
     * refuses binary files. Separate from read() so previewing never opens the editor.
     */
    async peek(filePath: string): Promise<{ content: string; truncated: boolean }> {
        const PEEK_BYTES = 256 * 1024;
        const abs = path.resolve(filePath);
        const s = await stat(abs);
        if (!s.isFile()) throw new Error("Not a file.");
        const buf = await readFile(abs);
        const slice = buf.subarray(0, PEEK_BYTES);
        if (this.looksBinary(slice.subarray(0, 8192))) throw new Error("Binary file — no text preview.");
        return { content: slice.toString("utf8"), truncated: buf.length > PEEK_BYTES };
    }

    /**
     * Resolve + validate a path destined for a mutating op. Rejects empty input
     * (which would resolve to cwd), drive/filesystem roots, the home dir, cwd, and
     * the Coretex data dir — guarding against catastrophic recursive deletes/moves.
     */
    private guardPath(p: string): string {
        if (!p || !p.trim()) throw new Error("Empty path");
        const abs = path.resolve(p);
        if (path.dirname(abs) === abs) throw new Error("Refusing to operate on a drive/filesystem root.");
        const protectedDirs = new Set([os.homedir(), process.cwd(), path.join(os.homedir(), ".coretex")].map((x) => path.resolve(x)));
        if (protectedDirs.has(abs)) throw new Error("Refusing to operate on a protected directory.");
        return abs;
    }

    /** Rename/move a file or folder. Never overwrites; copy+remove across volumes. */
    async move(from: string, to: string, copy = false): Promise<void> {
        const a = this.guardPath(from);
        const b = this.guardPath(to);
        // Never silently clobber an existing destination.
        const exists = await stat(b).then(() => true, () => false);
        if (exists) throw new Error(`Destination already exists: ${b}`);
        if (copy) {
            await fsCp(a, b, { recursive: true, errorOnExist: true, force: false });
            return;
        }
        try {
            await fsRename(a, b);
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === "EXDEV") {
                await fsCp(a, b, { recursive: true, errorOnExist: true, force: false });
                await fsRm(a, { recursive: true, force: true });
            } else {
                throw err;
            }
        }
    }

    /** Create a new (empty) folder. Fails if it already exists. */
    async mkdir(dirPath: string): Promise<void> {
        await fsMkdir(this.guardPath(dirPath), { recursive: false });
    }

    /** Create a new empty file. Fails if it already exists. */
    async newFile(filePath: string): Promise<void> {
        await writeFile(this.guardPath(filePath), "", { flag: "wx" });
    }

    /** Permanently delete a file or folder (recursive for folders). */
    async del(targetPath: string): Promise<void> {
        await fsRm(this.guardPath(targetPath), { recursive: true, force: false });
    }

    /**
     * A thumbnail/preview data URL: raw image, a video's representative frame, a PDF's first
     * page, or a shortcut/exe's associated shell icon. Two-tier cached (L1 memory + L2 disk
     * under ~/.coretex/thumb-cache) keyed by path+mtime+size, so it never recomputes across
     * navigation or restarts; an in-flight map dedups concurrent identical requests.
     */
    async thumbnail(filePath: string): Promise<string | null> {
        const abs = path.resolve(filePath);
        const ext = (abs.split(".").pop() ?? "").toLowerCase();
        let s;
        try {
            s = await stat(abs);
        } catch {
            return null;
        }
        if (!s.isFile()) return null;
        const key = createHash("sha256").update(`${abs}:${s.mtimeMs}:${s.size}`).digest("hex");
        const mem = this.thumbMem.get(key);
        if (mem !== undefined) {
            // Refresh recency (move-to-end) so the L1 cache is LRU, not FIFO.
            this.thumbMem.delete(key);
            this.thumbMem.set(key, mem);
            return mem;
        }
        const inflight = this.thumbInflight.get(key);
        if (inflight) return inflight;
        const p = this._computeThumb(abs, ext, key);
        this.thumbInflight.set(key, p);
        try {
            return await p;
        } finally {
            this.thumbInflight.delete(key);
        }
    }

    private async _computeThumb(abs: string, ext: string, key: string): Promise<string | null> {
        // L2 disk read.
        const cacheFile = this.thumbCacheDir ? path.join(this.thumbCacheDir, key + ".dat") : null;
        if (cacheFile) {
            try {
                const cached = await readFile(cacheFile, "utf8");
                if (cached) {
                    this._memSet(key, cached);
                    return cached;
                }
            } catch {
                /* cache miss */
            }
        }
        // Compute.
        let url: string | null;
        if (IMAGE_THUMB_EXTS.has(ext)) url = await this.imageThumb(abs, ext);
        else if (VIDEO_THUMB_EXTS.has(ext)) url = await this.limitHeavy(() => this.videoThumb(abs));
        else if (ext === "pdf") url = await this.limitHeavy(() => this.pdfThumb(abs));
        else if (process.platform === "win32" && ASSOC_ICON_EXTS.has(ext)) url = await this.limitHeavy(() => (ext === "url" ? this.urlIcon(abs) : this.assocIcon(abs)));
        else url = null;
        // Never ship an oversized payload over the WS bridge.
        if (url && url.length > MAX_THUMB_DATA_URL) url = null;
        if (url) {
            this._memSet(key, url);
            if (cacheFile) void this._writeCache(cacheFile, url);
        }
        return url;
    }

    /** Insert into the bounded L1 map (drop the oldest entry past the cap). */
    private _memSet(key: string, url: string): void {
        if (this.thumbMem.size >= 500) {
            const oldest = this.thumbMem.keys().next().value;
            if (oldest !== undefined) this.thumbMem.delete(oldest);
        }
        this.thumbMem.set(key, url);
    }

    private async _writeCache(cacheFile: string, url: string): Promise<void> {
        try {
            await fsMkdir(path.dirname(cacheFile), { recursive: true });
            await writeFile(cacheFile, url, "utf8");
            if (++this.thumbWrites % 200 === 0) void this._pruneThumbCache();
        } catch {
            /* best-effort cache */
        }
    }

    /** Keep the on-disk cache bounded: when it exceeds ~1000 files, delete the oldest down to ~700. */
    private async _pruneThumbCache(): Promise<void> {
        if (this.pruning || !this.thumbCacheDir) return;
        this.pruning = true;
        try {
            const names = await readdir(this.thumbCacheDir);
            if (names.length <= 1000) return;
            const withTimes = await Promise.all(
                names.map(async (n) => {
                    const full = path.join(this.thumbCacheDir!, n);
                    const mt = await stat(full).then((s) => s.mtimeMs, () => 0);
                    return { full, mt };
                }),
            );
            withTimes.sort((a, b) => a.mt - b.mt);
            for (const f of withTimes.slice(0, withTimes.length - 700)) {
                await unlink(f.full).catch(() => undefined);
            }
        } catch {
            /* best-effort */
        } finally {
            this.pruning = false;
        }
    }

    /**
     * A Windows .url internet shortcut is an INI file; its real icon is referenced by
     * IconFile=/IconIndex= (when present). Extract that icon, else fall back to the
     * shortcut's own associated icon.
     */
    private async urlIcon(abs: string): Promise<string | null> {
        let iconFile = "";
        let iconIndex = 0;
        try {
            const text = await readFile(abs, "utf8");
            const fm = /^\s*IconFile\s*=\s*(.+?)\s*$/im.exec(text);
            const im = /^\s*IconIndex\s*=\s*(-?\d+)\s*$/im.exec(text);
            if (fm) iconFile = fm[1].trim();
            if (im) iconIndex = Number(im[1]) || 0;
        } catch {
            /* unreadable — fall through to assoc icon */
        }
        if (iconFile && process.platform === "win32") {
            const png = await this.extractIconFrom(iconFile, iconIndex);
            if (png) return png;
        }
        return this.assocIcon(abs);
    }

    /** Extract a specific icon (by index) from an .exe/.dll/.ico via ExtractIconEx → PNG data URL. */
    private async extractIconFrom(iconPath: string, index: number): Promise<string | null> {
        const psPath = iconPath.replace(/'/g, "''");
        const script =
            "Add-Type -AssemblyName System.Drawing; " +
            "$sig='[DllImport(\"shell32.dll\",CharSet=CharSet.Auto)]public static extern int ExtractIconEx(string f,int i,IntPtr[] lg,IntPtr[] sm,int n);'; " +
            "$t=Add-Type -MemberDefinition $sig -Name Ico -Namespace Win32 -PassThru; " +
            `$lg=New-Object IntPtr[] 1; [void]$t::ExtractIconEx('${psPath}',${index},$lg,$null,1); ` +
            "try { if($lg[0] -ne [IntPtr]::Zero){ $i=[System.Drawing.Icon]::FromHandle($lg[0]); $ms=New-Object System.IO.MemoryStream; $i.ToBitmap().Save($ms,[System.Drawing.Imaging.ImageFormat]::Png); [Convert]::ToBase64String($ms.ToArray()) } else { '' } } catch { '' }";
        return new Promise((resolve) => {
            execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 8000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
                const b64 = (stdout ?? "").trim();
                if (err || b64.length === 0) resolve(null);
                else resolve(`data:image/png;base64,${b64}`);
            });
        });
    }

    private async imageThumb(abs: string, ext: string): Promise<string | null> {
        const s = await stat(abs);
        if (!s.isFile() || s.size === 0 || s.size > 2 * 1024 * 1024) return null;
        const buf = await readFile(abs);
        const mime = ext === "svg" ? "image/svg+xml" : ext === "jpg" ? "image/jpeg" : ext === "ico" ? "image/x-icon" : `image/${ext}`;
        return `data:${mime};base64,${buf.toString("base64")}`;
    }

    /** Extract a representative frame with the bundled ffmpeg → PNG data URL. */
    private async videoThumb(abs: string): Promise<string | null> {
        if (!FFMPEG_PATH) {
            if (!loggedMissingFfmpeg) { loggedMissingFfmpeg = true; console.warn("[fs] ffmpeg-static unavailable — video thumbnails disabled."); }
            return null;
        }
        const s = await stat(abs).catch(() => null);
        if (!s?.isFile()) return null;
        return new Promise((resolve) => {
            // file: protocol + protocol whitelist + -nostdin: never let a crafted media file
            // reinterpret the input as another protocol or open unrelated resources.
            const args = ["-nostdin", "-protocol_whitelist", "file", "-i", `file:${abs}`, "-vf", "thumbnail,scale=480:-1", "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"];
            execFile(FFMPEG_PATH, args, { encoding: "buffer", maxBuffer: 24 * 1024 * 1024, windowsHide: true, timeout: 12000 }, (err, stdout) => {
                const buf = stdout as unknown as Buffer;
                if (err || !buf || buf.length === 0) resolve(null);
                else resolve(`data:image/png;base64,${buf.toString("base64")}`);
            });
        });
    }

    /** Render a PDF's first page to a PNG data URL (lazy-loads pdf-to-img). */
    private async pdfThumb(abs: string): Promise<string | null> {
        const s = await stat(abs).catch(() => null);
        if (!s?.isFile() || s.size > 50 * 1024 * 1024) return null;
        try {
            const { pdf } = await import("pdf-to-img");
            const doc = await pdf(abs, { scale: 1.3 });
            for await (const page of doc) {
                return `data:image/png;base64,${(page as Buffer).toString("base64")}`; // first page only
            }
            return null;
        } catch (err) {
            if ((err as NodeJS.ErrnoException)?.code === "ERR_MODULE_NOT_FOUND" || (err as NodeJS.ErrnoException)?.code === "MODULE_NOT_FOUND") {
                if (!loggedMissingPdf) { loggedMissingPdf = true; console.warn("[fs] pdf-to-img not installed — PDF thumbnails disabled."); }
            }
            return null;
        }
    }

    /** Extract a Windows file's real associated shell icon (.exe/.lnk/games/…) → PNG data URL. */
    private async assocIcon(abs: string): Promise<string | null> {
        const psPath = abs.replace(/'/g, "''");
        const script =
            "Add-Type -AssemblyName System.Drawing; " +
            `try { $i=[System.Drawing.Icon]::ExtractAssociatedIcon('${psPath}'); $ms=New-Object System.IO.MemoryStream; $i.ToBitmap().Save($ms,[System.Drawing.Imaging.ImageFormat]::Png); [Convert]::ToBase64String($ms.ToArray()) } catch { '' }`;
        return new Promise((resolve) => {
            execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 8000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
                const b64 = (stdout ?? "").trim();
                if (err || b64.length === 0) resolve(null);
                else resolve(`data:image/png;base64,${b64}`);
            });
        });
    }

    /**
     * Recursive name search under `root` (the "search this folder inward" mode). Bounded by a
     * result cap + a wall-clock budget so a huge tree can't stall the Brain.
     */
    async searchFolder(root: string, query: string, limit = 500): Promise<FsEntry[]> {
        const q = query.trim().toLowerCase();
        if (!q) return [];
        const abs = path.resolve(root);
        const hits: FsEntry[] = [];
        const deadline = Date.now() + 6000;
        const walk = async (dir: string): Promise<void> => {
            if (hits.length >= limit || Date.now() > deadline) return;
            let dirents: import("node:fs").Dirent[];
            try {
                dirents = await readdir(dir, { withFileTypes: true });
            } catch {
                return;
            }
            for (const d of dirents) {
                if (hits.length >= limit || Date.now() > deadline) return;
                const full = path.join(dir, d.name);
                if (d.name.toLowerCase().includes(q)) {
                    let size = 0, modified = 0;
                    try { const s = await stat(full); size = s.size; modified = s.mtimeMs; } catch { /* unreadable */ }
                    hits.push({ name: d.name, path: full, isDir: d.isDirectory(), size, modified });
                }
                if (d.isDirectory()) await walk(full);
            }
        };
        await walk(abs);
        return hits;
    }

    /** Mounted drives/volumes with capacity, for the Files storage overview. */
    async drives(): Promise<DriveInfo[]> {
        if (process.platform === "win32") {
            return new Promise((resolve) => {
                execFile(
                    "powershell.exe",
                    ["-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,Size,FreeSpace,VolumeName | ConvertTo-Json -Compress"],
                    { windowsHide: true, timeout: 8000, maxBuffer: 1024 * 1024 },
                    (err, stdout) => {
                        if (err || !stdout) return resolve([]);
                        try {
                            const raw = JSON.parse(stdout) as unknown;
                            const arr = Array.isArray(raw) ? raw : [raw];
                            const out: DriveInfo[] = [];
                            for (const d of arr as Record<string, unknown>[]) {
                                if (!d || typeof d.DeviceID !== "string") continue;
                                out.push({
                                    path: d.DeviceID + "\\",
                                    label: typeof d.VolumeName === "string" ? d.VolumeName : "",
                                    total: Number(d.Size) || 0,
                                    free: Number(d.FreeSpace) || 0,
                                });
                            }
                            resolve(out);
                        } catch {
                            resolve([]);
                        }
                    },
                );
            });
        }
        // POSIX: df with 1K blocks.
        return new Promise((resolve) => {
            execFile("df", ["-kP"], { timeout: 8000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
                if (err || !stdout) return resolve([]);
                const out: DriveInfo[] = [];
                for (const line of stdout.trim().split("\n").slice(1)) {
                    const c = line.trim().split(/\s+/);
                    if (c.length < 6) continue;
                    const mount = c.slice(5).join(" ");
                    if (!mount.startsWith("/")) continue;
                    out.push({ path: mount, label: "", total: (Number(c[1]) || 0) * 1024, free: (Number(c[3]) || 0) * 1024 });
                }
                resolve(out);
            });
        });
    }

    /** Which of the given paths still exist on disk (for flagging broken starred/pinned items). */
    async checkPaths(paths: string[]): Promise<Record<string, boolean>> {
        const out: Record<string, boolean> = {};
        await Promise.all(
            paths.map(async (p) => {
                out[p] = await stat(path.resolve(p)).then(() => true, () => false);
            }),
        );
        return out;
    }

    async roots(): Promise<{ roots: string[]; home: string }> {
        const home = os.homedir();
        if (process.platform !== "win32") {
            return { roots: ["/"], home };
        }
        const found: string[] = [];
        for (let i = 67; i <= 90; i++) {
            // C..Z (skip A/B floppies)
            const drive = `${String.fromCharCode(i)}:\\`;
            try {
                await stat(drive);
                found.push(drive);
            } catch {
                // drive not present
            }
        }
        return { roots: found.length > 0 ? found : ["C:\\"], home };
    }

    /** Rich stat for the Properties dialog (size, dates, type, archive flag, folder item count). */
    async properties(filePath: string): Promise<FileProperties> {
        const abs = path.resolve(filePath);
        const s = await stat(abs);
        const isDir = s.isDirectory();
        const ext = isDir ? "" : (abs.split(".").pop() ?? "").toLowerCase();
        const archive = !isDir && ARCHIVE_EXTS.has(ext);
        let itemCount: number | undefined;
        if (isDir) {
            try {
                itemCount = (await readdir(abs)).length;
            } catch {
                /* unreadable */
            }
        }
        let encoding: string | undefined;
        let checksumSha256: string | undefined;
        if (!isDir) {
            const sample = await readSample(abs);
            encoding = detectEncoding(sample);
            checksumSha256 = await sha256File(abs);
        }
        return {
            path: abs,
            name: path.basename(abs) || abs,
            isDir,
            size: isDir ? 0 : s.size,
            created: s.birthtimeMs || s.ctimeMs,
            modified: s.mtimeMs,
            accessed: s.atimeMs,
            readOnly: !isDir && (s.mode & 0o200) === 0,
            mode: s.mode,
            type: humanType(isDir, ext),
            ext: ext || undefined,
            archive: archive || undefined,
            itemCount,
            encoding,
            checksumSha256,
        };
    }

    /** Extract an archive into a destination folder. .zip in-process (adm-zip); tar/gz via system `tar`. */
    async extract(archivePath: string, destDir: string): Promise<void> {
        const abs = path.resolve(archivePath);
        const dest = this.guardPath(destDir);
        const ext = (abs.split(".").pop() ?? "").toLowerCase();
        await fsMkdir(dest, { recursive: true });
        if (ext === "zip") {
            const { default: AdmZip } = await import("adm-zip");
            const zip = new AdmZip(abs);
            zip.extractAllTo(dest, /* overwrite */ false);
            return;
        }
        if (TAR_EXTS.has(ext) || abs.toLowerCase().endsWith(".tar.gz")) {
            await this._run("tar", ["-xf", abs, "-C", dest]);
            return;
        }
        throw new Error(`Unsupported archive type: .${ext} (zip and tar/gz are supported)`);
    }

    /** Compress files/folders into a new .zip (refuses to overwrite an existing destination). */
    async compress(srcPaths: string[], destPath: string): Promise<void> {
        const dest = path.resolve(destPath);
        if (srcPaths.length === 0) throw new Error("Nothing to compress.");
        const exists = await stat(dest).then(() => true, () => false);
        if (exists) throw new Error(`Destination already exists: ${dest}`);
        const ext = (dest.split(".").pop() ?? "").toLowerCase();
        if (ext !== "zip") throw new Error("Only .zip compression is supported.");
        const { default: AdmZip } = await import("adm-zip");
        const zip = new AdmZip();
        for (const sp of srcPaths) {
            const a = path.resolve(sp);
            const s = await stat(a);
            if (s.isDirectory()) zip.addLocalFolder(a, path.basename(a));
            else zip.addLocalFile(a);
        }
        await fsMkdir(path.dirname(dest), { recursive: true });
        zip.writeZip(dest);
    }

    /** Open a file/folder with the OS default handler (Brain runs locally on the user's machine). */
    async openExternal(filePath: string): Promise<void> {
        const abs = path.resolve(filePath);
        await stat(abs); // throws if it doesn't exist
        if (process.platform === "win32") {
            const psPath = abs.replace(/'/g, "''");
            await this._run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Start-Process -LiteralPath '${psPath}'`]);
        } else if (process.platform === "darwin") {
            await this._run("open", [abs]);
        } else {
            await this._run("xdg-open", [abs]);
        }
    }

    /** Show the OS "Open with…" picker (Windows). Other platforms fall back to the default handler. */
    async openWith(filePath: string): Promise<void> {
        const abs = path.resolve(filePath);
        await stat(abs);
        if (process.platform === "win32") {
            await this._run("rundll32.exe", ["shell32.dll,OpenAs_RunDLL", abs]);
        } else {
            await this.openExternal(abs);
        }
    }

    /** Promise wrapper around execFile for shell-open / tar invocations. */
    private _run(cmd: string, args: string[]): Promise<void> {
        return new Promise((resolve, reject) => {
            execFile(cmd, args, { windowsHide: true, timeout: 20000, maxBuffer: 4 * 1024 * 1024 }, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    private looksBinary(buf: Buffer): boolean {
        for (let i = 0; i < buf.length; i++) {
            if (buf[i] === 0) return true;
        }
        return false;
    }
}

/** Human-friendly file-type label for the Properties dialog. */
function humanType(isDir: boolean, ext: string): string {
    if (isDir) return "Folder";
    if (!ext) return "File";
    const LABELS: Record<string, string> = {
        png: "PNG image", jpg: "JPEG image", jpeg: "JPEG image", gif: "GIF image", webp: "WebP image", svg: "SVG image", ico: "Icon", bmp: "Bitmap image", avif: "AVIF image",
        mp4: "MP4 video", mov: "QuickTime video", mkv: "Matroska video", webm: "WebM video", avi: "AVI video", wmv: "Windows Media video",
        mp3: "MP3 audio", wav: "WAV audio", flac: "FLAC audio", m4a: "AAC audio", ogg: "Ogg audio",
        pdf: "PDF document", doc: "Word document", docx: "Word document", xls: "Excel spreadsheet", xlsx: "Excel spreadsheet", ppt: "PowerPoint", pptx: "PowerPoint",
        txt: "Text", md: "Markdown", json: "JSON", csv: "CSV", yml: "YAML", yaml: "YAML", xml: "XML", html: "HTML", css: "Stylesheet",
        js: "JavaScript", ts: "TypeScript", tsx: "TypeScript JSX", jsx: "JavaScript JSX", py: "Python", go: "Go", rs: "Rust", java: "Java", c: "C", cpp: "C++", sh: "Shell script",
        zip: "ZIP archive", tar: "TAR archive", gz: "Gzip archive", tgz: "Gzip archive", "7z": "7-Zip archive", rar: "RAR archive", bz2: "Bzip2 archive", xz: "XZ archive",
        exe: "Application", msi: "Installer", lnk: "Shortcut", url: "Internet shortcut", dll: "Library", bat: "Batch file", cmd: "Command script", ps1: "PowerShell script",
        db: "Database", sqlite: "SQLite database", sql: "SQL",
    };
    return LABELS[ext] ?? `${ext.toUpperCase()} file`;
}
