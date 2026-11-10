/**
 * LAXII IMAGE QUALITY (2026-11-10, Part B) — unit tests for the new
 * intelligence modules. All pure/deterministic (no network, no model calls):
 *  - scene-spec compilation (structured scene specification, Part B §1)
 *  - subject-count extraction and conflict-avoidance (resolutions/years are
 *    not subjects)
 *  - world-knowledge assembly for the new species/optics components
 *    (big-cat anatomy for the tiger benchmark, transparency refraction)
 *  - the bounded targeted-correction decision (serious-defect filter +
 *    correction prompt construction, Part B §5)
 */
import { describe, test, expect } from 'bun:test'

const { understandPrompt } = await import('../../src/lib/intel/understanding')
const { compileSceneSpecification } = await import('../../src/lib/intel/scene-spec')
const { assembleWorldKnowledge } = await import('../../src/lib/intel/world')
const { compileConditioning } = await import('../../src/lib/intel/grounding')
const { seriousAnatomyDefects, buildCorrectionPrompt } = await import(
  '../../src/lib/jobs/image-worker'
)

describe('scene specification (Part B §1)', () => {
  test('subject count: number words and digits next to subjects are detected', () => {
    expect(understandPrompt('two women walking in the rain at night', 'laxii').subjectCount).toBe(2)
    expect(understandPrompt('3 birds flying over the lake', 'laxii').subjectCount).toBe(3)
    expect(understandPrompt('a pair of eagles on a cliff', 'laxii').subjectCount).toBe(2)
    expect(understandPrompt('a majestic tiger in the jungle', 'laxii').subjectCount).toBe(1)
  })

  test('resolutions, years and phone-number-like digits are NOT subject counts', () => {
    // "a portrait" IS one subject; the digits below must not inflate the count.
    expect(understandPrompt('a portrait, 4k resolution, sharp focus, 2026 style', 'laxii').subjectCount).toBe(1)
    // No article and no number word before the subject → unstated, and bare
    // digits that are settings (f/2.8) never become counts.
    expect(understandPrompt('golden retriever puppy in the grass, f/2.8 bokeh', 'laxii').subjectCount).toBeNull()
    expect(understandPrompt('portrait in modern style, 4k, sharp, 2026', 'laxii').subjectCount).toBeNull()
  })

  test('an unstated count stays null (no silent guessing)', () => {
    expect(understandPrompt('a rainy street at night with reflections', 'laxii').subjectCount).toBeNull()
    expect(understandPrompt('a rainy street at night with reflections', 'laxii').subjects).toEqual([])
  })

  test('lighting direction and environment cues are extracted with their physics', () => {
    const u = understandPrompt('backlit portrait of a woman at the beach during golden hour', 'laxii')
    // First matching cue wins (backlight is stated, golden hour also present).
    expect(u.lightingDirection).toContain('backlight')
    expect(u.environment).toContain('outdoor')

    const night = understandPrompt('a man walking through rain at night under neon signs', 'laxii')
    expect(night.environment).toContain('night scene')
    expect(night.environment).toContain('wet weather') // find() returns first match only
  })

  test('the compiled scene spec covers subjects, anatomy, light direction, contact and materials', () => {
    const u = understandPrompt('two women sitting on a wooden bench holding glass cups of tea in a garden', 'laxii')
    const spec = compileSceneSpecification(u, { shotType: null, cameraMove: null, lens: null, lighting: [], color: [], composition: [], perspective: [] })
    expect(spec.block).toContain('SCENE SPECIFICATION')
    expect(spec.block).toContain('Subjects (2)')
    expect(spec.block).toContain('exactly two arms, two legs and five digits per hand')
    expect(spec.block).toContain('weight visibly') // sitting → contact points
    expect(spec.block).toContain('hands CLOSE around what they hold')
    expect(spec.block).toContain('Glass: transparent')
    expect(spec.block).toContain('Wood: grain runs consistently')
    expect(spec.block).toContain('explicit user directives above always win')
    expect(spec.fields.subjectCount).toBe(2)
  })

  test('an explicit user shot/lighting directive is NOT overridden by defaults', () => {
    const u = understandPrompt('a macro shot of a dew-covered leaf with shallow depth of field at golden hour', 'laxii')
    const spec = compileSceneSpecification(u, { shotType: 'macro lens (extreme small-subject detail)', cameraMove: null, lens: 'shallow depth of field with soft background bokeh', lighting: [], color: [], composition: [], perspective: [] })
    // Camera default must NOT appear (user set the shot); light direction IS
    // stated (golden hour), so no default light line either.
    expect(spec.block).not.toContain('Camera position: eye-level')
    expect(spec.block).toContain('Light direction:')
    expect(spec.block).toContain('low warm light from the horizon')
  })

  test('the scene spec block is bounded (fits the conditioning budget with room to spare)', () => {
    const u = understandPrompt('an eagle in mid-flight over a canyon at sunset, talons extended, wings fully spread', 'laxii')
    const block = compileSceneSpecification(u, { shotType: null, cameraMove: null, lens: null, lighting: [], color: [], composition: [], perspective: [] }).block
    expect(block.length).toBeLessThan(2200) // CONDITIONING_BUDGET.laxii
  })
})

