/**
 * BEAN Intelligence — curated React Bits component catalogue.
 *
 * Registry truth: a component is `installed: true` ONLY when its implementation
 * exists in `src/components/giftz-kit/` AND passed validation (repo tsc, lint,
 * render/SSR validation). Components known upstream but deliberately not
 * installed are recorded with an honest `notInstalledReason` and are never
 * advertised as available.
 *
 * Two upstream generations live in the kit, both recorded per entry:
 *  - The ORIGINAL 17 integrations, vendored verbatim from the free collection
 *    at commit 4e0d091d3b1ea8b7aadef33716a8d99d164ae4ce (preserved untouched).
 *  - The EXPANSION set (all remaining compatible free components), vendored
 *    from commit cf2801031f07f53d4684e65b961bde7c2e2a6921 — see
 *    catalog-expansion.ts (auto-derived by scripts/kit-expansion-curation.ts;
 *    descriptions/tags curated by BEAN).
 *
 * License: React Bits — MIT + Commons Clause v1.0 (see docs/THIRD-PARTY-NOTICES.md).
 * No React Bits Pro content or assets. Components importing `motion/react` are
 * adapted to `framer-motion` (recorded per entry in `adaptedFrom`).
 */
import type { FrontendComponentMeta, PinnedDependency } from './types'
import { EXPANSION_ENTRIES, EXPANSION_EXCLUSIONS, EXPANSION_COMMIT, type ExpansionEntry, type ExcludedEntry } from './catalog-expansion'

export const REACT_BITS_COMMIT = '4e0d091d3b1ea8b7aadef33716a8d99d164ae4ce'
export const REACT_BITS_EXPANSION_COMMIT = EXPANSION_COMMIT
export const REACT_BITS_REPO = 'https://github.com/DavidHDev/react-bits'
export const REACT_BITS_LICENSE = 'MIT + Commons Clause v1.0'
const RB_BASE = `${REACT_BITS_REPO}/blob/${REACT_BITS_COMMIT}/src/ts-default`
const RB_ATTR =
  'React Bits by David Haz — MIT + Commons Clause v1.0 (attribution preserved in each file; see docs/THIRD-PARTY-NOTICES.md)'

/** Exact versions BEAN installs and generated React projects pin. */
export const PINNED_DEPENDENCIES: Record<string, PinnedDependency> = {
  gsap: {
    name: 'gsap',
    version: '3.13.0',
    license: "Standard 'No Charge' GSAP License (free incl. commercial use)",
    licenseUrl: 'https://gsap.com/standard-license',
  },
  '@gsap/react': {
    name: '@gsap/react',
    version: '2.1.2',
    license: "Standard 'No Charge' GSAP License",
    licenseUrl: 'https://gsap.com/standard-license',
  },
  'framer-motion': {
    name: 'framer-motion',
    version: '12.26.2',
    license: 'MIT',
    licenseUrl: 'https://github.com/motiondivision/motion/blob/main/LICENSE',
  },
  vanta: {
    name: 'vanta',
    version: '0.5.24',
    license: 'MIT',
    licenseUrl: 'https://github.com/tengbao/vanta/blob/master/LICENSE.md',
  },
  three: {
    name: 'three',
    version: '0.134.0',
    license: 'MIT',
    licenseUrl: 'https://github.com/mrdoob/three.js/blob/r134/LICENSE',
  },
  p5: {
    name: 'p5',
    version: '0.6.1',
    license: 'LGPL-2.1 (vendored with notices; source: https://github.com/processing/p5.js/tree/v0.6.1)',
    licenseUrl: 'https://github.com/processing/p5.js/blob/v0.6.1/LICENSE',
  },
}

function entry(
  e: Omit<FrontendComponentMeta, 'sourceRepository' | 'license' | 'attribution' | 'upstreamCommit' | 'installed'> & {
    installed?: boolean
    notInstalledReason?: string
    upstreamCommit?: string
  },
): FrontendComponentMeta {
  return {
    ...e,
    sourceRepository: REACT_BITS_REPO,
    license: REACT_BITS_LICENSE,
    attribution: RB_ATTR,
    upstreamCommit: e.upstreamCommit ?? REACT_BITS_COMMIT,
    installed: e.installed ?? true,
  }
}

/** The ORIGINAL curated catalogue (implementation in src/components/giftz-kit,
 *  preserved verbatim from the first integration). */
