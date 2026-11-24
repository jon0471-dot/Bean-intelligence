#!/usr/bin/env python3
"""M37 patch: orchestrator.ts — workflow, delegation, contradictions, task stages."""
import sys, pathlib

p = pathlib.Path('/tmp/m37-run/src/lib/riishe/orchestrator.ts')
src = p.read_text()

def sub(old, new):
    global src
    if old not in src or src.count(old) != 1:
        print(f"FAIL: anchor missing/non-unique ({src.count(old)}x):\n{old[:220]}")
        sys.exit(1)
    src = src.replace(old, new)

# ---- E1: imports -----------------------------------------------------------
sub("""import { planCapabilities } from './capability-plan'""",
"""import { planCapabilities } from './capability-plan'
import { detectSourceContradictions, describeContradiction } from './contradictions'
import { detectWorkflow } from './workflow'
import { mapRiisheStatesToOutcome } from '@/lib/trust/types'""")

sub("""import type { MessageMetadata, ResponseState, TurnTimings, VerificationCheckView } from './states'""",
"""import type { MessageMetadata, ResponseState, TaskStage, TurnTimings, VerificationCheckView } from './states'""")

# ---- E2: OrchestrationEvent gains the task-stage variant --------------------
sub("""export type OrchestrationEvent =
  | { type: 'stage'; stage: 'researching' | 'tools' | 'solving' | 'verifying' }
  | { type: 'delta'; delta: string }
  | { type: 'reset' }
  | { type: 'research'; queries: string[] }
  | { type: 'tool'; name: string; status: 'started' | 'done' | 'failed' }""",
"""export type OrchestrationEvent =
  | { type: 'stage'; stage: 'researching' | 'tools' | 'solving' | 'verifying' }
  | { type: 'delta'; delta: string }
  | { type: 'reset' }
  | { type: 'research'; queries: string[] }
  | { type: 'tool'; name: string; status: 'started' | 'done' | 'failed' }
  /**
   * M37 §5 — genuine operational task stage, emitted ONLY at real execution
   * events (workflow detection, retrieval, document reads, delegation
   * submissions, approval waits, sandbox runs, terminal outcome). Never a
   * cosmetic or model-authored progress claim.
   */
  | { type: 'task'; stage: TaskStage; detail?: string }""")

# ---- E3: selectTools — coding delegation grants (M36 two-key pattern) ------
sub("""  allowImageGeneration?: boolean
  allowVideoCreation?: boolean
  allowSpeechSynthesis?: boolean
}): string[] {""",
"""  allowImageGeneration?: boolean
  allowVideoCreation?: boolean
  allowSpeechSynthesis?: boolean
  /** M37 §3 — CODE GIFTZ engineering-workflow delegation grants (permission
   *  key AND capability plan must both agree; the orchestrator computes the
   *  AND before calling). Grants BOTH the submit and the status probe. */
  allowCodingDelegation?: boolean
}): string[] {""")

sub("""  if (args.allowImageGeneration) tools.add('generate_image')
  if (args.allowVideoCreation) tools.add('create_video')
  if (args.allowSpeechSynthesis) tools.add('synthesize_speech')
  return [...tools]""",
"""  if (args.allowImageGeneration) tools.add('generate_image')
  if (args.allowVideoCreation) tools.add('create_video')
  if (args.allowSpeechSynthesis) tools.add('synthesize_speech')
  if (args.allowCodingDelegation) {
    tools.add('delegate_coding')
    tools.add('check_coding_job')
  }
  return [...tools]""")

