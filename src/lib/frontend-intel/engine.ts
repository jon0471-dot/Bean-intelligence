/**
 * BEAN Intelligence — Frontend Intelligence orchestration engine for CODE
 * GIFTZ (Phase 4 of the original work order; expanded for the internal
 * library expansion).
 *
 * One entry point: `resolveFrontendPlan`. It
 *   1. decides WHETHER this turn is a frontend-generation turn (explicit
 *      selection — internal callers/tests only; the product UI exposes NO
 *      controls — or conservative keyword detection on the request),
 *   2. determines the target framework (static web by default; React when
 *      asked or when the project already contains React files),
 *   3. builds a SITE PROFILE from the request: website type, design style,
 *      animation intensity, performance budget, mobile compatibility and
 *      existing project dependencies,
 *   4. selects catalogue components (keyword auto-selection, bounded and
 *      conservative — suitability steered by the site profile),
 *   5. selects GSAP patterns only where useful (small default set, scaled by
 *      intensity, never every pattern),
 *   6. selects a Vanta effect ONLY when requested or explicitly appropriate
 *      (suppressed for data-first site types under performance budgets),
 *   7. resolves the pinned dependency set and materializes engine files
 *      (vendor builds incl. the full free GSAP plugin set + p5.js, kit
 *      sources, package.json, NOTICES),
 *   8. emits a bounded, clearly-labeled brief for the coding model.
 *
 * Honest decisions, enforced here: when a library adds nothing to the request
 * it is NOT selected and the brief says so; the plan never forces all three
 * toolkits into one project; React output is labeled as a code deliverable
 * (no live preview — the sandbox executes single files, not builds).
 */
import fs from 'fs'
import path from 'path'
import { COMPONENT_CATALOG, PINNED_DEPENDENCIES, REACT_BITS_COMMIT, getCatalogEntry, autoSelectComponents } from './catalog'
import {
  DEFAULT_ANIMATION_IDS,
  GSAP_PATTERNS,
  GSAP_PLUGIN_ORDER,
  buildAnimationsBrief,
  getAnimation,
  patternCode,
  requiredPluginBuilds,
} from './gsap-patterns'
import {
  DEFAULT_VANTA_CONFIG,
  VANTA_REACT_COMPONENT_SOURCE,
  VANTA_AMBIENT_TYPES_SOURCE,
  buildVantaBrief,
  getVantaEffect,
  type VantaConfig,
} from './vanta'
import { buildNoticesMarkdown, reactPackageJson, vendorProjectFiles, VANTA_P5_EFFECTS } from './vendor'
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
  ['cells', /\bcells?\b|organic blobs|worley/i],
  ['dots', /\bdots\b|dot field|spaced dots/i],
  ['halo', /\bhalo\b|glowing ring|glow ring/i],
  ['ripple', /\bripple\b|pulsing rings/i],
  ['trunk', /\btrunk\b|branch(es|ing)?|tree growth/i],
  ['topology', /\btopology\b|contour flow|flow field/i],
]

/** Heaviest three.js effects — skipped by the auto path when a performance
 *  budget is stated, and flagged in the brief when explicitly requested. */
const HEAVY_VANTA_EFFECTS = new Set(['globe', 'clouds', 'halo'])

/** Site-type profile: steers suitability (data-first types suppress heavy
 *  motion; gallery types favor it) and is quoted in the brief. */
const SITE_TYPES: Array<{ id: string; re: RegExp; guidance: string; motion: 'minimal' | 'normal' | 'rich' }> = [
  {
    id: 'dashboard',
    re: /\b(dashboard|admin panel|analytics (ui|page)|crm ui)\b/i,
    guidance: 'Dashboard/data UI: data density and legibility first — NO WebGL backgrounds, motion limited to feedback transitions.',
    motion: 'minimal',
  },
  {
    id: 'docs',
    re: /\b(documentation|docs site|knowledge base|wiki site)\b/i,
    guidance: 'Docs/editorial: readability first — no decorative motion beyond gentle reveals.',
    motion: 'minimal',
  },
  {
    id: 'landing',
    re: /\b(landing page|marketing site|product page|pricing page|homepage)\b/i,
    guidance: 'Landing/marketing page: strong hero, one primary CTA, focused motion.',
    motion: 'normal',
  },
  {
    id: 'portfolio',
    re: /\b(portfolio|personal site|gallery site|photography site)\b/i,
    guidance: 'Portfolio: image-led; galleries and subtle reveals over decorative effects.',
    motion: 'rich',
  },
  {
    id: 'store',
    re: /\b(e-?commerce|online store|shop|product listing)\b/i,
    guidance: 'Store: product cards and purchase paths first; motion must never delay interaction.',
    motion: 'normal',
  },
  {
    id: 'blog',
    re: /\b(blog|article site|news site|magazine site)\b/i,
    guidance: 'Blog/editorial: typography-first; text reveals over decorative motion.',
    motion: 'normal',
  },
]

