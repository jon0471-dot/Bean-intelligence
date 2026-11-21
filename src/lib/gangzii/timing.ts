/**
 * BEAN Intelligence — GANGZII narration timing confidence (M28 Priority E).
 *
 * A single honest vocabulary for "how good is this timestamp" that every
 * consumer (subtitles, JAZMII sync, ducking regions, the UI) shares:
 *
 *   word-verified      word-level alignment actually performed against the
 *                      audio (NO engine does this today — see
 *                      docs/models/GANGZII-TIMING-ALIGNMENT-EVALUATION.md);
 *                      reserved, never self-assigned by heuristics.
 *   segment-measured   segment boundaries derived from the MEASURED duration
 *                      of the real audio artifact (ffprobe/kokoro output).
 *                      This is the production baseline.
 *   segment-estimated  segment boundaries ESTIMATED without audio (text
 *                      length heuristic). Never exported to subtitles, never
 *                      used for ducking regions — preview/sync-planning only,
 *                      always labeled estimated.
 *   unavailable        no timing information at all.
 *
 * The contract exists so approximate timestamps can never masquerade as
 * precise word alignment: consumers must carry the confidence value through
 * to whatever the user sees.
 */

export type TimingConfidence = 'word-verified' | 'segment-measured' | 'segment-estimated' | 'unavailable'

export type TimingReviewFlag = 'scene-out-of-range' | 'speech-overruns-scene' | 'timing-unavailable'

export interface TimingReviewFlagRow {
  segmentIdx: number
  sceneIdx: number | null
  flag: TimingReviewFlag
  detail: string
}

/**
 * M28 Priority F: pure review-flag computation from the built timeline
 * against the CURRENT scene layout. Used by the JAZMII narration-timing
 * writer — scene duration or order changes after narration attach produce
 * explicit flags (never silently moved audio, never re-synthesized speech).
 */
export function computeTimingReviewFlags(
  timing: Array<{ idx: number; sceneIdx?: number | null; confidence: TimingConfidence; durationMs: number | null }>,
  scenes: Array<{ idx: number; durationSec: number }>,
): TimingReviewFlagRow[] {
  const flags: TimingReviewFlagRow[] = []
  for (const t of timing) {
    const sceneIdx = t.sceneIdx ?? null
    const scene = sceneIdx !== null ? scenes.find((s) => s.idx === sceneIdx) : undefined
    if (sceneIdx !== null && !scene) {
      flags.push({
        segmentIdx: t.idx,
        sceneIdx,
        flag: 'scene-out-of-range',
        detail: `Association points at scene ${sceneIdx}, which does not exist in the current storyboard (scene count/order changed). Re-draft narration from captions or re-associate.`,
      })
    }
    if (scene && t.durationMs !== null && t.durationMs / 1000 > scene.durationSec + 0.5) {
      flags.push({
        segmentIdx: t.idx,
        sceneIdx,
        flag: 'speech-overruns-scene',
        detail: `Segment audio ${t.durationMs} ms exceeds scene ${sceneIdx} duration ${scene.durationSec} s by more than 0.5 s — trim the narration, split the segment, or lengthen the scene.`,
      })
    }
    if (t.confidence === 'unavailable') {
      flags.push({
        segmentIdx: t.idx,
        sceneIdx,
        flag: 'timing-unavailable',
        detail: 'No measured timing for this segment (regenerate it in GANGZII to restore the measured chain).',
      })
    }
  }
  return flags
}

export interface ConfidenceSegmentInput {
  /** Measured duration of the real audio artifact (ms), null when absent. */
  durationMs: number | null
  /** Segment exists in the timeline at all? */
  hasAudioArtifact: boolean
}

/** Classify one segment honestly — the only place the rules live. */
export function timingConfidenceFor(input: ConfidenceSegmentInput): TimingConfidence {
  if (input.durationMs !== null && Number.isFinite(input.durationMs) && input.durationMs > 0) {
    return 'segment-measured'
  }
  return input.hasAudioArtifact ? 'unavailable' : 'unavailable'
}

/**
 * Text-length duration estimate (words per second heuristic for narration
 * pace). Deliberately coarse and ALWAYS returned with 'segment-estimated':
 * it is a planning/preview aid, never a substitute for measurement.
 * ~2.6 words/second is the measured pace of the Kokoro English voices at
 * speed 1.0 (M27/M28 evaluation runs); the estimate degrades for non-English
 * text — which is exactly why it is labeled.
 */
export function estimateSegmentDurationMs(text: string, language = 'English (American)'): { durationMs: number; confidence: 'segment-estimated' } {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  const chars = text.length
  // Non-English text has no space-separated words — fall back to characters.
  const isWordBased = /^(English|Spanish|French|Italian|Portuguese)/i.test(language)
  const seconds = isWordBased
    ? Math.max(0.4, words / 2.6)
    : Math.max(0.4, chars / 6.5) // CJK-ish pacing fallback
  return { durationMs: Math.round(seconds * 1000), confidence: 'segment-estimated' }
}

export interface TimelineSegment {
  idx: number
  segmentId?: string
  sceneIdx?: number | null
  text?: string
  status?: string
  /** Measured duration when available (ms). */
  durationMs: number | null
  /** Cumulative start derived from measured durations (ms) — null when the chain is broken. */
  measuredStartMs: number | null
  /** Confidence of measuredStartSec/durationMs as labeled. */
  confidence: TimingConfidence
}

/**
 * Build the honest timeline view: measured cumulative starts where every
 * PRECEDING segment is measured; a segment after an unmeasured one cannot
 * have a trustworthy measured start (its anchor is unknown) — it is labeled
 * unavailable rather than estimated silently.
 */
export function buildTimelineTiming(
  segments: Array<{ idx: number; segmentId?: string; sceneIdx?: number | null; text?: string; status?: string; durationMs: number | null }>,
): Array<{ idx: number; segmentId?: string; sceneIdx?: number | null; text?: string; status?: string; durationMs: number | null; startMs: number | null; confidence: TimingConfidence; approximatedByEstimateMs?: number }> {
  const out: Array<{ idx: number; segmentId?: string; sceneIdx?: number | null; text?: string; status?: string; durationMs: number | null; startMs: number | null; confidence: TimingConfidence; approximatedByEstimateMs?: number }> = []
  let cursorMs = 0
  let chainIntact = true
  for (const s of segments.slice().sort((a, b) => a.idx - b.idx)) {
    const measured = s.durationMs !== null && Number.isFinite(s.durationMs) && (s.durationMs as number) > 0
    if (measured && chainIntact) {
      const startMs = cursorMs
      cursorMs += s.durationMs as number
      out.push({ ...s, startMs, confidence: 'segment-measured' })
      continue
    }
    // Chain broken: this segment (and everything after) has no trustworthy
    // measured start. An ESTIMATE may be attached explicitly, never silently.
    chainIntact = false
    const est = s.text ? estimateSegmentDurationMs(s.text).durationMs : null
    out.push({
      ...s,
      startMs: null,
      confidence: 'unavailable',
      ...(est !== null ? { approximatedByEstimateMs: est } : {}),
    })
    if (est !== null) cursorMs += est // keep the estimate chain for later previews
  }
  return out
}
