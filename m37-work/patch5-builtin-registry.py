#!/usr/bin/env python3
"""M37 patch: builtin-registry.ts — register the coding-delegation tools."""
import sys, pathlib

p = pathlib.Path('/tmp/m37-run/src/lib/riishe/tools/builtin-registry.ts')
src = p.read_text()

def sub(old, new):
    global src
    if old not in src or src.count(old) != 1:
        print(f"FAIL: anchor missing/non-unique ({src.count(old)}x):\n{old[:200]}")
        sys.exit(1)
    src = src.replace(old, new)

sub("""import {
  webSearchTool,
  readUrlTool,
  calculateTool,
  runCodeTool,
  readDocumentTool,
  analyzeImageTool,
} from './builtin'""",
"""import {
  webSearchTool,
  readUrlTool,
  calculateTool,
  runCodeTool,
  readDocumentTool,
  analyzeImageTool,
} from './builtin'
import { delegateCodingTool, checkCodingJobTool } from '../code-delegation'""")

sub("""  // M36-C — specialist delegation tools (LAXII / JAZMII / GANGZII via the
  // existing durable job queue; explicit-permission gated, plan-narrowed).
  registerTool(generateImageTool)
  registerTool(createVideoTool)
  registerTool(synthesizeSpeechTool)
  registered = true""",
"""  // M36-C — specialist delegation tools (LAXII / JAZMII / GANGZII via the
  // existing durable job queue; explicit-permission gated, plan-narrowed).
  registerTool(generateImageTool)
  registerTool(createVideoTool)
  registerTool(synthesizeSpeechTool)
  // M37 §3 — CODE GIFTZ engineering-workflow delegation (explicit permission,
  // two-key gated like every specialist delegation; submit + status probe).
  registerTool(delegateCodingTool)
  registerTool(checkCodingJobTool)
  registered = true""")

p.write_text(src)
print("builtin-registry.ts patched OK")
