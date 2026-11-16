/**
 * BEAN Intelligence — CODE GIFTZ refactoring execution (M25).
 *
 * Rides the EXISTING M23 operation ledger (`CodeFileOperation`, kind
 * 'refactor'): the same plan-hash confirmation binding, the same status
 * lifecycle (awaiting_confirmation → executed | cancelled | failed | stale),
 * the same replay protection. What refactor execution adds:
 *   - CONTENT-level staleness binding: every edit carries the full `before`
 *     content and the plan records each touched file's SHA-256 at plan time;
 *     execution re-validates ALL of them against the live workspace before
 *     anything is written (a concurrent chat edit invalidates the plan);
 *   - ONE atomic transaction for the whole multi-file mutation (creates,
 *     content rewrites, path moves) — any failure rolls back completely and
 *     the operation is recorded failed with NOTHING applied;
 *   - exactly ONE coherent version snapshot (kind 'refactor') AFTER the
 *     verified transaction — a failed execution never snapshots;
 *   - post-execution verification: content preservation for moved files,
 *     re-analysis of the dependency graph over the new file set, honest
 *     unresolved-import and duplicate-export counts.
 *
 * SERVER-ONLY. The Prisma boundary is the only side effect.
 */
import { db } from '@/lib/db'
import { logger } from '@/lib/observability/logger'
import { FileOpError } from '@/lib/code/file-ops/types'
import { snapshotProjectVersion } from '@/lib/code/versioning'
import { buildProjectGraph } from './graph'
import { refactorPlanHashOf, validateRefactorPlan, type RefactorPlan, type RefactorTurnPayload } from './plan'
import { extractSymbols } from './graph'

export interface RefactorResult {
  opId: string
  kind: RefactorPlan['kind']
  status: 'executed'
  applied: Array<{ path: string; action: 'created' | 'modified' | 'moved' | 'moved+modified' }>
  failed: Array<{ path: string; reason: string }>
  versionSeq: number | null
  verification: {
    contentsPreserved: boolean
    unresolvedImports: number
    duplicateExports: Array<{ name: string; paths: string[] }>
    integrityDetail: string
  }
  replayed?: boolean
  postGraph: { files: number; verifiedEdges: number; unresolvedEdges: number }
}

function parseRefactorPlan(json: string): RefactorPlan {
  const parsed = JSON.parse(json) as RefactorPlan
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.edits) || parsed.planVersion !== 1) {
    throw new FileOpError('INVALID', 'The stored refactoring plan is unreadable — refusing to execute.')
  }
  return parsed
}

async function loadOperation(opId: string, projectId: string) {
  const row = await db.codeFileOperation.findUnique({ where: { id: opId } })
  if (!row || row.projectId !== projectId) {
    throw new FileOpError('NOT_FOUND', 'This refactoring operation was not found for this project.')
  }
  return row
}

/** Create (or reuse) the awaiting-confirmation ledger row for a plan. */
export async function createRefactorOperation(projectId: string, plan: RefactorPlan): Promise<{ opId: string; planHash: string; reused: boolean }> {
  const planHash = refactorPlanHashOf(plan)
  const existing = await db.codeFileOperation.findFirst({
    where: { projectId, planHash, status: 'awaiting_confirmation' },
  })
  if (existing) return { opId: existing.id, planHash, reused: true }
  const row = await db.codeFileOperation.create({
    data: {
      projectId,
      kind: 'refactor',
      status: 'awaiting_confirmation',
      planJson: JSON.stringify(plan),
      planHash,
    },
  })
  return { opId: row.id, planHash, reused: false }
}

/**
 * Execute a confirmed refactoring atomically. Confirmation semantics mirror
 * M23 exactly: execution only through the confirm endpoint bound to the
 * planHash; replay returns the recorded result verbatim; stale plans are
 * refused with nothing applied.
 */
