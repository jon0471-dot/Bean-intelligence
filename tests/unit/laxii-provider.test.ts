/**
 * BEAN Intelligence — LAXII provider selection + capability truth tests
 * (Phase 6/7).
 *
 * Pins the honest routing contract:
 *  - deterministic enhancement always resolves to the local engine;
 *  - text-to-image resolves to the managed provider today;
 *  - every generative-edit op refuses with PROVIDER_UNAVAILABLE while the
 *    Diffusers worker is registry-disabled — the customer's image is
 *    untouched and no fake capability is advertised;
 *  - the public edit-capability surface mirrors the registry exactly
 *    (a disabled backend can NEVER be advertised as available);
 *  - the catalog carries license facts for every entry.
 */
import { describe, test, expect, afterEach } from 'bun:test'

const ENV_KEYS = ['LAXII_PROVIDER'] as const

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k]
})

import { resolveProvider, providerSetting, taskForOp, backendForChoice } from '../../src/lib/laxii/provider'
import { generativeWorkerStatus, getModelCatalog } from '../../src/lib/laxii/models'
import { BeanApiError } from '../../src/lib/api/errors'
import { getBackend } from '../../src/lib/registry/backends'

describe('providerSetting', () => {
  test('defaults to auto', () => {
    expect(providerSetting()).toBe('auto')
  })
  test('parses diffusers (case-insensitive); unknown values fall back to auto', () => {
    process.env.LAXII_PROVIDER = 'DIFFUSERS'
    expect(providerSetting()).toBe('diffusers')
    process.env.LAXII_PROVIDER = 'bogus'
    expect(providerSetting()).toBe('auto')
  })
})

describe('resolveProvider (worker registry-disabled, as shipped)', () => {
  test('deterministic enhancement → local engine (always available)', () => {
    expect(resolveProvider('deterministic-enhance')).toBe('local-engine')
  })

  test('text-to-image → managed provider', () => {
    expect(resolveProvider('text-to-image')).toBe('managed')
  })

  test('every generative op refuses with PROVIDER_UNAVAILABLE while disabled', () => {
    for (const op of ['masked-inpaint', 'reference-guided', 'identity-generate', 'object-removal', 'model-upscale'] as const) {
      try {
        resolveProvider(op)
        throw new Error(`${op} unexpectedly resolved — the disabled worker was treated as available`)
      } catch (e) {
        expect(e).toBeInstanceOf(BeanApiError)
        expect((e as BeanApiError).code).toBe('PROVIDER_UNAVAILABLE')
        expect((e as BeanApiError).message).toContain('not operational')
      }
    }
  })

  test('the refusal explicitly promises the image was not modified', () => {
    try {
      resolveProvider('masked-inpaint')
    } catch (e) {
      expect((e as BeanApiError).message).toContain('Your image was not modified')
    }
  })
})

describe('task and backend mapping', () => {
  test('taskForOp maps ops to their router tasks', () => {
    expect(taskForOp('text-to-image')).toBe('image-generation')
    expect(taskForOp('deterministic-enhance')).toBe('image-enhancement')
    expect(taskForOp('masked-inpaint')).toBe('image-editing')
  })

  test('backendForChoice is total over the choice union', () => {
    expect(backendForChoice('managed')).toBe('bean-image-hosted-primary')
    expect(backendForChoice('local-engine')).toBe('bean-image-local-sharp')
    expect(backendForChoice('diffusers-worker')).toBe('bean-image-selfhosted-diffusers')
  })
})

describe('capability truth (registry is the single source)', () => {
  test('generativeWorkerStatus reports disabled with the truthful reason', () => {
    const s = generativeWorkerStatus()
    expect(s.registryEnabled).toBe(false)
    expect(s.unavailableReason).toContain('no real inference test')
  })

  test('the local engine is enabled in the registry', () => {
    expect(getBackend('bean-image-local-sharp')?.enabled).toBe(true)
    expect(getBackend('bean-image-local-sharp')?.limits.generative).toBe(false)
  })

  test('the managed provider remains enabled and untouched', () => {
    const managed = getBackend('bean-image-hosted-primary')
    expect(managed?.enabled).toBe(true)
    expect(managed?.limits.imageToImage).toBe(false)
  })
})

describe('model catalog (public-safe)', () => {
  test('every entry carries license and commercial-use facts', () => {
    for (const m of getModelCatalog()) {
      expect(m.license.length).toBeGreaterThanOrEqual(3) // e.g. "MIT"
      expect(m.commercialUse.length).toBeGreaterThan(3)
      expect(m.status).toBeTruthy()
    }
  })

  test('rejected non-commercial stacks are absent from the catalog', () => {
    const ids = getModelCatalog().map((m) => m.id)
    expect(ids).not.toContain('instantid')
    expect(ids).not.toContain('ip-adapter-faceid')
    expect(ids).not.toContain('flux1-dev')
  })

  test('FLUX schnell is candidate-only, never default', () => {
    const flux = getModelCatalog().find((m) => m.id === 'flux1-schnell')
    expect(flux?.status).toBe('candidate-only')
  })
})
