/**
 * M43 Phase 4 contracts — contradiction & uncertainty reasoning:
 *   - the M37 numeric/date measure engine is REUSED over evidence records
 *     (mapped in, kinds re-labeled, contexts preserved);
 *   - new kinds: conflicting technical specs (same unit family, different
 *     values, DISTINCT independence groups), conflicting regional
 *     requirements (claim generalizes; evidence speaks for two jurisdictions),
 *     claim-exceeds-evidence (universal-quantifier / causal-certainty /
 *     precision escalation over the actual passages);
 *   - resolution is ONLY explicit newer-primary-supersedes (>= 30 days gap,
 *     primary authority, both values preserved, basis stated) — everything
 *     else stays unresolved;
 *   - uncertaintyStatement renders what remains uncertain, bounded;
 *   - no finding is ever silently dropped or silently preferred.
 *
 * Run: bun test tests/unit/m43-contradictions.test.ts
 */
import { describe, test, expect } from 'bun:test'
import {
  detectClaimContradictions,
  detectClaimExceedsEvidence,
  resolveContradictions,
  uncertaintyStatement,
} from '../../src/lib/research/contradiction-reasoning'
import { buildEvidenceRecords } from '../../src/lib/research/evidence'
import { assessEvidenceAuthority } from '../../src/lib/research/source-trust'
import type { SpecialistEvidence, SpecialistEvidencePack } from '../../src/lib/research/agent-evidence'

function srcEv(overrides: Partial<SpecialistEvidence> & { url: string }): SpecialistEvidence {
  return {
    sourceId: '[S1]', title: overrides.title ?? 'Source', host: new URL(overrides.url).host,
    sourceType: 'other', author: null, publishedAt: null, retrievedAt: '2026-11-20T08:00:00.000Z',
    excerpt: null, pageRead: false, provenance: { channel: null, engine: 'gateway' }, official: false, ...overrides,
  }
}

function recs(evidence: SpecialistEvidence[], role: 'supporting' | 'contradicting' = 'supporting') {
  const p: SpecialistEvidencePack = {
    consumer: 'knowledge', purpose: 'fact-check', evidence, queries: [], cacheHits: 0,
    fetchedAt: '', freshnessWarnings: [], degraded: [], elapsedMs: 1, skippedReason: null, searchCalls: 0, pageReadCalls: 0,
  }
  return buildEvidenceRecords(p, { role, assessAuthority: (s) => assessEvidenceAuthority(s, 'statistical') })
}

describe('M43 numeric/date contradictions reuse the M37 engine', () => {
  test('different percent values for the same entity from different groups are flagged', () => {
    // Entity must NOT be sentence-initial (the conservative M37 anchor rule).
    const records = recs([
      srcEv({ url: 'https://reuters.com/a', sourceId: '[S1]', sourceType: 'news', title: 'Union says the Acme restructuring cut 12 percent of the workforce', excerpt: 'The filing shows Acme cut 12 percent of its workforce.' }),
      srcEv({ url: 'https://bbc.com/b', sourceId: '[S2]', sourceType: 'news', title: 'Filing shows the Acme headcount fell by 18 percent', excerpt: 'The report states Acme reduced headcount by 18 percent.' }),
    ])
    const report = detectClaimContradictions('Acme laid off 15 percent of its workforce in 2026.', records)
    expect(report.measureFindings).toBeGreaterThanOrEqual(1)
    expect(report.findings.some((f) => f.kind === 'conflicting-numerical-values')).toBe(true)
    const f = report.findings.find((x) => x.kind === 'conflicting-numerical-values')
    expect(f?.valueA).not.toBe(f?.valueB)
    expect(f?.resolution).toBe('unresolved')
  })

  test('identical values are never flagged as contradictions', () => {
    const records = recs([
      srcEv({ url: 'https://reuters.com/a', sourceId: '[S1]', sourceType: 'news', title: 'Acme layoffs reach 12 percent of workforce', excerpt: 'Acme cut 12 percent of staff' }),
      srcEv({ url: 'https://bbc.com/b', sourceId: '[S2]', sourceType: 'news', title: 'Acme cuts 12 percent of staff', excerpt: 'Acme reduced headcount by 12 percent' }),
    ])
    const report = detectClaimContradictions('Acme laid off 12 percent of its workforce.', records)
    expect(report.findings.filter((f) => f.kind === 'conflicting-numerical-values')).toHaveLength(0)
  })
})

