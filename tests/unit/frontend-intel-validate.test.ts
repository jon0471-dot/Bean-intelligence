/**
 * BEAN Intelligence — Frontend Intelligence Toolkit: deterministic generation
 * checks (Phase 5 — every defect class the work order names, caught).
 */
import { describe, test, expect } from 'bun:test'
import { validateFrontendOutput, type FrontendOutputFile } from '../../src/lib/frontend-intel/validate'
import type { FrontendPlan } from '../../src/lib/frontend-intel/types'

/** Minimal enabled plan fixture (fields the validator consumes). */
function planFixture(overrides: Partial<FrontendPlan> = {}): FrontendPlan {
  return {
    enabled: true,
    target: 'static',
    reason: 'test',
    componentIds: [],
    animationIds: ['entrance-timeline'],
    vantaEffect: null,
    responsive: true,
    brief: '',
    engineFiles: [],
    summary: {
      enabled: true,
      target: 'static',
      reason: 'test',
      components: [],
      animations: ['entrance-timeline'],
      background: null,
      responsive: true,
      engineFiles: [],
      dependencies: [],
      notices: '',
    },
    ...overrides,
  }
}

const GOOD_STATIC_HTML =
  '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<script src="vendor/gsap.min.js"></script></head><body><h1 data-animate>Hi</h1>' +
  '<script src="app.js"></script></body></html>'
const GOOD_STATIC_CSS = '@media (max-width: 640px) { h1 { font-size: 1.5rem } }'
const GOOD_STATIC_JS =
  "var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; if (!reduceMotion) { gsap.from('[data-animate]', {opacity: 0, y: 20}) }"

