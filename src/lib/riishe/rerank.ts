/**
 * BEAN Intelligence — RIISHE REAL passage-reranking lane (M40, SERVER ONLY).
 *
 * Genuine cross-encoder inference on the SHA-256-pinned ms-marco-MiniLM-L-6-v2
 * quantized ONNX model through the EXISTING local-model manager. Accepts a
 * query and candidate passages, scores EVERY (query, passage) pair with a
 * real forward pass, and returns sigmoid relevance scores plus the ordered
 * ranking — scores are measured, never synthesized from keyword overlap.
 *
 * Honesty rules:
 *  - an uninstalled/corrupted artifact is an HONEST unavailable state
 *    (`RerankUnavailableError`);
 *  - candidates are capped (MAX_RERANK_CANDIDATES) so CPU cost stays bounded;
 *  - every result carries the model id + measured latency.
 */
import * as ort from 'onnxruntime-node'
import { getSession, localModelState, localModelCompanionPath } from '@/lib/media/local-models'
import { WordPieceTokenizer } from './text-tokenizer'

export const RERANK_MODEL_ID = 'ms-marco-minilm-rerank'
export const RERANK_MAX_TOKENS = 512
export const MAX_RERANK_CANDIDATES = 8

export class RerankUnavailableError extends Error {}

export interface RerankResult {
  /** Score per input candidate, same order as the input passages (0..1). */
  scores: number[]
  /** Candidate indexes sorted by DESCENDING relevance. */
  ordering: number[]
  provenance: {
    model: 'ms-marco-MiniLM-L-6-v2 cross-encoder (quantized ONNX, bean-pinned sha256)'
    runtime: 'onnxruntime-node CPU'
    pairs: number
    latencyMs: number
  }
}

let tokenizer: WordPieceTokenizer | null = null

async function getTokenizer(): Promise<WordPieceTokenizer> {
  if (tokenizer) return tokenizer
  const { readFileSync } = await import('node:fs')
  tokenizer = new WordPieceTokenizer(readFileSync(localModelCompanionPath(RERANK_MODEL_ID, 'vocab.txt'), 'utf8'))
  return tokenizer
}

function requireReady(): void {
  const state = localModelState(RERANK_MODEL_ID)
  if (state.state !== 'ready') {
    throw new RerankUnavailableError(
      `Passage reranking is unavailable on this host: the pinned cross-encoder model is ${state.state === 'not-installed' ? 'not installed' : `not usable (${state.error ?? state.state})`}.`,
    )
  }
}

/** True when the lane can execute right now (no model load). */
export function rerankLaneReady(): boolean {
  return localModelState(RERANK_MODEL_ID).state === 'ready'
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

/** Genuine pair-wise relevance scoring + ordering (CPU inference, measured). */
export async function rerankPassages(query: string, passages: string[]): Promise<RerankResult> {
  requireReady()
  if (passages.length === 0) throw new RerankUnavailableError('rerankPassages received no candidate passages')
  const capped = passages.slice(0, MAX_RERANK_CANDIDATES)
  const t0 = Date.now()
  const tok = await getTokenizer()
  const session = await getSession(RERANK_MODEL_ID)

  const scores: number[] = []
  for (const passage of capped) {
    const { inputIds, tokenTypeIds, attentionMask } = tok.encode(query.slice(0, 2_000), {
      pair: passage.slice(0, 8_000),
      maxLen: RERANK_MAX_TOKENS,
    })
    const len = inputIds.length
    const results = await session.run({
      input_ids: new ort.Tensor('int64', BigInt64Array.from(inputIds.map((v) => BigInt(v))), [1, len]),
      attention_mask: new ort.Tensor('int64', BigInt64Array.from(attentionMask.map((v) => BigInt(v))), [1, len]),
      token_type_ids: new ort.Tensor('int64', BigInt64Array.from(tokenTypeIds.map((v) => BigInt(v))), [1, len]),
    })
    const logits = results[session.outputNames[0]].data as Float32Array
    scores.push(sigmoid(logits[0]))
  }

  const ordering = scores
    .map((s, i) => ({ s, i }))
    .sort((x, y) => y.s - x.s)
    .map((x) => x.i)

  return {
    scores,
    ordering,
    provenance: {
      model: 'ms-marco-MiniLM-L-6-v2 cross-encoder (quantized ONNX, bean-pinned sha256)',
      runtime: 'onnxruntime-node CPU',
      pairs: capped.length,
      latencyMs: Date.now() - t0,
    },
  }
}
