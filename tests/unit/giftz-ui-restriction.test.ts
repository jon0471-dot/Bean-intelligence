/**
 * BEAN Intelligence — CODE GIFTZ internal-only frontend library (UI
 * restriction enforcement).
 *
 * The expanded frontend intelligence library is INTERNAL: the visible user
 * interface must remain free of the Frontend Toolkit controls. The user just
 * describes what they want to build; the engine resolves everything else.
 * These source-contract tests keep that restriction from regressing.
 */
import { describe, test, expect } from 'bun:test'
import { existsSync, readFileSync } from 'fs'
import path from 'path'

const ROOT = path.join(import.meta.dir, '../..')

describe('frontend library is internal-only (no UI/API selection surface)', () => {
  test('the Frontend Toolkit panel component is deleted', () => {
    expect(existsSync(path.join(ROOT, 'src/components/bean/giftz-frontend-panel.tsx'))).toBe(false)
  })

  test('the internal component catalogue API route is deleted', () => {
    expect(existsSync(path.join(ROOT, 'src/app/api/code-giftz/frontend/catalog/route.ts'))).toBe(false)
    expect(existsSync(path.join(ROOT, 'src/app/api/code-giftz/frontend'))).toBe(false)
  })

  test('the CODE GIFTZ chat UI renders no toolkit selector, catalogue, or summary strip', () => {
    const ui = readFileSync(path.join(ROOT, 'src/components/bean/code-giftz.tsx'), 'utf8')
    expect(ui.includes('GiftzFrontendPanel')).toBe(false)
    expect(ui.includes('FrontendSummary')).toBe(false)
    expect(ui.includes('giftz-frontend-panel')).toBe(false)
    expect(ui.includes('frontend/catalog')).toBe(false)
    expect(ui.includes('FrontendSelectionState')).toBe(false)
    expect(ui.includes('DEFAULT_FRONTEND_SELECTION')).toBe(false)
  })

  test('the chat API accepts no frontend selection parameter (selection lives only inside the engine)', () => {
    const route = readFileSync(path.join(ROOT, 'src/app/api/code-giftz/chat/route.ts'), 'utf8')
    expect(route.includes('body.frontend')).toBe(false)
    expect(route.match(/frontend:\s*z\./)).toBeNull()
    expect(route).toContain('no UI/API selection surface')
  })

  test('no component outside the kit imports the internal registry directly', () => {
    // The registry must be consumed ONLY by the engine + its tests — never
    // rendered as a browsable catalogue in app code.
    const appFiles = ['src/components/bean/code-giftz.tsx']
    for (const f of appFiles) {
      const src = readFileSync(path.join(ROOT, f), 'utf8')
      expect(src.includes('frontend-intel/catalog')).toBe(false)
      expect(src.includes('frontend-intel/gsap-patterns')).toBe(false)
      expect(src.includes('frontend-intel/vanta')).toBe(false)
    }
  })

  test('the internal engine remains fully wired (the capability itself is NOT removed)', () => {
    const route = readFileSync(path.join(ROOT, 'src/app/api/code-giftz/chat/route.ts'), 'utf8')
    expect(route).toContain('resolveFrontendPlan')
    expect(route).toContain('frontendPlan.enabled')
    const turn = readFileSync(path.join(ROOT, 'src/lib/giftz/turn.ts'), 'utf8')
    expect(turn).toContain('finalizeFrontendTurn')
    expect(turn).toContain('frontend.plan.engineFiles')
  })
})
