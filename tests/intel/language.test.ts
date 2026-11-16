/**
 * BEAN Intelligence — unit tests for the shared multilingual core
 * (work order Part 2 / Part 14: "Test English, Tamil, Hindi, Malayalam,
 * Arabic, Spanish, Chinese, Japanese and mixed-language prompts").
 * Run: bun test tests/intel/
 */
import { describe, test, expect } from 'bun:test'
import {
  analyzeLanguage,
  buildQueryVariants,
  languagePromptNote,
  languageName,
} from '../../src/lib/intel/language'

describe('language identification — the nine work-order languages', () => {
  test('English', () => {
    const a = analyzeLanguage('Who is the chief minister of Tamil Nadu right now?')
    expect(a.primary).toBe('en')
    expect(a.script).toBe('latin')
    expect(['high', 'medium']).toContain(a.confidence)
    expect(a.support).toBe('strong')
  })

  test('Tamil (native script)', () => {
    const a = analyzeLanguage('தமிழ்நாட்டின் முதல்வர் யார்? செய்தி என்ன?')
    expect(a.primary).toBe('ta')
    expect(a.script).toBe('tamil')
    expect(a.confidence).toBe('high')
    expect(a.transliterated).toBe(false)
  })

  test('Hindi (Devanagari)', () => {
    const a = analyzeLanguage('भारत के प्रधानमंत्री कौन हैं और मौसम कैसा है?')
    expect(a.primary).toBe('hi')
    expect(a.script).toBe('devanagari')
    expect(a.confidence).toBe('high')
    // Devanagari covers Marathi/Nepali too — the note must say so honestly.
    expect(a.supportNote).toMatch(/Marathi|Nepali/i)
  })

  test('Malayalam', () => {
    const a = analyzeLanguage('കേരളത്തിലെ മുഖ്യമന്ത്രി ആരാണ്? വാർത്ത എന്താണ്?')
    expect(a.primary).toBe('ml')
    expect(a.script).toBe('malayalam')
    expect(a.confidence).toBe('high')
  })

  test('Arabic (RTL)', () => {
    const a = analyzeLanguage('من هو رئيس الوزراء في الهند؟ ما هو الطقس اليوم؟')
    expect(a.primary).toBe('ar')
    expect(a.script).toBe('arabic')
    expect(a.confidence).toBe('high')
  })

  test('Spanish (Latin with stopword + diacritic scoring)', () => {
    const a = analyzeLanguage('Hola, ¿cómo está el clima hoy en la ciudad? Gracias por la imagen.')
    expect(a.primary).toBe('es')
    expect(['high', 'medium']).toContain(a.confidence)
  })

  test('Chinese (CJK)', () => {
    const a = analyzeLanguage('印度总理是谁？今天的天气怎么样？最新的新闻是什么？')
    expect(a.primary).toBe('zh')
    expect(a.script).toBe('cjk')
    expect(a.confidence).toBe('high')
  })

  test('Japanese (kana present)', () => {
    const a = analyzeLanguage('今日の天気はどうですか？最新のニュースを教えてください。')
    expect(a.primary).toBe('ja')
    expect(a.confidence).toBe('high')
  })

  test('Korean (Hangul)', () => {
    const a = analyzeLanguage('오늘 날씨는 어떻습니까?')
    expect(a.primary).toBe('ko')
    expect(a.confidence).toBe('high')
  })

  test('mixed-language: Tamil + English keeps Tamil primary and flags mixed', () => {
    const a = analyzeLanguage('இந்தியாவின் prime minister யார்?')
    expect(a.primary).toBe('ta')
    expect(a.mixed).toBe(true)
    expect(a.segments.length).toBeGreaterThanOrEqual(2)
  })

  test('mixed-language: Japanese + English', () => {
    const a = analyzeLanguage('Next.jsの最新バージョンを教えて please')
    expect(a.primary).toBe('ja')
    expect(a.mixed).toBe(true)
  })

  test('romanized Tamil is detected with LOW confidence and flagged', () => {
    const a = analyzeLanguage('vanakkam, epdi irukkinga? nandri')
    expect(a.primary).toBe('ta')
    expect(a.transliterated).toBe(true)
    expect(a.confidence).toBe('low')
  })

  test('empty/symbol-only input is honest unknown — never a guessed language', () => {
    for (const input of ['', '   ', '12345 !@#$', '...']) {
      const a = analyzeLanguage(input)
      expect(a.primary).toBe('unknown')
      expect(a.support).toBe('unknown')
    }
  })

  test('proper nouns in Latin do not flip a non-Latin primary', () => {
    const a = analyzeLanguage('இந்தியா மற்றும் Next.js பற்றி சொல்')
    expect(a.primary).toBe('ta')
  })
})

describe('cross-language query variants', () => {
  test('native-language query leads; lexicon adds an English pivot', () => {
    const variants = buildQueryVariants('இந்தியாவின் பிரதமர் யார்?')
    expect(variants[0]).toContain('பிரதமர்')
    expect(variants.length).toBeGreaterThanOrEqual(2)
    expect(variants.some((v) => v.toLowerCase().includes('prime minister'))).toBe(true)
  })

  test('English message with a lexicon concept gains no junk variants', () => {
    const variants = buildQueryVariants('Who is the prime minister of India?')
    expect(variants[0]).toBe('Who is the prime minister of India?')
  })

  test('empty input yields no variants', () => {
    expect(buildQueryVariants('')).toEqual([])
  })

  test('max three variants, original first, deduplicated', () => {
    const variants = buildQueryVariants('இந்தியாவின் பிரதமர் யார்? இந்தியா செய்தி')
    expect(variants.length).toBeLessThanOrEqual(3)
    expect(new Set(variants).size).toBe(variants.length)
  })
})

describe('prompt-note + naming', () => {
  test('languagePromptNote instructs same-language answers and proper-noun preservation', () => {
    const note = languagePromptNote(analyzeLanguage('வணக்கம், செய்தி என்ன?'))
    expect(note).toContain('Tamil')
    expect(note).toContain('SAME language')
    expect(note).toContain('proper nouns')
  })

  test('unknown language produces no note (no fake claims)', () => {
    expect(languagePromptNote(analyzeLanguage(''))).toBeNull()
  })

  test('languageName covers the served set', () => {
    for (const lang of ['en', 'ta', 'hi', 'ml', 'ar', 'es', 'zh', 'ja'] as const) {
      expect(languageName(lang)).not.toBe('Unknown')
    }
  })
})

describe('multilingual retrieval policy (research/policy integration)', () => {
  test('Tamil officeholder + news questions trigger grounded retrieval', async () => {
    const { shouldSearch } = await import('../../src/lib/research/policy')
    const d = shouldSearch('தமிழ்நாட்டின் தற்போதைய முதல்வர் யார்? சமீபத்திய செய்தி என்ன?')
    expect(d.search).toBe(true)
    expect(d.risk).toBe('high')
    expect(d.reason).toMatch(/TA/)
  })

  test('Malayalam officeholder + news questions trigger grounded retrieval', async () => {
    const { shouldSearch } = await import('../../src/lib/research/policy')
    const d = shouldSearch('കേരളത്തിലെ മുഖ്യമന്ത്രി ആരാണ്? ഇന്നത്തെ വാർത്ത എന്താണ്?')
    expect(d.search).toBe(true)
    expect(d.reason).toMatch(/ML/)
  })

  test('creative English tasks still skip retrieval (no false triggers)', async () => {
    const { shouldSearch } = await import('../../src/lib/research/policy')
    expect(shouldSearch('Write a poem about the sea').search).toBe(false)
  })
})
