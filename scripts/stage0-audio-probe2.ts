/**
 * GANGZII Stage-0 audio probe — PART 2 (throttled).
 * Re-tests the items that hit the gateway burst limit (429) in part 1,
 * with generous sleeps between calls. Merges results into the same
 * evidence JSON under `part2`.
 */
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'

const OUT = '/home/z/my-project/scripts/stage0-audio-out'
const EVIDENCE_PATH = '/home/z/my-project/models/licenses/gangzii-stage0-audio-probe-evidence.json'
const SLEEP_MS = 9_000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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
  const part2: Record<string, unknown> = { startedAt: new Date().toISOString() }

  // 1. volume param
  const vol = await measure(() => tts(zai, { input: 'Volume probe.', voice: 'tongtong', speed: 1.0, volume: 5.0, response_format: 'wav', stream: false }))
  part2.volume = vol.result ? { ok: true, bytes: vol.result.length } : { ok: false, error: vol.error }
  await sleep(SLEEP_MS)

  // 2. limit: exactly 1024
  const exact1024 = ('abcdefghij. ').repeat(85).slice(0, 1024)
  const m1024 = await measure(() => tts(zai, { input: exact1024, voice: 'tongtong', speed: 1.0, response_format: 'wav', stream: false }))
  part2.limit1024 = m1024.result ? { ok: true, bytes: m1024.result.length } : { ok: false, error: m1024.error }
  await sleep(SLEEP_MS)

  // 3. limit: 1025
  const over = await measure(() => tts(zai, { input: exact1024 + 'abcde', voice: 'tongtong', speed: 1.0, response_format: 'wav', stream: false }))
  part2.limit1025 = over.result ? { ok: true, bytes: over.result.length } : { ok: false, error: over.error }
  await sleep(SLEEP_MS)

  // 4. ASR round-trip on the wav from part 1
  const rtt = await measure(() => asr(zai, path.join(OUT, 'probe-tts.wav')))
  part2.asrWavRoundTrip = {
    ok: rtt.result != null && rtt.result.length > 0,
    latencyMs: rtt.latencyMs, error: rtt.error,
    expected: 'BEAN Intelligence audio probe. GANGZII will speak this line for verification.',
    got: rtt.result,
  }
  await sleep(SLEEP_MS)

  // 5. ASR containers
  const containers: Array<{ name: string; ext: string; args: string[] }> = [
    { name: 'webmOpus', ext: 'webm', args: ['-c:a', 'libopus', '-b:a', '64k'] },
    { name: 'm4aAac', ext: 'm4a', args: ['-c:a', 'aac', '-b:a', '96k'] },
    { name: 'oggVorbis', ext: 'ogg', args: ['-c:a', 'libvorbis'] },
    { name: 'flac', ext: 'flac', args: ['-c:a', 'flac'] },
  ]
  part2.asrContainers = {}
  for (const c of containers) {
    const dst = path.join(OUT, `probe-conv.${c.ext}`)
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', path.join(OUT, 'probe-tts.wav'), ...c.args, dst], { timeout: 30_000 })
    const m = await measure(() => asr(zai, dst))
    ;(part2.asrContainers as Record<string, unknown>)[c.name] = {
      ok: m.result != null && m.result.length > 0, latencyMs: m.latencyMs, error: m.error, got: m.result,
    }
    await sleep(SLEEP_MS)
  }

  // 6. chunked assembly: 2 PCM chunks → one WAV
  const s1 = 'This is the first chunk of the long text assembly test.'
  const s2 = 'And this is the second chunk, appended after the first one.'
  const parts: Buffer[] = []
  const lats: number[] = []
  let chunkErr: string | null = null
  for (const s of [s1, s2]) {
    const m = await measure(() => tts(zai, { input: s, voice: 'tongtong', speed: 1.0, response_format: 'pcm', stream: false }))
    lats.push(m.latencyMs)
    if (!m.result) { chunkErr = m.error; break }
    parts.push(m.result)
    await sleep(SLEEP_MS)
  }
  if (parts.length === 2) {
    const totalPcm = parts.reduce((n, b) => n + b.length, 0)
    const header = Buffer.alloc(44)
    header.write('RIFF', 0, 'ascii')
    header.writeUInt32LE(36 + totalPcm, 4)
    header.write('WAVE', 8, 'ascii')
    header.write('fmt ', 12, 'ascii')
    header.writeUInt32LE(16, 16)
    header.writeUInt16LE(1, 20)
    header.writeUInt16LE(1, 22) // mono (measured in part 1)
    header.writeUInt32LE(24000, 24) // measured in part 1
    header.writeUInt32LE(48000, 28)
    header.writeUInt16LE(2, 32)
    header.writeUInt16LE(16, 34)
    header.write('data', 36, 'ascii')
    header.writeUInt32LE(totalPcm, 40)
    const assembled = Buffer.concat([header, ...parts])
    const assembledPath = path.join(OUT, 'probe-assembled.wav')
    fs.writeFileSync(assembledPath, assembled)
    const dur = ffprobeDuration(assembledPath)
    const asrM = await measure(() => asr(zai, assembledPath))
    part2.chunkedAssembly = {
      ok: dur != null && dur > 2,
      chunkLatenciesMs: lats,
      assembledBytes: assembled.length,
      assembledDurationSec: dur,
      asrText: asrM.result,
      asrError: asrM.error,
      asrHearsBothChunks: asrM.result != null && asrM.result.includes('first chunk') && asrM.result.includes('second chunk'),
    }
  } else {
    part2.chunkedAssembly = { ok: false, error: chunkErr }
  }

  part2.finishedAt = new Date().toISOString()

  // merge into evidence
  const evidence = JSON.parse(fs.readFileSync(EVIDENCE_PATH, 'utf8')) as Record<string, unknown>
  evidence.part2 = part2
  evidence.summary = {
    ...(evidence.summary as Record<string, unknown>),
    asrRoundTrip: (part2.asrWavRoundTrip as { ok: boolean }).ok,
    chunkedAssembly: (part2.chunkedAssembly as { ok: boolean }).ok,
    volumeParam: (part2.volume as { ok: boolean }).ok,
    limit1024: (part2.limit1024 as { ok: boolean }).ok,
    limit1025Rejected: !(part2.limit1025 as { ok: boolean }).ok,
  }
  fs.writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify(part2, null, 2))
}

void main()
