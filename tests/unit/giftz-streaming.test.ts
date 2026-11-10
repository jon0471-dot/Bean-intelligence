/**
 * BEAN Intelligence — CODE GIFTZ streaming reliability regression tests (wire
 * protocol + shared client + retry contract). Run:
 *   bun test tests/unit/giftz-streaming.test.ts
 *
 * Covers the work order's remaining scenarios against the REAL production
 * code: src/lib/adapters/hosted-llm.ts sseDeltas (upstream byte stream),
 * src/lib/riishe/sse-client.ts (the SSE consumer the CODE GIFTZ UI uses),
 * src/lib/upstream/gateway.ts (typed failure classes), src/lib/giftz/retry.ts
 * (idempotent retry) and the CODE GIFTZ fence-repair helper. Only transport
 * is fault-injected; no network calls.
 */
import { describe, test, expect } from 'bun:test'
import { sseDeltas, UpstreamTruncatedError } from '../../src/lib/adapters/hosted-llm'
import {
  consumeRiisheStream,
  createSseFrameParser,
  streamFailureMessage,
  type RiisheStreamEvent,
  type StreamFailureInfo,
} from '../../src/lib/riishe/sse-client'
import { upstreamStreamErrorPayload } from '../../src/lib/upstream/gateway'
import { shouldCollapseDuplicateUserMessage } from '../../src/lib/giftz/retry'
import { closeUnbalancedFences } from '../../src/components/bean/code-giftz'

const encoder = new TextEncoder()

async function collect(stream: AsyncIterable<unknown>, opts?: { idleTimeoutMs?: number; maxDurationMs?: number }): Promise<string> {
  const out: string[] = []
  for await (const d of sseDeltas(stream, opts)) out.push(d)
  return out.join('')
}

const frameOf = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`

function sseResponse(frames: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const f of frames) c.enqueue(encoder.encode(f))
      c.close()
    },
  })
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function recorder() {
  const events: RiisheStreamEvent[] = []
  const failures: StreamFailureInfo[] = []
  let completed: RiisheStreamEvent | null = null
  return {
    callbacks: {
      onEvent: (e: RiisheStreamEvent) => events.push(e),
      onComplete: (e: RiisheStreamEvent) => {
        completed = e
      },
      onFailure: (f: StreamFailureInfo) => failures.push(f),
    },
    events,
    failures,
    get completed() {
      return completed
    },
  }
}

// ---- upstream byte-stream protocol (sseDeltas) ------------------------------

describe('SSE protocol — arbitrary network chunk boundaries', () => {
  test('one SSE event SPLIT across two chunks still parses (and a third fragment)', async () => {
    const full = frameOf('split token')
    const stream = {
      async *[Symbol.asyncIterator]() {
        yield encoder.encode(full.slice(0, 12))
        yield encoder.encode(full.slice(12, 30))
        yield encoder.encode(full.slice(30))
        yield encoder.encode('data: [DONE]\n\n')
      },
    }
    expect(await collect(stream as unknown as AsyncIterable<unknown>)).toBe('split token')
  })

  test('MULTIPLE SSE events inside ONE chunk all apply, in order', async () => {
    const stream = {
      async *[Symbol.asyncIterator]() {
        yield encoder.encode(frameOf('a') + frameOf('b') + frameOf('c') + 'data: [DONE]\n\n')
      },
    }
    expect(await collect(stream as unknown as AsyncIterable<unknown>)).toBe('abc')
  })

  test('CRLF boundaries (\\r\\n\\r\\n) separate events per spec', async () => {
    const stream = {
      async *[Symbol.asyncIterator]() {
        yield encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'win' } }] })}\r\n\r\ndata: [DONE]\r\n\r\n`)
      },
    }
    expect(await collect(stream as unknown as AsyncIterable<unknown>)).toBe('win')
  })

  test('the FINAL event without a trailing newline is flushed, never dropped', async () => {
    const stream = {
      async *[Symbol.asyncIterator]() {
        yield encoder.encode(frameOf('kept '))
        yield encoder.encode('data: {"choices":[{"delta":{"content":"tail"}}]}') // no \n\n, no [DONE]
      },
    }
    expect(await collect(stream as unknown as AsyncIterable<unknown>)).toBe('kept tail')
  })

  test('a UTF-8 emoji ZWJ sequence SPLIT across chunks reassembles exactly', async () => {
    // 👩‍💻 is a multi-codepoint ZWJ sequence — split inside its bytes.
    const text = 'developer 👩‍💻 emoji'
    const bytes = encoder.encode(frameOf(text))
    const cut = frameOf('').length + 16 // inside the emoji sequence
    const stream = {
      async *[Symbol.asyncIterator]() {
        yield bytes.slice(0, cut)
        yield bytes.slice(cut)
        yield encoder.encode('data: [DONE]\n\n')
      },
    }
    const out = await collect(stream as unknown as AsyncIterable<unknown>)
    expect(out).toBe(text)
    expect(out).not.toContain('\uFFFD')
  })

  test('a MALFORMED JSON event is skipped; later valid events still stream', async () => {
    const stream = {
      async *[Symbol.asyncIterator]() {
        yield encoder.encode('data: {not json at all\n\n')
        yield encoder.encode(frameOf('still works') + 'data: [DONE]\n\n')
      },
    }
    expect(await collect(stream as unknown as AsyncIterable<unknown>)).toBe('still works')
  })

  test('a DUPLICATE [DONE] sentinel terminates at the FIRST one (no double terminal)', async () => {
    const stream = {
      async *[Symbol.asyncIterator]() {
        yield encoder.encode(frameOf('done once ') + 'data: [DONE]\n\ndata: [DONE]\n\n' + frameOf('NEVER'))
      },
    }
    expect(await collect(stream as unknown as AsyncIterable<unknown>)).toBe('done once ')
  })

  test('empty upstream (EOF with zero bytes) yields zero deltas, no throw', async () => {
    const empty = { async *[Symbol.asyncIterator]() {} }
    expect(await collect(empty as unknown as AsyncIterable<unknown>)).toBe('')
  })

  test('upstream connection dying MID-GENERATION propagates as a typed error', async () => {
    const stream = {
      async *[Symbol.asyncIterator]() {
        yield encoder.encode(frameOf('partial before death'))
        throw new TypeError('fetch failed')
      },
    }
    let caught: unknown = null
    const deltas: string[] = []
    try {
      for await (const d of sseDeltas(stream as unknown as AsyncIterable<unknown>)) deltas.push(d)
    } catch (e) {
      caught = e
    }
    expect(deltas.join('')).toBe('partial before death') // partial deltas preserved
    expect((caught as Error).message).toBe('fetch failed')
    expect(upstreamStreamErrorPayload(caught).code).toBe('UPSTREAM_NETWORK')
  })

  test('idle timeout fires a labeled error when the provider stops sending', async () => {
    const stall = {
      [Symbol.asyncIterator]() {
        let n = 0
        return {
          next: () =>
            n++ === 0
              ? Promise.resolve({ done: false, value: encoder.encode(frameOf('first')) })
              : new Promise<IteratorResult<unknown>>(() => {}), // then silence
        }
      },
    }
    let caught: Error | null = null
    try {
      for await (const _ of sseDeltas(stall as unknown as AsyncIterable<unknown>, { idleTimeoutMs: 40, maxDurationMs: 0 })) void _
      expect.unreachable()
    } catch (e) {
      caught = e as Error
    }
    expect(caught?.message).toContain('no tokens received for 40ms')
    expect(upstreamStreamErrorPayload(caught).code).toBe('UPSTREAM_TIMEOUT')
  })
})

