/**
 * M26.2 — real ONNX inference probe for the three selected local models.
 * Runs against onnxruntime-node with synthetic sharp-generated fixtures.
 * Confirms: session load, input/output metadata, real tensor inference,
 * and output sanity for MODNet (matting), LaMa (inpainting), RIFE (interp).
 */
import * as ort from 'onnxruntime-node'
import sharp from 'sharp'
import path from 'node:path'

const DIR = path.join(process.cwd(), 'storage', 'models', 'probe')

async function makeFixture(w: number, h: number, file: string): Promise<Buffer> {
  // Synthetic "product on uniform background": light-gray bg + dark circle + bright bar
  const svg = `<svg width="${w}" height="${h}">
    <rect width="100%" height="100%" fill="#e8e8e8"/>
    <circle cx="${Math.round(w * 0.45)}" cy="${Math.round(h * 0.55)}" r="${Math.round(Math.min(w, h) * 0.3)}" fill="#305070"/>
    <rect x="${Math.round(w * 0.7)}" y="${Math.round(h * 0.2)}" width="${Math.round(w * 0.15)}" height="${Math.round(h * 0.12)}" fill="#c0a030"/>
  </svg>`
  const png = await sharp(Buffer.from(svg)).png().toBuffer()
  await sharp(png).toFile(file)
  return png
}

function f32(buf: Uint8Array, scale: number): Float32Array {
  const out = new Float32Array(buf.length)
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] * scale
  return out
}

async function probeModnet() {
  const p = path.join(DIR, 'modnet.onnx')
  const session = await ort.InferenceSession.create(p, { executionProviders: ['cpu'] })
  const meta = session.inputNames.concat('|OUT|', session.outputNames)
  const size = 512
  const png = await makeFixture(size, size, '/tmp/probe-modnet.png')
  const rgb = await sharp(png).removeAlpha().raw().toBuffer()
  const data = f32(rgb, 1 / 255)
  console.log(`MODNET inputMeta=${JSON.stringify((session as unknown as { inputMetadata: unknown }).inputMetadata)}`)
  const t0 = Date.now()
  const out = await session.run({ input: new ort.Tensor('float32', data, [1, 3, size, size]) })
  const ms = Date.now() - t0
  const alpha = out[session.outputNames[0]] as ort.Tensor
  const a = alpha.data as Float32Array
  let min = 1, max = 0, frac = 0
  for (const v of a) { if (v < min) min = v; if (v > max) max = v; if (v > 0.5) frac++ }
  console.log(`MODNET ok ${ms}ms in=[${meta}] out=[${alpha.dims}] alphaRange=[${min.toFixed(3)},${max.toFixed(3)}] subjectFraction=${(frac / a.length).toFixed(3)}`)
}

async function probeLama() {
  const p = path.join(DIR, 'lama.onnx')
  const session = await ort.InferenceSession.create(p, { executionProviders: ['cpu'] })
  const size = 512
  const png = await makeFixture(size, size, '/tmp/probe-lama.png')
  const raw = await sharp(png).removeAlpha().raw().toBuffer()
  // RGB -> BGR for the OpenCV-convention input
  const bgr = Buffer.alloc(size * size * 3)
  for (let i = 0; i < size * size; i++) {
    bgr[i * 3] = raw[i * 3 + 2]; bgr[i * 3 + 1] = raw[i * 3 + 1]; bgr[i * 3 + 2] = raw[i * 3]
  }
  const img = f32(bgr, 1 / 255)
  // Mask: erase the circle region (center block) — real structural inpaint task
  const mask = new Float32Array(size * size)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = x - size * 0.45, dy = y - size * 0.55
      if (dx * dx + dy * dy < Math.pow(size * 0.3, 2)) mask[y * size + x] = 1
    }
  const t0 = Date.now()
  const out = await session.run({
    image: new ort.Tensor('float32', img, [1, 3, size, size]),
    mask: new ort.Tensor('float32', mask, [1, 1, size, size]),
  })
  const ms = Date.now() - t0
  const o = out[Object.keys(out)[0]] as ort.Tensor
  const d = o.data as Float32Array
  let min = 255, max = 0
  for (const v of d) { if (v < min) min = v; if (v > max) max = v }
  console.log(`LAMA ok ${ms}ms in=[${session.inputNames}] out=[${o.dims}] range=[${min.toFixed(1)},${max.toFixed(1)}]`)
}

async function probeRife() {
  const p = path.join(DIR, 'rife.onnx')
  const session = await ort.InferenceSession.create(p, { executionProviders: ['cpu'] })
  console.log(`RIFE inputs=${session.inputNames} outputs=${session.outputNames} inputMeta=${JSON.stringify((session as unknown as { inputMetadata: unknown }).inputMetadata)}`)
  const size = 256
  const frames: Float32Array[] = []
  for (const f of [0, 1]) {
    const svg = `<svg width="${size}" height="${size}"><rect width="100%" height="100%" fill="#202830"/><rect x="${f === 0 ? 20 : 60}" y="110" width="60" height="60" fill="#e0b040" transform="rotate(${f === 0 ? 0 : 8} 128 128)"/></svg>`
    const png = await sharp(Buffer.from(svg)).png().toBuffer()
    const raw = await sharp(png).removeAlpha().raw().toBuffer()
    // map 0..255 -> -1..1
    const arr = new Float32Array(raw.length)
    for (let i = 0; i < arr.length; i++) arr[i] = raw[i] / 127.5 - 1
    frames.push(arr)
  }
  const t0 = Date.now()
  // Single-input export — try the candidate frame-packing conventions.
  const candidates: Array<{ shape: number[]; label: string; build: () => Float32Array }> = [
    { shape: [1, 6, size, size], label: 'frames-stacked-6ch', build: () => new Float32Array([...frames[0], ...frames[1]]) },
    {
      shape: [1, 7, size, size], label: 'frames+t-7ch', build: () => {
        const a = new Float32Array(size * size * 7)
        a.set(frames[0], 0)
        a.set(frames[1], size * size * 3)
        a.fill(0.5, size * size * 6)
        return a
      },
    },
    { shape: [2, 3, size, size], label: 'batched-2x3ch', build: () => new Float32Array([...frames[0], ...frames[1]]) },
  ]
  let o: ort.Tensor | null = null
  let used = ''
  for (const c of candidates) {
    try {
      const out = await session.run({ input: new ort.Tensor('float32', c.build(), c.shape) })
      o = out[session.outputNames[0]] as ort.Tensor
      used = c.label
      break
    } catch (e) {
      console.log(`RIFE candidate ${c.label} rejected: ${e instanceof Error ? e.message.slice(0, 120) : e}`)
    }
  }
  const ms = Date.now() - t0
  if (!o) { console.log('RIFE FAILED: no candidate shape accepted'); return }
  const d = o.data as Float32Array
  let min = 255, max = -255
  for (const v of d) { const u = (v + 1) * 127.5; if (u < min) min = u; if (u > max) max = u }
  console.log(`RIFE ok ${ms}ms shape=${used} out=[${o.dims}] mappedRange=[${min.toFixed(1)},${max.toFixed(1)}]`)
}

const only = process.argv[2]
for (const [name, fn] of [['modnet', probeModnet], ['lama', probeLama], ['rife', probeRife]] as const) {
  if (only && only !== name) continue
  try { await fn() } catch (e) { console.error(`${name.toUpperCase()} FAILED:`, e instanceof Error ? e.message : e) }
}
