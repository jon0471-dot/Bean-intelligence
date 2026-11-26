/**
 * M41.7 — mission-aware file-fenced deliverable verification tests.
 *
 * Covers the root-cause repair surface:
 *  - the trusted verification context (build / bounded serialization /
 *    untrusted-parse rejection),
 *  - the deliverable audit input (the file-fence wrapper is NEVER the
 *    audited deliverable; extracted files are),
 *  - the deterministic document contract (the ten Phase-3 checks incl.
 *    citation correspondence against the exact handed-off sources),
 *  - the deterministic website contract (static sites audited AS static
 *    sites — no package.json demand; HTML files alone never "verified"),
 *  - dispatch + planner contract wiring + anti-weakening guards.
 *
 * PURE tests — no DB, no network.
 */
import { describe, test, expect } from 'bun:test'
import {
  buildVerificationContext,
  parseMissionVerificationContext,
  serializeVerificationContext,
  buildDeliverableAuditInput,
  buildMissionAuditRequest,
  handoffSourceRefs,
  VERIFY_CONTEXT_LIMITS,
  type MissionVerificationContext,
} from '../../src/lib/riishe/mission/verify-context'
import {
  verifyTaskOutput,
  verifyDocumentDraft,
  verifyWebsiteBuild,
  type CodingJobPayload,
  type PersistedDeliverableEvidence,
} from '../../src/lib/riishe/mission/verifiers'
import { planMission } from '../../src/lib/riishe/mission/planner'
import { buildTaskSpec, MissionContractError } from '../../src/lib/riishe/mission/types'
import { parseFiles } from '../../src/lib/giftz/workspace'

const THREE_SOURCES = [
  { url: 'https://a.example/1?utm=x', title: 'Study A' },
  { url: 'https://b.example/2', title: 'Study B' },
  { url: 'https://c.example/3', title: 'Study C' },
]

const GROUNDED_REPORT = `# Remote Work and Productivity: What the Research Shows

## Introduction
This report summarizes the handed-off research, citing each finding [1][2][3] with real substance in every section so the length contract is satisfied comfortably.

## Findings
Study A measured that remote work raised output [1]. Study B found hybrid teams thrive [2]. Study C confirmed the output gains hold over time [3]. The paragraphs here are deliberately substantive: the deterministic contract rejects thin documents that cannot carry their sources, so each section carries real prose and the whole file lands well above the four-hundred-character floor.

## Sources
[1] Study A — https://a.example/1
[2] Study B — https://b.example/2
[3] Study C — https://c.example/3
`

const DOC_CRITERIA = {
  requireSelfVerification: true,
  minFileChanges: 1,
  requireSourceCitation: true,
  deliverablePath: 'report.md',
  deliverableKind: 'document' as const,
  requiredSections: ['Sources'],
}

function jobPayload(overrides: Partial<CodingJobPayload> = {}): CodingJobPayload {
  return {
    projectId: 'proj-x',
    changes: [{ path: 'report.md', change: 'created' }],
    contentChars: 4200,
    verification: { status: 'passed', attempts: 1, corrections: 0, issuesFound: 0 },
    durationMs: 1000,
    ...overrides,
  }
}

function persistedDoc(content: string | null): PersistedDeliverableEvidence {
  return {
    projectId: 'proj-x',
    manifest: content === null ? [] : [{ path: 'report.md', chars: content.length }],
    deliverableContent: content,
    contents: [],
  }
}

function websitePersisted(files: Array<{ path: string; content: string }>): PersistedDeliverableEvidence {
  return {
    projectId: 'proj-x',
    manifest: files.map((f) => ({ path: f.path, chars: f.content.length })),
    deliverableContent: null,
    contents: files,
  }
}

const GOOD_WEBSITE = [
  {
    path: 'index.html',
    content:
      '<!doctype html>\n<html><head><title>Studio</title>\n<link rel="stylesheet" href="style.css"></head>\n<body><h1>Studio</h1>\n<main><p>Substantive landing content: services, gallery and contact details laid out with semantic sections, responsive rules and accessible labels, comfortably above the stub floor so the entry-content contract holds for this fixture.</p>\n<a href="about.html">About</a></main></body></html>\n',
  },
  { path: 'about.html', content: '<!doctype html>\n<html><head><link rel="stylesheet" href="style.css"></head><body><h1>About</h1><p>Real biography content of adequate length to be an actual page rather than an empty stub placeholder file.</p></body></html>\n' },
  { path: 'style.css', content: 'body{font-family:sans-serif}\n' },
]

