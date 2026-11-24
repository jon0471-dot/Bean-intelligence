#!/usr/bin/env python3
"""M37 patch: use-riishe-chat.ts — live task stage consumption (additive)."""
import sys, pathlib

p = pathlib.Path('/tmp/m37-run/src/components/bean/riishe/use-riishe-chat.ts')
src = p.read_text()

def sub(old, new):
    global src
    if old not in src or src.count(old) != 1:
        print(f"FAIL: anchor missing/non-unique ({src.count(old)}x):\n{old[:200]}")
        sys.exit(1)
    src = src.replace(old, new)

# 1. MsgMeta gains the M37 additive fields (server-composed, ID-safe).
sub("""    policyDescription: string
  }
}""",
"""    policyDescription: string
  }
  /** M37 §5 — operational task stages recorded from REAL execution events
   *  (planning, delegation, terminal outcome). Server-composed; the UI only
   *  renders what actually happened. */
  taskStages?: Array<{ stage: string; at: string }>
  /** M37 §4 — multi-domain workflow provenance (deterministic detection). */
  workflow?: { parts: string[] }
  /** M37 §2 — the turn was served under the strict documents-only contract. */
  docGrounded?: boolean
}""")

# 2. Live task-stage state (alongside researching/runningTool).
sub("""  const [runningTool, setRunningTool] = useState<string | null>(null)
""",
"""  const [runningTool, setRunningTool] = useState<string | null>(null)
  // M37 §5 — genuine operational task stage, recorded by the server from
  // REAL execution events (never a client-side guess).
  const [liveTaskStage, setLiveTaskStage] = useState<string | null>(null)
""")

# 3. Consume the task frame.
sub("""          if (evt.tool) {
            if (evt.tool.status === 'started') setRunningTool(evt.tool.name)
            else setRunningTool(null)
          }""",
"""          if (evt.tool) {
            if (evt.tool.status === 'started') setRunningTool(evt.tool.name)
            else setRunningTool(null)
          }
          if (evt.task) setLiveTaskStage(evt.task.stage)""")

# 4. Clear on completion and on failure.
sub("""serverDone = true
          setResearching(false)
          setRunningTool(null)""",
"""serverDone = true
          setResearching(false)
          setRunningTool(null)
          setLiveTaskStage(null)""")

sub("""        onFailure: (failure: StreamFailureInfo) => {
          if (failure.kind === 'aborted') {""",
"""        onFailure: (failure: StreamFailureInfo) => {
          setLiveTaskStage(null)
          if (failure.kind === 'aborted') {""")

# 5. Expose to the presentational components.
sub("""    researching,
    runningTool,""",
"""    researching,
    runningTool,
    liveTaskStage,""")

p.write_text(src)
print("use-riishe-chat.ts patched OK")
