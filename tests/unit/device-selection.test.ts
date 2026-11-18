/**
 * BEAN Intelligence — resilient selection policy regressions (DeviceCapabilityManager).
 * Pins the 5-step policy honestly, including the negative paths:
 *  - no consent → server fallback (or honest unavailable in local-only);
 *  - server mode → never device lanes;
 *  - local-only privacy → backend fallback FORBIDDEN (null target);
 *  - non-browser environment → device lanes honestly unavailable.
 */
import { describe, test, expect, beforeEach } from 'bun:test'
import { DeviceCapabilityManager, webLlmResidency } from '@/lib/client-compute/inference/device-capability-manager'
import { setDeviceSettings, resetDeviceSettingsForTests } from '@/lib/client-compute/inference/device-settings'
import { setConsent } from '@/lib/client-compute/privacy'

let manager: DeviceCapabilityManager

beforeEach(() => {
  resetDeviceSettingsForTests()
  setDeviceSettings({ mode: 'auto' })
  // Reset consent too: it lives in a module-level stub and would otherwise
  // leak across tests (the honest gates must be tested in isolation).
  setConsent(false, false)
  manager = new DeviceCapabilityManager()
})

describe('selection policy', () => {
  test('server mode: every device lane routes to the server lane', () => {
    setDeviceSettings({ mode: 'server' })
    for (const kind of ['chat.on-device', 'audio.transcription.on-device', 'chat.local-engine'] as const) {
      const d = manager.selectExecutionPath(kind)
      expect(d.target).toBe('server')
      expect(d.reasons.join(' ')).toContain('mode "server" does not use')
    }
  })

  test('no consent: device lanes fall back to the server lane (honest, not silent device use)', () => {
    // consent is absent by default in this environment (localStorage stub)
    const d = manager.selectExecutionPath('chat.on-device')
    expect(d.target).toBe('server')
    expect(d.reasons.join(' ')).toContain('consent')
  })

  test('local-only privacy forbids the backend fallback (honest unavailable, never a silent server send)', () => {
    setConsent(true, true)
    setDeviceSettings({ mode: 'cpu-only' })
    const d = manager.selectExecutionPath('chat.on-device')
    expect(d.target).toBeNull()
    expect(d.reasons.join(' ')).toContain('local-only privacy mode forbids the server fallback')
  })

  test('local engine lane without pairing reports the missing pairing honestly', () => {
    const d = manager.selectExecutionPath('chat.local-engine')
    expect(d.target).toBe('server')
    expect(d.reasons.join(' ')).toContain('no local desktop engine is paired')
  })

  test('non-browser environment: device chat lane cannot claim client-gpu', () => {
    setConsent(true, false)
    // In bun tests there is no DOM — the capability snapshot is the honest
    // 'non-browser' one, so the WebGPU gate must fail (no fabricated GPU).
    const d = manager.selectExecutionPath('chat.on-device')
    expect(d.target).not.toBe('client-gpu')
  })

  test('memory budget is a labeled policy estimate (null outside a browser, never a measured claim)', () => {
    const budget = manager.estimateSafeModelMemoryBudgetMb()
    // Non-browser context: the honest answer is null (nothing measured).
    expect(budget).toBeNull()
  })

  test('residency mirror starts empty (no fabricated loaded-model state)', () => {
    expect(webLlmResidency.current).toBeNull()
  })
})
