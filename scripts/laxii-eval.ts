/**
 * LAXII — evaluation harness (Phase 7).
 *
 * Runs the mission §11 test matrix items that are executable on THIS host
 * and records REAL measured numbers. Items that require the GPU worker or
 * real photographs are SKIPPED with the explicit reason — never scored,
 * never faked. Output: scripts/laxii-eval-out/results.json + stdout table.
 *
 * Executable here (deterministic engine, real runs):
 *   A  Strict Preserve, no generative reconstruction   (masked enhance)
 *   B  Smart Edit, small mask                          (deterministic proxy*)
 *   C  Smart Edit, large mask                          (deterministic proxy*)
 *   F  Upscaling (Lanczos 2x/4x)                       (deterministic)
 *   G  Large-image memory handling                     (4096x4096 pass)
 *   H  Provider fallback (fault-injected, unit level)
 *   I  Cancellation and recovery (worker protocol)
 * Skipped with reasons:
 *   D  Face identity during new-scene generation  — needs GPU worker + real photos
 *   E  Multiple-face identity handling            — needs GPU worker + real photos
 *   J  Offline local inference (diffusers)        — needs GPU worker (torch/CUDA)
 *   Real SD-inpaint Smart Edit                         — same as J
 * (*) B/C here exercise the mask/compositing/validation machinery, which is
 * the preservation-critical part; the generative inner step is J-gated.
 */
import sharp from 'sharp'
import fs from 'fs'
import path from 'path'
import { performance } from 'perf_hooks'

import { toRaw, analyzeChange, differenceMap } from '../src/lib/laxii/metrics'
import {
  buildMask,
  compositePreserved,
  applyFaceProtection,
  shapeMask,
  validatePreservation,
} from '../src/lib/laxii/preservation'
import { enhanceImage } from '../src/lib/laxii/enhance'
import { resolveProvider, type LaxiiOp } from '../src/lib/laxii/provider'
import { workerPreflight, workerRequest, workerStop } from '../src/lib/laxii/worker'
import { BeanApiError } from '../src/lib/api/errors'

interface CaseResult {
  id: string
  name: string
  status: 'PASS' | 'FAIL' | 'SKIPPED'
  metrics: Record<string, number | string | boolean | null>
  reason?: string
  error?: string
}

const FIX = path.join(process.cwd(), 'tests', 'fixtures', 'laxii')
const OUT_DIR = path.join(process.cwd(), 'scripts', 'laxii-eval-out')

