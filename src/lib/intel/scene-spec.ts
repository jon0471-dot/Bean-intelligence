/**
 * BEAN Intelligence — structured scene specification (LAXII image quality).
 *
 * Part B §1 of the RIISHE/LAXII work order: BEFORE generation, the prompt is
 * compiled into a structured SCENE SPECIFICATION that makes the implicit
 * explicit — subjects and their identities, subject count and anatomical
 * expectations, spatial layers (foreground/middle/background), camera
 * position, lighting direction/intensity/shadow behavior, color harmony,
 * materials and surface behavior, perspective/depth/scale, environmental
 * conditions, and physical interactions/contact points.
 *
 * Contracts (mirroring grounding.ts, do not weaken them):
 *  - The user's prompt stays VERBATIM and FIRST; this block is APPENDED
 *    guidance. It never rewrites, replaces or contradicts an explicit user
 *    directive — defaults fill ONLY fields the user did not state.
 *  - Deterministic compilation (microseconds, no model call, no network).
 *  - Bounded output (budget-checked by compileConditioning).
 *  - HONEST SCOPE: this is prompt-conditioning guidance for the model, not a
 *    physics engine and not a guarantee — the compiled spec makes physical
 *    expectations explicit, nothing claims it forces accurate pixels.
 */

import type { PromptUnderstanding } from './understanding'
import type { CinematographyDirectives } from './cinema'

export interface SceneSpecification {
  /** The rendered, bounded block ('' when nothing is worth saying). */
  block: string
  /** Structured view (persisted to resultJson.intel for auditability). */
  fields: Record<string, unknown>
}

/** Persons visible in the frame by anatomical expectation. */
const PERSON_SUBJECT_RE = /\b(man|men|woman|women|person|people|child|children|boy|girl|couple|portrait|soldier|worker|dancer|athlete|musician|chef|doctor|student|teacher|farmer|pilot|astronaut|knight|warrior|monk)\b/i

/** Material-specific surface guidance (one line each, conservative). */
const MATERIAL_SURFACE: Array<{ match: RegExp; line: string }> = [
  { match: /\bglass|crystal|window|pane|mirror\b/i, line: '- Glass: transparent; background objects seen through it shift/refract at the boundary; specular highlights trace its edges.' },
  { match: /\bwater|milk|honey|oil|juice|liquid|wine|coffee\b/i, line: '- Liquid: pours/falls under gravity, wets surfaces it touches, meniscus and glisten where it meets container walls.' },
  { match: /\bmetal|steel|chrome|copper|brass|alumini?um\b/i, line: '- Metal: reflects its actual surroundings; dents crease smoothly rather than shattering.' },
  { match: /\bwooden?|timber|plank\b/i, line: '- Wood: grain runs consistently; failure splits along fibers.' },
  { match: /\bcloth|fabric|silk|cotton|saree|sari|dress|shirt|jacket|cloak|flag|banner\b/i, line: '- Cloth: drapes by gravity, folds concentrate at bends, wind presses/lifts it along the airflow.' },
  { match: /\brubber|latex|elastic\b/i, line: '- Rubber: stretches with visible thinning; recovers with a short damped wobble.' },
  { match: /\bporcelain|ceramic|marble|concrete|stone\b/i, line: '- Rigid solids (ceramic/stone): crack along sharp lines; fragments fall under gravity.' },
]

/**
 * Compile the structured scene specification for an image generation.
 * Only fields with real signal (or an honest default where the model
 * benefits from one) are rendered; everything stays one line per idea.
 */
