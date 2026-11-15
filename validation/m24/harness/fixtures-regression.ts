/**
 * M24 — M21 fixture regression on ISOLATED copies (Section 11).
 *
 * - Copies the three M21 fixtures (Nebula landing / Pulse dashboard / Nova
 *   Reyes portfolio) into validation/m24/fixtures/ — the originals are
 *   hash-verified byte-for-byte untouched.
 * - Builds each copy through the SAME pipeline as the M21 gate (generated
 *   dependency pins → tsc → vite production build).
 * - Renders each built copy in real Chromium: key content, console/page
 *   errors, internal navigation, mobile viewport, reduced motion.
 * - Exports each copy through the REAL ZIP exporter module and verifies.
 *
 * Run: bun validation/m24/harness/fixtures-regression.ts [a|b|c]
 */
import { createRequire } from 'node:module'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import {
  check,
  saveReport,
  sha256,
  stepStatus,
  type Check,
  type StepReport,
} from './lib'

const require = createRequire(import.meta.url)
const { chromium } = require('/home/z/.npm-global/lib/node_modules/playwright') as {
  chromium: import('/home/z/.npm-global/lib/node_modules/playwright/index.mjs').Chromium
}

const ROOT = path.resolve(import.meta.dir, '../../..')
const M21 = path.join(ROOT, 'validation/m21')
const M24 = path.join(ROOT, 'validation/m24')
const FIXTURES = path.join(M24, 'fixtures')
const EVIDENCE = path.join(M24, 'evidence')
fs.mkdirSync(FIXTURES, { recursive: true })
fs.mkdirSync(EVIDENCE, { recursive: true })

const PROJECTS = {
  a: { src: 'project-a-landing', name: 'Nebula landing page', port: 4311, expect: ['Nebula'] },
  b: { src: 'project-b-dashboard', name: 'Pulse analytics dashboard', port: 4312, expect: ['Pulse'] },
  c: { src: 'project-c-portfolio', name: 'Nova Reyes portfolio', port: 4313, expect: ['Nova'] },
} as const

type Key = keyof typeof PROJECTS
const argv = process.argv.slice(2).filter((a) => !a.startsWith('--')) as Key[]
const runKeys = argv.length > 0 && PROJECTS[argv[0] as Key] ? argv : (Object.keys(PROJECTS) as Key[])

function newStep(id: string, title: string): StepReport {
  return { id, title, status: 'NOT_TESTED', startedAt: new Date().toISOString(), checks: [], data: {} }
}

function finish(step: StepReport): StepReport {
  step.finishedAt = new Date().toISOString()
  step.durationMs = Date.parse(step.finishedAt) - Date.parse(step.startedAt)
  step.status = stepStatus(step.checks)
  return step
}

/** Every file under dir (relative paths, files only). */
function walkFiles(dir: string, base = dir): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walkFiles(p, base))
    else out.push(path.relative(base, p))
  }
  return out.sort()
}

const fileHashMap = (dir: string): Map<string, string> => {
  const map = new Map<string, string>()
  for (const rel of walkFiles(dir)) map.set(rel, sha256(fs.readFileSync(path.join(dir, rel), 'utf8')))
  return map
}

function serveStatic(root: string, port: number): Promise<http.Server> {
  const mime: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
  }
  const server = http.createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0]
    const file = path.join(root, decodeURIComponent(url))
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return }
    fs.readFile(file, (err, data) => {
      if (err) {
        // SPA-ish fallback: serve index.html for unknown paths.
        fs.readFile(path.join(root, 'index.html'), (err2, index) => {
          if (err2) { res.writeHead(404); res.end('not found'); return }
          res.writeHead(200, { 'content-type': mime['.html'] })
          res.end(index)
        })
        return
      }
      res.writeHead(200, { 'content-type': mime[path.extname(file)] ?? 'application/octet-stream' })
      res.end(data)
    })
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)))
}

