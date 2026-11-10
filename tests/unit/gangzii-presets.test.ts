/**
 * GANGZII — beep guard, WAV extraction, channel exports and preset registry
 * tests. Companion to tests/unit/gangzii.test.ts (which keeps the original
 * chunker/header/upload suites).
 *
 * The tone-guard fixtures are SYNTHETIC (deterministic math) — they verify
 * the detector logic, not the provider. Real provider evidence lives in
 * scripts/beep-probe-out/ and is verified end-to-end by scripts/e2e-gangzii.sh.
 */
import { describe, test, expect } from 'bun:test'
import {
  extractPcmFromWav,
  goertzelPowerDb,
  rmsDbfs,
  detectLeadingToneSamples,
  stripLeadingToneArtifact,
  buildWavHeader,
  assembleWavFromPcm,
  TTS_SAMPLE_RATE,
  BEEP_TONE_HZ,
} from '@/lib/adapters/hosted-audio'
import { extractJsonObject } from '@/app/api/gangzii/lyrics/analyze/route'
import {
  GANGZII_VOICE_PRESETS,
  GANGZII_VOICE_CATEGORIES,
  GANGZII_SONG_PRESETS,
  GANGZII_VOICES,
  getSongPreset,
  getVoicePreset,
} from '@/lib/registry/gangzii-presets'

// ---- synthetic PCM fixtures --------------------------------------------------

function tonePcm(freqHz: number, seconds: number, amplitude = 12000): Buffer {
  const n = Math.floor(TTS_SAMPLE_RATE * seconds)
  const buf = Buffer.alloc(n * 2)
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(amplitude * Math.sin((2 * Math.PI * freqHz * i) / TTS_SAMPLE_RATE)), i * 2)
  }
  return buf
}

/** Pseudo-speech: noise-shaped bursts with silence gaps (no pure tone). */
function speechLikePcm(seconds: number, seed = 42): Buffer {
  const n = Math.floor(TTS_SAMPLE_RATE * seconds)
  const buf = Buffer.alloc(n * 2)
  let s = seed
  const rand = () => {
    // xorshift for determinism
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }
  for (let i = 0; i < n; i++) {
    const voiced = i % (TTS_SAMPLE_RATE / 2) < TTS_SAMPLE_RATE / 3 // 2/3 duty
    const env = voiced ? 1 : 0
    // Mix several lowish frequencies — no single dominant pure tone.
    const v =
      6000 * Math.sin((2 * Math.PI * 220 * i) / TTS_SAMPLE_RATE) +
      4000 * Math.sin((2 * Math.PI * 610 * i) / TTS_SAMPLE_RATE) +
      2500 * Math.sin((2 * Math.PI * 970 * i) / TTS_SAMPLE_RATE)
    buf.writeInt16LE(Math.round(v * env * (0.8 + 0.4 * rand())), i * 2)
  }
  return buf
}

// ---- extractPcmFromWav --------------------------------------------------------

describe('extractPcmFromWav', () => {
  test('extracts the data payload from a valid canonical WAV', () => {
    const pcm = tonePcm(440, 0.2)
    const wav = assembleWavFromPcm(pcm)
    const out = extractPcmFromWav(wav)
    expect(out.length).toBe(pcm.length)
    expect(out.equals(pcm)).toBe(true)
  })

  test('rejects non-RIFF input loudly', () => {
    const fake = Buffer.concat([Buffer.from('NOTAWAVEFILE--------'), Buffer.alloc(64)])
    expect(() => extractPcmFromWav(fake)).toThrow(/RIFF\/WAVE/)
  })

  test('rejects wrong geometry (stereo / wrong rate / wrong bits)', () => {
    const pcm = tonePcm(440, 0.05)
    const header = buildWavHeader(pcm.length)
    // patch channels to 2
    const bad = Buffer.from(header)
    bad.writeUInt16LE(2, 22)
    expect(() => extractPcmFromWav(Buffer.concat([bad, pcm]))).toThrow(/2ch/)
  })

  test('rejects truncated buffers', () => {
    expect(() => extractPcmFromWav(Buffer.alloc(10))).toThrow(/RIFF\/WAVE/)
  })
})

// ---- tone detector / guard -----------------------------------------------------