// ---- client-side consumption (the CODE GIFTZ UI path) -----------------------

describe('client consumption — wire frames to typed UI states', () => {
  const giftzDelta = (text: string) => `data: ${JSON.stringify({ delta: text, projectId: 'p1' })}\n\n`
  const giftzDone = 'data: {"done":true,"projectId":"p1","messageId":"m1","changes":[]}\n\n'

  test('a clean stream ends in onComplete with the done payload (no failure)', async () => {
    const r = recorder()
    await consumeRishe(sseResponse([giftzDelta('Hello '), giftzDone]), r)
    expect(r.completed).not.toBeNull()
    expect(r.failures).toHaveLength(0)
    expect(r.events.map((e) => e.delta).join('')).toBe('Hello ')
  })

  test('the connection dying mid-body is a typed NETWORK failure — never the raw browser text', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(encoder.encode(giftzDelta('partial ')))
        // Simulate a transport reset: error the stream mid-body.
        c.error(new TypeError('network error'))
      },
    })
    const r = recorder()
    await consumeRishe(
      new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
      r,
    )
    expect(r.completed).toBeNull()
    expect(r.failures).toHaveLength(1)
    expect(r.failures[0].kind).toBe('network')
    expect(r.failures[0].message).toContain('connection')
    expect(r.failures[0].message).not.toContain('TypeError')
  })

  test('user Stop mid-stream surfaces as aborted (not an error)', async () => {
    const controller = new AbortController()
    const stream = new ReadableStream<Uint8Array>({
      async start(c) {
        c.enqueue(encoder.encode(giftzDelta('partial ')))
        // A real aborted fetch cancels the body: emulate the transport effect.
        controller.signal.addEventListener('abort', () => {
          try {
            c.error(new DOMException('The user aborted a request.', 'AbortError'))
          } catch {
            /* already closed */
          }
        })
        await new Promise((r) => setTimeout(r, 200))
        c.enqueue(encoder.encode(giftzDone))
        c.close()
      },
    })
    const r = recorder()
    const consuming = consumeRishe(
      new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
      r,
      { signal: controller.signal },
    )
    setTimeout(() => controller.abort(), 30) // Stop pressed mid-generation
    await consuming
    expect(r.completed).toBeNull()
    expect(r.failures).toHaveLength(1)
    expect(r.failures[0].kind).toBe('aborted')
  })

  test('a stream that closes WITHOUT the done event is a protocol failure (never fake success)', async () => {
    const r = recorder()
    await consumeRishe(sseResponse([giftzDelta('looks finished ')]), r)
    expect(r.completed).toBeNull()
    expect(r.failures).toHaveLength(1)
    expect(r.failures[0].kind).toBe('protocol')
  })

  test('the server error frame is delivered as an event; the UI shows its typed reason', async () => {
    const errorFrame = 'data: {"error":"The upstream AI gateway is rate-limited right now (HTTP 429).","code":"UPSTREAM_RATE_LIMITED","partial":true}\n\n'
    const r = recorder()
    await consumeRishe(sseResponse([giftzDelta('partial '), errorFrame]), r)
    expect(r.completed).toBeNull()
    expect(r.events.some((e) => e.code === 'UPSTREAM_RATE_LIMITED')).toBe(true)
  })

  test('keepalive comment frames are transport noise — no content, no protocol failure', async () => {
    const r = recorder()
    await consumeRishe(
      sseResponse([': keepalive\n\n', giftzDelta('ok'), ': keepalive\n\n', giftzDone]),
      r,
    )
    expect(r.completed).not.toBeNull()
    expect(r.events.filter((e) => typeof e.delta === 'string')).toHaveLength(1)
  })

  test('the frame parser handles the final event without a trailing blank line', async () => {
    const parser = createSseFrameParser()
    expect(parser.push(giftzDelta('a'))).toHaveLength(1)
    const tail = parser.push('data: {"done":true,"projectId":"p1"}')
    expect(tail).toHaveLength(0) // buffered — no boundary yet
    const flushed = parser.flush()
    expect(flushed).toHaveLength(1)
    expect(flushed[0].done).toBe(true)
  })
})

