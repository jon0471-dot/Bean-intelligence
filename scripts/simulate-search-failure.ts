/**
 * Search-failure simulation for RIISHE Auto mode (REAL gateway, no mocks):
 * fire many parallel real web_search calls to exhaust the burst quota, then
 * the driver script immediately asks a time-sensitive question in Auto mode.
 * Expected honest behavior: retrieval fails -> degraded notes -> NO
 * VERIFIED_FROM_SOURCES -> answer states it could not verify current info.
 */
import { webSearch } from '../src/lib/research/provider'

const queries = [
  'Tamil Nadu chief minister news',
  'latest technology releases',
  'current sports results cricket',
  'stock market today',
  'new movie releases this week',
  'weather report Chennai',
  'election news updates',
  'latest version nodejs',
  'inflation rate current',
  'football match results yesterday',
]

console.log(`firing ${queries.length * 2} parallel real web_search calls...`)
const settled = await Promise.allSettled(
  [...queries, ...queries].map((q, i) =>
    webSearch(`${q} ${i}`, { num: 5 }).then((r) => `ok:${r.length}results`),
  ),
)
let ok = 0
let failed = 0
for (const s of settled) {
  if (s.status === 'fulfilled') ok += 1
  else {
    failed += 1
    console.log('  search failed:', String(s.reason).slice(0, 130))
  }
}
console.log(`SEARCH BURST DONE: ok=${ok} failed=${failed} (failures = quota pressure for the next chat turn)`)
