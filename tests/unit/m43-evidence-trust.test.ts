/**
 * M43 Phase 1 + Phase 3 contracts — shared evidence representation and
 * domain-sensitive source trust:
 *   - evidence records built FROM the M42 specialist pack preserve identity,
 *     dates exactly as supplied, provenance and bounded passages;
 *   - canonical source keys collapse syndicated/mirrored copies of ONE
 *     original article into a single independence group;
 *   - corroboration counting is over DISTINCT groups, never raw rows;
 *   - publication-date validation: absent/unparseable = null (unknown),
 *     impossible dates = false, real past dates = true;
 *   - authority depends on the CLAIM KIND: government primary for regulation
 *     but only corroborating for an unrelated scientific claim; official docs
 *     primary for technical behavior; advisories primary for CVEs; original
 *     datasets primary for statistics; UGC always labeled user-generated;
 *   - a large number of weak sources never outweighs one authoritative
 *     primary source (weight is class-driven, not count-driven).
 *
 * Pure functions only — no network, no fixtures beyond literals.
 * Run: bun test tests/unit/m43-evidence-trust.test.ts
 */
import { describe, test, expect } from 'bun:test'
import {
  canonicalSourceKey,
  buildEvidenceRecords,
  independentGroupCount,
  validatePublicationDate,
  publisherFromHost,
  attributionView,
} from '../../src/lib/research/evidence'
import {
  classifyClaimKind,
  assessSourceAuthority,
  assessEvidenceAuthority,
  summarizeEvidenceWeight,
  type ClaimKind,
} from '../../src/lib/research/source-trust'
import type { SpecialistEvidencePack, SpecialistEvidence } from '../../src/lib/research/agent-evidence'

function ev(overrides: Partial<SpecialistEvidence> & { url: string }): SpecialistEvidence {
  return {
    sourceId: '[S1]',
    title: 'A title',
    url: overrides.url,
    host: new URL(overrides.url).host,
    sourceType: 'other',
    author: null,
    publishedAt: null,
    retrievedAt: '2026-11-27T08:00:00.000Z',
    excerpt: 'An excerpt from the source.',
    pageRead: false,
    provenance: { channel: null, engine: 'gateway' },
    official: false,
    ...overrides,
  }
}

function pack(evidence: SpecialistEvidence[]): SpecialistEvidencePack {
  return {
    consumer: 'knowledge',
    purpose: 'fact-check',
    evidence,
    queries: ['q'],
    cacheHits: 0,
    fetchedAt: '2026-11-27T08:00:00.000Z',
    freshnessWarnings: [],
    degraded: [],
    elapsedMs: 10,
    skippedReason: null,
    searchCalls: 1,
    pageReadCalls: 0,
  }
}

describe('M43 canonical source keys (independence)', () => {
  test('the same article with different tracking params and www collapses to one group', () => {
    const a = canonicalSourceKey('https://www.example.com/news/2026/report?utm_source=x&fbclid=abc&id=7')
    const b = canonicalSourceKey('https://example.com/news/2026/report?id=7')
    expect(a).toBe(b)
  })

  test('amp and print mirrors are the same article', () => {
    const base = canonicalSourceKey('https://example.com/a/story')
    expect(canonicalSourceKey('https://example.com/a/story?amp=1')).toBe(canonicalSourceKey('https://example.com/a/story?amp=1'))
    const amp = canonicalSourceKey('https://example.com/a/amp/story')
    const print = canonicalSourceKey('https://example.com/a/print/story')
    // path-segment mirrors differ by segment name — but amp/print suffix forms collapse:
    expect(canonicalSourceKey('https://example.com/a/story/amp')).toBe(base)
    expect(canonicalSourceKey('https://example.com/a/story/print')).toBe(base)
    expect(amp).not.toBe(base) // distinct path segment stays distinct (honest)
    expect(print).not.toBe(base)
  })

  test('different articles never share a group', () => {
    expect(canonicalSourceKey('https://a.com/x/1')).not.toBe(canonicalSourceKey('https://a.com/x/2'))
    expect(canonicalSourceKey('https://a.com/x/1')).not.toBe(canonicalSourceKey('https://b.com/x/1'))
  })

  test('non-http(s) and unparseable URLs fall back to a title key, not a crash', () => {
    const t = canonicalSourceKey('not a url', 'Some Title Here')
    expect(t.startsWith('t:')).toBe(true)
    expect(canonicalSourceKey('javascript:alert(1)', 'T')).toBe('t:t')
    expect(canonicalSourceKey('', '')).toBe('t:')
  })
})

