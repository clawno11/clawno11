/**
 * Local RAG (Retrieval-Augmented Generation) knowledge base.
 *
 * Architecture:
 *  - Documents are chunked (~500 chars, 60-char overlap) and stored in SQLite.
 *  - Search uses TF cosine similarity for semantic ranking.
 *    Candidate chunks are first fetched by SQL LIKE (fast recall), then
 *    re-ranked by cosine similarity against the query TF vector (precision).
 *  - Context injection: top-K highest-scoring chunks above a minimum similarity
 *    threshold are prepended to the user message as a system-style preamble.
 *
 * All data stays 100% local — no embeddings API, no external calls.
 */

import Database from "@tauri-apps/plugin-sql";
import { DB_URL } from "../db";

// ── Types ─────────────────────────────────────────────────────────────────

export interface RagDocument {
  id: string;
  name: string;
  path: string | null;
  mime: string;
  charCount: number;
  chunkCount: number;
  createdAt: number;
}

export interface RagChunk {
  id: string;
  docId: string;
  chunkIndex: number;
  content: string;
  /** Cosine similarity score (0–1). Present only when returned by searchChunks. */
  score?: number;
}

// ── Constants ─────────────────────────────────────────────────────────────

const CHUNK_SIZE = 500;
const OVERLAP    = 60;

/**
 * Minimum cosine similarity for a chunk to be included in RAG context.
 * Chunks scoring below this threshold are considered irrelevant to the query
 * and are excluded to avoid injecting unrelated content into the AI prompt.
 */
const MIN_SIMILARITY = 0.05;

/**
 * How many LIKE-recall candidates to fetch per search.
 * A higher multiplier gives the cosine re-ranker more to work with,
 * at the cost of more in-memory processing.
 */
const RECALL_MULTIPLIER = 8;

// ── Chunking ──────────────────────────────────────────────────────────────

/**
 * Split document text into overlapping chunks suitable for retrieval.
 *
 * Strategy:
 *  - Split on 2+ blank lines (paragraph boundaries) first.
 *  - Paragraphs ≤ CHUNK_SIZE are kept as-is.
 *  - Longer paragraphs are slid over with OVERLAP to preserve context.
 *  - CSV/TSV files: each non-empty line is treated as an independent chunk
 *    (splitting on paragraph boundaries would group many rows into one chunk).
 */
function chunkText(text: string, mime?: string): string[] {
  const cleaned = text.replace(/\r\n/g, "\n").replace(/\t/g, "  ");

  // Format-specific strategy for CSV/TSV: chunk per line to avoid
  // cutting in the middle of a data row.
  if (mime === "text/csv") {
    return cleaned
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .reduce<string[]>((acc, line) => {
        // Group lines into chunks of CHUNK_SIZE chars to avoid thousands of tiny chunks
        const last = acc[acc.length - 1];
        if (last !== undefined && last.length + line.length + 1 <= CHUNK_SIZE) {
          acc[acc.length - 1] = last + "\n" + line;
        } else {
          acc.push(line);
        }
        return acc;
      }, []);
  }

  const paragraphs = cleaned
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 5); // Lower threshold to keep short headings

  const chunks: string[] = [];

  for (const para of paragraphs) {
    if (para.length <= CHUNK_SIZE) {
      chunks.push(para);
    } else {
      // Slide a window over long paragraphs with overlap
      let start = 0;
      while (start < para.length) {
        const end   = Math.min(start + CHUNK_SIZE, para.length);
        const slice = para.slice(start, end).trim();
        if (slice.length > 10) chunks.push(slice);
        if (end === para.length) break;
        start = end - OVERLAP;
      }
    }
  }

  return chunks;
}

/** Infer MIME type from file extension for format-specific chunking. */
function mimeFromName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "csv")                      return "text/csv";
  if (ext === "md" || ext === "markdown") return "text/markdown";
  if (ext === "html" || ext === "htm")    return "text/html";
  if (ext === "json")                     return "application/json";
  if (ext === "yaml" || ext === "yml")    return "application/yaml";
  return "text/plain";
}

// ── Document ingestion ────────────────────────────────────────────────────

