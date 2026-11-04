/**
 * BEAN Intelligence — self-verification pipeline (modular, bounded, honest).
 *
 * The controlled verification loop (work order Part 1 §1):
 *   draft → independent verification → (issues? one corrective revision →
 *   re-verification) → final answer + honest verification status.
 *
 * Structural guarantees:
 *  - NO infinite loops: total model calls per turn are bounded by config
 *    (maxAttempts verifications + at most maxAttempts-1 corrective revisions,
 *    regenerationLimit full regenerations, all inside hard caps) — the bound
 *    is enforced by loop structure, not by convention;
 *  - the verification result is NEVER blindly accepted as success either:
 *    a pass below the confidence threshold, a malformed verifier reply, a
 *    failed verifier call, or a failed revision all resolve to the honest
 *    'unverified' class — the best available answer ships with an explicit
 *    uncertainty status instead of a claimed verification;
 *  - cancellation is honored at every boundary (the guard unwinds between
 *    passes and inside streamed revisions);
 *  - the verifier's reasoning and issue details are INTERNAL: callers may
 *    display only the summarized status — never the raw verifier output.
 *
 * The model access path is the unified gateway (configurable verification
 * model, possibly a different provider) — the engine has no provider code
 * of its own.
 */
import { planGatewayChat, executeGatewayChat, gatewayErrorFor, isGatewayCancelled } from '@/lib/ai-gateway/gateway'
import { VERIFIER_SYSTEM_PROMPT, buildVerifierUserTurn, buildRevisionInstruction } from './prompts'
import type { VerificationConfig } from './config'
import type { GenerationGuard } from '@/lib/giftz/chat-stream'
import { ClientDisconnectedError } from '@/lib/giftz/chat-stream'
import type { GatewayCallContext } from '@/lib/ai-gateway/types'

// ---- verifier report (internal shape) ---------------------------------------

export interface VerifierIssue {
  severity: 'critical' | 'major' | 'minor'
  type: 'requirement' | 'calculation' | 'logic' | 'code' | 'order' | 'factual'
  description: string
  correction: string
}

export interface VerifierReport {
  verdict: 'pass' | 'fail'
  confidence: number
  issues: VerifierIssue[]
}

export type VerificationStatus =
  | 'verified' // verification passed at/above the confidence threshold
  | 'corrected' // a revision was applied and re-verification PASSED
  | 'corrected-unverified' // a revision was applied but re-verification could not confirm it
  | 'unverified' // verification could not establish correctness (best available answer ships)
  | 'skipped' // verification disabled

export interface VerificationOutcome {
  status: VerificationStatus
  /** The answer to ship: the corrected revision when one was applied, else the draft. */
  finalContent: string
  attempts: number
  corrections: number
  /** critical+major issues found by the LAST verification pass (internal). */
  issuesFound: number
  confidence: number | null
  durationMs: number
  /** Internal honest reason when correctness could not be established. Never user-facing verbatim. */
  reason: string | null
}

export interface VerifyAndCorrectArgs {
  originalRequest: string
  draft: string
  config: VerificationConfig
  /** Gateway call context (principal, endpoint label, cancellation signal). */
  ctx: GatewayCallContext
  /** Cancellation guard — checked between passes; revisions also honor it. */
  guard?: GenerationGuard
  /** Stage reporter ('verifying' / 'revising') for the SSE lifecycle. */
  onStage?: (stage: 'verifying' | 'revising') => void
  /**
   * Streamed corrective revision: yields deltas of the FULL corrected answer
   * (SSE path — the client resets its buffer on the 'revising' stage).
   */
  streamRevision?: (instruction: string) => AsyncGenerator<string, void, unknown>
  /**
   * Non-streaming corrective revision (JSON path). When NEITHER generator is
   * supplied, a needed revision resolves honestly to 'unverified' with the
   * draft preserved — the pipeline never fabricates a correction.
   */
  generateRevision?: (instruction: string) => Promise<string>
}

// ---- verifier call -----------------------------------------------------------

