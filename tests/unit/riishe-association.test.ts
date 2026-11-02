/**
 * BEAN Intelligence — RIISHE request/response association regression tests.
 * Run: bun test tests/unit/riishe-association.test.ts
 *
 * Work order PART 4 asked whether responses can be associated with the wrong
 * user message (wrong message sent, history mis-assembled, old questions
 * reused, concurrent mixing, wrong retry target). These tests pin the pure
 * request-construction and association contracts against the REAL production
 * code — hermetic, no network, no DB:
 *  - the user turn construction carries the EXACT new question (once) and
 *    keeps it after any digest/evidence blocks;
 *  - history assembly never injects the new question twice;
 *  - the dangling-row collapse + regenerate planning keep ONE honest record
 *    of a retried/regenerated turn (measured duplication defects);
 *  - the SSE done event's messageId (persisted row id) flows through the
 *    client consumer unchanged — the client's Regenerate targets the row
 *    the server actually persisted;
 *  - dead-wire recovery adoption is guarded against adopting another
 *    turn's answer.
 */
import { describe, test, expect } from 'bun:test'
import { buildUserTurn, buildSystemPrompt } from '../../src/lib/riishe/prompts'
import { isDanglingDuplicateUserRow } from '../../src/app/api/riishe/chat/route'
import { planRegenerate, persistedAnswerMatchesTurn } from '../../src/lib/riishe/retry'
import { consumeRiisheStream, type RiisheStreamEvent } from '../../src/lib/riishe/sse-client'

const Q = 'Predict the output of console.log(typeof null) and the rest of the snippet.'

describe('request construction: the exact new question reaches the model', () => {
  test('buildUserTurn places the question verbatim, exactly once, as the last block', () => {
    const turn = buildUserTurn(Q, { evidenceBlock: null, task: 'coding', staleness: null })
    const count = turn.split('USER QUESTION:').length - 1
    expect(count).toBe(1)
    expect(turn.endsWith(`USER QUESTION: ${Q}`)).toBe(true)
    expect(turn).toContain(Q)
  })

  test('digest and evidence come BEFORE the question; the question is never rewritten', () => {
    const turn = buildUserTurn(
      Q,
      { evidenceBlock: 'E1: some evidence', task: 'research', staleness: null },
      'DIGEST of earlier turns',
    )
    expect(turn.indexOf('CONVERSATION MEMORY')).toBeLessThan(turn.indexOf('RETRIEVED EVIDENCE'))
    expect(turn.indexOf('RETRIEVED EVIDENCE')).toBeLessThan(turn.indexOf(`USER QUESTION: ${Q}`))
    expect(turn).toContain(Q)
  })

  test('the system prompt is conversation-independent (no cross-turn bleed)', () => {
    const a = buildSystemPrompt({ evidenceBlock: null, task: 'coding', staleness: null })
    const b = buildSystemPrompt({ evidenceBlock: null, task: 'coding', staleness: null })
    expect(a).toBe(b)
    expect(a).not.toContain(Q)
  })
})

describe('one honest record per retried/regenerated turn (no duplicate questions)', () => {
  test('a trailing dangling user row with identical content is the retry residue', () => {
    expect(isDanglingDuplicateUserRow({ role: 'user', content: Q }, Q)).toBe(true)
    expect(isDanglingDuplicateUserRow({ role: 'assistant', content: 'answer' }, Q)).toBe(false)
    expect(isDanglingDuplicateUserRow({ role: 'user', content: 'different question' }, Q)).toBe(false)
    expect(isDanglingDuplicateUserRow(null, Q)).toBe(false)
  })

  test('trailing regenerate always re-answers in place (retry), never appends a copy', () => {
    // With a persisted id (completed turn)...
    expect(planRegenerate({ isTrailing: true, serverId: 'row-1' })?.retry).toBe(true)
    // ...and after a failed turn (nothing persisted).
    expect(planRegenerate({ isTrailing: true, serverId: null })?.retry).toBe(true)
    // Earlier turns regenerate from their persisted id only.
    expect(planRegenerate({ isTrailing: false, serverId: 'row-5' })?.retryFromMessageId).toBe('row-5')
    expect(planRegenerate({ isTrailing: false, serverId: null })).toBeNull()
  })
})

describe('response association: the persisted row id reaches the client bubble', () => {
  test('the done event messageId passes through consumeRiisheStream to onComplete', async () => {
    const frames = [
      `data: ${JSON.stringify({ delta: 'Answer text', conversationId: 'c1' })}\n\n`,
      `data: ${JSON.stringify({ done: true, conversationId: 'c1', messageId: 'assistant-row-42', partial: false })}\n\n`,
    ]
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (const f of frames) c.enqueue(new TextEncoder().encode(f))
        c.close()
      },
    })
    let completed: RiisheStreamEvent | null = null
    await consumeRiisheStream(new Response(stream), {
      onEvent: () => undefined,
      onComplete: (e) => {
        completed = e
      },
      onFailure: () => undefined,
    })
    const done = completed as RiisheStreamEvent | null
    expect(done).not.toBeNull()
    expect(done?.messageId).toBe('assistant-row-42')
    expect(done?.partial).toBe(false)
  })

  test('two sequential turns each carry their own messageId (no cross-association)', async () => {
    const mk = (id: string, text: string): Response => {
      const frames = [
        `data: ${JSON.stringify({ delta: text })}\n\n`,
        `data: ${JSON.stringify({ done: true, messageId: id, partial: false })}\n\n`,
      ]
      const s = new ReadableStream<Uint8Array>({
        start(c) {
          for (const f of frames) c.enqueue(new TextEncoder().encode(f))
          c.close()
        },
      })
      return new Response(s)
    }
    const seen: Array<string | undefined> = []
    for (const [id, text] of [['row-a', 'first answer'], ['row-b', 'second answer']] as const) {
      await consumeRiisheStream(mk(id, text), {
        onEvent: () => undefined,
        onComplete: (e) => seen.push(e.messageId),
        onFailure: () => undefined,
      })
    }
    expect(seen).toEqual(['row-a', 'row-b'])
  })
})

describe('dead-wire recovery guards (never adopt another turn\'s answer)', () => {
  test('empty partial adopts a persisted completed answer for this turn', () => {
    expect(persistedAnswerMatchesTurn('The complete answer from the server.', '')).toBe(true)
  })
  test('a matching head adopts (verification rewrites keep the opening)', () => {
    const persisted = 'The answer starts the same way and then continues with the full verified content.'
    expect(persistedAnswerMatchesTurn(persisted, 'The answer starts the same way')).toBe(true)
  })
  test('a non-matching persisted answer is refused (wrong-turn guard)', () => {
    expect(persistedAnswerMatchesTurn('Completely different content about another topic.', 'The answer starts the same way')).toBe(false)
    expect(persistedAnswerMatchesTurn('', '')).toBe(false)
  })
})
