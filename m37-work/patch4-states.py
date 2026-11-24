#!/usr/bin/env python3
"""M37 patch: states.ts — task-stage + workflow metadata (additive)."""
import sys, pathlib

p = pathlib.Path('/home/z/my-project/src/lib/riishe/states.ts')
src = p.read_text()

def sub(old, new):
    global src
    if old not in src or src.count(old) != 1:
        print(f"FAIL: anchor missing/non-unique ({src.count(old)}x):\n{old[:200]}")
        sys.exit(1)
    src = src.replace(old, new)

# 1. Task-stage vocabulary (derived from REAL execution events only)
sub("""export type ResponseState = (typeof RESPONSE_STATES)[number]""",
"""export type ResponseState = (typeof RESPONSE_STATES)[number]

/**
 * M37 §5 — customer-facing operational task stages. Every entry is recorded
 * by the orchestrator from a REAL execution event (a workflow plan actually
 * composed, a document actually read, a coding job actually submitted or
 * probed, an approval actually pending, the terminal outcome actually
 * derived from the assigned response states). The model has no field to set
 * these and no authority over them — the same honesty contract as the
 * response states above.
 */
export const TASK_STAGES = [
  'planning',
  'researching',
  'reading-documents',
  'delegating',
  'approval-waiting',
  'executing',
  'verifying',
  'completed',
  'completed-with-limitations',
  'failed',
  'cancelled',
] as const
export type TaskStage = (typeof TASK_STAGES)[number]""")

# 2. Metadata fields
sub("""  /** Measured latency breakdown for this turn (performance reporting). */
  timings?: TurnTimings
}""",
"""  /** Measured latency breakdown for this turn (performance reporting). */
  timings?: TurnTimings
  /**
   * M37 §5 — the operational task stages THIS turn actually went through,
   * in order, each stamped when the real event fired. Absent for ordinary
   * single-domain turns (no workflow, no delegation) so the UI adds no
   * noise; a terminal entry (completed / completed-with-limitations /
   * failed / cancelled) is present whenever the turn produced one from its
   * assigned response states. Composed by the orchestrator — never by the
   * model. Contains no backend/model identities (customer-facing).
   */
  taskStages?: Array<{ stage: TaskStage; at: string; durationMs?: number }>
  /**
   * M37 §4 — multi-step workflow provenance: the capability domains the
   * turn actually coordinated (deterministic detection over the message +
   * attachments + capability plan). Absent when the turn was single-domain.
   */
  workflow?: { parts: string[] }
  /**
   * M37 §2 — true when the user requested STRICT document grounding and the
   * orchestrator served the turn under the documents-only contract (web
   * retrieval suppressed). Absent otherwise.
   */
  docGrounded?: boolean
}""")

p.write_text(src)
print("states.ts patched OK")
