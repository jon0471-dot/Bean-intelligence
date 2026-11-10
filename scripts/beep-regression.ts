/**
 * GANGZII beep regression check — asserts a TTS output WAV does NOT open
 * with the measured upstream 1650 Hz artifact.
 *
 * Usage: bun scripts/beep-regression.ts <file.wav>
 * Exit 0 = clean (no leading tone artifact).
 * Exit 1 = ARTIFACT DETECTED (regression).
 *
 * Uses the exact production detector (detectLeadingToneSamples) so the
 * regression gate and the defensive guard can never drift apart.
 */
import { detectLeadingToneSamples, extractPcmFromWav, BEEP_TONE_HZ, goertzelPowerDb, TTS_SAMPLE_RATE } from '../src/lib/adapters/hosted-audio'
import fs from 'fs'

const file = process.argv[2]
if (!file) {
  console.error('usage: bun scripts/beep-regression.ts <file.wav>')
  process.exit(2)
}

const buf = fs.readFileSync(file)
let pcm: Buffer
try {
  pcm = extractPcmFromWav(buf)
} catch (e) {
  console.error(`not a usable WAV: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(2)
}

const cut = detectLeadingToneSamples(pcm)
const tone0 = goertzelPowerDb(pcm, 0, Math.floor(TTS_SAMPLE_RATE * 0.06), BEEP_TONE_HZ)
const rms0 = ((): number => {
  const n = Math.floor(TTS_SAMPLE_RATE * 0.06)
  let acc = 0
  for (let i = 0; i < n; i++) acc += pcm.readInt16LE(i * 2) ** 2
  return 20 * Math.log10(Math.max(Math.sqrt(acc / n) / 32768, 1e-10))
})()

console.log(
  JSON.stringify({
    file,
    durationSec: Math.round((pcm.length / 2 / TTS_SAMPLE_RATE) * 100) / 100,
    leadingTonePowerDb: Math.round(tone0 * 10) / 10,
    leadingRmsDb: Math.round(rms0 * 10) / 10,
    artifactSamples: cut,
  }),
)

if (cut > 0) {
  console.error(`REGRESSION: leading ${BEEP_TONE_HZ} Hz artifact detected (${(cut / TTS_SAMPLE_RATE).toFixed(2)}s) — the beep is back.`)
  process.exit(1)
}
console.log('BEEP REGRESSION: PASS — no leading tone artifact.')
