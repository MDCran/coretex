// Coretex — local repository code indexer for the Project Assistant.
//
// Walks a project's source directory, honoring .gitignore plus a built-in
// ignore list, chunks each text file into overlapping line windows, embeds the
// windows via Ollama (with a graceful lexical fallback when embeddings are
// unavailable), and loads the result into a ProjectIndexStore under
// source:"code". Doc chunks indexed elsewhere are left untouched.

import type { Dirent } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";

import ignore from "ignore";

import type { CodeIndexState, IndexStatus } from "../types.js";
import { ProjectIndexStore, chunkId, type IndexChunk } from "./store.js";
import { embedTexts } from "./embeddings.js";

/**
 * Directories and file globs never indexed: dependency/build output and any
 * binary or asset payloads that would only add noise (and bloat) to retrieval.
 */
export const DEFAULT_IGNORES: string[] = [
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    "coverage",
    "release",
    "out",
    ".vite",
    ".turbo",
    "*.png",
    "*.jpg",
    "*.jpeg",
    "*.gif",
    "*.svg",
    "*.ico",
    "*.webp",
    "*.woff",
    "*.woff2",
    "*.ttf",
    "*.eot",
    "*.pdf",
    "*.zip",
    "*.gz",
    "*.exe",
    "*.dll",
    "*.bin",
    "*.lock",
    "*.lockb",
    "package-lock.json",
    "*.map",
    "*.min.js",
];

/** Files larger than this are skipped (likely generated/minified/binary). */
export const MAX_FILE_BYTES = 256 * 1024;

/** Hard cap on the number of files indexed in a single pass. */
export const MAX_FILES = 4000;

/** Lines per chunk window. */
const CHUNK_LINES = 120;

/** Lines of overlap between consecutive windows. */
const CHUNK_OVERLAP = 15;

/** Number of chunk texts embedded per Ollama request. */
const EMBED_BATCH = 64;

/** Emit a progress callback roughly every this many files scanned. */
const PROGRESS_EVERY = 25;

/** Bytes inspected at the head of a file when sniffing for binary content. */
const BINARY_SNIFF_BYTES = 8 * 1024;

/** Map file extensions to a coarse language label (default "text"). */
const LANGUAGE_BY_EXT: Record<string, string> = {
    ".ts": "ts",
    ".tsx": "tsx",
    ".mts": "ts",
    ".cts": "ts",
    ".js": "js",
    ".jsx": "jsx",
    ".mjs": "js",
    ".cjs": "js",
    ".py": "py",
    ".go": "go",
    ".rs": "rs",
    ".java": "java",
    ".kt": "kotlin",
    ".kts": "kotlin",
    ".scala": "scala",
    ".c": "c",
    ".h": "c",
    ".cc": "cpp",
    ".cpp": "cpp",
    ".cxx": "cpp",
    ".hpp": "cpp",
    ".hh": "cpp",
    ".cs": "csharp",
    ".rb": "ruby",
    ".php": "php",
    ".swift": "swift",
    ".m": "objc",
    ".mm": "objcpp",
    ".sh": "sh",
    ".bash": "sh",
    ".zsh": "sh",
    ".ps1": "powershell",
    ".sql": "sql",
    ".json": "json",
    ".jsonc": "json",
    ".json5": "json",
    ".yml": "yml",
    ".yaml": "yml",
    ".toml": "toml",
    ".ini": "ini",
    ".cfg": "ini",
    ".xml": "xml",
    ".html": "html",
    ".htm": "html",
    ".css": "css",
    ".scss": "scss",
    ".sass": "sass",
    ".less": "less",
    ".md": "md",
    ".mdx": "md",
    ".markdown": "md",
    ".txt": "text",
    ".vue": "vue",
    ".svelte": "svelte",
    ".astro": "astro",
    ".dart": "dart",
    ".lua": "lua",
    ".r": "r",
    ".pl": "perl",
    ".ex": "elixir",
    ".exs": "elixir",
    ".erl": "erlang",
    ".clj": "clojure",
    ".hs": "haskell",
    ".graphql": "graphql",
    ".gql": "graphql",
    ".proto": "protobuf",
    ".dockerfile": "dockerfile",
    ".env": "env",
};

/** Detect a coarse language label for a path by its file extension. */
export function detectLanguage(filePath: string): string {
    const ext = extname(filePath).toLowerCase();
    if (ext.length === 0) {
        return "text";
    }
    return LANGUAGE_BY_EXT[ext] ?? "text";
}

