/**
 * Live retrieval-side verification for the research-quality fix.
 * Runs the REAL production pipeline functions (webSearch, rankSources,
 * readPage, extractPublishedTime, stalenessWarning) against the acceptance
 * topic — no LLM solve step, so it works while chat completions are 429'd.
 * Every printed URL/date/classification is REAL provider output.
 */
import { webSearch, readPage } from '../src/lib/research/provider'
import { rankSources, stalenessWarning } from '../src/lib/research/rank'
import { buildQuerySet } from '../src/lib/research/pipeline'
import { detectSensitiveCase, coreTopic } from '../src/lib/research/sensitive'
import { shouldSearch } from '../src/lib/research/policy'

const QUERY = 'Research a current topic: Gingee girl missing'

async function main() {
  console.log('=== policy ===')
  const decision = shouldSearch(QUERY)
  console.log(JSON.stringify(decision))

  console.log('\n=== sensitive / core topic ===')
  console.log('sensitive:', JSON.stringify(detectSensitiveCase(QUERY)))
  const core = coreTopic(QUERY)
  console.log('coreTopic:', core)

  console.log('\n=== query set (fallback path: raw + deterministic freshness query) ===')
  const qs = buildQuerySet(QUERY, [QUERY], true)
  console.log(JSON.stringify(qs, null, 2))

  console.log('\n=== live retrieval ===')
  const all: Parameters<typeof rankSources>[1] = []
  for (const q of qs.queries) {
    try {
      const results = await webSearch(q, { num: 6, recencyDays: decision.recencyDays })
      console.log(`query "${q}" -> ${results.length} results`)
      all.push(...results)
    } catch (e) {
      console.log(`query "${q}" FAILED:`, e instanceof Error ? e.message : e)
    }
  }
  if (all.length === 0) {
    console.log('NO RETRIEVAL RESULTS (web_search also unavailable)')
    return
  }

  console.log('\n=== ranking (top 8) ===')
  const ranked = rankSources(QUERY, all, { freshnessMatters: true, limit: 8 })
  for (const s of ranked) {
    console.log(
      `[${s.id}] score=${s.score.toFixed(3)} type=${s.sourceType} official=${s.official} social=${s.social}` +
        ` | ${s.title.slice(0, 72)}\n     ${s.url.slice(0, 110)}\n     date=${s.date} year=${s.year} freshness=${s.freshness}`,
    )
  }

  console.log('\n=== staleness ===')
  console.log(stalenessWarning(ranked, { timeSensitive: true }))

  console.log('\n=== full-page read of top 2 (date verification) ===')
  for (const s of ranked.slice(0, 2)) {
    try {
      const page = await readPage(s.url)
      const date = page.publishedTime
      const snippet = page.text.slice(0, 220).replace(/\n+/g, ' ')
      console.log(`READ OK: ${s.url.slice(0, 100)}\n  publishedTime=${date}\n  content head: ${snippet}`)
    } catch (e) {
      console.log(`READ FAILED for ${s.url.slice(0, 90)}:`, e instanceof Error ? e.message : e)
    }
  }
}

main().catch((e) => {
  console.error('fatal:', e)
  process.exit(1)
})
