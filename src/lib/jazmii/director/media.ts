/**
 * BEAN Intelligence — JAZMII Auto Director: media preparation + deliverables.
 *
 * Reuses the EXISTING JAZMII media conventions:
 *  - storage lives under storage/jazmii/<userId>/ (the same root the video
 *    worker writes generated clips to) — productions add
 *    productions/<id>/{raw,clips,audio,composition,final};
 *  - validation is REAL ffprobe stream probing (media/ffprobe.ts), the same
 *    gate every delivered JAZMII video passes.
 *
 * Preparation contract (spec §8):
 *  - original generated clips are NEVER overwritten — raw/ keeps the provider
 *    output verbatim, clips/ holds normalized intermediates;
 *  - normalization is contain + background fill (deliberate reframing), never
 *    a silent stretch to the destination aspect ratio;
 *  - every normalized clip is re-probed; dimension/duration deviations are
 *    reported, never silently accepted.
 *
 * SERVER-ONLY.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, writeFile } from 'node:fs/promises'
import fs from 'node:fs'
import path from 'node:path'
import { probeVideoFile } from '@/lib/media/ffprobe'
import { logger } from '@/lib/observability/logger'
import type { Storyboard } from './schema'

const execFileP = promisify(execFile)

export const STORAGE_ROOT = path.join(process.cwd(), 'storage', 'jazmii')

/** Absolute production workspace for one user's production. */
export function productionDir(userId: string, productionId: string): string {
  return path.join(STORAGE_ROOT, userId, 'productions', productionId)
}

/** Storage-relative form (what the DB rows persist — never absolute paths). */
export function storageRelative(absPath: string): string {
  return path.relative(STORAGE_ROOT, absPath).split(path.sep).join('/')
}

export function absoluteFromStorage(rel: string): string {
  return path.join(STORAGE_ROOT, rel)
}

export interface NormalizeResult {
  ok: boolean
  clipPath: string | null
  probeJson: string | null
  error: string | null
  notes: string[]
}

/**
 * Normalize one generated scene clip to the composition canvas:
 * contain + background fill, target fps (cfr), exact trim to the planned
 * duration, muted (the music bed carries audio), H.264 yuv420p.
 */
