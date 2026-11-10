/**
 * BEAN Intelligence — deterministic computation verification.
 *
 * The solver model must emit a SELF_CHECK block listing the exact numeric
 * expressions behind its final results. This module evaluates those
 * expressions with a hand-rolled recursive-descent parser + evaluator
 * (NO eval, NO Function, NO process spawn — the model's text is parsed into
 * an AST of whitelisted arithmetic only) and compares the computed values
 * against the model's claimed values.
 *
 * Exactness: integer operations run on BigInt (exact); division and
 * transcendental functions fall back to float64 with relative tolerance in
 * the comparison.
 *
 * Honesty contract: COMPUTATION_VERIFIED is assigned ONLY when expressions
 * were actually evaluated and every value matched. Any mismatch, parse error
 * or overflow yields a failed check — never a pass.
 */

export interface SelfCheckItem {
  /** Exact expression to evaluate, e.g. "2**10" or "(3+4)*5/2". */
  expr: string
  /** The value the model claims the expression evaluates to. */
  claimed: string
}

export interface ComputationCheck {
  ran: boolean
  passed: boolean
  results: Array<{ expr: string; claimed: string; actual: string | null; match: boolean; error?: string }>
  durationMs: number
}

const MAX_EXPR_LEN = 200
const MAX_ITEMS = 12
const MAX_TOKENS = 120
const MAX_EXP = 4096 // |integer exponent| bound for exact BigInt power
const MAX_FACTORIAL = 500

/**
 * Parse a SELF_CHECK block emitted by the solver. Expected line format:
 *   CHECK: <expression> = <claimed value>
 * Falls back to scanning the whole answer when no explicit block exists.
 * Returns [] when the model did not emit a parseable block.
 */
export function parseSelfCheck(answer: string): SelfCheckItem[] {
  const items: SelfCheckItem[] = []
  const block = answer.match(/SELF_CHECK:?\s*\n([\s\S]*?)(?:\n\s*\n|$)/i)
  const source = block ? block[1] : answer
  const re = /CHECK\s*:\s*(.+?)\s*=\s*([^\n]+)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    const expr = m[1].trim().replace(/`/g, '')
    const claimed = m[2].trim().replace(/[*_~`]/g, '').trim()
    if (expr.length > 0 && expr.length <= MAX_EXPR_LEN && claimed.length > 0 && claimed.length <= 60) {
      items.push({ expr, claimed })
    }
    if (items.length >= MAX_ITEMS) break
  }
  return items
}

// ---------------------------------------------------------------------------
// Safe expression evaluation
// ---------------------------------------------------------------------------

type Value = { kind: 'int'; v: bigint } | { kind: 'float'; v: number }

function num(n: number): Value {
  return Number.isInteger(n) ? { kind: 'int', v: BigInt(n) } : { kind: 'float', v: n }
}
function toFloat(v: Value): number {
  return v.kind === 'int' ? Number(v.v) : v.v
}
function toStringValue(v: Value): string {
  if (v.kind === 'int') return v.v.toString()
  const f = v.v
  if (!Number.isFinite(f)) return f > 0 ? 'Infinity' : Number.isNaN(f) ? 'NaN' : '-Infinity'
  const r = Math.round(f * 1e10) / 1e10
  if (Number.isInteger(r) && Math.abs(r) < 1e15) return r.toString()
  return r.toString()
}

class ExprError extends Error {}

/** Tokenizer: numbers, operators, names. Thousands separators are NOT
 * supported inside expressions (ambiguous with function arguments); claimed
 * values are comma-normalized at comparison time instead. */
function tokenize(src: string): string[] {
  const s = src
    .replace(/[−–—]/g, '-') // unicode minus -> '-'
    .replace(/[×∗·]/g, '*')
    .replace(/[÷]/g, '/')
    .replace(/\^/g, '**')
    .replace(/\s+/g, '')
  const tokens: string[] = []
  let i = 0
  while (i < s.length) {
    const rest = s.slice(i)
    const numMatch = rest.match(/^(\d+\.\d+|\d+)/)
    if (numMatch) {
      tokens.push(numMatch[0])
      i += numMatch[0].length
      continue
    }
    const opMatch = rest.match(/^(\*\*|\/\/|[+\-*/%()!,])/)
    if (opMatch) {
      tokens.push(opMatch[0])
      i += opMatch[0].length
      continue
    }
    const nameMatch = rest.match(/^[a-zA-Z_][a-zA-Z_0-9]*/)
    if (nameMatch) {
      tokens.push(nameMatch[0])
      i += nameMatch[0].length
      continue
    }
    throw new ExprError(`unexpected character at position ${i}`)
  }
  if (tokens.length > MAX_TOKENS) throw new ExprError('expression too long')
  return tokens
}

