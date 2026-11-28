/**
 * BEAN Intelligence — M50.2 BEAN AI STUDIO workflow-graph schema parser (pure).
 *
 * Turns UNTRUSTED input into a structurally valid `StudioWorkflowGraph`, or
 * fails with deterministic, customer-safe diagnostics. Strictness rules:
 *  - the supported schema version is EXACTLY 1 (a future version is an
 *    explicit failure — never reinterpreted as version 1);
 *  - only the documented fields exist; anything else (especially fields that
 *    carry attempted executable authority — taskKind, agent, authScope,
 *    permissions, verification, provider ids…) is rejected;
 *  - configuration values are bounded STRINGS only (no nested objects, no
 *    arrays, no functions, no dangerous keys);
 *  - duplicate node/edge ids are rejected;
 *  - oversized graphs are rejected before deeper work;
 *  - hostile strings/prototype-shaped input can never smuggle fields through
 *    (only own-enumerable properties are read; keys are pattern-checked).
 *
 * PURE module — shape checks only. No DB, no I/O, no env reads, no Date.now,
 * no randomness.
 */

import { WORKFLOW_LIMITS, NODE_CONTRACT_VERSION } from './limits'
import { findProposedNodeType, STUDIO_NODE_REGISTRY } from './registry'
import type { StudioNodeRegistry } from './registry'
import type {
  StudioDiagnostic,
  StudioGraphNode,
  StudioGraphEdge,
  StudioWorkflowGraph,
  WorkflowValidationOutcome,
} from './types'
import { diag } from './diagnostics'

const NODE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/
const EDGE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/
const PORT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/
const CONFIG_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/

/** Keys that must never appear as configuration (prototype-smuggling). */
const FORBIDDEN_CONFIG_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/** A plain object guard that rejects arrays, nulls and non-objects. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function ownKeys(v: Record<string, unknown>): string[] {
  return Object.keys(v)
}

/** Exact-key check: every key must be documented; returns the unknown ones. */
function unknownKeys(v: Record<string, unknown>, allowed: readonly string[]): string[] {
  const allow = new Set(allowed)
  return ownKeys(v).filter((k) => !allow.has(k))
}

export interface ParseWorkflowGraphOptions {
  /** Injectable registry (tests). The default registry is authoritative. */
  registry?: StudioNodeRegistry
}

/**
 * Parse and structurally validate untrusted graph data (validation stages
 * 1–2: schema/version/size + registry/contract-version resolution). Returns
 * either the parsed graph or the deterministic diagnostics. Later semantic
 * stages run in validate.ts against the PARSED graph only.
 */