export async function normalizeSceneClip(
  rawAbsPath: string,
  outAbsPath: string,
  canvas: { width: number; height: number; fps: number },
  plannedDurationSec: number,
  background: string,
): Promise<NormalizeResult> {
  const notes: string[] = []
  try {
    // Honest source accounting BEFORE normalization: a provider clip shorter
    // than the planned scene duration is padded by HOLDING ITS FINAL FRAME
    // (deterministic) — the storyboard timeline stays exact and the
    // shortfall is reported, never silently stretched or dropped.
    const srcProbe = await probeVideoFile(rawAbsPath, 30_000)
    if (srcProbe.ok && srcProbe.video && srcProbe.video.durationSec < plannedDurationSec - 0.1) {
      notes.push(
        `scene clip source measures ${srcProbe.video.durationSec.toFixed(2)}s vs the planned ${plannedDurationSec}s — its final frame is held to preserve the exact timeline`,
      )
    } else if (srcProbe.ok && srcProbe.video && srcProbe.video.durationSec > plannedDurationSec + 0.1) {
      notes.push(
        `generated at the provider's supported length (${srcProbe.video.durationSec.toFixed(2)}s) — trimmed to the planned ${plannedDurationSec}s of the storyboard timeline`,
      )
    }
    await mkdir(path.dirname(outAbsPath), { recursive: true })
    const args = [
      '-y', '-hide_banner', '-loglevel', 'error', '-nostdin',
      '-i', rawAbsPath,
      '-vf',
      `scale=${canvas.width}:${canvas.height}:force_original_aspect_ratio=decrease,` +
        `pad=${canvas.width}:${canvas.height}:(ow-iw)/2:(oh-ih)/2:color=${background},` +
        `fps=${canvas.fps},setsar=1,` +
        `tpad=stop_mode=clone:stop_duration=${Math.max(0, plannedDurationSec).toFixed(3)},` +
        `trim=duration=${plannedDurationSec},setpts=PTS-STARTPTS`,
      '-an',
      '-c:v', 'libx264', '-preset', canvas.width * canvas.height >= 1_500_000 ? 'veryfast' : 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
      '-r', String(canvas.fps), '-fps_mode', 'cfr',
      '-video_track_timescale', '90000',
      '-movflags', '+faststart',
      outAbsPath,
    ]
    await execFileP('ffmpeg', args, { timeout: 5 * 60_000, maxBuffer: 8_000_000 })
  } catch (e) {
    const err = e as { stderr?: string; killed?: boolean; message?: string }
    return {
      ok: false,
      clipPath: null,
      probeJson: null,
      error: err.killed
        ? 'scene normalization exceeded its time limit'
        : `ffmpeg normalization failed: ${(err.stderr ?? err.message ?? 'unknown').slice(0, 240)}`,
      notes,
    }
  }

  const probe = await probeVideoFile(outAbsPath, 30_000)
  if (!probe.ok || !probe.video) {
    return { ok: false, clipPath: null, probeJson: null, error: `normalized clip failed stream validation: ${probe.error ?? 'unknown'}`, notes }
  }
  const v = probe.video
  const expectedFrames = Math.round(plannedDurationSec * canvas.fps)
  if (v.width !== canvas.width || v.height !== canvas.height) {
    notes.push(`normalized clip is ${v.width}x${v.height}, expected ${canvas.width}x${canvas.height}`)
  }
  if (Math.abs(v.durationSec - plannedDurationSec) > 0.35) {
    notes.push(`normalized clip measures ${v.durationSec.toFixed(2)}s, planned ${plannedDurationSec}s`)
  }
  if (v.frames !== null && v.frames !== expectedFrames) {
    notes.push(`normalized clip has ${v.frames} frames, expected ${expectedFrames}`)
  }
  return {
    ok: true,
    clipPath: outAbsPath,
    probeJson: JSON.stringify({ stream: v, audio: probe.audio ?? null, measuredAt: new Date().toISOString() }),
    error: null,
    notes,
  }
}

/** Probe facts of any local media file (honest wrapper). */
export async function probeClip(absPath: string) {
  const probe = await probeVideoFile(absPath, 30_000)
  if (!probe.ok || !probe.video) return null
  return { stream: probe.video, audio: probe.audio ?? null }
}

// ---- deliverable files (BRAG-inspired output set) ---------------------------

export function renderStoryboardJson(sb: Storyboard): string {
  return JSON.stringify(sb, null, 2)
}

/**
 * The JAZMII production plan — the honest equivalent of BRAG's brag-plan.md:
 * the approved storyboard rendered as readable markdown the owner can keep.
 */
