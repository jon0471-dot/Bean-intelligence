#!/usr/bin/env python3
"""M37 patch: riishe-messages.tsx — honest task-stage chips (live + terminal)."""
import sys, pathlib

p = pathlib.Path('/tmp/m37-run/src/components/bean/riishe/riishe-messages.tsx')
src = p.read_text()

def sub(old, new):
    global src
    if old not in src or src.count(old) != 1:
        print(f"FAIL: anchor missing/non-unique ({src.count(old)}x):\n{old[:200]}")
        sys.exit(1)
    src = src.replace(old, new)

# 1. Label map + chip component (operational labels only — no identities).
sub("""function AssistantMessage({""",
"""/** M37 §5 — honest operational stage labels recorded from REAL execution
 *  events; the UI renders only what the server actually reported. */
const TASK_STAGE_LABELS: Record<string, string> = {
  planning: 'Planning…',
  researching: 'Searching the web…',
  'reading-documents': 'Reading documents…',
  delegating: 'Delegating to the engineering workspace…',
  'approval-waiting': 'Waiting for approval…',
  executing: 'Executing in the sandbox…',
  verifying: 'Verifying…',
  completed: 'Completed',
  'completed-with-limitations': 'Completed with limitations',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

const TERMINAL_TASK_STAGES = new Set(['completed', 'completed-with-limitations', 'failed', 'cancelled'])

function TaskStageChip({ stage }: { stage: string }) {
  const label = TASK_STAGE_LABELS[stage] ?? null
  if (!label) return null
  const isTerminal = TERMINAL_TASK_STAGES.has(stage)
  const isBad = stage === 'failed' || stage === 'cancelled'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[10px]',
        isBad
          ? 'border border-red-500/30 bg-red-500/10 text-red-300'
          : isTerminal
            ? 'border border-white/15 bg-white/5 text-white/70'
            : 'border border-[#d4af37]/30 bg-[#d4af37]/10 text-[#f0c75e]',
      )}
    >
      {!isTerminal ? <Spinner /> : null}
      {label}
    </span>
  )
}

function AssistantMessage({""")

# 2. Live status line: the live task stage is the FIRST honest signal.
sub("""          {chat.researching ? (
            <span className="inline-flex items-center gap-2 text-xs text-white/50">
              <Globe className="h-3.5 w-3.5 animate-pulse text-[#d4af37]" /> Searching the web…
            </span>
          ) : chat.runningTool ? (""",
"""          {chat.liveTaskStage ? (
            <TaskStageChip stage={chat.liveTaskStage} />
          ) : chat.researching ? (
            <span className="inline-flex items-center gap-2 text-xs text-white/50">
              <Globe className="h-3.5 w-3.5 animate-pulse text-[#d4af37]" /> Searching the web…
            </span>
          ) : chat.runningTool ? (""")

# 3. Terminal outcome chip on completed messages (from REAL task stages).
sub("""  const claims = mapSourceClaims(msg.content, msg.meta?.sources ?? [])
  return (""",
"""  const claims = mapSourceClaims(msg.content, msg.meta?.sources ?? [])
  // M37 §5 — the terminal outcome is the LAST terminal stage the server
  // recorded from real execution; absent when nothing was tracked.
  const terminalTaskStage =
    (msg.meta?.taskStages ?? []).map((s) => s.stage).filter((s) => TERMINAL_TASK_STAGES.has(s)).pop() ?? null
  return (""")

sub("""        {msg.partial ? (
          <div className="mt-2 inline-flex items-center gap-1.5 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300">
            <AlertTriangle className="h-3 w-3" /> Incomplete — the stream was stopped or ended early
          </div>
        ) : null}
        <AnswerMeta meta={msg.meta} forceOpen={sourcesOpen} claims={claims} />""",
"""        {msg.partial ? (
          <div className="mt-2 inline-flex items-center gap-1.5 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300">
            <AlertTriangle className="h-3 w-3" /> Incomplete — the stream was stopped or ended early
          </div>
        ) : null}
        {terminalTaskStage ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <TaskStageChip stage={terminalTaskStage} />
            {msg.meta?.docGrounded ? (
              <span className="inline-flex items-center rounded border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] text-white/70">
                Answered from your documents only
              </span>
            ) : null}
          </div>
        ) : null}
        <AnswerMeta meta={msg.meta} forceOpen={sourcesOpen} claims={claims} />""")

p.write_text(src)
print("riishe-messages.tsx patched OK")
