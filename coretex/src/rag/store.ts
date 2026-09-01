// Coretex — unified per-project retrieval index.
//
// A single store holds BOTH document chunks and source-code chunks for every
// project, persisted to disk under <dataDir>/projects/<projectId>/index.json.
//
// Retrieval prefers dense cosine similarity (when the query can be embedded and
// the stored chunks carry embeddings) and degrades to a BM25 lexical ranker
// otherwise. Code and doc chunks are ranked independently so a query always
// surfaces the most relevant of each up to the caller's per-source limits.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ChatCitation, ChatSourceKind } from "../types.js";
import { Bm25, cosineSim, embedOne, tokenize } from "./embeddings.js";

/** A single indexed unit of retrievable text (a doc passage or a code span). */
export interface IndexChunk {
    id: string;
    projectId: string;
    source: ChatSourceKind;
    path: string;
    text: string;
    lineStart?: number;
    lineEnd?: number;
    embedding?: number[];
}

/** An {@link IndexChunk} paired with its relevance score for a given query. */
export interface RetrievedChunk extends IndexChunk {
    score: number;
}

/** Stable-ish id for a chunk: `source:path:lineStart`. */
export function chunkId(source: ChatSourceKind, path: string, lineStart?: number): string {
    return source + ":" + path + ":" + (lineStart ?? 0);
}

function isReadableNumberArray(value: unknown): value is number[] {
    return Array.isArray(value) && value.length > 0 && value.every((n) => typeof n === "number");
}

/**
 * In-memory + on-disk retrieval index, one logical index per project holding
 * both document and source-code chunks.
 */
export class ProjectIndexStore {
    private readonly dataDir: string;
    private readonly byProject = new Map<string, IndexChunk[]>();

    constructor(dataDir: string) {
        this.dataDir = dataDir;
    }

    /** Absolute path to a project's persisted index file. */
    private fileFor(projectId: string): string {
        return join(this.dataDir, "projects", projectId, "index.json");
    }

    /**
     * Load a project's chunks from disk into memory. Missing files are treated
     * as an empty index (the directory is created). Never throws on ENOENT.
     */
    async load(projectId: string): Promise<void> {
        const file = this.fileFor(projectId);
        await mkdir(dirname(file), { recursive: true });

        let raw: string;
        try {
            raw = await readFile(file, "utf8");
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === "ENOENT") {
                this.byProject.set(projectId, []);
                return;
            }
            throw err;
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            this.byProject.set(projectId, []);
            return;
        }

        this.byProject.set(projectId, Array.isArray(parsed) ? (parsed as IndexChunk[]) : []);
    }

    /** Persist a project's in-memory chunks to disk as JSON. */
    async save(projectId: string): Promise<void> {
        const file = this.fileFor(projectId);
        await mkdir(dirname(file), { recursive: true });
        const chunks = this.byProject.get(projectId) ?? [];
        await writeFile(file, JSON.stringify(chunks), "utf8");
    }

    /** All in-memory chunks for a project (empty array if none loaded). */
    getChunks(projectId: string): IndexChunk[] {
        return this.byProject.get(projectId) ?? [];
    }

    /** Count of code vs doc chunks currently in memory for a project. */
    counts(projectId: string): { code: number; doc: number } {
        let code = 0;
        let doc = 0;
        for (const chunk of this.getChunks(projectId)) {
            if (chunk.source === "code") {
                code++;
            } else {
                doc++;
            }
        }
        return { code, doc };
    }

    /**
     * Replace all chunks of a given source for a project with `chunks`, leaving
     * the other source's chunks untouched.
     */
    replaceSource(projectId: string, source: ChatSourceKind, chunks: IndexChunk[]): void {
        const existing = this.byProject.get(projectId) ?? [];
        const kept = existing.filter((c) => c.source !== source);
        this.byProject.set(projectId, kept.concat(chunks));
    }

    /**
     * Retrieve the most relevant chunks for `query`.
     *
     * Dense path: embed the query with {@link embedOne}; if that yields a vector
     * and at least one chunk carries an embedding, rank by {@link cosineSim}.
     * Lexical path: otherwise (or for chunks lacking embeddings) build a
     * {@link Bm25} ranker over the tokenized chunk texts and score lexically.
     *
     * Code and doc chunks are ranked independently; up to `opts.codeK` code and
     * `opts.docK` doc chunks are returned, concatenated code-first, deduped by id.
     */
    async retrieve(
        projectId: string,
        query: string,
        opts: { codeK: number; docK: number; ollamaBaseUrl?: string },
    ): Promise<RetrievedChunk[]> {
        const all = this.getChunks(projectId);
        if (all.length === 0) {
            return [];
        }

        const codeChunks = all.filter((c) => c.source === "code");
        const docChunks = all.filter((c) => c.source === "doc");

        const queryEmbedding = await embedOne(query, opts.ollamaBaseUrl);
        const haveQueryVec = isReadableNumberArray(queryEmbedding);

        const rankedCode = this.rankSource(codeChunks, query, haveQueryVec ? queryEmbedding : null);
        const rankedDoc = this.rankSource(docChunks, query, haveQueryVec ? queryEmbedding : null);

        const topCode = rankedCode.slice(0, Math.max(0, opts.codeK));
        const topDoc = rankedDoc.slice(0, Math.max(0, opts.docK));

        const out: RetrievedChunk[] = [];
        const seen = new Set<string>();
        for (const chunk of topCode.concat(topDoc)) {
            if (seen.has(chunk.id)) {
                continue;
            }
            seen.add(chunk.id);
            out.push(chunk);
        }
        return out;
    }

    /**
     * Rank a single source's chunks. Uses cosine similarity when a query vector
     * is supplied and the chunks carry embeddings; otherwise falls back to BM25.
     */
    private rankSource(
        chunks: IndexChunk[],
        query: string,
        queryEmbedding: number[] | null,
    ): RetrievedChunk[] {
        if (chunks.length === 0) {
            return [];
        }

        const embeddable =
            queryEmbedding !== null && chunks.some((c) => isReadableNumberArray(c.embedding));

        let scored: RetrievedChunk[];
        if (embeddable && queryEmbedding !== null) {
            scored = chunks.map((c) => ({
                ...c,
                score: isReadableNumberArray(c.embedding)
                    ? cosineSim(queryEmbedding, c.embedding)
                    : 0,
            }));
        } else {
            const tokenizedDocs = chunks.map((c) => tokenize(c.text));
            const bm25 = new Bm25(tokenizedDocs);
            const queryTokens = tokenize(query);
            scored = chunks.map((c, i) => ({
                ...c,
                score: bm25.score(queryTokens, i),
            }));
        }

        scored.sort((a, b) => b.score - a.score);
        return scored;
    }

    /** Distinct citations ({path, kind, lineStart, lineEnd}) for retrieved chunks. */
    toCitations(chunks: RetrievedChunk[]): ChatCitation[] {
        const out: ChatCitation[] = [];
        const seen = new Set<string>();
        for (const chunk of chunks) {
            const key =
                chunk.source + ":" + chunk.path + ":" + (chunk.lineStart ?? "") + ":" + (chunk.lineEnd ?? "");
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            const citation: ChatCitation = { path: chunk.path, kind: chunk.source };
            if (chunk.lineStart !== undefined) {
                citation.lineStart = chunk.lineStart;
            }
            if (chunk.lineEnd !== undefined) {
                citation.lineEnd = chunk.lineEnd;
            }
            out.push(citation);
        }
        return out;
    }
}
