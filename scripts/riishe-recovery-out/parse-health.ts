const path = process.argv[2]
const h = await Bun.file(path).json()
const p = h.products
const pick = (x: any) => ({ status: x.status, available: x.available, cat: x.probe?.failureCategory, lat: x.probe?.latencyMs, checkedAt: x.probe?.checkedAt, detail: (x.probe?.detail ?? '').slice(0, 160) })
console.log(JSON.stringify({
  riishe: pick(p.riishe),
  research: { avail: p.riishe.research?.available, cat: p.riishe.research?.probe?.failureCategory, lat: p.riishe.research?.probe?.latencyMs, detail: (p.riishe.research?.probe?.detail ?? '').slice(0, 160) },
  giftz: pick(p['code-giftz']),
  breaker: h.gateway?.breaker?.classes?.map((c: any) => ({ cls: c.class, cooling: c.coolingDown, streak: c.consecutive429s, skipped: c.skippedCalls })),
}, null, 1))
