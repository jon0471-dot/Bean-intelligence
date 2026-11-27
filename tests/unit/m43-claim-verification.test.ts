/**
 * M43 Phase 2 contracts — multi-source claim-level fact verification:
 *   - deterministic claim extraction (numbers/dates/versions/comparatives/
 *     causal/absolutes; bare assertion verbs never qualify);
 *   - the full outcome ladder: verified → strongly-supported →
 *     partially-supported → contradicted → outdated → insufficient-evidence →
 *     unverifiable → source-unavailable — nothing is ever forced to PASS;
 *   - authority beats count: many weak sources never outweigh one primary;
 *   - corroboration counts DISTINCT independence groups (copies never inflate);
 *   - equal-strength disagreement is recorded as UNRESOLVED, never silently
 *     resolved by preference;
 *   - impossible dates are excluded from support; version mismatches flagged;
 *   - UGC can never verify a factual claim on its own;
 *   - verifyClaims() with an injected retriever composes packs honestly and
 *     degrades without throwing; no retrieval → no fake results.
 *
 * Run: bun test tests/unit/m43-claim-verification.test.ts
 */
import { describe, test, expect } from 'bun:test'
import {
  extractFactualClaims,
  extractVersions,
  verifyClaim,
  verifyClaims,
  summarizeClaimVerification,
  type ClaimCheck,
} from '../../src/lib/research/claim-verification'
import { buildEvidenceRecords, type RoleTaggedEvidenceRecord } from '../../src/lib/research/evidence'
import { assessEvidenceAuthority } from '../../src/lib/research/source-trust'
import type { SpecialistEvidencePack, SpecialistEvidence } from '../../src/lib/research/agent-evidence'

const NOW = new Date('2026-11-27T00:00:00.000Z')

function srcEv(overrides: Partial<SpecialistEvidence> & { url: string; title?: string }): SpecialistEvidence {
  return {
    sourceId: '[S1]',
    title: overrides.title ?? 'Source',
    url: overrides.url,
    host: new URL(overrides.url).host,
    sourceType: 'other',
    author: null,
    publishedAt: null,
    retrievedAt: '2026-11-20T08:00:00.000Z',
    excerpt: overrides.excerpt ?? null,
    pageRead: false,
    provenance: { channel: null, engine: 'gateway' },
    official: false,
    ...overrides,
  }
}

function recs(evidence: SpecialistEvidence[], role: 'supporting' | 'contradicting' = 'supporting'): RoleTaggedEvidenceRecord[] {
  const p: SpecialistEvidencePack = {
    consumer: 'knowledge', purpose: 'fact-check', evidence, queries: [], cacheHits: 0,
    fetchedAt: '2026-11-20T08:00:00.000Z', freshnessWarnings: [], degraded: [], elapsedMs: 1,
    skippedReason: null, searchCalls: 0, pageReadCalls: 0,
  }
  return buildEvidenceRecords(p, {
    role,
    assessAuthority: (s) => assessEvidenceAuthority(s, 'statistical'), // fixed context for fixture predictability
  })
}

describe('M43 claim extraction', () => {
  test('selects fact-bearing sentences and rejects bare assertions', () => {
    const text = 'India launched the mission in August 2023. The unemployment rate fell to 6.7 percent. I think that is interesting. The team updated the website. Node.js 22 supports require(esm) natively. It works!'
    const claims = extractFactualClaims(text)
    expect(claims.length).toBeGreaterThanOrEqual(3)
    expect(claims.some((c) => c.signals.includes('date'))).toBe(true)
    expect(claims.some((c) => c.signals.includes('number'))).toBe(true)
    expect(claims.some((c) => c.text.includes('require(esm)'))).toBe(true)
    expect(claims.every((c) => c.text !== 'I think that is interesting.')).toBe(true)
  })

  test('claims are bounded and carry indices', () => {
    const many = Array.from({ length: 30 }, (_, i) => `Report ${i} measured 42 percent growth in 202${i % 10}.`).join(' ')
    const claims = extractFactualClaims(many, 5)
    expect(claims.length).toBe(5)
    expect(claims.map((c) => c.index)).toEqual([0, 1, 2, 3, 4])
  })

  test('version extraction is deterministic', () => {
    expect(extractVersions('works in Node 22.1.0 and 20.5, broken in v19.0.1')).toEqual(['22.1.0', '20.5', '19.0.1'])
  })
})

