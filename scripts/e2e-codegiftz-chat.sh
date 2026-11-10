#!/bin/bash
# CODE GIFTZ chat-first rebuild — live E2E against the real backend.
# Flow: register -> generate small web app (SSE) -> inspect files -> sandbox
# run (success + honest failure) -> follow-up change via chat -> attachment
# turn -> ownership isolation -> retry contract.
set -u
BASE="http://localhost:3000"
OUT="/home/z/my-project/scripts/e2e-out"
TS=$(date +%s)
CK="$OUT/cg-ck.txt"
ORIGIN="https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai"
PASS=0; FAIL=0
check() { if [ "$2" -eq 0 ]; then PASS=$((PASS+1)); echo "PASS: $1 — $3"; else FAIL=$((FAIL+1)); echo "FAIL: $1 — $3"; fi }

curl -s -c "$CK" -X POST "$BASE/api/auth/register" -H 'content-type: application/json' -H "origin: $ORIGIN" \
  -d "{\"email\":\"cgchat-$TS@bean.test\",\"password\":\"E2e-Cg-2026!\",\"name\":\"CG Chat\"}" | grep -q '"ok":true'
check "register" $? "-"

ssetail() { # ssetail <payload> <outfile>
  curl -s -N -b "$CK" -X POST "$BASE/api/code-giftz/chat?stream=1" \
    -H 'content-type: application/json' -H "origin: $ORIGIN" \
    -d "$1" -o "$2" --max-time 300
  python3 - "$2" << 'PYEOF'
import json, sys
done = None
for line in open(sys.argv[1]):
    if line.startswith('data: '):
        try:
            evt = json.loads(line[6:])
            if evt.get('done'): done = evt
        except Exception: pass
print(json.dumps(done) if done else '{}')
PYEOF
}

# ---- TURN 1: small web app + util/test files -----------------------------------
echo "=== TURN 1: generate small web app ==="
DONE=$(ssetail '{"message":"Build a small web app: index.html with a heading Counter and a button, styles.css styling it black and gold, app.js wiring the button click to increment a counter shown on the page. Also add utils.js exporting function add(a,b) and utils.test.js that prints PASS when add(2,3) equals 5."}' "$OUT/cg-t1.sse")
echo "$DONE" > "$OUT/cg-t1-done.json"
python3 - "$OUT/cg-t1-done.json" << 'PYEOF'
import json, sys
d = json.load(open('/home/z/my-project/scripts/e2e-out/cg-t1-done.json'))
ok = bool(d.get('ok'))
print('T1 ok:', ok)
if not ok:
    print('T1 error:', d.get('error', '')[:200])
    raise SystemExit
changes = d.get('fileChanges', [])
print('T1 sessionId:', d.get('sessionId'))
print('T1 files:', [(c['path'], c['status'], f"+{c['added']}") for c in changes])
paths = {c['path'] for c in changes}
expected = {'index.html', 'styles.css', 'app.js', 'utils.js', 'utils.test.js'}
print('T1 all 5 files generated:', expected.issubset(paths))
ws = json.dumps(d)
print('T1 counter in app.js:', ('count' in ws or 'counter' in ws))
PYEOF
SID=$(python3 -c "import json;print(json.load(open('$OUT/cg-t1-done.json')).get('sessionId',''))")
[ -n "$SID" ]; check "turn1 produced sessionId" $? "sid=$SID"

python3 - "$OUT/cg-t1-done.json" << 'PYEOF' ; check "turn1: 5 files, all generated" $? ""
import json, sys
d = json.load(open('/home/z/my-project/scripts/e2e-out/cg-t1-done.json'))
assert d.get('ok'), d.get('error')
paths = {c['path'] for c in d['fileChanges']}
assert {'index.html','styles.css','app.js','utils.js','utils.test.js'}.issubset(paths), paths
assert all(c['status'] == 'generated' for c in d['fileChanges'])
files = {f['path']: f for f in d['files']}
assert '<button' in files['index.html']['content'], 'button missing from html'
assert 'add' in files['utils.js']['content']
assert 'PASS' in files['utils.test.js']['content']
PYEOF

# ---- SANDBOX RUNS ---------------------------------------------------------------
echo "=== RUN utils.test.js (expect real success) ==="
curl -s -b "$CK" -X POST "$BASE/api/code-giftz/run" -H 'content-type: application/json' -H "origin: $ORIGIN" \
  -d "{\"sessionId\":\"$SID\",\"approval\":true,\"entryPath\":\"utils.test.js\"}" > "$OUT/cg-run-test.json"
