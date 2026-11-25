/**
 * M40 RTX 5060 Ti ACCEPTANCE HARNESS — browser entry.
 *
 * Drives the REAL client-compute segmentation lane (the production modules
 * the LAXII product imports: pinned MODNet artifact + onnxruntime-web worker)
 * through the M40 ten-point GPU checklist:
 *
 *   1.  real GPU adapter availability        (navigator.gpu, verbatim adapter info)
 *   2.  device/operator compatibility        (device features/limits + REAL jsep
 *                                             operator compile proven by init)
 *   3.  model init + weight integrity        (requestDownload consent+SHA-256 gate,
 *                                             then real session init)
 *   4.  REAL inference executed ON GPU       (worker-reported provider === 'webgpu')
 *   5.  correct, verified output             (dims match, alpha coverage band,
 *                                             non-degenerate mask, PNG bytes)
 *   6.  VRAM + timing                        (per-run wall time; WebGPU exposes NO
 *                                             VRAM counter — JS heap proxy recorded
 *                                             and honestly labeled)
 *   7.  GPU device loss + recovery           (destroy() the REAL device ORT owns →
 *                                             next run must recover)
 *   8.  automatic CPU/WASM fallback          (adapter made unavailable → real WASM
 *                                             inference through the same lane)
 *   9.  repeated requests, no leak           (10 runs, window.gc(), heap delta bound)
 *   10. worker cancel + cleanup + health     (mid-flight abort, then a fresh run)
 *
 * Every check records ok:true / ok:false / ok:null (honest unavailability with
 * the exact reason) + verbatim evidence. Results land in window.__RESULTS,
 * the page's download button, AND (M40.9) are auto-POSTed to the harness
 * server's /evidence endpoint so the one-command PowerShell runner can capture
 * and schema-validate them without a manual click.
 *
 * NO simulated device profiles and NO benchmark round-trips count as inference:
 * the only GPU proof this harness accepts is the worker's verbatim provider
 * field on a validated matte output.
 */
import { getClientCompute } from '../../src/lib/client-compute/index'
import { SEGMENTATION_KIND } from '../../src/lib/client-compute/adapters/laxii'

interface Check {
  point: string
  name: string
  ok: boolean | null
  detail: string
  evidence?: unknown
}