async function runVerifierPass(
  originalRequest: string,
  answer: string,
  config: VerificationConfig,
  ctx: GatewayCallContext,
): Promise<VerifierReport | null> {
  try {
    const plan = await planGatewayChat({
      model: config.verificationModel,
      messages: [{ role: 'user', content: buildVerifierUserTurn(originalRequest, answer, config.maxInputChars) }],
      system: VERIFIER_SYSTEM_PROMPT,
      // Verifiers benefit from determinism; the hosted path documents that it
      // does not forward sampling parameters (never silently ignored).
      temperature: 0.2,
      timeoutMs: config.timeoutMs,
    })
    const result = await executeGatewayChat(plan, ctx)
    return parseVerifierReport(result.content)
  } catch (e) {
    if (isGatewayCancelled(e)) throw e
    // A failed verifier call is NOT a failed turn: the draft is real work.
    // Record the honest reason and resolve to 'unverified' upstream.
    return null
  }
}

/**
 * Robust strict-JSON extraction: the verifier may wrap the object in a code
 * fence despite instructions. Find the first balanced-looking object and
 * validate its shape; anything else is treated as unusable (null) — never
 * guessed into a pass.
 */
export function parseVerifierReport(raw: string): VerifierReport | null {
  const text = raw.trim()
  // Prefer exact JSON; else strip a fence; else take the outermost braces.
  const candidates: string[] = [text]
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  if (fenced) candidates.push(fenced[1].trim())
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1))
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as {
        verdict?: unknown
        confidence?: unknown
        issues?: unknown
      }
      const verdict = parsed.verdict === 'pass' || parsed.verdict === 'fail' ? parsed.verdict : null
      if (!verdict) continue
      const confidence = typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
        ? Math.min(1, Math.max(0, parsed.confidence))
        : null
      const issues: VerifierIssue[] = Array.isArray(parsed.issues)
        ? (parsed.issues as Array<Record<string, unknown>>)
            .filter((i) => i && typeof i.description === 'string' && typeof i.correction === 'string')
            .map((i) => ({
              severity: i.severity === 'critical' || i.severity === 'major' ? i.severity : 'minor',
              type: typeof i.type === 'string' ? (i.type as VerifierIssue['type']) : 'requirement',
              description: String(i.description).slice(0, 2_000),
              correction: String(i.correction).slice(0, 2_000),
            }))
        : []
      return { verdict, confidence: confidence ?? (verdict === 'pass' ? 0.5 : 0.1), issues }
    } catch {
      /* try the next candidate */
    }
  }
  return null
}

// ---- the bounded loop ----------------------------------------------------------

/**
 * Verify the draft and, when the verifier identifies critical/major issues,
 * run a corrective revision and re-verify — all inside the configured bounds.
 */
