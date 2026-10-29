/** Probe: which vision model name works with createVision, and does audio.asr work? */
import ZAI from 'z-ai-web-dev-sdk'

const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const zai = await ZAI.create()

for (const model of ['glm-4.5v', 'glm-4v', 'glm-4v-flash', 'glm-4v-plus']) {
  try {
    const r = await zai.chat.completions.createVision({
      model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'What color is this image? Answer with one word.' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
        ],
      }],
      thinking: { type: 'disabled' },
    })
    console.log(`VISION ${model}: OK ->`, JSON.stringify(r.choices?.[0]?.message?.content ?? '').slice(0, 100))
    break
  } catch (e) {
    console.log(`VISION ${model}: FAIL ->`, (e instanceof Error ? e.message : String(e)).slice(0, 120))
  }
}

// 1s 440Hz sine wav via ffmpeg, then ASR probe
const { execSync } = await import('node:child_process')
execSync('ffmpeg -y -f lavfi -i "sine=frequency=440:duration=1" -ar 16000 /tmp/asr-probe.wav 2>/dev/null')
const fs = await import('node:fs')
const wav = fs.readFileSync('/tmp/asr-probe.wav').toString('base64')
try {
  const r = await zai.audio.asr.create({ file_base64: wav })
  console.log('ASR: OK ->', JSON.stringify(r).slice(0, 200))
} catch (e) {
  console.log('ASR: FAIL ->', (e instanceof Error ? e.message : String(e)).slice(0, 200))
}
