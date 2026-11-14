/**
 * M21 Phase 0 — baseline audit against the REAL library modules.
 * Reads the committed registry/engine sources; prints machine-checkable
 * numbers for docs/M21-GENERATION-VALIDATION-AUDIT.md. No code is modified.
 */
import fs from 'fs'
import path from 'path'
import { COMPONENT_CATALOG, PINNED_DEPENDENCIES, REACT_BITS_COMMIT } from '../src/lib/frontend-intel/catalog'
import { EXPANSION_EXCLUSIONS } from '../src/lib/frontend-intel/catalog-expansion'
import { GSAP_PATTERNS, PATTERN_PLUGIN_BUILDS, GSAP_PLUGIN_ORDER, DEFAULT_ANIMATION_IDS } from '../src/lib/frontend-intel/gsap-patterns'
import { VANTA_EFFECTS } from '../src/lib/frontend-intel/vanta'
import { GSAP_PLUGIN_FILES, VANTA_P5_EFFECTS } from '../src/lib/frontend-intel/vendor'
import { resolveFrontendPlan } from '../src/lib/frontend-intel/engine'

const kitDir = path.join(process.cwd(), 'src', 'components', 'giftz-kit')
const kitFiles = fs.readdirSync(kitDir)
const kitTsx = kitFiles.filter((f) => f.endsWith('.tsx')).length
const kitCss = kitFiles.filter((f) => f.endsWith('.css')).length

const installed = COMPONENT_CATALOG.filter((c) => c.installed)
const notInstalled = COMPONENT_CATALOG.filter((c) => !c.installed)
const byCategory = new Map<string, number>()
for (const c of installed) byCategory.set(c.category, (byCategory.get(c.category) ?? 0) + 1)

// every installed entry's kit files must exist on disk
let missingKit = 0
for (const c of installed) for (const f of c.kitFiles) if (!fs.existsSync(path.join(kitDir, f))) missingKit++

// vendor builds for every pattern plugin + every vanta effect must exist
const missingVendor: string[] = []
for (const plugin of GSAP_PLUGIN_ORDER) {
  const spec = GSAP_PLUGIN_FILES[plugin]
  if (!spec || !fs.existsSync(path.join(process.cwd(), 'node_modules', spec.source))) missingVendor.push(spec?.source ?? plugin)
}
for (const e of VANTA_EFFECTS) {
  const src = VANTA_P5_EFFECTS.has(e.id) ? 'vanta/vendor/p5.min.js' : 'three/build/three.min.js'
  const bundle = `vanta/dist/vanta.${e.id}.min.js`
  for (const s of [src, bundle]) if (!fs.existsSync(path.join(process.cwd(), 'node_modules', s))) missingVendor.push(s)
}

// attribution header spot-check: every kit file must carry React Bits + Commons Clause
const unattributed = kitFiles.filter((f) => {
  const head = fs.readFileSync(path.join(kitDir, f), 'utf8').slice(0, 2000)
  return !(head.includes('React Bits') && head.includes('Commons Clause'))
})

console.log(JSON.stringify({
  catalogTotal: COMPONENT_CATALOG.length,
  installed: installed.length,
  notInstalledRecorded: notInstalled.length,
  expansionExclusionRecords: EXPANSION_EXCLUSIONS.length,
  byCategory: Object.fromEntries([...byCategory.entries()].sort()),
  kitTsx, kitCss,
  missingKitFiles: missingKit,
  gsapPatterns: GSAP_PATTERNS.length,
  defaultAnimationIds: DEFAULT_ANIMATION_IDS,
  pluginBuilds: GSAP_PLUGIN_ORDER.length,
  missingVendorBuilds: missingVendor,
  vantaEffects: VANTA_EFFECTS.length,
  vantaP5: [...VANTA_P5_EFFECTS],
  unattributedKitFiles: unattributed,
  reactBitsCommit: REACT_BITS_COMMIT,
  pinnedDeps: Object.fromEntries(Object.entries(PINNED_DEPENDENCIES).map(([k, v]) => [k, v.version])),
}, null, 2))

// engine smoke: the three M21 prompts resolve without throwing and are enabled
const prompts = {
  A: 'Build a modern immersive dark-themed technology landing page for "Nebula", a fictional AI infrastructure platform, as a React app: professional hero section with strong typography, navigation with a mobile menu, feature cards, product showcase, testimonials, pricing, FAQ and footer, rich entrance and scroll animations, animated headings, count-up stats and an interactive animated background. Accessible controls, responsive on mobile.',
  B: 'Build a professional analytics dashboard as a React app: sidebar navigation, header, KPI stat cards, charts, a data table with search and filtering, date-range controls, loading and empty states, error states, responsive layout for tablet and phone. Use clearly labeled sample data, no live data. Performance matters: fast initial rendering.',
  C: 'Build a multi-page React developer portfolio site for a fictional developer: Home, About, Projects, project detail pages and Contact, with working internal navigation between the pages. Animated typography on headings, a projects gallery with interactive project cards and hover effects, elegant dark style, responsive navigation on mobile, accessible links.',
}
const smoke: Record<string, unknown> = {}
for (const [k, message] of Object.entries(prompts)) {
  const plan = resolveFrontendPlan({ message, existingFilePaths: [] })
  smoke[k] = {
    enabled: plan.enabled,
    target: plan.target,
    reason: plan.reason,
    components: plan.componentIds,
    animations: plan.animationIds,
    background: plan.vantaEffect,
    engineFiles: plan.engineFiles.map((f) => f.path).filter((p) => !p.startsWith('vendor/')),
    engineFileCount: plan.engineFiles.length,
    briefChars: plan.brief.length,
    profile: plan.summary ? undefined : undefined,
  }
}
console.log('--- prompt smoke ---')
console.log(JSON.stringify(smoke, null, 2))
