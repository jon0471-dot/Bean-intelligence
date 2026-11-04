/**
 * CODE GIFTZ — W6 verification-aware generation tests.
 *
 * Covers the W6 additions to the self-verification engine WITHOUT touching
 * the 12-category W5 suite (tests/unit/self-verification.test.ts, which
 * keeps pinning the pipeline's bounded-loop behavior):
 *  - request-type detection (buildVerificationFocus): async-order requests
 *    get the derivational order checklist; plain requests get none;
 *  - the focus reaches the VERIFIER's user turn (and only there — never the
 *    revision instruction, never the public summary);
 *  - the upgraded verifier system prompt carries the derivational discipline
 *    (running output list, walk-into-callee, position-by-position compare,
 *    requirement enumeration) — the verifier must RE-DERIVE order from code,
 *    never compare against a memorized sequence (work order §3.2);
 *  - pipeline behavior for non-order requests is byte-identical to W5.
 *
 * Run: bun test tests/unit/verification-w6.test.ts
 */
import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'

let settingsRow: { key: string; value: string; updatedAt: Date } | null = null

const dbFake = {
  systemSetting: {
    async findUnique({ where }: { where: { key: string } }) {
      if (settingsRow && settingsRow.key === where.key) return settingsRow
      return null
    },
  },
  providerCredential: { async findFirst() { return null } },
  usageRecord: { async create({ data }: { data: Record<string, unknown> }) { return data }, async count() { return 0 } },
  gatewayRequestLog: { async create({ data }: { data: Record<string, unknown> }) { return data } },
}
mock.module('@/lib/db', () => ({ db: dbFake }))

const { verifyAndCorrect } = await import('../../src/lib/verification/pipeline')
const { VERIFIER_SYSTEM_PROMPT, buildVerifierUserTurn, buildVerificationFocus } = await import(
  '../../src/lib/verification/prompts'
)
const { hostedLlmAdapter } = await import('../../src/lib/adapters/hosted-llm')
const { _resetUpstreamCooldownForTests } = await import('../../src/lib/upstream/gateway')

const verifierScript: Array<{ respond: string }> = []
const verifierCalls: Array<{ system: string; user: string }> = []

const realChat = hostedLlmAdapter.chat
const realChatStream = hostedLlmAdapter.chatStream

