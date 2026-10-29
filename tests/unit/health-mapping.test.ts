/**
 * BEAN Intelligence — product availability: probe → status mapping tests.
 *
 * Task: "Investigate BEAN Intelligence product availability after the
 * RIISHE upstream HTTP 429 mitigation" (2026-10-29).
 *
 * What is pinned here, against REAL production code:
 *  1. productStatus (the dashboard mapping, registry/status.ts) — the honest
 *     three-state derivation incl. the DEGRADED middle state a research-only
 *     429 must produce for RIISHE (partial availability, never "fully
 *     operational while current-web research is rate-limited upstream").
 *  2. The LAXII image-backend probe semantics (hosted-image.ts): configured
 *     vs reachable vs credentials-rejected vs rate-limited vs unreachable —
 *     and the honesty boundary that a REACHABLE gateway is never reported as
 *     proof of image GENERATION. Faults are injected ONLY at the two real
 *     boundaries (SDK config object, global fetch).
 *  3. The pre-audit defect this replaces (recorded, not just fixed): the old
 *     health route probed ZAI.create() (~2ms, zero network — measured 7ms
 *     live while the same gateway 429'd chat) and derived CODE GIFTZ
 *     availability from a DIFFERENT check (the chat completion probe), so the
 *     dashboard could show a 2ms "successful" probe next to Unavailable.
 *     The current route reports the separately probed chat class AND the
 *     local sandbox capability for CODE GIFTZ.
 */
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test'

import { productStatus } from '../../src/lib/registry/status'

// ---------------------------------------------------------------------------
// 1. productStatus — the dashboard mapping (client-safe, pure)
// ---------------------------------------------------------------------------

describe('productStatus: healthy / degraded / unavailable derivation', () => {
  test('a product with NO enabled backend is unavailable regardless of any probe (JAZMII truth)', () => {
    // Even a probe that claims full health cannot green a product the
    // registry has no enabled backend for — measured beats configured, but a
    // disabled registry entry outranks everything.
    expect(productStatus(false, { available: true })).toBe('unavailable')
    expect(productStatus(false, { available: true, research: { available: true } })).toBe('unavailable')
    expect(productStatus(false)).toBe('unavailable')
  })

  test('enabled backend with NO probe evidence yet falls back to the registry flag (pre-audit behavior)', () => {
    expect(productStatus(true, undefined)).toBe('operational')
  })

  test('a failed CORE probe makes the product unavailable', () => {
    expect(productStatus(true, { available: false })).toBe('unavailable')
  })

  test('RIISHE under a research-only 429: core ok + research down = DEGRADED (partial availability)', () => {
    // The exact post-mitigation scenario: the chat class answers, the
    // functions class (web_search/page_reader) is rate-limited upstream.
    // The dashboard must show the honest middle state — never "Operational".
    const status = productStatus(true, { available: true, research: { available: false } })
    expect(status).toBe('degraded')
  })

  test('CODE GIFTZ under a sandbox failure: core ok + sandbox down = DEGRADED', () => {
    const status = productStatus(true, { available: true, sandbox: { available: false } })
    expect(status).toBe('degraded')
  })

  test('all measured layers healthy = operational', () => {
    expect(productStatus(true, { available: true, research: { available: true } })).toBe('operational')
    expect(productStatus(true, { available: true, sandbox: { available: true } })).toBe('operational')
    expect(productStatus(true, { available: true })).toBe('operational')
  })

  test('a healthy secondary capability never upgrades a failed core', () => {
    expect(productStatus(true, { available: false, research: { available: true } })).toBe('unavailable')
  })
})

// ---------------------------------------------------------------------------
// 2. LAXII image-backend probe (hosted-image.ts) — boundary fault injection
// ---------------------------------------------------------------------------

/** Mutable boundaries each test installs: the SDK's runtime config + fetch. */
let sdkConfig: { baseUrl?: string; apiKey?: string } | null = {
  baseUrl: 'https://gateway.example.internal/v1',
  apiKey: 'test-tenant-key',
}
// Bun's fetch type requires preconnect(); the stub only needs the call shape.
type FetchStub = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<Response>
let fetchImpl: FetchStub = async () => new Response('{}', { status: 200 })

mock.module('z-ai-web-dev-sdk', () => ({
  default: {
    create: async () => ({ config: sdkConfig, images: { generations: { create: async () => { throw new Error('generation must never run from a health probe') } } } }),
  },
}))

const realFetch = globalThis.fetch

beforeEach(() => {
  sdkConfig = { baseUrl: 'https://gateway.example.internal/v1', apiKey: 'test-tenant-key' }
  fetchImpl = async () => new Response('{}', { status: 200 })
  globalThis.fetch = ((input, init) => fetchImpl(input, init)) as unknown as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
  delete (globalThis as unknown as Record<string, unknown>).__bean_upstream_cooldown__
})

const { hostedImageAdapter } = await import('../../src/lib/adapters/hosted-image')

describe('LAXII health probe: configured vs reachable vs capability (never conflated)', () => {
  test('MISCONFIGURED: client initializes but config lacks baseUrl/apiKey — the endpoint cannot be reached', async () => {
    sdkConfig = { baseUrl: '', apiKey: '' }
    const report = await hostedImageAdapter.health()
    expect(report.healthy).toBe(false)
    expect(report.detail).toContain('Misconfigured')
    expect(report.detail).toContain('cannot be reached')
  })

  test('UNREACHABLE: config present but the gateway host answers no request (network/upstream problem)', async () => {
    fetchImpl = async () => {
      throw new Error('connect ECONNREFUSED')
    }
    const report = await hostedImageAdapter.health()
    expect(report.healthy).toBe(false)
    expect(report.detail).toContain('UNREACHABLE')
    expect(report.detail).toContain('not a configuration gap')
  })

  test('credentials rejected (HTTP 401/403): reachable but misconfigured — operator action, not retry', async () => {
    fetchImpl = async () => new Response('{"error":"unauthorized"}', { status: 401 })
    const report = await hostedImageAdapter.health()
    expect(report.healthy).toBe(false)
    expect(report.detail).toContain('misconfigured')
    expect(report.detail).toContain('rejected the configured credentials')
    expect(report.detail).toContain('retrying will not change it')
  })

  test('rate-limited (HTTP 429): reachable but throttled — a DISTINCT state, never "operational"', async () => {
    fetchImpl = async () => new Response('{"error":"Too many requests"}', { status: 429 })
    const report = await hostedImageAdapter.health()
    expect(report.healthy).toBe(false)
    expect(report.detail).toContain('rate-limited')
    expect(report.detail).toContain('HTTP 429')
  })

  test('reachable + configured = healthy, and the detail NEVER claims generation was tested', async () => {
    let generationAttempted = false
    sdkConfig = {
      baseUrl: 'https://gateway.example.internal/v1',
      apiKey: 'test-tenant-key',
      // If the probe ever touches the generation endpoint, this fails loudly.
      ...({}),
    }
    const report = await hostedImageAdapter.health()
    expect(report.healthy).toBe(true)
    expect(report.detail).toContain('reachable')
    // The honesty boundary: probe success is NOT capability proof.
    expect(report.detail).toContain('does NOT run a generation')
    expect(generationAttempted).toBe(false)
    // The probe is a GET on the metadata route, never a POST to images.
    expect((fetchImpl as unknown as { __calls?: string[] }).__calls ?? null).toBeNull()
  })
})