export function compileSceneSpecification(u: PromptUnderstanding, cinema: CinematographyDirectives): SceneSpecification {
  const lines: string[] = ['SCENE SPECIFICATION (compiled guidance; explicit user directives above always win):']
  const fields: Record<string, unknown> = {}

  // --- Subjects, count and anatomy expectations ---------------------------
  const subjects = [...new Set([...u.subjects, ...u.creatures])].slice(0, 4)
  if (subjects.length > 0 || u.subjectCount !== null) {
    const count = u.subjectCount ?? 1
    fields.subjects = subjects
    fields.subjectCount = u.subjectCount
    const anatomy: string[] = []
    if (PERSON_SUBJECT_RE.test(u.normalized)) {
      anatomy.push('every person has exactly two arms, two legs and five digits per hand')
    }
    if (u.creatures.some((c) => /bird|eagle|crow|hawk|falcon|owl|parrot|peacock|sparrow/.test(c))) {
      anatomy.push('every bird has two legs, two wings with flight-feather groups, and a beak (no mammal traits)')
    }
    if (u.creatures.some((c) => /tiger|lion|leopard|cat|dog|horse|elephant|fox|wolf|bear|deer|monkey/.test(c))) {
      anatomy.push('every four-legged animal has exactly four limbs of the correct species proportions')
    }
    lines.push(
      `- Subjects (${count}): ${subjects.join(', ')}.` +
        (count > 1 ? ' Keep each subject COMPLETE and consistent — count must stay exact, no duplicated or merged bodies.' : '') +
        (anatomy.length > 0 ? ` Anatomy: ${anatomy.join('; ')}.` : ''),
    )
  }

  // --- Spatial layers ------------------------------------------------------
  const statedLayers = u.spatialLayers
  fields.spatialLayers = statedLayers
  if (statedLayers.length > 0) {
    lines.push(`- Depth layering: ${statedLayers.join(', ')} as stated; foreground occludes background consistently and scale shrinks with distance.`)
  } else if (subjects.length > 0) {
    lines.push('- Depth layering: subject in the middle ground, one supporting foreground element at most, background softer and smaller-scaled.')
  }

  // --- Camera position (defaults only when the user did not set a shot) ----
  fields.camera = { shot: cinema.shotType, lens: cinema.lens, angle: cinema.perspective[0] ?? null }
  if (!cinema.shotType && !cinema.perspective.length) {
    lines.push('- Camera position: eye-level medium framing unless the subject scale suggests otherwise; horizon level.')
  }

  // --- Lighting direction, intensity and shadow behavior -------------------
  fields.lightingDirection = u.lightingDirection
  if (u.lightingDirection) {
    lines.push(`- Light direction: ${u.lightingDirection}. One coherent key; shadows fall OPPOSITE it with edge softness matching source size.`)
  } else if (cinema.lighting.length === 0) {
    lines.push('- Light direction: one key from upper-side (45°) with soft fill; shadows fall opposite the key and never point two ways.')
  }

  // --- Color harmony -------------------------------------------------------
  fields.colorCues = cinema.color
  if (cinema.color.length === 0 && u.materials.length === 0) {
    lines.push('- Color: one harmonious palette (analogous base + one complementary accent); consistent grade across the frame.')
  }

  // --- Materials and surface behavior --------------------------------------
  fields.materials = u.materials
  const materialLines = MATERIAL_SURFACE.filter((m) => m.match.test(u.normalized)).map((m) => m.line)
  lines.push(...materialLines.slice(0, 3))

  // --- Environment conditions ----------------------------------------------
  fields.environment = u.environment
  if (u.environment) lines.push(`- Environment: ${u.environment}.`)

  // --- Physical interactions and contact points ----------------------------
  const contacts: string[] = []
  if (/\b(sit\w*|stand\w*|kneel\w*|lean\w*|crouch\w*|lie\w*|lying|rest\w*)\b/i.test(u.normalized)) {
    contacts.push('body contact points carry weight visibly (seat/feet compress what they rest on)')
  }
  if (/\b(hold\w*|grip\w*|carry\w*|grab\w*|touch\w*|pull\w*|push\w*)\b/i.test(u.normalized)) {
    contacts.push('hands CLOSE around what they hold — fingers wrap, surfaces deform slightly at contact')
  }
  if (/\b(fall\w*|drop\w*|crash\w*|collid\w*|impact|hit\w*|strike\w*|break\w*|shatter\w*)\b/i.test(u.normalized)) {
    contacts.push('falling/broken pieces obey gravity and meet the surface ONCE, at the contact zone, with debris scattering from it')
  }
  if (/\b(pour\w*|fill\w*|splash\w*|spill\w*|flow\w*)\b/i.test(u.normalized)) {
    contacts.push('liquid contact: stream meets surface at one point, splashes outward, level rises where it collects')
  }
  if (/\b(ride|riding|sit on|on top of|perched|perch)\b/i.test(u.normalized)) {
    contacts.push('riding/perching contact compresses the support and balances under gravity')
  }
  fields.contactPoints = contacts
  if (contacts.length > 0) lines.push(`- Physical contact: ${contacts.join('; ')}.`)

  // Honest scope: guidance, not a guarantee.
  fields.scope = 'prompt-conditioning guidance, not a physics simulation'

  const block = lines.length > 1 ? lines.join('\n') : ''
  return { block, fields }
}