const ORIGINAL_CATALOG: FrontendComponentMeta[] = [
  entry({
    id: 'split-text',
    name: 'SplitText',
    category: 'Text animation',
    description: 'Splits a heading into words/chars and animates the pieces in with a GSAP timeline (masked reveal).',
    sourceUrl: `${RB_BASE}/TextAnimations/SplitText/SplitText.tsx`,
    dependencies: ['gsap', '@gsap/react'],
    compatibility: 'React 18/19 client component; requires gsap >= 3.13 (SplitText plugin is free since 3.13).',
    styling: 'inline',
    variants: ['ts-default', 'ts-tailwind', 'js-default', 'js-tailwind'],
    kitFiles: ['SplitText.tsx'],
    adaptedFrom: undefined,
    tags: ['heading', 'title', 'hero text', 'split text', 'text reveal', 'animate heading'],
  }),
  entry({
    id: 'text-type',
    name: 'TextType',
    category: 'Text animation',
    description: 'Typewriter / type-delete loop with cursor; GSAP-driven, pausable.',
    sourceUrl: `${RB_BASE}/TextAnimations/TextType/TextType.tsx`,
    dependencies: ['gsap'],
    compatibility: 'React 18/19 client component.',
    styling: 'css-file',
    variants: ['ts-default', 'ts-tailwind', 'js-default', 'js-tailwind'],
    kitFiles: ['TextType.tsx', 'TextType.css'],
    tags: ['typewriter', 'typing', 'type effect', 'terminal text'],
  }),
  entry({
    id: 'blur-text',
    name: 'BlurText',
    category: 'Text animation',
    description: 'Words animate in one by one from a blur — animated heading effect.',
    sourceUrl: `${RB_BASE}/TextAnimations/BlurText/BlurText.tsx`,
    dependencies: ['framer-motion'],
    compatibility: 'React 18/19 client component; framer-motion 12.',
    styling: 'inline',
    variants: ['ts-default', 'ts-tailwind', 'js-default', 'js-tailwind'],
    kitFiles: ['BlurText.tsx'],
    adaptedFrom: 'motion/react -> framer-motion',
    tags: ['heading', 'blur text', 'animated heading', 'stagger words'],
  }),
  entry({
    id: 'shiny-text',
    name: 'ShinyText',
    category: 'Text animation',
    description: 'Shimmering highlight sweep across text — pure CSS animation.',
    sourceUrl: `${RB_BASE}/TextAnimations/ShinyText/ShinyText.tsx`,
    dependencies: [],
    compatibility: 'Any React; zero JS dependencies (CSS animation).',
    styling: 'css-file',
    variants: ['ts-default', 'ts-tailwind', 'js-default', 'js-tailwind'],
    kitFiles: ['ShinyText.tsx', 'ShinyText.css'],
    tags: ['shimmer', 'shine', 'badge text', 'loading label'],
  }),
  entry({
    id: 'gradient-text',
    name: 'GradientText',
    category: 'Text animation',
    description: 'Animated gradient sweep across display text; pure CSS.',
    sourceUrl: `${RB_BASE}/TextAnimations/GradientText/GradientText.tsx`,
    dependencies: [],
    compatibility: 'Any React; zero JS dependencies (CSS animation).',
    styling: 'css-file',
    variants: ['ts-default', 'ts-tailwind', 'js-default', 'js-tailwind'],
    kitFiles: ['GradientText.tsx', 'GradientText.css'],
    tags: ['gradient', 'hero heading', 'display text'],
  }),
  entry({
    id: 'count-up',
    name: 'CountUp',
    category: 'Text animation',
    description: 'Animates a number from a start value when it scrolls into view.',
    sourceUrl: `${RB_BASE}/TextAnimations/CountUp/CountUp.tsx`,
    dependencies: ['framer-motion'],
    compatibility: 'React 18/19; framer-motion 12 (useInView).',
    styling: 'inline',
    variants: ['ts-default', 'ts-tailwind', 'js-default', 'js-tailwind'],
    kitFiles: ['CountUp.tsx'],
    adaptedFrom: 'motion/react -> framer-motion',
    tags: ['counter', 'stats', 'number', 'count up', 'metrics'],
  }),
  entry({
    id: 'scroll-reveal',
    name: 'ScrollReveal',
    category: 'Text animation',
    description: 'Reveals text line-by-line as the user scrolls (ScrollTrigger).',
    sourceUrl: `${RB_BASE}/TextAnimations/ScrollReveal/ScrollReveal.tsx`,
    dependencies: ['gsap'],
    compatibility: 'React 18/19 client component; ScrollTrigger cleanup included.',
    styling: 'css-file',
    variants: ['ts-default', 'ts-tailwind', 'js-default', 'js-tailwind'],
    kitFiles: ['ScrollReveal.tsx', 'ScrollReveal.css'],
    tags: ['scroll reveal', 'scroll animation', 'about section'],
  }),
  entry({
    id: 'animated-content',
    name: 'AnimatedContent',
    category: 'Section animation',
    description: 'Entrance animation for any block when it enters the viewport (directional slide+blur).',
    sourceUrl: `${RB_BASE}/Animations/AnimatedContent/AnimatedContent.tsx`,
    dependencies: ['gsap'],
    compatibility: 'React 18/19 client component; ScrollTrigger cleanup included.',
    styling: 'inline',
    variants: ['ts-default', 'ts-tailwind', 'js-default', 'js-tailwind'],
    kitFiles: ['AnimatedContent.tsx'],
    tags: ['section', 'page section', 'fade in', 'entrance', 'reveal on scroll'],
  }),
  entry({
    id: 'star-border',
    name: 'StarBorder',
    category: 'Interactive button',
    description: 'Button with an animated starlight border sweep (pure CSS, zero deps).',
    sourceUrl: `${RB_BASE}/Animations/StarBorder/StarBorder.tsx`,
    dependencies: [],
    compatibility: 'Any React; CSS animation only.',
    styling: 'css-file',
    variants: ['ts-default', 'ts-tailwind', 'js-default', 'js-tailwind'],
    kitFiles: ['StarBorder.tsx', 'StarBorder.css'],
    tags: ['button', 'cta', 'call to action', 'primary button'],
  }),
  entry({
    id: 'click-spark',
    name: 'ClickSpark',
    category: 'Interactive effect',
    description: 'Canvas spark burst at every click point, wrapped around any children.',
    sourceUrl: `${RB_BASE}/Animations/ClickSpark/ClickSpark.tsx`,
    dependencies: [],
    compatibility: 'Any React; canvas, no deps.',
    styling: 'inline',
    variants: ['ts-default', 'ts-tailwind', 'js-default', 'js-tailwind'],
    kitFiles: ['ClickSpark.tsx'],
    tags: ['click effect', 'spark', 'playful', 'micro-interaction'],
  }),
  entry({
    id: 'spotlight-card',
    name: 'SpotlightCard',
    category: 'Card',
    description: 'Card with a mouse-following spotlight glow; content stays accessible.',
    sourceUrl: `${RB_BASE}/Components/SpotlightCard/SpotlightCard.tsx`,
    dependencies: [],
    compatibility: 'Any React; CSS custom properties.',
    styling: 'css-file',
    variants: ['ts-default', 'ts-tailwind', 'js-default', 'js-tailwind'],
    kitFiles: ['SpotlightCard.tsx', 'SpotlightCard.css'],
    tags: ['card', 'feature card', 'pricing card', 'hover glow'],
  }),
  entry({
    id: 'glare-hover',
    name: 'GlareHover',
    category: 'Hover interaction',
    description: 'Diagonal glare sweep across images/cards on hover; pure CSS.',
    sourceUrl: `${RB_BASE}/Animations/GlareHover/GlareHover.tsx`,
    dependencies: [],
    compatibility: 'Any React; CSS only.',
    styling: 'css-file',
    variants: ['ts-default', 'ts-tailwind', 'js-default', 'js-tailwind'],
    kitFiles: ['GlareHover.tsx', 'GlareHover.css'],
    tags: ['hover', 'glare', 'image hover', 'gallery hover'],
  }),
  entry({
    id: 'glass-surface',
    name: 'GlassSurface',
    category: 'Glass effect',
    description: 'Frosted-glass surface with refraction highlights; graceful degradation without WebGL.',
    sourceUrl: `${RB_BASE}/Components/GlassSurface/GlassSurface.tsx`,
    dependencies: [],
    compatibility: 'React 18/19; CSS backdrop-filter with sane fallbacks.',
    styling: 'css-file',
    variants: ['ts-default', 'ts-tailwind', 'js-default', 'js-tailwind'],
    kitFiles: ['GlassSurface.tsx', 'GlassSurface.css'],
    tags: ['glass', 'frosted', 'navbar glass', 'panel glass', 'glassmorphism'],
  }),
  entry({
    id: 'letter-glitch',
    name: 'LetterGlitch',
    category: 'Background effect',
    description: 'Canvas background of randomly flickering colored glyphs (matrix-adjacent).',
    sourceUrl: `${RB_BASE}/Backgrounds/LetterGlitch/LetterGlitch.tsx`,
    dependencies: [],
    compatibility: 'React 18/19; canvas, no deps.',
    styling: 'css-file',
    variants: ['ts-default', 'ts-tailwind', 'js-default', 'js-tailwind'],
    kitFiles: ['LetterGlitch.tsx', 'LetterGlitch.css'],
    tags: ['background', 'glitch', 'matrix', 'hacker', 'canvas background'],
  }),
  entry({
    id: 'dot-grid',
    name: 'DotGrid',
    category: 'Background effect',
    description: 'Interactive dot-grid canvas background reacting to the pointer.',
    sourceUrl: `${RB_BASE}/Backgrounds/DotGrid/DotGrid.tsx`,
    dependencies: [],
    compatibility: 'React 18/19; canvas, no deps.',
    styling: 'css-file',
    variants: ['ts-default', 'ts-tailwind', 'js-default', 'js-tailwind'],
    kitFiles: ['DotGrid.tsx', 'DotGrid.css'],
    tags: ['background', 'dots', 'grid', 'interactive background'],
  }),
  entry({
    id: 'dock',
    name: 'Dock',
    category: 'Animated navigation',
    description: 'macOS-style magnifying navigation dock (portal-based, animated).',
    sourceUrl: `${RB_BASE}/Components/Dock/Dock.tsx`,
    dependencies: [],
    compatibility: 'React 18/19; uses react-dom createPortal.',
    styling: 'css-file',
    variants: ['ts-default', 'ts-tailwind', 'js-default', 'js-tailwind'],
    kitFiles: ['Dock.tsx', 'Dock.css'],
    tags: ['navigation', 'nav', 'menu', 'dock', 'navbar'],
  }),
  entry({
    id: 'lattice-loader',
    name: 'LatticeLoader',
    category: 'Loading state',
    description: 'Animated lattice grid loader for loading states.',
    sourceUrl: `${RB_BASE}/Micro/LatticeLoader/LatticeLoader.tsx`,
    dependencies: [],
    compatibility: 'React 18/19; CSS animation.',
    styling: 'css-file',
    variants: ['ts-default', 'ts-tailwind', 'js-default', 'js-tailwind'],
    kitFiles: ['LatticeLoader.tsx', 'LatticeLoader.css'],
    tags: ['loading', 'loader', 'spinner', 'skeleton'],
  }),
]

