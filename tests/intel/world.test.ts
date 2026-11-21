/**
 * BEAN Intelligence — unit tests for the world grounding engine
 * (work order Part 3/4/11: ontology activation, scene analysis, motion
 * timelines, grounded compilation, honest failure).
 * Run: bun test tests/intel/
 */
import { describe, test, expect } from 'bun:test'
import { analyzeScene, needsEntityFacts } from '../../src/lib/intel/world/analyze'
import { buildMotionTimeline, serializeTimeline } from '../../src/lib/intel/world/motion'
import { compileGroundedImagePrompt, compileGroundedVideoPrompt } from '../../src/lib/intel/world/compile'
import { activatedModules, WORLD_MODULES } from '../../src/lib/intel/world/ontology'

describe('ontology activation (multilingual)', () => {
  test('all six modules exist with facts, constraints and negatives', () => {
    expect(WORLD_MODULES.map((m) => m.id as string).sort()).toEqual(
      ['animal', 'human', 'materials', 'nature', 'physics', 'spatial'].sort(),
    )
    for (const m of WORLD_MODULES) {
      expect(m.facts.length).toBeGreaterThanOrEqual(6)
      expect(m.constraints.length).toBeGreaterThanOrEqual(3)
      expect(m.negatives.length).toBeGreaterThanOrEqual(3)
      expect(m.triggers.length).toBeGreaterThanOrEqual(5)
    }
  })

  test('bird flight activates the animal module in English', () => {
    const hits = activatedModules('an eagle flying over the mountains')
    expect(hits.has('animal')).toBe(true)
  })

  test('bird flight activates in Tamil, Hindi and Chinese', () => {
    expect(activatedModules('கழுகு பறக்கிறது').has('animal')).toBe(true)
    expect(activatedModules('चील आसमान में उड़ रही है').has('animal')).toBe(true)
    expect(activatedModules('老鹰在天上飞').has('animal')).toBe(true)
  })

  test('water/fire/wind activate nature in English and Tamil', () => {
    expect(activatedModules('waves crashing on the shore').has('nature')).toBe(true)
    expect(activatedModules('நெருப்பு மற்றும் புகை').has('nature')).toBe(true)
  })

  test('glass and wood activate materials', () => {
    expect(activatedModules('a glass window shattering').has('materials')).toBe(true)
    expect(activatedModules('wood breaking along the grain').has('materials')).toBe(true)
  })

  test('partial words do NOT falsely activate (cat vs category)', () => {
    const hits = activatedModules('a comprehensive category listing')
    expect(hits.has('animal')).toBe(false)
  })
})

describe('scene analysis', () => {
  test('human walking prompt produces a grounded plan', () => {
    const plan = analyzeScene('a woman walking in the rain on a city street at night, close-up')
    expect(plan.subjects.map((s) => s.class)).toContain('person')
    expect(plan.modules.map((m) => m.id)).toContain('human')
    expect(plan.modules.map((m) => m.id)).toContain('nature') // rain
    expect(plan.motionVerbs.some((v) => v.includes('legged locomotion'))).toBe(true)
    expect(plan.environment).toContain('urban')
    expect(plan.weather).toBe('rain')
    expect(plan.lighting).toMatch(/night/)
    expect(plan.cameraCues[0]).toMatch(/close-up/i)
    expect(plan.constraints.length).toBeGreaterThan(0)
    expect(plan.negativeConstraints.length).toBeGreaterThan(0)
    expect(plan.language.primary).toBe('en')
  })

  test('bird flight plan carries flight constraints and never the folded-wing negative silently', () => {
    const plan = analyzeScene('a peregrine falcon flying over a cliff at sunset')
    const subject = plan.subjects.find((s) => s.class === 'bird')
    expect(subject).toBeDefined()
    expect(subject!.namedEntity).toBe(true) // "Peregrine falcon" multiword species
    expect(needsEntityFacts(plan)).toBe(true)
    expect(plan.modules.map((m) => m.id)).toContain('animal')
    expect(plan.constraints.some((c) => c.toLowerCase().includes('wing'))).toBe(true)
    expect(plan.negativeConstraints.some((n) => n.includes('wings bending backwards'))).toBe(true)
    expect(plan.lighting).toMatch(/golden-hour/)
  })

  test('non-English prompt keeps original language and still grounds', () => {
    const plan = analyzeScene('ஒரு மனிதன் காட்டில் நடக்கிறான்')
    expect(plan.language.primary).toBe('ta')
    expect(plan.subjects.map((s) => s.class)).toContain('person')
    expect(plan.motionVerbs.some((v) => v.includes('legged locomotion'))).toBe(true)
  })

  test('empty prompt yields an honest low-confidence plan, not an invented scene', () => {
    const plan = analyzeScene('   ')
    expect(plan.subjects).toEqual([])
    expect(plan.confidence).toBeLessThanOrEqual(0.3)
    expect(plan.modules.map((m) => m.id)).toEqual(['spatial']) // always-on baseline
    expect(plan.notes.some((n) => n.toLowerCase().includes('no specific subject'))).toBe(true)
  })

  test('spatial module is always active for generation consistency', () => {
    const plan = analyzeScene('a red apple on a table')
    expect(plan.modules.map((m) => m.id)).toContain('spatial')
  })
})

