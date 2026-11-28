/**
 * Test helper — loose graph literal types for the M50.2 suites.
 *
 * The suites construct graph literals and then MUTATE them (pushing nodes,
 * overwriting config values). TypeScript infers narrow literal types for
 * those objects, which fights the mutations; these deliberately loose shapes
 * mirror the wire contract (schemaVersion 1, bounded string configs) so the
 * suites can build graphs freely while `parseWorkflowGraph` still enforces
 * the REAL strictness at runtime.
 *
 * Test-only. The production modules never import this file.
 */

export interface LooseStudioNode {
  nodeId: string
  nodeType: string
  contractVersion: number
  config: Record<string, string>
  position?: { x: number; y: number }
}

export interface LooseStudioEdge {
  edgeId: string
  from: { nodeId: string; port: string }
  to: { nodeId: string; port: string }
}

export interface LooseStudioGraph {
  schemaVersion: 1
  nodes: LooseStudioNode[]
  edges: LooseStudioEdge[]
}

/** Annotate an inline graph literal as a LooseStudioGraph. */
export function looseGraph(g: LooseStudioGraph): LooseStudioGraph {
  return g
}
