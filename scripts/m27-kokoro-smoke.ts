/**
 * M27 — REAL local TTS smoke test (not a mock): loads the Kokoro-82M ONNX
 * model from storage/models/ and synthesizes actual speech, then validates
 * the produced WAV with ffprobe. Measures generation time + memory.
 * Usage: bun scripts/m27-kokoro-smoke.ts
 */
import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'

const MODELS_ROOT = path.join(process.cwd(), 'storage', 'models', 'hf')
const REPO = 'onnx-community/Kokoro-82M-v1.0-ONNX'

async function main() {
  const t0 = Date.now()
  const memBefore = process.memoryUsage().heapUsed
  const { KokoroTTS } = await import('kokoro-js')
  // Configure the TRANSFORMERS env directly (same object kokoro-js re-exports,
  // but imported from the package that owns it to be certain).
  const { env } = await import('@huggingface/transformers')
  env.allowRemoteModels = false
  env.allowLocalModels = true
  env.localModelPath = MODELS_ROOT
  console.log('[smoke] remote models disabled; local path', MODELS_ROOT)
  console.log('[smoke] loading Kokoro-82M (q8) from', path.join(MODELS_ROOT, REPO))
  const tts = await KokoroTTS.from_pretrained(REPO, { dtype: 'q8', device: 'cpu' })
  const loadMs = Date.now() - t0
  console.log('[smoke] loaded in', loadMs, 'ms; voices:', Object.keys((tts as unknown as { voices: Record<string, unknown> }).voices).length)

  const text = 'GANGZII is the audio production specialist of BEAN Intelligence. This narration was synthesized locally on this machine.'
  const t1 = Date.now()
  const audio = await tts.generate(text, { voice: 'af_heart', speed: 1.0 })
  const genMs = Date.now() - t1
  const raw = audio as unknown as { audio: Float32Array; sampling_rate: number }
  const samples: Float32Array = raw.audio instanceof Float32Array ? raw.audio : new Float32Array(raw.audio)
  const sampleRate: number = raw.sampling_rate
  console.log('[smoke] generated', samples.length, 'samples at', sampleRate, 'Hz in', genMs, 'ms')

  // Encode 16-bit PCM WAV
  const pcm = Buffer.alloc(samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    pcm.writeInt16LE(Math.round(s * 32767), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(pcm.length, 40)
  const outDir = '/tmp/m27-smoke'
  fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, `kokoro-smoke-${Date.now()}.wav`)
  fs.writeFileSync(outPath, Buffer.concat([header, pcm]))
  const durationSec = samples.length / sampleRate
  console.log('[smoke] WAV written:', outPath, (fs.statSync(outPath).size / 1e6).toFixed(2), 'MB, duration', durationSec.toFixed(2), 's')

  // ffprobe validation (real, not assumed)
  await new Promise<void>((resolve, reject) => {
    execFile('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,sample_rate,channels,duration', '-of', 'json', outPath], (err, stdout) => {
      if (err) reject(err)
      else {
        console.log('[smoke] ffprobe:', stdout.trim())
        resolve()
      }
    })
  })
  const memAfter = process.memoryUsage().heapUsed
  console.log('[smoke] heap used ~', Math.round((memAfter - memBefore) / 1e6), 'MB delta; RSS', Math.round(process.memoryUsage().rss / 1e6), 'MB')
  console.log('[smoke] RESULT: REAL LOCAL SPEECH GENERATED OK — load', loadMs, 'ms, gen', genMs, 'ms for', durationSec.toFixed(2), 's audio (RTF', (genMs / 1000 / durationSec).toFixed(2), ')')
}

main().catch((e) => {
  console.error('[smoke] FAILED:', e instanceof Error ? e.message : e)
  process.exit(1)
})
