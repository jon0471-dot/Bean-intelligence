/**
 * BEAN Intelligence — CODE GIFTZ refactoring graph tests (M25).
 *
 * Pins the project-understanding contract:
 *  - verified edges only point at files that exist; unresolved relative
 *    specifiers are listed, never guessed;
 *  - file classification is honest (component/service/util/config/test);
 *  - symbol extraction covers named/default/re-export exports and local
 *    declarations;
 *  - namespace imports are tracked (rename needs them);
 *  - incremental updates re-analyze ONLY changed paths and re-point moved
 *    edge targets;
 *  - cycle detection reports real cycles over verified edges;
 *  - dependency cones bound the affected scope.
 */
import { describe, test, expect } from 'bun:test'
import {
  buildProjectGraph,
  updateGraph,
  classifyFile,
  extractSymbols,
  parseImports,
  detectCircularDependencies,
  dependencyCone,
  verifiedImportersOf,
} from '../../src/lib/code/refactoring/graph'

describe('M25 graph — classification', () => {
  test('classifies files by path shape and content shape', () => {
    expect(classifyFile('src/components/Button.tsx', '')).toBe('component')
    expect(classifyFile('src/services/api.ts', '')).toBe('service')
    expect(classifyFile('src/utils/format.ts', '')).toBe('util')
    expect(classifyFile('src/app.test.tsx', '')).toBe('test')
    expect(classifyFile('package.json', '')).toBe('config')
    expect(classifyFile('assets/logo.png', '')).toBe('asset')
    expect(classifyFile('styles/main.css', '')).toBe('style')
    expect(classifyFile('README.md', '')).toBe('doc')
    expect(classifyFile('src/Hero.tsx', 'export default function Hero() { return <div/> }')).toBe('component')
  })

  test('does not classify arbitrary text files as code', () => {
    expect(classifyFile('notes.txt', 'export const fake')).toBe('doc')
  })
})

describe('M25 graph — symbols and imports', () => {
  test('extracts exported and declared symbols', () => {
    const src = [
      'export function alpha() {}',
      'const hidden = 1',
      'export default class Widget {}',
      'export const beta = 2',
      'export { hidden }',
      'export type Kind = "a"',
      'function localHelper() {}',
    ].join('\n')
    const syms = extractSymbols(src)
    const names = new Map(syms.map((s) => [s.name, s]))
    expect(names.get('alpha')?.exported).toBe(true)
    expect(names.get('beta')?.exported).toBe(true)
    expect(names.get('Widget')?.exported).toBe(true)
    expect(names.get('hidden')?.exported).toBe(true)
    expect(names.get('Kind')?.exported).toBe(true)
    expect(names.get('localHelper')?.exported).toBe(false)
  })

  test('parses named, default, namespace, side-effect and dynamic imports with lines', () => {
    const src = [
      "import { a, b as c } from './lib'",
      "import Default from './widget'",
      "import * as NS from './ns'",
      "import './side-effect'",
      "const m = require('./legacy')",
      "async function f() { return import('./lazy') }",
    ].join('\n')
    const imports = parseImports(src)
    const bySpec = new Map(imports.map((i) => [i.specifier, i]))
    expect(bySpec.get('./lib')?.bindingNames).toEqual(['a', 'b'])
    expect(bySpec.get('./widget')?.defaultBinding).toBe(true)
    expect(bySpec.get('./ns')?.namespaceBinding).toBe('NS')
    expect(bySpec.get('./side-effect')?.bindingNames).toEqual([])
    expect(bySpec.get('./legacy')?.defaultBinding).toBe(true)
    expect(bySpec.get('./lazy')?.kind).toBe('dynamic')
    expect(bySpec.get('./lib')?.line).toBe(1)
  })

  test('aliases keep both sides: `import { X as Y }` records binding X', () => {
    const imports = parseImports("import { Hero as SiteHero } from './hero'")
    expect(imports[0].bindingNames).toEqual(['Hero'])
  })
})

