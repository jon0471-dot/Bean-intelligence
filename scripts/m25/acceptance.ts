/**
 * M25 FINAL ACCEPTANCE harness (deterministic tier) — real execution evidence
 * for intelligent multi-file refactoring, run against a REAL isolated SQLite
 * database (never the runtime DB) and the REAL committed modules:
 * detection → graph → planning → hash-bound confirmation → transactional
 * atomic execution → version snapshot → post-verification → rollback → export.
 *
 * Method (the established M21/M22/M23 honest-substitution policy): the
 * DETERMINISTIC refactoring operations (rename-symbol, move-module) are pure
 * server-side code and need NO provider; they are exercised here end-to-end.
 * The PROVIDER-ASSISTED operations (extraction / consolidation / service
 * layer) are validated LIVE through the real product API in
 * validation/m25/harness/live-refactoring.ts and are deliberately NOT mocked
 * here — a mocked provider call would prove nothing.
 *
 * The M21 fixtures (Nebula = project-a-landing, Pulse = project-b-dashboard,
 * Nova Reyes = project-c-portfolio) are loaded READ-ONLY from
 * validation/m21/projects/ as regression inputs; the files on disk are
 * hash-verified untouched after the run and the seeded verification projects
 * are deleted again (fixtures are never registered in production storage).
 *
 * Run:
 *   mkdir -p scripts/m25-out
 *   DATABASE_URL=file:$PWD/scripts/m25-out/verify.db npx prisma db push --skip-generate
 *   DATABASE_URL=file:$PWD/scripts/m25-out/verify.db bun run scripts/m25/acceptance.ts
 */
import { PrismaClient } from '@prisma/client'
import { createHash } from 'crypto'
import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { buildProjectGraph, verifiedImportersOf } from '../../src/lib/code/refactoring/graph'
import { planRenameSymbol, planMoveModule, validateRefactorPlan } from '../../src/lib/code/refactoring/plan'
import { createRefactorOperation, executeRefactorOperation } from '../../src/lib/code/refactoring/execute'
import { runStaticValidation } from '../../src/lib/code/refactoring/validate'
import { detectFileOperation } from '../../src/lib/code/file-ops/detect'
import { performDetectedFileOperation, executeOperation } from '../../src/lib/code/file-ops/execute'
import {
  snapshotProjectVersion,
  rollbackToVersion,
  listVersions,
  validateVersionIntegrity,
} from '../../src/lib/code/versioning'
import { buildProjectZip, verifyExportZip } from '../../src/lib/code/export'
import { scanReferences } from '../../src/lib/code/file-ops/references'

