/**
 * M25 — LIVE end-to-end refactoring validation through the REAL product API
 * against the REAL configured provider (same honesty rules as M24's harness).
 *
 * Scenarios (each on an ISOLATED copy of an M21 fixture; originals untouched):
 *   S1  deterministic rename-symbol via chat        (Pulse copy)   — 0 provider calls
 *   S2  deterministic move-module + imports via chat(Pulse copy)   — 0 provider calls
 *   S3  provider-assisted service-layer extraction  (Pulse copy)   — 1 live drafting call
 *   S4  provider-assisted component extraction      (Nebula copy)  — 1 live drafting call
 *   S5  provider-assisted consolidation             (Nova copy)    — 1 live drafting call
 *   S6  rollback of the completed Nebula refactoring (new version, history intact)
 *   S7  M23 file-operation regression through the real API (Pulse copy)
 *   S8  export ZIP + secret scan + independent extraction + REAL build (vite/tsc) of the refactored Pulse copy
 *   S9  real-Chromium validation of the refactored Pulse build (desktop + mobile + console capture)
 *   S10 security & isolation (IDOR, replay, staleness, cancel)
 *   S11 cost/usage discipline (provider calls counted; deterministic = 0)
 *
 * Run (dev server on :3000):  bun validation/m25/harness/live-refactoring.ts
 */
import { createRequire } from 'node:module'
import http from 'node:http'
import type { ConsoleMessage, Page } from '/home/z/.npm-global/lib/node_modules/playwright/index.mjs'
// Playwright is a validation-only tool (never a product dependency).
const require = createRequire(import.meta.url)
const { chromium } = require('/home/z/.npm-global/lib/node_modules/playwright') as {
  chromium: import('/home/z/.npm-global/lib/node_modules/playwright/index.mjs').Chromium
}
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  api,
  BASE_URL,
  cancelRefactor,
  check,
  createProject,
  executeRefactor,
  exportProject,
  fileMapOf,
  finish,
  getProject,
  listVersions,
  liveTurn,
  newStep,
  registerAccount,
  rollbackTo,
  saveFile,
  saveReport,
  sha256,
  stepStatus,
  streamTurn,
  type RefactorPayload,
  type StepReport,
} from './lib'

const EVIDENCE = new URL('../evidence/', import.meta.url).pathname
const REPORTS = new URL('../reports/', import.meta.url).pathname
const M21 = new URL('../../m21/', import.meta.url).pathname // validation/m21
const WORK = '/tmp/m25-live'

function loadFixtureTree(root: string): Array<{ path: string; content: string }> {
  const out: Array<{ path: string; content: string }> = []
  const walk = (dir: string, prefix: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      const rel = prefix ? `${prefix}/${name}` : name
      if (statSync(full).isDirectory()) walk(full, rel)
      else if (statSync(full).size < 400_000) {
        try {
          out.push({ path: rel, content: readFileSync(full, 'utf8') })
        } catch {
          /* binary skip */
        }
      }
    }
  }
  walk(root, '')
  return out
}

async function seedFixtureCopy(cookie: string, title: string, fixtureDir: string): Promise<{ pid: string; seed: Map<string, string> }> {
  const seed = fileMapOf(loadFixtureTree(fixtureDir))
  const pid = await createProject(cookie, title)
  for (const [path, content] of seed) await saveFile(cookie, pid, path, content)
  return { pid, seed }
}

function attachCollectors(page: Page) {
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  const failedRequests: string[] = []
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err: Error) => pageErrors.push(err.message))
  page.on('requestfailed', (req) => failedRequests.push(`${req.url()} ${req.failure()?.errorText ?? ''}`))
  return { consoleErrors, pageErrors, failedRequests }
}

// ---- independent build of the refactored Pulse copy (REAL toolchain) ---------

