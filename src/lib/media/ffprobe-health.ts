import { execFile } from 'node:child_process'

/**
 * LAXII-JAZMII RESTORATION (2026-11-14, defect D5) — measured ffprobe
 * availability for the video completion gate.
 *
 * MEASURED DEFECT: `src/lib/media/ffprobe.ts` is the hard completion gate for
 * every JAZMII video job (codec + duration >= 0.5 s + frames >= 8), and it
 * reports honestly when the binary is missing — but NOTHING surfaced that
 * fact anywhere: with ffprobe absent, every video download terminated
 * `ARTIFACT_INVALID` ("ffprobe could not decode the payload: spawn ffprobe
 * ENOENT") while the dashboard kept claiming healthy video reachability.
 * GANGZII audio probes its ffmpeg dependency at health time
 * (`hosted-audio.ts` healthFfmpeg); video now gets the same treatment for
 * its ffprobe dependency.
 *
 * Honesty rules (mirroring the ffprobe module's own):
 *  - this probe EXECUTES `ffprobe -version` — availability is measured, never
 *    assumed from PATH optimism;
 *  - a probe that cannot run reports exactly that (bounded error detail);
 *  - the result is cached briefly so parallel health reads share one real
 *    execution, and `force` re-measures;
 *  - the probe NEVER claims a version it did not read from the binary.
 */

export interface FfprobeAvailability {
  available: boolean
  /** First line of the binary's own version output; null when unavailable. */
  version: string | null
  /** Bounded measurement detail; null when available. */
  detail: string | null
  checkedAt: string
  latencyMs: number
}

let cache: { at: number; report: FfprobeAvailability } | null = null
const CACHE_TTL_MS = 20_000 // same contract as the other health probes

export function ffprobeHealthTtlMs(): number {
  return CACHE_TTL_MS
}

export async function probeFfprobe(force = false): Promise<FfprobeAvailability> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.report
  const t0 = Date.now()
  let report: FfprobeAvailability
  try {
    const version = await new Promise<string>((resolve, reject) => {
      execFile('ffprobe', ['-version'], { timeout: 5_000, maxBuffer: 1024 * 1024 }, (err, stdout) =>
        err ? reject(err) : resolve(String(stdout)),
      )
    })
    const v = version.split('\n')[0]?.trim() ?? ''
    report = {
      available: v.length > 0,
      version: v || null,
      detail: v ? null : 'ffprobe executed but printed no version banner — treated as unavailable.',
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - t0,
    }
  } catch (e) {
    report = {
      available: false,
      version: null,
      detail: `ffprobe is not usable on this host: ${e instanceof Error ? e.message : String(e)}`.slice(0, 240),
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - t0,
    }
  }
  cache = { at: Date.now(), report }
  return report
}