describe('M43 spec conflicts', () => {
  test('same spec family, different values, different groups → conflicting-technical-specs', () => {
    const records = recs([
      srcEv({ url: 'https://docs.example.com/limits', sourceId: '[S1]', excerpt: 'The API supports up to 100 requests per minute on every plan.' }),
      srcEv({ url: 'https://vendor.example.net/pricing', sourceId: '[S2]', excerpt: 'Rate limits: up to 500 requests per minute.' }),
    ])
    const report = detectClaimContradictions('The API allows up to 300 requests per minute.', records)
    expect(report.findings.some((f) => f.kind === 'conflicting-technical-specs')).toBe(true)
    const f = report.findings.find((x) => x.kind === 'conflicting-technical-specs')
    expect(f?.valueA).toContain('100 requests')
    expect(f?.valueB).toContain('500 requests')
  })

  test('copies within one group are not spec conflicts', () => {
    const shared = 'the plan allows up to 100 requests per minute on every tier'
    const records = recs([
      srcEv({ url: 'https://docs.example.com/limits', sourceId: '[S1]', excerpt: shared, title: `API rate limits confirmed ${shared}` }),
      srcEv({ url: 'https://mirror.example.net/limits', sourceId: '[S2]', excerpt: shared, title: `API rate limits confirmed ${shared}` }),
    ])
    const report = detectClaimContradictions('The API allows up to 100 requests per minute.', records)
    expect(report.findings.filter((f) => f.kind === 'conflicting-technical-specs')).toHaveLength(0)
  })
})

describe('M43 regional requirement conflicts', () => {
  test('claim generalizing across regions with jurisdiction-specific evidence is flagged', () => {
    const records = recs([
      srcEv({ url: 'https://meity.gov.in/in-rules', sourceId: '[S1]', excerpt: 'In India the data localization rule requires storage within the country.' }),
      srcEv({ url: 'https://edpb.europa.eu/eu-rules', sourceId: '[S2]', excerpt: 'In the EU the GDPR permits transfers under adequacy decisions.' }),
    ])
    const report = detectClaimContradictions('Data localization is required for user data in every major jurisdiction in 2026.', records)
    expect(report.findings.some((f) => f.kind === 'conflicting-regional-requirements')).toBe(true)
    const f = report.findings.find((x) => x.kind === 'conflicting-regional-requirements')
    expect(f?.note).toContain('jurisdiction')
  })

  test('single-region evidence never triggers a regional conflict', () => {
    const records = recs([
      srcEv({ url: 'https://meity.gov.in/in-rules', sourceId: '[S1]', excerpt: 'In India the rule requires storage within the country.' }),
    ])
    const report = detectClaimContradictions('In India the rule requires local storage.', records)
    expect(report.findings.filter((f) => f.kind === 'conflicting-regional-requirements')).toHaveLength(0)
  })
})

describe('M43 claim-exceeds-evidence', () => {
  test('universal quantifier escalation is caught', () => {
    const findings = detectClaimExceedsEvidence('All studies prove the diet works for everyone.', [
      'Some studies suggest the diet may help certain participants.',
    ])
    expect(findings.some((f) => f.kind === 'claim-exceeds-evidence')).toBe(true)
    expect(findings.some((f) => f.note.includes('universal quantifier'))).toBe(true)
  })

  test('causal certainty escalation is caught', () => {
    const findings = detectClaimExceedsEvidence('The treatment causes full recovery in patients.', [
      'The treatment was associated with improved outcomes in a small cohort.',
    ])
    expect(findings.some((f) => f.note.includes('causal/certainty escalation'))).toBe(true)
  })

  test('precision escalation is caught', () => {
    const findings = detectClaimExceedsEvidence('The device weighs exactly 240 grams.', [
      'The device weighs approximately 240 grams depending on configuration.',
    ])
    expect(findings.some((f) => f.note.includes('precision escalation'))).toBe(true)
  })

  test('a claim with no supporting passage at all is flagged', () => {
    const findings = detectClaimExceedsEvidence('The merger was approved unanimously.', [])
    expect(findings).toHaveLength(1)
    expect(findings[0].evidenceIdB).toBe('[no-evidence]')
  })

  test('matching strength is NOT flagged', () => {
    const findings = detectClaimExceedsEvidence('Some studies suggest the diet may help certain participants.', [
      'Some studies suggest the diet may help certain participants.',
    ])
    expect(findings.filter((f) => f.kind === 'claim-exceeds-evidence')).toHaveLength(0)
  })
})

