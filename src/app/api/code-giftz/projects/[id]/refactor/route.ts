/**
 * CODE GIFTZ — refactoring planning endpoint (M25).
 *
 * POST — plan (NEVER execute) a multi-file refactoring for an owned project.
 *   Deterministic kinds (rename-symbol, move-module) build the plan entirely
 *   server-side with zero provider calls; provider-assisted kinds run ONE
 *   bounded drafting pass through the existing coding backend and validate the
 *   draft server-side. The returned plan is stored on the existing M23
 *   operation ledger (kind 'refactor') awaiting explicit confirmation bound to
 *   the plan hash — execution happens exclusively through
 *   /file-ops/execute (which dispatches refactor rows to the atomic executor).
 *
 * GET — list this project's refactoring operations (status + result), for the
 *   workspace UI. Owner-checked end to end.
 */
import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { preflight } from '@/lib/router/router'
import { recordUsage, recordAudit } from '@/lib/observability/metering'
import { logger } from '@/lib/observability/logger'
import { FileOpError } from '@/lib/code/file-ops/types'
import { detectRefactoringRequest } from '@/lib/code/refactoring/detect'
import { performDetectedRefactoring } from '@/lib/code/refactoring/chat-flow'
import type { RefactorKind, RefactorTurnPayload } from '@/lib/code/refactoring/plan'
import type { RefactorDetection } from '@/lib/code/refactoring/detect'

const KINDS = ['rename-symbol', 'move-module', 'extract-component', 'extract-module', 'service-layer', 'consolidate', 'restructure', 'repair'] as const

const schema = z
  .object({
    /** Free-form refactoring request (detected like a chat turn). */
    message: z.string().min(4).max(12000).optional(),
    /** Explicit kind — skips detection when provided. */
    kind: z.enum(KINDS).optional(),
    symbol: z.string().min(1).max(100).optional(),
    newName: z.string().min(1).max(100).optional(),
    sources: z.array(z.string().min(1).max(200)).max(10).optional(),
    destination: z.string().min(1).max(200).optional(),
    scopeRoots: z.array(z.string().min(1).max(200)).max(12).optional(),
  })
  .refine((b) => Boolean(b.message) || Boolean(b.kind), { message: 'Provide a refactoring request or an explicit kind.' })

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const body = await parseBody(request, schema)
    const project = await db.codeProject.findUnique({ where: { id } })
    if (!project || project.userId !== user.id) {
      throw new BeanApiError('NOT_FOUND', 'Project not found.')
    }
    const files = await db.codeFile.findMany({ where: { projectId: id }, orderBy: { path: 'asc' } })
    if (files.length === 0) {
      throw new BeanApiError('VALIDATION_ERROR', 'This project has no files yet — refactoring applies to saved projects.')
    }
    const fileRows = files.map((f) => ({ path: f.path, content: f.content }))

    // Detection: explicit kind wins; otherwise the same deterministic detector
    // the chat route uses (identical semantics, one implementation).
    let detection: RefactorDetection
    if (body.kind) {
      detection = {
        detected: true,
        type: 'op',
        kind: body.kind as RefactorKind,
        ...(body.kind === 'rename-symbol' ? { symbol: body.symbol, newName: body.newName } : {}),
        ...(body.kind === 'move-module' ? { sources: body.sources, destination: body.destination } : {}),
        ...(body.scopeRoots ? { scopeRoots: body.scopeRoots } : {}),
        request: body.message ?? body.kind,
      }
    } else {
      detection = detectRefactoringRequest(body.message ?? '', fileRows)
    }

    if (!detection.detected) {
      throw new BeanApiError(
        'VALIDATION_ERROR',
        'No refactoring operation was recognized in this request. Supported: rename a symbol, move modules with import updates, extract a component/module, extract a service layer, consolidate repeated structures, reorganize the project.',
      )
    }
    if (detection.type === 'clarification') {
      return ok({ status: 'clarification', question: detection.question })
    }

    // Provider-assisted kinds need a coding backend slot; deterministic kinds
    // are planned with zero provider involvement (provider-independence rule).
    const needsProvider = detection.kind !== 'rename-symbol' && detection.kind !== 'move-module'
    let adapter: import('@/lib/adapters/types').TaskAdapter | undefined
    let backendRequestMs = 120_000
    let maxPromptChars = 12_000
    let servedBy: Awaited<ReturnType<typeof preflight>>['servedBy'] | null = null
    let release: (() => void) | null = null
    if (needsProvider) {
      const pf = await preflight(user.id, 'code-giftz', 'coding-task')
      adapter = pf.adapter
      backendRequestMs = pf.backend.timeouts.requestMs
      maxPromptChars = Number(pf.backend.limits.maxPromptChars ?? 12_000)
      servedBy = pf.servedBy
      release = pf.release
    }

    try {
      const flow = await performDetectedRefactoring({
        projectId: id,
        message: body.message ?? body.kind ?? '',
        files: fileRows,
        ...(adapter ? { adapter } : {}),
        backendRequestMs,
        maxPromptChars,
        detection,
      })

      if (flow.tokensInEst > 0 && servedBy) {
        await recordUsage({
          userId: user.id,
          product: 'code-giftz',
          backendId: servedBy.backendId,
          kind: 'coding-task',
          tokensIn: flow.tokensInEst,
          tokensOut: flow.tokensOutEst,
          durationMs: 0,
          success: true,
        })
      }
      await recordAudit({
        actorId: user.id,
        action: 'code-giftz.refactor_plan',
        target: id,
        meta: {
          status: flow.payload.status,
          kind: flow.payload.kind,
          engine: flow.payload.engine,
          opId: flow.payload.opId,
          providerCalls: needsProvider ? 1 : 0,
        },
      })

      const payload: RefactorTurnPayload = flow.payload
      if (payload.status === 'clarification' || payload.status === 'rejected' || payload.status === 'failed') {
        return ok({
          status: payload.status,
          ...(payload.question ? { question: payload.question } : {}),
          ...(payload.reason ? { reason: payload.reason } : {}),
          kind: payload.kind,
        })
      }
      return ok(payload)
    } catch (e) {
      // Honest failure semantics: a provider outage during assisted drafting
      // leaves the workspace untouched and reports the failure class verbatim.
      if (e instanceof FileOpError) {
        throw new BeanApiError(e.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'VALIDATION_ERROR', e.message)
      }
      throw e
    } finally {
      release?.()
    }
  })
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const project = await db.codeProject.findUnique({ where: { id } })
    if (!project || project.userId !== user.id) {
      throw new BeanApiError('NOT_FOUND', 'Project not found.')
    }
    const rows = await db.codeFileOperation.findMany({
      where: { projectId: id, kind: 'refactor' },
      orderBy: { createdAt: 'desc' },
      take: 25,
    })
    logger.info('giftz.refactor_list', { projectId: id, count: rows.length })
    return ok({
      operations: rows.map((r) => ({
        opId: r.id,
        status: r.status,
        planHash: r.planHash,
        createdAt: r.createdAt.toISOString(),
        executedAt: r.executedAt?.toISOString() ?? null,
        ...(r.resultJson ? { result: JSON.parse(r.resultJson) } : {}),
      })),
    })
  })
}