function installVerifierFake(): void {
  hostedLlmAdapter.chat = async function (req: { messages: Array<{ role: string; content: string }> }) {
    verifierCalls.push({
      system: req.messages[0]?.role === 'assistant' ? req.messages[0].content : '',
      user: [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? '',
    })
    const call = verifierScript.shift()
    if (!call) throw new Error('verifier script exhausted')
    return { content: call.respond, tokensInEst: 10, tokensOutEst: 5, durationMs: 3 }
  } as typeof hostedLlmAdapter.chat
  hostedLlmAdapter.chatStream = async function* () { yield '' } as typeof hostedLlmAdapter.chatStream
}

beforeEach(() => {
  _resetUpstreamCooldownForTests()
  installVerifierFake()
  verifierScript.length = 0
  verifierCalls.length = 0
  settingsRow = null
})
afterEach(() => {
  hostedLlmAdapter.chat = realChat
  hostedLlmAdapter.chatStream = realChatStream
})

function verifierReport(overrides: Partial<{ verdict: string; confidence: number }> = {}): string {
  return JSON.stringify({ verdict: overrides.verdict ?? 'pass', confidence: overrides.confidence ?? 0.9, issues: [] })
}

const CTX = { userId: 'w6-user', apiKeyId: null, authKind: 'internal' as const, endpoint: 'w6-test', signal: null }
const CFG = { enabled: true, verificationModel: 'bean-code-hosted', maxAttempts: 2, timeoutMs: 60_000, minConfidence: 0.6, regenerationLimit: 1, maxInputChars: 30_000 }

describe('W6 verification focus — request-type detection', () => {
  test('async/event-loop requests get the derivational order checklist', () => {
    for (const req of [
      'What does this script print? console.log(1); Promise.resolve().then(() => console.log(2));',
      'Explain the execution order of the async function below.',
      'Trace the microtask queue for this setTimeout + await example.',
      'What will be the output order of these console.log calls?',
    ]) {
      const focus = buildVerificationFocus(req)
      expect(focus).not.toBeNull()
      expect(focus!).toContain('EXECUTION-ORDER')
      expect(focus!).toContain('running output list')
      expect(focus!).toContain('position by position')
      expect(focus!).toContain('never from the draft')
    }
  })

  test('plain non-async requests get NO focus block (general discipline unchanged)', () => {
    for (const req of [
      'Write a function that reverses a string.',
      'What is 2+2?',
      'Parse the CSV and handle errors.',
      'Make it faster.',
    ]) {
      expect(buildVerificationFocus(req)).toBeNull()
    }
  })

  test('detection is case-insensitive', () => {
    expect(buildVerificationFocus('Explain the Event Loop behavior here.')).not.toBeNull()
    expect(buildVerificationFocus('Use AWAIT to fetch the data and return it.')).not.toBeNull()
  })
})

describe('W6 verifier prompt discipline (system prompt content)', () => {
  test('the order discipline is DERIVATIONAL — re-derive from code, never memorized comparison', () => {
    expect(VERIFIER_SYSTEM_PROMPT).toContain('RUNNING OUTPUT LIST')
    expect(VERIFIER_SYSTEM_PROMPT).toContain('PART OF THE CALLER')
    expect(VERIFIER_SYSTEM_PROMPT).toContain('POSITION BY POSITION')
    expect(VERIFIER_SYSTEM_PROMPT).toContain('Never derive the order from the draft')
    // §3.2 explicitly forbids comparing against a memorized expected sequence:
    expect(VERIFIER_SYSTEM_PROMPT).not.toMatch(/expected sequence [A-Z]( [A-Z]){5,}/)
  })

  test('requirement coverage is checked by ENUMERATION first', () => {
    expect(VERIFIER_SYSTEM_PROMPT).toContain('ENUMERATE THE REQUIREMENTS')
    expect(VERIFIER_SYSTEM_PROMPT).toContain('silently dropped requirement is a major issue')
  })

  test('calculations must be recomputed independently of the draft', () => {
    expect(VERIFIER_SYSTEM_PROMPT).toContain('RECOMPUTE')
    expect(VERIFIER_SYSTEM_PROMPT).toContain('never adopt the draft')
  })
})

describe('W6 focus threading through the pipeline', () => {
  test('async-order request: the focus block reaches the verifier user turn', async () => {
    verifierScript.push({ respond: verifierReport({ verdict: 'pass', confidence: 0.93 }) })
    const outcome = await verifyAndCorrect({
      originalRequest: 'What does this script print? console.log(1); queueMicrotask(() => console.log(2));',
      draft: 'It prints 1, then 2, and claims the queue drains after the sync block.',
      config: CFG,
      ctx: CTX,
    })
    expect(outcome.status).toBe('verified')
    expect(verifierCalls).toHaveLength(1)
    expect(verifierCalls[0].user).toContain('VERIFICATION FOCUS FOR THIS REQUEST')
    expect(verifierCalls[0].user).toContain('EXECUTION-ORDER')
    // the draft itself is still present in full
    expect(verifierCalls[0].user).toContain('It prints 1, then 2')
  })

  test('non-order request: user turn has NO focus block (W5 behavior byte-identical)', async () => {
    verifierScript.push({ respond: verifierReport({ verdict: 'pass', confidence: 0.91 }) })
    const outcome = await verifyAndCorrect({
      originalRequest: 'Write a function that reverses a string.',
      draft: 'function reverse(s) { return [...s].reverse().join("") }',
      config: CFG,
      ctx: CTX,
    })
    expect(outcome.status).toBe('verified')
    expect(verifierCalls[0].user).not.toContain('VERIFICATION FOCUS')
  })

  test('focus is INTERNAL: it never appears in the user-facing summary fields', async () => {
    verifierScript.push({ respond: verifierReport({ verdict: 'pass', confidence: 0.9 }) })
    const outcome = await verifyAndCorrect({
      originalRequest: 'Trace the microtask order for this async snippet.',
      draft: 'draft',
      config: CFG,
      ctx: CTX,
    })
    const summary = JSON.stringify({ status: outcome.status, attempts: outcome.attempts, corrections: outcome.corrections, issuesFound: outcome.issuesFound })
    expect(summary).not.toContain('EXECUTION-ORDER')
    expect(summary).not.toContain('running output list')
    expect(Object.keys(JSON.parse(summary)).sort()).toEqual(['attempts', 'corrections', 'issuesFound', 'status'])
  })
})

describe('W6 buildVerifierUserTurn — budget behavior preserved with focus', () => {
  test('focus block still present when the request is truncated', () => {
    const longRequest = 'async '.repeat(20_000) + 'what prints?'
    const turn = buildVerifierUserTurn(longRequest, 'draft', 6_000, buildVerificationFocus('async order question'))
    expect(turn).toContain('VERIFICATION FOCUS FOR THIS REQUEST')
    expect(turn).toContain('request truncated for verification')
  })

  test('no focus → identical turn shape to the W5 contract', () => {
    const turn = buildVerifierUserTurn('req', 'draft', 30_000, null)
    expect(turn).toContain("USER'S ORIGINAL REQUEST:")
    expect(turn).toContain('DRAFT ANSWER TO VERIFY:')
    expect(turn).not.toContain('VERIFICATION FOCUS')
  })
})
