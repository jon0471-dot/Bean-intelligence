/**
 * BEAN Intelligence — JAZMII Auto Director: FFmpeg composition engine.
 *
 * The ALWAYS-AVAILABLE local composition path (zero external services, ₹0):
 * scene clips are re-asserted to the canvas (contain + background fill —
 * never stretched), chained with real transitions, captions are rendered as
 * readable timed text, the closing brand card is a deterministic color source,
 * and user-supplied audio is mixed with BRAG-style fades. Everything runs in
 * ONE ffmpeg invocation (single encode, no generation loss between steps).
 *
 * Determinism contract:
 *  - every input is trimmed to its planned duration and normalized to the
 *    canvas fps (cfr), so the expected frame count is EXACTLY
 *    round(duration * fps) per scene — the final file is re-probed and any
 *    deviation is reported honestly, never silently accepted;
 *  - no random elements, no timestamps in output metadata.
 *
 * Honest limits (stated, not hidden):
 *  - 'fade' is a dip through the background color (a true dissolve needs
 *    overlapping timelines, which would break the exact duration accounting
 *    the storyboard guarantees);
 *  - captions are plain readable text (no kinetic typography);
 *  - when no audio track is supplied the final file has NO audio stream and
 *    the deliverable metadata says exactly that.
 *
 * SERVER-ONLY.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, writeFile } from 'node:fs/promises'
import fs from 'node:fs'
import path from 'node:path'
import { probeVideoFile, probeAudioDurationSec } from '@/lib/media/ffprobe'
import { FADE_DURATION_SEC } from '../schema'
import { buildDynamicDuckPlan, duckPlanToVolumeFilter } from '@/lib/gangzii/ducking'
import type { CompositionEngine, CompositionPlan, CompositionResult } from './types'

const execFileP = promisify(execFile)

const COMPOSE_TIMEOUT_MS = Number(process.env.JAZMII_DIRECTOR_COMPOSE_TIMEOUT_MS ?? 10 * 60_000)
const POSTER_TIMEOUT_MS = 30_000

/** Candidate fixed font paths (DejaVu family ships with the base image). */
const FONT_CANDIDATES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
]

function resolveFontFile(): string | null {
  for (const p of FONT_CANDIDATES) {
    try {
      if (fs.existsSync(p)) return p
    } catch {
      /* continue */
    }
  }
  return null
}

/** ffmpeg presence probe (version parse, no generation). */
async function ffmpegAvailable(): Promise<{ ok: boolean; version: string | null }> {
  try {
    const res = await execFileP('ffmpeg', ['-version'], { timeout: 10_000, maxBuffer: 1_000_000 })
    const m = /^ffmpeg version (\S+)/.exec(res.stdout)
    return { ok: true, version: m ? m[1] : 'unknown' }
  } catch {
    return { ok: false, version: null }
  }
}

/** Split a caption into balanced readable lines (never wider than maxChars). */
function wrapCaption(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w
    if (candidate.length <= maxChars || current === '') {
      current = candidate
    } else {
      lines.push(current)
      current = w
    }
  }
  if (current) lines.push(current)
  return lines.slice(0, 3)
}

export interface FfmpegEngineOptions {
  /** Escape hatch for tests; defaults to the system binary. */
  ffmpegBin?: string
}