describe('leading 1650 Hz tone guard', () => {
  test('Goertzel finds a pure tone and rejects off-frequency windows', () => {
    const pcm = tonePcm(BEEP_TONE_HZ, 0.5)
    const atTone = goertzelPowerDb(pcm, 0, Math.floor(TTS_SAMPLE_RATE * 0.06), BEEP_TONE_HZ)
    const offTone = goertzelPowerDb(pcm, 0, Math.floor(TTS_SAMPLE_RATE * 0.06), BEEP_TONE_HZ + 300)
    expect(atTone).toBeGreaterThan(-20)
    expect(offTone).toBeLessThan(atTone - 15)
  })

  test('detects the exact artifact signature: leading tone + silence + speech', () => {
    const beep = tonePcm(BEEP_TONE_HZ, 0.55)
    const gap = Buffer.alloc(Math.floor(TTS_SAMPLE_RATE * 0.25) * 2)
    const speech = speechLikePcm(1.5)
    const stream = Buffer.concat([beep, gap, speech])
    const cut = detectLeadingToneSamples(stream)
    expect(cut).toBeGreaterThan(0)
    const cutSec = cut / TTS_SAMPLE_RATE
    // The artifact is 0.55 s; the cut must land in [0.4, 0.8] s — close to
    // the tone end, never inside the speech region (starts at 0.8 s).
    expect(cutSec).toBeGreaterThanOrEqual(0.4)
    expect(cutSec).toBeLessThanOrEqual(0.8)
    const { pcm, stripped } = stripLeadingToneArtifact(stream)
    expect(stripped).toBe(true)
    // What remains begins with the silence gap + speech — the beep is gone.
    const residualTone = goertzelPowerDb(pcm, 0, Math.floor(TTS_SAMPLE_RATE * 0.06), BEEP_TONE_HZ)
    expect(residualTone).toBeLessThan(-40)
  })

  test('never cuts real speech openings (false-positive guard)', () => {
    const speech = speechLikePcm(2.0)
    expect(detectLeadingToneSamples(speech)).toBe(0)
    const { stripped } = stripLeadingToneArtifact(speech)
    expect(stripped).toBe(false)
  })

  test('does not cut speech even when loud', () => {
    const loud = speechLikePcm(1.0, 7)
    for (let i = 0; i < loud.length / 2; i++) {
      loud.writeInt16LE(Math.max(-32768, Math.min(32767, loud.readInt16LE(i * 2) * 3)), i * 2)
    }
    expect(detectLeadingToneSamples(loud)).toBe(0)
  })

  test('does not cut a DIFFERENT pure tone that opens a stream (e.g. musical intro)', () => {
    const intro = tonePcm(880, 0.6) // A5 note — not the artifact
    const speech = speechLikePcm(1.0)
    const stream = Buffer.concat([intro, speech])
    expect(detectLeadingToneSamples(stream)).toBe(0)
  })

  test('does not cut short blips below the 200 ms minimum', () => {
    const blip = tonePcm(BEEP_TONE_HZ, 0.1)
    const speech = speechLikePcm(1.0)
    expect(detectLeadingToneSamples(Buffer.concat([blip, speech]))).toBe(0)
  })

  test('silence-only streams are untouched', () => {
    const silence = Buffer.alloc(TTS_SAMPLE_RATE * 2)
    expect(detectLeadingToneSamples(silence)).toBe(0)
  })

  test('rmsDbfs sanity: pure tone at amplitude 12000 ≈ -11.7 dBFS', () => {
    const pcm = tonePcm(BEEP_TONE_HZ, 0.2)
    const rms = rmsDbfs(pcm, 0, Math.floor(TTS_SAMPLE_RATE * 0.1))
    // sine RMS = A/√2 → 20·log10(12000/(32768·√2)) ≈ -11.7 dBFS
    expect(rms).toBeGreaterThan(-13.5)
    expect(rms).toBeLessThan(-10)
  })

  test('Goertzel RMS-equivalent matches rmsDbfs for an on-bin pure tone', () => {
    const pcm = tonePcm(BEEP_TONE_HZ, 0.3)
    const g = goertzelPowerDb(pcm, 0, Math.floor(TTS_SAMPLE_RATE * 0.1), BEEP_TONE_HZ)
    const r = rmsDbfs(pcm, 0, Math.floor(TTS_SAMPLE_RATE * 0.1))
    expect(Math.abs(g - r)).toBeLessThan(0.5)
  })
})

// ---- shared preset registries ---------------------------------------------------

