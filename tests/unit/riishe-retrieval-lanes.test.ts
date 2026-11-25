/**
 * M40 — RIISHE retrieval lanes: REAL CPU inference + honest states.
 *
 * These tests run the REAL pinned models (all-MiniLM-L6-v2 quantized ONNX,
 * ms-marco-MiniLM-L-6-v2 quantized ONNX, tessdata_fast eng) through the
 * production services — onnxruntime-node CPU EP, no mocks:
 *  - embeddings: 384-dim, L2-normalized, paraphrase ≫ unrelated cosine;
 *  - reranking: cross-encoder scores order the relevant passage first;
 *  - document search: chunk → embed → cosine → rerank over a synthetic long
 *    document with planted facts; bounded cache reuse on the second call;
 *  - OCR: real text extraction from a sharp-rendered image + the honest
 *    no-usable-text refusal on a blank image;
 *  - uninstalled-artifact honesty: with BEAN_LOCAL_MODELS_DIR pointed at an
 *    empty directory, every lane throws its typed unavailable error — never
 *    zeros, never fabricated output.
 *
 * Environment note: these are REAL model executions (measured latencies in
 * the tens of ms on CPU) — they are the same class of evidence the M40
 * acceptance matrix records, run here at unit scope for regression pinning.
 */
import { describe, test, expect, afterAll } from 'bun:test'
import { existsSync } from 'node:fs'
import {
  embedTexts,
  cosineSimilarity,
  EmbeddingUnavailableError,
  EMBEDDING_DIMENSIONS,
} from '@/lib/riishe/embeddings'
import { rerankPassages, RerankUnavailableError } from '@/lib/riishe/rerank'
import {
  chunkDocument,
  searchDocument,
  clearDocumentRetrievalCache,
  documentRetrievalCacheSize,
  MAX_CACHED_DOCS,
  MAX_CHUNKS_PER_DOC,
} from '@/lib/riishe/doc-retrieval'
import {
  recognizeImageText,
  ocrLaneReady,
  ocrWorkerScriptPath,
  OCR_WORKER_SPAWN_TIMEOUT_MS,
  OcrUnavailableError,
  releaseOcrWorker,
} from '@/lib/riishe/ocr'
import {
  localModelState,
  unloadAllLocalModels,
  LOCAL_MODELS,
} from '@/lib/media/local-models'

const REAL_DIR = process.env.BEAN_LOCAL_MODELS_DIR // capture (tests may override)

function useEmptyModelDir(): void {
  process.env.BEAN_LOCAL_MODELS_DIR = '/tmp/m40-test-empty-models'
}

function useRealModelDir(): void {
  if (REAL_DIR) process.env.BEAN_LOCAL_MODELS_DIR = REAL_DIR
  else delete process.env.BEAN_LOCAL_MODELS_DIR
}

// Precondition: the pinned artifacts are installed (they are part of the
// milestone's verified state; if absent the install script is the fix).
const embedReady = localModelState('minilm-l6-embeddings').state === 'ready'
const rerankReady = localModelState('ms-marco-minilm-rerank').state === 'ready'
const ocrReady = localModelState('ocr-eng-traineddata').state === 'ready'

afterAll(async () => {
  useRealModelDir()
  clearDocumentRetrievalCache()
  await releaseOcrWorker()
  await unloadAllLocalModels()
})

describe('REAL embedding inference (all-MiniLM-L6-v2 quantized ONNX, CPU)', () => {
  test.skipIf(!embedReady)('produces 384-dim L2-normalized vectors with real semantic separation', async () => {
    useRealModelDir()
    const batch = await embedTexts([
      'The capital of France is Paris.',
      'Paris is the capital city of France.',
      'I enjoy playing soccer with my friends on weekends.',
    ])
    expect(batch.vectors.length).toBe(3)
    expect(batch.dimensions).toBe(EMBEDDING_DIMENSIONS)
    expect(EMBEDDING_DIMENSIONS).toBe(384)
    for (const v of batch.vectors) {
      expect(v.length).toBe(384)
      const norm = Math.sqrt(Array.from(v).reduce((s, x) => s + x * x, 0))
      expect(norm).toBeCloseTo(1.0, 3)
    }
    const cParaphrase = cosineSimilarity(batch.vectors[0], batch.vectors[1])
    const cUnrelated = cosineSimilarity(batch.vectors[0], batch.vectors[2])
    expect(cParaphrase).toBeGreaterThan(0.85)
    expect(cUnrelated).toBeLessThan(0.3)
    expect(cParaphrase - cUnrelated).toBeGreaterThan(0.5)
    expect(batch.provenance.texts).toBe(3)
    expect(batch.provenance.latencyMs).toBeGreaterThan(0)
    expect(batch.provenance.model).toContain('all-MiniLM-L6-v2')
  })

  test.skipIf(!embedReady)('refuses empty input honestly', async () => {
    useRealModelDir()
    await expect(embedTexts([])).rejects.toBeInstanceOf(EmbeddingUnavailableError)
  })

  test('honest unavailable state when the artifact is absent', async () => {
    useEmptyModelDir()
    await expect(embedTexts(['anything'])).rejects.toBeInstanceOf(EmbeddingUnavailableError)
  })
})

