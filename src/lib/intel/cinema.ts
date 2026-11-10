/**
 * BEAN Intelligence — cinematography and visual-grounding module (LAXII &
 * JAZMII).
 *
 * Understands the visual language of a prompt — shot sizes, camera movement,
 * lenses, depth of field, lighting set-ups, color treatment — and compiles
 * it into a compact structured conditioning block for the EXISTING image and
 * video models. Never sends a huge unstructured essay downstream (brief §5).
 *
 * Contracts:
 *  - User-explicit directives always win: extraction first, defaults only
 *    for the few fields a generation benefits from and the user did not set.
 *  - Deterministic keyword tables (microseconds, no model call). The tables
 *    are vocabulary coverage, NOT knowledge — factual scene grounding lives
 *    in world.ts + retrieval.
 *  - Output is bounded to a handful of lines.
 */

export interface CinematographyDirectives {
  /** Explicit shot sizes found ("close-up", "wide shot", "extreme close-up"). */
  shotType: string | null
  /** Camera movement found ("tracking shot", "dolly in", "crane up"). */
  cameraMove: string | null
  /** Lens / focal / DOF cues found ("85mm", "shallow depth of field"). */
  lens: string | null
  /** Lighting cues found ("golden hour", "rim light", "low-key"). */
  lighting: string[]
  /** Color treatment cues found ("teal and orange", "high contrast"). */
  color: string[]
  /** Composition cues ("rule of thirds", "symmetrical", "over-the-shoulder"). */
  composition: string[]
  /** POV / perspective cues ("pov", "first person", "dutch angle"). */
  perspective: string[]
}

export interface CinematographyMatch {
  directive: string
  signal: string
}

// ---------------------------------------------------------------------------
// Vocabulary tables (each entry: canonical phrase <- trigger regex)
// ---------------------------------------------------------------------------

interface VocabEntry {
  phrase: string
  re: RegExp
}