// Minimal alias so the consumer name reads honestly in this file's context.
function consumeRishe(
  res: Response,
  r: ReturnType<typeof recorder>,
  opts?: { signal?: AbortSignal },
): Promise<void> {
  return consumeRiisheStream(res, r.callbacks, opts)
}

// ---- typed failure classes --------------------------------------------------

describe('typed failure classes on the wire', () => {
  test('truncation / network / timeout / rate-limit / auth / billing are distinct codes', () => {
    expect(upstreamStreamErrorPayload(new UpstreamTruncatedError()).code).toBe('UPSTREAM_TRUNCATED')
    expect(upstreamStreamErrorPayload(new Error('fetch failed')).code).toBe('UPSTREAM_NETWORK')
    expect(upstreamStreamErrorPayload(new Error('upstream stream timed out: no tokens received for 120000ms')).code).toBe('UPSTREAM_TIMEOUT')
    expect(upstreamStreamErrorPayload(new Error('status 429: Too many requests')).code).toBe('UPSTREAM_RATE_LIMITED')
    expect(upstreamStreamErrorPayload(new Error('status 401: bad key')).code).toBe('UPSTREAM_AUTH')
    expect(upstreamStreamErrorPayload(new Error('status 402: billing')).code).toBe('UPSTREAM_BILLING')
    expect(upstreamStreamErrorPayload(new Error('something else')).code).toBe('BACKEND_FAILURE')
  })

  test('client-facing failure wording never leaks raw browser errors', () => {
    for (const kind of ['network', 'timeout', 'protocol'] as const) {
      const msg = streamFailureMessage(kind, null)
      expect(msg.toLowerCase()).not.toContain('typeerror')
      expect(msg.toLowerCase()).not.toContain('fetch failed')
      expect(msg.length).toBeGreaterThan(20)
    }
  })
})

// ---- retry idempotency + interrupted rendering ------------------------------

describe('safe retry — failed turns do not duplicate history', () => {
  test('a trailing identical unanswered user prompt collapses on retry', () => {
    expect(shouldCollapseDuplicateUserMessage({ role: 'user', content: 'write FOO' }, 'write FOO')).toBe(true)
  })
  test('an answered turn is never collapsed (repeat prompts are legitimate new turns)', () => {
    expect(shouldCollapseDuplicateUserMessage({ role: 'assistant', content: 'here is FOO' }, 'write FOO')).toBe(false)
  })
  test('a different prompt is never collapsed', () => {
    expect(shouldCollapseDuplicateUserMessage({ role: 'user', content: 'write BAR' }, 'write FOO')).toBe(false)
  })
  test('empty history never collapses', () => {
    expect(shouldCollapseDuplicateUserMessage(null, 'write FOO')).toBe(false)
  })
})

describe('interrupted answers stay readable (unbalanced code fences)', () => {
  test('a stream cut mid-code-block gets its fence closed for rendering', () => {
    const partial = 'Here is the code:\n\n```js path=main.js\nconsole.log("hi")\n'
    const fixed = closeUnbalancedFences(partial)
    expect(fixed.endsWith('```')).toBe(true)
    expect(fixed.split('\n').filter((l) => l.trimStart().startsWith('```'))).toHaveLength(2)
  })
  test('complete answers with balanced fences are untouched', () => {
    const complete = 'Code:\n\n```js\nconsole.log(1)\n```\n\nDone.'
    expect(closeUnbalancedFences(complete)).toBe(complete)
  })
  test('plain prose without any fence is untouched', () => {
    expect(closeUnbalancedFences('Just an explanation.')).toBe('Just an explanation.')
  })
})
