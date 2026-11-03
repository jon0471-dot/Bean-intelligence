/**
 * BEAN Intelligence — CODE GIFTZ chat turn lifecycle regression tests.
 * Run: bun test tests/unit/giftz-chat-stream.test.ts
 *
 * The 2026-11-03 work order required the streaming turn lifecycle to be
 * reliable end-to-end. These tests run against the REAL production lifecycle
 * (src/lib/giftz/chat-stream.ts — the exact module the route wires) with only
 * the dependencies fault-injected (fake generation, fake persistence).
 * No network calls, no DB.
 *
 * Root cause they pin (dev.log 2026-11-03T04:29:45Z):
 *   codegiftz.chat_failed "Invalid state: Controller is already closed" —
 *   a client disconnect mid-generation used to make controller.enqueue throw,
 *   the catch's error-frame enqueue throw again, and the finally's close()
 *   throw a third time. With the extracted lifecycle those throws are
 *   structurally impossible (asserted here).
 */
import { describe, test, expect } from 'bun:test'
import {
  createGiftzChatStream,
  ClientDisconnectedError,
  type GiftzChatStreamDeps,
  type GiftzTurnResult,
} from '../../src/lib/giftz/chat-stream'
import { UpstreamTruncatedError } from '../../src/lib/adapters/hosted-llm'
import { upstreamStreamErrorPayload, UpstreamRateLimitError } from '../../src/lib/upstream/gateway'

// ---- harness ----------------------------------------------------------------

const encoder = new TextEncoder()

async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let out = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    out += decoder.decode(value, { stream: true })
  }
  return out + decoder.decode()
}

type WireFrame = Record<string, unknown>
function framesOf(raw: string): WireFrame[] {
  return raw
    .split('\n\n')
    .filter((f) => f.startsWith('data: '))
    .map((f) => JSON.parse(f.slice(6)) as WireFrame)
}
function keepalivesOf(raw: string): number {
  return raw.split('\n\n').filter((f) => f.trim() === ': keepalive').length
}
function terminalFrames(frames: WireFrame[]): WireFrame[] {
  return frames.filter((f) => f.done !== undefined || f.error !== undefined)
}

function turnResult(content: string, changes: GiftzTurnResult['changes'] = []): GiftzTurnResult {
  return { content, changes, durationMs: 5, tokensInEst: 1, tokensOutEst: 2, continuationCount: 0 }
}

/** Standard fake deps: emits the given deltas through onEvent, then returns. */
function fakeDeps(overrides: Partial<GiftzChatStreamDeps> = {}): GiftzChatStreamDeps & {
  persisted: string[]
  releases: number
} {
  const state = { persisted: [] as string[], releases: 0 }
  const deps: GiftzChatStreamDeps = {
    projectId: 'proj-1',
    runTurn: async (onEvent) => {
      onEvent?.({ stage: 'thinking' })
      for (const d of ['Hello ', 'world']) onEvent?.({ delta: d })
      return turnResult('Hello world')
    },
    persistAssistant: async (result) => {
      state.persisted.push(result.content)
      return { messageId: 'msg-1' }
    },
    afterPersist: async () => ({ files: [{ path: 'main.js', origin: 'generated' }] }),
    failurePayload: upstreamStreamErrorPayload,
    release: () => {
      state.releases += 1
    },
    heartbeatMs: 0,
    disconnectSignal: null,
    log: () => {},
    ...overrides,
  }
  return {
    ...deps,
    get persisted() {
      return state.persisted
    },
    get releases() {
      return state.releases
    },
  } as GiftzChatStreamDeps & { persisted: string[]; releases: number }
}

// Unhandled-rejection guard: Bun itself fails the whole run on any unhandled
// rejection (verified — a leaked lifecycle error cannot pass silently), so no
// custom listener is needed; the lifecycle must simply never produce one.

// ---- scenarios ---------------------------------------------------------------

