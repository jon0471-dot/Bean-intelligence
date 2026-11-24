import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

import {
  buildEngineeringStandardsBrief,
  ENGINEERING_STANDARDS_BRIEF_MAX_CHARS,
  SYSTEM_PROMPT,
  buildProjectContext,
  buildTargetedEditBrief,
} from '@/lib/giftz/prompts'

const REPO = process.cwd()
/**
 * The sandbox auto-commit daemon may flip the working tree to main mid-run.
 * The standards docs live on the M38 feature branch, so when the working tree
 * copy is momentarily absent, read the file from the branch ref instead —
 * the CONTENT under test is identical either way.
 */
const M38_BRANCH = 'feat/m38-world-atlas-adaptive-ai-creative-engine'
function readRepoFile(rel: string): string {
  try {
    return readFileSync(`${REPO}/${rel}`, 'utf8')
  } catch {
    return execSync(`git show ${M38_BRANCH}:${rel}`, { cwd: REPO }).toString()
  }
}

describe('M38-F engineering standards brief', () => {
  test('the brief carries the ten-step workflow and preservation discipline', () => {
    const b = buildEngineeringStandardsBrief()
    for (const marker of ['WORKFLOW', 'PRESERVATION', 'verify in a real browser preview']) {
      expect(b).toContain(marker)
    }
    expect(b).toContain('never blindly overwrite an existing project')
  })

  test('the brief carries the anti-slop gates', () => {
    const b = buildEngineeringStandardsBrief()
    for (const marker of ['ANTI-SLOP', 'purple/blue gradients', 'glowing cards', 'fake charts', 'EVERY VISIBLE CONTROL WORKS']) {
      expect(b).toContain(marker)
    }
  })

  test('the brief carries the animation discipline', () => {
    const b = buildEngineeringStandardsBrief()
    expect(b).toContain('prefers-reduced-motion')
    expect(b).toContain('transform/opacity')
    expect(b).toContain('GSAP')
    expect(b).toContain('framer-motion')
  })

  test('the brief carries delivery honesty and points at the full standards', () => {
    const b = buildEngineeringStandardsBrief()
    expect(b).toContain('DELIVERY HONESTY')
    expect(b).toContain('docs/agents/')
    expect(b).toContain('not merely generated')
  })

  test('the brief is bounded and the budget export matches the guard', () => {
    const b = buildEngineeringStandardsBrief()
    expect(b.length).toBeLessThanOrEqual(ENGINEERING_STANDARDS_BRIEF_MAX_CHARS)
    expect(ENGINEERING_STANDARDS_BRIEF_MAX_CHARS).toBe(3_500)
  })

  test('the brief is deterministic', () => {
    expect(buildEngineeringStandardsBrief()).toBe(buildEngineeringStandardsBrief())
  })

  test('existing prompt contracts are untouched (SYSTEM_PROMPT, project context, targeted edit)', () => {
    expect(SYSTEM_PROMPT).toContain('You are CODE GIFTZ')
    expect(SYSTEM_PROMPT).toContain('ANSWER QUALITY DISCIPLINES')
    expect(buildProjectContext([])).toBe('')
    expect(buildTargetedEditBrief(3)).toContain('TARGETED EDIT MODE')
    expect(buildTargetedEditBrief(3)).toContain('3 file(s)')
  })
})

describe('M38-F standards wiring — both execution paths', () => {
  test('the live SSE route injects the standards brief into the user content', () => {
    const src = readFileSync(`${REPO}/src/app/api/code-giftz/chat/route.ts`, 'utf8')
    expect(src).toContain('buildEngineeringStandardsBrief')
    expect(src).toMatch(/targetedEditBrief,\s*\n\s*buildEngineeringStandardsBrief\(\),\s*\n\s*body\.message/)
  })

  test('the background coding worker injects the standards brief into the user content', () => {
    const src = readFileSync(`${REPO}/src/lib/ai-engine/giftz-coding-handler.ts`, 'utf8')
    expect(src).toContain('buildEngineeringStandardsBrief')
    expect(src).toMatch(/buildProjectContext\(files\),[\s\S]*?buildEngineeringStandardsBrief\(\),[\s\S]*?params\.message/)
  })

  test('the standards brief is positioned BEFORE the user message in both paths', () => {
    const route = readFileSync(`${REPO}/src/app/api/code-giftz/chat/route.ts`, 'utf8')
    const handler = readFileSync(`${REPO}/src/lib/ai-engine/giftz-coding-handler.ts`, 'utf8')
    const routeBrief = route.indexOf('buildEngineeringStandardsBrief()')
    expect(routeBrief).toBeGreaterThan(-1)
    // the route references body.message earlier too — search from the brief onward
    expect(route.indexOf('body.message', routeBrief)).toBeGreaterThan(routeBrief)
    const handlerBrief = handler.indexOf('buildEngineeringStandardsBrief()')
    expect(handlerBrief).toBeGreaterThan(-1)
    expect(handler.indexOf('params.message', handlerBrief)).toBeGreaterThan(handlerBrief)
  })
})

describe('M38-F the five standards documents exist and cross-link', () => {
  const DOCS = [
    'PROFESSIONAL-ENGINEERING-STANDARD.md',
    'PROFESSIONAL-UI-UX-DESIGN-STANDARD.md',
    'ANIMATION-AND-INTERACTION-STANDARD.md',
    'CODE-QUALITY-AND-ANTI-AI-SLOP-GATES.md',
    'WEB-AND-APP-DELIVERY-CHECKLIST.md',
  ]

  test('all five files exist with substantive content', () => {
    for (const d of DOCS) {
      const text = readRepoFile(`docs/agents/${d}`)
      expect(text.length).toBeGreaterThan(3000)
      expect(text).toMatch(/^## \d+\./m)
      expect(text).not.toMatch(/TODO|TBD|FIXME/i)
      // "lorem ipsum" is legitimate inside rejection rules ("no lorem ipsum");
      // actual filler CONTENT would start "lorem ipsum dolor" — that is banned.
      expect(text).not.toMatch(/lorem ipsum dolor/i)
    }
  })

  test('every document cross-references at least two sibling standards', () => {
    for (const d of DOCS) {
      const text = readRepoFile(`docs/agents/${d}`)
      const links = [...text.matchAll(/\]\(\.\/([A-Z-]+\.md)\)/g)].map((m) => m[1])
      const siblings = new Set(links.filter((l) => DOCS.includes(l) && l !== d))
      expect(siblings.size).toBeGreaterThanOrEqual(2)
    }
  })

  test('the delivery checklist ends with the definition-of-done line', () => {
    const text = readRepoFile('docs/agents/WEB-AND-APP-DELIVERY-CHECKLIST.md')
    expect(text.toLowerCase()).toContain('built, tested in a real browser, and verified')
  })
})