# ---- E4: move the capability-planning block above the retrieval decision ---
# The strict document-grounding contract must shape searchNeeded itself.
sub("""  const searchNeeded = decision.search && !isDocumentLike(userMessage)

  // ---- Injection gate (input side, BEFORE generation) ----------------------""",
"""  // ---- Tool permissions (moved ABOVE the retrieval decision for M37: the
  // strict document-grounding contract changes searchNeeded itself) --------
  // Code execution is a SERVER-SIDE policy (no composer toggle). The route
  // holds the per-request permission key; the capability planner narrows it
  // to turns where executing code genuinely helps (explicit requests,
  // simulations, heavy computation). Both must agree — this is the real
  // approval gate the tool registry enforces on every run_code call.
  const capabilityPlan = planCapabilities(userMessage, profile.task, documents.length > 0, documents.map((d) => d.kind ?? ''))
  const allowCodeExecution =
    input.toolContext?.permissions.has('allowCodeExecution') === true && capabilityPlan.codeExecution
  // M36-C — specialist delegation gating (same two-key pattern as code
  // execution): server-side permission key + per-turn capability plan must
  // BOTH agree before a delegation tool enters the model's universe.
  const allowImageGeneration =
    input.toolContext?.permissions.has('allowImageGeneration') === true && capabilityPlan.imageGeneration
  const allowVideoCreation =
    input.toolContext?.permissions.has('allowVideoCreation') === true && capabilityPlan.videoCreation
  const allowSpeechSynthesis =
    input.toolContext?.permissions.has('allowSpeechSynthesis') === true && capabilityPlan.speechSynthesis
  // M37 §3 — CODE GIFTZ delegation gating (same two-key pattern).
  const allowCodingDelegation =
    input.toolContext?.permissions.has('allowCodingDelegation') === true && capabilityPlan.codingDelegation
  // M37 §2 — STRICT document grounding: when the user asked for answers based
  // ONLY on the attached documents, web retrieval is suppressed for the turn
  // so general knowledge can never silently substitute the documents.
  const docGrounded = documents.length > 0 && capabilityPlan.docOnlyGrounding
  const searchNeeded = decision.search && !isDocumentLike(userMessage) && !docGrounded
  // M37 §4 — ONE workflow: the message spans several capability domains, so
  // the turn gets the coordination protocol and its stages are tracked.
  const workflow = detectWorkflow({
    searchNeeded,
    task: profile.task,
    hasDocuments: documents.length > 0,
    plan: capabilityPlan,
  })

  // ---- Injection gate (input side, BEFORE generation) ----------------------""")

# Remove the now-duplicated old capability-plan block.
sub("""  // ---- Tool permissions ------------------------------------------------------
  // Code execution is a SERVER-SIDE policy (no composer toggle). The route
  // holds the per-request permission key; the capability planner narrows it
  // to turns where executing code genuinely helps (explicit requests,
  // simulations, heavy computation). Both must agree — this is the real
  // approval gate the tool registry enforces on every run_code call.
  const capabilityPlan = planCapabilities(userMessage, profile.task, documents.length > 0, documents.map((d) => d.kind ?? ''))
  const allowCodeExecution =
    input.toolContext?.permissions.has('allowCodeExecution') === true && capabilityPlan.codeExecution
  // M36-C — specialist delegation gating (same two-key pattern as code
  // execution): server-side permission key + per-turn capability plan must
  // BOTH agree before a delegation tool enters the model's universe.
  const allowImageGeneration =
    input.toolContext?.permissions.has('allowImageGeneration') === true && capabilityPlan.imageGeneration
  const allowVideoCreation =
    input.toolContext?.permissions.has('allowVideoCreation') === true && capabilityPlan.videoCreation
  const allowSpeechSynthesis =
    input.toolContext?.permissions.has('allowSpeechSynthesis') === true && capabilityPlan.speechSynthesis

  // ---- Retrieve -------------------------------------------------------------""",
"""  // ---- Retrieve -------------------------------------------------------------""")

# ---- E6: task-stage recording infrastructure -------------------------------
sub("""export async function orchestrateTurn(input: OrchestrationInput): Promise<OrchestrationResult> {
  const t0 = Date.now()
  const { userMessage, history, caps, adapter, onEvent } = input
  const degraded: string[] = []
  const stages: MessageMetadata['stages'] = []""",
"""export async function orchestrateTurn(input: OrchestrationInput): Promise<OrchestrationResult> {
  const t0 = Date.now()
  const { userMessage, history, caps, adapter, onEvent } = input
  const degraded: string[] = []
  const stages: MessageMetadata['stages'] = []
  // M37 §5 — operational task stages, recorded ONLY at real execution events.
  // Each stage is emitted once per turn; the array persists in metadata so
  // the progress timeline survives conversation reloads.
  const taskStages: NonNullable<MessageMetadata['taskStages']> = []
  const seenTaskStages = new Set<string>()
  const emitTaskStage = (stage: TaskStage, detail?: string): void => {
    if (seenTaskStages.has(stage)) return
    seenTaskStages.add(stage)
    taskStages.push({ stage, at: new Date().toISOString() })
    onEvent?.({ type: 'task', stage, ...(detail !== undefined ? { detail } : {}) })
  }
  // M37 §4 — a detected multi-domain workflow genuinely enters its planning
  // stage (the composer's first pass produces the plan under the protocol).
  if (workflow.active) emitTaskStage('planning', workflow.parts.join('+'))""")

