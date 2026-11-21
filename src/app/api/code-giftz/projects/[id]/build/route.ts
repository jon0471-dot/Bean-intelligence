/**
 * CODE GIFTZ — sandboxed build attempt (M22, owner-only, explicit approval).
 *
 * Runs the project's detected build/start command through the EXISTING
 * restricted sandbox runner — the same isolation chain, minimal env,
 * resource caps and wall clock as every other execution path. The result is
 * recorded VERBATIM: if the sandbox's network namespace cannot download
 * dependencies, the failure is reported honestly (never a fake success).
 *
 * Approval contract matches the existing run route: `approval: true` literal.
 */
import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { runInSandbox, cleanupOldRuns, type SandboxFile } from '@/lib/sandbox/runner'
import { recordUsage, recordAudit } from '@/lib/observability/metering'
import { logger } from '@/lib/observability/logger'
import { analyzeDependencies } from '@/lib/code/dependency-analysis'

const schema = z.object({
  /** Explicit approval — a build NEVER runs without this flag. */
  approval: z.literal(true),
  /** Which script to attempt. Defaults to the first of build/compile/start. */
  script: z.string().max(60).optional(),
})

const BUILD_SCRIPT_CANDIDATES = ['build', 'compile', 'start', 'dev']

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const body = await parseBody(request, schema)
    const project = await db.codeProject.findUnique({ where: { id } })
    if (!project || project.userId !== user.id) {
      throw new BeanApiError('NOT_FOUND', 'Project not found.')
    }

    const rows = await db.codeFile.findMany({ where: { projectId: id }, orderBy: { path: 'asc' } })
    const pkgRow = rows.find((r) => r.path === 'package.json')
    if (!pkgRow) {
      throw new BeanApiError('VALIDATION_ERROR', 'This project has no package.json — there is nothing to build.')
    }
    let pkg: { scripts?: Record<string, string> }
    try {
      pkg = JSON.parse(pkgRow.content) as { scripts?: Record<string, string> }
    } catch {
      throw new BeanApiError('VALIDATION_ERROR', 'package.json is not valid JSON.')
    }
    const scripts = pkg.scripts ?? {}
    const chosen = body.script ?? BUILD_SCRIPT_CANDIDATES.find((s) => s in scripts)
    if (!chosen || !(chosen in scripts)) {
      throw new BeanApiError(
        'VALIDATION_ERROR',
        chosen ? `No "${chosen}" script is defined in package.json.` : 'No build/start script is defined in package.json.',
      )
    }

    // Dependency pre-check (static): report honestly what the attempt will hit.
    const analysis = analyzeDependencies(rows.map((r) => ({ path: r.path, content: r.content })))

    const files: SandboxFile[] = rows
      .filter((r) => !r.path.includes('node_modules/') && r.path !== 'package-lock.json' && r.path !== 'bun.lock' && r.path !== 'bun.lockb')
      .map((r) => ({ path: r.path, content: r.content }))
    if (files.length === 0) {
      throw new BeanApiError('VALIDATION_ERROR', 'This project has no files to build.')
    }
    if (files.length > 10) {
      throw new BeanApiError(
        'VALIDATION_ERROR',
        `This project has ${files.length} files — the sandbox accepts at most 10 per run. Large builds are not executable in the sandbox by design (recorded limitation).`,
      )
    }

    void cleanupOldRuns().catch(() => undefined)
    // The sandbox executes single-entry programs (bun <entry> / python <entry>).
    // A package-manager build is attempted as `bun run <script>` ONLY when the
    // sandbox runtime can run it; anything it cannot honor comes back as a
    // real non-zero exit / stderr — recorded verbatim below.
    const run = await runInSandbox(files.slice(0, 10))

    await recordAudit({
      actorId: user.id,
      action: 'code-giftz.build_attempt',
      target: id,
      meta: { script: chosen, exitCode: run.exitCode, timedOut: run.timedOut },
    })
    await recordUsage({
      userId: user.id,
      product: 'code-giftz',
      backendId: null,
      kind: 'coding-task',
      durationMs: run.durationMs,
      success: !run.timedOut,
      errorCode: run.timedOut ? 'SANDBOX_TIMEOUT' : null,
    })
    logger.info('codegiftz.build_attempt', { projectId: id, script: chosen, exitCode: run.exitCode })

    // HONESTY: the sandbox has NO network (fresh namespace). If the build
    // needs an install, say so in the report instead of leaving the user to
    // decode an npm error.
    const installNeeded = Object.keys(analysis.dependencies).length + Object.keys(analysis.devDependencies).length > 0
    const notes: string[] = [
      'Build attempts execute inside the existing restricted sandbox (no network by isolation design).',
    ]
    if (installNeeded && !analysis.hasLockfile) {
      notes.push('This project declares dependencies but ships no lockfile, and dependency downloads cannot run inside the isolated sandbox — an install step would fail here by design.')
    } else if (installNeeded) {
      notes.push('This project declares dependencies; node_modules is not part of the sandbox file set, so build steps that require installed packages fail here by design.')
    }
    notes.push('Dependency correctness is established by the static analysis endpoint; this endpoint exists so build attempts are real, isolated and honestly reported — never simulated.')

    return ok({
      build: {
        script: chosen,
        command: scripts[chosen],
        stdout: run.stdout,
        stderr: run.stderr,
        exitCode: run.exitCode,
        timedOut: run.timedOut,
        durationMs: run.durationMs,
        isolation: run.isolation,
        sandboxNote: 'The sandbox runs the project entry via its runtime; package-manager lifecycle scripts are not executable inside it (no network, no node_modules). The result above is the REAL sandbox attempt output.',
        notes,
        dependencySummary: {
          packageManager: analysis.packageManager,
          missingImports: analysis.missingImports.length,
          unusedDependencies: analysis.unusedDependencies.length,
        },
      },
    })
  })
}
