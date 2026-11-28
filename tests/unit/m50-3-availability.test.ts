/**
 * M50.3 BEAN AI STUDIO — availability snapshot mapping tests.
 *
 * Pins the server-side bridge over the REAL capability-health model:
 *  - every measured state maps explicitly and preserves the real
 *    distinctions: available / degraded / rate-limited / BLOCKED /
 *    unavailable / not-configured;
 *  - a measured contract blocker ('blocked' capability row) is NOT
 *    collapsed into generic degradation and never reads as operational;
 *  - absence of evidence stays ABSENT ('unknown' in the pure core — honest
 *    silence, never a synthesized claim);
 *  - the platform surface is never part of the snapshot;
 *  - the mapping is pure: no env reads, no probes, no time.
 *
 * Run: bun test tests/unit/m50-3-availability.test.ts
 */
import { describe, test, expect } from 'bun:test'
import { mapProductHealthToStudioState, studioAvailabilityFromHealth } from '../../src/lib/ai-studio/availability'
import type { ProductHealthEntry } from '../../src/lib/registry/status'

function entry(partial: Partial<ProductHealthEntry>): ProductHealthEntry {
  return { available: true, ...partial }
}

describe('M50.3 availability — per-product state mapping', () => {
  test('operational maps to available; not-configured stays not-configured', () => {
    expect(mapProductHealthToStudioState(entry({ status: 'operational' }))).toBe('available')
    expect(mapProductHealthToStudioState(entry({ status: 'not-configured', available: false }))).toBe('not-configured')
  })

  test('rate-limited, degraded and unavailable map verbatim', () => {
    expect(mapProductHealthToStudioState(entry({ status: 'rate-limited' }))).toBe('rate-limited')
    expect(mapProductHealthToStudioState(entry({ status: 'degraded' }))).toBe('degraded')
    expect(mapProductHealthToStudioState(entry({ status: 'unavailable', available: false }))).toBe('unavailable')
  })

  test('a measured BLOCKED capability row maps to blocked (never collapsed into degraded)', () => {
    const blocked: ProductHealthEntry = entry({
      status: 'degraded',
      capabilities: [
        { state: 'operational', statusAffecting: true },
        { state: 'blocked', statusAffecting: true, evidence: { note: 'measured contract blocker' } },
      ],
    })
    expect(mapProductHealthToStudioState(blocked)).toBe('blocked')
    // A display-only blocked row does not gate the surface.
    const displayOnly = entry({
      status: 'operational',
      capabilities: [{ state: 'blocked', statusAffecting: false }],
    })
    expect(mapProductHealthToStudioState(displayOnly)).toBe('available')
  })

  test('no entry and evidence-less payloads map to ABSENT (honest silence)', () => {
    expect(mapProductHealthToStudioState(undefined)).toBeUndefined()
    expect(mapProductHealthToStudioState(entry({ available: true }))).toBeUndefined() // bare true is never a claim
  })

  test('a failed probe without a status maps to unavailable (never operational)', () => {
    expect(mapProductHealthToStudioState(entry({ available: false }))).toBe('unavailable')
  })
})

describe('M50.3 availability — snapshot assembly', () => {
  test('only surfaces with real evidence appear; platform never enters the snapshot', () => {
    const snapshot = studioAvailabilityFromHealth({
      riishe: entry({ status: 'operational' }),
      laxii: entry({ status: 'rate-limited' }),
      jazmii: entry({ status: 'not-configured', available: false }),
      'code-giftz': entry({
        status: 'degraded',
        capabilities: [{ state: 'blocked', statusAffecting: true }],
      }),
    })
    expect(snapshot).toEqual({
      riishe: 'available',
      laxii: 'rate-limited',
      jazmii: 'not-configured',
      'code-giftz': 'blocked',
    })
    expect('platform' in snapshot).toBe(false)
    // gangzii has no evidence → absent
    expect('gangzii' in snapshot).toBe(false)
  })

  test('the snapshot feeds the pure core and produces honest diagnostics (incl. blocked)', async () => {
    const { compileWorkflowToPlan } = await import('../../src/lib/ai-studio/compile')
    const g = {
      schemaVersion: 1 as const,
      nodes: [
        { nodeId: 'i', nodeType: 'image.create', contractVersion: 1, config: { prompt: 'a poster' } },
        { nodeId: 'm', nodeType: 'output.deliverable', contractVersion: 1, config: {} },
      ],
      edges: [{ edgeId: 'e1', from: { nodeId: 'i', port: 'image' }, to: { nodeId: 'm', port: 'image' } }],
    }
    const snapshot = studioAvailabilityFromHealth({
      laxii: entry({
        status: 'degraded',
        capabilities: [{ state: 'blocked', statusAffecting: true }],
      }),
    })
    const result = compileWorkflowToPlan(g, undefined, snapshot)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.diagnostics.some((d) => d.severity === 'warning' && d.message.includes('blocked'))).toBe(true)
    expect(result.diagnostics.every((d) => d.severity !== 'error')).toBe(true)
  })

  test('an empty measured payload yields an empty snapshot (no claims invented)', () => {
    expect(studioAvailabilityFromHealth(undefined)).toEqual({})
    expect(studioAvailabilityFromHealth({})).toEqual({})
  })
})