function check(claim: string, support: SpecialistEvidence[] = [], contra: SpecialistEvidence[] = [], staleAfterDays?: number): ClaimCheck {
  return verifyClaim({
    claim,
    supporting: recs(support),
    contradicting: contra.length ? recs(contra, 'contradicting') : [],
    staleAfterDays,
    now: NOW,
  })
}

describe('M43 verifyClaim decision table', () => {
  const REG_CLAIM = 'The regulation caps processing fees at 2 percent according to the 2026 directive.'

  test('primary authority + independent corroboration → verified', () => {
    const c = check(REG_CLAIM, [
      srcEv({ url: 'https://meity.gov.in/directive-2026', sourceId: '[S1]', publishedAt: '2026-06-01', excerpt: 'fees capped at 2 percent', official: true }),
      srcEv({ url: 'https://reuters.com/article-2026', sourceId: '[S2]', publishedAt: '2026-06-02', excerpt: 'the directive caps fees at 2 percent', sourceType: 'news' }),
    ])
    expect(c.outcome).toBe('verified')
    expect(c.hasPrimarySupport).toBe(true)
    expect(c.independentSupportGroups).toBe(2)
    expect(c.basis.some((b) => b.includes('2 distinct independent group'))).toBe(true)
  })

  test('single primary source without corroboration → strongly-supported (never verified)', () => {
    const c = check(REG_CLAIM, [
      srcEv({ url: 'https://meity.gov.in/directive-2026', sourceId: '[S1]', publishedAt: '2026-06-01', excerpt: 'fees capped at 2 percent', official: true }),
    ])
    expect(c.outcome).toBe('strongly-supported')
    expect(c.independentSupportGroups).toBe(1)
  })

  test('two syndicated copies of ONE article are still ONE group → strongly-supported only', () => {
    const shared = 'the directive caps payment processing fees at 2 percent from next quarter'
    const c = check(REG_CLAIM, [
      srcEv({ url: 'https://origin.example.com/a', sourceId: '[S1]', publishedAt: '2026-06-01', title: `fee caps confirmed by directive ${shared}`, excerpt: shared, official: true }),
      srcEv({ url: 'https://mirror.example.net/b', sourceId: '[S2]', publishedAt: '2026-06-02', title: `fee caps confirmed by directive ${shared}`, excerpt: shared }),
    ])
    expect(c.independentSupportGroups).toBe(1)
    expect(c.outcome).toBe('strongly-supported') // one gov group = single primary group
  })

  test('two strong non-primary sources → strongly-supported; one strong source → partially-supported', () => {
    const two = check('Unemployment fell to 6.7 percent this quarter.', [
      srcEv({ url: 'https://reuters.com/a', sourceId: '[S1]', publishedAt: '2026-10-01', excerpt: 'fell to 6.7 percent', sourceType: 'news' }),
      srcEv({ url: 'https://bbc.com/b', sourceId: '[S2]', publishedAt: '2026-10-02', excerpt: 'unemployment at 6.7 percent', sourceType: 'news' }),
    ])
    expect(two.outcome).toBe('strongly-supported')
    const one = check('Unemployment fell to 6.7 percent this quarter.', [
      srcEv({ url: 'https://reuters.com/a', sourceId: '[S1]', publishedAt: '2026-10-01', excerpt: 'fell to 6.7 percent', sourceType: 'news' }),
    ])
    expect(one.outcome).toBe('partially-supported')
  })

  test('stronger contradicting evidence → contradicted, regardless of support count', () => {
    const c = check('The regulation caps fees at 2 percent.', [
      srcEv({ url: 'https://blog-a.example.com/x', sourceId: '[S1]', excerpt: 'fees capped at 2 percent' }),
      srcEv({ url: 'https://blog-b.example.com/y', sourceId: '[S2]', excerpt: 'capped at 2 percent' }),
      srcEv({ url: 'https://blog-c.example.com/z', sourceId: '[S3]', excerpt: '2 percent cap confirmed' }),
    ], [
      srcEv({ url: 'https://meity.gov.in/directive-2026', sourceId: '[S4]', publishedAt: '2026-06-01', excerpt: 'the cap is 3.5 percent, not 2 percent', official: true }),
    ])
    expect(c.outcome).toBe('contradicted')
    expect(c.independentContradictingGroups).toBe(1)
  })

  test('equal-strength disagreement stays UNRESOLVED (partially-supported + recorded)', () => {
    const c = check('Unemployment fell to 6.7 percent this quarter.', [
      srcEv({ url: 'https://reuters.com/a', sourceId: '[S1]', publishedAt: '2026-10-01', excerpt: 'fell to 6.7 percent', sourceType: 'news' }),
    ], [
      srcEv({ url: 'https://bbc.com/b', sourceId: '[S2]', publishedAt: '2026-10-01', excerpt: 'unemployment did not fall — it rose to 8.2 percent', sourceType: 'news' }),
    ])
    expect(c.outcome).toBe('partially-supported')
    expect(c.unresolved).toContain('unresolved')
    expect(c.independentContradictingGroups).toBe(1)
  })

  test('weaker contradiction is noted but does not block', () => {
    const c = check(REG_CLAIM, [
      srcEv({ url: 'https://meity.gov.in/directive', sourceId: '[S1]', publishedAt: '2026-06-01', excerpt: 'cap is 2 percent', official: true }),
    ], [
      srcEv({ url: 'https://random-blog.example.com/post', sourceId: '[S2]', excerpt: 'actually the cap is not 2 percent' }),
    ])
    expect(c.outcome).toBe('strongly-supported')
    expect(c.basis.some((b) => b.includes('weaker'))).toBe(true)
  })

  test('only UGC/weak support → insufficient-evidence (never PASS)', () => {
    const c = check('Vaccination coverage reached 90 percent of adults.', [
      srcEv({ url: 'https://reddit.com/r/thread', sourceId: '[S1]', excerpt: 'felt like most people got it', sourceType: 'social' }),
      srcEv({ url: 'https://forum.example.org/t', sourceId: '[S2]', excerpt: 'many users say coverage is high' }),
    ])
    expect(c.outcome).toBe('insufficient-evidence')
    expect(c.hasPrimarySupport).toBe(false)
  })

  test('no evidence at all → insufficient-evidence with explicit basis', () => {
    const c = check('The census counted exactly 1.41 billion people in 2026.')
    expect(c.outcome).toBe('insufficient-evidence')
    expect(c.basis.some((b) => b.includes('no evidence'))).toBe(true)
  })

  test('impossible dates are excluded from support', () => {
    const c = check(REG_CLAIM, [
      srcEv({ url: 'https://meity.gov.in/doc', sourceId: '[S1]', publishedAt: '2031-01-01', excerpt: 'cap is 2 percent', official: true }),
    ])
    // The only support was excluded for an impossible date → nothing usable.
    expect(['unverifiable', 'insufficient-evidence', 'source-unavailable']).toContain(c.outcome)
    expect(c.basis.some((b) => b.includes('impossible'))).toBe(true)
    expect(c.supportingEvidenceIds).toHaveLength(0)
  })

  test('all sources unavailable after date filtering → source-unavailable', () => {
    const c = check(REG_CLAIM, [
      srcEv({ url: 'https://meity.gov.in/old', sourceId: '[S1]', publishedAt: '2040-01-01', excerpt: 'x' }),
      srcEv({ url: 'https://reuters.com/gone', sourceId: '[S2]', publishedAt: '2039-01-01', excerpt: 'y', sourceType: 'news' }),
    ])
    expect(c.outcome).toBe('source-unavailable')
  })

  test('outdated outcome for time-sensitive claims whose only support is stale', () => {
    const c = check('Security teams report the vulnerability affects 40 percent of deployments.', [
      srcEv({ url: 'https://reuters.com/2024/a', sourceId: '[S1]', publishedAt: '2024-01-15', excerpt: 'affects 40 percent', sourceType: 'news' }),
    ], [], 365)
    expect(c.outcome).toBe('outdated')
    expect(c.outdatedReason).toContain('older than 365 days')
  })

  test('version mismatch is flagged when claim and evidence speak of different versions', () => {
    const c = check('Node.js 22.1 enables the new permission model by default.', [
      srcEv({ url: 'https://reuters.com/tech', sourceId: '[S1]', excerpt: 'Node.js 18.0 introduced the permission model experiment', sourceType: 'news' }),
      srcEv({ url: 'https://bbc.com/tech', sourceId: '[S2]', excerpt: 'in Node.js 16.5 the flag shipped behind a flag', sourceType: 'news' }),
    ])
    expect(c.versionNote).not.toBeNull()
    expect(c.versionNote).toContain('different version')
  })

  test('unsupported causal overreach without evidence stays insufficient (never PASS)', () => {
    const c = check('The new policy caused unemployment because it removed incentives, leading to 10 percent losses.')
    expect(['insufficient-evidence', 'unverifiable']).toContain(c.outcome)
  })
})

