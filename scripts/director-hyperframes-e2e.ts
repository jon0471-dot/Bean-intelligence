/**
 * JAZMII AUTO DIRECTOR — HyperFrames engine END-TO-END acceptance (local).
 *
 * Runs the REAL adapter path end-to-end with REAL media:
 *   CompositionPlan → project generation (HTML/GSAP) → `hyperframes check`
 *   (the single quality gate) → `hyperframes render` → ffprobe validation →
 *   poster + captions.
 *
 * Evidence recorded: pinned version, check report ok, measured stream facts,
 * artifacts. No mocks. Run: bun scripts/director-hyperframes-e2e.ts
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { probeVideoFile } from '../src/lib/media/ffprobe'
import { createHyperframesCompositionEngine } from '../src/lib/jazmii/director/composition/hyperframes-engine'
import { HYPERFRAMES_VERSION } from '../src/lib/jazmii/director/composition'

const execFileP = promisify(execFile)

async function main() {
  const dir = await mkdtemp(path.join(tmpdir(), 'bean-director-hf-e2e-'))
  const evidence: Record<string, unknown> = { startedAt: new Date().toISOString(), pinnedVersion: HYPERFRAMES_VERSION }
  try {
    // --- probe ---------------------------------------------------------------
    const engine = createHyperframesCompositionEngine()
    const probe = await engine.probe()
    evidence.probe = probe
    if (!probe.available) {
      console.log(JSON.stringify({ ok: false, reason: probe.reason, evidence }, null, 2))
      process.exit(2)
    }

    // --- real fixtures ---------------------------------------------------------
    const clipA = path.join(dir, 'scene-01.mp4')
    const clipB = path.join(dir, 'scene-02.mp4')
    const music = path.join(dir, 'music.mp3')
    await execFileP('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=544x960:rate=30:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-c:a', 'aac', '-shortest', clipA])
    await execFileP('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'smptebars=size=540x960:rate=30:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', clipB])
    await execFileP('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=10', '-af', 'volume=0.3', '-c:a', 'libmp3lame', music])

    // --- compose (check gate + render) ----------------------------------------
    const result = await engine.compose({
      productionId: 'hf-e2e',
      title: 'Aurora Launch Film',
      canvas: { width: 540, height: 960, fps: 30 },
      background: '0a0a0f',
      scenes: [
        { idx: 1, clipPath: clipA, durationSec: 3, caption: 'Wake with the sun.', transitionOut: 'cut' },
        { idx: 2, clipPath: clipB, durationSec: 4, caption: 'Light that learns your morning.', transitionOut: 'fade' },
      ],
      endCard: { title: 'Aurora Launch Film', subtitle: 'Wake with the sun.', durationSec: 3 },
      audio: { musicPath: music, musicVolume: 0.32, musicAttribution: 'test tone (synthesized)', voiceoverPath: null, voiceoverVolume: 1.0 },
      workDir: dir,
      outputPath: path.join(dir, 'final.mp4'),
    })

    // --- independent validation --------------------------------------------------
    const probeOut = await probeVideoFile(result.videoPath, 30_000)
    const compositionProject = path.join(dir, 'composition')
    const indexHtml = await readFile(path.join(compositionProject, 'index.html'), 'utf8')
    const checks = fs.readdirSync(path.join(compositionProject, '.hyperframes', 'artifacts', 'checks')).filter((f) => f.endsWith('.json'))
    const checkReport = JSON.parse(await readFile(path.join(compositionProject, '.hyperframes', 'artifacts', 'checks', checks[checks.length - 1]), 'utf8')) as { ok?: boolean }

    evidence.result = {
      engine: result.engine,
      bytes: result.bytes,
      plannedDurationSec: result.plannedDurationSec,
      measuredDurationSec: result.measuredDurationSec,
      posterAtSec: result.posterAtSec,
      notes: result.notes,
    }
    evidence.ffprobe = probeOut
    evidence.checkReportOk = checkReport.ok === true
    evidence.compositionGenerated = indexHtml.includes('data-composition-id="root"') && indexHtml.includes('window.__timelines')
    evidence.assetsCopied = fs.existsSync(path.join(compositionProject, 'assets', 'vendor', 'gsap.min.js'))
    evidence.posterExists = fs.existsSync(result.posterPath)
    evidence.captionsExist = result.captionsPath !== null && fs.existsSync(result.captionsPath)

    const ok =
      result.engine === 'hyperframes' &&
      evidence.checkReportOk === true &&
      probeOut.ok === true &&
      probeOut.video !== null &&
      Math.abs(result.measuredDurationSec - 10) < 0.6 && // 3 + 4 + 3 end card
      probeOut.video!.width === 540 &&
      probeOut.video!.height === 960 &&
      probeOut.audio !== null &&
      evidence.posterExists === true &&
      evidence.captionsExist === true &&
      evidence.compositionGenerated === true

    console.log(JSON.stringify({ ok, evidence }, null, 2))
    process.exit(ok ? 0 : 1)
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e), evidence }, null, 2))
    process.exit(1)
  } finally {
    // Keep the composition project for post-run inspection; remove on success
    // to avoid disk growth (evidence above already extracted).
    if (process.env.HF_E2E_KEEP !== '1') {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

void main()
