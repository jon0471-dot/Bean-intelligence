/**
 * BEAN Intelligence — self-verification configuration (work order Part 1 §3).
 *
 * Two configuration layers, resolved per turn:
 *  1. Deployment defaults from environment variables (BEAN_VERIFY_*):
 *     the operator's baseline, needs no database access to know.
 *  2. The runtime SystemSetting row (written by /api/admin/verification):
 *     operator-tunable WITHOUT a redeploy. It overrides env defaults.
 *
 * Hard caps are non-negotiable regardless of configuration: they make the
 * "no infinite regeneration loops" requirement structural, not conventional.
 *
 * Default state: DISABLED. Verification doubles (worst case triples) the
 * provider calls per turn — enabling it is an explicit operator decision,
 * not a silent behavior change to a working product.
 */
import { db } from '@/lib/db'

export const SETTING_KEY = 'verification.config'

/** Hard structural caps — every configurable value is clamped inside these. */
export const hardCaps = {
  maxAttempts: 3,
  timeoutMs: 120_000,
  maxRegenerations: 1,
  maxInputChars: 60_000,
} as const

export interface VerificationConfig {
  /** Master switch. Default false — an explicit operator decision. */
  enabled: boolean
  /** Gateway model id used for verification (may differ from the primary). */
  verificationModel: string
  /** Verification PASSES per turn (verify draft → [correct → verify again]…). */
  maxAttempts: number
  /** Wall-clock cap for ONE verifier model call. */
  timeoutMs: number
  /** Verifier confidence at or below this → honesty outcome 'unverified'. */
  minConfidence: number
  /** FULL corrective regenerations allowed per turn (each revision produces
   *  the complete corrected answer from scratch). 0 = verify-only: blocking
   *  issues are detected and reported honestly, but the draft is never
   *  auto-rewritten. ALWAYS additionally capped by maxAttempts-1 — a revision
   *  consumes one verification attempt after it, so the worst case model
   *  calls per turn is 1 (draft) + maxAttempts (verifier) + maxAttempts-1
   *  (revisions), every knob clamped by hardCaps: no infinite loop exists. */
  regenerationLimit: number
  /** Char budget for the verifier input (request + draft). */
  maxInputChars: number
}

export const DEFAULT_VERIFICATION_CONFIG: VerificationConfig = {
  enabled: envBool('BEAN_VERIFY_ENABLED', false),
  verificationModel: process.env.BEAN_VERIFY_MODEL ?? 'bean-code-hosted',
  maxAttempts: clampInt(process.env.BEAN_VERIFY_MAX_ATTEMPTS, 2, 1, hardCaps.maxAttempts),
  timeoutMs: clampInt(process.env.BEAN_VERIFY_TIMEOUT_MS, 60_000, 5_000, hardCaps.timeoutMs),
  minConfidence: clampFloat(process.env.BEAN_VERIFY_MIN_CONFIDENCE, 0.6, 0, 1),
  regenerationLimit: clampInt(process.env.BEAN_VERIFY_REGENERATIONS, 1, 0, hardCaps.maxRegenerations),
  maxInputChars: clampInt(process.env.BEAN_VERIFY_MAX_INPUT_CHARS, 30_000, 2_000, hardCaps.maxInputChars),
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]
  if (raw === undefined) return fallback
  return raw.trim().toLowerCase() === 'true' || raw.trim() === '1'
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = raw !== undefined ? Number.parseInt(raw, 10) : NaN
  if (Number.isNaN(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function clampFloat(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = raw !== undefined ? Number.parseFloat(raw) : NaN
  if (Number.isNaN(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/** Effective config: SystemSetting row (operator) overrides env defaults. */
export async function verificationConfig(): Promise<VerificationConfig> {
  let cfg: VerificationConfig = { ...DEFAULT_VERIFICATION_CONFIG }
  try {
    const row = await db.systemSetting.findUnique({ where: { key: SETTING_KEY } })
    if (row) {
      const stored = JSON.parse(row.value) as Partial<VerificationConfig>
      cfg = { ...cfg, ...stored }
    }
  } catch {
    // Unreadable stored config falls back to env defaults — never blocks a turn.
  }
  // Clamp EVERYTHING inside the hard caps (defense against a hand-edited row).
  return {
    enabled: cfg.enabled === true,
    verificationModel: typeof cfg.verificationModel === 'string' && cfg.verificationModel ? cfg.verificationModel : DEFAULT_VERIFICATION_CONFIG.verificationModel,
    maxAttempts: Math.min(hardCaps.maxAttempts, Math.max(1, Math.floor(Number(cfg.maxAttempts) || DEFAULT_VERIFICATION_CONFIG.maxAttempts))),
    timeoutMs: Math.min(hardCaps.timeoutMs, Math.max(5_000, Math.floor(Number(cfg.timeoutMs) || DEFAULT_VERIFICATION_CONFIG.timeoutMs))),
    minConfidence: Math.min(1, Math.max(0, Number.isFinite(Number(cfg.minConfidence)) ? Number(cfg.minConfidence) : DEFAULT_VERIFICATION_CONFIG.minConfidence)),
    regenerationLimit: Math.min(hardCaps.maxRegenerations, Math.max(0, Math.floor(Number(cfg.regenerationLimit) || DEFAULT_VERIFICATION_CONFIG.regenerationLimit))),
    maxInputChars: Math.min(hardCaps.maxInputChars, Math.max(2_000, Math.floor(Number(cfg.maxInputChars) || DEFAULT_VERIFICATION_CONFIG.maxInputChars))),
  }
}

/** Test hook: reset the module-level cache in tests (config is read per call). */
export function _resetVerificationConfigForTests(): void {
  /* config is read per turn — nothing cached; hook kept for symmetry */
}
