/**
 * M50.2 BEAN AI STUDIO — schema parsing tests (hermetic, pure).
 *
 * Pins the strict versioned-graph schema (stage 1) and registry/contract
 * resolution (stage 2): supported version only, documented fields only,
 * bounded data-only configuration, duplicate-id rejection, hostile-input
 * rejection, and explicit refusal of unknown/proposed node types (never
 * substituted, never reinterpreted).
 *
 * Run: bun test tests/unit/m50-2-graph-schema.test.ts
 */
import { describe, test, expect } from 'bun:test'

import { parseWorkflowGraph } from '../../src/lib/ai-studio/schema'
import { WORKFLOW_LIMITS } from '../../src/lib/ai-studio/limits'

function validGraph() {
  return {
    schemaVersion: 1,
    nodes: [
      { nodeId: 'n1', nodeType: 'input.text', contractVersion: 1, config: { text: 'research topic' }, position: { x: 0, y: 0 } },
      { nodeId: 'n2', nodeType: 'research.web', contractVersion: 1, config: {} },
      { nodeId: 'n3', nodeType: 'document.draft', contractVersion: 1, config: { instruction: 'write the report' } },
      { nodeId: 'n4', nodeType: 'output.deliverable', contractVersion: 1, config: {} },
    ],
    edges: [
      { edgeId: 'e1', from: { nodeId: 'n1', port: 'text' }, to: { nodeId: 'n2', port: 'topic' } },
      { edgeId: 'e2', from: { nodeId: 'n2', port: 'pack' }, to: { nodeId: 'n3', port: 'research' } },
      { edgeId: 'e3', from: { nodeId: 'n3', port: 'document' }, to: { nodeId: 'n4', port: 'project' } },
    ],
  }
}

function codesOf(result: { ok: boolean; outcome?: { diagnostics: Array<{ code: string }> } }): string[] {
  if (result.ok) return []
  return (result.outcome?.diagnostics ?? []).map((d) => d.code)
}

describe('M50.2 schema — valid version-1 graphs', () => {
  test('a fully valid graph parses and is preserved verbatim', () => {
    const result = parseWorkflowGraph(validGraph())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.graph.schemaVersion).toBe(1)
    expect(result.graph.nodes).toHaveLength(4)
    expect(result.graph.edges).toHaveLength(3)
    expect(result.graph.nodes[0].config['text']).toBe('research topic')
    expect(result.graph.nodes[0].position).toEqual({ x: 0, y: 0 })
  })

  test('an absent config object is allowed; an empty one is preserved', () => {
    const g = validGraph()
    delete (g.nodes[1] as Record<string, unknown>).config
    const result = parseWorkflowGraph(g)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.graph.nodes[1].config).toEqual({})
  })

  test('position is optional and presentation-only', () => {
    const g = validGraph()
    for (const n of g.nodes) delete (n as Record<string, unknown>).position
    const result = parseWorkflowGraph(g)
    expect(result.ok).toBe(true)
  })
})

describe('M50.2 schema — version discipline', () => {
  test('an unsupported schema version fails explicitly (never reinterpreted as 1)', () => {
    const result = parseWorkflowGraph({ ...validGraph(), schemaVersion: 2 })
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain('E_SCHEMA')
    if (result.ok) return
    expect(result.outcome.diagnostics.some((d) => d.message.includes('schema version 2'))).toBe(true)
  })

  test('a missing or non-integer schemaVersion fails', () => {
    const a = parseWorkflowGraph({ ...validGraph(), schemaVersion: '1' })
    expect(codesOf(a)).toContain('E_SCHEMA')
    const withoutVersion: Record<string, unknown> = { nodes: validGraph().nodes, edges: validGraph().edges }
    const b = parseWorkflowGraph(withoutVersion)
    expect(codesOf(b)).toContain('E_SCHEMA')
    const c = parseWorkflowGraph({ ...validGraph(), schemaVersion: 1.5 })
    expect(codesOf(c)).toContain('E_SCHEMA')
  })

  test('an unsupported node contract version fails while the type itself is known', () => {
    const g = validGraph()
    ;(g.nodes[1] as { contractVersion: number }).contractVersion = 2
    const result = parseWorkflowGraph(g)
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain('E_UNKNOWN_NODE')
    if (result.ok) return
    expect(result.outcome.diagnostics.some((d) => d.message.includes('contract version 2'))).toBe(true)
  })
})

