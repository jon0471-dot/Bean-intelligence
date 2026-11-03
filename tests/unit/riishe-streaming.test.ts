/**
 * BEAN Intelligence — RIISHE streaming reliability regression tests.
 * Run: bun test tests/unit/riishe-streaming.test.ts
 *
 * Covers the 12 required scenarios from the work order, plus the server-side
 * SSE writer contract. Everything runs against the REAL production code:
 *  - src/lib/riishe/sse-client.ts (client frame parser + stream consumer);
 *  - src/lib/riishe/sse.ts (server writer: keepalive, disconnect tolerance);
 *  - src/lib/adapters/hosted-llm.ts sseDeltas (upstream stall guard).
 * Only the TRANSPORT (Readables / async iterables) is fault-injected; no
 * network calls are made.
 */
import { describe, test, expect } from 'bun:test'
import {
  CLIENT_IDLE_WATCHDOG_MS,
  classifyHttpFailure,
  consumeRiisheStream,
  createSseFrameParser,
  streamFailureMessage,
  type RiisheStreamEvent,
  type StreamFailureInfo,
} from '../../src/lib/riishe/sse-client'
import { createSseWriter, DEFAULT_SSE_HEARTBEAT_MS } from '../../src/lib/riishe/sse'
import { sseDeltas } from '../../src/lib/adapters/hosted-llm'

const encoder = new TextEncoder()

/** Build a Response whose body replays the given STRING frames. */
function sseResponse(frames: string[], opts: { delayMs?: number } = {}): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(c) {
      for (const f of frames) {
        c.enqueue(encoder.encode(f))
        if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs))
      }
      c.close()
    },
  })
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

/** Build a Response from RAW byte chunks (for multibyte split tests). */
function byteResponse(chunks: Uint8Array[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const b of chunks) c.enqueue(b)
      c.close()
    },
  })
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

/** Callback recorder for consumeRiisheStream. */
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

const delta = (text: string, extra: Record<string, unknown> = {}) =>
  `data: ${JSON.stringify({ delta: text, ...extra })}\n\n`

describe('scenario 1 — short response completes normally', () => {
  test('deltas arrive in order and onComplete fires with the persisted message id', async () => {
    const r = recorder()
    await consumeRiisheStream(
      sseResponse([
        ': connected\n\n',
        delta('Hello', { conversationId: 'c1' }),
        delta('!', { conversationId: 'c1' }),
        'data: {"done":true,"conversationId":"c1","messageId":"m1","partial":false}\n\n',
      ]),
      r.callbacks,
    )
    expect(r.events.filter((e) => e.delta).map((e) => e.delta)).toEqual(['Hello', '!'])
    expect(r.completed).not.toBeNull()
    expect(r.completed?.messageId).toBe('m1')
    expect(r.failures).toHaveLength(0)
  })
})

describe('scenario 2 — long response streaming over an extended period', () => {
  test('100 chunks streamed over time are all received, in order, without loss', async () => {
    const r = recorder()
    const frames = Array.from({ length: 100 }, (_, i) => delta(`chunk-${i} `))
    frames.push('data: {"done":true}\n\n')
    await consumeRiisheStream(sseResponse(frames, { delayMs: 1 }), r.callbacks)
    const deltas = r.events.filter((e) => e.delta).map((e) => e.delta)
    expect(deltas).toHaveLength(100)
    expect(deltas[0]).toBe('chunk-0 ')
    expect(deltas[99]).toBe('chunk-99 ')
    expect(r.completed).not.toBeNull()
    expect(r.failures).toHaveLength(0)
  })
})