describe('static-target generation checks', () => {
  test('a correct static output passes with zero issues', () => {
    const report = validateFrontendOutput(
      [
        { path: 'index.html', content: GOOD_STATIC_HTML },
        { path: 'styles.css', content: GOOD_STATIC_CSS },
        { path: 'app.js', content: GOOD_STATIC_JS },
      ],
      planFixture(),
    )
    expect(report.passed).toBe(true)
    expect(report.blocking).toBe(0)
    expect(report.warnings).toBe(0)
  })

  test('missing vendor script tag → blocking (animations would ReferenceError in the preview)', () => {
    const report = validateFrontendOutput(
      [
        { path: 'index.html', content: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><h1>Hi</h1><script src="app.js"></script></body></html>' },
        { path: 'app.js', content: GOOD_STATIC_JS },
      ],
      planFixture(),
    )
    expect(report.passed).toBe(false)
    expect(report.issues.some((i) => i.id === 'vendor-script-tags' && i.severity === 'blocking')).toBe(true)
  })

  test('remote CDN script/link → blocking (no remote injection; the preview CSP blocks it too)', () => {
    const report = validateFrontendOutput(
      [
        {
          path: 'index.html',
          content:
            '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><script src="https://cdn.example.com/gsap.min.js"></script><link href="https://fonts.example.com/x.css" rel="stylesheet"></head><body></body></html>',
        },
      ],
      planFixture({ animationIds: [] }),
    )
    expect(report.issues.some((i) => i.id === 'no-remote-resources' && i.severity === 'blocking')).toBe(true)
  })

  test('Vanta without destroy() or WebGL fallback → blocking', () => {
    const report = validateFrontendOutput(
      [
        {
          path: 'index.html',
          content:
            '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><script src="vendor/three.min.js"></script><script src="vendor/vanta.birds.min.js"></script></head><body><div id="vanta-bg"></div><script src="app.js"></script></body></html>',
        },
        { path: 'app.js', content: "window.__beanVanta = VANTA.BIRDS({ el: document.getElementById('vanta-bg'), THREE: window.THREE })" },
      ],
      planFixture({ animationIds: [], vantaEffect: 'birds' }),
    )
    expect(report.issues.some((i) => i.id === 'vanta-fallback' && i.severity === 'blocking')).toBe(true)
  })

  test('missing viewport meta → blocking; missing media queries → warning', () => {
    const report = validateFrontendOutput(
      [
        {
          path: 'index.html',
          content: '<!doctype html><html><head></head><body></body></html>',
        },
        { path: 'styles.css', content: 'body { margin: 0 }' },
      ],
      planFixture({ animationIds: [] }),
    )
    expect(report.issues.some((i) => i.id === 'responsive' && i.severity === 'blocking')).toBe(true)
    expect(report.issues.some((i) => i.id === 'responsive' && i.severity === 'warning')).toBe(true)
  })

  test('GSAP without a reduced-motion guard → warning (pattern fix suggested)', () => {
    const report = validateFrontendOutput(
      [
        {
          path: 'index.html',
          content: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><script src="vendor/gsap.min.js"></script></head><body></body></html>',
        },
        { path: 'app.js', content: "gsap.from('.x', { opacity: 0 })" },
      ],
      planFixture(),
    )
    expect(report.issues.some((i) => i.id === 'reduced-motion' && i.severity === 'warning')).toBe(true)
  })

  test('grossly unbalanced syntax → warning screening (honest, not a fake parse claim)', () => {
    const report = validateFrontendOutput(
      [
        {
          path: 'index.html',
          content:
            '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><script src="vendor/gsap.min.js"></script></head><body></body></html>',
        },
        { path: 'app.js', content: GOOD_STATIC_JS + '\nfunction broken() { if (x) { gsap.to(y, { opacity: 0 ' },
      ],
      planFixture(),
    )
    expect(report.issues.some((i) => i.id === 'syntax-screen' && i.severity === 'warning')).toBe(true)
  })

  test('engine-managed vendor bytes are never flagged by the syntax screen', () => {
    const report = validateFrontendOutput(
      [
        { path: 'index.html', content: GOOD_STATIC_HTML },
        { path: 'styles.css', content: GOOD_STATIC_CSS },
        { path: 'app.js', content: GOOD_STATIC_JS },
        // A vendor file whose minified content contains unbalanced-looking delimiters.
        { path: 'vendor/gsap.min.js', content: 'function (a{b[((' },
      ],
      planFixture(),
    )
    expect(report.issues.some((i) => i.id === 'syntax-screen')).toBe(false)
  })
})

describe('react-target generation checks', () => {
  const reactPlan = planFixture({ target: 'react', animationIds: ['entrance-timeline'] })

  const goodPkg = JSON.stringify({
    name: 'giftz-frontend-app',
    private: true,
    dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0', gsap: '3.13.0', '@gsap/react': '2.1.2' },
  })

  const goodApp = {
    path: 'App.jsx',
    content:
      "import { useRef } from 'react'\nimport { useGSAP } from '@gsap/react'\nimport { gsap } from 'gsap'\nimport SplitText from './components/kit/SplitText'\n" +
      "export default function App() { const root = useRef(null); useGSAP(() => { if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return; gsap.from('[data-animate]', {opacity:0}) }, { scope: root }); return <div ref={root}><SplitText text=\"Hi\" /></div> }",
  }

  test('a correct React output passes', () => {
    const report = validateFrontendOutput(
      [
        { path: 'package.json', content: goodPkg },
        { path: 'components/kit/SplitText.tsx', content: 'export default function SplitText() { return null }' },
        goodApp,
      ],
      reactPlan,
    )
    expect(report.passed).toBe(true)
    expect(report.blocking).toBe(0)
  })

  test('importing a kit component that was never emitted → blocking invalid-component-name', () => {
    const report = validateFrontendOutput(
      [
        { path: 'package.json', content: goodPkg },
        { ...goodApp, content: goodApp.content.replace('./components/kit/SplitText', './components/kit/Lanyard') },
      ],
      reactPlan,
    )
    expect(report.issues.some((i) => i.id === 'invalid-component-name' && i.severity === 'blocking')).toBe(true)
  })

  // M21 finding F-2 / repair R-C1: the kit-import check must also match
  // PARENT-relative specifiers ('../components/kit/…'), which real multi-page
  // apps (pages/*.tsx) produce — a ghost import via '../' must stay blocking,
  // and a real emitted component referenced via '../' must stay accepted.
  test('parent-relative kit imports are checked the same as ./ ones (R-C1)', () => {
    const emitted = { path: 'components/kit/SplitText.tsx', content: 'export default function SplitText() { return null }' }
    // ghost import through '../' → still blocking
    const ghost = validateFrontendOutput(
      [
        { path: 'package.json', content: goodPkg },
        emitted,
        { ...goodApp, path: 'pages/home.jsx', content: goodApp.content.replace("'./components/kit/SplitText'", "'../components/kit/Lanyard'") },
      ],
      reactPlan,
    )
    expect(ghost.issues.some((i) => i.id === 'invalid-component-name' && i.severity === 'blocking')).toBe(true)
    // real component through '../' → accepted
    const ok = validateFrontendOutput(
      [
        { path: 'package.json', content: goodPkg },
        emitted,
        { ...goodApp, path: 'pages/home.jsx', content: goodApp.content.replace("'./components/kit/SplitText'", "'../components/kit/SplitText'") },
      ],
      reactPlan,
    )
    expect(ok.issues.some((i) => i.id === 'invalid-component-name')).toBe(false)
  })

  test('undeclared bare import → blocking missing-imports', () => {
    const report = validateFrontendOutput(
      [
        { path: 'package.json', content: goodPkg },
        { path: 'components/kit/SplitText.tsx', content: 'export default function SplitText() { return null }' },
        { ...goodApp, content: goodApp.content + "\nimport confetti from 'canvas-confetti'" },
      ],
      reactPlan,
    )
    expect(report.issues.some((i) => i.id === 'missing-imports' && i.severity === 'blocking')).toBe(true)
  })

  test('dependency version drift from the tested matrix → blocking dependency-pins', () => {
    const drifted = JSON.stringify({
      name: 'x',
      dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0', gsap: '3.12.5', '@gsap/react': '2.1.2' },
    })
    const report = validateFrontendOutput(
      [
        { path: 'package.json', content: drifted },
        { path: 'components/kit/SplitText.tsx', content: 'export default function SplitText() { return null }' },
        goodApp,
      ],
      reactPlan,
    )
    expect(report.issues.some((i) => i.id === 'dependency-pins' && i.severity === 'blocking')).toBe(true)
    expect(report.issues.find((i) => i.id === 'dependency-pins')?.message).toContain('3.12.5')
  })

  test('GSAP without useGSAP/context-revert → blocking react-cleanup (missing cleanup)', () => {
    const leaky = {
      path: 'App.jsx',
      content:
        "import { useEffect } from 'react'\nimport { gsap } from 'gsap'\nexport default function App() { useEffect(() => { gsap.from('.x', {opacity:0}) }, []); return null }",
    }
    const report = validateFrontendOutput(
      [{ path: 'package.json', content: goodPkg }, leaky],
      reactPlan,
    )
    expect(report.issues.some((i) => i.id === 'react-cleanup' && i.severity === 'blocking')).toBe(true)
  })

  test('requested Vanta background never imported → blocking vanta-not-wired', () => {
    const report = validateFrontendOutput(
      [
        {
          path: 'package.json',
          content: JSON.stringify({ dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0', vanta: '0.5.24', three: '0.134.0' } }),
        },
        { path: 'components/kit/VantaBackground.tsx', content: 'export default function VantaBackground() { return null }' },
        { path: 'App.jsx', content: 'export default function App() { return <div>hi</div> }' },
      ],
      planFixture({ target: 'react', animationIds: [], vantaEffect: 'birds' }),
    )
    expect(report.issues.some((i) => i.id === 'vanta-not-wired' && i.severity === 'blocking')).toBe(true)
  })

  test('gsap.context + revert() is accepted as manual cleanup (official alternative)', () => {
    const manual = {
      path: 'App.jsx',
      content:
        "import { useEffect, useRef } from 'react'\nimport { gsap } from 'gsap'\nexport default function App() { const root = useRef(null); useEffect(() => { const ctx = gsap.context(() => { gsap.from('.x', {opacity:0}) }, root); if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { ctx.revert() } return () => ctx.revert() }, []); return null }",
    }
    const report = validateFrontendOutput([{ path: 'package.json', content: goodPkg }, manual], reactPlan)
    expect(report.issues.some((i) => i.id === 'react-cleanup')).toBe(false)
  })
})

describe('shared checks', () => {
  test('unsafe paths are rejected with a blocking issue (defense in depth over applyFiles)', () => {
    const report = validateFrontendOutput(
      [{ path: '../escape.js', content: 'x' }],
      planFixture({ animationIds: [] }),
    )
    expect(report.issues.some((i) => i.id === 'path-isolation' && i.severity === 'blocking')).toBe(true)
  })

  test('issues are sorted blocking-first', () => {
    const report = validateFrontendOutput(
      [
        {
          path: 'index.html',
          content: '<!doctype html><html><head></head><body><script src="https://cdn.example.com/x.js"></script></body></html>',
        },
      ],
      planFixture(),
    )
    if (report.issues.length >= 2) {
      expect(report.issues[0].severity).toBe('blocking')
    }
  })
})