/** One local checkout contributing files to a project's unified code index. */
export interface CodeIndexRoot {
    path: string;
    /** Human-readable prefix used to disambiguate citations across repositories. */
    label?: string;
    repoId?: string;
}

/** Does the head of a buffer look binary (contains a NUL byte)? */
function looksBinary(buf: Buffer): boolean {
    const end = Math.min(buf.length, BINARY_SNIFF_BYTES);
    for (let i = 0; i < end; i++) {
        if (buf[i] === 0) {
            return true;
        }
    }
    return false;
}

/**
 * Split text into ~CHUNK_LINES-line windows with ~CHUNK_OVERLAP-line overlap.
 * Each window carries 1-based inclusive lineStart/lineEnd. Empty or
 * whitespace-only windows are skipped.
 */
function chunkLines(text: string): { text: string; lineStart: number; lineEnd: number }[] {
    const lines = text.split(/\r\n|\r|\n/);
    const out: { text: string; lineStart: number; lineEnd: number }[] = [];
    const step = Math.max(1, CHUNK_LINES - CHUNK_OVERLAP);

    for (let start = 0; start < lines.length; start += step) {
        const end = Math.min(lines.length, start + CHUNK_LINES);
        const windowText = lines.slice(start, end).join("\n");
        if (windowText.trim().length > 0) {
            out.push({ text: windowText, lineStart: start + 1, lineEnd: end });
        }
        if (end >= lines.length) {
            break;
        }
    }
    return out;
}

/**
 * Indexes a local repository's source files into a {@link ProjectIndexStore}
 * under the "code" source, embedding chunk texts via Ollama when available.
 */
export class CodeIndexer {
    private readonly store: ProjectIndexStore;
    private readonly ollamaBaseUrl: string;

    constructor(store: ProjectIndexStore, ollamaBaseUrl = "http://localhost:11434") {
        this.store = store;
        this.ollamaBaseUrl = ollamaBaseUrl;
    }

    /**
     * Walk `sourcePath`, chunk and embed text files, and replace the project's
     * "code" chunks in the store. Reports progress through `onProgress` and
     * returns the final state. Never rethrows: failures resolve to a state with
     * status "error".
     */
    async indexCode(
        projectId: string,
        sourcePath: string,
        onProgress: (state: CodeIndexState) => void,
    ): Promise<CodeIndexState> {
        return this.indexCodeRoots(projectId, [{ path: sourcePath }], onProgress);
    }

    /**
     * Index several local checkouts into one project index. File and chunk caps
     * apply to the combined set, and citation paths are prefixed with the repo
     * label when more than one independent checkout is present.
     */
    async indexCodeRoots(
        projectId: string,
        roots: CodeIndexRoot[],
        onProgress: (state: CodeIndexState) => void,
    ): Promise<CodeIndexState> {
        const cleanRoots = roots
            .map((root) => ({ ...root, path: root.path.trim(), label: root.label?.trim() }))
            .filter((root) => root.path.length > 0);
        const sourcePath = cleanRoots[0]?.path;
        const sourcePaths = cleanRoots.map((root) => root.path);
        const indexedRepoIds = cleanRoots.map((root) => root.repoId).filter((id): id is string => Boolean(id));
        try {
            // 1) Walk every selected checkout, honoring each repository's own
            // .gitignore. The cap is shared so one project cannot multiply the
            // indexing budget merely by linking more repositories.
            const files: { sourceRoot: string; relativePath: string; indexPath: string }[] = [];
            let filesScanned = 0;

            const emitProgress = (status: IndexStatus, chunks: number): void => {
                onProgress({
                    projectId,
                    sourcePath,
                    sourcePaths,
                    indexedRepoIds,
                    status,
                    filesScanned,
                    chunks,
                    docChunks: this.store.counts(projectId).doc,
                });
            };

            const walk = async (
                dir: string,
                relDir: string,
                root: CodeIndexRoot,
                ig: ReturnType<typeof ignore>,
            ): Promise<void> => {
                if (files.length >= MAX_FILES) {
                    return;
                }
                let entries: Dirent[];
                try {
                    entries = await readdir(dir, { withFileTypes: true });
                } catch {
                    return;
                }

                for (const entry of entries) {
                    if (files.length >= MAX_FILES) {
                        return;
                    }
                    const relPath = relDir.length > 0 ? relDir + "/" + entry.name : entry.name;
                    const absPath = join(dir, entry.name);

                    if (entry.isDirectory()) {
                        // Test both bare and trailing-slash forms for directories.
                        if (ig.ignores(relPath) || ig.ignores(relPath + "/")) {
                            continue;
                        }
                        await walk(absPath, relPath, root, ig);
                        continue;
                    }

                    if (!entry.isFile()) {
                        continue;
                    }
                    if (ig.ignores(relPath)) {
                        continue;
                    }

                    filesScanned++;

                    let size: number;
                    try {
                        size = (await stat(absPath)).size;
                    } catch {
                        continue;
                    }
                    if (size > MAX_FILE_BYTES) {
                        continue;
                    }

                    // Binary sniff: read the head and look for a NUL byte.
                    let head: Buffer;
                    try {
                        head = await readFile(absPath);
                    } catch {
                        continue;
                    }
                    if (looksBinary(head)) {
                        continue;
                    }

                    const label = root.label?.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "").trim();
                    const identity = root.repoId?.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "").trim();
                    // Repo ids are stable and unique even when two organizations
                    // use the same repository/folder name. Including both keeps
                    // citations readable without allowing chunk-id collisions.
                    const prefix = [label, identity && identity !== label ? identity : undefined].filter(Boolean).join("--");
                    files.push({
                        sourceRoot: root.path,
                        relativePath: relPath,
                        indexPath: prefix ? `${prefix}/${relPath}` : relPath,
                    });

                    if (filesScanned % PROGRESS_EVERY === 0) {
                        emitProgress("indexing", 0);
                    }
                }
            };

