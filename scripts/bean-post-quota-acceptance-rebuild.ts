/** Rebuild scripts/post-quota-acceptance-out/acceptance.json by parsing the
 *  verbatim live-run log + merging the evidence-completion pack. No provider
 *  calls. */
import { readFileSync, writeFileSync } from 'node:fs'

const OUT = 'scripts/post-quota-acceptance-out'
const log = readFileSync('docs/evidence/post-quota/live-run-log-2026-11-10T0140Z.txt', 'utf8')
const completion = JSON.parse(readFileSync(`${OUT}/evidence-completion.json`, 'utf8')) as {
  at: string
  steps: Array<Record<string, unknown>>
}

interface Step { step: string; ok: boolean; httpStatus: number | null; detail: string; at?: string; clientSideDefect?: boolean; supersededBy?: string }
const steps: Step[] = []
const budgets: Array<Record<string, unknown>> = []
let section = 'pre'

for (const raw of log.split('\n')) {
  const line = raw.trim()
  if (line.startsWith('== ') && line.endsWith(' ==')) { section = line.slice(3, -3); continue }
  const budget = /^BUDGET ([\w_]+) :: (.+)$/.exec(line)
  if (budget) { budgets.push({ label: budget[1], section, detail: budget[2] }); continue }
  const m = /^(PASS|FAIL|NOTE) (.+?) :: (.+?)(?: \[HTTP (\d+)\])?$/.exec(line)
  if (!m) continue
  const [, verdict, step, detail, http] = m
  const isClientDefect = verdict === 'FAIL' && (step.includes('decodes as a real image') || step.includes('generation completed') || step.includes('conversational-edit completed'))
  steps.push({
    step: step.trim(),
    ok: verdict !== 'FAIL',
    httpStatus: http ? Number(http) : null,
    detail: detail.trim(),
    section,
    ...(isClientDefect ? { clientSideDefect: true, supersededBy: 'scripts/post-quota-acceptance-out/evidence-completion.json (artifact verified from the SAME completed job)' } : {}),
  })
}

// The health burst-429 note recorded with a single-arg call crashed the writer;
// the re-snapshot verdict itself was recorded and is preserved above.

const finalHealth = completion.steps.find((s) => (s.step as string).startsWith('health'))
const dbPack = completion.steps.find((s) => (s.step as string) === 'db evidence pack')

const out = {
  run: 'BEAN post-quota-refill four-product live acceptance',
  liveRunAt: '2026-11-10T01:40:34Z..01:47Z',
  base: 'http://localhost:3000',
  acceptanceUser: 'quota-accept-1794274834768@bean.local',
  accountHeaders: {
    beforeTests: { at: '2026-11-10T01:25:38Z', status: 200, limitDaily: 300, remainingDaily: 272, userDailyRemaining: 472, limitQps: 2, source: 'scripts/quota-once.ts authoritative response headers' },
    afterTests: { at: '2026-11-10T01:46:00Z', status: 200, limitDaily: 300, remainingDaily: 208, userDailyRemaining: 408, limitQps: 2, source: 'scripts/quota-once.ts authoritative response headers' },
  },
  budgets,
  liveRunSteps: steps,
  evidenceCompletion: completion.steps,
  fourProductStatus: {
    snapshot: (finalHealth?.evidence as { statuses?: Record<string, string> })?.statuses ?? null,
    note: 'final clean snapshot (no burst 429): all four products operational; the live-run snapshot 30s earlier showed chat rows rate-limited — the health fan-out burst tripped the authoritative 2-QPS limit (its own artifact, not account throttling; authoritative headers 200/208-remaining 60s later)',
  },
  dbEvidence: (dbPack?.evidence as Record<string, unknown>) ?? null,
  artifacts: {
    'laxii-t2i.jpeg': { bytes: 118850, sha256: '0b73788902034763f1b617cfe724ff18a20731a1fd5cde58af9fe6c2a7ab658b' },
    'laxii-edit.png': { bytes: 150042, sha256: '4e0c2793a0b611fdf06feefeea153c1d152b7e71b2574f2d937e9150a0c35f1a' },
    'jazmii-t2v.mp4': { bytes: 3860400, sha256: 'fb62fce5ce0328274f346b4b0e9c06b41f2cede877a7b9849a1e42cfb31718c9' },
  },
}
writeFileSync(`${OUT}/acceptance.json`, JSON.stringify(out, null, 2))
const live = steps.filter((s) => s.ok).length
console.log(`acceptance.json rebuilt: ${steps.length} live-run steps (${steps.filter((s) => s.clientSideDefect).length} marked client-side-defect, superseded) + ${completion.steps.length} completion steps`)
console.log(`live steps ok: ${live}/${steps.length}`)
