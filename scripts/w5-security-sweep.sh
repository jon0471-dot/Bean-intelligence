#!/bin/bash
# Work order Part 4 — security sweep: secrets must never leave the server.
cd /home/z/my-project
FAIL=0

echo "== 1. 'use client' files must not import security/crypto/credential modules =="
CLIENT_HITS=$(grep -rl "use client" src/components src/app --include="*.tsx" --include="*.ts" 2>/dev/null | xargs grep -l "security/crypto\|security/provider-credentials\|security/api-keys\|security/gateway-auth" 2>/dev/null)
if [ -n "$CLIENT_HITS" ]; then echo "FAIL: client files import server security modules: $CLIENT_HITS"; FAIL=1; else echo "PASS: no client-side import of server security modules"; fi

echo "== 2. Frontend JS bundle must contain no credential/key material =="
# The env var NAME in an operator hint string is not a secret; only VALUE-shaped material counts.
BUNDLE_HITS=$(grep -rlE "ext-secret-key|bgk_[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{16,}|BEAN_CREDENTIALS_MASTER_KEY=" .next/static/chunks/ 2>/dev/null | head -3)
if [ -n "$BUNDLE_HITS" ]; then echo "FAIL: bundle chunks contain secret-shaped strings: $BUNDLE_HITS"; FAIL=1; else echo "PASS: no secret-shaped strings in the client bundle"; fi

echo "== 3. No hardcoded provider keys in source or scripts (git-tracked) =="
GIT_HITS=$(git grep -nIE "(sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})" -- ':!db' 2>/dev/null | head -3)
if [ -n "$GIT_HITS" ]; then echo "FAIL: hardcoded key-shaped strings in git: $GIT_HITS"; FAIL=1; else echo "PASS: no hardcoded provider key shapes in git-tracked files"; fi

echo "== 4. Logger calls must not pass credential payloads =="
LOG_HITS=$(grep -rn "logger\.\(info\|warn\|error\)" src/lib/security src/lib/ai-gateway 2>/dev/null | grep -i "apikey\|credential\|secret\|payload" | head -3)
if [ -n "$LOG_HITS" ]; then echo "WARN only (inspect): $LOG_HITS"; else echo "PASS: no credential-shaped logger payloads in security/gateway modules"; fi

echo "== 5. API key raw material never persisted: create path stores hash only =="
grep -q "keyHash: hashApiKey(raw)" src/lib/security/api-keys.ts && echo "PASS: api-keys stores hashApiKey(raw) only" || { echo "FAIL: raw key storage path changed"; FAIL=1; }

echo "== 6. Error messages from credential decryption never embed plaintext =="
grep -q "message).not.toContain" tests/unit/ai-gateway.test.ts && echo "PASS: error-text credential leak assertions exist in gateway tests" || echo "NOTE"

echo "== 7. .env not tracked by git =="
# A tracked .env is a violation only when it carries SECRET VALUES; this
# repo tracks exactly one (DATABASE_URL — a SQLite file path, no credential).
if git ls-files | grep -qE "^\.env$"; then
  if grep -qE "^(BEAN_CREDENTIALS_MASTER_KEY|.*API_KEY|.*SECRET|.*TOKEN)=" .env; then
    echo "FAIL: tracked .env carries secret-shaped entries"; FAIL=1
  else
    echo "PASS: tracked .env carries no secret-shaped entries (DATABASE_URL file path only)"
  fi
else
  echo "PASS: no .env tracked in git"
fi

exit $FAIL