const FUNCS = new Map<string, (...args: number[]) => number>(Object.entries({
  sqrt: Math.sqrt,
  abs: Math.abs,
  log: (x: number, base?: number) => (base === undefined ? Math.log(x) : Math.log(x) / Math.log(base)),
  log2: Math.log2,
  log10: Math.log10,
  exp: Math.exp,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  floor: Math.floor,
  ceil: Math.ceil,
  round: (x: number, digits?: number) => (digits === undefined ? Math.round(x) : Math.round(x * 10 ** digits) / 10 ** digits),
  min: (...a: number[]) => Math.min(...a),
  max: (...a: number[]) => Math.max(...a),
}))

// Map (not object literals) so prototype-chain names like 'constructor',
// 'toString' can never be reached from model-supplied expressions.
const CONSTANTS = new Map<string, number>([
  ['pi', Math.PI],
  ['e', Math.E],
])

function factorialBig(n: bigint): bigint {
  let r = 1n
  for (let i = 2n; i <= n; i++) r *= i
  return r
}
function gcdBig(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a
  b = b < 0n ? -b : b
  while (b) [a, b] = [b, a % b]
  return a
}
function combBig(n: bigint, k: bigint): bigint {
  if (k < 0n || k > n) return 0n
  k = k > n - k ? n - k : k
  let r = 1n
  for (let i = 1n; i <= k; i++) r = (r * (n - k + i)) / i
  return r
}
function permBig(n: bigint, k: bigint): bigint {
  if (k < 0n || k > n) return 0n
  let r = 1n
  for (let i = 0n; i < k; i++) r *= n - i
  return r
}

class Parser {
  private pos = 0
  constructor(private readonly tokens: string[]) {}

  private peek(): string | undefined {
    return this.tokens[this.pos]
  }
  private next(): string {
    const t = this.tokens[this.pos]
    if (t === undefined) throw new ExprError('unexpected end of expression')
    this.pos++
    return t
  }
  private expect(t: string): void {
    if (this.next() !== t) throw new ExprError(`expected '${t}'`)
  }

  /** True when all tokens were consumed (guards trailing garbage). */
  atEnd(): boolean {
    return this.pos >= this.tokens.length
  }

  parseExpr(): Value {
    let left = this.parseTerm()
    for (;;) {
      const t = this.peek()
      if (t === '+') {
        this.next()
        left = add(left, this.parseTerm())
      } else if (t === '-') {
        this.next()
        left = sub(left, this.parseTerm())
      } else return left
    }
  }

  private parseTerm(): Value {
    let left = this.parseUnary()
    for (;;) {
      const t = this.peek()
      if (t === '*') {
        this.next()
        left = mul(left, this.parseUnary())
      } else if (t === '/') {
        this.next()
        left = div(left, this.parseUnary())
      } else if (t === '//') {
        this.next()
        left = floordiv(left, this.parseUnary())
      } else if (t === '%') {
        this.next()
        left = mod(left, this.parseUnary())
      } else return left
    }
  }

  private parseUnary(): Value {
    const t = this.peek()
    if (t === '-') {
      this.next()
      return neg(this.parseUnary())
    }
    if (t === '+') {
      this.next()
      return this.parseUnary()
    }
    return this.parsePower()
  }

  private parsePower(): Value {
    const base = this.parseAtom()
    if (this.peek() === '**') {
      this.next()
      const exp = this.parseUnary() // right-associative
      return pow(base, exp)
    }
    return base
  }

  private parseAtom(): Value {
    const t = this.next()
    if (t === '(') {
      const v = this.parseExpr()
      this.expect(')')
      return v
    }
    if (/^\d+$/.test(t)) return { kind: 'int', v: BigInt(t) }
    if (/^[a-zA-Z_]/.test(t)) {
      if (this.peek() === '(') {
        this.next()
        const args: Value[] = []
        if (this.peek() !== ')') {
          args.push(this.parseExpr())
          while (this.peek() === ',') {
            this.next()
            args.push(this.parseExpr())
          }
        }
        this.expect(')')
        return callFunc(t, args)
      }
      if (CONSTANTS.has(t)) return num(CONSTANTS.get(t) as number)
      throw new ExprError(`unknown identifier '${t}'`)
    }
    throw new ExprError(`unexpected token '${t}'`)
  }
}

function assertInt(v: Value, op: string): bigint {
  if (v.kind !== 'int') throw new ExprError(`${op} requires integers`)
  return v.v
}

function checkFinite(v: Value): Value {
  if (v.kind === 'float' && !Number.isFinite(v.v)) throw new ExprError('overflow')
  return v
}

