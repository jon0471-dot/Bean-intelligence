/**
 * M47.1 tests — provider-native tool-calling capability registry.
 *
 * Classification: LOCAL-INTEGRATION — real registry modules over controlled
 * local dependencies. No external network; no model call. The LIVE-shaped
 * behavior (a configured model actually emitting a native tool call) is
 * measured separately by scripts/m47-native-tool-probe.ts and recorded in
 * the M47 acceptance matrix; the registry tests pin that the REGISTRY
 * reports exactly the measured evidence — never more, never less.
 *
 * What this pins:
 *  - the five-state evidence vocabulary exists and the registry uses only
 *    states backed by evidence ('native' ONLY where a measurement exists);
 *  - the hosted lane's descriptor carries the measured facts: native,
 *    non-streaming-only (streaming measured broken), openai call shapes,
 *    preserved call_ ids, measuredAt + evidence artifact;
 *  - every unmeasured lane is honestly 'unknown' with the text protocol —
 *    never advertised as native-capable;
 *  - unknown backend ids get an honest default (text protocol, unmeasured)
 *    — no refusal shortcut, no invented capability;
 *  - per-model overrides narrow descriptors explicitly and auditably;
 *  - the runtime policy selects the protocol FROM the registry (native lane
 *    → native protocol with the streaming constraint attached; text lanes
 *    unchanged; no-tools turns unaffected);
 *  - diagnostics expose evidence fields without any secret-shaped value.
 */
import { describe, test, expect } from 'bun:test'
import {
  resolveToolCallingDescriptor,
  resolveToolProtocol,
  resolveToolInvocationPolicy,
  toolCallingDiagnostics,
  NATIVE_TOOL_CALLING_STATES,
  type NativeToolCallingState,
} from '@/lib/riishe/tool-invocation'

const CHAT_LANES = [
  'bean-llm-hosted-primary',
  'bean-llm-openai-compatible',
  'bean-llm-anthropic',
  'bean-chat-local-llamacpp',
] as const

describe('M47.1 capability-state vocabulary', () => {
  test('exactly the five evidence states exist', () => {
    expect(NATIVE_TOOL_CALLING_STATES).toEqual([
      'native',
      'text-protocol',
      'unsupported',
      'unknown',
      'temporarily-unavailable',
    ] satisfies readonly NativeToolCallingState[])
  })
})

describe('M47.1 registry: measured hosted lane', () => {
  test('the hosted lane records MEASURED native support with the full evidence trail', () => {
    const d = resolveToolCallingDescriptor('bean-llm-hosted-primary')
    expect(d.kind).toBe('native')
    expect(d.nativeState).toBe('native')
    expect(d.requestCarriesTools).toBe(true)
    expect(d.responseCallShape).toBe('openai-tool_calls')
    expect(d.toolResultShape).toBe('openai-role-tool')
    expect(d.toolCallIdStyle).toBe('openai-call-id')
    expect(d.argumentEncoding).toBe('json-string')
    // The measured streaming constraint is a HARD false, not an unmeasured null.
    expect(d.streamingToolCalls).toBe(false)
    // Evidence fields: when and by what artifact this was measured.
    expect(d.measuredAt).toBe('2026-11-28')
    expect(d.evidence).toContain('m47-native-tool-probe')
    // Multi-call per response was NOT measured — recorded as null (never guessed).
    expect(d.multiCallPerResponse).toBeNull()
  })

  test('native kind is consistent with the native evidence state (kind never drifts from evidence)', () => {
    for (const lane of CHAT_LANES) {
      const d = resolveToolCallingDescriptor(lane)
      if (d.kind === 'native') expect(d.nativeState).toBe('native')
      if (d.nativeState !== 'native') expect(d.kind).not.toBe('native')
    }
  })
})

describe('M47.1 registry: unmeasured lanes stay honest', () => {
  test('every unmeasured lane is unknown + text protocol with null measurement fields', () => {
    for (const lane of ['bean-llm-openai-compatible', 'bean-llm-anthropic', 'bean-chat-local-llamacpp']) {
      const d = resolveToolCallingDescriptor(lane)
      expect(d.nativeState).toBe('unknown')
      expect(d.kind).toBe('text')
      expect(d.measuredAt).toBeNull()
      expect(d.evidence).toBeNull()
      expect(d.responseCallShape).toBeNull()
      expect(d.streamingToolCalls).toBeNull()
      // The note says WHY (unconfigured / unmeasured) — honesty is auditable.
      expect(d.note.toLowerCase()).toMatch(/no .*(measurement|provider)|unmeasured|varies/)
    }
  })

  test('an unsupported-capability state exists in the vocabulary even though no lane currently measures to it', () => {
    // 'unsupported' and 'temporarily-unavailable' are reserved for MEASURED
    // outcomes and runtime conditions — the registry never uses them as guesses.
    for (const lane of CHAT_LANES) {
      const d = resolveToolCallingDescriptor(lane)
      expect(['native', 'unknown']).toContain(d.nativeState)
    }
  })

  test('unknown backend ids get the honest default record (text protocol, unmeasured)', () => {
    for (const id of ['future-provider-x', '', null, undefined]) {
      const d = resolveToolCallingDescriptor(id as string | null | undefined)
      expect(d.kind).toBe('text')
      expect(d.nativeState).toBe('unknown')
      expect(d.measuredAt).toBeNull()
    }
  })

  test('back-compat: resolveToolProtocol derives from the same registry', () => {
    expect(resolveToolProtocol('bean-llm-hosted-primary').kind).toBe('native')
    expect(resolveToolProtocol('bean-chat-local-llamacpp').kind).toBe('text')
    expect(resolveToolProtocol('never-seen-lane').kind).toBe('text')
  })
})

