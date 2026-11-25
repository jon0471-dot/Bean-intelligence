/**
 * BEAN Intelligence — client compute: browser capability detection (Phase 2).
 *
 * Every value here comes from a REAL browser check performed at detection
 * time, or is `null` when the platform does not expose it. Browsers do not
 * reliably expose exact free VRAM, exact free system RAM or GPU model names;
 * this module never invents those values and never derives hardware tiers
 * from user-agent strings (tier derivation lives in device-profile.ts and
 * consumes only the measured facts below, plus an optional opt-in benchmark).
 *
 * Detection must succeed in non-DOM environments (SSR, unit tests): it then
 * reports `environment: 'non-browser'` with a Tier-0-compatible snapshot
 * instead of throwing — the honest answer to "can I compute here?" is no.
 *
 * Client-safe: no Node-only imports.
 */
import type { CapabilitySnapshot } from './types'
import type { StructGPU, StructGPUAdapter } from './webgpu/engine'

/** Minimal wasm module with a v128 SIMD opcode, used for a real SIMD probe.
 * Module: (module (func (result v128) (v128.const i32x4 0 0 0 0)))
 * — 8-byte header, type section ([] -> v128), function section, code section
 * whose body is locals=0 + `v128.const 0xfd 0x0c` + the FULL 16 v128 data
 * bytes + `end`. WebAssembly.validate() accepts it iff SIMD is enabled.
 * M39 fix: the previous hand-built module carried only 12 of the 16 required
 * v128 data bytes (body size 15 instead of 20), so WebAssembly.validate()
 * rejected it on EVERY runtime — the probe always reported simd:false and
 * gated the CPU/WASM chat lane (and every wasm model lane) off everywhere.
 */
const SIMD_WASM_BYTES = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b, 0x03,
  0x02, 0x01, 0x00, 0x0a, 0x16, 0x01, 0x14, 0x00, 0xfd, 0x0c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0b,
])

/** A small valid non-SIMD wasm module, used to probe base WASM support. */
const BASE_WASM_BYTES = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
])

function probeWebAssembly(): { supported: boolean; simd: boolean | null } {
  try {
    if (typeof WebAssembly === 'undefined') return { supported: false, simd: null }
    const base = WebAssembly.validate(BASE_WASM_BYTES)
    let simd: boolean | null = null
    try {
      simd = WebAssembly.validate(SIMD_WASM_BYTES)
    } catch {
      simd = null
    }
    return { supported: base, simd }
  } catch {
    return { supported: false, simd: null }
  }
}

/** Probe WebGL support and MAX_TEXTURE_SIZE via a throwaway canvas context. */
function probeWebGL(): { webgl2: boolean; webgl1: boolean; maxTextureSize: number | null } {
  try {
    if (typeof document === 'undefined') return { webgl2: false, webgl1: false, maxTextureSize: null }
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    let webgl2 = false
    let webgl1 = false
    let maxTextureSize: number | null = null
    try {
      const gl2 = canvas.getContext('webgl2')
      if (gl2) {
        webgl2 = true
        const v = gl2.getParameter(gl2.MAX_TEXTURE_SIZE)
        if (typeof v === 'number') maxTextureSize = v
        gl2.getExtension('WEBGL_lose_context')?.loseContext()
      }
    } catch {
      webgl2 = false
    }
    if (!webgl2) {
      try {
        const gl1 = canvas.getContext('webgl')
        if (gl1) {
          webgl1 = true
          const v = gl1.getParameter(gl1.MAX_TEXTURE_SIZE)
          if (typeof v === 'number') maxTextureSize = v
          gl1.getExtension('WEBGL_lose_context')?.loseContext()
        }
      } catch {
        webgl1 = false
      }
    }
    return { webgl2, webgl1, maxTextureSize }
  } catch {
    return { webgl2: false, webgl1: false, maxTextureSize: null }
  }
}

/** Browser-family label. Display-level fact only — NEVER used for capability
 * or tier decisions. Prefers UA-CH brands when present, falls back to a
 * coarse UA parse (family name only). */