function add(a: Value, b: Value): Value {
  return checkFinite(a.kind === 'int' && b.kind === 'int' ? { kind: 'int', v: a.v + b.v } : num(toFloat(a) + toFloat(b)))
}
function sub(a: Value, b: Value): Value {
  return checkFinite(a.kind === 'int' && b.kind === 'int' ? { kind: 'int', v: a.v - b.v } : num(toFloat(a) - toFloat(b)))
}
function mul(a: Value, b: Value): Value {
  return checkFinite(a.kind === 'int' && b.kind === 'int' ? { kind: 'int', v: a.v * b.v } : num(toFloat(a) * toFloat(b)))
}
function div(a: Value, b: Value): Value {
  const fb = toFloat(b)
  if (fb === 0) throw new ExprError('division by zero')
  return checkFinite(num(toFloat(a) / fb))
}
function floordiv(a: Value, b: Value): Value {
  if (a.kind === 'int' && b.kind === 'int') {
    if (b.v === 0n) throw new ExprError('division by zero')
    const q = a.v / b.v
    const r = a.v % b.v
    return { kind: 'int', v: r !== 0n && (r < 0n) !== (b.v < 0n) ? q - 1n : q }
  }
  const fb = toFloat(b)
  if (fb === 0) throw new ExprError('division by zero')
  return checkFinite(num(Math.floor(toFloat(a) / fb)))
}
function mod(a: Value, b: Value): Value {
  if (a.kind === 'int' && b.kind === 'int') {
    if (b.v === 0n) throw new ExprError('division by zero')
    const r = a.v % b.v
    return { kind: 'int', v: r !== 0n && (r < 0n) !== (b.v < 0n) ? r + b.v : r }
  }
  const fb = toFloat(b)
  if (fb === 0) throw new ExprError('division by zero')
  return checkFinite(num(toFloat(a) % fb))
}
function neg(a: Value): Value {
  return a.kind === 'int' ? { kind: 'int', v: -a.v } : checkFinite(num(-a.v))
}
function pow(a: Value, b: Value): Value {
  if (a.kind === 'int' && b.kind === 'int' && b.v >= 0n && b.v <= BigInt(MAX_EXP)) {
    return { kind: 'int', v: a.v ** b.v }
  }
  const fb = toFloat(b)
  if (Math.abs(fb) > MAX_EXP) throw new ExprError('exponent too large')
  return checkFinite(num(Math.pow(toFloat(a), fb)))
}
function callFunc(name: string, args: Value[]): Value {
  if (name === 'factorial') {
    const n = assertInt(args[0] ?? { kind: 'float', v: NaN }, 'factorial')
    if (n < 0n || n > BigInt(MAX_FACTORIAL)) throw new ExprError('factorial argument out of range')
    return { kind: 'int', v: factorialBig(n) }
  }
  if (name === 'gcd') return { kind: 'int', v: gcdBig(assertInt(args[0] ?? { kind: 'float', v: NaN }, 'gcd'), assertInt(args[1] ?? { kind: 'float', v: NaN }, 'gcd')) }
  if (name === 'comb') return { kind: 'int', v: combBig(assertInt(args[0] ?? { kind: 'float', v: NaN }, 'comb'), assertInt(args[1] ?? { kind: 'float', v: NaN }, 'comb')) }
  if (name === 'perm') return { kind: 'int', v: permBig(assertInt(args[0] ?? { kind: 'float', v: NaN }, 'perm'), assertInt(args[1] ?? { kind: 'float', v: NaN }, 'perm')) }
  const fn = FUNCS.get(name)
  if (!fn) throw new ExprError(`unknown function '${name}'`)
  const nums = args.map(toFloat)
  return checkFinite(num(fn(...nums)))
}

/** Evaluate a single arithmetic expression. Throws ExprError on any violation. */
export function evaluateExpression(expr: string): string {
  if (expr.length > MAX_EXPR_LEN) throw new ExprError('expression too long')
  const parser = new Parser(tokenize(expr))
  const value = parser.parseExpr()
  if (!parser.atEnd()) throw new ExprError('unexpected trailing tokens')
  return toStringValue(value)
}

/** Normalize a claimed numeric string for comparison. */
function normalizeNumeric(s: string): string {
  return s
    .trim()
    .replace(/[,\s]/g, '')
    .replace(/[−–—]/g, '-')
    .replace(/^\+/, '')
    .replace(/\.$/, '')
}

/** Numeric equality with exact-match-first and relative tolerance for floats. */
export function numericEqual(a: string, b: string): boolean {
  const na = normalizeNumeric(a)
  const nb = normalizeNumeric(b)
  if (na === nb) return true
  const fa = Number(na)
  const fb = Number(nb)
  if (Number.isFinite(fa) && Number.isFinite(fb)) {
    if (fa === fb) return true
    const scale = Math.max(Math.abs(fa), Math.abs(fb))
    return scale > 0 && Math.abs(fa - fb) / scale <= 1e-9
  }
  return false
}

/**
 * Evaluate all self-check expressions and compare with the model's claims.
 * ran=false when nothing was checkable — callers must not treat that as a
 * pass.
 */
export async function verifyComputations(items: SelfCheckItem[]): Promise<ComputationCheck> {
  const t0 = Date.now()
  if (items.length === 0) return { ran: false, passed: false, results: [], durationMs: 0 }
  const results = items.map((item) => {
    try {
      const actual = evaluateExpression(item.expr)
      return { expr: item.expr, claimed: item.claimed, actual, match: numericEqual(item.claimed, actual) }
    } catch (e) {
      return {
        expr: item.expr,
        claimed: item.claimed,
        actual: null,
        match: false,
        error: e instanceof Error ? e.message : 'evaluation failed',
      }
    }
  })
  return {
    ran: true,
    passed: results.every((r) => r.match),
    results,
    durationMs: Date.now() - t0,
  }
}
