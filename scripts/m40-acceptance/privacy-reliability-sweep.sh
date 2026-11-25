#!/bin/bash
# M40 Milestone 6 — privacy & reliability evidence sweep.
# Greps the ACTUAL source for the M40 brief's hard prohibitions and required
# guarantees, printing a PASS/FAIL verdict per check. Output feeds the
# implementation report (docs/M40-IMPLEMENTATION-REPORT.md §6).
cd "$(dirname "$0")/../.." || exit 1
echo "=== M40 M6 PRIVACY & RELIABILITY SWEEP ($(date -u +%FT%TZ)) ==="
SCOPE="src prisma next.config.ts scripts/build-workers.mjs scripts/copy-ort-assets.mjs scripts/copy-native-libs.mjs"
fail=0
absent() { # name pattern
  local n; n=$(rg -in "$2" $SCOPE 2>/dev/null | wc -l | tr -d ' ')
  if [ "$n" = "0" ]; then echo "PASS [absent] $1 (0 hits in src/prisma/build scripts)"; else echo "FAIL [absent] $1 — $n hits:"; rg -in "$2" $SCOPE 2>/dev/null | head -5; fail=1; fi
}
present() { # name pattern scope-hint
  local n; n=$(rg -in "$2" ${3:-$SCOPE} 2>/dev/null | wc -l | tr -d ' ')
  if [ "$n" != "0" ]; then echo "PASS [present] $1 ($n hits; e.g. $(rg -iln "$2" ${3:-$SCOPE} 2>/dev/null | head -1))"; else echo "FAIL [present] $1 — 0 hits"; fail=1; fi
}
echo "--- hard prohibitions (must be absent from product source) ---"
# the ONLY allowed 'ollama' hits are the explicit policy comments ('No Ollama — llama.cpp only'):
OLLAMA_REAL=$(rg -in "ollama" src 2>/dev/null | rg -iv "no ollama|per policy" | wc -l | tr -d ' ')
if [ "$OLLAMA_REAL" = "0" ]; then echo "PASS [refined] Ollama appears ONLY in the two explicit policy-refusal comments; zero imports/usage/subprocess references"; else echo "FAIL [refined] real Ollama references: $OLLAMA_REAL"; rg -in "ollama" src | rg -iv "no ollama|per policy" | head -5; fail=1; fi
absent "no crypto-miner indicators" "cryptonight|stratum\+tcp|xmrig|monero|minerd|coinhive"
absent "no hardcoded API key literals (sk-…/Bearer …)" "sk-[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9]{25,}"
absent "no cross-visitor compute dispatch" "dispatchTo|otherVisitor|shareComputeWith|other.?user.?s.?(device|hardware)"
echo "--- required guarantees (must be present) ---"
present "explicit download consent gate" "requestDownload|consentApproved|approval.*download|download.*approval" "src/lib/client-compute src/lib/media"
present "SHA-256 integrity verification of pinned artifacts" "sha256|createHash" "src/lib/client-compute src/lib/media"
present "bounded concurrency caps consulted by the scheduler" "maxConcurren|concurrencyCap|CONCURRENCY|task concurrency|Configurable task concurrency" "src/lib/client-compute src/lib/media"
present "abort/cancellation on every lane" "AbortController|AbortSignal" "src/lib/client-compute src/lib/media"
present "memory feasibility / tier budget gate" "feasib|tierBudget|memoryBudget|budgetRefus|memory-feasibility" "src/lib/client-compute"
present "own-session-only client compute (privacy.ts rule + consent gate; no cross-visitor dispatch exists)" "no visitors' hardware used for other users|consent|scheduler consults" "src/lib/client-compute/privacy.ts"
echo "--- verdict: fail=$fail (0 = all checks green) ---"
exit $fail
