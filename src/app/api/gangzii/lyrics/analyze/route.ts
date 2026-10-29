import { z } from 'zod'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { preflight, assertChatRequest } from '@/lib/router/router'
import { hostedLlmAdapter } from '@/lib/adapters/hosted-llm'
import { recordUsage } from '@/lib/observability/metering'
import { getSongPreset } from '@/lib/registry/gangzii-presets'

const schema = z.object({
  lyrics: z
    .string()
    .trim()
    .min(8, 'Write or draft some lyrics first — there is nothing to analyze yet.')
    .max(3600, 'Lyrics exceed the 3600-character analysis limit for the current conversation backend.'),
  songIdea: z.string().trim().max(2000).optional(),
  presetId: z.string().trim().max(64).optional(),
  /** When true, RIISHE also returns a full improved draft. */
  wantImprovedDraft: z.boolean().optional(),
})

/**
 * RIISHE lyric-critique system role. It must return STRICT JSON, must not
 * invent numeric scores (none are requested), and must quote short examples
 * from the actual submitted lyrics for every weakness. The honesty boundary
 * is part of the contract: textual craft only — melody fit, timing and
 * final musical quality are NOT assessable without a singing model.
 */
const SYSTEM_PROMPT = [
  'You are RIISHE, the BEAN Intelligence lyric analyst serving GANGZII Song Studio.',
  'Analyze the submitted lyrics against the song idea and style context provided.',
  'Assess: relevance to the idea; structure (verses, pre-chorus, chorus, bridge,',
  'outro where appropriate); natural phrasing and singability; rhythm, syllable',
  'balance and rhyme quality; repetition, filler and awkward grammar; imagery,',
  'emotional progression and originality; whether the chorus is memorable; and',
  'whether the lyrics match the requested genre and mood.',
  'Quote SHORT verbatim examples from the submitted lyrics for every weakness.',
  'Never invent a numerical score — none is requested and none may be produced.',
  'Do not rewrite the lyrics unless an improved draft is explicitly requested.',
  'Answer with STRICT JSON only (no markdown fences, no commentary) matching:',
  '{"overall": string,',
  ' "strengths": string[],',
  ' "weaknesses": [{"issue": string, "quote": string, "why": string}],',
  ' "sections": [{"section": string, "suggestion": string}],',
  ' "improvements": string[],',
  ' "improvedDraft": string | null}',
  '"improvedDraft" must be null unless an improved draft is explicitly requested;',
  'when requested it must be a complete revised draft that preserves the intended',
  'theme and fixes the identified weaknesses.',
].join(' ')

/** The validated shape RIISHE must return. */
const analysisSchema = z.object({
  overall: z.string().min(1),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.object({ issue: z.string(), quote: z.string().default(''), why: z.string().default('') })),
  sections: z.array(z.object({ section: z.string(), suggestion: z.string() })),
  improvements: z.array(z.string()),
  improvedDraft: z.string().nullable().optional(),
})

/**
 * Extract a JSON object from a model reply. Handles markdown fences and
 * surrounding prose deterministically, then parses. No heuristic "recovery"
 * that could invent content — an unparseable reply is a hard failure.
 */
export function extractJsonObject(text: string): unknown {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()
  const start = cleaned.indexOf('{')
  if (start === -1) throw new Error('no JSON object found')
  // Walk to the matching closing brace (string-aware, escape-aware).
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        const candidate = cleaned.slice(start, i + 1)
        return JSON.parse(candidate)
      }
    }
  }
  throw new Error('unterminated JSON object')
}

/**
 * GANGZII Song Studio — "Analyze lyrics with RIISHE" / "Improve lyrics with
 * RIISHE" (REAL capability through the BEAN conversation adapter).
 *
 * Returns a structured critique of the CURRENT editor contents (never a
 * hardcoded evaluation) and, when requested, a complete improved draft.
 * The draft is a SUGGESTION: the UI shows it beside the original and the
 * user applies it explicitly — RIISHE never overwrites the user's draft.
 *
 * Honesty boundary: this is TEXT analysis only. RIISHE cannot verify vocal
 * melody fit, instrumental timing or final musical quality — no singing or
 * music-generation model exists on this deployment, and the response says so.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    const body = await parseBody(request, schema)

    let presetContext: string | null = null
    if (body.presetId) {
      const preset = getSongPreset(body.presetId)
      if (preset) {
        // Unknown preset ids are tolerated here: analysis works with or
        // without a valid preset; the id only enriches genre/mood context.
        presetContext = `Style preset "${preset.displayName}": genre ${preset.genre}; mood ${preset.mood}; energy ${preset.energy}/5. The lyrics should match this genre and mood.`
      }
    }

    const { backend, adapter, release } = await preflight(user.id, 'gangzii', 'chat')

    try {
      const userContent = [
        body.wantImprovedDraft
          ? 'Task: analyze these lyrics AND produce a full improved draft.'
          : 'Task: analyze these lyrics. Do NOT produce a rewrite — set improvedDraft to null.',
        body.songIdea ? `Song idea: ${body.songIdea}` : null,
        presetContext,
        '--- LYRICS START ---',
        body.lyrics,
        '--- LYRICS END ---',
      ]
        .filter(Boolean)
        .join('\n')

      const caps = assertChatRequest(backend, [{ role: 'user', content: userContent }])
      const result = await adapter.chat!({
        messages: [
          { role: 'assistant', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        maxPromptChars: caps.maxPromptChars,
        maxHistoryMessages: caps.maxHistoryMessages,
        timeoutMs: backend.timeouts.requestMs,
      })

      let parsed: z.infer<typeof analysisSchema>
      try {
        parsed = analysisSchema.parse(extractJsonObject(result.content))
      } catch {
        // Empty or malformed RIISHE output is an honest failure — the UI
        // keeps the user's draft untouched and shows an actionable error.
        throw new BeanApiError(
          'BACKEND_FAILURE',
          'RIISHE returned a malformed analysis (the structured critique could not be read). Your lyrics are untouched — please try again.',
        )
      }

      const improvedDraft =
        body.wantImprovedDraft && parsed.improvedDraft && parsed.improvedDraft.trim().length >= 8
          ? parsed.improvedDraft.trim()
          : null

      if (body.wantImprovedDraft && !improvedDraft) {
        throw new BeanApiError(
          'BACKEND_FAILURE',
          'RIISHE did not return an improved draft. Your lyrics are untouched — try the Improve action again.',
        )
      }

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

      return ok({
        analysis: {
          overall: parsed.overall,
          strengths: parsed.strengths,
          weaknesses: parsed.weaknesses,
          sections: parsed.sections,
          improvements: parsed.improvements,
        },
        improvedDraft,
        analyzedBy: 'RIISHE',
        durationMs: result.durationMs,
        limitation:
          'RIISHE evaluates lyrics as TEXT (structure, phrasing, rhyme, imagery). It cannot verify vocal melody fit, instrumental timing or final musical quality — no singing or music-generation model is deployed on this platform.',
      })
    } finally {
      release()
    }
  })
}