# Wait: workflow is declared AFTER the top of orchestrateTurn — the emit above
# must live after the workflow declaration. Remove it from the top and place it
# right after detectWorkflow instead.
sub("""  // M37 §4 — a detected multi-domain workflow genuinely enters its planning
  // stage (the composer's first pass produces the plan under the protocol).
  if (workflow.active) emitTaskStage('planning', workflow.parts.join('+'))

  // ---- Understand ----------------------------------------------------------""",
"""  // ---- Understand ----------------------------------------------------------""")

sub("""  const workflow = detectWorkflow({
    searchNeeded,
    task: profile.task,
    hasDocuments: documents.length > 0,
    plan: capabilityPlan,
  })
""",
"""  const workflow = detectWorkflow({
    searchNeeded,
    task: profile.task,
    hasDocuments: documents.length > 0,
    plan: capabilityPlan,
  })
  // M37 §4 — a detected multi-domain workflow genuinely enters its planning
  // stage (the composer's first pass produces the plan under the protocol).
  if (workflow.active) emitTaskStage('planning', workflow.parts.join('+'))
""")

# ---- E7: researching task stage on real retrieval --------------------------
sub("""  if (searchNeeded) {
    onEvent?.({ type: 'stage', stage: 'researching' })
    const tSearch = Date.now()""",
"""  if (searchNeeded) {
    onEvent?.({ type: 'stage', stage: 'researching' })
    emitTaskStage('researching')
    const tSearch = Date.now()""")

# ---- E8: system prompt context ---------------------------------------------
sub("""        responseMode,
        sensitiveCase,
        hasImages: documents.some((d) => d.kind === 'image'),
        userLanguage: LANGUAGE_NAMES[langProfile.primary],
        toolNames: finalToolsActive ? finalToolNames : undefined,
      },""",
"""        responseMode,
        sensitiveCase,
        hasImages: documents.some((d) => d.kind === 'image'),
        userLanguage: LANGUAGE_NAMES[langProfile.primary],
        toolNames: finalToolsActive ? finalToolNames : undefined,
        // M37 §2 — multi-document comparison + strict grounding contracts.
        multiDoc: documents.length > 1,
        docGrounded,
        // M37 §4 — the coordination protocol for multi-domain turns.
        ...(workflow.active ? { workflow: { parts: workflow.parts } } : {}),
      },""")

# ---- E9: selectTools call gains the delegation grant ------------------------
sub("""    allowImageGeneration,
    allowVideoCreation,
    allowSpeechSynthesis,
  })
  const finalToolsActive = finalToolNames.length > 0 && input.toolContext != null""",
"""    allowImageGeneration,
    allowVideoCreation,
    allowSpeechSynthesis,
    allowCodingDelegation,
  })
  const finalToolsActive = finalToolNames.length > 0 && input.toolContext != null""")

# ---- E10: tool-loop events → task stages -----------------------------------
sub("""      onToolEvent: (e) => onEvent?.({ type: 'tool', name: e.name, status: e.status }),""",
"""      onToolEvent: (e) => {
        onEvent?.({ type: 'tool', name: e.name, status: e.status })
        // M37 §5 — real tool starts map to honest operational stages.
        if (e.status === 'started') {
          if (e.name === 'read_document' || e.name === 'analyze_image') emitTaskStage('reading-documents')
          else if (e.name === 'delegate_coding') emitTaskStage('delegating')
          else if (e.name === 'run_code') emitTaskStage('executing')
        }
      },""")

# ---- E11: approval-waiting parsed from the REAL check tool output -----------
sub("""    stages.push({ stage: 'tools', durationMs: Date.now() - tTools })
    toolExecutions = loop.executions
    degraded.push(...loop.degraded)
    solveResult = { content: loop.content, streamed: false }""",
"""    stages.push({ stage: 'tools', durationMs: Date.now() - tTools })
    toolExecutions = loop.executions
    degraded.push(...loop.degraded)
    // M37 §5 — a delegated job that is WAITING FOR APPROVAL is a real
    // operational state, parsed from the status probe's ACTUAL output.
    const waitingApproval = toolExecutions.some(
      (e) => e.tool === 'check_coding_job' && e.ok && e.output.includes('WAITING FOR APPROVAL'),
    )
    if (waitingApproval) emitTaskStage('approval-waiting')
    solveResult = { content: loop.content, streamed: false }""")