python3 - "$OUT/cg-run-test.json" << 'PYEOF' ; check "run utils.test.js: exit 0, PASS in stdout" $? ""
import json, sys
d = json.load(open('/home/z/my-project/scripts/e2e-out/cg-run-test.json'))
r = d['run']
assert r['exitCode'] == 0, r
assert 'PASS' in r['stdout'], r['stdout']
assert not r['timedOut']
PYEOF

echo "=== RUN app.js (DOM code in bun — expect HONEST failure) ==="
curl -s -b "$CK" -X POST "$BASE/api/code-giftz/run" -H 'content-type: application/json' -H "origin: $ORIGIN" \
  -d "{\"sessionId\":\"$SID\",\"approval\":true,\"entryPath\":\"app.js\"}" > "$OUT/cg-run-app.json"
python3 - "$OUT/cg-run-app.json" << 'PYEOF' ; check "run app.js: honest failure surfaced (nonzero exit/stderr)" $? ""
import json, sys
d = json.load(open('/home/z/my-project/scripts/e2e-out/cg-run-app.json'))
r = d['run']
# DOM-dependent code cannot run under bun — the run route must report the
# REAL result (nonzero exit / ReferenceError), never a fake success.
assert (r['exitCode'] in (None, 1)) or r['timedOut'] or len(r['stderr']) > 0, r
ok_means_exit0 = r['exitCode'] == 0 and not r['timedOut'] and len(r['stderr']) == 0
print('   (app.js happened to run clean:', ok_means_exit0, ')')
PYEOF

# ---- TURN 2: follow-up change ----------------------------------------------------
echo "=== TURN 2: change counter start + button label ==="
DONE=$(ssetail "{\"sessionId\":\"$SID\",\"message\":\"Change the counter to start at 10 instead of 0, and make the button text read Clicked N times after each click. Update only the files that need to change.\"}" "$OUT/cg-t2.sse")
echo "$DONE" > "$OUT/cg-t2-done.json"
python3 - "$OUT/cg-t2-done.json" << 'PYEOF' ; check "turn2: app.js modified with previousContent kept" $? ""
import json, sys
d = json.load(open('/home/z/my-project/scripts/e2e-out/cg-t2-done.json'))
assert d.get('ok'), d.get('error')
changes = {c['path']: c for c in d['fileChanges']}
assert 'app.js' in changes, changes
assert changes['app.js']['status'] == 'modified', changes
files = {f['path']: f for f in d['files']}
app = files['app.js']
assert app['previousContent'] is not None and len(app['previousContent']) > 0, 'previousContent lost'
assert app['content'] != app['previousContent']
assert ('10' in app['content']), 'start-at-10 not applied'
assert 'Clicked' in app['content'] or 'clicked' in app['content'], 'button label not applied'
# untouched files must NOT appear as modified
for c in changes.values():
    if c['path'] in ('utils.js', 'utils.test.js'):
        raise AssertionError(f'unnecessary change to {c.path}')
print('   changed files:', list(changes.keys()))
PYEOF

# ---- TURN 3: attachment-driven change ---------------------------------------------
echo "=== TURN 3: attachment (notes.md) drives a change ==="
printf 'Project notes\nTagline: BEAN Counter — gold on black, always counting.\n' > "$OUT/notes.md"
curl -s -b "$CK" -X POST "$BASE/api/riishe/documents" -H "origin: $ORIGIN" -F "file=@$OUT/notes.md" > "$OUT/cg-doc.json"
DOCID=$(python3 -c "import json;print(json.load(open('$OUT/cg-doc.json'))['document']['id'])" 2>/dev/null)
[ -n "$DOCID" ]; check "upload attachment notes.md" $? "doc=$DOCID"
DONE=$(ssetail "{\"sessionId\":\"$SID\",\"documentIds\":[\"$DOCID\"],\"message\":\"Read the attached notes and add the tagline from them as a footer paragraph in index.html.\"}" "$OUT/cg-t3.sse")
echo "$DONE" > "$OUT/cg-t3-done.json"
python3 - "$OUT/cg-t3-done.json" << 'PYEOF' ; check "turn3: index.html modified using REAL attachment text" $? ""
import json, sys
d = json.load(open('/home/z/my-project/scripts/e2e-out/cg-t3-done.json'))
assert d.get('ok'), d.get('error')
changes = {c['path']: c for c in d['fileChanges']}
assert 'index.html' in changes, changes
files = {f['path']: f for f in d['files']}
html = files['index.html']['content']
assert 'gold on black' in html or 'always counting' in html, html[:400]
PYEOF