const db = new PrismaClient()
const results: Array<{ step: string; status: 'OFFLINE_VERIFIED' | 'FAILED'; pass: boolean; detail: Record<string, unknown> }> = []
function record(step: string, pass: boolean, detail: Record<string, unknown>) {
  results.push({ step, status: pass ? 'OFFLINE_VERIFIED' : 'FAILED', pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${step}`)
  console.log('     ' + JSON.stringify(detail).slice(0, 500))
}

function sha(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

/** Recursively read a fixture directory into { path, content } rows (utf-8 text files only). */
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
          /* binary — skip (fixtures are text projects) */
        }
      }
    }
  }
  walk(root, '')
  return out
}

async function projectFiles(projectId: string) {
  const rows = await db.codeFile.findMany({ where: { projectId }, orderBy: { path: 'asc' } })
  return rows.map((r) => ({ path: r.path, content: r.content }))
}

const FIXTURE_ROOT = 'validation/m21/projects'
const FIXTURES = ['project-a-landing', 'project-b-dashboard', 'project-c-portfolio']
const FIXTURE_LABELS: Record<string, string> = {
  'project-a-landing': 'Nebula landing page',
  'project-b-dashboard': 'Pulse analytics dashboard',
  'project-c-portfolio': 'Nova Reyes portfolio',
}

async function main() {
  const startedAt = new Date().toISOString()
  console.log(`M25 deterministic acceptance — started ${startedAt}`)

  record('acceptance database reachable', (await db.codeProject.count()) >= 0, { projects: await db.codeProject.count() })

  // ---- fixture pre-hashes (on-disk integrity proof) --------------------------
  const fixtureHashBefore = new Map<string, string>()
  for (const fixture of FIXTURES) {
    for (const f of loadFixtureTree(join(FIXTURE_ROOT, fixture))) {
      fixtureHashBefore.set(`${fixture}/${f.path}`, sha(f.content))
    }
  }
  record('M21 fixtures loaded read-only (pre-run hashes recorded)', fixtureHashBefore.size > 0, { files: fixtureHashBefore.size })

  const userId = 'm25-acceptance-user'
  await db.user.upsert({
    where: { email: 'm25-acceptance@verification.invalid' },
    update: {},
    create: { id: userId, email: 'm25-acceptance@verification.invalid', passwordHash: 'verification-only-not-a-credential' },
  })

  // ---- per-fixture deterministic scenarios -----------------------------------
  for (const fixture of FIXTURES) {
    const label = FIXTURE_LABELS[fixture]
    const seed = loadFixtureTree(join(FIXTURE_ROOT, fixture))
    const seedByPath = new Map(seed.map((f) => [f.path, f.content]))
    const project = await db.codeProject.create({ data: { userId, title: `M25 verify — ${label}`, framework: 'react', language: 'typescript' } })
    const pid = project.id
    for (const f of seed) {
      await db.codeFile.create({ data: { projectId: pid, path: f.path, content: f.content, origin: 'generated' } })
    }
    await snapshotProjectVersion({ projectId: pid, kind: 'initial', summary: `M25 acceptance seed — ${label}` })

    const files = await projectFiles(pid)

    // -- 1. Graph honesty on a REAL fixture ------------------------------------
    const graph = buildProjectGraph(files)
    const verifiedEdges = [...graph.nodes.values()].flatMap((n) => n.imports).filter((i) => i.verified)
    record(
      `graph honesty: ${label}`,
      verifiedEdges.length > 0 && graph.notes.length >= 2,
      { files: files.length, verifiedEdges: verifiedEdges.length, unresolved: graph.unresolved.length, notes: graph.notes.length },
    )

    // -- 2. Deterministic rename-symbol across verified references -------------
    // Only UNIQUELY-declared symbols qualify: the fixture may legitimately
    // declare the same type name in two files (Pulse declares RegionRow in
    // both App.tsx and data/sample.ts) — the ambiguity guard refuses those,
    // which is exactly the safety behavior under test.
    const renameCandidates: Array<{ path: string; symbol: string; importers: number }> = []
    const declarationCount = new Map<string, number>()
    for (const node of graph.nodes.values()) {
      for (const sym of node.symbols) declarationCount.set(sym.name, (declarationCount.get(sym.name) ?? 0) + 1)
    }
    for (const node of graph.nodes.values()) {
      if (!/\.tsx?$/.test(node.path) || node.path.includes('/kit/')) continue
      for (const sym of node.symbols) {
        if (!sym.exported) continue
        if ((declarationCount.get(sym.name) ?? 0) !== 1) continue
        const importers = verifiedImportersOf(graph, node.path).filter(({ edge }) => edge.bindingNames.includes(sym.name))
        if (importers.length >= 1) renameCandidates.push({ path: node.path, symbol: sym.name, importers: importers.length })
      }
    }
    renameCandidates.sort((a, b) => b.importers - a.importers)
    const pick = renameCandidates[0]
    if (!pick) {
      record(`rename-symbol: ${label}`, false, { error: 'no uniquely-declared exported symbol with verified importers found' })
    } else {
      const newName = `${pick.symbol}Refactored`
      const beforeRename = await projectFiles(pid)
      const plan = planRenameSymbol(beforeRename, { symbol: pick.symbol, newName })
      const safety = validateRefactorPlan(plan, beforeRename)
      const { opId, planHash } = await createRefactorOperation(pid, plan)
      const result = await executeRefactorOperation(opId, pid)

      const afterRename = await projectFiles(pid)
      const afterByPath = new Map(afterRename.map((f) => [f.path, f.content]))
      const defAfter = afterByPath.get(pick.path) ?? ''
      const renameOk =
        safety.ok &&
        result.status === 'executed' &&
        defAfter.includes(newName) &&
        !defAfter.includes(`function ${pick.symbol}(`) &&
        result.verification.contentsPreserved

      // Unrelated files byte-for-byte preserved.
      const touched = new Set(plan.edits.map((e) => e.path))
      let unrelatedPreserved = true
      for (const f of beforeRename) {
        if (touched.has(f.path)) continue
        if (afterByPath.get(f.path) !== f.content) unrelatedPreserved = false
      }

      const versions = await listVersions(pid)
      const refactorVersion = versions.find((v) => v.kind === 'refactor')
      const integrity = refactorVersion ? await validateVersionIntegrity(pid, refactorVersion.seq) : null

      record(
        `rename-symbol: ${label}`,
        Boolean(renameOk && unrelatedPreserved && refactorVersion && integrity?.ok),
        {
          symbol: `${pick.symbol} → ${newName}`,
          definingFile: pick.path,
          filesTouched: plan.edits.length,
          unrelatedFilesPreserved: unrelatedPreserved,
          versionSeq: refactorVersion?.seq ?? null,
          integrityOk: integrity?.ok ?? false,
          planHash: planHash.slice(0, 12),
        },
      )

      // -- 3. Replay safety ----------------------------------------------------
      const replay = await executeRefactorOperation(opId, pid)
      const afterReplay = await projectFiles(pid)
      record(
        `replay safety: ${label}`,
        replay.replayed === true && JSON.stringify(afterReplay) === JSON.stringify(afterRename),
        { replayed: replay.replayed === true, workspaceUnchanged: JSON.stringify(afterReplay) === JSON.stringify(afterRename) },
      )

      // -- 4. Stale-plan rejection (concurrent content change) ------------------
      const stalePlan = planRenameSymbol(afterRename, { symbol: newName, newName: `${newName}2` })
      const staleOp = await createRefactorOperation(pid, stalePlan)
      const staleTarget = await db.codeFile.findUnique({ where: { projectId_path: { projectId: pid, path: pick.path } } })
      if (staleTarget) {
        await db.codeFile.update({ where: { id: staleTarget.id }, data: { content: staleTarget.content + '\n// concurrent edit' } })
      }
      let staleRefused = false
      try {
        await executeRefactorOperation(staleOp.opId, pid)
      } catch (e) {
        staleRefused = e instanceof Error && /no longer matches|STALE|stale/i.test(e.message)
      }
      const afterStale = await projectFiles(pid)
      const staleOpRow = await db.codeFileOperation.findUnique({ where: { id: staleOp.opId } })
      const concurrentEditPreserved = (afterStale.find((f) => f.path === pick.path)?.content ?? '').includes('// concurrent edit')
      record(
        `stale-plan rejection: ${label}`,
        staleRefused && staleOpRow?.status === 'stale' && concurrentEditPreserved,
        { refused: staleRefused, ledgerStatus: staleOpRow?.status, concurrentEditPreserved },
      )
      // Undo the concurrent edit for the next scenarios.
      if (staleTarget) {
        const restored = afterRename.find((f) => f.path === pick.path)?.content ?? staleTarget.content
        await db.codeFile.update({ where: { id: staleTarget.id }, data: { content: restored } })
      }
    }

    // -- 5. Deterministic move-module with import updates ------------------------
    const moveCandidate =
      files.find((f) => f.path === 'data/sample.ts') ??
      files.find((f) => f.path === 'lib/motion.ts') ??
      files.find((f) => /^lib\/[^/]+\.tsx?$/.test(f.path)) ??
      files.find((f) => /^components\/[^/]+\.tsx?$/.test(f.path) && verifiedImportersOf(graph, f.path).length > 0)
    if (!moveCandidate) {
      record(`move-module: ${label}`, false, { error: 'no movable module found' })
    } else {
      const destDir = moveCandidate.path.startsWith('data/') ? 'core/data' : 'core'
      const beforeMove = await projectFiles(pid)
      const movePlan = planMoveModule(beforeMove, { sources: [moveCandidate.path], destination: destDir })
      const moveSafety = validateRefactorPlan(movePlan, beforeMove)
      const moveOp = await createRefactorOperation(pid, movePlan)
      const moveResult = await executeRefactorOperation(moveOp.opId, pid)
      const afterMove = await projectFiles(pid)
      const afterByPath = new Map(afterMove.map((f) => [f.path, f.content]))
      const movedTo = movePlan.moves[0]?.to
      const movedContent = movedTo ? afterByPath.get(movedTo) : undefined

      const remainingRefs = scanReferences(afterMove, movePlan.moves.map((m) => m.from)).length
      const touchedPaths = new Set([
        ...movePlan.moves.flatMap((m) => [m.from, m.to]),
        ...movePlan.edits.map((e) => e.path),
        ...movePlan.edits.map((e) => e.fromPath ?? ''),
      ].filter(Boolean))
      let unrelatedPreserved = true
      for (const f of beforeMove) {
        if (touchedPaths.has(f.path)) continue
        if (afterByPath.get(f.path) !== f.content) unrelatedPreserved = false
      }

      record(
        `move-module: ${label}`,
        Boolean(moveSafety.ok && moveResult.status === 'executed' && movedContent !== undefined && remainingRefs === 0 && unrelatedPreserved),
        {
          moved: `${moveCandidate.path} → ${movedTo}`,
          filesRewritten: movePlan.edits.length,
          remainingOldPathRefs: remainingRefs,
          unrelatedFilesPreserved: unrelatedPreserved,
          versionSeq: moveResult.versionSeq,
        },
      )

      // -- 6. Static validation pipeline over the moved set ---------------------
      const validation = runStaticValidation(afterMove, movePlan)
      const hardChecks = validation.checks.filter((c) => c.name === 'import-graph' || c.name === 'duplicate-exports' || c.name === 'planned-edits-landed' || c.name === 'scope-integrity')
      record(
        `static validation: ${label}`,
        hardChecks.every((c) => c.passed),
        {
          verdict: validation.verdict,
          checks: validation.checks.map((c) => `${c.name}:${c.passed ? 'ok' : 'issues'}`),
          note: 'missing imports and cycles are recorded honestly (a fixture may legitimately ship them); import-graph + duplicate-exports + plan-landing must be clean after a verified refactor',
        },
      )

      // -- 7. Export ZIP regression on the refactored project -------------------
      const meta = {
        title: `M25 verify — ${label}`,
        description: null,
        framework: 'react',
        language: 'typescript',
        createdAt: new Date(),
        updatedAt: new Date(),
        currentVersion: (await listVersions(pid))[0]?.seq ?? 0,
      }
      const exported = await buildProjectZip(meta, afterMove, (await listVersions(pid)).length)
      const verification = await verifyExportZip(exported.zip, exported.manifest)
      record(
        `export zip: ${label}`,
        verification.ok && exported.manifest.fileCount > 0 && Boolean(movedContent !== undefined && afterByPath.has(movedTo as string)),
        { fileCount: exported.manifest.fileCount, movedFileInSet: afterByPath.has(movedTo as string), issues: verification.issues },
      )
    }

    // -- 8. Rollback of the refactoring (creates a NEW version) -------------------
    const versionsBeforeRollback = await listVersions(pid)
    const initialSeq = Math.min(...versionsBeforeRollback.map((v) => v.seq))
    const rollback = await rollbackToVersion(pid, initialSeq)
    const afterRollback = await projectFiles(pid)
    const restoredMatchesSeed = afterRollback.length === seed.length && afterRollback.every((f) => seedByPath.get(f.path) === f.content)
    const versionsAfterRollback = await listVersions(pid)
    const rollbackVersion = versionsAfterRollback.find((v) => v.kind === 'rollback')
    record(
      `rollback-as-new-version: ${label}`,
      restoredMatchesSeed && Boolean(rollbackVersion) && versionsAfterRollback.length === versionsBeforeRollback.length + 1,
      {
        restoredTo: initialSeq,
        newVersionSeq: rollbackVersion?.seq ?? null,
        historyLengthBefore: versionsBeforeRollback.length,
        historyLengthAfter: versionsAfterRollback.length,
        contentsMatchSeed: restoredMatchesSeed,
      },
    )

    // -- 9. M23 file-operation regression INSIDE the refactored project ----------
    const filesAfterRollback = await projectFiles(pid)
    let m23Ok = true
    const m23Detail: Record<string, string> = {}
    const moveMessage = `move ${moveCandidate?.path ?? 'lib/motion.ts'} into archive`
    const detection = detectFileOperation(moveMessage, filesAfterRollback)
    if (!detection.detected) {
      m23Ok = false
      m23Detail[moveMessage] = 'not-detected'
    } else {
      const flow = await performDetectedFileOperation({ projectId: pid, detection, files: filesAfterRollback })
      const executed = flow.payload.status === 'executed' || flow.payload.status === 'awaiting_confirmation'
      m23Detail['m23 move'] = flow.payload.status
      if (!executed) m23Ok = false
      if (flow.payload.status === 'awaiting_confirmation' && flow.payload.opId) {
        const res = await executeOperation(flow.payload.opId, pid)
        if (res.failed.length > 0) m23Ok = false
        m23Detail['m23 move'] = `executed(${res.applied.length})`
      }
    }
    // A destructive op still requires confirmation.
    const delDetection = detectFileOperation(`delete ${moveCandidate?.path ?? 'lib/motion.ts'}`, filesAfterRollback)
    if (delDetection.detected && delDetection.type === 'op') {
      const delFlow = await performDetectedFileOperation({ projectId: pid, detection: delDetection, files: filesAfterRollback })
      m23Ok = m23Ok && delFlow.payload.status === 'awaiting_confirmation'
      m23Detail['delete requires confirmation'] = delFlow.payload.status
    }
    const m23Versions = await listVersions(pid)
    const m23Integrity = await Promise.all(m23Versions.map((v) => validateVersionIntegrity(pid, v.seq)))
    record(`M23 file-ops regression: ${label}`, m23Ok && m23Integrity.every((i) => i.ok), { ...m23Detail, versions: m23Integrity.length, integrityOk: m23Integrity.filter((i) => i.ok).length })

    await db.codeProject.delete({ where: { id: pid } })
  }

  // ---- fixture on-disk integrity after the run -------------------------------
  let fixturesUntouched = true
  for (const [key, hash] of fixtureHashBefore) {
    const [fixture, ...rest] = key.split('/')
    const rel = rest.join('/')
    const full = join(FIXTURE_ROOT, fixture, rel)
    if (!existsSync(full) || sha(readFileSync(full, 'utf8')) !== hash) {
      fixturesUntouched = false
      break
    }
  }
  record('M21 fixture files on disk untouched (hash-verified)', fixturesUntouched, { checked: fixtureHashBefore.size })

  // ---- cleanup ----------------------------------------------------------------
  await db.codeProject.deleteMany({ where: { userId } })
  await db.user.delete({ where: { id: userId } }).catch(() => undefined)
  const remaining = await db.codeProject.count({ where: { userId } })
  record('verification projects cleaned up (fixtures never persisted in product storage)', remaining === 0, { remaining })

  const failed = results.filter((r) => !r.pass)
  console.log(`\n${results.length - failed.length}/${results.length} acceptance steps passed`)
  await Bun.write('scripts/m25-out/acceptance.json', JSON.stringify({ ranAt: new Date().toISOString(), baseline: '49b04055f2c41fff0b5160afcd7d4e3059f51afd', results }, null, 2))
  await db.$disconnect()
  if (failed.length > 0) process.exit(1)
}

main().catch(async (e) => {
  console.error('ACCEPTANCE RUN FAILED:', e)
  await Bun.write('scripts/m25-out/acceptance.json', JSON.stringify({ ranAt: new Date().toISOString(), fatal: String(e), results }, null, 2))
  await db.$disconnect()
  process.exit(1)
})
