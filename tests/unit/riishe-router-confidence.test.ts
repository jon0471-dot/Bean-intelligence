/**
 * BEAN Intelligence — unit tests for the confidence-bearing intelligence
 * router and the capability planner wiring (Phase 2).
 * Run: bun test tests/unit/riishe-router-confidence.test.ts
 *
 * Pins:
 *   - classifyTaskDetailed decides EXACTLY like classifyTask (parity), and
 *     additionally reports confidence + named signals.
 *   - planCapabilities narrows run_code to turns where execution genuinely
 *     helps (the real approval gate) and grants analyze_image iff an image
 *     document is attached.
 *   - selectTools offers analyze_image only for image turns.
 */
import { describe, test, expect } from 'bun:test'
import { classifyTask, classifyTaskDetailed } from '../../src/lib/riishe/classify'
import { planCapabilities } from '../../src/lib/riishe/capability-plan'
import { selectTools } from '../../src/lib/riishe/orchestrator'

const TASKS = ['general', 'math', 'coding', 'research', 'document'] as const
type Task = (typeof TASKS)[number]

const SAMPLES: Array<[string, Task]> = [
  ['What is the latest version of Next.js?', 'research'],
  ['Calculate 17*23', 'math'],
  ['Write a python function that sorts a list', 'coding'],
  ['Sounds great, thank you!!', 'general'],
]

describe('classifyTaskDetailed parity with classifyTask', () => {
  for (const [message, expected] of SAMPLES) {
    test(`"${message.slice(0, 32)}…" → ${expected} in both APIs`, () => {
      const plain = classifyTask(message)
      const detailed = classifyTaskDetailed(message)
      expect(plain.task).toBe(expected)
      expect(detailed.task).toBe(expected)
      expect(detailed.thinkingEnabled).toBe(plain.thinkingEnabled)
      expect(detailed.verifyMath).toBe(plain.verifyMath)
      expect(detailed.requireCitations).toBe(plain.requireCitations)
    })
  }

  test('confidence bands and signals are reported', () => {
    const fresh = classifyTaskDetailed('What is the latest version of Next.js?')
    expect(fresh.confidence).toBeGreaterThanOrEqual(0.85)
    expect(fresh.signals.some((s) => s.family === 'freshness')).toBe(true)

    const code = classifyTaskDetailed('Write a python function that sorts a list')
    expect(code.confidence).toBeGreaterThanOrEqual(0.7)
    expect(code.signals.some((s) => s.family === 'code')).toBe(true)

    const weak = classifyTaskDetailed('Who won the match yesterday evening in the second half?')
    if (weak.task === 'research') expect(weak.confidence).toBeLessThan(0.85)

    const general = classifyTaskDetailed('thanks!')
    expect(general.task).toBe('general')
    expect(general.confidence).toBeGreaterThan(0)
    expect(general.confidence).toBeLessThanOrEqual(1)
  })
})

describe('planCapabilities — the real approval gate', () => {
  test('plain math does NOT grant code execution (planner narrows the permission)', () => {
    const plan = planCapabilities('Calculate 17*23', 'math', false)
    expect(plan.codeExecution).toBe(false)
  })

  test('explicit execution requests grant run_code', () => {
    expect(planCapabilities('run this code and show the output', 'coding', false).codeExecution).toBe(true)
    expect(planCapabilities('simulate a monte carlo estimate', 'math', false).codeExecution).toBe(true)
  })

  test('heavy computation grants sandbox verification', () => {
    expect(planCapabilities('compute 250! mod 1000003', 'math', false).codeExecution).toBe(true)
  })

  test('image analysis is granted exactly when an image document is attached', () => {
    expect(planCapabilities('what does this show', 'document', true, ['image']).imageAnalysis).toBe(true)
    expect(planCapabilities('summarize this', 'document', true, ['pdf']).imageAnalysis).toBe(false)
    expect(planCapabilities('hello', 'general', false, []).imageAnalysis).toBe(false)
  })
})

describe('selectTools — analyze_image only for image turns', () => {
  test('no tools without need', () => {
    expect(selectTools({ searchNeeded: false, task: 'general', hasDocuments: false, allowCodeExecution: false, researchFailed: false })).toEqual([])
  })

  test('image documents add analyze_image (and read_document)', () => {
    const tools = selectTools({
      searchNeeded: false,
      task: 'document',
      hasDocuments: true,
      allowCodeExecution: false,
      researchFailed: false,
      hasImageDocuments: true,
    })
    expect(tools).toContain('analyze_image')
    expect(tools).toContain('read_document')
  })

  test('non-image documents never offer analyze_image', () => {
    const tools = selectTools({
      searchNeeded: false,
      task: 'document',
      hasDocuments: true,
      allowCodeExecution: false,
      researchFailed: false,
      hasImageDocuments: false,
    })
    expect(tools).not.toContain('analyze_image')
  })

  test('run_code requires BOTH the permission key and the planner grant (composition)', () => {
    // The orchestrator composes: planCapabilities narrows the route-held
    // permission FIRST, selectTools then honors the narrowed flag.
    const base = { searchNeeded: false, task: 'coding' as Task, hasDocuments: false, researchFailed: false }
    // Plain coding question: planner refuses → no run_code even though the
    // route holds the permission key.
    const plainNarrowed = planCapabilities('write a function that sorts a list', 'coding', false)
    expect(selectTools({ ...base, allowCodeExecution: plainNarrowed.codeExecution })).not.toContain('run_code')
    // Explicit execution request: planner grants → run_code offered.
    const explicit = planCapabilities('run this code and show the output', 'coding', false)
    expect(selectTools({ ...base, allowCodeExecution: explicit.codeExecution })).toContain('run_code')
    // Without the permission key at all, the planner grant alone is not enough.
    expect(selectTools({ ...base, allowCodeExecution: false })).not.toContain('run_code')
  })
})
