/**
 * BEAN Intelligence — JAZMII Auto Director: composition engine selection.
 *
 * Resolution order (honest, probe-gated — never a silent pretend engine):
 *  1. explicit 'ffmpeg'  → the FFmpeg engine (always the safe floor);
 *  2. explicit 'hyperframes' → the HyperFrames adapter; unavailable = hard
 *     honest error (the user explicitly asked for it);
 *  3. 'auto' → HyperFrames when its probe passes, otherwise FFmpeg with a
 *     recorded fallback note. The basic video export NEVER depends on
 *     HyperFrames being installed.
 *
 * SERVER-ONLY.
 */
import { createFfmpegCompositionEngine } from './ffmpeg-engine'
import { createHyperframesCompositionEngine } from './hyperframes-engine'
import type { CompositionEngine, CompositionEngineId } from './types'

export type { CompositionEngine, CompositionEngineId, CompositionPlan, CompositionResult } from './types'
export { HYPERFRAMES_VERSION } from './hyperframes-engine'
export { createFfmpegCompositionEngine, createHyperframesCompositionEngine }

export async function resolveCompositionEngine(
  preference: 'auto' | 'hyperframes' | 'ffmpeg',
): Promise<{ engine: CompositionEngine; fallbackNote: string | null }> {
  if (preference === 'ffmpeg') {
    return { engine: createFfmpegCompositionEngine(), fallbackNote: null }
  }
  const hf = createHyperframesCompositionEngine()
  if (preference === 'hyperframes') {
    return { engine: hf, fallbackNote: null }
  }
  // auto
  const probe = await hf.probe()
  if (probe.available) {
    return { engine: hf, fallbackNote: null }
  }
  return {
    engine: createFfmpegCompositionEngine(),
    fallbackNote: `HyperFrames unavailable (${probe.reason}) — composed with the local FFmpeg engine instead.`,
  }
}

/** Registry of engine ids for admin/diagnostic surfaces. */
export const COMPOSITION_ENGINE_IDS: CompositionEngineId[] = ['ffmpeg', 'hyperframes']
