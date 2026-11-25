/**
 * M40 RTX 5060 Ti acceptance harness — STATIC SERVER.
 *
 * Serves the validation harness on the SAME origin layout the client-compute
 * engine expects at runtime:
 *   /harness        → validation/m40-rtx/harness.html
 *   /bundle.js      → validation/m40-rtx/bundle.js
 *   /portrait.jpg   → scripts/m262/fixtures/portrait.jpg (real acceptance fixture)
 *   /ort/*          → public/ort/*           (self-hosted onnxruntime-web wasm, jsep build)
 *   /workers/*      → public/workers/*      (built worker bundles)
 *
 * Why a separate server: the client segmentation worker is instantiated from
 * the absolute path `/workers/segmentation-worker.js` and loads its wasm from
 * `/ort/`, and the model cache (Cache API) is origin-scoped — so the harness
 * must be same-origin with those paths WITHOUT touching the app tree or the
 * running product server. This server maps exactly those paths to the repo's
 * existing files and nothing else. It is a validation instrument, not part of
 * the product.
 *
 * Windows usage (real RTX 5060 Ti hardware):
 *   node scripts\m40-acceptance\rtx-harness-server.mjs
 *   chrome --js-flags="--expose-gc" "http://localhost:8787/harness"
 * (build artifacts must exist first: npm run build  OR  npm run dev once)
 */
import http from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const PORT = Number(process.env.RTX_HARNESS_PORT ?? 8787)

const MAP = [
  { route: '/harness', file: 'validation/m40-rtx/harness.html', type: 'text/html; charset=utf-8' },
  { route: '/bundle.js', file: 'validation/m40-rtx/bundle.js', type: 'text/javascript; charset=utf-8' },
  { route: '/portrait.jpg', file: 'scripts/m262/fixtures/portrait.jpg', type: 'image/jpeg' },
]
const PREFIXES = [
  { prefix: '/ort/', dir: 'public/ort' },
  { prefix: '/workers/', dir: 'public/workers' },
]
const TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
}

function send(res, code, body) {
  res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' })
  res.end(body)
}

const server = http.createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0]
  try {
    const exact = MAP.find((m) => m.route === url)
    if (exact) {
      const abs = path.join(ROOT, exact.file)
      if (!existsSync(abs)) return send(res, 404, `missing build artifact: ${exact.file} (run npm run build first)`)
      res.writeHead(200, { 'content-type': exact.type })
      return createReadStream(abs).pipe(res)
    }
    const hit = PREFIXES.find((p) => url.startsWith(p.prefix))
    if (hit) {
      const rel = url.slice(hit.prefix.length).replace(/\.\./g, '')
      const abs = path.join(ROOT, hit.dir, rel)
      if (!existsSync(abs) || !statSync(abs).isFile()) return send(res, 404, 'not found')
      res.writeHead(200, { 'content-type': TYPES[path.extname(abs)] ?? 'application/octet-stream' })
      return createReadStream(abs).pipe(res)
    }
    send(res, 404, 'unknown harness route')
  } catch (e) {
    send(res, 500, `harness server error: ${e?.message ?? e}`)
  }
})

server.listen(PORT, () => {
  console.log(`M40 RTX harness server on http://localhost:${PORT}/harness`)
  console.log(`serving repo root: ${ROOT}`)
})
