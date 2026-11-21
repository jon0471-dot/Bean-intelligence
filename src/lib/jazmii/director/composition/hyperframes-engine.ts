/**
 * BEAN Intelligence — JAZMII Auto Director: HyperFrames composition adapter.
 *
 * Wraps the VERIFIED local HyperFrames CLI (pinned 0.9.72 — proven in this
 * environment: Node 24, FFmpeg 7.1.5, hyperframes-managed chrome-headless-shell,
 * deterministic frame-seeked rendering) behind the narrow composition
 * boundary. JAZMII domain logic never touches HyperFrames specifics — it
 * hands over a CompositionPlan and receives a CompositionResult.
 *
 * Honest failure contract (spec §4):
 *  - probe() checks Node >= 22, the pinned CLI, a render-capable headless
 *    Chrome and the vendored GSAP runtime — never runs a render;
 *  - `hyperframes check` is the single gate BEFORE rendering: a composition
 *    that fails its own quality gate (lint/runtime/contrast/craft) fails the
 *    hyperframes path with the REAL findings; the caller (engine 'auto')
 *    then falls back to the always-available FFmpeg engine and records why;
 *  - the existing basic video export NEVER depends on HyperFrames.
 *
 * Composition generation: scenes become timed <video> elements (muted — the
 * music bed carries audio), captions/titles/end-card become GSAP-timeline
 * elements (seek-safe, deterministic), music becomes a timed <audio> bed.
 * No CDN dependencies — GSAP is vendored from BEAN's own node_modules.
 *
 * SERVER-ONLY.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, copyFile, writeFile, readdir } from 'node:fs/promises'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { probeVideoFile } from '@/lib/media/ffprobe'
import { logger } from '@/lib/observability/logger'
import type { CompositionEngine, CompositionPlan, CompositionResult } from './types'

const execFileP = promisify(execFile)

/** Pin: the version verified end-to-end in this environment (never floating). */
export const HYPERFRAMES_VERSION = process.env.JAZMII_HYPERFRAMES_VERSION ?? '0.9.72'
const RENDER_QUALITY = process.env.JAZMII_DIRECTOR_HF_QUALITY ?? 'looks'
const RENDER_WORKERS = 2
const CHECK_TIMEOUT_MS = 3 * 60_000
const RENDER_TIMEOUT_MS = Number(process.env.JAZMII_DIRECTOR_COMPOSE_TIMEOUT_MS ?? 10 * 60_000)

interface CheckFinding {
  severity: string
  code: string
  message: string
}
interface CheckReport {
  ok?: boolean
  lint?: { ok?: boolean; errorCount?: number; warningCount?: number; findings?: CheckFinding[] }
  runtime?: { ok?: boolean }
  layout?: { ok?: boolean }
  contrast?: { ok?: boolean }
  craft?: { ok?: boolean }
  audio?: { ok?: boolean }
}

function nodeMajor(): number {
  return Number(process.versions.node.split('.')[0] ?? 0)
}

/** Resolve the pinned CLI entry (project-local node_modules). */
function resolveCli(): string | null {
  const p = path.join(process.cwd(), 'node_modules', 'hyperframes', 'bin', 'hyperframes.mjs')
  try {
    return fs.existsSync(p) ? p : null
  } catch {
    return null
  }
}

/** HyperFrames-managed headless Chrome (downloaded by `browser ensure`). */
function resolveBrowser(): string | null {
  const base = path.join(os.homedir(), '.cache', 'hyperframes', 'chrome', 'chrome-headless-shell')
  try {
    if (!fs.existsSync(base)) return null
    for (const ver of fs.readdirSync(base)) {
      const exe = path.join(base, ver, 'chrome-headless-shell-linux64', 'chrome-headless-shell')
      if (fs.existsSync(exe)) return exe
    }
    return null
  } catch {
    return null
  }
}