describe('M43 verifyClaims composition (injected retrieval, no network)', () => {
  test('packs compose into per-claim checks; summary stays bounded and honest', async () => {
    const pack: SpecialistEvidencePack = {
      consumer: 'knowledge',
      purpose: 'fact-check',
      evidence: [
        srcEv({ url: 'https://meity.gov.in/directive', sourceId: '[S1]', publishedAt: '2026-06-01', excerpt: 'The 2026 directive caps processing fees at 2 percent and mandates registration.' }),
        srcEv({ url: 'https://reuters.com/coverage', sourceId: '[S2]', publishedAt: '2026-06-02', excerpt: 'The directive caps fees at 2 percent starting next quarter.', sourceType: 'news' }),
      ],
      queries: ['directive caps'],
      cacheHits: 0,
      fetchedAt: '2026-11-20T08:00:00.000Z',
      freshnessWarnings: [],
      degraded: [],
      elapsedMs: 5,
      skippedReason: null,
      searchCalls: 1,
      pageReadCalls: 0,
    }
    let calls = 0
    const report = await verifyClaims('The 2026 directive caps payment processing fees at 2 percent for all merchants. It was announced in June 2026.', {
      retrieve: async () => { calls += 1; return pack },
    })
    expect(calls).toBe(1)
    expect(report.packsRetrieved).toBe(1)
    expect(report.claims.length).toBeGreaterThanOrEqual(2)
    expect(report.summary).toContain('claim verification')
    expect(report.summary.length).toBeLessThanOrEqual(400)
    expect(report.degraded).toHaveLength(0)
  })

  test('retrieval failure degrades honestly — never throws, never fabricates', async () => {
    const report = await verifyClaims('The scheme covers 40 percent of rural households since 2024.', {
      retrieve: async () => { throw new Error('gateway 503') },
    })
    expect(report.claims).toHaveLength(0)
    expect(report.degraded[0]).toContain('gateway 503')
    expect(report.summary).toContain('could not retrieve evidence')
  })

  test('no retriever → honest no-op with degraded note', async () => {
    const report = await verifyClaims('The scheme covers 40 percent of rural households since 2024.')
    expect(report.claims).toHaveLength(0)
    expect(report.degraded[0]).toContain('without retrieval')
  })

  test('text with no checkable claims reports honestly', async () => {
    const report = await verifyClaims('Please write a poem about the sea.', {
      retrieve: async () => { throw new Error('should not be called') },
    })
    expect(report.claims).toHaveLength(0)
    expect(report.summary).toContain('no checkable factual claims')
  })
})

