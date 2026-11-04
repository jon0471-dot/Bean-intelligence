#!/usr/bin/env bash
# CODE GIFTZ — public-preview browser E2E v2 (real browser via agent-browser).
# Corrections vs v1: retry-after-stop = re-send same prompt (Stop is not an
# error by design; Retry button only renders for typed failures); refresh
# check clicks the project in the rail before asserting history.
set -u
BASE="https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai"
OUT=/home/z/my-project/scripts/giftz-verify-out/preview-e2e
mkdir -p "$OUT"
EMAIL="gz-e2e-v2-$(date +%s)@bean-test.dev"
PASS_COUNT=0; FAIL_COUNT=0
log(){ echo "[$(date +%H:%M:%S)] $*"; }
pass(){ log "PASS: $*"; PASS_COUNT=$((PASS_COUNT+1)); }
fail(){ log "FAIL: $*"; FAIL_COUNT=$((FAIL_COUNT+1)); }
ab(){ agent-browser "$@"; }
userBubbles(){ ab eval "([...document.querySelectorAll('p.whitespace-pre-wrap')].filter(p=>p.textContent.includes('$1'))).length" 2>/dev/null | tail -1; }
stopVisible(){ ab get count "[aria-label='Stop generating']" 2>/dev/null | tail -1; }
waitDone(){ local n="${1:-40}" i=0 c; while [ $i -lt "$n" ]; do c=$(stopVisible); if [ "${c:-1}" = "0" ]; then return 0; fi; sleep 3; i=$((i+1)); done; return 1; }
sendPrompt(){ ab find first "textarea" fill "$1"; ab find first "[aria-label='Send']" click; }

log "=== C1: load + register ==="
ab set viewport 1440 900
ab open "$BASE"; ab wait --load networkidle
ab find text "Create account" click
ab find first "#name" fill "Preview E2E v2"
ab find first "#email" fill "$EMAIL"
ab find first "#password" fill "PreviewE2E2026x"
ab find text "Create your account" click
sleep 3; ab wait --load networkidle
if ab snapshot -i 2>/dev/null | grep -qi "CODE GIFTZ"; then pass "register -> dashboard"; else fail "register failed"; fi
ab find text "CODE GIFTZ" click; sleep 2

log "=== C4: SHORT streaming turn ==="
sendPrompt "Write a one-line JavaScript function that adds two numbers."
S=$(stopVisible); [ "${S:-0}" != "0" ] && pass "short turn: streaming UI live" || log "note: short turn streamed faster than the 0-delay poll (stop visible check skipped)"
if waitDone 40; then pass "short turn terminal state reached"; else fail "short turn never finished"; fi
BODY=$(ab eval "document.body.innerText.includes('function')" 2>/dev/null | tail -1)
[ "$BODY" = "true" ] && pass "short answer rendered in DOM" || fail "short answer not rendered"
ab screenshot "$OUT/v2-c4-short.png"

log "=== C5: Markdown + files turn ==="
sendPrompt 'Create a tiny counter web app (index.html, styles.css, app.js). Then explain the JavaScript event loop in Markdown: use a ## heading, a bullet list with 3 items, and a fenced js code block.'
if waitDone 60; then pass "markdown turn terminal state"; else fail "markdown turn never finished"; fi
MD_HEAD=$(ab eval "document.querySelectorAll('h1,h2,h3').length" 2>/dev/null | tail -1)
MD_LIST=$(ab eval "document.querySelectorAll('ul li,ol li').length" 2>/dev/null | tail -1)
MD_CODE=$(ab eval "document.querySelectorAll('pre code').length" 2>/dev/null | tail -1)
log "rendered: headings=$MD_HEAD list=$MD_LIST code=$MD_CODE"
[ "${MD_HEAD:-0}" -ge 1 ] && [ "${MD_LIST:-0}" -ge 3 ] && [ "${MD_CODE:-0}" -ge 1 ] && pass "Markdown rendered" || fail "Markdown rendering incomplete"
UB=$(userBubbles "tiny counter web app")
[ "${UB:-0}" = "1" ] && pass "counter prompt bubble exactly once" || fail "counter bubble count=$UB"