export function createFfmpegCompositionEngine(opts: FfmpegEngineOptions = {}): CompositionEngine {
  const bin = opts.ffmpegBin ?? 'ffmpeg'

  return {
    id: 'ffmpeg',
    describe: 'Local FFmpeg filtergraph composition (single-pass encode, deterministic concat)',

    async probe() {
      const ff = await ffmpegAvailable()
      if (!ff.ok) {
        return { available: false, reason: 'ffmpeg is not available on this host', detail: {} }
      }
      const font = resolveFontFile()
      return {
        available: true,
        reason: null,
        detail: { ffmpegVersion: ff.version, fontFile: font ?? 'fontconfig fallback: DejaVu Sans' },
      }
    },

    async compose(plan: CompositionPlan): Promise<CompositionResult> {
      const { canvas, scenes, endCard, audio } = plan
      if (scenes.length === 0) throw new Error('Composition refused: the plan has no scenes.')
      for (const s of scenes) {
        if (!fs.existsSync(s.clipPath)) {
          throw new Error(`Composition refused: scene ${s.idx} clip is missing on disk.`)
        }
      }
      const fontFile = resolveFontFile()
      const fontOpt = fontFile ? `fontfile=${fontFile}` : `font=DejaVu Sans`

      const fps = canvas.fps
      const W = canvas.width
      const H = canvas.height
      const bg = plan.background
      const fontSize = Math.max(28, Math.round(W * 0.042))
      const maxLineChars = Math.max(18, Math.floor(W / (fontSize * 0.55)))
      const bottomMargin = Math.round(Math.max(96, H * 0.075))

      await mkdir(path.dirname(plan.outputPath), { recursive: true })
      const textDir = path.join(plan.workDir, 'text')
      await mkdir(textDir, { recursive: true })
      const writeText = async (name: string, content: string) => {
        const p = path.join(textDir, name)
        await writeFile(p, content, 'utf8')
        return p
      }

      // ---- timeline ---------------------------------------------------------
      // Scene i occupies [start_i, start_i + dur). End card follows. Total is
      // EXACT: sum(scene durations) + endCard duration.
      const starts: number[] = []
      let t = 0
      for (const s of scenes) {
        starts.push(t)
        t += s.durationSec
      }
      const total = t + endCard.durationSec
      const expectedFrames = Math.round(total * fps)
      const fade = FADE_DURATION_SEC

      // ---- inputs -------------------------------------------------------------
      const args: string[] = ['-y', '-hide_banner', '-loglevel', 'error', '-nostdin']
      for (const s of scenes) args.push('-i', s.clipPath)
      // End card: deterministic color source (never an AI-generated frame).
      args.push('-f', 'lavfi', '-i', `color=c=${bg}:s=${W}x${H}:r=${fps}:d=${endCard.durationSec}`)
      if (audio.musicPath) args.push('-i', audio.musicPath)
      if (audio.voiceoverPath) args.push('-i', audio.voiceoverPath)
      // M27: scene-timed sound effects (each gets its own input, mixed with
      // adelay at its exact timeline position below).
      const sfx = audio.sfx ?? []
      for (const s of sfx) args.push('-i', s.path)

      // ---- video filtergraph ---------------------------------------------------
      const filterComplex: string[] = []
      const videoLabels: string[] = []

      for (let i = 0; i < scenes.length; i += 1) {
        const s = scenes[i]
        const start = starts[i]
        const dur = s.durationSec
        const chain: string[] = [
          `fps=${fps}`,
          'setsar=1',
          `scale=${W}:${H}:force_original_aspect_ratio=decrease`,
          `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${bg}`,
          // Defensive exactness: a short input is padded by holding its final
          // frame, then trimmed to the planned duration — the timeline stays
          // EXACT regardless of what length the input turned out to be.
          `tpad=stop_mode=clone:stop_duration=${dur.toFixed(3)}`,
          `trim=duration=${dur}`,
          'setpts=PTS-STARTPTS',
        ]
        // Transition OUT of this scene; transition IN mirrors the previous
        // scene's transitionOut (dip through the background color).
        if (s.transitionOut === 'fade') {
          chain.push(`fade=t=out:st=${Math.max(0, dur - fade).toFixed(3)}:d=${fade}:color=${bg}`)
        }
        if (i > 0 && scenes[i - 1].transitionOut === 'fade') {
          chain.push(`fade=t=in:st=0:d=${fade}:color=${bg}`)
        }
        // Caption: timed alpha window, readable wrapped block near the bottom.
        if (s.caption) {
          const capFile = await writeText(`caption-${s.idx}.txt`, wrapCaption(s.caption, maxLineChars).join('\n'))
          const t0 = start + 0.25
          const t1 = Math.min(start + dur - 0.15, start + dur - 0.01)
          const alpha =
            `alpha='if(lt(t\\,${t0.toFixed(3)})\\,0\\,` +
            `if(lt(t\\,${(t0 + 0.35).toFixed(3)})\\,(t-${t0.toFixed(3)})/0.35\\,` +
            `if(lt(t\\,${(t1 - 0.35).toFixed(3)})\\,1\\,` +
            `if(lt(t\\,${t1.toFixed(3)})\\,(${t1.toFixed(3)}-t)/0.35\\,0))))'`
          chain.push(
            `drawtext=${fontOpt}:textfile=${capFile}:fontsize=${fontSize}:fontcolor=white` +
              `:borderw=${Math.max(2, Math.round(fontSize / 15))}:bordercolor=black@0.55` +
              `:x=(w-text_w)/2:y=h-text_h-${bottomMargin}:${alpha}`,
          )
        }
        filterComplex.push(`[${i}:v]${chain.join(',')}[v${i}]`)
        videoLabels.push(`[v${i}]`)
      }

      // End card chain (brand title + optional subtitle, deterministic source).
      const endIdx = scenes.length
      const endChain: string[] = [
        'setsar=1',
        'format=yuv420p',
        `trim=duration=${endCard.durationSec}`,
        'setpts=PTS-STARTPTS',
      ]
      const titleFile = await writeText('endcard-title.txt', plan.title)
      const endTitleSize = Math.max(36, Math.round(W * 0.058))
      const endSubSize = Math.max(22, Math.round(W * 0.032))
      endChain.push(
        `drawtext=${fontOpt}:textfile=${titleFile}:fontsize=${endTitleSize}:fontcolor=white` +
          `:x=(w-text_w)/2:y=(h-text_h)/2-${Math.round(endTitleSize * 0.9)}` +
          `:alpha='if(lt(t\\,0.25)\\,0\\,if(lt(t\\,0.65)\\,(t-0.25)/0.4\\,1))'`,
      )
      if (endCard.subtitle) {
        const subFile = await writeText('endcard-subtitle.txt', endCard.subtitle)
        endChain.push(
          `drawtext=${fontOpt}:textfile=${subFile}:fontsize=${endSubSize}:fontcolor=white@0.82` +
            `:x=(w-text_w)/2:y=(h-text_h)/2+${Math.round(endSubSize * 1.4)}` +
            `:alpha='if(lt(t\\,0.45)\\,0\\,if(lt(t\\,0.85)\\,(t-0.45)/0.4\\,1))'`,
        )
      }
      endChain.push(`fade=t=out:st=${Math.max(0, endCard.durationSec - 0.5).toFixed(3)}:d=0.5:color=${bg}`)
      filterComplex.push(`[${endIdx}:v]${endChain.join(',')}[v${endIdx}]`)
      videoLabels.push(`[v${endIdx}]`)

      filterComplex.push(`${videoLabels.join('')}concat=n=${scenes.length + 1}:v=1:a=0[vcat]`)
      filterComplex.push(`[vcat]format=yuv420p[vout]`)

      // ---- audio filtergraph ----------------------------------------------------
      // Notes accumulate from the graph build onward (SFX fade-out skips etc.).
      const notes: string[] = []
      let audioArg: string[] = []
      const musicIdx = scenes.length + 1
      const voiceIdx = musicIdx + (audio.musicPath ? 1 : 0)
      const firstSfxIdx = voiceIdx + (audio.voiceoverPath ? 1 : 0)
      // M27: every audio source is processed into a labeled stream and mixed
      // with ONE amix (N inputs) — music + voiceover + any sound effects.
      // M28 Priority C: when measured narration regions are available, the
      // music bed follows a deterministic timeline-aware ducking curve
      // (attack/release/depth from the duck module — still NOT sidechain
      // compression); without regions the honest M27 static duck applies.
      const mixLabels: string[] = []
      const sfxFadeOutPending: Array<{ i: number; s: { path: string; startSec: number; volume: number; label: string | null; fadeInSeconds?: number; fadeOutSeconds?: number }; fo: number }> = []
      let duckNote: string | null = null
      let duckFilterFragment: string | null = null
      if (audio.musicPath && audio.voiceoverPath && (audio.voiceoverActiveRegions?.length ?? 0) > 0) {
        const plan = buildDynamicDuckPlan(audio.voiceoverActiveRegions ?? [], audio.duck)
        duckFilterFragment = duckPlanToVolumeFilter(plan, audio.musicVolume).replace(/^volume=/, '')
        duckNote =
          `Music ducks dynamically under the voiceover: ${plan.regions.length} measured narration region(s), ` +
          `duckTo ${plan.config.duckTo}, attack ${plan.config.attackMs} ms, release ${plan.config.releaseMs} ms, ${plan.config.curve} curve, ` +
          `min level ${plan.config.minMusicLevel} (timeline-driven automation from narration timing — NOT sidechain compression).`
      }
      if (audio.musicPath) {
        const duckPart = duckFilterFragment ?? `${(audio.musicVolume * 0.55).toFixed(3)}`
        filterComplex.push(
          `[${musicIdx}:a]atrim=0:${total.toFixed(3)},asetpts=PTS-STARTPTS,` +
            `volume=${duckPart},afade=t=in:st=0:d=0.6,` +
            `afade=t=out:st=${Math.max(0, total - 1.2).toFixed(3)}:d=1.2[am]`,
        )
        mixLabels.push('[am]')
      }
      if (audio.voiceoverPath) {
        filterComplex.push(
          `[${voiceIdx}:a]atrim=0:${total.toFixed(3)},asetpts=PTS-STARTPTS,volume=${audio.voiceoverVolume}[av]`,
        )
        mixLabels.push('[av]')
      }
      sfx.forEach((s, i) => {
        const delayMs = Math.max(0, Math.round(s.startSec * 1000))
        // M28 Priority D: optional per-effect fades measured against the real
        // asset duration (a fade-out without a probed duration would guess —
        // skipped with a note instead).
        const fadeParts: string[] = []
        const fi = Math.max(0, Math.min(5, s.fadeInSeconds ?? 0))
        const fo = Math.max(0, Math.min(5, s.fadeOutSeconds ?? 0))
        if (fi > 0) fadeParts.push(`afade=t=in:st=${s.startSec.toFixed(3)}:d=${fi.toFixed(3)}`)
        if (fo > 0) {
          fadeParts.push(`__SFX_FADE_OUT_${i}__`)
        }
        filterComplex.push(
          `[${firstSfxIdx + i}:a]volume=${Math.max(0, Math.min(1, s.volume)).toFixed(3)},` +
            `adelay=${delayMs}:all=1,apad=whole_dur=${total.toFixed(3)},atrim=0:${total.toFixed(3)},asetpts=PTS-STARTPTS` +
            (fadeParts.length > 0 ? `,${fadeParts.join(',')}` : '') +
            `[as${i}]`,
        )
        mixLabels.push(`[as${i}]`)
        if (fo > 0) sfxFadeOutPending.push({ i, s, fo })
      })
      // Resolve fade-out placements now that the chain knows each asset's
      // measured end (probe failures keep the effect WITHOUT a fade-out and
      // add an explicit note — never a guessed timestamp).
      for (const { i, s, fo } of sfxFadeOutPending) {
        const dur = await probeAudioDurationSec(s.path)
        if (dur === null) {
          // Remove the placeholder from the already-pushed filter line.
          const idx = filterComplex.findIndex((f) => f.includes(`__SFX_FADE_OUT_${i}__`))
          if (idx >= 0) {
            filterComplex[idx] = filterComplex[idx].replace(/,__SFX_FADE_OUT_\d+__/, '')
          }
          notes.push(`Sound effect "${s.label ?? `#${i}`}" could not be duration-probed; its fade-out was skipped rather than guessed.`)
          continue
        }
        const st = Math.max(s.startSec, s.startSec + dur - fo)
        for (let k = 0; k < filterComplex.length; k += 1) {
          if (filterComplex[k].includes(`__SFX_FADE_OUT_${i}__`)) {
            filterComplex[k] = filterComplex[k].replace(`__SFX_FADE_OUT_${i}__`, `afade=t=out:st=${st.toFixed(3)}:d=${fo.toFixed(3)}`)
          }
        }
      }
      if (mixLabels.length === 1) {
        // Single source: still pad/trim to the exact timeline length.
        filterComplex.push(`${mixLabels[0]}apad=whole_dur=${total.toFixed(3)},atrim=0:${total.toFixed(3)}[aout]`)
        audioArg = ['-map', '[aout]']
      } else if (mixLabels.length > 1) {
        filterComplex.push(
          `${mixLabels.join('')}amix=inputs=${mixLabels.length}:duration=longest:normalize=0,` +
            `apad=whole_dur=${total.toFixed(3)},atrim=0:${total.toFixed(3)}[aout]`,
        )
        audioArg = ['-map', '[aout]']
      }

      args.push('-filter_complex', filterComplex.join(';'), '-map', '[vout]', ...audioArg)
      args.push(
        '-c:v', 'libx264',
        // Memory-lean encode on large canvases (measured: x264 medium at
        // 1080x1920 inside a 3.9 GB cgroup OOM-killed the host process;
        // veryfast is deterministic, keeps CRF 18 quality, uses a fraction
        // of the memory and renders several times faster).
        '-preset', W * H >= 1_500_000 ? 'veryfast' : 'medium',
        '-crf', '18',
        '-pix_fmt', 'yuv420p',
        '-r', String(fps),
        '-fps_mode', 'cfr',
        '-video_track_timescale', '90000',
        ...(audioArg.length > 0 ? ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2'] : []),
        '-movflags', '+faststart',
        plan.outputPath,
      )

      try {
        await execFileP(bin, args, { timeout: COMPOSE_TIMEOUT_MS, maxBuffer: 8_000_000 })
      } catch (e) {
        const err = e as { stderr?: string; killed?: boolean; message?: string }
        const tail = (err.stderr ?? '').split('\n').filter(Boolean).slice(-4).join(' | ')
        throw new Error(
          err.killed
            ? `Local composition exceeded its ${Math.round(COMPOSE_TIMEOUT_MS / 60_000)}-minute time limit and was stopped.`
            : `Local composition failed: ${tail || err.message || 'ffmpeg error'}`.slice(0, 400),
        )
      }

      // ---- honest validation -----------------------------------------------------
      const probe = await probeVideoFile(plan.outputPath, 30_000)
      if (!probe.ok || !probe.video) {
        throw new Error(
          `The composed video failed stream validation: ${probe.error ?? 'ffprobe could not read the output'}. Nothing is delivered.`,
        )
      }
      const measured = probe.video.durationSec
      if (Math.abs(measured - total) > 0.35) {
        notes.push(
          `Measured duration ${measured.toFixed(2)}s differs from the planned ${total.toFixed(2)}s.`,
        )
      }
      if (probe.video.frames !== null && probe.video.frames !== expectedFrames) {
        notes.push(
          `Measured frame count ${probe.video.frames} differs from the exact expected ${expectedFrames} (fps normalization rounding).`,
        )
      }
      if (!audio.musicPath && !audio.voiceoverPath && sfx.length === 0) {
        notes.push('No audio track in the final video (no music or voiceover was supplied).')
      }
      if (audio.musicPath && audio.voiceoverPath) {
        notes.push(
          duckNote ??
            'Music ducks to a fixed lower bed under the voiceover (static ducking — no narration timing was available for dynamic ducking).',
        )
      }
      if (sfx.length > 0) {
        notes.push(
          `${sfx.length} sound effect(s) mixed at their planned timeline positions` +
            (audio.musicPath && audio.voiceoverPath
              ? duckNote
                ? ' (music ducks dynamically under the voiceover).'
                : ' (music ducks statically under the voiceover).'
              : '.'),
        )
      }

      // ---- poster frame -----------------------------------------------------------
      // BRAG rule: a strong SETTLED moment — end of the second scene by
      // default (after the hook; before later transitions).
      const posterSceneIdx = Math.min(1, scenes.length - 1)
      let posterAt = starts[posterSceneIdx] + scenes[posterSceneIdx].durationSec - 0.6
      posterAt = Math.min(Math.max(posterAt, 0.4), Math.max(0.4, measured - 0.4))
      const posterPath = path.join(path.dirname(plan.outputPath), 'poster.jpg')
      try {
        await execFileP(
          bin,
          ['-y', '-ss', posterAt.toFixed(3), '-i', plan.outputPath, '-frames:v', '1', '-q:v', '2', posterPath],
          { timeout: POSTER_TIMEOUT_MS, maxBuffer: 2_000_000 },
        )
      } catch {
        notes.push('Poster frame extraction failed; the video itself is unaffected.')
      }

      // ---- captions SRT -------------------------------------------------------------
      let captionsPath: string | null = null
      const captioned = scenes.filter((s) => s.caption)
      if (captioned.length > 0) {
        captionsPath = path.join(path.dirname(plan.outputPath), 'captions.srt')
        await writeFile(captionsPath, buildSrt(captioned, starts), 'utf8')
      }

      const bytes = fs.existsSync(plan.outputPath) ? fs.statSync(plan.outputPath).size : 0

      return {
        engine: 'ffmpeg',
        videoPath: plan.outputPath,
        bytes,
        probe,
        plannedDurationSec: total,
        measuredDurationSec: measured,
        posterPath: fs.existsSync(posterPath) ? posterPath : '',
        posterAtSec: posterAt,
        captionsPath: captionsPath && fs.existsSync(captionsPath) ? captionsPath : null,
        notes,
      }
    },
  }
}

/** SRT timestamp format 00:00:00,000. */
function srtTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000))
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  const rest = ms % 1000
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(rest, 3)}`
}

function buildSrt(scenes: CompositionPlan['scenes'], starts: number[]): string {
  const blocks: string[] = []
  let n = 1
  scenes.forEach((s) => {
    if (!s.caption) return
    const start = starts[s.idx - 1] + 0.25
    const end = starts[s.idx - 1] + s.durationSec - 0.15
    if (end <= start) return
    blocks.push(`${n}\n${srtTime(start)} --> ${srtTime(end)}\n${s.caption}\n`)
    n += 1
  })
  return blocks.join('\n')
}