const WEBSITE_CRITERIA = {
  requireSelfVerification: true,
  minFileChanges: 1,
  deliverableKind: 'website' as const,
  requiredPaths: ['index.html'],
}

const WEBSITE_PAYLOAD: CodingJobPayload = {
  projectId: 'proj-x',
  changes: [{ path: 'index.html', change: 'created' }, { path: 'style.css', change: 'created' }, { path: 'about.html', change: 'created' }],
  contentChars: 8000,
  verification: { status: 'passed', attempts: 1, corrections: 0, issuesFound: 0 },
  durationMs: 1000,
}

// ---------------------------------------------------------------------------
// The trusted context
// ---------------------------------------------------------------------------

describe('verification context (build / parse / serialize)', () => {
  test('builds from the task contract; source numbering matches the handoff exactly', () => {
    const refs = handoffSourceRefs(THREE_SOURCES)
    const ctx = buildVerificationContext({
      missionId: 'm1', taskId: 'document', taskKind: 'document-draft',
      criteria: { ...DOC_CRITERIA, requiredSections: ['Sources'] },
      sources: THREE_SOURCES,
    })
    expect(ctx.deliverableKind).toBe('document')
    expect(ctx.deliverablePath).toBe('report.md')
    expect(ctx.requireCitations).toBe(true)
    expect(ctx.sources.map((s) => `${s.index}|${s.url}`)).toEqual(refs.map((s) => `${s.index}|${s.url}`))
    // Query strings are stripped exactly like the handoff pack.
    expect(ctx.sources[0].url).toBe('https://a.example/1')
  })

  test('citations are not required when no sources were handed off', () => {
    const ctx = buildVerificationContext({
      missionId: 'm1', taskId: 'document', taskKind: 'document-draft',
      criteria: { ...DOC_CRITERIA }, sources: [],
    })
    expect(ctx.requireCitations).toBe(false)
    expect(ctx.sources).toEqual([])
  })

  test('website defaults to the index.html entry when no paths were specified', () => {
    const ctx = buildVerificationContext({
      missionId: 'm1', taskId: 'build', taskKind: 'code-build',
      criteria: { deliverableKind: 'website' }, sources: [],
    })
    expect(ctx.requiredPaths).toEqual(['index.html'])
  })

  test('serialization stays inside the job-params bound and round-trips', () => {
    const ctx = buildVerificationContext({
      missionId: 'm1', taskId: 'document', taskKind: 'document-draft',
      criteria: DOC_CRITERIA, sources: THREE_SOURCES,
    })
    const s = serializeVerificationContext(ctx)
    expect(s.length).toBeLessThanOrEqual(VERIFY_CONTEXT_LIMITS.serializedChars)
    const back = parseMissionVerificationContext(JSON.parse(s))
    expect(back).not.toBeNull()
    expect(back!.sources.length).toBe(3)
    expect(back!.deliverablePath).toBe('report.md')
  })

  test('the worker-side parse REJECTS malformed shapes (untrusted → null, never weakened)', () => {
    expect(parseMissionVerificationContext(null)).toBeNull()
    expect(parseMissionVerificationContext('inject me')).toBeNull()
    expect(parseMissionVerificationContext({ missionId: 'm1' })).toBeNull()
    expect(parseMissionVerificationContext({ missionId: 'm1', taskId: 't', taskKind: 'not-a-kind', deliverableKind: 'document' })).toBeNull()
    // A forged context with non-URL "sources" loses them (citation checks engage only on real URLs).
    const forged = parseMissionVerificationContext({
      missionId: 'm1', taskId: 't', taskKind: 'document-draft', deliverableKind: 'document',
      requireCitations: true, sources: [{ index: 1, url: 'javascript:alert(1)', title: 'x' }],
    })
    expect(forged).not.toBeNull()
    expect(forged!.sources).toEqual([])
    expect(forged!.requireCitations).toBe(false)
    // Path traversal in required paths is dropped by the shape-checked reader.
    const traversal = parseMissionVerificationContext({
      missionId: 'm1', taskId: 't', taskKind: 'code-build', deliverableKind: 'website',
      requiredPaths: ['../../etc/passwd', 'index.html'],
    })
    expect(traversal).not.toBeNull()
    expect(traversal!.requiredPaths).toEqual(['index.html'])
  })
})

