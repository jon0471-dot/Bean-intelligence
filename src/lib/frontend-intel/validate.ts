/**
 * BEAN Intelligence — deterministic generation checks for CODE GIFTZ frontend
 * output (Phase 5 of the Frontend Intelligence Toolkit work order).
 *
 * These checks run on the EXTRACTED project files after a frontend turn and
 * catch the defect classes the work order names: missing imports, invalid
 * component names, incorrect/missing animation cleanup, missing responsive
 * behavior, missing WebGL fallback, broken syntax (screening), dependency and
 * version mismatch, and remote-script injection.
 *
 * Honesty contract: checks are REPORTED, never silently "fixed"; a blocking
 * issue does not hide the generated files — the report rides to the UI so the
 * user can iterate. Vendor/kit engine files are excluded from syntax
 * screening (they are validated by the repo's own gates, not heuristics).
 */
import { assertSafeProjectPath } from '@/lib/giftz/workspace'
import { PINNED_DEPENDENCIES } from './catalog'
import type { FrontendCheck, FrontendCheckReport, FrontendPlan } from './types'

export interface FrontendOutputFile {
  path: string
  content: string
}

/** Paths the ENGINE generated (validated by repo gates, not heuristics). */
function isEngineManaged(path: string): boolean {
  return (
    path.startsWith('vendor/') ||
    path.startsWith('components/kit/') ||
    path.startsWith('types/') ||
    path === 'package.json' ||
    path === 'NOTICES.md'
  )
}

function htmlFiles(files: FrontendOutputFile[]): FrontendOutputFile[] {
  return files.filter((f) => f.path.endsWith('.html'))
}

function cssFiles(files: FrontendOutputFile[]): FrontendOutputFile[] {
  return files.filter((f) => f.path.endsWith('.css'))
}

function scriptFiles(files: FrontendOutputFile[]): FrontendOutputFile[] {
  return files.filter((f) => /\.(js|jsx|ts|tsx)$/.test(f.path) && !isEngineManaged(f.path))
}

const RUNTIME_BUILTINS = new Set(['react', 'react-dom', 'react/jsx-runtime'])

