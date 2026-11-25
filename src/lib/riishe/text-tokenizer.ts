/**
 * BEAN Intelligence — BERT WordPiece tokenizer for the local embedding /
 * cross-encoder lanes (M40, SERVER ONLY).
 *
 * A faithful, dependency-free implementation of the BERT WordPiece scheme
 * (google-research/bert tokenization.py semantics):
 *   1. basic tokenization — lowercase, unicode-whitespace normalization,
 *      punctuation split, CJK ideographs split per character;
 *   2. WordPiece — greedy longest-match-first subword segmentation with
 *     '##' continuation markers, [UNK] fallback and the 100-char word cap.
 *
 * The vocabulary is the pinned `vocab.txt` installed beside each ONNX model
 * by the local-model manager (line number = token id, [PAD]=0 … [UNK]=100).
 * Everything here is pure and deterministic — unit-tested against known
 * BERT tokenizations; no model I/O happens in this module.
 */

export const SPECIAL_TOKENS = {
  pad: '[PAD]',
  unk: '[UNK]',
  cls: '[CLS]',
  sep: '[SEP]',
  mask: '[MASK]',
} as const

/** BERT punctuation code-point ranges (tokenization.py _is_punctuation). */
function isPunctuation(code: number): boolean {
  if ((code >= 33 && code <= 47) || (code >= 58 && code <= 64) || (code >= 91 && code <= 96) || (code >= 123 && code <= 126)) {
    return true
  }
  // unicode punctuation categories
  return (
    (code >= 0x2000 && code <= 0x206f) ||
    (code >= 0x3000 && code <= 0x303f) ||
    code === 0x00a1 ||
    code === 0x00bf ||
    code === 0x2010 ||
    code === 0x2019 ||
    code === 0x201c ||
    code === 0x201d
  )
}

function isCjk(code: number): boolean {
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0xac00 && code <= 0xd7af)
  )
}

function isWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0b || code === 0x0c || code === 0x0d || code === 0x200b || code === 0xfeff
}

/** BERT BasicTokenizer: case-fold, whitespace normalize, punctuation split, CJK split. */
export function basicTokenize(text: string): string[] {
  const out: string[] = []
  let buf = ''
  const flush = () => {
    if (buf) out.push(buf)
    buf = ''
  }
  for (const ch of text.toLowerCase()) {
    const code = ch.codePointAt(0)!
    if (isCjk(code)) {
      flush()
      out.push(ch)
    } else if (isWhitespace(code)) {
      flush()
    } else if (isPunctuation(code)) {
      flush()
      out.push(ch)
    } else {
      buf += ch
    }
  }
  flush()
  return out
}

export interface EncodedSequence {
  /** [CLS] a… [SEP] (b… [SEP] for pairs). */
  inputIds: number[]
  /** 0 for the first segment (incl. specials), 1 for the pair segment. */
  tokenTypeIds: number[]
  /** 1 for every non-pad token (this tokenizer never emits padding rows). */
  attentionMask: number[]
  tokens: string[]
  /** Number of WordPiece pieces before any truncation diagnostics. */
  truncated: boolean
}

export interface WordPieceOptions {
  /** Max token slots INCLUDING the [CLS]/[SEP] special tokens. */
  maxLen: number
  /** Optional second segment (cross-encoder query/passage pairs). */
  pair?: string
}

export class WordPieceTokenizer {
  private readonly vocab: Map<string, number>
  readonly vocabularySize: number

  constructor(vocabText: string) {
    this.vocab = new Map()
    const lines = vocabText.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const token = lines[i].replace(/\r$/, '')
      if (token.length === 0 && i !== 0) continue
      if (!this.vocab.has(token)) this.vocab.set(token, i)
    }
    this.vocabularySize = this.vocab.size
  }

  /** True when the token string is a vocab entry (piece-existence checks). */
  hasToken(token: string): boolean {
    return this.vocab.has(token)
  }

  tokenId(token: string): number {
    return this.vocab.get(token) ?? this.vocab.get(SPECIAL_TOKENS.unk) ?? 100
  }

  /** Greedy longest-match-first WordPiece segmentation of one word. */
  tokenizeWord(word: string): string[] {
    if (word.length > 100) return [SPECIAL_TOKENS.unk]
    const pieces: string[] = []
    let start = 0
    while (start < word.length) {
      let end = word.length
      let found: string | null = null
      while (start < end) {
        const candidate = (start > 0 ? '##' : '') + word.slice(start, end)
        if (this.vocab.has(candidate)) {
          found = candidate
          break
        }
        end -= 1
      }
      if (found === null) return [SPECIAL_TOKENS.unk]
      pieces.push(found)
      start = end
    }
    return pieces
  }

  /** Full pipeline: basic tokenize + wordpiece + [CLS]/[SEP] framing. */
  encode(text: string, options: WordPieceOptions): EncodedSequence {
    const segment = (t: string): string[] => {
      const pieces: string[] = []
      for (const w of basicTokenize(t)) pieces.push(...this.tokenizeWord(w))
      return pieces
    }
    const specials = options.pair !== undefined ? 3 : 2
    const budget = Math.max(1, options.maxLen - specials)
    let a = segment(text)
    let b = options.pair !== undefined ? segment(options.pair) : []
    let truncated = false
    if (a.length + b.length > budget) {
      // Cross-encoder convention: truncate the PASSAGE first, then the query,
      // never letting either fall below half the budget (measured convention of
      // the ms-marco MiniLM cross-encoder recipes).
      const half = Math.floor(budget / 2)
      if (b.length > half) {
        b = b.slice(0, Math.max(half, budget - a.length))
        truncated = true
      }
      if (a.length > half) {
        a = a.slice(0, Math.max(half, budget - b.length))
        truncated = true
      }
    }
    const tokens = [SPECIAL_TOKENS.cls, ...a, SPECIAL_TOKENS.sep]
    const types: number[] = [0, ...a.map(() => 0), 0]
    if (options.pair !== undefined) {
      tokens.push(...b, SPECIAL_TOKENS.sep)
      types.push(...b.map(() => 1), 1)
    }
    const inputIds = tokens.map((t) => this.tokenId(t))
    return {
      inputIds,
      tokenTypeIds: types,
      attentionMask: inputIds.map(() => 1),
      tokens,
      truncated,
    }
  }
}