describe('successful turn — short stream completes with exactly one terminal', () => {
  test('thinking → deltas → done(messageId) in order; persisted exactly once; released once', async () => {
    const deps = fakeDeps()
    const raw = await drain(createGiftzChatStream(deps))
    const frames = framesOf(raw)
    expect(frames[0]).toEqual({ stage: 'thinking' })
    expect(frames[1]).toEqual({ delta: 'Hello ', projectId: 'proj-1' })
    expect(frames[2]).toEqual({ delta: 'world', projectId: 'proj-1' })
    const terminals = terminalFrames(frames)
    expect(terminals).toHaveLength(1)
    expect(terminals[0].done).toBe(true)
    expect(terminals[0].messageId).toBe('msg-1')
    expect(terminals[0].projectId).toBe('proj-1')
    expect(Array.isArray(terminals[0].changes)).toBe(true)
    expect(terminals[0].files).toEqual([{ path: 'main.js', origin: 'generated' }])
    expect(deps.persisted).toEqual(['Hello world'])
    expect(deps.releases).toBe(1)
  })
})

describe('successful turn — long stream (many deltas, large content)', () => {
  test('every delta arrives in order; content persists byte-exact', async () => {
    const chunks = Array.from({ length: 200 }, (_, i) => `chunk-${i} `)
    const big = `Here is the code:\n\n\`\`\`js path=main.js\n${'x'.repeat(20_000)}\n\`\`\`\n\n\`\`\`css path=style.css\nbody { color: gold }\n\`\`\`\n`
    const deps = fakeDeps({
      runTurn: async (onEvent) => {
        for (const c of chunks) onEvent?.({ delta: c })
        for (const c of big.match(/[\s\S]{1,500}/g) ?? []) onEvent?.({ delta: c })
        return turnResult(chunks.join('') + big)
      },
    })
    const raw = await drain(createGiftzChatStream(deps))
    const frames = framesOf(raw)
    const deltas = frames.filter((f) => typeof f.delta === 'string') as Array<{ delta: string }>
    expect(deltas.map((d) => d.delta).join('')).toBe(chunks.join('') + big)
    expect(terminalFrames(frames)).toHaveLength(1)
    expect(deps.persisted[0]).toBe(chunks.join('') + big)
  })
})

describe('provider error during generation', () => {
  test('a 429 produces ONE typed UPSTREAM_RATE_LIMITED error frame, no done, no persistence', async () => {
    const deps = fakeDeps({
      runTurn: async () => {
        throw new UpstreamRateLimitError('chat', 'chat completion is rate-limited upstream (HTTP 429)')
      },
    })
    const raw = await drain(createGiftzChatStream(deps))
    const frames = framesOf(raw)
    const terminals = terminalFrames(frames)
    expect(terminals).toHaveLength(1)
    expect(terminals[0].done).toBeUndefined()
    expect(terminals[0].code).toBe('UPSTREAM_RATE_LIMITED')
    expect(String(terminals[0].error)).toContain('rate-limited')
    expect(deps.persisted).toEqual([])
    expect(deps.releases).toBe(1)
  })

  test('an upstream transport death (fetch failed) is its own honest class', async () => {
    const deps = fakeDeps({
      runTurn: async (onEvent) => {
        onEvent?.({ delta: 'partial ' })
        throw new Error('fetch failed')
      },
    })
    const raw = await drain(createGiftzChatStream(deps))
    const terminals = terminalFrames(framesOf(raw))
    expect(terminals).toHaveLength(1)
    expect(terminals[0].code).toBe('UPSTREAM_NETWORK')
    expect(String(terminals[0].error)).toContain('connection to the AI provider was lost')
  })

  test('an upstream stall/timeout is UPSTREAM_TIMEOUT, not a generic failure', async () => {
    const deps = fakeDeps({
      runTurn: async () => {
        throw new Error('upstream stream timed out: no tokens received for 120000ms')
      },
    })
    const terminals = terminalFrames(framesOf(await drain(createGiftzChatStream(deps))))
    expect(terminals).toHaveLength(1)
    expect(terminals[0].code).toBe('UPSTREAM_TIMEOUT')
  })

  test('an output-limit truncation is UPSTREAM_TRUNCATED with partial text preserved on the wire', async () => {
    const deps = fakeDeps({
      runTurn: async (onEvent) => {
        onEvent?.({ delta: 'the beginning of a long answer ' })
        throw new UpstreamTruncatedError()
      },
    })
    const raw = await drain(createGiftzChatStream(deps))
    const frames = framesOf(raw)
    expect(frames.some((f) => f.delta === 'the beginning of a long answer ')).toBe(true)
    const terminals = terminalFrames(frames)
    expect(terminals).toHaveLength(1)
    expect(terminals[0].code).toBe('UPSTREAM_TRUNCATED')
  })

  test('an empty upstream response is a failure, never a fake completion', async () => {
    const deps = fakeDeps({
      runTurn: async () => {
        // The route turns empty content into a typed BeanApiError before
        // persistence; model that honestly here.
        throw new Error('The coding backend returned an empty response.')
      },
    })
    const terminals = terminalFrames(framesOf(await drain(createGiftzChatStream(deps))))
    expect(terminals).toHaveLength(1)
    expect(terminals[0].code).toBe('BACKEND_FAILURE')
  })
})

