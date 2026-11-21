/**
 * JAZMII AUTO DIRECTOR — Creative Director planner tests.
 *
 * Pinned behavior (spec §6):
 *  - the planner uses the SHARED guarded chat completion (breaker-aware) —
 *    the model's output is only a PROPOSAL until the storyboard schema
 *    passes;
 *  - malformed proposals are retried with the REAL validation issues
 *    appended (bounded), then fail honestly — no template is silently
 *    substituted;
 *  - upstream throttle/auth/billing errors propagate unchanged (never
 *    retried into a throttle).
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { UpstreamRateLimitError } from '../../src/lib/upstream/gateway'

let chatResponses: Array<(() => unknown) | { throw?: unknown }> = []
let chatCalls = 0
let lastUserMessage = ''

mock.module('@/lib/adapters/hosted-llm', () => ({
  guardedChatCompletion: async (body: { messages: Array<{ role: string; content: string }> }) => {
    chatCalls += 1
    const user = body.messages.find((m) => m.role === 'user')
    lastUserMessage = user?.content ?? ''
    const next = chatResponses.shift()
    if (!next) throw new Error('test scripted no response')
    if ('throw' in next && next.throw) throw next.throw
    const fn = next as () => unknown
    return fn()
  },
}))

const { generateStoryboard, StoryboardPlannerError } = await import('../../src/lib/jazmii/director/planner')
const { directorRequestSchema } = await import('../../src/lib/jazmii/director/schema')

beforeEach(() => {
  chatResponses = []
  chatCalls = 0
  lastUserMessage = ''
})

const REQ = directorRequestSchema.parse({ prompt: 'Launch film for Aurora, a sunrise alarm clock', style: 'product-launch', durationSec: 10 })

function validStoryboardJson(): string {
  return JSON.stringify({
    title: 'Aurora Launch Film',
    objective: 'Make sunrise alarm clocks feel inevitable.',
    tone: 'product-launch',
    format: '9:16',
    width: 1080,
    height: 1920,
    fps: 30,
    durationSeconds: 10,
    visualDirection: 'Warm dawn light, deep blacks.',
    voiceover: false,
    scenes: [
      { id: 'scene-01', durationSeconds: 3, purpose: 'opening-hook', visualDescription: 'dark room, glowing dial', generationPrompt: 'Slow push-in on a glowing clock in a dark bedroom.', caption: 'Wake with the sun.', transitionOut: 'cut' },
      { id: 'scene-02', durationSeconds: 4, purpose: 'product-moment', visualDescription: 'hands adjust the dial', generationPrompt: 'Close-up of hands turning a brass dial as light blooms.', transitionOut: 'fade' },
      { id: 'scene-03', durationSeconds: 3, purpose: 'outro', visualDescription: 'full sunrise floods the room', generationPrompt: 'A bedroom flooded with golden sunrise light.', transitionOut: 'cut' },
    ],
  })
}

describe('planner — schema-validated storyboard generation', () => {
  test('a valid first proposal passes with zero retries', async () => {
    chatResponses = [() => ({ choices: [{ message: { content: validStoryboardJson() } }] })]
    const result = await generateStoryboard(REQ)
    expect(result.storyboard.scenes.length).toBe(3)
    expect(result.meta.attempts).toBe(1)
    expect(result.meta.degraded).toHaveLength(0)
    // The user prompt carries the verbatim request and the fixed bounds.
    expect(lastUserMessage).toContain('Launch film for Aurora')
    expect(lastUserMessage).toContain('durationSeconds: 10')
  })

  test('a fenced/prose-wrapped JSON proposal is still parsed', async () => {
    chatResponses = [() => ({ choices: [{ message: { content: 'Here is my plan:\n```json\n' + validStoryboardJson() + '\n```' } }] })]
    const result = await generateStoryboard(REQ)
    expect(result.ok ?? true).toBe(true)
    expect(result.storyboard.title).toBe('Aurora Launch Film')
  })

  test('an invalid proposal is retried with the REAL schema issues appended', async () => {
    // First attempt: duration accounting broken (scenes sum 10, declared 12).
    const bad = JSON.parse(validStoryboardJson())
    bad.durationSeconds = 12
    chatResponses = [
      () => ({ choices: [{ message: { content: JSON.stringify(bad) } }] }),
      () => ({ choices: [{ message: { content: validStoryboardJson() } }] }),
    ]
    const result = await generateStoryboard(REQ)
    expect(result.meta.attempts).toBe(2)
    expect(result.meta.degraded.length).toBe(1)
    expect(lastUserMessage).toContain('rejected by schema validation')
    expect(lastUserMessage).toContain('must match exactly')
  })

  test('three invalid attempts fail honestly with the real issues — no silent template', async () => {
    chatResponses = [
      () => ({ choices: [{ message: { content: 'not json at all' } }] }),
      () => ({ choices: [{ message: { content: '{}' } }] }),
      () => ({ choices: [{ message: { content: '{"title": "x"}' } }] }),
    ]
    let caught: unknown = null
    try {
      await generateStoryboard(REQ)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(StoryboardPlannerError)
    expect((caught as Error).message).toContain('could not produce a valid storyboard')
    expect(chatCalls).toBe(3)
  })

  test('an upstream 429 propagates unchanged (never retried into a throttle)', async () => {
    chatResponses = [{ throw: new UpstreamRateLimitError('chat', 'chat completion is rate-limited upstream (HTTP 429): throttled') }]
    let caught: unknown = null
    try {
      await generateStoryboard(REQ)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(UpstreamRateLimitError)
    expect(chatCalls).toBe(1)
  })
})