/**
 * Ingest a document into the knowledge base.
 *
 * - Rejects empty documents (no usable chunks) with a descriptive error.
 * - Detects duplicates by file path: if the same path was previously imported,
 *   the old document (and its chunks) is atomically replaced inside the transaction.
 * - All reads, deletes and inserts are wrapped in a single transaction so a
 *   mid-import crash leaves the database in a consistent state.
 */
export async function ingestDocument(
  name: string,
  content: string,
  path?: string,
): Promise<{ docId: string; chunkCount: number }> {
  const db    = await Database.load(DB_URL);
  const mime  = mimeFromName(name);
  const chunks = chunkText(content, mime);

  if (chunks.length === 0) {
    throw new Error(
      "文件内容为空或全部内容过短（每段不足 5 个字符），无法建立知识块。请检查文件内容后重试。",
    );
  }

  const docId = crypto.randomUUID();
  const now   = Date.now();

  // All operations — including the old-document cleanup — run inside one
  // transaction so a crash at any point leaves no partial state.
  await db.execute("BEGIN");
  try {
    // Replace existing document with the same path to avoid duplicates.
    if (path) {
      const existing = await db.select<Array<{ id: string }>>(
        `SELECT id FROM rag_documents WHERE path = $1 LIMIT 1`,
        [path],
      );
      if (existing.length > 0) {
        const oldId = existing[0]!.id;
        // Explicitly delete chunks first (SQLite FK cascade requires PRAGMA foreign_keys=ON
        // which tauri-plugin-sql does not guarantee).
        await db.execute(`DELETE FROM rag_chunks    WHERE doc_id = $1`, [oldId]);
        await db.execute(`DELETE FROM rag_documents WHERE id     = $1`, [oldId]);
      }
    }

    await db.execute(
      `INSERT INTO rag_documents (id, name, path, mime, char_count, chunk_count, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [docId, name, path ?? null, mime, content.length, chunks.length, now],
    );

    for (let i = 0; i < chunks.length; i++) {
      await db.execute(
        `INSERT INTO rag_chunks (id, doc_id, chunk_index, content, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        // chunks[i] is guaranteed non-undefined by the loop bounds
        [crypto.randomUUID(), docId, i, chunks[i]!, now],
      );
    }

    await db.execute("COMMIT");
  } catch (e) {
    await db.execute("ROLLBACK");
    throw e;
  }

  return { docId, chunkCount: chunks.length };
}

// ── Document management ───────────────────────────────────────────────────

export async function listDocuments(): Promise<RagDocument[]> {
  const db   = await Database.load(DB_URL);
  const rows = await db.select<Array<{
    id: string; name: string; path: string | null; mime: string;
    char_count: number; chunk_count: number; created_at: number;
  }>>(
    `SELECT id, name, path, mime, char_count, chunk_count, created_at
     FROM rag_documents ORDER BY created_at DESC`,
  );
  return rows.map((r) => ({
    id: r.id, name: r.name, path: r.path, mime: r.mime,
    charCount: r.char_count, chunkCount: r.chunk_count, createdAt: r.created_at,
  }));
}

/**
 * Delete a document and all its associated chunks atomically.
 *
 * Both deletes run inside a transaction so a crash between them cannot
 * leave a document record with no chunks (orphan document visible in the list
 * but returning no search results).
 *
 * Chunks are deleted explicitly rather than relying on ON DELETE CASCADE,
 * because SQLite FK enforcement requires PRAGMA foreign_keys = ON
 * which tauri-plugin-sql does not guarantee.
 */
export async function deleteDocument(docId: string): Promise<void> {
  const db = await Database.load(DB_URL);
  await db.execute("BEGIN");
  try {
    await db.execute(`DELETE FROM rag_chunks    WHERE doc_id = $1`, [docId]);
    await db.execute(`DELETE FROM rag_documents WHERE id     = $1`, [docId]);
    await db.execute("COMMIT");
  } catch (e) {
    await db.execute("ROLLBACK");
    throw e;
  }
}

