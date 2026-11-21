/**
 * JAZMII AUTO DIRECTOR — storyboard schema tests.
 *
 * Pinned behavior (spec §6):
 *  - the storyboard is a typed, schema-validated structure — malformed
 *    planner output is rejected BEFORE any generation job exists;
 *  - scene durations MUST sum exactly to the declared total;
 *  - scene bounds mirror the REAL backend limits (3..12 s per clip);
 *  - only transitions the composition engines actually render are allowed.
 */
import { describe, test, expect } from 'bun:test'
import {
  storyboardSchema,
  parseStoryboard,
  approvedPlanSchema,
  directorRequestSchema,
  SCENE_DURATION_MIN_SEC,
  SCENE_DURATION_MAX_SEC,
  PRODUCTION_DURATION_MAX_SEC,
} from '../../src/lib/jazmii/director/schema'

function validStoryboard() {
  return {
    title: 'Aurora Launch Film',
    objective: 'Make sunrise alarm clocks feel inevitable.',
    tone: 'product-launch' as const,
    format: '9:16' as const,
    width: 1080,
    height: 1920,
    fps: 30,
    durationSeconds: 10,
    visualDirection: 'Warm dawn light, deep blacks, single bold type moments.',
    voiceover: false,
    scenes: [
      {
        id: 'scene-01',
        durationSeconds: 3,
        purpose: 'opening-hook' as const,
        visualDescription: 'A black room; the clock face glows into dawn.',
        generationPrompt: 'Slow push-in on a glowing alarm clock in a dark bedroom, warm light rising.',
        caption: 'Wake with the sun.',
        transitionOut: 'cut' as const,
      },
      {
        id: 'scene-02',
        durationSeconds: 4,
        purpose: 'product-moment' as const,
        visualDescription: 'Hands adjust the dial; sunrise ramps up.',
        generationPrompt: 'Close-up of hands turning a brass dial as warm light blooms.',
        transitionOut: 'fade' as const,
      },
      {
        id: 'scene-03',
        durationSeconds: 3,
        purpose: 'outro' as const,
        visualDescription: 'Full sunrise floods the room.',
        generationPrompt: 'A bedroom flooded with golden sunrise light, curtains glowing.',
        transitionOut: 'cut' as const,
      },
    ],
  }
}

describe('storyboard schema — validation gate', () => {
  test('a valid storyboard passes and parses', () => {
    const parsed = parseStoryboard(validStoryboard())
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.storyboard.scenes.length).toBe(3)
      expect(parsed.storyboard.title).toBe('Aurora Launch Film')
    }
  })

  test('scene durations MUST sum exactly to durationSeconds', () => {
    const sb = validStoryboard()
    sb.durationSeconds = 11 // scenes still sum to 10
    const parsed = parseStoryboard(sb)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.issues.some((i) => i.includes('must match exactly'))).toBe(true)
    }
  })

  test('a scene below the backend minimum is rejected (real provider bounds)', () => {
    const sb = validStoryboard()
    sb.scenes[0].durationSeconds = SCENE_DURATION_MIN_SEC - 1
    expect(storyboardSchema.safeParse(sb).success).toBe(false)
  })

  test('a scene above the backend maximum is rejected (real provider bounds)', () => {
    const sb = validStoryboard()
    sb.scenes[1].durationSeconds = SCENE_DURATION_MAX_SEC + 1
    expect(storyboardSchema.safeParse(sb).success).toBe(false)
  })

  test('a transition no engine can render is rejected', () => {
    const sb = validStoryboard()
    ;(sb.scenes[0] as Record<string, unknown>).transitionOut = 'zoom-warp'
    expect(storyboardSchema.safeParse(sb).success).toBe(false)
  })

  test('duplicate scene ids are rejected', () => {
    const sb = validStoryboard()
    sb.scenes[2].id = 'scene-01'
    const parsed = parseStoryboard(sb)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.issues.some((i) => i.includes('Duplicate scene id'))).toBe(true)
  })

  test('four scenes stay valid when duration accounting holds (max bound pinned)', () => {
    const sb = validStoryboard()
    const extra = { ...sb.scenes[0], id: 'scene-09' }
    const parsed = parseStoryboard({ ...sb, durationSeconds: 13, scenes: [...sb.scenes, extra] })
    expect(parsed.ok).toBe(true)
    expect(PRODUCTION_DURATION_MAX_SEC).toBe(60)
  })

  test('prompt length bounds are enforced on the scene generation prompt', () => {
    const sb = validStoryboard()
    sb.scenes[0].generationPrompt = 'x'.repeat(601)
    expect(storyboardSchema.safeParse(sb).success).toBe(false)
  })
})

describe('approved plan + request schema', () => {
  test('an approved plan carries the storyboard and the engine preference', () => {
    const plan = {
      storyboard: validStoryboard(),
      approvedAt: new Date().toISOString(),
      approvedRev: 1,
      enginePreference: 'ffmpeg' as const,
      audioTracks: [],
      sceneLimitAck: true,
    }
    expect(approvedPlanSchema.safeParse(plan).success).toBe(true)
  })

  test('an approved plan with a malformed storyboard fails closed', () => {
    const plan = {
      storyboard: { ...validStoryboard(), durationSeconds: 99 },
      approvedAt: new Date().toISOString(),
      approvedRev: 1,
      enginePreference: 'auto' as const,
      audioTracks: [],
      sceneLimitAck: true,
    }
    expect(approvedPlanSchema.safeParse(plan).success).toBe(false)
  })

  test('director request defaults are honest (BRAG-preferred window)', () => {
    const parsed = directorRequestSchema.parse({ prompt: 'A launch film for our alarm clock' })
    expect(parsed.durationSec).toBe(20)
    expect(parsed.format).toBe('9:16')
    expect(parsed.engine).toBe('auto')
  })

  test('an oversized duration is rejected', () => {
    const parsed = directorRequestSchema.safeParse({ prompt: 'x', durationSec: PRODUCTION_DURATION_MAX_SEC + 1 })
    expect(parsed.success).toBe(false)
  })
})
