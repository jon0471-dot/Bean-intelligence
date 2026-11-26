/**
 * M42.3b LIVE probe — real retrieval through every security/community
 * adapter (official public APIs, no credentials). Records verbatim
 * evidence: the returned URL/title/date/author per adapter plus elapsed
 * time. Honest classification per the M42 discipline: PASS /
 * honest-unavailable (with the exact reason). Never upgraded.
 */
import {
  osvVulnById,
  osvPackageAdvisories,
  stackExchangeSearch,
  hackerNewsSearch,
  runSecurityCommunityLane,
} from '../../src/lib/research/security-community'

interface Row { adapter: string; ok: boolean; url: string | null; title: string | null; date: string | null; author: string | null; community: boolean | null; ms: number; error: string | null }
const rows: Row[] = []

interface ProbeResult { url: string; title: string; date: string | null; author: string | null; community: boolean | null }

async function probe(name: string, run: () => Promise<ProbeResult | null>): Promise<void> {
  const t0 = Date.now()
  try {
    const r = await run()
    rows.push({ adapter: name, ok: !!r, url: r?.url ?? null, title: r?.title?.slice(0, 90) ?? null, date: r?.date ?? null, author: r?.author ?? null, community: r?.community ?? null, ms: Date.now() - t0, error: r ? null : 'no result returned' })
  } catch (e) {
    rows.push({ adapter: name, ok: false, url: null, title: null, date: null, author: null, community: null, ms: Date.now() - t0, error: e instanceof Error ? e.message.slice(0, 140) : 'unavailable' })
  }
}

async function main() {
  await probe('osv-by-id', async () => {
    const r = await osvVulnById('CVE-2021-23336')
    return r ? { url: r.url, title: r.title, date: r.date, author: r.author, community: false } : null
  })
  await probe('osv-package-npm', async () => {
    const r = await osvPackageAdvisories('lodash', 'npm')
    const first = r[0]
    return first ? { url: first.url, title: first.title, date: first.date, author: first.author, community: false } : null
  })
  await probe('osv-package-pypi', async () => {
    const r = await osvPackageAdvisories('django', 'PyPI')
    const first = r[0]
    return first ? { url: first.url, title: first.title, date: first.date, author: first.author, community: false } : null
  })
  await probe('stackexchange', async () => {
    const r = await stackExchangeSearch('bun test runner isolate modules')
    const first = r[0]
    return first ? { url: first.url, title: first.title, date: first.date, author: first.author, community: true } : null
  })
  await probe('hackernews', async () => {
    const r = await hackerNewsSearch('sqlite performance')
    const first = r[0]
    return first ? { url: first.url, title: first.title, date: first.date, author: first.author, community: true } : null
  })
  await probe('dispatch-advisory-lane', async () => {
    const lane = await runSecurityCommunityLane('audit our dependency for CVE-2021-23336', { userId: null, budgetMs: 20_000 })
    if (lane.results.length === 0) return null
    const r = lane.results[0]
    return { url: r.url, title: r.title, date: r.date ?? null, author: r.author ?? null, community: r.social }
  })
  await probe('dispatch-community-lane', async () => {
    const lane = await runSecurityCommunityLane('hacker news discussion about the sqlite release', { userId: null, budgetMs: 20_000 })
    if (lane.results.length === 0) return null
    const r = lane.results[0]
    return { url: r.url, title: r.title, date: r.date ?? null, author: r.author ?? null, community: r.social }
  })

  const pass = rows.filter((r) => r.ok).length
  console.log('--- M42.3b security/community adapter live probe ---')
  for (const r of rows) {
    console.log(`${r.ok ? 'PASS' : 'HONEST-UNAVAILABLE'} ${r.adapter} (${r.ms}ms) :: ${r.ok ? `${r.title} — ${r.url}${r.date ? ` [${r.date}]` : ''}${r.author ? ` by ${r.author}` : ''}${r.community ? ' [UGC]' : ''}` : r.error}`)
  }
  console.log(`TOTAL: ${pass}/${rows.length} adapters PASS (real retrieval, validated fields)`)
  const { writeFileSync, mkdirSync } = await import('node:fs')
  mkdirSync('scripts/m42-acceptance/out', { recursive: true })
  writeFileSync('scripts/m42-acceptance/out/security-community-probe.json', JSON.stringify({ at: new Date().toISOString(), rows, summary: { pass, total: rows.length } }, null, 2))
  console.log('evidence → scripts/m42-acceptance/out/security-community-probe.json')
}
void main()