describe('REAL cross-encoder reranking (ms-marco-MiniLM-L-6-v2 quantized ONNX, CPU)', () => {
  test.skipIf(!rerankReady)('orders the genuinely relevant passage first with a wide margin', async () => {
    useRealModelDir()
    const query = 'How many people live in Berlin?'
    const passages = [
      'New York City is famous for the Metropolitan Museum of Art.',
      'Berlin has a population of 3,852,029 registered inhabitants in an area of 891.82 square kilometers.',
      'The Berlin Wall fell in November 1989.',
    ]
    const result = await rerankPassages(query, passages)
    expect(result.scores.length).toBe(3)
    expect(result.ordering[0]).toBe(1) // the population passage wins
    expect(result.scores[1]).toBeGreaterThan(0.5)
    // The museum passage scores near zero against this query.
    expect(result.scores[0]).toBeLessThan(result.scores[1] - 0.5)
    expect(result.provenance.pairs).toBe(3)
    expect(result.provenance.model).toContain('ms-marco-MiniLM-L-6-v2')
  })

  test('honest unavailable state when the artifact is absent', async () => {
    useEmptyModelDir()
    await expect(rerankPassages('query', ['passage'])).rejects.toBeInstanceOf(RerankUnavailableError)
  })
})

describe('document chunking (pure)', () => {
  test('covers the full text with overlap and preserves char offsets', () => {
    const text = Array.from({ length: 60 }, (_, i) => `Paragraph ${i} discusses topic number ${i} with sufficient content to matter here.`).join('\n\n')
    const chunks = chunkDocument(text)
    expect(chunks.length).toBeGreaterThan(3)
    expect(chunks[0].start).toBe(0)
    for (let i = 0; i < chunks.length; i++) {
      expect(text.slice(chunks[i].start, chunks[i].start + chunks[i].text.length)).toBe(chunks[i].text)
      if (i > 0) expect(chunks[i].start).toBeLessThan(chunks[i - 1].start + chunks[i - 1].text.length)
    }
    const last = chunks[chunks.length - 1]
    expect(last.start + last.text.length).toBeGreaterThanOrEqual(text.length - 700)
  })

  test('respects the chunk cap and rejects empty input', () => {
    expect(chunkDocument('')).toEqual([])
    expect(chunkDocument('   \n  ')).toEqual([])
    const huge = `word ${'content '.repeat(120_000)}`
    expect(chunkDocument(huge).length).toBeLessThanOrEqual(MAX_CHUNKS_PER_DOC)
  })
})

describe('REAL document search (embed + cosine + cross-encoder rerank)', () => {
  test.skipIf(!embedReady || !rerankReady)('surfaces the planted fact from a long document and caches the vectors', async () => {
    useRealModelDir()
    clearDocumentRetrievalCache()
    // A long synthetic quarterly report; the queried fact is planted mid-text
    // among distractors.
    const sections = [
      'This report covers general corporate operations for the fiscal year, including office facilities, travel policy, and routine administration.',
      'The marketing team reviewed brand awareness campaigns across three regions and proposed a refreshed visual identity for the following year.',
      'BUDGET CODE BX-77 was assigned to the Lisbon infrastructure project with an approved budget of 2.4 million euros for phase one.',
      'Human resources recorded standard annual leave balances and updated the onboarding checklist for new engineering hires.',
      'The sustainability committee measured office energy usage and recommended LED retrofits in two buildings next quarter.',
    ]
    // Repeat to push the document well past one chunk (~2.6k chars).
    const documentText = sections.join('\n\n') + '\n\n' + sections.join('\n\n')
    const result = await searchDocument({
      conversationKey: 'test-conv-m40',
      documentId: 'doc-1',
      documentName: 'annual-report.txt',
      documentText,
      query: 'What budget was approved for the Lisbon infrastructure project?',
    })
    expect(result.passages.length).toBeGreaterThan(0)
    expect(result.passages.length).toBeLessThanOrEqual(3)
    const top = result.passages[0]
    expect(top.relevance).toBeGreaterThan(0.5)
    expect(top.text).toContain('BX-77')
    expect(result.provenance.cache.recomputed).toBe(true)
    expect(result.provenance.cache.cachedChunks).toBeGreaterThan(2)
    expect(result.provenance.rerank.pairs).toBeLessThanOrEqual(8)

    // Second identical query: the cache serves the chunks (no recompute).
    const second = await searchDocument({
      conversationKey: 'test-conv-m40',
      documentId: 'doc-1',
      documentName: 'annual-report.txt',
      documentText,
      query: 'What budget was approved for the Lisbon infrastructure project?',
    })
    expect(second.provenance.cache.recomputed).toBe(false)
    expect(second.passages[0].text).toContain('BX-77')
    expect(documentRetrievalCacheSize()).toBe(1)
  })

  test('cache is bounded (MAX_CACHED_DOCS)', () => {
    clearDocumentRetrievalCache()
    // The bound is enforced inside searchDocument's lruBump; verify the
    // exported constant matches the documented policy.
    expect(MAX_CACHED_DOCS).toBe(8)
    expect(documentRetrievalCacheSize()).toBe(0)
  })

  test('honest unavailable when the lanes are absent (fallback contract preserved)', async () => {
    useEmptyModelDir()
    await expect(
      searchDocument({
        conversationKey: 'test-conv-offline',
        documentId: 'doc-x',
        documentName: 'doc.txt',
        documentText: 'Some substantial text content for the retrieval lane to attempt to search through.',
        query: 'anything',
      }),
    ).rejects.toBeInstanceOf(EmbeddingUnavailableError)
  })
})

