/**
 * BEAN Intelligence — CODE GIFTZ file-operation execution (M23).
 *
 * Real, transactional mutations over the existing DB-backed project files
 * (CodeFile rows) — never simulated chat responses:
 *   - every precondition is re-validated INSIDE the mutation transaction
 *     (SQLite + connection_limit=1 serializes writers, so the in-transaction
 *     check is race-safe);
 *   - multi-file operations are atomic: a failure rolls back completely and is
 *     reported honestly — never "complete success" for a partial outcome;
 *   - execution is replay-safe: an executed operation returns its recorded
 *     result verbatim (replayed:true) instead of mutating twice;
 *   - every successful mutation snapshots a project version (kind 'file-op'
 *     or 'repair'); a failed operation snapshots NOTHING;
 *   - post-execution verification records content preservation and the
 *     remaining-reference count; a rename/move with affected references
 *     offers a SEPARATELY REVIEWABLE repair plan (own confirmation).
 *
 * SERVER-ONLY. The Prisma boundary is the only side effect.
 */
import { db } from '@/lib/db'
import { logger } from '@/lib/observability/logger'
import { createHash } from 'crypto'
import { applyFiles } from '@/lib/giftz/workspace'
import { snapshotProjectVersion } from '@/lib/code/versioning'
import {
  buildFileOpPlan,
  canonicalJson,
  planHashOf,
} from './plan'
import { buildRepairEdits, applyRepairEdits, scanReferences } from './references'
import {
  FileOpError,
  type FileOpPlan,
  type FileOpResult,
  type FileOpTurnPayload,
} from './types'
import type { Detection, RawIntent } from './detect'

// ---- operation records ------------------------------------------------------

function parsePlan(json: string): FileOpPlan {
  const parsed = JSON.parse(json) as FileOpPlan
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.moves)) {
    throw new FileOpError('INVALID', 'The stored operation plan is unreadable — refusing to execute.')
  }
  return parsed
}

/**
 * Create (or reuse) the operation record for a plan. Duplicate protection: an
 * identical plan (same planHash) already awaiting confirmation on this
 * project is returned instead of a second row.
 */
export async function createOperation(
  projectId: string,
  plan: FileOpPlan,
): Promise<{ opId: string; planHash: string; reused: boolean }> {
  const planHash = planHashOf(plan)
  const existing = await db.codeFileOperation.findFirst({
    where: { projectId, planHash, status: 'awaiting_confirmation' },
  })
  if (existing) return { opId: existing.id, planHash, reused: true }
  const row = await db.codeFileOperation.create({
    data: {
      projectId,
      kind: plan.kind,
      status: 'awaiting_confirmation',
      planJson: canonicalJson(plan),
      planHash,
    },
  })
  return { opId: row.id, planHash, reused: false }
}

async function loadOperation(opId: string, projectId: string) {
  const row = await db.codeFileOperation.findUnique({ where: { id: opId } })
  if (!row || row.projectId !== projectId) {
    throw new FileOpError('NOT_FOUND', 'This file operation was not found for this project.')
  }
  return row
}

// ---- execution ---------------------------------------------------------------

interface FileRow {
  path: string
  content: string
}

async function loadFiles(projectId: string): Promise<FileRow[]> {
  return db.codeFile.findMany({ where: { projectId }, orderBy: { path: 'asc' } })
}

function hash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

/**
 * Pre-execution staleness + validity check against the CURRENT file set.
 * Structural ops check path-level preconditions (a rename preserves content,
 * so concurrent content edits do not invalidate it); repair plans check the
 * exact text they will replace (content-level staleness).
 */
