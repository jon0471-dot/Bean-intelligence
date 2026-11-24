import { describe, expect, test, beforeEach } from 'bun:test'

import {
  searchAtlasTool,
  readAtlasDocTool,
  scoreAtlasSections,
  loadAtlasLibrary,
  atlasDocCount,
  resetAtlasCacheForTests,
} from '@/lib/riishe/tools/atlas'
import { selectTools } from '@/lib/riishe/orchestrator'
import { getTool, listToolNames } from '@/lib/riishe/tools/registry'

beforeEach(() => {
  resetAtlasCacheForTests()
})

const TOOL_CTX_BASE = {
  permissions: new Set<string>(),
  documents: new Map(),
}

describe('M38-E atlas tools — library loading', () => {
  test('the real repository library loads with all 31 documents', () => {
    const lib = loadAtlasLibrary()
    expect(lib).not.toBeNull()
    expect(lib!.docs.length).toBe(31)
    expect(atlasDocCount()).toBe(31)
  })

  test('every parsed doc carries atlas id, title and review date', () => {
    const lib = loadAtlasLibrary()!
    for (const doc of lib.docs) {
      expect(doc.atlasId).toMatch(/^ATLAS-/)
      expect(doc.title.length).toBeGreaterThan(3)
      expect(doc.reviewDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(doc.sections.length).toBeGreaterThanOrEqual(3)
    }
  })

  test('the required domain guides are present (04-29 + foundation)', () => {
    const lib = loadAtlasLibrary()!
    const files = new Set(lib.docs.map((d) => d.file))
    for (const f of [
      'README.md',
      '00-world-knowledge-coverage-map.md',
      '01-knowledge-schema-and-relationships.md',
      '02-source-provenance-and-licensing.md',
      '03-coverage-gaps-and-update-policy.md',
      '04-human-anatomy-and-physiology.md',
      '08-human-falls-impact-balance-and-recovery.md',
      '13-bird-anatomy-flight-and-aerodynamics.md',
      '16-physics-motion-forces-and-energy.md',
      '26-professional-software-ui-ux-and-motion-design.md',
      '29-professional-code-generation-and-product-engineering.md',
    ]) {
      expect(files.has(f)).toBe(true)
    }
  })
})

describe('M38-E atlas tools — deterministic search', () => {
  test('querying human movement finds the movement guides with real scores', () => {
    const lib = loadAtlasLibrary()!
    const hits = scoreAtlasSections(lib, 'how do humans walk gait stance swing')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].score).toBeGreaterThan(0)
    const files = hits.map((h) => h.doc.file)
    expect(files.some((f) => f.startsWith('05-') || f.startsWith('06-'))).toBe(true)
  })

  test('bird flight query surfaces the dedicated flight reference first', () => {
    const lib = loadAtlasLibrary()!
    const hits = scoreAtlasSections(lib, 'bird flight aerodynamics lift feathers soaring')
    expect(hits.length).toBeGreaterThan(0)
    // the dedicated flight document must rank among the top hits
    const top3 = hits.slice(0, 3).map((h) => h.doc.file)
    expect(top3.some((f) => f.startsWith('13-'))).toBe(true)
  })

  test('an atlas id resolves directly', () => {
    const lib = loadAtlasLibrary()!
    const hits = scoreAtlasSections(lib, 'ATLAS-13')
    expect(hits[0]?.doc.atlasId).toBe('ATLAS-13')
  })

  test('an unrelated query returns no fabricated hits', () => {
    const lib = loadAtlasLibrary()!
    const hits = scoreAtlasSections(lib, 'qqxvvt zzpltq bxqmqv')
    expect(hits.length).toBe(0)
  })

  test('scoring is deterministic (same query, same order)', () => {
    const lib = loadAtlasLibrary()!
    const a = scoreAtlasSections(lib, 'insect exoskeleton metamorphosis')
    const b = scoreAtlasSections(lib, 'insect exoskeleton metamorphosis')
    expect(a.map((h) => `${h.doc.file}#${h.section?.n}`)).toEqual(b.map((h) => `${h.doc.file}#${h.section?.n}`))
  })
})

