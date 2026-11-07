/**
 * BEAN Intelligence — background job event stream (SSE).
 *
 * GET /api/ai/jobs/[id]/events?since=<seq>
 *
 * Replays the job's append-only event log from any cursor, then tails it
 * live. This is what makes background execution watchable: a client can
 * connect AFTER submission (or reconnect after a tab refresh, or from a
 * different device) and still receive every delta/progress/stage frame in
 * order. Events are read from the database, NOT from worker memory, so the
 * stream survives worker restarts and even server restarts.
 *
 * Wire contract: `data: {"seq":N,"type":"…",…}` frames (same one-line JSON
 * convention as the product SSE endpoints), `: keepalive` comments during
 * silence, one terminal frame `data: {"terminal":true,"status":…}` then a
 * clean close. Owner-checked every request.
 */

import { db } from '@/lib/db'
import { handle, BeanApiError } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { getEventsSince } from '@/lib/ai-engine/events'
import { isTerminal } from '@/lib/ai-engine/types'

const POLL_MS = 350
const HEARTBEAT_MS = 15_000
const TERMINAL_GRACE_POLLS = 3

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const job = await db.generationJob.findUnique({
      where: { id },
      select: { id: true, userId: true, status: true },
    })
    if (!job || job.userId !== user.id) {
      throw new BeanApiError('NOT_FOUND', 'Job not found.')
    }

    const since = Number(new URL(request.url).searchParams.get('since') ?? '-1')
    let cursor = Number.isFinite(since) ? since : -1

    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false
        const close = () => {
          if (closed) return
          closed = true
          try {
            controller.close()
          } catch {
            /* already closed */
          }
        }
        const send = (obj: Record<string, unknown>) => {
          if (closed) return false
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
            return true
          } catch {
            closed = true
            return false
          }
        }
        const comment = (text: string) => {
          if (closed) return
          try {
            controller.enqueue(encoder.encode(`: ${text}\n\n`))
          } catch {
            closed = true
          }
        }

        request.signal.addEventListener('abort', () => {
          closed = true
        })

        comment('connected')

        let idleSince = Date.now()
        let gracePolls = 0
        // Tail loop: bounded work per iteration; aborts when the client goes
        // away or the job reaches a terminal state (with a small grace so a
        // race between the terminal event write and the status flip resolves).
        for (;;) {
          if (closed) break
          const events = await getEventsSince(job.id, cursor)
          for (const e of events) {
            cursor = e.seq
            idleSince = Date.now()
            gracePolls = 0
            if (!send({ seq: e.seq, type: e.type, ...e.data })) break
          }
          if (closed) break

          const row = await db.generationJob.findUnique({
            where: { id: job.id },
            select: { status: true, errorCode: true, errorMessage: true, resultJson: true },
          })
          if (!row) {
            send({ terminal: true, status: 'failed', errorCode: 'NOT_FOUND' })
            break
          }
          if (isTerminal(row.status)) {
            if (events.length === 0) {
              gracePolls += 1
              if (gracePolls >= TERMINAL_GRACE_POLLS) {
                let result: Record<string, unknown> | null = null
                try {
                  result = row.resultJson ? (JSON.parse(row.resultJson) as Record<string, unknown>) : null
                } catch {
                  result = null
                }
                send({
                  terminal: true,
                  status: row.status,
                  errorCode: row.errorCode,
                  errorMessage: row.errorMessage,
                  result,
                })
                break
              }
            }
          }
          if (Date.now() - idleSince > HEARTBEAT_MS) {
            comment('keepalive')
            idleSince = Date.now()
          }
          await new Promise((r) => setTimeout(r, POLL_MS))
        }
        close()
      },
    })

    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      },
    })
  })
}