describe('M25 graph — edges and honesty', () => {
  const files = [
    { path: 'src/app.tsx', content: "import { Hero } from './components/hero'\nimport './styles.css'" },
    { path: 'src/components/hero.tsx', content: "export function Hero() { return null }\nimport { fmt } from '../utils/format'" },
    { path: 'src/utils/format.ts', content: 'export const fmt = (s: string) => s' },
    { path: 'src/styles.css', content: "@import './theme.css';\nbody { margin: 0 }" },
    { path: 'src/theme.css', content: 'body { color: red }' },
    { path: 'src/orphan.ts', content: "import { x } from './does-not-exist'" },
  ]

  test('verified edges resolve; unresolved relative imports are recorded honestly', () => {
    const g = buildProjectGraph(files)
    const app = g.nodes.get('src/app.tsx')
    expect(app).toBeDefined()
    const heroEdge = app!.imports.find((i) => i.specifier === './components/hero')
    expect(heroEdge?.verified).toBe(true)
    expect(heroEdge?.resolvedPath).toBe('src/components/hero.tsx')
    expect(heroEdge?.bindingNames).toEqual(['Hero'])
    const cssEdge = app!.imports.find((i) => i.specifier === './styles.css')
    expect(cssEdge?.verified).toBe(true)
    const orphan = g.nodes.get('src/orphan.ts')
    expect(orphan!.imports[0].verified).toBe(false)
    expect(g.unresolved.some((u) => u.path === 'src/orphan.ts' && u.specifier === './does-not-exist')).toBe(true)
  })

  test('importer counts and importer queries work', () => {
    const g = buildProjectGraph(files)
    expect(g.nodes.get('src/components/hero.tsx')!.importedByCount).toBe(1)
    const importers = verifiedImportersOf(g, 'src/utils/format.ts')
    expect(importers.map((i) => i.path)).toEqual(['src/components/hero.tsx'])
  })

  test('graph notes never claim complete coverage', () => {
    const g = buildProjectGraph(files)
    expect(g.notes.some((n) => n.includes('unresolved') || n.includes('NOT claimed'))).toBe(true)
  })

  test('bare package specifiers are not project edges and not unresolved noise', () => {
    const g = buildProjectGraph([{ path: 'a.ts', content: "import React from 'react'" }])
    expect(g.nodes.get('a.ts')!.imports[0].verified).toBe(false)
    expect(g.unresolved).toHaveLength(0)
  })
})

describe('M25 graph — incremental updates', () => {
  test('re-analyzes changed files only and re-points moved targets', () => {
    const files = [
      { path: 'src/app.tsx', content: "import { Hero } from './components/hero'" },
      { path: 'src/components/hero.tsx', content: 'export function Hero() { return null }' },
    ]
    const g = buildProjectGraph(files)
    // Move hero.tsx → src/ui/hero.tsx (only the file list changed; app.tsx still references the old path).
    const moved = [
      { path: 'src/app.tsx', content: files[0].content },
      { path: 'src/ui/hero.tsx', content: files[1].content },
    ]
    const g2 = updateGraph(g, moved, ['src/components/hero.tsx', 'src/ui/hero.tsx'])
    // app.tsx was NOT re-analyzed: its edge re-pointed to the new stem or is honestly unresolved.
    const edge = g2.nodes.get('src/app.tsx')!.imports[0]
    if (edge.verified) expect(edge.resolvedPath).toBe('src/ui/hero.tsx')
    else expect(edge.resolvedPath).toBeNull()
    // The new file WAS re-analyzed.
    expect(g2.nodes.get('src/ui/hero.tsx')!.symbols.some((s) => s.name === 'Hero')).toBe(true)
    expect(g2.complete).toBe(false)
  })

  test('editing one file does not disturb other nodes', () => {
    const files = [
      { path: 'a.ts', content: 'export const a = 1' },
      { path: 'b.ts', content: "import { a } from './a'" },
    ]
    const g = buildProjectGraph(files)
    const before = JSON.stringify(g.nodes.get('b.ts'))
    const g2 = updateGraph(g, [files[0], { path: 'b.ts', content: "import { a } from './a'\nexport const b = 2" }], ['b.ts'])
    expect(JSON.stringify(g.nodes.get('a.ts'))).toBe(JSON.stringify(g2.nodes.get('a.ts')))
    expect(JSON.stringify(g2.nodes.get('b.ts'))).not.toBe(before)
  })
})

describe('M25 graph — cycles and cones', () => {
  test('detects real import cycles over verified edges', () => {
    const files = [
      { path: 'a.ts', content: "import { b } from './b'" },
      { path: 'b.ts', content: "import { c } from './c'" },
      { path: 'c.ts', content: "import { a } from './a'" },
      { path: 'd.ts', content: 'export const d = 1' },
    ]
    const cycles = detectCircularDependencies(buildProjectGraph(files))
    expect(cycles).toHaveLength(1)
    expect(cycles[0][0]).toBe(cycles[0][cycles[0].length - 1])
    expect(cycles[0].length).toBe(4)
  })

  test('no false cycles in a tree', () => {
    const files = [
      { path: 'a.ts', content: "import { b } from './b'" },
      { path: 'b.ts', content: 'export const b = 1' },
    ]
    expect(detectCircularDependencies(buildProjectGraph(files))).toHaveLength(0)
  })

  test('dependency cone walks up (imports) and down (importers) transitively', () => {
    const files = [
      { path: 'src/app.tsx', content: "import { h } from './hero'" },
      { path: 'src/hero.tsx', content: "import { f } from './format'" },
      { path: 'src/format.ts', content: 'export const f = 1' },
      { path: 'src/unrelated.ts', content: 'export const u = 1' },
    ]
    const g = buildProjectGraph(files)
    const up = dependencyCone(g, ['src/app.tsx'], 'up')
    expect(up).toEqual(['src/app.tsx', 'src/format.ts', 'src/hero.tsx'])
    const down = dependencyCone(g, ['src/format.ts'], 'down')
    expect(down).toEqual(['src/app.tsx', 'src/format.ts', 'src/hero.tsx'])
    expect(dependencyCone(g, ['src/unrelated.ts'], 'down')).toEqual(['src/unrelated.ts'])
  })
})