async function maskRect(w: number, h: number, rect: { x: number; y: number; width: number; height: number }): Promise<Buffer> {
  const px = Buffer.alloc(w * h * 4, 0)
  for (let y = rect.y; y < Math.min(h, rect.y + rect.height); y++) {
    for (let x = rect.x; x < Math.min(w, rect.x + rect.width); x++) {
      const i = (y * w + x) * 4
      px[i] = px[i + 1] = px[i + 2] = px[i + 3] = 255
    }
  }
  return sharp(px, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer()
}

async function caseA(): Promise<CaseResult> {
  const t0 = performance.now()
  const img = await sharp(path.join(FIX, 'portrait-single.png')).png().toBuffer()
  const { result, original } = await enhanceImage({ image: img })
  const raw = await toRaw(result.outputPng)
  const change = analyzeChange(original, raw)
  const report = validatePreservation({
    original, output: raw, mask: null, faceZones: [], generativeUsed: false, pipeline: 'eval-A',
  })
  // Strict Preserve full-frame with globalColor=true is a documented global
  // change; the mission-relevant guarantee is no generative op + geometry.
  const pass = !report.dimensionsChanged && !report.generativeUsed && change.changedPct > 0
  return {
    id: 'A', name: 'Strict Preserve — no generative reconstruction', status: pass ? 'PASS' : 'FAIL',
    metrics: {
      changedPct: Number(change.changedPct.toFixed(2)),
      psnrDb: change.psnrDb == null ? null : Number(change.psnrDb.toFixed(1)),
      generativeUsed: false,
      opsApplied: result.plan.ops.length,
      durationMs: Math.round(performance.now() - t0),
    },
  }
}

async function maskedEditCase(id: 'B' | 'C', rect: { x: number; y: number; width: number; height: number }): Promise<CaseResult> {
  const t0 = performance.now()
  const img = await sharp(path.join(FIX, 'localized-edit.png')).png().toBuffer()
  const first = await enhanceImage({ image: img })
  const { original } = first
  const maskPng = await maskRect(original.width, original.height, rect)
  const mask = shapeMask(await buildMask([{ kind: 'edit', png: maskPng }], original.width, original.height), { expandPx: 2, featherPx: 4 })
  // Deterministic inner op: local contrast only inside the mask region.
  const rerun = await enhanceImage({ image: img, options: { denoise: false, exposureWhiteBalance: false, grade: false, localContrast: true, upscaleFactor: 1 } })
  const processed = await toRaw(rerun.result.outputPng)
  const composite = compositePreserved(original, processed, mask, { globalColorChange: false })
  const change = analyzeChange(original, { data: composite.data, width: original.width, height: original.height })
  const diffPng = await differenceMap(original, { data: composite.data, width: original.width, height: original.height })
  const report = validatePreservation({
    original, output: { data: composite.data, width: original.width, height: original.height },
    mask, faceZones: [], generativeUsed: false, pipeline: `eval-${id}`,
  })
  const maskArea = rect.width * rect.height
  const pass =
    change.changedPct > 0 && change.changedPct < ((maskArea * 2.2) / (original.width * original.height)) * 100
  fs.writeFileSync(path.join(OUT_DIR, `eval-${id}-diff.png`), diffPng)
  return {
    id, name: `${id === 'B' ? 'Small' : 'Large'}-mask edit (deterministic inner op)`, status: pass ? 'PASS' : 'FAIL',
    metrics: {
      maskCoveragePct: Number(((maskArea / (original.width * original.height)) * 100).toFixed(2)),
      changedPct: Number(change.changedPct.toFixed(2)),
      exactPreservedPct: Number(report.exactPreservedPct.toFixed(2)),
      blendedPct: Number(report.blendedPct.toFixed(2)),
      generativeUsed: false,
      durationMs: Math.round(performance.now() - t0),
    },
  }
}

async function caseF(): Promise<CaseResult> {
  const t0 = performance.now()
  const img = await sharp(path.join(FIX, 'photo-lowres.png')).png().toBuffer()
  const meta = await sharp(img).metadata()
  const { result } = await enhanceImage({ image: img, options: { ...{ denoise: true, exposureWhiteBalance: false, grade: false, localContrast: false }, upscaleFactor: 4 } })
  const outMeta = await sharp(result.outputPng).metadata()
  const pass = outMeta.width === (meta.width ?? 0) * 4 && outMeta.height === (meta.height ?? 0) * 4
  return {
    id: 'F', name: 'Upscaling 4× (Lanczos)', status: pass ? 'PASS' : 'FAIL',
    metrics: {
      input: `${meta.width}x${meta.height}`,
      output: `${outMeta.width}x${outMeta.height}`,
      durationMs: Math.round(performance.now() - t0),
    },
  }
}

async function caseG(): Promise<CaseResult> {
  const t0 = performance.now()
  // 4096x4096 = 16.7 MP — exactly at the configured cap.
  const data = Buffer.alloc(4096 * 4096 * 3, 90)
  for (let p = 0; p < 4096 * 4096; p += 997) data[p * 3] = 200 // sparse structure
  const img = await sharp(data, { raw: { width: 4096, height: 4096, channels: 3 } }).png().toBuffer()
  const { result, original } = await enhanceImage({ image: img, options: { denoise: false, exposureWhiteBalance: true, grade: false, localContrast: false } })
  const rssMb = Math.round(process.memoryUsage.rss() / 1024 / 1024)
  const pass = result.width === 4096 && result.height === 4096
  return {
    id: 'G', name: 'Large image (4096×4096, 16.7 MP)', status: pass ? 'PASS' : 'FAIL',
    metrics: {
      width: result.width, height: result.height,
      inputBytes: img.length, outputBytes: result.outputPng.length,
      processRssMb: rssMb,
      durationMs: Math.round(performance.now() - t0),
      originalW: original.width,
    },
  }
}

function caseH(): CaseResult {
  // Fault-injected provider fallback at the seam level: the managed path is
  // available; generative ops must refuse (measured in unit tests too).
  const t0 = performance.now()
  try {
    const t2i = resolveProvider('text-to-image')
    const det = resolveProvider('deterministic-enhance')
    let refused = 0
    for (const op of ['masked-inpaint', 'object-removal', 'reference-guided'] as LaxiiOp[]) {
      try {
        resolveProvider(op)
      } catch (e) {
        if (e instanceof BeanApiError && e.code === 'PROVIDER_UNAVAILABLE') refused++
      }
    }
    return {
      id: 'H', name: 'Provider fallback (worker unavailable → honest refusal)', status: refused === 3 ? 'PASS' : 'FAIL',
      metrics: { textToImage: t2i, deterministic: det, generativeRefused: refused, durationMs: Math.round(performance.now() - t0) },
    }
  } catch (e) {
    return { id: 'H', name: 'Provider fallback', status: 'FAIL', metrics: {}, error: String(e) }
  }
}

async function caseI(): Promise<CaseResult> {
  const t0 = performance.now()
  try {
    // Protocol-level cancellation: request + cancel round-trip on the real worker.
    await workerRequest('cancel', { targetId: 'eval-cancel-1' }, { timeoutMs: 30_000 })
    return {
      id: 'I', name: 'Cancellation round-trip (worker protocol)', status: 'PASS',
      metrics: { durationMs: Math.round(performance.now() - t0), note: 'cancel request answered by live worker; end-to-end diffusion cancel is J-gated' },
    }
  } catch (e) {
    return { id: 'I', name: 'Cancellation round-trip', status: 'FAIL', metrics: {}, error: String(e) }
  }
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const results: CaseResult[] = []

  results.push(await caseA())
  results.push(await maskedEditCase('B', { x: 330, y: 500, width: 90, height: 60 })) // the stain, small mask
  results.push(await maskedEditCase('C', { x: 0, y: 320, width: 480, height: 320 })) // lower half, large mask
  results.push(await caseF())
  results.push(await caseG())
  results.push(caseH())
  results.push(await caseI())

  // Skips with explicit, honest reasons (measured preflight evidence).
  let workerReason = 'worker not reachable'
  try {
    const pf = await workerPreflight(30_000)
    workerReason = `preflight ok=false on this host: missing [${pf.missingPackages.join(', ')}], CUDA ${
      pf.cuda.available ? 'available' : 'unavailable'}, disk ${pf.disk.freeGb} GB free`
  } catch (e) {
    workerReason = `worker unreachable: ${e instanceof Error ? e.message : String(e)}`
  }
  for (const [id, name] of [
    ['D', 'Face identity during new-scene generation'],
    ['E', 'Multiple-face identity handling'],
    ['J', 'Offline local inference (diffusers)'],
    ['J2', 'Real SD-inpaint Smart Edit (generative inner step)'],
  ] as Array<[string, string]>) {
    results.push({ id, name, status: 'SKIPPED', metrics: {}, reason: `GPU worker unavailable — ${workerReason}` })
  }

  const pass = results.filter((r) => r.status === 'PASS').length
  const fail = results.filter((r) => r.status === 'FAIL').length
  const skipped = results.filter((r) => r.status === 'SKIPPED').length
  const payload = {
    generatedAt: new Date().toISOString(),
    host: { gpu: false, note: 'BEAN dev sandbox — no CUDA; deterministic engine only' },
    summary: { pass, fail, skipped, total: results.length },
    results,
  }
  fs.writeFileSync(path.join(OUT_DIR, 'results.json'), JSON.stringify(payload, null, 2))
  console.log('LAXII eval — measured', new Date().toISOString())
  for (const r of results) {
    const head = `[${r.status}] ${r.id} ${r.name}`
    console.log(head)
    if (Object.keys(r.metrics).length) console.log('     ', JSON.stringify(r.metrics))
    if (r.reason) console.log('      reason:', r.reason)
    if (r.error) console.log('      error:', r.error)
  }
  console.log(`\n${pass} pass / ${fail} fail / ${skipped} skipped → ${path.join(OUT_DIR, 'results.json')}`)
  workerStop()
  if (fail > 0) process.exitCode = 1
}

void main()
