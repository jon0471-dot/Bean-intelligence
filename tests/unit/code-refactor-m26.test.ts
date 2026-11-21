/**
 * BEAN Intelligence — M26 refactoring reliability regressions (audit §4.4):
 *  - R-1 bounded graph build: generated dirs excluded, oversized projects
 *    refused honestly (typed RefactorScopeError), no silent unbounded parse;
 *  - R-2 move-module basename ambiguity → clarification (never a silent
 *    multi-file move);
 *  - R-3 prose-shaped "restructure/consolidate" requests are NOT hijacked
 *    into multi-file plans; folder-shaped intent still detects;
 *  - R-4 root-relative '/…' specifiers resolve as graph edges.
 */
import { describe, test, expect } from 'bun:test'
import {
  buildProjectGraph,
  graphFileExcluded,
  resolveSpecifier,
  RefactorScopeError,
  GRAPH_MAX_FILES,
} from '../../src/lib/code/refactoring/graph'
import { detectRefactoringRequest } from '../../src/lib/code/refactoring/detect'

const file = (path: string, content = '') => ({ path, content })

describe('M26 R-1 — bounded graph build', () => {
  test('generated/dependency directories are excluded from the graph', () => {
    expect(graphFileExcluded('node_modules/left-pad/index.js')).toBe(true)
    expect(graphFileExcluded('.next/server/app.js')).toBe(true)
    expect(graphFileExcluded('dist/bundle.js')).toBe(true)
    expect(graphFileExcluded('src/lib/utils.ts')).toBe(false)
    expect(graphFileExcluded('app/page.tsx')).toBe(false)
  })

  test('an oversized project is refused with an honest typed error (never silently unbounded)', () => {
    const files = Array.from({ length: GRAPH_MAX_FILES + 10 }, (_, i) =>
      file(`src/generated/file-${i}.ts`, 'export const x = 1'),
    )
    expect(() => buildProjectGraph(files)).toThrow(RefactorScopeError)
    try {
      buildProjectGraph(files)
    } catch (e) {
      expect((e as RefactorScopeError).message).toContain('analyzable files')
      expect((e as RefactorScopeError).message).toContain('at most')
    }
  })

  test('a project within bounds still builds (the cap is not over-tight)', () => {
    const files = Array.from({ length: 50 }, (_, i) => file(`src/mod-${i}.ts`, 'import { a } from "./mod-0"; export const a = 1'))
    const g = buildProjectGraph(files)
    expect(g.nodes.size).toBe(50)
    expect(g.complete).toBe(true)
  })
})

describe('M26 R-2 — move-module basename ambiguity', () => {
  const files = [
    file('src/components/hero.tsx'),
    file('src/sections/hero.tsx'),
    file('src/lib/utils.ts'),
  ]

  test('two same-basename files → clarification, NOT a silent two-file move', () => {
    const d = detectRefactoringRequest('move hero.tsx into shared and update imports', files)
    expect(d.detected).toBe(true)
    if (!d.detected || d.type !== 'clarification') throw new Error('expected clarification')
    expect(d.question).toContain('matches 2 files')
    expect(d.question).toContain('src/components/hero.tsx')
    expect(d.question).toContain('src/sections/hero.tsx')
  })

  test('an exact path still moves directly (no false clarification)', () => {
    const d = detectRefactoringRequest('move src/lib/utils.ts into shared and update imports', files)
    expect(d.detected).toBe(true)
    if (!d.detected || d.type !== 'op' || d.kind !== 'move-module') throw new Error('expected move op')
    expect(d.sources as string[]).toEqual(['src/lib/utils.ts'])
  })

  test('a folder token still moves its whole folder', () => {
    const d = detectRefactoringRequest('move src/lib into core and update imports', [
      file('src/lib/utils.ts'),
      file('src/lib/http.ts'),
      file('src/app/page.tsx'),
    ])
    expect(d.detected).toBe(true)
    if (!d.detected || d.type !== 'op' || d.kind !== 'move-module') throw new Error('expected move op')
    expect((d.sources as string[]).sort()).toEqual(['src/lib/http.ts', 'src/lib/utils.ts'])
  })
})

describe('M26 R-3 — prose requests are never hijacked', () => {
  const files = [file('src/components/pricing.tsx', 'function PricingSection() {}')]

  test('function-level prose stays a normal edit turn', () => {
    for (const text of [
      'help me restructure this function',
      'can you reorganize this code for me',
      'consolidate these two functions into one',
      'deduplicate this logic',
    ]) {
      const d = detectRefactoringRequest(text, files)
      expect(d.detected).toBe(false)
    }
  })

  test('folder/project-shaped intent still detects as restructure', () => {
    const d = detectRefactoringRequest('restructure the project so components live in folders', [
      file('src/a.ts'),
      file('src/b.ts'),
    ])
    expect(d.detected).toBe(true)
    if (!d.detected || d.type !== 'op') throw new Error('expected op')
    expect(d.kind).toBe('restructure')
  })

  test('multi-file consolidation phrasing still detects', () => {
    const d = detectRefactoringRequest(
      'merge these repeated pricing card sections into a shared component',
      [file('src/a.tsx'), file('src/b.tsx')],
    )
    // honest multi-file detection: with an ambiguous scope it CLARIFIES
    // (never silently plans), with a resolvable scope it plans
    expect(d.detected).toBe(true)
    if (!d.detected) throw new Error('expected detection')
    expect(['op', 'clarification']).toContain(d.type)
    if (d.type === 'op') expect(['consolidate', 'extract-component']).toContain(d.kind)
  })
})

describe('M26 R-4 — root-relative specifiers resolve', () => {
  test("'/components/button' resolves to the project file (same as '@/components/button')", () => {
    const paths = new Set(['components/button.tsx'])
    // both root-relative spellings resolve to the SAME target (the resolver
    // probes the exact path, then extension candidates — parity is the contract)
    expect(resolveSpecifier('src/app/page.tsx', '/components/button', paths)).toBe(
      resolveSpecifier('src/app/page.tsx', '@/components/button', paths),
    )
    expect(resolveSpecifier('src/app/page.tsx', '/components/button', paths)).toBeTruthy()
  })

  test("a missing '/'-specifier stays unresolved (never guessed)", () => {
    const paths = new Set(['components/button.tsx'])
    expect(resolveSpecifier('src/app/page.tsx', '/components/missing', paths)).toBeNull()
  })
})
