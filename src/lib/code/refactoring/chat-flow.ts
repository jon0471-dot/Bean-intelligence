/**
 * BEAN Intelligence — CODE GIFTZ refactoring chat flow (M25).
 *
 * The chat-side orchestration for a detected refactoring request, mirroring
 * M23's `performDetectedFileOperation` pattern:
 *   - deterministic kinds (rename-symbol, move-module): planned straight from
 *     the real file set — ZERO provider involvement, zero token cost;
 *   - provider-assisted kinds: one bounded drafting pass through the EXISTING
 *     adapter, then server-side validation into a plan. The draft never
 *     touches the workspace; execution requires explicit approval through the
 *     confirmation endpoint bound to the plan hash.
 *
 * Every failure path returns an HONEST payload (rejected / clarification /
 * failed) — nothing is silently downgraded to success, and a provider failure
 * during drafting leaves the workspace untouched.
 *
 * SERVER-ONLY.
 */
import { FileOpError } from '@/lib/code/file-ops/types'
import type { TaskAdapter } from '@/lib/adapters/types'
import { buildProjectGraph, dependencyCone, RefactorScopeError } from './graph'
import { buildDeterministicRefactorPlan, detectRefactoringRequest, type RefactorDetection } from './detect'
import { assembleAssistedPlan, correctiveDraftCharBudget, draftRefactoringPatch } from './assisted'
import {
  planEditsPreview,
  refactorConsequence,
  validateRefactorPlan,
  type RefactorPlan,
  type RefactorTurnPayload,
} from './plan'
import { createRefactorOperation, refactorAssistantText } from './execute'

export type RefactorFlowResult = {
  payload: RefactorTurnPayload
  assistantText: string
  /** Honest token estimate — non-zero only for provider-assisted drafting. */
  tokensInEst: number
  tokensOutEst: number
  /** Honest provider-call count (deterministic = 0; assisted = 1–2 with the
   *  bounded corrective pass). Recorded for cost/usage evidence. */
  providerCalls: number
}

function mapFileOpError(e: FileOpError): RefactorFlowResult {
  const payload: RefactorTurnPayload =
    e.code === 'NOT_FOUND'
      ? { status: 'clarification', question: e.message }
      : { status: 'rejected', reason: e.message }
  return { payload, assistantText: refactorAssistantText(payload), tokensInEst: 0, tokensOutEst: 0, providerCalls: 0 }
}

function planToPayload(plan: RefactorPlan, opId: string, planHash: string, status: RefactorTurnPayload['status'] = 'awaiting_confirmation'): RefactorTurnPayload {
  return {
    status,
    kind: plan.kind,
    opId,
    planHash,
    title: plan.title,
    engine: plan.engine,
    reason: plan.reason,
    steps: plan.steps,
    affectedFiles: plan.edits.map((e) => e.path).sort(),
    createdPaths: plan.createdPaths,
    editsPreview: planEditsPreview(plan),
    risks: plan.risks,
    unresolved: plan.unresolved,
    consequence: refactorConsequence(plan),
  }
}

export type RefactorFlowArgs = {
  projectId: string
  message: string
  files: Array<{ path: string; content: string }>
  /** Provider-assisted drafting needs the adapter + backend limits. When
   *  omitted, assisted kinds are rejected honestly (no provider slot). */
  adapter?: TaskAdapter
  backendRequestMs?: number
  maxPromptChars?: number
  /** Optional pre-resolved detection (the caller already ran the detector). */
  detection?: RefactorDetection
}

/**
 * Plan (never execute) the refactoring requested by a chat message.
 * Deterministic kinds build the plan server-side; assisted kinds run ONE
 * bounded provider drafting pass and validate it into a plan.
 */