describe('user cancellation — Stop / disconnect', () => {
  test('cancel() mid-generation unwinds the turn, persists nothing, sends NO error frame, releases once', async () => {
    let loopUnwound = false
    const deps = fakeDeps({
      runTurn: async (onEvent, guard) => {
        onEvent?.({ delta: 'first ' })
        try {
          // Keep emitting until cancelled (a long generation). The guard can
          // unwind via the loop check OR via the lifecycle's onEvent callback
          // (which throws ClientDisconnectedError once the client is gone) —
          // both mean the generation stopped consuming the upstream.
          for (let i = 0; i < 500; i++) {
            if (guard.aborted) throw new ClientDisconnectedError()
            await new Promise((r) => setTimeout(r, 2))
            onEvent?.({ delta: 'more ' })
          }
          return turnResult('unreachable')
        } finally {
          loopUnwound = true
        }
      },
    })
    const stream = createGiftzChatStream(deps)
    const reader = stream.getReader()
    await reader.read() // stage thinking
    await reader.read() // first delta
    await reader.cancel() // the user pressed Stop
    await new Promise((r) => setTimeout(r, 60))
    expect(loopUnwound).toBe(true) // generation stopped promptly, not run to completion
    expect(deps.persisted).toEqual([]) // incomplete turn persisted nothing
    expect(deps.releases).toBe(1)
  })

  test('request.signal abort (browser disconnect) also unwinds the generation', async () => {
    const signal = new AbortController()
    let loopUnwound = false
    const deps = fakeDeps({
      disconnectSignal: signal.signal,
      runTurn: async (_onEvent, guard) => {
        try {
          for (let i = 0; i < 500; i++) {
            if (guard.aborted) throw new ClientDisconnectedError()
            await new Promise((r) => setTimeout(r, 2))
          }
          return turnResult('unreachable')
        } finally {
          loopUnwound = true
        }
      },
    })
    const stream = createGiftzChatStream(deps)
    const reading = drain(stream)
    await new Promise((r) => setTimeout(r, 10))
    signal.abort()
    await reading.catch(() => '')
    await new Promise((r) => setTimeout(r, 30))
    expect(loopUnwound).toBe(true)
    expect(deps.persisted).toEqual([])
    expect(deps.releases).toBe(1)
  })

  test('a FULLY generated answer is persisted even when the client vanished before done', async () => {
    const signal = new AbortController()
    const deps = fakeDeps({
      disconnectSignal: signal.signal,
      runTurn: async (onEvent, guard) => {
        // Ignores the guard (generation was already finished upstream).
        onEvent?.({ delta: 'complete answer' })
        void guard
        return turnResult('complete answer')
      },
    })
    const stream = createGiftzChatStream(deps)
    const reading = drain(stream)
    await new Promise((r) => setTimeout(r, 5))
    signal.abort() // client disconnects right as generation completes
    await reading.catch(() => '')
    await new Promise((r) => setTimeout(r, 20))
    expect(deps.persisted).toEqual(['complete answer'])
    expect(deps.releases).toBe(1)
  })
})