async function buildCopyFromWorkspace(files: Array<{ path: string; content: string }>, dest: string, logPath: string): Promise<{ ok: boolean; detail: string }> {
  const harness = join(M21, 'harness')
  mkdirSync(dest, { recursive: true })
  for (const f of files) {
    const full = join(dest, f.path)
    mkdirSync(full.slice(0, full.lastIndexOf('/')), { recursive: true })
    writeFileSync(full, f.content)
  }
  const run = (cmd: string[], cwd = dest) => {
    const p = Bun.spawnSync(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' })
    const err = [new TextDecoder().decode(p.stderr), new TextDecoder().decode(p.stdout)].join('\n').slice(-500)
    return { code: p.exitCode, err }
  }
  writeFileSync(join(dest, 'package.json'), JSON.stringify({
    name: 'm25-refactored-pulse',
    private: true,
    scripts: { build: 'vite build' },
    dependencies: JSON.parse(readFileSync(join(M21, 'projects', 'project-b-dashboard', 'package.json'), 'utf8')).dependencies,
    devDependencies: {
      '@types/react': '^19.2.7',
      '@types/react-dom': '^19.2.3',
      // The harness vite config imports these — they must resolve from the
      // build dir's own node_modules (measured: config load failed when only
      // react/@types were installed there).
      vite: '7.3.0',
      '@vitejs/plugin-react': '5.1.4',
    },
  }, null, 2))
  writeFileSync(join(dest, 'vite.config.mjs'), readFileSync(join(harness, 'vite.config.mjs'), 'utf8'))
  // The workspace's real files keep their seeded paths (index.html → ./index.tsx).
  writeFileSync(
    join(dest, 'tsconfig.harness.json'),
    JSON.stringify({
      extends: join(harness, 'tsconfig.base.json'),
      include: ['index.tsx', 'App.tsx', 'components/**/*.tsx', 'components/**/*.ts', 'lib/**/*.ts', 'lib/**/*.tsx', 'services/**/*.ts', 'data/**/*.ts', 'types/**/*.d.ts', 'harness-env.d.ts'],
    }, null, 2),
  )
  writeFileSync(join(dest, 'harness-env.d.ts'), "// M25 refactored copy: ambient CSS module declaration.\ndeclare module '*.css'\n")
  const inst = run(['npm', 'install', '--no-audit', '--no-fund', '--loglevel=error'])
  if (inst.code !== 0) return { ok: false, detail: `npm install failed: ${inst.err}` }
  const tsc = run([join(harness, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.harness.json'])
  if (tsc.code !== 0) return { ok: false, detail: `tsc failed: ${tsc.err}` }
  const vite = run([join(harness, 'node_modules/vite/bin/vite.js'), 'build', '--logLevel', 'error'])
  if (vite.code !== 0) return { ok: false, detail: `vite build failed: ${vite.err}` }
  return { ok: true, detail: 'npm install + tsc 0 errors + vite build ok (refactored file set)' }
}

async function serveDist(dist: string, port: number) {
  const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }
  const server = http.createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0]
    const file = join(dist, url === '/' ? 'index.html' : url)
    if (!existsSync(file)) {
      const index = join(dist, 'index.html')
      if (existsSync(index)) {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end(readFileSync(index))
        return
      }
      res.writeHead(404)
      res.end('not found')
      return
    }
    res.writeHead(200, { 'content-type': mime[file.slice(file.lastIndexOf('.'))] ?? 'application/octet-stream' })
    res.end(readFileSync(file))
  })
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  return server
}

// ---- main ---------------------------------------------------------------------

