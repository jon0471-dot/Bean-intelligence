import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, ok } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { preflight } from '@/lib/router/router'
import { recordUsage, recordAudit } from '@/lib/observability/metering'
import { hostedLlmAdapter, withTimeout } from '@/lib/adapters/hosted-llm'
import { extractFiles } from '@/lib/sandbox/runner'

const schema = z.object({
  mode: z.enum(['generate', 'explain', 'review', 'plan']),
  prompt: z.string().min(5, 'Describe the coding task (at least 5 characters).').max(12000),
  /** Optional code context the user explicitly provides (e.g. paste a file). */
  codeContext: z.string().max(12000).optional(),
  language: z.string().max(30).default('javascript'),
})

const MODE_PROMPTS: Record<string, string> = {
  generate:
    'You are CODE GIFTZ, the coding assistant of BEAN Intelligence. Write complete, runnable code for the request. ' +
    'Respond with one or more fenced code blocks. When multiple files make sense, tag each fence with `path=filename.ext` like: ```js path=main.js ' +
    'Add a short explanation after the code. Standard library only — no external package installs.',
  explain:
    'You are CODE GIFTZ. Explain the provided code clearly: what it does, key control flow, complexity where relevant, and any bugs or risks you notice.',
  review:
    'You are CODE GIFTZ performing a code review. List concrete issues by severity (bug, security, performance, style) with suggested fixes. Reference code snippets precisely.',
  plan:
    'You are CODE GIFTZ producing an implementation plan: numbered steps, files to create, data shapes, edge cases and test suggestions. Do not write the full implementation.',
}

/**
 * CODE GIFTZ — create a coding task. Generation runs synchronously against
 * the hosted LLM (a single request, not a long-running GPU job); the task
 * and its output files are persisted for audit and re-execution.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    const body = await parseBody(request, schema)
    const { backend, adapter, release } = await preflight(user.id, 'code-giftz', 'coding-task')

    try {
      if (!adapter.codeTask) {
        throw new Error('Code adapter unavailable')
      }
      const systemPrompt = MODE_PROMPTS[body.mode]
      const userContent = body.codeContext
        ? `${body.prompt}\n\nCode context:\n\`\`\`\n${body.codeContext.slice(0, 8000)}\n\`\`\`\nTarget language: ${body.language}`
        : `${body.prompt}\n\nTarget language: ${body.language}`

      const result = await withTimeout(
        hostedLlmAdapter.codeTask!({
          mode: body.mode as 'generate',
          messages: [
            { role: 'assistant', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
          maxPromptChars: Number(backend.limits.maxPromptChars ?? 12000),
          timeoutMs: backend.timeouts.requestMs,
        }),
        backend.timeouts.requestMs,
        'CODE GIFTZ',
      )

      const files = body.mode === 'generate' ? extractFiles(result.content) : []

      const job = await db.generationJob.create({
        data: {
          userId: user.id,
          product: 'code-giftz',
          task: 'coding-task',
          status: 'completed',
          backendId: backend.id,
          paramsJson: JSON.stringify({
            mode: body.mode,
            prompt: body.prompt,
            language: body.language,
            hasCodeContext: !!body.codeContext,
          }),
          resultJson: JSON.stringify({
            content: result.content,
            files,
            durationMs: result.durationMs,
          }),
          queuedAt: new Date(),
          startedAt: new Date(),
          finishedAt: new Date(),
        },
      })

      await recordUsage({
        userId: user.id,
        product: 'code-giftz',
        backendId: backend.id,
        kind: 'coding-task',
        tokensIn: result.tokensInEst,
        tokensOut: result.tokensOutEst,
        durationMs: result.durationMs,
        success: true,
      })
      await recordAudit({ actorId: user.id, action: 'code-giftz.task', target: job.id, meta: { mode: body.mode } })

      return ok({
        task: {
          id: job.id,
          mode: body.mode,
          content: result.content,
          files,
          durationMs: result.durationMs,
        },
      })
    } finally {
      release()
    }
  })
}

/** Task history for the caller. */
export async function GET() {
  return handle(async () => {
    const user = await requireUser()
    const jobs = await db.generationJob.findMany({
      where: { userId: user.id, product: 'code-giftz' },
      orderBy: { queuedAt: 'desc' },
      take: 25,
    })
    return ok({
      tasks: jobs.map((j) => {
        const result = j.resultJson ? JSON.parse(j.resultJson) : null
        return {
          id: j.id,
          mode: (JSON.parse(j.paramsJson) as { mode?: string }).mode ?? null,
          status: j.status,
          content: result?.content ?? null,
          files: result?.files ?? [],
          durationMs: result?.durationMs ?? null,
          createdAt: j.queuedAt,
        }
      }),
    })
  })
}