// ---------------------------------------------------------------------------
// The deliverable audit input (wrapper ≠ deliverable)
// ---------------------------------------------------------------------------

describe('deliverable audit input', () => {
  const ctx: MissionVerificationContext = buildVerificationContext({
    missionId: 'm1', taskId: 'document', taskKind: 'document-draft',
    criteria: DOC_CRITERIA, sources: THREE_SOURCES,
  })

  test('the document content is audited directly — the wrapper and its fences are not', () => {
    const wrapper = [
      'Here is the report you asked for:',
      '```md path=report.md',
      GROUNDED_REPORT,
      '```',
      'Let me know if you want changes.',
    ].join('\n')
    const files = parseFiles(wrapper)
    expect(files.length).toBe(1)
    const audit = buildDeliverableAuditInput(files, ctx)
    // The actual document IS present…
    expect(audit.text).toContain('# Remote Work and Productivity')
    // …while the wrapper prose and fence syntax are NOT the audited text.
    expect(audit.text).not.toContain('Here is the report you asked for:')
    expect(audit.text).not.toContain('Let me know if you want changes.')
    expect(audit.text).not.toContain('```md path=report.md')
    expect(audit.text).toContain('DELIVERY WRAPPER')
    expect(audit.deliveredFiles).toEqual(['report.md'])
  })

  test('a wrapper with no extractable file produces an honest NO-DELIVERABLE audit', () => {
    const audit = buildDeliverableAuditInput([], ctx)
    expect(audit.text).toContain('NO DELIVERABLE FILE')
    expect(audit.deliveredFiles).toEqual([])
  })

  test('the website audit lists the real file inventory with entry files first', () => {
    const webCtx = buildVerificationContext({
      missionId: 'm1', taskId: 'build', taskKind: 'code-build',
      criteria: WEBSITE_CRITERIA, sources: [],
    })
    const wrapper = [
      'Built the site:',
      '```html path=index.html\n<html>…real entry…</html>\n```',
      '```css path=style.css\nbody{}\n```',
    ].join('\n')
    const audit = buildDeliverableAuditInput(parseFiles(wrapper), webCtx)
    expect(audit.text).toContain('FILE: index.html')
    expect(audit.text).toContain('FILE: style.css')
    expect(audit.text.indexOf('FILE: index.html')).toBeLessThan(audit.text.indexOf('FILE: style.css'))
    expect(audit.text).not.toContain('Built the site:')
  })

  test('the audit request carries the acceptance contract, not the wrapper', () => {
    const req = buildMissionAuditRequest('Research X and write a report', ctx)
    expect(req).toContain('Research X and write a report')
    expect(req).toContain('report.md')
    expect(req).toContain('Sources')
    expect(req).toContain('[1] Study A — https://a.example/1')
    expect(req).toContain('truncated or incomplete deliverable cannot pass')
  })
})

// ---------------------------------------------------------------------------
// The deterministic DOCUMENT contract (Phase 3's ten checks)
// ---------------------------------------------------------------------------