describe('M38-E atlas tools — tool execution', () => {
  test('search_atlas returns real sections and citation sources', async () => {
    const r = await searchAtlasTool.execute({ query: 'bird flight lift drag flapping' }, TOOL_CTX_BASE)
    expect(r.ok).toBe(true)
    expect(r.output).toContain('ATLAS-')
    expect(r.sources?.length).toBeGreaterThan(0)
    expect(r.sources![0].hostName).toBe('bean-knowledge-atlas')
    expect(r.sources![0].pageRead).toBe(true)
    expect(r.sources![0].url).toContain('docs/knowledge-atlas/')
  })

  test('read_atlas_doc pages a real document honestly', async () => {
    const r0 = await readAtlasDocTool.execute({ atlasId: 'ATLAS-06', offset: 0 }, TOOL_CTX_BASE)
    expect(r0.ok).toBe(true)
    expect(r0.output).toContain('ATLAS-06')
    // a page boundary note must be honest about remaining content
    expect(r0.output).toMatch(/\[more text remains|\[end of document\]/)
    // continue to the end and hit the honest end note
    const bigOffset = 1_000_000
    const rEnd = await readAtlasDocTool.execute({ atlasId: 'ATLAS-06', offset: bigOffset }, TOOL_CTX_BASE)
    expect(rEnd.ok).toBe(true)
    expect(rEnd.output).toContain('past the end')
  })

  test('read_atlas_doc with a section filter returns exactly that section', async () => {
    const r = await readAtlasDocTool.execute({ atlasId: 'ATLAS-01', section: 3, offset: 0 }, TOOL_CTX_BASE)
    expect(r.ok).toBe(true)
    expect(r.output).toContain('§3')
    expect(r.output).toContain('action schema')
    const rBad = await readAtlasDocTool.execute({ atlasId: 'ATLAS-01', section: 999, offset: 0 }, TOOL_CTX_BASE)
    expect(rBad.ok).toBe(false)
    expect(rBad.output).toContain('no section 999')
  })

  test('unknown atlas id fails honestly with the real id list', async () => {
    const r = await readAtlasDocTool.execute({ atlasId: 'ATLAS-999', offset: 0 }, TOOL_CTX_BASE)
    expect(r.ok).toBe(false)
    expect(r.output).toContain('No atlas document matches')
    expect(r.output).toContain('ATLAS-04')
  })

  test('input validation rejects malformed requests', () => {
    expect(() => searchAtlasTool.validate({ query: '' })).toThrow()
    expect(() => readAtlasDocTool.validate({ atlasId: 'x' })).toThrow()
    expect(() => readAtlasDocTool.validate({ atlasId: 'ATLAS-06', offset: -5 })).toThrow()
  })

  test('atlas tools are registered in the fixed registry', () => {
    // registerBuiltins runs at orchestrator module load; importing the
    // orchestrator above guarantees registration happened in this process.
    expect(listToolNames()).toContain('search_atlas')
    expect(listToolNames()).toContain('read_atlas_doc')
    expect(getTool('search_atlas')?.permission).toBe('standard')
    expect(getTool('read_atlas_doc')?.permission).toBe('standard')
  })

  test('selectTools admits the atlas tools under the SAME conditions as web search', () => {
    const withDocs = selectTools({
      searchNeeded: false,
      task: 'document',
      hasDocuments: true,
      allowCodeExecution: false,
      researchFailed: false,
    })
    expect(withDocs).toContain('search_atlas')
    expect(withDocs).toContain('read_atlas_doc')
    expect(withDocs).toContain('web_search')

    const deep = selectTools({
      searchNeeded: false,
      task: 'research',
      hasDocuments: false,
      allowCodeExecution: false,
      researchFailed: false,
      deepResearch: true,
    })
    expect(deep).toContain('search_atlas')

    const recovery = selectTools({
      searchNeeded: true,
      task: 'knowledge',
      hasDocuments: false,
      allowCodeExecution: false,
      researchFailed: true,
    })
    expect(recovery).toContain('search_atlas')

    const plain = selectTools({
      searchNeeded: false,
      task: 'chat',
      hasDocuments: false,
      allowCodeExecution: false,
      researchFailed: false,
    })
    expect(plain).not.toContain('search_atlas')
    expect(plain).not.toContain('web_search')
  })

  test('search output never leaks server paths beyond the relative atlas path', async () => {
    const r = await searchAtlasTool.execute({ query: 'squat knee mechanics' }, TOOL_CTX_BASE)
    expect(r.output).not.toMatch(/\/home\//)
    expect(r.output).not.toMatch(/process\.cwd/)
    expect(r.output).not.toMatch(/node_modules/)
  })
})