export function parseWorkflowGraph(
  input: unknown,
  options: ParseWorkflowGraphOptions = {},
): { ok: true; graph: StudioWorkflowGraph } | { ok: false; outcome: WorkflowValidationOutcome } {
  const registry = options.registry ?? STUDIO_NODE_REGISTRY
  const problems: StudioDiagnostic[] = []

  // --- Stage 1: schema, version, size -------------------------------------
  if (!isPlainObject(input)) {
    problems.push(diag('E_SCHEMA', 'The workflow must be an object with schemaVersion, nodes and edges.'))
    return { ok: false, outcome: { valid: false, diagnostics: orderDiagnostics(problems) } }
  }

  // Size bound FIRST (cheapest denial-of-surface control), on the value as
  // submitted. Deterministic for the same submitted data shape.
  let serialized = ''
  try {
    serialized = JSON.stringify(input)
  } catch {
    problems.push(diag('E_SCHEMA', 'The workflow could not be serialized (cyclic or non-serializable data).'))
    return { ok: false, outcome: { valid: false, diagnostics: orderDiagnostics(problems) } }
  }
  if (serialized.length > WORKFLOW_LIMITS.graphJsonMaxChars) {
    problems.push(
      diag(
        'E_BOUNDS',
        `The workflow is too large (${serialized.length} characters; the limit is ${WORKFLOW_LIMITS.graphJsonMaxChars}).`,
      ),
    )
    return { ok: false, outcome: { valid: false, diagnostics: orderDiagnostics(problems) } }
  }

  const unknownRoot = unknownKeys(input, ['schemaVersion', 'nodes', 'edges'])
  for (const k of unknownRoot) {
    problems.push(diag('E_SCHEMA', `Unknown workflow field "${clip(k)}" is not allowed.`))
  }

  const schemaVersion = input.schemaVersion
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion)) {
    problems.push(diag('E_SCHEMA', 'schemaVersion must be an integer.'))
  } else if (schemaVersion !== WORKFLOW_LIMITS.schemaVersion) {
    problems.push(
      diag(
        'E_SCHEMA',
        `Unsupported workflow schema version ${schemaVersion}; this build supports version ${WORKFLOW_LIMITS.schemaVersion} only.`,
      ),
    )
  }

  if (!Array.isArray(input.nodes)) {
    problems.push(diag('E_SCHEMA', 'nodes must be an array.'))
  }
  if (!Array.isArray(input.edges)) {
    problems.push(diag('E_SCHEMA', 'edges must be an array.'))
  }
  if (problems.some((p) => p.severity === 'error')) {
    return { ok: false, outcome: { valid: false, diagnostics: orderDiagnostics(problems) } }
  }

  const rawNodes = input.nodes as unknown[]
  const rawEdges = input.edges as unknown[]

  if (rawNodes.length > WORKFLOW_LIMITS.maxNodes) {
    problems.push(
      diag('E_BOUNDS', `A workflow is capped at ${WORKFLOW_LIMITS.maxNodes} nodes (got ${rawNodes.length}).`),
    )
  }
  if (rawEdges.length > WORKFLOW_LIMITS.maxEdgesTotal) {
    problems.push(
      diag('E_BOUNDS', `A workflow is capped at ${WORKFLOW_LIMITS.maxEdgesTotal} edges (got ${rawEdges.length}).`),
    )
  }

  // --- Nodes ---------------------------------------------------------------
  const nodes: StudioGraphNode[] = []
  const nodeIds = new Set<string>()
  for (const raw of rawNodes) {
    if (!isPlainObject(raw)) {
      problems.push(diag('E_SCHEMA', 'Every node must be an object.'))
      continue
    }
    const unk = unknownKeys(raw, ['nodeId', 'nodeType', 'contractVersion', 'config', 'position'])
    for (const k of unk) {
      problems.push(diag('E_SCHEMA', `Unknown node field "${clip(k)}" is not allowed (graphs carry data only).`))
    }
    const nodeId = raw.nodeId
    if (typeof nodeId !== 'string' || !NODE_ID_RE.test(nodeId)) {
      problems.push(diag('E_SCHEMA', 'Every node needs a short id (letters, numbers, "-" or "_"; max 32 characters).'))
      continue
    }
    if (nodeIds.has(nodeId)) {
      problems.push(diag('E_SCHEMA', `Duplicate node id "${nodeId}".`))
      continue
    }
    nodeIds.add(nodeId)

    const nodeType = raw.nodeType
    if (typeof nodeType !== 'string' || nodeType.length === 0 || nodeType.length > 64) {
      problems.push(diag('E_SCHEMA', `Node "${nodeId}" needs a valid nodeType.`))
      continue
    }

    const contractVersion = raw.contractVersion
    if (typeof contractVersion !== 'number' || !Number.isInteger(contractVersion) || contractVersion < 1) {
      problems.push(diag('E_SCHEMA', `Node "${nodeId}" needs an integer contractVersion.`))
      continue
    }

    // Config: bounded flat string map. Executable authority cannot hide here.
    const config: Record<string, string> = {}
    const rawConfig = raw.config
    if (rawConfig === undefined) {
      // absent config is fine
    } else if (!isPlainObject(rawConfig)) {
      problems.push(diag('E_SCHEMA', `Node "${nodeId}" config must be an object of bounded string values.`))
      continue
    } else {
      let configValid = true
      for (const key of ownKeys(rawConfig)) {
        if (!CONFIG_KEY_RE.test(key) || FORBIDDEN_CONFIG_KEYS.has(key)) {
          problems.push(diag('E_SCHEMA', `Node "${nodeId}" has an unsafe configuration key.`))
          configValid = false
          continue
        }
        const value = rawConfig[key]
        if (typeof value !== 'string') {
          problems.push(
            diag('E_SCHEMA', `Node "${nodeId}" configuration "${key}" must be a string (graphs carry data only).`),
          )
          configValid = false
          continue
        }
        if (value.length > WORKFLOW_LIMITS.configTextMaxChars) {
          problems.push(
            diag(
              'E_BOUNDS',
              `Node "${nodeId}" configuration "${key}" exceeds ${WORKFLOW_LIMITS.configTextMaxChars} characters.`,
            ),
          )
          configValid = false
          continue
        }
        // Explicit safe assignment — never a spread of untrusted input.
        config[key] = value
      }
      if (!configValid) continue
    }

    // Position: presentation-only, bounded finite numbers.
    let position: { x: number; y: number } | undefined
    const rawPosition = raw.position
    if (rawPosition !== undefined) {
      if (!isPlainObject(rawPosition) || unknownKeys(rawPosition, ['x', 'y']).length > 0) {
        problems.push(diag('E_SCHEMA', `Node "${nodeId}" position must be an object with x and y numbers only.`))
        continue
      }
      const { x, y } = rawPosition as { x: unknown; y: unknown }
      const finiteX = typeof x === 'number' && Number.isFinite(x)
      const finiteY = typeof y === 'number' && Number.isFinite(y)
      if (!finiteX || !finiteY || unknownKeys(rawPosition, ['x', 'y']).length > 0) {
        problems.push(diag('E_SCHEMA', `Node "${nodeId}" position must be an object with finite x and y numbers only.`))
        continue
      }
      if (
        Math.abs(x as number) > WORKFLOW_LIMITS.positionMaxAbs ||
        Math.abs(y as number) > WORKFLOW_LIMITS.positionMaxAbs
      ) {
        problems.push(diag('E_BOUNDS', `Node "${nodeId}" position coordinates exceed the ${WORKFLOW_LIMITS.positionMaxAbs} bound.`))
        continue
      }
      position = { x: x as number, y: y as number }
    }

    nodes.push({ nodeId, nodeType, contractVersion, config, ...(position ? { position } : {}) })
  }

  // --- Edges ---------------------------------------------------------------
  const edges: StudioGraphEdge[] = []
  const edgeIds = new Set<string>()
  for (const raw of rawEdges) {
    if (!isPlainObject(raw)) {
      problems.push(diag('E_SCHEMA', 'Every edge must be an object.'))
      continue
    }
    const unk = unknownKeys(raw, ['edgeId', 'from', 'to'])
    for (const k of unk) {
      problems.push(diag('E_SCHEMA', `Unknown edge field "${clip(k)}" is not allowed.`))
    }
    const edgeId = raw.edgeId
    if (typeof edgeId !== 'string' || !EDGE_ID_RE.test(edgeId)) {
      problems.push(diag('E_SCHEMA', 'Every edge needs a short id (letters, numbers, "-" or "_"; max 32 characters).'))
      continue
    }
    if (edgeIds.has(edgeId)) {
      problems.push(diag('E_SCHEMA', `Duplicate edge id "${edgeId}".`))
      continue
    }
    const from = parseEndpoint(raw.from)
    const to = parseEndpoint(raw.to)
    if (!from || !to) {
      problems.push(diag('E_SCHEMA', `Edge "${edgeId}" needs "from" and "to" endpoints with nodeId and port.`))
      continue
    }
    edgeIds.add(edgeId)
    edges.push({ edgeId, from, to })
  }

  if (problems.some((p) => p.severity === 'error')) {
    return { ok: false, outcome: { valid: false, diagnostics: orderDiagnostics(problems) } }
  }

  // --- Stage 2: registry + contract-version resolution ---------------------
  for (const node of nodes) {
    const proposed = findProposedNodeType(node.nodeType)
    if (proposed) {
      problems.push(
        diag(
          'E_UNKNOWN_NODE',
          `Node type "${node.nodeType}" is a documented proposal, not an executable node: ${proposed.reason}`,
          { nodeId: node.nodeId },
        ),
      )
      continue
    }
    const contract = registry.resolve(node.nodeType, node.contractVersion)
    if (!contract) {
      const known = registry.contracts.some((c) => c.nodeType === node.nodeType)
      problems.push(
        diag(
          'E_UNKNOWN_NODE',
          known
            ? `Node "${node.nodeType}" contract version ${node.contractVersion} is not supported (supported: version ${NODE_CONTRACT_VERSION}).`
            : `Unknown node type "${node.nodeType}" — it is not part of the supported node catalogue and is never substituted.`,
          { nodeId: node.nodeId },
        ),
      )
    }
  }

  if (problems.some((p) => p.severity === 'error')) {
    return { ok: false, outcome: { valid: false, diagnostics: orderDiagnostics(problems) } }
  }

  const graph: StudioWorkflowGraph = {
    schemaVersion: WORKFLOW_LIMITS.schemaVersion,
    nodes,
    edges,
  }
  return { ok: true, graph }
}

function parseEndpoint(raw: unknown): { nodeId: string; port: string } | null {
  if (!isPlainObject(raw)) return null
  if (unknownKeys(raw, ['nodeId', 'port']).length > 0) return null
  const { nodeId, port } = raw as { nodeId: unknown; port: unknown }
  if (typeof nodeId !== 'string' || !NODE_ID_RE.test(nodeId)) return null
  if (typeof port !== 'string' || !PORT_ID_RE.test(port)) return null
  return { nodeId, port }
}

/** Deterministic diagnostic order: stage order is implied by insertion;
 *  this trims and freezes the array (same input ⇒ same output). */
export function orderDiagnostics(diagnostics: StudioDiagnostic[]): StudioDiagnostic[] {
  return diagnostics.slice()
}

function clip(text: string, max = 40): string {
  const t = text.trim()
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`
}
