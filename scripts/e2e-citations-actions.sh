#!/usr/bin/env bash
# BEAN Intelligence — RIISHE citations/actions/Auto-accuracy: live acceptance.
# Real route, real gateway, real retrieval. No mocks.
set -u

BASE="http://localhost:3000"
ORIGIN="https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai"
JAR="/home/z/my-project/scripts/e2e-cit-cookies.txt"
OUT="/home/z/my-project/scripts/e2e-cit-out"
mkdir -p "$OUT"
rm -f "$JAR"

BR_HEADERS=(-H "Origin: $ORIGIN" -H "Sec-Fetch-Site: same-origin" -H "Sec-Fetch-Mode: cors" -H "Sec-Fetch-Dest: empty")

TS=$(date +%s)
EMAIL="e2e-cit-$TS@bean-test.dev"

echo "================ 0. REGISTER ================"
S=$(curl -s -o "$OUT/reg.json" -w "%{http_code}" -X POST "$BASE/api/auth/register" \
  -b "$JAR" -c "$JAR" --max-time 60 "${BR_HEADERS[@]}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"E2eTest!Passw0rd\",\"name\":\"E2E Citations\"}")
echo "register -> $S"

analyze() { # file label
  local f="$1" label="$2"
  echo "---- $label ----"
  echo "  researching-stage events: $(grep -c '"stage":"researching"' "$f")"
  echo "  queries: $(grep -o '"research":{"queries":\[[^]]*\]}' "$f" | head -1)"
  node -e '
    const fs = require("fs");
    const raw = fs.readFileSync(process.argv[1], "utf8");
    let content = "", meta = null, sawDone = false, convId = null;
    for (const line of raw.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      let e; try { e = JSON.parse(line.slice(6)); } catch { continue; }
      if (e.delta) content += e.delta;
      if (e.meta) meta = e.meta;
      if (e.done) { sawDone = true; if (e.conversationId) convId = e.conversationId; }
    }
    console.log("  done event:", sawDone, "| conversationId:", convId);
    console.log("  ANSWER:", JSON.stringify(content.slice(0, 400)));
    if (meta) {
      console.log("  states:", JSON.stringify(meta.states));
      console.log("  searchMode:", meta.searchMode, "| retrievedAt:", meta.retrievedAt ?? "none");
      console.log("  grounding:", JSON.stringify(meta.grounding ?? null));
      console.log("  sources:", meta.sources.length);
      for (const s of meta.sources) {
        console.log(`    [${s.id}] ${s.hostName} | date=${s.date ?? "none"} | official=${s.official} | pageRead=${s.pageRead} | cited=${s.cited ?? false} | ${s.url.slice(0, 90)}`);
      }
      console.log("  verification:", JSON.stringify(meta.verification ?? []));
      console.log("  degraded:", JSON.stringify((meta.degraded ?? []).slice(0, 4)));
      // citation integrity: every [n] in the answer resolves to a source
      const ids = [...content.matchAll(/\[(\d{1,2})\](?!\()/g)].map(m => Number(m[1]));
      const srcIds = new Set(meta.sources.map(s => s.id));
      const dangling = ids.filter(i => !srcIds.has(i));
      console.log("  inline citation ids:", JSON.stringify([...new Set(ids)]), "| dangling:", JSON.stringify([...new Set(dangling)]));
    } else {
      console.log("  meta: NONE");
    }
  ' "$f"
}

echo "================ A. WEB MODE: TN Chief Minister ================"
S=$(curl -s -o "$OUT/a-web.sse" -w "%{http_code}" -X POST "$BASE/api/riishe/chat?stream=1" \
  -b "$JAR" -c "$JAR" --max-time 240 "${BR_HEADERS[@]}" \
  -H "Content-Type: application/json" -H "Accept: text/event-stream" \
  -d '{"message":"Who is the current Chief Minister of Tamil Nadu?","searchMode":"on"}')
echo "web -> $S"
analyze "$OUT/a-web.sse" "A: Web mode"

echo ""
echo "================ B. AUTO MODE: same question ================"
sleep 3
S=$(curl -s -o "$OUT/b-auto.sse" -w "%{http_code}" -X POST "$BASE/api/riishe/chat?stream=1" \
  -b "$JAR" -c "$JAR" --max-time 240 "${BR_HEADERS[@]}" \
  -H "Content-Type: application/json" -H "Accept: text/event-stream" \
  -d '{"message":"Who is the Chief Minister of Tamil Nadu?","searchMode":"auto"}')
echo "auto -> $S"
analyze "$OUT/b-auto.sse" "B: Auto mode (no explicit 'current')"

echo ""
echo "================ F. dedup/consistency: same-page sources counted once ================"
node -e '
  const fs = require("fs");
  for (const [label, f] of [["A-web", "a-web.sse"], ["B-auto", "b-auto.sse"]]) {
    const raw = fs.readFileSync(`${process.argv[1]}/${f}`, "utf8");
    let meta = null;
    for (const line of raw.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      try { const e = JSON.parse(line.slice(6)); if (e.meta) meta = e.meta; } catch {}
    }
    if (!meta) continue;
    const canon = (u) => { try { const x = new URL(u); return `${x.protocol}//${x.hostname.replace(/^www\./,"")}${x.pathname.replace(/\/$/,"")}`; } catch { return u; } };
    const keys = meta.sources.map(s => canon(s.url));
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    console.log(`  ${label}: sources=${meta.sources.length} canonical-duplicates=${dupes.length} citedCount=${meta.sources.filter(s => s.cited).length}`);
  }
' "$OUT"

echo ""
echo "================ E. unsupported-claim scan (election-result explanations) ================"
node -e '
  const fs = require("fs");
  for (const [label, f] of [["A-web", "a-web.sse"], ["B-auto", "b-auto.sse"]]) {
    const raw = fs.readFileSync(`${process.argv[1]}/${f}`, "utf8");
    let content = "", meta = null;
    for (const line of raw.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      try { const e = JSON.parse(line.slice(6)); if (e.delta) content += e.delta; if (e.meta) meta = e.meta; } catch {}
    }
    const electionClaims = (content.match(/[^.!?]*(won the election|election result|sworn in)[^.!?]*[.!?]/gi) ?? []).map(s => s.trim());
    console.log(`  ${label}: election/swearing-in sentences found: ${electionClaims.length}`);
    for (const s of electionClaims) console.log(`    - ${s.slice(0, 220)}`);
    if (meta?.grounding) console.log(`    grounding: ${JSON.stringify(meta.grounding)}`);
    if (meta) console.log(`    states: ${JSON.stringify(meta.states)}`);
  }
' "$OUT"