export async function executeRefactorOperation(opId: string, projectId: string): Promise<RefactorResult> {
  const row = await loadOperation(opId, projectId)
  if (row.kind !== 'refactor') {
    throw new FileOpError('INVALID', 'This operation is not a refactoring.')
  }
  const plan = parseRefactorPlan(row.planJson)

  // Stored-plan integrity: the hash the confirmation was bound to must still
  // match the stored bytes.
  if (refactorPlanHashOf(plan) !== row.planHash) {
    await db.codeFileOperation.update({
      where: { id: row.id },
      data: { status: 'failed', resultJson: JSON.stringify({ error: 'stored plan integrity mismatch' }) },
    })
    throw new FileOpError('INVALID', 'The stored refactoring plan does not match its confirmation hash — execution refused.')
  }

  // Replay protection: an executed operation replays its recorded result.
  if (row.status === 'executed') {
    const recorded = row.resultJson ? (JSON.parse(row.resultJson) as RefactorResult) : null
    if (recorded) return { ...recorded, replayed: true }
    throw new FileOpError('INVALID', 'The operation is already recorded as executed but its result is unreadable.')
  }
  if (row.status === 'cancelled') {
    throw new FileOpError('INVALID', 'This refactoring was cancelled and cannot be executed. Ask again to re-plan.')
  }
  if (row.status === 'failed' || row.status === 'stale') {
    throw new FileOpError('INVALID', 'This refactoring already failed. Ask again to re-plan with the current project state.')
  }

  const files = await db.codeFile.findMany({ where: { projectId }, orderBy: { path: 'asc' } })
  const fileRows = files.map((f) => ({ path: f.path, content: f.content }))

  // Content-level staleness + precondition validation against the LIVE set.
  let safety
  try {
    safety = validateRefactorPlan(plan, fileRows)
  } catch (e) {
    await db.codeFileOperation.update({ where: { id: row.id }, data: { status: 'failed', resultJson: JSON.stringify({ error: String(e) }) } }).catch(() => undefined)
    throw new FileOpError('INVALID', `The refactoring plan could not be validated: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (!safety.ok) {
    const status = safety.stale.length > 0 ? 'stale' : 'failed'
    await db.codeFileOperation
      .update({ where: { id: row.id }, data: { status, resultJson: JSON.stringify({ error: [...safety.stale, ...safety.conflicts, ...safety.errors].join(' ') }) } })
      .catch(() => undefined)
    throw new FileOpError(
      safety.stale.length > 0 ? 'STALE' : 'CONFLICT',
      `The refactoring plan no longer matches the project (${[...safety.stale, ...safety.conflicts, ...safety.symbolCollisions, ...safety.errors][0]}) — NOTHING was applied. Ask again to re-plan.`,
    )
  }

  // Hash the pre-execution content of every moved/modified source for the
  // content-preservation check.
  const beforeByPath = new Map(fileRows.map((f) => [f.path, f.content] as const))

  let versionSeq: number | null = null
  try {
    await db.$transaction(async (tx) => {
      // Re-validate inside the transaction (SQLite + connection_limit=1 makes
      // this race-safe) — the same discipline as M23's executor.
      const currentRows = await tx.codeFile.findMany({ where: { projectId } })
      const currentByPath = new Map(currentRows.map((f) => [f.path, f] as const))
      const currentLower = new Map(currentRows.map((f) => [f.path.toLowerCase(), f] as const))

      // Creates.
      for (const edit of plan.edits) {
        if (edit.changeType !== 'create') continue
        if (currentByPath.has(edit.path) || currentLower.has(edit.path.toLowerCase())) {
          throw new FileOpError('CONFLICT', `${edit.path} was created concurrently — transaction rolled back, nothing was applied.`)
        }
        await tx.codeFile.create({ data: { projectId, path: edit.path, content: edit.after, origin: 'modified' } })
      }
      // Content rewrites (modify) — verify `before` matches the live row.
      for (const edit of plan.edits) {
        if (edit.changeType !== 'modify' || edit.before === null) continue
        const row0 = currentByPath.get(edit.path) ?? currentLower.get(edit.path.toLowerCase())
        if (!row0) throw new FileOpError('STALE', `${edit.path} disappeared while executing — transaction rolled back, nothing was applied.`)
        if (row0.content !== edit.before) throw new FileOpError('STALE', `${edit.path} changed concurrently — transaction rolled back, nothing was applied.`)
        await tx.codeFile.update({ where: { id: row0.id }, data: { content: edit.after } })
      }
      // Moves and move-content (path + possibly rewritten content).
      const moveContentByFrom = new Map(
        plan.edits.filter((e) => e.changeType === 'move-content' && e.fromPath).map((e) => [e.fromPath as string, e] as const),
      )
      const moveTargets = new Set(plan.moves.map((m) => m.to))
      for (const move of plan.moves) {
        const row0 = currentByPath.get(move.from) ?? currentLower.get(move.from.toLowerCase())
        if (!row0) throw new FileOpError('STALE', `${move.from} disappeared while executing — transaction rolled back, nothing was applied.`)
        if (row0.path !== move.from) throw new FileOpError('STALE', `${move.from} changed case concurrently — transaction rolled back.`)
        const taken = currentLower.get(move.to.toLowerCase())
        if (taken && taken.id !== row0.id && !moveTargets.has(taken.path)) {
          throw new FileOpError('CONFLICT', `${move.to} was created concurrently — transaction rolled back, nothing was applied.`)
        }
        const edit = moveContentByFrom.get(move.from)
        if (edit) {
          if (row0.content !== edit.before) throw new FileOpError('STALE', `${move.from} changed concurrently — transaction rolled back, nothing was applied.`)
          await tx.codeFile.update({ where: { id: row0.id }, data: { path: move.to, content: edit.after } })
        } else {
          await tx.codeFile.update({ where: { id: row0.id }, data: { path: move.to } })
        }
      }

      // M26 (audit R-6): the version snapshot is created INSIDE the
      // transaction — a crash between commit and snapshot previously left a
      // mutated workspace with NO restore point. At the 200-version history
      // cap the snapshot is skipped gracefully (disclosed via versionSeq null
      // — the same unversioned-mutation state as before, but never silent and
      // the workspace is never bricked); ANY other snapshot failure rolls the
      // whole refactor back.
      let snapshotResult: Awaited<ReturnType<typeof snapshotProjectVersion>> | null = null
      try {
        snapshotResult = await snapshotProjectVersion(
          {
            projectId,
            kind: 'refactor',
            summary: `${plan.title} — ${plan.edits.length} file(s)${plan.moves.length > 0 ? `, ${plan.moves.length} move(s)` : ''}`,
          },
          tx,
        )
      } catch (snapshotError) {
        const isCap = snapshotError instanceof Error && /history limit/i.test(snapshotError.message)
        if (!isCap) throw snapshotError
        logger.warn('giftz.refactor_snapshot_skipped_at_cap', { projectId, opId })
      }
      versionSeq = snapshotResult?.version?.seq ?? null
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await db.codeFileOperation
      .update({ where: { id: row.id }, data: { status: 'failed', resultJson: JSON.stringify({ error: message }) } })
      .catch(() => undefined)
    throw e instanceof FileOpError ? e : new FileOpError('INVALID', `The refactoring failed and was rolled back completely: ${message}`)
  }

  // ---- post-execution verification -----------------------------------------
  const afterRows = await db.codeFile.findMany({ where: { projectId }, orderBy: { path: 'asc' } })
  const afterFiles = afterRows.map((f) => ({ path: f.path, content: f.content }))
  const afterByPath = new Map(afterFiles.map((f) => [f.path, f.content] as const))

  let contentsPreserved = true
  const failed: RefactorResult['failed'] = []
  for (const move of plan.moves) {
    const before = beforeByPath.get(move.from)
    const now = afterByPath.get(move.to)
    // For move-content edits the content is EXPECTED to differ (specifier
    // rewrites) — preservation applies to pure moves only.
    const edit = plan.edits.find((e) => e.fromPath === move.from)
    if (!edit && before !== undefined && now !== before) {
      contentsPreserved = false
      failed.push({ path: move.to, reason: 'A moved file\'s content no longer matches its pre-operation hash.' })
    }
    if (edit && now !== edit.after) {
      contentsPreserved = false
      failed.push({ path: move.to, reason: 'A move-content file does not match its planned content.' })
    }
  }
  for (const edit of plan.edits) {
    const now = afterByPath.get(edit.path)
    if (now !== edit.after) {
      contentsPreserved = false
      failed.push({ path: edit.path, reason: 'A planned edit does not match the persisted content.' })
    }
  }

  const postGraph = buildProjectGraph(afterFiles)
  const verifiedEdges = [...postGraph.nodes.values()].flatMap((n) => n.imports).filter((i) => i.verified).length
  const unresolvedEdges = [...postGraph.nodes.values()].flatMap((n) => n.imports).filter((i) => !i.verified && i.specifier.startsWith('.')).length

  // Duplicate exported declarations across the new set (created files are the
  // usual source).
  const exportHolders = new Map<string, string[]>()
  for (const f of afterFiles) {
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(f.path)) continue
    for (const sym of extractSymbols(f.content)) {
      if (!sym.exported) continue
      const list = exportHolders.get(sym.name) ?? []
      list.push(f.path)
      exportHolders.set(sym.name, list)
    }
  }
  const duplicateExports = [...exportHolders.entries()].filter(([, paths]) => paths.length > 1).map(([name, paths]) => ({ name, paths }))

  const result: RefactorResult = {
    opId,
    kind: plan.kind,
    status: 'executed',
    applied: plan.edits.map((e) => ({
      path: e.path,
      action: e.changeType === 'create' ? 'created' : e.changeType === 'move-content' ? 'moved+modified' : e.changeType === 'modify' ? 'modified' : 'moved',
    })),
    failed,
    versionSeq,
    verification: {
      contentsPreserved,
      unresolvedImports: unresolvedEdges,
      duplicateExports,
      integrityDetail: contentsPreserved
        ? `All ${plan.edits.length} planned mutation(s) verified in the persisted workspace; dependency graph re-analyzed (${verifiedEdges} verified import edge(s), ${unresolvedEdges} unresolved relative specifier(s)).`
        : 'Post-execution verification FAILED — inspect the project and use version history to restore.',
    },
    postGraph: { files: afterFiles.length, verifiedEdges, unresolvedEdges },
  }

  await db.codeFileOperation.update({
    where: { id: row.id },
    data: { status: 'executed', executedAt: new Date(), resultJson: JSON.stringify(result) },
  })
  return result
}

// ---- chat-surface payload + deterministic text ---------------------------------

export function refactorAssistantText(payload: RefactorTurnPayload): string {
  switch (payload.status) {
    case 'awaiting_confirmation':
      return `Planned refactoring — ${payload.title ?? payload.kind}. ${(payload.steps ?? []).join(' ')} ${payload.consequence ?? ''} Nothing has been changed yet — review the diff and confirm below to execute.`
    case 'executed': {
      const r = payload.result
      const n = r?.applied.length ?? 0
      const version = payload.versionSeq ? ` Version v${payload.versionSeq} recorded.` : ''
      const warn = r && r.failed.length > 0 ? ` WARNING: ${r.failed[0].reason}` : ''
      const unresolved = r && r.verification.unresolvedImports > 0 ? ` ${r.verification.unresolvedImports} unresolved relative import(s) remain in the project.` : ''
      return `Refactoring executed — ${n} file(s) changed.${unresolved}${version}${warn}`
    }
    case 'rejected':
      return `I cannot plan this refactoring as requested: ${payload.reason ?? 'the plan has conflicts'}. Nothing was changed.`
    case 'clarification':
      return payload.question ?? 'I need one detail before I can plan this refactoring.'
    case 'failed':
      return `The refactoring could not be planned: ${payload.reason ?? 'unknown error'}. Nothing was changed.`
  }
}
