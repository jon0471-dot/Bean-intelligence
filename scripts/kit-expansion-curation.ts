#!/usr/bin/env bun
/**
 * One-shot expansion curation (NOT part of the app): vendors every COMPATIBLE
 * free React Bits component from the read-only /tmp/react-bits checkout into
 * the BEAN giftz-kit folder, preserving the EXISTING 17 integrations verbatim
 * (they stay pinned to their original upstream commit), and emits:
 *   - scripts/kit-expansion-out/selection.json   (authoritative selection evidence)
 *   - src/lib/frontend-intel/catalog-expansion.ts (registry data for the new set)
 * The React Bits repository itself is never copied wholesale.
 *
 * Compatibility rule (binding): a component is selected only when its bare
 * imports are a subset of { gsap, @gsap/react, motion } — `motion/react` is
 * adapted to `framer-motion` exactly like the two components adapted in the
 * original integration (recorded per entry in `adaptedFrom`). Everything else
 * is EXCLUDED with a recorded reason (unapproved extra dependencies).
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import path from 'path'

const SRC = '/tmp/react-bits/src/ts-default'
const DEST = '/home/z/my-project/src/components/giftz-kit'
const OUT = '/home/z/my-project/scripts/kit-expansion-out'
const UPSTREAM_COMMIT = 'cf2801031f07f53d4684e65b961bde7c2e2a6921'
const APPROVED = new Set(['gsap', '@gsap/react', 'motion'])
/** The 17 components vendored in the original integration (commit 4e0d091…).
 *  They are PRESERVED verbatim — never re-vendored from the newer commit. */
const EXISTING = new Set([
  'SplitText', 'TextType', 'BlurText', 'ShinyText', 'GradientText', 'CountUp', 'ScrollReveal',
  'AnimatedContent', 'StarBorder', 'ClickSpark', 'GlareHover', 'SpotlightCard', 'GlassSurface',
  'LetterGlitch', 'DotGrid', 'Dock', 'LatticeLoader',
])

/** Components that pass the dependency rule but are excluded for other
 *  verified reasons (each stated honestly in the registry). */
const FORCED_EXCLUSIONS: Record<string, string> = {
  GridScan:
    'Loads face-api.js and its model weights from a CDN at runtime (remote script + model injection) — incompatible with the offline/CSP contract for generated projects.',
}

/** Minimal, behavior-preserving type annotations applied on top of the
 *  verbatim source so files pass BEAN's strict TypeScript gate. Every fix is
 *  recorded in the file header and the registry (`note`). */
const TYPE_FIXES: Record<string, Array<[string, string]>> = {
  ChromaGrid: [['const stops = [];', 'const stops: string[] = [];']],
  GlowCursor: [['const bloom = [];', 'const bloom: Target[] = [];']],
  PixelSwap: [
    ['let timer = 0;', 'let timer: number | ReturnType<typeof setTimeout> = 0;'],
  ],
  ScrollVelocity: [['const spans = [];', 'const spans: React.ReactElement[] = [];']],
}

interface Selected {
  name: string
  category: string
  deps: string[]
  adapted: boolean
  typeFixed: boolean
  css: boolean
  description: string
  tags: string[]
  note?: string
}

