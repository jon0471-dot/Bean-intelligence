/**
 * JAZMII AUTO DIRECTOR — composition engine selection + HyperFrames probe
 * honesty.
 *
 * Pinned behavior (spec §4):
 *  - the FFmpeg engine is the ALWAYS-available floor ('ffmpeg' preference
 *    never depends on HyperFrames);
 *  - 'auto' resolves HyperFrames ONLY when its probe passes (Node ≥ 22,
 *    pinned CLI, managed headless Chrome, vendored GSAP) and records the
 *    honest fallback note otherwise;
 *  - an explicit 'hyperframes' preference with a failing probe surfaces the
 *    REAL blocker at compose time (probe reason), never a silent FFmpeg swap;
 *  - the pinned version is exact — never a floating latest.
 */
import { describe, test, expect } from 'bun:test'
import {
  resolveCompositionEngine,
  HYPERFRAMES_VERSION,
  createHyperframesCompositionEngine,
} from '../../src/lib/jazmii/director/composition'

describe('composition engine selection', () => {
  test('the pinned HyperFrames version is exact (never floating)', () => {
    expect(HYPERFRAMES_VERSION).toBe('0.9.72')
    expect(/^\d+\.\d+\.\d+$/.test(HYPERFRAMES_VERSION)).toBe(true)
  })

  test('the ffmpeg preference always resolves to the ffmpeg engine', async () => {
    const { engine, fallbackNote } = await resolveCompositionEngine('ffmpeg')
    expect(engine.id).toBe('ffmpeg')
    expect(fallbackNote).toBeNull()
    const probe = await engine.probe()
    expect(probe.available).toBe(true)
  })

  test('the hyperframes probe reports its REAL availability with details', async () => {
    const engine = createHyperframesCompositionEngine()
    const probe = await engine.probe()
    // This environment has the pinned CLI + managed Chrome installed, so the
    // honest answer here is available=true; the assertions cover BOTH shapes
    // so the contract holds on any host.
    expect(typeof probe.available).toBe('boolean')
    expect(probe.detail.pinnedVersion).toBe(HYPERFRAMES_VERSION)
    if (probe.available) {
      expect(probe.reason).toBeNull()
      expect(probe.detail.cli).toContain('hyperframes')
      expect(probe.detail.browser).toContain('chrome-headless-shell')
    } else {
      expect(probe.reason).toBeTruthy()
    }
  })

  test('auto resolves to a working engine and records a fallback note only when real', async () => {
    const { engine, fallbackNote } = await resolveCompositionEngine('auto')
    expect(['ffmpeg', 'hyperframes']).toContain(engine.id)
    if (engine.id === 'ffmpeg') {
      // The fallback note must state the REAL blocker, not a vague failure.
      expect(fallbackNote).toContain('HyperFrames unavailable')
    } else {
      expect(fallbackNote).toBeNull()
    }
  })
})
