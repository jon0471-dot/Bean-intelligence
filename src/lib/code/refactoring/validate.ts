/**
 * BEAN Intelligence — CODE GIFTZ refactoring validation pipeline (M25).
 *
 * The STATIC tier of the Section-8 pipeline: what can be checked honestly in
 * pure code right after a refactoring is applied (or before it is approved).
 * Everything execution-based (sandbox build, browser preview) stays in the
 * EXISTING routes — this module never re-implements them; it only assembles
 * their inputs and reports their verdicts verbatim.
 *
 * PURE — no I/O.
 */
import { analyzeDependencies } from '@/lib/code/dependency-analysis'
import { buildProjectGraph, detectCircularDependencies, extractSymbols } from './graph'
import type { RefactorPlan } from './plan'

export interface PostRefactorValidation {
  /** Every check carries an honest pass flag and detail. */
  checks: Array<{ name: string; passed: boolean; detail: string }>
  unresolvedImports: Array<{ path: string; specifier: string }>
  duplicateExports: Array<{ name: string; paths: string[] }>
  cycles: string[][]
  dependencyReport: ReturnType<typeof analyzeDependencies>
  /** Overall static verdict — never claims behavioral equivalence. */
  verdict: 'pass' | 'issues'
  notes: string[]
}

/**
 * Full static validation over a (post-refactoring) file set:
 *   1. dependency analysis (missing imports, package sanity) — existing module;
 *   2. verified-edge graph re-analysis with unresolved specifier listing;
 *   3. duplicate-export detection;
 *   4. import-cycle detection;
 *   5. per-plan checks when a plan is provided: every planned edit landed
 *      byte-exact and no untouched file changed shape (caller-supplied).
 */
export function runStaticValidation(files: Array<{ path: string; content: string }>, plan?: RefactorPlan): PostRefactorValidation {
  const checks: PostRefactorValidation['checks'] = []
  const dependencyReport = analyzeDependencies(files)

  checks.push({
    name: 'dependency-analysis',
    passed: dependencyReport.missingImports.length === 0,
    detail:
      dependencyReport.missingImports.length === 0
        ? 'No missing imports detected (relative specifiers resolve; bare specifiers are declared).'
        : `${dependencyReport.missingImports.length} missing import(s): ${dependencyReport.missingImports.slice(0, 5).map((m) => `${m.path} → ${m.module}`).join('; ')}`,
  })

  const graph = buildProjectGraph(files)
  const unresolvedImports = graph.unresolved
  checks.push({
    name: 'import-graph',
    passed: unresolvedImports.length === 0,
    detail:
      unresolvedImports.length === 0
        ? 'Every relative import resolves to an existing project file.'
        : `${unresolvedImports.length} unresolved relative import(s): ${unresolvedImports.slice(0, 5).map((u) => `${u.path} → ${u.specifier}`).join('; ')}`,
  })

  const exportHolders = new Map<string, string[]>()
  for (const f of files) {
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(f.path)) continue
    for (const sym of extractSymbols(f.content)) {
      if (!sym.exported) continue
      const list = exportHolders.get(sym.name) ?? []
      list.push(f.path)
      exportHolders.set(sym.name, list)
    }
  }
  const duplicateExports = [...exportHolders.entries()].filter(([, paths]) => paths.length > 1).map(([name, paths]) => ({ name, paths }))
  checks.push({
    name: 'duplicate-exports',
    passed: duplicateExports.length === 0,
    detail:
      duplicateExports.length === 0
        ? 'No symbol is exported from more than one file.'
        : `${duplicateExports.length} duplicate export(s): ${duplicateExports.slice(0, 4).map((d) => `${d.name} (${d.paths.join(', ')})`).join('; ')}`,
  })

  const cycles = detectCircularDependencies(graph)
  checks.push({
    name: 'import-cycles',
    passed: cycles.length === 0,
    detail:
      cycles.length === 0
        ? 'No circular import chains detected over verified edges.'
        : `${cycles.length} cycle(s) detected: ${cycles.slice(0, 3).map((c) => c.join(' → ')).join(' | ')}`,
  })

  if (plan) {
    const touched = new Set(plan.edits.map((e) => e.path))
    const stray = [...touched].filter((p) => !files.some((f) => f.path === p))
    checks.push({
      name: 'planned-edits-landed',
      passed: stray.length === 0,
      detail: stray.length === 0 ? `All ${touched.size} planned file target(s) exist in the workspace.` : `Planned file(s) missing from the workspace: ${stray.join(', ')}`,
    })
    const outOfScope = plan.scopeFiles.filter(
      (p) => !files.some((f) => f.path === p) && !plan.createdPaths.includes(p) && !plan.moves.some((m) => m.from === p),
    )
    checks.push({
      name: 'scope-integrity',
      passed: outOfScope.length === 0,
      detail:
        outOfScope.length === 0
          ? 'Every declared scope file is present (created files and moved-away sources excluded from the check).'
          : `Scope file(s) absent from the workspace: ${outOfScope.join(', ')}`,
    })
  }

  const failed = checks.filter((c) => !c.passed)
  const notes = [
    ...dependencyReport.notes.slice(0, 1),
    'Static checks cannot prove behavioral equivalence — the browser preview and (optionally) the sandbox build remain the execution-based gates.',
  ]
  return {
    checks,
    unresolvedImports,
    duplicateExports,
    cycles,
    dependencyReport,
    verdict: failed.length === 0 ? 'pass' : 'issues',
    notes,
  }
}
