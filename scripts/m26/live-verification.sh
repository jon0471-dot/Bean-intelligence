#!/bin/bash
# M26 live verification battery (bounded, local, disposable accounts) — v2.
# Ordering: identity-dependent tests run BEFORE the register rate-limit test
# (the limiter is shared per client IP, by design).
set -u
BASE=http://localhost:3000
PASS=0; FAIL=0
check() {
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "PASS  $1"
  else FAIL=$((FAIL+1)); echo "FAIL  $1 (expected=$2 actual=$3)"; fi
}
NOT403() {
  if [ "$2" != "403" ]; then PASS=$((PASS+1)); echo "PASS  $1 (status=$2, no CSRF rejection)"
  else FAIL=$((FAIL+1)); echo "FAIL  $1 (status=403 — wrongly rejected)"; fi
}

echo "=== O-1: request correlation ids ==="
H1=$(curl -s -D - -o /dev/null "$BASE/api/health" | grep -i "x-bean-request-id" | tr -d '\r' | awk '{print $2}')
H2=$(curl -s -D - -o /dev/null "$BASE/api/health" | grep -i "x-bean-request-id" | tr -d '\r' | awk '{print $2}')
check "response carries x-bean-request-id" "yes" "$([ -n "$H1" ] && echo yes)"
check "ids differ per request" "yes" "$([ "$H1" != "$H2" ] && echo yes)"
RUN_TAG="r$(date +%s | tail -c 8)"
XFF="10.77.$(date +%s | tail -c 6).9"
H3=$(curl -s -D - -o /dev/null "$BASE/api/health" -H "x-bean-request-id: m26-client-id-1234" | grep -i "x-bean-request-id" | tr -d '\r' | awk '{print $2}')
check "client-supplied id is honored (echoed)" "m26-client-id-1234" "$H3"

echo "=== S-8a: register the disposable account (before limiter tests) ==="
# distinct XFF bucket (documents the shared XFF-key residual from the audit):
# identity-dependent tests must not collide with the limiter test's bucket
RC=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/auth/register" -H "Content-Type: application/json" -H "X-Forwarded-For: $XFF" -c /tmp/m26-c1.txt -d "{\"email\":\"m26-pw-$RUN_TAG@disposable.local\",\"password\":\"OldPass123\",\"name\":\"pw\"}")
check "registration works" "200" "$RC"

echo "=== S-5: sibling-tenant same-site CSRF rejected ==="
C1=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/auth/login" -H "Origin: https://evil.space-z.ai" -H "Sec-Fetch-Site: same-site" -H "Content-Type: application/json" -d '{"email":"x@y.z","password":"nope"}')
check "same-site sibling origin rejected (403)" "403" "$C1"
C2=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/auth/login" -H "Origin: https://preview-abc123.space-z.ai" -H "Sec-Fetch-Site: same-site" -H "Content-Type: application/json" -d '{"email":"x@y.z","password":"nope"}')
check "same-site suffix host without exact allowlist rejected (403)" "403" "$C2"
C3=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/auth/login" -H "Origin: https://preview-abc123.space-z.ai" -H "Sec-Fetch-Site: same-origin" -H "Content-Type: application/json" -d '{"email":"x@y.z","password":"nope"}')
NOT403 "the app origin's same-origin mutations pass the origin gate" "$C3"

echo "=== S-8b: session revocation on password change ==="
L1=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/auth/login" -H "X-Forwarded-For: $XFF" -H "Content-Type: application/json" -c /tmp/m26-c2.txt -d "{\"email\":\"m26-pw-$RUN_TAG@disposable.local\",\"password\":\"OldPass123\"}")
check "login succeeds" "200" "$L1"
CH=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/account/settings" -H "Content-Type: application/json" -b /tmp/m26-c2.txt -d '{"currentPassword":"OldPass123","newPassword":"NewPass456"}')
check "password change (PATCH) succeeds" "200" "$CH"
PUB_AFTER=$(curl -s "$BASE/api/health" -b /tmp/m26-c2.txt | grep -c breaker)
check "old session is revoked (health falls back to public shape)" "0" "$PUB_AFTER"
L2=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/auth/login" -H "X-Forwarded-For: $XFF" -H "Content-Type: application/json" -c /tmp/m26-c3.txt -d "{\"email\":\"m26-pw-$RUN_TAG@disposable.local\",\"password\":\"NewPass456\"}")
check "re-login with the new password works" "200" "$L2"
FULL=$(curl -s "$BASE/api/health" -b /tmp/m26-c3.txt | grep -c breaker)
check "authenticated session sees the full health detail" "yes" "$([ "$FULL" -ge 1 ] && echo yes)"

echo "=== F-G1: GANGZII async surfaces fail honestly (never hang/queue forever) ==="
# In THIS build GANGZII is not registered in BEAN_PRODUCTS — the TTS route
# fails at preflight with a typed NOT_FOUND before any enqueue (the
# documented orphaned-UI state; unit tests pin the enqueue-time NO_BACKEND
# guard that protects the queue if a job ever reaches it).
G=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/gangzii/tts" -H "Content-Type: application/json" -b /tmp/m26-c3.txt -d '{"text":"hello from m26","voice":"tongtong","speed":1}')
check "gangzii TTS answers a typed error (no hang)" "yes" "$(case "$G" in 000) echo no;; *) echo yes;; esac)"
STUCK=$(node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({ datasources: { db: { url: 'file:' + process.cwd() + '/db/custom.db' } } });
p.generationJob.count({ where: { product: 'gangzii', status: { in: ['queued','starting','running','retry_wait'] } } }).then(r => { console.log(r); return p.\$disconnect(); });
" 2>/dev/null)
check "no gangzii jobs stuck in the queue" "0" "$STUCK"

echo "=== S-11: unauthenticated health stays minimal ==="
PUB=$(curl -s "$BASE/api/health")
check "public payload has no breaker detail" "yes" "$(echo "$PUB" | grep -q breaker && echo no || echo yes)"
check "public payload keeps readiness statuses" "yes" "$(echo "$PUB" | grep -q '"riishe":{"status"' && echo yes || echo no)"

echo "=== S-8c: register rate limit (LAST — consumes the window) ==="
LIMITED=0
for i in 1 2 3 4 5 6 7; do
  C=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/auth/register" -H "Content-Type: application/json" -d "{\"email\":\"m26-rl2-$i@disposable.local\",\"password\":\"TestPass123\",\"name\":\"rl$i\"}")
  [ "$C" = "429" ] && LIMITED=$((LIMITED+1))
done
check "rapid registrations hit the limiter (>=1 of 7 → 429)" "yes" "$([ "$LIMITED" -ge 1 ] && echo yes)"

echo
echo "RESULT: $PASS pass / $FAIL fail"
[ "$FAIL" = "0" ]