export async function performDetectedRefactoring(args: RefactorFlowArgs): Promise<RefactorFlowResult> {
  const detection = args.detection ?? detectRefactoringRequest(args.message, args.files)
  if (!detection.detected) {
    throw new FileOpError('INVALID', 'No refactoring request was detected.')
  }
  if (detection.type === 'clarification') {
    const payload: RefactorTurnPayload = { status: 'clarification', question: detection.question }
    return { payload, assistantText: refactorAssistantText(payload), tokensInEst: 0, tokensOutEst: 0, providerCalls: 0 }
  }

  // ---- deterministic kinds ---------------------------------------------------
  if (detection.kind === 'rename-symbol' || detection.kind === 'move-module') {
    try {
      const plan = buildDeterministicRefactorPlan(detection, args.files)
      const safety = validateRefactorPlan(plan, args.files)
      if (!safety.ok) {
        const payload: RefactorTurnPayload = {
          status: 'rejected',
          kind: plan.kind,
          reason: `The plan failed server-side validation against the current project: ${[...safety.stale, ...safety.conflicts, ...safety.symbolCollisions, ...safety.errors][0]}`,
        }
        return { payload, assistantText: refactorAssistantText(payload), tokensInEst: 0, tokensOutEst: 0, providerCalls: 0 }
      }
      const { opId, planHash } = await createRefactorOperation(args.projectId, plan)
      const payload = planToPayload(plan, opId, planHash)
      return { payload, assistantText: refactorAssistantText(payload), tokensInEst: 0, tokensOutEst: 0, providerCalls: 0 }
    } catch (e) {
      if (e instanceof FileOpError) return mapFileOpError(e)
      throw e
    }
  }

  // ---- provider-assisted kinds -------------------------------------------------
  if (!args.adapter) {
    const payload: RefactorTurnPayload = {
      status: 'failed',
      kind: detection.kind,
      reason: 'No coding backend is available for the drafting pass — the refactoring cannot be planned right now. Deterministic operations (rename/move with import updates) remain available.',
    }
    return { payload, assistantText: refactorAssistantText(payload), tokensInEst: 0, tokensOutEst: 0, providerCalls: 0 }
  }
  let providerCalls = 0
  try {
    const graph = buildProjectGraph(args.files)
    const scopeRoots = detection.scopeRoots ?? []
    // Drafting scope = the SAME dependency cone the validator enforces (the
    // roots plus what imports them and what they import). A relocation's
    // required edits live in the UP-cone (its importers) — drafting from the
    // bare roots produced incomplete relocations (measured live-acceptance
    // failure: the model cannot update importers it was never shown). Roots
    // ride first, then the rest of the cone in deterministic path order; the
    // adapter-side character budget omits what does not fit (the server's
    // deterministic importer completion covers verified omissions).
    const cone = new Set<string>(scopeRoots)
    if (scopeRoots.length > 0) {
      for (const p of dependencyCone(graph, scopeRoots, 'down')) cone.add(p)
      for (const p of dependencyCone(graph, scopeRoots, 'up')) cone.add(p)
    }
    const scopeFiles = [
      ...args.files.filter((f) => scopeRoots.includes(f.path)),
      ...args.files
        .filter((f) => cone.has(f.path) && !scopeRoots.includes(f.path))
        .sort((a, b) => a.path.localeCompare(b.path)),
    ]
    const draftArgs = {
      adapter: args.adapter,
      backendRequestMs: args.backendRequestMs ?? 120_000,
      maxPromptChars: args.maxPromptChars ?? 12_000,
      kind: detection.kind,
      request: detection.request,
      scopeFiles,
    }
    const draft = await draftRefactoringPatch(draftArgs)
    providerCalls = 1
    let plan: RefactorPlan
    try {
      plan = assembleAssistedPlan({
        kind: detection.kind,
        title: titleFor(detection.kind, detection.request),
        reason: detection.request.slice(0, 200),
        request: detection.request,
        files: args.files,
        graph,
        scopeRoots,
        draft: draft.draft,
      }).plan
    } catch (assembleError) {
      // ONE bounded corrective re-draft (the established draft → validate →
      // correct pattern): the validation failure becomes feedback, never a
      // silent retry loop. A second rejection fails honestly. Measured
      // failure classes addressed here: the corrected answer must be FENCES
      // ONLY (a prose-only answer is unusable by construction), and the
      // model corrects far more reliably from its OWN previous draft than
      // from a cold restart.
      if (!(assembleError instanceof FileOpError)) throw assembleError
      const correction = await draftRefactoringPatch({
        ...draftArgs,
        extraContext: [
          'CORRECTION REQUIRED — your previous draft was REJECTED by server-side validation:',
          `"${assembleError.message.slice(0, 300)}"`,
          'Fix EXACTLY this problem. Answer ONLY with path-tagged fences (```lang path=...) — one per changed or created file — plus one short summary paragraph. NEVER answer with prose alone; an answer without fences is unusable.',
          'YOUR PREVIOUS DRAFT (correct it: keep every fence that was already valid, add the missing fences, then re-emit the COMPLETE corrected draft):',
          // Budgeted by the adapter's per-message limit: an oversized slice
          // pushes the contract past the truncation point (measured failure).
          draft.rawContent.slice(0, correctiveDraftCharBudget(draftArgs.maxPromptChars)),
          'Reminder: when a symbol MOVES to a new file, its declaration must be REMOVED from the old file — the same export must never exist in two files, and EVERY importer of the moved symbols must be re-emitted importing the new location.',
        ].join('\n'),
      })
      providerCalls = 2
      plan = assembleAssistedPlan({
        kind: detection.kind,
        title: titleFor(detection.kind, detection.request),
        reason: detection.request.slice(0, 200),
        request: detection.request,
        files: args.files,
        graph,
        scopeRoots,
        draft: correction.draft,
      }).plan
      plan.notes.push(`Drafted after 1 bounded corrective pass (first draft rejected: ${assembleError.message.slice(0, 140)}).`)
    }
    const { opId, planHash } = await createRefactorOperation(args.projectId, plan)
    const payload = planToPayload(plan, opId, planHash)
    return {
      payload,
      assistantText: refactorAssistantText(payload),
      tokensInEst: draft.tokensInEst + (providerCalls > 1 ? draft.tokensInEst : 0),
      tokensOutEst: draft.tokensOutEst + (providerCalls > 1 ? draft.tokensOutEst : 0),
      providerCalls,
    }
  } catch (e) {
    // M26 (audit R-1): scope refusals surface as honest typed rejections
    if (e instanceof RefactorScopeError) {
      const payload: RefactorTurnPayload = { status: 'rejected', reason: e.message }
      return { payload, assistantText: refactorAssistantText(payload), tokensInEst: 0, tokensOutEst: 0, providerCalls: 0 }
    }
    if (e instanceof FileOpError) return mapFileOpError(e)
    throw e // provider failures propagate as their typed classes (honest frames)
  }
}

function titleFor(kind: RefactorPlan['kind'], request: string): string {
  const short = request.length > 60 ? `${request.slice(0, 57)}…` : request
  const prefix: Record<string, string> = {
    'extract-component': 'Extract component',
    'extract-module': 'Extract module',
    'service-layer': 'Service-layer extraction',
    consolidate: 'Consolidate repeated structures',
    restructure: 'Folder restructuring',
    repair: 'Targeted repair',
  }
  return `${prefix[kind] ?? kind}: ${short}`
}
