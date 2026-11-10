/**
 * GANGZII beep investigation — analyze the first seconds of every archived
 * TTS output for an artificial tone (beep/chime) at the start.
 *
 * Method: decode WAV (mono 16-bit PCM) -> per-window RMS + dominant frequency
 * (Goertzel over a bin set) -> report the first 2 s in 100 ms windows.
 * A "beep" shows as a high-amplitude, stable-frequency window well above the
 * noise floor before speech begins.
 */
import fs from 'fs'

function readWav(path: string): { sampleRate: number; channels: number; samples: Int16Array } {
  const buf = fs.readFileSync(path)
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`not a RIFF/WAVE file: ${path}`)
  }
  // walk chunks to find fmt + data
  let off = 12
  let sampleRate = 0
  let channels = 0
  let bits = 0
  let dataOff = -1
  let dataLen = 0
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(off + 10)
      sampleRate = buf.readUInt32LE(off + 12)
      bits = buf.readUInt16LE(off + 22)
    } else if (id === 'data') {
      dataOff = off + 8
      dataLen = Math.min(size, buf.length - off - 8)
    }
    off += 8 + size + (size % 2)
  }
  if (dataOff < 0) throw new Error(`no data chunk: ${path}`)
  const n = Math.floor(dataLen / 2)
  const samples = new Int16Array(n)
  for (let i = 0; i < n; i++) samples[i] = buf.readInt16LE(dataOff + i * 2)
  if (bits !== 16 || channels !== 1 || sampleRate !== 24000) {
    console.log(`  [note] ${path}: ${channels}ch ${sampleRate}Hz ${bits}bit`)
  }
  return { sampleRate, channels, samples }
}

/** RMS of a window, dBFS. */
function rmsDb(samples: Int16Array, start: number, len: number): number {
  let acc = 0
  for (let i = start; i < start + len; i++) acc += samples[i] * samples[i]
  const rms = Math.sqrt(acc / len) / 32768
  return 20 * Math.log10(Math.max(rms, 1e-10))
}

/** Dominant frequency of a window via Goertzel over 80–4000 Hz. */
function dominantFreq(samples: Int16Array, start: number, len: number, sampleRate: number): { freq: number; power: number } {
  const win = new Float64Array(len)
  for (let i = 0; i < len; i++) win[i] = samples[start + i] * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (len - 1))) // Hamming
  let bestFreq = 0
  let bestPow = 0
  for (let f = 80; f <= 4000; f += 10) {
    const w = (2 * Math.PI * f) / sampleRate
    const coeff = 2 * Math.cos(w)
    let s0 = 0
    let s1 = 0
    let s2 = 0
    for (let i = 0; i < len; i++) {
      s0 = win[i] + coeff * s1 - s2
      s2 = s1
      s1 = s0
    }
    const power = s1 * s1 + s2 * s2 - coeff * s1 * s2
    if (power > bestPow) {
      bestPow = power
      bestFreq = f
    }
  }
  return { freq: bestFreq, power: bestPow }
}

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('usage: bun scripts/beep-analysis.ts <file.wav> [...]')
  process.exit(1)
}

for (const path of files) {
  console.log(`\n=== ${path} ===`)
  const { sampleRate, samples } = readWav(path)
  const dur = samples.length / sampleRate
  console.log(`  duration ${dur.toFixed(2)}s, ${samples.length} samples @ ${sampleRate}Hz`)
  const winLen = Math.floor(sampleRate * 0.1) // 100 ms windows
  const windows = Math.min(Math.floor(samples.length / winLen), 40)
  for (let w = 0; w < windows; w++) {
    const start = w * winLen
    const db = rmsDb(samples, start, winLen)
    const { freq, power } = dominantFreq(samples, start, winLen, sampleRate)
    const powerNorm = 10 * Math.log10(Math.max(power / (winLen * winLen * 32768 * 32768), 1e-12))
    const bar = '#'.repeat(Math.max(0, Math.round((db + 80) / 2)))
    const marker = db > -35 ? '  <-- LOUD' : ''
    console.log(
      `  ${(start / sampleRate).toFixed(1)}s rms=${db.toFixed(1).padStart(7)}dBFS dom=${String(freq).padStart(4)}Hz p=${powerNorm.toFixed(1)}dB ${bar}${marker}`,
    )
  }
}
