#!/usr/bin/env bash
# BEAN Intelligence — RIISHE clean-citations & verification UX: live acceptance.
# Real route, real gateway, real retrieval. No mocks.
set -u

BASE="http://localhost:3000"
ORIGIN="https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai"
JAR="/home/z/my-project/scripts/e2e-clean-cookies.txt"
OUT="/home/z/my-project/scripts/e2e-clean-out"
mkdir -p "$OUT"

BR_HEADERS=(-H "Origin: $ORIGIN" -H "Sec-Fetch-Site: same-origin" -H "Sec-Fetch-Mode: cors" -H "Sec-Fetch-Dest: empty")

TS=$(date +%s)
EMAIL="e2e-clean2-$TS@bean-test.dev"

echo "================ 0. REGISTER ================"
S=$(curl -s -o "$OUT/reg2.json" -w "%{http_code}" -X POST "$BASE/api/auth/register" \
  -b "$JAR" -c "$JAR" --max-time 60 "${BR_HEADERS[@]}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"E2eTest!Passw0rd\",\"name\":\"E2E Clean Citations 2\"}")
echo "register -> $S"

analyze() { # file label
  node -e '
    const fs = require("fs");
    const raw = fs.readFileSync(process.argv[1], "utf8");
    let content = "", meta = null, sawDone = false, errored = null, resets = 0, doneContent = null;
    for (const line of raw.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      let e; try { e = JSON.parse(line.slice(6)); } catch { continue; }
      if (e.reset) { content = ""; resets++; }
      if (e.delta) content += e.delta;
      if (e.done) { sawDone = true; if (e.content) doneContent = e.content; }
      if (e.meta) meta = e.meta;
      if (e.error) errored = e.error;
    }
    const visible = doneContent ?? content; // authoritative persisted content
    const strip = s => s
      .replace(/\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]\(#bean-src-\d{1,2}\)/g, "")
      .replace(/\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\](?!\()/g, "")
      .replace(/\(\s*\)/g, "");
    const summary = {
      sawDone, errored, resets,
      contentChars: visible.length,
      contentPreview: visible.slice(0, 340).replace(/\n/g, " | "),
      states: meta?.states ?? null,
      sourceCount: meta?.sources?.length ?? 0,
      sources: (meta?.sources ?? []).map(s => ({ id: s.id, title: (s.title||"").slice(0,46), host: s.hostName, date: s.date, cited: s.cited, supports: s.supports ? s.supports.slice(0,56) : null })),
      verification: (meta?.verification ?? []).map(v => v.check + ":" + v.status),
      grounding: meta?.grounding ?? null,
      degradedNotes: (meta?.degraded ?? []).map(d => d.slice(0, 88)),
      markerIds: [...new Set((visible.match(/\[(\d{1,2})\]/g) ?? []).map(m => Number(m.slice(1,-1))))],
      sourceIds: (meta?.sources ?? []).map(s => s.id),
      retrievedAt: meta?.retrievedAt ? "YES" : "no",
    };
    summary.orphanMarkers = summary.markerIds.filter(id => !summary.sourceIds.includes(id));
    summary.copyHasMarkers = /\[\d{1,2}(?:\s*,\s*\d{1,2})*\]/.test(strip(visible));
    const norm = s => s.toLowerCase().replace(/^[\s>]*([-*+]|\d{1,2}[.)])\s+/, "").replace(/[\u201C\u201D"]/g, "").replace(/\[\d{1,2}(?:\s*,\s*\d{1,2})*\]/g, "").replace(/[.!?:;,]+$/, "").replace(/\s+/g, " ").trim();
    const sents = visible.split(/(?<=[.!?])\s+/).map(norm).filter(s => s.length >= 12 && s.includes(" "));
    const seen = new Set(); let dups = 0;
    for (const s of sents) { if (seen.has(s)) dups++; else seen.add(s); }
    summary.duplicateSentences = dups;
    summary.selfCheckVisible = /SELF_CHECK|CHECK:/.test(visible);
    console.log(JSON.stringify(summary, null, 1));
  ' "$1"
}

ask() { # file message mode
  local f="$1" msg="$2" mode="${3:-auto}"
  curl -s -N --max-time 240 -X POST "$BASE/api/riishe/chat?stream=1" \
    -b "$JAR" -c "$JAR" "${BR_HEADERS[@]}" \
    -H "Content-Type: application/json" \
    -d "{\"message\":$(node -e 'console.log(JSON.stringify(process.argv[1]))' "$msg"),\"searchMode\":\"$mode\"}" > "$f"
}

echo ""
echo "================ TEST 1: GREETING (Auto) ================"
ask "$OUT/r1-greeting.sse" "Hi! How are you today?"
echo "greeting:"; analyze "$OUT/r1-greeting.sse"

echo ""
echo "================ TEST 2: SIMPLE MATH (Auto) ================"
ask "$OUT/r2-math.sse" "What is 17 * 23 - 45? Show the calculation."
echo "math:"; analyze "$OUT/r2-math.sse"

echo ""
echo "================ TEST 3: CURRENT EVENTS (Auto) ================"
ask "$OUT/r3-tn-cm-auto.sse" "Who is the Chief Minister of Tamil Nadu right now?"
echo "TN CM auto:"; analyze "$OUT/r3-tn-cm-auto.sse"

echo ""
echo "================ TEST 4: WEB MODE (forced research) ================"
ask "$OUT/r4-tn-cm-web.sse" "Who is the current Chief Minister of Tamil Nadu and when did they take office?"
echo "TN CM web:"; analyze "$OUT/r4-tn-cm-web.sse"

echo ""
echo "================ TEST 5: STABLE CONCEPT (Auto) ================"
ask "$OUT/r5-stable.sse" "Why is the sky blue?"
echo "stable:"; analyze "$OUT/r5-stable.sse"

echo ""
echo "================ DONE ================"
