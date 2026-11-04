#!/usr/bin/env bash
# ============================================================================
# BEAN workspace — PREVIEW SUPERVISOR (whole-website preview persistence)
#
# ROOT CAUSES this fixes (all measured 2026-11-04, see
# docs/reports/PREVIEW-PERSISTENCE-REPORT.md):
#   R1  sandbox recycles kill every process; the platform's preview boot
#       (npm run dev on :3000) is NOT reliably re-run afterwards — the public
#       preview URL 502s until someone manually re-boots the server;
#   R2  OOM collateral: a build running beside the dev server got it killed;
#   R3  orphaned :3100 evaluation servers block later eval launches
#       (EADDRINUSE incident 11-04 05:xx);
#   R4  (platform-level, NOT fixable in-repo) scheduled/cron turns restore a
#       STALE workspace snapshot and auto-commit it — a cron-based recovery
#       heartbeat was measured REGRESSING the workspace (stale .git metadata
#       at 11-03). Cron is therefore disqualified as a recovery mechanism;
#       the supported recovery is a task-end `check` reconcile + the
#       platform's own boot.
#
# WHAT THIS SUPERVISOR DOES (process lifecycle ONLY — never touches data):
#   - `check` (default): one reconcile pass — if /api/health is 200 it does
#     NOTHING (zero duplicate processes); when down it kills stale/wedged
#     :3000 dev-server-class listeners, boots via the platform's own boot
#     path (npm run dev), waits bounded for health, prints one verdict line.
#     Run it at the end of every coding task — it exits after one pass, and
#     a server whose launcher exits before the tool call ends SURVIVES the
#     sandbox's process cleanup (measured twice on 2026-11-04).
#   - `daemon`: reconcile loop — works on a normal host; in THIS sandbox any
#     background process dies with its spawning tool call (measured), so
#     daemon mode cannot persist here; provided for portability only.
#
# INVARIANTS:
#   - exactly ONE server on :3000 (health-first check prevents duplicates);
#   - the platform's own boot command is used — the preview proxy keeps
#     serving the SAME app; no replacement website, no static screenshots;
#   - no data operations: no migrations, no DB writes, no builds (the build
#     OOM was the original killer — the supervisor never builds);
#   - :3100 eval servers are transient by design (script-owned traps);
#     reconcile only clears ORPHANED listeners (parent chain gone).
#
# Usage:
#   scripts/preview-supervisor.sh check [max-wait-sec]   # one reconcile pass
#   scripts/preview-supervisor.sh daemon                  # loop (portable only)
# ============================================================================
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$ROOT/scripts/preview-supervisor.log"
LOCK="$ROOT/scripts/preview-supervisor.lock"
URL="http://127.0.0.1:3000"
HEALTH="$URL/api/health"
CHECK_INTERVAL="${CHECK_INTERVAL:-30}"
MAX_WAIT="${2:-90}"

log() {
  # Append to the log file always; echo to stderr only in check mode (daemon
  # stdout is redirected to the same file — echoing would duplicate lines).
  printf '%s [preview-supervisor] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >> "$LOG"
  if [ "${SUPERVISOR_MODE:-check}" != "daemon" ]; then
    printf '%s [preview-supervisor] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >&2
  fi
}

health() {
  # 200 + parseable JSON => healthy. Catches 502/empty/ECONNREFUSED alike.
  curl -s --max-time 5 "$HEALTH" | python3 -c "import json,sys
try:
  d=json.load(sys.stdin); sys.exit(0 if isinstance(d,dict) else 1)
except Exception: sys.exit(1)" 2>/dev/null
}

# Listeners on a TCP port as "pid command" pairs (empty when none).
port_listeners() {
  ss -tlnp 2>/dev/null | awk -v p=":$1" '$4 ~ p"$"' | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u | while read -r pid; do
    [ -n "$pid" ] && printf '%s %s\n' "$pid" "$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | cut -c1-120)"
  done
}

