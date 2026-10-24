/**
 * BEAN Intelligence — RIISHE orchestration pipeline.
 *
 * Understand -> Retrieve -> Solve -> Verify -> Respond
 *
 *  - Understand: deterministic task classification + freshness-risk policy.
 *  - Retrieve: REAL web research through the authorized gateway (only when
 *    the query warrants it). Failures degrade honestly.
 *  - Solve: capability-validated hosted model call with the task-appropriate
 *    prompt protocol and thinking mode.
 *  - Verify: deterministic arithmetic re-evaluation of the solver's
 *    SELF_CHECK expressions + citation integrity audit against the actual
 *    evidence pack. Bounded single re-solve on failed math verification.
 *  - Respond: post-processed answer (fabricated URLs stripped, internal
 *    check block lifted into a verification summary) + response states
 *    assigned ONLY from actual execution evidence.
 *
 * The orchestrator NEVER fabricates: tool failures, empty evidence and
 * unverifiable answers are surfaced as degraded states, not hidden.
 */
import type { TaskAdapter } from '@/lib/adapters/types'
import type { ChatTurn } from '@/lib/adapters/types'
import { withTimeout } from '@/lib/adapters/hosted-llm'
import { shouldSearch, isDocumentLike } from '@/lib/research/policy'
import { runResearch, formatEvidenceBlock, type EvidencePack } from '@/lib/research/pipeline'
import { classifyTask, assertCapability, CHAT_BACKEND_CAPABILITIES, type TaskProfile } from './classify'
import { BeanApiError } from '@/lib/api/errors'
import { buildSystemPrompt, buildUserTurn } from './prompts'
import { parseSelfCheck, verifyComputations, type ComputationCheck } from '@/lib/verify/exprcheck'
import { auditCitations, stripFabricatedUrls } from '@/lib/verify/citations'
import type { MessageMetadata, ResponseState, VerificationCheckView } from './states'

export type OrchestrationEvent =
  | { type: 'stage'; stage: 'researching' | 'solving' | 'verifying' }
  | { type: 'delta'; delta: string }
  | { type: 'research'; queries: string[] }

export interface OrchestrationInput {
  userMessage: string
  history: ChatTurn[]
  caps: { maxPromptChars: number; maxHistoryMessages: number }
  adapter: TaskAdapter
  /** Streams deltas and stage events when the caller wants SSE. */
  onEvent?: (e: OrchestrationEvent) => void
  /** Capability list of the selected backend; the classified task must be
   *  declared here or the turn is refused (no silent substitution). */
  backendCapabilities?: readonly string[]
  /** Force the non-streaming adapter call (JSON path). */
  nonStreaming?: boolean
}

export interface OrchestrationResult {
  content: string
  metadata: MessageMetadata
  searchRan: boolean
  /** Aggregated token estimates for metering (all inference calls). */
  tokensInEst: number
  tokensOutEst: number
  durationMs: number
  task: TaskProfile['task']
}

function statesFrom(
  profile: TaskProfile,
  searchNeeded: boolean,
  pack: EvidencePack | null,
  citationsValid: boolean | null,
  computation: ComputationCheck | null,
  degraded: string[],
): ResponseState[] {
  const states = new Set<ResponseState>()
  const searchFailed = searchNeeded && pack !== null && pack.sources.length === 0 && pack.degraded.length > 0
  if (searchFailed) states.add('TOOL_UNAVAILABLE')

  const computationVerified = computation?.ran === true && computation.passed
  const computationFailed = computation?.ran === true && !computation.passed
  if (computationVerified) states.add('COMPUTATION_VERIFIED')

  const hasSources = (pack?.sources.length ?? 0) > 0
  if (hasSources && citationsValid === true) states.add('VERIFIED_FROM_SOURCES')

  if (computationFailed) states.add('PARTIALLY_VERIFIED')
  else if (hasSources && citationsValid === false) states.add('PARTIALLY_VERIFIED')

  if (states.size === 0) states.add('UNVERIFIED')
  return [...states]
}