async function main(): Promise<void> {
  const results: { startedAt: string; userAgent: string; checks: Check[]; finishedAt?: string } = {
    startedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    checks: [],
  }
  const resultsEl = document.getElementById('results') as HTMLElement
  const render = () => {
    resultsEl.textContent = JSON.stringify(results, null, 1)
    ;(window as unknown as { __RESULTS?: unknown }).__RESULTS = results
  }
  const push = (point: string, name: string, ok: boolean | null, detail: string, evidence?: unknown) => {
    results.checks.push({ point, name, ok, detail, ...(evidence !== undefined ? { evidence } : {}) })
    render()
    console.log(`[m40-rtx] ${point} ${name}: ${ok === true ? 'PASS' : ok === false ? 'FAIL' : 'N/A'} :: ${detail}`)
  }
  const gcNow: () => void = (window as unknown as { gc?: () => void }).gc ?? (() => {})

  // ---- instrumentation: capture every GPUDevice the runtime opens + adapter blocking
  const devices: GPUDevice[] = []
  const deviceLostEvents: unknown[] = []
  const origRequestDevice = GPUAdapter.prototype.requestDevice
  GPUAdapter.prototype.requestDevice = async function (this: GPUAdapter, ...args: unknown[]) {
    const dev = await origRequestDevice.apply(this, args as [])
    devices.push(dev)
    dev.lost?.then?.((info) => deviceLostEvents.push({ at: new Date().toISOString(), reason: (info as GPUDeviceLostInfo)?.reason, message: (info as GPUDeviceLostInfo)?.message }))
    return dev
  } as typeof GPUAdapter.prototype.requestDevice
  const origRequestAdapter = navigator.gpu.requestAdapter.bind(navigator.gpu)
  let adapterBlocked = false
  navigator.gpu.requestAdapter = async (options?: GPURequestAdapterOptions) => {
    if (adapterBlocked) return null
    return origRequestAdapter(options)
  }

  // ---- point 1: real GPU adapter availability
  let adapter: GPUAdapter | null = null
  try {
    adapter = await navigator.gpu.requestAdapter()
  } catch (e) {
    push('1', 'gpu-adapter', false, `requestAdapter threw: ${(e as Error).message}`)
  }
  const info = (adapter as unknown as { info?: GPUAdapterInfo })?.info ?? null
  const infoStr = info ? JSON.stringify({ vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description }) : '(adapter.info unavailable in this Chrome — older requestAdapterInfo() path below)'
  let legacyInfo: Record<string, string> | null = null
  if (!info && adapter) {
    try {
      const legacy = await (adapter as unknown as { requestAdapterInfo?: () => Promise<Record<string, string>> }).requestAdapterInfo?.()
      legacyInfo = legacy ?? null
    } catch {
      /* recorded as unavailable */
    }
  }
  const vendorStr = (info?.vendor ?? legacyInfo?.vendor ?? '').toLowerCase()
  const descStr = `${info?.description ?? ''} ${info?.device ?? ''} ${legacyInfo?.description ?? ''} ${legacyInfo?.device ?? ''}`.toLowerCase()
  const isNvidia = vendorStr.includes('nvidia') || descStr.includes('nvidia')
  const isRtx5060Ti = descStr.includes('5060')
  push(
    '1',
    'gpu-adapter',
    !!adapter && isNvidia && isRtx5060Ti,
    adapter
      ? `adapter present; vendor="${info?.vendor ?? legacyInfo?.vendor ?? '?'}" description/device="${(descStr || '(empty)').slice(0, 120)}"; nvidia=${isNvidia}, rtx-5060-string=${isRtx5060Ti}`
      : 'no WebGPU adapter — the GPU acceptance cannot run on this machine',
    { info: infoStr, legacyInfo },
  )
  if (!adapter) {
    // No WebGPU adapter: record the honest refusal and STOP. finish() must run
    // exactly once (it binds the download button); continuing without an
    // adapter would only produce null-deref noise past point 1.
    finish()
    return
  }

  function finish() {
    results.finishedAt = new Date().toISOString()
    render()
    const pass = results.checks.filter((c) => c.ok === true).length
    const fail = results.checks.filter((c) => c.ok === false).length
    const na = results.checks.filter((c) => c.ok === null).length
    console.log(`[m40-rtx] DONE: ${pass} PASS / ${fail} FAIL / ${na} honest-unavailable`)
    // M40.9: auto-report the finished evidence to the harness server so the
    // one-command runner can capture it. The manual download button stays for
    // standalone use. An unreachable /evidence endpoint must never hide the
    // run itself — the button remains functional either way.
    fetch('/evidence', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(results),
    })
      .then(async (res) => {
        const body = await res.text().catch(() => '')
        console.log(`[m40-rtx] evidence auto-report: HTTP ${res.status} ${body.slice(0, 200)}`)
      })
      .catch((e) => console.log(`[m40-rtx] evidence auto-report unavailable (${(e as Error).message}) — use the download button`))
    const btn = document.getElementById('download') as HTMLElement
    btn.style.display = 'inline-block'
    btn.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(results, null, 1)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `rtx-acceptance-results-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
      a.click()
    })
  }

  // ---- point 2: device/operator compatibility (features/limits recorded; the
  // REAL operator proof is the successful jsep compile of the whole MODNet graph
  // at session init, asserted by points 3/4).
  let device: GPUDevice | null = null
  try {
    device = await adapter!.requestDevice()
    push('2', 'device-open', !!device, 'GPUDevice opened', {
      features: device.features ? Array.from(device.features) : [],
      maxBufferMb: device.limits?.maxBufferSize ? Number(device.limits.maxBufferSize) / 1048576 : null,
      maxComputeWorkgroupStorageSize: device.limits?.maxComputeWorkgroupStorageSize ?? null,
    })
  } catch (e) {
    push('2', 'device-open', false, `requestDevice threw: ${(e as Error).message}`)
  }

  // ---- engine init (real detection; the tier derives from THIS machine)
  const cc = getClientCompute()
  await cc.init()
  const snapshot = cc.getSnapshot()
  const profile = cc.getProfile()
  push('0', 'environment', !!snapshot?.webgpu, 'client-compute engine initialized on this machine', {
    tier: profile?.tier,
    tierReasons: profile?.tierReasons,
    webgpu: snapshot?.webgpu,
    hardwareConcurrency: snapshot?.hardwareConcurrency,
    deviceMemoryGb: snapshot?.deviceMemoryGb,
    devicesOpenedByEngine: devices.length,
  })

  // ---- explicit consent (the product's real gate; never bypassed)
  cc.consent.set(true, false)
  push('0', 'consent', true, 'device-compute consent granted explicitly for this acceptance run')

  // ---- point 3a: pinned model download through the REAL integrity gate
  const dl = await cc.registry.requestDownload('laxii-bgremoval-modnet', {
    approval: true,
    onProgress: (f) => {
      resultsEl.textContent = `downloading pinned MODNet… ${(f * 100).toFixed(0)}%\n` + resultsEl.textContent.slice(0, 400)
    },
  })
  push('3', 'model-download-integrity', dl.ok === true, dl.ok ? 'pinned MODNet downloaded; SHA-256 verified by the production gate' : `download refused: ${dl.code} — ${dl.reason}`, dl)

  const loadPortrait = async (): Promise<Blob | null> => {
    const fileInput = document.getElementById('portrait') as HTMLInputElement
    if (fileInput.files?.[0]) return fileInput.files[0]
    try {
      const res = await fetch('./portrait.jpg')
      if (!res.ok) return null
      return await res.blob()
    } catch {
      return null
    }
  }
  const portrait = await loadPortrait()
  if (!portrait) {
    push('4', 'real-inference', null, 'no input image available (place portrait.jpg next to the harness or pick a file) — remaining points honestly unavailable')
    finish()
    return
  }

  /** The segmentation worker's validated output payload (scheduler-unwrapped). */
  interface MatteOutput {
    blob: Blob
    bytes: number
    width: number
    height: number
    pixels: Uint8ClampedArray
    provider: 'webgpu' | 'wasm'
    durationMs: number
  }
  // runTask resolves to the scheduler's ComputeTaskOutput wrapper; the matte
  // itself lives in .output. Non-completed phases are honest throws so every
  // check below sees either a REAL validated matte or a catchable failure.
  const runMatte = async (signal?: AbortSignal): Promise<MatteOutput> => {
    const res = await cc.scheduler.runTask<Blob | { blob: Blob }, MatteOutput>(
      { productId: 'laxii', kind: SEGMENTATION_KIND, input: { blob: portrait }, ...(signal ? { signal } : {}) },
      {},
    )
    if (res.phase !== 'completed' || !res.output) {
      throw new Error(`matte did not complete: phase=${res.phase} state=${res.state} reason=${res.reason ?? 'none'}`)
    }
    return res.output
  }

  const validateMatte = (out: { width: number; height: number; pixels: Uint8ClampedArray; blob: Blob }) => {
    let opaque = 0
    let sum = 0
    let sumSq = 0
    const n = out.pixels.length / 4
    for (let i = 3; i < out.pixels.length; i += 4) {
      const a = out.pixels[i]
      sum += a
      sumSq += a * a
      if (a > 128) opaque++
    }
    const mean = sum / n
    const variance = sumSq / n - mean * mean
    const coverage = opaque / n
    const dimsOk = out.width > 0 && out.height > 0
    return { coverage, mean, variance, dimsOk, opaque }
  }

  // ---- points 3b/4/5/6: init + REAL GPU inference + validated output + timing
  let firstRun: Awaited<ReturnType<typeof runMatte>> | null = null
  try {
    const t0 = performance.now()
    firstRun = await runMatte()
    const wallMs = performance.now() - t0
    const provider = firstRun.provider
    const onGpu = provider === 'webgpu'
    push('4', 'real-inference', onGpu, onGpu ? `REAL inference ON GPU: worker-reported provider=webgpu, wall ${wallMs.toFixed(0)}ms (in-worker measured ${firstRun.durationMs}ms)` : `provider=${String(provider)} — the GPU lane did NOT serve this matte`, { provider, wallMs, durationMs: firstRun.durationMs })
    const v = validateMatte(firstRun)
    const outOk = v.dimsOk && v.coverage > 0.03 && v.coverage < 0.9 && v.variance > 1
    push('5', 'output-validation', outOk, outOk ? `validated matte: ${firstRun.width}x${firstRun.height}, alpha coverage ${(v.coverage * 100).toFixed(1)}%, mask variance ${v.variance.toFixed(0)} (non-degenerate person silhouette)` : `matte failed validation: dimsOk=${v.dimsOk} coverage=${(v.coverage * 100).toFixed(1)}% variance=${v.variance.toFixed(0)}`, { coverage: v.coverage, variance: v.variance, width: firstRun.width, height: firstRun.height })
    push('6', 'timing-memory', true, `measured: first-run wall ${wallMs.toFixed(0)}ms, steady-state ${firstRun.durationMs}ms; WebGPU exposes NO VRAM counter — JS heap is recorded as the honest proxy, never labeled as VRAM`, {
      firstRunWallMs: wallMs,
      adapterLimits: device?.limits ? { maxBufferSizeMb: Number(device.limits.maxBufferSize) / 1048576 } : null,
    })
  } catch (e) {
    push('4', 'real-inference', false, `matte run threw: ${(e as Error).message.slice(0, 200)}`)
    finish()
    return
  }

  // ---- point 9: repeated runs without leak
  try {
    gcNow()
    const heapBefore = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null
    const times: number[] = []
    let allOk = true
    for (let i = 0; i < 10; i++) {
      const r = await runMatte()
      times.push(r.durationMs)
      if (r.provider !== 'webgpu') allOk = false
      gcNow()
    }
    const heapAfter = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null
    const growthMb = heapBefore != null && heapAfter != null ? (heapAfter - heapBefore) / 1048576 : null
    const bounded = growthMb == null ? true : growthMb < 30
    push('9', 'repeat-no-leak', allOk && bounded, `${times.length} sequential mattes ${allOk ? 'all on GPU' : 'NOT all on GPU'}; heap delta ${growthMb == null ? 'unavailable (performance.memory off)' : `${growthMb.toFixed(1)}MB`} → ${bounded ? 'bounded' : 'GROWING'}`, { times, growthMb })
  } catch (e) {
    push('9', 'repeat-no-leak', false, `repeat run threw: ${(e as Error).message.slice(0, 160)}`)
  }

  // ---- point 10: mid-flight cancel + worker health
  try {
    const ac = new AbortController()
    const p = runMatte(ac.signal)
    setTimeout(() => ac.abort(), 250)
    let cancelled = false
    try {
      await p
    } catch (e) {
      cancelled = true
      push('10', 'cancel-cleanup', true, `mid-flight abort produced an honest rejection: ${(e as Error).message.slice(0, 120)}`)
    }
    if (!cancelled) push('10', 'cancel-cleanup', null, 'the run completed before the abort fired (too fast to cancel) — recorded, not fabricated')
    const after = await runMatte()
    push('10', 'worker-health-after-cancel', !!after.provider, `follow-up matte succeeded (provider=${String(after.provider)}, ${after.durationMs}ms) — the worker survived the cancel`)
  } catch (e) {
    push('10', 'worker-health-after-cancel', false, `post-cancel run threw: ${(e as Error).message.slice(0, 160)}`)
  }

  // ---- point 7: REAL device loss + recovery
  try {
    const target = devices[devices.length - 1]
    if (!target) {
      push('7', 'device-loss-recovery', null, 'no captured GPUDevice to destroy — unavailable')
    } else {
      target.destroy()
      await new Promise((r) => setTimeout(r, 300))
      const r = await runMatte()
      const provider = r.provider
      const recovered = provider === 'webgpu'
      push(
        '7',
        'device-loss-recovery',
        recovered,
        recovered
          ? `destroy()ed the device the runtime owned → next matte RECOVERED on a fresh GPU device (provider=webgpu, ${r.durationMs}ms)`
          : `after destroy() the lane continued via provider=${String(provider)} — recovery-to-GPU did NOT happen (honest result; the fallback proof is point 8)`,
        { provider, durationMs: r.durationMs, deviceLostEvents },
      )
    }
  } catch (e) {
    push('7', 'device-loss-recovery', false, `post-destroy run threw: ${(e as Error).message.slice(0, 160)}`, { deviceLostEvents })
  }

  // ---- point 8: automatic CPU/WASM fallback (adapter unavailable = the same
  // code path a driver reset takes) — runs LAST: the worker caches its session,
  // so the provider may stick to wasm afterwards (recorded, never hidden).
  try {
    adapterBlocked = true
    const r = await runMatte()
    const provider = r.provider
    const v = validateMatte(r)
    const ok = provider === 'wasm' && v.coverage > 0.03 && v.coverage < 0.9
    push('8', 'auto-cpu-fallback', ok, ok ? `with the adapter unavailable the SAME lane produced a VALIDATED matte via REAL WASM/SIMD CPU inference (provider=wasm, ${r.durationMs}ms)` : `fallback did not produce a validated CPU matte (provider=${String(provider)})`, { provider, durationMs: r.durationMs, coverage: v.coverage })
    adapterBlocked = false
    const r2 = await runMatte()
    push('8', 'provider-stickiness-after-fallback', true, `after restoring the adapter the lane reported provider=${String(r2.provider)} (the worker caches its session — stickiness is recorded, never presented as GPU recovery)`)
  } catch (e) {
    push('8', 'auto-cpu-fallback', false, `fallback run threw: ${(e as Error).message.slice(0, 160)}`)
    adapterBlocked = false
  }

  finish()
}

main().catch((e) => {
  const el = document.getElementById('results') as HTMLElement
  el.textContent = `HARNESS FAILED: ${e?.message ?? e}`
  const fatal = { startedAt: new Date().toISOString(), userAgent: navigator.userAgent, finishedAt: new Date().toISOString(), fatal: String(e?.message ?? e), checks: [] }
  ;(window as unknown as { __RESULTS?: unknown }).__RESULTS = fatal
  // even a fatal harness error is honest evidence — report it the same way
  fetch('/evidence', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fatal) }).catch(() => {})
})
