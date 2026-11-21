/**
 * GANGZII M27 — Narration Studio unit tests.
 *
 * Pure-logic coverage for the honest text-preparation contract:
 *  - normalization never silently rewrites the user's wording (changes are
 *    classified and bounded; overrides apply last and are echoed);
 *  - segmentation is deterministic and sentence-preserving;
 *  - subtitles only ever carry MEASURED timings — unmeasured segments are
 *    skipped and counted, never estimated;
 *  - the local Kokoro engine's splitter respects the model's input window;
 *  - registry invariants: GANGZII is a real product with real backends and
 *    DISJOINT voice catalogs (engine selection is voice-driven, so an
 *    overlapping catalog would silently swap engines).
 */
import { describe, test, expect } from 'bun:test'
import {
  normalizeTextForSpeech,
  segmentTextForNarration,
  buildSubtitles,
  numberToWords,
  type SubtitleSegment,
} from '@/lib/gangzii/text-normalize'
import { splitTextForKokoro } from '@/lib/gangzii/tts-engine'
import { BEAN_PRODUCTS, getProduct, GANGZII_LIMITS } from '@/lib/registry/products'
import { getBackendsForProduct } from '@/lib/registry/backends'
import {
  GANGZII_VOICE_PRESETS,
  KOKORO_VOICE_PRESETS,
  isHostedVoice,
  isKokoroVoice,
} from '@/lib/registry/gangzii-presets'

// ---------------------------------------------------------------------------
// numberToWords
// ---------------------------------------------------------------------------

describe('numberToWords', () => {
  test('ones, teens, tens', () => {
    expect(numberToWords(0)).toBe('zero')
    expect(numberToWords(7)).toBe('seven')
    expect(numberToWords(15)).toBe('fifteen')
    expect(numberToWords(42)).toBe('forty two')
  })
  test('hundreds, thousands, millions', () => {
    expect(numberToWords(300)).toBe('three hundred')
    expect(numberToWords(1234)).toBe('one thousand two hundred and thirty four')
    expect(numberToWords(2_500_000)).toBe('two million five hundred thousand')
  })
  test('decimals are spoken point-wise', () => {
    expect(numberToWords(3.14)).toBe('three point one four')
  })
})

// ---------------------------------------------------------------------------
// normalizeTextForSpeech — classified, bounded, echoable rewrites
// ---------------------------------------------------------------------------

describe('normalizeTextForSpeech', () => {
  test('whitespace is collapsed and reported, wording unchanged', () => {
    const r = normalizeTextForSpeech('Hello   world\t\tagain')
    expect(r.normalized).toBe('Hello world again')
    expect(r.changes.some((c) => c.kind === 'whitespace')).toBe(true)
  })

  test('integers expand to spoken words (en)', () => {
    const r = normalizeTextForSpeech('We shipped 3 versions in 2026.')
    expect(r.normalized).toBe('We shipped three versions in twenty twenty six.')
    expect(r.changes.some((c) => c.kind === 'number')).toBe(true)
    expect(r.changes.some((c) => c.kind === 'year')).toBe(true)
  })

  test('currency expands with cents (en)', () => {
    const r = normalizeTextForSpeech('It costs $12.50 today.')
    expect(r.normalized).toBe('It costs twelve dollars and fifty cents today.')
  })

  test('URLs become spoken dot/slash forms (en)', () => {
    const r = normalizeTextForSpeech('See https://example.com/pricing for details.')
    expect(r.normalized).toContain('example dot com slash pricing')
    expect(r.changes.some((c) => c.kind === 'url')).toBe(true)
  })

  test('abbreviations expand for capitalized names only (Dr. Meier)', () => {
    const r = normalizeTextForSpeech('Dr. Chen arrived.')
    expect(r.normalized).toBe('Doctor Chen arrived.')
  })

  test('clock times expand (9:30)', () => {
    const r = normalizeTextForSpeech('The event starts at 9:30 sharp.')
    expect(r.normalized).toContain('nine thirty')
  })

  test('pronunciation overrides apply LAST and are echoed', () => {
    const r = normalizeTextForSpeech('The song is called NADIR.', {
      overrides: [{ from: 'NADIR', to: 'nah-DEER' }],
    })
    expect(r.normalized).toContain('nah-DEER')
    expect(r.overridesApplied).toEqual([{ from: 'NADIR', to: 'nah-DEER' }])
    expect(r.changes.some((c) => c.kind === 'pronunciation-override')).toBe(true)
  })

  test('CJK punctuation spacing only — no rewording (zh not verified for expansion)', () => {
    const r = normalizeTextForSpeech('你好，世界！', { language: 'zh' })
    expect(r.normalized).toBe('你好, 世界! ')
    expect(r.changes.some((c) => c.kind === 'cjk-punctuation')).toBe(true)
    expect(r.changes.some((c) => c.kind === 'number')).toBe(false)
  })

  test('the original text is never mutated (pure function)', () => {
    const original = '  3 items  cost $5. '
    const copy = original
    normalizeTextForSpeech(original)
    expect(original).toBe(copy)
  })
})

