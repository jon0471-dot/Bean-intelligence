/**
 * M41 diagnostics: run the REAL verifier prompt over a mission-shaped
 * document draft via the REAL gateway (planGatewayChat + executeGatewayChat,
 * authKind 'internal') and print the issue descriptions. No mock — the same
 * hosted verifier the coding worker uses.
 */
import { parseVerifierReport } from '../../src/lib/verification/pipeline'
import { buildVerifierUserTurn } from '../../src/lib/verification/prompts'
import { VERIFIER_SYSTEM_PROMPT } from '../../src/lib/verification/prompts'
import { verificationConfig } from '../../src/lib/verification/config'
import { planGatewayChat, executeGatewayChat } from '../../src/lib/ai-gateway/gateway'

const originalRequest = `Write the requested document as report.md in a new engineering project. Ground every factual claim in the research sources handed to you below; include a "Sources" section listing every source you used with its URL. Structure the document professionally (title, sections, conclusion). Do not invent facts that the sources do not support; mark uncertainty explicitly. Request: Research the current state of electric vehicle charging infrastructure and write a report on it.

VERIFIED RESEARCH SOURCES (use only these for factual claims; cite each as [n] with its URL in a Sources section):
[1] IEA Global EV Outlook 2025 — https://www.iea.org/reports/global-ev-outlook-2025
[2] BloombergNEF Electric Vehicle Outlook — https://about.bnef.com/electric-vehicle-outlook/
[3] Alternative Fuels Data Center: Electric Vehicle Charging — https://afdc.energy.gov/fuels/electricity-charging`

const draft = `# Electric Vehicle Charging Infrastructure: Current State and Outlook

## Introduction
Electric vehicle (EV) adoption is accelerating globally. This report examines the current state of EV charging infrastructure: charging levels, deployment trends and costs, based on the research below.

## Charging Levels
1. **Level 1** (120 V AC): 3-5 miles of range per hour; typical for overnight home charging [3].
2. **Level 2** (240 V AC): the most common public and workplace option, roughly 10-25 miles of range per hour [3].
3. **DC fast charging**: an 80% charge in 20-60 minutes depending on the vehicle and power level [1].

## Deployment Trends
Public charging points grew strongly through 2024, with China hosting the majority of installations; Europe and North America follow [1]. Investment has shifted toward high-power corridors and megawatt charging for heavy trucks [2].

## Costs
Home Level 2 hardware installs typically cost 500-2,000 USD before installation; public DC fast-charging sites cost substantially more, driven by grid connection and power electronics [2].

## Conclusion
Charging infrastructure is scaling quickly but remains uneven across regions; continued grid investment and standardization dominate the outlook.

## Sources
[1] IEA Global EV Outlook 2025 — https://www.iea.org/reports/global-ev-outlook-2025
[2] BloombergNEF Electric Vehicle Outlook — https://about.bnef.com/electric-vehicle-outlook/
[3] Alternative Fuels Data Center: Electric Vehicle Charging — https://afdc.energy.gov/fuels/electricity-charging
`

async function main() {
  const config = await verificationConfig()
  console.log('config:', JSON.stringify({ enabled: config.enabled, model: config.verificationModel, minConfidence: config.minConfidence, maxInputChars: config.maxInputChars }))
  const plan = await planGatewayChat({
    model: config.verificationModel,
    messages: [{ role: 'user', content: buildVerifierUserTurn(originalRequest, draft, config.maxInputChars, null) }],
    system: VERIFIER_SYSTEM_PROMPT,
    temperature: 0.2,
    timeoutMs: config.timeoutMs,
  })
  const result = await executeGatewayChat(plan, { userId: null, apiKeyId: null, authKind: 'internal', endpoint: 'm41-verify-probe' })
  const report = parseVerifierReport(result.content)
  console.log('verdict:', report?.verdict, 'confidence:', report?.confidence)
  console.log('issues:')
  for (const i of report?.issues ?? []) {
    console.log(`- [${i.severity}/${i.type}] ${i.description}\n  correction: ${i.correction}`)
  }
}
void main()
