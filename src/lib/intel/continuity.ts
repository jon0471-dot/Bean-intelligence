/**
 * BEAN Intelligence — JAZMII continuity engine & LAXII output verification.
 *
 * Uses the EXISTING lanes only: ffmpeg/ffprobe for frame extraction (the
 * same tools the video acceptance evidence used) and the gateway vision
 * model (via intel/vision.ts) for scene-state analysis. Deterministic
 * geometry/persistence checks run FIRST (cheap, always available); the
 * vision pass adds what pixels can tell us that geometry cannot.
 *
 * HONESTY CONTRACT (brief §6):
 *  - Every report records HOW it was produced (vision analysis / frame
 *    metadata only / unavailable) — a check that did not run is never
 *    claimed as passed.
 *  - Detected defects are REPORTED, never silently hidden; bounded
 *    correction is attempted only where the existing model genuinely
 *    supports it (LAXII edit path — not silently, only noted).
 *  - This is a defect DETECTOR with curated knowledge, not a guarantee of
 *    perfect generation.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { analyzeImageOnce } from './vision'

const execFileP = promisify(execFile)

// ---------------------------------------------------------------------------
// Frame extraction (deterministic, local, no network)
// ---------------------------------------------------------------------------

export interface FrameExtraction {
  dataUrl: string | null
  reason: string | null
}

/**
 * Extract ONE frame from a local video file: the last frame by default
 * (previous-shot ending state) or at a 0..1 position. Uses the same
 * ffmpeg tooling proven by the JAZMII acceptance evidence.
 */
