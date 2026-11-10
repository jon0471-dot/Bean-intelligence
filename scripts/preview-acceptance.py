#!/usr/bin/env python3
"""
RIISHE — Final Preview Acceptance Test harness.

Runs the 9-item acceptance suite against the PUBLIC preview domain, steering
the sandbox ingress to the live production instance with the ingress' own
XTransformPort mechanism (the platform preview forwards query strings —
measured). Produces exact per-item evidence and a machine-readable report.

No production code is touched. Read-only HTTP + the account's own test
conversations (e2e-stream-1103@bean.dev).
"""
import http.client
import json
import os
import re
import ssl
import subprocess
import sys
import time

BASE_HOST = "preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai"
BASE = f"https://{BASE_HOST}"
ORIGIN = BASE
STEER = "3100"  # live production instance (platform-started 02:20 UTC)
OUT = "/home/z/my-project/scripts/preview-acceptance-out"
COOKIE_FILE = "/home/z/my-project/scripts/e2e-verify-out/cookies.txt"
os.makedirs(OUT, exist_ok=True)

REPORT = {"startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "items": {}}


def log(msg):
    print(msg, flush=True)


def session_token():
    """Extract the bean_session token from the curl cookie jar (never printed)."""
    for line in open(COOKIE_FILE, encoding="utf-8", errors="replace"):
        parts = line.rstrip("\n").split("\t")
        if len(parts) >= 7 and parts[5] == "bean_session":
            return parts[6]
        m = re.search(r"bean_session=([^;\s]+)", line)
        if m:
            return m.group(1)
    raise SystemExit("no bean_session token found in cookie jar")


TOKEN = session_token()


def curl(method, path, body=None, timeout=90, raw_to=None):
    """HTTP via the preview domain, steered to the live instance. Returns (status, body_bytes)."""
    import tempfile
    sep = "&" if "?" in path else "?"
    url = f"{BASE}{path}{sep}XTransformPort={STEER}"
    tmp = raw_to or tempfile.mkstemp(prefix="pa-", suffix=".body")[1]
    cmd = [
        "curl", "-s", "-S", "--max-time", str(timeout),
        "-o", tmp,
        "-w", "%{http_code}\t%{time_total}\t%{size_download}",
        "-X", method, url,
        "-H", f"Origin: {ORIGIN}",
        "-H", f"Cookie: bean_session={TOKEN}",
        "-H", "Accept-Encoding: identity",
    ]
    if body is not None:
        cmd += ["-H", "Content-Type: application/json", "--data-binary", json.dumps(body)]
    p = subprocess.run(cmd, capture_output=True, timeout=timeout + 15)
    tail = p.stdout.decode("utf-8", "replace").strip().split("\t")
    status = int(tail[0]) if tail and tail[0].isdigit() else 0
    ttotal = float(tail[1]) if len(tail) > 1 else 0.0
    size = int(tail[2]) if len(tail) > 2 else 0
    data = open(tmp, "rb").read()
    if not raw_to:
        os.unlink(tmp)
    return status, data, ttotal, size


def sse_post(path, payload, tag, max_seconds=300):
    """
    POST with body, stream the SSE response with per-frame arrival timestamps.
    Returns dict with protocol evidence. Frames buffered on b'\\n\\n' (also
    tolerates CRLF), so UTF-8 split across TCP chunks stays intact.
    """
    sep = "&" if "?" in path else "?"
    url = f"{path}{sep}XTransformPort={STEER}"
    conn = http.client.HTTPSConnection(BASE_HOST, timeout=max_seconds)
    headers = {
        "Origin": ORIGIN,
        "Cookie": f"bean_session={TOKEN}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "Accept-Encoding": "identity",
    }
    ev = {
        "tag": tag,
        "http_status": None,
        "response_headers": {},
        "t_connect": None,
        "frames": [],  # (t_rel, kind) kind in comment|json
        "comments": [],
        "json_events": [],
        "deltas": 0,
        "chars": 0,
        "resets": 0,
        "reset_ts": [],
        "content": "",
        "done": None,
        "error_frame": None,
        "conversation_id": None,
        "premature_eof": False,
        "wall": None,
        "max_gap_any": 0.0,
        "max_gap_content": 0.0,
        "first_content_ts": None,
        "last_content_ts": None,
        "raw_file": f"{OUT}/{tag}.sse",
    }
    body = json.dumps(payload)
    t0 = time.time()
    ev["t_connect"] = 0.0
    conn.request("POST", url, body=body, headers=headers)
    resp = conn.getresponse()
    ev["http_status"] = resp.status
    ev["response_headers"] = {k.lower(): v for k, v in resp.getheaders()}
    buf = b""
    last_any = time.time()
    last_content = time.time()
    raw = open(ev["raw_file"], "wb")
    try:
        while True:
            chunk = resp.read(4096)
            if not chunk:
                break
            now = time.time()
            ev["max_gap_any"] = max(ev["max_gap_any"], now - last_any)
            last_any = now
            raw.write(chunk)
            buf += chunk
            while b"\n\n" in buf:
                frame, buf = _split_frame(buf)
                txt = frame.decode("utf-8", "replace").strip()
                if not txt:
                    continue
                t_rel = round(now - t0, 3)
                if txt.startswith(":"):
                    ev["comments"].append({"t": t_rel, "text": txt})
                    continue
                for line in txt.splitlines():
                    line = line.strip()
                    if not line.startswith("data:"):
                        continue
                    payload_str = line[5:].strip()
                    try:
                        obj = json.loads(payload_str)
                    except json.JSONDecodeError:
                        ev["json_events"].append({"t": t_rel, "unparsable": payload_str[:200]})
                        continue
                    ev["max_gap_content"] = max(ev["max_gap_content"], now - last_content)
                    last_content = now
                    if obj.get("reset") is True:
                        ev["resets"] += 1
                        ev["reset_ts"].append(t_rel)
                        ev["content"] = ""
                        ev["json_events"].append({"t": t_rel, "reset": True})
                    elif "delta" in obj:
                        ev["deltas"] += 1
                        delta = obj.get("delta", "")
                        ev["chars"] += len(delta)
                        ev["content"] += delta
                        if ev["first_content_ts"] is None:
                            ev["first_content_ts"] = t_rel
                        ev["last_content_ts"] = t_rel
                        if ev["conversation_id"] is None and obj.get("conversationId"):
                            ev["conversation_id"] = obj["conversationId"]
                    elif obj.get("done") is True:
                        ev["done"] = obj
                        if obj.get("conversationId"):
                            ev["conversation_id"] = obj["conversationId"]
                    elif "error" in obj:
                        ev["error_frame"] = obj
                    else:
                        ev["json_events"].append({"t": t_rel, "event": _clip_event(obj)})
    finally:
        raw.close()
        try:
            conn.close()
        except Exception:
            pass
    ev["wall"] = round(time.time() - t0, 3)
    if ev["done"] is None and ev["error_frame"] is None:
        ev["premature_eof"] = True
    return ev


def _split_frame(buf):
    """Split one SSE frame off the buffer, tolerating \\n\\n and \\r\\n\\r\\n."""
    i = buf.find(b"\n\n")
    j = buf.find(b"\r\n\r\n")
    if j != -1 and (i == -1 or j < i):
        return buf[:j], buf[j + 4:]
    if i == -1:
        return b"", b""
    return buf[:i], buf[i + 2:]


def _clip_event(obj):
    slim = {}
    for k, v in obj.items():
        if isinstance(v, str) and len(v) > 120:
            slim[k] = v[:120] + "…"
        elif isinstance(v, list) and len(str(v)) > 300:
            slim[k] = str(v)[:300] + "…"
        else:
            slim[k] = v
    return slim


def summarize_stream(ev):
    d = ev["done"] or {}
    return {
        "http": ev["http_status"],
        "deltas": ev["deltas"],
        "chars": ev["chars"],
        "resets": ev["resets"],
        "comments": len(ev["comments"]),
        "first_content_ts": ev["first_content_ts"],
        "last_content_ts": ev["last_content_ts"],
        "max_gap_any_s": round(ev["max_gap_any"], 2),
        "max_gap_content_s": round(ev["max_gap_content"], 2),
        "wall_s": ev["wall"],
        "done_partial": d.get("partial"),
        "done_messageId": d.get("messageId"),
        "done_durationMs": d.get("durationMs"),
        "done_firstTokenMs": d.get("firstTokenMs"),
        "meta_states": (d.get("meta") or {}).get("states"),
        "error_frame": ev["error_frame"],
        "premature_eof": ev["premature_eof"],
        "conversationId": ev["conversation_id"],
    }


def main():
    log("=" * 72)
    log("RIISHE Final Preview Acceptance Test")
    log(f"target: {BASE} (steered via ingress XTransformPort={STEER})")
    log("=" * 72)

    # ---- S0: session -------------------------------------------------------
    st, data, _, _ = curl("GET", "/api/auth/session", timeout=30)
    sess = json.loads(data.decode("utf-8", "replace")) if st == 200 else {}
    user = sess.get("user", {})
    log(f"\n[S0] session via preview+steer: HTTP {st} user={user.get('email')} id={user.get('id')}")
    REPORT["items"]["S0_session"] = {"status": st, "user": user.get("email"), "userId": user.get("id")}
    if st != 200 or not user.get("id"):
        log("FATAL: no valid session through the preview path — cannot proceed.")
        REPORT["fatal"] = "session"
        json.dump(REPORT, open(f"{OUT}/report.json", "w"), indent=2)
        return

    # ---- T1: homepage ------------------------------------------------------
    log("\n[T1] application homepage via preview…")
    st, html, tt, size = curl("GET", "/", timeout=45, raw_to=f"{OUT}/home.html")
    markers = {m: (m.encode() in html) for m in ["BEAN", "RIISHE", "bean-intelligence", "<title>"]}
    title = re.search(rb"<title>(.*?)</title>", html, re.S)
    REPORT["items"]["T1_homepage"] = {
        "status": st, "bytes": size, "time_s": round(tt, 2),
        "title": title.group(1).decode("utf-8", "replace")[:120] if title else None,
        "markers": markers,
    }
    log(f"[T1] HTTP {st} bytes={size} title={REPORT['items']['T1_homepage']['title']!r} markers={markers}")

    # default-route (what a plain browser hit gets) — environment finding
    p = subprocess.run(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "20", f"{BASE}/"], capture_output=True)
    default_home = int(p.stdout.decode().strip() or 0)
    p = subprocess.run(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "20", f"{BASE}/api/health"], capture_output=True)
    default_health = int(p.stdout.decode().strip() or 0)
    REPORT["items"]["T1_homepage"]["default_route_home"] = default_home
    REPORT["items"]["T1_homepage"]["default_route_health"] = default_health
    log(f"[T1] default preview route (no steer): / -> HTTP {default_home}, /api/health -> HTTP {default_health}")

    # ---- T2: health --------------------------------------------------------
    log("\n[T2] /api/health via preview…")
    st, data, _, _ = curl("GET", "/api/health", timeout=45)
    health = json.loads(data.decode("utf-8", "replace")) if st == 200 else {}
    riishe = health.get("products", {}).get("riishe", {})
    REPORT["items"]["T2_health"] = {
        "status": st, "ok": health.get("ok"), "live": health.get("live"),
        "riishe_available": riishe.get("available"),
        "riishe_probe": riishe.get("probe", {}).get("detail"),
        "riishe_research": (riishe.get("research") or {}).get("available"),
        "time": health.get("time"),
    }
    log(f"[T2] HTTP {st} ok={health.get('ok')} riishe.available={riishe.get('available')} research={REPORT['items']['T2_health']['riishe_research']}")

    # ---- T3 + T9 baseline: existing conversations ---------------------------
    log("\n[T3] open existing RIISHE conversation…")
    st, data, _, _ = curl("GET", "/api/riishe/chat", timeout=45)
    lst = json.loads(data.decode("utf-8", "replace")) if st == 200 else {}
    convs_before = lst.get("conversations", [])
    json.dump({"status": st, "conversations": convs_before}, open(f"{OUT}/convs-before.json", "w"), indent=2)
    n_before = len(convs_before)
    total_msgs_before = sum(c.get("messages", 0) for c in convs_before)
    log(f"[T3] HTTP {st} conversations={n_before} total_messages={total_msgs_before}")
    for c in convs_before[:6]:
        log(f"     - {c['id'][:14]}… msgs={c.get('messages')} title={c.get('title','')[:60]!r}")

    pick = next((c for c in convs_before if "fifa" in c.get("title", "").lower()), None)
    if pick is None:
        pick = next((c for c in convs_before if c.get("messages", 0) >= 2), convs_before[0] if convs_before else None)
    REPORT["items"]["T3_open_existing"] = {"status": st, "conversations": n_before, "picked": pick}
    existing = None
    if pick:
        st, data, _, _ = curl("GET", f"/api/riishe/conversations/{pick['id']}", timeout=45)
        det = json.loads(data.decode("utf-8", "replace")) if st == 200 else {}
        existing = det.get("conversation")
        json.dump(det, open(f"{OUT}/conv-before.json", "w"), indent=2)
        log(f"[T3] detail HTTP {st}: conv={pick['id'][:14]}… rows={len((existing or {}).get('messages', []))}")
        REPORT["items"]["T3_open_existing"]["detail_status"] = st
        REPORT["items"]["T3_open_existing"]["detail_rows"] = len((existing or {}).get("messages", []))

    # ---- T4: normal prompt in the EXISTING conversation ---------------------
    log("\n[T4] normal prompt (existing conversation, full streaming)…")
    t4 = None
    if existing:
        t4 = sse_post("/api/riishe/chat?stream=1",
                      {"conversationId": existing["id"],
                       "message": "Reply with exactly this token and nothing else: PREVIEW-ACCEPTANCE-OK"},
                      "t4-normal")
        json.dump(summarize_stream(t4), open(f"{OUT}/t4-summary.json", "w"), indent=2)
        log(f"[T4] {json.dumps(summarize_stream(t4))}")
        REPORT["items"]["T4_normal_stream"] = summarize_stream(t4)
    else:
        REPORT["items"]["T4_normal_stream"] = {"skipped": "no existing conversation"}
        log("[T4] SKIPPED — no existing conversation")

    # ---- T5: long response --------------------------------------------------
    log("\n[T5] long response (must not silently terminate)…")
    t5 = sse_post("/api/riishe/chat?stream=1",
                  {"message": ("Write a detailed technical brief of at least 1200 words explaining "
                               "how TLS 1.3 differs from TLS 1.2. Use section headings, cover the "
                               "handshake, cipher suites, key schedule, 0-RTT, and downgrade "
                               "protection, and end with a short summary list.")},
                  "t5-long", max_seconds=300)
    json.dump(summarize_stream(t5), open(f"{OUT}/t5-summary.json", "w"), indent=2)
    log(f"[T5] {json.dumps(summarize_stream(t5))}")
    REPORT["items"]["T5_long_stream"] = summarize_stream(t5)

    # ---- T6: Tamil Unicode --------------------------------------------------
    log("\n[T6] Tamil Unicode streaming…")
    t6 = sse_post("/api/riishe/chat?stream=1",
                  {"message": "தமிழில் மட்டும் பதிலளிக்கவும். சென்னை நகரம் பற்றி இரண்டு வாக்கியங்கள் எழுதுங்கள்."},
                  "t6-tamil")
    tamil_re = re.compile(r"[\u0b80-\u0bff]")
    streamed = t6["content"]
    REPORT["items"]["T6_tamil_stream"] = summarize_stream(t6)
    REPORT["items"]["T6_tamil_stream"]["tamil_chars_streamed"] = len(tamil_re.findall(streamed))
    REPORT["items"]["T6_tamil_stream"]["streamed_head"] = streamed[:200]
    log(f"[T6] {json.dumps({k: v for k, v in summarize_stream(t6).items() if k != 'streamed_head'}, ensure_ascii=False)}")
    log(f"[T6] tamil chars streamed: {REPORT['items']['T6_tamil_stream']['tamil_chars_streamed']}")

    # ---- T7: persistence of the three turns ---------------------------------
    log("\n[T7] persistence verification…")
    def detail(cid):
        st, data, _, _ = curl("GET", f"/api/riishe/conversations/{cid}", timeout=45)
        return st, (json.loads(data.decode("utf-8", "replace")) if st == 200 else {})

    def persisted_check(cid, streamed_content, tag):
        st, det = detail(cid)
        conv = det.get("conversation") or {}
        msgs = conv.get("messages", [])
        asst = [m for m in msgs if m.get("role") == "assistant"]
        last = asst[-1] if asst else None
        exact = bool(last) and last.get("content") == streamed_content
        res = {
            "tag": tag, "detail_status": st, "rows": len(msgs),
            "assistant_rows": len(asst),
            "persisted_len": len(last.get("content", "")) if last else 0,
            "streamed_len": len(streamed_content),
            "exact_match": exact,
            "head_match": bool(last) and last.get("content", "")[:120] == streamed_content[:120],
        }
        json.dump(det, open(f"{OUT}/{tag}-conv-after.json", "w"), indent=2)
        return res, det

    persist = []
    if t4 and t4.get("conversation_id"):
        r, _ = persisted_check(t4["conversation_id"], t4["content"], "t4")
        persist.append(r); log(f"[T7] t4: {json.dumps(r)}")
    if t5 and t5.get("conversation_id"):
        r, _ = persisted_check(t5["conversation_id"], t5["content"], "t5")
        persist.append(r); log(f"[T7] t5: {json.dumps(r)}")
    if t6 and t6.get("conversation_id"):
        r, det6 = persisted_check(t6["conversation_id"], t6["content"], "t6")
        tamil_persisted = len(tamil_re.findall((det6.get("conversation") or {}).get("messages", [{}])[-1].get("content", ""))) if det6.get("conversation", {}).get("messages") else 0
        r["tamil_chars_persisted"] = tamil_persisted
        persist.append(r); log(f"[T7] t6: {json.dumps(r, ensure_ascii=False)}")
    REPORT["items"]["T7_persistence"] = persist

    # ---- T9: existing history intact ----------------------------------------
    log("\n[T9] existing conversation history integrity…")
    t9 = {"list_status": None, "conversations_after": None, "new_conversations": 0,
          "old_rows_byte_identical": None, "only_appended": None}
    st, data, _, _ = curl("GET", "/api/riishe/chat", timeout=45)
    lst2 = json.loads(data.decode("utf-8", "replace")) if st == 200 else {}
    convs_after = lst2.get("conversations", [])
    json.dump({"status": st, "conversations": convs_after}, open(f"{OUT}/convs-after.json", "w"), indent=2)
    before_ids = {c["id"] for c in convs_before}
    after_ids = {c["id"] for c in convs_after}
    t9["list_status"] = st
    t9["conversations_after"] = len(convs_after)
    t9["new_conversations"] = len(after_ids - before_ids)
    t9["all_before_still_present"] = before_ids.issubset(after_ids)
    if existing:
        st, det2 = detail(existing["id"])
        old = existing.get("messages", [])
        new = (det2.get("conversation") or {}).get("messages", [])
        t9["old_rows_byte_identical"] = (
            len(new) >= len(old)
            and all(o == n for o, n in zip(old, new))
        )
        t9["only_appended"] = len(new) >= len(old) and all(
            n.get("id") == o.get("id") for o, n in zip(old, new)
        )
        t9["rows_before"] = len(old)
        t9["rows_after"] = len(new)
    REPORT["items"]["T9_history_intact"] = t9
    log(f"[T9] {json.dumps(t9)}")

    # ---- T8: errors / protocol headers --------------------------------------
    log("\n[T8] error & protocol evidence…")
    t8 = {
        "sse_response_headers_t4": t4["response_headers"] if t4 else None,
        "sse_error_frames": [e["error_frame"] for e in (t4, t5, t6) if e and e["error_frame"]],
        "unexpected_status": [],
        "dev_log_last_write": None,
        "note": "server-side stdout of the platform-started production instance is not readable from this shell; HTTP-level + SSE-level error evidence collected above",
    }
    for name, e in (("t4", t4), ("t5", t5), ("t6", t6)):
        if e and e["http_status"] != 200:
            t8["unexpected_status"].append({name: e["http_status"]})
    try:
        t8["dev_log_last_write"] = time.strftime(
            "%Y-%m-%dT%H:%M:%SZ", time.gmtime(os.path.getmtime("/home/z/my-project/dev.log")))
    except OSError:
        pass
    # reconcile the audited run-0237 t2 persistence anomaly: was a reset involved?
    try:
        raw237 = open("/home/z/my-project/scripts/e2e-verify-out/t2-long.sse", "rb").read()
        t8["run0237_t2_reset_events"] = raw237.count(b'{"reset":true}') + raw237.count(b'{"reset": true}')
        t8["run0237_t2_done_partial"] = b'"partial":true' in raw237 or b'"partial": true' in raw237
    except OSError:
        pass
    REPORT["items"]["T8_errors"] = t8
    log(f"[T8] {json.dumps(t8, default=str)[:600]}")

    # ---- report -------------------------------------------------------------
    REPORT["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    json.dump(REPORT, open(f"{OUT}/report.json", "w"), indent=2, ensure_ascii=False)
    log("\nreport written to scripts/preview-acceptance-out/report.json")


if __name__ == "__main__":
    main()