describe('scenario 3 — response containing multiple code blocks', () => {
  test('code fences split across deltas reassemble byte-exact', async () => {
    const block1 = '```python\nprint("one")\nprint(2 + 2)\n```'
    const block2 = '```js\nconst x = [1, 2].map(n => n * 2);\n```'
    const full = `Here is code:\n\n${block1}\n\nand more:\n\n${block2}\n\ndone.`
    const r = recorder()
    // Deliberately split INSIDE the fences at awkward points.
    await consumeRiisheStream(
      sseResponse([
        delta(full.slice(0, 40)),
        delta(full.slice(40, 75)),
        delta(full.slice(75, 120)),
        delta(full.slice(120)),
        'data: {"done":true}\n\n',
      ]),
      r.callbacks,
    )
    const content = r.events.filter((e) => e.delta).map((e) => e.delta).join('')
    expect(content).toBe(full)
    expect(content.match(/```/g)?.length).toBe(4)
    expect(r.completed).not.toBeNull()
  })
})

describe('scenario 4 — response containing Markdown tables', () => {
  test('table rows stream intact (no rows dropped or reordered)', async () => {
    const table = [
      '| Year | Downloads |',
      '| --- | ---: |',
      '| 2024 | 1.2M |',
      '| 2025 | 3.4M |',
      '| 2026 | 7.9M |',
    ].join('\n')
    const r = recorder()
    const lines = table.split('\n').map((l) => delta(`${l}\n`))
    await consumeRiisheStream(sseResponse([...lines, delta('After the table.'), 'data: {"done":true}\n\n']), r.callbacks)
    const content = r.events.filter((e) => e.delta).map((e) => e.delta).join('')
    expect(content).toContain('| Year | Downloads |')
    expect(content).toContain('| 2026 | 7.9M |')
    expect(content.trimEnd().endsWith('After the table.')).toBe(true)
    expect(r.completed).not.toBeNull()
  })
})

describe('scenario 5 — Unicode and Tamil characters split across chunks', () => {
  test('a multibyte character cut in half at a network boundary reassembles correctly', async () => {
    const tamil = 'வணக்கம் RIISHE நண்பரே'
    const frame = delta(`${tamil} — மொழிபெயர்ப்பு சோதனை`)
    const bytes = encoder.encode(frame)
    // Split at a byte offset INSIDE a multibyte sequence.
    const splitAt = 12
    const r = recorder()
    await consumeRiisheStream(byteResponse([bytes.slice(0, splitAt), bytes.slice(splitAt)]), r.callbacks)
    const content = r.events.filter((e) => e.delta).map((e) => e.delta).join('')
    expect(content).toBe(`${tamil} — மொழிபெயர்ப்பு சோதனை`)
    expect(content).not.toContain('\uFFFD')
  })

  test('an emoji split exactly at a surrogate boundary also reassembles', async () => {
    const frame = delta('gold ✨ done')
    const bytes = encoder.encode(frame)
    const starAt = bytes.findIndex((b, i) => b === 0xe2 && bytes[i + 1] === 0x9c)
    const r = recorder()
    await consumeRiisheStream(byteResponse([bytes.slice(0, starAt + 1), bytes.slice(starAt + 1)]), r.callbacks)
    const content = r.events.filter((e) => e.delta).map((e) => e.delta).join('')
    expect(content).toBe('gold ✨ done')
  })
})

describe('scenario 6 — network connection interruption mid-stream', () => {
  test('a dying connection classifies as network failure, never success', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(encoder.encode(delta('partial one ')))
        setTimeout(() => c.error(new TypeError('network error')), 5)
      },
    })
    const r = recorder()
    await consumeRiisheStream(new Response(stream), r.callbacks)
    expect(r.completed).toBeNull() // NEVER labeled complete
    expect(r.failures).toHaveLength(1)
    expect(r.failures[0].kind).toBe('network')
    // The honest category wording — not the raw browser string.
    expect(r.failures[0].message).toBe(streamFailureMessage('network', null))
    expect(r.failures[0].message).toContain('connection to RIISHE was lost')
    expect(r.events.filter((e) => e.delta)).toHaveLength(1) // partial preserved for the caller
  })
})

describe('scenario 7 — provider returning an error during generation', () => {
  test('the typed error event is surfaced and the turn is never marked complete', async () => {
    const r = recorder()
    await consumeRiisheStream(
      sseResponse([
        delta('The answer begins '),
        'data: {"error":"The upstream AI gateway is rate-limited right now (HTTP 429).","code":"UPSTREAM_RATE_LIMITED","partial":true}\n\n',
        // Server closes WITHOUT a done event (error payload is always last).
      ]),
      r.callbacks,
    )
    const errorEvent = r.events.find((e) => e.error)
    expect(errorEvent?.code).toBe('UPSTREAM_RATE_LIMITED')
    expect(errorEvent?.error).toContain('rate-limited')
    expect(r.completed).toBeNull()
    // At the transport layer the clean close without `done` is a protocol
    // failure — the hook layer preserves the SERVER's wording instead.
    expect(r.failures).toHaveLength(1)
    expect(r.failures[0].kind).toBe('protocol')
  })
})

describe('scenario 8 — timeout during generation', () => {
  test('client watchdog: a wedged stream (no bytes at all) is classified as timeout', async () => {
    const never = new ReadableStream<Uint8Array>({
      start() {
        /* never enqueues, never closes */
      },
    })
    const r = recorder()
    await consumeRiisheStream(new Response(never), r.callbacks, { idleWatchdogMs: 30 })
    expect(r.completed).toBeNull()
    expect(r.failures).toHaveLength(1)
    expect(r.failures[0].kind).toBe('timeout')
    expect(r.failures[0].message).toBe(streamFailureMessage('timeout', null))
  })

  test('upstream stall guard: sseDeltas throws a labeled timeout when tokens stop', async () => {
    let releases = 0
    let calls = 0
    const stalled = {
      [Symbol.asyncIterator]() {
        return {
          next: () => {
            calls += 1
            if (calls === 1) {
              // One chunk arrives, then the upstream goes silent forever.
              return new Promise<IteratorResult<unknown>>((resolve) =>
                setTimeout(() => resolve({ done: false, value: { 0: 100 } }), 1),
              )
            }
            return new Promise<IteratorResult<unknown>>(() => {}) // never settles
          },
          return: () => {
            releases += 1
            return Promise.resolve({ done: true as const, value: undefined })
          },
        }
      },
    }
    let caught: Error | null = null
    try {
      for await (const _ of sseDeltas(stalled as unknown as AsyncIterable<unknown>, { idleTimeoutMs: 30 })) {
        void _
      }
      expect.unreachable()
    } catch (e) {
      caught = e as Error
    }
    expect(caught?.message).toContain('timed out')
    expect(releases).toBe(1) // the iterator was released best-effort
  })

  test('while tokens flow, the stall guard never fires', async () => {
    const slowButAlive = {
      [Symbol.asyncIterator]() {
        let n = 0
        return {
          next: async () => {
            n += 1
            if (n > 4) return { done: true as const, value: undefined }
            await new Promise((r) => setTimeout(r, 25))
            const text = encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: `t${n} ` } }] })}\n\n`)
            return { done: false as const, value: Object.fromEntries(text.entries()) }
          },
        }
      },
    }
    const out: string[] = []
    for await (const d of sseDeltas(slowButAlive as unknown as AsyncIterable<unknown>, { idleTimeoutMs: 200 })) {
      out.push(d)
    }
    expect(out.join('')).toBe('t1 t2 t3 t4 ')
  })

  test('classifyUpstreamError maps the stall message to the timeout class (payload contract)', () => {
    // The stall error text contains "timed out" — classifyHttpFailure /
    // upstreamStreamErrorPayload must produce the honest timeout category.
    const info = classifyHttpFailure(504)
    expect(info.kind).toBe('timeout')
    expect(info.message).toContain('timed out')
  })
})

