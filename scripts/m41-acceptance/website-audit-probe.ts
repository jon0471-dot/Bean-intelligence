/**
 * M41.7 diagnostics: run the REAL mission-aware hosted verifier over the
 * REAL persisted website project (the audit input the worker builds), and
 * also the deterministic website verifier. Prints the hosted issue
 * descriptions — the exact feedback the audit produced.
 */
import { readFileSync } from 'node:fs'
import { parseVerifierReport } from '../../src/lib/verification/pipeline'
import { buildVerifierUserTurn, VERIFIER_SYSTEM_PROMPT } from '../../src/lib/verification/prompts'
import { verificationConfig } from '../../src/lib/verification/config'
import { planGatewayChat, executeGatewayChat } from '../../src/lib/ai-gateway/gateway'
import { buildDeliverableAuditInput, buildMissionAuditRequest, buildVerificationContext } from '../../src/lib/riishe/mission/verify-context'
import { verifyTaskOutput } from '../../src/lib/riishe/mission/verifiers'

const files = JSON.parse(readFileSync('/home/z/my-project/scripts/m417/website-files.json', 'utf8')) as Array<{ path: string; content: string }>
const objective = 'Build a professional website for the alpine gear studio with a products page and a contact form'

async function main() {
  const cfg = await verificationConfig()
  const ctx = buildVerificationContext({
    missionId: 'diagnostic',
    taskId: 'build',
    taskKind: 'code-build',
    criteria: { requireSelfVerification: true, minFileChanges: 1, deliverableKind: 'website', requiredPaths: ['index.html'] },
    sources: [],
  })
  const audit = buildDeliverableAuditInput(files, ctx)
  // Deterministic pre-checks exactly as the worker computes them.
  const { auditPreview } = await import('../../src/lib/code/preview-audit')
  const preview = auditPreview(files)
  const precheck = {
    factLines: [
      `Extracted file inventory: ${files.map((f) => `${f.path} (${f.content.length} chars)`).join(', ')}.`,
      `Static-site audit: ${preview.htmlFiles.length} HTML file(s); entry: ${preview.entry}; broken internal links: ${preview.brokenInternalLinks.length}; missing assets: ${preview.missingAssets.length}.`,
      `Required entry "index.html" EXISTS with ${files.find((f) => f.path === 'index.html')?.content.length ?? 0} characters of content.`,
    ],
  }
  const request = buildMissionAuditRequest(objective, ctx, precheck)
  console.log('--- deterministic website verifier on the persisted files ---')
  const det = verifyTaskOutput('code-build', ctx as never, {
    projectId: 'diagnostic',
    changes: files.map((f) => ({ path: f.path, change: 'created' })),
    verification: { status: 'verified', attempts: 1, corrections: 0, issuesFound: 0 },
  }, { persisted: { projectId: 'diagnostic', manifest: files.map((f) => ({ path: f.path, chars: f.content.length })), deliverableContent: null, contents: files } })
  console.log(det.status, '|', det.reasons.join(' ').slice(0, 300))
  console.log('--- hosted mission-aware audit (REAL gateway call) ---')
  console.log('audit input chars:', audit.text.length)
  const plan = await planGatewayChat({
    model: cfg.verificationModel,
    messages: [{ role: 'user', content: buildVerifierUserTurn(request, audit.text, cfg.maxInputChars, null) }],
    system: VERIFIER_SYSTEM_PROMPT,
    temperature: 0.2,
    timeoutMs: cfg.timeoutMs,
  })
  const result = await executeGatewayChat(plan, { userId: null, apiKeyId: null, authKind: 'internal', endpoint: 'm41.7-website-audit-probe' })
  const report = parseVerifierReport(result.content)
  console.log('verdict:', report?.verdict, 'confidence:', report?.confidence)
  for (const i of report?.issues ?? []) {
    console.log(`- [${i.severity}/${i.type}] ${i.description.slice(0, 220)}`)
    console.log(`  correction: ${i.correction.slice(0, 160)}`)
  }
}
void main()
