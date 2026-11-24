#!/usr/bin/env python3
"""M37 patch: trust/adapters/riishe.ts — task-progress steps in the receipt."""
import sys, pathlib

p = pathlib.Path('/tmp/m37-run/src/lib/trust/adapters/riishe.ts')
src = p.read_text()

def sub(old, new):
    global src
    if old not in src or src.count(old) != 1:
        print(f"FAIL: anchor missing/non-unique ({src.count(old)}x):\n{old[:200]}")
        sys.exit(1)
    src = src.replace(old, new)

# 1. Recorder input interface unchanged; add the task-event observer type +
#    method to the interface.
sub("""  /** Observe an orchestration event (stage/tool/research) into the ledger. */
  onEvent(e: OrchestrationEvent): void""",
"""  /** Observe an orchestration event (stage/tool/research) into the ledger. */
  onEvent(e: OrchestrationEvent): void
  /**
   * M37 §5 — observe an operational task-stage event (planning, delegating,
   * approval-waiting, …) into the ledger. Real events only: each observed
   * stage records ledger rows (a workflow-planning evidence row, a delivery
   * step for an actual coding delegation, an approval step for a REAL
   * waiting_for_approval state). Best-effort like every recorder method.
   */
  onTaskEvent(e: { stage: string; detail?: string }): void""")

# 2. Implementation: delegation/approval bookkeeping state + observer.
sub("""export function createRiisheTurnRecorder(input: RiisheTurnRecorderInput): RiisheTurnRecorder {
  let taskId: string | null = null
  let lastRunningStage: TrustStepKind | null = null
  let toolNames: string[] = []""",
"""export function createRiisheTurnRecorder(input: RiisheTurnRecorderInput): RiisheTurnRecorder {
  let taskId: string | null = null
  let lastRunningStage: TrustStepKind | null = null
  let toolNames: string[] = []
  // M37 §5 — delegation/approval bookkeeping (single step per kind, appended
  // AFTER the four fixed orchestration steps so seqs stay monotonic).
  let deliveryStepSeq: number | null = null
  let approvalStepSeq: number | null = null
  let workflowRecorded = false""")

sub("""  const cancelled = async (): Promise<void> =>""",
"""  const onTaskEvent = (e: { stage: string; detail?: string }): void => {
    if (!taskId) return
    void (async () => {
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
    })().catch(() => undefined)
  }

  const cancelled = async (): Promise<void> =>""")

# 3. Cancelled: delegation/approval steps that never settled are skipped.
sub("""  const cancelled = async (): Promise<void> =>
    guard('cancelled', async () => {
      if (!taskId) return
      const steps = await db.trustStep.findMany({ where: { taskId }, orderBy: { seq: 'asc' } })
      for (const step of steps) {
        if (step.status === 'planned' || step.status === 'running') {
          await updateTrustStepStatus(taskId, step.seq, 'skipped')
        }
      }""",
"""  const cancelled = async (): Promise<void> =>
    guard('cancelled', async () => {
      if (!taskId) return
      const steps = await db.trustStep.findMany({ where: { taskId }, orderBy: { seq: 'asc' } })
      for (const step of steps) {
        if (step.status === 'planned' || step.status === 'running') {
          await updateTrustStepStatus(taskId, step.seq, 'skipped')
        }
      }
      deliveryStepSeq = null
      approvalStepSeq = null""")

# 4. Return the new observer.
sub("""  return {
    get taskId() {
      return taskId
    },
    begin,
    addDocuments,
    onEvent,
    complete,
    completeMemory,
    cancelled,
    failed,
  }
}""",
"""  return {
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
}""")

p.write_text(src)
print("trust/adapters/riishe.ts patched OK")
