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
  /** Social-media source: user-generated content, not reporting. */
  social?: boolean
  pageRead: boolean
}

export interface VerificationCheckView {
  check: string // human label
  status: 'passed' | 'failed' | 'warning' | 'not_applicable'
  detail: string
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