/** Expansion entry -> registry entry. Descriptions stay pure; provenance
 *  notes ride in `compatibility` so the UI summary stays one-line honest. */
function expansionEntry(e: ExpansionEntry): FrontendComponentMeta {
  const depText = e.dependencies.length > 0 ? e.dependencies.join(', ') : 'no JavaScript dependencies'
  const stylingText = e.styling === 'css-file' ? 'ships its own CSS file' : 'uses inline styles'
  return entry({
    id: e.id,
    name: e.name,
    category: e.category,
    description: e.description,
    sourceUrl: `${REACT_BITS_REPO}/blob/${EXPANSION_COMMIT}/src/ts-default/${e.sourceDir}`,
    dependencies: e.dependencies,
    compatibility: `React 18/19 client component (${stylingText}); requires ${depText}.${e.note ? ` Note: ${e.note}` : ''}`,
    styling: e.styling,
    variants: ['ts-default'],
    kitFiles: e.kitFiles,
    adaptedFrom: e.adaptedFrom,
    upstreamCommit: EXPANSION_COMMIT,
    tags: e.tags,
  })
}

/** Known upstream components deliberately NOT installed — recorded honestly
 *  (never advertised as available in BEAN). Every exclusion states its
 *  verified reason (extra dependencies, remote-runtime requirements). */
