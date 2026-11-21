/**
 * Browser harness entry — bundles the REAL client-compute engine for
 * in-Chromium verification. This is the actual production engine code
 * (same modules the app imports), exercised in a real browser: real
 * capability probes, real Web Workers via the default blob-URL factory,
 * real canvas decode/encode, real localStorage consent, real Cache API.
 *
 * Results are written to window.__RESULTS and rendered into #results.
 */
import { getClientCompute } from '../../../src/lib/client-compute/index'
import { scheduleImagePreprocess, scheduleChromaCutout } from '../../../src/lib/client-compute/adapters/laxii'
import { scheduleCodeAnalysis } from '../../../src/lib/client-compute/adapters/code-giftz'
import { scheduleReferenceCheck } from '../../../src/lib/client-compute/adapters/jazmii'

async function main(): Promise<void> {
  const results: Record<string, unknown> = { startedAt: new Date().toISOString(), checks: [] }
  const push = (name: string, data: unknown) => {
    results.checks.push({ name, ...(data as object) })
    ;(document.getElementById('results') as HTMLElement).textContent = JSON.stringify(results, null, 1)
  }

  const cc = getClientCompute()
  await cc.init()
  const snapshot = cc.getSnapshot()
  const profile = cc.getProfile()
  push('capability-detection', {
    environment: snapshot?.environment,
    secureContext: snapshot?.secureContext,
    webgpu: snapshot?.webgpu,
    webgl: { webgl2: snapshot?.webgl.webgl2, webgl1: snapshot?.webgl.webgl1, maxTextureSize: snapshot?.webgl.maxTextureSize },
    wasm: snapshot?.wasm,
    workers: snapshot?.workers,
    offscreenCanvas: snapshot?.offscreenCanvas,
    sharedArrayBuffer: snapshot?.sharedArrayBuffer,
    hardwareConcurrency: snapshot?.hardwareConcurrency,
    deviceMemoryGb: snapshot?.deviceMemoryGb,
    storage: snapshot?.storage,
    browserFamily: snapshot?.browser.family,
    tier: profile?.tier,
    tierReasons: profile?.tierReasons,
    conservative: profile?.conservative,
  })

  // Status surface
  const status = await cc.getStatus()
  push('compute-status', { tierLabel: status.tierLabel, usableTargets: status.usableTargets, adapters: status.adapters })

  // Consent gate: WITHOUT consent, a device task must be refused honestly.
  cc.consent.revoke()
  const refused = await scheduleCodeAnalysis(cc, { files: [{ path: 'a.ts', content: 'const a = 1' }] })
  push('no-consent-refusal', { phase: refused.phase, reason: refused.reason })

  // Grant consent (real user action simulated), then run the real worker lane.
  cc.consent.set(true, false)

  // 1) CODE GIFTZ analysis — REAL blob worker execution (code never leaves the page).
  const analysis = await scheduleCodeAnalysis(cc, {
    files: [
      { path: 'app.ts', content: 'import { helper } from "./helper"\nexport const broken = ((1 + 2)' },
      { path: 'helper.ts', content: 'export const helper = 1' },
      { path: 'ghost.ts', content: "import { x } from './does-not-exist'" },
    ],
  })
  push('code-analysis', {
    phase: analysis.phase,
    target: analysis.target,
    state: analysis.state,
    validated: analysis.outputValidated,
    issues: analysis.output?.issues.map((i) => `${i.kind}@${i.path}:${i.line ?? '-'}`),
    durationMs: analysis.durationMs,
  })

  // 2) LAXII preprocess — real canvas decode + REAL worker resize + real JPEG encode.
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = 480
  const ctx = canvas.getContext('2d')!
  const grad = ctx.createLinearGradient(0, 0, 640, 480)
  grad.addColorStop(0, '#d4af37')
  grad.addColorStop(1, '#111')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 640, 480)
  const sourceBlob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b as Blob), 'image/png'))
  const preprocess = await scheduleImagePreprocess(cc, { blob: sourceBlob, maxWidth: 320, maxHeight: 240, quality: 0.9 })
  push('laxii-preprocess', {
    phase: preprocess.phase,
    target: preprocess.target,
    state: preprocess.state,
    validated: preprocess.outputValidated,
    originalBytes: preprocess.output?.originalBytes,
    outputBytes: preprocess.output?.bytes,
    width: preprocess.output?.width,
    height: preprocess.output?.height,
    scaleApplied: preprocess.output?.scaleApplied,
    durationMs: preprocess.durationMs,
  })

  // 3) LAXII chroma cutout — the deterministic port, on a green-screen image.
  const cc2 = document.createElement('canvas')
  cc2.width = 160
  cc2.height = 120
  const cctx = cc2.getContext('2d')!
  cctx.fillStyle = '#1ec81e'
  cctx.fillRect(0, 0, 160, 120)
  cctx.fillStyle = '#c82e1e'
  cctx.fillRect(40, 30, 80, 60)
  const greenBlob = await new Promise<Blob>((resolve) => cc2.toBlob((b) => resolve(b as Blob), 'image/png'))
  const cutout = await scheduleChromaCutout(cc, { blob: greenBlob })
  push('laxii-chroma-cutout', {
    phase: cutout.phase,
    state: cutout.state,
    validated: cutout.outputValidated,
    transparentFraction: cutout.output?.transparentFraction,
    keyHue: cutout.output?.keyHue,
    keySamples: cutout.output?.keySamples,
    durationMs: cutout.durationMs,
  })

  // 4) JAZMII reference pre-check — the 160x120 image must FAIL bounds honestly.
  const refCheck = await scheduleReferenceCheck(cc, { blob: greenBlob })
  push('jazmii-reference-check', { phase: refCheck.phase, state: refCheck.state, ok: refCheck.output?.ok, reason: refCheck.output?.reason, width: refCheck.output?.width, height: refCheck.output?.height })

  // 5) Segmentation — model-gated honesty in a real browser (no runtime installed).
  const seg = await cc.scheduler.runTask({ productId: 'laxii', kind: 'image.segmentation', input: {} })
  push('segmentation-honest-state', { phase: seg.phase, state: seg.state, reason: seg.reason })

  // 6) Local-only enforcement: local-only task with no device lane → never leaves.
  cc.consent.set(true, true)
  const localOnly = await scheduleCodeAnalysis(cc, { files: [] })
  push('local-only-mode', { phase: localOnly.phase, state: localOnly.state, reason: localOnly.reason })
  cc.consent.set(true, false)

  results.finishedAt = new Date().toISOString()
  ;(window as unknown as { __RESULTS: unknown }).__RESULTS = results
  ;(document.getElementById('status') as HTMLElement).textContent = 'DONE'
  ;(document.getElementById('results') as HTMLElement).textContent = JSON.stringify(results, null, 1)
}

void main().catch((error) => {
  ;(window as unknown as { __RESULTS: unknown }).__RESULTS = { fatalError: String(error) }
  ;(document.getElementById('status') as HTMLElement).textContent = 'FATAL: ' + String(error)
})
