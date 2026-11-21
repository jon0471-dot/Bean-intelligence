/**
 * BEAN Intelligence — JAZMII Auto Director: composition engine adapter boundary.
 *
 * The composition stage assembles generated scene clips, titles, captions,
 * transitions and audio into ONE finished video. Two engines sit behind this
 * narrow interface:
 *
 *   - 'ffmpeg'      — the always-available local FFmpeg filtergraph engine
 *                     (deterministic concat + fades + drawtext + audio mix);
 *                     the basic export NEVER depends on anything else.
 *   - 'hyperframes' — the verified local HyperFrames CLI (pinned version)
 *                     rendering a generated HTML/GSAP composition in
 *                     headless Chrome; used when its probe AND its own
 *                     `check` quality gate pass.
 *
 * The boundary is intentional (spec §4): JAZMII's domain logic never imports
 * HyperFrames-specific implementation details — it speaks only in
 * CompositionPlan / CompositionResult.
 *
 * SERVER-ONLY.
 */
import type { VideoStreamProbe } from '@/lib/media/ffprobe'

export type CompositionEngineId = 'ffmpeg' | 'hyperframes'

/** One scene's composition input (idx is 1-based, timeline-ordered). */
export interface CompositionSceneInput {
  idx: number
  /** Absolute path of the scene clip (already ffprobe-validated). */
  clipPath: string
  /** Planned display seconds (integer, 3..12 — matches the storyboard). */
  durationSec: number
  /** Caption overlaid on this scene (null = none). */
  caption: string | null
  /** How this scene hands over to the next one. */
  transitionOut: 'cut' | 'fade'
}

export interface CompositionPlan {
  productionId: string
  title: string
  canvas: { width: number; height: number; fps: number }
  /** Background hex (without '#'), e.g. '0x0a0a0f' — pad/fade/end-card ground. */
  background: string
  scenes: CompositionSceneInput[]
  /** Closing brand card appended after the last scene. */
  endCard: { title: string; subtitle: string | null; durationSec: number }
  /** User-supplied audio (absolute local paths, already validated server-side). */
  audio: {
    musicPath: string | null
    musicVolume: number
    /** Attribution/license note recorded verbatim in the render metadata. */
    musicAttribution: string | null
    voiceoverPath: string | null
    voiceoverVolume: number
  }
  /** Work directory (absolute) the engine may use for intermediates. */
  workDir: string
  /** Where the finished MP4 must be written (absolute). */
  outputPath: string
}

export interface CompositionResult {
  engine: CompositionEngineId
  /** Absolute path of the rendered MP4. */
  videoPath: string
  bytes: number
  /** ffprobe-measured facts of the rendered file (the real validation). */
  probe: VideoStreamProbe
  /** Planned vs measured duration in seconds (honest accounting). */
  plannedDurationSec: number
  measuredDurationSec: number
  /** Absolute poster frame path (JPEG). */
  posterPath: string
  /** Where the poster frame was taken (seconds into the final video). */
  posterAtSec: number
  /** SRT captions path when any scene carries a caption. */
  captionsPath: string | null
  /** Honest engine notes (fallback reasons, check findings, audio notes). */
  notes: string[]
}

export interface CompositionEngine {
  readonly id: CompositionEngineId
  /** Human-readable identity incl. the pinned runtime version. */
  readonly describe: string
  /**
   * Cheap capability probe (filesystem/binary checks — never runs a render).
   * `reason` explains unavailability honestly when available=false.
   */
  probe(): Promise<{ available: boolean; reason: string | null; detail: Record<string, unknown> }>
  /** Render the plan. Throws Error with a customer-safe message on failure. */
  compose(plan: CompositionPlan): Promise<CompositionResult>
}
