#!/usr/bin/env python3
"""M37 patch: builtin-registry.ts — register the coding-delegation tools."""
import sys, pathlib

p = pathlib.Path('/home/z/my-project/src/lib/riishe/tools/builtin-registry.ts')
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

sub("""  registerTool(readDocumentTool)
  registerTool(analyzeImageTool)
  registered = true""",
"""  registerTool(readDocumentTool)
  registerTool(analyzeImageTool)
  // M37 §3 — CODE GIFTZ engineering-workflow delegation (explicit permission).
  registerTool(delegateCodingTool)
  registerTool(checkCodingJobTool)
  registered = true""")

p.write_text(src)
print("builtin-registry.ts patched OK")
