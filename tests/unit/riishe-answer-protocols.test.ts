/**
 * BEAN Intelligence — RIISHE 30-question evaluation answer-protocol pins.
 * Run: bun test tests/unit/riishe-answer-protocols.test.ts
 *
 * Pins the GENERAL protocol additions for the measured 30-question manual
 * eval (2026-11-02 work order) — none of these tests hardcode an eval
 * answer; they pin that the correct RULE is present in the system prompt a
 * real turn would produce, and in the extraction/blocks the model sees:
 *  - Q3  mechanism-per-setting (atmospheric scattering vs interstellar dust);
 *  - Q4  material-behavior classes (shear-thickening/thinning/viscoelastic/
 *        yield-stress) and behavior != state;
 *  - Q16 JS coercion tracing (ToPrimitive -> String -> Number in order);
 *  - Q19 built-in data-structure guarantees (dynamic arrays, Map order);
 *  - Q21 product role boundaries (JAZMII video/audio/voice, LAXII image-only);
 *  - Q25 correlation != causation;
 *  - Q27 PDF page accounting in the extraction note + document block, and
 *        the document protocol's extraction-honesty rules;
 *  - Q29 software version line distinction (LTS vs Current vs prerelease);
 *  - Q30 implementation-status ladder + payment-integration correctness;
 *  - 2C  exact output requirements + conflicting user information.
 * All pure — no network.
 */
import { describe, test, expect } from 'bun:test'
import { buildSystemPrompt } from '../../src/lib/riishe/prompts'
import { APPLICATION_IDENTITY, buildIdentityProtocol, renderIdentityBlock } from '../../src/lib/riishe/identity'
import { extractPdf } from '../../src/lib/files/extract'

function generalPrompt() {
  return buildSystemPrompt({ evidenceBlock: null, task: 'general', staleness: null })
}

function codingPrompt() {
  return buildSystemPrompt({ evidenceBlock: null, task: 'coding', staleness: null })
}

describe('Q3 — mechanism-per-setting attribution (astronomy)', () => {
  test('the base protocol attributes scattering vs dust to their settings', () => {
    const p = generalPrompt()
    expect(p).toContain('Attribute each mechanism to its actual setting')
    expect(p).toContain("EARTH'S ATMOSPHERE")
    expect(p).toContain('interstellar')
    expect(p).toContain('Name which mechanism applies where the question places the phenomenon')
  })
})

describe('Q4 — material-behavior classes are distinguished', () => {
  test('the base protocol names the behavior classes and forbids state confusion', () => {
    const p = generalPrompt()
    expect(p).toContain('shear-thickening')
    expect(p).toContain('shear-thinning')
    expect(p).toContain('viscoelasticity')
    expect(p).toContain('yield-stress')
    expect(p).toContain('a behavior class is never a change of physical state')
    expect(p).toContain('one class must not be substituted for another')
  })
})

describe('Q16 — JS coercion is traced through the actual conversion steps', () => {
  test('the coding protocol requires ordered ToPrimitive/ToString/ToNumber tracing', () => {
    const p = codingPrompt()
    expect(p).toContain('ToPrimitive first, then ToString/ToNumber')
    expect(p).toContain('naming each intermediate value')
    expect(p).toContain('never assert a result from intuition')
  })
})

describe('Q19 — built-in data-structure guarantees are stated exactly', () => {
  test('the coding protocol pins dynamic arrays and Map insertion order', () => {
    const p = codingPrompt()
    expect(p).toContain('dynamic, length-indexed collections')
    expect(p).toContain('fixed-size low-level arrays')
    expect(p).toContain('Map preserves insertion order')
    expect(p).toContain('Never present a built-in as identical to a low-level structure')
  })
})

describe('Q21 — product role boundaries are exhaustive and separate', () => {
  test('the shipped identity assigns video/audio/voice to JAZMII and images only to LAXII', () => {
    const block = renderIdentityBlock()
    expect(block).toContain('general-purpose conversational AI')
    expect(block).toContain('LAXII is the image AI')
    expect(block).toContain('images ONLY')
    expect(block).toContain('JAZMII is the video, audio and voice AI')
    expect(block).toContain('never to LAXII')
    expect(block).toContain('CODE GIFTZ is the coding AI')
  })

  test('the role-boundary rule forbids cross-assignment in every prompt', () => {
    const p = generalPrompt()
    expect(p).toContain('PRODUCT ROLE BOUNDARIES')
    expect(p).toContain('never assign one product\'s responsibilities to another')
  })

  test('every fact in the profile carries a verification basis', () => {
    const facts = [APPLICATION_IDENTITY.application, APPLICATION_IDENTITY.assistant, ...APPLICATION_IDENTITY.products]
    for (const fact of facts) {
      expect(fact.basis.length).toBeGreaterThan(0)
      expect(fact.statement.length).toBeGreaterThan(0)
    }
  })
})

describe('Q25 — correlation is never presented as causation', () => {
  test('the base protocol requires confounders before any causal claim', () => {
    const p = generalPrompt()
    expect(p).toContain('Correlation is not causation')
    expect(p).toContain('confounders or alternative explanations')
    expect(p).toContain('a causal claim needs controlled or experimental evidence')
  })
})

describe('2C — exact output requirements and conflicting user info', () => {
  test('the base protocol requires exact counts/formats/components', () => {
    const p = generalPrompt()
    expect(p).toContain('Follow the user\'s EXPLICIT output requirements exactly')
    expect(p).toContain('count what you produce and match it')
  })
  test('the base protocol forbids silently picking one side of a user-info conflict', () => {
    const p = generalPrompt()
    expect(p).toContain('CONFLICT with each other')
    expect(p).toContain('do not silently pick one and do not merge them')
  })
})

