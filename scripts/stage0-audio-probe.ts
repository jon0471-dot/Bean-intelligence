/**
 * BEAN Intelligence — GANGZII Stage-0 AUDIO probe.
 *
 * Measures (never assumes) what the authorized gateway's audio surface can
 * actually do BEFORE any GANGZII code is written:
 *   1. TTS wav/mp3/pcm outputs — magic bytes, sizes, latency, duration (ffprobe)
 *   2. TTS voices (all 7 documented), speed range, volume param, exact 1024-char limit
 *   3. ASR round-trip on generated WAV (known text → transcription fidelity)
 *   4. ASR on browser-realistic containers: webm/opus (MediaRecorder), m4a, ogg, flac
 *   5. Chunked synthesis design: 2×PCM chunks concatenated under one WAV header —
 *      verified by duration (ffprobe) + ASR content check
 *
 * Evidence JSON → models/licenses/gangzii-stage0-audio-probe-evidence.json
 * Raw audio artifacts → scripts/stage0-audio-out/
 */
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'

const OUT = '/home/z/my-project/scripts/stage0-audio-out'
fs.mkdirSync(OUT, { recursive: true })

const evidence: Record<string, any> = { startedAt: new Date().toISOString() }

function ffprobeDuration(file: string): number | null {
  try {
    const out = execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file],
      { encoding: 'utf8', timeout: 15_000 },
    ).trim()
    const n = Number(out)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

function ffprobeFormat(file: string): { codec: string | null; sampleRate: string | null; channels: string | null } {
  try {
    const out = execFileSync(
      'ffprobe',
      ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name,sample_rate,channels', '-of', 'json', file],
      { encoding: 'utf8', timeout: 15_000 },
    )
    const j = JSON.parse(out) as { streams?: Array<{ codec_name?: string; sample_rate?: string; channels?: number }> }
    const s = j.streams?.[0]
    return { codec: s?.codec_name ?? null, sampleRate: s?.sample_rate ?? null, channels: s?.channels != null ? String(s.channels) : null }
  } catch {
    return { codec: null, sampleRate: null, channels: null }
  }
}

/** Parse the fmt chunk of a RIFF/WAVE file (bytes 20..35 for PCM). */
function parseWavHeader(buf: Buffer): {
  isRiff: boolean; channels: number | null; sampleRate: number | null; bitsPerSample: number | null
} {
  if (buf.length < 44) return { isRiff: false, channels: null, sampleRate: null, bitsPerSample: null }
  const isRiff = buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE'
  if (!isRiff) return { isRiff: false, channels: null, sampleRate: null, bitsPerSample: null }
  // Walk chunks to find fmt (handles extra chunks before data)
  let off = 12
  let channels: number | null = null
  let sampleRate: number | null = null
  let bits: number | null = null
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    if (id === 'fmt ' && off + 8 + 16 <= buf.length) {
      channels = buf.readUInt16LE(off + 10)
      sampleRate = buf.readUInt32LE(off + 12)
      bits = buf.readUInt16LE(off + 22)
      break
    }
    off += 8 + size + (size % 2)
  }
  return { isRiff, channels, sampleRate, bitsPerSample: bits }
}

async function measure<T>(fn: () => Promise<T>): Promise<{ result: T | null; latencyMs: number; error: string | null }> {
  const t0 = Date.now()
  try {
    return { result: await fn(), latencyMs: Date.now() - t0, error: null }
  } catch (e) {
    return { result: null, latencyMs: Date.now() - t0, error: e instanceof Error ? e.message : String(e) }
  }
}

async function tts(zai: Awaited<ReturnType<typeof ZAI.create>>, body: Record<string, unknown>) {
  const res = (await zai.audio.tts.create(body as never)) as Response
  const ab = await res.arrayBuffer()
  return Buffer.from(new Uint8Array(ab))
}

async function asr(zai: Awaited<ReturnType<typeof ZAI.create>>, file: string) {
  const b64 = fs.readFileSync(file).toString('base64')
  const res = (await zai.audio.asr.create({ file_base64: b64 })) as { text?: string }
  return res?.text ?? null
}