// ---------------------------------------------------------------------------
// segmentTextForNarration — deterministic, sentence-preserving
// ---------------------------------------------------------------------------

describe('segmentTextForNarration', () => {
  test('empty text yields no segments', () => {
    expect(segmentTextForNarration('')).toEqual([])
    expect(segmentTextForNarration('   ')).toEqual([])
  })

  test('sentence-per-segment when the cap forces it (maxChars small)', () => {
    // Each sentence fits under 22 chars but no two accumulate together.
    const segments = segmentTextForNarration('First sentence here. Second one follows! Third question?', 22)
    expect(segments.length).toBe(3)
    expect(segments[0]).toBe('First sentence here.')
    expect(segments[1]).toBe('Second one follows!')
    expect(segments[2]).toBe('Third question?')
  })

  test('accumulates short sentences without needless splits', () => {
    const segments = segmentTextForNarration('One. Two. Three.', 500)
    expect(segments).toEqual(['One. Two. Three.'])
  })

  test('oversized sentences split on word boundaries (never mid-word)', () => {
    const long = 'word '.repeat(150).trim() // 750+ chars, no sentence enders
    const segments = segmentTextForNarration(long, 500)
    expect(segments.length).toBeGreaterThanOrEqual(2)
    for (const s of segments) expect(s.length).toBeLessThanOrEqual(500)
    expect(segments.join(' ').split(/\s+/).length).toBe(150)
  })

  test('same input always yields the same segmentation (deterministic)', () => {
    const text = 'Alpha beta. Gamma delta! Epsilon zeta?'
    expect(segmentTextForNarration(text)).toEqual(segmentTextForNarration(text))
  })
})

// ---------------------------------------------------------------------------
// buildSubtitles — measured timings only, honest skipping
// ---------------------------------------------------------------------------

describe('buildSubtitles', () => {
  const segments: SubtitleSegment[] = [
    { idx: 1, text: 'Measured one.', durationMs: 1500 },
    { idx: 2, text: 'Unmeasured (still generating).', durationMs: null },
    { idx: 3, text: 'Measured two.', durationMs: 800 },
  ]

  test('SRT: measured segments only, contiguous, comma milliseconds', () => {
    const r = buildSubtitles(segments, 'srt')
    expect(r.measuredCount).toBe(2)
    expect(r.skippedCount).toBe(1)
    expect(r.content).toContain('00:00:00,000 --> 00:00:01,500')
    expect(r.content).toContain('Measured one.')
    // The unmeasured segment NEVER appears with an estimated timestamp.
    expect(r.content).not.toContain('Unmeasured')
  })

  test('VTT: WEBVTT header, dot milliseconds, honesty note', () => {
    const r = buildSubtitles(segments, 'vtt')
    expect(r.content.startsWith('WEBVTT')).toBe(true)
    expect(r.content).toContain('not word-level alignment')
    expect(r.content).toContain('00:00:01.500 --> 00:00:02.300')
  })

  test('all-unmeasured input produces an empty (honest) subtitle body', () => {
    const r = buildSubtitles(
      [{ idx: 1, text: 'Nothing measured.', durationMs: null }],
      'srt',
    )
    expect(r.measuredCount).toBe(0)
    expect(r.skippedCount).toBe(1)
    expect(r.content.trim()).toBe('')
  })
})

