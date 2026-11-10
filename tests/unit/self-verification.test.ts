/**
 * Self-verification engine tests (work order Part 4 — the 12 test categories).
 *
 * Boundaries: the hosted adapter's chat method is monkey-patched (save /
 * restore — the module itself stays REAL, so the pipeline exercises the real
 * gateway planning, registry resolution and adapter seam) and the database is
 * a mock.module fake (settings + credential lookups only). No test touches
 * the real DB and no test calls any provider.
 *
 * The 12 categories, mapped to tests:
 *  1.  correct answer ............... 'verified', draft preserved, 1 pass
 *  2.  wrong calculation ............ critical issue → revision → 'corrected'
 *  3.  missing requirement .......... major issue → revision → 'corrected'
 *  4.  contradictory instructions ... factual contradiction → revision
 *  5.  ambiguous request ............ low-confidence pass → honest 'unverified'
 *  6.  code generation .............. code/syntax issue → revision
 *  7.  event-loop / order ........... 'order' issue → revision
 *  8.  verification failure ......... verifier call throws → 'unverified',
 *                                     draft preserved (never fabricated)
 *  9.  regeneration bound ........... verify-only (limit 0) and bound
 *                                     exhaustion — bounded calls, no loop
 *  10. cancellation ................. between passes AND mid-revision —
 *                                     ClientDisconnectedError always unwinds
 *  11. streaming .................... streamed revision deltas assemble the
 *                                     full corrected answer; stages reported
 *  12. timeout ...................... verifier timeout → honest 'unverified'
 *
 * Honesty contract pinned here: the pipeline NEVER claims verification it did
 * not obtain, never shows verifier reasoning to the user surface, and its
 * call count is structurally bounded by config clamps.
 *
 * Run: bun test tests/unit/self-verification.test.ts
 */
import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'

// ---- database fake (settings + credential lookup; nothing else used here) ---

let settingsRow: { key: string; value: string; updatedBy?: string; updatedAt: Date } | null = null

const dbFake = {
  systemSetting: {
    async findUnique({ where }: { where: { key: string } }) {
      if (settingsRow && settingsRow.key === where.key) return settingsRow
      return null
    },
  },
  providerCredential: {
    async findFirst() {
      return null // no external provider configured in these tests
    },
  },
  usageRecord: {
    async create({ data }: { data: Record<string, unknown> }) {
      return data
    },
    async count() {
      return 0
    },
  },
  gatewayRequestLog: {
    async create({ data }: { data: Record<string, unknown> }) {
      return data
    },
  },
}
mock.module('@/lib/db', () => ({ db: dbFake }))

// ---- imports under test (AFTER the mock) -------------------------------------

const { verifyAndCorrect, publicVerificationSummary, parseVerifierReport } = await import(
  '../../src/lib/verification/pipeline'
)
const { verificationConfig, DEFAULT_VERIFICATION_CONFIG, hardCaps, SETTING_KEY } = await import(
  '../../src/lib/verification/config'
)
const { hostedLlmAdapter } = await import('../../src/lib/adapters/hosted-llm')
const { _resetUpstreamCooldownForTests } = await import('../../src/lib/upstream/gateway')
const { ClientDisconnectedError } = await import('../../src/lib/giftz/chat-stream')

// ---- verifier scripting harness ---------------------------------------------

type ScriptedCall =
  | { respond: string } // verifier reply body (JSON report or junk)
  | { failWith: Error } // verifier call throws (timeout, network, …)

const verifierScript: ScriptedCall[] = []
const revisions: string[] = []
const verifierCalls: Array<{ system: string; user: string; timeoutMs: number }> = []
const stages: Array<'verifying' | 'revising'> = []

const realChat = hostedLlmAdapter.chat
const realChatStream = hostedLlmAdapter.chatStream

