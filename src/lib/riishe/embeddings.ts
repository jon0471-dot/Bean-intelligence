/**
 * BEAN Intelligence — RIISHE REAL text-embedding lane (M40, SERVER ONLY).
 *
 * Genuine CPU inference on the SHA-256-pinned all-MiniLM-L6-v2 quantized
 * ONNX model through the EXISTING local-model manager (`getSession`,
 * one resident session, idle-unloaded, kSameAsRequested arena). Produces
 * 384-dim L2-normalized embeddings via mean pooling — the exact pooling the
 * sentence-transformers model card prescribes.
 *
 * Honesty rules:
 *  - an uninstalled/corrupted artifact is an HONEST unavailable state — the
 *    caller receives a typed `EmbeddingUnavailableError`, never zeros,
 *    hashes or random vectors standing in for real embeddings;
 *  - every result carries the model id + measured latency (provenance);
 *  - batching is bounded (RAM-safe: small fixed micro-batches, no arena
 *    ballooning on the shared CPU).
 */
import * as ort from 'onnxruntime-node'
import { getSession, localModelState, localModelCompanionPath } from '@/lib/media/local-models'
import { WordPieceTokenizer } from './text-tokenizer'

export const EMBEDDING_MODEL_ID = 'minilm-l6-embeddings'
export const EMBEDDING_DIMENSIONS = 384
export const EMBEDDING_MAX_TOKENS = 512
const BATCH = 8

export class EmbeddingUnavailableError extends Error {}

export interface EmbeddingBatch {
  vectors: Float32Array[]
  dimensions: number
  provenance: {
    model: 'all-MiniLM-L6-v2 (quantized ONNX, bean-pinned sha256)'
    runtime: 'onnxruntime-node CPU'
    texts: number
    latencyMs: number
  }
}

let tokenizer: WordPieceTokenizer | null = null

async function getTokenizer(): Promise<WordPieceTokenizer> {
  if (tokenizer) return tokenizer
  const { readFileSync } = await import('node:fs')
  tokenizer = new WordPieceTokenizer(readFileSync(localModelCompanionPath(EMBEDDING_MODEL_ID, 'vocab.txt'), 'utf8'))
  return tokenizer
}

/** Install-state check that throws the HONEST unavailable error. */
function requireReady(): void {
  const state = localModelState(EMBEDDING_MODEL_ID)
  if (state.state !== 'ready') {
    throw new EmbeddingUnavailableError(
      `Text embeddings are unavailable on this host: the pinned MiniLM embedding model is ${state.state === 'not-installed' ? 'not installed' : `not usable (${state.error ?? state.state})`}.`,
    )
  }
}

/** True when the lane can execute right now (no model load). */
export function embeddingsLaneReady(): boolean {
  return localModelState(EMBEDDING_MODEL_ID).state === 'ready'
}

function meanPool(hidden: Float32Array, dims: number, tokens: number): Float32Array {
  const out = new Float32Array(dims)
  for (let t = 0; t < tokens; t++) {
    for (let d = 0; d < dims; d++) out[d] += hidden[t * dims + d]
  }
  for (let d = 0; d < dims; d++) out[d] /= tokens
  let norm = 0
  for (let d = 0; d < dims; d++) norm += out[d] * out[d]
  norm = Math.sqrt(norm) || 1
  for (let d = 0; d < dims; d++) out[d] /= norm
  return out
}

/** Genuine embeddings for a bounded list of texts (CPU inference, measured). */
export async function embedTexts(texts: string[]): Promise<EmbeddingBatch> {
  requireReady()
  if (texts.length === 0) throw new EmbeddingUnavailableError('embedTexts received no input text')
  const t0 = Date.now()
  const tok = await getTokenizer()
  const session = await getSession(EMBEDDING_MODEL_ID)

  const vectors: Float32Array[] = []
  for (let start = 0; start < texts.length; start += BATCH) {
    const slice = texts.slice(start, start + BATCH)
    // Per-text runs keep the CPU arena bounded; batching happens at the
    // scheduler level (concurrency), not by concatenating rows into one
    // giant tensor (measured OOM pattern on low-spec hosts).
    for (const text of slice) {
      const { inputIds, tokenTypeIds, attentionMask } = tok.encode(text.slice(0, 12_000), { maxLen: EMBEDDING_MAX_TOKENS })
      const len = inputIds.length
      const results = await session.run({
        input_ids: new ort.Tensor('int64', BigInt64Array.from(inputIds.map((v) => BigInt(v))), [1, len]),
        attention_mask: new ort.Tensor('int64', BigInt64Array.from(attentionMask.map((v) => BigInt(v))), [1, len]),
        token_type_ids: new ort.Tensor('int64', BigInt64Array.from(tokenTypeIds.map((v) => BigInt(v))), [1, len]),
      })
      const out = results[session.outputNames[0]]
      const dims = out.dims // [1, tokens, 384]
      vectors.push(meanPool(out.data as Float32Array, dims[2], dims[1]))
    }
  }

  return {
    vectors,
    dimensions: EMBEDDING_DIMENSIONS,
    provenance: {
      model: 'all-MiniLM-L6-v2 (quantized ONNX, bean-pinned sha256)',
      runtime: 'onnxruntime-node CPU',
      texts: texts.length,
      latencyMs: Date.now() - t0,
    },
  }
}

/** Cosine similarity for L2-normalized vectors (dot product). */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) throw new Error('cosineSimilarity dimension mismatch')
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}
