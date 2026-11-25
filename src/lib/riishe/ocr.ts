/**
 * BEAN Intelligence — RIISHE REAL OCR lane (M40, SERVER ONLY).
 *
 * Genuine optical character recognition on image bytes using tesseract.js 6
 * (WebAssembly CPU) with the SHA-256-pinned `eng.traineddata` language data
 * served from the EXISTING local-model manager — the traineddata never comes
 * from a CDN at recognition time and the model is never claimed installed
 * when it is not.
 *
 * Honesty rules:
 *  - an uninstalled/corrupted traineddata artifact is an HONEST unavailable
 *    state (`OcrUnavailableError`) — no recognition is attempted without the
 *    pinned language data;
 *  - every result carries measured confidence + word count + latency; a run
 *    that finds no usable text returns that fact instead of an empty success;
 *  - language limitation is REAL and stated: English tessdata_fast only.
 *    Non-Latin scripts are reported as not-recognized, never guessed.
 *
 * The tesseract.js WebAssembly core ships via the npm lockfile (recorded
 * boundary note, same policy as the Kokoro voice packs — models/manifests).
 */
import { createWorker, type Worker } from 'tesseract.js'
import path from 'node:path'
import { localModelState, localModelArtifactPath } from '@/lib/media/local-models'

export const OCR_MODEL_ID = 'ocr-eng-traineddata'
export const OCR_MIN_CONFIDENCE = 40 // below this the text is refused, not guessed
const OCR_TIMEOUT_MS = Number(process.env.BEAN_OCR_TIMEOUT_MS ?? 60_000)
const OCR_MAX_BYTES = 20 * 1024 * 1024

export class OcrUnavailableError extends Error {}

export interface OcrResult {
  text: string
  confidence: number
  wordCount: number
  provenance: {
    model: 'tesseract 5.3.x eng (tessdata_fast, bean-pinned sha256)'
    runtime: 'tesseract.js 6 WebAssembly CPU'
    language: 'eng'
    latencyMs: number
  }
}

let cachedWorker: Worker | null = null

function requireReady(): string {
  const state = localModelState(OCR_MODEL_ID)
  if (state.state !== 'ready') {
    throw new OcrUnavailableError(
      `OCR is unavailable on this host: the pinned English language data is ${state.state === 'not-installed' ? 'not installed' : `not usable (${state.error ?? state.state})`}.`,
    )
  }
  // tesseract.js langPath is a DIRECTORY (it appends '<lang>.traineddata'
  // itself) — hand it the pinned artifact's parent directory.
  return path.dirname(localModelArtifactPath(OCR_MODEL_ID, 'eng.traineddata'))
}

/** True when the lane can execute right now (no worker spawn). */
export function ocrLaneReady(): boolean {
  return localModelState(OCR_MODEL_ID).state === 'ready'
}

/** Release the cached worker (idle/memory-pressure hook — mirror of getSession's reaper). */
export async function releaseOcrWorker(): Promise<void> {
  const w = cachedWorker
  cachedWorker = null
  if (w) {
    await w.terminate().catch(() => undefined)
  }
}

async function getWorker(langPath: string): Promise<Worker> {
  if (cachedWorker) return cachedWorker
  // OEM 1 = LSTM_ONLY (the tessdata_fast engine); gzip:false because the
  // pinned artifact is stored uncompressed and verified by hash.
  cachedWorker = await createWorker('eng', 1, { langPath, gzip: false, cacheMethod: 'none' as never })
  return cachedWorker
}

/** Genuine OCR over image bytes (CPU WebAssembly inference, measured). */
export async function recognizeImageText(imageBytes: Buffer): Promise<OcrResult> {
  const langPath = requireReady()
  if (imageBytes.length === 0) throw new OcrUnavailableError('OCR received empty image bytes')
  if (imageBytes.length > OCR_MAX_BYTES) {
    throw new OcrUnavailableError(`OCR input is too large (${imageBytes.length} bytes; the lane accepts up to ${OCR_MAX_BYTES}).`)
  }
  const t0 = Date.now()
  const worker = await getWorker(langPath)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new OcrUnavailableError(`OCR did not finish within ${OCR_TIMEOUT_MS}ms`)), OCR_TIMEOUT_MS)
  })
  let result: Awaited<ReturnType<Worker['recognize']>>
  try {
    result = await Promise.race([worker.recognize(imageBytes), timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
  const rawText = (result.data.text ?? '').replace(/\n{3,}/g, '\n\n').trim()
  const confidence = typeof result.data.confidence === 'number' ? result.data.confidence : 0
  const wordCount = rawText.split(/\s+/).filter(Boolean).length

  // Output validation: below the measured-confidence floor or with no words,
  // the lane reports an honest NO-USABLE-TEXT outcome (never an empty success,
  // never guessed characters).
  if (wordCount === 0) {
    throw new OcrUnavailableError('OCR completed and found no usable text in the image (no characters recognized).')
  }
  if (confidence < OCR_MIN_CONFIDENCE) {
    throw new OcrUnavailableError(
      `OCR completed but the measured recognition confidence (${confidence.toFixed(1)}) is below the ${OCR_MIN_CONFIDENCE} floor — the text is not reliable enough to report.`,
    )
  }

  return {
    text: rawText,
    confidence,
    wordCount,
    provenance: {
      model: 'tesseract 5.3.x eng (tessdata_fast, bean-pinned sha256)',
      runtime: 'tesseract.js 6 WebAssembly CPU',
      language: 'eng',
      latencyMs: Date.now() - t0,
    },
  }
}