const SHOT_TYPES: VocabEntry[] = [
  { phrase: 'extreme close-up', re: /\b(extreme\s+close.?up|ecu|x?\s?cu)\b/i },
  { phrase: 'close-up', re: /\b(close.?up|closeup|headshot)\b/i },
  { phrase: 'medium shot', re: /\b(medium\s+shot|mid\s+shot|waist.?up|bust\s+shot)\b/i },
  { phrase: 'wide shot', re: /\b(wide\s+shot|long\s+shot|full\s+shot|establishing\s+shot|panorama|vista)\b/i },
  { phrase: 'extreme wide shot', re: /\b(extreme\s+wide|aerial\s+view|drone\s+shot|bird'?s?.eye\s+view)\b/i },
  { phrase: 'over-the-shoulder shot', re: /\b(over.?the.?shoulder|ots)\b/i },
  { phrase: 'POV shot', re: /\b(pov|point.of.view|first.person)\b/i },
]

const CAMERA_MOVES: VocabEntry[] = [
  { phrase: 'tracking shot (camera follows the subject)', re: /\b(track\w*\s+shot|follow\w*\s+shot|truck\w*\s+shot)\b/i },
  { phrase: 'dolly in (camera moves toward the subject)', re: /\b(dolly\s*in|push\s*in|zoom\s+in slowly)\b/i },
  { phrase: 'dolly out (camera moves away from the subject)', re: /\b(dolly\s*out|pull\s*out|zoom\s+out slowly)\b/i },
  { phrase: 'crane/jib move (camera rises or sweeps vertically)', re: /\b(crane|jib|boom\s+(up|down)|rise\s+up)\b/i },
  { phrase: 'pan (camera rotates horizontally)', re: /\b(pan\w*\s+(left|right|across|around)?|sweep\w*\s+(left|right))\b/i },
  { phrase: 'tilt (camera rotates vertically)', re: /\b(tilt\w*\s+(up|down)?)\b/i },
  { phrase: 'orbit (camera circles the subject)', re: /\b(orbit\w*|arc\s+shot|circle\w*\s+(the|around))\b/i },
  { phrase: 'handheld (small organic camera shake)', re: /\b(handheld|shaky\s+cam)\b/i },
  { phrase: 'static locked-off camera', re: /\b(static\s+(shot|camera)|locked.?off|tripod)\b/i },
]

const LENS_DOF: VocabEntry[] = [
  { phrase: 'shallow depth of field with soft background bokeh', re: /\b(bokeh|shallow\s+(depth\s+of\s+field|dof|focus)|creamy\s+background)\b/i },
  { phrase: 'deep focus (foreground and background both sharp)', re: /\b(deep\s+focus|deep\s+depth\s+of\s+field|everything\s+in\s+focus)\b/i },
  { phrase: 'telephoto compression (long lens)', re: /\b(telephoto|long\s+lens|\d{3,4}\s?mm)\b/i },
  { phrase: 'wide-angle lens with expanded perspective', re: /\b(wide.?angle|\d{2}\s?mm\s+lens|fisheye)\b/i },
  { phrase: 'macro lens (extreme small-subject detail)', re: /\b(macro\s+(lens|shot|photography)?)\b/i },
  { phrase: 'tilt-shift miniature perspective', re: /\b(tilt.?shift)\b/i },
]

const LIGHTING: VocabEntry[] = [
  { phrase: 'golden-hour sunlight (warm, low sun, long shadows)', re: /\b(golden\s*hour|sunset\s+light|sunrise\s+light|warm\s+evening\s+light)\b/i },
  { phrase: 'blue-hour twilight (cool, soft, dim ambient)', re: /\b(blue\s*hour|twilight|dusk\s+light|pre.?dawn)\b/i },
  { phrase: 'key light with soft fill (balanced studio look)', re: /\b(three.?point|key\s+light\s+and\s+fill|studio\s+lighting)\b/i },
  { phrase: 'rim/back light separating the subject from the background', re: /\b(rim\s+light|back\s?light\w*|hair\s+light|contour\s+light)\b/i },
  { phrase: 'low-key lighting (deep shadows, dramatic contrast)', re: /\b(low.?key|chiaroscuro|noir\s+lighting|dark\s+moody\s+lighting)\b/i },
  { phrase: 'high-key lighting (bright, airy, minimal shadows)', re: /\b(high.?key|bright\s+airy|soft\s+even\s+lighting)\b/i },
  { phrase: 'volumetric light rays through atmosphere', re: /\b(volumetric|god\s+ray\w*|light\s+shaft\w*|crepuscular|hazy\s+beams)\b/i },
  { phrase: 'hard direct light with crisp shadows', re: /\b(hard\s+light\w*|harsh\s+sunlight|direct\s+sun)\b/i },
  { phrase: 'natural available light', re: /\b(natural\s+light\w*|available\s+light|window\s+light)\b/i },
  { phrase: 'neon practical lights with colored spill', re: /\b(neon|practical\s+lights?|led\s+strip\w*)\b/i },
  { phrase: 'firelight (warm flickering source)', re: /\b(fire\s*light\w*|candle\w*light|torch\s+light|ember\s+glow)\b/i },
]

const COLOR: VocabEntry[] = [
  { phrase: 'complementary color scheme with warm/cool contrast', re: /\b(complement\w*\s+colou?rs?|teal\s+and\s+orange|warm\s+cool\s+contrast)\b/i },
  { phrase: 'analogous color palette (harmonious neighboring hues)', re: /\b(analogous\s+colou?rs?|harmonious\s+palette)\b/i },
  { phrase: 'monochrome palette', re: /\b(monochrome|black\s+and\s+white|b&w|greyscale|grayscale|desaturated)\b/i },
  { phrase: 'high-contrast cinematic grade', re: /\b(high\s+contrast|punchy\s+grade|crisp\s+contrast)\b/i },
  { phrase: 'pastel palette', re: /\b(pastel|soft\s+muted\s+colou?rs?)\b/i },
  { phrase: 'vibrant saturated palette', re: /\b(vibrant|saturated\s+colou?rs?|rich\s+colou?rs?)\b/i },
  { phrase: 'warm white balance', re: /\b(warm\s+white\s+balance|warm\s+tone\w*)\b/i },
  { phrase: 'cool white balance', re: /\b(cool\s+white\s+balance|cool\s+tone\w*)\b/i },
  // LAXII IMAGE QUALITY (2026-11-10, Part B §4): exposure/grading vocabulary.
  { phrase: 'documentary available-light grade (natural contrast, subtle film grain)', re: /\b(documentary\s+(?:look|grade|style)|available.?light\s+(?:look|grade)|photojournalis\w+)\b/i },
  { phrase: 'long-exposure light trails (moving lights streak, statics stay sharp)', re: /\b(long.?exposure|light.?trail\w*)\b/i },
  { phrase: 'moody underexposed grade (deep shadows, low ambient fill)', re: /\b(underexposed|moody\s+(?:grade|look)|dark\s+and\s+moody)\b/i },
  { phrase: 'bright airy overexposed grade (lifted shadows, gentle highlight rolloff)', re: /\b(overexposed|bright\s+and\s+airy|ethereal\s+(?:look|grade))\b/i },
  { phrase: 'vintage film grade (faded blacks, halation, period color cast)', re: /\b(vintage\s+(?:film|look|grade)|retro\s+(?:film|grade)|70s|80s\s+film\s+look)\b/i },
]

const COMPOSITION: VocabEntry[] = [
  { phrase: 'rule-of-thirds composition', re: /\b(rule\s+of\s+thirds)\b/i },
  { phrase: 'centered symmetrical composition', re: /\b(symmetr\w*|centered?\s+composition|dead.?center)\b/i },
  { phrase: 'leading lines guiding the eye to the subject', re: /\b(lead\w*\s+lines?)\b/i },
  { phrase: 'framed through a natural foreground element', re: /\b(frame\w*\s+(through|within)|natural\s+framing)\b/i },
  { phrase: 'negative space emphasizing the subject', re: /\b(negative\s+space|minimalist\s+composition)\b/i },
  { phrase: 'low angle looking up at the subject', re: /\b(low\s+angle|worm'?s?.eye|looking\s+up\s+at)\b/i },
  { phrase: 'high angle looking down on the subject', re: /\b(high\s+angle|looking\s+down\s+(on|at))\b/i },
  { phrase: 'dutch angle (tilted horizon, unease)', re: /\b(dutch\s+angle|canted\s+angle|tilted\s+horizon)\b/i },
]

// ---------------------------------------------------------------------------
// Extraction and compilation
// ---------------------------------------------------------------------------

function scanTable(table: VocabEntry[], text: string): Array<{ phrase: string; signal: string }> {
  const out: Array<{ phrase: string; signal: string }> = []
  for (const e of table) {
    const m = e.re.exec(text)
    if (m) out.push({ phrase: e.phrase, signal: m[0].toLowerCase() })
  }
  return out
}

/** Extract explicit visual-language directives from a prompt (deterministic). */
export function extractCinematography(prompt: string): CinematographyDirectives {
  const text = prompt.toLowerCase()
  const shots = scanTable(SHOT_TYPES, text)
  const moves = scanTable(CAMERA_MOVES, text)
  const lenses = scanTable(LENS_DOF, text)
  const lights = scanTable(LIGHTING, text)
  const colors = scanTable(COLOR, text)
  const comps = scanTable(COMPOSITION, text)
  return {
    shotType: shots[0]?.phrase ?? null,
    cameraMove: moves[0]?.phrase ?? null,
    lens: lenses[0]?.phrase ?? null,
    lighting: lights.map((l) => l.phrase).slice(0, 3),
    color: colors.map((c) => c.phrase).slice(0, 3),
    composition: comps.map((c) => c.phrase).slice(0, 3),
    perspective: comps.filter((c) => /angle|pov|point of view|first person/i.test(c.phrase)).map((c) => c.phrase).slice(0, 2),
  }
}

/**
 * Compile a compact camera/lighting/color conditioning block.
 * `defaults` fills ONLY what the user did not specify; explicit directives
 * are rendered verbatim-first. For video, movement defaults to a gentle
 * static-plus-subtle-move so short clips stay stable (a fast random move
 * destroys short-clip coherence).
 */
export function renderCinematographyBlock(d: CinematographyDirectives, product: 'laxii' | 'jazmii'): string {
  const lines: string[] = []
  const shot = d.shotType ?? (product === 'jazmii' ? 'medium shot' : 'balanced medium framing')
  const move = product === 'jazmii' ? (d.cameraMove ?? 'static camera with a very subtle slow push-in') : null
  lines.push(`CAMERA & LIGHT:`)
  lines.push(`- Shot: ${shot}.`)
  if (move) lines.push(`- Camera: ${move}.`)
  if (d.lens) lines.push(`- Lens/DOF: ${d.lens}.`)
  const light = d.lighting.length > 0 ? d.lighting.join('; ') : 'natural directional key light with soft fill'
  lines.push(`- Lighting: ${light}.`)
  if (d.color.length > 0) lines.push(`- Color: ${d.color.join('; ')}.`)
  if (d.composition.length > 0) lines.push(`- Composition: ${d.composition.join('; ')}.`)
  lines.push(`- Keep one coherent light direction, true shadows and consistent exposure.`)
  return lines.join('\n')
}

/**
 * Shot-continuity directives for JAZMII follow-up shots (brief §6): the
 * next shot inherits the previous shot's state unless the user overrides.
 */
export function renderContinuityDirectives(prev: {
  shotType?: string | null
  lighting?: string[]
  color?: string[]
  cameraMove?: string | null
}): string {
  const lines = ['SHOT CONTINUITY:']
  if (prev.shotType) lines.push(`- Maintain the previous shot's framing scale (${prev.shotType}) unless the user requests a change.`)
  if (prev.lighting?.length) lines.push(`- Preserve lighting: ${prev.lighting.join('; ')}.`)
  if (prev.color?.length) lines.push(`- Preserve color grade: ${prev.color.join('; ')}.`)
  lines.push(`- Keep the subject's identity, outfit, size and position continuous with the previous shot's final state.`)
  return lines.join('\n')
}