describe('world knowledge: new species + optics components (benchmark coverage)', () => {
  test('the Bengal tiger prompt assembles the big-cat anatomy component', () => {
    const u = understandPrompt('A Bengal tiger walking through tall grass, natural wildlife photography', 'laxii')
    const keys = assembleWorldKnowledge(u).map((c) => c.key)
    expect(keys).toContain('big-cat-tiger')
    const tiger = assembleWorldKnowledge(u).find((c) => c.key === 'big-cat-tiger')!
    expect(tiger.facts.join(' ')).toContain('digitigrade')
    expect(tiger.defectsToAvoid.join(' ')).toContain('reversed front knees')
  })

  test('glass/refraction prompts assemble the transparency-optics component', () => {
    const u = understandPrompt('water pouring into a transparent glass on a marble counter', 'laxii')
    const keys = assembleWorldKnowledge(u).map((c) => c.key)
    expect(keys).toContain('transparency-optics')
    expect(keys).toContain('liquid-pour')
    const optics = assembleWorldKnowledge(u).find((c) => c.key === 'transparency-optics')!
    expect(optics.facts.join(' ')).toContain('refraction')
    expect(optics.defectsToAvoid.join(' ')).toContain('shadows as dark as an opaque object')
  })

  test('the conditioned prompt stays verbatim-first with the scene spec appended (laxii only)', async () => {
    const prompt = 'A Bengal tiger walking through tall grass, natural wildlife photography'
    // Retrieval seam: an empty result keeps the test hermetic (honest degrade).
    const { setGroundingSearchForTests } = await import('../../src/lib/intel/grounding')
    setGroundingSearchForTests(async () => [])
    const grounded = await (await import('../../src/lib/intel/grounding')).prepareImageIntelligence(prompt)
    expect(grounded.conditionedPrompt.startsWith(prompt)).toBe(true)
    expect(grounded.conditionedPrompt).toContain('SCENE SPECIFICATION')
    expect(grounded.conditionedPrompt).toContain('big cats')
    expect(grounded.conditionedPrompt).not.toContain('FIDELITY NOTES') // empty retrieval → no fabricated sources
    expect(grounded.sceneSpec).toBeTruthy()
    // JAZMII must NOT receive the image-scene spec (video keeps its timeline).
    const video = await (await import('../../src/lib/intel/grounding')).prepareVideoIntelligence(prompt)
    expect(video.conditionedPrompt.startsWith(prompt)).toBe(true)
    expect(video.conditionedPrompt).not.toContain('SCENE SPECIFICATION')
    expect(video.conditionedPrompt).toContain('MOTION TIMELINE')
  })
})

describe('bounded targeted correction (Part B §5)', () => {
  test('serious anatomy/persistence defects are detected; lighting nuances are not', () => {
    const defects = [
      'human anatomy errors (extra fingers on the left hand)',
      'the subject count is wrong: two women requested but three rendered',
      'object persistence error: the glass bowl appears fully intact and unsupported/floating, yet shards are already scattered',
      'shadows fall slightly softer than the key light suggests',
      'the tiger has reversed front knees',
    ]
    const serious = seriousAnatomyDefects(defects)
    expect(serious).toHaveLength(4)
    expect(serious.some((d) => d.includes('extra fingers'))).toBe(true)
    expect(serious.some((d) => d.includes('subject count'))).toBe(true)
    expect(serious.some((d) => d.includes('unsupported/floating'))).toBe(true)
    expect(serious.some((d) => d.includes('reversed front knees'))).toBe(true)
    expect(serious.some((d) => d.includes('shadows fall slightly softer'))).toBe(false)
  })

  test('the correction prompt targets ONLY the defects and preserves everything else', () => {
    const p = buildCorrectionPrompt(['extra fingers on the left hand'])
    expect(p).toContain('fix ONLY these observed defects')
    expect(p).toContain('extra fingers on the left hand')
    expect(p).toContain('same composition')
    expect(p).toContain('Do not add or remove any other element')
  })

  test('an empty or clean defect list never triggers a correction', () => {
    expect(seriousAnatomyDefects([])).toEqual([])
    expect(seriousAnatomyDefects(['gentle golden rim light'])).toEqual([])
  })
})