function installVerifierFake(): void {
  hostedLlmAdapter.chat = async function (req: { messages: Array<{ role: string; content: string }>; timeoutMs: number }) {
    const call = verifierScript.shift()
    verifierCalls.push({
      system: req.messages[0]?.role === 'assistant' ? req.messages[0].content : '',
      user: [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? '',
      timeoutMs: req.timeoutMs,
    })
    if (!call) throw new Error('verifier script exhausted — pipeline made an unbounded call')
    if ('failWith' in call) throw call.failWith
    return { content: call.respond, tokensInEst: 10, tokensOutEst: 5, durationMs: 3 }
  } as typeof hostedLlmAdapter.chat
  hostedLlmAdapter.chatStream = async function* () {
    // The pipeline's own streamRevision generator is supplied by the TEST —
    // the gateway streaming path is not used in these scenarios.
    yield ''
  } as typeof hostedLlmAdapter.chatStream
}

function restoreHosted(): void {
  hostedLlmAdapter.chat = realChat
  hostedLlmAdapter.chatStream = realChatStream
}

beforeEach(() => {
  _resetUpstreamCooldownForTests()
  installVerifierFake()
  verifierScript.length = 0
  revisions.length = 0
  verifierCalls.length = 0
  stages.length = 0
  settingsRow = null
})
afterEach(() => {
  restoreHosted()
})

function verifierReport(overrides: Partial<{ verdict: string; confidence: number; issues: unknown[] }> = {}): string {
  return JSON.stringify({
    verdict: overrides.verdict ?? 'pass',
    confidence: overrides.confidence ?? 0.9,
    issues: overrides.issues ?? [],
  })
}

function issue(severity: 'critical' | 'major' | 'minor', type: string, description: string, correction: string) {
  return { severity, type, description, correction }
}

const CTX = { userId: 'user-1', apiKeyId: null, authKind: 'internal' as const, endpoint: 'self-verification-test', signal: null }

const DEFAULT_CFG = {
  ...DEFAULT_VERIFICATION_CONFIG,
  enabled: true,
  verificationModel: 'bean-code-hosted',
}

describe('self-verification — the 12 work-order categories', () => {
  // 1 ---------------------------------------------------------------------
  test('1. correct answer: verification passes → verified, draft preserved, exactly one pass', async () => {
    verifierScript.push({ respond: verifierReport({ verdict: 'pass', confidence: 0.92 }) })
    const outcome = await verifyAndCorrect({
      originalRequest: 'Write a function that reverses a string.',
      draft: 'function reverse(s) { return [...s].reverse().join("") }',
      config: DEFAULT_CFG,
      ctx: CTX,
    })
    expect(outcome.status).toBe('verified')
    expect(outcome.finalContent).toBe('function reverse(s) { return [...s].reverse().join("") }')
    expect(outcome.attempts).toBe(1)
    expect(outcome.corrections).toBe(0)
    expect(outcome.issuesFound).toBe(0)
    expect(verifierCalls).toHaveLength(1)
  })

  // 2 ---------------------------------------------------------------------
  test('2. wrong calculation: critical issue triggers revision, corrected answer re-verifies', async () => {
    verifierScript.push({
      respond: verifierReport({
        verdict: 'fail',
        confidence: 0.2,
        issues: [issue('critical', 'calculation', 'The draft claims 2+2=5.', 'Recompute: 2+2=4 and update every derived value.')],
      }),
    })
    verifierScript.push({ respond: verifierReport({ verdict: 'pass', confidence: 0.88 }) })
    const outcome = await verifyAndCorrect({
      originalRequest: 'What is 2+2?',
      draft: '2+2 is 5.',
      config: DEFAULT_CFG,
      ctx: CTX,
      generateRevision: async (instruction) => {
        revisions.push(instruction)
        return '2+2 is 4.'
      },
    })
    expect(outcome.status).toBe('corrected')
    expect(outcome.finalContent).toBe('2+2 is 4.')
    expect(outcome.corrections).toBe(1)
    expect(outcome.attempts).toBe(2)
    expect(verifierCalls).toHaveLength(2)
    // The revision instruction carries the verifier's actionable correction.
    expect(revisions[0]).toContain('2+2=4')
    expect(revisions[0]).toContain('calculation')
  })

  // 3 ---------------------------------------------------------------------
  test('3. missing requirement: major issue → revision restores the dropped deliverable', async () => {
    verifierScript.push({
      respond: verifierReport({
        verdict: 'fail',
        confidence: 0.3,
        issues: [issue('major', 'requirement', 'The request asked for error handling; the draft silently dropped it.', 'Add the try/catch with the documented error value.')],
      }),
    })
    verifierScript.push({ respond: verifierReport({ verdict: 'pass', confidence: 0.85 }) })
    const outcome = await verifyAndCorrect({
      originalRequest: 'Parse the CSV and handle errors.',
      draft: 'Parses the CSV. (no error handling)',
      config: DEFAULT_CFG,
      ctx: CTX,
      generateRevision: async () => 'Parses the CSV with full error handling (try/catch, documented not-found value).',
    })
    expect(outcome.status).toBe('corrected')
    expect(outcome.finalContent).toContain('error handling')
    // issuesFound reports the LAST verification pass — the re-verification of
    // the corrected answer found zero blocking issues, which is the success
    // condition itself.
    expect(outcome.issuesFound).toBe(0)
  })

  // 4 ---------------------------------------------------------------------
  test('4. contradictory instructions: factual contradiction detected and corrected', async () => {
    verifierScript.push({
      respond: verifierReport({
        verdict: 'fail',
        confidence: 0.25,
        issues: [issue('major', 'factual', 'The draft says the function is pure, then mutates its input.', 'Pick one contract; state input purity explicitly and keep the code consistent.')],
      }),
    })
    verifierScript.push({ respond: verifierReport({ verdict: 'pass', confidence: 0.83 }) })
    const outcome = await verifyAndCorrect({
      originalRequest: 'Write a pure function that doubles array values.',
      draft: 'This function is pure. Implementation: arr.push(x*2) mutates.',
      config: DEFAULT_CFG,
      ctx: CTX,
      generateRevision: async () => 'Pure implementation with explicit "input is never mutated" contract.',
    })
    expect(outcome.status).toBe('corrected')
    expect(outcome.finalContent).toContain('never mutated')
  })

  // 5 ---------------------------------------------------------------------
  test('5. ambiguous request: low-confidence pass below threshold → honest unverified, draft kept', async () => {
    verifierScript.push({ respond: verifierReport({ verdict: 'pass', confidence: 0.4 }) })
    const draft = 'It depends on the interpretation; here is one reading.'
    const outcome = await verifyAndCorrect({
      originalRequest: 'Make it faster.',
      draft,
      config: DEFAULT_CFG,
      ctx: CTX,
    })
    expect(outcome.status).toBe('unverified')
    expect(outcome.finalContent).toBe(draft) // best available answer ships
    expect(outcome.reason).toMatch(/below threshold/)
    expect(outcome.corrections).toBe(0)
    // Never claimed verified.
    expect(outcome.status).not.toBe('verified')
  })

  // 6 ---------------------------------------------------------------------
  test('6. code generation: syntax-invalid code is caught and corrected', async () => {
    verifierScript.push({
      respond: verifierReport({
        verdict: 'fail',
        confidence: 0.2,
        issues: [issue('critical', 'code', 'The code block is missing its closing brace — the function does not parse.', 'Close the function body and re-emit the complete file.')],
      }),
    })
    verifierScript.push({ respond: verifierReport({ verdict: 'pass', confidence: 0.9 }) })
    const outcome = await verifyAndCorrect({
      originalRequest: 'Write a JS function sum(a,b).',
      draft: 'function sum(a,b) { return a+b;',
      config: DEFAULT_CFG,
      ctx: CTX,
      generateRevision: async () => 'function sum(a,b) { return a+b; }',
    })
    expect(outcome.status).toBe('corrected')
    expect(outcome.finalContent.endsWith('}')).toBe(true)
  })

  // 7 ---------------------------------------------------------------------
  test('7. event-loop / execution order: wrong order is a critical issue with a trace correction', async () => {
    verifierScript.push({
      respond: verifierReport({
        verdict: 'fail',
        confidence: 0.15,
        issues: [issue('critical', 'order', 'The draft claims the .then callback prints before the sync log; simulating the code shows the sync log runs first.', 'Rebuild the trace statement by statement and state the corrected final output.')],
      }),
    })
    verifierScript.push({ respond: verifierReport({ verdict: 'pass', confidence: 0.87 }) })
    const outcome = await verifyAndCorrect({
      originalRequest: 'What does this script print? console.log(1); Promise.resolve().then(() => console.log(2)); console.log(3);',
      draft: 'Final output: 2, 1, 3',
      config: DEFAULT_CFG,
      ctx: CTX,
      generateRevision: async () => 'Trace: sync 1, sync 3, then microtask 2. Final output: 1, 3, 2',
    })
    expect(outcome.status).toBe('corrected')
    expect(outcome.finalContent).toContain('1, 3, 2')
  })

  // 8 ---------------------------------------------------------------------
  test('8. verification failure: verifier call throws → honest unverified with the draft preserved', async () => {
    verifierScript.push({ failWith: new Error('fetch failed') })
    const draft = 'The real draft content.'
    const outcome = await verifyAndCorrect({
      originalRequest: 'q',
      draft,
      config: DEFAULT_CFG,
      ctx: CTX,
    })
    expect(outcome.status).toBe('unverified')
    expect(outcome.finalContent).toBe(draft)
    expect(outcome.reason).toMatch(/verifier unavailable/)
    expect(outcome.attempts).toBe(1)
    expect(outcome.confidence).toBeNull()
  })

  // 9 ---------------------------------------------------------------------
  test('9a. regeneration limit 0 → verify-only: blocking issues detected, draft NEVER rewritten', async () => {
    verifierScript.push({
      respond: verifierReport({
        verdict: 'fail',
        confidence: 0.2,
        issues: [issue('critical', 'calculation', 'wrong number', 'fix it')],
      }),
    })
    const draft = 'The uncorrected draft.'
    let revisionAttempted = false
    const outcome = await verifyAndCorrect({
      originalRequest: 'q',
      draft,
      config: { ...DEFAULT_CFG, regenerationLimit: 0 },
      ctx: CTX,
      generateRevision: async () => {
        revisionAttempted = true
        return 'should never happen'
      },
    })
    expect(revisionAttempted).toBe(false)
    expect(outcome.status).toBe('unverified')
    expect(outcome.finalContent).toBe(draft)
    expect(outcome.reason).toMatch(/regeneration limit is 0/)
    expect(verifierCalls).toHaveLength(1) // no re-verification without a revision
  })

  test('9b. bound exhaustion: verifier keeps failing → bounded calls, corrected-unverified (no loop)', async () => {
    const failing = verifierReport({
      verdict: 'fail',
      confidence: 0.2,
      issues: [issue('critical', 'logic', 'still wrong', 'fix again')],
    })
    verifierScript.push({ respond: failing }, { respond: failing }, { respond: failing }, { respond: failing })
    const outcome = await verifyAndCorrect({
      originalRequest: 'q',
      draft: 'draft',
      config: { ...DEFAULT_CFG, maxAttempts: 3, regenerationLimit: 2 },
      ctx: CTX,
      generateRevision: async () => 'revision attempt',
    })
    // Structural bound: maxAttempts 3 caps verifier passes at 3, so revisions
    // can never exceed 2 (each revision consumes the verification pass after
    // it). Even a regenerationLimit beyond the attempt cap cannot loop.
    expect(verifierCalls).toHaveLength(3)
    expect(outcome.attempts).toBe(3)
    expect(outcome.corrections).toBe(2)
    expect(outcome.status).toBe('corrected-unverified')
    expect(outcome.reason).toMatch(/bound reached/)
  })

  test('9c. config clamp: a hand-edited extreme row cannot exceed the hard caps (no infinite loop)', async () => {
    settingsRow = {
      key: SETTING_KEY,
      value: JSON.stringify({ enabled: true, maxAttempts: 999, timeoutMs: 99_999_999, regenerationLimit: 500, minConfidence: 42, maxInputChars: 5_000_000 }),
      updatedAt: new Date(),
    }
    const cfg = await verificationConfig()
    expect(cfg.maxAttempts).toBe(hardCaps.maxAttempts)
    expect(cfg.timeoutMs).toBe(hardCaps.timeoutMs)
    expect(cfg.regenerationLimit).toBe(hardCaps.maxRegenerations)
    expect(cfg.minConfidence).toBeLessThanOrEqual(1)
    expect(cfg.maxInputChars).toBe(hardCaps.maxInputChars)
  })

  // 10 --------------------------------------------------------------------
  test('10a. cancellation between passes: aborted guard unwinds with ClientDisconnectedError', async () => {
    verifierScript.push({
      respond: verifierReport({ verdict: 'fail', confidence: 0.2, issues: [issue('critical', 'calculation', 'x', 'y')] }),
    })
    let aborted = false
    const guard = { get aborted() { return aborted } }
    const run = verifyAndCorrect({
      originalRequest: 'q',
      draft: 'draft',
      config: DEFAULT_CFG,
      ctx: CTX,
      guard,
      generateRevision: async () => {
        aborted = true // the client disconnected while revising
        return 'never consumed'
      },
    })
    await expect(run).rejects.toThrow(ClientDisconnectedError)
  })

  test('10b. cancellation mid-revision: a disconnected stream NEVER ships a "failed revision" answer', async () => {
    verifierScript.push({
      respond: verifierReport({ verdict: 'fail', confidence: 0.2, issues: [issue('critical', 'code', 'x', 'y')] }),
    })
    const outcomePromise = verifyAndCorrect({
      originalRequest: 'q',
      draft: 'draft',
      config: DEFAULT_CFG,
      ctx: CTX,
      streamRevision: async function* () {
        yield 'partial revision text'
        throw new ClientDisconnectedError() // client vanished mid-stream
      },
    })
    // Cancellation propagates — it is not swallowed into 'corrective revision failed'.
    await expect(outcomePromise).rejects.toThrow(ClientDisconnectedError)
  })

  // 11 --------------------------------------------------------------------
  test('11. streaming: streamed revision deltas assemble the full corrected answer; stages reported', async () => {
    verifierScript.push({
      respond: verifierReport({ verdict: 'fail', confidence: 0.3, issues: [issue('major', 'requirement', 'missing part', 'add it')] }),
    })
    verifierScript.push({ respond: verifierReport({ verdict: 'pass', confidence: 0.91 }) })
    const deltasSeen: string[] = []
    const outcome = await verifyAndCorrect({
      originalRequest: 'q',
      draft: 'draft',
      config: DEFAULT_CFG,
      ctx: CTX,
      onStage: (s) => stages.push(s),
      streamRevision: async function* () {
        for (const d of ['full ', 'corrected ', 'answer']) {
          deltasSeen.push(d)
          yield d
        }
      },
    })
    expect(outcome.status).toBe('corrected')
    expect(outcome.finalContent).toBe('full corrected answer')
    expect(deltasSeen.join('')).toBe('full corrected answer')
    expect(stages[0]).toBe('verifying')
    expect(stages).toContain('revising')
    // The second verifier pass verified the REVISED answer, not the draft.
    expect(verifierCalls[1].user).toContain('full corrected answer')
  })

  // 12 --------------------------------------------------------------------
  test('12. timeout: a verifier that stalls past the cap resolves to honest unverified (draft kept)', async () => {
    verifierScript.push({ failWith: new Error('gateway chat completion timed out after 60000ms') })
    const draft = 'The draft the timeout preserved.'
    const outcome = await verifyAndCorrect({
      originalRequest: 'q',
      draft,
      config: { ...DEFAULT_CFG, timeoutMs: 60_000 },
      ctx: CTX,
    })
    expect(outcome.status).toBe('unverified')
    expect(outcome.finalContent).toBe(draft)
    // The configured timeout reached the gateway call (verifier plan).
    expect(verifierCalls[0].timeoutMs).toBe(60_000)
  })
})

describe('self-verification — privacy and report parsing discipline', () => {
  test('public summary exposes ONLY status/counts — never verifier reasoning or issue text', async () => {
    verifierScript.push({
      respond: verifierReport({
        verdict: 'fail',
        confidence: 0.2,
        issues: [issue('critical', 'calculation', 'SECRET-VERIFIER-REASONING: the trace shows X', 'SECRET-CORRECTION-INSTRUCTION')],
      }),
    })
    verifierScript.push({ respond: verifierReport({ verdict: 'pass', confidence: 0.9 }) })
    const outcome = await verifyAndCorrect({
      originalRequest: 'q',
      draft: 'draft',
      config: DEFAULT_CFG,
      ctx: CTX,
      generateRevision: async () => 'revised',
    })
    const summary = publicVerificationSummary(outcome)
    expect(summary).not.toBeNull()
    const serialized = JSON.stringify(summary)
    expect(serialized).not.toContain('SECRET-VERIFIER-REASONING')
    expect(serialized).not.toContain('SECRET-CORRECTION-INSTRUCTION')
    // The public surface is EXACTLY the four honest counters — nothing else.
    expect(Object.keys(summary!).sort()).toEqual(['attempts', 'corrections', 'issuesFound', 'status'])
    expect(summary!.status).toBe('corrected')
    expect(summary!.attempts).toBe(2)
    // An unverified/disabled outcome projects to null (nothing internal leaks).
    expect(publicVerificationSummary(null)).toBeNull()
    expect(publicVerificationSummary({ ...outcome, status: 'skipped' })).toBeNull()
  })

  test('verifier report parsing: fenced JSON accepted; malformed output NEVER guessed into a pass', () => {
    expect(parseVerifierReport('```json\n{"verdict":"pass","confidence":0.9,"issues":[]}\n```')).not.toBeNull()
    expect(parseVerifierReport('{"verdict":"pass","confidence":0.9,"issues":[]}')).not.toBeNull()
    expect(parseVerifierReport('I think it looks fine')).toBeNull()
    expect(parseVerifierReport('{"verdict":"maybe","confidence":0.9}')).toBeNull()
    // Issues missing the correction field are dropped, not invented.
    const partial = parseVerifierReport('{"verdict":"fail","confidence":0.3,"issues":[{"severity":"critical","description":"no correction"}]}')
    expect(partial!.issues).toHaveLength(0)
  })
})