// ---- Curated per-component registry text (hand-authored, one line each) ----
// Descriptions state what the component does; tags drive the engine's
// conservative auto-selection (keyword match against the user's request).
const CURATED: Record<string, { d: string; t: string[]; note?: string }> = {
  // ---------- Backgrounds (canvas/WebGL-free ones are zero-dep) ----------
  Aurora: { d: 'Silk-like animated aurora gradient background (WebGL shader, zero-dep implementation).', t: ['background', 'aurora', 'gradient', 'hero background'], note: 'Previously not installed (needed ogl at the older pinned commit); the current free implementation is self-contained.' },
  Particles: { d: 'Interactive particle-field background that reacts to the pointer (canvas, zero-dep implementation).', t: ['background', 'particles', 'interactive background'], note: 'Previously not installed (needed ogl at the older pinned commit); the current free implementation is self-contained.' },
  Waves: { d: 'Animated wave-lines background drawn on canvas.', t: ['background', 'waves', 'lines'] },
  Silk: { d: 'Flowing silk-like background using layered canvas gradients.', t: ['background', 'silk', 'smooth'] },
  Beams: { d: 'Light-beam sweep background rendered on canvas.', t: ['background', 'beams', 'light'] },
  Lightning: { d: 'Procedural lightning-strike canvas background.', t: ['background', 'lightning', 'storm', 'energy'] },
  DarkVeil: { d: 'Dark veil shader background with slow smoky motion.', t: ['background', 'dark', 'veil', 'smoke'] },
  GridScan: { d: 'Sci-fi grid scanning background with a moving highlight line.', t: ['background', 'grid', 'scan', 'sci-fi'] },
  Radar: { d: 'Radar-sweep background with blips and rotating beam.', t: ['background', 'radar', 'scan', 'dashboard'] },
  SoftAurora: { d: 'Soft blurred aurora gradient background (canvas).', t: ['background', 'aurora', 'soft', 'gradient'] },
  Balatro: { d: 'Animated card-suit style background inspired by Balatro (canvas).', t: ['background', 'game', 'cards', 'playful'] },
  LightRays: { d: 'Volumetric light rays emanating from a point (canvas).', t: ['background', 'light', 'rays', 'hero'] },
  PlasmaWave: { d: 'Flowing plasma-wave background (canvas).', t: ['background', 'plasma', 'wave'] },
  DotField: { d: 'Animated dot-field background with gentle motion.', t: ['background', 'dots', 'field'] },
  LightTunnel: { d: 'Light-tunnel perspective background (canvas).', t: ['background', 'tunnel', 'light', 'perspective'] },
  Galaxy: { d: 'Rotating star-field galaxy background (canvas).', t: ['background', 'galaxy', 'stars', 'space'] },
  Topography: { d: 'Animated topographic contour-line background (canvas).', t: ['background', 'topography', 'contour', 'map'] },
  GradientWaves: { d: 'Smooth gradient waves background (canvas).', t: ['background', 'gradient', 'waves'] },
  SlicedWaves: { d: 'Sliced wave layers background with parallax motion (canvas).', t: ['background', 'waves', 'layers'] },
  Ballpit: { d: 'Interactive bouncing-balls canvas background.', t: ['background', 'balls', 'playful', 'physics'] },
  Lightfall: { d: 'Falling light streaks background (canvas).', t: ['background', 'light', 'falling'] },
  RippleGrid: { d: 'Rippling grid background that reacts to the pointer (canvas).', t: ['background', 'grid', 'ripple', 'interactive'] },
  PixelBlast: { d: 'Pixel-explosion effect background (canvas).', t: ['background', 'pixel', 'retro', 'game'] },
  LiquidEther: { d: 'Liquid ether fluid-simulation background (WebGL shaders, zero-dep implementation).', t: ['background', 'liquid', 'fluid', 'simulation'] },
  Ferrofluid: { d: 'Magnetic ferrofluid-style blob background (canvas).', t: ['background', 'ferrofluid', 'blob', 'magnetic'] },
  PixelSnow: { d: 'Pixelated snowfall background (canvas).', t: ['background', 'snow', 'pixel', 'winter'] },
  ShapeGrid: { d: 'Grid of animated shapes forming a background (canvas).', t: ['background', 'grid', 'shapes'] },
  Antigravity: { d: 'Floating anti-gravity particle background (canvas).', t: ['background', 'particles', 'floating'] },
  GridMotion: { d: 'Grid of items animating with scroll motion.', t: ['background', 'grid', 'scroll'] },
  Plasma: { d: 'Classic plasma-flow shader background (canvas).', t: ['background', 'plasma', 'retro'] },
  SideRays: { d: 'Side light rays background for hero sections (canvas).', t: ['background', 'rays', 'hero', 'light'] },
  FloatingLines: { d: 'Floating line-field background with gentle drift (canvas).', t: ['background', 'lines', 'minimal'] },
  GridDistortion: { d: 'Distorted grid background reacting to the pointer (canvas).', t: ['background', 'grid', 'distortion', 'interactive'] },
  MagnetLines: { d: 'Lines that bend toward the pointer like magnetic field lines (canvas).', t: ['background', 'magnet', 'lines', 'interactive'] },
  AcidSquares: { d: 'Psychedelic animated squares background (canvas).', t: ['background', 'squares', 'retro', 'playful'] },
  GradientBlinds: { d: 'Gradient blinds (vertical slats) background (canvas).', t: ['background', 'gradient', 'blinds'] },
  GradientASCII: { d: 'ASCII-character gradient background (canvas).', t: ['background', 'ascii', 'terminal', 'retro'] },
  FaultyTerminal: { d: 'Faulty CRT terminal background with scanline glitches (canvas).', t: ['background', 'terminal', 'crt', 'glitch', 'retro'] },
  Threads: { d: 'Wavy thread-strands background (canvas).', t: ['background', 'threads', 'lines'] },
  Dither: { d: 'Dithered gradient background with a retro 1-bit feel (canvas).', t: ['background', 'dither', 'retro', '1-bit'] },
  MagicRings: { d: 'Concentric magic rings background with pulse motion (canvas).', t: ['background', 'rings', 'magic'] },
  GhostFibers: { d: 'Flowing ghost fiber strands background (canvas).', t: ['background', 'fibers', 'flow'] },
  WebThreads: { d: 'Web-thread network strands background (canvas).', t: ['background', 'threads', 'network'] },
  LiquidChrome: { d: 'Liquid chrome metal-flow background (canvas).', t: ['background', 'chrome', 'metal', 'liquid'] },
  FluxLines: { d: 'Flux line-field background with directional flow (canvas).', t: ['background', 'flux', 'lines'] },
  MoltenMetal: { d: 'Molten-metal slow-flow background (canvas).', t: ['background', 'metal', 'lava'] },
  CRTWarp: { d: 'CRT warp background with curvature and scanlines (canvas).', t: ['background', 'crt', 'retro', 'scanlines'] },
  LightPillar: { d: 'Vertical light pillar background for hero sections (canvas).', t: ['background', 'pillar', 'light', 'hero'] },
  Scanner: { d: 'Scanner sweep background with a detection line (canvas).', t: ['background', 'scanner', 'scan', 'security'] },
  Orb: { d: 'Glowing orb background with soft pulsing motion (canvas).', t: ['background', 'orb', 'glow'] },
  Grainient: { d: 'Grainy gradient background with film grain (canvas).', t: ['background', 'grain', 'gradient'] },
  PrismaticBurst: { d: 'Prismatic light burst background (canvas).', t: ['background', 'prism', 'burst', 'light'] },
  Iridescence: { d: 'Iridescent shimmer background (canvas).', t: ['background', 'iridescent', 'shimmer', 'holographic'] },
  LineWaves: { d: 'Interference line-waves background (canvas).', t: ['background', 'lines', 'waves'] },
  Prism: { d: 'Prismatic refraction background (canvas).', t: ['background', 'prism', 'light'] },

  // ---------- Micro-interactions ----------
  FlyingButton: { d: 'Button whose label particles fly apart on click.', t: ['button', 'micro-interaction', 'playful'] },
  HoldButton: { d: 'Hold-to-confirm button with progress ring.', t: ['button', 'hold', 'confirm', 'micro-interaction'] },
  Shredder: { d: 'Paper-shredder style card dismissal interaction.', t: ['card', 'dismiss', 'micro-interaction', 'playful'] },
  SloshGauge: { d: 'Liquid sloshing gauge for progress/loading states.', t: ['gauge', 'progress', 'loading', 'liquid'] },

  ScrubField: { d: 'Scrub-to-fill input field with drag interaction.', t: ['input', 'scrub', 'form', 'micro-interaction'] },
  DodgeField: { d: 'Input field whose placeholder dodges the pointer until focused.', t: ['input', 'playful', 'micro-interaction'] },
  WakeSlider: { d: 'Slider that wakes with a ripple as the thumb moves.', t: ['slider', 'input', 'micro-interaction'] },
  TearTicket: { d: 'Ticket-style element that tears apart on activation.', t: ['ticket', 'coupon', 'micro-interaction', 'playful'] },
  FlipCard: { d: 'Two-sided card that flips on hover/tap.', t: ['card', 'flip', 'hover'] },
  CometDial: { d: 'Dial control with a comet-trail indicator.', t: ['dial', 'control', 'micro-interaction'] },
  JellyRadio: { d: 'Radio buttons with a jelly squish animation.', t: ['radio', 'form', 'playful', 'micro-interaction'] },
  SquishSwitch: { d: 'Toggle switch with a satisfying squish animation.', t: ['switch', 'toggle', 'micro-interaction'] },
  WarmTooltip: { d: 'Tooltip that warms up (glows) before appearing.', t: ['tooltip', 'hover', 'micro-interaction'] },
  StatusMark: { d: 'Animated status indicator (pulse, success, warning states).', t: ['status', 'indicator', 'badge'] },
  RubberSegment: { d: 'Rubber-band segmented progress/control element.', t: ['segment', 'progress', 'playful'] },

  // ---------- Components (UI) ----------
  DecayCard: { d: 'Image card with a decay/dissolve hover effect (image supplied via props).', t: ['card', 'image', 'hover', 'gallery'], note: 'Default image is a remote URL; supply your own image for offline preview.' },
  LineSidebar: { d: 'Sidebar navigation with an animated active-line indicator.', t: ['sidebar', 'navigation', 'nav'] },
  InfiniteSpiral: { d: 'Infinite spiral gallery/carousel of items.', t: ['carousel', 'gallery', 'spiral'] },
  CircularCarousel: { d: 'Circular carousel with rotating item positions.', t: ['carousel', 'circular', 'gallery'] },
  DriftWall: { d: 'Image wall whose tiles drift slowly (images via props).', t: ['gallery', 'wall', 'background', 'images'], note: 'Default images are remote URLs; supply your own for offline preview.' },
  BorderGlow: { d: 'Card/panel with an animated glowing border.', t: ['card', 'border', 'glow'] },
  CurvedInput: { d: 'Text input rendered along a curved path.', t: ['input', 'text', 'form', 'creative'] },
  BounceCards: { d: 'Stacked cards that bounce apart on hover.', t: ['cards', 'stack', 'hover', 'gallery'] },
  ScrollStack: { d: 'Cards that stack/pin as the user scrolls.', t: ['cards', 'scroll', 'stack'] },
  OptionWheel: { d: 'Scrollable option wheel (dial-style selector).', t: ['selector', 'wheel', 'options'] },
  ChromaGrid: { d: 'Card grid with chromatic aberration hover effect.', t: ['grid', 'cards', 'hover', 'gallery'] },
  Folder: { d: 'Interactive folder that opens to reveal items.', t: ['folder', 'files', 'playful'] },
  FluidGlass: { d: 'Fluid glass refraction effect over content (zero-dep implementation).', t: ['glass', 'fluid', 'refraction', 'hero'] },
  GooeyNav: { d: 'Navigation with a gooey blob active indicator (SVG filter).', t: ['nav', 'navigation', 'gooey', 'menu'] },
  PixelCard: { d: 'Card with pixel-dissolve hover transition.', t: ['card', 'pixel', 'hover', 'retro'] },
  InfiniteMenu: { d: 'Infinite draggable image menu (zero-dep implementation).', t: ['menu', 'gallery', 'interactive'] },
  CircularGallery: { d: 'Bendable circular gallery of images (images via props).', t: ['gallery', 'circular', 'images'], note: 'Default images are remote URLs; supply your own for offline preview.' },
  StaggeredMenu: { d: 'Full-screen staggered menu with GSAP-animated reveal.', t: ['menu', 'navigation', 'gsap', 'overlay'] },
  FlyingPosters: { d: 'Posters that fly/scatter in 3D-ish perspective on pointer move (zero-dep implementation).', t: ['gallery', 'posters', 'interactive'] },
  GlassIcons: { d: 'Glassmorphism icon buttons with hover effects.', t: ['icons', 'glass', 'buttons'] },
  SpecularButton: { d: 'Button with a specular highlight sweep.', t: ['button', 'cta', 'highlight'] },
  HoloCard: { d: 'Holographic trading-card effect that tilts with the pointer.', t: ['card', 'holographic', 'tilt', 'hover'] },
  PillNav: { d: 'Pill-shaped navigation with sliding active indicator.', t: ['nav', 'navigation', 'pill', 'menu'] },
  Counter: { d: 'Animated number counter with separators/suffixes (component).', t: ['counter', 'stats', 'number', 'metrics'] },
  TiltedCard: { d: 'Card that tilts in 3D following the pointer.', t: ['card', 'tilt', '3d', 'hover'] },
  BubbleMenu: { d: 'Expanding bubble menu with GSAP animation.', t: ['menu', 'bubble', 'fab', 'gsap'] },
  AccordionGallery: { d: 'Accordion-style expanding gallery (GSAP).', t: ['accordion', 'gallery', 'gsap'] },
  DepthCarousel: { d: 'Carousel with depth/parallax layering (GSAP).', t: ['carousel', 'depth', 'parallax', 'gsap'] },
  Stack: { d: 'Card stack with drag-to-throw interaction (framer-motion).', t: ['cards', 'stack', 'drag', 'swipe'] },

  // ---------- Text animations ----------
  EchoText: { d: 'Text with an echoing trail of copies behind it.', t: ['text', 'echo', 'heading', 'trippy'] },
  MaskedHeading: { d: 'Heading revealed through an animated mask (GSAP).', t: ['heading', 'mask', 'reveal', 'gsap'] },
  ScrambledText: { d: 'Text that scrambles/decodes into place (GSAP).', t: ['text', 'scramble', 'decode', 'hacker'] },
  CurvedLoop: { d: 'Marquee text flowing along a curved SVG path.', t: ['text', 'marquee', 'curved', 'loop'] },
  FuzzyText: { d: 'Fuzzy/furry edged text effect (canvas).', t: ['text', 'fuzzy', 'heading'] },
  SplitFlapText: { d: 'Airport split-flap board style text animation.', t: ['text', 'split-flap', 'airport', 'retro'] },
  TextCursor: { d: 'Text with a demo typing cursor/pointer trail.', t: ['text', 'cursor', 'typing'] },
  GlitchText: { d: 'Glitching text effect with RGB split.', t: ['text', 'glitch', 'cyber'] },
  ScrollFloat: { d: 'Text that floats in per-character on scroll (GSAP).', t: ['text', 'scroll', 'reveal', 'gsap'] },
  FoldText: { d: 'Text that folds/unfolds line by line (GSAP).', t: ['text', 'fold', 'reveal', 'gsap'] },
  DepthText: { d: 'Text with layered depth/parallax shadow.', t: ['text', 'depth', '3d', 'shadow'] },
  TextPressure: { d: 'Text whose glyphs flex with pointer proximity (variable font via prop).', t: ['text', 'variable font', 'interactive', 'hero'], note: 'Uses a remote variable-font by default; falls back to system fonts offline.' },
  ParticleText: { d: 'Text rendered as interactive particles (canvas).', t: ['text', 'particles', 'interactive'] },
  StrokeText: { d: 'Outlined stroke text that animates on scroll (GSAP).', t: ['text', 'stroke', 'outline', 'gsap'] },
  Shuffle: { d: 'Text that shuffles through characters into place (@gsap/react).', t: ['text', 'shuffle', 'decode'] },
  ASCIIText: { d: 'Text rendered as animated ASCII glyphs (canvas).', t: ['text', 'ascii', 'terminal', 'retro'] },
  TechText: { d: 'Hi-tech HUD style text effect (canvas).', t: ['text', 'tech', 'hud', 'sci-fi'] },
  TextLoop: { d: 'Looping rotating text phrases (GSAP).', t: ['text', 'loop', 'rotating', 'phrases'] },
  VariableProximity: { d: 'Text whose weight shifts with pointer proximity (variable font via prop).', t: ['text', 'variable font', 'proximity', 'heading'], note: 'Uses a remote variable-font by default; falls back to system fonts offline.' },
  RotatingText: { d: 'Word rotator with animated transitions (framer-motion).', t: ['text', 'rotating', 'words', 'hero'] },
  CircularText: { d: 'Text arranged in a circle, optionally spinning (framer-motion).', t: ['text', 'circular', 'badge', 'spin'] },
  ScrollVelocity: { d: 'Scroll-velocity-reactive marquee text (framer-motion).', t: ['text', 'marquee', 'scroll', 'velocity'] },
  TrueFocus: { d: 'Focus-frame text effect that moves between words (framer-motion).', t: ['text', 'focus', 'frame', 'heading'] },
  DecryptedText: { d: 'Matrix-style decrypting text (framer-motion).', t: ['text', 'decrypt', 'matrix', 'hacker'] },

  // ---------- Animations (general) ----------
  ElectricBorder: { d: 'Animated electric/lightning border for cards or panels.', t: ['border', 'electric', 'card', 'glow'] },
  Magnet: { d: 'Element that magnetically follows the pointer within bounds.', t: ['magnet', 'hover', 'micro-interaction', 'cta'] },
  HalftoneReveal: { d: 'Halftone-dot image reveal on scroll (image via props).', t: ['halftone', 'image', 'reveal', 'retro'], note: 'Default image is a remote URL; supply your own for offline preview.' },
  Cubes: { d: 'Interactive grid of 3D-looking cubes reacting to the pointer.', t: ['cubes', 'grid', 'interactive'] },
  Strands: { d: 'Flowing strand-field animation (image/canvas).', t: ['strands', 'flow', 'background'] },
  OrbitImages: { d: 'Images orbiting a center point (images via props).', t: ['orbit', 'images', 'gallery'] },
  ShapeBlur: { d: 'SVG shape with animated gooey blur trail.', t: ['shape', 'blur', 'gooey', 'svg'] },
  LaserFlow: { d: 'Laser-flow light animation across an image (image via props).', t: ['laser', 'light', 'image'], note: 'Default image is a remote URL; supply your own for offline preview.' },
  Ribbons: { d: 'Flowing ribbon trails animation (canvas).', t: ['ribbons', 'flow', 'background'] },
  SplashCursor: { d: 'Fluid splash cursor that paints behind the pointer (WebGL fluid, zero-dep implementation).', t: ['cursor', 'fluid', 'splash', 'playful'] },
  LogoLoop: { d: 'Infinite logo marquee loop.', t: ['logo', 'marquee', 'loop', 'social proof'] },
  MetallicPaint: { d: 'Metallic-paint swirl that follows the pointer (canvas).', t: ['metallic', 'paint', 'interactive'] },
  PixelTransition: { d: 'Content revealed through a pixel-grid transition.', t: ['pixel', 'transition', 'card', 'retro'] },
  StickerPeel: { d: 'Peelable sticker interaction over content (image via props).', t: ['sticker', 'peel', 'playful'], note: 'Default image is a remote URL; supply your own for offline preview.' },
  GhostCursor: { d: 'Ghost-trail cursor effect (canvas).', t: ['cursor', 'trail', 'ghost'] },
  GlowCursor: { d: 'Glowing cursor spotlight effect (canvas).', t: ['cursor', 'glow', 'spotlight'] },
  ScrollExpand: { d: 'Section that expands to full view as the user scrolls.', t: ['scroll', 'expand', 'section'] },
  PixelSwap: { d: 'Pixelated image swap transition (images via props).', t: ['pixel', 'image', 'swap'], note: 'Default images are remote URLs; supply your own for offline preview.' },
  Noise: { d: 'Film-grain noise overlay with blend modes.', t: ['noise', 'grain', 'overlay', 'texture'] },
  GradualBlur: { d: 'Progressive edge blur overlay (top/bottom).', t: ['blur', 'overlay', 'scroll'] },
  PixelTrail: { d: 'Pixel trail that follows the pointer (canvas).', t: ['cursor', 'pixel', 'trail', 'playful'] },
  FadeContent: { d: 'Simple fade-in wrapper when content enters the viewport (GSAP).', t: ['fade', 'reveal', 'content', 'gsap'] },
  TargetCursor: { d: 'Target/crosshair cursor effect with trailing ring.', t: ['cursor', 'target', 'crosshair'] },
  CursorGrid: { d: 'Grid of cells that light up around the pointer.', t: ['cursor', 'grid', 'interactive'] },
  MetaBalls: { d: 'Gooey metaballs that chase the pointer (SVG filter).', t: ['metaballs', 'gooey', 'pointer', 'playful'] },
  ElasticMesh: { d: 'Elastic mesh deformation reacting to the pointer (canvas).', t: ['mesh', 'elastic', 'interactive'] },
  SwarmCursor: { d: 'Swarm of dots that follows the pointer (canvas).', t: ['cursor', 'swarm', 'dots', 'playful'] },
  ImageTrail: { d: 'Image trail that follows the pointer (GSAP; images via props).', t: ['cursor', 'image', 'trail', 'gsap'], note: 'Default images are remote URLs; supply your own for offline preview.' },
  Crosshair: { d: 'Crosshair lines that track the pointer across the page.', t: ['cursor', 'crosshair', 'pointer'] },
}