export async function documentCount(): Promise<number> {
  const db   = await Database.load(DB_URL);
  const rows = await db.select<Array<{ cnt: number }>>(
    `SELECT COUNT(*) as cnt FROM rag_documents`,
  );
  return rows[0]?.cnt ?? 0;
}

// ── TF cosine similarity ──────────────────────────────────────────────────

/** Tokenise text into lowercase word tokens (CJK character bigrams + Latin words). */
function tokenise(text: string): string[] {
  const tokens: string[] = [];
  // Latin / numeric words (min 2 chars)
  for (const m of text.toLowerCase().matchAll(/[a-z0-9_\-]{2,}/g)) {
    tokens.push(m[0]!);
  }
  // CJK bigrams — good approximation of semantic units without a full tokeniser.
  // Covers CJK Unified Ideographs + Hiragana/Katakana + Hangul.
  const cjk = text.replace(
    /[^\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af\uf900-\ufaff]/g,
    "",
  );
  for (let i = 0; i < cjk.length - 1; i++) {
    tokens.push(cjk[i]! + cjk[i + 1]!);
  }
  return tokens;
}

/** Compute term-frequency map (TF) for a token list. */
function tf(tokens: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
  const total = tokens.length || 1;
  freq.forEach((v, k) => freq.set(k, v / total));
  return freq;
}

/** Cosine similarity between two TF vectors (range 0–1). */
function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0, normA = 0, normB = 0;
  a.forEach((v, k) => { dot += v * (b.get(k) ?? 0); normA += v * v; });
  b.forEach((v)    => { normB += v * v; });
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Escape SQLite LIKE metacharacters (%, _, \) in a search word so that
 * user input is treated as a literal substring, not a pattern.
 */
function escapeLike(word: string): string {
  return word.replace(/[%_\\]/g, "\\$&");
}

// ── Search ────────────────────────────────────────────────────────────────

/**
 * TF cosine similarity search across all chunks.
 *
 * Steps:
 *  1. SQL LIKE recall — fast candidate fetch using escaped query keywords.
 *     Fetches up to RECALL_MULTIPLIER × topK candidates.
 *  2. TF cosine re-rank — score each candidate against the query TF vector.
 *  3. Return top-K results that meet the MIN_SIMILARITY threshold,
 *     sorted descending by score.
 */
export async function searchChunks(query: string, topK = 5): Promise<RagChunk[]> {
  const db    = await Database.load(DB_URL);
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .slice(0, 10);

  if (words.length === 0) return [];

  // Step 1: broad keyword recall with escaped LIKE patterns
  const conditions = words.map((_, i) => `LOWER(content) LIKE $${i + 2} ESCAPE '\\'`).join(" OR ");
  const params: (string | number)[] = [
    topK * RECALL_MULTIPLIER,
    ...words.map((w) => `%${escapeLike(w)}%`),
  ];

  const rows = await db.select<Array<{
    id: string; doc_id: string; chunk_index: number; content: string;
  }>>(
    `SELECT id, doc_id, chunk_index, content FROM rag_chunks
     WHERE ${conditions} LIMIT $1`,
    params,
  );

  if (rows.length === 0) return [];

  // Step 2: TF cosine re-rank
  const queryTf = tf(tokenise(query));
  const scored = rows.map((r) => ({
    id:         r.id,
    docId:      r.doc_id,
    chunkIndex: r.chunk_index,
    content:    r.content,
    score:      cosine(queryTf, tf(tokenise(r.content))),
  }));

  // Step 3: filter by minimum similarity, sort, return top-K
  return scored
    .filter((c) => c.score >= MIN_SIMILARITY)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/**
 * Build a context string to prepend to a chat message.
 *
 * Only chunks that exceed MIN_SIMILARITY are included, so when the query has
 * no meaningful overlap with the knowledge base, an empty string is returned
 * and no irrelevant context is injected into the AI prompt.
 */
export async function buildRagContext(query: string, topK = 3): Promise<string> {
  const chunks = await searchChunks(query, topK);
  if (chunks.length === 0) return "";

  const body = chunks
    .map((c, i) => `[${i + 1}] ${c.content}`)
    .join("\n\n");

  return `${body}\n\n`;
}
