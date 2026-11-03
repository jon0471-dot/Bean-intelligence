/**
 * BEAN Intelligence — controlled continuation of length-capped answers.
 * Run: bun test tests/unit/riishe-continuation.test.ts
 *
 * Pins the continuation contract (2026-11-03 reliability work order §2):
 * when the provider cuts an answer at its output limit, the partial is
 * preserved, a bounded continuation pass resumes EXACTLY where it stopped
 * without repeating, and when the bound is reached the typed truncation
 * error propagates carrying everything produced — never a fake completion.
 * The solve pass is injected; no network, no model.
 */
import { describe, test, expect } from 'bun:test'
import {
  buildContinuationMessages,
  solveWithContinuation,
  CONTINUATION_INSTRUCTION,
  MAX_SOLVE_CONTINUATIONS,
} from '../../src/lib/riishe/continuation'
import { UpstreamTruncatedError } from '../../src/lib/adapters/hosted-llm'
import type { ChatTurn } from '@/lib/adapters/types'

const baseMessages: ChatTurn[] = [
  { role: 'assistant', content: 'system prompt' },
  { role: 'user', content: 'write a long essay' },
]

describe('continuation — normal completion needs no continuation', () => {
  test('a complete first pass returns its content with count 0', async () => {
    let calls = 0
    const outcome = await solveWithContinuation({
      baseMessages,
      solvePass: async () => {
        calls += 1
        return 'the whole answer'
      },
    })
    expect(outcome.content).toBe('the whole answer')
    expect(outcome.continuationCount).toBe(0)
    expect(calls).toBe(1)
  })
})

describe('continuation — truncation resumes from the preserved partial', () => {
  test('one truncated pass is continued and the texts concatenate in order', async () => {
    const seenMessages: ChatTurn[][] = []
    const outcome = await solveWithContinuation({
      baseMessages,
      solvePass: async (messages) => {
        seenMessages.push(messages)
        if (seenMessages.length === 1) {
          throw new UpstreamTruncatedError('upstream truncated the response at its output length limit (finish_reason: length)', 'part one —')
        }
        return 'part two'
      },
    })
    expect(outcome.content).toBe('part one —part two')
    expect(outcome.continuationCount).toBe(1)
    // The continuation pass receives: base + the partial as assistant + the ask.
    expect(seenMessages[1].length).toBe(baseMessages.length + 2)
    expect(seenMessages[1][baseMessages.length]).toEqual({ role: 'assistant', content: 'part one —' })
    expect(seenMessages[1][baseMessages.length + 1]?.role).toBe('user')
    expect(seenMessages[1][baseMessages.length + 1]?.content).toBe(CONTINUATION_INSTRUCTION)
  })

  test('the continuation instruction forbids repeating earlier text', () => {
    expect(CONTINUATION_INSTRUCTION).toContain('Continue EXACTLY where it stopped')
    expect(CONTINUATION_INSTRUCTION).toContain('without repeating any text you already wrote')
  })

  test('the bound matches the documented constant (resource control)', () => {
    expect(MAX_SOLVE_CONTINUATIONS).toBe(1)
  })
})

describe('continuation — the bound is enforced honestly', () => {
  test('a second truncation propagates the typed error carrying ALL produced text', async () => {
    let calls = 0
    let caught: UpstreamTruncatedError | null = null
    try {
      await solveWithContinuation({
        baseMessages,
        solvePass: async () => {
          calls += 1
          if (calls === 1) throw new UpstreamTruncatedError('truncated (finish_reason: length)', 'first ')
          throw new UpstreamTruncatedError('truncated (finish_reason: length)', 'second ')
        },
      })
      expect.unreachable()
    } catch (e) {
      caught = e as UpstreamTruncatedError
    }
    expect(caught).toBeInstanceOf(UpstreamTruncatedError)
    // Everything produced is preserved on the error — nothing is dropped.
    expect(caught?.partialText).toBe('first second ')
    expect(calls).toBe(2) // exactly MAX_SOLVE_CONTINUATIONS + 1 passes
  })

  test('a truncation with an EMPTY partial is not continued (no referent)', async () => {
    let calls = 0
    await expect(
      solveWithContinuation({
        baseMessages,
        solvePass: async () => {
          calls += 1
          throw new UpstreamTruncatedError('truncated (finish_reason: length)', '')
        },
      }),
    ).rejects.toBeInstanceOf(UpstreamTruncatedError)
    expect(calls).toBe(1)
  })
})

describe('continuation — other failures propagate untouched', () => {
  test('non-truncation errors are not swallowed', async () => {
    let calls = 0
    await expect(
      solveWithContinuation({
        baseMessages,
        solvePass: async () => {
          calls += 1
          throw new Error('upstream stream timed out: no tokens received')
        },
      }),
    ).rejects.toThrow('timed out')
    expect(calls).toBe(1)
  })
})

describe('continuation — message construction', () => {
  test('buildContinuationMessages keeps the base and appends partial + ask', () => {
    const messages = buildContinuationMessages(baseMessages, 'partial answer so far')
    expect(messages.slice(0, baseMessages.length)).toEqual(baseMessages)
    expect(messages[messages.length - 2]).toEqual({ role: 'assistant', content: 'partial answer so far' })
    expect(messages[messages.length - 1]?.role).toBe('user')
  })
})
