/**
 * BEAN Intelligence — AI Device Settings store (client-safe).
 *
 * The user's explicit compute preferences for the universal AI runtime:
 *   mode            — where inference SHOULD run (the resilient selection
 *                     policy still degrades honestly when a mode cannot be
 *                     honored on this device)
 *   consent         — device-compute consent lives in privacy.ts (v1); the
 *                     settings store references it, it never bypasses it
 *   preferredModel  — which on-device chat model to use when several exist
 *   localEngine     — pairing facts for the OPTIONAL local desktop engine
 *                     (loopback only). The pairing key is stored ONLY in
 *                     this browser's localStorage and is never sent to any
 *                     BEAN server — the browser talks to the engine directly.
 *
 * Versioned localStorage under 'bean.ai.deviceSettings.v1'; non-DOM
 * environments degrade to an in-memory stub (honest defaults).
 *
 * Client-safe: no Node-only imports.
 */

export type AiDeviceMode =
  /** Automatic: compatible WebGPU model → CPU/WASM model → paired local
   * engine → server provider (the default policy, task §4). */
  | 'auto'
  /** Prefer GPU acceleration when the device supports it; CPU otherwise;
   * server only as explicit fallback action. */
  | 'gpu-preferred'
  /** Never use the GPU for inference (battery/thermal control). */
  | 'cpu-only'
  /** Use the paired local desktop engine (llama.cpp) when reachable. */
  | 'local-engine'
  /** Server providers only (no device compute, no local engine). */
  | 'server'

export interface LocalEnginePairing {
  /** Loopback host only — enforced by validation. */
  host: '127.0.0.1' | 'localhost' | '[::1]'
  port: number
  /** llama-server --api-key value. Stored ONLY in this browser. */
  apiKey: string
  /** When the pairing was last VERIFIED (models probe succeeded). */
  verifiedAt: string | null
  /** Model id reported by the engine at verification time. */
  reportedModel: string | null
}

export interface AiDeviceSettings {
  version: 1
  mode: AiDeviceMode
  /** Client model id preferred for on-device chat (null = registry default). */
  preferredChatModelId: string | null
  localEngine: LocalEnginePairing | null
  updatedAt: string
}

export const DEVICE_SETTINGS_KEY = 'bean.ai.deviceSettings.v1'

const DEFAULTS: AiDeviceSettings = {
  version: 1,
  mode: 'auto',
  preferredChatModelId: null,
  localEngine: null,
  updatedAt: new Date(0).toISOString(),
}

let memoryFallback: AiDeviceSettings | null = null
let listener: ((settings: AiDeviceSettings) => void) | null = null

function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}

function sanitize(raw: unknown): AiDeviceSettings | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Partial<AiDeviceSettings>
  if (s.version !== 1) return null
  const modes: AiDeviceMode[] = ['auto', 'gpu-preferred', 'cpu-only', 'local-engine', 'server']
  const mode = modes.includes(s.mode as AiDeviceMode) ? (s.mode as AiDeviceMode) : 'auto'
  let localEngine: LocalEnginePairing | null = null
  if (s.localEngine && typeof s.localEngine === 'object') {
    const le = s.localEngine as LocalEnginePairing
    const host = le.host as LocalEnginePairing['host']
    const port = typeof le.port === 'number' && Number.isInteger(le.port) && le.port > 0 && le.port <= 65535 ? le.port : null
    if ((host === '127.0.0.1' || host === 'localhost' || host === '[::1]') && port !== null && typeof le.apiKey === 'string') {
      localEngine = {
        host,
        port,
        apiKey: le.apiKey,
        verifiedAt: typeof le.verifiedAt === 'string' ? le.verifiedAt : null,
        reportedModel: typeof le.reportedModel === 'string' ? le.reportedModel : null,
      }
    }
  }
  return {
    version: 1,
    mode,
    preferredChatModelId: typeof s.preferredChatModelId === 'string' ? s.preferredChatModelId : null,
    localEngine,
    updatedAt: typeof s.updatedAt === 'string' ? s.updatedAt : new Date(0).toISOString(),
  }
}

/** Read the current settings (defaults when never set). */
export function getDeviceSettings(): AiDeviceSettings {
  const store = safeLocalStorage()
  if (!store) return memoryFallback ?? DEFAULTS
  try {
    const raw = store.getItem(DEVICE_SETTINGS_KEY)
    if (!raw) return DEFAULTS
    return sanitize(JSON.parse(raw)) ?? DEFAULTS
  } catch {
    return DEFAULTS
  }
}

/** Persist settings (sanitized). Fires the change listener. */
export function setDeviceSettings(update: Partial<Omit<AiDeviceSettings, 'version' | 'updatedAt'>>): AiDeviceSettings {
  const next = sanitize({ ...getDeviceSettings(), ...update, version: 1, updatedAt: new Date().toISOString() }) ?? DEFAULTS
  const store = safeLocalStorage()
  if (!store) {
    memoryFallback = next
  } else {
    try {
      store.setItem(DEVICE_SETTINGS_KEY, JSON.stringify(next))
    } catch {
      memoryFallback = next
    }
  }
  try {
    listener?.(next)
  } catch {
    /* listener errors must never break settings handling */
  }
  return next
}

/** Is the local desktop engine paired (facts present)? Reachability is a
 * separate, measured check — pairing alone never proves reachability. */
export function isLocalEnginePaired(): boolean {
  return getDeviceSettings().localEngine !== null
}

/** Remove any stored pairing (the pairing key is deleted with it). */
export function unpairLocalEngine(): AiDeviceSettings {
  return setDeviceSettings({ localEngine: null })
}

/** Subscribe to settings changes (UI re-render). */
export function onDeviceSettingsChange(cb: (settings: AiDeviceSettings) => void): () => void {
  listener = cb
  return () => {
    if (listener === cb) listener = null
  }
}

/** Test seam: reset the in-memory fallback. */
export function resetDeviceSettingsForTests(): void {
  memoryFallback = null
  listener = null
}
