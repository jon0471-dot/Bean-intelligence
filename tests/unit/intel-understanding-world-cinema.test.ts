/**
 * BEAN Intelligence — understanding/world/cinema unit tests.
 * Pure, deterministic, no network.
 */
import { describe, test, expect } from 'bun:test'
import { understandPrompt, classifyIntent } from '../../src/lib/intel/understanding'
import { assembleWorldKnowledge, renderWorldKnowledgeBlock, MAX_WORLD_COMPONENTS } from '../../src/lib/intel/world'
import { extractCinematography, renderCinematographyBlock, renderContinuityDirectives } from '../../src/lib/intel/cinema'

// ---------------------------------------------------------------------------
// Understanding
// ---------------------------------------------------------------------------

describe('prompt understanding — intent classification', () => {
  test('LAXII lane defaults to generate-image even for a bare subject', () => {
    expect(classifyIntent('a red fox in snow', 'laxii')).toBe('generate-image')
  })

  test('JAZMII lane defaults to generate-video', () => {
    expect(classifyIntent('a crow taking off from a branch', 'jazmii')).toBe('generate-video')
  })

  test('RIISHE lane classifies questions as answer and greetings as smalltalk', () => {
    expect(classifyIntent('Who is the chief minister of Tamil Nadu?', 'riishe')).toBe('answer')
    expect(classifyIntent('hello!', 'riishe')).toBe('smalltalk')
  })

  test('edit intent detected for image-edit phrasing', () => {
    expect(classifyIntent('remove the background of my photo', 'laxii')).toBe('edit-image')
  })
})

describe('prompt understanding — domain taxonomy', () => {
  test('medical prompts route to the medicine domain with matched signals', () => {
    const u = understandPrompt('Explain the anatomy of the human knee for a medical student', 'riishe')
    expect(u.domains.some((d) => d.domain === 'medicine-healthcare')).toBe(true)
    expect(u.domains[0].matched.length).toBeGreaterThan(0)
  })

  test('multi-domain prompts rank all touched domains by signal count', () => {
    const u = understandPrompt('Design a car engine cooling system with a software control circuit', 'riishe')
    expect(u.domains.length).toBeGreaterThanOrEqual(2)
    expect(u.domains[0].score).toBeGreaterThanOrEqual(u.domains[u.domains.length - 1].score)
  })

  test('creative prompts classify no domain (honest empty)', () => {
    const u = understandPrompt('a beautiful abstract painting of feelings', 'laxii')
    expect(u.domains.length).toBe(0)
  })
})

describe('prompt understanding — entity extraction', () => {
  test('creatures, nature, materials and physics actions are collected', () => {
    const u = understandPrompt('a crow taking off from a wet branch, wings spreading, rain splashing on glass', 'jazmii')
    expect(u.creatures).toContain('crow')
    expect(u.nature).toContain('rain')
    expect(u.materials).toContain('glass')
    expect(u.physicsActions.length).toBeGreaterThan(0)
  })

  test('short generation prompts flag ambiguity honestly', () => {
    const u = understandPrompt('a cat', 'laxii')
    expect(u.ambiguous.some((a) => a.includes('underspecified'))).toBe(true)
  })

  test('classification is microsecond-fast (budget: well under 50ms per call)', () => {
    const u = understandPrompt('a bald eagle soaring over the Grand Canyon at golden hour with volumetric light', 'jazmii')
    expect(u.durationMs).toBeLessThan(50)
  })
})

// ---------------------------------------------------------------------------
// World knowledge
// ---------------------------------------------------------------------------

describe('world knowledge assembly', () => {
  test('crow prompt assembles bird-flight + crow components', () => {
    const u = understandPrompt('a crow taking off and flying over a field', 'jazmii')
    const keys = assembleWorldKnowledge(u).map((c) => c.key)
    expect(keys).toContain('bird-flight')
    expect(keys).toContain('crow')
  })

  test('walking human prompt assembles gait + proportions', () => {
    const u = understandPrompt('a person walking through a market', 'jazmii')
    const keys = assembleWorldKnowledge(u).map((c) => c.key)
    expect(keys).toContain('human-walk-run')
    expect(keys).toContain('human-proportions')
  })

  test('water/fire/material prompts assemble the right domains', () => {
    const u = understandPrompt('waterfall pouring into a river next to a burning campfire, smoke rising', 'laxii')
    const keys = assembleWorldKnowledge(u).map((c) => c.key)
    expect(keys).toContain('waterfall-river')
    expect(keys).toContain('fire-smoke')
  })

  test('assembly is bounded (never more than MAX_WORLD_COMPONENTS)', () => {
    const u = understandPrompt(
      'a person walking a dog past a burning car crash into a glass window while rain falls on the ocean waves and snow covers the wooden metal bridge, eagle flying overhead',
      'jazmii',
    )
    expect(assembleWorldKnowledge(u).length).toBeLessThanOrEqual(MAX_WORLD_COMPONENTS)
  })

  test('rendered block opens with the honest scope line and stays compact', () => {
    const u = understandPrompt('a crow flying in heavy rain', 'jazmii')
    const block = renderWorldKnowledgeBlock(assembleWorldKnowledge(u))
    expect(block).toContain('not a physics simulation')
    expect(block.length).toBeLessThan(4000)
  })

  test('empty selection renders empty (no fake guidance)', () => {
    const u = understandPrompt('abstract gradient artwork', 'laxii')
    expect(renderWorldKnowledgeBlock(assembleWorldKnowledge(u))).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Cinematography
// ---------------------------------------------------------------------------

describe('cinematography module', () => {
  test('explicit directives are extracted verbatim-first', () => {
    const d = extractCinematography('close-up of a watchmaker, shallow depth of field, golden hour lighting, teal and orange grade')
    expect(d.shotType).toBe('close-up')
    expect(d.lens).toBe('shallow depth of field with soft background bokeh')
    expect(d.lighting).toContain('golden-hour sunlight (warm, low sun, long shadows)')
    expect(d.color.join(' ')).toContain('complementary')
  })

  test('camera movement extraction covers dolly/pan/tracking', () => {
    expect(extractCinematography('slow dolly in on the subject').cameraMove).toContain('dolly in')
    expect(extractCinematography('tracking shot following the runner').cameraMove).toContain('tracking')
  })

  test('video conditioning fills a SAFE default camera move; image has none', () => {
    const d = extractCinematography('a lighthouse in a storm')
    const videoBlock = renderCinematographyBlock(d, 'jazmii')
    const imageBlock = renderCinematographyBlock(d, 'laxii')
    expect(videoBlock).toContain('static camera with a very subtle slow push-in')
    expect(imageBlock).not.toContain('push-in')
    expect(videoBlock).toContain('one coherent light direction')
  })

  test('user-explicit lighting wins over defaults (never overridden)', () => {
    const d = extractCinematography('a cabin in low-key lighting with volumetric light rays')
    const block = renderCinematographyBlock(d, 'laxii')
    expect(block).toContain('low-key')
    expect(block).toContain('volumetric')
    expect(block).not.toContain('natural directional key light')
  })

  test('continuity directives render the previous-shot state', () => {
    const block = renderContinuityDirectives({
      shotType: 'medium shot',
      lighting: ['golden-hour sunlight (warm, low sun, long shadows)'],
      color: ['warm white balance'],
    })
    expect(block).toContain('SHOT CONTINUITY')
    expect(block).toContain('medium shot')
    expect(block).toContain('identity, outfit, size and position')
  })
})
