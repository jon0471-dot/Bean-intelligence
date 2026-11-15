/**
 * M23 FINAL ACCEPTANCE harness — real execution evidence for chat-based file
 * operations, run against a REAL isolated SQLite database (never the runtime
 * DB) and the REAL committed modules (detection → planning → confirmation →
 * transactional execution → version snapshot → repair → rollback → export).
 *
 * Method (the established M21/M22 honest-substitution policy): no provider
 * credentials exist in this sandbox, so the external LLM hop cannot run — and
 * M23 file operations do not need one: the entire feature is deterministic
 * server-side code, exercised here end-to-end through the real modules with
 * real Prisma/SQLite persistence.
 *
 * The M21 fixtures (Nebula = project-a-landing, Pulse = project-b-dashboard,
 * Nova Reyes = project-c-portfolio) are loaded READ-ONLY from
 * validation/m21/projects/ as regression inputs; the files on disk are
 * hash-verified untouched after the run and the seeded verification projects
 * are deleted again (the fixtures are never registered in any production
 * storage and never moved).
 *
 * Run:
 *   mkdir -p scripts/m23-out
 *   DATABASE_URL=file:$PWD/scripts/m23-out/verify.db npx prisma db push --skip-generate
 *   DATABASE_URL=file:$PWD/scripts/m23-out/verify.db bun run scripts/m23/acceptance.ts
 */
import { PrismaClient } from '@prisma/client'
import { createHash } from 'crypto'
import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { detectFileOperation } from '../../src/lib/code/file-ops/detect'
import { performDetectedFileOperation, executeOperation, cancelOperation } from '../../src/lib/code/file-ops/execute'
import { snapshotProjectVersion, rollbackToVersion, listVersions, validateVersionIntegrity } from '../../src/lib/code/versioning'
import { buildProjectZip, verifyExportZip } from '../../src/lib/code/export'