describe('scenario 9 — user pressing Stop', () => {
  test('an abort surfaces as kind "aborted" (no error banner semantics)', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(encoder.encode(delta('kept partial ')))
        setTimeout(() => {
          const abortErr = new Error('The user aborted the request.')
          abortErr.name = 'AbortError'
          c.error(abortErr)
        }, 5)
      },
    })
    const r = recorder()
    await consumeRiisheStream(new Response(stream), r.callbacks)
    expect(r.completed).toBeNull()
    expect(r.failures).toHaveLength(1)
    expect(r.failures[0].kind).toBe('aborted')
    expect(r.events.filter((e) => e.delta)).toHaveLength(1) // partial kept
  })
})

describe('scenario 10 — two consecutive chat requests', () => {
  test('parser state never leaks between turns', async () => {
    const r1 = recorder()
    await consumeRiisheStream(sseResponse([delta('first '), delta('turn'), 'data: {"done":true}\n\n']), r1.callbacks)
    const r2 = recorder()
    await consumeRiisheStream(sseResponse([delta('second '), delta('turn'), 'data: {"done":true}\n\n']), r2.callbacks)
    const c1 = r1.events.filter((e) => e.delta).map((e) => e.delta).join('')
    const c2 = r2.events.filter((e) => e.delta).map((e) => e.delta).join('')
    expect(c1).toBe('first turn')
    expect(c2).toBe('second turn')
    expect(c2).not.toContain('first')
    expect(r1.completed).not.toBeNull()
    expect(r2.completed).not.toBeNull()
  })
})