describe('persistence and post-persistence reliability', () => {
  test('a persistence failure yields ONE honest PERSIST_FAILED frame — no done, no usage', async () => {
    let usageCalls = 0
    const deps = fakeDeps({
      persistAssistant: async () => {
        throw new Error('UNIQUE constraint failed')
      },
      afterPersist: async () => {
        usageCalls += 1
      },
    })
    const raw = await drain(createGiftzChatStream(deps))
    const frames = framesOf(raw)
    const terminals = terminalFrames(frames)
    expect(terminals).toHaveLength(1)
    expect(terminals[0].done).toBeUndefined()
    expect(terminals[0].code).toBe('PERSIST_FAILED')
    expect(String(terminals[0].error)).toContain('could not be saved')
    expect(usageCalls).toBe(0)
    expect(deps.releases).toBe(1)
  })

  test('usage/audit failing AFTER persistence never breaks the completed turn', async () => {
    const deps = fakeDeps({
      afterPersist: async () => {
        throw new Error('metering write failed')
      },
    })
    const raw = await drain(createGiftzChatStream(deps))
    const frames = framesOf(raw)
    const terminals = terminalFrames(frames)
    expect(terminals).toHaveLength(1)
    expect(terminals[0].done).toBe(true) // the answer WAS persisted and complete
    expect(deps.persisted).toEqual(['Hello world'])
  })
})

describe('heartbeats during silent stretches', () => {
  test(': keepalive comment frames flow while the model is thinking, and are never content', async () => {
    const deps = fakeDeps({
      heartbeatMs: 10,
      runTurn: async (onEvent) => {
        await new Promise((r) => setTimeout(r, 55)) // silent "thinking" pause
        onEvent?.({ delta: 'late token' })
        return turnResult('late token')
      },
    })
    const raw = await drain(createGiftzChatStream(deps))
    expect(keepalivesOf(raw)).toBeGreaterThanOrEqual(2)
    const frames = framesOf(raw)
    expect(frames.filter((f) => typeof f.delta === 'string')).toHaveLength(1)
    expect(terminalFrames(frames)).toHaveLength(1)
    expect(terminalFrames(frames)[0].done).toBe(true)
  })
})

describe('recovery after a failed generation', () => {
  test('a turn after a failed one completes normally (no poisoned lifecycle state)', async () => {
    let failFirst = true
    const deps = fakeDeps({
      runTurn: async () => {
        if (failFirst) {
          failFirst = false
          throw new Error('transient upstream failure')
        }
        return turnResult('recovered answer')
      },
    })
    const first = terminalFrames(framesOf(await drain(createGiftzChatStream(deps))))
    expect(first).toHaveLength(1)
    expect(first[0].error).toBeDefined()
    const secondFrames = framesOf(await drain(createGiftzChatStream(deps)))
    const second = terminalFrames(secondFrames)
    expect(second).toHaveLength(1)
    expect(second[0].done).toBe(true)
    expect(deps.persisted).toEqual(['recovered answer'])
    expect(deps.releases).toBe(2)
  })
})

// ---- controlled continuation for output-limit truncation --------------------

import { generateTurnWithContinuation } from '../../src/lib/giftz/chat-stream'
import type { ChatTurn } from '../../src/lib/adapters/types'

/** Fake upstream pass: streams the given chunks; `cut` throws the typed
 *  truncation error mid-pass (as sseDeltas does on finish_reason length). */
function fakeUpstreamPass(script: Array<{ chunks: string[]; cut?: boolean }>) {
  let call = 0
  const seenMessages: ChatTurn[][] = []
  return {
    seenMessages,
    chatStream: (messages: ChatTurn[]) => {
      seenMessages.push(messages)
      const step = script[Math.min(call, script.length - 1)]
      call += 1
      return (async function* () {
        for (const chunk of step.chunks) yield chunk
        if (step.cut) throw new UpstreamTruncatedError()
      })()
    },
  }
}