            for (const root of cleanRoots) {
                if (files.length >= MAX_FILES) break;
                const ig = ignore().add(DEFAULT_IGNORES);
                try {
                    const gitignore = await readFile(join(root.path, ".gitignore"), "utf8");
                    ig.add(gitignore);
                } catch {
                    // No .gitignore (or unreadable) — defaults are sufficient.
                }
                await walk(root.path, "", root, ig);
            }

            // 2) Chunk every collected file.
            const chunks: IndexChunk[] = [];
            let processed = 0;
            for (const file of files) {
                let content: string;
                try {
                    content = await readFile(join(file.sourceRoot, file.relativePath), "utf8");
                } catch {
                    continue;
                }

                for (const window of chunkLines(content)) {
                    chunks.push({
                        id: chunkId("code", file.indexPath, window.lineStart),
                        projectId,
                        source: "code",
                        path: file.indexPath,
                        text: window.text,
                        lineStart: window.lineStart,
                        lineEnd: window.lineEnd,
                    });
                }

                processed++;
                if (processed % PROGRESS_EVERY === 0) {
                    emitProgress("indexing", chunks.length);
                }
            }

            // 3) Embed chunk texts in batches; attach embeddings positionally.
            for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
                const batch = chunks.slice(i, i + EMBED_BATCH);
                const vectors = await embedTexts(
                    batch.map((c) => c.text),
                    this.ollamaBaseUrl,
                );
                if (vectors === null) {
                    // Embeddings unavailable — leave undefined for lexical fallback.
                    continue;
                }
                for (let j = 0; j < batch.length; j++) {
                    const vec = vectors[j];
                    const chunk = batch[j];
                    if (vec !== undefined && chunk !== undefined) {
                        chunk.embedding = vec;
                    }
                }
            }

            // 4) Load into the store and persist.
            this.store.replaceSource(projectId, "code", chunks);
            await this.store.save(projectId);

            // 5) Final ready state.
            const finalState: CodeIndexState = {
                projectId,
                sourcePath,
                sourcePaths,
                indexedRepoIds,
                status: "ready",
                filesScanned,
                chunks: chunks.length,
                docChunks: this.store.counts(projectId).doc,
                lastIndexedAt: Date.now(),
            };
            onProgress(finalState);
            return finalState;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const errorState: CodeIndexState = {
                projectId,
                sourcePath,
                sourcePaths,
                indexedRepoIds,
                status: "error",
                filesScanned: 0,
                chunks: 0,
                docChunks: this.store.counts(projectId).doc,
                error: message,
            };
            onProgress(errorState);
            return errorState;
        }
    }
}