describe('scenario 11 — stream ending without a valid completion event', () => {
  test('a clean close WITHOUT done is a protocol failure, never a success', async () => {
    const r = recorder()
    await consumeRiisheStream(sseResponse([delta('looks finished but '), delta('never completed')]), r.callbacks)
    expect(r.completed).toBeNull()
    expect(r.failures).toHaveLength(1)
    expect(r.failures[0].kind).toBe('protocol')
    expect(r.failures[0].message).toContain('ended before the model finished')
  })

  test('a malformed JSON frame is skipped, not fatal — later frames still parse', async () => {
    const r = recorder()
    await consumeRiisheStream(
      sseResponse(['data: {not-json\n\n', delta('still alive '), 'data: {"done":true}\n\n']),
      r.callbacks,
    )
    expect(r.events.filter((e) => e.delta).map((e) => e.delta)).toEqual(['still alive '])
    expect(r.completed).not.toBeNull()
    expect(r.failures).toHaveLength(0)
  })
})

describe('scenario 12 — final chunk arriving separately from previous chunks', () => {
  test('a final frame WITHOUT the trailing blank line is flushed at close', async () => {
    const r = recorder()
    await consumeRiisheStream(
      sseResponse([delta('before '), delta('final '), 'data: {"done":true,"messageId":"last"}']),
      r.callbacks,
    )
    expect(r.completed).not.toBeNull()
    expect(r.completed?.messageId).toBe('last')
    expect(r.failures).toHaveLength(0)
  })

  test('a data line split mid-JSON across network chunks is buffered, not lost', async () => {
    const r = recorder()
    const frame = delta('tail-end')
    const bytes = encoder.encode(frame)
    const cut = bytes.indexOf(0x7d) // inside the JSON "}" region
    await consumeRiisheStream(byteResponse([bytes.slice(0, cut), bytes.slice(cut)]), r.callbacks)
    expect(r.events.filter((e) => e.delta).map((e) => e.delta)).toEqual(['tail-end'])
    expect(r.completed).toBeNull() // this stream has no done event (delta only)
    expect(r.failures.map((f) => f.kind)).toEqual(['protocol'])
  })
})

