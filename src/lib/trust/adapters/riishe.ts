/**
 * BEAN Intelligence — RIISHE background-turn Trust Engine adapter.
 *
 * Turns every background RIISHE chat job into a real, inspectable execution
 * receipt: the orchestration stages become steps, retrieved sources and tool
 * executions become evidence rows with provenance, and the final outcome is
 * derived ONLY from the response states that the orchestrator assigned from
 * actual execution (src/lib/riishe/states.ts honesty contract).
 *
 * Best-effort by contract: recording failures are logged and never break the
 * user's turn — the conversation pipeline stays authoritative. Every method
 * is safe to call after a failed begin() (it degrades to a no-op).
 *
 * SERVER-ONLY.
 */

import { logger } from '@/lib/observability/logger'
import { db } from '@/lib/db'
import type { OrchestrationEvent } from '@/lib/riishe/orchestrator'
import {
  TRUST_LIMITS,
  mapRiisheStatesToOutcome,
  type TrustStepKind,
} from '@/lib/trust/types'
import { addTrustEvidence, finalizeTrustTask, planTrustSteps, startTrustTask, updateTrustStepStatus } from '@/lib/trust/tasks'
import { cancelTrustTask, failTrustTask } from '@/lib/trust/tasks'
import { registerResumableKind, writeResumeCheckpoint } from '@/lib/trust/resume'

/**
 * The RIISHE background-turn pipeline is checkpoint-resumable: the recorder
 * persists a safe checkpoint after every step the ledger shows `done`, and
 * recovery refuses to blindly re-run an interrupted step (stages are NOT
 * declared idempotent — an interrupted stage is truthfully failed and the
 * receipt reflects that). Registered here so resume support is exactly as
 * broad as the executors that actually checkpoint.
 */
registerResumableKind('chat', { retryRunningStep: false })

/** Structural view of the orchestrator metadata we may attach as evidence. */
interface RiisheMetadataLike {
  states?: string[]
  verificationNote?: string | null
  degraded?: string[]
  sources?: Array<{
    title?: string
    url?: string
    hostName?: string
    pageRead?: boolean
    reach?: { channel: string; backend: string | null; engine: string }
    readEngine?: string
  }>
  toolRuns?: Array<{ tool?: string; ok?: boolean; durationMs?: number }>
}

interface RiisheResultLike {
  content?: string
  metadata?: RiisheMetadataLike
}

interface MemoryOutcomeLike {
  content?: string
  meta?: { memoryAction?: { action?: string; count?: number; refused?: boolean; conflictCount?: number } | null }
}

const SOURCE_EVIDENCE_CAP = 16

/** The four orchestration stages → receipt steps. */
const STAGE_TO_STEP: Record<string, TrustStepKind> = {
  researching: 'retrieval',
  tools: 'tool',
  solving: 'generation',
  verifying: 'verification',
}

type OrchestratedStepKind = Extract<TrustStepKind, 'retrieval' | 'tool' | 'generation' | 'verification'>

const STEP_SEQ: Record<OrchestratedStepKind, number> = {
  retrieval: 1,
  tool: 2,
  generation: 3,
  verification: 4,
}

export interface RiisheTurnRecorderInput {
  /** GenerationJob id for background turns; null/omitted for interactive turns. */
  jobId?: string | null
  userId: string
  message: string
  conversationId: string
}

export interface RiisheTurnRecorder {
  readonly taskId: string | null
  /** Create the task + planned steps and start it (best-effort). */
  begin(): Promise<void>
  /** Attach document evidence for turns that carried attached documents. */
  addDocuments(docs: Array<{ id: string; name: string; truncated: boolean; note: string | null }>): Promise<void>
  /** Observe an orchestration event (stage/tool/research) into the ledger. */
  onEvent(e: OrchestrationEvent): void
  /**
   * M37 §5 — observe an operational task-stage event (planning, delegating,
   * approval-waiting, …) into the ledger. Real events only: each observed
   * stage records ledger rows (a workflow-planning evidence row, a delivery
   * step for an actual coding delegation, an approval step for a REAL
   * waiting_for_approval state). Best-effort like every recorder method.
   */
  onTaskEvent(e: { stage: string; detail?: string }): void
  /** Settle as an honestly-derived outcome after a completed turn. */
  complete(result: RiisheResultLike, info: { persisted: boolean }): Promise<void>
  /** Settle a memory-command turn (real database action, confirmed to the user). */
  completeMemory(memoryOutcome: MemoryOutcomeLike): Promise<void>
  /** Settle as cancelled. */
  cancelled(): Promise<void>
  /** Settle as failed with the truthful failure classification. */
  failed(failure: { errorCode?: string | null; errorMessage?: string | null }): Promise<void>
}