function probeBrowserFamily(): { family: string; mobileHint: boolean } {
  try {
    const nav = navigator as Navigator & {
      userAgentData?: { brands?: Array<{ brand: string; version: string }>; mobile?: boolean }
    }
    const brands = nav.userAgentData?.brands ?? []
    for (const candidate of ['Microsoft Edge', 'Chromium', 'Google Chrome', 'Firefox', 'Safari']) {
      if (brands.some((b) => b.brand === candidate)) {
        return { family: candidate, mobileHint: nav.userAgentData?.mobile === true }
      }
    }
    const ua = navigator.userAgent ?? ''
    let family = 'Unknown'
    if (/Edg\//.test(ua)) family = 'Microsoft Edge'
    else if (/Firefox\//.test(ua)) family = 'Firefox'
    else if (/Chrome\//.test(ua)) family = 'Google Chrome'
    else if (/Safari\//.test(ua)) family = 'Safari'
    return { family, mobileHint: /Mobi|Android|iPhone|iPad/i.test(ua) }
  } catch {
    return { family: 'Unknown', mobileHint: false }
  }
}

async function probeWebGPU(): Promise<CapabilitySnapshot['webgpu']> {
  const empty = { supported: false, adapterAvailable: false, features: [] as string[], limits: null as Record<string, number> | null, fallbackAdapter: null as boolean | null }
  try {
    const gpu = (typeof navigator !== 'undefined' ? (navigator as Navigator & { gpu?: StructGPU }).gpu : undefined) ?? null
    if (!gpu?.requestAdapter) return empty
    // Cast: the ambient GPUAdapter type (brought in by @webgpu/types via the
    // onnxruntime-web dependency) differs structurally from this module's
    // narrow StructGPU shim; the probe reads only features/limits/isFallbackAdapter.
    const adapter = ((await gpu.requestAdapter()) ?? null) as unknown as StructGPUAdapter | null
    if (!adapter) return { ...empty, supported: true }
    // requestAdapterInfo is deprecated/partial; only limits + features are
    // read (both real GPU facts, no vendor/architecture strings collected).
    const features: string[] = []
    try {
      for (const f of adapter.features ?? []) features.push(String(f))
    } catch {
      /* features enumeration unavailable */
    }
    let limits: Record<string, number> | null = null
    try {
      const raw = adapter.limits as unknown as Record<string, number> | undefined
      if (raw && typeof raw === 'object') {
        limits = {}
        for (const key of Object.keys(raw)) {
          const v = (raw as Record<string, unknown>)[key]
          if (typeof v === 'number' && Number.isFinite(v) && v >= 0) limits[key] = v
        }
        if (Object.keys(limits).length === 0) limits = null
      }
    } catch {
      limits = null
    }
    let fallbackAdapter: boolean | null = null
    try {
      const info = adapter.isFallbackAdapter
      if (typeof info === 'boolean') fallbackAdapter = info
    } catch {
      fallbackAdapter = null
    }
    return { supported: true, adapterAvailable: true, features, limits, fallbackAdapter }
  } catch {
    return empty
  }
}

async function probeStorage(): Promise<CapabilitySnapshot['storage'] | null> {
  try {
    const nav = navigator as Navigator & {
      storage?: { estimate?: () => Promise<{ quota?: number; usage?: number }>; persist?: () => Promise<boolean>; persisted?: () => Promise<boolean> }
    }
    if (!nav.storage?.estimate) return null
    const est = await nav.storage.estimate()
    let persisted: boolean | null = null
    try {
      if (nav.storage.persisted) persisted = await nav.storage.persisted()
    } catch {
      persisted = null
    }
    return {
      quotaBytes: typeof est.quota === 'number' && Number.isFinite(est.quota) ? est.quota : null,
      usageBytes: typeof est.usage === 'number' && Number.isFinite(est.usage) ? est.usage : null,
      persisted,
    }
  } catch {
    return null
  }
}

/** Detect the full capability snapshot. Always resolves; in non-DOM
 * environments it resolves to an honest 'non-browser' snapshot. */
export async function detectCapabilities(): Promise<CapabilitySnapshot> {
  const hasDom = typeof document !== 'undefined' && typeof window !== 'undefined'
  const detectedAt = Date.now()

  if (!hasDom) {
    return {
      environment: 'non-browser',
      secureContext: false,
      webgpu: { supported: false, adapterAvailable: false, features: [], limits: null, fallbackAdapter: null },
      webgl: { webgl2: false, webgl1: false, maxTextureSize: null },
      wasm: probeWebAssembly(),
      workers: false,
      offscreenCanvas: false,
      sharedArrayBuffer: false,
      crossOriginIsolated: false,
      hardwareConcurrency: null,
      deviceMemoryGb: null,
      storage: null,
      browser: { family: 'non-browser', mobileHint: false },
      detectedAt,
    }
  }

  const nav = navigator as Navigator & {
    deviceMemory?: number
    hardwareConcurrency?: number
  }
  const webgpu = await probeWebGPU()
  const webgl = probeWebGL()
  const wasm = probeWebAssembly()
  const storage = await probeStorage()
  const browser = probeBrowserFamily()
  const crossOriginIsolated = crossOriginIsolatedGlobal() === true
  const workers = typeof Worker === 'function'
  const offscreenCanvas = typeof OffscreenCanvas === 'function'

  return {
    environment: 'browser',
    secureContext: typeof isSecureContext === 'boolean' ? isSecureContext : false,
    webgpu,
    webgl,
    wasm,
    workers,
    offscreenCanvas,
    crossOriginIsolated,
    sharedArrayBuffer: crossOriginIsolated && typeof SharedArrayBuffer === 'function',
    hardwareConcurrency:
      typeof nav.hardwareConcurrency === 'number' && Number.isFinite(nav.hardwareConcurrency) && nav.hardwareConcurrency > 0
        ? nav.hardwareConcurrency
        : null,
    deviceMemoryGb:
      typeof nav.deviceMemory === 'number' && Number.isFinite(nav.deviceMemory) && nav.deviceMemory > 0
        ? nav.deviceMemory
        : null,
    storage,
    browser,
    detectedAt,
  }
}

function crossOriginIsolatedGlobal(): boolean | undefined {
  try {
    // `crossOriginIsolated` is a window global in browsers.
    return (globalThis as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated
  } catch {
    return undefined
  }
}