describe('Q29 — software version lines are distinguished', () => {
  test('the citation protocol requires LTS/Current/prerelease separation with release dates', () => {
    const p = buildSystemPrompt({
      evidenceBlock: 'RETRIEVED EVIDENCE (numbered; cite as [n])\n[1] Example',
      task: 'research',
      staleness: null,
    })
    expect(p).toContain('LTS vs Current vs prerelease')
    expect(p).toContain('the latest of that kind comes from the HIGHEST version line')
    expect(p).toContain('never present a prerelease (alpha/beta/canary) as the stable latest')
    expect(p).toContain('never merge numbers from different lines into one claim')
  })
  test('latest-developments questions must lead with the newest dated official items', () => {
    const p = buildSystemPrompt({
      evidenceBlock: 'RETRIEVED EVIDENCE (numbered; cite as [n])\n[1] Example',
      task: 'research',
      staleness: null,
    })
    expect(p).toContain('lead with the NEWEST dated official announcements')
    expect(p).toContain('never mix items from different years')
  })
})

describe('Q30 — implementation honesty ladder and project planning', () => {
  test('the coding protocol pins the exact five-rung status ladder', () => {
    const p = codingPrompt()
    expect(p).toContain('Proposed (not implemented)')
    expect(p).toContain('Implemented (code exists)')
    expect(p).toContain('Tested (tests actually ran and passed)')
    expect(p).toContain('Verified (behaviour confirmed in the target environment)')
    expect(p).toContain('Deployed (production confirmed)')
    expect(p).toContain('never claim a rung the conversation\'s evidence does not show')
  })
  test('the coding protocol requires requirement gathering and payment-integration correctness', () => {
    const p = codingPrompt()
    expect(p).toContain('gather the requirements and inspect existing constraints')
    expect(p).toContain('webhook signature verification')
    expect(p).toContain('idempotency')
    expect(p).toContain('duplicate-transaction handling')
    expect(p).toContain('reconciliation')
  })
})

describe('Q27 — PDF extraction completeness', () => {
  test('a real PDF note reports the page accounting honestly', async () => {
    // Minimal valid one-page PDF with a text layer.
    const pdf = Buffer.from(
      `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 58 >> stream
BT /F1 18 Tf 72 720 Td (Q27 page accounting check) Tj ET
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
trailer << /Root 1 0 R /Size 6 >>
%%EOF`,
      'utf8',
    )
    const out = await extractPdf(pdf)
    expect(out.text).toContain('Q27 page accounting check')
    expect(out.truncated).toBe(false)
    expect(out.note).toContain('text layer extracted')
    expect(out.note).toContain('1 of 1 page had extractable text')
    expect(out.note).toContain('embedded images, charts and scan-only content are not analyzed')
  }, 20_000)

  test('the document protocol carries extraction honesty into answers', () => {
    const p = buildSystemPrompt({ evidenceBlock: null, task: 'document', staleness: null })
    expect(p).toContain('Extraction honesty')
    expect(p).toContain('embedded images, charts and scan-only pages were not analyzed')
    expect(p).toContain('keep their headers, units and footnotes attached')
    expect(p).toContain('Verify important numerical claims against the extracted text')
  })
})

describe('2D — image analysis protocol rides with image attachments', () => {
  test('no image protocol without images', () => {
    const p = buildSystemPrompt({ evidenceBlock: null, task: 'document', staleness: null })
    expect(p).not.toContain('Image analysis protocol')
  })
  test('image attachments get observations-vs-interpretations + math-transcription rules', () => {
    const p = buildSystemPrompt({
      evidenceBlock: null,
      task: 'document',
      staleness: null,
      hasImages: true,
    })
    expect(p).toContain('Image analysis protocol')
    expect(p).toContain('DIRECT OBSERVATIONS')
    expect(p).toContain('Do not invent details that are not visible in the image')
    expect(p).toContain('no invented damage, defects, specifications, causes')
    expect(p).toContain('transcribe the equations/labels first')
    expect(p).toContain('flag any symbol you cannot read clearly')
    expect(p).toContain('verify the final answer against the transcription')
  })
})

describe('identity protocol still intact after the role-boundary addition', () => {
  test('provenance + people protocols are present exactly once on every task', () => {
    for (const task of ['general', 'math', 'coding', 'research', 'document'] as const) {
      const p = buildSystemPrompt({ evidenceBlock: null, task, staleness: null })
      expect(p).toContain('INFORMATION PROVENANCE')
      expect(p).toContain('PEOPLE GROUNDING PROTOCOL')
      expect(p.match(/APPLICATION IDENTITY \(verified application configuration/g)?.length).toBe(1)
    }
  })
  test('the full protocol block is assembled once by buildIdentityProtocol', () => {
    const block = buildIdentityProtocol()
    expect(block).toContain('PRODUCT ROLE BOUNDARIES')
    expect(block).toContain('verifies NO facts about any specific person')
  })
})

// ---- search-policy false positive (measured 2026-11-02): English "actually"
// matched the Spanish recency signal and triggered a wasted search on an
// ordinary explanation — extra latency and extra gateway calls (429 pressure).

import { shouldSearch } from '../../src/lib/research/policy'

describe('search policy — no false positive on English "actually"', () => {
  test('ordinary explanations with "actually" do not search', () => {
    expect(shouldSearch('How does a quantum computer actually differ from a classical computer? Explain superposition accurately.').search).toBe(false)
    expect(shouldSearch('What does this function actually return?').search).toBe(false)
  })
  test('real Spanish recency intent still searches', () => {
    expect(shouldSearch('¿Cuál es la versión actual de Python?').search).toBe(true)
    expect(shouldSearch('¿Cuáles son las noticias de hoy sobre la NASA?').search).toBe(true)
  })
})
