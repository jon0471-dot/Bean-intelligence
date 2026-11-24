import { describe, expect, test } from 'bun:test'

import {
  resolveQualityRoute,
  type QualityRouteInput,
} from '@/lib/client-compute/quality-routing'

const BASE: QualityRouteInput = {
  deviceTier: 3,
  conservative: false,
  taskComplexity: 'standard',
  localModelVerified: true,
  localModelQualityClass: 'balanced',
  authorizedBackendAvailable: true,
  localOnlyMode: false,
}

describe('M38-B5 quality routing policy', () => {
  test('adequate local model on a capable device is approved without caveats', () => {
    const r = resolveQualityRoute(BASE)
    expect(r.decision).toBe('local-approved')
    expect(r.limitation).toBeNull()
    expect(r.reasons.join(' ')).toContain('balanced')
  })

  test('high-class local model satisfies a demanding task', () => {
    const r = resolveQualityRoute({ ...BASE, taskComplexity: 'demanding', localModelQualityClass: 'high' })
    expect(r.decision).toBe('local-approved')
    expect(r.limitation).toBeNull()
  })

  test('a weak local model NEVER silently replaces a stronger route', () => {
    const r = resolveQualityRoute({ ...BASE, taskComplexity: 'demanding', localModelQualityClass: 'minimal' })
    expect(r.decision).toBe('prefer-backend')
    expect(r.limitation).toContain('authorized stronger route')
    expect(r.limitation).not.toBeNull()
    expect(r.reasons.join(' ')).toContain('materially reduce quality')
  })

  test('weak local model WITHOUT an authorized backend states the limitation honestly', () => {
    const r = resolveQualityRoute({
      ...BASE,
      taskComplexity: 'demanding',
      localModelQualityClass: 'minimal',
      authorizedBackendAvailable: false,
    })
    expect(r.decision).toBe('local-with-limitation')
    expect(r.limitation).toContain('materially limits quality')
    expect(r.limitation).toContain('no authorized stronger route')
    // honesty: limitation is explicit, not silent
    expect(r.decision).not.toBe('local-approved')
  })

  test('no verified local model routes to the authorized backend', () => {
    const r = resolveQualityRoute({ ...BASE, localModelVerified: false })
    expect(r.decision).toBe('require-backend')
    expect(r.limitation).toBeNull()
  })

  test('no verified local model and no authorized backend is an honest no-route', () => {
    const r = resolveQualityRoute({ ...BASE, localModelVerified: false, authorizedBackendAvailable: false })
    expect(r.decision).toBe('no-route')
    expect(r.limitation).toContain('cannot be executed')
    expect(r.limitation).toContain('Nothing will be silently substituted')
  })

  test('local-only mode never routes to a backend — adequate model runs with device caveat on low tiers', () => {
    const r = resolveQualityRoute({
      ...BASE,
      deviceTier: 1,
      localOnlyMode: true,
      taskComplexity: 'standard',
    })
    expect(r.decision).toBe('local-with-limitation')
    expect(r.limitation).toContain('local-only mode')
    expect(r.reasons.join(' ')).toContain('excluded by policy')
  })

  test('local-only mode with an inadequate model states the quality ceiling instead of silently degrading', () => {
    const r = resolveQualityRoute({
      ...BASE,
      localOnlyMode: true,
      taskComplexity: 'demanding',
      localModelQualityClass: 'minimal',
    })
    expect(r.decision).toBe('local-with-limitation')
    expect(r.limitation).toContain('materially limits quality')
    expect(r.limitation).toContain('rather than silently substituted')
  })

  test('local-only mode without a verified local model cannot execute at all', () => {
    const r = resolveQualityRoute({ ...BASE, localOnlyMode: true, localModelVerified: false })
    expect(r.decision).toBe('no-route')
    expect(r.limitation).toContain('privacy settings')
  })

  test('conservative devices state a limitation even when the model is adequate', () => {
    const r = resolveQualityRoute({ ...BASE, conservative: true, taskComplexity: 'standard' })
    expect(r.decision).toBe('local-with-limitation')
    expect(r.limitation).toContain('conservative low-resource')
  })

  test('low-tier device states a limitation for non-light tasks', () => {
    const r = resolveQualityRoute({ ...BASE, deviceTier: 1, taskComplexity: 'standard' })
    expect(r.decision).toBe('local-with-limitation')
    expect(r.limitation).toContain('lower-tier')
  })

  test('light tasks on low-tier devices run without a quality caveat', () => {
    const r = resolveQualityRoute({ ...BASE, deviceTier: 1, taskComplexity: 'light' })
    expect(r.decision).toBe('local-approved')
    expect(r.limitation).toBeNull()
  })

  test('the adequacy matrix never lets a minimal model silently serve standard/demanding work', () => {
    for (const complexity of ['standard', 'demanding'] as const) {
      for (const localOnlyMode of [false, true]) {
        const r = resolveQualityRoute({ ...BASE, taskComplexity: complexity, localModelQualityClass: 'minimal', localOnlyMode })
        expect(r.decision).not.toBe('local-approved')
        expect(r.limitation).not.toBeNull()
      }
    }
  })
})