describe('M43 summary helper', () => {
  test('counts outcomes and unresolved disagreements', () => {
    const s = summarizeClaimVerification([
      { claim: 'a', claimKind: 'general', outcome: 'verified', basis: [], supportingEvidenceIds: [], contradictingEvidenceIds: [], independentSupportGroups: 2, independentContradictingGroups: 0, decisiveClass: 'authoritative', hasPrimarySupport: true, unresolved: null, versionNote: null, outdatedReason: null },
      { claim: 'b', claimKind: 'general', outcome: 'contradicted', basis: [], supportingEvidenceIds: [], contradictingEvidenceIds: ['[E2]'], independentSupportGroups: 1, independentContradictingGroups: 1, decisiveClass: 'weak', hasPrimarySupport: false, unresolved: null, versionNote: null, outdatedReason: null },
      { claim: 'c', claimKind: 'general', outcome: 'partially-supported', basis: [], supportingEvidenceIds: [], contradictingEvidenceIds: [], independentSupportGroups: 1, independentContradictingGroups: 1, decisiveClass: 'strong', hasPrimarySupport: false, unresolved: 'disagreement remains unresolved', versionNote: null, outdatedReason: null },
    ])
    expect(s).toContain('1 verified')
    expect(s).toContain('1 contradicted')
    expect(s).toContain('unresolved')
  })
})
