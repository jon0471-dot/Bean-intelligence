/**
 * BEAN Intelligence — M41 mission task-graph (DAG) kernel (pure).
 *
 * Deterministic dependency mathematics for mission task graphs:
 *  - structural validation (ids, deps, cycles, bounds) BEFORE any execution;
 *  - stable topological order (execution can never start a task before its
 *    dependencies are verified);
 *  - the ready set (dependencies satisfied → schedulable, bounded parallel
 *    lanes; independent tasks may run concurrently, dependent tasks never do);
 *  - skip propagation (a failed/skipped dependency skips everything
 *    downstream — an unexecuted task is never presented as executed);
 *  - the deliverable chain (mission success stands on the deliverable
 *    task — a failed side task can make the mission partial, never fake
 *    the deliverable).
 *
 * PURE module — string/array math only. No DB, no I/O.
 */

import {
  MISSION_LIMITS,
  MISSION_TASK_KINDS,
  MissionContractError,
  type MissionTaskSpec,
  type MissionTaskStatus,
} from './types'

// ---------------------------------------------------------------------------
// Structural validation
// ---------------------------------------------------------------------------

export interface GraphValidation {
  valid: boolean
  problems: string[]
}

/** Validate a task list as a well-formed executable DAG. Never throws for
 *  content problems — returns the reasons so the planner/refuser can report
 *  them honestly. Throws only on contract-level programmer errors. */
export function validateTaskGraph(tasks: readonly MissionTaskSpec[]): GraphValidation {
  const problems: string[] = []
  if (tasks.length === 0) problems.push('A mission needs at least one task.')
  if (tasks.length > MISSION_LIMITS.maxTasks) {
    problems.push(`A mission is capped at ${MISSION_LIMITS.maxTasks} tasks (got ${tasks.length}).`)
  }
  const byId = new Map<string, MissionTaskSpec>()
  for (const t of tasks) {
    if (byId.has(t.id)) problems.push(`Duplicate task id "${t.id}".`)
    byId.set(t.id, t)
    if (!(MISSION_TASK_KINDS as readonly string[]).includes(t.kind)) {
      problems.push(`Task "${t.id}" has an unknown kind "${t.kind}".`)
    }
    if (t.dependsOn.length > MISSION_LIMITS.maxDependenciesPerTask) {
      problems.push(`Task "${t.id}" exceeds ${MISSION_LIMITS.maxDependenciesPerTask} dependencies.`)
    }
  }
  for (const t of tasks) {
    for (const dep of t.dependsOn) {
      if (!byId.has(dep)) problems.push(`Task "${t.id}" depends on unknown task "${dep}".`)
    }
  }
  // Cycle detection: iterative DFS with three-color marking.
  const WHITE = 0
  const GRAY = 1
  const BLACK = 2
  const color = new Map<string, number>()
  for (const t of tasks) color.set(t.id, WHITE)
  for (const t of tasks) {
    if (color.get(t.id) !== WHITE) continue
    const stack: Array<{ id: string; i: number }> = [{ id: t.id, i: 0 }]
    color.set(t.id, GRAY)
    while (stack.length > 0) {
      const top = stack[stack.length - 1]
      const node = byId.get(top.id)
      const deps = node?.dependsOn ?? []
      if (top.i >= deps.length) {
        color.set(top.id, BLACK)
        stack.pop()
        continue
      }
      const dep = deps[top.i++]
      if (!byId.has(dep)) continue // already reported as unknown
      const c = color.get(dep) ?? WHITE
      if (c === GRAY) {
        problems.push(`Dependency cycle detected through "${dep}" (task "${top.id}" is part of it).`)
      } else if (c === WHITE) {
        color.set(dep, GRAY)
        stack.push({ id: dep, i: 0 })
      }
    }
  }
  return { valid: problems.length === 0, problems }
}

/** Guarded validation for internal callers: throws on an invalid graph. */
export function requireValidTaskGraph(tasks: readonly MissionTaskSpec[]): void {
  const v = validateTaskGraph(tasks)
  if (!v.valid) throw new MissionContractError(v.problems.join(' '))
}

// ---------------------------------------------------------------------------
// Ordering + scheduling
// ---------------------------------------------------------------------------

/** Kahn topological order (stable: preserves the spec's task order among
 *  equals). Returns null when the graph contains a cycle. */
export function topologicalOrder(tasks: readonly MissionTaskSpec[]): string[] | null {
  const indegree = new Map<string, number>()
  const dependents = new Map<string, string[]>()
  for (const t of tasks) {
    indegree.set(t.id, t.dependsOn.length)
    for (const dep of t.dependsOn) {
      const list = dependents.get(dep) ?? []
      list.push(t.id)
      dependents.set(dep, list)
    }
  }
  const order: string[] = []
  const queue = tasks.filter((t) => (indegree.get(t.id) ?? 0) === 0).map((t) => t.id)
  while (queue.length > 0) {
    const id = queue.shift() as string
    order.push(id)
    for (const dep of dependents.get(id) ?? []) {
      const d = (indegree.get(dep) ?? 1) - 1
      indegree.set(dep, d)
      if (d === 0) queue.push(dep)
    }
  }
  return order.length === tasks.length ? order : null
}

export interface TaskRuntimeState {
  taskId: string
  status: MissionTaskStatus
}

const DONE_LIKE: readonly MissionTaskStatus[] = ['done']

/** Tasks whose dependencies are ALL done and that are still schedulable
 *  (pending/ready). Dependent tasks NEVER run before their dependencies are
 *  verified — ordering is enforced by data, not by convention. */
