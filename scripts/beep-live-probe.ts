/**
 * GANGZII beep root-cause live probe (economy: 4 gateway TTS calls, 3s apart).
 *
 * Questions answered:
 *  Q1 Does response_format 'wav' come back beep-free? (header + first 1.2s)
 *  Q2 Does response_format 'pcm' carry the 1650 Hz tone?
 *  Q3 Is the tone per-CALL or only on the first call of a process?
 *  Q4 Can wav-format responses be parsed chunk-wise (RIFF/24k/mono/16-bit) so
 *     the adapter can switch formats and assemble beep-free multi-chunk audio?
 *
 * Evidence: JSON + WAV artifacts under scripts/beep-probe-out/.
 */
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'fs'
import path from 'path'

const OUT = path.join(process.cwd(), 'scripts', 'beep-probe-out')
fs.mkdirSync(OUT, { recursive: true })
const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface CallResult {
  label: string
  format: string
  ok: boolean
  bytes: number
  latencyMs: number
  error?: string
  parsedWav?: { sampleRate: number; channels: number; bits: number; dataBytes: number }
}

function parseWav(buf: Buffer): { sampleRate: number; channels: number; bits: number; dataOff: number; dataLen: number } | null {
  if (buf.length < 44) return null
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null
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
  if (dataOff < 0) return null
  return { sampleRate, channels, bits, dataOff, dataLen }
}

function pcmFromWav(buf: Buffer): Buffer {
  const w = parseWav(buf)
  if (!w) throw new Error('not a WAV')
  return buf.subarray(w.dataOff, w.dataOff + w.dataLen)
}

/** Goertzel power at 1650 Hz over a 0.3s window, in dBFS-ish normalized units. */
function tone1650Power(pcm: Buffer, startSample: number, winSamples: number, rate = 24000): number {
  const n = Math.min(winSamples, Math.floor(pcm.length / 2) - startSample)
  if (n < 1000) return -200
  let s1 = 0
  let s2 = 0
  const w = (2 * Math.PI * 1650) / rate
  const coeff = 2 * Math.cos(w)
  for (let i = 0; i < n; i++) {
    const x = pcm.readInt16LE((startSample + i) * 2)
    const s0 = x + coeff * s1 - s2
    s2 = s1
    s1 = s0
  }
  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2
  return 10 * Math.log10(Math.max(power / (n * n * 32768 * 32768), 1e-12))
}

/** RMS dBFS over a window. */
function rmsDb(pcm: Buffer, startSample: number, winSamples: number): number {
  const n = Math.min(winSamples, Math.floor(pcm.length / 2) - startSample)
  if (n <= 0) return -200
  let acc = 0
  for (let i = 0; i < n; i++) acc += pcm.readInt16LE((startSample + i) * 2) ** 2
  const rms = Math.sqrt(acc / n) / 32768
  return 20 * Math.log10(Math.max(rms, 1e-10))
}

function analyze(label: string, pcm: Buffer): { tone0_06: number; tone0_18: number; tone0_30: number; rms0_06: number; rms0_18: number; rms0_30: number } {
  const w06 = Math.floor(24000 * 0.06)
  return {
    tone0_06: Math.round(tone1650Power(pcm, 0, w06) * 10) / 10,
    tone0_18: Math.round(tone1650Power(pcm, Math.floor(24000 * 0.12), w06) * 10) / 10,
    tone0_30: Math.round(tone1650Power(pcm, Math.floor(24000 * 0.24), w06) * 10) / 10,
    rms0_06: Math.round(rmsDb(pcm, 0, w06) * 10) / 10,
    rms0_18: Math.round(rmsDb(pcm, Math.floor(24000 * 0.12), w06) * 10) / 10,
    rms0_30: Math.round(rmsDb(pcm, Math.floor(24000 * 0.24), w06) * 10) / 10,
  }
}

async function callTts(zai: Awaited<ReturnType<typeof ZAI.create>>, body: Record<string, unknown>): Promise<Buffer> {
  const res = (await zai.audio.tts.create(body as never)) as Response
  return Buffer.from(new Uint8Array(await res.arrayBuffer()))
}

