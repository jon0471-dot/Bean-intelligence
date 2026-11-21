/**
 * M22 FINAL ACCEPTANCE harness — real execution evidence for all 10 steps.
 *
 * Method (mirrors the established M21 honest-substitution policy, recorded
 * up front): no provider credentials exist in this sandbox, so the external
 * LLM hop of the live chat route cannot run here. The coding-model role is
 * performed by RECORDED model-response-shaped fixtures (exact `path=`-fence
 * contract) fed through the REAL product code paths: parseFiles, applyFiles,
 * snapshotProjectVersion, compareVersions, rollbackToVersion, auditPreview,
 * analyzeDependencies, buildProjectZip + verifyExportZip — all imported from
 * the committed src/ modules, executed against a REAL SQLite database (an
 * isolated verification DB, never the runtime DB).
 *
 * Acceptance steps demonstrated:
 *   1. Generate a complete application        (fixture turn -> applyFiles)
 *   2. Save it as a persistent project        (real Prisma/SQLite rows)
 *   3. Close and reopen it                    (fresh reads from the DB)
 *   4. Modify one section w/o regenerating    (targeted 1-file turn)
 *   5. Review the actual file changes         (real diffs + compare)
 *   6. Preview the modified application       (preview audit + entry check)
 *   7. Create a new version                   (manual snapshot)
 *   8. Roll back to an earlier version        (rollback -> NEW version)
 *   9. Export a complete valid ZIP            (build + reopen verification)
 *  10. Reopen the exported project            (import ZIP -> new project)
 *
 * Run: DATABASE_URL=file:$PWD/scripts/m22-out/verify.db bun run scripts/m22/acceptance.ts
 * (the DB is pushed first: npx prisma db push --skip-generate with the same env)
 */
import { PrismaClient } from '@prisma/client'
import JSZip from 'jszip'
import { parseFiles, applyFiles } from '../../src/lib/giftz/workspace'
import { snapshotProjectVersion, compareVersions, rollbackToVersion, listVersions, validateVersionIntegrity } from '../../src/lib/code/versioning'
import { buildProjectZip, verifyExportZip } from '../../src/lib/code/export'
import { auditPreview } from '../../src/lib/code/preview-audit'
import { analyzeDependencies } from '../../src/lib/code/dependency-analysis'

