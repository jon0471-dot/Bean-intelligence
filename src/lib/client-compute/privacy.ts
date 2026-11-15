/**
 * BEAN Intelligence — client compute: privacy and user consent (Phase 8).
 *
 * Rules implemented here (non-negotiable):
 *  - No device compute of any kind runs without EXPLICIT consent
 *    (`granted: true`). The scheduler consults this module before every
 *    device execution.
 *  - `localOnly: true` means tasks must NEVER be sent to a backend. The
 *    scheduler reads this flag on every fallback decision — a privacy
 *    expectation is never silently changed by a fallback.
 *  - No background mining, no hidden GPU workloads, no third-party compute
 *    contribution, no visitors' hardware used for other users' jobs.
 *  - Diagnostics never contain raw media or prompt text (see redact()).
 *
 * Consent is stored in localStorage under a versioned key. In non-DOM
 * environments the store degrades to an in-memory stub that reports
 * "no consent" (the honest default).
 *
 * Client-safe: no Node-only imports.
 */
import { CLIENT_COMPUTE_CONSENT_KEY, type ClientComputeConsent } from './types'

const CONSENT_VERSION = 1

let memoryFallback: ClientComputeConsent | null = null
let listener: ((consent: ClientComputeConsent | null) => void) | null = null

function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}

/** Read the current consent state (null = the user has never been asked). */
export function getConsent(): ClientComputeConsent | null {
  const store = safeLocalStorage()
  if (!store) return memoryFallback
  try {
    const raw = store.getItem(CLIENT_COMPUTE_CONSENT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ClientComputeConsent
    if (parsed?.version !== CONSENT_VERSION || typeof parsed.granted !== 'boolean' || typeof parsed.localOnly !== 'boolean') {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

/** Persist an explicit consent decision. */
export function setConsent(granted: boolean, localOnly: boolean): ClientComputeConsent {
  const consent: ClientComputeConsent = {
    version: CONSENT_VERSION,
    granted: granted === true,
    localOnly: granted === true && localOnly === true,
    updatedAt: new Date().toISOString(),
  }
  const store = safeLocalStorage()
  if (!store) {
    memoryFallback = consent
  } else {
    try {
      store.setItem(CLIENT_COMPUTE_CONSENT_KEY, JSON.stringify(consent))
    } catch {
      memoryFallback = consent
    }
  }
  try {
    listener?.(consent)
  } catch {
    /* listener errors must never break consent handling */
  }
  return consent
}

/** Withdraw consent entirely (device compute + local-only both off). */
export function revokeConsent(): ClientComputeConsent {
  return setConsent(false, false)
}

/** Subscribe to consent changes (used by UI to re-render status). */
export function onConsentChange(cb: (consent: ClientComputeConsent | null) => void): () => void {
  listener = cb
  return () => {
    if (listener === cb) listener = null
  }
}

/** Scheduler-facing gate: is DEVICE execution currently permitted? */
export function isDeviceComputeAllowed(): boolean {
  return getConsent()?.granted === true
}

/** Scheduler-facing gate: is BACKEND fallback forbidden because the user
 * selected local-only processing? This check runs on EVERY fallback
 * decision, not just at task submission. */
export function isLocalOnlyMode(): boolean {
  const consent = getConsent()
  return consent?.granted === true && consent.localOnly === true
}

/** Strip anything that must never appear in diagnostics: payload-ish strings
 * are reduced to type labels. Adapters call this for every note they emit. */
export function redactForDiagnostics(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') {
    // Strings longer than a safe label length are truncated to a size note —
    // we never know whether a caller embedded media bytes or prompt text.
    return value.length <= 120 ? value : `${value.slice(0, 60)}… [truncated ${value.length} chars]`
  }
  return `[${typeof value}]`
}