describe('M43 evidence records from the M42 pack', () => {
  test('identity, dates and provenance are preserved exactly; nothing invented', () => {
    const records = buildEvidenceRecords(pack([
      ev({ url: 'https://gov.in/reg/2026/rules', sourceId: '[S1]', publishedAt: '2026-03-04', author: 'A. Author', sourceType: 'official', official: true }),
      ev({ url: 'https://news.example.com/copy', sourceId: '[S2]', publishedAt: null }),
    ]))
    expect(records.length).toBe(2)
    const r1 = records[0]
    expect(r1.evidenceId).toBe('[E1]')
    expect(r1.sourceId).toBe('[S1]')
    expect(r1.identity.publishedAt).toBe('2026-03-04')
    expect(r1.identity.author).toBe('A. Author')
    expect(r1.identity.updatedAt).toBeNull() // no lane supplies it — never invented
    expect(r1.dateValid).toBe(true)
    expect(r1.role).toBe('supporting')
    const r2 = records[1]
    expect(r2.identity.publishedAt).toBeNull()
    expect(r2.dateValid).toBeNull() // absent = unknown, honest
    expect(r2.passage).toBe('An excerpt from the source.')
  })

  test('syndicated copies of one article share an independence group; count is distinct groups', () => {
    const SHARED = ' regulators published the new data protection compliance rules this week'
    const records = buildEvidenceRecords(pack([
      ev({ url: 'https://origin.example.com/story/2026/x', sourceId: '[S1]', title: `Officials announce sweeping digital privacy overhaul ${SHARED}` }),
      ev({ url: 'https://syndicated.example.com/story/2026/x?utm_campaign=n', sourceId: '[S2]', title: `Officials announce sweeping digital privacy overhaul ${SHARED}` }),
      ev({ url: 'https://origin.example.com/other/2026/y', sourceId: '[S3]' }),
    ]))
    expect(records[0].independenceGroup).toBe(records[1].independenceGroup) // same original article, different host
    expect(records[2].independenceGroup).not.toBe(records[0].independenceGroup)
    expect(independentGroupCount(records)).toBe(2)
  })

  test('generic short titles never merge distinct pages (safe default)', () => {
    const records = buildEvidenceRecords(pack([
      ev({ url: 'https://a.example.com/about', sourceId: '[S1]', title: 'A title' }),
      ev({ url: 'https://b.example.org/about', sourceId: '[S2]', title: 'A title' }),
    ]))
    expect(records[0].independenceGroup).not.toBe(records[1].independenceGroup)
    expect(independentGroupCount(records)).toBe(2)
  })

  test('authority callback is applied per source and basis is carried', () => {
    const records = buildEvidenceRecords(pack([ev({ url: 'https://x.com/a', sourceType: 'social' })]), {
      assessAuthority: (s) => ({ authorityClass: 'user-generated', basis: `test basis for ${s.host}` }),
    })
    expect(records[0].authorityClass).toBe('user-generated')
    expect(records[0].authorityBasis).toBe('test basis for x.com')
  })

  test('records are bounded and attribution views stay handoff-safe', () => {
    const many = Array.from({ length: 40 }, (_, i) => ev({ url: `https://h${i}.com/a`, sourceId: `[S${i + 1}]` }))
    const records = buildEvidenceRecords(pack(many))
    expect(records.length).toBe(32) // MAX_RECORDS cap
    const view = attributionView(records)
    expect(view.length).toBe(24)
    expect(view[0].evidenceId).toBe('[E1]')
    expect(view.every((v) => v.url.length <= 512 && v.title.length <= 160)).toBe(true)
  })
})