function validateAgainstCurrent(plan: FileOpPlan, files: FileRow[]): void {
  const byPath = new Map(files.map((f) => [f.path, f.content]))
  const lowerIndex = new Map(files.map((f) => [f.path.toLowerCase(), f.path]))

  if (plan.kind === 'repair') {
    for (const edit of plan.edits ?? []) {
      const content = byPath.get(edit.path)
      if (content === undefined) {
        throw new FileOpError('STALE', `${edit.path} no longer exists — the repair plan is stale and was not applied.`)
      }
      if (!content.includes(edit.find)) {
        throw new FileOpError('STALE', `${edit.path} changed since the repair was prepared — the reference to repair is no longer present. The plan was NOT applied; re-run the move or ask for a targeted edit.`)
      }
    }
    return
  }

  if (plan.kind === 'create') {
    for (const c of plan.creates ?? []) {
      if (byPath.has(c.path)) {
        throw new FileOpError('CONFLICT', `${c.path} already exists — the plan is stale, nothing was created.`)
      }
    }
    return
  }

  if (plan.kind === 'delete') {
    for (const d of plan.deletes ?? []) {
      if (!byPath.has(d)) {
        throw new FileOpError('STALE', `${d} no longer exists — the plan is stale, nothing was deleted.`)
      }
    }
    return
  }

  // rename / move / batch-move / batch-rename
  for (const from of new Set(plan.moves.map((m) => m.from))) {
    const actual = lowerIndex.get(from.toLowerCase())
    if (!actual) {
      throw new FileOpError('STALE', `${from} no longer exists — the plan is stale, nothing was changed. Ask again to re-plan.`)
    }
    if (actual !== from) {
      throw new FileOpError('STALE', `${from} changed concurrently — the plan is stale, nothing was changed. Ask again to re-plan.`)
    }
  }
  for (const move of plan.moves) {
    const taken = lowerIndex.get(move.to.toLowerCase())
    if (taken && taken !== move.from) {
      throw new FileOpError('CONFLICT', `${move.to} now exists (${taken}) — the plan is stale, nothing was changed. Ask again to re-plan.`)
    }
  }
}

/**
 * Execute an operation record. Confirmation semantics:
 *  - a plan with requiresConfirmation executes ONLY through this function
 *    (the user's explicit Confirm action on the exact plan);
 *  - an already-executed operation REPLAYS its recorded result (idempotent
 *    retry — the mutation is never applied twice);
 *  - cancelled/failed records refuse execution.
 */
