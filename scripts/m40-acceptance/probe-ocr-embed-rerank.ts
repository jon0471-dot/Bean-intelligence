/**
 * M40 probe — REAL CPU inference for the three capability lanes BEFORE any
 * production service is written (measure first, then pin):
 *   1. OCR: tesseract.js 6 + tessdata_fast eng (local traineddata, no CDN)
 *      reading a text image rendered deterministically with sharp.
 *   2. Embeddings: all-MiniLM-L6-v2 quantized ONNX (onnxruntime-node, CPU EP)
 *      + hand-rolled BERT WordPiece tokenizer -> 384-dim L2-normalized vectors,
 *      cosine sanity (paraphrase pair vs unrelated pair).
 *   3. Reranking: ms-marco-MiniLM-L-6-v2 quantized cross-encoder ONNX ->
 *      relevance scores, relevant passage must outrank irrelevant one.
 *
 * Every artifact lives in /tmp/m40-models for the probe; the production
 * descriptors pin these exact bytes (sha256 recorded from this download).
 */
import fs from 'node:fs'
import path from 'node:path'
import * as ort from 'onnxruntime-node'
import sharp from 'sharp'
import { createWorker } from 'tesseract.js'

const DIR = '/tmp/m40-models'

// ---- BERT basic tokenizer ---------------------------------------------------

function basicTokenize(text: string): string[] {
  const lower = text.toLowerCase()
  const out: string[] = []
  let buf = ''
  for (const ch of lower) {
    const code = ch.codePointAt(0)!
    const isPunct =
      (code >= 33 && code <= 47) || (code >= 58 && code <= 64) || (code >= 91 && code <= 96) || (code >= 123 && code <= 126)
    const isCJK = code >= 0x4e00 && code <= 0x9fff
    if (isCJK) {
      if (buf) out.push(buf)
      buf = ''
      out.push(ch)
    } else if (isPunct || /\s/.test(ch)) {
      if (buf) out.push(buf)
      buf = ''
      if (isPunct) out.push(ch)
    } else {
      buf += ch
    }
  }
  if (buf) out.push(buf)
  return out
}