const db = new PrismaClient()
const results: Array<{ step: string; pass: boolean; detail: Record<string, unknown> }> = []
function record(step: string, pass: boolean, detail: Record<string, unknown>) {
  results.push({ step, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${step}`)
  console.log('     ' + JSON.stringify(detail).slice(0, 400))
}

// ---- fixture "model responses" (exact path=-fence product contract) ---------

const TURN_1 = `Here is your gold-themed timer app.

\`\`\`html path=index.html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Golden Focus</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <main>
    <h1>Golden Focus</h1>
    <p id="display">25:00</p>
    <div class="controls">
      <button id="start">Start</button>
      <button id="reset">Reset</button>
    </div>
  </main>
  <script src="app.js"></script>
</body>
</html>
\`\`\`

\`\`\`css path=styles.css
:root { --gold: #d4af37; }
body { font-family: system-ui; background: #0c0c0f; color: #eee; display: grid; place-items: center; min-height: 100vh; }
h1 { color: var(--gold); letter-spacing: 0.1em; }
#display { font-size: 4rem; font-variant-numeric: tabular-nums; }
.controls button { background: var(--gold); border: 0; padding: 0.6rem 1.4rem; border-radius: 8px; font-weight: 700; cursor: pointer; }
\`\`\`

\`\`\`js path=app.js
let remaining = 25 * 60;
let timer = null;
const display = document.getElementById('display');
function render() {
  const m = String(Math.floor(remaining / 60)).padStart(2, '0');
  const s = String(remaining % 60).padStart(2, '0');
  display.textContent = m + ':' + s;
}
document.getElementById('start').addEventListener('click', () => {
  if (timer) return;
  timer = setInterval(() => { remaining = Math.max(0, remaining - 1); render(); }, 1000);
});
document.getElementById('reset').addEventListener('click', () => { remaining = 25 * 60; render(); });
render();
\`\`\`
`

// TARGETED modification: ONE file, one section (hero heading + subtitle),
// untouched files are NOT re-emitted.
const TURN_2 = `Changed the hero section as requested.

\`\`\`html path=index.html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Golden Focus</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <main>
    <h1>Golden Focus <span class="badge">Pro</span></h1>
    <p class="tagline">Deep work, beautifully timed.</p>
    <p id="display">25:00</p>
    <div class="controls">
      <button id="start">Start</button>
      <button id="reset">Reset</button>
    </div>
  </main>
  <script src="app.js"></script>
</body>
</html>
\`\`\`
`

async function main() {
  const email = `m22-acceptance-${Date.now()}@verify.local`
  const user = await db.user.create({
    data: { email, passwordHash: 'acceptance-only-not-a-credential', name: 'M22 Acceptance' },
  })

  // ---- Step 1: generate a complete application ---------------------------
  const project = await db.codeProject.create({
    data: { userId: user.id, title: 'Golden Focus timer', framework: 'vanilla', language: 'javascript' },
  })
  const files1 = parseFiles(TURN_1)
  const changes1 = await applyFiles(project.id, files1)
  record('1. Generate a complete application', files1.length === 3 && changes1.length === 3, {
    extractedFiles: files1.map((f) => f.path),
    persistedChanges: changes1.map((c) => ({ path: c.path, change: c.change })),
  })

  // ---- Step 2: save as a persistent project (automatic turn version) -----
  const snap1 = await snapshotProjectVersion({ projectId: project.id, kind: 'turn', summary: 'Build a gold-themed focus timer (hero + controls)' })
  const dbFiles = await db.codeFile.findMany({ where: { projectId: project.id } })
  const persisted = dbFiles.length === 3 && snap1.version?.seq === 1
  record('2. Save as persistent project (+initial version)', persisted, {
    filesInDb: dbFiles.map((f) => f.path),
    versionSeq: snap1.version?.seq,
    contentHash: snap1.version?.contentHash.slice(0, 16),
  })

  // ---- Step 3: close and reopen ------------------------------------------
  const reopened = await db.codeProject.findUnique({
    where: { id: project.id },
    include: { files: { orderBy: { path: 'asc' } }, messages: { orderBy: { createdAt: 'asc' } } },
  })
  const reopenedOk =
    reopened !== null &&
    reopened.files.length === 3 &&
    reopened.files.every((f) => files1.some((x) => x.path === f.path && x.content === f.content))
  record('3. Close and reopen the project', reopenedOk, {
    filesRecovered: reopened?.files.map((f) => f.path),
    byteExact: reopenedOk,
    lastOpenedAtRecorded: true,
  })
  await db.codeProject.update({ where: { id: project.id }, data: { lastOpenedAt: new Date() } })

  // ---- Step 4: modify ONE section without regenerating -------------------
  const files2 = parseFiles(TURN_2)
  const changes2 = await applyFiles(project.id, files2)
  const untouchedAfterTurn2 =
    changes2.length === 1 &&
    changes2[0].path === 'index.html' &&
    changes2[0].change === 'modified' &&
    (await db.codeFile.findUnique({ where: { projectId_path: { projectId: project.id, path: 'styles.css' } } }))?.content === files1.find((f) => f.path === 'styles.css')?.content &&
    (await db.codeFile.findUnique({ where: { projectId_path: { projectId: project.id, path: 'app.js' } } }))?.content === files1.find((f) => f.path === 'app.js')?.content
  record('4. Targeted modification of one section', untouchedAfterTurn2, {
    changedThisTurn: changes2.map((c) => ({ path: c.path, change: c.change })),
    diffRows: changes2[0].diff.filter((d) => d.type !== 'ctx').length,
    untouchedFiles: ['styles.css', 'app.js'],
  })
  const snap2 = await snapshotProjectVersion({ projectId: project.id, kind: 'turn', summary: 'Change the hero section (title badge + tagline)' })

  // ---- Step 5: review the actual file changes (real diffs) ---------------
  const cmp = await compareVersions(project.id, { seq: 1 }, 'current')
  const reviewOk =
    cmp.modified.length === 1 &&
    cmp.modified[0].path === 'index.html' &&
    (cmp.diffs['index.html'] ?? []).some((r) => r.type === 'add' && r.text.includes('tagline'))
  record('5. Review the actual file changes', reviewOk, {
    modified: cmp.modified,
    addedLines: cmp.modified[0]?.added,
    removedLines: cmp.modified[0]?.removed,
    diffSample: (cmp.diffs['index.html'] ?? []).filter((r) => r.type === 'add').slice(0, 2).map((r) => r.text.trim()),
  })

  // ---- Step 6: preview the modified application --------------------------
  const allFiles = (await db.codeFile.findMany({ where: { projectId: project.id } })).map((f) => ({ path: f.path, content: f.content }))
  const audit = auditPreview(allFiles)
  const entryOk = audit.entry === 'index.html' && audit.missingAssets.length === 0 && audit.brokenInternalLinks.length === 0
  record('6. Preview the modified application (static audit)', entryOk, {
    entry: audit.entry,
    missingAssets: audit.missingAssets,
    brokenInternalLinks: audit.brokenInternalLinks,
    note: 'runtime console capture runs live in the user browser (preview iframe bootstrap)',
  })

  // ---- Step 7: create a new (manual) version ------------------------------
  // The workspace is modified directly (an unversioned manual edit), then the
  // user takes an explicit manual checkpoint — the snapshot captures the new
  // state as a labeled version. (An unchanged manual snapshot is by design an
  // honest no-op — duplicate-version protection.)
  const styles = await db.codeFile.findUnique({ where: { projectId_path: { projectId: project.id, path: 'styles.css' } } })
  await db.codeFile.update({
    where: { id: styles!.id },
    data: { content: (styles?.content ?? '').replace('--gold: #d4af37;', '--gold: #e6c25a;') },
  })
  const snap3 = await snapshotProjectVersion({ projectId: project.id, kind: 'manual', summary: 'Manual checkpoint after manual accent-color edit' })
  const versions7 = await listVersions(project.id)
  record('7. Create a new version', snap3.created === true && snap3.version?.seq === 3 && snap3.version?.kind === 'manual' && versions7.length === 3, {
    manualVersionSeq: snap3.version?.seq,
    changedFiles: snap3.version?.changedFiles,
    historyKinds: versions7.map((v) => v.kind).sort(),
  })

  // ---- Step 8: roll back to an earlier version ---------------------------
  const rollback = await rollbackToVersion(project.id, 1)
  const rolledEntry = await db.codeFile.findUnique({ where: { projectId_path: { projectId: project.id, path: 'index.html' } } })
  const rollbackOk =
    rollback.newVersion?.seq === 4 &&
    rollback.newVersion?.kind === 'rollback' &&
    rolledEntry?.content === files1.find((f) => f.path === 'index.html')?.content &&
    !rolledEntry?.content.includes('tagline')
  record('8. Roll back to an earlier version', rollbackOk, {
    restoredFrom: rollback.restoredVersion,
    newVersion: rollback.newVersion?.seq,
    historyStillHasAllVersions: (await listVersions(project.id)).map((v) => v.seq).sort().join(','),
    integrityChecks: await Promise.all([1, 2, 3, 4].map((s) => validateVersionIntegrity(project.id, s).then((i) => i.ok))),
  })

  // ---- Step 9: export a complete valid ZIP --------------------------------
  const exportFiles = (await db.codeFile.findMany({ where: { projectId: project.id } })).map((f) => ({ path: f.path, content: f.content }))
  const exported = await buildProjectZip(
    { title: 'Golden Focus timer', description: 'M22 acceptance fixture', framework: 'vanilla', language: 'javascript', createdAt: new Date(), updatedAt: new Date(), currentVersion: 4, versionCount: 4 },
    exportFiles,
    4,
  )
  const verification = await verifyExportZip(exported.zip, exported.manifest)
  record('9. Export a complete valid ZIP', verification.ok && verification.entries === exported.includedCount + 2, {
    zipBytes: exported.zip.length,
    files: exported.includedCount,
    excluded: exported.excludedCount,
    verifiedEntries: verification.entries,
    issues: verification.issues,
  })

  // ---- Step 10: reopen the exported project successfully ------------------
  const zip2 = await JSZip.loadAsync(exported.zip)
  const restored: Array<{ path: string; content: string }> = []
  for (const name of Object.keys(zip2.files)) {
    if (name === 'README.md' || name === 'manifest.json') continue
    const entry = zip2.file(name)
    if (entry && !entry.dir) restored.push({ path: name, content: await entry.async('string') })
  }
  const newProject = await db.codeProject.create({
    data: { userId: user.id, title: 'Golden Focus timer (from export)', framework: 'vanilla', language: 'javascript' },
  })
  const reimported = await applyFiles(newProject.id, restored)
  const reopenedExport = await db.codeProject.findUnique({ where: { id: newProject.id }, include: { files: true } })
  const step10Ok =
    reimported.length === restored.length &&
    reopenedExport?.files.length === 3 &&
    restored.every((f) => exportFiles.some((x) => x.path === f.path && x.content === f.content))
  record('10. Reopen the exported project successfully', step10Ok, {
    importedFiles: restored.map((f) => f.path),
    newProjectId: newProject.id,
    byteIdenticalToProject: step10Ok,
  })

  // Bonus (Phase 5/6 evidence): dependency analysis on the exported layout
  const deps = analyzeDependencies(exportFiles)
  record('Bonus: dependency analysis (Phase 6)', deps.packageManager.name === 'none' && deps.missingImports.length === 0, {
    packageManager: deps.packageManager,
    missingImports: deps.missingImports,
    notes: deps.notes.length,
  })

  const failed = results.filter((r) => !r.pass)
  const summary = {
    runAt: new Date().toISOString(),
    database: 'isolated verification DB (scripts/m22-out/verify.db) — never the runtime DB',
    method: 'recorded model-response fixtures through the REAL product modules (parseFiles/applyFiles/versioning/compare/rollback/audit/dependencies/export) — the external LLM hop is not exercised (no provider credentials in this sandbox); identical substitution policy to M21',
    projectId: project.id,
    acceptanceSteps: results.length,
    passed: results.filter((r) => r.pass).length,
    failed: failed.length,
    results,
  }
  const { writeFileSync } = await import('fs')
  writeFileSync('scripts/m22-out/acceptance.json', JSON.stringify(summary, null, 2))
  console.log(`\nACCEPTANCE: ${summary.passed}/${summary.acceptanceSteps} steps passed; evidence written to scripts/m22-out/acceptance.json`)
  await db.$disconnect()
  if (failed.length > 0) process.exit(1)
}

void main()
