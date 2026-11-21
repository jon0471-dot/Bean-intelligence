/**
 * BEAN Intelligence — JAZMII Auto Director: Creative Director (storyboard planner).
 *
 * Turns a user's creative request into a SCHEMA-VALIDATED storyboard using the
 * SAME authorized language-model infrastructure as RIISHE/CODE GIFTZ
 * (`guardedChatCompletion` — breaker-aware, honest, no paid provider added).
 *
 * Honesty rules:
 *  - the model's output is a PROPOSAL; it becomes a storyboard only after
 *    passing the zod storyboard schema (duration accounting included);
 *  - a malformed proposal is retried with the validation issues appended
 *    (bounded retries); if it still fails, the caller gets the REAL reason —
 *    no fallback template is silently substituted for a failed model call;
 *  - the planner adapts to the user's prompt (BRAG rule: the video must feel
 *    made for THIS subject) — creative modes shape pacing and structure, but
 *    hook, scenes and copy come from the user's subject.
 *
 * SERVER-ONLY.
 */
import { guardedChatCompletion } from '@/lib/adapters/hosted-llm'
import { classifyUpstreamError } from '@/lib/upstream/gateway'
import { logger } from '@/lib/observability/logger'
import {
  ASPECT_CANVAS,
  CAPTION_MAX_CHARS,
  CREATIVE_MODES,
  CREATIVE_MODE_LABELS,
  FADE_DURATION_SEC,
  PRODUCTION_DURATION_MAX_SEC,
  PRODUCTION_DURATION_MIN_SEC,
  SCENE_COUNT_MAX,
  SCENE_COUNT_MIN,
  SCENE_DURATION_MAX_SEC,
  SCENE_DURATION_MIN_SEC,
  TRANSITIONS,
  parseStoryboard,
  type DirectorRequest,
  type Storyboard,
} from './schema'

export class StoryboardPlannerError extends Error {
  readonly issues: string[]
  constructor(message: string, issues: string[] = []) {
    super(message)
    this.name = 'StoryboardPlannerError'
    this.issues = issues
  }
}

interface CompletionShape {
  choices?: Array<{ message?: { content?: string } }>
}

const PLANNER_SYSTEM = `You are the Creative Director of BEAN Intelligence's JAZMII Auto Director.
You plan short, professional videos that are assembled from AI-generated scene clips.

CRAFT RULES (treat as law):
- HOOK FIRST: the first scene (2-4s) must stop the scroll. Plan it before anything else.
- BEAT STRUCTURE: opening-hook -> reveal -> 1-4 highlights or product moments -> punchline/outro.
- SPECIFIC, NOT GENERIC: use the user's actual subject, names, product and claims. Never invent
  statistics, testimonials, user counts or product features that are not in the request.
- READABLE TEXT: each caption is ONE short line (max ${CAPTION_MAX_CHARS} chars). Roughly 0.3s per word;
  a 5-word caption needs about 2s on screen.
- EVERY SCENE is a SINGLE continuous camera shot described in concrete visual language (subject,
  setting, motion, light). No montage descriptions inside one scene; split montage into scenes.
- generationPrompt per scene: a self-contained text-to-video prompt (60-220 words) describing ONE shot.
- Scene durations are WHOLE seconds between ${SCENE_DURATION_MIN_SEC} and ${SCENE_DURATION_MAX_SEC}.
  The backend generates each shot at the nearest supported length (5s or 10s) and the
  timeline trims it to your planned duration — describe shots that read well at that length.
  A longer story = more scenes, never a longer scene.
- Scene durations MUST sum EXACTLY to durationSeconds.
- Transitions: only ${TRANSITIONS.map((t) => `"${t}"`).join(' or ')} (what the composition engines really render).
- Total duration ${PRODUCTION_DURATION_MIN_SEC}-${PRODUCTION_DURATION_MAX_SEC}s; scenes: ${SCENE_COUNT_MIN}-${SCENE_COUNT_MAX}.
- aspect: "9:16" (1080x1920), "16:9" (1920x1080) or "1:1" (1080x1080) — use the requested one.
- fps: use the requested fps.
- audioDirection per scene: what the sound should do emotionally (direction only).
- voiceover: true ONLY if the user explicitly asked for narration.

OUTPUT: one JSON object, no markdown fences, matching EXACTLY this shape:
{
  "title": string (<=80 chars),
  "objective": string (one sentence, <=300 chars),
  "audience": string (<=200 chars),
  "tone": use EXACTLY the tone value given in the request (one of: ${CREATIVE_MODES.join(' | ')}),
  "platform": string (<=60 chars, e.g. "Instagram Reels"),
  "format": "9:16" | "16:9" | "1:1",
  "width": number, "height": number, "fps": number,
  "durationSeconds": number,
  "visualDirection": string (overall look: palette, grade, mood; <=600 chars),
  "musicDirection": string (<=300 chars) or omit,
  "voiceover": boolean,
  "scenes": [
    {
      "id": "scene-01",
      "durationSeconds": number,
      "purpose": "opening-hook" | "reveal" | "highlight" | "product-moment" | "punchline" | "outro" | "custom",
      "visualDescription": string (<=600 chars, what the viewer sees),
      "generationPrompt": string (<=600 chars, the text-to-video prompt for this ONE shot),
      "cameraDirection": string (<=200 chars) or omit,
      "caption": string (<=${CAPTION_MAX_CHARS} chars) or omit,
      "transitionOut": "cut" | "fade",
      "audioDirection": string (<=200 chars) or omit
    }
  ]
}`