const BASE: ChatTurn[] = [
  { role: 'assistant', content: 'system' },
  { role: 'user', content: 'build it' },
]

describe('generateTurnWithContinuation — a length-capped answer continues, never fakes completion', () => {
  test('single pass completes: content, continuationCount 0, deltas forwarded', async () => {
    const upstream = fakeUpstreamPass([{ chunks: ['Hello ', 'world'] }])
    const deltas: string[] = []
    const out = await generateTurnWithContinuation({
      baseMessages: BASE,
      chatStream: upstream.chatStream,
      onDelta: (d) => deltas.push(d),
    })
    expect(out).toEqual({ content: 'Hello world', continuationCount: 0 })
    expect(deltas.join('')).toBe('Hello world')
    expect(upstream.seenMessages).toHaveLength(1)
  })

  test('pass 1 truncated mid-fence → pass 2 continues EXACTLY there; one continuous delta stream', async () => {
    const upstream = fakeUpstreamPass([
      { chunks: ['Here is the code:\n\n```js path=main.js\nconsole.log(', '1)\n'], cut: true },
      { chunks: ['```\n\nThat completes the file.'] },
    ])
    const deltas: string[] = []
    const out = await generateTurnWithContinuation({
      baseMessages: BASE,
      chatStream: upstream.chatStream,
      onDelta: (d) => deltas.push(d),
    })
    expect(out.continuationCount).toBe(1)
    expect(out.content).toBe('Here is the code:\n\n```js path=main.js\nconsole.log(1)\n```\n\nThat completes the file.')
    // Every delta of every pass reached the client, in order.
    expect(deltas.join('')).toBe(out.content)
    // The continuation messages carry the accumulated partial as the assistant turn.
    const cont = upstream.seenMessages[1]
    expect(cont[cont.length - 2].role).toBe('assistant')
    expect(cont[cont.length - 2].content).toContain('console.log(')
    expect(cont[cont.length - 1].role).toBe('user')
  })

  test('bound reached (both passes truncated) → typed truncation error with the FULL partial attached', async () => {
    const upstream = fakeUpstreamPass([
      { chunks: ['part-one '], cut: true },
      { chunks: ['part-two '], cut: true },
    ])
    const deltas: string[] = []
    let caught: unknown = null
    try {
      await generateTurnWithContinuation({
        baseMessages: BASE,
        chatStream: upstream.chatStream,
        onDelta: (d) => deltas.push(d),
        maxContinuations: 1,
      })
      expect.unreachable()
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(UpstreamTruncatedError)
    expect((caught as UpstreamTruncatedError).partialText).toBe('part-one part-two ')
    expect(deltas.join('')).toBe('part-one part-two ') // client kept every streamed token
    expect(upstreamStreamErrorPayload(caught).code).toBe('UPSTREAM_TRUNCATED')
  })

  test('a cancelled turn unwinds through a continuation pass as cancellation, not truncation', async () => {
    const guard = { aborted: false }
    const upstream = fakeUpstreamPass([{ chunks: ['first-pass-tail'] }])
    let caught: unknown = null
    try {
      await generateTurnWithContinuation({
        baseMessages: BASE,
        chatStream: (messages) =>
          (async function* () {
            yield 'pass-one '
            guard.aborted = true // client disconnects between passes/next delta
            yield 'trigger '
            void messages
          })(),
        guard,
      })
      expect.unreachable()
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(ClientDisconnectedError)
  })

  test('truncation with an EMPTY first pass propagates honestly (nothing to continue from)', async () => {
    const upstream = fakeUpstreamPass([{ chunks: [], cut: true }])
    let caught: unknown = null
    try {
      await generateTurnWithContinuation({
        baseMessages: BASE,
        chatStream: upstream.chatStream,
      })
      expect.unreachable()
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(UpstreamTruncatedError)
    // No usable partial rides on the error (empty string = nothing to continue
    // from; solveWithContinuation's documented contract) — no fake completion.
    expect((caught as UpstreamTruncatedError).partialText).toBeFalsy()
  })
})