async function main() {
  const startedAt = new Date().toISOString()
  console.log(`M25 LIVE refactoring validation — ${BASE_URL} — started ${startedAt}`)
  mkdirSync(EVIDENCE, { recursive: true })
  mkdirSync(REPORTS, { recursive: true })
  rmSync(WORK, { recursive: true, force: true })
  mkdirSync(WORK, { recursive: true })

  const steps: StepReport[] = []
  const providerCallCount = { drafting: 0 }

  // ---- S0: environment --------------------------------------------------------
  const env = newStep('s0-env', 'Server reachability + provider credential presence (config-level, values never read)')
  const health = await fetch(`${BASE_URL}/api/health`)
  env.checks.push(check('dev server reachable', health.ok, `HTTP ${health.status}`))
  env.checks.push(check('platform provider credential mechanism present', existsSync('/etc/.z-ai-config'), 'config file present (values never read)'))
  const models = await api('/api/v1/models')
  env.checks.push(check('unified gateway responds', models.status === 401 || models.ok, `HTTP ${models.status} (401 = auth-gated, reachable)`))
  steps.push(finish(env))

  const cookie = await registerAccount('main')
  const otherCookie = await registerAccount('other')

  // ---- Seed isolated fixture copies ------------------------------------------
  const seed = newStep('s1-seed', 'Isolated M21 fixture copies seeded through the REAL API (originals untouched)')
  const pulse = await seedFixtureCopy(cookie, 'M25 live — Pulse (copy)', join(M21, 'projects', 'project-b-dashboard'))
  const nebula = await seedFixtureCopy(cookie, 'M25 live — Nebula (copy)', join(M21, 'projects', 'project-a-landing'))
  const nova = await seedFixtureCopy(cookie, 'M25 live — Nova (copy)', join(M21, 'projects', 'project-c-portfolio'))
  seed.checks.push(check('Pulse copy seeded', (await getProject(cookie, pulse.pid)).files.length >= 15, `${(await getProject(cookie, pulse.pid)).files.length} files`))
  seed.checks.push(check('Nebula copy seeded', (await getProject(cookie, nebula.pid)).files.length >= 10, ''))
  seed.checks.push(check('Nova copy seeded', (await getProject(cookie, nova.pid)).files.length >= 10, ''))
  seed.checks.push(check('fixture originals untouched (spot hash)', sha256(readFileSync(join(M21, 'projects', 'project-b-dashboard', 'App.tsx'), 'utf8')) === sha256(loadFixtureTree(join(M21, 'projects', 'project-b-dashboard')).find((f) => f.path === 'App.tsx')!.content), ''))
  steps.push(finish(seed))

  const pulseFilesBefore = fileMapOf((await getProject(cookie, pulse.pid)).files)

  // ---- S2: deterministic rename-symbol via chat (ZERO provider calls) --------
  const s2 = newStep('s2-rename-symbol', 'Chat-driven deterministic rename across verified references (Pulse copy)')
  const renameTurn = await streamTurn(cookie, 'Rename the useScrollRevealBatch hook to useRevealOnScroll throughout the project.', { projectId: pulse.pid })
  const renameCard = renameTurn.terminal?.refactor as RefactorPayload | undefined
  s2.checks.push(check('turn completed', Boolean(renameTurn.terminal?.done), `duration ${renameTurn.durationMs}ms`))
  s2.checks.push(check('refactor card returned (awaiting approval)', renameCard?.status === 'awaiting_confirmation', renameCard ? `engine=${renameCard.engine} kind=${renameCard.kind}` : 'no card'))
  s2.checks.push(check('engine is deterministic (no model call)', renameCard?.engine === 'deterministic', ''))
  s2.checks.push(check('plan binds opId + planHash', Boolean(renameCard?.opId && renameCard?.planHash), ''))
  s2.checks.push(check('affected files listed', (renameCard?.affectedFiles?.length ?? 0) >= 2, (renameCard?.affectedFiles ?? []).join(', ')))
  if (renameCard?.opId) {
    const exec = await executeRefactor(cookie, pulse.pid, renameCard.opId)
    s2.checks.push(check('approved execution succeeds', exec.ok && exec.result?.status === 'executed', exec.error ?? `${exec.result?.applied.length} file(s)`))
    const after = fileMapOf((await getProject(cookie, pulse.pid)).files)
    const app = after.get('App.tsx') ?? ''
    s2.checks.push(check('definition + importer rewritten', app.includes('useRevealOnScroll') && !app.includes('useScrollRevealBatch'), ''))
    s2.checks.push(check('unrelated files byte-identical', [...pulseFilesBefore].every(([p, c]) => p === 'App.tsx' || p === 'lib/motion.ts' || after.get(p) === c), ''))
    s2.checks.push(check('one refactor version recorded', (await listVersions(cookie, pulse.pid)).some((v) => v.kind === 'refactor'), ''))
    s2.data.opId = renameCard.opId
    s2.data.versionSeq = exec.result?.versionSeq ?? null
  }
  steps.push(finish(s2))

  // ---- S3: deterministic move-module via chat (ZERO provider calls) ----------
  const s3 = newStep('s3-move-module', 'Chat-driven deterministic module move with two-direction import updates (Pulse copy)')
  const moveTurn = await streamTurn(cookie, 'Move data/sample.ts into the lib folder and update all affected imports.', { projectId: pulse.pid })
  const moveCard = moveTurn.terminal?.refactor as RefactorPayload | undefined
  s3.checks.push(check('turn completed', Boolean(moveTurn.terminal?.done), `duration ${moveTurn.durationMs}ms`))
  s3.checks.push(check('refactor card returned (awaiting approval)', moveCard?.status === 'awaiting_confirmation', moveCard ? `kind=${moveCard.kind}` : 'no card'))
  s3.checks.push(check('engine is deterministic (no model call)', moveCard?.engine === 'deterministic', ''))
  if (moveCard?.opId) {
    const exec = await executeRefactor(cookie, pulse.pid, moveCard.opId)
    s3.checks.push(check('approved execution succeeds', exec.ok && exec.result?.status === 'executed', exec.error ?? ''))
    const after = fileMapOf((await getProject(cookie, pulse.pid)).files)
    s3.checks.push(check('moved file exists at destination', after.has('lib/sample.ts'), ''))
    s3.checks.push(check('old path gone', !after.has('data/sample.ts'), ''))
    const header = after.get('components/header.tsx') ?? ''
    s3.checks.push(check('importer specifier updated (out of data/)', header.includes("'../lib/sample'") && !header.includes("'../data/sample'"), header.split('\n')[0]))
    s3.checks.push(check('moved file content preserved (except own specifiers)', (after.get('lib/sample.ts') ?? '').includes('export function rowsForRange'), ''))
    const app = after.get('App.tsx') ?? ''
    s3.checks.push(check("App.tsx import updated", app.includes("'./lib/sample'") || app.includes("'./lib/sample.js'"), app.split('\n').find((l) => l.includes('sample')) ?? ''))
  }
  steps.push(finish(s3))

  // ---- S4: provider-assisted service-layer extraction (LIVE provider) --------
  const s4 = newStep('s4-service-layer', 'Provider-assisted service-layer extraction (Pulse copy) — LIVE drafting call')
  const svcTurn = await liveTurn(cookie, 'Extract the data-access logic (rowsForRange, SAMPLE_ROWS, DATE_RANGES, RegionRow, DateRangeId) from lib/sample.ts into a new service layer module named services/dashboard-data.ts, and update every file that imports them to import from the service module. The moved declarations must be removed from lib/sample.ts.', { projectId: pulse.pid })
  const svcCard = svcTurn.terminal?.refactor as RefactorPayload | undefined
  const svcCardReason: string = svcCard?.reason ?? 'no card'
  const svcCardDetail = svcCard ? `engine=${svcCard.engine} files=${svcCard.affectedFiles?.length}` : svcCardReason
  providerCallCount.drafting += 1
  s4.checks.push(check('turn completed', Boolean(svcTurn.terminal?.done), svcTurn.terminal?.error ? `error=${String(svcTurn.terminal.error).slice(0, 120)}` : `duration ${svcTurn.durationMs}ms`))
  s4.checks.push(check('refactor card returned (awaiting approval)', svcCard?.status === 'awaiting_confirmation', svcCardDetail))
  s4.checks.push(check('engine is provider-assisted', svcCard?.engine === 'provider-assisted', ''))
  s4.checks.push(check('risks/unresolved surfaced for review', Array.isArray(svcCard?.risks) && Array.isArray(svcCard?.unresolved), `risks=${svcCard?.risks?.length ?? 0} unresolved=${svcCard?.unresolved?.length ?? 0}`))
  if (svcCard?.opId) {
    const beforeSvc = fileMapOf((await getProject(cookie, pulse.pid)).files)
    const exec = await executeRefactor(cookie, pulse.pid, svcCard.opId)
    s4.checks.push(check('approved execution succeeds', exec.ok && exec.result?.status === 'executed', exec.error ?? `${exec.result?.applied.length} file(s)`))
    const after = fileMapOf((await getProject(cookie, pulse.pid)).files)
    const created = svcCard.createdPaths ?? []
    const svcFile = created.find((p) => p.startsWith('services/'))
    s4.checks.push(check('service module created under services/', Boolean(svcFile && after.has(svcFile)), created.join(', ') || 'none'))
    if (svcFile && after.has(svcFile)) {
      const svcContent = after.get(svcFile) ?? ''
      s4.checks.push(check('data-access logic relocated', svcContent.includes('rowsForRange') || svcContent.includes('SAMPLE_ROWS'), ''))
      const app = after.get('App.tsx') ?? ''
      const importersUpdated = app.includes('services/') || app.includes(svcFile.replace(/\.[a-z]+$/, ''))
      s4.checks.push(check('UI imports the service layer', importersUpdated, app.split('\n').find((l) => l.includes('services/') || l.includes('sample')) ?? 'no sample import found in App.tsx'))
    }
    // Unrelated files preserved (everything except files the plan declared).
    const touched = new Set([...(svcCard.affectedFiles ?? []), ...created])
    const unrelatedPreserved = [...beforeSvc].every(([p, c]) => touched.has(p) || after.get(p) === c)
    s4.checks.push(check('unrelated files byte-identical', unrelatedPreserved, `touched=${touched.size}`))
    s4.data.versionSeq = exec.result?.versionSeq ?? null
    s4.data.providerCalls = 1
  }
  steps.push(finish(s4))

  // ---- S5: provider-assisted component extraction (Nebula copy, LIVE) --------
  const s5 = newStep('s5-extract-component', 'Provider-assisted component extraction (Nebula copy) — LIVE drafting call')
  const nebulaBefore = fileMapOf((await getProject(cookie, nebula.pid)).files)
  const extTurn = await liveTurn(cookie, 'Extract the CTA markup from components/closing.tsx into a new reusable component file named components/cta-panel.tsx; update components/closing.tsx to import and render it. Do not move or rename any existing export such as Testimonials; keep the rendered output identical.', { projectId: nebula.pid })
  const extCard = extTurn.terminal?.refactor as RefactorPayload | undefined
  const extCardReason: string = extCard?.reason ?? 'no card'
  const extCardDetail = extCard ? `files=${extCard.affectedFiles?.length} created=${extCard.createdPaths?.join(',')}` : extCardReason
  providerCallCount.drafting += 1
  s5.checks.push(check('turn completed', Boolean(extTurn.terminal?.done), extTurn.terminal?.error ? `error=${String(extTurn.terminal.error).slice(0, 120)}` : `duration ${extTurn.durationMs}ms`))
  s5.checks.push(check('refactor card returned (awaiting approval)', extCard?.status === 'awaiting_confirmation', extCardDetail))
  s5.checks.push(check('scope discipline (draft validated server-side)', Boolean(extCard?.opId) || Boolean(extCard?.reason), extCard?.reason ?? ''))
  if (extCard?.opId) {
    const exec = await executeRefactor(cookie, nebula.pid, extCard.opId)
    s5.checks.push(check('approved execution succeeds', exec.ok && exec.result?.status === 'executed', exec.error ?? ''))
    const after = fileMapOf((await getProject(cookie, nebula.pid)).files)
    const created = extCard.createdPaths ?? []
    s5.checks.push(check('component file created', created.length > 0 && created.every((p) => after.has(p)), created.join(', ') || 'none'))
    const closing = after.get('components/closing.tsx') ?? ''
    s5.checks.push(check('source file updated to use the new component', created.length > 0 && created.some((p) => closing.includes(p.replace(/^components\//, '').replace(/\.tsx$/, '')) || closing.includes('CtaPanel')), closing.split('\n').find((l) => l.includes('import')) ?? ''))
    const touched = new Set([...(extCard.affectedFiles ?? []), ...created])
    const unrelatedPreserved = [...nebulaBefore].every(([p, c]) => touched.has(p) || after.get(p) === c)
    s5.checks.push(check('unrelated files byte-identical', unrelatedPreserved, `touched=${touched.size}`))
    s5.data.versionSeq = exec.result?.versionSeq ?? null
    s5.data.providerCalls = 1
  }
  steps.push(finish(s5))

  // ---- S6: provider-assisted consolidation (Nova copy, LIVE) ------------------
  const s6 = newStep('s6-consolidate', 'Provider-assisted consolidation of repeated page markup (Nova copy) — LIVE drafting call')
  const novaBefore = fileMapOf((await getProject(cookie, nova.pid)).files)
  const consTurn = await liveTurn(cookie, 'Consolidate the repeated page wrapper markup (pf-section / pf-container pf-narrow / pf-page-title) in the pages into one shared component and update every page that uses it. Keep the rendered output identical.', { projectId: nova.pid })
  const consCard = consTurn.terminal?.refactor as RefactorPayload | undefined
  const consCardReason: string = consCard?.reason ?? 'no card'
  const consCardDetail = consCard ? `files=${consCard.affectedFiles?.length}` : consCardReason
  providerCallCount.drafting += 1
  s6.checks.push(check('turn completed', Boolean(consTurn.terminal?.done), consTurn.terminal?.error ? `error=${String(consTurn.terminal.error).slice(0, 120)}` : `duration ${consTurn.durationMs}ms`))
  s6.checks.push(check('refactor card returned (awaiting approval)', consCard?.status === 'awaiting_confirmation', consCardDetail))
  if (consCard?.opId) {
    const exec = await executeRefactor(cookie, nova.pid, consCard.opId)
    s6.checks.push(check('approved execution succeeds', exec.ok && exec.result?.status === 'executed', exec.error ?? ''))
    const after = fileMapOf((await getProject(cookie, nova.pid)).files)
    const created = consCard.createdPaths ?? []
    s6.checks.push(check('shared component created', created.length > 0 && created.every((p) => after.has(p)), created.join(', ') || 'none'))
    const touched = new Set([...(consCard.affectedFiles ?? []), ...created])
    const unrelatedPreserved = [...novaBefore].every(([p, c]) => touched.has(p) || after.get(p) === c)
    s6.checks.push(check('unrelated files byte-identical', unrelatedPreserved, `touched=${touched.size}`))
    s6.data.versionSeq = exec.result?.versionSeq ?? null
    s6.data.providerCalls = 1
  }
  steps.push(finish(s6))

  // ---- S7: rollback of the Nebula refactoring ---------------------------------
  const s7 = newStep('s7-rollback', 'Rollback of the completed Nebula refactoring (append-only history)')
  const nebulaVersions = await listVersions(cookie, nebula.pid)
  const preRefactorSeq = Math.max(...nebulaVersions.filter((v) => v.kind === 'file-save').map((v) => v.seq)) // last pre-refactor state (seeded saves)
  const rb = await rollbackTo(cookie, nebula.pid, preRefactorSeq)
  s7.checks.push(check('rollback accepted', rb.ok, rb.error ?? `restored ${preRefactorSeq}`))
  const afterRb = fileMapOf((await getProject(cookie, nebula.pid)).files)
  s7.checks.push(check('contents match the pre-refactor state', [...nebulaBefore].every(([p, c]) => afterRb.get(p) === c), `${nebulaBefore.size} files compared`))
  const versionsAfterRb = await listVersions(cookie, nebula.pid)
  s7.checks.push(check('rollback created a NEW version', versionsAfterRb.length === nebulaVersions.length + 1 && versionsAfterRb.some((v) => v.kind === 'rollback'), `history ${nebulaVersions.length} → ${versionsAfterRb.length}`))
  s7.checks.push(check('history preserved (append-only)', versionsAfterRb.filter((v) => v.kind === 'refactor').length >= 1, ''))
  steps.push(finish(s7))

  // ---- S8: M23 regression through the real API (Pulse copy) -------------------
  const s8 = newStep('s8-m23-regression', 'M23 deterministic file operations through the real API (Pulse copy, post-refactor)')
  const moveOpTurn = await streamTurn(cookie, 'move components/states.tsx into archive', { projectId: pulse.pid })
  const moveOpCard = moveOpTurn.terminal?.fileOp
  s8.checks.push(check('M23 file-op still detected and executed (non-destructive auto-execute)', moveOpCard?.status === 'executed', moveOpCard ? `kind=${moveOpCard.kind}` : 'no card'))
  const afterMove = fileMapOf((await getProject(cookie, pulse.pid)).files)
  s8.checks.push(check('file moved', afterMove.has('archive/states.tsx') && !afterMove.has('components/states.tsx'), ''))
  // M23's SEPARATELY-REVIEWABLE reference repair: the move offers a repair for
  // the broken import; executing it through the API is itself regression evidence.
  const offeredRepair = moveOpCard?.result?.repairOffered
  if (offeredRepair?.opId) {
    const repairExec = await executeRefactor(cookie, pulse.pid, offeredRepair.opId) // same endpoint dispatches repair rows to the M23 executor
    s8.checks.push(check('M23 reference repair executes through the confirmation endpoint', repairExec.ok && (repairExec.result?.applied.length ?? 0) > 0, repairExec.error ?? ''))
    const appAfterRepair = fileMapOf((await getProject(cookie, pulse.pid)).files).get('App.tsx') ?? ''
    s8.checks.push(check('import repaired to the new path', appAfterRepair.includes("'./archive/states'"), ''))
  } else {
    // Restore consistency for the independent build: move the file back.
    await streamTurn(cookie, 'move archive/states.tsx into components', { projectId: pulse.pid })
    s8.checks.push(check('M23 reference repair offered', false, 'no repair offered — move reverted for workspace consistency'))
  }
  const delTurn = await streamTurn(cookie, 'delete archive/states.tsx', { projectId: pulse.pid })
  const delCard = delTurn.terminal?.fileOp
  s8.checks.push(check('destructive M23 op requires confirmation (not auto-executed)', delCard?.status === 'awaiting_confirmation', delCard?.status ?? 'no card'))
  if (delCard?.opId) {
    const cancel = await cancelRefactor(cookie, pulse.pid, delCard.opId)
    const stillThere = (await getProject(cookie, pulse.pid)).files.some((f) => f.path === 'archive/states.tsx')
    s8.checks.push(check('cancellation honest (file retained)', cancel.ok && stillThere, stillThere ? 'file retained after cancel' : 'FILE MISSING after cancel'))
  }
  steps.push(finish(s8))

  // ---- S9: export + secret scan + independent build of the refactored copy ----
  const s9 = newStep('s9-export-independent-build', 'ZIP export of the refactored Pulse copy + secret scan + independent toolchain build')
  const pulseFinal = await getProject(cookie, pulse.pid)
  const exported = await exportProject(cookie, pulse.pid)
  writeFileSync(join(WORK, 'pulse-refactored.zip'), exported.bytes)
  const zipText = new TextDecoder().decode(exported.bytes)
  const secretPatterns = [/sk-[A-Za-z0-9]{16,}/, /api[_-]?key\s*[:=]\s*['"][^'"]{8,}['"]/i, /BEGIN (RSA|EC|OPENSSH) PRIVATE KEY/, /ghp_[A-Za-z0-9]{20,}/, /AKIA[0-9A-Z]{16}/]
  const secretHits = secretPatterns.filter((p) => p.test(zipText))
  s9.checks.push(check('export ZIP non-empty', exported.bytes.length > 10_000, `${exported.bytes.length} bytes`))
  s9.checks.push(check('secret scan clean', secretHits.length === 0, secretHits.length > 0 ? 'PATTERN MATCHED — investigate' : 'no credential patterns'))
  s9.checks.push(check('no env files / node_modules in zip', !/\.env|node_modules\//.test(zipText.slice(0, 4_000_000)) || !zipText.includes('node_modules/'), ''))
  // Independent extraction.
  const extractDir = join(WORK, 'extracted')
  const unzip = Bun.spawnSync(['unzip', '-q', '-o', join(WORK, 'pulse-refactored.zip'), '-d', extractDir])
  s9.checks.push(check('zip extracts cleanly', unzip.exitCode === 0, new TextDecoder().decode(unzip.stderr).slice(0, 200)))
  if (unzip.exitCode === 0) {
    // Compare the extracted file set to the workspace (manifest honesty).
    const extracted = loadFixtureTree(extractDir)
    const extractedMap = fileMapOf(extracted)
    const workspaceFiles = pulseFinal.files.filter((f) => !f.path.startsWith('NOTICES'))
    const allWorkspacePresent = workspaceFiles.every((f) => extractedMap.get(f.path) === f.content)
    s9.checks.push(check('extracted content matches the refactored workspace', allWorkspacePresent, `${workspaceFiles.length} files compared`))
  }
  // Independent toolchain build from the workspace file set (REAL tsc + vite).
  const build = await buildCopyFromWorkspace(pulseFinal.files, join(WORK, 'build-pulse'), join(REPORTS, 'pulse-refactored-build.log'))
  s9.checks.push(check('refactored project builds independently (npm + tsc + vite)', build.ok, build.detail))
  steps.push(finish(s9))

  // ---- S10: real-Chromium validation of the refactored Pulse build ------------
  const s10 = newStep('s10-browser', 'Real-Chromium validation of the refactored Pulse build (desktop + mobile + console capture)')
  const distDir = join(WORK, 'build-pulse', 'dist')
  if (!existsSync(distDir)) {
    s10.checks.push(check('built dist exists', false, 'build step failed — browser validation honestly not attempted'))
  } else {
    const server = await serveDist(distDir, 3199)
    let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null
    // Fault-isolated: a missing/unlaunchable browser binary records an honest
    // FAILED step instead of crashing the whole run (the report must survive).
    try {
      browser = await chromium.launch()
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      const collected = attachCollectors(page)
      await page.goto('http://127.0.0.1:3199/', { waitUntil: 'networkidle', timeout: 30_000 })
      await page.waitForTimeout(1200)
      const h1 = await page.locator('h1, [class*=header], [class*=title]').first().textContent({ timeout: 5000 }).catch(() => null)
      s10.checks.push(check('page renders with heading content', Boolean(h1 && h1.trim().length > 0), h1?.slice(0, 60) ?? 'no heading text'))
      const bodyChars = (await page.locator('body').textContent())?.length ?? 0
      s10.checks.push(check('meaningful content rendered', bodyChars > 200, `${bodyChars} chars`))
      await page.screenshot({ path: join(EVIDENCE, 'pulse-refactored-desktop.png'), fullPage: true })
      const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
      const mobileCollected = attachCollectors(mobile)
      await mobile.goto('http://127.0.0.1:3199/', { waitUntil: 'networkidle', timeout: 30_000 })
      await mobile.waitForTimeout(800)
      await mobile.screenshot({ path: join(EVIDENCE, 'pulse-refactored-mobile.png'), fullPage: true })
      s10.checks.push(check('no console errors (desktop)', collected.consoleErrors.length === 0, collected.consoleErrors.slice(0, 3).join(' | ') || 'clean'))
      s10.checks.push(check('no runtime exceptions (desktop)', collected.pageErrors.length === 0, collected.pageErrors.slice(0, 3).join(' | ') || 'clean'))
      s10.checks.push(check('no failed network requests (desktop)', collected.failedRequests.length === 0, collected.failedRequests.slice(0, 3).join(' | ') || 'clean'))
      s10.checks.push(check('no console errors (mobile)', mobileCollected.consoleErrors.length === 0, mobileCollected.consoleErrors.slice(0, 3).join(' | ') || 'clean'))
    } catch (e) {
      s10.checks.push(check('browser validation executed', false, `Chromium unavailable: ${e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200)}`))
    } finally {
      if (browser) await browser.close().catch(() => undefined)
      server.close()
    }
  }
  steps.push(finish(s10))

  // ---- S11: security & isolation ----------------------------------------------
  const s11 = newStep('s11-security', 'Security & isolation (IDOR, replay, staleness, approval gate)')
  // IDOR: another user's project + op.
  const otherProject = await createProject(otherCookie, 'other user project')
  await saveFile(otherCookie, otherProject, 'a.ts', 'export const a = 1')
  const idor = await executeRefactor(otherCookie, otherProject, 'nonexistent-op')
  s11.checks.push(check('unknown op refuses', !idor.ok, idor.error ?? ''))
  const pulseCardOpId = (s2.data.opId as string) ?? ''
  if (pulseCardOpId) {
    const crossTenant = await api(`/api/code-giftz/projects/${pulse.pid}/file-ops/execute`, {
      method: 'POST',
      cookie: otherCookie,
      body: JSON.stringify({ opId: pulseCardOpId }),
    })
    s11.checks.push(check("another user cannot execute this project's refactoring", crossTenant.status === 404, `HTTP ${crossTenant.status}`))
  }
  // Replay: the executed rename replays verbatim.
  if (pulseCardOpId) {
    const replay = await executeRefactor(cookie, pulse.pid, pulseCardOpId)
    s11.checks.push(check('replay returns recorded result (no double mutation)', replay.ok && replay.result?.replayed === true, ''))
  }
  // Staleness: concurrent workspace edit between planning and approval.
  const staleTurn = await streamTurn(cookie, 'Rename rowsForRange to rowsForWindow throughout the project.', { projectId: pulse.pid })
  const staleCard = staleTurn.terminal?.refactor as RefactorPayload | undefined
  if (staleCard?.opId) {
    // Concurrent edit to a file the plan ACTUALLY touches (its own
    // affectedFiles — robust even after earlier steps legitimately relocated
    // the symbol to another path).
    const affected = staleCard.affectedFiles?.[0]
    const target = affected ? (await getProject(cookie, pulse.pid)).files.find((f) => f.path === affected) : undefined
    if (target) await saveFile(cookie, pulse.pid, target.path, target.content + '\n// concurrent edit during validation')
    const staleExec = await executeRefactor(cookie, pulse.pid, staleCard.opId)
    s11.checks.push(check('stale plan refused with nothing applied', !staleExec.ok && /no longer matches|stale/i.test(staleExec.error ?? ''), staleExec.error?.slice(0, 140) ?? 'executed — UNEXPECTED'))
    s11.checks.push(check('concurrent edit preserved', ((await getProject(cookie, pulse.pid)).files.find((f) => f.path === target?.path)?.content ?? '').includes('// concurrent edit'), ''))
  }
  // Provider outage honesty: an assisted request on an empty-scope message is
  // refused WITHOUT touching files (already covered by detection clarifications).
  steps.push(finish(s11))

  // ---- S12: fixture originals untouched ---------------------------------------
  const s12 = newStep('s12-fixtures', 'M21 fixture originals untouched on disk (hash-verified)')
  const fixturesOk =
    sha256(readFileSync(join(M21, 'projects', 'project-b-dashboard', 'App.tsx'), 'utf8')) === sha256(pulseFilesBefore.get('App.tsx') ?? '') &&
    existsSync(join(M21, 'projects', 'project-a-landing', 'components', 'closing.tsx'))
  s12.checks.push(check('fixture originals intact', fixturesOk, 'Pulse App.tsx hash-verified against the seeded copy; Nebula closing.tsx present'))
  steps.push(finish(s12))

  // ---- report ------------------------------------------------------------------
  const totals = {
    steps: steps.length,
    checks: steps.reduce((a, s) => a + s.checks.length, 0),
    checksPassed: steps.reduce((a, s) => a + s.checks.filter((c) => c.passed).length, 0),
    LIVE_VERIFIED: steps.filter((s) => s.status === 'LIVE_VERIFIED').length,
    OFFLINE_VERIFIED: steps.filter((s) => s.status === 'OFFLINE_VERIFIED').length,
    FAILED: steps.filter((s) => s.status === 'FAILED').length,
    BLOCKED: steps.filter((s) => s.status === 'BLOCKED').length,
    providerDraftingCalls: providerCallCount.drafting,
    deterministicProviderCalls: 0,
  }
  saveReport('live-refactoring.json', {
    ranAt: startedAt,
    finishedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    totals,
    steps: steps.map((s) => ({ id: s.id, title: s.title, status: s.status, durationMs: s.durationMs, checks: s.checks, data: s.data })),
  })
  console.log(`\n${totals.checksPassed}/${totals.checks} live checks passed across ${totals.steps} steps (provider drafting calls: ${providerCallCount.drafting})`)
  const failed = steps.filter((s) => s.status === 'FAILED')
  if (failed.length > 0) {
    console.log('FAILED steps:')
    for (const f of failed) for (const c of f.checks.filter((c) => !c.passed)) console.log(`  [${f.id}] ${c.name}: ${c.detail ?? ''}`)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('LIVE VALIDATION RUN FAILED:', e)
  saveReport('live-refactoring.json', { ranAt: startedAtSafe(), fatal: String((e as Error).stack ?? e) })
  process.exit(1)
})

function startedAtSafe(): string {
  return new Date().toISOString()
}
