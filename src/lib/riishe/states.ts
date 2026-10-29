import type { Prisma } from '@prisma/client'

/**
 * BEAN Intelligence — RIISHE response states and verification summary.
 *
 * HONESTY CONTRACT: these states are assigned by the orchestrator from
 * ACTUAL execution results (did search run? did the arithmetic evaluator
 * actually run and match? did a sandbox execute code?). The language model
 * has no authority over them and no field to set them.
 */

export const RESPONSE_STATES = [
  'VERIFIED_FROM_SOURCES', // every external claim cites a retrieved source
  'COMPUTATION_VERIFIED', // arithmetic was evaluated and matched claims
  'EXECUTION_VERIFIED', // code actually executed with passing results
  'PARTIALLY_VERIFIED', // some checks ran and passed, others did not apply
  'UNVERIFIED', // no verification applied (plain conversation)
  'TOOL_UNAVAILABLE', // a required tool failed; response degraded honestly
] as const

export type ResponseState = (typeof RESPONSE_STATES)[number]

export interface EvidenceSourceView {
  id: number
  title: string
  url: string
  hostName: string
  date: string | null
  official: boolean
  /** True when the source is a social/video platform (shown as provenance). */
  social: boolean
  pageRead: boolean
}

export interface VerificationCheckView {
  check: string // human label
  status: 'passed' | 'failed' | 'warning' | 'not_applicable'
  detail: string
}

/**
 * Measured per-turn latency breakdown (all wall-clock, ms). Recorded by the
 * orchestrator from real timestamps — never estimated. Fields that did not
 * happen this turn are null/absent (e.g. ttft on the non-streaming path).
 */
export interface TurnTimings {
  /** Total user-perceived orchestration wall time. */
  totalMs: number
  /** Classification + search policy + injection gate (understand phase). */
  understandMs: number
  /** Research pipeline wall time (null when no retrieval ran). */
  researchMs: number | null
  /** Inside research: provider search wall time (parallel, cache-aware). */
  searchMs?: number
  /** Inside research: full-page fetch wall time. */
  pageReadMs?: number
  /** Model gateway time to FIRST token of the solve pass (streaming path). */
  solveTtftMs: number | null
  /** Total solve wall time across all passes (tool loop excluded). */
  solveMs: number
  /** Arithmetic verification + citation audit + answer hygiene. */
  verifyMs: number
  /** Bounded claim-repair pass (present only when it ran). */
  repairMs?: number
  /** Solution passes executed (1 = single solve, 2 = one bounded retry). */
  solvePasses: number
}

export interface MessageMetadata {
  states: ResponseState[]
  sources: EvidenceSourceView[]
  verification: VerificationCheckView[]
  /** Which stage events actually fired during orchestration. */
  stages: Array<{ stage: 'researching' | 'tools' | 'solving' | 'verifying'; durationMs: number }>
  /** Honest degradation notes (tool failures, fallbacks). */
  degraded: string[]
  /** Real server-side tool executions for this turn (name, outcome, time). */
  toolRuns?: Array<{ tool: string; ok: boolean; durationMs: number }>
  /** True when a condensed digest of earlier turns was included in context. */
  digestUsed?: boolean
  /** ISO-8601 timestamp of when live research ran for this message (the
   *  "last checked" time). Set by the orchestrator only when retrieval was
   *  attempted — present even when retrieval failed, so the UI can state
   *  WHEN live verification was last attempted. Absent for turns that did
   *  not warrant a search. */
  retrievedAt?: string
  /** True when the deterministic injection guard replaced a complying
   *  output with a refusal. Set by the orchestrator only — never by the
   *  model. Absent (undefined) when the guard did not fire. */
  injectionBlocked?: boolean
  /** Short, customer-facing note shown ONLY when verification is
   *  incomplete or something material could not be confirmed (claims not
   *  covered by retrieved evidence, stale sources, geographic mismatch).
   *  Absent for ordinary answers — no badge noise. Composed by the
   *  orchestrator from deterministic audits, never by the model. */
  verificationNote?: string
  /** Measured latency breakdown for this turn (performance reporting). */
  timings?: TurnTimings
}

/** Build the customer-facing verification summary. Empty when nothing ran. */
export function buildVerificationSummary(views: VerificationCheckView[]): VerificationCheckView[] {
  return views.filter((v) => v.status !== 'not_applicable')
}

/**
 * Serialize metadata for Prisma's Json column. JSON round-trip drops
 * `undefined` values and produces a plain JSON object — the cast is the
 * single, audited boundary between the domain type and the DB input type.
 */
export function metadataToJson(m: MessageMetadata): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(m)) as Prisma.InputJsonObject
}