describe('M43 publication-date validation', () => {
  const now = new Date('2026-11-27T00:00:00.000Z')
  test('absent and unparseable dates are null (unknown), never invented', () => {
    expect(validatePublicationDate(null, now)).toBeNull()
    expect(validatePublicationDate('', now)).toBeNull()
    expect(validatePublicationDate('sometime soon', now)).toBeNull()
  })
  test('real past dates validate; bare years work', () => {
    expect(validatePublicationDate('2026-03-04', now)).toBe(true)
    expect(validatePublicationDate('2026-03-04T10:00:00Z', now)).toBe(true)
    expect(validatePublicationDate('1998', now)).toBe(true)
  })
  test('future dates and implausibly old dates are rejected', () => {
    expect(validatePublicationDate('2027-06-01', now)).toBe(false)
    expect(validatePublicationDate('1900-01-01', now)).toBe(false)
    expect(validatePublicationDate('1899', now)).toBe(false)
  })
  test('small clock skew is tolerated', () => {
    expect(validatePublicationDate(new Date(now.getTime() + 10 * 3600 * 1000).toISOString(), now)).toBe(true)
  })
})

describe('M43 claim-kind classification', () => {
  test('security, regulatory, technical, research, statistical, community kinds', () => {
    expect(classifyClaimKind('CVE-2021-23336 affects json pointer dereference')).toBe('security-vulnerability')
    expect(classifyClaimKind('The GDPR requires a legal basis for processing personal data')).toBe('regulatory')
    expect(classifyClaimKind('Node.js 22 changed the default behavior of the fs API')).toBe('technical-behavior')
    expect(classifyClaimKind('A peer-reviewed study found the treatment reduced symptoms')).toBe('research-finding')
    expect(classifyClaimKind('The unemployment rate fell to 6.7 percent this quarter')).toBe('statistical')
    expect(classifyClaimKind('Users on Reddit report the workaround breaks on mobile')).toBe('community-experience')
    expect(classifyClaimKind('The agency announced new measures this week')).toBe('current-events')
    expect(classifyClaimKind('Something entirely unstructured here')).toBe('general')
  })
})

describe('M43 domain-sensitive authority', () => {
  test('government is primary for regulation, only corroborating for an unrelated scientific claim', () => {
    const gov = { host: 'meity.gov.in', sourceType: 'official', official: true, social: false, provenance: { engine: 'gateway' } }
    const forReg = assessEvidenceAuthority(gov, 'regulatory')
    const forScience = assessEvidenceAuthority(gov, 'research-finding')
    expect(forReg.authorityClass).toBe('authoritative')
    expect(forReg.isPrimaryForClaim).toBe(true)
    expect(forScience.authorityClass).toBe('corroborating')
    expect(forScience.isPrimaryForClaim).toBe(false)
  })

  test('official docs are primary for technical behavior; advisory hosts primary for CVEs', () => {
    const docs = assessEvidenceAuthority({ host: 'nodejs.org', sourceType: 'other', official: false, social: false, provenance: { engine: 'direct' } }, 'technical-behavior')
    expect(docs.authorityClass).toBe('authoritative')
    const advisory = assessEvidenceAuthority({ host: 'osv.dev', sourceType: 'other', official: true, social: false, provenance: { engine: 'direct' } }, 'security-vulnerability')
    expect(advisory.authorityClass).toBe('authoritative')
    expect(advisory.isPrimaryForClaim).toBe(true)
  })

  test('academic primary for research findings; original datasets primary for statistics', () => {
    const paper = assessEvidenceAuthority({ host: 'arxiv.org', sourceType: 'other', official: false, social: false, provenance: { engine: 'direct' } }, 'research-finding')
    expect(paper.authorityClass).toBe('authoritative')
    const data = assessEvidenceAuthority({ host: 'data.gov.in', sourceType: 'official', official: true, social: false, provenance: { engine: 'gateway' } }, 'statistical')
    expect(data.isPrimaryForClaim).toBe(true)
  })

  test('UGC stays labeled user-generated for every kind except community experience', () => {
    const ugc = { host: 'reddit.com', sourceType: 'social', official: false, social: true, provenance: { engine: 'gateway' } }
    for (const kind of ['regulatory', 'technical-behavior', 'research-finding', 'security-vulnerability', 'statistical', 'current-events', 'general'] as ClaimKind[]) {
      const a = assessEvidenceAuthority(ugc, kind)
      expect(a.authorityClass).toBe('user-generated')
      expect(a.isPrimaryForClaim).toBe(false)
    }
    const asExperience = assessEvidenceAuthority(ugc, 'community-experience')
    expect(asExperience.isPrimaryForClaim).toBe(true) // first-hand experience evidence
    expect(asExperience.authorityClass).toBe('user-generated') // still labeled, never "authoritative truth"
  })

  test('a government source does not become primary for security advisories it did not issue… but advisory-government hosts do', () => {
    // A generic government portal is corroborating for a CVE claim:
    const portal = assessEvidenceAuthority({ host: 'india.gov.in', sourceType: 'official', official: true, social: false, provenance: { engine: 'gateway' } }, 'security-vulnerability')
    expect(portal.authorityClass).not.toBe('authoritative')
    // A security-cert government host IS primary for vulnerability claims:
    const cert = assessEvidenceAuthority({ host: 'cisa.gov', sourceType: 'official', official: true, social: false, provenance: { engine: 'gateway' } }, 'security-vulnerability')
    expect(cert.authorityClass).toBe('authoritative')
  })
})

