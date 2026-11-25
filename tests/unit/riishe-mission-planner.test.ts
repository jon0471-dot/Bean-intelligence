/**
 * M41 Phase 1/3 — deterministic mission planner + cross-agent handoff.
 *
 * The four canonical workflows produce REAL, contract-complete task DAGs
 * routed to the real specialists; everything else is refused honestly.
 * Handoffs are bounded, sanitized, deterministic digests — never chat.
 */
import { describe, test, expect } from 'bun:test'

import { planMission } from '../../src/lib/riishe/mission/planner'
import {
  enrichObjective,
  assetHandoff,
  correctionHandoff,
  researchPackHandoff,
  safeSourceUrl,
} from '../../src/lib/riishe/mission/handoff'
import { validateTaskGraph } from '../../src/lib/riishe/mission/graph'
import { MISSION_LIMITS } from '../../src/lib/riishe/mission/types'

// ---------------------------------------------------------------------------
// Planner — canonical workflow A: website build
// ---------------------------------------------------------------------------

describe('planner: website-build', () => {
  const plan = planMission('Build a professional website for my coffee shop with a menu page and contact form')
  test('produces a valid build→verify DAG routed to CODE GIFTZ', () => {
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.missionType).toBe('website-build')
    expect(validateTaskGraph(plan.tasks).valid).toBe(true)
    expect(plan.deliverableTaskId).toBe('build')
    const kinds = plan.tasks.map((t) => t.kind)
    expect(kinds).toContain('code-build')
    expect(kinds).toContain('verify-deliverable')
    const build = plan.tasks.find((t) => t.kind === 'code-build')!
    expect(build.agent).toBe('code-giftz')
    expect(build.authScope).toBe('project-write')
    expect(build.objective).toContain('coffee shop')
    const verify = plan.tasks.find((t) => t.kind === 'verify-deliverable')!
    expect(verify.dependsOn).toContain('build')
  })

  test('a brand-asset request orders the visual asset BEFORE the build', () => {
    const plan = planMission('Build a website for my bakery with a logo for the brand')
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const image = plan.tasks.find((t) => t.kind === 'image-asset')
    expect(image).toBeDefined()
    const build = plan.tasks.find((t) => t.kind === 'code-build')!
    expect(build.dependsOn).toContain('asset-image')
    expect(image!.agent).toBe('laxii')
  })

  test('a project name is carried into the build task params', () => {
    const plan = planMission('Build a website called Aurora Labs with a pricing page')
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const build = plan.tasks.find((t) => t.kind === 'code-build')!
    expect(build.params.projectName).toBe('Aurora Labs')
  })
})

// ---------------------------------------------------------------------------
// Planner — workflow B: media production
// ---------------------------------------------------------------------------

describe('planner: media-production', () => {
  test('video + narration + visuals produce a parallel asset DAG with a video deliverable', () => {
    const plan = planMission(
      'Create a video about mountain hiking with narration saying: "Trailheads open at sunrise." and a poster for the cover',
    )
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.missionType).toBe('media-production')
    expect(validateTaskGraph(plan.tasks).valid).toBe(true)
    const video = plan.tasks.find((t) => t.kind === 'video-asset')!
    expect(video).toBeDefined()
    expect(video.agent).toBe('jazmii')
    expect(plan.deliverableTaskId).toBe('asset-video')
    const audio = plan.tasks.find((t) => t.kind === 'audio-asset')
    expect(audio).toBeDefined()
    expect(audio!.agent).toBe('gangzii')
    expect(audio!.params.text).toContain('Trailheads open at sunrise')
    const image = plan.tasks.find((t) => t.kind === 'image-asset')
    expect(image).toBeDefined()
    expect(image!.agent).toBe('laxii')
    const verify = plan.tasks.find((t) => t.kind === 'verify-deliverable')!
    expect(verify.dependsOn).toContain('asset-video')
  })

  test('plain narration without explicit spoken text does NOT fabricate audio', () => {
    const plan = planMission('Create a video about ocean waves with a voiceover')
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    // No explicit narration text → no audio task (the planner never invents spoken content)
    expect(plan.tasks.find((t) => t.kind === 'audio-asset')).toBeUndefined()
    expect(plan.tasks.length).toBeGreaterThanOrEqual(2)
  })

  test('a standalone video request is an honest single-domain refusal', () => {
    const plan = planMission('Create a video about space exploration')
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.reason.toLowerCase()).toContain('single-domain')
  })
})

// ---------------------------------------------------------------------------
// Planner — workflow C: research → document
// ---------------------------------------------------------------------------

describe('planner: research-document', () => {
  test('research feeds the document draft, which feeds the integrity gate', () => {
    const plan = planMission('Research the impact of remote work on productivity and write a report on the findings')
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.missionType).toBe('research-document')
    expect(validateTaskGraph(plan.tasks).valid).toBe(true)
    const research = plan.tasks.find((t) => t.kind === 'research')!
    expect(research.agent).toBe('knowledge')
    expect(research.verification.minSources).toBe(3)
    const doc = plan.tasks.find((t) => t.kind === 'document-draft')!
    expect(doc.dependsOn).toContain('research')
    expect(doc.params.deliverablePath).toBe('report.md')
    expect(doc.verification.requireSourceCitation).toBe(true)
    expect(plan.deliverableTaskId).toBe('document')
    const verify = plan.tasks.find((t) => t.kind === 'verify-deliverable')!
    expect(verify.dependsOn).toContain('document')
  })

  test('research WITHOUT a document deliverable is refused honestly', () => {
    const plan = planMission('Research the history of the打字机 and give me the facts')
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.reason.toLowerCase()).toContain('single-domain')
  })
})