describe('GANGZII voice preset registry', () => {
  test('contains exactly the 7 provider-verified voices with unique stable ids', () => {
    const ids = GANGZII_VOICE_PRESETS.map((v) => v.id)
    expect(ids.length).toBe(7)
    expect(new Set(ids).size).toBe(7)
    for (const required of ['tongtong', 'chuichui', 'xiaochen', 'jam', 'kazi', 'douji', 'luodo']) {
      expect(ids).toContain(required)
    }
  })

  test('preset id IS the provider voice id (no synthetic voices)', () => {
    for (const v of GANGZII_VOICE_PRESETS) {
      expect(v.providerVoiceId).toBe(v.id)
      expect(v.previewText.length).toBeGreaterThan(0)
      expect(v.previewText.length).toBeLessThan(200)
    }
  })

  test('every preset maps to a declared category', () => {
    const catIds = GANGZII_VOICE_CATEGORIES.map((c) => c.id)
    for (const v of GANGZII_VOICE_PRESETS) {
      expect(catIds).toContain(v.category)
    }
    // every category holds at least one voice (no empty groups in UI)
    for (const c of GANGZII_VOICE_CATEGORIES) {
      expect(GANGZII_VOICE_PRESETS.some((v) => v.category === c.id)).toBe(true)
    }
  })

  test('language claims are honest: zh/en verified, Tamil never claimed', () => {
    for (const v of GANGZII_VOICE_PRESETS) {
      for (const l of v.languages) {
        expect(['verified', 'unverified']).toContain(l.status)
        if (l.lang === 'Tamil') expect(l.status).toBe('unverified')
      }
    }
  })

  test('backward-compatible flat GANGZII_VOICES stays aligned', () => {
    expect(GANGZII_VOICES.length).toBe(GANGZII_VOICE_PRESETS.length)
    for (let i = 0; i < GANGZII_VOICES.length; i++) {
      expect(GANGZII_VOICES[i].value).toBe(GANGZII_VOICE_PRESETS[i].id)
      expect(GANGZII_VOICES[i].label).toBe(GANGZII_VOICE_PRESETS[i].displayName)
    }
  })

  test('getVoicePreset resolves and unknown ids miss', () => {
    expect(getVoicePreset('jam')?.displayName).toBe('Jam')
    expect(getVoicePreset('fake-voice-9000')).toBeUndefined()
  })
})

describe('GANGZII song preset registry', () => {
  test('all 16 requested style categories exist with unique stable ids', () => {
    expect(GANGZII_SONG_PRESETS.length).toBe(16)
    const ids = GANGZII_SONG_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(16)
  })

  test('every preset is honestly unavailable for generation (no music worker)', () => {
    for (const p of GANGZII_SONG_PRESETS) {
      expect(p.generationAvailable).toBe(false)
    }
  })

  test('metadata is complete: genre, mood, instrumentation, energy, modes, duration', () => {
    for (const p of GANGZII_SONG_PRESETS) {
      expect(p.genre.length).toBeGreaterThan(0)
      expect(p.mood.length).toBeGreaterThan(0)
      expect(p.instrumentation.length).toBeGreaterThan(0)
      expect(p.energy).toBeGreaterThanOrEqual(1)
      expect(p.energy).toBeLessThanOrEqual(5)
      expect(p.vocalModes.length).toBeGreaterThan(0)
      expect(p.durationRangeSec.min).toBeGreaterThan(0)
      expect(p.durationRangeSec.max).toBeGreaterThan(p.durationRangeSec.min)
      expect(p.lyricStyleHint.length).toBeGreaterThan(0)
    }
  })

  test('instrumental-only presets exist and never claim sung vocals', () => {
    const instrumentalOnly = GANGZII_SONG_PRESETS.filter((p) => !p.vocalModes.includes('sung'))
    expect(instrumentalOnly.length).toBeGreaterThanOrEqual(2)
    for (const p of instrumentalOnly) {
      expect(p.vocalModes).toEqual(['instrumental'])
    }
  })

  test('getSongPreset resolves and unknown ids miss', () => {
    expect(getSongPreset('tamil-pop')?.displayName).toBe('Tamil pop')
    expect(getSongPreset('not-a-preset')).toBeUndefined()
  })
})

// ---- RIISHE analysis JSON extraction --------------------------------------------

describe('extractJsonObject (RIISHE analyze route)', () => {
  test('parses a clean JSON object', () => {
    const out = extractJsonObject('{"overall":"good","strengths":[]}') as Record<string, unknown>
    expect(out.overall).toBe('good')
  })

  test('parses JSON inside markdown fences', () => {
    const out = extractJsonObject('```json\n{"overall":"ok"}\n```') as Record<string, unknown>
    expect(out.overall).toBe('ok')
  })

  test('parses JSON embedded in surrounding prose', () => {
    const out = extractJsonObject('Here is the analysis:\n{"overall":"fine","sections":[]}\nDone.') as Record<string, unknown>
    expect(out.overall).toBe('fine')
  })

  test('handles braces inside JSON strings without breaking the scan', () => {
    const out = extractJsonObject('{"overall":"uses { and } wisely","quote":"line \\"with\\" braces { ok }"}') as Record<string, unknown>
    expect(out.overall).toBe('uses { and } wisely')
  })

  test('throws on garbage / non-JSON replies (honest failure path)', () => {
    expect(() => extractJsonObject('I cannot analyze that.')).toThrow()
    expect(() => extractJsonObject('{unterminated')).toThrow()
    expect(() => extractJsonObject('')).toThrow()
  })
})