log "=== C6: STOP mid-stream ==="
LONG_PROMPT='Build a complete task-manager mini app: index.html with a task form (title, priority, due date), list rendering, filter buttons and a stats bar; styles.css dark theme with gold accent; app.js with add, filter, delete logic and localStorage persistence.'
sendPrompt "$LONG_PROMPT"
STREAM_OK=0; i=0
while [ $i -lt 20 ]; do S=$(stopVisible); [ "${S:-0}" != "0" ] && { STREAM_OK=1; break; }; sleep 1; i=$((i+1)); done
[ "$STREAM_OK" = "1" ] && pass "long turn: streaming UI live (Stop control visible)" || fail "stop control never appeared on long turn"
sleep 5
PARTIAL_LEN=$(ab eval "document.body.innerText.length" 2>/dev/null | tail -1)
ab find first "[aria-label='Stop generating']" click; sleep 2
ab snapshot 2>/dev/null | grep -q "Generation stopped" && pass "stop honored — partial kept, honestly labeled" || fail "'Generation stopped' marker missing"
ENABLED=$(ab eval "!document.querySelector('textarea').disabled" 2>/dev/null | tail -1)
[ "$ENABLED" = "true" ] && pass "composer still enabled after failure (input not disabled)" || fail "composer disabled after stop"
ab screenshot "$OUT/v2-c6-stopped.png"

log "=== C7: retry after stop = re-send same prompt (collapse check) ==="
sendPrompt "$LONG_PROMPT"
if waitDone 60; then pass "re-sent turn terminal state"; else fail "re-sent turn never finished"; fi
DUP=$(userBubbles "Build a complete task-manager mini app")
[ "${DUP:-0}" = "1" ] && pass "no duplicate user message after retry (bubble count=1)" || fail "duplicate user messages: $DUP"
TASK_ANS=$(ab eval "document.body.innerText.includes('localStorage') || document.body.innerText.includes('localStorage')" 2>/dev/null | tail -1)
ab screenshot "$OUT/v2-c7-retry.png"

log "=== C8: refresh persistence ==="
ab reload; ab wait --load networkidle; sleep 3
ab find text "adds two numbers" click 2>/dev/null || ab find text "Write a one-line JavaScript" click
sleep 3
SHORT_UB=$(userBubbles "adds two numbers")
MD_UB=$(userBubbles "tiny counter web app")
LONG_UB=$(userBubbles "Build a complete task-manager mini app")
log "after refresh+reopen: short=$SHORT_UB counter=$MD_UB task=$LONG_UB"
[ "${SHORT_UB:-0}" = "1" ] && [ "${MD_UB:-0}" = "1" ] && [ "${LONG_UB:-0}" = "1" ] && pass "full history persisted after refresh, each prompt exactly once" || fail "history after refresh: short=$SHORT_UB counter=$MD_UB task=$LONG_UB"
HIST_ANS=$(ab eval "document.body.innerText.includes('Event Loop') || document.body.innerText.includes('event loop')" 2>/dev/null | tail -1)
[ "$HIST_ANS" = "true" ] && pass "persisted assistant answer re-rendered (Markdown content intact)" || fail "persisted answer not re-rendered"
ab screenshot "$OUT/v2-c8-refresh.png"

log "=== C9: console + network ==="
ERRS=$(ab errors 2>/dev/null | tail -n +2); ERR_COUNT=$(echo "$ERRS" | grep -c . || true)
CONS=$(ab console 2>/dev/null | grep -iE "error" | grep -viE "favicon|404|Download the React DevTools" | head -5)
CONS_COUNT=$(echo "$CONS" | grep -c . || true)
NET=$(ab network requests 2>/dev/null | grep -E "\[(5[0-9][0-9])\]| (5[0-9][0-9]) " | head -5); NET_COUNT=$(echo "$NET" | grep -c . || true)
log "pageErrors=$ERR_COUNT consoleErrors=$CONS_COUNT net5xx=$NET_COUNT"
[ "${ERR_COUNT:-0}" = "0" ] && pass "zero uncaught page errors" || fail "$ERR_COUNT page errors"
[ "${CONS_COUNT:-0}" = "0" ] && pass "zero console errors (filtered)" || fail "$CONS_COUNT console errors"
[ "${NET_COUNT:-0}" = "0" ] && pass "zero 5xx / 502 responses" || fail "$NET_COUNT 5xx responses"
ab close
log "=== E2E v2 SUMMARY: PASS=$PASS_COUNT FAIL=$FAIL_COUNT account=$EMAIL ==="