describe('motion timeline', () => {
  test('bird flight timeline: takeoff -> flight beats -> landing, physics annotated', () => {
    const plan = analyzeScene('a peacock flying from a tree to the ground')
    const t = buildMotionTimeline(plan, 5)
    expect(t.beats.length).toBeGreaterThan(0)
    expect(t.beats[0].tStart).toBe(0)
    expect(t.beats[t.beats.length - 1].tEnd).toBe(1)
    const allPhysics = t.beats.flatMap((b) => b.physics)
    expect(allPhysics.some((p) => /downstroke|lift/i.test(p))).toBe(true)
    expect(t.cameraContinuity).toMatch(/camera/i)
    expect(t.startState.length).toBeGreaterThan(10)
    expect(t.endState.length).toBeGreaterThan(10)
    expect(t.note).toBeNull() // motion was requested — no honesty note needed
  })

  test('no-motion prompt gets an HONEST ambient timeline with a note', () => {
    const plan = analyzeScene('a still lake at dawn with mountains behind')
    const t = buildMotionTimeline(plan, 5)
    expect(t.note).toMatch(/no explicit motion/i)
    expect(t.beats[0].action).toMatch(/ambient|subtle/i)
  })

  test('timeline durations respect the 3..12s clamp', () => {
    const plan = analyzeScene('a man running across a field')
    const t = buildMotionTimeline(plan, 30)
    expect(t.cameraContinuity).toContain('12s')
  })

  test('serialized timeline is prompt-ready text in time order', () => {
    const plan = analyzeScene('water pouring from a jug into a glass')
    const s = serializeTimeline(buildMotionTimeline(plan, 5))
    expect(s).toMatch(/^Start:/)
    expect(s).toMatch(/End:/)
    expect(s.indexOf('Start:')).toBeLessThan(s.indexOf('End:'))
  })
})

describe('grounded compilation', () => {
  test('image prompt: user words preserved VERBATIM and lead the final prompt', () => {
    const userPrompt = 'a woman walking in the rain on a city street at night, close-up'
    const plan = analyzeScene(userPrompt)
    const compiled = compileGroundedImagePrompt(plan)
    expect(compiled.finalPrompt.startsWith(userPrompt)).toBe(true)
    expect(compiled.originalPrompt).toBe(userPrompt)
    expect(compiled.appliedConstraints.length).toBeGreaterThan(0)
    expect(compiled.finalPrompt).toContain('Physical grounding:')
    expect(compiled.plan.language).toBe('en')
  })

  test('constraint budget caps the appended grounding', () => {
    const plan = analyzeScene('an astronaut (a person) walking on glass shards near fire and water, metal bending, wood splintering, rubber stretching, falling into a river under gravity, jumping, spinning, bouncing')
    const compiled = compileGroundedImagePrompt(plan)
    // Constraint payload is bounded (700 chars + scaffolding)
    const appended = compiled.finalPrompt.length - compiled.originalPrompt.length
    expect(appended).toBeLessThan(1400)
  })

  test('video prompt folds the motion timeline and stays honest about generation', () => {
    const plan = analyzeScene('a cat jumping off a table')
    const compiled = compileGroundedVideoPrompt(plan, 8)
    expect(compiled.finalPrompt).toContain('Motion timeline:')
    // Jump physics: crouch -> launch -> landing (regression pin: a missing
    // beat template used to fall through to the ambient beat silently).
    expect(compiled.timeline.beats.length).toBe(3)
    expect(compiled.timeline.beats[0].action).toMatch(/crouch/i)
    expect(compiled.timeline.beats[1].physics.some((p) => /parabola/.test(p))).toBe(true)
    expect(compiled.timeline.beats[2].action).toMatch(/landing/i)
    expect(compiled.notes.some((n) => n.includes('video model'))).toBe(true)
    expect(compiled.originalPrompt).toBe('a cat jumping off a table')
  })

  test('retrieved evidence is labeled with its sources, never blended silently', () => {
    const plan = analyzeScene('the Eiffel Tower at sunset')
    const compiled = compileGroundedImagePrompt(plan, {
      facts: ['The Eiffel Tower is a wrought-iron lattice tower in Paris.'],
      sources: ['wikipedia.org'],
    })
    expect(compiled.finalPrompt).toContain('Reference facts (wikipedia.org)')
  })
})