export async function verifyAndCorrect(args: VerifyAndCorrectArgs): Promise<VerificationOutcome> {
  const t0 = Date.now()
  const { config, ctx } = args
  if (!config.enabled) {
    return { status: 'skipped', finalContent: args.draft, attempts: 0, corrections: 0, issuesFound: 0, confidence: null, durationMs: Date.now() - t0, reason: null }
  }

  const ensureAlive = (): void => {
    if (args.guard?.aborted) throw new ClientDisconnectedError()
  }

  let current = args.draft
  let attempts = 0
  let corrections = 0
  let last: VerifierReport | null = null
  let status: VerificationStatus = 'unverified'
  let reason: string | null = null
  /** A fail on the FINAL allowed pass leaves the revised (or draft) answer
   *  shipping as corrected-unverified — issues were already acted on. */
  let revisedAndUnconfirmed = false
  /** Corrective revisions are bounded by BOTH the attempt budget (a revision
   *  always consumes one verification attempt after it) and the operator's
   *  regeneration limit — two independent clamps; neither can loop. */
  const revisionBudget = Math.max(0, Math.min(config.maxAttempts - 1, config.regenerationLimit))

  while (attempts < config.maxAttempts) {
    ensureAlive()
    attempts += 1
    args.onStage?.('verifying')
    last = await runVerifierPass(args.originalRequest, current, config, ctx)

    if (last === null) {
      // Verifier unavailable or unusable output — honest uncertainty, no
      // correction decision can be made from nothing.
      status = corrections > 0 ? 'corrected-unverified' : 'unverified'
      reason = 'verifier unavailable or returned unusable output'
      break
    }

    const blocking = last.issues.filter((i) => i.severity === 'critical' || i.severity === 'major')
    if (last.verdict === 'pass' && blocking.length === 0) {
      if (last.confidence >= config.minConfidence) {
        status = corrections > 0 ? 'corrected' : 'verified'
      } else {
        // Verification ran but cannot establish correctness confidently —
        // never CLAIM verified below the threshold.
        status = corrections > 0 ? 'corrected-unverified' : 'unverified'
        reason = `verifier confidence ${(last.confidence).toFixed(2)} below threshold ${config.minConfidence}`
      }
      break
    }

    if (last.verdict === 'fail' && blocking.length > 0) {
      if (corrections >= revisionBudget) {
        // Bound reached: ship the best available answer with the honest
        // status — issues were addressed by the previous revision when one
        // ran, but the re-verification still finds blockers (or none ran).
        status = corrections > 0 ? 'corrected-unverified' : 'unverified'
        reason = revisionBudget === 0
          ? 'regeneration limit is 0 — verify-only mode with unresolved blocking issues'
          : 'verification bound reached with unresolved blocking issues'
        revisedAndUnconfirmed = corrections > 0
        break
      }
      ensureAlive()
      if (!args.streamRevision && !args.generateRevision) {
        // No revision path wired — ship the draft with the honest status.
        status = 'unverified'
        reason = 'blocking issues found but no revision path is available'
        break
      }
      args.onStage?.('revising')
      const instruction = buildRevisionInstruction(blocking)
      let revised = ''
      try {
        if (args.streamRevision) {
          for await (const delta of args.streamRevision(instruction)) {
            ensureAlive()
            revised += delta
          }
        } else {
          revised = await args.generateRevision!(instruction)
        }
      } catch (revisionError) {
        // Cancellation ALWAYS unwinds — a disconnected client must never be
        // misreported as a failed revision (the route's lifecycle depends on
        // ClientDisconnectedError propagating to the stream teardown).
        if (isGatewayCancelled(revisionError) || revisionError instanceof ClientDisconnectedError) throw revisionError
        // A failed revision leaves the draft as the best available answer.
        status = corrections > 0 ? 'corrected-unverified' : 'unverified'
        reason = 'corrective revision failed'
        break
      }
      ensureAlive()
      if (!revised.trim()) {
        // An empty revision leaves the draft as the best available answer.
        status = corrections > 0 ? 'corrected-unverified' : 'unverified'
        reason = 'corrective revision produced no usable content'
        break
      }
      current = revised
      corrections += 1
      // Loop continues to the re-verification pass when attempts remain.
      continue
    }

    // Defensive: verdict fail with minor-only issues — treat as pass-shaped.
    if (last.confidence >= config.minConfidence) {
      status = corrections > 0 ? 'corrected' : 'verified'
    } else {
      status = corrections > 0 ? 'corrected-unverified' : 'unverified'
      reason = `verifier confidence ${(last.confidence).toFixed(2)} below threshold ${config.minConfidence}`
    }
    break
  }

  if (attempts >= config.maxAttempts && last !== null && status === 'unverified' && reason === null) {
    status = revisedAndUnconfirmed || corrections > 0 ? 'corrected-unverified' : 'unverified'
    reason = 'verification bound reached'
  }

  return {
    status,
    finalContent: current,
    attempts,
    corrections,
    issuesFound: last ? last.issues.filter((i) => i.severity === 'critical' || i.severity === 'major').length : 0,
    confidence: last?.confidence ?? null,
    durationMs: Date.now() - t0,
    reason,
  }
}

/** User-facing summary — the ONLY verification data allowed into the wire/UI. */
export function publicVerificationSummary(
  outcome: VerificationOutcome | null | undefined,
): {
  status: Exclude<VerificationStatus, 'skipped'>
  attempts: number
  corrections: number
  issuesFound: number
} | null {
  if (!outcome || outcome.status === 'skipped') return null
  return {
    status: outcome.status,
    attempts: outcome.attempts,
    corrections: outcome.corrections,
    issuesFound: outcome.issuesFound,
  }
}

/** Map a pipeline error to the honest fallback: ship the draft unverified. */
export function verificationFallback(e: unknown): { reason: string } {
  const beanError = gatewayErrorFor(e)
  return { reason: `verification failed: ${beanError.code}` }
}
