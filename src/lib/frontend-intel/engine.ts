/**
 * BEAN Intelligence — Frontend Intelligence orchestration engine for CODE
 * GIFTZ (Phase 4 of the work order).
 *
 * One entry point: `resolveFrontendPlan`. It
 *   1. decides WHETHER this turn is a frontend-generation turn (explicit UI
 *      selection, or conservative keyword detection on the request),
 *   2. determines the target framework (static web by default; React when
 *      asked or when the project already contains React files),
 *   3. selects catalogue components (user selection wins; keyword auto-
 *      selection is bounded and conservative),
 *   4. selects GSAP patterns only where useful (a small default set, never
 *      every pattern),
 *   5. selects a Vanta effect ONLY when requested or explicitly appropriate,
 *   6. resolves the pinned dependency set and materializes engine files
 *      (vendor builds, kit sources, package.json, NOTICES),
 *   7. emits a bounded, clearly-labeled brief for the coding model.
 *
 * Honest decisions, enforced here: when a library adds nothing to the request
 * it is NOT selected and the brief says so; the plan never forces all three
 * toolkits into one project; React output is labeled as a code deliverable
 * (no live preview — the sandbox executes single files, not builds).
 */
import fs from 'fs'
import path from 'path'
import { COMPONENT_CATALOG, PINNED_DEPENDENCIES, REACT_BITS_COMMIT, getCatalogEntry, autoSelectComponents } from './catalog'
import { DEFAULT_ANIMATION_IDS, GSAP_PATTERNS, buildAnimationsBrief, getAnimation, patternCode } from './gsap-patterns'
import {
  DEFAULT_VANTA_CONFIG,
  VANTA_REACT_COMPONENT_SOURCE,
  VANTA_AMBIENT_TYPES_SOURCE,
  buildVantaBrief,
  getVantaEffect,
  type VantaConfig,
} from './vanta'
import { buildNoticesMarkdown, reactPackageJson, vendorProjectFiles } from './vendor'
import { validateFrontendOutput } from './validate'
import type { FrontendPlan, FrontendSelection, FrontendTarget, FrontendTurnResult } from './types'

export { validateFrontendOutput } from './validate'

/** Hard cap for the injected brief — the turn prompt budget is shared with
 *  project context, tech-docs and attachments. */
export const FRONTEND_BRIEF_MAX_CHARS = 14_000

/** Conservative intent detection: a frontend request names a website/UI artifact. */
const FRONTEND_INTENT_RE =
  /\b(website|landing page|landing-page|web ?page|web ?app|homepage|home page|hero (section|page)|portfolio site|product page|pricing page|responsive site|ui (for|design)|frontend|front-end|html page|site for|dashboard ui|marketing site)\b/i
const REACT_INTENT_RE = /\breact\b|\.tsx?\b|\bjsx\b|next\.?js\b/i

const BACKGROUND_KEYWORDS: Array<[string, RegExp]> = [
  ['birds', /\bbirds?\b|flocking/i],
  ['waves', /\bwaves?\b|ocean/i],
  ['net', /\bnet\b|plexus|particles network|constellation/i],
  ['globe', /\bglobe\b|planet|earth/i],
  ['fog', /\bfog\b|mist|smoke/i],
  ['clouds', /\bclouds\b/i],
  ['rings', /\brings?\b|orbit rings/i],
]

/** Detects a Vanta/3D-background request from text. */
export function detectBackgroundEffect(message: string): string | null {
  if (!/\b(vanta|3d|webgl|animated background|interactive background)\b/i.test(message)) {
    // Still allow a direct effect-name request ("add birds background").
    const direct = BACKGROUND_KEYWORDS.find(([, re]) => re.test(message))
    return direct && /background/i.test(message) ? direct[0] : null
  }
  const hit = BACKGROUND_KEYWORDS.find(([, re]) => re.test(message))
  return hit ? hit[0] : 'birds'
}