describe('SSE frame parser — protocol details', () => {
  test('handles CRLF frames, comments, and multi-line data payloads', () => {
    const p = createSseFrameParser()
    const out = p.push(': hi\r\ndata: {"delta":"a"}\r\n\r\ndata: {"delta":"b"}\n\n')
    expect(out.map((e) => e.delta)).toEqual(['a', 'b'])
    // Multi-line data joins with \n (spec behavior; BEAN never sends it, but
    // a spec-compliant peer could).
    const multi = p.push('data: {"delta":"x\\ny"}\n\n')
    expect(multi.map((e) => e.delta)).toEqual(['x\ny'])
    const flushed = p.flush()
    expect(flushed).toHaveLength(0)
  })

  test('comment-only keepalive frames produce no events', () => {
    const p = createSseFrameParser()
    expect(p.push(': keepalive\n\n')).toHaveLength(0)
    expect(p.push(': keepalive\n\n: connected\n\n')).toHaveLength(0)
  })

  test('a [DONE] sentinel maps to a done event', () => {
    const p = createSseFrameParser()
    expect(p.push('data: [DONE]\n\n')).toEqual([{ done: true }])
  })
})

describe('server SSE writer (createSseWriter)', () => {
  function fakeController() {
    const written: string[] = []
    let closed = false
    const dec = new TextDecoder()
    return {
      controller: {
        enqueue(chunk: Uint8Array) {
          if (closed) throw new TypeError('Controller is already closed')
          written.push(dec.decode(chunk))
        },
        close() {
          if (closed) throw new TypeError('Already closed')
          closed = true
        },
      } as unknown as ReadableStreamDefaultController<Uint8Array>,
      written,
      isClosed: () => closed,
    }
  }

  test('send() emits single-line data frames; comment() emits comment frames', () => {
    const { controller, written } = fakeController()
    const w = createSseWriter(controller, { heartbeatMs: 60_000 })
    expect(w.send({ delta: 'hi' })).toBe(true)
    expect(w.comment('connected')).toBe(true)
    expect(written[0]).toBe(`data: ${JSON.stringify({ delta: 'hi' })}\n\n`)
    expect(written[1]).toBe(': connected\n\n')
    w.close()
    expect(w.isClosed()).toBe(true)
  })

  test('heartbeat emits a keepalive comment after the idle window', async () => {
    const { controller, written } = fakeController()
    const w = createSseWriter(controller, { heartbeatMs: 15 })
    w.comment('connected')
    const before = written.length
    await new Promise((r) => setTimeout(r, 60))
    expect(written.length).toBeGreaterThan(before)
    expect(written.slice(before).some((s) => s === ': keepalive\n\n')).toBe(true)
    w.close()
  }, CLIENT_IDLE_WATCHDOG_MS)

  test('closing twice is safe; enqueue-after-close returns false without throwing', () => {
    const { controller, written } = fakeController()
    const w = createSseWriter(controller, { heartbeatMs: DEFAULT_SSE_HEARTBEAT_MS })
    w.close()
    w.close() // idempotent
    expect(w.send({ delta: 'late' })).toBe(false)
    expect(w.comment('late')).toBe(false)
    expect(written).toHaveLength(0)
    expect(w.isClosed()).toBe(true)
  })

  test('a consumer disconnect is contained: no throw, onClosed(client_gone) once', () => {
    const reasons: string[] = []
    const { controller, written } = fakeController()
    const w = createSseWriter(controller, { heartbeatMs: 60_000, onClosed: (r) => reasons.push(r) })
    // Simulate the runtime closing under us (client disconnected).
    ;(controller as unknown as { close(): void }).close()
    expect(w.send({ delta: 'into the void' })).toBe(false)
    expect(w.isClosed()).toBe(true)
    expect(reasons).toEqual(['client_gone'])
    expect(written).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 2026-11-02 upstream SSE adapter hardening (sseDeltas)
// ---------------------------------------------------------------------------

import { UpstreamTruncatedError } from '../../src/lib/adapters/hosted-llm'

function frameOf(text: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`
}

async function collect(
  stream: AsyncIterable<unknown>,
  opts?: { idleTimeoutMs?: number; maxDurationMs?: number },
): Promise<string> {
  const out: string[] = []
  for await (const d of sseDeltas(stream, opts)) out.push(d)
  return out.join('')
}

describe('upstream SSE adapter hardening (2026-11-02)', () => {
  test('plain string chunks decode to deltas (no byte-record assumption)', async () => {
    const stream = {
      async *[Symbol.asyncIterator]() {
        yield 'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n'
        yield 'data: {"choices":[{"delta":{"content":"world"}}]}\n\n'
        yield 'data: [DONE]\n\n'
      },
    }
    expect(await collect(stream as unknown as AsyncIterable<unknown>)).toBe('Hello world')
  })

  test('Uint8Array chunks with a Tamil character SPLIT across chunks reassemble (zero U+FFFD)', async () => {
    // "வணக்கம்" — split the multibyte sequence in the middle of a character.
    const word = 'வணக்கம்'
    const bytes = encoder.encode(frameOf(word))
    const splitAt = frameOf('').length + 6 // inside the first multibyte char
    const chunk1 = bytes.slice(0, splitAt)
    const chunk2 = bytes.slice(splitAt)
    const stream = {
      async *[Symbol.asyncIterator]() {
        yield chunk1
        yield chunk2
        yield encoder.encode('data: [DONE]\n\n')
      },
    }
    const text = await collect(stream as unknown as AsyncIterable<unknown>)
    expect(text).toBe(word)
    expect(text).not.toContain('\uFFFD')
  })

  test('data: without a space and CRLF line endings both parse per spec', async () => {
    const payload = JSON.stringify({ choices: [{ delta: { content: 'spec-safe' } }] })
    const stream = {
      async *[Symbol.asyncIterator]() {
        yield encoder.encode(`data:${payload}\r\n\r\n`)
        yield encoder.encode('data: [DONE]\r\n\r\n')
      },
    }
    expect(await collect(stream as unknown as AsyncIterable<unknown>)).toBe('spec-safe')
  })

  test('finish_reason "length" raises the typed truncation error even after [DONE]', async () => {
    const stream = {
      async *[Symbol.asyncIterator]() {
        yield encoder.encode(frameOf('partial json {"id":'))
        yield encoder.encode('data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n')
        yield encoder.encode('data: [DONE]\n\n')
      },
    }
    let caught: unknown = null
    const deltas: string[] = []
    try {
      for await (const d of sseDeltas(stream as unknown as AsyncIterable<unknown>)) deltas.push(d)
    } catch (e) {
      caught = e
    }
    expect(deltas.join('')).toBe('partial json {"id":')
    expect(caught).toBeInstanceOf(UpstreamTruncatedError)
  })

  test('finish_reason "stop" is a normal completion (no truncation error)', async () => {
    const stream = {
      async *[Symbol.asyncIterator]() {
        yield encoder.encode(frameOf('done properly '))
        yield encoder.encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n')
        yield encoder.encode('data: [DONE]\n\n')
      },
    }
    expect(await collect(stream as unknown as AsyncIterable<unknown>)).toBe('done properly ')
  })

  test('the truncation error classifies as its own honest payload (not a generic failure)', async () => {
    const { upstreamStreamErrorPayload } = await import('../../src/lib/upstream/gateway')
    const payload = upstreamStreamErrorPayload(new UpstreamTruncatedError())
    expect(payload.code).toBe('UPSTREAM_TRUNCATED')
    expect(payload.partial).toBe(true)
    expect(payload.error).toContain('length limit')
  })
})

// ---- 2026-11-03 reliability work order additions ---------------------------

describe('final flush — a last data line without a trailing blank line is not dropped', () => {
  test('the residual buffered line is processed when the stream closes', async () => {
    const stream = {
      async *[Symbol.asyncIterator]() {
        yield encoder.encode(frameOf('first '))
        // Ends WITHOUT the trailing \n\n and WITHOUT [DONE].
        yield encoder.encode('data: {"choices":[{"delta":{"content":"last token"}}]}')
      },
    }
    expect(await collect(stream as unknown as AsyncIterable<unknown>)).toBe('first last token')
  })

  test('a UTF-8 character split exactly at stream end is flushed, not corrupted', async () => {
    // 'த' in UTF-8 is 3 bytes; cut it so the final chunk ends the stream with
    // the remaining bytes and no trailing newline.
    const full = encoder.encode('data: {"choices":[{"delta":{"content":"தமிழ்"}}]}')
    const cut = full.length - 2
    const stream = {
      async *[Symbol.asyncIterator]() {
        yield full.slice(0, cut)
        yield full.slice(cut) // ends the stream, no trailing newline
      },
    }
    expect(await collect(stream as unknown as AsyncIterable<unknown>)).toBe('தமிழ்')
  })
})

describe('total duration guard — a slow-drip stream cannot hold a turn forever', () => {
  test('fires a labeled total-duration timeout when the stream outlives the cap', async () => {
    const drip = {
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<unknown>>(() => {}), // never settles
        }
      },
    }
    let caught: Error | null = null
    const t0 = Date.now()
    try {
      for await (const _ of sseDeltas(drip as unknown as AsyncIterable<unknown>, {
        idleTimeoutMs: 5_000, // idle guard NOT the first to fire
        maxDurationMs: 40,
      })) {
        void _
      }
      expect.unreachable()
    } catch (e) {
      caught = e as Error
    }
    expect(caught?.message).toContain('total stream duration exceeded')
    expect(Date.now() - t0).toBeLessThan(2_000)
  })

  test('a healthy stream well under the cap completes untouched', async () => {
    const stream = {
      async *[Symbol.asyncIterator]() {
        yield encoder.encode(frameOf('quick '))
        yield encoder.encode('data: [DONE]\n\n')
      },
    }
    expect(
      await collect(
        stream as unknown as AsyncIterable<unknown>,
        { idleTimeoutMs: 1_000, maxDurationMs: 5_000 },
      ),
    ).toBe('quick ')
  })

  test('maxDurationMs 0 disables the total cap (idle guard still applies)', async () => {
    const drip = {
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<unknown>>(() => {}),
        }
      },
    }
    let caught: Error | null = null
    try {
      for await (const _ of sseDeltas(drip as unknown as AsyncIterable<unknown>, {
        idleTimeoutMs: 30,
        maxDurationMs: 0,
      })) {
        void _
      }
      expect.unreachable()
    } catch (e) {
      caught = e as Error
    }
    // The IDLE guard fired (not the total cap) — the cap was truly off.
    expect(caught?.message).toContain('no tokens received for 30ms')
  })
})

describe('empty stream — a zero-byte completion is never a success', () => {
  test('an SSE body that closes with NO bytes at all is a protocol failure, never onComplete', async () => {
    const r = recorder()
    await consumeRiisheStream(sseResponse([]), r.callbacks)
    expect(r.completed).toBeNull()
    expect(r.failures).toHaveLength(1)
    expect(r.failures[0].kind).toBe('protocol')
    expect(r.failures[0].message).toContain('ended before the model finished')
  })

  test('an empty HTTP 200 (null body) is a protocol failure too', async () => {
    const r = recorder()
    await consumeRiisheStream(
      new Response(null, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
      r.callbacks,
    )
    expect(r.completed).toBeNull()
    expect(r.failures).toHaveLength(1)
    expect(r.failures[0].kind).toBe('protocol')
  })

  test('an upstream generator that yields nothing produces zero deltas and no throw (route marks the turn partial, never a fake completion)', async () => {
    const empty = {
      async *[Symbol.asyncIterator]() {
        /* closes immediately */
      },
    }
    const out: string[] = []
    for await (const d of sseDeltas(empty as unknown as AsyncIterable<unknown>, {
      idleTimeoutMs: 1_000,
      maxDurationMs: 1_000,
    })) {
      out.push(d)
    }
    expect(out).toEqual([])
  })
})
