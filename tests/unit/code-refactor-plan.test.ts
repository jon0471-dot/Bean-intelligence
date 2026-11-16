/**
 * BEAN Intelligence — CODE GIFTZ refactoring plan tests (M25).
 *
 * Pins the plan contract (pure — no DB):
 *  - rename-symbol rewrites ONLY verified references (definition + importers);
 *    inferred matches in non-importing files are LISTED, never rewritten;
 *  - aliased imports keep the alias, rename the specifier binding;
 *  - property-access occurrences stay untouched outside namespace imports;
 *  - comment lines are never rewritten;
 *  - symbol collisions / missing symbols / ambiguous definitions are honest
 *    errors;
 *  - move-module updates BOTH directions (moved files' own relative imports
 *    and incoming references) with exact-specifier repairs, preserving
 *    extension conventions;
 *  - validateRefactorPlan catches stale befores, conflicting edits, create
 *    collisions, duplicate exports, export-surface changes and cycles;
 *  - the plan hash is deterministic over canonical JSON (confirmation
 *    binding) and a changed plan changes the hash.
 */
import { describe, test, expect } from 'bun:test'
import { planRenameSymbol, planMoveModule, validateRefactorPlan, refactorPlanHashOf, replaceIdentifierInContent, sha256 } from '../../src/lib/code/refactoring/plan'
import { FileOpError } from '../../src/lib/code/file-ops/types'

const PROJECT = [
  {
    path: 'src/utils/format.ts',
    content: [
      '// formatValue renders money',
      'export function formatValue(n: number): string {',
      "  return '$' + n.toFixed(2)",
      '}',
      'export const formatValueLabel = "value"',
    ].join('\n'),
  },
  {
    path: 'src/components/hero.tsx',
    content: [
      "import { formatValue, formatValue as fv } from '../utils/format'",
      'export function Hero({ n }: { n: number }) {',
      '  return <span>{formatValue(n)} {fv(n)}</span>',
      '}',
    ].join('\n'),
  },
  {
    path: 'src/app.tsx',
    content: [
      "import { Hero } from './components/hero'",
      'export default function App() {',
      '  const hint = "formatValue is nice"',
      '  return <Hero n={3} />',
      '}',
    ].join('\n'),
  },
]