describe('M50.2 schema — malformed shapes', () => {
  test('non-object graphs, bad primitives and malformed endpoints are rejected', () => {
    expect(codesOf(parseWorkflowGraph(null))).toContain('E_SCHEMA')
    expect(codesOf(parseWorkflowGraph([validGraph()]))).toContain('E_SCHEMA')
    expect(codesOf(parseWorkflowGraph('graph'))).toContain('E_SCHEMA')
    expect(codesOf(parseWorkflowGraph({ ...validGraph(), nodes: 'nodes' }))).toContain('E_SCHEMA')
    expect(codesOf(parseWorkflowGraph({ ...validGraph(), edges: {} }))).toContain('E_SCHEMA')
    const badNode = validGraph()
    ;(badNode.nodes[0] as unknown as Record<string, unknown>).nodeId = 42
    expect(codesOf(parseWorkflowGraph(badNode))).toContain('E_SCHEMA')
    const badEdge = validGraph()
    ;(badEdge.edges[0] as { from: unknown }).from = { nodeId: 'n1' } // missing port
    expect(codesOf(parseWorkflowGraph(badEdge))).toContain('E_SCHEMA')
    const badEdge2 = validGraph()
    ;(badEdge2.edges[1] as { to: unknown }).to = 'n3'
    expect(codesOf(parseWorkflowGraph(badEdge2))).toContain('E_SCHEMA')
  })

  test('invalid positions are rejected (non-finite, oversized, unknown keys)', () => {
    const g1 = validGraph()
    ;(g1.nodes[0] as { position: unknown }).position = { x: 'left', y: 0 }
    expect(codesOf(parseWorkflowGraph(g1))).toContain('E_SCHEMA')
    const g2 = validGraph()
    ;(g2.nodes[0] as { position: unknown }).position = { x: 9_999_999, y: 0 }
    expect(codesOf(parseWorkflowGraph(g2))).toContain('E_BOUNDS')
    const g3 = validGraph()
    ;(g3.nodes[0] as { position: unknown }).position = { x: 0, y: 0, z: 1 }
    expect(codesOf(parseWorkflowGraph(g3))).toContain('E_SCHEMA')
  })
})

describe('M50.2 schema — duplicates and unknown fields', () => {
  test('duplicate node ids are rejected', () => {
    const g = validGraph()
    g.nodes.push({ nodeId: 'n1', nodeType: 'input.text', contractVersion: 1, config: {} })
    const result = parseWorkflowGraph(g)
    expect(codesOf(result)).toContain('E_SCHEMA')
    if (result.ok) return
    expect(result.outcome.diagnostics.some((d) => d.message.includes('Duplicate node id'))).toBe(true)
  })

  test('duplicate edge ids are rejected', () => {
    const g = validGraph()
    g.edges.push(JSON.parse(JSON.stringify(g.edges[0])))
    expect(codesOf(parseWorkflowGraph(g))).toContain('E_SCHEMA')
  })

  test('unknown fields carrying attempted executable authority are rejected', () => {
    const g = validGraph()
    ;(g.nodes[1] as Record<string, unknown>).taskKind = 'code-build'
    ;(g.nodes[1] as Record<string, unknown>).agent = 'code-giftz'
    ;(g.nodes[1] as Record<string, unknown>).authScope = 'project-write'
    const result = parseWorkflowGraph(g)
    expect(result.ok).toBe(false)
    if (result.ok) return
    const messages = result.outcome.diagnostics.map((d) => d.message).join(' ')
    expect(messages).toContain('taskKind')
    expect(messages).toContain('agent')
    expect(messages).toContain('authScope')
  })

  test('verification overrides, permissions and provider ids cannot ride a node or edge', () => {
    const g = validGraph()
    ;(g.nodes[2] as Record<string, unknown>).verification = { minSources: 0 }
    ;(g.nodes[2] as Record<string, unknown>).permissions = ['admin']
    ;(g.nodes[2] as Record<string, unknown>).provider = 'internal-model-x'
    ;(g.edges[1] as Record<string, unknown>).condition = 'skip-verify'
    const result = parseWorkflowGraph(g)
    expect(result.ok).toBe(false)
    expect(codesOf(result).filter((c) => c === 'E_SCHEMA').length).toBeGreaterThanOrEqual(3)
  })

  test('unknown root fields are rejected', () => {
    const result = parseWorkflowGraph({ ...validGraph(), executionMode: 'ungoverned' })
    expect(codesOf(result)).toContain('E_SCHEMA')
  })
})

describe('M50.2 schema — bounds', () => {
  test('oversized graphs are rejected before deeper work', () => {
    const big = 'x'.repeat(WORKFLOW_LIMITS.graphJsonMaxChars + 10)
    const result = parseWorkflowGraph({ ...validGraph(), nodes: validGraph().nodes, filler: undefined, note: big })
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain('E_BOUNDS')
  })

  test('per-field config values beyond the global text bound are rejected', () => {
    const g = validGraph()
    ;(g.nodes[0].config as Record<string, string>)['text'] = 'y'.repeat(WORKFLOW_LIMITS.configTextMaxChars + 1)
    expect(codesOf(parseWorkflowGraph(g))).toContain('E_BOUNDS')
  })

  test('more nodes than the cap is a bounds error', () => {
    const g = validGraph()
    for (let i = 0; i < WORKFLOW_LIMITS.maxNodes; i++) {
      g.nodes.push({ nodeId: `extra${i}`, nodeType: 'input.text', contractVersion: 1, config: {} })
    }
    expect(codesOf(parseWorkflowGraph(g))).toContain('E_BOUNDS')
  })
})