function resolveGsap(): string | null {
  const p = path.join(process.cwd(), 'node_modules', 'gsap', 'dist', 'gsap.min.js')
  try {
    return fs.existsSync(p) ? p : null
  } catch {
    return null
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * M28 Priority D: measured audio duration of a local SFX asset (ffprobe —
 * the real bytes, never the filename). Returns null when the file cannot be
 * probed; the caller then keeps the limitation note instead of pretending.
 */
async function probeAudioDurationSec(file: string): Promise<number | null> {
  try {
    const res = await execFileP(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', file],
      { timeout: 15_000, maxBuffer: 1_000_000 },
    )
    const d = (JSON.parse(res.stdout) as { format?: { duration?: string } }).format?.duration
    const n = d ? Number(d) : Number.NaN
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

/** JSON-stringified attribute value (safe single-quoted HTML attribute). */
function attrJson(v: unknown): string {
  return escapeHtml(JSON.stringify(v))
}

interface TimelineEntry {
  selector: string
  at: number
  duration: number
  from: Record<string, string | number>
  to: Record<string, string | number>
  ease?: string
}

/**
 * Generate the composition project from the plan. Returns the project dir.
 * The generated HTML follows the verified HyperFrames contract:
 *  - root with data-composition-id / data-start / data-duration / dims;
 *  - timed clips with class="clip" + data-start + data-duration;
 *  - one paused GSAP timeline registered on window.__timelines[id].
 */
function generateProject(
  projectDir: string,
  plan: CompositionPlan,
  gsapPath: string,
  preparedSfx: Array<{
    assetSrc: string
    startSec: number
    volume: number
    durationSec: number | null
    fadeInSeconds: number
    fadeOutSeconds: number
    label: string | null
  }>,
): { indexHtml: string; totalDuration: number } {
  const { canvas, scenes, endCard, audio } = plan
  const W = canvas.width
  const H = canvas.height
  const fps = canvas.fps

  let t = 0
  const starts: number[] = []
  for (const s of scenes) {
    starts.push(t)
    t += s.durationSec
  }
  const total = t + endCard.durationSec
  const bgCss = `#${plan.background.replace(/^0x/, '')}`

  const bodyParts: string[] = []
  const timeline: TimelineEntry[] = []

  scenes.forEach((s, i) => {
    const src = `assets/scene-${String(s.idx).padStart(2, '0')}.mp4`
    bodyParts.push(
      `    <video id="scene-${s.idx}" class="clip scene-video" src="${src}" data-start="${starts[i]}" data-duration="${s.durationSec}" muted></video>`,
    )
    if (s.caption) {
      // No data-start on TEXT elements: the runtime's craft/lint gates require
      // timeline elements to be leaf nodes. Captions are an INTENTIONAL
      // overlay on footage (that is the product): the gate's documented
      // allow markers mark exactly that intent, while the scrim keeps the
      // text WCAG-readable and the position stays inside platform safe areas.
      bodyParts.push(
        `    <div class="caption" id="caption-${s.idx}" data-layout-allow-overlap data-layout-allow-occlusion>${escapeHtml(s.caption)}</div>`,
      )
      const t0 = starts[i] + 0.25
      const tOut = starts[i] + s.durationSec - 0.15
      timeline.push({
        selector: `#caption-${s.idx}`,
        at: t0,
        duration: 0.35,
        from: { autoAlpha: 0, y: 14 },
        to: { autoAlpha: 1, y: 0 },
        ease: 'power2.out',
      })
      timeline.push({
        selector: `#caption-${s.idx}`,
        at: tOut,
        duration: 0.3,
        from: { autoAlpha: 1 },
        to: { autoAlpha: 0 },
        ease: 'power2.in',
      })
    }
    // Scene boundary fade mirrors the FFmpeg engine's dip-through-background.
    if (s.transitionOut === 'fade') {
      // A full-frame ground overlay that snaps in for the last `fade` seconds.
      bodyParts.push(
        `    <div class="dip clip" id="dip-out-${s.idx}" data-start="${(starts[i] + s.durationSec - 0.4).toFixed(3)}" data-duration="0.4"></div>`,
      )
      timeline.push({
        selector: `#dip-out-${s.idx}`,
        at: starts[i] + s.durationSec - 0.4,
        duration: 0.4,
        from: { opacity: 0 },
        to: { opacity: 1 },
        ease: 'none',
      })
    }
    if (i > 0 && scenes[i - 1].transitionOut === 'fade') {
      bodyParts.push(
        `    <div class="dip clip" id="dip-in-${s.idx}" data-start="${starts[i]}" data-duration="0.4"></div>`,
      )
      timeline.push({
        selector: `#dip-in-${s.idx}`,
        at: starts[i],
        duration: 0.4,
        from: { opacity: 1 },
        to: { opacity: 0 },
        ease: 'none',
      })
    }
  })

  const endStart = t
  bodyParts.push(
    `    <div class="endcard" id="endcard">`,
    `      <div class="endcard-stack">`,
    `        <h1 class="endcard-title">${escapeHtml(plan.title)}</h1>`,
    endCard.subtitle ? `        <p class="endcard-sub">${escapeHtml(endCard.subtitle)}</p>` : '',
    `      </div>`,
    `    </div>`,
  )
  timeline.push({
    selector: '#endcard',
    at: endStart + 0.2,
    duration: 0.45,
    from: { autoAlpha: 0 },
    to: { autoAlpha: 1 },
    ease: 'power2.out',
  })

  const audioEl = [
    audio.musicPath
      ? `\n    <audio id="music-bed" src="assets/music${path.extname(audio.musicPath) || '.mp3'}" data-start="0" data-duration="${total}" data-volume="${audio.musicVolume}" data-fade-in="0.6" data-fade-out="1.2"></audio>`
      : '',
    audio.voiceoverPath
      ? `\n    <audio id="voiceover" src="assets/voiceover${path.extname(audio.voiceoverPath) || '.mp3'}" data-start="0" data-duration="${total}" data-volume="${audio.voiceoverVolume}"></audio>`
      : '',
    // M28 Priority D: scene-timed sound effects use the SAME verified timed
    // <audio> mechanism (multiple elements mix through the runtime's WebAudio
    // graph; data-fade-in/out supported per element — measured in the shipped
    // hyperframes@0.9.72 runtime). Placement/start/volume/fades come from the
    // plan; the asset duration is MEASURED with ffprobe and clamped to the
    // timeline end. Unsupported cases keep the honest limitation note.
    ...preparedSfx.map((s, i) => {
      const dur = s.durationSec !== null ? Math.min(s.durationSec, Math.max(0.05, total - s.startSec)) : null
      return (
        `\n    <audio id="sfx-${i}" src="${s.assetSrc}" data-start="${s.startSec.toFixed(3)}"` +
        (dur !== null ? ` data-duration="${dur.toFixed(3)}"` : '') +
        ` data-volume="${s.volume.toFixed(3)}"` +
        (s.fadeInSeconds > 0 ? ` data-fade-in="${s.fadeInSeconds.toFixed(3)}"` : '') +
        (s.fadeOutSeconds > 0 ? ` data-fade-out="${s.fadeOutSeconds.toFixed(3)}"` : '') +
        `></audio>`
      )
    }),
  ].join('')

  const tlJs = timeline
    .map(
      (e) =>
        `  tl.fromTo("${e.selector}", ${JSON.stringify(e.from)}, ${JSON.stringify(e.to)}, ${e.at.toFixed(3)});`,
    )
    .join('\n')

  const indexHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />
    <script src="assets/vendor/gsap.min.js"></script>
    <style>
      :root {
        --ground: ${bgCss};
        --ink: #ffffff;
        --font-display: 'DejaVu Sans', sans-serif;
      }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: var(--ground); font-family: var(--font-display); }
      #root { width: 100%; height: 100%; position: relative; }
      .clip { position: absolute; inset: 0; }
      .scene-video { width: ${W}px; height: ${H}px; object-fit: cover; z-index: 0; }
      .dip { background: var(--ground); z-index: 10; }
      .caption {
        position: absolute; left: 9%; right: 9%; bottom: ${(H * 0.24).toFixed(0)}px;
        text-align: center; color: #ffffff;
        font-size: ${Math.max(28, Math.round(W * 0.04))}px; font-weight: 700; line-height: 1.3;
        background: rgba(5, 6, 10, 0.8);
        padding: ${(H * 0.014).toFixed(0)}px ${(W * 0.03).toFixed(0)}px;
        border-radius: 14px;
        z-index: 30;
        visibility: hidden;
      }
      .endcard {
        position: absolute; inset: 0;
        background: var(--ground);
        display: flex; align-items: center; justify-content: center;
        z-index: 40;
        visibility: hidden;
      }
      .endcard-stack { display: flex; flex-direction: column; align-items: center; gap: ${(H * 0.02).toFixed(0)}px; max-width: 72%; text-align: center; }
      .endcard-title { color: #ffffff; font-size: ${Math.max(40, Math.round(W * 0.062))}px; font-weight: 800; letter-spacing: -0.02em; }
      .endcard-sub { color: #d9d9e3; font-size: ${Math.max(24, Math.round(W * 0.034))}px; font-weight: 500; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="root" data-start="0" data-duration="${total}" data-width="${W}" data-height="${H}" data-fps="${fps}">
${bodyParts.filter(Boolean).join('\n')}${audioEl}
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
${tlJs}
      window.__timelines["root"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
`

  return { indexHtml, totalDuration: total }
}

export function createHyperframesCompositionEngine(): CompositionEngine {
  return {
    id: 'hyperframes',
    describe: `HyperFrames ${HYPERFRAMES_VERSION} (local HTML/GSAP composition, headless-Chrome frame-accurate render)`,

    async probe() {
      const detail: Record<string, unknown> = { pinnedVersion: HYPERFRAMES_VERSION }
      if (nodeMajor() < 22) {
        return { available: false, reason: `HyperFrames requires Node.js 22+; this runtime has ${process.versions.node}`, detail }
      }
      const cli = resolveCli()
      detail.cli = cli
      if (!cli) {
        return {
          available: false,
          reason: `hyperframes@${HYPERFRAMES_VERSION} is not installed (run: npm install hyperframes@${HYPERFRAMES_VERSION} and npx hyperframes@${HYPERFRAMES_VERSION} browser ensure)`,
          detail,
        }
      }
      const browser = resolveBrowser()
      detail.browser = browser
      if (!browser) {
        return {
          available: false,
          reason: `the hyperframes-managed headless Chrome is missing (run once: npx hyperframes@${HYPERFRAMES_VERSION} browser ensure)`,
          detail,
        }
      }
      const gsap = resolveGsap()
      detail.gsap = gsap
      if (!gsap) {
        return { available: false, reason: 'the vendored GSAP runtime (node_modules/gsap) is missing', detail }
      }
      try {
        const v = await execFileP('node', [cli, '--version'], { timeout: 30_000, maxBuffer: 1_000_000 })
        detail.cliVersion = v.stdout.trim()
      } catch (e) {
        return {
          available: false,
          reason: `the hyperframes CLI failed to start: ${e instanceof Error ? e.message.slice(0, 140) : 'unknown'}`,
          detail,
        }
      }
      return { available: true, reason: null, detail }
    },

    async compose(plan: CompositionPlan): Promise<CompositionResult> {
      const probe = await this.probe()
      if (!probe.available) throw new Error(`HyperFrames composition unavailable: ${probe.reason}`)

      const projectDir = path.join(plan.workDir, 'composition')
      const assetsDir = path.join(projectDir, 'assets')
      await mkdir(path.join(assetsDir, 'vendor'), { recursive: true })
      await mkdir(path.dirname(plan.outputPath), { recursive: true })

      // --- project files -------------------------------------------------------
      await writeFile(
        path.join(projectDir, 'hyperframes.json'),
        JSON.stringify({ $schema: 'https://hyperframes.heygen.com/schema/hyperframes.json', paths: { assets: 'assets' } }, null, 2),
        'utf8',
      )
      await writeFile(
        path.join(projectDir, 'meta.json'),
        JSON.stringify({ id: `jazmii-${plan.productionId}`, name: plan.title.slice(0, 60) }, null, 2),
        'utf8',
      )
      const gsap = resolveGsap()!
      await copyFile(gsap, path.join(assetsDir, 'vendor', 'gsap.min.js'))

      // M28 Priority D: scene-timed SFX are REAL now — each asset is copied
      // into the composition, its duration MEASURED with ffprobe, and a timed
      // <audio> element is generated with the verified data-* contract. The
      // runtime mixes all elements through its WebAudio graph (same mechanism
      // as the verified music bed + voiceover). An asset that cannot be
      // probed keeps its element with a runtime-derived duration and an
      // explicit note — never a silent drop, never a pretend success.
      const preparedSfx: Array<{
        assetSrc: string
        startSec: number
        volume: number
        durationSec: number | null
        fadeInSeconds: number
        fadeOutSeconds: number
        label: string | null
      }> = []
      const sfxProbeFailures: string[] = []
      for (let i = 0; i < (plan.audio.sfx ?? []).length; i += 1) {
        const s = plan.audio.sfx![i]
        const ext = path.extname(s.path) || '.mp3'
        const assetName = `sfx-${String(i).padStart(2, '0')}${ext}`
        await copyFile(s.path, path.join(assetsDir, assetName))
        const measured = await probeAudioDurationSec(path.join(assetsDir, assetName))
        if (measured === null) sfxProbeFailures.push(s.label ?? assetName)
        preparedSfx.push({
          assetSrc: `assets/${assetName}`,
          startSec: Math.max(0, s.startSec),
          volume: Math.max(0, Math.min(1, s.volume)),
          durationSec: measured,
          fadeInSeconds: Math.max(0, Math.min(5, s.fadeInSeconds ?? 0)),
          fadeOutSeconds: Math.max(0, Math.min(5, s.fadeOutSeconds ?? 0)),
          label: s.label,
        })
      }

      const { indexHtml, totalDuration } = generateProject(projectDir, plan, gsap, preparedSfx)
      await writeFile(path.join(projectDir, 'index.html'), indexHtml, 'utf8')

      // Scene clips (muted copies — the music bed carries the audio).
      for (const s of plan.scenes) {
        await copyFile(s.clipPath, path.join(assetsDir, `scene-${String(s.idx).padStart(2, '0')}.mp4`))
      }
      if (plan.audio.musicPath) {
        await copyFile(plan.audio.musicPath, path.join(assetsDir, `music${path.extname(plan.audio.musicPath) || '.mp3'}`))
      }
      // M27: the voiceover uses the SAME pinned-runtime <audio> mechanism as
      // the music bed (measured: the HyperFrames renderer plays timed audio
      // elements) — narration therefore works on BOTH engines.
      if (plan.audio.voiceoverPath) {
        await copyFile(plan.audio.voiceoverPath, path.join(assetsDir, `voiceover${path.extname(plan.audio.voiceoverPath) || '.mp3'}`))
      }

      const run = async (args: string[], timeout: number) => {
        const cli = resolveCli()!
        return execFileP('node', [cli, ...args], {
          cwd: projectDir,
          timeout,
          maxBuffer: 16_000_000,
        })
      }

      // --- the single quality gate: `hyperframes check` -----------------------
      try {
        await run(['check'], CHECK_TIMEOUT_MS)
      } catch (e) {
        const err = e as { killed?: boolean }
        if (err.killed) throw new Error('HyperFrames check exceeded its time limit; composition aborted.')
        // check exits non-zero on failure — fall through to report parsing.
      }
      const report = await latestCheckReport(projectDir)
      if (!report || report.ok !== true) {
        const findings = summarizeFindings(report)
        throw new Error(
          `HyperFrames check rejected the composition${findings ? `: ${findings}` : ' (no report was produced)'}`,
        )
      }

      // --- render ---------------------------------------------------------------
      try {
        await run(['render', '--quality', RENDER_QUALITY, '--workers', String(RENDER_WORKERS), '--output', plan.outputPath], RENDER_TIMEOUT_MS)
      } catch (e) {
        const err = e as { killed?: boolean; stderr?: string; message?: string }
        if (err.killed) {
          throw new Error(`HyperFrames render exceeded its ${Math.round(RENDER_TIMEOUT_MS / 60_000)}-minute time limit.`)
        }
        throw new Error(`HyperFrames render failed: ${(err.stderr ?? err.message ?? 'unknown').slice(0, 300)}`)
      }

      const probeOut = await probeVideoFile(plan.outputPath, 30_000)
      if (!probeOut.ok || !probeOut.video) {
        throw new Error(
          `The composed video failed stream validation: ${probeOut.error ?? 'ffprobe could not read the output'}. Nothing is delivered.`,
        )
      }

      const notes: string[] = [
        `Rendered by HyperFrames ${HYPERFRAMES_VERSION} (check gate passed; quality ${RENDER_QUALITY}).`,
      ]
      if (Math.abs(probeOut.video.durationSec - totalDuration) > 0.35) {
        notes.push(
          `Measured duration ${probeOut.video.durationSec.toFixed(2)}s differs from the planned ${totalDuration.toFixed(2)}s.`,
        )
      }
      if (!plan.audio.musicPath && !plan.audio.voiceoverPath && (plan.audio.sfx?.length ?? 0) === 0) {
        notes.push('No audio track in the final video (no music or voiceover was supplied).')
      }
      if ((plan.audio.sfx?.length ?? 0) > 0) {
        // M28 Priority D: SFX ARE applied — the note records WHAT was mixed,
        // and the real-render integration tests verify the audio stream.
        notes.push(
          `${preparedSfx.length} sound effect(s) mixed as timed audio elements at their planned positions ` +
            `(${preparedSfx.map((s) => `${s.startSec.toFixed(2)}s@${s.volume.toFixed(2)}`).join(', ')})` +
            (preparedSfx.some((s) => s.fadeInSeconds > 0 || s.fadeOutSeconds > 0) ? ', with requested fades' : '') +
            '.',
        )
        if (sfxProbeFailures.length > 0) {
          notes.push(
            `${sfxProbeFailures.length} sound effect asset(s) could not be duration-probed (${sfxProbeFailures.join(', ')}); their elements rely on the runtime's media-derived duration — verify in the rendered output.`,
          )
        }
        // Measured cross-engine honesty (2026-11-21, hyperframes@0.9.72):
        // the runtime's WebAudio render graph applies a constant ≈ −18 dB
        // offset vs source unity while data-volume stays linear (measured
        // −6.02 dB per ×0.5). Absolute loudness therefore differs from the
        // FFmpeg engine's unity mix; relative levels (ducking, fades, SFX
        // balance) match. Delivery-critical mixes should finish with
        // GANGZII loudness normalization (loudnorm), which both paths
        // measure with EBUR128 afterwards.
        notes.push(
          'HyperFrames WebAudio mix gain staging measured ≈ −18 dB vs source unity (data-volume linear) — absolute loudness differs from the FFmpeg engine; normalize loudness for delivery-critical masters.',
        )
      }

      // --- poster (ffmpeg extraction from the rendered file) --------------------
      const posterSceneIdx = Math.min(1, plan.scenes.length - 1)
      let posterAt = 0
      {
        let t = 0
        for (let i = 0; i < plan.scenes.length; i += 1) {
          if (i === posterSceneIdx) posterAt = t + plan.scenes[i].durationSec - 0.6
          t += plan.scenes[i].durationSec
        }
      }
      posterAt = Math.min(Math.max(posterAt, 0.4), Math.max(0.4, probeOut.video.durationSec - 0.4))
      const posterPath = path.join(path.dirname(plan.outputPath), 'poster.jpg')
      try {
        await execFileP(
          'ffmpeg',
          ['-y', '-ss', posterAt.toFixed(3), '-i', plan.outputPath, '-frames:v', '1', '-q:v', '2', posterPath],
          { timeout: 30_000, maxBuffer: 2_000_000 },
        )
      } catch {
        notes.push('Poster frame extraction failed; the video itself is unaffected.')
      }

      // --- captions SRT -----------------------------------------------------------
      let captionsPath: string | null = null
      const captioned = plan.scenes.filter((s) => s.caption)
      if (captioned.length > 0) {
        const starts: number[] = []
        let t = 0
        for (const s of plan.scenes) {
          starts.push(t)
          t += s.durationSec
        }
        const blocks: string[] = []
        let n = 1
        for (const s of captioned) {
          const start = starts[s.idx - 1] + 0.25
          const end = starts[s.idx - 1] + s.durationSec - 0.15
          if (end <= start) continue
          blocks.push(`${n}\n${srtTime(start)} --> ${srtTime(end)}\n${s.caption}\n`)
          n += 1
        }
        captionsPath = path.join(path.dirname(plan.outputPath), 'captions.srt')
        await writeFile(captionsPath, blocks.join('\n'), 'utf8')
      }

      const bytes = fs.existsSync(plan.outputPath) ? fs.statSync(plan.outputPath).size : 0

      return {
        engine: 'hyperframes',
        videoPath: plan.outputPath,
        bytes,
        probe: probeOut,
        plannedDurationSec: totalDuration,
        measuredDurationSec: probeOut.video.durationSec,
        posterPath: fs.existsSync(posterPath) ? posterPath : '',
        posterAtSec: posterAt,
        captionsPath: captionsPath && fs.existsSync(captionsPath) ? captionsPath : null,
        notes,
      }
    },
  }
}

/** Newest hyperframes check report under the project's artifacts dir
 *  (sorted by MTIME — the filenames are UUIDs, not chronological). */
async function latestCheckReport(projectDir: string): Promise<CheckReport | null> {
  const dir = path.join(projectDir, '.hyperframes', 'artifacts', 'checks')
  try {
    const names = (await readdir(dir)).filter((f) => f.endsWith('.json'))
    if (names.length === 0) return null
    const stats = await Promise.all(
      names.map(async (f) => ({ f, m: (await fs.promises.stat(path.join(dir, f))).mtimeMs })),
    )
    stats.sort((a, b) => b.m - a.m)
    const raw = await fs.promises.readFile(path.join(dir, stats[0].f), 'utf8')
    return JSON.parse(raw) as CheckReport
  } catch (e) {
    logger.warn('jazmii.director_hf_report_unreadable', {
      message: e instanceof Error ? e.message.slice(0, 120) : 'unknown',
    })
    return null
  }
}

function summarizeFindings(report: CheckReport | null): string {
  if (!report) return ''
  const findings: string[] = []
  const sections = ['lint', 'runtime', 'layout', 'contrast', 'craft', 'audio'] as const
  for (const sec of sections) {
    const s = report[sec]
    if (!s || s.ok !== false) continue
    const sectionFindings = 'findings' in s && Array.isArray(s.findings) ? s.findings : []
    for (const f of sectionFindings.slice(0, 4)) {
      findings.push(`${sec}/${f.code}: ${f.message.slice(0, 140)}`)
    }
    if (sectionFindings.length === 0) findings.push(`${sec}: failed (no findings recorded)`)
  }
  return findings.slice(0, 6).join(' | ')
}

/** SRT timestamp (shared shape with the FFmpeg engine). */
function srtTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000))
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  const rest = ms % 1000
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(rest, 3)}`
}