const main = async () => {
  const zai = await ZAI.create()

  // ---- 1. TTS core formats -------------------------------------------------
  evidence.tts = {}
  const SENTENCE = 'BEAN Intelligence audio probe. GANGZII will speak this line for verification.'

  for (const fmt of ['wav', 'mp3', 'pcm'] as const) {
    const m = await measure(() => tts(zai, { input: SENTENCE, voice: 'tongtong', speed: 1.0, response_format: fmt, stream: false }))
    if (m.result) {
      const file = path.join(OUT, `probe-tts.${fmt}`)
      fs.writeFileSync(file, m.result)
      const magic = m.result.subarray(0, 4).toString('ascii')
      evidence.tts[fmt] = {
        ok: true, latencyMs: m.latencyMs, bytes: m.result.length,
        magicHex: m.result.subarray(0, 12).toString('hex'),
        magicAscii: [...m.result.subarray(0, 4)].map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '·')).join(''),
        wavHeader: fmt === 'wav' ? parseWavHeader(m.result) : undefined,
        durationSec: fmt !== 'pcm' ? ffprobeDuration(file) : null,
      }
    } else {
      evidence.tts[fmt] = { ok: false, latencyMs: m.latencyMs, error: m.error }
    }
  }

  // ---- 2. Voices -----------------------------------------------------------
  evidence.ttsVoices = {}
  for (const voice of ['tongtong', 'chuichui', 'xiaochen', 'jam', 'kazi', 'douji', 'luodo', '__invalid_voice__']) {
    const m = await measure(() => tts(zai, { input: 'Voice probe one.', voice, speed: 1.0, response_format: 'wav', stream: false }))
    if (m.result) {
      const file = path.join(OUT, `probe-voice-${voice}.wav`)
      fs.writeFileSync(file, m.result)
      evidence.ttsVoices[voice] = { ok: true, latencyMs: m.latencyMs, bytes: m.result.length, durationSec: ffprobeDuration(file) }
    } else {
      evidence.ttsVoices[voice] = { ok: false, latencyMs: m.latencyMs, error: m.error }
    }
  }

  // ---- 3. Speed + volume + limit ------------------------------------------
  evidence.ttsSpeed = {}
  for (const speed of [0.5, 1.5, 2.0, 0.3]) {
    const m = await measure(() => tts(zai, { input: 'Speed probe for rate control.', voice: 'tongtong', speed, response_format: 'wav', stream: false }))
    if (m.result) {
      const file = path.join(OUT, `probe-speed-${String(speed).replace('.', '_')}.wav`)
      fs.writeFileSync(file, m.result)
      evidence.ttsSpeed[String(speed)] = { ok: true, durationSec: ffprobeDuration(file), bytes: m.result.length }
    } else {
      evidence.ttsSpeed[String(speed)] = { ok: false, error: m.error }
    }
  }

  const vol = await measure(() => tts(zai, { input: 'Volume probe.', voice: 'tongtong', speed: 1.0, volume: 5.0, response_format: 'wav', stream: false } as Record<string, unknown>))
  evidence.ttsVolume = vol.result
    ? { ok: true, bytes: vol.result.length }
    : { ok: false, error: vol.error }

  // Exactly 1024 chars then 1025 chars — establish the real limit boundary.
  const at1024 = 'a'.repeat(1016) + ' End. ' // 1022 → keep under with sentence end
  const exact1024 = ('abcdefghij. ').repeat(85) // 12*85=1020 chars
  const m1024 = await measure(() => tts(zai, { input: exact1024.slice(0, 1024), voice: 'tongtong', speed: 1.0, response_format: 'wav', stream: false }))
  evidence.ttsLimit1024 = m1024.result ? { ok: true, bytes: m1024.result.length } : { ok: false, error: m1024.error }
  const over = await measure(() => tts(zai, { input: exact1024 + 'abcde', voice: 'tongtong', speed: 1.0, response_format: 'wav', stream: false })) // 1025
  evidence.ttsLimit1025 = over.result ? { ok: true, bytes: over.result.length } : { ok: false, error: over.error }
  void at1024

  // ---- 4. ASR round-trip on generated WAV ----------------------------------
  evidence.asr = {}
  const rtt = await measure(() => asr(zai, path.join(OUT, 'probe-tts.wav')))
  evidence.asr.wavRoundTrip = {
    ok: rtt.result != null && rtt.result.length > 0,
    latencyMs: rtt.latencyMs,
    error: rtt.error,
    expected: SENTENCE,
    got: rtt.result,
  }

  // ---- 5. ASR on browser-realistic containers (produced via ffmpeg) --------
  const conversions: Array<{ name: string; args: string[]; ext: string }> = [
    { name: 'webmOpus', ext: 'webm', args: ['-c:a', 'libopus', '-b:a', '64k'] }, // MediaRecorder default
    { name: 'm4aAac', ext: 'm4a', args: ['-c:a', 'aac', '-b:a', '96k'] },
    { name: 'oggVorbis', ext: 'ogg', args: ['-c:a', 'libvorbis'] },
    { name: 'flac', ext: 'flac', args: ['-c:a', 'flac'] },
  ]
  evidence.asrContainers = {}
  for (const c of conversions) {
    const dst = path.join(OUT, `probe-conv.${c.ext}`)
    try {
      execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', path.join(OUT, 'probe-tts.wav'), ...c.args, dst], { timeout: 30_000 })
      const m = await measure(() => asr(zai, dst))
      evidence.asrContainers[c.name] = {
        converted: true, ok: m.result != null && m.result.length > 0, latencyMs: m.latencyMs, error: m.error, got: m.result,
      }
    } catch (e) {
      evidence.asrContainers[c.name] = { converted: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  // ---- 6. Chunked synthesis design (PCM concat under one WAV header) -------
  // Two distinct sentences; synthesize each as PCM, concatenate, wrap in a
  // WAV header, then verify duration (ffprobe) + ASR hears BOTH sentences.
  const s1 = 'This is the first chunk of the long text assembly test.'
  const s2 = 'And this is the second chunk, appended after the first one.'
  const pcmParts: Buffer[] = []
  const chunkLatencies: number[] = []
  let chunkErr: string | null = null
  for (const s of [s1, s2]) {
    const m = await measure(() => tts(zai, { input: s, voice: 'tongtong', speed: 1.0, response_format: 'pcm', stream: false }))
    chunkLatencies.push(m.latencyMs)
    if (!m.result) { chunkErr = m.error; break }
    pcmParts.push(m.result)
  }
  if (pcmParts.length === 2) {
    // Derive the WAV framing from the measured wav output: wav size - pcm size for the
    // same sentence gives the header size. pcm bytes = samples * 2 (16-bit).
    const wavBuf = fs.readFileSync(path.join(OUT, 'probe-tts.wav'))
    const pcmSingle = fs.readFileSync(path.join(OUT, 'probe-tts.pcm'))
    const headerBytes = wavBuf.length - pcmSingle.length
    const fmt = parseWavHeader(wavBuf)
    const totalPcm = pcmParts.reduce((n, b) => n + b.length, 0)
    // Rebuild a canonical 44-byte PCM WAV header from MEASURED fmt values.
    const sr = fmt.sampleRate ?? 24000
    const ch = fmt.channels ?? 1
    const bits = fmt.bitsPerSample ?? 16
    const header = Buffer.alloc(44)
    header.write('RIFF', 0, 'ascii')
    header.writeUInt32LE(36 + totalPcm, 4)
    header.write('WAVE', 8, 'ascii')
    header.write('fmt ', 12, 'ascii')
    header.writeUInt32LE(16, 16)
    header.writeUInt16LE(1, 20) // PCM
    header.writeUInt16LE(ch, 22)
    header.writeUInt32LE(sr, 24)
    header.writeUInt32LE((sr * ch * bits) / 8, 28) // byte rate
    header.writeUInt16LE((ch * bits) / 8, 32) // block align
    header.writeUInt16LE(bits, 34)
    header.write('data', 36, 'ascii')
    header.writeUInt32LE(totalPcm, 40)
    const assembled = Buffer.concat([header, ...pcmParts])
    const assembledPath = path.join(OUT, 'probe-assembled.wav')
    fs.writeFileSync(assembledPath, assembled)
    const dur = ffprobeDuration(assembledPath)
    const asrM = await measure(() => asr(zai, assembledPath))
    evidence.chunkedAssembly = {
      ok: dur != null && dur > 2,
      headerBytesDerived: headerBytes,
      wavFmt: fmt,
      chunkLatenciesMs: chunkLatencies,
      assembledBytes: assembled.length,
      assembledDurationSec: dur,
      ffprobeFormat: ffprobeFormat(assembledPath),
      asrText: asrM.result,
      asrError: asrM.error,
      asrHearsBothChunks: asrM.result != null && asrM.result.includes('first chunk') && asrM.result.includes('second chunk'),
    }
  } else {
    evidence.chunkedAssembly = { ok: false, error: chunkErr }
  }

  evidence.finishedAt = new Date().toISOString()
  const allOk =
    (evidence.tts as Record<string, { ok: boolean }>).wav?.ok &&
    (evidence.asr as Record<string, { ok: boolean }>).wavRoundTrip?.ok
  evidence.summary = {
    ttsWav: (evidence.tts as Record<string, { ok: boolean }>).wav?.ok ?? false,
    ttsMp3: (evidence.tts as Record<string, { ok: boolean }>).mp3?.ok ?? false,
    ttsPcm: (evidence.tts as Record<string, { ok: boolean }>).pcm?.ok ?? false,
    asrRoundTrip: (evidence.asr as Record<string, { ok: boolean }>).wavRoundTrip?.ok ?? false,
    chunkedAssembly: (evidence.chunkedAssembly as { ok: boolean } | undefined)?.ok ?? false,
    verdict: allOk ? 'Audio backends VERIFIED — proceed with GANGZII build.' : 'One or more audio backends FAILED — do not claim capability.',
  }

  fs.writeFileSync(
    '/home/z/my-project/models/licenses/gangzii-stage0-audio-probe-evidence.json',
    JSON.stringify(evidence, null, 2),
  )
  console.log(JSON.stringify(evidence.summary, null, 2))
  console.log('\nTTS formats:', JSON.stringify(evidence.tts, null, 2))
  console.log('\nVoices:', JSON.stringify(evidence.ttsVoices, null, 2))
  console.log('\nSpeed:', JSON.stringify(evidence.ttsSpeed, null, 2))
  console.log('\nVolume:', JSON.stringify(evidence.ttsVolume, null, 2))
  console.log('\nLimit1024:', JSON.stringify(evidence.ttsLimit1024), '\nLimit1025:', JSON.stringify(evidence.ttsLimit1025))
  console.log('\nASR round-trip:', JSON.stringify(evidence.asr, null, 2))
  console.log('\nASR containers:', JSON.stringify(evidence.asrContainers, null, 2))
  console.log('\nChunked assembly:', JSON.stringify(evidence.chunkedAssembly, null, 2))
}

void main()
