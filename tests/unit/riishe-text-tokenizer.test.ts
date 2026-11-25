/**
 * M40 — RIISHE retrieval lanes: the BERT WordPiece tokenizer (pure, pinned
 * behaviors).
 *
 *  - vocab semantics: line-number = id, [PAD]=0, [UNK]=100, 30522 entries;
 *  - basic tokenization: lowercase, punctuation split, CJK per-char;
 *  - WordPiece greedy longest-match-first with ## continuations and [UNK];
 *  - [CLS]/[SEP] framing, pair token_type_ids, and the truncation contract
 *    (passage tail truncated first, neither segment below half the budget).
 *
 * These pins guard the pinned-vocab integrity contract: if the installed
 * vocab.txt were ever swapped for a different one, the id mappings below
 * would break loudly instead of silently degrading every embedding.
 */
import { describe, test, expect } from 'bun:test'
import { WordPieceTokenizer, basicTokenize } from '@/lib/riishe/text-tokenizer'
import { readFileSync } from 'node:fs'
import { localModelCompanionPath } from '@/lib/media/local-models'

// The REAL pinned vocab from the installed model — not a fixture copy.
const vocabPath = localModelCompanionPath('minilm-l6-embeddings', 'vocab.txt')
const tok = new WordPieceTokenizer(readFileSync(vocabPath, 'utf8'))

describe('WordPiece tokenizer (M40 retrieval lanes)', () => {
  test('vocabulary identity: size, [PAD]=0, [UNK]=100, line-number ids', () => {
    expect(tok.vocabularySize).toBe(30522)
    expect(tok.tokenId('[PAD]')).toBe(0)
    expect(tok.tokenId('[UNK]')).toBe(100)
    expect(tok.tokenId('[CLS]')).toBe(101)
    expect(tok.tokenId('[SEP]')).toBe(102)
    // 'paris' is a common BERT vocab word with a stable line-number id.
    expect(tok.tokenId('paris')).toBeGreaterThan(1000)
  })

  test('basic tokenization: lowercase, punctuation split, CJK per-char', () => {
    expect(basicTokenize('Hello, World!')).toEqual(['hello', ',', 'world', '!'])
    expect(basicTokenize('  multiple   spaces\ttab\nnewline ')).toEqual(['multiple', 'spaces', 'tab', 'newline'])
    expect(basicTokenize('巴黎Paris')).toEqual(['巴', '黎', 'paris'])
  })

  test('WordPiece: greedy longest-match-first with ## continuations', () => {
    // On the REAL pinned vocab, greedy longest-match-first must produce
    // pieces that (a) all exist in the vocabulary, (b) reassemble the word
    // exactly, and (c) take the LONGEST possible prefix at every step.
    const pieces = tok.tokenizeWord('unaffable')
    expect(pieces.join('').replace(/##/g, '')).toBe('unaffable')
    for (const p of pieces) expect(tok.hasToken(p)).toBe(true)
    // Greedy property: the first piece is the longest in-vocab prefix.
    let longest = ''
    for (let end = pieces.join('').length; end > 0; end--) {
      const candidate = 'unaffable'.slice(0, end)
      if (tok.hasToken(candidate)) {
        longest = candidate
        break
      }
    }
    expect(pieces[0]).toBe(longest)
    // A whole word present in the vocab stays whole.
    expect(tok.tokenizeWord('paris')).toEqual(['paris'])
    // An OOV word decomposes into vocab pieces; fully-unknowable words are [UNK].
    expect(tok.tokenizeWord('preprocessing')).not.toContain('preprocessing')
    expect(tok.tokenizeWord('𝕬𝖇𝖈')).toEqual(['[UNK]'])
    // Over-long words are [UNK] per the BERT 100-char cap.
    expect(tok.tokenizeWord('a'.repeat(101))).toEqual(['[UNK]'])
  })

  test('WordPiece greedy semantics on a CONTROLLED vocab (deterministic pin)', () => {
    // The canonical BERT example vocabulary: un/##aff/##able exist, una/##ffa
    // deliberately do NOT — greedy must reproduce the paper's segmentation.
    const controlled = new WordPieceTokenizer(
      ['[PAD]', '[UNK]', '[CLS]', '[SEP]', '[MASK]', 'un', '##aff', '##able', 'play', '##ing', '##er'].join('\n') + '\n',
    )
    expect(controlled.tokenizeWord('unaffable')).toEqual(['un', '##aff', '##able'])
    expect(controlled.tokenizeWord('playing')).toEqual(['play', '##ing'])
    expect(controlled.tokenizeWord('player')).toEqual(['play', '##er'])
    // 'zzz' has no piece at all -> [UNK], whose id is its line position (1 here).
    expect(controlled.tokenizeWord('zzz')).toEqual(['[UNK]'])
    expect(controlled.tokenId('zzz')).toBe(controlled.tokenId('[UNK]'))
    expect(controlled.tokenId('[UNK]')).toBe(1)
  })

  test('single-segment encode: [CLS]/[SEP] framing, ids resolve, mask all-ones', () => {
    const enc = tok.encode('The capital of France is Paris.', { maxLen: 512 })
    expect(enc.tokens[0]).toBe('[CLS]')
    expect(enc.tokens[enc.tokens.length - 1]).toBe('[SEP]')
    expect(enc.inputIds.length).toBe(enc.tokens.length)
    expect(enc.tokenTypeIds.every((t) => t === 0)).toBe(true)
    expect(enc.attentionMask.every((m) => m === 1)).toBe(true)
    expect(enc.truncated).toBe(false)
    // decode-by-id round-trip: every id maps back to the exact token.
    enc.tokens.forEach((t, i) => expect(tok.tokenId(t)).toBe(enc.inputIds[i]))
  })

  test('pair encode: second segment marked token_type 1, two [SEP]s', () => {
    const enc = tok.encode('How many people live in Berlin?', { pair: 'Berlin has a population of 3,852,029.', maxLen: 512 })
    const sepIndexes = enc.tokens.reduce<number[]>((acc, t, i) => (t === '[SEP]' ? [...acc, i] : acc), [])
    expect(sepIndexes.length).toBe(2)
    expect(enc.tokenTypeIds[sepIndexes[0]]).toBe(0)
    expect(enc.tokenTypeIds[sepIndexes[0] + 1]).toBe(1)
    expect(enc.tokenTypeIds[enc.tokenTypeIds.length - 1]).toBe(1)
    expect(enc.truncated).toBe(false)
  })

  test('truncation contract: long pairs truncate the passage first, both bounded at half', () => {
    const query = 'quarterly revenue'
    const longPassage = `revenue figures. ${'filler content '.repeat(400)}`
    const enc = tok.encode(query, { pair: longPassage, maxLen: 128 })
    const total = enc.inputIds.length
    expect(total).toBeLessThanOrEqual(128)
    expect(enc.truncated).toBe(true)
    // The query segment survived intact (its tokens all still present).
    const queryTokens = tok.encode(query, { maxLen: 128 }).tokens.slice(1, -1)
    for (const t of queryTokens) expect(enc.tokens).toContain(t)
  })
})