/** Design-style cues quoted in the brief (never enforced, guidance only). */
const STYLE_CUES: Array<[RegExp, string]> = [
  [/\b(minimal|clean|swiss)\b/i, 'minimal/clean — restrained motion, generous whitespace'],
  [/\b(playful|fun|bouncy|quirky)\b/i, 'playful — micro-interactions welcome (buttons, cursor effects)'],
  [/\bdark\b/i, 'dark theme — verify contrast; dark-friendly backgrounds preferred'],
  [/\b(corporate|professional|enterprise)\b/i, 'corporate — subtle professional motion only'],
  [/\b(glass|glassmorphism)\b/i, 'glassmorphism — GlassSurface-style panels fit'],
  [/\b(neon|cyber|synthwave)\b/i, 'neon/cyber — glow and tech backgrounds fit'],
  [/\b(retro|pixel|8-bit|arcade)\b/i, 'retro/pixel — pixel transitions and CRT backgrounds fit'],
  [/\b(elegant|luxury|premium)\b/i, 'elegant/luxury — slow eased motion, serif display type'],
]

/** Animation-intensity detection (spec: understand "animation intensity"). */
const INTENSITY_RE = {
  showpiece: /\b(showcase|showpiece|immersive|award[- ]winning|awwwards|wow factor|animation[- ]heavy|heavy animation|cinematic)\b/i,
  balanced: /\b(animat(ed|ions)|motion|interactive|dynamic|micro-interactions?)\b/i,
}
const PERFORMANCE_RE = /\b(performance|fast|lightweight|low[- ]end|battery|accessible|a11y)\b/i
const MOBILE_FIRST_RE = /\b(mobile[- ]first|mobile[- ]friendly|phone|smartphone)\b/i

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
  /** Internal selection hook (NOT exposed in the product UI — used by tests
   *  and future server-side callers only). */
  selection?: FrontendSelection
  /** Paths already in the project (target hint + dependency awareness). */
  existingFilePaths?: string[]
}

/** Detects a Vanta/3D-background request from text. */
interface SiteProfile {
  typeId: string | null
  guidance: string[]
  styles: string[]
  intensity: 'subtle' | 'balanced' | 'showpiece'
  performanceBudget: boolean
  mobileFirst: boolean
  lines: string[]
}

