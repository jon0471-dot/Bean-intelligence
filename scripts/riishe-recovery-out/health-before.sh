#!/bin/bash
# ONE health poll (cache state unknown — may be warm; worst case 3 metered calls)
T=$(date -u +%FT%TZ)
curl -s --max-time 30 "http://localhost:3000/api/health" > scripts/riishe-recovery-out/health-before-$T.json
echo "saved at $T"
bun -e '
const h = await Bun.file(process.argv[2]).json();
const p = h.products;
const pick = (x) => ({ status: x.status, available: x.available, cat: x.probe?.failureCategory, detail: (x.probe?.detail ?? "").slice(0, 120), lat: x.probe?.latencyMs });
console.log(JSON.stringify({ riishe: pick(p.riishe), giftz: pick(p["code-giftz"]), research: p.riishe.research?.probe, breaker: h.gateway?.breaker?.classes?.map(c => ({ cls: c.class, cooling: c.coolingDown, streak: c.consecutive429s, skipped: c.skippedCalls })) }, null, 1));
' scripts/riishe-recovery-out/health-before-*.json