describe('M43 evidence weight (class-driven, never count-driven)', () => {
  test('forty weak copies cannot outweigh one authoritative primary group', () => {
    const weak = Array.from({ length: 12 }, (_, i) => ({
      authorityClass: 'weak' as const,
      isPrimaryForClaim: false,
      independenceGroup: `g${i}`,
    }))
    const weakSummary = summarizeEvidenceWeight(weak)
    const onePrimary = summarizeEvidenceWeight([
      { authorityClass: 'authoritative', isPrimaryForClaim: true, independenceGroup: 'gov' },
    ])
    expect(weakSummary.hasPrimary).toBe(false)
    expect(onePrimary.hasPrimary).toBe(true)
    expect(onePrimary.decisiveClass).toBe('authoritative')
    // The decisive class of many weak rows stays weak — count did not promote it.
    expect(weakSummary.decisiveClass).toBe('weak')
  })

  test('copies within one group do not inflate distinct-group counts', () => {
    const s = summarizeEvidenceWeight([
      { authorityClass: 'strong', isPrimaryForClaim: false, independenceGroup: 'same' },
      { authorityClass: 'strong', isPrimaryForClaim: false, independenceGroup: 'same' },
      { authorityClass: 'strong', isPrimaryForClaim: false, independenceGroup: 'same' },
    ])
    expect(s.independentSupportGroups).toBe(1)
  })

  test('contradicting groups are counted distinctly from supporting groups', () => {
    const s = summarizeEvidenceWeight(
      [{ authorityClass: 'strong', isPrimaryForClaim: false, independenceGroup: 'sup' }],
      [{ authorityClass: 'authoritative', independenceGroup: 'con' }],
    )
    expect(s.independentSupportGroups).toBe(1)
    expect(s.independentContradictingGroups).toBe(1)
    expect(s.basis).toContain('no primary authority')
  })
})

describe('M43 publisher labels', () => {
  test('known brands labeled from host only; government hosts stay unlabeled', () => {
    expect(publisherFromHost('bbc.com')).toBe('BBC')
    expect(publisherFromHost('www.npmjs.com')).toBe('npm')
    expect(publisherFromHost('developer.mozilla.org')).toBe('MDN Web Docs')
    expect(publisherFromHost('meity.gov.in')).toBeNull()
    expect(publisherFromHost('random-blog.example')).toBeNull()
  })
})
