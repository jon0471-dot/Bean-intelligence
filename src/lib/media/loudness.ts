/**
 * BEAN Intelligence — shared EBU R128 loudness measurement (M28).
 *
 * One parser for the ffmpeg ebur128 summary, used by the audio worker
 * (receipts/resultJson) and the speech evaluation runner so every recorded
 * loudness number is derived identically.
 *
 * Correctness notes (found while building the M28 evaluation — the previous
 * first-match parsing had two real defects):
 *  1. The progressive per-window lines (e.g. "t: 1.2  ...  I: -70.0 LUFS")
 *     and the final summary line share the "I:" prefix. Taking the FIRST
 *     match grabs a transient window value; the summary at the END of the
 *     output is the integrated value — so the LAST match wins.
 *  2. In ffmpeg ≥7 the summary prints the true-peak value as
 *     "Peak: -6.0 dBFS" under the "True peak:" heading (NOT dBTP), so a
 *     dBTP-only regex never matched and true peak was silently null.
 *     The section-aware parse accepts dBFS or dBTP and records the unit.
 *
 * Pure module (no node imports beyond child_process for the runner).
 */

import { execFile } from 'child_process'

export interface LoudnessMeasurement {
  integratedLufs: number | null
  /** True-peak value from the "True peak:" summary section. */
  truePeak: number | null
  /** Unit exactly as ffmpeg printed it (dBFS in ffmpeg ≥7 summaries). */
  truePeakUnit: 'dBFS' | 'dBTP' | null
  loudnessRangeLu: number | null
}

const NUM = '(-?\\d+(?:\\.\\d+)?)'

/**
 * Parse the ebur128 stderr summary. Section-aware: the true peak is read
 * from the "True peak:" block, not from any "Peak:" occurrence elsewhere.
 */
export function parseEbur128Summary(stderr: string): LoudnessMeasurement {
  const out: LoudnessMeasurement = {
    integratedLufs: null,
    truePeak: null,
    truePeakUnit: null,
    loudnessRangeLu: null,
  }
  if (!stderr) return out
  try {
    // Integrated loudness: LAST "I: <n> LUFS" occurrence = summary value.
    const iMatches = [...stderr.matchAll(new RegExp(`I:\\s*${NUM}\\s*LUFS`, 'g'))]
    if (iMatches.length > 0) out.integratedLufs = Number(iMatches[iMatches.length - 1][1])

    // Loudness range: LAST "LRA: <n> LU" occurrence (summary block).
    const lraMatches = [...stderr.matchAll(new RegExp(`LRA:\\s*${NUM}\\s*LU`, 'g'))]
    if (lraMatches.length > 0) out.loudnessRangeLu = Number(lraMatches[lraMatches.length - 1][1])

    // True peak: the Peak line inside the "True peak:" summary section.
    const tpSection = stderr.match(/True peak:[\s\S]*$/)
    if (tpSection) {
      const peak = tpSection[0].match(new RegExp(`Peak:\\s*${NUM}\\s*(dBFS|dBTP)`))
      if (peak) {
        out.truePeak = Number(peak[1])
        out.truePeakUnit = peak[2] === 'dBTP' ? 'dBTP' : 'dBFS'
      }
    }
  } catch {
    // keep nulls — measurement unavailability is recorded honestly
  }
  return out
}

/** Measure a file with the same invocation the audio worker uses. */
export function measureLoudnessEbur128(file: string, timeoutMs = 60_000): Promise<LoudnessMeasurement> {
  return new Promise((resolve) => {
    execFile(
      'ffmpeg',
      ['-nostats', '-hide_banner', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'],
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      (_err, _stdout, stderr) => {
        resolve(parseEbur128Summary(String(stderr)))
      },
    )
  })
}