// ---------------------------------------------------------------------------
// splitTextForKokoro — the local engine's real input window guard
// ---------------------------------------------------------------------------

describe('splitTextForKokoro', () => {
  test('short text is a single chunk', () => {
    expect(splitTextForKokoro('Hello GANGZII.')).toEqual(['Hello GANGZII.'])
  })

  test('long text splits under 400 chars per chunk on sentence boundaries', () => {
    const sentence = 'This is a narration sentence for the local engine. '
    const text = sentence.repeat(20) // ~1010 chars
    const chunks = splitTextForKokoro(text)
    expect(chunks.length).toBeGreaterThanOrEqual(3)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(400)
    // Deterministic order + no content loss.
    expect(chunks.join(' ').split(/\s+/).filter(Boolean).length).toBe(text.split(/\s+/).filter(Boolean).length)
  })

  test('empty text yields no chunks', () => {
    expect(splitTextForKokoro('')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Registry invariants — GANGZII is a REAL product with DISJOINT voice sets
// ---------------------------------------------------------------------------

describe('GANGZII registry invariants (M27)', () => {
  test('gangzii is a public product with speech-synthesis task', () => {
    const p = getProduct('gangzii')
    expect(p).toBeDefined()
    expect(p!.task).toBe('speech-synthesis')
    expect(BEAN_PRODUCTS.some((b) => b.id === 'gangzii')).toBe(true)
  })

  test('gangzii has enabled backends for every audio task family', () => {
    for (const task of ['speech-synthesis', 'audio-transcription', 'audio-conversion', 'audio-production']) {
      const enabled = getBackendsForProduct('gangzii').filter((b) => b.task === task && b.enabled)
      expect(enabled.length).toBeGreaterThanOrEqual(1)
    }
  })

  test('local-first chain: Kokoro precedes the hosted gateway for synthesis', () => {
    const tts = getBackendsForProduct('gangzii').filter((b) => b.task === 'speech-synthesis' && b.enabled)
    expect(tts[0].id).toBe('bean-audio-tts-local-kokoro')
    expect(tts.some((b) => b.id === 'bean-audio-tts-hosted-primary')).toBe(true)
  })

  test('voice catalogs are DISJOINT (engine selection is voice-driven)', () => {
    const hosted = new Set(GANGZII_VOICE_PRESETS.map((v) => v.id))
    const local = new Set(KOKORO_VOICE_PRESETS.map((v) => v.id))
    for (const id of hosted) expect(isKokoroVoice(id)).toBe(false)
    for (const id of local) expect(isHostedVoice(id)).toBe(false)
  })

  test('GANGZII limits stay the measured values both engines share', () => {
    expect(GANGZII_LIMITS.speedMin).toBe(0.5)
    expect(GANGZII_LIMITS.speedMax).toBe(2.0)
    expect(GANGZII_LIMITS.sampleRateHz).toBe(24_000)
  })

  test('Kokoro catalog ships the full bundled voice set with honest grades', () => {
    // 54 voice packs bundled with kokoro-js 1.2.1.
    expect(KOKORO_VOICE_PRESETS.length).toBe(54)
    // English entries carry the model card's own grades; others null.
    const english = KOKORO_VOICE_PRESETS.filter((v) => v.grade !== null)
    expect(english.length).toBe(28)
    for (const v of english) expect(v.grade).toMatch(/^[A-F][+-]?$/)
  })
})
