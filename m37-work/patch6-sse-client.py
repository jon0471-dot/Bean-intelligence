#!/usr/bin/env python3
"""M37 patch: sse-client.ts — task-stage event on the wire (additive)."""
import sys, pathlib

p = pathlib.Path('/home/z/my-project/src/lib/riishe/sse-client.ts')
src = p.read_text()

def sub(old, new):
    global src
    if old not in src or src.count(old) != 1:
        print(f"FAIL: anchor missing/non-unique ({src.count(old)}x):\n{old[:200]}")
        sys.exit(1)
    src = src.replace(old, new)

sub("""  tool?: { name: string; status: 'started' | 'done' | 'failed' }
  meta?: MsgMeta""",
"""  tool?: { name: string; status: 'started' | 'done' | 'failed' }
  /** M37 §5 — operational task stage, recorded from REAL execution events
   *  (planning, reading documents, delegating, approval waiting, terminal
   *  outcome). Additive; consumers that ignore it are unaffected. */
  task?: { stage: string; detail?: string }
  meta?: MsgMeta""")

p.write_text(src)
print("sse-client.ts patched OK")