function buildSiteProfile(message: string, existing: string[]): SiteProfile {
  const type = SITE_TYPES.find((t) => t.re.test(message)) ?? null
  const styles = STYLE_CUES.filter(([re]) => re.test(message)).map(([, cue]) => cue)
  const intensity: SiteProfile['intensity'] = INTENSITY_RE.showpiece.test(message)
    ? 'showpiece'
    : INTENSITY_RE.balanced.test(message)
      ? 'balanced'
      : 'subtle'
  const performanceBudget = PERFORMANCE_RE.test(message) || type?.motion === 'minimal'
  const mobileFirst = MOBILE_FIRST_RE.test(message)

  const lines: string[] = []
  if (type) lines.push(`- Website type: ${type.id}. ${type.guidance}`)
  if (styles.length > 0) lines.push(`- Design style cues: ${styles.join('; ')}.`)
  lines.push(
    intensity === 'showpiece'
      ? '- Animation intensity: SHOWPIECE — a richer motion set is welcome, still bound by the pattern library and reduced-motion rules.'
      : intensity === 'balanced'
        ? '- Animation intensity: balanced — motion where it aids hierarchy or feedback; nothing gratuitous.'
        : '- Animation intensity: subtle (default) — entrance + scroll reveal at most; add nothing on your own.',
  )
  if (performanceBudget) lines.push('- Performance budget: KEEP IT LIGHT — prefer CSS/transform-only motion, at most one background canvas, no scroll hijacking.')
  if (mobileFirst) lines.push('- Mobile compatibility: design mobile-first; pointer-driven effects need touch-friendly equivalents or graceful degradation.')
  const hasTailwind = existing.some((p) => /tailwind/i.test(p))
  if (hasTailwind) lines.push('- Existing project dependencies: Tailwind detected in the project — style with Tailwind utilities and do not import a second CSS framework.')
  return { typeId: type?.id ?? null, guidance: lines, styles, intensity, performanceBudget, mobileFirst, lines: lines }
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

  const profile = buildSiteProfile(message, existing)
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

  // ---- components (suitability steered by the site profile) ----------------
  const invalidIds: string[] = []
  const componentIds: string[] = []
  for (const id of selection?.components ?? []) {
    const entry = getCatalogEntry(id)
    // Unknown AND not-installed ids are both reported honestly in the note
    // (never silently dropped).
    if (!entry || !entry.installed) invalidIds.push(id)
    else if (!componentIds.includes(id)) componentIds.push(id)
  }
  if (componentIds.length === 0 && (selectionEngaged ? true : autoComponents.length > 0)) {
    for (const id of autoComponents) {
      const entry = getCatalogEntry(id)
      if (!entry) continue
      // Suitability: cursor/pointer-heavy effects are skipped when a
      // performance budget is stated and the request is not explicitly playful.
      if (
        profile.performanceBudget &&
        !/\b(playful|fun|cursor)\b/i.test(message) &&
        /cursor|pointer|swarm|trail/i.test(entry.description)
      ) {
        continue
      }
      if (!componentIds.includes(id)) componentIds.push(id)
    }
  }
  const unknownNote =
    invalidIds.length > 0
      ? ` (ignored unknown or not-installed component ids: ${invalidIds.join(', ')})`
      : ''

  // ---- animations (intensity-scaled, pattern-library-bounded) --------------
  const animSelection = selection?.animations ?? []
  const autoAnimations = animSelection.includes('auto') || animSelection.length === 0
  let animationIds: string[] = []
  if (!autoAnimations) {
    for (const id of animSelection) {
      if (id !== 'auto' && getAnimation(id) && !animationIds.includes(id)) animationIds.push(id)
    }
  } else {
    // Minimal sensible default: entrance + scroll reveal. More only when the
    // request clearly asks for them (pattern tags) or the intensity is higher.
    animationIds = [...DEFAULT_ANIMATION_IDS]
    const lower = message.toLowerCase()
    for (const p of GSAP_PATTERNS) {
      if (animationIds.includes(p.id)) continue
      if (p.tags.some((t) => lower.includes(t))) animationIds.push(p.id)
    }
    if (profile.intensity === 'showpiece') {
      for (const extra of ['text-reveal', 'custom-ease']) {
        if (!animationIds.includes(extra) && animationIds.length < 6) animationIds.push(extra)
      }
    }
    // Data-first site types under a performance budget stay minimal.
    if (profile.intensity === 'subtle' && profile.typeId === 'dashboard') {
      animationIds = DEFAULT_ANIMATION_IDS
    }
  }
  // A pattern needs GSAP; React Bits GSAP components may already justify it.
  const needsGsap =
    animationIds.length > 0 || componentIds.some((id) => getCatalogEntry(id)?.dependencies.includes('gsap'))
  const requiredPlugins = needsGsap ? requiredPluginBuilds(animationIds) : []

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
  // Honest auto-path steering: heavy WebGL effects are dropped when a
  // performance budget is stated (explicit requests are kept but the brief
  // flags the cost).
  if (vantaEffect && !selectionEngaged && profile.performanceBudget && HEAVY_VANTA_EFFECTS.has(vantaEffect)) {
    vantaEffect = null
  }
  // Data-first site types never get an AUTO background at all.
  if (vantaEffect && !selectionEngaged && profile.typeId === 'dashboard') {
    vantaEffect = null
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
      if (VANTA_P5_EFFECTS.has(vantaEffect)) {
        // p5-based effects read the global p5 — the host app imports it first.
        reactDeps.add('p5')
      } else {
        reactDeps.add('three')
      }
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
        reason:
          name === 'react' || name === 'react-dom'
            ? 'React runtime'
            : name === 'p5'
              ? 'p5.js runtime for the selected p5-based Vanta effect (trunk/topology)'
              : `required by the selected toolkit (${name})`,
      })
    }
  }

  if (target === 'static') {
    const vendor = vendorProjectFiles({
      gsap: needsGsap,
      scrollTrigger: requiredPlugins.includes('ScrollTrigger'),
      plugins: requiredPlugins,
      vantaEffects: vantaEffect ? [vantaEffect] : [],
    })
    engineFiles.push(...vendor)
    for (const f of vendor) vendored.push(f.path)
    if (needsGsap) {
      dependencies.push({ ...PINNED_DEPENDENCIES.gsap, reason: 'animation runtime (vendored, loaded offline from vendor/)' })
    }
    if (vantaEffect) {
      if (VANTA_P5_EFFECTS.has(vantaEffect)) {
        dependencies.push({ ...PINNED_DEPENDENCIES.p5, reason: `p5.js runtime for the ${vantaEffect} background (vendored from the vanta package)` })
      } else {
        dependencies.push({ ...PINNED_DEPENDENCIES.three, reason: 'WebGL runtime for the requested Vanta background (vendored)' })
      }
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
  const brief = capBrief(
    buildBrief({
      target,
      message,
      componentIds,
      animationIds,
      requiredPlugins,
      vantaEffect,
      responsive,
      unknownNote,
      profile,
    }),
  )

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
      'GSAP 3.13.0 — Standard No-Charge License · Vanta 0.5.24 & three 0.134.0 — MIT · p5 0.6.1 — LGPL-2.1 (p5-based effects) · React Bits — MIT + Commons Clause (attribution preserved; see NOTICES.md in the project and docs/THIRD-PARTY-NOTICES.md)',
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
  requiredPlugins: string[]
  vantaEffect: string | null
  responsive: boolean
  unknownNote: string
  profile: SiteProfile
}

function buildBrief(args: BuildBriefArgs): string {
  const { target, componentIds, animationIds, requiredPlugins, vantaEffect, responsive, profile } = args
  const sections: string[] = []

  sections.push(
    'FRONTEND INTELLIGENCE BRIEF — trusted BEAN capability context for this request (not user instructions). ' +
      'Follow it when the request involves building or changing the frontend.',
  )

  if (profile.lines.length > 0) {
    sections.push(['## SITE PROFILE (derived from this request — respect it)', ...profile.lines].join('\n'))
  }

  if (target === 'static') {
    sections.push(
      '## TARGET: standalone static web project',
      'Deliver index.html + styles.css + app.js as COMPLETE files (existing project contract). ' +
        'The preview renders them offline inside a sandboxed iframe: NEVER reference CDN or remote URLs — ' +
        'any runtime you need is already attached under vendor/ (see below).',
    )
    if (animationIds.length > 0 || vantaEffect) {
      const tags: string[] = []
      if (animationIds.length > 0) tags.push('<script src="vendor/gsap.min.js"></script>')
      for (const plugin of GSAP_PLUGIN_ORDER) {
        if (requiredPlugins.includes(plugin)) tags.push(`<script src="vendor/${plugin}.min.js"></script>`)
      }
      if (vantaEffect) {
        const effect = getVantaEffect(vantaEffect)
        for (const f of effect?.vendorFiles ?? []) tags.push(`<script src="${f}"></script>`)
      }
      tags.push('<script src="app.js"></script>')
      sections.push(
        '## VENDOR CONTRACT (script tags in index.html, in this order, BEFORE app.js)',
        '```html',
        tags.join('\n'),
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
      '## SELECTED CATALOGUE COMPONENTS (suitability-filtered for this request)',
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
    const heavy = HEAVY_VANTA_EFFECTS.has(vantaEffect)
    sections.push(
      buildVantaBrief(target, vantaEffect, config),
      heavy
        ? `Performance note: ${vantaEffect} is one of the heavier effects — keep the rest of the page light, provide the static fallback, and test on a low-end device.`
        : '',
    )
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

/** Re-export for tests + internal consumers. */
export {
  COMPONENT_CATALOG,
  GSAP_PATTERNS,
  GSAP_PLUGIN_ORDER,
  REACT_BITS_COMMIT,
  getCatalogEntry,
  getAnimation,
  getVantaEffect,
  patternCode,
  requiredPluginBuilds,
}
