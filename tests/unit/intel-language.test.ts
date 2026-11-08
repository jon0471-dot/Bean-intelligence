/**
 * BEAN Intelligence — multilingual language-layer unit tests.
 * Pure, deterministic, no network. Covers the brief's test languages:
 * English, Tamil, Hindi, Malayalam, Arabic, Spanish, Chinese, Japanese and
 * mixed-language prompts, plus transliteration and term preservation.
 */
import { describe, test, expect } from 'bun:test'
import {
  detectLanguage,
  searchLanguagesFor,
  extractPreservedTerms,
  mixedLanguageSegments,
  normalizeMultilingualText,
  LANGUAGE_NAMES,
} from '../../src/lib/intel/language'

describe('language identification (script-based)', () => {
  test('English prompts detect as English with function-word evidence', () => {
    const p = detectLanguage('What is the tallest mountain in the world and how was it measured?')
    expect(p.primary).toBe('en')
    expect(p.confidence).toBeGreaterThan(0.55)
  })

  test('Tamil script prompts detect as Tamil', () => {
    const p = detectLanguage('தமிழ்நாட்டின் தலைநகர் எது? எனக்கு சொல்லுங்கள்')
    expect(p.primary).toBe('ta')
    expect(p.confidence).toBeGreaterThan(0.6)
  })

  test('Hindi (Devanagari) prompts detect as Hindi', () => {
    const p = detectLanguage('भारत की राजधानी क्या है और यह कब स्थापित हुई?')
    expect(p.primary).toBe('hi')
    expect(p.confidence).toBeGreaterThan(0.6)
  })

  test('Malayalam prompts detect as Malayalam', () => {
    const p = detectLanguage('കേരളത്തിലെ തലസ്ഥാനം ഏതാണ്? എനിക്ക് പറയൂ')
    expect(p.primary).toBe('ml')
    expect(p.confidence).toBeGreaterThan(0.6)
  })

  test('Arabic prompts detect as Arabic', () => {
    const p = detectLanguage('ما هي عاصمة مصر وما هو عدد سكانها؟')
    expect(p.primary).toBe('ar')
    expect(p.confidence).toBeGreaterThan(0.6)
  })

  test('Spanish prompts detect via function words (Latin script)', () => {
    const p = detectLanguage('¿Cuál es la capital de Argentina y por qué es importante?')
    expect(p.primary).toBe('es')
  })

  test('Chinese prompts detect as Chinese', () => {
    const p = detectLanguage('中国的首都是哪里？请告诉我它的历史')
    expect(p.primary).toBe('zh')
  })

  test('Japanese prompts detect as Japanese (kana decisive over kanji)', () => {
    const p = detectLanguage('日本の首都はどこですか？教えてください')
    expect(p.primary).toBe('ja')
  })

  test('empty and punctuation-only inputs degrade honestly to undetermined', () => {
    expect(detectLanguage('').primary).toBe('und')
    expect(detectLanguage('??? !!!').primary).toBe('und')
    expect(detectLanguage('??? !!!').confidence).toBeLessThan(0.5)
  })

  test('short English fragments report LOW confidence (honest, not overclaimed)', () => {
    const p = detectLanguage('cat')
    expect(p.primary).toBe('en')
    expect(p.confidence).toBeLessThanOrEqual(0.55)
  })
})

describe('mixed-language and transliteration handling', () => {
  test('Tamil + English mixed prompt is flagged mixed with both languages present', () => {
    const text = 'தமிழ்நாடு பற்றி tell me the history of its temples'
    const p = detectLanguage(text)
    expect(p.primary).toBe('ta')
    expect(p.mixed).toBe(true)
    expect(p.note).toContain('mixed-script')
  })

  test('transliterated Tamil words are recognized, not treated as confident English', () => {
    const p = detectLanguage('vanakkam, eppadi irukkinga? enna sollu')
    expect(p.transliterated).toBe(true)
    expect(p.confidence).toBeLessThanOrEqual(0.5)
  })

  test('transliteration markers do not fire on ordinary English', () => {
    expect(detectLanguage('explain how a transformer model works').transliterated).toBe(false)
  })

  test('mixedLanguageSegments separates script runs', () => {
    const runs = mixedLanguageSegments('வணக்கம் world hello நன்றி')
    const scripts = runs.filter((r) => r.text.trim().length > 0).map((r) => r.script)
    expect(scripts).toContain('tamil')
    expect(scripts).toContain('latin')
  })
})

describe('search-language selection', () => {
  test('English prompts search in English only', () => {
    expect(searchLanguagesFor(detectLanguage('What is the latest Node.js release?'))).toEqual(['en'])
  })

  test('non-English prompts search in the original language FIRST, then English', () => {
    const langs = searchLanguagesFor(detectLanguage('தமிழ்நாட்டின் தலைநகர் எது?'))
    expect(langs[0]).toBe('ta')
    expect(langs).toContain('en')
    expect(langs.length).toBe(2)
  })

  test('undetermined prompts still produce a usable query language (en)', () => {
    expect(searchLanguagesFor(detectLanguage('???'))).toEqual(['en'])
  })
})

describe('term preservation (names, technical tokens, measurements)', () => {
  test('proper nouns, measurements and technical tokens are extracted verbatim', () => {
    const t = extractPreservedTerms('Mount Everest is 8848 m high; build a Next.js app with react-dom@19.0.0 rendering 60 fps')
    expect(t.properNouns).toContain('Mount Everest')
    expect(t.measurements.some((m) => m.startsWith('8848'))).toBe(true)
    expect(t.measurements.some((m) => m.includes('fps'))).toBe(true)
    expect(t.technical.some((x) => x.toLowerCase().includes('next.js') || x.toLowerCase().includes('react-dom'))).toBe(true)
  })

  test('quoted strings are captured for verbatim preservation', () => {
    const t = extractPreservedTerms('make a poster titled "PONGAL FEST" with warm colors')
    expect(t.quoted).toContain('PONGAL FEST')
  })
})

describe('normalization and display names', () => {
  test('NFC normalization + control-char removal + whitespace collapse', () => {
    // Control characters are REMOVED (not replaced by spaces); space runs collapse.
    const normalized = normalizeMultilingualText('cafe\u0301  \u0007 bad\u000Bchars')
    expect(normalized).toBe('café badchars')
  })

  test('language display names exist for all supported languages', () => {
    expect(LANGUAGE_NAMES.ta).toBe('Tamil')
    expect(LANGUAGE_NAMES.ml).toBe('Malayalam')
    expect(LANGUAGE_NAMES.ar).toBe('Arabic')
    expect(LANGUAGE_NAMES.ja).toBe('Japanese')
    expect(LANGUAGE_NAMES.zh).toBe('Chinese')
    expect(LANGUAGE_NAMES.es).toBe('Spanish')
    expect(LANGUAGE_NAMES.hi).toBe('Hindi')
    expect(LANGUAGE_NAMES.en).toBe('English')
  })
})