describe('M50.2 schema — hostile input', () => {
  test('prototype-shaped input cannot smuggle fields (JSON.parse own-property case)', () => {
    const hostile = JSON.parse('{"schemaVersion":1,"__proto__":{"taskKind":"code-build"},"nodes":[{"nodeId":"n1","nodeType":"input.text","contractVersion":1,"config":{"__proto__":{"agent":"root"}},"position":{"x":0,"y":0}}],"edges":[]}')
    const result = parseWorkflowGraph(hostile)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const messages = result.outcome.diagnostics.map((d) => d.message).join(' ')
      expect(messages).not.toContain('code-build accepted')
    }
  })

  test('dangerous configuration keys are rejected', () => {
    const g = validGraph()
    ;(g.nodes[0].config as Record<string, string>)['constructor'] = 'evil'
    expect(codesOf(parseWorkflowGraph(g))).toContain('E_SCHEMA')
    // `__proto__` only becomes an own property through JSON parsing (a plain
    // assignment mutates the prototype instead — itself a safe outcome).
    const hostile = JSON.parse(
      JSON.stringify(validGraph()).replace('"text":"research topic"', '"text":"research topic","__proto__":"evil"'),
    )
    expect(hostile.nodes[0].config).toHaveProperty('__proto__')
    expect(codesOf(parseWorkflowGraph(hostile))).toContain('E_SCHEMA')
  })

  test('non-string config values (objects, arrays, numbers) are rejected — graphs are data-only', () => {
    const g = validGraph()
    ;(g.nodes[0].config as Record<string, unknown>)['text'] = { exec: 'rm -rf /' }
    expect(codesOf(parseWorkflowGraph(g))).toContain('E_SCHEMA')
    const g2 = validGraph()
    ;(g2.nodes[0].config as Record<string, unknown>)['text'] = ['a']
    expect(codesOf(parseWorkflowGraph(g2))).toContain('E_SCHEMA')
  })

  test('object-shape config keys violate the safe identifier rule', () => {
    const g = validGraph()
    ;(g.nodes[0].config as Record<string, string>)['9bad-key'] = 'value'
    expect(codesOf(parseWorkflowGraph(g))).toContain('E_SCHEMA')
  })
})

describe('M50.2 schema — proposed and unknown node types', () => {
  test('documented proposed nodes are refused with their structural reason', () => {
    const g = validGraph()
    g.nodes.push({ nodeId: 'n9', nodeType: 'approval.gate', contractVersion: 1, config: {} })
    const result = parseWorkflowGraph(g)
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain('E_UNKNOWN_NODE')
    if (result.ok) return
    expect(result.outcome.diagnostics.some((d) => d.message.includes('approval-wait state'))).toBe(true)
  })

  test('completely unknown node types are refused and never substituted', () => {
    const g = validGraph()
    ;(g.nodes[1] as { nodeType: string }).nodeType = 'ai.magic'
    const result = parseWorkflowGraph(g)
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain('E_UNKNOWN_NODE')
    if (result.ok) return
    expect(result.outcome.diagnostics.some((d) => d.message.includes('never substituted'))).toBe(true)
  })

  test('every proposed exclusion carries a non-empty structural reason', async () => {
    const { PROPOSED_NODE_TYPES, STUDIO_NODE_CONTRACTS } = await import('../../src/lib/ai-studio/registry')
    expect(PROPOSED_NODE_TYPES.length).toBeGreaterThan(0)
    for (const p of PROPOSED_NODE_TYPES) {
      expect(p.reason.length).toBeGreaterThan(20)
      expect(STUDIO_NODE_CONTRACTS.some((c) => c.nodeType === p.nodeType)).toBe(false)
    }
    const names = PROPOSED_NODE_TYPES.map((p) => p.nodeType)
    for (const forbidden of ['approval.gate', 'agent.turn', 'team.mission', 'gateway.chat', 'niiki.scene', 'niiki.vfx', 'external.http', 'code.arbitrary']) {
      expect(names).toContain(forbidden)
    }
  })
})

describe('M50.2 schema — determinism', () => {
  test('the same invalid input always produces byte-identical diagnostics', () => {
    const g = JSON.parse(JSON.stringify(validGraph()))
    ;(g.nodes[1] as { nodeType: string }).nodeType = 'ai.magic'
    const a = parseWorkflowGraph(g)
    const b = parseWorkflowGraph(JSON.parse(JSON.stringify(g)))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})