const NOT_INSTALLED: FrontendComponentMeta[] = EXPANSION_EXCLUSIONS.map((e: ExcludedEntry) =>
  entry({
    id: e.id,
    name: e.name,
    category: e.category,
    description: `Upstream React Bits component (${e.category.toLowerCase()}) that BEAN does NOT install.`,
    sourceUrl: `${REACT_BITS_REPO}/blob/${EXPANSION_COMMIT}/src/ts-default/${e.sourceDir}`,
    dependencies: e.dependencies,
    compatibility: 'Not installed in BEAN — see the recorded exclusion reason.',
    styling: 'inline',
    variants: ['ts-default'],
    kitFiles: [],
    installed: false,
    notInstalledReason: e.reason,
    upstreamCommit: EXPANSION_COMMIT,
    tags: [],
  }),
)

export const COMPONENT_CATALOG: FrontendComponentMeta[] = [...ORIGINAL_CATALOG, ...EXPANSION_ENTRIES.map(expansionEntry)]

export const NOT_INSTALLED_CATALOG: FrontendComponentMeta[] = NOT_INSTALLED

export const FULL_CATALOG: FrontendComponentMeta[] = [...COMPONENT_CATALOG, ...NOT_INSTALLED_CATALOG]

const CATALOG_BY_ID = new Map(FULL_CATALOG.map((c) => [c.id, c]))

export function getCatalogEntry(id: string): FrontendComponentMeta | undefined {
  return CATALOG_BY_ID.get(id)
}

/** Keyword-driven auto-selection: catalogue components whose tags match the
 *  request text. Bounded to keep generated projects focused (max 5). */
export function autoSelectComponents(message: string, limit = 5): string[] {
  const text = message.toLowerCase()
  const picked: string[] = []
  for (const c of COMPONENT_CATALOG) {
    if (picked.length >= limit) break
    if (c.tags.some((t) => text.includes(t)) && !picked.includes(c.id)) picked.push(c.id)
  }
  return picked
}