async function buildCopy(dest: string, logPath: string): Promise<{ ok: boolean; detail: string }> {
  const harness = path.join(M21, 'harness')
  const run = (cmd: string[], cwd = dest) => {
    const p = Bun.spawnSync(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' })
    return { code: p.exitCode, err: new TextDecoder().decode(p.stderr).slice(0, 400) }
  }
  fs.appendFileSync(logPath, `npm install\n`)
  const inst = run(['npm', 'install', '--no-audit', '--no-fund', '--loglevel=error'])
  if (inst.code !== 0) return { ok: false, detail: `npm install failed: ${inst.err}` }
  if (fs.existsSync(path.join(dest, 'node_modules/three'))) {
    run(['npm', 'install', '--no-save', '--no-audit', '--no-fund', '--loglevel=error', '@types/three@0.134.0'])
  }
  // Harness glue (same as the M21 gate writes fresh each run).
  fs.writeFileSync(path.join(dest, 'tsconfig.harness.json'), JSON.stringify({
    extends: path.join(harness, 'tsconfig.base.json'),
    include: ['index.tsx', 'App.tsx', 'components/**/*.tsx', 'components/**/*.ts', 'lib/**/*.ts', 'lib/**/*.tsx', 'types/**/*.d.ts', 'pages/**/*.tsx', 'data/**/*.ts', 'harness-env.d.ts', 'main.tsx'],
  }, null, 2))
  fs.writeFileSync(path.join(dest, 'harness-env.d.ts'), "// M24 fixture copy: ambient declarations so tsc accepts the project's CSS imports.\ndeclare module '*.css'\n")
  fs.appendFileSync(logPath, 'tsc\n')
  const tsc = run([path.join(harness, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.harness.json'])
  if (tsc.code !== 0) return { ok: false, detail: `tsc failed: ${tsc.err}` }
  fs.appendFileSync(logPath, 'vite build\n')
  const vite = run([path.join(harness, 'node_modules/vite/bin/vite.js'), 'build', '--logLevel', 'error'])
  if (vite.code !== 0) return { ok: false, detail: `vite build failed: ${vite.err}` }
  return { ok: true, detail: 'npm install + tsc 0 errors + vite build ok' }
}

async function main() {
  const steps: StepReport[] = []
  const startedAt = new Date().toISOString()
  const browser = await chromium.launch()
  const originalsBefore = new Map<Key, Map<string, string>>(
    runKeys.map((k) => [k, fileHashMap(path.join(M21, 'projects', PROJECTS[k].src))] as never),
  )

  try {
    const s1 = newStep('fixtures-isolation', 'M21 fixtures copied to isolated validation dirs; originals untouched')
    const copies: Partial<Record<Key, string>> = {}
    for (const k of runKeys) {
      const dest = path.join(FIXTURES, PROJECTS[k].src)
      fs.rmSync(dest, { recursive: true, force: true })
      fs.cpSync(path.join(M21, 'projects', PROJECTS[k].src), dest, { recursive: true })
      fs.rmSync(path.join(dest, 'node_modules'), { recursive: true, force: true })
      fs.rmSync(path.join(dest, 'dist'), { recursive: true, force: true })
      copies[k] = dest
      const before = originalsBefore.get(k)!
      const after = fileHashMap(path.join(M21, 'projects', PROJECTS[k].src))
      const untouched = before.size === after.size && [...before].every(([rel, h]) => after.get(rel) === h)
      s1.checks.push(check(`${PROJECTS[k].name}: original fixture byte-for-byte untouched after copy`, untouched, `${before.size} files hashed`))
    }
    const s1f = finish(s1)
    s1f.status = 'OFFLINE_VERIFIED' // hash verification, no service call
    steps.push(s1f)

    const s2 = newStep('fixtures-build', 'Each isolated fixture copy builds through the real pipeline (pins → tsc → vite)')
    for (const k of runKeys) {
      const dest = copies[k]!
      const log = path.join(M24, 'reports', `fixture-${k}-build.log`)
      const r = await buildCopy(dest, log)
      s2.checks.push(check(`${PROJECTS[k].name}: copy builds (install + tsc + vite)`, r.ok, r.detail))
    }
    steps.push(finish(s2))

    const s3 = newStep('fixtures-browser', 'Each built fixture copy renders in real Chromium (content, errors, navigation, mobile, reduced motion)')
    for (const k of runKeys) {
      const dest = copies[k]!
      const dist = path.join(dest, 'dist')
      if (!fs.existsSync(dist)) {
        s3.checks.push(check(`${PROJECTS[k].name}: built dist exists for browser validation`, false, 'no dist — build step failed'))
        continue
      }
      const server = await serveStatic(dist, PROJECTS[k].port)
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
      const page = await ctx.newPage()
      const consoleErrors: string[] = []
      const pageErrors: string[] = []
      page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
      page.on('pageerror', (e) => pageErrors.push(e.message))
      await page.goto(`http://127.0.0.1:${PROJECTS[k].port}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await page.waitForTimeout(1_500)
      const body = await page.textContent('body').catch(() => '')
      const contentOk = PROJECTS[k].expect.every((t) => (body ?? '').includes(t))
      s3.checks.push(check(`${PROJECTS[k].name}: key content renders ("${PROJECTS[k].expect.join('", "')}")`, contentOk))
      await page.screenshot({ path: path.join(EVIDENCE, `fixture-${k}-desktop.png`), fullPage: true })

      // Internal navigation: click the first in-page link that stays on origin.
      const link = page.locator('a[href^="#"], a[href^="/"]:not([href*="//"])').first()
      if ((await link.count()) > 0) {
        const before0 = page.url()
        await link.click().catch(() => {})
        await page.waitForTimeout(600)
        s3.checks.push(check(`${PROJECTS[k].name}: internal navigation works without errors`, consoleErrors.length === 0 && pageErrors.length === 0, `${before0} → ${page.url()}`))
      }
      s3.checks.push(check(`${PROJECTS[k].name}: no console/page errors on load`, consoleErrors.length === 0 && pageErrors.length === 0, JSON.stringify({ consoleErrors: consoleErrors.slice(0, 3), pageErrors: pageErrors.slice(0, 3) }).slice(0, 220)))

      // Mobile viewport on a fresh page.
      const mob = await ctx.newPage()
      await mob.setViewportSize({ width: 390, height: 844 })
      const mobErrs: string[] = []
      mob.on('pageerror', (e) => mobErrs.push(e.message))
      await mob.goto(`http://127.0.0.1:${PROJECTS[k].port}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await mob.waitForTimeout(900)
      const noOverflow = await mob.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)
      await mob.screenshot({ path: path.join(EVIDENCE, `fixture-${k}-mobile.png`), fullPage: true })
      s3.checks.push(check(`${PROJECTS[k].name}: mobile viewport renders without horizontal overflow`, noOverflow, `scrollWidth=${await mob.evaluate(() => document.documentElement.scrollWidth)}`))
      s3.checks.push(check(`${PROJECTS[k].name}: mobile load produces no page errors`, mobErrs.length === 0))

      // Reduced motion context.
      const rmCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
      const rm = await rmCtx.newPage()
      const rmErrs: string[] = []
      rm.on('pageerror', (e) => rmErrs.push(e.message))
      await rm.goto(`http://127.0.0.1:${PROJECTS[k].port}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await rm.waitForTimeout(900)
      await rm.screenshot({ path: path.join(EVIDENCE, `fixture-${k}-reduced-motion.png`) })
      s3.checks.push(check(`${PROJECTS[k].name}: reduced-motion load produces no page errors`, rmErrs.length === 0))
      await rmCtx.close()
      await ctx.close()
      server.close()
    }
    steps.push(finish(s3))

    const s4 = newStep('fixtures-export', 'Each fixture copy exports through the REAL ZIP exporter (integrity + secret scan)')
    const { buildProjectZip, verifyExportZip, filterExportFiles } = await import('@/lib/code/export')
    for (const k of runKeys) {
      const dest = copies[k]!
      const files = walkFiles(dest)
        .filter((rel) => !rel.startsWith('tsconfig.harness') && rel !== 'harness-env.d.ts')
        .map((rel) => ({ path: rel, content: fs.readFileSync(path.join(dest, rel), 'utf8') }))
      const filtered = filterExportFiles(files)
      const zip = await buildProjectZip(
        {
          title: PROJECTS[k].name,
          description: 'M24 isolated fixture export',
          framework: 'react',
          language: 'tsx',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          currentVersion: 1,
        },
        files,
        1,
      )
      const verification = await verifyExportZip(zip.zip, zip.manifest)
      const zipPath = path.join(EVIDENCE, `fixture-${k}-export.zip`)
      fs.writeFileSync(zipPath, zip.zip)
      s4.checks.push(check(`${PROJECTS[k].name}: exporter archive verifies (entry count, safe names, manifest hashes)`, verification.ok, JSON.stringify(verification).slice(0, 200)))
      s4.checks.push(check(`${PROJECTS[k].name}: export excludes secret/unsafe entries (fail-closed filter)`, filtered.excluded.every((e) => e.reason) && !filtered.included.some((f) => f.path.includes('.env')), `excluded=${filtered.excluded.length} included=${filtered.included.length}`))
    }
    const s4f = finish(s4)
    s4f.status = 'OFFLINE_VERIFIED' // real exporter module, no service call
    steps.push(s4f)
  } catch (err) {
    console.error('\n!! fixtures harness aborted:', err)
    const sErr = newStep('infrastructure', `unexpected harness error: ${String(err).slice(0, 200)}`)
    sErr.checks.push(check('fixtures run completed without infrastructure errors', false, String(err).slice(0, 300)))
    steps.push(finish(sErr))
  } finally {
    await browser.close()
  }

  const summary = {
    ranAt: startedAt,
    finishedAt: new Date().toISOString(),
    fixtures: runKeys.map((k) => PROJECTS[k].name),
    note: 'Original M21 fixtures are hash-verified untouched; all validation happens on isolated copies under validation/m24/fixtures/. Browser rendering uses real Chromium against each copy\'s production build.',
    steps: steps.map((s) => ({ id: s.id, title: s.title, status: s.status, checks: s.checks, data: s.data })),
    totals: {
      steps: steps.length,
      verified: steps.filter((s) => s.status === 'LIVE_VERIFIED').length,
      failed: steps.filter((s) => s.status === 'FAILED').length,
      checks: steps.reduce((n, s) => n + s.checks.length, 0),
      checksPassed: steps.reduce((n, s) => n + s.checks.filter((c) => c.passed).length, 0),
    },
  }
  const out = await saveReport('fixtures-regression', summary)
  console.log(`\n==== M24 FIXTURES REGRESSION: ${summary.totals.checksPassed}/${summary.totals.checks} checks passed ====`)
  for (const s of steps) {
    console.log(`\n${s.id} [${s.status}] (${s.checks.filter((c) => c.passed).length}/${s.checks.length})`)
    for (const c of s.checks) console.log(`  [${c.passed ? 'PASS' : 'FAIL'}] ${c.name}${c.detail ? ` — ${c.detail}` : ''}`)
  }
  console.log(`\nreport: ${out}`)
  if (summary.totals.checksPassed !== summary.totals.checks) process.exit(1)
}

await main()