export async function orchestrateTurn(input: OrchestrationInput): Promise<OrchestrationResult> {
  const t0 = Date.now()
  const { userMessage, history, caps, adapter, onEvent } = input
  const degraded: string[] = []
  const stages: MessageMetadata['stages'] = []

  // ---- Understand ----------------------------------------------------------
  const profile = classifyTask(userMessage)
  if (input.backendCapabilities) {
    try {
      assertCapability(input.backendCapabilities, profile.task)
    } catch {
      throw new BeanApiError(
        'CAPABILITY_UNSUPPORTED',
        'The selected backend does not declare support for this task type.',
      )
    }
  }
  const decision = shouldSearch(userMessage)
  const searchNeeded = decision.search && !isDocumentLike(userMessage)

  // ---- Retrieve -------------------------------------------------------------
  let pack: EvidencePack | null = null
  if (searchNeeded) {
    onEvent?.({ type: 'stage', stage: 'researching' })
    const tSearch = Date.now()
    pack = await runResearch(userMessage, decision)
    stages.push({ stage: 'researching', durationMs: Date.now() - tSearch })
    degraded.push(...pack.degraded)
    onEvent?.({ type: 'research', queries: pack.queries })
  } else {
    degraded.push(`search not warranted: ${decision.reason}`)
  }
  const evidenceBlock = pack ? formatEvidenceBlock(pack) : null

  // ---- Solve ----------------------------------------------------------------
  const systemPrompt = buildSystemPrompt({ evidenceBlock, task: profile.task, staleness: pack?.staleness ?? null })
  let userTurn = buildUserTurn(userMessage, {
    evidenceBlock: evidenceBlock ? evidenceBlock : null,
    task: profile.task,
    staleness: pack?.staleness ?? null,
  })
  if (searchNeeded && pack && pack.sources.length === 0) {
    userTurn +=
      '\n\nNOTE: live research was requested but every search tool failed. State plainly that you could ' +
      'not verify current information in this reply, and answer from stable knowledge with explicit uncertainty.'
  }

  const baseMessages: ChatTurn[] = [
    { role: 'assistant', content: systemPrompt },
    ...history.slice(-caps.maxHistoryMessages),
    { role: 'user', content: userTurn },
  ]

  const runSolve = async (messages: ChatTurn[]): Promise<{ content: string; streamed: boolean }> => {
    onEvent?.({ type: 'stage', stage: 'solving' })
    if (input.nonStreaming) {
      const result = await withTimeout(
        adapter.chat!({
          messages,
          maxPromptChars: caps.maxPromptChars,
          maxHistoryMessages: caps.maxHistoryMessages,
          timeoutMs: 90_000,
          thinkingEnabled: profile.thinkingEnabled,
        }),
        90_000,
        'RIISHE',
      )
      return { content: result.content, streamed: false }
    }
    let full = ''
    for await (const delta of adapter.chatStream!({
      messages,
      maxPromptChars: caps.maxPromptChars,
      maxHistoryMessages: caps.maxHistoryMessages,
      timeoutMs: 90_000,
      thinkingEnabled: profile.thinkingEnabled,
    })) {
      full += delta
      onEvent?.({ type: 'delta', delta })
    }
    if (!full.trim()) throw new Error('Upstream returned an empty completion')
    return { content: full, streamed: true }
  }

  let solveResult = await runSolve(baseMessages)

  // ---- Verify ---------------------------------------------------------------
  onEvent?.({ type: 'stage', stage: 'verifying' })
  const tVerify = Date.now()

  // 1. arithmetic verification (deterministic, in-process safe evaluator)
  let computation: ComputationCheck | null = null
  let finalContent = solveResult.content
  if (profile.verifyMath) {
    const checks = parseSelfCheck(finalContent)
    if (checks.length > 0) {
      computation = await verifyComputations(checks)
      if (computation.ran && !computation.passed) {
        // bounded single re-solve with the verification evidence fed back
        const failed = computation.results
          .filter((r) => !r.match)
          .map((r) => `CHECK: ${r.expr} = ${r.claimed} -> evaluated to ${r.actual ?? r.error}`)
          .join('\n')
        const retryMessages: ChatTurn[] = [
          ...baseMessages,
          { role: 'assistant', content: finalContent },
          {
            role: 'user',
            content:
              "BEAN's independent arithmetic verifier evaluated your SELF_CHECK block and found mismatches:\n" +
              `${failed}\n\nRe-derive the solution and return the COMPLETE corrected answer with a corrected ` +
              'SELF_CHECK block. If a value cannot be established, say so explicitly.',
          },
        ]
        solveResult = await runSolve(retryMessages)
        finalContent = solveResult.content
        const rechecks = parseSelfCheck(finalContent)
        if (rechecks.length > 0) computation = await verifyComputations(rechecks)
      }
    }
  }
  stages.push({ stage: 'verifying', durationMs: Date.now() - tVerify })

  // 2. citation integrity audit against the ACTUAL evidence
  let citationsValid: boolean | null = null
  if (pack && pack.sources.length > 0) {
    const audit = auditCitations(finalContent, pack.sources)
    citationsValid =
      audit.invalidIds.length === 0 && audit.fabricatedUrls.length === 0 && audit.usedSources.length > 0
    const stripped = stripFabricatedUrls(finalContent, pack.sources)
    finalContent = stripped.text
    if (stripped.removed.length > 0) {
      degraded.push(`${stripped.removed.length} non-evidence URL(s) removed by citation validation`)
    }
    if (audit.uncitedEvidence) {
      degraded.push('evidence was retrieved but the answer cites none of it')
    }
  }

  // 3. lift the raw SELF_CHECK block out of the customer-visible answer
  finalContent = liftSelfCheck(finalContent)

  // ---- Respond ---------------------------------------------------------------
  const states = statesFrom(profile, searchNeeded, pack, citationsValid, computation, degraded)

  const verification: VerificationCheckView[] = []
  if (computation?.ran) {
    for (const r of computation.results) {
      verification.push({
        check: `arithmetic: ${r.expr}`,
        status: r.match ? 'passed' : 'failed',
        detail: `claimed ${r.claimed} -> evaluated ${r.actual ?? r.error}`,
      })
    }
  } else if (profile.verifyMath) {
    verification.push({
      check: 'arithmetic re-evaluation',
      status: 'not_applicable',
      detail: 'the solver emitted no checkable SELF_CHECK expressions',
    })
  }
  if (pack && pack.sources.length > 0) {
    verification.push({
      check: 'citation integrity',
      status: citationsValid === true ? 'passed' : citationsValid === false ? 'failed' : 'not_applicable',
      detail:
        citationsValid === true
          ? 'all citation markers resolve to retrieved sources'
          : citationsValid === false
            ? 'some citations did not resolve to retrieved evidence'
            : 'answer contained no citation markers',
    })
    if (pack.staleness) {
      verification.push({ check: 'source freshness', status: 'passed', detail: pack.staleness })
    }
  }

  const metadata: MessageMetadata = {
    states,
    sources: (pack?.sources ?? []).map((s) => ({
      id: s.id,
      title: s.title,
      url: s.url,
      hostName: s.hostName,
      date: s.date,
      official: s.official,
      pageRead: s.pageRead,
    })),
    verification: verification.filter((v) => v.status !== 'not_applicable'),
    stages,
    degraded,
  }

  // token estimates: solver call(s) — prompt (system+history+turn) and outputs
  const promptChars =
    systemPrompt.length +
    userTurn.length +
    history.reduce((n, m) => n + m.content.length, 0)
  const tokensInEst = Math.ceil(promptChars / 4)
  const tokensOutEst = Math.ceil(finalContent.length / 4)

  return {
    content: finalContent,
    metadata,
    searchRan: searchNeeded,
    tokensInEst,
    tokensOutEst,
    durationMs: Date.now() - t0,
    task: profile.task,
  }
}

/** Remove the raw SELF_CHECK block from the visible answer. */
export function liftSelfCheck(content: string): string {
  return content
    .replace(/SELF_CHECK:?\s*\n[\s\S]*?(?:\n\s*\n|$)/i, '')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()
}
