/**
 * RIISHE upgrade — real smoke test for research + verification primitives.
 * Run: bunx tsx scripts/riishe-smoke.ts   (or bun run scripts/riishe-smoke.ts)
 * No fakes: exercises the authorized gateway's web_search + page_reader and
 * the deterministic arithmetic evaluator.
 */
import { shouldSearch } from '../src/lib/research/policy'
import { webSearch, readPage } from '../src/lib/research/provider'
import { rankSources } from '../src/lib/research/rank'
import { evaluateExpression, parseSelfCheck, verifyComputations } from '../src/lib/verify/exprcheck'
import { auditCitations } from '../src/lib/verify/citations'
import type { EvidenceSource } from '../src/lib/research/pipeline'

async function main() {
  console.log('== 1. search policy decisions ==')
  const cases = [
    'Who is the current CEO of NVIDIA?',
    'What is 17 * 23 - 45?',
    'Write a haiku about autumn',
    'Latest version of the Next.js framework and its new APIs',
    'hi there',
  ]
  for (const c of cases) {
    const d = shouldSearch(c)
    console.log(`  [${d.search ? 'SEARCH' : ' skip '}] risk=${d.risk} :: ${c} :: ${d.reason}`)
  }

  console.log('\n== 2. real web_search via gateway ==')
  const results = await webSearch('Who is the current CEO of NVIDIA', { num: 6, recencyDays: 180 })
  console.log(`  got ${results.length} results`)
  for (const r of results.slice(0, 3)) {
    console.log(`  - [${r.rank}] ${r.title.slice(0, 60)} | ${r.hostName} | date=${r.date ?? 'none'}`)
  }

  console.log('\n== 3. ranking + dedup ==')
  const ranked = rankSources('Who is the current CEO of NVIDIA', results, { freshnessMatters: true, limit: 4 })
  for (const s of ranked) {
    console.log(`  [${s.id}] score=${s.score.toFixed(3)} official=${s.official} year=${s.year ?? '?'} ${s.url.slice(0, 70)}`)
  }

  console.log('\n== 4. page_reader (top source) ==')
  const top = ranked[0]
  if (top) {
    try {
      const page = await readPage(top.url)
      console.log(`  read ${page.text.length} chars, title="${page.title.slice(0, 50)}", published=${page.publishedTime ?? 'none'}`)
      console.log(`  excerpt: ${page.text.slice(0, 120).replace(/\n/g, ' ')}`)
    } catch (e) {
      console.log(`  page read failed (recorded honestly): ${e instanceof Error ? e.message : e}`)
    }
  }

  console.log('\n== 5. arithmetic verification ==')
  const exprs = [
    ['(3+4)*5/2', '17.5'],
    ['2**10', '1024'],
    ['factorial(10)', '3628800'],
    ['sqrt(144)', '12'],
    ['2**10', '2048'], // deliberate mismatch
    ['gcd(48, 180)', '12'],
    ['comb(5,2)', '10'],
    ['1/3', '0.3333333333'],
  ]
  const items = exprs.map(([e, c]) => ({ expr: e, claimed: c }))
  const check = await verifyComputations(items)
  console.log(`  ran=${check.ran} passed=${check.passed}`)
  for (const r of check.results) {
    console.log(`  ${r.match ? 'PASS' : 'FAIL'} ${r.expr} = ${r.actual} (claimed ${r.claimed})${r.error ? ' err=' + r.error : ''}`)
  }

  const adversarial = ['process.exit(1)', 'fs.readFileSync("/etc/passwd")', '__import__("os").system("ls")', '9**9**9', '(10**100)**(10**100)']
  for (const a of adversarial) {
    try {
      evaluateExpression(a)
      console.log(`  SECURITY FAIL: evaluated disallowed input: ${a.slice(0, 40)}`)
    } catch {
      console.log(`  blocked: ${a.slice(0, 40)}`)
    }
  }
  // long but safe linear arithmetic evaluates exactly (BigInt), no resource risk
  try {
    const big = evaluateExpression('9' + '*9'.repeat(50))
    console.log(`  big product evaluated exactly (${big.length} digits) — safe linear arithmetic`)
  } catch {
    console.log('  big product unexpectedly failed')
  }

  console.log('\n== 6. citation audit ==')
  const sources: EvidenceSource[] = ranked.map((r, i) => ({
    ...r,
    id: i + 1,
    pageRead: false,
    excerpt: null,
  }))
  const goodAnswer = 'Jensen Huang is the CEO [1]. Some claim otherwise [2].'
  const badAnswer = 'See https://totally-fabricated.example.com/page for proof. Also [99].'
  const a1 = auditCitations(goodAnswer, sources)
  const a2 = auditCitations(badAnswer, sources)
  console.log(`  good: referenced=${JSON.stringify(a1.referencedIds)} invalid=${JSON.stringify(a1.invalidIds)} fabricated=${a1.fabricatedUrls.length}`)
  console.log(`  bad:  referenced=${JSON.stringify(a2.referencedIds)} invalid=${JSON.stringify(a2.invalidIds)} fabricated=${JSON.stringify(a2.fabricatedUrls)}`)

  console.log('\n== 7. parseSelfCheck ==')
  const sample = 'The answer is 42.\n\nSELF_CHECK:\nCHECK: 6*7 = 42\nCHECK: 2**5 = 31\n'
  const parsed = parseSelfCheck(sample)
  console.log(`  parsed ${parsed.length} items:`, parsed)
  console.log('\nSMOKE COMPLETE')
}

main().catch((e) => {
  console.error('SMOKE FAILED:', e)
  process.exit(1)
})