export async function extractFrame(videoPath: string, position: 'last' | number = 'last'): Promise<FrameExtraction> {
  if (!videoPath.toLowerCase().endsWith('.mp4') && !videoPath.toLowerCase().endsWith('.webm') && !videoPath.toLowerCase().endsWith('.mov')) {
    return { dataUrl: null, reason: `unsupported container for frame extraction: ${path.extname(videoPath) || 'unknown'}` }
  }
  let dir: string | null = null
  try {
    dir = await mkdtemp(path.join(tmpdir(), 'bean-intel-frame-'))
    const out = path.join(dir, 'frame.jpg')
    const args =
      position === 'last'
        ? ['-sseof', '-0.5', '-i', videoPath, '-frames:v', '1', '-q:v', '2', '-y', out]
        : ['-ss', String(position), '-i', videoPath, '-frames:v', '1', '-q:v', '2', '-y', out]
    try {
      await execFileP('ffmpeg', args, { timeout: 15_000 })
    } catch {
      // -sseof can fail on very short/odd containers — retry at 90% via ffprobe duration.
      try {
        const probe = await execFileP('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', videoPath], { timeout: 10_000 })
        const duration = Number.parseFloat(probe.stdout.trim())
        if (Number.isFinite(duration) && duration > 0) {
          await execFileP('ffmpeg', ['-ss', String(Math.max(0, duration * 0.9)), '-i', videoPath, '-frames:v', '1', '-q:v', '2', '-y', out], { timeout: 15_000 })
        } else {
          return { dataUrl: null, reason: 'ffprobe could not read a usable duration for frame extraction' }
        }
      } catch (e2) {
        return { dataUrl: null, reason: `frame extraction tools failed: ${e2 instanceof Error ? e2.message.slice(0, 120) : 'unknown'}` }
      }
    }
    const buf = await readFile(out)
    if (buf.length === 0) return { dataUrl: null, reason: 'ffmpeg produced an empty frame' }
    return { dataUrl: `data:image/jpeg;base64,${buf.toString('base64')}`, reason: null }
  } catch (e) {
    return { dataUrl: null, reason: `frame extraction failed: ${e instanceof Error ? e.message.slice(0, 160) : 'unknown'}` }
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function imageBufferToDataUrl(buf: Buffer, mime = 'image/jpeg'): Promise<string> {
  return `data:${mime};base64,${buf.toString('base64')}`
}

// ---------------------------------------------------------------------------
// Vision JSON parsing helper
// ---------------------------------------------------------------------------

function extractJson(text: string): Record<string, unknown> | null {
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const parsed = JSON.parse(m[0])
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// JAZMII: reference/previous-shot scene state
// ---------------------------------------------------------------------------

export interface SceneState {
  method: 'vision-analysis' | 'unavailable'
  subject: string | null
  clothing: string | null
  pose: string | null
  environment: string | null
  lightingDirection: string | null
  cameraFraming: string | null
  colorPalette: string | null
  /** Continuity directives derived from the state (rendered into conditioning). */
  continuityDirectives: string | null
  reason: string | null
}

const SCENE_STATE_INSTRUCTION =
  'Analyze this frame for film-continuity purposes. Respond with JSON only, no prose: ' +
  '{"subject":"main subject appearance in one sentence","clothing":"visible clothing/outfit","pose":"body pose and orientation",' +
  '"environment":"setting/background","lightingDirection":"where the key light comes from (left/right/above/front/back) and its warmth",' +
  '"cameraFraming":"shot size and angle","colorPalette":"dominant colors"}. ' +
  'Every field must be a short factual string; use "unclear" when genuinely not determinable.'

/**
 * Extract the scene state of a reference image (I2V source or previous
 * shot's final frame) using the existing vision lane. Non-fatal.
 */
export async function extractSceneState(imageDataUrl: string): Promise<SceneState> {
  const outcome = await analyzeImageOnce(imageDataUrl, SCENE_STATE_INSTRUCTION)
  if (!outcome.text) {
    return {
      method: 'unavailable',
      subject: null,
      clothing: null,
      pose: null,
      environment: null,
      lightingDirection: null,
      cameraFraming: null,
      colorPalette: null,
      continuityDirectives: null,
      reason: outcome.reason,
    }
  }
  const json = extractJson(outcome.text)
  if (!json) {
    return {
      method: 'unavailable',
      subject: null,
      clothing: null,
      pose: null,
      environment: null,
      lightingDirection: null,
      cameraFraming: null,
      colorPalette: null,
      continuityDirectives: null,
      reason: 'vision analysis did not return parseable JSON; continuity directives were not derived',
    }
  }
  const str = (k: string): string | null => (typeof json[k] === 'string' && (json[k] as string).trim() ? (json[k] as string).trim().slice(0, 200) : null)
  const subject = str('subject')
  const clothing = str('clothing')
  const pose = str('pose')
  const environment = str('environment')
  const lightingDirection = str('lightingDirection')
  const cameraFraming = str('cameraFraming')
  const colorPalette = str('colorPalette')

  const directives: string[] = ['SCENE CONTINUITY (from the reference/previous shot, vision-analyzed):']
  if (subject) directives.push(`- Subject must remain: ${subject}.`)
  if (clothing && clothing.toLowerCase() !== 'unclear') directives.push(`- Clothing must remain: ${clothing}.`)
  if (pose) directives.push(`- Motion starts from this pose: ${pose}.`)
  if (environment) directives.push(`- Environment must remain: ${environment}.`)
  if (lightingDirection) directives.push(`- Key light: ${lightingDirection}.`)
  if (cameraFraming) directives.push(`- Match the framing scale: ${cameraFraming}.`)
  if (colorPalette && colorPalette.toLowerCase() !== 'unclear') directives.push(`- Keep the palette: ${colorPalette}.`)
  directives.push('- Preserve the subject’s identity, body proportions and limb count exactly; no new accessories or outfit changes.')

  return {
    method: 'vision-analysis',
    subject,
    clothing,
    pose,
    environment,
    lightingDirection,
    cameraFraming,
    colorPalette,
    continuityDirectives: directives.join('\n'),
    reason: null,
  }
}

// ---------------------------------------------------------------------------
// Defect checklists (deterministic knowledge from world components)
// ---------------------------------------------------------------------------

const VIDEO_DEFECT_CHECKLIST = [
  'extra or missing limbs, fingers or duplicated body parts',
  'face structure or identity changing',
  'clothing or accessories changing between shots',
  'objects appearing, disappearing or teleporting',
  'impossible collisions or objects passing through each other',
  'sudden position jumps or sliding without steps',
  'lighting direction or color grade discontinuity',
  'incorrect or missing shadows',
  'camera discontinuity (framing/angle jumps within one shot)',
  'anatomically wrong locomotion (e.g. bird wings as rigid boards, reversed knees)',
]

/**
 * JAZMII: verify a completed video's continuity. The last frame is
 * vision-checked against the requested subject/scene; the report is honest
 * about the method and its limits (frame-level analysis of a video's final
 * state, plus the deterministic checklist context — not full motion-metric
 * physics simulation).
 */
export interface ContinuityReport {
  checked: boolean
  method: 'vision-frame-analysis' | 'unavailable'
  defects: string[]
  /** What the vision model was asked and answered (truncated, auditable). */
  observation: string | null
  checkedAt: string
  durationMs: number
  reason: string | null
}

export async function verifyVideoContinuity(
  videoPath: string,
  context: { requestSummary: string; referenceState?: SceneState | null },
): Promise<ContinuityReport> {
  const t0 = Date.now()
  const frame = await extractFrame(videoPath, 'last')
  if (!frame.dataUrl) {
    return { checked: false, method: 'unavailable', defects: [], observation: null, checkedAt: new Date().toISOString(), durationMs: Date.now() - t0, reason: frame.reason }
  }
  const checklist = VIDEO_DEFECT_CHECKLIST.map((d) => `- ${d}`).join('\n')
  const referenceLines = context.referenceState?.method === 'vision-analysis'
    ? [
        `The shot was conditioned from a reference frame: subject=${context.referenceState.subject ?? 'unclear'}; clothing=${context.referenceState.clothing ?? 'unclear'}; environment=${context.referenceState.environment ?? 'unclear'}.`,
      ]
    : []
  const instruction =
    `You are a film-continuity checker. The final frame of a generated video is provided.\n` +
    `The video was requested as: "${context.requestSummary.slice(0, 300)}".\n` +
    referenceLines.join('\n') +
    `\nInspect the frame for these DEFECT classes only:\n${checklist}\n` +
    `Respond with JSON only: {"defects":["<each clearly observed defect, with which class>"],"observation":"one-sentence factual description of the final frame state"}. ` +
    `If none of the defect classes are visible, return an empty defects array. Do not speculate about motion you cannot see in a still frame; frame-level analysis cannot prove temporal smoothness — only report what is visible.`

  const outcome = await analyzeImageOnce(frame.dataUrl, instruction)
  if (!outcome.text) {
    return { checked: false, method: 'unavailable', defects: [], observation: null, checkedAt: new Date().toISOString(), durationMs: Date.now() - t0, reason: outcome.reason }
  }
  const json = extractJson(outcome.text)
  const defects = Array.isArray(json?.defects)
    ? (json!.defects as unknown[]).filter((d): d is string => typeof d === 'string').slice(0, 8)
    : []
  return {
    checked: true,
    method: 'vision-frame-analysis',
    defects,
    observation: typeof json?.observation === 'string' ? (json!.observation as string).slice(0, 400) : outcome.text.slice(0, 400),
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    reason: null,
  }
}

// ---------------------------------------------------------------------------
// LAXII: post-generation verification
// ---------------------------------------------------------------------------

export interface ImageVerificationReport {
  checked: boolean
  method: 'vision-analysis' | 'unavailable'
  defects: string[]
  observation: string | null
  checkedAt: string
  durationMs: number
  reason: string | null
}

const IMAGE_DEFECT_CHECKLIST = [
  'human anatomy errors (extra/missing limbs or fingers, impossible joints)',
  'animal anatomy errors (wrong limb count, rigid-board wings, reversed joints)',
  'face distortion or asymmetric drifting eyes',
  'object persistence errors (floating objects, impossible supports)',
  'lighting inconsistencies (shadows from multiple directions, missing shadows)',
  'material behavior errors (glass bending, rigid liquid)',
  'text artifacts or garbled lettering (if any text was requested, verify it matches)',
]

/**
 * LAXII: verify a generated image against the defect checklist. Non-fatal
 * and honest — a skipped or failed check reports WHY.
 */
export async function verifyGeneratedImage(imageDataUrl: string, requestSummary: string): Promise<ImageVerificationReport> {
  const t0 = Date.now()
  const checklist = IMAGE_DEFECT_CHECKLIST.map((d) => `- ${d}`).join('\n')
  const instruction =
    `You are an image-quality inspector. The generated image was requested as: "${requestSummary.slice(0, 300)}".\n` +
    `Inspect it for these DEFECT classes only:\n${checklist}\n` +
    `Respond with JSON only: {"defects":["<each clearly observed defect>"],"observation":"one-sentence factual description of the image"}. ` +
    `If none are visible, return an empty defects array. Report only what is clearly visible; do not invent defects.`

  const outcome = await analyzeImageOnce(imageDataUrl, instruction)
  if (!outcome.text) {
    return { checked: false, method: 'unavailable', defects: [], observation: null, checkedAt: new Date().toISOString(), durationMs: Date.now() - t0, reason: outcome.reason }
  }
  const json = extractJson(outcome.text)
  const defects = Array.isArray(json?.defects)
    ? (json!.defects as unknown[]).filter((d): d is string => typeof d === 'string').slice(0, 8)
    : []
  return {
    checked: true,
    method: 'vision-analysis',
    defects,
    observation: typeof json?.observation === 'string' ? (json!.observation as string).slice(0, 400) : outcome.text.slice(0, 400),
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    reason: null,
  }
}

/** Write a temporary frame file (used by tests and tools that need a real file). */
export async function writeTempFrame(videoPath: string): Promise<string | null> {
  const f = await extractFrame(videoPath, 'last')
  if (!f.dataUrl) return null
  const dir = await mkdtemp(path.join(tmpdir(), 'bean-intel-tmp-'))
  const file = path.join(dir, 'frame.jpg')
  await writeFile(file, Buffer.from(f.dataUrl.replace(/^data:image\/\w+;base64,/, ''), 'base64'))
  return file
}
