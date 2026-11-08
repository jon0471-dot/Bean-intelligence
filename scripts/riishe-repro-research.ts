/**
 * Reproduce the RIISHE live-research bug: "Who is the CM of Tamil Nadu?"
 * Calls the real research pipeline (runResearch) directly and prints the
 * evidence pack + degraded notes so we can see exactly why live research
 * fails.
 */
import { runResearch } from '../src/lib/research/pipeline'
import { shouldSearch } from '../src/lib/research/policy'

async function main() {
  const question = process.argv[2] ?? 'Who is the current Chief Minister of Tamil Nadu?'
  console.log(`[repro] question: ${question}`)
  const decision = shouldSearch(question)
  console.log(`[repro] decision: risk=${decision.risk} recencyDays=${decision.recencyDays ?? '-'} reason=${decision.reason}`)
  const t0 = Date.now()
  const pack = await runResearch(question, decision)
  console.log(`[repro] durationMs=${pack.durationMs} searchMs=${pack.searchMs} pageReadMs=${pack.pageReadMs}`)
  console.log(`[repro] queries: ${JSON.stringify(pack.queries)}`)
  console.log(`[repro] sources: ${pack.sources.length}`)
  for (const s of pack.sources) {
    console.log(`  [${s.id}] ${s.title} | host=${s.hostName} | date=${s.date} | pageRead=${s.pageRead}`)
    console.log(`      url=${s.url}`)
    console.log(`      snippet=${s.snippet.slice(0, 220)}`)
  }
  console.log(`[repro] degraded (${pack.degraded.length}):`)
  for (const d of pack.degraded) console.log(`  - ${d}`)
  console.log(`[repro] independent (${(pack.independent ?? []).length}) laneMs=${pack.independentMs ?? 0}:`)
  for (const d of pack.independent ?? []) console.log(`  + ${d}`)
  console.log(`[repro] staleness: ${pack.staleness}`)
  console.log(`[repro] total wall: ${Date.now() - t0}ms`)
}

main().catch((e) => {
  console.error('[repro] FAILED:', e)
  process.exit(1)
})