// ---------------------------------------------------------------------------
// Planner — workflow D: debug
// ---------------------------------------------------------------------------

describe('planner: debug-app', () => {
  test('debug objective requires sandbox proof', () => {
    const plan = planMission('Fix the checkout bug in my app — the total shows NaN after applying a coupon')
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.missionType).toBe('debug-app')
    const build = plan.tasks.find((t) => t.kind === 'code-build')!
    expect(build.objective.toLowerCase()).toContain('reproduce')
    expect(build.verification.requireSandboxPass).toBe(true)
    expect(build.verification.requireSelfVerification).toBe(true)
    const verify = plan.tasks.find((t) => t.kind === 'verify-deliverable')!
    expect(verify.dependsOn).toContain('build')
  })
})

// ---------------------------------------------------------------------------
// Planner — honest refusals
// ---------------------------------------------------------------------------

describe('planner: honest refusals', () => {
  test('questions never plan missions', () => {
    expect(planMission('How do I build a website and a video for my brand?').ok).toBe(false)
    expect(planMission('Explain what a research report is').ok).toBe(false)
  })

  test('short or oversize objectives are refused with exact reasons', () => {
    expect(planMission('too short').ok).toBe(false)
    const long = 'build a website ' + 'x'.repeat(MISSION_LIMITS.objectiveChars)
    expect(planMission(long).ok).toBe(false)
  })

  test('unrelated objectives are refused with guidance', () => {
    const plan = planMission('Plan my team offsite agenda for three days in Lisbon')
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.reason).toContain('multi-part execution objective')
  })
})

// ---------------------------------------------------------------------------
// Handoff contracts
// ---------------------------------------------------------------------------

describe('handoff digests', () => {
  const sources = [
    { url: 'https://example.com/a?token=SECRET123', title: 'Study A', snippet: 'Remote work raised output 13%.' },
    { url: 'https://example.com/b', title: 'Study B', snippet: 'Hybrid teams report higher satisfaction.' },
    { url: 'not-a-url', title: 'Broken', snippet: 'x' },
  ]

  test('research pack is sanitized (query strings stripped), bounded and deterministic', () => {
    const artifacts = sources.map((s, i) => ({ artifact: 'research-pack' as const, taskId: 'research', ref: s.url, label: s.title }))
    const block = researchPackHandoff(artifacts, sources)
    expect(block.sourceCount).toBe(2) // the non-URL is excluded
    expect(block.text).not.toContain('SECRET123')
    expect(block.text).toContain('https://example.com/a')
    expect(block.text).toContain('[1] Study A')
    const again = researchPackHandoff(artifacts, sources)
    expect(block.text).toBe(again.text) // deterministic
    expect(block.text.length).toBeLessThanOrEqual(4000)
  })

  test('asset handoff names the real artifacts', () => {
    const artifacts = [
      { artifact: 'image-asset' as const, taskId: 'asset-image', ref: 'asset-1', label: '1024x1024 poster' },
      { artifact: 'audio-asset' as const, taskId: 'asset-audio', ref: '/api/gangzii/audio/9', label: 'wav 184844 bytes' },
    ]
    const block = assetHandoff(artifacts)
    expect(block.text).toContain('image-asset')
    expect(block.text).toContain('audio-asset')
    expect(block.sourceCount).toBe(0)
  })

  test('empty inputs produce empty handoffs (nothing is invented)', () => {
    expect(researchPackHandoff([], []).text).toBe('')
    expect(assetHandoff([]).text).toBe('')
    expect(correctionHandoff([]).text).toBe('')
  })

  test('correction handoff carries the concrete verification failures', () => {
    const block = correctionHandoff(['Sandbox run exited with code 1.', 'The deliverable file "report.md" is missing.'])
    expect(block.text).toContain('CORRECTION ROUND')
    expect(block.text).toContain('with code 1')
  })

  test('enrichObjective appends handoff text and stays bounded', () => {
    const base = 'Write the report on remote work.'
    const block = { text: '\nVERIFIED RESEARCH SOURCES:\n[1] Study A — https://example.com/a', sourceCount: 1 }
    const enriched = enrichObjective(base, [block])
    expect(enriched.startsWith(base)).toBe(true)
    expect(enriched).toContain('https://example.com/a')
    const huge = { text: '\n' + 'y'.repeat(9000), sourceCount: 0 }
    expect(enrichObjective(base, [huge]).length).toBeLessThanOrEqual(8001)
  })

  test('safeSourceUrl strips query and hash but keeps the path', () => {
    expect(safeSourceUrl('https://example.com/p/page?utm=x&q=1#frag')).toBe('https://example.com/p/page')
    expect(safeSourceUrl('::::')).toBe('')
  })
})
