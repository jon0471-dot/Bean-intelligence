/**
 * BEAN Intelligence — RIISHE document retrieval lane (M40, SERVER ONLY).
 *
 * Embedding-based retrieval + cross-encoder reranking over the documents the
 * user attached to THIS conversation, integrated into the EXISTING retrieval
 * surface (the `search_document` tool beside `read_document`). It rides the
 * REAL M40 lanes (pinned MiniLM embeddings + ms-marco cross-encoder, CPU) and
 * creates NO new memory/vector database: chunk vectors live in a bounded,
 * conversation-scoped in-process cache keyed by document id — the same
 * session-local pattern the RIISHE memory and atlas tools already use — and
 * evaporate with the process or when evicted.
 *
 * Honesty rules:
 *  - uninstalled lanes are honest unavailable states (typed errors surface
 *    through the tool so the orchestrator can fall back to read_document);
 *  - chunk counts, cache size and provenance are measured on every result;
 *  - the cache is bounded (MAX_CACHED_DOCS, MAX_CHUNKS_PER_DOC) — low-spec
 *    hosts never accumulate unbounded vector memory.
 */
import { embedTexts, cosineSimilarity, EmbeddingUnavailableError, EMBEDDING_DIMENSIONS } from './embeddings'
import { rerankPassages, RerankUnavailableError, MAX_RERANK_CANDIDATES } from './rerank'

const CHUNK_CHARS = 700
const CHUNK_OVERLAP = 120
export const MAX_CHUNKS_PER_DOC = 400
export const MAX_CACHED_DOCS = 8
const TOP_K_BEFORE_RERANK = MAX_RERANK_CANDIDATES
const TOP_K_FINAL = 3
const MIN_CHUNK_CHARS = 40

export interface RetrievedPassage {
  text: string
  charStart: number
  charEnd: number
  /** Cosine similarity of the chunk to the query (embedding stage). */
  cosine: number
  /** Cross-encoder relevance score 0..1 (rerank stage). */
  relevance: number
}

export interface DocumentSearchResult {
  passages: RetrievedPassage[]
  provenance: {
    embeddings: { model: string; runtime: string; chunksEmbedded: number; latencyMs: number }
    rerank: { model: string; runtime: string; pairs: number; latencyMs: number }
    cache: { cachedChunks: number; recomputed: boolean }
  }
}

interface CachedChunks {
  chunks: Array<{ text: string; start: number }>
  vectors: Float32Array[]
  dimensions: number
  cachedAt: number
}

/** conversationId:docId → chunk cache (bounded LRU by insertion order). */
const cache = new Map<string, CachedChunks>()

/** Test/production hook: drop every cached chunk vector (memory pressure). */
export function clearDocumentRetrievalCache(): void {
  cache.clear()
}

export function documentRetrievalCacheSize(): number {
  return cache.size
}

/** Deterministic chunking with overlap; pure and unit-tested. */
export function chunkDocument(text: string): Array<{ text: string; start: number }> {
  const chunks: Array<{ text: string; start: number }> = []
  if (!text || text.length === 0) return chunks
  const step = CHUNK_CHARS - CHUNK_OVERLAP
  for (let start = 0; start < text.length && chunks.length < MAX_CHUNKS_PER_DOC; start += step) {
    // Snap chunk boundaries to whitespace when possible (chunks feed the
    // tokenizer; whole-word boundaries measurably improve relevance).
    let end = Math.min(start + CHUNK_CHARS, text.length)
    if (end < text.length) {
      const window = text.slice(end - 80, end)
      const lastBreak = Math.max(window.lastIndexOf('\n'), window.lastIndexOf('. '), window.lastIndexOf(' '))
      if (lastBreak > 0) end = end - 80 + lastBreak + 1
    }
    const chunkText = text.slice(start, end)
    if (chunkText.trim().length >= MIN_CHUNK_CHARS) {
      chunks.push({ text: chunkText, start })
    }
    if (end >= text.length) break
  }
  return chunks
}

function lruBump(key: string, value: CachedChunks): void {
  cache.delete(key)
  cache.set(key, value)
  while (cache.size > MAX_CACHED_DOCS) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

/**
 * Search ONE attached document: embed query + chunks (cached per document),
 * cosine-retrieve the top candidates, cross-encoder rerank, return the top
 * passages with REAL measured scores and provenance.
 */
export async function searchDocument(args: {
  conversationKey: string
  documentId: string
  documentName: string
  documentText: string
  query: string
}): Promise<DocumentSearchResult> {
  const query = args.query.trim()
  if (!query) throw new EmbeddingUnavailableError('searchDocument received an empty query')
  if (args.documentText.length === 0) {
    throw new EmbeddingUnavailableError(`"${args.documentName}" has no extractable text to search.`)
  }

  const cacheKey = `${args.conversationKey}:${args.documentId}`
  let entry = cache.get(cacheKey)
  let recomputed = false
  if (!entry) {
    const chunks = chunkDocument(args.documentText)
    if (chunks.length === 0) {
      throw new EmbeddingUnavailableError(`"${args.documentName}" produced no searchable chunks (text too short or empty).`)
    }
    const embedded = await embedTexts(chunks.map((c) => c.text))
    if (embedded.dimensions !== EMBEDDING_DIMENSIONS) {
      throw new EmbeddingUnavailableError(`embedding lane returned dimension ${embedded.dimensions}, expected ${EMBEDDING_DIMENSIONS}`)
    }
    entry = { chunks, vectors: embedded.vectors, dimensions: embedded.dimensions, cachedAt: Date.now() }
    lruBump(cacheKey, entry)
    recomputed = true
  }

  const tEmb = Date.now()
  const queryEmbedded = await embedTexts([query])
  const embLatency = Date.now() - tEmb

  // Cosine retrieval over the cached chunk vectors.
  const q = queryEmbedded.vectors[0]
  const scored = entry.chunks.map((c, i) => ({
    chunk: c,
    cosine: cosineSimilarity(q, entry.vectors[i]),
  }))
  scored.sort((a, b) => b.cosine - a.cosine)
  const candidates = scored.slice(0, Math.min(TOP_K_BEFORE_RERANK, scored.length))

  // Cross-encoder rerank of the cosine winners (REAL pair-wise scoring).
  const reranked = await rerankPassages(query, candidates.map((c) => c.chunk.text))
  const passages: RetrievedPassage[] = reranked.ordering.slice(0, TOP_K_FINAL).map((idx) => ({
    text: candidates[idx].chunk.text,
    charStart: candidates[idx].chunk.start,
    charEnd: candidates[idx].chunk.start + candidates[idx].chunk.text.length,
    cosine: candidates[idx].cosine,
    relevance: reranked.scores[idx],
  }))

  return {
    passages,
    provenance: {
      embeddings: {
        model: queryEmbedded.provenance.model,
        runtime: queryEmbedded.provenance.runtime,
        chunksEmbedded: recomputed ? entry.chunks.length + 1 : 1,
        latencyMs: embLatency,
      },
      rerank: {
        model: reranked.provenance.model,
        runtime: reranked.provenance.runtime,
        pairs: reranked.provenance.pairs,
        latencyMs: reranked.provenance.latencyMs,
      },
      cache: { cachedChunks: entry.chunks.length, recomputed },
    },
  }
}

export { EmbeddingUnavailableError, RerankUnavailableError }
