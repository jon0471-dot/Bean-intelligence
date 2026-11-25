/**
 * M41 Phase 2/7 — deterministic mission output verifiers.
 *
 * Every verifier decision is derived from the REAL worker payload shapes
 * (coding / image / video / audio / research). Pinned here: verified,
 * needs_correction and failed paths — including the never-upgrade rule
 * (missing evidence can never become success).
 */
import { describe, test, expect } from 'bun:test'

import {
  verifyAudioAsset,
  verifyCodeBuild,
  verifyDeliverable,
  verifyDocumentDraft,
  verifyImageAsset,
  verifyResearch,
  verifyTaskOutput,
  verifyVideoAsset,
  type AudioJobPayload,
  type CodingJobPayload,
  type ImageJobPayload,
  type ResearchPayload,
  type VideoJobPayload,
} from '../../src/lib/riishe/mission/verifiers'

const PASSING_CODE: CodingJobPayload = {
  projectId: 'proj1',
  changes: [
    { path: 'index.html', change: 'created' },
    { path: 'styles.css', change: 'created' },
  ],
  contentChars: 4200,
  verification: { status: 'passed', attempts: 1, corrections: 0, issuesFound: 0 },
  execution: { status: 'ok', exitCode: 0, timedOut: false, durationMs: 800 },
}

describe('code-build verifier', () => {
  test('verified when changes + self-verification + sandbox pass exist', () => {
    const v = verifyCodeBuild(PASSING_CODE, { requireSelfVerification: true, requireSandboxPass: true, minFileChanges: 1 })
    expect(v.status).toBe('verified')
    expect(v.artifacts[0]?.artifact).toBe('code-project')
    expect(v.artifacts[0]?.ref).toBe('proj1')
  })

  test('failed sandbox = needs_correction, never success', () => {
    const bad: CodingJobPayload = { ...PASSING_CODE, execution: { status: 'error', exitCode: 1, timedOut: false, durationMs: 120 } }
    const v = verifyCodeBuild(bad, { requireSandboxPass: true })
    expect(v.status).toBe('needs_correction')
    expect(v.reasons.join(' ')).toContain('exited with code 1')
  })

  test('missing verification evidence = needs_correction (unproven change)', () => {
    const v = verifyCodeBuild({ projectId: 'p', changes: [{ path: 'a.js', change: 'created' }] }, { requireSelfVerification: true })
    expect(v.status).toBe('needs_correction')
    expect(v.reasons[0]).toContain('self-verification')
  })

  test('no payload at all = failed', () => {
    expect(verifyCodeBuild(null, {}).status).toBe('failed')
  })

  test('sandbox that never ran is surfaced, not forgiven', () => {
    const v = verifyCodeBuild({ projectId: 'p', changes: [{ path: 'a.js', change: 'created' }], executionUnavailable: 'sandbox unavailable' }, { requireSandboxPass: true })
    expect(v.status).toBe('needs_correction')
    expect(v.reasons.join(' ')).toContain('sandbox')
  })
})

describe('document-draft verifier', () => {
  const criteria = { requireSelfVerification: true, minFileChanges: 1, requireSourceCitation: true, deliverablePath: 'report.md' }

  test('verified when the deliverable path is among the real changes', () => {
    const payload: CodingJobPayload = {
      ...PASSING_CODE,
      changes: [{ path: 'report.md', change: 'created' }],
    }
    const v = verifyDocumentDraft(payload, criteria, 3)
    expect(v.status).toBe('verified')
  })

  test('missing deliverable path is caught deterministically', () => {
    const v = verifyDocumentDraft(PASSING_CODE, criteria, 3)
    expect(v.status).toBe('needs_correction')
    expect(v.reasons.join(' ')).toContain('report.md')
  })

  test('thin deliverables cannot carry their sources', () => {
    const payload: CodingJobPayload = {
      projectId: 'p',
      changes: [{ path: 'report.md', change: 'created' }],
      contentChars: 120,
      verification: { status: 'passed' },
    }
    const v = verifyDocumentDraft(payload, criteria, 3)
    expect(v.status).toBe('needs_correction')
    expect(v.reasons.join(' ')).toContain('120 characters')
  })

  test('without handed-off sources the citation contract is not applied', () => {
    const payload: CodingJobPayload = {
      projectId: 'p',
      changes: [{ path: 'notes.md', change: 'created' }],
      contentChars: 150,
      verification: { status: 'passed' },
    }
    const v = verifyDocumentDraft(payload, { deliverablePath: 'notes.md' }, 0)
    expect(v.status).toBe('verified')
  })
})