const CREATIVE_MODE_GUIDANCE: Record<string, string> = {
  'cinematic-film':
    'Cinematic film: wide establishing energy, dramatic lighting language, deliberate pacing, bold typography moments. Scenes breathe.',
  'product-ad':
    'Product advertisement: the product is the hero of every scene. Show function, not slogans. Sharp cuts, confident pacing.',
  'product-launch':
    'Product launch / showcase: reveal structure — tease, show the real thing, land the payoff in the final seconds.',
  'social-reel':
    'Social media reel: fast, native to vertical feeds, hook inside 2 seconds, caption-driven, energetic pacing.',
  explainer:
    'Explainer video: one clear idea per scene, ordered so each scene builds on the last, clean readable captions.',
  'story-short':
    'Story-driven short film: a tiny narrative arc with a character or place, emotion over information.',
  trailer:
    'Promotional trailer: escalating intensity, beat-dropped reveals, end on the strongest card.',
  custom: 'Follow the user\'s own style direction verbatim when they gave one.',
}

function plannerUserPrompt(req: DirectorRequest): string {
  const canvas = ASPECT_CANVAS[req.format]
  return [
    `Creative request from the user (verbatim):`,
    `"""`,
    req.prompt.slice(0, 2000),
    `"""`,
    ``,
    `Fixed parameters (must be honored exactly):`,
    `- tone: ${req.style}${CREATIVE_MODE_GUIDANCE[req.style] ? ` — ${CREATIVE_MODE_GUIDANCE[req.style]}` : ''}`,
    `- format: ${req.format} (${canvas.width}x${canvas.height}), fps: ${req.fps}`,
    `- durationSeconds: ${req.durationSec} (scene durations must sum to exactly this)`,
    req.referenceImageUrl
      ? `- A reference image will drive each scene's generation. Describe scenes that CONTINUE that visual world; do not describe completely unrelated subjects.`
      : '',
    req.referenceImageUrl
      ? `- Do NOT claim or imply character/scene continuity across scenes that the model cannot guarantee; describe each shot to stand on its own.`
      : '',
    ``,
    `Respond with the JSON object only.`,
  ]
    .filter(Boolean)
    .join('\n')
}