/** Bare-package imports (`from 'x'` / `import 'x'`) of model-generated files. */
export function bareImports(files: FrontendOutputFile[]): Set<string> {
  const found = new Set<string>()
  for (const f of files) {
    const patterns = [/from\s+['"]([^.'"][^'"]*)['"]/g, /import\s+['"]([^.'"][^'"]*)['"]/g]
    for (const re of patterns) {
      let m: RegExpExecArray | null
      while ((m = re.exec(f.content)) !== null) {
        const spec = m[1]
        if (spec && !spec.startsWith('.') && !spec.startsWith('/')) found.add(spec)
      }
    }
  }
  return found
}

/**
 * Validate one frontend generation. Never throws; returns the honest report.
 */
export function validateFrontendOutput(files: FrontendOutputFile[], plan: FrontendPlan): FrontendCheckReport {
  const issues: FrontendCheck[] = []
  const add = (id: string, severity: 'blocking' | 'warning', message: string) => issues.push({ id, severity, message })

  // ---- path isolation (defense in depth; applyFiles also asserts) --------
  for (const f of files) {
    try {
      assertSafeProjectPath(f.path)
    } catch (e) {
      add('path-isolation', 'blocking', `Unsafe project file path rejected: ${f.path} (${(e as Error).message})`)
    }
  }

  const html = htmlFiles(files)
  const css = cssFiles(files)
  const scripts = scriptFiles(files)
  const allText = files.filter((f) => !isEngineManaged(f.path)).map((f) => f.content).join('\n')
  const htmlText = html.map((f) => f.content).join('\n')

  // ---- remote resource injection (both targets; the preview CSP would break it too)
  const remoteScript = /<script[^>]+src=["']https?:\/\//i.test(htmlText)
  const remoteLink = /<link[^>]+href=["']https?:\/\//i.test(htmlText)
  const remoteImport = /@import\s+url\(["']?https?:/i.test(css.map((f) => f.content).join('\n'))
  if (remoteScript || remoteLink || remoteImport) {
    add(
      'no-remote-resources',
      'blocking',
      'Generated markup references a remote (http(s)) script/stylesheet. Remote injection is not allowed: use the vendored files in vendor/ (they are inlined by the isolated preview).',
    )
  }

  if (plan.target === 'static') {
    // ---- vendor script tags for the runtimes the plan promises ----------
    const needsGsap = plan.animationIds.length > 0
    const needsScrollTrigger = plan.animationIds.some((id) => id === 'scroll-reveal-batch' || id === 'svg-draw')
    if (needsGsap && html.length > 0 && !htmlText.includes('vendor/gsap.min.js')) {
      add('vendor-script-tags', 'blocking', 'GSAP animations are planned but index.html never loads <script src="vendor/gsap.min.js"> — the animation code would throw ReferenceError in the preview.')
    }
    if (needsScrollTrigger && html.length > 0 && !htmlText.includes('vendor/ScrollTrigger.min.js')) {
      add('vendor-script-tags', 'blocking', 'ScrollTrigger-based patterns are planned but index.html never loads <script src="vendor/ScrollTrigger.min.js"> before app.js.')
    }
    if (plan.vantaEffect) {
      if (html.length > 0 && !htmlText.includes(`vendor/vanta.${plan.vantaEffect}.min.js`)) {
        add('vendor-script-tags', 'blocking', `The ${plan.vantaEffect} background is planned but index.html never loads <script src="vendor/vanta.${plan.vantaEffect}.min.js"> and vendor/three.min.js before app.js.`)
      }
      // ---- vanta fallback + cleanup markers ----------------------------
      const hasDestroy = /\.destroy\(/.test(allText)
      const hasFallback = /vanta-fallback|WebGLRenderingContext/.test(allText)
      if (!hasDestroy || !hasFallback) {
        add('vanta-fallback', 'blocking', 'The Vanta background is planned but the generated code is missing the WebGL fallback or the destroy() cleanup required by the background contract.')
      }
    }
    // ---- reduced-motion guard ------------------------------------------
    if (plan.animationIds.length > 0 && /gsap\./.test(allText) && !allText.includes('prefers-reduced-motion')) {
      add('reduced-motion', 'warning', 'GSAP animation code found without a prefers-reduced-motion guard — add the guarded pattern from the brief.')
    }
    if (plan.vantaEffect && !allText.includes('prefers-reduced-motion')) {
      add('reduced-motion', 'warning', 'The Vanta background init is missing its prefers-reduced-motion guard.')
    }
    // ---- static ScrollTrigger hygiene -----------------------------------
    if (/ScrollTrigger/.test(allText) && !/once:\s*true|\.kill\(/.test(allText)) {
      add('scrolltrigger-cleanup', 'warning', 'ScrollTrigger usage without `once: true` or an explicit kill() — repeated triggers can accumulate.')
    }
    // ---- responsive markers ---------------------------------------------
    if (plan.responsive) {
      const hasViewport = /<meta[^>]+name=["']viewport["'][^>]+content=["'][^"']*width=device-width/i.test(htmlText)
      const hasMediaQuery = css.some((f) => /@media|clamp\(/.test(f.content))
      if (!hasViewport) {
        add('responsive', 'blocking', 'Responsive layout is required but index.html is missing the <meta name="viewport" content="width=device-width, …"> tag.')
      }
      if (!hasMediaQuery) {
        add('responsive', 'warning', 'No @media queries or clamp() found in the stylesheets — verify the layout actually adapts on mobile.')
      }
    }
  } else {
    // ---- React target ----------------------------------------------------
    const pkgFile = files.find((f) => f.path === 'package.json')
    const emittedKit = new Set(files.filter((f) => f.path.startsWith('components/kit/')).map((f) => f.path))

    // 1. kit imports must resolve to engine-emitted files (no ghost components)
    for (const f of files.filter((x) => /\.(tsx|jsx|ts|js)$/.test(x.path) && !isEngineManaged(x.path))) {
      const re = /['"]\.\/?components\/kit\/([^'"]+)['"]/g
      let m: RegExpExecArray | null
      while ((m = re.exec(f.content)) !== null) {
        const ref = m[1]
        const base = ref.replace(/\.(tsx|jsx|ts|css|js)$/, '')
        const ok = emittedKit.has(`components/kit/${base}.tsx`) || emittedKit.has(`components/kit/${base}.css`) || emittedKit.has(`components/kit/${ref}`)
        if (!ok) {
          add('invalid-component-name', 'blocking', `${f.path} imports './components/kit/${ref}' but no such kit file was emitted — available: ${[...emittedKit].map((p) => p.replace('components/kit/', '')).join(', ') || 'none'}.`)
        }
      }
    }

    // 2. every bare import must be declared in the emitted package.json
    if (pkgFile) {
      let deps: Record<string, string> = {}
      try {
        const parsed = JSON.parse(pkgFile.content) as { dependencies?: Record<string, string> }
        deps = parsed.dependencies ?? {}
      } catch {
        add('dependency-pins', 'blocking', 'The generated package.json is not valid JSON.')
      }
      const modelCode = files.filter((f) => /\.(tsx|jsx|ts|js)$/.test(f.path) && !isEngineManaged(f.path))
      const rootOf = (spec: string) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0])
      for (const f of modelCode) {
        for (const spec of bareImports([f])) {
          const root = rootOf(spec)
          if (RUNTIME_BUILTINS.has(spec) || RUNTIME_BUILTINS.has(root)) continue
          if (!deps[root]) {
            add('missing-imports', 'blocking', `${f.path}: import of '${spec}' is not declared in package.json dependencies — the generated project would not build.`)
          }
        }
      }
      // 3. pinned versions must match the tested matrix
      for (const [name, pin] of Object.entries(PINNED_DEPENDENCIES)) {
        if (deps[name] !== undefined && deps[name] !== pin.version) {
          add('dependency-pins', 'blocking', `package.json pins ${name}@${deps[name]} but the tested version is ${pin.version} (${pin.license}) — align the version or remove the dependency.`)
        }
      }
    } else if (files.some((f) => /\.(tsx|jsx)$/.test(f.path) && !isEngineManaged(f.path))) {
      add('dependency-pins', 'blocking', 'React target generated component files but no package.json — the engine normally attaches one.')
    }

    // 4. React animation cleanup: official useGSAP integration or gsap.context+revert
    if (plan.animationIds.length > 0 && /gsap/.test(allText)) {
      const official = /useGSAP\(/.test(allText)
      const manual = /gsap\.context\(/.test(allText) && /\.revert\(\)/.test(allText)
      if (!official && !manual) {
        add('react-cleanup', 'blocking', 'GSAP is used without the official cleanup integration — wrap animations in useGSAP(...) (from @gsap/react) or gsap.context(...) with .revert() on unmount.')
      }
      if (!allText.includes('prefers-reduced-motion')) {
        add('reduced-motion', 'warning', 'GSAP animation code without a prefers-reduced-motion guard — add the guarded pattern from the brief.')
      }
    }

    // 5. requested background must actually be wired
    if (plan.vantaEffect) {
      const wired = files.some((f) => !isEngineManaged(f.path) && /components\/kit\/VantaBackground/.test(f.content))
      if (!wired) {
        add('vanta-not-wired', 'blocking', `The ${plan.vantaEffect} background was requested, but no generated component imports './components/kit/VantaBackground' — the background would never render.`)
      }
    }

    // 6. responsive: CSS modules / styles file should adapt
    if (plan.responsive && css.length > 0 && !css.some((f) => /@media|clamp\(/.test(f.content)) && !allText.includes('clamp(') && !allText.includes('@media')) {
      add('responsive', 'warning', 'No @media queries or clamp() found — verify the layout adapts on mobile.')
    }
  }

  // ---- syntax screening (heuristic, both targets; engine files excluded) --
  for (const f of scripts) {
    if (isEngineManaged(f.path)) continue
    if (f.path.endsWith('.min.js')) continue
    const pairs: Array<[string, string]> = [
      ['{', '}'],
      ['(', ')'],
      ['[', ']'],
    ]
    for (const [open, close] of pairs) {
      const openCount = f.content.split(open).length - 1
      const closeCount = f.content.split(close).length - 1
      if (Math.abs(openCount - closeCount) > 2) {
        add('syntax-screen', 'warning', `${f.path}: unbalanced '${open}${close}' (${openCount} vs ${closeCount}) — possible broken syntax; check the file in the editor/preview.`)
        break
      }
    }
  }

  const blocking = issues.filter((i) => i.severity === 'blocking').length
  const warnings = issues.length - blocking
  return { passed: blocking === 0, blocking, warnings, issues: sortIssues(issues) }
}

function sortIssues(issues: FrontendCheck[]): FrontendCheck[] {
  return [...issues].sort((a, b) => (a.severity === b.severity ? a.id.localeCompare(b.id) : a.severity === 'blocking' ? -1 : 1))
}
