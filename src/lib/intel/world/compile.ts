/**
 * BEAN Intelligence — grounding compilation (Part 4/6/7 of the work order):
 * turn a ScenePlan (+ optional retrieved evidence) into the conditioning a
 * generator can actually consume.
 *
 * Compilation rules (honesty contract):
 *  - The user's prompt is preserved VERBATIM and leads the compiled prompt.
 *    Grounding APPENDS constraint clauses; it never rewrites user intent.
 *  - The conditioning is compact (bounded char budget) — grounded prompts
 *    must not drown the user's intent.
 *  - Generation models are English-strongest: constraints are compiled in
 *    English while the user's original words stay untouched. The user's
 *    language is noted in metadata, not silently translated.
 *  - The output explicitly separates: user content, world-grounding
 *    constraints, and (when present) retrieved factual knowledge with its
 *    sources. Deterministic masking/compositing is NEVER described as
 *    generative editing (that stays the existing preservation engine's job).
 */

import type { ScenePlan } from './analyze'
import { buildMotionTimeline, serializeTimeline, type MotionTimeline } from './motion'

export interface GroundedImagePrompt {
  /** user prompt + compiled grounding constraints (what the provider gets). */
  finalPrompt: string
  /** User's original words, untouched. */
  originalPrompt: string
  /** Constraint clauses that were appended. */
  appliedConstraints: string[]
  /** Structured plan persisted in job metadata for evaluation. */
  plan: {
    subjects: string[]
    modules: string[]
    motionVerbs: string[]
    environment: string | null
    lighting: string | null
    weather: string | null
    language: string
    confidence: number
  }
  notes: string[]
}

/** Max chars of constraint text appended to a generation prompt. */
const MAX_CONSTRAINT_CHARS = 700

/**
 * Compile a grounded IMAGE generation prompt.
 */
export function compileGroundedImagePrompt(scene: ScenePlan, evidence?: { facts: string[]; sources: string[] }): GroundedImagePrompt {
  const constraints: string[] = []
  let used = 0
  for (const c of scene.constraints) {
    if (used + c.length + 2 > MAX_CONSTRAINT_CHARS) break
    constraints.push(c)
    used += c.length + 2
  }

  const parts: string[] = [scene.originalPrompt]
  if (constraints.length > 0) {
    parts.push(`Physical grounding: ${constraints.join('; ')}.`)
  }
  if (scene.lighting && !new RegExp(scene.lighting.slice(0, 24), 'i').test(scene.originalPrompt)) {
    parts.push(`Lighting: ${scene.lighting}.`)
  }
  if (scene.cameraCues.length > 0) {
    parts.push(`Framing: ${scene.cameraCues[0]}.`)
  }
  if (evidence && evidence.facts.length > 0) {
    // Retrieved facts are labeled with their sources — never blended into
    // the model's own knowledge.
    parts.push(`Reference facts (${evidence.sources.slice(0, 3).join(', ')}): ${evidence.facts.slice(0, 3).join(' ')}`)
  }

  return {
    finalPrompt: parts.join(' '),
    originalPrompt: scene.originalPrompt,
    appliedConstraints: constraints,
    plan: {
      subjects: scene.subjects.map((s) => s.class),
      modules: scene.modules.map((m) => m.id),
      motionVerbs: scene.motionVerbs,
      environment: scene.environment,
      lighting: scene.lighting,
      weather: scene.weather,
      language: scene.language.primary,
      confidence: scene.confidence,
    },
    notes: scene.notes,
  }
}

export interface GroundedVideoPrompt {
  /** user prompt + motion timeline + constraints (what the provider gets). */
  finalPrompt: string
  originalPrompt: string
  timeline: MotionTimeline
  appliedConstraints: string[]
  plan: GroundedImagePrompt['plan']
  notes: string[]
}

/**
 * Compile a grounded VIDEO prompt: scene plan + motion timeline folded into
 * the text conditioning the provider actually supports (text prompt), plus
 * the timeline as structured metadata for evaluation.
 */
export function compileGroundedVideoPrompt(scene: ScenePlan, durationSec = 5): GroundedVideoPrompt {
  const timeline = buildMotionTimeline(scene, durationSec)
  const groundedImage = compileGroundedImagePrompt(scene)
  const serialized = serializeTimeline(timeline)

  const parts = [groundedImage.finalPrompt, `Motion timeline: ${serialized}`]
  const finalPrompt = parts.join(' ')

  return {
    finalPrompt,
    originalPrompt: scene.originalPrompt,
    timeline,
    appliedConstraints: groundedImage.appliedConstraints,
    plan: groundedImage.plan,
    notes: [
      ...scene.notes,
      // Honesty: the grounding layer does NOT generate video.
      'Grounding produced conditioning only — video generation is performed by the video model.',
    ],
  }
}