export function renderProductionPlan(sb: Storyboard, meta: { productionId: string; engine: string; approvedAt: string }): string {
  const lines: string[] = []
  lines.push(`# ${sb.title}`)
  lines.push('')
  lines.push(`> JAZMII Auto Director production \`${meta.productionId}\` — storyboard approved ${meta.approvedAt}, composed by the ${meta.engine} engine.`)
  lines.push('')
  lines.push(`**Objective:** ${sb.objective}`)
  if (sb.audience) lines.push(`**Audience:** ${sb.audience}`)
  lines.push(`**Creative mode:** ${sb.tone}`)
  if (sb.platform) lines.push(`**Target platform:** ${sb.platform}`)
  lines.push(`**Format:** ${sb.format} (${sb.width}x${sb.height} @ ${sb.fps}fps)`)
  lines.push(`**Planned duration:** ${sb.durationSeconds}s across ${sb.scenes.length} scenes`)
  lines.push(`**Visual direction:** ${sb.visualDirection}`)
  if (sb.musicDirection) lines.push(`**Music direction:** ${sb.musicDirection}`)
  lines.push(`**Voiceover intent:** ${sb.voiceover ? 'declared (realized only from a user-supplied narration track)' : 'none'} `)
  lines.push('')
  lines.push('## Scene-by-scene storyboard')
  lines.push('')
  let t = 0
  sb.scenes.forEach((s, i) => {
    const next = i < sb.scenes.length - 1 ? s.transitionOut : 'end card'
    lines.push(`### Scene ${i + 1} — ${s.purpose} — ${s.durationSeconds}s (timeline ${t.toFixed(0)}s–${(t + s.durationSeconds).toFixed(0)}s)`)
    lines.push(`${s.visualDescription}`)
    lines.push(`- Generation prompt: ${s.generationPrompt}`)
    if (s.cameraDirection) lines.push(`- Camera/motion: ${s.cameraDirection}`)
    if (s.caption) lines.push(`- Caption: "${s.caption}"`)
    lines.push(`- Handover: ${next}`)
    if (s.audioDirection) lines.push(`- Audio intent: ${s.audioDirection}`)
    lines.push('')
    t += s.durationSeconds
  })
  lines.push('## Honest limitations of this build')
  lines.push('')
  lines.push('- Scene clips are generated by the existing JAZMII video backend (3–12s per shot); cross-scene character/scene continuity is NOT guaranteed and never claimed.')
  lines.push('- Transitions are implemented as exact-timeline cuts or dips through the background color.')
  lines.push('- A successful ffprobe validation proves media structure (codec, dimensions, duration, frames), not creative quality.')
  lines.push('- Voiceover is mixed only from a user-supplied narration track; nothing is auto-narrated.')
  lines.push('')
  return lines.join('\n')
}

/** Share copy (BRAG rule: 1–3 sentences, specific, no generic SaaS language). */
export function renderShareCopy(sb: Storyboard): string {
  const hook = sb.scenes[0]?.caption ?? sb.scenes[0]?.visualDescription ?? ''
  const payoff = sb.scenes[sb.scenes.length - 1]?.caption ?? sb.objective
  const hookLine = hook.length > 0 ? hook.slice(0, 90) : sb.title
  const body = `${sb.title} — ${sb.objective}`
  const cta = payoff.length > 0 && payoff !== hook ? ` ${payoff.slice(0, 90)}` : ''
  return `${hookLine}\n\n${body}${cta}\n`.replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

export interface RenderMetadataInput {
  productionId: string
  engine: string
  engineNotes: string[]
  plannedDurationSec: number
  measured: { width: number; height: number; durationSec: number; frames: number | null; fps: number | null; codec: string; bytes: number }
  audio: { music: boolean; voiceover: boolean; attribution: string | null }
  scenes: Array<{ idx: number; status: string; assetProbe: unknown }>
  generatedAt: string
}

export async function writeDeliverables(
  finalDir: string,
  files: {
    storyboard: Storyboard
    plan: string
    shareCopy: string
    renderMetadata: RenderMetadataInput
  },
): Promise<void> {
  await mkdir(finalDir, { recursive: true })
  await writeFile(path.join(finalDir, 'storyboard.json'), renderStoryboardJson(files.storyboard), 'utf8')
  await writeFile(path.join(finalDir, 'production-plan.md'), files.plan, 'utf8')
  await writeFile(path.join(finalDir, 'share-copy.txt'), files.shareCopy, 'utf8')
  await writeFile(path.join(finalDir, 'render-metadata.json'), JSON.stringify(files.renderMetadata, null, 2), 'utf8')
}

export function dirSizeOk(bytes: number): boolean {
  // Composition workspace guard — keep renders inside the ₹0 disk budget.
  return bytes < 2 * 1024 * 1024 * 1024
}

/** Production workspace disk usage (bytes). */
export function dirUsage(dir: string): number {
  let total = 0
  const walk = (d: string) => {
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else {
        try {
          total += fs.statSync(p).size
        } catch {
          /* vanished mid-walk */
        }
      }
    }
  }
  walk(dir)
  return total
}

export function logPrep(productionId: string, event: string, data: Record<string, unknown> = {}): void {
  logger.info(`jazmii.director_${event}`, { productionId, ...data })
}