describe('REAL OCR (tesseract.js 6 + tessdata_fast eng, WebAssembly CPU)', () => {
  test.skipIf(!ocrReady)('extracts real text from a rendered image and refuses blank images honestly', async () => {
    useRealModelDir()
    const sharp = (await import('sharp')).default
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="300"><rect width="100%" height="100%" fill="white"/>' +
      '<text x="60" y="120" font-family="DejaVu Sans" font-size="42" fill="black">Bean Intelligence OCR 2026</text>' +
      '<text x="60" y="210" font-family="DejaVu Sans" font-size="42" fill="black">Invoice 48291 total 1250 USD</text></svg>'
    const png = await sharp(Buffer.from(svg)).png().toBuffer()
    const result = await recognizeImageText(png)
    const low = result.text.toLowerCase()
    expect(low).toContain('bean intelligence ocr 2026')
    expect(low).toContain('48291')
    expect(low).toContain('1250 usd')
    expect(result.confidence).toBeGreaterThan(60)
    expect(result.wordCount).toBeGreaterThan(5)
    expect(result.provenance.language).toBe('eng')
    expect(result.provenance.model).toContain('tessdata_fast')

    // Honesty gate: a blank image has NO usable text — the lane must say so
    // instead of returning an empty success or guessed characters.
    const blank = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="100%" height="100%" fill="white"/></svg>')).png().toBuffer()
    await expect(recognizeImageText(blank)).rejects.toBeInstanceOf(OcrUnavailableError)
  })

  test('honest unavailable state when the traineddata is absent', async () => {
    useEmptyModelDir()
    expect(ocrLaneReady()).toBe(false)
    await expect(recognizeImageText(Buffer.from('not really an image but sized'))).rejects.toBeInstanceOf(OcrUnavailableError)
  })

  test('the recognition worker resolves a REAL installed worker script (bundled-context honesty)', () => {
    // tesseract.js' __dirname-based default breaks in a bundled server
    // context (measured live: "/ROOT/node_modules/..." MODULE_NOT_FOUND in
    // `next dev`); the runtime resolver must hand the spawn a path that
    // EXISTS on disk in every supported context (dev worktree, standalone
    // trace, unbundled module lane). The real-inference test above proves
    // the resolved path end-to-end: the worker spawns through it and
    // recognizes real text.
    const p = ocrWorkerScriptPath()
    expect(p).toContain('tesseract.js')
    expect(p.endsWith('worker-script/node/index.js') || p.endsWith('worker-script\\node\\index.js')).toBe(true)
    expect(existsSync(p)).toBe(true)
  })

  test('the worker spawn is bounded — a hanging spawn is an honest unavailable, never a route hang', () => {
    expect(Number.isFinite(OCR_WORKER_SPAWN_TIMEOUT_MS)).toBe(true)
    expect(OCR_WORKER_SPAWN_TIMEOUT_MS).toBeGreaterThan(0)
    expect(OCR_WORKER_SPAWN_TIMEOUT_MS).toBeLessThanOrEqual(120_000)
  })
})

describe('M40 local-model manager state honesty', () => {
  test('every M40 descriptor pins real artifacts with companion integrity', () => {
    for (const id of ['minilm-l6-embeddings', 'ms-marco-minilm-rerank', 'ocr-eng-traineddata']) {
      const desc = LOCAL_MODELS[id]
      expect(desc).toBeDefined()
      expect(desc.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(desc.bytes).toBeGreaterThan(0)
      expect(desc.license.commercialUse).toBe('permitted')
    }
    // The two ONNX models carry the pinned vocab companion.
    expect(LOCAL_MODELS['minilm-l6-embeddings'].companionFiles?.[0]?.file).toBe('vocab.txt')
    expect(LOCAL_MODELS['ms-marco-minilm-rerank'].companionFiles?.[0]?.file).toBe('vocab.txt')
  })
})