class WordPiece {
  vocab: Map<string, number>
  constructor(vocabText: string) {
    this.vocab = new Map()
    vocabText.split('\n').forEach((line, i) => {
      const t = line.replace(/\r$/, '')
      if (t.length > 0 || i === 0) this.vocab.set(t, i)
    })
  }
  id(token: string): number {
    return this.vocab.get(token) ?? 100 /* [UNK] */
  }
  tokenizeWord(word: string): string[] {
    if (word.length > 100) return ['[UNK]']
    const pieces: string[] = []
    let start = 0
    while (start < word.length) {
      let end = word.length
      let found: string | null = null
      while (start < end) {
        const candidate = (start > 0 ? '##' : '') + word.slice(start, end)
        if (this.vocab.has(candidate)) {
          found = candidate
          break
        }
        end -= 1
      }
      if (found === null) return ['[UNK]']
      pieces.push(found)
      start = end
    }
    return pieces
  }
  encode(text: string, options: { pair?: string; maxLen: number }): { inputIds: number[]; tokenTypeIds: number[]; attentionMask: number[]; tokens: string[] } {
    const buildSegment = (t: string): string[] => {
      const tokens: string[] = []
      for (const w of basicTokenize(t)) tokens.push(...this.tokenizeWord(w))
      return tokens
    }
    const maxLen = options.maxLen
    let a = buildSegment(text)
    let b = options.pair !== undefined ? buildSegment(options.pair) : []
    const specials = options.pair !== undefined ? 3 : 2
    const budget = maxLen - specials
    if (a.length + b.length > budget) {
      // cross-encoder convention: never drop the query below half the budget;
      // truncate the passage tail first, then the query tail, bounded at half.
      const half = Math.floor(budget / 2)
      if (b.length > half) b = b.slice(0, Math.max(half, budget - a.length))
      if (a.length > half) a = a.slice(0, Math.max(half, budget - b.length))
    }
    const tokens = ['[CLS]', ...a, '[SEP]']
    const types: number[] = [0, ...a.map(() => 0), 0]
    if (options.pair !== undefined) {
      tokens.push(...b, '[SEP]')
      types.push(...b.map(() => 1), 1)
    }
    const ids = tokens.map((t) => this.id(t))
    const mask = ids.map(() => 1)
    return { inputIds: ids, tokenTypeIds: types, attentionMask: mask, tokens }
  }
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

function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

async function main() {
  const vocabText = fs.readFileSync(path.join(DIR, 'minilm-vocab.txt'), 'utf8')
  const tok = new WordPiece(vocabText)
  console.log('vocab size:', tok.vocab.size)

  // ---- embeddings ----
  const t0 = Date.now()
  const embSession = await ort.InferenceSession.create(path.join(DIR, 'minilm-model_quantized.onnx'), {
    executionProviders: ['cpu'],
  })
  console.log('embeddings session loaded in', Date.now() - t0, 'ms; inputs:', embSession.inputNames, 'outputs:', embSession.outputNames)

  const embed = async (text: string): Promise<Float32Array> => {
    const { inputIds, tokenTypeIds, attentionMask } = tok.encode(text, { maxLen: 512 })
    const len = inputIds.length
    const results = await embSession.run({
      input_ids: new ort.Tensor('int64', BigInt64Array.from(inputIds.map(BigInt)), [1, len]),
      attention_mask: new ort.Tensor('int64', BigInt64Array.from(attentionMask.map(BigInt)), [1, len]),
      token_type_ids: new ort.Tensor('int64', BigInt64Array.from(tokenTypeIds.map(BigInt)), [1, len]),
    })
    const outName = embSession.outputNames[0]
    const t = results[outName]
    const dims = t.dims // e.g. [1, len, 384]
    return meanPool(t.data as Float32Array, dims[2], dims[1])
  }

  const e1 = await embed('The capital of France is Paris.')
  const e2 = await embed('Paris is the capital city of France.')
  const e3 = await embed('I enjoy playing soccer with my friends on weekends.')
  console.log('embedding dim:', e1.length, '| normalized len:', Math.sqrt(e1.reduce((s, v) => s + v * v, 0)).toFixed(4))
  const cRel = cosine(e1, e2)
  const cUnrel = cosine(e1, e3)
  console.log('cosine(paraphrase):', cRel.toFixed(4), '| cosine(unrelated):', cUnrel.toFixed(4), '| ordering ok:', cRel > cUnrel)

  // ---- reranking ----
  const t1 = Date.now()
  const rrSession = await ort.InferenceSession.create(path.join(DIR, 'msmarco-model_quantized.onnx'), {
    executionProviders: ['cpu'],
  })
  console.log('rerank session loaded in', Date.now() - t1, 'ms; inputs:', rrSession.inputNames, 'outputs:', rrSession.outputNames)

  const score = async (query: string, passage: string): Promise<number> => {
    const { inputIds, tokenTypeIds, attentionMask } = tok.encode(query, { pair: passage, maxLen: 512 })
    const len = inputIds.length
    const results = await rrSession.run({
      input_ids: new ort.Tensor('int64', BigInt64Array.from(inputIds.map(BigInt)), [1, len]),
      attention_mask: new ort.Tensor('int64', BigInt64Array.from(attentionMask.map(BigInt)), [1, len]),
      token_type_ids: new ort.Tensor('int64', BigInt64Array.from(tokenTypeIds.map(BigInt)), [1, len]),
    })
    const t = results[rrSession.outputNames[0]]
    return sigmoid((t.data as Float32Array)[0])
  }

  const query = 'How many people live in Berlin?'
  const sGood = await score(query, 'Berlin has a population of 3,852,029 registered inhabitants in an area of 891.82 square kilometers.')
  const sBad = await score(query, 'New York City is famous for the Metropolitan Museum of Art.')
  console.log('rerank relevant:', sGood.toFixed(4), '| irrelevant:', sBad.toFixed(4), '| ordering ok:', sGood > sBad)

  // ---- OCR ----
  const t2 = Date.now()
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="300"><rect width="100%" height="100%" fill="white"/><text x="60" y="120" font-family="DejaVu Sans" font-size="42" fill="black">Bean Intelligence OCR 2026</text><text x="60" y="210" font-family="DejaVu Sans" font-size="42" fill="black">Invoice 48291 total 1250 USD</text></svg>`
  const png = await sharp(Buffer.from(svg)).png().toBuffer()
  fs.writeFileSync(path.join(DIR, 'ocr-input.png'), png)
  const worker = await createWorker('eng', 1, { langPath: DIR, gzip: false, cacheMethod: 'none' as never })
  const { data } = await worker.recognize(png)
  await worker.terminate()
  const ocrText = (data.text ?? '').trim()
  console.log('OCR loaded+ran in', Date.now() - t2, 'ms; confidence:', data.confidence?.toFixed?.(1))
  console.log('OCR text:', JSON.stringify(ocrText))
  const expect = ['bean intelligence ocr 2026', 'invoice 48291', '1250 usd']
  const low = ocrText.toLowerCase()
  const hits = expect.filter((p) => low.includes(p))
  console.log('OCR planted fragments found:', hits.length, '/', expect.length, hits)

  const allOk =
    e1.length === 384 && cRel > cUnrel + 0.15 && sGood > sBad + 0.2 && hits.length === expect.length
  console.log('PROBE RESULT:', allOk ? 'ALL LANES REAL + CORRECT' : 'LANES NEED WORK')
}

main().catch((e) => {
  console.error('PROBE FAILED:', e)
  process.exit(1)
})
