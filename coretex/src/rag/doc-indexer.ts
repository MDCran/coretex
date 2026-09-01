// Coretex — project context document indexer. Mirrors CodeIndexer but for
// user-uploaded context docs: it extracts text from each uploaded file, chunks
// and embeds it, and merges the result into the project's unified index under the
// "doc" source (leaving code chunks untouched). Retrieval/chat already consume
// doc chunks — this is the missing producer. Text formats only in v1 (txt/md/
// json/csv/code); binary docs (pdf/docx) are recorded as metadata but not indexed.

import type { CodeIndexState, UploadedDoc } from "../types.js";
import { ProjectIndexStore, type IndexChunk, chunkId } from "./store.js";
import { embedTexts } from "./embeddings.js";

const CHUNK_LINES = 120;
const CHUNK_OVERLAP = 15;
const EMBED_BATCH = 64;
const MAX_DOC_BYTES = 2 * 1024 * 1024;

/** Decode an UploadedDoc's content (data-URL/base64 or raw text) to text, or null if binary. */
export function decodeDocText(doc: UploadedDoc): string | null {
    let text: string;
    if (doc.content.startsWith("data:")) {
        const comma = doc.content.indexOf(",");
        const meta = doc.content.slice(5, comma);
        const payload = doc.content.slice(comma + 1);
        try {
            if (/;base64/i.test(meta)) {
                text = Buffer.from(payload, "base64").toString("utf8");
            } else {
                text = decodeURIComponent(payload);
            }
        } catch {
            return null;
        }
    } else {
        text = doc.content;
    }
    if (text.length > MAX_DOC_BYTES) text = text.slice(0, MAX_DOC_BYTES);
    // Reject obviously-binary content (a NUL byte is a reliable binary signal).
    if (/\x00/.test(text)) return null;
    return text;
}

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
        if (end >= lines.length) break;
    }
    return out;
}

export class DocIndexer {
    constructor(
        private readonly store: ProjectIndexStore,
        private readonly ollamaBaseUrl: string,
    ) {}

    /**
     * Ingest uploaded docs into the project's "doc" source, merging with any docs
     * already attached (re-uploading the same filename replaces its chunks).
     * The caller must `store.load(projectId)` first. Returns the final index state.
     */
    async indexDocuments(
        projectId: string,
        docs: UploadedDoc[],
        onProgress?: (state: CodeIndexState) => void,
    ): Promise<CodeIndexState> {
        const emit = (status: CodeIndexState["status"], extra?: Partial<CodeIndexState>): void => {
            onProgress?.({
                projectId,
                status,
                filesScanned: docs.length,
                chunks: this.store.counts(projectId).code,
                docChunks: this.store.counts(projectId).doc,
                ...extra,
            });
        };

        try {
            emit("indexing");
            const newNames = new Set(docs.map((d) => d.name));
            // Keep existing doc chunks except for filenames being re-uploaded.
            const keptDocs = this.store
                .getChunks(projectId)
                .filter((c) => c.source === "doc" && !newNames.has(c.path));

            const fresh: IndexChunk[] = [];
            for (const doc of docs) {
                const text = decodeDocText(doc);
                if (text === null) continue; // binary/undecodable — metadata only
                for (const window of chunkLines(text)) {
                    fresh.push({
                        id: chunkId("doc", doc.name, window.lineStart),
                        projectId,
                        source: "doc",
                        path: doc.name,
                        text: window.text,
                        lineStart: window.lineStart,
                        lineEnd: window.lineEnd,
                    });
                }
            }

            // Embed fresh chunks in batches (positional; null → lexical fallback).
            for (let i = 0; i < fresh.length; i += EMBED_BATCH) {
                const batch = fresh.slice(i, i + EMBED_BATCH);
                const vectors = await embedTexts(batch.map((c) => c.text), this.ollamaBaseUrl);
                if (vectors === null) continue;
                for (let j = 0; j < batch.length; j++) {
                    const vec = vectors[j];
                    const chunk = batch[j];
                    if (vec !== undefined && chunk !== undefined) chunk.embedding = vec;
                }
                emit("indexing");
            }

            this.store.replaceSource(projectId, "doc", keptDocs.concat(fresh));
            await this.store.save(projectId);

            const finalState: CodeIndexState = {
                projectId,
                status: "ready",
                filesScanned: docs.length,
                chunks: this.store.counts(projectId).code,
                docChunks: this.store.counts(projectId).doc,
                lastIndexedAt: Date.now(),
            };
            onProgress?.(finalState);
            return finalState;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const errorState: CodeIndexState = {
                projectId,
                status: "error",
                filesScanned: 0,
                chunks: this.store.counts(projectId).code,
                docChunks: this.store.counts(projectId).doc,
                error: message,
            };
            onProgress?.(errorState);
            return errorState;
        }
    }
}