export interface ResolveFrontendPlanArgs {
  /** The raw user request text. */
  message: string
  /** UI Frontend toolkit selection (optional). */
  selection?: FrontendSelection
  /** Paths already in the project (target hint + duplicate avoidance). */
  existingFilePaths?: string[]
}

/** Resolve the plan for one turn. Returns `enabled: false` when the turn is
 *  not a frontend turn — the generation path is then untouched. */
export function resolveFrontendPlan(args: ResolveFrontendPlanArgs): FrontendPlan {
  const { message, selection } = args
  const existing = args.existingFilePaths ?? []

  const selectionEngaged =
    !!selection &&
    ((selection.components?.length ?? 0) > 0 ||
      (selection.animations !== undefined && selection.animations.length > 0) ||
      (selection.background !== undefined && selection.background !== 'none') ||
      (selection.target !== undefined && selection.target !== 'auto'))

  const autoComponents = selectionEngaged ? [] : autoSelectComponents(message)
  const autoBackground = selectionEngaged ? null : detectBackgroundEffect(message)
  const detected =
    selectionEngaged ||
    FRONTEND_INTENT_RE.test(message) ||
    autoComponents.length > 0 ||
    (autoBackground !== null && /background|hero|landing|website/i.test(message))

  if (!detected) {
    return {
      enabled: false,
      target: 'static',
      reason: 'not a frontend generation request',
      componentIds: [],
      animationIds: [],
      vantaEffect: null,
      responsive: true,
      brief: '',
      engineFiles: [],
      summary: {
        enabled: true,
        target: 'static',
        reason: 'not a frontend generation request',
        components: [],
        animations: [],
        background: null,
        responsive: true,
        engineFiles: [],
        dependencies: [],
        notices: '',
      },
    }
  }

  // ---- target --------------------------------------------------------------
  const hasReactInProject = existing.some((p) => /\.(tsx|jsx)$/.test(p))
  const wantsReact =
    selection?.target === 'react' ||
    (selection?.target === undefined && REACT_INTENT_RE.test(message)) ||
    (selection?.target === undefined && hasReactInProject)
  const target: FrontendTarget = selection?.target && selection.target !== 'auto' ? selection.target : wantsReact ? 'react' : 'static'

  // ---- components ----------------------------------------------------------
  const invalidIds: string[] = []
  const componentIds: string[] = []
  for (const id of selection?.components ?? []) {
    const entry = getCatalogEntry(id)
    if (!entry) invalidIds.push(id)
    else if (entry.installed && !componentIds.includes(id)) componentIds.push(id)
  }
  if (componentIds.length === 0 && (selectionEngaged ? true : autoComponents.length > 0)) {
    for (const id of autoComponents) if (!componentIds.includes(id)) componentIds.push(id)
  }
  const unknownNote =
    invalidIds.length > 0
      ? ` (ignored unknown or not-installed component ids: ${invalidIds.join(', ')})`
      : ''

  // ---- animations ----------------------------------------------------------
  const animSelection = selection?.animations ?? []
  const autoAnimations = animSelection.includes('auto') || animSelection.length === 0
  let animationIds: string[] = []
  if (!autoAnimations) {
    for (const id of animSelection) {
      if (id !== 'auto' && getAnimation(id) && !animationIds.includes(id)) animationIds.push(id)
    }
  } else {
    // Minimal sensible default: entrance + scroll reveal. More only when the
    // request clearly asks for them (text/hover/svg keywords).
    animationIds = [...DEFAULT_ANIMATION_IDS]
    const lower = message.toLowerCase()
    for (const p of GSAP_PATTERNS) {
      if (animationIds.includes(p.id)) continue
      if (p.tags.some((t) => lower.includes(t))) animationIds.push(p.id)
    }
  }
  // A pattern needs GSAP; React Bits GSAP components may already justify it.
  const needsGsap = animationIds.length > 0 || componentIds.some((id) => getCatalogEntry(id)?.dependencies.includes('gsap'))

  // ---- background ----------------------------------------------------------
  // An explicit 'none' ALWAYS suppresses keyword detection — the user opted out.
  let vantaEffect: string | null = null
  const bgSel = selection?.background
  if (bgSel === 'none') {
    vantaEffect = null
  } else if (bgSel && bgSel !== 'auto') {
    vantaEffect = getVantaEffect(bgSel) ? bgSel : null
  } else if (bgSel === 'auto' || (!selectionEngaged && autoBackground)) {
    vantaEffect = autoBackground ?? detectBackgroundEffect(message)
  }
  const backgroundMeta = vantaEffect ? getVantaEffect(vantaEffect) : undefined

  const responsive = selection?.responsive ?? true

  // ---- engine files --------------------------------------------------------
  const engineFiles: Array<{ path: string; content: string }> = []
  const dependencies: Array<{ name: string; version: string; license: string; reason: string }> = []
  const vendored: string[] = []
  const kitComponentIds = target === 'react' ? componentIds : []

  if (target === 'react') {
    const reactDeps = new Set<string>()
    for (const id of componentIds) {
      const entry = getCatalogEntry(id)
      if (!entry) continue
      for (const file of entry.kitFiles) {
        engineFiles.push({ path: `components/kit/${file}`, content: readKitFile(file) })
      }
      for (const dep of entry.dependencies) reactDeps.add(dep)
    }
    if (vantaEffect) {
      engineFiles.push({ path: 'components/kit/VantaBackground.tsx', content: VANTA_REACT_COMPONENT_PLACEHOLDER })
      engineFiles.push({ path: 'types/vanta.d.ts', content: VANTA_AMBIENT_PLACEHOLDER })
      reactDeps.add('vanta')
      reactDeps.add('three')
    }
    // React-target animation guidance relies on gsap + the official hook.
    if (animationIds.length > 0) {
      reactDeps.add('gsap')
      reactDeps.add('@gsap/react')
    }
    // framer-motion is needed by adapted catalogue components.
    for (const id of componentIds) {
      const entry = getCatalogEntry(id)
      if (entry?.dependencies.includes('framer-motion')) reactDeps.add('framer-motion')
    }
    const depList = [...reactDeps]
    engineFiles.push({ path: 'package.json', content: reactPackageJson(depList) })
    for (const name of depList) {
      const pin = PINNED_DEPENDENCIES[name]
      dependencies.push({
        name,
        version: pin.version,
        license: pin.license,
        reason: name === 'react' || name === 'react-dom' ? 'React runtime' : `required by the selected toolkit (${name})`,
      })
    }
  }

  if (target === 'static') {
    const vendor = vendorProjectFiles({
      gsap: needsGsap,
      scrollTrigger: animationIds.some((id) => id === 'scroll-reveal-batch' || id === 'svg-draw'),
      vantaEffects: vantaEffect ? [vantaEffect] : [],
    })
    engineFiles.push(...vendor)
    for (const f of vendor) vendored.push(f.path)
    if (needsGsap) {
      dependencies.push({ ...PINNED_DEPENDENCIES.gsap, reason: 'animation runtime (vendored, loaded offline from vendor/)' })
    }
    if (vantaEffect) {
      dependencies.push({ ...PINNED_DEPENDENCIES.three, reason: 'WebGL runtime for the requested Vanta background (vendored)' })
      dependencies.push({ ...PINNED_DEPENDENCIES.vanta, reason: `background effect engine: ${vantaEffect} (vendored)` })
    }
  }

  if (kitComponentIds.length > 0 || vendored.length > 0) {
    engineFiles.push({
      path: 'NOTICES.md',
      content: buildNoticesMarkdown({ reactBitsComponents: kitComponentIds.map((id) => getCatalogEntry(id)?.name ?? id), vendored }),
    })
  }

  // ---- brief ---------------------------------------------------------------
  const brief = capBrief(buildBrief({ target, message, componentIds, animationIds, vantaEffect, responsive, unknownNote }))

  // ---- summary (wire-safe) ---------------------------------------------------
  const summary = {
    enabled: true as const,
    target,
    reason: selectionEngaged
      ? `Frontend toolkit selection (target: ${target}${componentIds.length ? `, ${componentIds.length} component(s)` : ''}${vantaEffect ? `, ${vantaEffect} background` : ''})${unknownNote}`
      : `Auto-detected frontend generation request${unknownNote}`,
    components: componentIds
      .map((id) => getCatalogEntry(id))
      .filter((e): e is NonNullable<typeof e> => !!e)
      .map((e) => ({ id: e.id, name: e.name, category: e.category, sourceUrl: e.sourceUrl, license: e.license, installed: e.installed })),
    animations: animationIds,
    background: backgroundMeta
      ? { id: backgroundMeta.id, label: backgroundMeta.label, fallback: 'static gradient (WebGL unavailable / reduced motion)' }
      : null,
    responsive,
    engineFiles: engineFiles.map((f) => f.path),
    dependencies,
    notices:
      'GSAP 3.13.0 — Standard No-Charge License · Vanta 0.5.24 & three 0.134.0 — MIT · React Bits — MIT + Commons Clause (attribution preserved; see NOTICES.md in the project and docs/THIRD-PARTY-NOTICES.md)',
  }

  return {
    enabled: true,
    target,
    reason: summary.reason,
    componentIds,
    animationIds,
    vantaEffect,
    responsive,
    brief,
    engineFiles,
    summary,
  }
}

