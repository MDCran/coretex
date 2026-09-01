// Coretex — text embeddings via Ollama with a graceful lexical fallback.
//
// The Project Assistant prefers dense vector search (Ollama's nomic-embed-text),
// but Ollama may be offline or the model may be missing. Every network path here
// degrades to `null` so callers can fall back to the BM25 lexical ranker below.

/** Default embedding model pulled by Ollama for the Project Assistant. */
export const EMBED_MODEL = "nomic-embed-text";

/** Default Ollama base URL (no trailing slash). */
export const DEFAULT_OLLAMA = "http://localhost:11434";

interface EmbedBatchResponse {
    embeddings?: number[][];
}

interface EmbedSingleResponse {
    embedding?: number[];
}

function isNumberArray(value: unknown): value is number[] {
    return Array.isArray(value) && value.every((n) => typeof n === "number");
}

function isNumberMatrix(value: unknown): value is number[][] {
    return Array.isArray(value) && value.every(isNumberArray);
}

/**
 * Embed a batch of texts. Returns one vector per input text, or `null` if
 * embeddings are unavailable for any reason (Ollama offline, model missing,
 * non-ok response, malformed payload). Never throws.
 *
 * Strategy: try the modern batch endpoint `/api/embed` first. If that 404s
 * (older Ollama builds), fall back to the legacy per-text `/api/embeddings`.
 */
export async function embedTexts(
    texts: string[],
    baseUrl: string = DEFAULT_OLLAMA,
): Promise<number[][] | null> {
    if (texts.length === 0) {
        return [];
    }

    const root = baseUrl.replace(/\/+$/, "");

    // ---- Modern batch endpoint: POST /api/embed { model, input } ----
    try {
        const resp = await fetch(root + "/api/embed", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
        });

        if (resp.ok) {
            const data = (await resp.json()) as EmbedBatchResponse;
            const embeddings = data.embeddings;
            if (isNumberMatrix(embeddings) && embeddings.length === texts.length) {
                return embeddings;
            }
            // ok but unusable payload — give up gracefully.
            return null;
        }

        // Only the legacy fallback makes sense on a 404; any other non-ok
        // status (auth, server error) means embeddings are not available.
        if (resp.status !== 404) {
            return null;
        }
    } catch {
        return null;
    }

    // ---- Legacy endpoint: POST /api/embeddings { model, prompt } per text ----
    try {
        const out: number[][] = [];
        for (const text of texts) {
            const resp = await fetch(root + "/api/embeddings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
            });
            if (!resp.ok) {
                return null;
            }
            const data = (await resp.json()) as EmbedSingleResponse;
            const embedding = data.embedding;
            if (!isNumberArray(embedding)) {
                return null;
            }
            out.push(embedding);
        }
        return out;
    } catch {
        return null;
    }
}

/**
 * Convenience wrapper to embed a single string. Returns the vector, or `null`
 * if embeddings are unavailable. Never throws.
 */
export async function embedOne(
    text: string,
    baseUrl: string = DEFAULT_OLLAMA,
): Promise<number[] | null> {
    const result = await embedTexts([text], baseUrl);
    if (result === null) {
        return null;
    }
    const vec = result[0];
    return vec ?? null;
}

/**
 * Standard cosine similarity. Returns 0 when either vector is empty, the
 * lengths differ, or either has zero magnitude.
 */
export function cosineSim(a: number[], b: number[]): number {
    if (a.length === 0 || b.length === 0 || a.length !== b.length) {
        return 0;
    }

    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        const av = a[i] ?? 0;
        const bv = b[i] ?? 0;
        dot += av * bv;
        normA += av * av;
        normB += bv * bv;
    }

    if (normA === 0 || normB === 0) {
        return 0;
    }

    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// A small English stopword set — just enough to cut the highest-frequency
// function words that add noise to both BM25 and identifier matching.
const STOPWORDS = new Set<string>([
    "the", "and", "for", "are", "but", "not", "you", "all", "any", "can",
    "had", "her", "was", "one", "our", "out", "day", "get", "has", "him",
    "his", "how", "man", "new", "now", "old", "see", "two", "way", "who",
    "boy", "did", "its", "let", "put", "say", "she", "too", "use", "that",
    "this", "with", "from", "they", "have", "were", "will", "your", "what",
    "when", "them", "then", "than", "into", "some", "such", "only", "also",
    "been", "more", "most", "over", "very", "just", "like", "here", "there",
    "their", "would", "could", "should", "about", "which", "these", "those",
]);