describe('M43 resolution rules', () => {
  test('newer primary supersedes older with a stated basis and both values preserved', () => {
    const govRec = recs([
      srcEv({ url: 'https://meity.gov.in/new', sourceId: '[S1]', publishedAt: '2026-10-01', excerpt: 'the cap is 3.5 percent', official: true }),
    ])[0]
    const blogRec = recs([
      srcEv({ url: 'https://blog.example.com/old', sourceId: '[S2]', publishedAt: '2026-01-01', excerpt: 'the cap is 2 percent' }),
    ], 'contradicting')[0]
    blogRec.evidenceId = '[E2]' // unique ids across the SET (guaranteed in production where one pack builds all records)
    const records = [govRec, blogRec]
    const constructed = [{
      kind: 'conflicting-numerical-values' as const,
      subject: 'fee cap: percent',
      evidenceIdA: govRec.evidenceId,
      evidenceIdB: blogRec.evidenceId,
      valueA: '3.5',
      valueB: '2',
      note: 'cap differs',
      resolution: 'unresolved' as const,
      resolutionBasis: null,
    }]
    const resolved = resolveContradictions(constructed, records, new Date('2026-11-27T00:00:00.000Z'))
    expect(resolved[0].resolution).toBe('resolvable')
    expect(resolved[0].resolutionBasis).toContain('supersedes')
    expect(resolved[0].valueA).toBe('3.5') // both values preserved — supersession, not deletion
    expect(resolved[0].valueB).toBe('2')
  })

  test('equal-date or non-primary evidence never resolves', () => {
    const records = [
      ...recs([srcEv({ url: 'https://reuters.com/a', sourceId: '[S1]', publishedAt: '2026-10-01', sourceType: 'news', excerpt: 'x' })]),
      ...recs([srcEv({ url: 'https://bbc.com/b', sourceId: '[S2]', publishedAt: '2026-10-01', sourceType: 'news', excerpt: 'y' })], 'contradicting'),
    ]
    const constructed = [{
      kind: 'conflicting-numerical-values' as const,
      subject: 'rate: percent',
      evidenceIdA: '[E1]',
      evidenceIdB: '[E2]',
      valueA: '6.7',
      valueB: '8.2',
      note: 'rates differ',
      resolution: 'unresolved' as const,
      resolutionBasis: null,
    }]
    const resolved = resolveContradictions(constructed, records, new Date('2026-11-27T00:00:00.000Z'))
    expect(resolved[0].resolution).toBe('unresolved')
    expect(resolved[0].resolutionBasis).toBeNull()
  })

  test('claim-exceeds findings are never resolvable', () => {
    const ce = detectClaimExceedsEvidence('All studies prove it works.', ['Some studies suggest it may help.'])
    const resolved = resolveContradictions(ce, [])
    expect(resolved[0].resolution).toBe('unresolved')
  })
})

describe('M43 uncertainty statement', () => {
  test('renders the leading disagreement + unresolved claim notes, bounded', () => {
    const report = detectClaimContradictions(
      'The Acme layoff share was 15 percent.',
      recs([srcEv({ url: 'https://reuters.com/a', sourceId: '[S1]', sourceType: 'news', title: 'Union says the Acme restructuring cut 12 percent of the workforce', excerpt: 'The filing shows Acme cut 12 percent.' })]),
      recs([srcEv({ url: 'https://bbc.com/b', sourceId: '[S2]', sourceType: 'news', title: 'Filing shows the Acme headcount fell by 18 percent', excerpt: 'The report states Acme cut 18 percent.' })], 'contradicting'),
    )
    const s = uncertaintyStatement(report, [{ claim: 'x', unresolved: 'independent sources of equal strength disagree about this claim' }])
    expect(s.startsWith('What remains uncertain:')).toBe(true)
    expect(s.length).toBeLessThanOrEqual(480)
  })

  test('empty when nothing is unresolved', () => {
    expect(uncertaintyStatement({ findings: [], measureFindings: 0, unresolvedCount: 0, resolvableCount: 0 })).toBe('')
  })
})