describe('document deliverable verifier (persisted audit)', () => {
  const ctx: TaskVerificationExtras = { sourceRefs: handoffSourceRefs(THREE_SOURCES) }

  test('a grounded persisted report passes on its ACTUAL content', () => {
    const out = verifyDocumentDraft(jobPayload(), DOC_CRITERIA, { ...ctx, persisted: persistedDoc(GROUNDED_REPORT) })
    expect(out.status).toBe('verified')
    expect(out.reasons[0]).toContain('persisted document')
  })

  test('(1) missing deliverable file is caught', () => {
    const out = verifyDocumentDraft(jobPayload(), DOC_CRITERIA, { ...ctx, persisted: persistedDoc(null) })
    expect(out.status).toBe('needs_correction')
    expect(out.reasons.join(' ')).toContain('does not exist')
  })

  test('(2) unsafe deliverable paths fail the boundary check', () => {
    const out = verifyDocumentDraft(jobPayload(), { ...DOC_CRITERIA, deliverablePath: '../escape.md' }, { ...ctx, persisted: persistedDoc(GROUNDED_REPORT) })
    expect(out.status).toBe('needs_correction')
    expect(out.reasons.join(' ')).toContain('not a safe project-relative path')
  })

  test('(3) thin documents cannot pass', () => {
    const out = verifyDocumentDraft(jobPayload({ contentChars: 120 }), DOC_CRITERIA, { ...ctx, persisted: persistedDoc('# Tiny\n\n## Src\n[1] https://a.example/1\n') })
    expect(out.status).toBe('needs_correction')
    expect(out.reasons.join(' ')).toContain('too thin')
  })

  test('(4)/(5) missing structure or the required Sources section is caught', () => {
    const noSections = GROUNDED_REPORT.replace(/^## .+$/gm, 'plain text line')
    const out = verifyDocumentDraft(jobPayload(), DOC_CRITERIA, { ...ctx, persisted: persistedDoc(noSections) })
    expect(out.status).toBe('needs_correction')
    expect(out.reasons.join(' ')).toContain('Sources')
  })

  test('(6) a document with no numbered citations fails the citation contract', () => {
    const uncited = GROUNDED_REPORT.replace(/\[\d\]/g, '')
    const out = verifyDocumentDraft(jobPayload(), DOC_CRITERIA, { ...ctx, persisted: persistedDoc(uncited) })
    expect(out.status).toBe('needs_correction')
    expect(out.reasons.join(' ')).toContain('cites no numbered sources')
  })

  test('(7)/(9) markers beyond the handed-off count cannot pass', () => {
    const overcited = GROUNDED_REPORT.replace('[3]', '[9]')
    const out = verifyDocumentDraft(jobPayload(), DOC_CRITERIA, { ...ctx, persisted: persistedDoc(overcited) })
    expect(out.status).toBe('needs_correction')
    expect(out.reasons.join(' ')).toContain('do not correspond')
  })

  test('(8) URLs outside the handed-off pack are unsupported citations', () => {
    const contaminated = GROUNDED_REPORT.replace('https://c.example/3', 'https://not-in-the-pack.example/xyz')
    const out = verifyDocumentDraft(jobPayload(), DOC_CRITERIA, { ...ctx, persisted: persistedDoc(contaminated) })
    expect(out.status).toBe('needs_correction')
    expect(out.reasons.join(' ')).toContain('outside the handed-off research pack')
  })

  test('(10) an unclosed fence — truncation — cannot pass', () => {
    const truncated = GROUNDED_REPORT + '\n' + '```py\n' + "print('cut off mid-block'\n"
    const out = verifyDocumentDraft(jobPayload(), DOC_CRITERIA, { ...ctx, persisted: persistedDoc(truncated) })
    expect(out.status).toBe('needs_correction')
    expect(out.reasons.join(' ')).toContain('unclosed code fence')
  })

  test('truncated REAL output (half a report) fails completeness', () => {
    const half = GROUNDED_REPORT.slice(0, Math.floor(GROUNDED_REPORT.length / 2))
    const out = verifyDocumentDraft(jobPayload(), DOC_CRITERIA, { ...ctx, persisted: persistedDoc(half) })
    // The half report loses its Sources section AND most citations.
    expect(out.status).toBe('needs_correction')
  })

  test('legacy evidence path (no persisted snapshot) keeps the original contract', () => {
    const ok = verifyDocumentDraft(jobPayload(), DOC_CRITERIA, { handedOffSources: 3 })
    expect(ok.status).toBe('verified')
    const wrongPath = verifyDocumentDraft(jobPayload({ changes: [{ path: 'other.md', change: 'created' }] }), DOC_CRITERIA, { handedOffSources: 3 })
    expect(wrongPath.status).toBe('needs_correction')
    const thin = verifyDocumentDraft(jobPayload({ contentChars: 50 }), DOC_CRITERIA, { handedOffSources: 3 })
    expect(thin.status).toBe('needs_correction')
  })

  test('the unproven-base guard still outranks everything (no verified wrap of a failed job)', () => {
    const out = verifyDocumentDraft(jobPayload({ verification: { status: 'unverified', attempts: 2, corrections: 1, issuesFound: 1 } }), DOC_CRITERIA, { ...ctx, persisted: persistedDoc(GROUNDED_REPORT) })
    expect(out.status).toBe('needs_correction')
    expect(out.reasons.join(' ')).toContain('unverified')
  })

  test('M41.7 live regression: the hosted pipeline SUCCESS vocabulary (verified/corrected) passes the gate', () => {
    // Live-measured 2026-11-26: the mission-aware hosted audit returned
    // status 'verified' (0 issues) for a good document and the gate still
    // refused it with the contradictory reason "Self-verification reported
    // \"verified\"" — poisoning the correction round that followed.
    const verified = verifyDocumentDraft(jobPayload({ verification: { status: 'verified', attempts: 1, corrections: 0, issuesFound: 0 } }), DOC_CRITERIA, { ...ctx, persisted: persistedDoc(GROUNDED_REPORT) })
    expect(verified.status).toBe('verified')
    const corrected = verifyDocumentDraft(jobPayload({ verification: { status: 'corrected', attempts: 2, corrections: 1, issuesFound: 0 } }), DOC_CRITERIA, { ...ctx, persisted: persistedDoc(GROUNDED_REPORT) })
    expect(corrected.status).toBe('verified')
  })

  test('M41.7 live regression: clustered citation styles ([1, 4], [1-3]) parse for correspondence', () => {
    const clustered = GROUNDED_REPORT.replace('[1][2][3]', '[1, 2, 3]').replace('[1]. Study B found hybrid teams thrive [2]', '[1, 2]. Study B found hybrid teams thrive')
    const ranged = GROUNDED_REPORT.replace('[1][2][3]', '[1-3]')
    expect(verifyDocumentDraft(jobPayload(), DOC_CRITERIA, { ...ctx, persisted: persistedDoc(clustered) }).status).toBe('verified')
    expect(verifyDocumentDraft(jobPayload(), DOC_CRITERIA, { ...ctx, persisted: persistedDoc(ranged) }).status).toBe('verified')
    // an out-of-range number inside a cluster is still caught
    const badRange = GROUNDED_REPORT.replace('[1][2][3]', '[1, 9]')
    expect(verifyDocumentDraft(jobPayload(), DOC_CRITERIA, { ...ctx, persisted: persistedDoc(badRange) }).status).toBe('needs_correction')
  })
})

type TaskVerificationExtras = import('../../src/lib/riishe/mission/verifiers').TaskVerificationContext

// ---------------------------------------------------------------------------
// The deterministic WEBSITE contract (Phase 4)
// ---------------------------------------------------------------------------

describe('website deliverable verifier (persisted audit)', () => {
  test('a real static site passes WITHOUT any package.json demand', () => {
    const out = verifyWebsiteBuild(WEBSITE_PAYLOAD, WEBSITE_CRITERIA, { persisted: websitePersisted(GOOD_WEBSITE) })
    expect(out.status).toBe('verified')
    expect(out.reasons[0]).toContain('static site')
  })

  test('a missing entry file is caught', () => {
    const out = verifyWebsiteBuild(WEBSITE_PAYLOAD, WEBSITE_CRITERIA, { persisted: websitePersisted(GOOD_WEBSITE.slice(1)) })
    expect(out.status).toBe('needs_correction')
    expect(out.reasons.join(' ')).toContain('index.html')
  })

  test('HTML files alone never equal a verified website (stub entry)', () => {
    const stub = [{ path: 'index.html', content: '<html><body>stub</body></html>\n' }]
    const out = verifyWebsiteBuild(WEBSITE_PAYLOAD, WEBSITE_CRITERIA, { persisted: websitePersisted(stub) })
    expect(out.status).toBe('needs_correction')
    expect(out.reasons.join(' ')).toContain('not a substantive page')
  })

  test('broken internal links and missing assets are named', () => {
    const broken = [
      GOOD_WEBSITE[0],
      { path: 'orphan.html', content: '<!doctype html>\n<html><head><link rel="stylesheet" href="ghost.css"></head><body><a href="missing.html">x</a><img src="nope.png"></body></html>\n' },
    ]
    const out = verifyWebsiteBuild(WEBSITE_PAYLOAD, WEBSITE_CRITERIA, { persisted: websitePersisted(broken) })
    expect(out.status).toBe('needs_correction')
    const joined = out.reasons.join(' ')
    expect(joined).toContain('ghost.css')
    expect(joined).toContain('missing.html')
  })

  test('no persisted snapshot ⇒ unproven, never verified', () => {
    const out = verifyWebsiteBuild(WEBSITE_PAYLOAD, WEBSITE_CRITERIA, {})
    expect(out.status).toBe('needs_correction')
    expect(out.reasons.join(' ')).toContain('unproven')
  })

  test('a failed hosted self-verification still blocks the website (gate intact)', () => {
    const out = verifyWebsiteBuild(
      { ...WEBSITE_PAYLOAD, verification: { status: 'issues_found', attempts: 2, corrections: 1, issuesFound: 2 } },
      WEBSITE_CRITERIA,
      { persisted: websitePersisted(GOOD_WEBSITE) },
    )
    expect(out.status).toBe('needs_correction')
    expect(out.reasons.join(' ')).toContain('issues_found')
  })
})

// ---------------------------------------------------------------------------
// Dispatch, planner wiring and anti-weakening structure
// ---------------------------------------------------------------------------

describe('M41.7 dispatch and contracts', () => {
  test('verifyTaskOutput routes website contracts to the persisted-file verifier', () => {
    const out = verifyTaskOutput('code-build', WEBSITE_CRITERIA, WEBSITE_PAYLOAD, { persisted: websitePersisted([{ path: 'index.html', content: '<html>stub</html>' }]) })
    expect(out.status).toBe('needs_correction')
    expect(out.reasons.join(' ')).toContain('not a substantive page')
  })

  test('plain code-builds keep the job-payload gates (debug lane untouched)', () => {
    const out = verifyTaskOutput('code-build', { requireSelfVerification: true, minFileChanges: 1 }, {
      projectId: 'p', changes: [{ path: 'a.js', change: 'created' }], verification: { status: 'passed' },
    })
    expect(out.status).toBe('verified')
  })

  test('the planner emits the website contract (index.html entry, no stack demand)', () => {
    const plan = planMission('Build a professional website for my coffee shop with a menu page')
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const build = plan.tasks.find((t) => t.kind === 'code-build')!
    expect(build.verification.deliverableKind).toBe('website')
    expect(build.verification.requiredPaths).toContain('index.html')
  })

  test('the planner emits the document contract (Sources section when research exists)', () => {
    const plan = planMission('Research the impact of remote work and write a report on it')
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const doc = plan.tasks.find((t) => t.kind === 'document-draft')!
    expect(doc.verification.deliverableKind).toBe('document')
    expect(doc.verification.deliverablePath).toBe('report.md')
    expect(doc.verification.requiredSections).toContain('Sources')
  })

  test('a document task can never declare a website deliverable (contract error)', () => {
    expect(() =>
      buildTaskSpec({
        id: 'doc', kind: 'document-draft', title: 'x', objective: 'write the report', expectedOutput: 'the report',
        verification: { deliverableKind: 'website' },
      }),
    ).toThrow(MissionContractError)
  })

  test('unsafe requiredPaths are rejected by the contract builder', () => {
    expect(() =>
      buildTaskSpec({
        id: 'build', kind: 'code-build', title: 'x', objective: 'build the site', expectedOutput: 'the site',
        verification: { deliverableKind: 'website', requiredPaths: ['../escape.html'] },
      }),
    ).toThrow(MissionContractError)
  })
})
