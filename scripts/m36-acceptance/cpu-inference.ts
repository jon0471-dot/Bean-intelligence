/**
 * M36-B — REAL LOCAL CPU MODEL EXECUTION ACCEPTANCE.
 *
 * Runs the EXACT pinned MODNet artifact from the client-compute model
 * registry through onnxruntime-node's CPU execution provider on THIS host:
 *  1. verifies the artifact bytes against the pinned SHA-256 (refuses on
 *     mismatch — the same integrity gate the browser download path enforces);
 *  2. applies the SAME preprocessing the segmentation worker applies
 *     (shortest edge 512, /32, rescale 1/255, mean/std 0.5);
 *  3. executes REAL CPU inference and validates the matte output (shape,
 *     value range) — actual model output, never a mock.
 *
 * This is the server-side CPU evidence for brief §13 ("a CPU/WASM-supported
 * workload executes"). Browser WebGPU execution requires WebGPU hardware and
 * is recorded as an environmental blocker in the milestone report.
 *
 * Run: bun scripts/m36-acceptance/cpu-inference.ts
 * The artifact (6.6 MB) is downloaded once into this directory (gitignored).
 */

import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'

const ARTIFACT = new URL('./modnet_quantized.onnx', import.meta.url).pathname
const PINNED_SHA256 = '92e49898c3e05a6d7a944fc67a8cb87c4aad754ffb6ebd949528c7d1105fee3a'
const EXPECTED_BYTES = 6_632_188

async function ensureArtifact(): Promise<void> {
  if (existsSync(ARTIFACT)) return
  const url =
    'https://huggingface.co/Xenova/modnet/resolve/fa2fa546052fba4c08921230a26cc69a333fca12/onnx/model_quantized.onnx'
  console.log(`[m36] downloading pinned artifact from ${url}`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`artifact download failed: HTTP ${res.status}`)
  const bytes = Buffer.from(await res.arrayBuffer())
  const { writeFileSync } = await import('node:fs')
  writeFileSync(ARTIFACT, bytes)
}

function sha256File(path: string): { hex: string; bytes: number } {
  const { readFileSync } = require('node:fs') as typeof import('node:fs')
  const buf = readFileSync(path)
  return { hex: createHash('sha256').update(buf).digest('hex'), bytes: buf.length }
}

/** Same preprocessing as src/workers/segmentation-worker.ts (pinned config). */
function preprocessSynthetic(width: number, height: number): { input: Float32Array; dims: [number, number, number, number] } {
  const scale = 512 / Math.min(width, height)
  const w = Math.max(32, Math.floor((width * scale) / 32) * 32)
  const h = Math.max(32, Math.floor((height * scale) / 32) * 32)
  const data = new Float32Array(1 * 3 * h * w)
  const rescale = 0.00392156862745098 // 1/255
  let o = 0
  // Synthetic image: a gradient frame with a bright center (deterministic).
  for (let c = 0; c < 3; c++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const cx = Math.abs(x - w / 2) < w / 6 && Math.abs(y - h / 2) < h / 6
        const rgb = cx ? 240 : (x * 7 + y * 3) % 256
        data[o++] = (rgb * rescale - 0.5) / 0.5
      }
    }
  }
  return { input: data, dims: [1, 3, h, w] }
}

async function main(): Promise<void> {
  console.log('=== M36-B REAL CPU MODEL EXECUTION ACCEPTANCE ===')
  await ensureArtifact()

  // 1. Integrity gate — the pinned checksum is mandatory (fail-closed).
  const { hex, bytes } = sha256File(ARTIFACT)
  console.log(`[m36] artifact: ${bytes.toLocaleString()} bytes, sha256=${hex.slice(0, 16)}…`)
  if (hex !== PINNED_SHA256) {
    throw new Error(`INTEGRITY FAILURE: sha256 mismatch — refusing to run unverified weights`)
  }
  if (bytes !== EXPECTED_BYTES) {
    throw new Error(`INTEGRITY FAILURE: byte count ${bytes} ≠ pinned ${EXPECTED_BYTES}`)
  }
  console.log('[m36] integrity verified: byte count + SHA-256 match the pinned values exactly')

  // 2. Real session load through onnxruntime-node (CPU execution provider).
  const ort = await import('onnxruntime-node')
  const session = await ort.InferenceSession.create(ARTIFACT, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
  })
  console.log(`[m36] session loaded (cpu EP); inputs: ${session.inputNames.join(', ')}; outputs: ${session.outputNames.join(', ')}`)

  // 3. Real inference on the preprocessed input.
  const { input, dims } = preprocessSynthetic(640, 480)
  const tensor = new ort.Tensor('float32', input, dims)
  const t0 = Date.now()
  const feeds: Record<string, ort.Tensor> = { [session.inputNames[0]]: tensor }
  const results = await session.run(feeds)
  const durationMs = Date.now() - t0
  const outputName = session.outputNames[0]
  const output = results[outputName]
  const matte = output.data as Float32Array
  const [_, __, outH, outW] = output.dims as number[]

  // 4. Validate the ACTUAL output (a real segmentation matte).
  let min = 1
  let max = 0
  let inRange = 0
  for (let i = 0; i < matte.length; i++) {
    const v = matte[i]
    if (v < min) min = v
    if (v > max) max = v
    if (v >= 0 && v <= 1) inRange++
  }
  const rangeOk = inRange === matte.length
  const shapeOk = outH === dims[2] && outW === dims[3]
  const foregroundPresent = max > 0.5 // the bright center block should produce foreground

  console.log(`[m36] inference wall time: ${durationMs}ms`)
  console.log(`[m36] input dims: ${dims.join('x')} (${input.length.toLocaleString()} floats)`)
  console.log(`[m36] output dims: ${output.dims.join('x')} (${matte.length.toLocaleString()} floats)`)
  console.log(`[m36] matte value range: [${min.toFixed(4)}, ${max.toFixed(4)}]; in-range fraction: ${inRange}/${matte.length}`)
  console.log(`[m36] shape preserved: ${shapeOk}; all values in [0,1]: ${rangeOk}; foreground detected: ${foregroundPresent}`)

  if (!shapeOk) throw new Error('REAL OUTPUT FAILED VALIDATION: matte shape does not match input')
  if (!rangeOk) throw new Error('REAL OUTPUT FAILED VALIDATION: matte values outside [0,1]')
  if (!foregroundPresent) throw new Error('REAL OUTPUT FAILED VALIDATION: no foreground in the synthetic center block')

  console.log('=== M36-B ACCEPTANCE: REAL CPU INFERENCE PASSED (actual model output validated) ===')
  console.log(JSON.stringify({
    acceptance: 'm36-b-cpu-inference',
    artifactBytes: bytes,
    sha256: hex,
    executionProvider: 'cpu (onnxruntime-node)',
    inputDims: dims,
    outputDims: Array.from(output.dims),
    durationMs,
    matteMin: Number(min.toFixed(4)),
    matteMax: Number(max.toFixed(4)),
    shapeOk,
    rangeOk,
    foregroundDetected: foregroundPresent,
  }, null, 2))
}

main().catch((e) => {
  console.error('[m36] ACCEPTANCE FAILED:', e instanceof Error ? e.message : e)
  process.exit(1)
})
