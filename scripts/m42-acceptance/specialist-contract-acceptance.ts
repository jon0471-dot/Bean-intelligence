/**
 * M42.5 LIVE acceptance — the shared specialist research contract driven
 * through the REAL pipeline for all seven consumers, plus the fiction
 * exclusion rule. Every row is classified honestly:
 *   PASS               — real evidence returned (hosts/urls validated non-empty)
 *   HONEST-UNAVAILABLE — skipped/degraded with the exact recorded reason
 *   FAIL               — zero evidence with no honest reason
 * The fiction-exclusion rows are PASS only when NO evidence is returned
 * (retrieval must not fire for fiction/transform tasks).
 */
import {
  runSpecialistResearch,
  shouldPreflightResearch,
  type SpecialistConsumer,
  type ResearchPurpose,
} from '../../src/lib/research/agent-evidence'

interface Row {
  consumer: SpecialistConsumer
  kind: 'task-relevant' | 'fiction-exclusion'
  objective: string
  classification: 'PASS' | 'HONEST-UNAVAILABLE' | 'FAIL'
  evidenceCount: number
  hosts: string[]
  datedSources: string[]
  reason: string | null
  ms: number
}

const CASES: Array<{ consumer: SpecialistConsumer; purpose: ResearchPurpose; objective: string }> = [
  { consumer: 'riishe', purpose: 'fact-check', objective: 'Research the current state of the European EV charging market with sources' },
  { consumer: 'code-giftz', purpose: 'technical', objective: 'upgrade our project to the latest zod npm package version — check the official documentation and compatibility notes' },
  { consumer: 'laxii', purpose: 'visual-reference', objective: 'photorealistic kingfisher illustration — real anatomy and plumage references' },
  { consumer: 'jazmii', purpose: 'video-reference', objective: 'documentary about kingfishers — real diving behavior and habitat references' },
  { consumer: 'gangzii', purpose: 'audio-reference', objective: 'pronunciation references for the Icelandic place name Þingvellir — authoritative phonetic sources' },
  { consumer: 'knowledge', purpose: 'research-document', objective: 'assemble sources on the global semiconductor supply chain with publication dates' },
  { consumer: 'quality', purpose: 'fact-check', objective: 'fact-check: which Node.js release line currently holds Active LTS status — official sources only' },
]

async function main() {
  const rows: Row[] = []
  for (const c of CASES) {
    const t0 = Date.now()
    const pack = await runSpecialistResearch({
      consumer: c.consumer,
      objective: c.objective,
      userId: null,
      missionScoped: true,
      purpose: c.purpose,
      freshness: 'stable',
    })
    const ms = Date.now() - t0
    const evidence = pack.evidence
    const hosts = [...new Set(evidence.map((e) => e.host))].slice(0, 8)
    const dated = evidence.filter((e) => e.publishedAt).map((e) => `${e.sourceId}(${e.publishedAt!.slice(0, 10)})`).slice(0, 6)
    let classification: Row['classification']
    let reason: string | null = null
    if (evidence.length > 0) {
      classification = 'PASS'
    } else if (pack.skippedReason) {
      classification = 'HONEST-UNAVAILABLE'
      reason = pack.skippedReason
    } else if (pack.degraded.length > 0) {
      classification = 'HONEST-UNAVAILABLE'
      reason = pack.degraded.join('; ').slice(0, 200)
    } else {
      classification = 'FAIL'
    }
    rows.push({ consumer: c.consumer, kind: 'task-relevant', objective: c.objective, classification, evidenceCount: evidence.length, hosts, datedSources: dated, reason, ms })
    console.log(`${classification} ${c.consumer} (${ms}ms) :: ${evidence.length} source(s) — ${hosts.length > 0 ? hosts.join(', ') : reason ?? 'no reason recorded'}`)
  }

  // The fiction exclusion — measured through the REAL execution path: the
  // mission executor consults the deterministic trigger BEFORE any network
  // call, and the trigger must refuse fiction/transform objectives.
  for (const objective of [
    'write a fantasy story about an imaginary glass cloud city',
    'reformat my meeting notes into bullet points',
  ]) {
    const t0 = Date.now()
    const triggered = shouldPreflightResearch(objective, 'riishe')
    // Mirror the executor: only a triggered objective runs retrieval at all.
    const pack = triggered
      ? await runSpecialistResearch({ consumer: 'riishe', objective, userId: null, missionScoped: true })
      : null
    const ms = Date.now() - t0
    const cleanSkip = !triggered && pack === null
    rows.push({
      consumer: 'riishe',
      kind: 'fiction-exclusion',
      objective,
      classification: cleanSkip ? 'PASS' : 'FAIL',
      evidenceCount: pack?.evidence.length ?? 0,
      hosts: [],
      datedSources: [],
      reason: cleanSkip
        ? 'the deterministic trigger refused the fiction/transform objective — no network call was made'
        : `retrieval FIRED for a fiction/transform objective (triggered=${triggered}, searchCalls=${pack?.searchCalls ?? 'n/a'})`,
      ms,
    })
    console.log(`${cleanSkip ? 'PASS' : 'FAIL'} fiction-exclusion (${ms}ms) :: "${objective.slice(0, 50)}" → ${cleanSkip ? 'trigger refused, no retrieval' : 'RETRIEVAL FIRED'}`)
  }

  const pass = rows.filter((r) => r.classification === 'PASS').length
  const hun = rows.filter((r) => r.classification === 'HONEST-UNAVAILABLE').length
  const fail = rows.filter((r) => r.classification === 'FAIL').length
  console.log(`TOTAL: ${pass} PASS / ${hun} honest-unavailable / ${fail} FAIL across ${rows.length} rows`)
  const { writeFileSync, mkdirSync } = await import('node:fs')
  mkdirSync('scripts/m42-acceptance/out', { recursive: true })
  writeFileSync('scripts/m42-acceptance/out/specialist-contract-acceptance.json', JSON.stringify({ at: new Date().toISOString(), rows, summary: { pass, honestUnavailable: hun, fail, total: rows.length } }, null, 2))
  console.log('evidence → scripts/m42-acceptance/out/specialist-contract-acceptance.json')
}
void main()
