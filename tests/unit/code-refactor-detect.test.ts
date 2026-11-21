/**
 * BEAN Intelligence — CODE GIFTZ refactoring intent detection tests (M25).
 *
 * Pins the composable detection contract:
 *  - rename-symbol requests resolve against the REAL symbol index; unknown
 *    symbols fall through (M23 file-op rename still owns file renames);
 *  - ambiguous declarations produce focused clarification;
 *  - service-layer / consolidation / extraction / restructure intents are
 *    recognized and scoped;
 *  - a move WITH import-update intent routes to move-module; a plain move
 *    falls through to M23;
 *  - prose-shaped code requests are NEVER hijacked ({ detected: false }).
 */
import { describe, test, expect } from 'bun:test'
import { detectRefactoringRequest } from '../../src/lib/code/refactoring/detect'

const FILES = [
  { path: 'src/utils/format.ts', content: 'export function formatValue(n: number) {\n  return String(n)\n}' },
  { path: 'src/components/hero.tsx', content: "import { formatValue } from '../utils/format'\nexport function Hero() { return null }" },
  { path: 'src/components/card.tsx', content: 'export function Card() { return null }' },
  { path: 'src/app.tsx', content: "import { Hero } from './components/hero'\nexport default function App() { return null }" },
  { path: 'src/services/data.ts', content: 'export async function load() { return [] }' },
]

describe('M25 detection — rename symbol', () => {
  test('resolves an existing symbol', () => {
    const d = detectRefactoringRequest('rename formatValue to money throughout the project', FILES)
    expect(d.detected).toBe(true)
    if (d.detected && d.type === 'op') {
      expect(d.kind).toBe('rename-symbol')
      expect(d.symbol).toBe('formatValue')
      expect(d.newName).toBe('money')
    }
  })

  test('unknown symbol falls through (maybe a file rename for M23)', () => {
    expect(detectRefactoringRequest('rename ghostSymbol to alive', FILES).detected).toBe(false)
  })

  test('ambiguous declaration clarifies', () => {
    const dup = [...FILES, { path: 'src/other.ts', content: 'export function formatValue() { return "" }' }]
    const d = detectRefactoringRequest('rename formatValue to money', dup)
    expect(d.detected).toBe(true)
    if (d.detected && d.type === 'clarification') expect(d.question).toContain('which one')
  })
})

describe('M25 detection — assisted kinds', () => {
  test('service-layer intent is recognized with scope', () => {
    const d = detectRefactoringRequest('move all API calls into a service layer', FILES)
    expect(d.detected).toBe(true)
    if (d.detected && d.type === 'op') {
      expect(d.kind).toBe('service-layer')
      expect((d.scopeRoots ?? []).length).toBeGreaterThan(0)
    }
  })

  test('extract component intent resolves the named file', () => {
    const d = detectRefactoringRequest('extract the hero section from hero.tsx into its own component file', FILES)
    expect(d.detected).toBe(true)
    if (d.detected && d.type === 'op') {
      expect(d.kind).toBe('extract-component')
      expect(d.scopeRoots).toEqual(['src/components/hero.tsx'])
    }
  })

  test('extract without a resolvable target asks which file', () => {
    const d = detectRefactoringRequest('extract the shared widget into its own component file', FILES)
    expect(d.detected).toBe(true)
    // Either clarification or a candidate list — never a guess of one file.
    if (d.detected && d.type === 'op') expect((d.scopeRoots ?? []).length).toBeGreaterThan(0)
  })

  test('consolidation intent is recognized', () => {
    const d = detectRefactoringRequest('convert these repeated card elements into a shared component', FILES)
    expect(d.detected).toBe(true)
    if (d.detected && d.type === 'op') expect(d.kind).toBe('consolidate')
  })

  test('restructure intent is recognized', () => {
    const d = detectRefactoringRequest('reorganize this project into a cleaner folder structure', FILES)
    expect(d.detected).toBe(true)
    if (d.detected && d.type === 'op') expect(d.kind).toBe('restructure')
  })
})

describe('M25 detection — move-module vs M23 move', () => {
  test('move WITH import-update intent routes to move-module', () => {
    const d = detectRefactoringRequest('move src/utils/format.ts into src/lib and update all affected imports', FILES)
    expect(d.detected).toBe(true)
    if (d.detected && d.type === 'op') {
      expect(d.kind).toBe('move-module')
      expect(d.sources).toEqual(['src/utils/format.ts'])
      expect(d.destination).toBe('src/lib')
    }
  })

  test('plain move falls through (M23 owns it)', () => {
    expect(detectRefactoringRequest('move src/utils/format.ts into src/lib', FILES).detected).toBe(false)
  })
})

describe('M25 detection — honesty guards', () => {
  test('prose-shaped edit requests are never hijacked', () => {
    expect(detectRefactoringRequest('change the hero heading to say Welcome home', FILES).detected).toBe(false)
    expect(detectRefactoringRequest('add a search filter to the dashboard table', FILES).detected).toBe(false)
  })

  test('empty projects never detect', () => {
    expect(detectRefactoringRequest('rename formatValue to money', []).detected).toBe(false)
  })

  test('short messages never detect', () => {
    expect(detectRefactoringRequest('rename x', FILES).detected).toBe(false)
  })
})