const EXCLUSION_REASONS: Record<string, string> = {
  ogl: 'Requires the extra `ogl` WebGL library — dependency not approved for BEAN generated projects.',
  three: 'Requires a direct `three` dependency outside the approved Vanta contract — not approved.',
  vgpu: "Requires React Bits' private `vgpu` WebGPU package (not published for standalone use) — cannot be vendored.",
  'matter-js': 'Requires the `matter-js` physics engine — dependency not approved.',
  '@use-gesture/react': 'Requires the `@use-gesture/react` package — dependency not approved.',
  '@react-three/fiber': 'Requires the @react-three/fiber + drei stack — not approved.',
  '@hugeicons/react': 'Requires the @hugeicons icon packages (license/count not approved for generated projects) — not approved.',
  '@hugeicons/core-free-icons': 'Requires the @hugeicons icon packages (license/count not approved for generated projects) — not approved.',
}

mkdirSync(OUT, { recursive: true })
const selected: Selected[] = []
const excluded: Array<{ name: string; category: string; deps: string[]; reason: string }> = []
let preserved = 0

for (const cat of readdirSync(SRC, { withFileTypes: true }).filter((d) => d.isDirectory())) {
  const dir = path.join(SRC, cat.name)
  for (const comp of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    const cdir = path.join(dir, comp.name)
    const tsxPath = path.join(cdir, `${comp.name}.tsx`)
    if (!existsSync(tsxPath)) continue
    const content = readFileSync(tsxPath, 'utf8')
    const deps = new Set<string>()
    const re = /(?:from\s+|import\s+|import\()['"]([^.'"/][^'"]*)['"]/g
    let m: RegExpExecArray | null
    while ((m = re.exec(content)) !== null) {
      const spec = m[1]!
      const root = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
      if (root !== 'react' && root !== 'react-dom' && root !== 'react/jsx-runtime') deps.add(root)
    }
    const depList = [...deps].sort()
    if (FORCED_EXCLUSIONS[comp.name]) {
      excluded.push({ name: comp.name, category: cat.name, deps: depList, reason: FORCED_EXCLUSIONS[comp.name]! })
      continue
    }
    const compatible = depList.every((d) => APPROVED.has(d))
    if (!compatible) {
      const reason =
        EXCLUSION_REASONS[depList.find((d) => EXCLUSION_REASONS[d]) ?? ''] ??
        `Requires unapproved dependencies: ${depList.join(', ')}.`
      excluded.push({ name: comp.name, category: cat.name, deps: depList, reason })
      continue
    }
    if (EXISTING.has(comp.name)) {
      preserved += 1
      continue
    }
    const curated = CURATED[comp.name]
    if (!curated) throw new Error(`kit-expansion: missing curated description for ${cat.name}/${comp.name}`)
    const upstreamUrl = `https://github.com/DavidHDev/react-bits/blob/${UPSTREAM_COMMIT}/src/ts-default/${cat.name}/${comp.name}`
    const hasCss = existsSync(path.join(cdir, `${comp.name}.css`))
    const adapted = depList.includes('motion')
    const typeFixed = (TYPE_FIXES[comp.name] ?? []).length > 0
    let tsx = readFileSync(tsxPath, 'utf8')
    if (adapted) tsx = tsx.replaceAll('motion/react', 'framer-motion')
    for (const [from, to] of TYPE_FIXES[comp.name] ?? []) {
      if (!tsx.includes(from)) throw new Error(`kit-expansion: type-fix source drift for ${comp.name}: '${from}' not found`)
      tsx = tsx.replace(from, to)
    }
    const fixNote = typeFixed
      ? ` Included with ${TYPE_FIXES[comp.name]!.length} recorded, behavior-preserving TypeScript annotation(s) so the file passes BEAN's strict tsc gate.`
      : ''
    const headerLines = [
      '/**',
      ` * ${comp.name} — React Bits (https://reactbits.dev) — MIT + Commons Clause v1.0.`,
      ` * Upstream source: ${upstreamUrl}`,
      ' * Copyright (c) 2026 David Haz. Use as part of an application, website or',
      ' * product is permitted; the components themselves may not be sold or',
      ' * redistributed standalone. Full notices: docs/THIRD-PARTY-NOTICES.md.',
      adapted
        ? " * Adapted for BEAN Intelligence: import source 'motion/react' -> 'framer-motion'."
        : ' * Included verbatim (this attribution header added) by BEAN Intelligence.',
      ...(curated.note ? [` * Note: ${curated.note}`] : []),
      ...(typeFixed ? [` * Type adaptation:${fixNote}`] : []),
      ' */',
      '',
    ]
    writeFileSync(path.join(DEST, `${comp.name}.tsx`), headerLines.join('\n') + tsx)
    if (hasCss) {
      const css = readFileSync(path.join(cdir, `${comp.name}.css`), 'utf8')
      const cssHeader = `/* ${comp.name}.css — React Bits (https://reactbits.dev) — MIT + Commons Clause v1.0.\n * Upstream: ${upstreamUrl}/${comp.name}.css — Copyright (c) 2026 David Haz.\n * Included by BEAN Intelligence; notices: docs/THIRD-PARTY-NOTICES.md. */\n\n`
      writeFileSync(path.join(DEST, `${comp.name}.css`), cssHeader + css)
    }
    selected.push({
      name: comp.name,
      category: cat.name,
      deps: depList,
      adapted,
      typeFixed,
      css: hasCss,
      description: curated.d,
      tags: curated.t,
      note: curated.note,
    })
  }
}

// The catalog data module (committed source of truth for the new entries).
const catMap: Record<string, string> = {
  Backgrounds: 'Background effect',
  Animations: 'General animation',
  Components: 'UI component',
  Micro: 'Micro-interaction',
  TextAnimations: 'Text animation',
}
const regEntries = selected.map((s) => {
  // The adapted import source IS a real dependency of the vendored file:
  // `motion/react` -> `framer-motion` (exact pin recorded in the registry).
  const deps = s.deps.map((d) => (d === 'motion' ? 'framer-motion' : d))
  const adaptedBits = [
    s.adapted ? "import source 'motion/react' -> 'framer-motion'" : null,
    s.typeFixed ? 'recorded TypeScript annotations (behavior-preserving)' : null,
  ].filter((b): b is string => b !== null)
  const adaptedFrom = adaptedBits.length > 0 ? adaptedBits.join('; ') : undefined
  return {
    id: s.name
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
      .toLowerCase(),
    name: s.name,
    category: catMap[s.category] ?? s.category,
    description: s.description,
    dependencies: deps,
    styling: s.css ? 'css-file' : 'inline',
    kitFiles: s.css ? [`${s.name}.tsx`, `${s.name}.css`] : [`${s.name}.tsx`],
    tags: s.tags,
    adaptedFrom,
    note: s.note,
    upstreamCategory: s.category,
    sourceDir: `${s.category}/${s.name}`,
  }
})

const catalogModule = `/**
 * BEAN Intelligence — React Bits expansion registry data (auto-derived by
 * scripts/kit-expansion-curation.ts from the upstream free collection at
 * commit ${UPSTREAM_COMMIT}; descriptions and tags are curated by BEAN).
 *
 * This module is DATA ONLY: no logic. The curated registry in catalog.ts
 * merges these entries with the original 17 integrations (pinned to the
 * older upstream commit, preserved verbatim).
 *
 * License: React Bits — MIT + Commons Clause v1.0 (see docs/THIRD-PARTY-NOTICES.md).
 */

export interface ExpansionEntry {
  id: string
  name: string
  category: string
  description: string
  dependencies: string[]
  styling: 'css-file' | 'inline'
  kitFiles: string[]
  tags: string[]
  adaptedFrom?: string
  note?: string
  upstreamCategory: string
  sourceDir: string
}

export const EXPANSION_COMMIT = '${UPSTREAM_COMMIT}'

export const EXPANSION_ENTRIES: ExpansionEntry[] = ${JSON.stringify(regEntries, null, 2)}

export interface ExcludedEntry {
  id: string
  name: string
  category: string
  dependencies: string[]
  reason: string
  upstreamCategory: string
  sourceDir: string
}

export const EXPANSION_EXCLUSIONS: ExcludedEntry[] = ${JSON.stringify(
    excluded.map((e) => ({
      id: e.name
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
        .toLowerCase(),
      name: e.name,
      category: catMap[e.category] ?? e.category,
      dependencies: e.deps,
      reason: e.reason,
      upstreamCategory: e.category,
      sourceDir: `${e.category}/${e.name}`,
    })),
    null,
    2,
  )}
`

writeFileSync('/home/z/my-project/src/lib/frontend-intel/catalog-expansion.ts', catalogModule)
writeFileSync(
  path.join(OUT, 'selection.json'),
  JSON.stringify({ upstreamCommit: UPSTREAM_COMMIT, preservedExisting: preserved, selected, excluded }, null, 2),
)
console.log(`preserved existing: ${preserved}`)
console.log(`newly vendored: ${selected.length}`)
console.log(`excluded: ${excluded.length}`)
for (const s of selected) console.log(`  + ${s.category}/${s.name}${s.css ? ' (+css)' : ''}${s.adapted ? ' (adapted)' : ''}`)
for (const e of excluded) console.log(`  - ${e.category}/${e.name}: ${e.reason}`)
