#!/usr/bin/env bash
set -u
BASE="https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai"
OUT=/home/z/my-project/scripts/giftz-verify-out/preview-e2e
PASS=0; FAIL=0
log(){ echo "[$(date +%H:%M:%S)] $*"; }
pass(){ log "PASS: $*"; PASS=$((PASS+1)); }
fail(){ log "FAIL: $*"; FAIL=$((FAIL+1)); }
ab(){ agent-browser "$@"; }
bubbles(){ ab eval "([...document.querySelectorAll('p.whitespace-pre-wrap')].filter(p=>p.textContent.includes('$1'))).length" 2>/dev/null | tail -1; }
ab set viewport 1440 900
ab open "$BASE"; ab wait --load networkidle
ab find first "#email" fill "gz-e2e-v2-1793759396@bean-test.dev"
ab find first "#password" fill "PreviewE2E2026x"
ab find text "Sign in to BEAN" click
sleep 3; ab wait --load networkidle
ab find text "CODE GIFTZ" click; sleep 2
R=$(ab eval "(()=>{const el=[...document.querySelectorAll('*')].find(x=>x.children.length===0&&x.textContent.trim().startsWith('Write a one-line JavaScript'));if(el){(el.closest('div[class*=cursor]')||el.parentElement.parentElement).click();return 'clicked'}return 'not-found'})()" 2>/dev/null | tail -1)
log "rail click: $R"; sleep 3
SHORT=$(bubbles "adds two numbers"); MD=$(bubbles "tiny counter web app"); TASK=$(bubbles "Build a complete task-manager mini app")
log "history bubbles: short=$SHORT counter=$MD task=$TASK"
[ "${SHORT:-0}" = "1" ] && [ "${MD:-0}" = "1" ] && [ "${TASK:-0}" = "1" ] && pass "refresh persistence: all three prompts appear exactly once after reload" || fail "history counts short=$SHORT counter=$MD task=$TASK"
EV=$(ab eval "document.body.innerText.includes('Event Loop') || document.body.innerText.includes('event loop')" 2>/dev/null | tail -1)
[ "$EV" = "true" ] && pass "persisted Markdown answer re-rendered (history intact)" || fail "persisted answer not rendered"
F=$(ab eval "document.body.innerText.includes('index.html')" 2>/dev/null | tail -1)
[ "$F" = "true" ] && pass "workspace files restored from server" || fail "files not restored"
ERRS=$(ab errors 2>/dev/null | tail -n +2); EC=$(echo "$ERRS" | grep -c . || true)
CONS=$(ab console 2>/dev/null | grep -iE "error" | grep -viE "favicon|404|Download the React DevTools" | head -3); CC=$(echo "$CONS" | grep -c . || true)
[ "${EC:-0}" = "0" ] && pass "zero page errors" || fail "$EC page errors"
[ "${CC:-0}" = "0" ] && pass "zero console errors" || fail "$CC console errors"
ab screenshot "$OUT/v3b-history.png"
ab close
log "=== v3b SUMMARY: PASS=$PASS FAIL=$FAIL ==="