/** Extract the JSON object from a model response (tolerates fences/prose). */
function extractJson(text: string): unknown {
  const trimmed = text.trim()
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed)
  const candidate = fenced ? fenced[1] : trimmed
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new StoryboardPlannerError('The model response contained no JSON object.')
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1))
  } catch (e) {
    throw new StoryboardPlannerError(
      `The model response was not valid JSON: ${e instanceof Error ? e.message.slice(0, 160) : 'parse error'}`,
    )
  }
}

export interface PlannedStoryboard {
  storyboard: Storyboard
  /** Real metadata about how the plan was produced (for the Trust ledger). */
  meta: {
    attempts: number
    degraded: string[]
    modelClass: 'chat'
  }
}

const PLANNER_MAX_ATTEMPTS = 3

/**
 * Generate a schema-validated storyboard for the request. Throws
 * StoryboardPlannerError (with the real issues) when no valid storyboard can
 * be produced; upstream-class errors propagate unchanged (breaker/throttle
 * honesty is preserved).
 */
export async function generateStoryboard(req: DirectorRequest): Promise<PlannedStoryboard> {
  const degraded: string[] = []
  let lastIssues: string[] = []
  let attempts = 0

  for (let attempt = 1; attempt <= PLANNER_MAX_ATTEMPTS; attempt += 1) {
    attempts = attempt
    let content: string | undefined
    try {
      const completion = (await guardedChatCompletion({
        messages: [
          { role: 'assistant', content: PLANNER_SYSTEM },
          {
            role: 'user',
            content:
              plannerUserPrompt(req) +
              (attempt > 1
                ? `\n\nIMPORTANT — your previous proposal was rejected by schema validation:\n- ${lastIssues.join('\n- ')}\nFix EXACTLY these problems and return the corrected JSON object only.`
                : ''),
          },
        ],
        temperature: 0.7,
        max_tokens: 3000,
        thinking: { type: 'disabled' },
      })) as CompletionShape
      content = completion.choices?.[0]?.message?.content
    } catch (e) {
      // Upstream-class failures are surfaced honestly (never retried into a
      // throttle): rate-limited/auth/billing propagate as-is.
      const failure = classifyUpstreamError(e)
      if (failure.kind === 'rate_limited' || failure.kind === 'auth' || failure.kind === 'billing') {
        throw e
      }
      degraded.push(`attempt ${attempt}: chat completion failed (${failure.kind})`)
      continue
    }
    if (!content || content.trim().length === 0) {
      degraded.push(`attempt ${attempt}: empty completion`)
      continue
    }
    let raw: unknown
    try {
      raw = extractJson(content)
    } catch (e) {
      degraded.push(`attempt ${attempt}: ${e instanceof Error ? e.message.slice(0, 160) : 'extract failed'}`)
      lastIssues = ['the response must be a single JSON object']
      continue
    }
    const parsed = parseStoryboard(raw)
    if (parsed.ok) {
      return { storyboard: parsed.storyboard, meta: { attempts, degraded, modelClass: 'chat' } }
    }
    lastIssues = parsed.issues
    degraded.push(`attempt ${attempt}: schema rejected (${parsed.issues.length} issue(s))`)
  }

  logger.warn('jazmii.director_planner_failed', { attempts, issues: lastIssues.slice(0, 6) })
  throw new StoryboardPlannerError(
    `The Creative Director could not produce a valid storyboard after ${attempts} attempt(s): ${lastIssues[0] ?? 'no usable model response'}`,
    lastIssues,
  )
}

/**
 * Realistic storyboard repair when a user edits captions/timing: re-validate
 * the whole storyboard (duration accounting is re-checked). Returns the real
 * issues on failure.
 */
export function repairStoryboardAfterEdit(raw: unknown): { ok: true; storyboard: Storyboard } | { ok: false; issues: string[] } {
  return parseStoryboard(raw)
}

/** Constants re-exported for the service layer's bounds messages. */
export { FADE_DURATION_SEC, PRODUCTION_DURATION_MIN_SEC, PRODUCTION_DURATION_MAX_SEC, SCENE_DURATION_MIN_SEC, SCENE_DURATION_MAX_SEC }
