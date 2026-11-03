#!/usr/bin/env python3
"""
READ-ONLY infrastructure probe for the preview 502 recovery.

Strictly read-only: HTTP GET requests + os.stat() on two database files.
No process management, no file writes (except this probe's own stdout log),
no configuration changes. Used to establish the exact current state of:
  - the public preview domain (default route + XTransformPort steering)
  - 127.0.0.1:3000 (platform ingress default target)
  - 127.0.0.1:3100 (previously reported production instance)
  - which database each reachable app instance is wired to (via stat + an
    authenticated READ-only conversations list using the existing probe cookie)
"""
import http.client
import json
import os
import ssl
import sys
import time

PREVIEW_HOST = "preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai"
COOKIE_FILE = "/home/z/my-project/scripts/e2e-verify-out/cookies.txt"

ctx = ssl.create_default_context()


def log(*a):
    print(*a, flush=True)


def get(host, port, path, scheme="http", headers=None, timeout=20):
    """GET, return (status, server_header, content_type, body_bytes, error)."""
    try:
        if scheme == "https":
            conn = http.client.HTTPSConnection(host, port, context=ctx, timeout=timeout)
        else:
            conn = http.client.HTTPConnection(host, port, timeout=timeout)
        h = {"User-Agent": "bean-infra-probe/1.0 (read-only)", "Accept-Encoding": "identity"}
        if headers:
            h.update(headers)
        t0 = time.time()
        conn.request("GET", path, headers=h)
        r = conn.getresponse()
        body = r.read(65536)
        dt = time.time() - t0
        out = (
            r.status,
            r.getheader("Server", ""),
            r.getheader("Content-Type", ""),
            r.getheader("X-Powered-By", ""),
            body,
            dt,
        )
        conn.close()
        return out
    except Exception as e:  # connection refused etc.
        return None, None, None, None, f"{type(e).__name__}: {e}".encode(), 0.0


def session_token():
    for line in open(COOKIE_FILE, encoding="utf-8", errors="replace"):
        parts = line.rstrip("\n").split("\t")
        if len(parts) >= 7 and parts[5] == "bean_session":
            return parts[6]
        if "bean_session=" in line:
            import re
            m = re.search(r"bean_session=([^;\s]+)", line)
            if m:
                return m.group(1)
    return None


def stat_line(path):
    try:
        st = os.stat(path)
        return f"size={st.st_size} mtime={time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(st.st_mtime))}"
    except Exception as e:
        return f"UNAVAILABLE ({type(e).__name__})"


log("=" * 78)
log("READ-ONLY PROBE", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
log("=" * 78)

log("\n--- DB FILE STATS (stat only, files not opened for write) ---")
log("db/custom.db (REAL user data) :", stat_line("/home/z/my-project/db/custom.db"))
log("verify.db (E2E throwaway copy):", stat_line("/home/z/my-project/scripts/e2e-verify-out/verify.db"))

log("\n--- LOCAL PORTS ---")
for label, port, path in [
    ("127.0.0.1:3000 GET /api/health", 3000, "/api/health"),
    ("127.0.0.1:3000 GET /", 3000, "/"),
    ("127.0.0.1:3100 GET /api/health", 3100, "/api/health"),
    ("127.0.0.1:3100 GET /", 3100, "/"),
]:
    st, server, ctype, xpb, body, dt = get("127.0.0.1", port, path)
    if st is None:
        log(f"{label:34s} -> NOT LISTENING ({body.decode()[:80]})")
    else:
        snippet = body[:200].decode("utf-8", "replace").replace("\n", " ")
        log(f"{label:34s} -> {st} {dt*1000:.0f}ms ctype={ctype} server={server!r} xpowered={xpb!r}")
        log(f"{'':38s}body[:200]={snippet!r}")

log("\n--- PUBLIC PREVIEW DOMAIN (default route = ingress default handle) ---")
for label, path in [
    ("preview GET /", "/"),
    ("preview GET /api/health", "/api/health"),
    ("preview GET /?XTransformPort=3000", "/?XTransformPort=3000"),
    ("preview GET /api/health?XTransformPort=3000", "/api/health?XTransformPort=3000"),
    ("preview GET /api/health?XTransformPort=3100", "/api/health?XTransformPort=3100"),
]:
    st, server, ctype, xpb, body, dt = get(PREVIEW_HOST, 443, path, scheme="https")
    if st is None:
        log(f"{label:46s} -> ERROR: {body.decode()[:120]}")
        continue
    isdev = b"/_next/static/development" in body
    title = ""
    if b"<title>" in body:
        title = body.split(b"<title>")[1].split(b"</title>")[0][:80].decode("utf-8", "replace")
    log(f"{label:46s} -> {st} {dt*1000:.0f}ms ctype={ctype} devMarker={isdev} title={title!r}")
    if path.startswith("/api/health") and st == 200:
        try:
            j = json.loads(body)
            log(f"{'':48s}ok={j.get('ok')} live={j.get('live')} time={j.get('time')}")
        except Exception:
            pass

log("\n--- DB WIRING DISCRIMINATOR (READ-only conversations list, existing probe cookie) ---")
tok = session_token()
if not tok:
    log("no bean_session token in cookie jar; skipping")
else:
    st, server, ctype, xpb, body, dt = get(
        PREVIEW_HOST, 443, "/api/riishe/conversations", scheme="https",
        headers={"Cookie": f"bean_session={tok}", "Origin": f"https://{PREVIEW_HOST}"},
    )
    if st is None:
        log("request failed:", body.decode()[:120])
    else:
        b = body[:400].decode("utf-8", "replace").replace("\n", " ")
        log(f"GET /api/riishe/conversations -> {st} ({len(body)} bytes)")
        log(f"  body[:400]={b!r}")
        if st == 200:
            try:
                j = json.loads(body)
                items = j if isinstance(j, list) else j.get("conversations", [])
                log(f"  -> wired to a DB containing the e2e probe account; conversation count={len(items)}")
                log("     (e2e-stream-1103@bean.dev exists ONLY in verify.db; real custom.db lacks it)")
            except Exception:
                pass
        else:
            log("  -> probe account NOT authenticated on this instance")
            log("     (expected if the app is wired to the REAL db/custom.db, which lacks that account)")

log("\nDONE (read-only; nothing on the system was modified)")
