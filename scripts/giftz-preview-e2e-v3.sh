#!/usr/bin/env bash
# CODE GIFTZ — public-preview E2E v3: login + refresh persistence + history.
set -u
BASE="https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai"
OUT=/home/z/my-project/scripts/giftz-verify-out/preview-e2e
PASS=0; FAIL=0
log(){ echo "[$(date +%H:%M:%S)] $*"; }
pass(){ log "PASS: $*"; PASS=$((PASS+1)); }
fail(){ log "FAIL: $*"; FAIL=$((FAIL+1)); }
ab(){ agent-browser "$@"; }
bubbles(){ ab eval "([...document.querySelectorAll('p.whitespace-pre-wrap')].filter(p=>p.textContent.includes('$1'))).length" 2>/dev/null | tail -1; }

log "=== v3-1: sign in with the v2 E2E account (login path) ==="
ab set viewport 1440 900
ab open "$BASE"; ab wait --load networkidle
ab find text "Sign in" click 2>/dev/null   # toggle to login mode if currently register
ab find first "#email" fill "gz-e2e-v2-1793759396@bean-test.dev"
ab find first "#password" fill "PreviewE2E2026x"
ab find text "Sign in to BEAN" click
sleep 3; ab wait --load networkidle
ab snapshot -i 2>/dev/null | grep -qi "CODE GIFTZ" && pass "login -> dashboard (session works on public origin)" || fail "login failed"

log "=== v3-2: open CODE GIFTZ, click the existing project in the rail ==="
ab find text "CODE GIFTZ" click; sleep 2
ab eval "(()=>{const el=[...document.querySelectorAll('button,div[role=button],a')].find(x=>x.textContent.includes('adds two numbers'));if(el){el.click();return 'clicked'}return 'not-found'})()" 2>/dev/null | tail -1
sleep 3
SHORT=$(bubbles "adds two numbers"); MD=$(bubbles "tiny counter web app"); TASK=$(bubbles "Build a complete task-manager mini app")
log "history bubbles: short=$SHORT counter=$MD task=$TASK"
[ "${SHORT:-0}" = "1" ] && [ "${MD:-0}" = "1" ] && [ "${TASK:-0}" = "1" ] && pass "refresh persistence: every prompt appears exactly once after full reload" || fail "history counts short=$SHORT counter=$MD task=$TASK"
EV=$(ab eval "document.body.innerText.includes('Event Loop') || document.body.innerText.includes('event loop')" 2>/dev/null | tail -1)
[ "$EV" = "true" ] && pass "persisted Markdown answer re-rendered after refresh" || fail "persisted answer not rendered"
FILES=$(ab eval "document.body.innerText.includes('index.html')" 2>/dev/null | tail -1)
[ "$FILES" = "true" ] && pass "workspace files restored from server (source of truth)" || fail "files not restored"
ab screenshot "$OUT/v3-history.png"

log "=== v3-3: console + network ==="
ERRS=$(ab errors 2>/dev/null | tail -n +2); EC=$(echo "$ERRS" | grep -c . || true)
CONS=$(ab console 2>/dev/null | grep -iE "error" | grep -viE "favicon|404|Download the React DevTools" | head -3); CC=$(echo "$CONS" | grep -c . || true)
NET=$(ab network requests 2>/dev/null | grep -E "\[5[0-9][0-9]\]" | head -3); NC=$(echo "$NET" | grep -c . || true)
log "pageErrors=$EC consoleErrors=$CC net5xx=$NC"
[ "${EC:-0}" = "0" ] && pass "zero page errors" || fail "$EC page errors"
[ "${CC:-0}" = "0" ] && pass "zero console errors" || fail "$CC console errors"
[ "${NC:-0}" = "0" ] && pass "zero 5xx" || fail "$NC 5xx"
ab close
log "=== v3 SUMMARY: PASS=$PASS FAIL=$FAIL ==="