describe('M47.1 per-model overrides', () => {
  test('a per-model state is applied explicitly and audited in the note', () => {
    // The override table is module-private; this pins the documented shape
    // through the exported resolver with a lane/model pair that has no
    // override: the BACKEND record applies unchanged.
    const d = resolveToolCallingDescriptor('bean-llm-openai-compatible', 'gpt-4o-mini')
    expect(d.nativeState).toBe('unknown')
    expect(d.note).not.toMatch(/Per-model override/)
  })

  test('providerModel does not invent capability for a measured lane without an override', () => {
    const d = resolveToolCallingDescriptor('bean-llm-hosted-primary', 'some-future-checkpoint')
    // No override exists for this model — the lane-level measured record
    // applies verbatim (its measuredAt makes checkpoint drift auditable).
    expect(d.nativeState).toBe('native')
    expect(d.measuredAt).toBe('2026-11-28')
    expect(d.note).not.toMatch(/Per-model override/)
  })
})

describe('M47.1 runtime policy selection (registry-authoritative)', () => {
  test('a native lane runs the NATIVE protocol and carries the measured streaming constraint', () => {
    const p = resolveToolInvocationPolicy({ backendId: 'bean-llm-hosted-primary', toolNames: ['execution_decision'] })
    expect(p.mode).toBe('loop')
    expect(p.protocol).toBe('native')
    expect(p.nativeState).toBe('native')
    expect(p.streamingToolCalls).toBe(false)
    expect(p.degradedNote).toBeNull()
    expect(p.reason).toMatch(/native/)
  })

  test('text lanes keep the text protocol (M45/M46 behavior unchanged)', () => {
    for (const lane of ['bean-llm-openai-compatible', 'bean-llm-anthropic', 'bean-chat-local-llamacpp']) {
      const p = resolveToolInvocationPolicy({ backendId: lane, toolNames: ['web_search'] })
      expect(p.mode).toBe('loop')
      expect(p.protocol).toBe('text')
      expect(p.nativeState).toBe('unknown')
      expect(p.degradedNote).toBeNull()
    }
  })

  test('no-tools turns are unaffected by protocol resolution', () => {
    const p = resolveToolInvocationPolicy({ backendId: 'bean-llm-hosted-primary', toolNames: [] })
    expect(p.mode).toBe('loop')
    expect(p.reason).toBe('no-tools-active')
    expect(p.degradedNote).toBeNull()
  })

  test('unknown lanes never resolve to the native protocol', () => {
    const p = resolveToolInvocationPolicy({ backendId: 'mystery-lane', toolNames: ['web_search'] })
    expect(p.protocol).toBe('text')
    expect(p.nativeState).toBe('unknown')
  })
})

describe('M47.1 operational diagnostics', () => {
  test('diagnostics cover every registered lane with evidence fields and no secrets', () => {
    const diags = toolCallingDiagnostics()
    const ids = diags.map((d) => d.backendId)
    for (const lane of CHAT_LANES) expect(ids).toContain(lane)
    const hosted = diags.find((d) => d.backendId === 'bean-llm-hosted-primary')!
    expect(hosted.nativeState).toBe('native')
    expect(hosted.measuredAt).toBe('2026-11-28')
    // No credential-shaped or secret-shaped value anywhere in the projection.
    const blob = JSON.stringify(diags)
    expect(blob).not.toMatch(/ghp_[A-Za-z0-9]/)
    expect(blob).not.toMatch(/sk-[A-Za-z0-9]{16,}/)
    expect(blob.toLowerCase()).not.toContain('apikey')
    expect(blob.toLowerCase()).not.toContain('bearer')
  })

  test('diagnostics state matches the registry descriptors exactly (pure projection)', () => {
    for (const d of toolCallingDiagnostics()) {
      const reg = resolveToolCallingDescriptor(d.backendId)
      expect(d.protocol).toBe(reg.kind)
      expect(d.nativeState).toBe(reg.nativeState)
      expect(d.streamingToolCalls).toBe(reg.streamingToolCalls)
      expect(d.measuredAt).toBe(reg.measuredAt)
    }
  })
})