# ---- E12: cross-source contradiction scan ----------------------------------
sub("""  const dedupedUniverse = dedupeSourcesWithMap(auditUniversePre)
  const auditUniverse: AuditSource[] = dedupedUniverse.kept""",
"""  const dedupedUniverse = dedupeSourcesWithMap(auditUniversePre)
  const auditUniverse: AuditSource[] = dedupedUniverse.kept
  // M37 §1 — cross-source claim comparison over the ACTUAL retrieved text:
  // two different sources stating different figures/dates for the same
  // entity is surfaced as an unresolved disagreement (never silently
  // resolved, never flagged when the evidence is silent).
  const sourceContradictions = auditUniverse.length >= 2 && !injectionBlocked
    ? detectSourceContradictions(auditUniverse.map((s) => ({ id: s.id, title: s.title, snippet: s.snippet, excerpt: s.excerpt })))
    : []""")

# ---- E13: contradiction guidance rides the existing bounded repair pass ----
sub("""    const repairItems: string[] = []
    if (initialSupport.unsupported.length > 0) {""",
"""    const repairItems: string[] = []
    if (sourceContradictions.length > 0) {
      repairItems.push(
        'the retrieved sources themselves DISAGREE on the following points — state each disagreement explicitly, attribute every version to its source [n], and never silently pick one:\n' +
          sourceContradictions.map((c) => `- ${describeContradiction(c)}`).join('\n'),
      )
    }
    if (initialSupport.unsupported.length > 0) {""")

# ---- E14: verification check row for contradictions -------------------------
sub("""  if (staleCurrency && researchRan) {
    verification.push({
      check: 'claim currency',
      status: 'warning',
      detail: staleCurrency,
    })
  }""",
"""  if (staleCurrency && researchRan) {
    verification.push({
      check: 'claim currency',
      status: 'warning',
      detail: staleCurrency,
    })
  }
  if (sourceContradictions.length > 0) {
    // M37 §1 — claim comparison/contradiction identification, from the real
    // evidence text only. A warning, never a silent resolution.
    verification.push({
      check: 'cross-source consistency',
      status: 'warning',
      detail: `the retrieved sources disagree: ${sourceContradictions.map(describeContradiction).join('; ')}`.slice(0, 580),
    })
  }""")

# ---- E15: terminal task stage from the SAME response states -----------------
# Placed AFTER statesFrom() so the mapping reads the real states (the
# Wire-accuracy reset block above runs earlier in the file by design).
sub("""  const states = statesFrom(searchNeeded, pack, citationsValid, computation, degraded, ranCode, support)""",
"""  const states = statesFrom(searchNeeded, pack, citationsValid, computation, degraded, ranCode, support)

  // M37 §5 — the terminal task stage derives from the SAME response states
  // (assigned from actual execution) through the SAME trust mapping — never
  // from the model's own claim, and never manufactured when nothing ran.
  if (finalContent.trim().length > 0) {
    const outcome = mapRiisheStatesToOutcome(states, true)
    emitTaskStage(
      outcome.outcome === 'completed'
        ? 'completed'
        : outcome.outcome === 'failed'
          ? 'failed'
          : 'completed-with-limitations',
    )
  }""")

# ---- E16: verification note gains the contradiction line --------------------
sub("""  const verificationNote = buildVerificationNote({""",
"""  const contradictionNote = sourceContradictions.length > 0
    ? `the retrieved sources disagree on ${sourceContradictions.length} point${sourceContradictions.length === 1 ? '' : 's'} (${sourceContradictions.map(describeContradiction).join('; ')})`
    : null
  const verificationNote = buildVerificationNote({""")

sub("""    pageTextUnavailable: degraded.some(
      (d) => d.includes('page read failed') || d.includes('error or blocked page'),
    ),
  })""",
"""    pageTextUnavailable: degraded.some(
      (d) => d.includes('page read failed') || d.includes('error or blocked page'),
    ),
  })
  // M37 §1 — the note carries unresolved source disagreements too.
  const verificationNoteCombined =
    [verificationNote, contradictionNote].filter(Boolean).join('. ') || null""")

sub("""    ...(verificationNote ? { verificationNote } : {}),""",
"""    ...(verificationNoteCombined ? { verificationNote: verificationNoteCombined } : {}),""")

# ---- E17: metadata additions ------------------------------------------------
sub("""    ...(injectionBlocked ? { injectionBlocked: true } : {}),""",
"""    ...(injectionBlocked ? { injectionBlocked: true } : {}),
    // M37 §5 — the operational stages this turn REALLY went through.
    ...(taskStages.length > 0 ? { taskStages } : {}),
    // M37 §4 — multi-domain workflow provenance (deterministic detection).
    ...(workflow.active ? { workflow: { parts: [...workflow.parts] } } : {}),
    // M37 §2 — the turn was served under the strict documents-only contract.
    ...(docGrounded ? { docGrounded: true } : {}),""")

p.write_text(src)
print("orchestrator.ts patched OK")