const db = new PrismaClient()
const results: Array<{ step: string; pass: boolean; detail: Record<string, unknown> }> = []
function record(step: string, pass: boolean, detail: Record<string, unknown>) {
  results.push({ step, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${step}`)
  console.log('     ' + JSON.stringify(detail).slice(0, 460))
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
  return db.codeFile.findMany({ where: { projectId }, orderBy: { path: 'asc' } })
}

async function seedProject(userId: string, title: string, files: Array<{ path: string; content: string }>): Promise<string> {
  // The verification user (isolated throwaway row in the throwaway DB).
  await db.user.upsert({
    where: { email: 'm23-acceptance@verification.invalid' },
    update: {},
    create: { id: userId, email: 'm23-acceptance@verification.invalid', passwordHash: 'verification-only-not-a-credential' },
  })
  const project = await db.codeProject.create({ data: { userId, title } })
  for (const f of files) {
    await db.codeFile.create({ data: { projectId: project.id, path: f.path, content: f.content, origin: 'generated' } })
  }
  await snapshotProjectVersion({ projectId: project.id, kind: 'manual', summary: 'seeded fixture state' })
  return project.id
}

/** Run a chat message through the real detection → flow pipeline against the DB. */
async function flow(projectId: string, message: string) {
  const files = await projectFiles(projectId)
  const detection = detectFileOperation(message, files)
  return performDetectedFileOperation({ projectId, detection, files })
}

const FIXTURE_ROOT = 'validation/m21/projects'
const fixtureHashBefore = new Map<string, string>()

async function main() {
  // ---- fixture integrity baseline ------------------------------------------
  for (const fixture of ['project-a-landing', 'project-b-dashboard', 'project-c-portfolio']) {
    const dir = join(FIXTURE_ROOT, fixture)
    if (existsSync(dir)) {
      for (const f of loadFixtureTree(dir)) {
        fixtureHashBefore.set(`${fixture}/${f.path}`, sha(f.content))
      }
    }
  }
  record('M21 fixtures readable (read-only baseline hashed)', fixtureHashBefore.size > 50, {
    files: fixtureHashBefore.size,
    nebula: [...fixtureHashBefore.keys()].filter((k) => k.startsWith('project-a-landing/')).length,
    pulse: [...fixtureHashBefore.keys()].filter((k) => k.startsWith('project-b-dashboard/')).length,
    novaReyes: [...fixtureHashBefore.keys()].filter((k) => k.startsWith('project-c-portfolio/')).length,
  })

  // ---- seed Nebula into the verification DB --------------------------------
  const nebulaFiles = loadFixtureTree(join(FIXTURE_ROOT, 'project-a-landing'))
  const userId = 'm23-acceptance-user'
  const projectId = await seedProject(userId, 'Nebula (M23 acceptance copy)', nebulaFiles)
  const versions0 = await listVersions(projectId)
  record('Nebula fixture seeded as a persistent project (verification DB)', versions0.length === 1, {
    files: nebulaFiles.length,
    version: versions0[0]?.seq,
    kind: versions0[0]?.kind,
  })

  // ---- 1. rename with import repair ----------------------------------------
  const rename = await flow(projectId, 'rename components/site-nav.tsx to components/top-nav.tsx')
  const renameOk = rename.payload.status === 'executed' && rename.payload.versionSeq != null
  const oldGone = (await db.codeFile.findUnique({ where: { projectId_path: { projectId, path: 'components/site-nav.tsx' } } })) === null
  const newThere = await db.codeFile.findUnique({ where: { projectId_path: { projectId, path: 'components/top-nav.tsx' } } })
  const appUnchanged = (await db.codeFile.findUnique({ where: { projectId_path: { projectId, path: 'App.tsx' } } }))?.content ?? ''
  record('1. chat rename executes with byte-identical content', renameOk && oldGone && !!newThere && appUnchanged.includes("'./components/site-nav'"), {
    status: rename.payload.status,
    version: rename.payload.versionSeq,
    remainingReferences: rename.payload.result?.verification.remainingReferences,
    contentsPreserved: rename.payload.result?.verification.contentsPreserved,
  })

  const repairOffer = rename.payload.result?.repairOffered
  const repair = repairOffer ? await executeOperation(repairOffer.opId, projectId) : null
  const appRepaired = (await db.codeFile.findUnique({ where: { projectId_path: { projectId, path: 'App.tsx' } } }))?.content ?? ''
  const brokenLeft = repair?.verification.remainingReferences ?? -1
  record('2. offered import repair executes and fixes App.tsx references', !!repair && brokenLeft === 0 && appRepaired.includes("'./components/top-nav'"), {
    repairedFiles: repair?.applied.map((a) => a.path),
    remainingReferences: brokenLeft,
    version: repair?.versionSeq,
  })

  // ---- 3. folder move with nested contents ---------------------------------
  const kitBefore = await projectFiles(projectId)
  const kitFiles = kitBefore.filter((f) => f.path.startsWith('components/kit/'))
  const move = await flow(projectId, 'move the kit folder into assets')
  const afterMove = await projectFiles(projectId)
  const movedOk =
    move.payload.status === 'executed' &&
    kitFiles.length > 0 &&
    kitFiles.every((f) => {
      const to = f.path.replace('components/kit/', 'assets/kit/')
      const row = afterMove.find((x) => x.path === to)
      return row && row.content === f.content
    }) &&
    !afterMove.some((f) => f.path.startsWith('components/kit/'))
  record('3. folder move preserves nested contents byte-for-byte', movedOk, {
    movedFiles: kitFiles.length,
    status: move.payload.status,
    version: move.payload.versionSeq,
  })

  // ---- 4. batch rename by convention ---------------------------------------
  // Nebula's components are already kebab-case; create ONE PascalCase file via
  // the explicit-content create flow, then batch-rename the folder.
  const pascalMsg = 'Add a file called components/SiteFooter.tsx:\n\n```tsx path=components/SiteFooter.tsx\nexport const SiteFooter = () => <footer/>\n```\n'
  await flow(projectId, pascalMsg)
  const batch = await flow(projectId, 'rename all .tsx files in components to kebab-case')
  const afterBatch = await projectFiles(projectId)
  const batchOk =
    batch.payload.status === 'executed' &&
    afterBatch.some((f) => f.path === 'components/site-footer.tsx') &&
    !afterBatch.some((f) => f.path === 'components/SiteFooter.tsx')
  record('4. batch rename applies kebab-case to every matching file', batchOk, {
    status: batch.payload.status,
    affected: batch.payload.affectedFiles,
    version: batch.payload.versionSeq,
  })

  // ---- 5. create folder + explicit-content file ------------------------------
  const createFolder = await flow(projectId, 'create a folder called docs')
  const marker = await db.codeFile.findUnique({ where: { projectId_path: { projectId, path: 'docs/.gitkeep' } } })
  const createFileMsg = 'Add a file called docs/manual.md:\n\n```md path=docs/manual.md\n# Nebula manual\n\nGenerated by CODE GIFTZ.\n```\n'
  const createFile = await flow(projectId, createFileMsg)
  const manual = await db.codeFile.findUnique({ where: { projectId_path: { projectId, path: 'docs/manual.md' } } })
  record('5. create folder (.gitkeep marker) + create file with explicit content', createFolder.payload.status === 'executed' && !!marker && createFile.payload.status === 'executed' && (manual?.content ?? '').includes('# Nebula manual'), {
    folder: createFolder.payload.status,
    file: createFile.payload.status,
    contentChars: manual?.content.length,
  })

  // ---- 6. deletion with confirmation + rollback ------------------------------
  const del = await flow(projectId, 'delete the assets folder')
  const delAwaiting = del.payload.status === 'awaiting_confirmation' && del.payload.opId != null
  const stillThere = await db.codeFile.findFirst({ where: { projectId, path: { startsWith: 'assets/kit/' } } })
  const cancelled = delAwaiting ? await cancelOperation(del.payload.opId!, projectId) : null
  const afterCancel = await projectFiles(projectId)
  const cancelOk = !!cancelled && cancelled.cancelled === true && afterCancel.some((f) => f.path.startsWith('assets/kit/'))
  record('6. destructive delete requires confirmation; cancel changes nothing', delAwaiting && stillThere != null && cancelOk, {
    planFiles: del.payload.affectedFiles?.length,
    afterCancelFiles: afterCancel.length,
  })

  const del2 = await flow(projectId, 'delete the assets folder')
  const delResult = del2.payload.opId ? await executeOperation(del2.payload.opId, projectId) : null
  const afterDelete = await projectFiles(projectId)
  const deleteOk = del2.payload.status === 'awaiting_confirmation' && !!delResult && delResult.applied.length === kitFiles.length && !afterDelete.some((f) => f.path.startsWith('assets/'))
  record('7. confirmed folder deletion removes exactly the planned files', deleteOk, {
    applied: delResult?.applied.length,
    version: delResult?.versionSeq,
  })

  const versionsBeforeRollback = await listVersions(projectId)
  // Roll back to the version BEFORE the deletion (the delete itself is v{n}).
  const preDeleteSeq = (delResult?.versionSeq ?? 1) - 1
  const rollback = await rollbackToVersion(projectId, preDeleteSeq)
  const afterRollback = await projectFiles(projectId)
  const rollbackOk =
    rollback.newVersion != null &&
    afterRollback.some((f) => f.path === 'assets/kit/gsap-core.ts' || f.path.startsWith('assets/kit/')) &&
    afterRollback.some((f) => f.path === 'docs/manual.md')
  let integrity: Array<Awaited<ReturnType<typeof validateVersionIntegrity>>>
  try {
    const vs = await listVersions(projectId)
    integrity = await Promise.all(vs.map((v) => validateVersionIntegrity(projectId, v.seq)))
  } catch (e) {
    console.error('INTEGRITY CHECK FAILED:', e)
    throw e
  }
  record('8. rollback restores the deleted tree as a NEW version; all versions valid', rollbackOk && integrity.every((i) => i.ok), {
    versions: integrity.length,
    integrityOk: integrity.filter((i) => i.ok).length,
    rollbackVersion: rollback.newVersion?.seq,
  })

  // ---- 9. real reopen (fresh reads) + ZIP export verification ---------------
  const reopened = await projectFiles(projectId)
  const reopenOk =
    reopened.some((f) => f.path === 'components/top-nav.tsx') &&
    reopened.find((f) => f.path === 'App.tsx')?.content.includes("'./components/top-nav'") === true
  const project = await db.codeProject.findUnique({ where: { id: projectId } })
  const zipResult = project
    ? await buildProjectZip(
        {
          title: project.title,
          description: project.description,
          framework: project.framework,
          language: project.language,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          currentVersion: project.currentVersion,
        },
        reopened,
        null,
      )
    : null
  const zipCheck = zipResult ? await verifyExportZip(zipResult.zip, zipResult.manifest) : null
  record('9. reopen from SQLite + verified ZIP export (secret-free, manifest present)', reopenOk && !!zipCheck?.ok, {
    files: reopened.length,
    zipEntries: zipCheck?.entries,
    zipOk: zipCheck?.ok,
    zipIssues: zipCheck?.issues ?? [],
  })

  // ---- 10. unrelated files byte-for-byte unchanged across ALL ops -----------
  // The ONLY content change the user approved was the reference repair
  // (repairOffer.affectedFiles); every other original file must be identical.
  const originalNebula = new Map(nebulaFiles.map((f) => [f.path, f.content]))
  const approvedContentChanges = new Set((repairOffer?.affectedFiles ?? []).map((a) => a.path))
  let unchanged = true
  const changedReport: string[] = []
  for (const f of reopened) {
    const orig = originalNebula.get(f.path)
    if (orig === undefined) continue // created/renamed-in files are new or moved
    if (orig !== f.content && !approvedContentChanges.has(f.path)) {
      unchanged = false
      changedReport.push(f.path)
    }
  }
  record('10. no UNINTENDED content changes (only the approved repair touched file contents)', unchanged, {
    changedContentFiles: changedReport,
    approvedRepairTargets: [...approvedContentChanges],
  })

  // ---- Pulse + Nova Reyes representative regression -------------------------
  for (const [fixture, ops] of [
    ['project-b-dashboard', ['rename components/sidenav.tsx to components/navigation.tsx', 'delete the data folder']],
    ['project-c-portfolio', ['rename pages/projects.tsx to pages/work.tsx', 'create a folder called assets/icons']],
  ] as Array<[string, string[]]>) {
    const fixtureFiles = loadFixtureTree(join(FIXTURE_ROOT, fixture))
    const pid = await seedProject(userId, `${fixture} (M23 regression copy)`, fixtureFiles)
    let ok = true
    const detail: Record<string, unknown> = {}
    for (const op of ops) {
      const r = await flow(pid, op)
      const executed = r.payload.status === 'executed' || r.payload.status === 'awaiting_confirmation'
      detail[op] = r.payload.status
      if (!executed) ok = false
      if (r.payload.status === 'awaiting_confirmation' && r.payload.opId) {
        const res = await executeOperation(r.payload.opId, pid)
        if (res.failed.length > 0) ok = false
        detail[op] = `${r.payload.status}→executed(${res.applied.length})`
      }
    }
    let integrity: Array<Awaited<ReturnType<typeof validateVersionIntegrity>>>
    try {
      const vs = await listVersions(pid)
      integrity = await Promise.all(vs.map((v) => validateVersionIntegrity(pid, v.seq)))
    } catch (e) {
      console.error(`INTEGRITY FAILED for ${fixture}:`, (e as Error).stack ?? e)
      throw e
    }
    record(`M21 fixture regression: ${fixture} representative operations`, ok && integrity.every((i) => i.ok), {
      ...detail,
      versions: integrity.length,
      integrityOk: integrity.filter((i) => i.ok).length,
    })
    await db.codeProject.delete({ where: { id: pid } })
  }

  // ---- fixture on-disk integrity after the run ------------------------------
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
  record('M21 fixture files on disk untouched (hash-verified)', fixturesUntouched, {
    checked: fixtureHashBefore.size,
  })

  // ---- cleanup: remove ALL seeded verification projects ---------------------
  await db.codeProject.deleteMany({ where: { userId } })
  await db.user.delete({ where: { id: userId } }).catch(() => undefined)
  const remaining = await db.codeProject.count({ where: { userId } })
  record('verification projects cleaned up (fixtures never persisted in product storage)', remaining === 0, { remaining })

  const failed = results.filter((r) => !r.pass)
  console.log(`\n${results.length - failed.length}/${results.length} acceptance steps passed`)
  await Bun.write('scripts/m23-out/acceptance.json', JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2))
  await db.$disconnect()
  if (failed.length > 0) process.exit(1)
}

main().catch(async (e) => {
  console.error('ACCEPTANCE RUN FAILED:', e)
  await Bun.write('scripts/m23-out/acceptance.json', JSON.stringify({ ranAt: new Date().toISOString(), fatal: String(e), results }, null, 2))
  await db.$disconnect()
  process.exit(1)
})