describe('M25 rename-symbol', () => {
  test('renames definition + verified importers, keeps inferred matches', () => {
    const plan = planRenameSymbol(PROJECT, { symbol: 'formatValue', newName: 'money' })
    const edited = new Map(plan.edits.map((e) => [e.path, e.after]))
    // Definition rewritten (comment untouched). A DIFFERENT symbol whose name
    // merely contains the token as a prefix (`formatValueLabel`) is untouched —
    // token-boundary matching, not substring matching.
    expect(edited.get('src/utils/format.ts')).not.toContain('// money renders money')
    expect(edited.get('src/utils/format.ts')).toContain('export function money(')
    expect(edited.get('src/utils/format.ts')).toContain('export const formatValueLabel = "value"')
    // Importer: both the direct binding and the aliased binding rename the
    // SPECIFIER name; the alias itself stays.
    expect(edited.get('src/components/hero.tsx')).toContain("import { money, money as fv } from '../utils/format'")
    expect(edited.get('src/components/hero.tsx')).toContain('{money(n)} {fv(n)}')
    // Non-importing file: the only occurrence lives inside a string — the file
    // is NOT edited, and the inferred match is honestly listed.
    expect(edited.has('src/app.tsx')).toBe(false)
    expect(plan.unresolved.some((u) => u.path === 'src/app.tsx')).toBe(true)
    // Aliased usages untouched (rename never rewrites literals — the pure
    // replaceIdentifierInContent test above pins string skipping).
    expect(edited.get('src/components/hero.tsx')).toContain('fv(n)')
  })

  test('collision with an existing symbol is refused', () => {
    expect(() => planRenameSymbol(PROJECT, { symbol: 'formatValue', newName: 'Hero' })).toThrow(FileOpError)
    try {
      planRenameSymbol(PROJECT, { symbol: 'formatValue', newName: 'Hero' })
    } catch (e) {
      expect((e as FileOpError).code).toBe('CONFLICT')
    }
  })

  test('unknown symbol and non-identifiers are honest errors', () => {
    expect(() => planRenameSymbol(PROJECT, { symbol: 'nope', newName: 'x' })).toThrow(/No declaration/)
    expect(() => planRenameSymbol(PROJECT, { symbol: 'formatValue', newName: 'not an id' })).toThrow(/not a valid identifier/)
  })

  test('ambiguous declaration (same symbol in two files) asks, never guesses', () => {
    const dup = [...PROJECT, { path: 'src/other.ts', content: 'export function formatValue() { return "" }' }]
    try {
      planRenameSymbol(dup, { symbol: 'formatValue', newName: 'money' })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(FileOpError)
      expect((e as FileOpError).message).toContain('which one')
    }
  })

  test('definingPath hint narrows the definition', () => {
    const dup = [...PROJECT, { path: 'src/other.ts', content: 'export function formatValue() { return "" }' }]
    const plan = planRenameSymbol(dup, { symbol: 'formatValue', newName: 'money2', definingPath: 'src/utils/format.ts' })
    expect(plan.edits.map((e) => e.path)).toContain('src/utils/format.ts')
  })

  test('dot-prefixed property accesses are skipped outside namespace imports', () => {
    const files = [
      { path: 'mod.ts', content: 'export const config = { a: 1 }' },
      { path: 'use.ts', content: "import { config } from './mod'\nconst x = config.config\nconst y = config" },
    ]
    const plan = planRenameSymbol(files, { symbol: 'config', newName: 'settings' })
    const after = plan.edits.find((e) => e.path === 'use.ts')!.after
    expect(after).toContain('settings.config') // binding renamed, property access kept
    expect(after).toContain('const y = settings') // binding usage renamed
    expect(plan.unresolved.some((u) => u.path === 'use.ts' && u.note.includes('property access'))).toBe(true)
  })

  test('namespace-import access IS renamed', () => {
    const files = [
      { path: 'mod.ts', content: 'export const config = { a: 1 }' },
      { path: 'use.ts', content: "import * as mod from './mod'\nconst x = mod.config" },
    ]
    const plan = planRenameSymbol(files, { symbol: 'config', newName: 'settings' })
    const after = plan.edits.find((e) => e.path === 'use.ts')!.after
    expect(after).toContain('mod.settings')
  })

  test('replaceIdentifierInContent skips comment lines and string content', () => {
    const src = ['// formatValue doc', '/* formatValue */', 'const x = formatValue(1)', 'const s = "formatValue in string"'].join('\n')
    const out = replaceIdentifierInContent(src, 'formatValue', 'money')
    expect(out.content).toContain('// formatValue doc')
    expect(out.content).toContain('/* formatValue */')
    expect(out.content).toContain('const x = money(1)')
    expect(out.content).toContain('"formatValue in string"') // literals are never rewritten
    expect(out.count).toBe(1)
    expect(out.skippedString).toBe(1)
  })

  test('plan records source hashes and deterministic metadata', () => {
    const plan = planRenameSymbol(PROJECT, { symbol: 'formatValue', newName: 'money' })
    expect(plan.engine).toBe('deterministic')
    expect(plan.requiresConfirmation).toBe(true)
    expect(plan.sourceHashes['src/utils/format.ts']).toBe(sha256(PROJECT[0].content))
    expect(plan.affectedTests).toEqual([])
  })
})

describe('M25 move-module', () => {
  const files = [
    { path: 'src/lib/api.ts', content: ["import { fmt } from './fmt'", 'export const api = { get: () => fmt(1) }'].join('\n') },
    { path: 'src/lib/fmt.ts', content: 'export const fmt = (n: number) => String(n)' },
    { path: 'src/app.tsx', content: ["import { api } from './lib/api'", 'export default function App() { return api.get() }'].join('\n') },
  ]

  test('rewrites outgoing imports of the moved file AND incoming references', () => {
    const plan = planMoveModule(files, { sources: ['src/lib/api.ts'], destination: 'src/services' })
    const movedEdit = plan.edits.find((e) => e.path === 'src/services/api.ts')
    expect(movedEdit).toBeDefined()
    expect(movedEdit!.changeType).toBe('move-content')
    // The moved file's own relative import points at the old sibling — after
    // the move it must reach ../lib/fmt.ts.
    expect(movedEdit!.after).toContain("'../lib/fmt'")
    // The importer's specifier was repaired exactly.
    const importerEdit = plan.edits.find((e) => e.path === 'src/app.tsx')
    expect(importerEdit).toBeDefined()
    expect(importerEdit!.after).toContain("'./services/api'")
    expect(plan.moves).toEqual([{ from: 'src/lib/api.ts', to: 'src/services/api.ts' }])
  })

  test('extension convention is preserved (extension-less stays extension-less)', () => {
    const plan = planMoveModule(files, { sources: ['src/lib/api.ts'], destination: 'src/services' })
    const importerEdit = plan.edits.find((e) => e.path === 'src/app.tsx')!
    expect(importerEdit.after).not.toContain(" './services/api.ts'")
  })

  test('folder moves expand and repair every affected file', () => {
    const plan = planMoveModule(files, { sources: ['src/lib'], destination: 'src/core' })
    expect(plan.moves.length).toBe(2)
    expect(plan.edits.find((e) => e.path === 'src/core/api.ts')).toBeDefined()
    expect(plan.edits.find((e) => e.path === 'src/app.tsx')!.after).toContain("'./core/api'")
  })

  test('destination conflicts are honest errors', () => {
    const withTarget = [...files, { path: 'src/services/api.ts', content: 'export const x = 1' }]
    try {
      planMoveModule(withTarget, { sources: ['src/lib/api.ts'], destination: 'src/services' })
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as FileOpError).code).toBe('CONFLICT')
    }
  })

  test('unknown source is NOT_FOUND, not a guess', () => {
    expect(() => planMoveModule(files, { sources: ['src/nope.ts'], destination: 'x' })).toThrow(/does not exist/)
  })

  test('moving into own subfolder is refused', () => {
    expect(() => planMoveModule(files, { sources: ['src/lib'], destination: 'src/lib/inner' })).toThrow(/own subfolder/)
  })

  test('exact-file destination inside its own folder prefix is refused', () => {
    expect(() => planMoveModule(files, { sources: ['src/lib/api.ts'], destination: 'src/lib/api.ts/nested' })).toThrow()
  })
})

