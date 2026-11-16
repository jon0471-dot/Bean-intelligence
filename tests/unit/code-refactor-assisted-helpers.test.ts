/**
 * BEAN Intelligence — unit tests for the assisted-refactoring helper layer
 * (M25 measured-failure fixes):
 *  - rePointBindings: mechanical import surgery for deterministic importer
 *    completion (named, type-only, default, export-from, mixed splits);
 *  - stillBindsNames: the precise relocation-completeness question;
 *  - correctiveDraftCharBudget + buildScopeContext: the drafting prompt must
 *    fit the adapter's per-message maxPromptChars (measured s6 failure: the
 *    contract rode at the tail and was silently truncated away).
 */
import { describe, test, expect } from 'bun:test'
import {
  buildScopeContext,
  correctiveDraftCharBudget,
  rePointBindings,
} from '../../src/lib/code/refactoring/assisted'

describe('rePointBindings (deterministic importer completion surgery)', () => {
  const specFor = (target: string) => `../../${target.replace(/\.[a-z]+$/i, '')}`

  test('a whole-statement move re-points the specifier', () => {
    const out = rePointBindings(
      "import { fmt } from '../utils/format'\nexport const A = 1",
      '../utils/format',
      new Map([['fmt', 'services/format-service.ts']]),
      specFor,
    )
    expect(out).toContain("import { fmt } from '../../services/format-service'")
    expect(out).not.toContain('../utils/format')
  })

  test('a mixed statement is SPLIT: kept bindings stay, moved bindings re-point', () => {
    const out = rePointBindings(
      "import { fmt, KEPT } from '../utils/format'",
      '../utils/format',
      new Map([['fmt', 'services/format-service.ts']]),
      specFor,
    )
    expect(out).toContain("{ KEPT } from '../utils/format'")
    expect(out).toContain("{ fmt } from '../../services/format-service'")
  })

  test('type-only statements keep their type marker', () => {
    const out = rePointBindings(
      "import type { RegionRow } from '../data/sample'",
      '../data/sample',
      new Map([['RegionRow', 'services/rows.ts']]),
      specFor,
    )
    expect(out).toContain("import type { RegionRow } from '../../services/rows'")
  })

  test('a default import of a moved symbol re-points', () => {
    const out = rePointBindings(
      "import fmt from '../utils/format'",
      '../utils/format',
      new Map([['fmt', 'services/format-service.ts']]),
      specFor,
    )
    expect(out).toContain("import fmt from '../../services/format-service'")
  })

  test('export-from statements are handled too (re-export residue)', () => {
    const out = rePointBindings(
      "export { fmt } from '../utils/format'",
      '../utils/format',
      new Map([['fmt', 'services/format-service.ts']]),
      specFor,
    )
    expect(out).toContain("export { fmt } from '../../services/format-service'")
  })

  test('unrelated specifiers and unknown names are left byte-identical', () => {
    const content = "import { other } from './unrelated'\nimport { fmt } from '../utils/format'"
    const out = rePointBindings(content, '../utils/format', new Map([['unknownSymbol', 'services/x.ts']]), specFor)
    expect(out).toBe(content)
  })
})

describe('drafting prompt budget (adapter per-message truncation guard)', () => {
  test('correctiveDraftCharBudget leaves room for instruction + contract inside maxPromptChars', () => {
    // The measured failure: a 6,000-char hard slice plus a wide scope context
    // pushed the CONTRACT past the adapter's 12,000-char per-message slice.
    const budget = correctiveDraftCharBudget(12_000)
    expect(budget).toBe(6_500)
    expect(budget + 5_500).toBeLessThanOrEqual(12_000)
  })

  test('correctiveDraftCharBudget never drops below a usable floor', () => {
    expect(correctiveDraftCharBudget(4_000)).toBe(4_000)
    expect(correctiveDraftCharBudget(1_000)).toBe(4_000)
  })

  test('buildScopeContext omits whole files past the budget instead of truncating content', () => {
    const files = [
      { path: 'small.ts', content: 'x'.repeat(900) },
      { path: 'huge.ts', content: 'y'.repeat(5_000) },
    ]
    const out = buildScopeContext(files, 1_500)
    expect(out).toContain('--- small.ts ---')
    expect(out).toContain('huge.ts (omitted from context: scope budget reached')
    expect(out).not.toContain('yyyyyyyyyy'.repeat(20)) // the huge body is not dumped
  })

  test('an empty scope renders as an empty context block', () => {
    expect(buildScopeContext([], 5_000)).toBe('')
  })
})
