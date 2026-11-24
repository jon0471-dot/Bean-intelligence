#!/usr/bin/env python3
"""M37 patch: riishe/chat/route.ts — delegation permission key + task event forwarding."""
import sys, pathlib

p = pathlib.Path('/home/z/my-project/src/app/api/riishe/chat/route.ts')
src = p.read_text()

def sub(old, new):
    global src
    if old not in src or src.count(old) != 1:
        print(f"FAIL: anchor missing/non-unique ({src.count(old)}x):\n{old[:200]}")
        sys.exit(1)
    src = src.replace(old, new)

# 1. Permission set: coding delegation joins the server-side authority keys
#    (the capability planner still narrows per turn — two-key gate preserved).
sub("""      permissions: new Set(['allowCodeExecution', 'allowImageGeneration', 'allowVideoCreation', 'allowSpeechSynthesis']),""",
"""      permissions: new Set(['allowCodeExecution', 'allowImageGeneration', 'allowVideoCreation', 'allowSpeechSynthesis', 'allowCodingDelegation']),""")

# 2. SSE forwarding: task-stage events reach the client AND the receipt ledger.
sub("""              } else if (e.type === 'tool') {
                writer.send({ tool: e })
              }""",
"""              } else if (e.type === 'tool') {
                writer.send({ tool: e })
              } else if (e.type === 'task') {
                // M37 §5 — genuine operational stages (planning, reading
                // documents, delegating, approval waiting, terminal outcome)
                // recorded from REAL execution events; additive wire frames.
                trust.onTaskEvent(e)
                writer.send({ task: { stage: e.stage, ...(e.detail ? { detail: e.detail } : {}) } })
              }""")

p.write_text(src)
print("route.ts patched OK")