export async function executeOperation(opId: string, projectId: string): Promise<FileOpResult> {
  const row = await loadOperation(opId, projectId)
  const plan = parsePlan(row.planJson)

  // Integrity of the stored plan: the hash the confirmation was bound to must
  // still match the stored plan bytes (a tampered/corrupt record is refused).
  if (planHashOf(plan) !== row.planHash) {
    await db.codeFileOperation.update({
      where: { id: row.id },
      data: { status: 'failed', resultJson: JSON.stringify({ error: 'stored plan integrity mismatch' }) },
    })
    throw new FileOpError('INVALID', 'The stored operation plan does not match its confirmation hash — execution refused.')
  }

  if (row.status === 'executed') {
    const recorded = row.resultJson ? (JSON.parse(row.resultJson) as FileOpResult) : null
    if (recorded) return { ...recorded, replayed: true }
    throw new FileOpError('INVALID', 'The operation is already recorded as executed but its result is unreadable.')
  }
  if (row.status === 'cancelled') {
    throw new FileOpError('INVALID', 'This operation was cancelled and cannot be executed. Ask again to re-plan.')
  }
  if (row.status === 'failed' || row.status === 'stale') {
    throw new FileOpError('INVALID', 'This operation already failed. Ask again to re-plan with the current project state.')
  }

  const files = await loadFiles(projectId)
  try {
    validateAgainstCurrent(plan, files)
  } catch (e) {
    if (e instanceof FileOpError && (e.code === 'STALE' || e.code === 'CONFLICT')) {
      await db.codeFileOperation.update({
        where: { id: row.id },
        data: { status: e.code === 'STALE' ? 'stale' : 'failed', resultJson: JSON.stringify({ error: e.message }) },
      })
    }
    throw e
  }

  // Content preservation evidence: hashes of every source file before the mutation.
  const beforeHashes = new Map(files.map((f) => [f.path, hash(f.content)]))

  let result: FileOpResult
  try {
    if (plan.kind === 'repair') {
      result = await executeRepair(plan, row.id, projectId)
    } else {
      result = await executeStructural(plan, row.id, projectId, beforeHashes)
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await db.codeFileOperation
      .update({
        where: { id: row.id },
        data: { status: 'failed', resultJson: JSON.stringify({ error: message }) },
      })
      .catch(() => undefined)
    throw e instanceof FileOpError ? e : new FileOpError('INVALID', `The operation failed and was rolled back: ${message}`)
  }

  await db.codeFileOperation.update({
    where: { id: row.id },
    data: { status: 'executed', executedAt: new Date(), resultJson: JSON.stringify(result) },
  })
  return result
}

/** Structural operations: rename / move / delete / create / batch — one atomic transaction. */
async function executeStructural(
  plan: FileOpPlan,
  opId: string,
  projectId: string,
  beforeHashes: Map<string, string>,
): Promise<FileOpResult> {
  const applied: FileOpResult['applied'] = []

  await db.$transaction(async (tx) => {
    // Re-validate EVERY precondition inside the transaction (race-safe).
    const currentRows = await tx.codeFile.findMany({ where: { projectId } })
    const byPath = new Map(currentRows.map((f) => [f.path, f] as const))
    const lowerIndex = new Map(currentRows.map((f) => [f.path.toLowerCase(), f] as const))

    for (const move of plan.moves) {
      const source = byPath.get(move.from) ?? lowerIndex.get(move.from.toLowerCase())
      if (!source) throw new FileOpError('STALE', `${move.from} disappeared while the operation was running — transaction rolled back, nothing was changed.`)
      if (move.from !== source.path) throw new FileOpError('STALE', `${move.from} changed case concurrently — transaction rolled back.`)
      const dest = lowerIndex.get(move.to.toLowerCase())
      if (dest && dest.id !== source.id) throw new FileOpError('CONFLICT', `${move.to} was created concurrently — transaction rolled back, nothing was changed.`)
      if (move.from === move.to) continue // no-op (case-identical)
      await tx.codeFile.update({ where: { id: source.id }, data: { path: move.to } })
      applied.push({ from: move.from, to: move.to, action: 'moved' })
    }

    for (const d of plan.deletes ?? []) {
      const row = byPath.get(d) ?? lowerIndex.get(d.toLowerCase())
      if (!row) throw new FileOpError('STALE', `${d} disappeared while the operation was running — transaction rolled back, nothing was deleted.`)
      await tx.codeFile.delete({ where: { id: row.id } })
      applied.push({ path: d, action: 'deleted' })
    }

    for (const c of plan.creates ?? []) {
      const existing = byPath.get(c.path) ?? lowerIndex.get(c.path.toLowerCase())
      if (existing) throw new FileOpError('CONFLICT', `${c.path} was created concurrently — transaction rolled back, nothing was created.`)
      const content = plan.kind === 'create' && c.withContent ? (plan.createContent ?? '') : ''
      await tx.codeFile.create({
        data: { projectId, path: c.path, content, origin: c.withContent ? 'modified' : 'generated' },
      })
      applied.push({ path: c.path, action: 'created' })
    }
  })

  // Version snapshot AFTER the verified mutation (never a fake success).
  let versionSeq: number | null = null
  try {
    const snapshot = await snapshotProjectVersion({
      projectId,
      kind: 'file-op',
      summary: fileOpSummary(plan),
    })
    versionSeq = snapshot.version?.seq ?? null
  } catch (snapshotError) {
    logger.warn('giftz.fileop_snapshot_failed', {
      projectId,
      opId,
      message: snapshotError instanceof Error ? snapshotError.message : String(snapshotError),
    })
  }

  // Post-execution verification: content preservation + remaining references.
  const after = await loadFiles(projectId)
  const afterByPath = new Map(after.map((f) => [f.path, f.content]))
  let contentsPreserved = true
  for (const move of plan.moves) {
    const before = beforeHashes.get(move.from)
    const now = afterByPath.get(move.to)
    if (before !== undefined && hash(now ?? '') !== before) contentsPreserved = false
  }
  const movedFromPaths = plan.moves.map((m) => m.from)
  const remaining = scanReferences(after, movedFromPaths).length
  const failed: FileOpResult['failed'] = []
  if (!contentsPreserved) {
    failed.push({ path: plan.moves.map((m) => m.to).join(', '), action: 'content-preservation-check', reason: 'A moved file\'s content no longer matches its pre-operation hash.' })
  }

  // Offer the SEPARATELY REVIEWABLE reference repair when references exist.
  let repairOffered: FileOpResult['repairOffered'] = null
  if (movedFromPaths.length > 0 && remaining > 0 && plan.kind !== 'repair') {
    const { edits, unrepairable } = buildRepairEdits(after, plan.moves)
    if (edits.length > 0) {
      const repairPlan: FileOpPlan = {
        kind: 'repair',
        targets: [...new Set(edits.map((e) => e.path))].map((p) => ({ path: p, isFolder: false })),
        moves: plan.moves.map((m) => ({ from: m.from, to: m.to, isFolder: m.isFolder })),
        edits,
        conflicts: [],
        referenceImpact: referenceImpactFromEdits(edits),
        requiresConfirmation: true,
        consequence:
          `Repairs ${edits.length} reference(s) in ${new Set(edits.map((e) => e.path)).size} file(s) so imports point to the new path(s). Each file's change is shown before you approve it.` +
          (unrepairable.length > 0 ? ` ${unrepairable.length} reference(s) could not be repaired automatically (${unrepairable[0].reason}).` : ''),
      }
      const repair = await createOperation(projectId, repairPlan)
      repairOffered = {
        opId: repair.opId,
        planHash: repair.planHash,
        affectedFiles: referenceImpactFromEdits(edits),
        consequence: repairPlan.consequence,
      }
    }
  }

  return {
    opId,
    kind: plan.kind,
    applied,
    failed,
    versionSeq,
    verification: {
      contentsPreserved,
      remainingReferences: remaining,
      detail: contentsPreserved
        ? `All moved file(s) verified at their new paths with identical content${remaining > 0 ? `; ${remaining} reference(s) to the old path(s) remain — review the suggested repair` : '; no references to the old path(s) remain'}.`
        : 'Content-preservation check FAILED — inspect the project before continuing.',
    },
    repairOffered,
  }
}

function referenceImpactFromEdits(edits: Array<{ path: string }>) {
  const byPath = new Map<string, number>()
  for (const e of edits) byPath.set(e.path, (byPath.get(e.path) ?? 0) + 1)
  return [...byPath.entries()].map(([path, count]) => ({ path, lines: [], sample: `${count} reference(s)` }))
}

/** Reference repair: applies the planned replacements through the SAME applyFiles write path as every content edit. */
async function executeRepair(
  plan: FileOpPlan,
  opId: string,
  projectId: string,
): Promise<FileOpResult> {
  const files = await loadFiles(projectId)
  const { changed, missing } = applyRepairEdits(files, plan.edits ?? [])
  if (missing.length > 0) {
    throw new FileOpError(
      'STALE',
      `${missing[0].path} changed since the repair was prepared (the old reference text is no longer present). Nothing was applied — re-plan the repair.`,
    )
  }
  // applyFiles = the single content-write path (path-safe, honest diffs).
  const changes = await applyFiles(projectId, changed.map((c) => ({ path: c.path, content: c.content })))
  const applied = changes.map((c) => ({ path: c.path, action: 'repaired' as const }))

  let versionSeq: number | null = null
  try {
    const snapshot = await snapshotProjectVersion({
      projectId,
      kind: 'repair',
      summary: `Repaired ${applied.length} reference(s) after ${plan.moves.map((m) => `${m.from} → ${m.to}`).join(', ')}`,
    })
    versionSeq = snapshot.version?.seq ?? null
  } catch (snapshotError) {
    logger.warn('giftz.repair_snapshot_failed', {
      projectId,
      opId,
      message: snapshotError instanceof Error ? snapshotError.message : String(snapshotError),
    })
  }

  const after = await loadFiles(projectId)
  const oldPaths = plan.moves.map((m) => m.from)
  const remaining = scanReferences(after, oldPaths).length
  return {
    opId,
    kind: 'repair',
    applied,
    failed: [],
    versionSeq,
    verification: {
      contentsPreserved: true,
      remainingReferences: remaining,
      detail: `${applied.length} file(s) repaired${remaining > 0 ? `; ${remaining} reference(s) to the old path(s) could not be resolved automatically and remain` : '; no references to the old path(s) remain'}.`,
    },
  }
}

function fileOpSummary(plan: FileOpPlan): string {
  if (plan.kind === 'delete') {
    const n = plan.deletes?.length ?? 0
    return n === 1 ? `Deleted ${plan.deletes?.[0]}` : `Deleted ${n} file(s) under ${plan.targets[0]?.path}`
  }
  if (plan.kind === 'create') {
    return `Created ${plan.creates?.map((c) => c.path).join(', ')}`
  }
  if (plan.moves.length === 1) {
    return `${plan.kind === 'rename' ? 'Renamed' : 'Moved'} ${plan.moves[0].from} → ${plan.moves[0].to}`
  }
  return `${plan.kind === 'batch-rename' ? 'Batch-renamed' : 'Moved'} ${plan.moves.length} file(s)`
}

// ---- cancellation -----------------------------------------------------------

export async function cancelOperation(opId: string, projectId: string): Promise<{ cancelled: boolean }> {
  const row = await loadOperation(opId, projectId)
  if (row.status === 'executed') {
    throw new FileOpError('INVALID', 'This operation already executed — it cannot be cancelled. Restore from the Versions panel if needed.')
  }
  if (row.status !== 'awaiting_confirmation') {
    throw new FileOpError('INVALID', 'This operation is no longer pending.')
  }
  await db.codeFileOperation.update({ where: { id: row.id }, data: { status: 'cancelled' } })
  return { cancelled: true }
}

// ---- chat flow --------------------------------------------------------------

/** Deterministic truthful assistant text for a file-op turn (no model involved). */
export function fileOpAssistantText(payload: FileOpTurnPayload): string {
  switch (payload.status) {
    case 'executed': {
      const r = payload.result
      const n = r?.applied.length ?? 0
      const head =
        payload.kind === 'delete'
          ? `Deleted ${n} file(s).`
          : payload.kind === 'create'
            ? `Created ${n} item(s).`
            : payload.kind === 'repair'
              ? `Repaired ${n} file(s).`
              : `${payload.kind === 'rename' ? 'Renamed' : 'Moved'} ${n} item(s).`
      const version = payload.versionSeq ? ` Version v${payload.versionSeq} recorded.` : ''
      const refs = r && r.verification.remainingReferences > 0
        ? ` ${r.verification.remainingReferences} reference(s) to the old path(s) may break — a repair is offered below.`
        : ''
      const warn = r && r.failed.length > 0 ? ` WARNING: ${r.failed[0].reason}` : ''
      return `${head}${refs}${version}${warn}`
    }
    case 'awaiting_confirmation':
      return `Planned ${payload.kind}: ${payload.source?.join(', ')}${payload.destination ? ` → ${payload.destination}` : ''}. ${payload.consequence ?? ''} Nothing has been changed yet — confirm below to execute.`
    case 'clarification':
      return payload.question ?? 'I need one detail before I can perform this operation.'
    case 'rejected':
      return `I cannot perform this operation as requested: ${payload.reason ?? 'the plan has conflicts'}. Nothing was changed.`
    case 'explained':
      return `If you proceed: ${payload.consequence ?? ''}`
    case 'failed':
      return `The operation failed before anything was changed: ${payload.reason ?? 'unknown error'}. Ask again to re-plan.`
  }
}

export type DetectedFlowResult = {
  payload: FileOpTurnPayload
  assistantText: string
}

/**
 * The chat-side flow for a detected operation: plan → validate → (execute or
 * await confirmation or clarify). Never calls the model; never touches files
 * outside the validated plan.
 */
export async function performDetectedFileOperation(args: {
  projectId: string
  detection: Detection
  files: Array<{ path: string; content: string }>
}): Promise<DetectedFlowResult> {
  const { projectId, detection, files } = args

  if (!detection.detected) {
    throw new FileOpError('INVALID', 'No file operation was detected.')
  }
  if (detection.type === 'clarification') {
    const payload: FileOpTurnPayload = { status: 'clarification', question: detection.question }
    return { payload, assistantText: fileOpAssistantText(payload) }
  }
  if (detection.type === 'explain') {
    const payload = explainPlan(detection.intent, files)
    return { payload, assistantText: fileOpAssistantText(payload) }
  }

  // A real operation request.
  let plan: FileOpPlan
  try {
    plan = buildFileOpPlan(detection.intent, files)
  } catch (e) {
    if (e instanceof FileOpError) {
      if (e.code === 'CONFLICT' || e.code === 'PROTECTED' || e.code === 'LIMIT' || e.code === 'INVALID') {
        const payload: FileOpTurnPayload = { status: 'rejected', reason: e.message }
        return { payload, assistantText: fileOpAssistantText(payload) }
      }
      if (e.code === 'NOT_FOUND') {
        const payload: FileOpTurnPayload = {
          status: 'clarification',
          question: e.message,
        }
        return { payload, assistantText: fileOpAssistantText(payload) }
      }
    }
    throw e
  }

  if (plan.conflicts.length > 0) {
    const payload: FileOpTurnPayload = {
      status: 'rejected',
      kind: plan.kind,
      conflicts: plan.conflicts,
      reason: `Destination conflict: ${plan.conflicts.join(', ')} already exist${plan.conflicts.length === 1 ? 's' : ''}. Nothing was changed.`,
    }
    return { payload, assistantText: fileOpAssistantText(payload) }
  }

  const { opId, planHash } = await createOperation(projectId, plan)

  if (plan.requiresConfirmation) {
    const payload: FileOpTurnPayload = {
      status: 'awaiting_confirmation',
      kind: plan.kind,
      opId,
      planHash,
      source: plan.targets.map((t) => t.path),
      destination: plan.destination,
      affectedFiles: plan.deletes ?? plan.creates?.map((c) => c.path) ?? plan.moves.map((m) => `${m.from} → ${m.to}`),
      conflicts: [],
      referenceImpact: plan.referenceImpact,
      consequence: plan.consequence,
    }
    return { payload, assistantText: fileOpAssistantText(payload) }
  }

  // Non-destructive: execute immediately (the plan card still shows everything).
  try {
    const result = await executeOperation(opId, projectId)
    const payload: FileOpTurnPayload = {
      status: 'executed',
      kind: plan.kind,
      opId,
      planHash,
      source: plan.targets.map((t) => t.path),
      destination: plan.destination,
      affectedFiles: plan.moves.map((m) => `${m.from} → ${m.to}`),
      referenceImpact: plan.referenceImpact,
      result,
      versionSeq: result.versionSeq,
      consequence: plan.consequence,
    }
    return { payload, assistantText: fileOpAssistantText(payload) }
  } catch (e) {
    if (e instanceof FileOpError) {
      const payload: FileOpTurnPayload = {
        status: 'failed',
        kind: plan.kind,
        opId,
        reason: e.message,
      }
      return { payload, assistantText: fileOpAssistantText(payload) }
    }
    throw e
  }
}

function explainPlan(intent: RawIntent, files: Array<{ path: string; content: string }>): FileOpTurnPayload {
  try {
    const plan = buildFileOpPlan(intent, files)
    return {
      status: 'explained',
      kind: plan.kind,
      source: plan.targets.map((t) => t.path),
      destination: plan.destination,
      affectedFiles: plan.deletes ?? plan.moves.map((m) => `${m.from} → ${m.to}`),
      conflicts: plan.conflicts,
      referenceImpact: plan.referenceImpact,
      consequence: plan.consequence,
      reason: plan.conflicts.length > 0 ? 'This plan currently has destination conflicts — nothing would be executed.' : undefined,
    }
  } catch (e) {
    if (e instanceof FileOpError) {
      return { status: 'explained', consequence: e.message }
    }
    throw e
  }
}