export function createRiisheTurnRecorder(input: RiisheTurnRecorderInput): RiisheTurnRecorder {
  let taskId: string | null = null
  let lastRunningStage: TrustStepKind | null = null
  let toolNames: string[] = []
  // M37 §5 — delegation/approval bookkeeping (single step per kind, appended
  // AFTER the four fixed orchestration steps so seqs stay monotonic).
  let deliveryStepSeq: number | null = null
  let approvalStepSeq: number | null = null
  let workflowRecorded = false
  // M37: task events arrive as fire-and-forget chains; two rapid events
  // (delegating → approval-waiting) must allocate their per-task step seqs
  // SERIALLY, so the ledger's per-task monotonic seq stays unique.
  let taskEventChain: Promise<void> = Promise.resolve()

  const guard = async (method: string, fn: () => Promise<void>): Promise<void> => {
    try {
      await fn()
    } catch (err) {
      logger.warn('trust.record_failed', {
        taskId: taskId ?? undefined,
        method,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const begin = async (): Promise<void> =>
    guard('begin', async () => {
      const task = await db.trustTask.create({
        data: {
          userId: input.userId,
          product: 'riishe',
          kind: 'chat',
          title: input.message.slice(0, TRUST_LIMITS.title),
          requestPreview: input.message.slice(0, TRUST_LIMITS.requestPreview),
          requestChars: input.message.length,
          jobId: input.jobId ?? null,
          conversationId: input.conversationId,
          status: 'planned',
        },
      })
      taskId = task.id
      await planTrustSteps(taskId, [
        { kind: 'retrieval', title: 'Research and retrieval' },
        { kind: 'tool', title: 'Tool execution' },
        { kind: 'generation', title: 'Answer generation' },
        { kind: 'verification', title: 'Answer verification' },
      ])
      await startTrustTask(taskId)
    })

  const addDocuments = async (
    docs: Array<{ id: string; name: string; truncated: boolean; note: string | null }>,
  ): Promise<void> =>
    guard('addDocuments', async () => {
      if (!taskId) return
      for (const d of docs) {
        await addTrustEvidence(taskId, {
          kind: 'document',
          ref: d.id,
          title: d.name.slice(0, TRUST_LIMITS.summaryField),
          note: [
            d.truncated ? 'text truncated at the extraction bound' : null,
            d.note ? d.note.slice(0, 200) : null,
          ]
            .filter(Boolean)
            .join('; ') || undefined,
          origin: 'extracted',
        })
      }
    })

  const onEvent = (e: OrchestrationEvent): void => {
    if (!taskId) return
    try {
      if (e.type === 'stage') {
        const kind = STAGE_TO_STEP[e.stage]
        if (!kind) return
        const seq = STEP_SEQ[kind]
        // Advance the previous running step to done, persist the resume
        // checkpoint for it, then start this one. Ordered inside one async
        // chain so the checkpoint always follows the ledger write it claims.
        const previousStage = lastRunningStage
        lastRunningStage = kind
        void (async () => {
          if (previousStage && previousStage !== kind) {
            const prevSeq = STEP_SEQ[previousStage]
            await updateTrustStepStatus(taskId!, prevSeq, 'done')
            await writeResumeCheckpoint(taskId!, { completedThroughSeq: prevSeq })
          }
          await updateTrustStepStatus(taskId!, seq, 'running')
        })().catch(() => undefined)
      } else if (e.type === 'tool') {
        if (e.name && e.status === 'started' && !toolNames.includes(e.name)) {
          toolNames = [...toolNames, e.name]
        }
      }
    } catch {
      // Ledger observation must never break the turn.
    }
  }

  const flushStepState = async (verificationFailed: boolean) =>
    guard('flushSteps', async () => {
      if (!taskId) return
      // Mark every still-planned/running step truthfully, persisting a resume
      // checkpoint after each completed step (seq order keeps the checkpoint
      // prefix-claim consistent with the ledger).
      const steps = await db.trustStep.findMany({ where: { taskId }, orderBy: { seq: 'asc' } })
      for (const step of steps) {
        if (step.status === 'planned' || step.status === 'running') {
          if (step.kind === 'retrieval' || step.kind === 'tool') {
            await updateTrustStepStatus(taskId, step.seq, 'done')
            await writeResumeCheckpoint(taskId, { completedThroughSeq: step.seq })
          } else if (step.kind === 'generation') {
            await updateTrustStepStatus(taskId, step.seq, 'done')
            await writeResumeCheckpoint(taskId, { completedThroughSeq: step.seq })
          } else if (step.kind === 'verification') {
            await updateTrustStepStatus(taskId, step.seq, verificationFailed ? 'failed' : 'done')
          } else {
            await updateTrustStepStatus(taskId, step.seq, 'done')
          }
        }
      }
    })

  const complete = async (result: RiisheResultLike, info: { persisted: boolean }): Promise<void> =>
    guard('complete', async () => {
      if (!taskId) return
      const states = result.metadata?.states ?? []
      const produced = info.persisted && (result.content?.trim().length ?? 0) > 0
      const mapping = mapRiisheStatesToOutcome(states, produced)
      const verificationFailed = mapping.outcome !== 'completed'

      await flushStepState(verificationFailed)

      // Evidence: real sources with retrieval provenance (extracted facts).
      const sources = (result.metadata?.sources ?? []).slice(0, SOURCE_EVIDENCE_CAP)
      for (const s of sources) {
        const ref = s.url ?? s.hostName ?? ''
        if (!ref) continue
        const provenance = [
          s.readEngine ? `read via ${s.readEngine}` : null,
          s.reach ? `channel ${s.reach.channel}` : null,
          s.pageRead ? 'full page read' : 'snippet only',
        ]
          .filter(Boolean)
          .join('; ')
        await addTrustEvidence(taskId, {
          kind: 'source',
          ref: ref.slice(0, TRUST_LIMITS.refChars),
          title: (s.title ?? s.hostName ?? 'source').slice(0, TRUST_LIMITS.summaryField),
          note: provenance || undefined,
          origin: 'extracted',
        })
      }

      // Evidence: real tool executions with measured outcomes.
      for (const t of (result.metadata?.toolRuns ?? []).slice(0, 10)) {
        if (!t.tool) continue
        await addTrustEvidence(taskId, {
          kind: 'tool-output',
          ref: t.tool,
          note: `ok=${t.ok === true}; durationMs=${typeof t.durationMs === 'number' ? t.durationMs : 'unknown'}`,
          origin: 'extracted',
        })
      }

      // Limitations: degraded notes + honest outcome reason.
      const limitations: string[] = []
      for (const d of (result.metadata?.degraded ?? []).slice(0, TRUST_LIMITS.limitationsPerTask - 1)) {
        limitations.push(String(d).slice(0, TRUST_LIMITS.limitationChars))
      }
      if (mapping.outcome !== 'completed') limitations.push(mapping.reason)

      const verificationSummary =
        result.metadata?.verificationNote?.trim() ||
        `Response states assigned from actual execution: ${states.length ? states.join(', ') : 'none recorded'}. ${mapping.reason}`

      if (mapping.outcome === 'failed') {
        await failTrustTask(taskId, {
          failureNote: mapping.reason,
          limitations,
        })
        return
      }

      await finalizeTrustTask(taskId, {
        outcome: mapping.outcome,
        outcomeSummary: mapping.reason,
        verificationSummary: verificationSummary.slice(0, TRUST_LIMITS.summaryField),
        limitations,
      })
    })

  const completeMemory = async (memoryOutcome: MemoryOutcomeLike): Promise<void> =>
    guard('completeMemory', async () => {
      if (!taskId) return
      await flushStepState(false)
      const action = memoryOutcome.meta?.memoryAction
      const actionLabel = action?.action ?? 'memory command'
      const count = typeof action?.count === 'number' ? action.count : null
      // M33: potential conflicts presented with a save are part of the
      // truthful receipt — the detector warned the user and NOTHING was
      // replaced automatically.
      const conflictNote =
        typeof action?.conflictCount === 'number' && action.conflictCount > 0
          ? `, ${action.conflictCount} potential conflict(s) presented (nothing was replaced automatically)`
          : ''
      const verification = `Memory command executed against the memory store (${actionLabel}${
        count !== null ? `, ${count} item(s)` : ''
      }${conflictNote}); the confirmation shown to you reflects the real database write.`
      const verificationSummary = verification.slice(0, TRUST_LIMITS.summaryField)
      if (action?.refused) {
        await finalizeTrustTask(taskId, {
          outcome: 'completed_with_limitations',
          outcomeSummary: 'The memory command was evaluated and refused by the memory policy.',
          verificationSummary,
          limitations: ['The requested memory action was refused by the memory policy.'],
        })
        return
      }
      const insufficient = action && typeof action.count === 'number' && action.count === 0
      await finalizeTrustTask(
        taskId,
        insufficient
          ? {
              outcome: 'completed_with_limitations',
              outcomeSummary: 'The memory command ran but changed nothing (nothing matched or nothing new).',
              verificationSummary,
              limitations: ['No memory rows were changed.'],
            }
          : {
              outcome: 'completed',
              outcomeSummary: `Memory command executed (${actionLabel}).`,
              verificationSummary,
            },
      )
    })

  const onTaskEvent = (e: { stage: string; detail?: string }): void => {
    if (!taskId) return
    // Serialized chain: each event's ledger writes complete before the next
    // event's begin (seq allocation and step transitions stay ordered).
    taskEventChain = taskEventChain
      .then(() => (async () => {
      if (e.stage === 'planning' && !workflowRecorded) {
        // REAL event: the turn was detected as a multi-domain workflow. The
        // parts list is deterministic routing provenance (no content, no
        // identities) — recorded once as an extracted measurement.
        workflowRecorded = true
        await addTrustEvidence(taskId!, {
          kind: 'measurement',
          ref: 'workflow-plan',
          title: 'Multi-step workflow composed',
          note: `capability domains coordinated: ${e.detail ?? 'unknown'}`.slice(0, TRUST_LIMITS.noteField),
          origin: 'extracted',
        })
        return
      }
      if (e.stage === 'delegating' && deliveryStepSeq === null) {
        // REAL event: a coding job was actually submitted to the engineering
        // workspace. The step starts now and settles with the turn outcome.
        const seq = await planTrustSteps(taskId!, [{ kind: 'delivery', title: 'Coding delegation to the engineering workspace' }])
        deliveryStepSeq = seq
        await updateTrustStepStatus(taskId!, seq, 'running', {
          detailJson: e.detail ? JSON.stringify({ detail: String(e.detail).slice(0, 200) }) : undefined,
        })
        return
      }
      if (e.stage === 'approval-waiting' && approvalStepSeq === null) {
        // REAL event: a delegated job's execution receipt reports it is
        // waiting for a user approval. Recorded honestly — never skipped.
        const seq = await planTrustSteps(taskId!, [{ kind: 'approval', title: 'Waiting for a required approval' }])
        approvalStepSeq = seq
        await updateTrustStepStatus(taskId!, seq, 'running')
        return
      }
      if (e.stage === 'approval-waiting' && approvalStepSeq !== null) {
        return
      }
      if ((e.stage === 'completed' || e.stage === 'completed-with-limitations') && deliveryStepSeq !== null) {
        // The delegated job's completion is reflected in the turn outcome;
        // the delivery step settles with it (detail from the REAL probe).
        await updateTrustStepStatus(taskId!, deliveryStepSeq, 'done')
        return
      }
      if ((e.stage === 'completed' || e.stage === 'completed-with-limitations') && approvalStepSeq !== null) {
        await updateTrustStepStatus(taskId!, approvalStepSeq, 'done')
      }
    })())
      .catch(() => undefined)
  }

  const cancelled = async (): Promise<void> =>
    guard('cancelled', async () => {
      if (!taskId) return
      const steps = await db.trustStep.findMany({ where: { taskId }, orderBy: { seq: 'asc' } })
      for (const step of steps) {
        if (step.status === 'planned' || step.status === 'running') {
          await updateTrustStepStatus(taskId, step.seq, 'skipped')
        }
      }
      deliveryStepSeq = null
      approvalStepSeq = null
      await cancelTrustTask(
        taskId,
        'Cancelled by the user while the turn was running; any streamed partial is visible in the job event log and nothing was saved as a complete answer.',
      )
    })

  const failed = async (failure: { errorCode?: string | null; errorMessage?: string | null }): Promise<void> =>
    guard('failed', async () => {
      if (!taskId) return
      const note = failure.errorMessage?.trim() || failure.errorCode || 'The turn failed with an unclassified error.'
      await failTrustTask(taskId, {
        failureNote: `${failure.errorCode ?? 'ERROR'}: ${note}`.slice(0, TRUST_LIMITS.summaryField),
      })
    })

  return {
    get taskId() {
      return taskId
    },
    begin,
    addDocuments,
    onEvent,
    onTaskEvent,
    complete,
    completeMemory,
    cancelled,
    failed,
  }
}

/** Exported for tests: the stage→step mapping. */
export const RIISHE_STAGE_STEP_MAP = STAGE_TO_STEP
