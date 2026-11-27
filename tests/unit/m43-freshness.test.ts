/**
 * M43 Phase 5 contracts — continuous knowledge freshness:
 *   - per-domain policies exist with the spec's exact shape (security
 *     frequent, docs version-change, prices near-use, legal jurisdiction+
 *     effective-date, science slow, historical permanent, events short);
 *   - records without usable dates are UNKNOWN — never fresh, never expired;
 *   - expired evidence is identified with a stated reason and never silently
 *     used; aging is distinct from expired;
 *   - domain classification is deterministic (CVE text → security; price
 *     text → price-availability; law text → legal; historical text never
 *     expires);
 *   - supersession chains PRESERVE the full previous evidence (current moves,
 *     history stays reachable) — no silent updates;
 *   - disappeared sources are marked gone/unavailable with reason + timestamp,
 *     records retained;
 *   - pure module: no polling, no I/O.
 *
 * Run: bun test tests/unit/m43-freshness.test.ts
 */
import { describe, test, expect } from 'bun:test'
import {
  FRESHNESS_POLICIES,
  KNOWLEDGE_DOMAINS,
  classifyKnowledgeDomain,
  domainForClaim,
  assessFreshness,
  supersedeRecord,
  markSourceUnavailable,
  highestMajorVersion,
} from '../../src/lib/research/freshness'
import { buildEvidenceRecords } from '../../src/lib/research/evidence'
import { assessEvidenceAuthority } from '../../src/lib/research/source-trust'
import type { SpecialistEvidence, SpecialistEvidencePack } from '../../src/lib/research/agent-evidence'

function srcEv(overrides: Partial<SpecialistEvidence> & { url: string }): SpecialistEvidence {
  return {
    sourceId: '[S1]', title: overrides.title ?? 'Source', url: overrides.url, host: new URL(overrides.url).host,
    sourceType: 'other', author: null, publishedAt: null, retrievedAt: '2026-11-20T08:00:00.000Z',
    excerpt: null, pageRead: false, provenance: { channel: null, engine: 'gateway' }, official: false, ...overrides,
  }
}

function one(overrides: Partial<SpecialistEvidence> & { url: string }) {
  const p: SpecialistEvidencePack = {
    consumer: 'knowledge', purpose: 'fact-check', evidence: [srcEv(overrides)], queries: [], cacheHits: 0,
    fetchedAt: '', freshnessWarnings: [], degraded: [], elapsedMs: 1, skippedReason: null, searchCalls: 0, pageReadCalls: 0,
  }
  return buildEvidenceRecords(p, { assessAuthority: (s) => assessEvidenceAuthority(s, 'general') })[0]
}

const NOW = new Date('2026-11-27T00:00:00.000Z')

describe('M43 freshness policies', () => {
  test('all seven domains have policies with the spec shape', () => {
    expect([...KNOWLEDGE_DOMAINS]).toEqual([
      'security-vulnerability', 'software-docs', 'price-availability',
      'legal-regulatory', 'science-fundamentals', 'historical', 'current-events',
    ])
    expect(FRESHNESS_POLICIES['security-vulnerability'].maxAgeDays).toBe(30)
    expect(FRESHNESS_POLICIES['security-vulnerability'].revalidation).toBe('scheduled')
    expect(FRESHNESS_POLICIES['software-docs'].revalidation).toBe('version-change')
    expect(FRESHNESS_POLICIES['price-availability'].revalidation).toBe('on-use')
    expect(FRESHNESS_POLICIES['price-availability'].maxAgeDays).toBeLessThanOrEqual(7)
    expect(FRESHNESS_POLICIES['legal-regulatory'].revalidation).toBe('on-use')
    expect(FRESHNESS_POLICIES['science-fundamentals'].maxAgeDays).toBeGreaterThan(365)
    expect(FRESHNESS_POLICIES.historical.maxAgeDays).toBeNull()
    expect(FRESHNESS_POLICIES.historical.revalidation).toBe('none')
    expect(FRESHNESS_POLICIES['current-events'].maxAgeDays).toBeLessThanOrEqual(14)
  })
})

describe('M43 domain classification', () => {
  test('deterministic per text shape', () => {
    expect(classifyKnowledgeDomain('CVE-2026-1234 allows remote code execution')).toBe('security-vulnerability')
    expect(classifyKnowledgeDomain('The subscription price increased to $9.99 this month')).toBe('price-availability')
    expect(classifyKnowledgeDomain('The regulation requires compliance after the effective date')).toBe('legal-regulatory')
    expect(classifyKnowledgeDomain('The library release notes document the deprecated API')).toBe('software-docs')
    expect(classifyKnowledgeDomain('The empire was established in 1526 and ruled for centuries')).toBe('historical')
    expect(classifyKnowledgeDomain('Photosynthesis converts light using the chlorophyll constant')).toBe('science-fundamentals')
    expect(classifyKnowledgeDomain('The agency announced new measures today')).toBe('current-events')
  })

  test('claim-kind fallback applies only when the text itself is unclassified', () => {
    expect(domainForClaim('Something entirely vague', 'security-vulnerability')).toBe('security-vulnerability')
    expect(domainForClaim('The price of the device', 'technical-behavior')).toBe('price-availability')
    expect(domainForClaim('The framework was updated', 'technical-behavior')).toBe('software-docs')
  })

  test('historical facts classify as historical and never expire', () => {
    const rec = one({ url: 'https://history.example.com/empire', publishedAt: '1998-05-01' })
    const a = assessFreshness(rec, 'historical', NOW)
    expect(a.status).toBe('fresh')
    expect(a.policy.maxAgeDays).toBeNull()
    expect(a.revalidationDue).toBe(false)
  })
})

