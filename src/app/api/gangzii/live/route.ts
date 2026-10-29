import { z } from 'zod'
import { handle, ok } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { preflight, assertChatRequest } from '@/lib/router/router'
import { hostedLlmAdapter } from '@/lib/adapters/hosted-llm'
import { recordUsage, recordAudit } from '@/lib/observability/metering'

const schema = z.object({
  transcript: z.string().trim().min(1, 'Say something first.').max(1000),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(2000),
      }),
    )
    .max(12)
    .optional(),
})

const SYSTEM_PROMPT = [
  'You are GANGZII, the voice assistant of BEAN Intelligence.',
  'The user is talking to you by voice. Your reply will be spoken aloud by a',
  'text-to-speech voice, so write for the ear: warm, natural, conversational.',
  'Keep answers short — one to three sentences unless the user explicitly asks',
  'for more detail. No markdown, no bullet lists, no emojis, no stage directions.',
  'If you cannot do something by voice, say so plainly and honestly.',
].join(' ')

/**
 * GANGZII — Live Voice turn (REAL pipeline, honestly turn-based).
 *
 * The browser records one turn, the gateway transcribes it (ASR), this route
 * generates the spoken-style reply through the authorized conversation
 * gateway, and the client then speaks it through the REAL TTS job pipeline.
 * This is a measured STT -> LLM -> TTS pipeline — NOT a low-latency duplex
 * stream, and the UI labels it as turn-based accordingly.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    const body = await parseBody(request, schema)
    const { backend, adapter, release } = await preflight(user.id, 'gangzii', 'chat')

    try {
      const history = (body.history ?? []).slice(-12)
      const caps = assertChatRequest(backend, [
        ...history,
        { role: 'user', content: body.transcript },
      ])

      const result = await adapter.chat!({
        messages: [
          { role: 'assistant', content: SYSTEM_PROMPT },
          ...history,
          { role: 'user', content: body.transcript },
        ],
        maxPromptChars: caps.maxPromptChars,
        maxHistoryMessages: caps.maxHistoryMessages,
        timeoutMs: backend.timeouts.requestMs,
      })

      await recordUsage({
        userId: user.id,
        product: 'gangzii',
        backendId: backend.id,
        kind: 'chat',
        tokensIn: result.tokensInEst,
        tokensOut: result.tokensOutEst,
        durationMs: result.durationMs,
        success: true,
      })
      await recordAudit({
        actorId: user.id,
        action: 'gangzii.live.turn',
        meta: { transcriptChars: body.transcript.length, replyChars: result.content.length },
      })

      return ok({ reply: result.content.trim(), durationMs: result.durationMs })
    } finally {
      release()
    }
  })
}
