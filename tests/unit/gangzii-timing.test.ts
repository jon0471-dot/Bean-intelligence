/**
 * GANGZII M28 Priority E — timing confidence tests.
 *
 * The honest vocabulary: measured vs estimated vs unavailable; a broken
 * measured chain never silently passes as measured; estimates are explicit
 * and never exported to subtitles.
 */
import { describe, test, expect } from 'bun:test'
import {
  timingConfidenceFor,
  estimateSegmentDurationMs,
  buildTimelineTiming,
} from '@/lib/gangzii/timing'

describe('timingConfidenceFor', () => {
  test('a measured duration is segment-measured', () => {
    expect(timingConfidenceFor({ durationMs: 3200, hasAudioArtifact: true })).toBe('segment-measured')
    expect(timingConfidenceFor({ durationMs: 3200, hasAudioArtifact: false })).toBe('segment-measured')
  })

  test('no duration → unavailable, never estimated silently', () => {
    expect(timingConfidenceFor({ durationMs: null, hasAudioArtifact: true })).toBe('unavailable')
    expect(timingConfidenceFor({ durationMs: 0, hasAudioArtifact: true })).toBe('unavailable')
    expect(timingConfidenceFor({ durationMs: Number.NaN, hasAudioArtifact: true })).toBe('unavailable')
    expect(timingConfidenceFor({ durationMs: null, hasAudioArtifact: false })).toBe('unavailable')
  })

  test('word-verified is NOT reachable from heuristics (reserved)', () => {
    // The function's output type can produce it in the type system, but the
    // implementation must never return it for anything but an actual aligner.
    for (const d of [null, 0, 1000, 99999]) {
      expect(timingConfidenceFor({ durationMs: d, hasAudioArtifact: true })).not.toBe('word-verified')
    }
  })
})

describe('estimateSegmentDurationMs', () => {
  test('English text estimates from word count at the measured Kokoro pace', () => {
    const est = estimateSegmentDurationMs('one two three four five six seven eight nine ten') // 10 words
    expect(est.confidence).toBe('segment-estimated')
    expect(est.durationMs).toBe(Math.round((10 / 2.6) * 1000))
  })

  test('CJK text falls back to character pacing', () => {
    const est = estimateSegmentDurationMs('这是六个字的句子', 'Chinese') // 8 chars
    expect(est.confidence).toBe('segment-estimated')
    expect(est.durationMs).toBe(Math.round((8 / 6.5) * 1000))
  })
})

describe('buildTimelineTiming — the measured chain', () => {
  test('measured segments accumulate starts; unchanged segments keep exact durations', () => {
    const t = buildTimelineTiming([
      { idx: 1, durationMs: 2000 },
      { idx: 2, durationMs: 1500 },
      { idx: 3, durationMs: 3000 },
    ])
    expect(t.map((x) => x.confidence)).toEqual(['segment-measured', 'segment-measured', 'segment-measured'])
    expect(t.map((x) => x.startMs)).toEqual([0, 2000, 3500])
    expect(t[2].durationMs).toBe(3000)
  })

  test('a broken measured chain labels later segments unavailable — with an EXPLICIT estimate only', () => {
    const t = buildTimelineTiming([
      { idx: 1, durationMs: 2000, text: 'measured intro sentence here' },
      { idx: 2, durationMs: null, text: 'one two three four' },
      { idx: 3, durationMs: 2500, text: 'measured tail' },
    ])
    expect(t[0].confidence).toBe('segment-measured')
    expect(t[0].startMs).toBe(0)
    expect(t[1].confidence).toBe('unavailable')
    expect(t[1].startMs).toBeNull()
    expect(t[1].approximatedByEstimateMs).toBeDefined()
    expect(t[2].confidence).toBe('unavailable') // anchor unknown after the break
    expect(t[2].startMs).toBeNull()
    expect(t[2].durationMs).toBe(2500) // the measured duration is still kept
  })

  test('regenerating one segment changes only downstream starts, not other durations', () => {
    const before = buildTimelineTiming([
      { idx: 1, durationMs: 1000 },
      { idx: 2, durationMs: 2000 },
      { idx: 3, durationMs: 3000 },
    ])
    const after = buildTimelineTiming([
      { idx: 1, durationMs: 1000 },
      { idx: 2, durationMs: 2600 }, // segment 2 regenerated (longer)
      { idx: 3, durationMs: 3000 }, // unchanged
    ])
    expect(before[0].startMs).toBe(after[0].startMs) // segment 1 untouched
    expect(after[2].startMs).toBe(1000 + 2600) // honest downstream shift
    expect(after[2].durationMs).toBe(before[2].durationMs) // duration preserved
  })
})

import { computeTimingReviewFlags } from '@/lib/gangzii/timing'

describe('computeTimingReviewFlags (M28 Priority F)', () => {
  const timing = [
    { idx: 1, sceneIdx: 1, confidence: 'segment-measured' as const, durationMs: 4000 },
    { idx: 2, sceneIdx: 2, confidence: 'segment-measured' as const, durationMs: 9000 },
    { idx: 3, sceneIdx: 5, confidence: 'segment-measured' as const, durationMs: 2000 },
    { idx: 4, sceneIdx: null, confidence: 'unavailable' as const, durationMs: null },
  ]
  const scenes = [
    { idx: 1, durationSec: 5 },
    { idx: 2, durationSec: 6 },
    { idx: 3, durationSec: 5 },
  ]

  test('speech overrunning a shortened scene is flagged, not silently moved', () => {
    const flags = computeTimingReviewFlags(timing, scenes)
    const overrun = flags.find((f) => f.segmentIdx === 2)
    expect(overrun?.flag).toBe('speech-overruns-scene')
    expect(overrun?.detail).toContain('9000 ms')
  })

  test('an association pointing at a removed/renumbered scene is flagged', () => {
    const flags = computeTimingReviewFlags(timing, scenes)
    const outOfRange = flags.find((f) => f.segmentIdx === 3)
    expect(outOfRange?.flag).toBe('scene-out-of-range')
    expect(outOfRange?.sceneIdx).toBe(5)
  })

  test('unmeasured timing is flagged for regeneration', () => {
    const flags = computeTimingReviewFlags(timing, scenes)
    expect(flags.find((f) => f.segmentIdx === 4)?.flag).toBe('timing-unavailable')
  })

  test('a healthy timeline produces no flags', () => {
    const healthy = [
      { idx: 1, sceneIdx: 1, confidence: 'segment-measured' as const, durationMs: 3000 },
      { idx: 2, sceneIdx: 2, confidence: 'segment-measured' as const, durationMs: 4000 },
    ]
    expect(computeTimingReviewFlags(healthy, scenes)).toEqual([])
  })
})