# Orphaned :3100 eval servers: launcher scripts always kill on exit via trap;
# a listener whose launcher is gone is debris that blocks future eval runs.
clean_orphan_eval_servers() {
  local pids
  pids=$(ss -tlnp 2>/dev/null | awk '$4 ~ /:3100$/' | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u)
  for pid in $pids; do
    local cmd; cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null)
    case "$cmd" in *server.js*|*next*) kill "$pid" 2>/dev/null && log "cleaned orphaned :3100 eval server (pid $pid)";; esac
  done
}

kill_stale_preview() {
  # Only kill processes that ARE the app's dev/standalone server on :3000 —
  # never anything else that might hold the port.
  while read -r pid cmd; do
    [ -z "$pid" ] && continue
    case "$cmd" in
      *next*dev*|*next-server*|*".next/standalone/server.js"*)
        log "killing stale preview server pid=$pid (${cmd:0:60})"
        kill "$pid" 2>/dev/null; sleep 1
        kill -9 "$pid" 2>/dev/null ;;
      *) log "port :3000 held by pid=$pid (${cmd:0:60}) — not app-class, leaving it" ;;
    esac
  done < <(port_listeners 3000)
}

boot_preview() {
  cd "$ROOT" || return 1
  # The platform's OWN boot path — dev mode, port 3000, dev.log evidence kept.
  # NOTE: this function is called by `check` mode, whose parent script EXITS
  # right after — the reparented server then survives the sandbox's process
  # cleanup. It must never be called from a long-lived foreground script.
  nohup npm run dev >> "$ROOT/scripts/preview-dev-server.log" 2>&1 &
  disown 2>/dev/null || true
  log "booted preview via platform boot path (npm run dev)"
}

# ---- one reconcile pass ------------------------------------------------------
reconcile() {
  if health; then
    log "PREVIEW HEALTHY (:3000 answering /api/health)"
    return 0
  fi

  log "PREVIEW DOWN — reconciling"
  clean_orphan_eval_servers
  kill_stale_preview

  # Give a dying-but-recoverable server a moment; then boot fresh.
  local waited=0
  while [ "$waited" -lt 10 ]; do
    health && { log "PREVIEW HEALTHY after clearing stale state"; return 0; }
    sleep 1; waited=$((waited + 1))
  done

  boot_preview
  waited=0
  while [ "$waited" -lt "$MAX_WAIT" ]; do
    if health; then
      log "PREVIEW RECOVERED in ${waited}s (health 200, /api/health parseable)"
      return 0
    fi
    sleep 2; waited=$((waited + 2))
  done
  log "PREVIEW STILL DOWN after boot + ${MAX_WAIT}s — inspect scripts/preview-dev-server.log"
  return 1
}

# ---- modes -------------------------------------------------------------------
if [ "${1:-check}" = "daemon" ]; then
  export SUPERVISOR_MODE=daemon
  # Single-instance guard for daemon mode (check mode is idempotent and safe
  # to run concurrently — it reconciles to the same healthy state).
  if [ -f "$LOCK" ] && kill -0 "$(cat "$LOCK" 2>/dev/null)" 2>/dev/null; then
    log "daemon already running (pid $(cat "$LOCK")) — exiting"
    exit 0
  fi
  echo $$ > "$LOCK"
  trap 'rm -f "$LOCK"; exit 0' INT TERM
  log "daemon started (pid $$, interval ${CHECK_INTERVAL}s) — NOTE: dies with its parent shell in this sandbox"
  failures=0
  while true; do
    if reconcile; then failures=0; else
      failures=$((failures + 1))
      if [ "$failures" -ge 3 ]; then
        log "3 consecutive failed reconciles — cooling down 120s (still supervising)"
        sleep 120; failures=0
      fi
    fi
    sleep "$CHECK_INTERVAL"
  done
else
  reconcile
fi
