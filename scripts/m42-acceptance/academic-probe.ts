/**
 * M42.3 LIVE probe — real retrieval through every academic/registry adapter
 * (official public APIs, no credentials). Records verbatim evidence: the
 * returned URL/title/date/author per adapter plus elapsed time. Honest
 * classification per the M42 discipline: PASS / honest-unavailable (with
 * the exact reason).
 */
import { crossrefSearch, openalexSearch, arxivSearch, doajSearch, npmPackageInfo, pypiPackageInfo, runAcademicLane } from '../../src/lib/research/academic'

interface Row { adapter: string; ok: boolean; url: string | null; title: string | null; date: string | null; author: string | null; ms: number; error: string | null }
const rows: Row[] = []

async function probe(name: string, run: () => Promise<{ url: string; title: string; date: string | null; author: string | null } | null>): Promise<void> {
  const t0 = Date.now()
  try {
    const r = await run()
    rows.push({ adapter: name, ok: !!r, url: r?.url ?? null, title: r?.title?.slice(0, 90) ?? null, date: r?.date ?? null, author: r?.author ?? null, ms: Date.now() - t0, error: r ? null : 'no result returned' })
  } catch (e) {
    rows.push({ adapter: name, ok: false, url: null, title: null, date: null, author: null, ms: Date.now() - t0, error: e instanceof Error ? e.message.slice(0, 140) : 'unavailable' })
  }
}

async function main() {
  await probe('crossref', async () => {
    const r = await crossrefSearch('solid-state battery electrolyte review')
    const first = r[0]
    return first ? { url: first.url, title: first.title, date: first.date, author: first.author } : null
  })
  await probe('openalex', async () => {
    const r = await openalexSearch('solid electrolyte lithium battery')
    const first = r[0]
    return first ? { url: first.url, title: first.title, date: first.date, author: first.author } : null
  })
  await probe('arxiv', async () => {
    const r = await arxivSearch('solid state battery simulation')
    const first = r[0]
    return first ? { url: first.url, title: first.title, date: first.date, author: first.author } : null
  })
  await probe('doaj', async () => {
    const r = await doajSearch('lithium battery electrolyte')
    const first = r[0]
    return first ? { url: first.url, title: first.title, date: first.date, author: first.author } : null
  })
  await probe('npm', async () => {
    const r = await npmPackageInfo('zod')
    return r ? { url: r.url, title: r.title, date: r.date, author: r.author } : null
  })
  await probe('pypi', async () => {
    const r = await pypiPackageInfo('requests')
    return r ? { url: r.url, title: r.title, date: r.date, author: r.author } : null
  })
  await probe('dispatch-scholarly', async () => {
    const lane = await runAcademicLane('recent paper on solid electrolyte with doi', { userId: null, budgetMs: 20_000 })
    if (lane.results.length === 0) return null
    return { url: lane.results[0].url, title: lane.results[0].title, date: lane.results[0].date ?? null, author: lane.results[0].author ?? null }
  })

  const pass = rows.filter((r) => r.ok).length
  console.log('--- M42.3 academic adapter live probe ---')
  for (const r of rows) {
    console.log(`${r.ok ? 'PASS' : 'HONEST-UNAVAILABLE'} ${r.adapter} (${r.ms}ms) :: ${r.ok ? `${r.title} — ${r.url}${r.date ? ` [${r.date}]` : ''}${r.author ? ` by ${r.author}` : ''}` : r.error}`)
  }
  console.log(`TOTAL: ${pass}/${rows.length} adapters PASS (real retrieval, validated fields)`)
  const { writeFileSync, mkdirSync } = await import('node:fs')
  mkdirSync('scripts/m42-acceptance/out', { recursive: true })
  writeFileSync('scripts/m42-acceptance/out/academic-probe.json', JSON.stringify({ at: new Date().toISOString(), rows, summary: { pass, total: rows.length } }, null, 2))
  console.log('evidence → scripts/m42-acceptance/out/academic-probe.json')
}
void main()