export function readyTaskIds(
  tasks: readonly MissionTaskSpec[],
  states: ReadonlyMap<string, MissionTaskStatus>,
): string[] {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const ready: string[] = []
  for (const t of tasks) {
    const status = states.get(t.id) ?? 'pending'
    if (status !== 'pending' && status !== 'ready') continue
    const depsSatisfied = t.dependsOn.every((dep) => {
      const depStatus = states.get(dep)
      return depStatus === 'done' || (DONE_LIKE as readonly string[]).includes(depStatus ?? '')
    })
    if (depsSatisfied) ready.push(t.id)
  }
  void byId
  return ready
}

/** Direct dependents of a task (consumers of its verified output). */
export function dependentsOf(tasks: readonly MissionTaskSpec[], taskId: string): string[] {
  return tasks.filter((t) => t.dependsOn.includes(taskId)).map((t) => t.id)
}

/** All downstream tasks reachable from the given root (inclusive). */
export function downstreamOf(tasks: readonly MissionTaskSpec[], rootIds: readonly string[]): Set<string> {
  const out = new Set<string>(rootIds)
  let changed = true
  while (changed) {
    changed = false
    for (const t of tasks) {
      if (out.has(t.id)) continue
      if (t.dependsOn.some((d) => out.has(d))) {
        out.add(t.id)
        changed = true
      }
    }
  }
  return out
}

/** Tasks that must be skipped because an upstream dependency failed or was
 *  skipped. Deterministic, transitive, and NEVER includes done/running
 *  tasks (skip propagation only reaches work that has not executed). */
export function skippedDownstream(
  tasks: readonly MissionTaskSpec[],
  states: ReadonlyMap<string, MissionTaskStatus>,
): string[] {
  const failedRoots = tasks
    .filter((t) => {
      const s = states.get(t.id)
      return s === 'failed' || s === 'skipped' || s === 'cancelled'
    })
    .map((t) => t.id)
  if (failedRoots.length === 0) return []
  const skipSet = downstreamOf(tasks, failedRoots)
  return tasks
    .filter((t) => {
      if (!skipSet.has(t.id)) return false
      const s = states.get(t.id) ?? 'pending'
      return s === 'pending' || s === 'ready'
    })
    .map((t) => t.id)
}

/** The deliverable chain: the deliverable task plus everything it depends
 *  on (transitively). Mission success is decided HERE — side-task failures
 *  make the mission partial; a deliverable-chain failure makes it failed. */
export function deliverableChain(tasks: readonly MissionTaskSpec[], deliverableTaskId: string): Set<string> {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const chain = new Set<string>()
  const stack = [deliverableTaskId]
  while (stack.length > 0) {
    const id = stack.pop() as string
    if (chain.has(id)) continue
    chain.add(id)
    const t = byId.get(id)
    if (t) for (const dep of t.dependsOn) stack.push(dep)
  }
  return chain
}

export interface MissionOutcomeDecision {
  outcome: 'completed' | 'completed_partial' | 'failed' | 'incomplete'
  /** Customer-safe reason grounded in actual task states. */
  reason: string
}

/** Decide the honest mission outcome from ACTUAL task states (pure — the
 *  executor calls this only after the graph reaches a terminal shape).
 *  A failed subtask is never presented as successful: deliverable-chain
 *  failure = failed; side failures = completed_partial; all done = completed. */
export function decideMissionOutcome(
  tasks: readonly MissionTaskSpec[],
  states: ReadonlyMap<string, MissionTaskStatus>,
  deliverableTaskId: string,
): MissionOutcomeDecision {
  const chain = deliverableChain(tasks, deliverableTaskId)
  const statusOf = (id: string) => states.get(id) ?? 'pending'
  const deliverableStatus = statusOf(deliverableTaskId)
  const chainFailure = [...chain].find((id) => ['failed', 'skipped', 'cancelled'].includes(statusOf(id)))
  if (deliverableStatus !== 'done' || chainFailure) {
    return {
      outcome: 'failed',
      reason: chainFailure
        ? `The deliverable chain did not complete: task "${chainFailure}" is ${statusOf(chainFailure)}.`
        : `The deliverable task "${deliverableTaskId}" did not complete (status: ${deliverableStatus}).`,
    }
  }
  const sideFailures = tasks.filter((t) => {
    if (chain.has(t.id)) return false
    const s = statusOf(t.id)
    return s === 'failed' || s === 'skipped' || s === 'cancelled'
  })
  const unfinished = tasks.filter((t) => {
    if (chain.has(t.id)) return false
    return !['done', 'failed', 'skipped', 'cancelled'].includes(statusOf(t.id))
  })
  if (unfinished.length > 0) {
    return {
      outcome: 'incomplete',
      reason: `${unfinished.length} task(s) outside the deliverable chain are still active.`,
    }
  }
  if (sideFailures.length > 0) {
    return {
      outcome: 'completed_partial',
      reason: `The deliverable is complete and verified, but ${sideFailures.length} supporting task(s) did not finish (${sideFailures
        .map((t) => `"${t.id}" ${statusOf(t.id)}`)
        .join(', ')}).`,
    }
  }
  return { outcome: 'completed', reason: 'Every task completed and verified.' }
}

/** Bounded parallel lanes: take at most `cap` ids from a ready list,
 *  preserving the spec's order (deterministic scheduling). */
export function takeParallelBatch(readyIds: readonly string[], cap: number): string[] {
  const bounded = Math.min(Math.max(cap, 1), MISSION_LIMITS.maxParallelTasks)
  return readyIds.slice(0, bounded)
}