# ---- OWNERSHIP --------------------------------------------------------------------
echo "=== OWNERSHIP: user B cannot touch session A ==="
CK2="$OUT/cg-ck2.txt"
curl -s -c "$CK2" -X POST "$BASE/api/auth/register" -H 'content-type: application/json' -H "origin: $ORIGIN" \
  -d "{\"email\":\"cgchat2-$TS@bean.test\",\"password\":\"E2e-Cg-2026!\",\"name\":\"CG2\"}" > /dev/null
code=$(curl -s -o "$OUT/cg-foreign.json" -w "%{http_code}" -b "$CK2" "$BASE/api/code-giftz/chat/$SID" -H "origin: $ORIGIN")
[ "$code" = "404" ]; check "foreign GET session -> 404" $? "code=$code"
code=$(curl -s -o "$OUT/cg-foreign2.json" -w "%{http_code}" -b "$CK2" -X POST "$BASE/api/code-giftz/run" -H 'content-type: application/json' -H "origin: $ORIGIN" -d "{\"sessionId\":\"$SID\",\"approval\":true}")
[ "$code" = "404" ]; check "foreign sandbox run -> 404" $? "code=$code"
code=$(curl -s -o "$OUT/cg-foreign3.json" -w "%{http_code}" -b "$CK2" -X PATCH "$BASE/api/code-giftz/chat/$SID" -H 'content-type: application/json' -H "origin: $ORIGIN" -d '{"path":"app.js","content":"x"}')
[ "$code" = "404" ]; check "foreign file edit -> 404" $? "code=$code"

# ---- RETRY CONTRACT -----------------------------------------------------------------
echo "=== TURN 4: reset button (retry flag on a NEW question must NOT delete turn3's answer) ==="
DONE=$(ssetail "{\"sessionId\":\"$SID\",\"retry\":true,\"message\":\"Add a reset button next to the counter that sets the count back to 10.\"}" "$OUT/cg-t4.sse")
echo "$DONE" > "$OUT/cg-t4-done.json"
python3 - "$OUT/cg-t4-done.json" << 'PYEOF' ; check "turn4: reset button added" $? ""
import json, sys
d = json.load(open('/home/z/my-project/scripts/e2e-out/cg-t4-done.json'))
assert d.get('ok'), d.get('error')
files = {f['path']: f for f in d['files']}
html = files['index.html']['content'].lower()
appjs = files['app.js']['content'].lower()
assert 'reset' in html or 'reset' in appjs, 'reset button not found'
print('   reset present in:', 'index.html' if 'reset' in html else '', 'app.js' if 'reset' in appjs else '')
PYEOF

echo "=== TRUE RETRY: resend turn4's exact question -> pair regenerated ==="
DONE=$(ssetail "{\"sessionId\":\"$SID\",\"retry\":true,\"message\":\"Add a reset button next to the counter that sets the count back to 10.\"}" "$OUT/cg-t5.sse")
echo "$DONE" > "$OUT/cg-t5-done.json"
python3 - "$OUT/cg-t5-done.json" << 'PYEOF' ; check "true retry: regenerated cleanly (ok)" $? ""
import json, sys
d = json.load(open('/home/z/my-project/scripts/e2e-out/cg-t5-done.json'))
assert d.get('ok'), d.get('error')
PYEOF

# history after misuse-retry + true-retry: 4 user rows (t1-t4), 4 assistant rows (t1-t4; t4 regenerated in place)
curl -s -b "$CK" "$BASE/api/code-giftz/chat/$SID" -H "origin: $ORIGIN" > "$OUT/cg-detail.json"
python3 - "$OUT/cg-detail.json" << 'PYEOF' ; check "history: 4 user + 4 assistant rows, no duplicates, turn3 answer preserved" $? ""
import json, sys
d = json.load(open('/home/z/my-project/scripts/e2e-out/cg-detail.json'))
msgs = d['session']['messages']
users = [m for m in msgs if m['role'] == 'user']
assistants = [m for m in msgs if m['role'] == 'assistant']
assert len(users) == 4, f'expected 4 user rows, got {len(users)}'
assert len(assistants) == 4, f'expected 4 assistant rows, got {len(assistants)}'
t3 = users[2]['content']
assert 'attached notes' in t3
# exactly one user row per distinct question (no duplicates from retry)
contents = [u['content'] for u in users]
assert len(set(contents)) == 4, contents
PYEOF

echo ""
echo "CODE GIFTZ LIVE E2E: $PASS pass / $FAIL fail"