/**
 * Split a camelCase / PascalCase / snake_case / kebab-case identifier (and any
 * surrounding prose) into lowercase word parts. This makes code identifiers
 * such as `parseHTTPResponse` or `max_retry_count` tokenize into useful terms.
 */
function splitWordParts(raw: string): string[] {
    const parts: string[] = [];
    // First break on any non-alphanumeric boundary (handles snake/kebab/dots).
    for (const segment of raw.split(/[^A-Za-z0-9]+/)) {
        if (segment.length === 0) {
            continue;
        }
        // Then break camelCase / PascalCase and digit boundaries within a segment.
        //   fooBar      -> foo, Bar
        //   parseHTTP   -> parse, HTTP
        //   HTTPServer  -> HTTP, Server
        //   v2Model     -> v, 2, Model  (kept simple: alpha/digit transitions)
        const sub = segment
            .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
            .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
            .replace(/([A-Za-z])([0-9])/g, "$1 $2")
            .replace(/([0-9])([A-Za-z])/g, "$1 $2");
        for (const piece of sub.split(/\s+/)) {
            if (piece.length > 0) {
                parts.push(piece);
            }
        }
    }
    return parts;
}

/**
 * Tokenize text for lexical search: lowercase, split on non-alphanumeric while
 * also breaking apart camelCase and snake/kebab identifiers, then drop tokens
 * shorter than 2 characters and a small English stopword set.
 */
export function tokenize(text: string): string[] {
    if (text.length === 0) {
        return [];
    }

    const tokens: string[] = [];
    for (const part of splitWordParts(text)) {
        const token = part.toLowerCase();
        if (token.length < 2) {
            continue;
        }
        if (STOPWORDS.has(token)) {
            continue;
        }
        tokens.push(token);
    }
    return tokens;
}

/**
 * Standard BM25 ranker over a corpus of pre-tokenized documents.
 *
 * Build once from the tokenized docs; call `score(queryTokens, docIndex)` to
 * rank a query against any document. Uses the canonical parameters k1=1.5 and
 * b=0.75 with the BM25+ idf floor to keep scores non-negative.
 */
export class Bm25 {
    private readonly k1 = 1.5;
    private readonly b = 0.75;

    private readonly docCount: number;
    private readonly avgDocLength: number;
    private readonly docLengths: number[];
    /** Per-document term frequencies. */
    private readonly termFreqs: Map<string, number>[];
    /** Inverse document frequency per term. */
    private readonly idf: Map<string, number>;

    constructor(docs: string[][]) {
        this.docCount = docs.length;
        this.docLengths = new Array(docs.length);
        this.termFreqs = new Array(docs.length);

        // Document frequency: number of docs containing each term.
        const df = new Map<string, number>();
        let totalLength = 0;

        for (let d = 0; d < docs.length; d++) {
            const tokens = docs[d] ?? [];
            this.docLengths[d] = tokens.length;
            totalLength += tokens.length;

            const tf = new Map<string, number>();
            for (const token of tokens) {
                tf.set(token, (tf.get(token) ?? 0) + 1);
            }
            this.termFreqs[d] = tf;

            for (const term of tf.keys()) {
                df.set(term, (df.get(term) ?? 0) + 1);
            }
        }

        this.avgDocLength = docs.length > 0 ? totalLength / docs.length : 0;

        // IDF with a positive floor (Lucene-style smoothing).
        this.idf = new Map<string, number>();
        for (const [term, freq] of df) {
            const value = Math.log(1 + (this.docCount - freq + 0.5) / (freq + 0.5));
            this.idf.set(term, value);
        }
    }

    /** BM25 relevance score of `queryTokens` against document `docIndex`. */
    score(queryTokens: string[], docIndex: number): number {
        if (docIndex < 0 || docIndex >= this.docCount) {
            return 0;
        }
        const tf = this.termFreqs[docIndex];
        if (tf === undefined) {
            return 0;
        }
        const docLength = this.docLengths[docIndex] ?? 0;

        let score = 0;
        for (const term of queryTokens) {
            const termFreq = tf.get(term);
            if (termFreq === undefined || termFreq === 0) {
                continue;
            }
            const idf = this.idf.get(term);
            if (idf === undefined) {
                continue;
            }
            const denomLengthNorm =
                this.avgDocLength > 0 ? docLength / this.avgDocLength : 0;
            const denom = termFreq + this.k1 * (1 - this.b + this.b * denomLengthNorm);
            score += idf * ((termFreq * (this.k1 + 1)) / denom);
        }
        return score;
    }
}