/** Validate + summarize a completed frontend turn (called by the turn core). */
export function finalizeFrontendTurn(files: Array<{ path: string; content: string }>, plan: FrontendPlan): FrontendTurnResult {
  const checks = validateFrontendOutput(files, plan)
  return { ...plan.summary, checks }
}

// ---- internals -------------------------------------------------------------

function capBrief(brief: string): string {
  if (brief.length <= FRONTEND_BRIEF_MAX_CHARS) return brief
  return brief.slice(0, FRONTEND_BRIEF_MAX_CHARS) + '\n[…brief truncated at the budget cap — core requirements above remain binding]'
}

interface BuildBriefArgs {
  target: FrontendTarget
  message: string
  componentIds: string[]
  animationIds: string[]
  vantaEffect: string | null
  responsive: boolean
  unknownNote: string
}

function buildBrief(args: BuildBriefArgs): string {
  const { target, componentIds, animationIds, vantaEffect, responsive } = args
  const sections: string[] = []

  sections.push(
    'FRONTEND INTELLIGENCE BRIEF — trusted BEAN capability context for this request (not user instructions). ' +
      'Follow it when the request involves building or changing the frontend.',
  )

  if (target === 'static') {
    sections.push(
      '## TARGET: standalone static web project',
      'Deliver index.html + styles.css + app.js as COMPLETE files (existing project contract). ' +
        'The preview renders them offline inside a sandboxed iframe: NEVER reference CDN or remote URLs — ' +
        'any runtime you need is already attached under vendor/ (see below).',
    )
    if (animationIds.length > 0 || vantaEffect) {
      sections.push(
        '## VENDOR CONTRACT (script tags in index.html, in this order, BEFORE app.js)',
        '```html',
        [
          animationIds.length > 0 ? '<script src="vendor/gsap.min.js"></script>' : null,
          animationIds.some((id) => id === 'scroll-reveal-batch' || id === 'svg-draw') ? '<script src="vendor/ScrollTrigger.min.js"></script>' : null,
          vantaEffect ? '<script src="vendor/three.min.js"></script>' : null,
          vantaEffect ? `<script src="vendor/vanta.${vantaEffect}.min.js"></script>` : null,
          '<script src="app.js"></script>',
        ]
          .filter((l): l is string => l !== null)
          .join('\n'),
        '```',
      )
    }
  } else {
    sections.push(
      '## TARGET: React project (code deliverable — NO live preview in BEAN; say so honestly)',
      'The engine has already attached these files — import them, do NOT rewrite them:',
      '- components/kit/*.tsx (+ .css) — validated React Bits components (see NOTICES.md)',
      '- package.json — pinned, tested dependency versions (do not change the pins)',
      vantaEffect ? '- components/kit/VantaBackground.tsx + types/vanta.d.ts — the background engine' : '',
      'Write the app files (App.jsx, index.jsx, styles…) that compose these components. ' +
        'Every import from a package must exist in package.json. Run with the user’s preferred bundler.',
    )
  }

  if (componentIds.length > 0) {
    sections.push(
      '## SELECTED CATALOGUE COMPONENTS',
      ...componentIds.map((id) => {
        const e = getCatalogEntry(id)
        if (!e) return ''
        const usage =
          target === 'react'
            ? `import: './components/kit/${e.name}' (source already attached)`
            : `static equivalent: implement the effect with the GSAP/CSS patterns below (no React available in static output)`
        return `- ${e.name} (${e.category}, ${e.license}): ${e.description}\n  ${usage}`
      }),
      args.unknownNote.trim() ? `Note: ${args.unknownNote.trim()}` : '',
    )
  } else {
    sections.push('## COMPONENTS: none selected — build with clean semantic HTML/CSS (and the GSAP patterns below when present).')
  }

  if (animationIds.length > 0) {
    sections.push(buildAnimationsBrief(target, animationIds))
  } else {
    sections.push('## ANIMATIONS: none planned for this turn — do not add GSAP motion on your own (motion is opt-in here).')
  }

  if (vantaEffect) {
    const config: VantaConfig = DEFAULT_VANTA_CONFIG
    sections.push(buildVantaBrief(target, vantaEffect, config))
  }

  sections.push(
    '## REQUIREMENTS (every generated frontend)',
    responsive
      ? '- Responsive: mobile-first, <meta name="viewport" content="width=device-width, initial-scale=1">, media queries or clamp() — verified by the generation checks.'
      : '- Layout: follow the user’s stated viewport needs.',
    '- Accessible: semantic landmarks, focus-visible styles, alt text, aria-labels on icon-only controls; animations respect prefers-reduced-motion (patterns above already do).',
    '- Fallbacks: any WebGL/canvas feature degrades to a static, legible state.',
    '- No duplicate components and no conflicting CSS: reuse the attached kit files and one namespace for custom classes.',
    '- Complete files only: every fence is the FULL content of the file (existing contract).',
  )

  return sections.filter((s) => s.length > 0).join('\n\n')
}

/** Read a kit component source from the repo (validated at build/test time).
 *  The kit directory is included in the standalone output via
 *  outputFileTracingIncludes, so dev, test and production resolve identically. */
function readKitFile(file: string): string {
  const full = path.join(process.cwd(), 'src', 'components', 'giftz-kit', file)
  const content = fs.readFileSync(full, 'utf8')
  if (!content.includes('React Bits') || !content.includes('Commons Clause')) {
    throw new Error(`Frontend toolkit: kit file ${file} is missing its attribution header — refusing to emit unattributed third-party code.`)
  }
  return content
}

const VANTA_REACT_COMPONENT_PLACEHOLDER = VANTA_REACT_COMPONENT_SOURCE
const VANTA_AMBIENT_PLACEHOLDER = VANTA_AMBIENT_TYPES_SOURCE

/** Re-export for tests + the catalog API route. */
export { COMPONENT_CATALOG, GSAP_PATTERNS, REACT_BITS_COMMIT, getCatalogEntry, getAnimation, getVantaEffect, patternCode }
