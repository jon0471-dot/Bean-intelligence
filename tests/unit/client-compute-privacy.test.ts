/**
 * Client compute — privacy and consent gates (spec Phase 8).
 */
import { describe, test, expect, beforeEach } from 'bun:test'
import { getConsent, setConsent, revokeConsent, isDeviceComputeAllowed, isLocalOnlyMode, redactForDiagnostics, onConsentChange } from '@/lib/client-compute/privacy'

beforeEach(() => {
  revokeConsent()
})

describe('client-compute privacy and consent', () => {
  test('default state: no device compute allowed without explicit consent', () => {
    const consent = getConsent()
    // null = never asked; a persisted record must carry granted:false.
    expect(consent === null || consent.granted === false).toBe(true)
    expect(isDeviceComputeAllowed()).toBe(false)
    expect(isLocalOnlyMode()).toBe(false)
  })

  test('explicit consent grants device compute', () => {
    setConsent(true, false)
    expect(isDeviceComputeAllowed()).toBe(true)
    expect(isLocalOnlyMode()).toBe(false)
    const consent = getConsent()
    expect(consent?.version).toBe(1)
    expect(consent?.granted).toBe(true)
  })

  test('local-only mode: granted + localOnly both required', () => {
    setConsent(true, true)
    expect(isDeviceComputeAllowed()).toBe(true)
    expect(isLocalOnlyMode()).toBe(true)
    setConsent(false, true)
    expect(isDeviceComputeAllowed()).toBe(false)
    expect(isLocalOnlyMode()).toBe(false)
  })

  test('localOnly cannot be true without granted consent', () => {
    const consent = setConsent(false, true)
    expect(consent.localOnly).toBe(false)
  })

  test('revocation clears everything', () => {
    setConsent(true, true)
    const revoked = revokeConsent()
    expect(revoked.granted).toBe(false)
    expect(isDeviceComputeAllowed()).toBe(false)
    expect(isLocalOnlyMode()).toBe(false)
  })

  test('consent changes notify subscribers', () => {
    const state: { seen: boolean | null } = { seen: null }
    const off = onConsentChange((c) => {
      state.seen = c?.granted ?? null
    })
    setConsent(true, false)
    expect(state.seen).toBe(true)
    off()
    setConsent(false, false)
    expect(state.seen).toBe(true) // listener detached
  })

  test('redaction: diagnostics never carry long payloads or raw objects', () => {
    expect(redactForDiagnostics(42)).toBe('42')
    expect(redactForDiagnostics(true)).toBe('true')
    expect(redactForDiagnostics('short note')).toBe('short note')
    const long = 'x'.repeat(5000)
    const redacted = redactForDiagnostics(long)
    expect(redacted.length).toBeLessThan(120)
    expect(redacted).toMatch(/truncated 5000 chars/)
    expect(redactForDiagnostics({ media: 'bytes' })).toBe('[object]')
    expect(redactForDiagnostics(null)).toBe('')
  })
})