describe('M25 plan validation (semantic safety)', () => {
  test('stale before-content is caught', () => {
    const plan = planRenameSymbol(PROJECT, { symbol: 'formatValue', newName: 'money' })
    const tampered = PROJECT.map((f) => (f.path === 'src/utils/format.ts' ? { path: f.path, content: f.content + '\n// concurrent edit' } : f))
    const report = validateRefactorPlan(plan, tampered)
    expect(report.ok).toBe(false)
    expect(report.stale.some((s) => s.includes('changed since'))).toBe(true)
  })

  test('conflicting duplicate edits are caught', () => {
    const plan = planRenameSymbol(PROJECT, { symbol: 'formatValue', newName: 'money' })
    const broken = { ...plan, edits: [...plan.edits, plan.edits[0]] }
    const report = validateRefactorPlan(broken, PROJECT)
    expect(report.conflicts.some((c) => c.includes('Two edits'))).toBe(true)
  })

  test('create onto an existing path is caught', () => {
    const plan = planRenameSymbol(PROJECT, { symbol: 'formatValue', newName: 'money' })
    const withCreate = { ...plan, edits: [...plan.edits, { path: 'src/app.tsx', before: null, after: 'export const x = 1', changeType: 'create' as const }] }
    const report = validateRefactorPlan(withCreate, PROJECT)
    expect(report.conflicts.some((c) => c.includes('already exists'))).toBe(true)
  })

  test('cross-file duplicate exports are surfaced as reviewable risks (not silent)', () => {
    const plan = planRenameSymbol(PROJECT, { symbol: 'formatValue', newName: 'money' })
    const withDup = {
      ...plan,
      edits: [...plan.edits, { path: 'src/new.ts', before: null, after: "export function Hero() { return null }", changeType: 'create' as const }],
      createdPaths: ['src/new.ts'],
    }
    const report = validateRefactorPlan(withDup, PROJECT)
    // Legal ES modules — reported for review, NOT a hard block.
    expect(report.ok).toBe(true)
    expect(report.symbolCollisions.some((c) => c.includes('Hero'))).toBe(true)
  })

  test('export-surface changes are reported (lost exports)', () => {
    const plan = {
      planVersion: 1 as const,
      kind: 'extract-component' as const,
      title: 't',
      reason: 'r',
      engine: 'provider-assisted' as const,
      steps: [],
      edits: [{ path: 'src/app.tsx', before: PROJECT[2].content, after: "import { Hero } from './components/hero'\nconst App = () => <Hero n={1} />", changeType: 'modify' as const }],
      moves: [],
      createdPaths: [],
      scopeFiles: ['src/app.tsx'],
      risks: [],
      unresolved: [],
      notes: [],
      sourceHashes: { 'src/app.tsx': sha256(PROJECT[2].content) },
      affectedTests: [],
      requiresConfirmation: true as const,
    }
    const report = validateRefactorPlan(plan, PROJECT)
    expect(report.ok).toBe(true) // informational, not blocking
    expect(report.exportChanges[0].lost).toContain('App')
    expect(report.exportChanges[0].gained).toEqual([])
  })

  test('plan hash binds the exact plan content', () => {
    const plan = planRenameSymbol(PROJECT, { symbol: 'formatValue', newName: 'money' })
    const h1 = refactorPlanHashOf(plan)
    const h2 = refactorPlanHashOf(JSON.parse(JSON.stringify(plan)) as typeof plan)
    expect(h1).toBe(h2)
    const changed = { ...plan, title: `${plan.title}!` }
    expect(refactorPlanHashOf(changed)).not.toBe(h1)
  })
})
