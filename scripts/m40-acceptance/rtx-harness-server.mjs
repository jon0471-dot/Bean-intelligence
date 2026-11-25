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
 * Windows usage (real RTX 5060 Ti hardware) — see the ONE-COMMAND runner:
 *   powershell -ExecutionPolicy Bypass -File scripts\m40-acceptance\run-rtx-acceptance.ps1
 * Manual usage (equivalent, still supported):
 *   node scripts\m40-acceptance\rtx-harness-server.mjs
 *   chrome --js-flags="--expose-gc" "http://localhost:8787/harness"
 * (build artifacts must exist first: npm run build  OR  npm run dev once)
 *
 * M40.9 addition: the harness page now POSTs its finished evidence JSON to
 * POST /evidence (same origin). The server schema-gates the payload, saves it
 * to validation/m40-rtx/results-<utcstamp>.json and answers with the saved
 * path — so the PowerShell runner can wait for the file instead of requiring
 * a manual download-button click. The payload is exactly what the page
 * rendered (browser-side measurements only): no secrets and no local file
 * paths exist in it by construction.
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

const OUT_DIR = path.join(ROOT, 'validation', 'm40-rtx')

/** Minimal shape gate for harness evidence (full JSON-Schema validation happens
 * in validate-rtx-evidence.mjs; the server only refuses clearly-broken bodies). */
function plausibleEvidence(body) {
  return (
    body != null &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    typeof body.startedAt === 'string' &&
    Array.isArray(body.checks) &&
    body.checks.every(
      (c) =>
        c != null &&
        typeof c === 'object' &&
        typeof c.point === 'string' &&
        typeof c.name === 'string' &&
        (typeof c.ok === 'boolean' || c.ok === null) &&
        typeof c.detail === 'string',
    )
  )
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 16 * 1048576) {
        reject(new Error('evidence payload too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

const server = http.createServer(async (req, res) => {
  const url = (req.url ?? '/').split('?')[0]
  try {
    if (req.method === 'POST' && url === '/evidence') {
      const raw = await readBody(req)
      let body
      try {
        body = JSON.parse(raw.toString('utf8'))
      } catch {
        return send(res, 400, 'evidence POST body is not valid JSON')
      }
      if (!plausibleEvidence(body)) {
        return send(res, 422, 'evidence payload does not match the harness evidence shape (startedAt/checks[{point,name,ok,detail}])')
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const file = path.join(OUT_DIR, `results-${stamp}.json`)
      const { writeFileSync } = await import('node:fs')
      writeFileSync(file, JSON.stringify(body, null, 1))
      console.log(`[m40-rtx] evidence received (${body.checks.length} checks) → ${path.relative(ROOT, file)}`)
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ saved: path.relative(ROOT, file), checks: body.checks.length }))
    }
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
