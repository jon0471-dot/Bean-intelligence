/**
 * BEAN Intelligence — unit tests for the analyze_image tool + cross-source
 * research conflict note (Phases 3-5, hermetic — no network, no DB).
 * Run: bun test tests/unit/riishe-tools-v2.test.ts
 */
import { describe, test, expect } from 'bun:test'
import { analyzeImageTool } from '../../src/lib/riishe/tools/builtin'
import { listToolNames } from '../../src/lib/riishe/tools/registry'
import { registerBuiltins } from '../../src/lib/riishe/tools/builtin-registry'
import { findDateDisagreement, formatEvidenceBlock } from '../../src/lib/research/pipeline'
import type { ToolContext } from '../../src/lib/riishe/tools/types'

registerBuiltins()

const ctx = (docs: ToolContext['documents']): ToolContext => ({
  permissions: new Set<string>(),
  documents: docs,
})

describe('analyze_image tool', () => {
  test('is registered in the fixed tool universe', () => {
    expect(listToolNames()).toContain('analyze_image')
  })

  test('refuses unknown document ids honestly', async () => {
    const r = await analyzeImageTool.execute({ documentId: 'nope', question: 'what is shown?' }, ctx(new Map()))
    expect(r.ok).toBe(false)
    expect(r.output).toContain('No attached image')
  })

  test('refuses non-image documents', async () => {
    const docs = new Map([['d1', { name: 'notes.pdf', text: '…', truncated: false, kind: 'pdf' }]])
    const r = await analyzeImageTool.execute({ documentId: 'd1', question: 'what is shown?' }, ctx(docs))
    expect(r.ok).toBe(false)
    expect(r.output).toContain('not an image')
  })

  test('admits missing pixels honestly instead of inventing analysis', async () => {
    const docs = new Map([['d1', { name: 'shot.png', text: 'stale description', truncated: false, kind: 'image', storagePath: null }]])
    const r = await analyzeImageTool.execute({ documentId: 'd1', question: 'what error is shown?' }, ctx(docs))
    expect(r.ok).toBe(false)
    expect(r.output).toContain('not retained')
  })

  test('input validation bounds the question', () => {
    expect(() => analyzeImageTool.validate({ documentId: 'd1', question: 'x' })).toThrow()
    expect(() => analyzeImageTool.validate({ documentId: 'd1', question: 'what does the chart show?' })).not.toThrow()
  })
})

describe('cross-source date disagreement (conflict comparison)', () => {
  test('flags packs whose dated sources span more than a year', () => {
    const note = findDateDisagreement([
      { id: 1, title: '2024 Market Report', date: '2024-02-01' },
      { id: 2, title: '2026 Market Report', date: '2026-10-01' },
    ])
    expect(note).toContain('wide date range')
    expect(note).toContain('2026 Market Report')
  })

  test('stays silent for tight date ranges and undated packs', () => {
    expect(findDateDisagreement([
      { id: 1, title: 'A', date: '2026-09-01' },
      { id: 2, title: 'B', date: '2026-10-01' },
    ])).toBe(null)
    expect(findDateDisagreement([
      { id: 1, title: 'A', date: null },
      { id: 2, title: 'B', date: null },
    ])).toBe(null)
    expect(findDateDisagreement([{ id: 1, title: 'A', date: '2019-01-01' }])).toBe(null)
  })

  test('formatEvidenceBlock appends the note to the numbered sources', () => {
    const block = formatEvidenceBlock({
      sources: [
        { id: 1, title: 'Old news', url: 'https://a.example/x', hostName: 'a.example', date: '2023-05-01', official: false, social: false, pageRead: false, snippet: 's', excerpt: 'e' },
        { id: 2, title: 'Fresh news', url: 'https://b.example/y', hostName: 'b.example', date: '2026-10-01', official: false, social: false, pageRead: false, snippet: 's', excerpt: 'e' },
      ],
      queries: [],
      degraded: [],
      staleness: null,
      geoWarning: null,
      durationMs: 1,
      searchMs: 1,
      pageReadMs: 0,
      searchCalls: 1,
      pageReadCalls: 0,
      cacheHits: 0,
      fetchedAt: new Date().toISOString(),
    } as never)
    expect(block).toContain('[1] Old news')
    expect(block).toContain('wide date range')
  })
})
