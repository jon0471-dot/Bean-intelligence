/**
 * BEAN Intelligence — CODE GIFTZ reference-integrity scanning tests (M23).
 *
 * Pure suite: import/require/dynamic-import specifiers, HTML src/href and
 * CSS url() references, root-relative and @/ alias forms, extension-less
 * imports, exact repair-edit construction, and honest unrepairable reports.
 */
import { describe, test, expect } from 'bun:test'
import {
  scanReferences,
  buildRepairEdits,
  applyRepairEdits,
  normalizeRef,
} from '../../src/lib/code/file-ops/references'

const FILES = [
  {
    path: 'src/App.tsx',
    content: `import { Button } from './components/Button'\nimport { api } from './services/api'\nimport logo from '../assets/logo.png'\nimport { utils } from '@/lib/utils'\nexport default function App() { return null }\n`,
  },
  {
    path: 'src/main.tsx',
    content: `import App from './App'\nimport('./lazy').then(() => {})\nrequire('./legacy.js')\n`,
  },
  {
    path: 'src/components/Card.tsx',
    content: `import { api } from '../services/api'\nexport const Card = () => null\n`,
  },
  {
    path: 'index.html',
    content: `<html><head><link rel="stylesheet" href="styles.css"></head><body><img src="assets/logo.png"><script src="app.js"></script></body></html>\n`,
  },
  {
    path: 'styles.css',
    content: `body { background: url(assets/bg.png); }\n@import url("./theme.css");\n`,
  },
  { path: 'src/components/Button.tsx', content: `export const Button = () => null\n` },
  { path: 'src/services/api.ts', content: `export const api = 1\n` },
  { path: 'assets/logo.png', content: 'PNGDATA' },
  { path: 'assets/bg.png', content: 'BGDATA' },
  { path: 'src/lib/utils.ts', content: `export const utils = 1\n` },
]

describe('reference scanning', () => {
  test('finds extension-less relative imports of a moved file', () => {
    const refs = scanReferences(FILES, ['src/components/Button.tsx'])
    expect(refs.map((r) => r.path).sort()).toEqual(['src/App.tsx'])
    expect(refs[0].specifier).toBe('./components/Button')
    expect(refs[0].extensionless).toBe(true)
    expect(refs[0].lines).toEqual([1])
  })

  test('finds relative imports from a parent directory', () => {
    const refs = scanReferences(FILES, ['src/services/api.ts']).filter((r) => r.path === 'src/components/Card.tsx')
    expect(refs.length).toBe(1)
    expect(refs[0].specifier).toBe('../services/api')
    expect(refs[0].lines).toEqual([1])
  })

  test('finds @/ alias references', () => {
    const refs = scanReferences(FILES, ['src/lib/utils.ts'])
    expect(refs.map((r) => r.path)).toEqual(['src/App.tsx'])
    expect(refs[0].style).toBe('alias')
  })

  test('finds HTML asset references in every referencing file', () => {
    const refs = scanReferences(FILES, ['assets/logo.png'])
    expect(refs.some((r) => r.path === 'index.html')).toBe(true)
    expect(refs.some((r) => r.path === 'src/App.tsx')).toBe(true)
  })

  test('finds CSS url() references', () => {
    const refs = scanReferences(FILES, ['assets/bg.png'])
    expect(refs.map((r) => r.path)).toEqual(['styles.css'])
  })

  test('a file never references itself; unrelated files are untouched', () => {
    const refs = scanReferences(FILES, ['src/App.tsx'])
    expect(refs.some((r) => r.path === 'src/App.tsx')).toBe(false)
  })

  test('bare specifiers only match exact literal targets (never package names)', () => {
    expect(scanReferences(FILES, ['styles.css']).map((r) => r.path)).toEqual(['index.html'])
    expect(scanReferences(FILES, ['nonexistent/x.ts']).length).toBe(0)
  })
})

describe('repair-edit construction', () => {
  test('recomputes correct relative specifiers for a moved file', () => {
    const { edits, unrepairable } = buildRepairEdits(FILES, [
      { from: 'src/components/Button.tsx', to: 'src/ui/Button.tsx' },
    ])
    expect(unrepairable).toEqual([])
    expect(edits.length).toBe(1)
    expect(edits[0]).toEqual({
      path: 'src/App.tsx',
      find: './components/Button',
      replaceWith: './ui/Button',
    })
  })

  test('repairing a folder move rewrites every importing specifier', () => {
    const { edits } = buildRepairEdits(FILES, [{ from: 'src/services', to: 'src/core/services' }])
    const appEdit = edits.find((e) => e.path === 'src/App.tsx')
    expect(appEdit?.replaceWith).toBe('./core/services/api')
    const cardEdit = edits.find((e) => e.path === 'src/components/Card.tsx')
    expect(cardEdit?.replaceWith).toBe('../core/services/api')
  })

  test('alias references are repaired with their @/ prefix preserved', () => {
    const { edits, unrepairable } = buildRepairEdits(FILES, [{ from: 'src/lib/utils.ts', to: 'src/lib/helpers.ts' }])
    expect(unrepairable).toEqual([])
    expect(edits[0]).toMatchObject({ path: 'src/App.tsx', find: '@/lib/utils', replaceWith: '@/lib/helpers' })
  })

  test('root-relative references are repaired with their leading slash', () => {
    const htmlOnly = [
      { path: 'index.html', content: `<img src="/assets/logo.png">` },
      { path: 'assets/logo.png', content: 'PNG' },
    ]
    const { edits } = buildRepairEdits(htmlOnly, [{ from: 'assets/logo.png', to: 'media/logo.png' }])
    expect(edits[0]).toEqual({ path: 'index.html', find: '/assets/logo.png', replaceWith: '/media/logo.png' })
  })

  test('applyRepairEdits changes only the matched specifier', () => {
    const { changed, missing } = applyRepairEdits(FILES, [
      { path: 'src/App.tsx', find: './components/Button', replaceWith: './ui/Button' },
    ])
    expect(missing).toEqual([])
    expect(changed.length).toBe(1)
    expect(changed[0].content).toContain("from './ui/Button'")
    expect(changed[0].content).toContain("from './services/api'") // untouched
    expect(changed[0].content).toContain("from '@/lib/utils'") // untouched
  })

  test('a vanished reference is reported missing (stale), never guessed', () => {
    const { missing } = applyRepairEdits(FILES, [
      { path: 'src/App.tsx', find: './components/Ghost', replaceWith: './ui/Ghost' },
    ])
    expect(missing).toEqual([{ path: 'src/App.tsx', find: './components/Ghost' }])
  })
})

describe('normalizeRef parity with the preview audit', () => {
  test('resolves ../ and ./ chains', () => {
    expect(normalizeRef('src/components', '../services/api')).toBe('src/services/api')
    expect(normalizeRef('', '/assets/logo.png')).toBe('assets/logo.png')
    expect(normalizeRef('src', './lib/utils')).toBe('src/lib/utils')
  })
})
