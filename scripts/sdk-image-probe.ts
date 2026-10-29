/** Does the gateway chat accept image content parts (vision)? Tiny 8x8 red PNG. */
import ZAI from 'z-ai-web-dev-sdk'
// 1x1 red PNG (67 bytes, valid)
const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const zai = await ZAI.create()
try {
  const r = await zai.chat.completions.create({
    messages: [{ role: 'user', content: [
      { type: 'text', text: 'What color is this image? One word.' },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
    ] as never }],
    thinking: { type: 'disabled' },
  })
  console.log('VISION_OK:', JSON.stringify(r.choices?.[0]?.message?.content ?? '').slice(0, 120))
} catch (e) {
  console.log('VISION_FAIL:', (e instanceof Error ? e.message : String(e)).slice(0, 200))
}