describe('M43 freshness assessment', () => {
  test('security advisory within 7 days is fresh', () => {
    const rec = one({ url: 'https://osv.dev/vuln/CVE-2026-1', publishedAt: '2026-11-22', excerpt: 'GHSA advisory for the parser package' })
    const a = assessFreshness(rec, 'security-vulnerability', NOW)
    expect(a.status).toBe('fresh')
    expect(a.revalidationDue).toBe(false)
  })

  test('security advisory older than 30 days is EXPIRED with stated reason', () => {
    const rec = one({ url: 'https://osv.dev/vuln/CVE-2026-1', publishedAt: '2026-09-01', excerpt: 'GHSA advisory' })
    const a = assessFreshness(rec, 'security-vulnerability', NOW)
    expect(a.status).toBe('expired')
    expect(a.revalidationDue).toBe(true)
    expect(a.reason).toContain('30-day window')
    expect(a.ageDays).toBeGreaterThan(30)
  })

  test('prices are stale almost immediately (near-use verification)', () => {
    const rec = one({ url: 'https://shop.example.com/item', publishedAt: '2026-11-01', excerpt: 'price drop announced' })
    const a = assessFreshness(rec, 'price-availability', NOW)
    expect(a.status).toBe('expired')
    expect(a.reason).toContain('verified near the time of use')
  })

  test('record without a usable date is UNKNOWN — never silently fresh or expired', () => {
    const undated = one({ url: 'https://docs.example.com/guide' })
    const a = assessFreshness(undated, 'security-vulnerability', NOW)
    expect(a.status).toBe('unknown')
    expect(a.ageDays).toBeNull()
    expect(a.reason).toContain('cannot be established')
    expect(a.revalidationDue).toBe(true) // revalidate because freshness is unknown
  })

  test('future-garbage date (unparseable) is unknown too', () => {
    const rec = one({ url: 'https://x.example.com/a', publishedAt: 'sometime' })
    expect(assessFreshness(rec, 'current-events', NOW).status).toBe('unknown')
  })

  test('aging is distinct from expired (science window)', () => {
    const rec = one({ url: 'https://journals.example.com/paper', publishedAt: '2024-06-01', excerpt: 'a foundational study of protein folding' })
    const a = assessFreshness(rec, 'science-fundamentals', NOW)
    expect(a.status).toBe('aging')
    expect(a.reason).toContain('recheck recommended')
    const old = one({ url: 'https://journals.example.com/paper2', publishedAt: '2018-01-01', excerpt: 'a foundational study' })
    expect(assessFreshness(old, 'science-fundamentals', NOW).status).toBe('expired')
  })

  test('version awareness reports the highest major version mentioned', () => {
    expect(highestMajorVersion('Node.js 22.1 and 20.5 mention v19.0')).toBe(22)
    expect(highestMajorVersion('no versions here')).toBeNull()
  })
})

describe('M43 supersession chains', () => {
  interface Rec {
    evidenceId: string
    identity: { publishedAt: string | null; retrievedAt: string }
  }
  const r = (id: string, publishedAt: string | null): Rec => ({ evidenceId: id, identity: { publishedAt, retrievedAt: '2026-11-20T00:00:00Z' } })

  test('current moves; the full previous chain is preserved (no silent updates)', () => {
    const v1 = r('[E1]', '2025-01-01')
    const v2 = r('[E2]', '2026-03-01')
    const v3 = r('[E3]', '2026-11-01')
    let chain = supersedeRecord<Rec>(null, v1, 'initial retrieval')
    chain = supersedeRecord(chain, v2, 'revalidation found a newer advisory')
    chain = supersedeRecord(chain, v3, 'version changed')
    expect(chain.current.evidenceId).toBe('[E3]')
    expect(chain.previous.map((p) => p.evidenceId)).toEqual(['[E1]', '[E2]']) // oldest first, none destroyed
    expect(chain.reason).toContain('version changed')
  })
})

describe('M43 source disappearance', () => {
  test('404/410 → gone; other statuses → unavailable; both retained with reasons', () => {
    const gone = markSourceUnavailable('[E7]', 404, NOW)
    expect(gone.availability).toBe('gone')
    expect(gone.reason).toContain('retained')
    const flaky = markSourceUnavailable('[E7]', 503, NOW)
    expect(flaky.availability).toBe('unavailable')
    expect(flaky.reason).toContain('not deleted')
    expect(flaky.markedAt).toBe(NOW.toISOString())
    const neterr = markSourceUnavailable('[E7]', null, NOW)
    expect(neterr.availability).toBe('unavailable')
  })
})