describe('media verifiers (real worker payload shapes)', () => {
  const criteria = { requireArtifact: true }

  test('image verified from the real imageUrl payload', () => {
    const p: ImageJobPayload = { imageUrl: '/api/laxii/images/j1', width: 1024, height: 1024, format: 'png', bytes: 500000 }
    const v = verifyImageAsset(p, criteria)
    expect(v.status).toBe('verified')
    expect(v.artifacts[0]?.artifact).toBe('image-asset')
  })

  test('image with no artifact URL = failed', () => {
    expect(verifyImageAsset({ width: 1024, height: 1024 }, criteria).status).toBe('failed')
    expect(verifyImageAsset(null, criteria).status).toBe('failed')
  })

  test('video verified only WITH ffprobe stream facts (the worker completion gate)', () => {
    const good: VideoJobPayload = { videoUrl: '/api/jazmii/video/j2', stream: { codec: 'h264', width: 1280, height: 720, durationSec: 5.2 } }
    expect(verifyVideoAsset(good, criteria).status).toBe('verified')
    const unproven: VideoJobPayload = { videoUrl: '/api/jazmii/video/j2' }
    const v = verifyVideoAsset(unproven, criteria)
    expect(v.status).toBe('needs_correction')
    expect(v.reasons[0]).toContain('ffprobe')
  })

  test('audio requires the validated-WAV contract', () => {
    const good: AudioJobPayload = { artifactUrl: '/api/gangzii/audio/j3', format: 'wav', bytes: 184844 }
    expect(verifyAudioAsset(good, { requireArtifact: true, requireAudioValidation: true }).status).toBe('verified')
    const wrongFormat: AudioJobPayload = { artifactUrl: '/x', format: 'mp3', bytes: 1000 }
    expect(verifyAudioAsset(wrongFormat, { requireAudioValidation: true }).status).toBe('needs_correction')
    const empty: AudioJobPayload = { artifactUrl: '/x', format: 'wav', bytes: 44 }
    expect(verifyAudioAsset(empty, criteria).status).toBe('failed')
    expect(verifyAudioAsset(null, criteria).status).toBe('failed')
  })
})

describe('research verifier', () => {
  test('min sources enforced against REAL http(s) sources only', () => {
    const good: ResearchPayload = {
      sources: [
        { url: 'https://a.example/1', title: 'A', snippet: 'x' },
        { url: 'https://b.example/2', title: 'B', snippet: 'y' },
        { url: 'https://c.example/3', title: 'C', snippet: 'z' },
      ],
      queries: ['remote work productivity'],
    }
    expect(verifyResearch(good, { minSources: 3 }).status).toBe('verified')
    const thin: ResearchPayload = { sources: [{ url: 'https://a.example/1', title: 'A', snippet: 'x' }], queries: ['q'] }
    const v = verifyResearch(thin, { minSources: 3 })
    expect(v.status).toBe('needs_correction')
    expect(v.reasons[0]).toContain('1 real source')
  })

  test('degraded retrieval is carried into the reason (honest unavailability)', () => {
    const v = verifyResearch({ sources: [], queries: ['q'], degraded: ['upstream search unavailable'] }, { minSources: 3 })
    expect(v.status).toBe('needs_correction')
    expect(v.reasons[0]).toContain('upstream search unavailable')
  })
})

describe('aggregate deliverable gate', () => {
  test('fails when any input is unverified', () => {
    const v = verifyDeliverable([
      { taskId: 'build', kind: 'code-build', verified: true, artifactCount: 1, summary: 'ok' },
      { taskId: 'asset-image', kind: 'image-asset', verified: false, artifactCount: 0, summary: 'no artifact' },
    ])
    expect(v.status).toBe('failed')
    expect(v.reasons[0]).toContain('asset-image')
  })

  test('fails when nothing real was produced (no fake delivery)', () => {
    const v = verifyDeliverable([{ taskId: 'a', kind: 'research', verified: true, artifactCount: 0, summary: 'ok' }])
    expect(v.status).toBe('failed')
    expect(v.reasons[0]).toContain('no real artifacts')
  })

  test('verified with real artifact totals', () => {
    const v = verifyDeliverable([
      { taskId: 'build', kind: 'code-build', verified: true, artifactCount: 1, summary: 'ok' },
      { taskId: 'asset-audio', kind: 'audio-asset', verified: true, artifactCount: 2, summary: 'ok' },
    ])
    expect(v.status).toBe('verified')
    expect(v.reasons[0]).toContain('3 real artifact')
  })
})

describe('kind dispatch', () => {
  test('verifyTaskOutput routes to the right verifier', () => {
    const code = verifyTaskOutput('code-build', {}, PASSING_CODE)
    expect(code.status).toBe('verified')
    const bareGate = verifyTaskOutput('verify-deliverable', {}, null)
    expect(bareGate.status).toBe('failed') // aggregation happens in the executor
  })
})