const TEXT = 'GANGZII beep probe line one.'
const results: Array<CallResult & { analysis?: ReturnType<typeof analyze> }> = []
const artifacts: Record<string, string> = {}

async function run(label: string, format: 'wav' | 'pcm') {
  const t0 = Date.now()
  try {
    const buf = await callTts(zai, { input: TEXT, voice: 'tongtong', speed: 1.0, response_format: format, stream: false })
    const r: CallResult & { analysis?: ReturnType<typeof analyze> } = {
      label,
      format,
      ok: buf.length > 44,
      bytes: buf.length,
      latencyMs: Date.now() - t0,
    }
    if (format === 'wav') {
      const w = parseWav(buf)
      r.parsedWav = w ? { sampleRate: w.sampleRate, channels: w.channels, bits: w.bits, dataBytes: w.dataLen } : undefined
      r.ok = !!w && w.sampleRate === 24000 && w.channels === 1 && w.bits === 16
      if (w) r.analysis = analyze(label, pcmFromWav(buf))
      const p = path.join(OUT, `${label}.wav`)
      fs.writeFileSync(p, buf)
      artifacts[label] = p
    } else {
      r.analysis = analyze(label, buf)
      // wrap raw pcm in a minimal WAV for later listening/verification
      const header = Buffer.alloc(44)
      header.write('RIFF', 0, 'ascii')
      header.writeUInt32LE(36 + buf.length, 4)
      header.write('WAVE', 8, 'ascii')
      header.write('fmt ', 12, 'ascii')
      header.writeUInt32LE(16, 16)
      header.writeUInt16LE(1, 20)
      header.writeUInt16LE(1, 22)
      header.writeUInt32LE(24000, 24)
      header.writeUInt32LE(48000, 28)
      header.writeUInt16LE(2, 32)
      header.writeUInt16LE(16, 34)
      header.write('data', 36, 'ascii')
      header.writeUInt32LE(buf.length, 40)
      const p = path.join(OUT, `${label}.wav`)
      fs.writeFileSync(p, Buffer.concat([header, buf]))
      artifacts[label] = p
    }
    results.push(r)
    console.log(JSON.stringify(r))
  } catch (e) {
    results.push({ label, format, ok: false, bytes: 0, latencyMs: Date.now() - t0, error: e instanceof Error ? e.message : String(e) })
    console.log(JSON.stringify(results[results.length - 1]))
  }
}

const zai = await ZAI.create()

// Q1/Q4a: wav format, call 1
await run('wav-call1', 'wav')
await SLEEP(3000)
// Q2/Q3: pcm format, call 2
await run('pcm-call2', 'pcm')
await SLEEP(3000)
// Q3: pcm format again, call 3
await run('pcm-call3', 'pcm')
await SLEEP(3000)
// Q4b: wav format again — proves per-call reproducibility of the clean path
await run('wav-call4', 'wav')

const evidence = {
  startedAt: new Date().toISOString(),
  text: TEXT,
  voice: 'tongtong',
  results,
  artifacts,
  interpretation: {
    beepToneHz: 1650,
    beepPresentIn: results.filter((r) => r.analysis && r.analysis.tone0_06 > -45 && r.analysis.tone0_18 > -45).map((r) => r.label),
    beepAbsentIn: results.filter((r) => r.analysis && !(r.analysis.tone0_06 > -45 && r.analysis.tone0_18 > -45)).map((r) => r.label),
  },
  finishedAt: new Date().toISOString(),
}
fs.writeFileSync(path.join(OUT, 'beep-probe-evidence.json'), JSON.stringify(evidence, null, 2))
console.log('\nEVIDENCE saved to scripts/beep-probe-out/beep-probe-evidence.json')
console.log('beep present in:', evidence.interpretation.beepPresentIn)
console.log('beep absent in:', evidence.interpretation.beepAbsentIn)
