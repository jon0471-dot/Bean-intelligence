/**
 * BEAN Intelligence — React Bits expansion registry data (auto-derived by
 * scripts/kit-expansion-curation.ts from the upstream free collection at
 * commit cf2801031f07f53d4684e65b961bde7c2e2a6921; descriptions and tags are curated by BEAN).
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

export const EXPANSION_COMMIT = 'cf2801031f07f53d4684e65b961bde7c2e2a6921'

export const EXPANSION_ENTRIES: ExpansionEntry[] = [
  {
    "id": "dark-veil",
    "name": "DarkVeil",
    "category": "Background effect",
    "description": "Dark veil shader background with slow smoky motion.",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "DarkVeil.tsx",
      "DarkVeil.css"
    ],
    "tags": [
      "background",
      "dark",
      "veil",
      "smoke"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/DarkVeil"
  },
  {
    "id": "lightning",
    "name": "Lightning",
    "category": "Background effect",
    "description": "Procedural lightning-strike canvas background.",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "Lightning.tsx",
      "Lightning.css"
    ],
    "tags": [
      "background",
      "lightning",
      "storm",
      "energy"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/Lightning"
  },
  {
    "id": "silk",
    "name": "Silk",
    "category": "Background effect",
    "description": "Flowing silk-like background using layered canvas gradients.",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "Silk.tsx",
      "Silk.css"
    ],
    "tags": [
      "background",
      "silk",
      "smooth"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/Silk"
  },
  {
    "id": "radar",
    "name": "Radar",
    "category": "Background effect",
    "description": "Radar-sweep background with blips and rotating beam.",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "Radar.tsx",
      "Radar.css"
    ],
    "tags": [
      "background",
      "radar",
      "scan",
      "dashboard"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/Radar"
  },
  {
    "id": "particles",
    "name": "Particles",
    "category": "Background effect",
    "description": "Interactive particle-field background that reacts to the pointer (canvas, zero-dep implementation).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "Particles.tsx",
      "Particles.css"
    ],
    "tags": [
      "background",
      "particles",
      "interactive background"
    ],
    "note": "Previously not installed (needed ogl at the older pinned commit); the current free implementation is self-contained.",
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/Particles"
  },
  {
    "id": "soft-aurora",
    "name": "SoftAurora",
    "category": "Background effect",
    "description": "Soft blurred aurora gradient background (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "SoftAurora.tsx",
      "SoftAurora.css"
    ],
    "tags": [
      "background",
      "aurora",
      "soft",
      "gradient"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/SoftAurora"
  },
  {
    "id": "balatro",
    "name": "Balatro",
    "category": "Background effect",
    "description": "Animated card-suit style background inspired by Balatro (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "Balatro.tsx",
      "Balatro.css"
    ],
    "tags": [
      "background",
      "game",
      "cards",
      "playful"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/Balatro"
  },
  {
    "id": "light-rays",
    "name": "LightRays",
    "category": "Background effect",
    "description": "Volumetric light rays emanating from a point (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "LightRays.tsx",
      "LightRays.css"
    ],
    "tags": [
      "background",
      "light",
      "rays",
      "hero"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/LightRays"
  },
  {
    "id": "plasma-wave",
    "name": "PlasmaWave",
    "category": "Background effect",
    "description": "Flowing plasma-wave background (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "PlasmaWave.tsx",
      "PlasmaWave.css"
    ],
    "tags": [
      "background",
      "plasma",
      "wave"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/PlasmaWave"
  },
  {
    "id": "dot-field",
    "name": "DotField",
    "category": "Background effect",
    "description": "Animated dot-field background with gentle motion.",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "DotField.tsx",
      "DotField.css"
    ],
    "tags": [
      "background",
      "dots",
      "field"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/DotField"
  },
  {
    "id": "light-tunnel",
    "name": "LightTunnel",
    "category": "Background effect",
    "description": "Light-tunnel perspective background (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "LightTunnel.tsx",
      "LightTunnel.css"
    ],
    "tags": [
      "background",
      "tunnel",
      "light",
      "perspective"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/LightTunnel"
  },
  {
    "id": "galaxy",
    "name": "Galaxy",
    "category": "Background effect",
    "description": "Rotating star-field galaxy background (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "Galaxy.tsx",
      "Galaxy.css"
    ],
    "tags": [
      "background",
      "galaxy",
      "stars",
      "space"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/Galaxy"
  },
  {
    "id": "topography",
    "name": "Topography",
    "category": "Background effect",
    "description": "Animated topographic contour-line background (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "Topography.tsx",
      "Topography.css"
    ],
    "tags": [
      "background",
      "topography",
      "contour",
      "map"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/Topography"
  },
  {
    "id": "gradient-waves",
    "name": "GradientWaves",
    "category": "Background effect",
    "description": "Smooth gradient waves background (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "GradientWaves.tsx",
      "GradientWaves.css"
    ],
    "tags": [
      "background",
      "gradient",
      "waves"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/GradientWaves"
  },
  {
    "id": "sliced-waves",
    "name": "SlicedWaves",
    "category": "Background effect",
    "description": "Sliced wave layers background with parallax motion (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "SlicedWaves.tsx",
      "SlicedWaves.css"
    ],
    "tags": [
      "background",
      "waves",
      "layers"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/SlicedWaves"
  },
  {
    "id": "ballpit",
    "name": "Ballpit",
    "category": "Background effect",
    "description": "Interactive bouncing-balls canvas background.",
    "dependencies": [],
    "styling": "inline",
    "kitFiles": [
      "Ballpit.tsx"
    ],
    "tags": [
      "background",
      "balls",
      "playful",
      "physics"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/Ballpit"
  },
  {
    "id": "lightfall",
    "name": "Lightfall",
    "category": "Background effect",
    "description": "Falling light streaks background (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "Lightfall.tsx",
      "Lightfall.css"
    ],
    "tags": [
      "background",
      "light",
      "falling"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/Lightfall"
  },
  {
    "id": "ripple-grid",
    "name": "RippleGrid",
    "category": "Background effect",
    "description": "Rippling grid background that reacts to the pointer (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "RippleGrid.tsx",
      "RippleGrid.css"
    ],
    "tags": [
      "background",
      "grid",
      "ripple",
      "interactive"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/RippleGrid"
  },
  {
    "id": "aurora",
    "name": "Aurora",
    "category": "Background effect",
    "description": "Silk-like animated aurora gradient background (WebGL shader, zero-dep implementation).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "Aurora.tsx",
      "Aurora.css"
    ],
    "tags": [
      "background",
      "aurora",
      "gradient",
      "hero background"
    ],
    "note": "Previously not installed (needed ogl at the older pinned commit); the current free implementation is self-contained.",
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/Aurora"
  },
  {
    "id": "pixel-blast",
    "name": "PixelBlast",
    "category": "Background effect",
    "description": "Pixel-explosion effect background (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "PixelBlast.tsx",
      "PixelBlast.css"
    ],
    "tags": [
      "background",
      "pixel",
      "retro",
      "game"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/PixelBlast"
  },
  {
    "id": "liquid-ether",
    "name": "LiquidEther",
    "category": "Background effect",
    "description": "Liquid ether fluid-simulation background (WebGL shaders, zero-dep implementation).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "LiquidEther.tsx",
      "LiquidEther.css"
    ],
    "tags": [
      "background",
      "liquid",
      "fluid",
      "simulation"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/LiquidEther"
  },
  {
    "id": "ferrofluid",
    "name": "Ferrofluid",
    "category": "Background effect",
    "description": "Magnetic ferrofluid-style blob background (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "Ferrofluid.tsx",
      "Ferrofluid.css"
    ],
    "tags": [
      "background",
      "ferrofluid",
      "blob",
      "magnetic"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/Ferrofluid"
  },
  {
    "id": "pixel-snow",
    "name": "PixelSnow",
    "category": "Background effect",
    "description": "Pixelated snowfall background (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "PixelSnow.tsx",
      "PixelSnow.css"
    ],
    "tags": [
      "background",
      "snow",
      "pixel",
      "winter"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/PixelSnow"
  },
  {
    "id": "shape-grid",
    "name": "ShapeGrid",
    "category": "Background effect",
    "description": "Grid of animated shapes forming a background (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "ShapeGrid.tsx",
      "ShapeGrid.css"
    ],
    "tags": [
      "background",
      "grid",
      "shapes"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/ShapeGrid"
  },
  {
    "id": "antigravity",
    "name": "Antigravity",
    "category": "Background effect",
    "description": "Floating anti-gravity particle background (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "Antigravity.tsx",
      "Antigravity.css"
    ],
    "tags": [
      "background",
      "particles",
      "floating"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/Antigravity"
  },
  {
    "id": "grid-motion",
    "name": "GridMotion",
    "category": "Background effect",
    "description": "Grid of items animating with scroll motion.",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "GridMotion.tsx",
      "GridMotion.css"
    ],
    "tags": [
      "background",
      "grid",
      "scroll"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/GridMotion"
  },
  {
    "id": "plasma",
    "name": "Plasma",
    "category": "Background effect",
    "description": "Classic plasma-flow shader background (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "Plasma.tsx",
      "Plasma.css"
    ],
    "tags": [
      "background",
      "plasma",
      "retro"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/Plasma"
  },
  {
    "id": "beams",
    "name": "Beams",
    "category": "Background effect",
    "description": "Light-beam sweep background rendered on canvas.",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "Beams.tsx",
      "Beams.css"
    ],
    "tags": [
      "background",
      "beams",
      "light"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/Beams"
  },
  {
    "id": "side-rays",
    "name": "SideRays",
    "category": "Background effect",
    "description": "Side light rays background for hero sections (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "SideRays.tsx",
      "SideRays.css"
    ],
    "tags": [
      "background",
      "rays",
      "hero",
      "light"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/SideRays"
  },
  {
    "id": "floating-lines",
    "name": "FloatingLines",
    "category": "Background effect",
    "description": "Floating line-field background with gentle drift (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "FloatingLines.tsx",
      "FloatingLines.css"
    ],
    "tags": [
      "background",
      "lines",
      "minimal"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/FloatingLines"
  },
  {
    "id": "grid-distortion",
    "name": "GridDistortion",
    "category": "Background effect",
    "description": "Distorted grid background reacting to the pointer (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "GridDistortion.tsx",
      "GridDistortion.css"
    ],
    "tags": [
      "background",
      "grid",
      "distortion",
      "interactive"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/GridDistortion"
  },
  {
    "id": "magnet-lines",
    "name": "MagnetLines",
    "category": "Background effect",
    "description": "Lines that bend toward the pointer like magnetic field lines (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "MagnetLines.tsx",
      "MagnetLines.css"
    ],
    "tags": [
      "background",
      "magnet",
      "lines",
      "interactive"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/MagnetLines"
  },
  {
    "id": "acid-squares",
    "name": "AcidSquares",
    "category": "Background effect",
    "description": "Psychedelic animated squares background (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "AcidSquares.tsx",
      "AcidSquares.css"
    ],
    "tags": [
      "background",
      "squares",
      "retro",
      "playful"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/AcidSquares"
  },
  {
    "id": "gradient-blinds",
    "name": "GradientBlinds",
    "category": "Background effect",
    "description": "Gradient blinds (vertical slats) background (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "GradientBlinds.tsx",
      "GradientBlinds.css"
    ],
    "tags": [
      "background",
      "gradient",
      "blinds"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/GradientBlinds"
  },
  {
    "id": "gradient-ascii",
    "name": "GradientASCII",
    "category": "Background effect",
    "description": "ASCII-character gradient background (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "GradientASCII.tsx",
      "GradientASCII.css"
    ],
    "tags": [
      "background",
      "ascii",
      "terminal",
      "retro"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/GradientASCII"
  },
  {
    "id": "faulty-terminal",
    "name": "FaultyTerminal",
    "category": "Background effect",
    "description": "Faulty CRT terminal background with scanline glitches (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "FaultyTerminal.tsx",
      "FaultyTerminal.css"
    ],
    "tags": [
      "background",
      "terminal",
      "crt",
      "glitch",
      "retro"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/FaultyTerminal"
  },
  {
    "id": "threads",
    "name": "Threads",
    "category": "Background effect",
    "description": "Wavy thread-strands background (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "Threads.tsx",
      "Threads.css"
    ],
    "tags": [
      "background",
      "threads",
      "lines"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/Threads"
  },
  {
    "id": "dither",
    "name": "Dither",
    "category": "Background effect",
    "description": "Dithered gradient background with a retro 1-bit feel (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "Dither.tsx",
      "Dither.css"
    ],
    "tags": [
      "background",
      "dither",
      "retro",
      "1-bit"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/Dither"
  },
  {
    "id": "magic-rings",
    "name": "MagicRings",
    "category": "Background effect",
    "description": "Concentric magic rings background with pulse motion (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "MagicRings.tsx",
      "MagicRings.css"
    ],
    "tags": [
      "background",
      "rings",
      "magic"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/MagicRings"
  },
  {
    "id": "ghost-fibers",
    "name": "GhostFibers",
    "category": "Background effect",
    "description": "Flowing ghost fiber strands background (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "GhostFibers.tsx",
      "GhostFibers.css"
    ],
    "tags": [
      "background",
      "fibers",
      "flow"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/GhostFibers"
  },
  {
    "id": "web-threads",
    "name": "WebThreads",
    "category": "Background effect",
    "description": "Web-thread network strands background (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "WebThreads.tsx",
      "WebThreads.css"
    ],
    "tags": [
      "background",
      "threads",
      "network"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/WebThreads"
  },
  {
    "id": "liquid-chrome",
    "name": "LiquidChrome",
    "category": "Background effect",
    "description": "Liquid chrome metal-flow background (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "LiquidChrome.tsx",
      "LiquidChrome.css"
    ],
    "tags": [
      "background",
      "chrome",
      "metal",
      "liquid"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/LiquidChrome"
  },
  {
    "id": "flux-lines",
    "name": "FluxLines",
    "category": "Background effect",
    "description": "Flux line-field background with directional flow (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "FluxLines.tsx",
      "FluxLines.css"
    ],
    "tags": [
      "background",
      "flux",
      "lines"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/FluxLines"
  },
  {
    "id": "molten-metal",
    "name": "MoltenMetal",
    "category": "Background effect",
    "description": "Molten-metal slow-flow background (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "MoltenMetal.tsx",
      "MoltenMetal.css"
    ],
    "tags": [
      "background",
      "metal",
      "lava"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/MoltenMetal"
  },
  {
    "id": "waves",
    "name": "Waves",
    "category": "Background effect",
    "description": "Animated wave-lines background drawn on canvas.",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "Waves.tsx",
      "Waves.css"
    ],
    "tags": [
      "background",
      "waves",
      "lines"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/Waves"
  },
  {
    "id": "crt-warp",
    "name": "CRTWarp",
    "category": "Background effect",
    "description": "CRT warp background with curvature and scanlines (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "CRTWarp.tsx",
      "CRTWarp.css"
    ],
    "tags": [
      "background",
      "crt",
      "retro",
      "scanlines"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/CRTWarp"
  },
  {
    "id": "light-pillar",
    "name": "LightPillar",
    "category": "Background effect",
    "description": "Vertical light pillar background for hero sections (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "LightPillar.tsx",
      "LightPillar.css"
    ],
    "tags": [
      "background",
      "pillar",
      "light",
      "hero"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/LightPillar"
  },
  {
    "id": "scanner",
    "name": "Scanner",
    "category": "Background effect",
    "description": "Scanner sweep background with a detection line (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "Scanner.tsx",
      "Scanner.css"
    ],
    "tags": [
      "background",
      "scanner",
      "scan",
      "security"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/Scanner"
  },
  {
    "id": "orb",
    "name": "Orb",
    "category": "Background effect",
    "description": "Glowing orb background with soft pulsing motion (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "Orb.tsx",
      "Orb.css"
    ],
    "tags": [
      "background",
      "orb",
      "glow"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/Orb"
  },
  {
    "id": "grainient",
    "name": "Grainient",
    "category": "Background effect",
    "description": "Grainy gradient background with film grain (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "Grainient.tsx",
      "Grainient.css"
    ],
    "tags": [
      "background",
      "grain",
      "gradient"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/Grainient"
  },
  {
    "id": "prismatic-burst",
    "name": "PrismaticBurst",
    "category": "Background effect",
    "description": "Prismatic light burst background (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "PrismaticBurst.tsx",
      "PrismaticBurst.css"
    ],
    "tags": [
      "background",
      "prism",
      "burst",
      "light"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/PrismaticBurst"
  },
  {
    "id": "iridescence",
    "name": "Iridescence",
    "category": "Background effect",
    "description": "Iridescent shimmer background (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "Iridescence.tsx",
      "Iridescence.css"
    ],
    "tags": [
      "background",
      "iridescent",
      "shimmer",
      "holographic"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/Iridescence"
  },
  {
    "id": "line-waves",
    "name": "LineWaves",
    "category": "Background effect",
    "description": "Interference line-waves background (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "LineWaves.tsx",
      "LineWaves.css"
    ],
    "tags": [
      "background",
      "lines",
      "waves"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/LineWaves"
  },
  {
    "id": "prism",
    "name": "Prism",
    "category": "Background effect",
    "description": "Prismatic refraction background (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "Prism.tsx",
      "Prism.css"
    ],
    "tags": [
      "background",
      "prism",
      "light"
    ],
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/Prism"
  },
  {
    "id": "scrub-field",
    "name": "ScrubField",
    "category": "Micro-interaction",
    "description": "Scrub-to-fill input field with drag interaction.",
    "dependencies": [
      "framer-motion"
    ],
    "styling": "css-file",
    "kitFiles": [
      "ScrubField.tsx",
      "ScrubField.css"
    ],
    "tags": [
      "input",
      "scrub",
      "form",
      "micro-interaction"
    ],
    "adaptedFrom": "import source 'motion/react' -> 'framer-motion'",
    "upstreamCategory": "Micro",
    "sourceDir": "Micro/ScrubField"
  },
  {
    "id": "dodge-field",
    "name": "DodgeField",
    "category": "Micro-interaction",
    "description": "Input field whose placeholder dodges the pointer until focused.",
    "dependencies": [
      "framer-motion"
    ],
    "styling": "css-file",
    "kitFiles": [
      "DodgeField.tsx",
      "DodgeField.css"
    ],
    "tags": [
      "input",
      "playful",
      "micro-interaction"
    ],
    "adaptedFrom": "import source 'motion/react' -> 'framer-motion'",
    "upstreamCategory": "Micro",
    "sourceDir": "Micro/DodgeField"
  },
  {
    "id": "wake-slider",
    "name": "WakeSlider",
    "category": "Micro-interaction",
    "description": "Slider that wakes with a ripple as the thumb moves.",
    "dependencies": [
      "framer-motion"
    ],
    "styling": "css-file",
    "kitFiles": [
      "WakeSlider.tsx",
      "WakeSlider.css"
    ],
    "tags": [
      "slider",
      "input",
      "micro-interaction"
    ],
    "adaptedFrom": "import source 'motion/react' -> 'framer-motion'",
    "upstreamCategory": "Micro",
    "sourceDir": "Micro/WakeSlider"
  },
  {
    "id": "flying-button",
    "name": "FlyingButton",
    "category": "Micro-interaction",
    "description": "Button whose label particles fly apart on click.",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "FlyingButton.tsx",
      "FlyingButton.css"
    ],
    "tags": [
      "button",
      "micro-interaction",
      "playful"
    ],
    "upstreamCategory": "Micro",
    "sourceDir": "Micro/FlyingButton"
  },
  {
    "id": "tear-ticket",
    "name": "TearTicket",
    "category": "Micro-interaction",
    "description": "Ticket-style element that tears apart on activation.",
    "dependencies": [
      "framer-motion"
    ],
    "styling": "css-file",
    "kitFiles": [
      "TearTicket.tsx",
      "TearTicket.css"
    ],
    "tags": [
      "ticket",
      "coupon",
      "micro-interaction",
      "playful"
    ],
    "adaptedFrom": "import source 'motion/react' -> 'framer-motion'",
    "upstreamCategory": "Micro",
    "sourceDir": "Micro/TearTicket"
  },
  {
    "id": "flip-card",
    "name": "FlipCard",
    "category": "Micro-interaction",
    "description": "Two-sided card that flips on hover/tap.",
    "dependencies": [
      "framer-motion"
    ],
    "styling": "css-file",
    "kitFiles": [
      "FlipCard.tsx",
      "FlipCard.css"
    ],
    "tags": [
      "card",
      "flip",
      "hover"
    ],
    "adaptedFrom": "import source 'motion/react' -> 'framer-motion'",
    "upstreamCategory": "Micro",
    "sourceDir": "Micro/FlipCard"
  },
  {
    "id": "comet-dial",
    "name": "CometDial",
    "category": "Micro-interaction",
    "description": "Dial control with a comet-trail indicator.",
    "dependencies": [
      "framer-motion"
    ],
    "styling": "css-file",
    "kitFiles": [
      "CometDial.tsx",
      "CometDial.css"
    ],
    "tags": [
      "dial",
      "control",
      "micro-interaction"
    ],
    "adaptedFrom": "import source 'motion/react' -> 'framer-motion'",
    "upstreamCategory": "Micro",
    "sourceDir": "Micro/CometDial"
  },
  {
    "id": "jelly-radio",
    "name": "JellyRadio",
    "category": "Micro-interaction",
    "description": "Radio buttons with a jelly squish animation.",
    "dependencies": [
      "framer-motion"
    ],
    "styling": "css-file",
    "kitFiles": [
      "JellyRadio.tsx",
      "JellyRadio.css"
    ],
    "tags": [
      "radio",
      "form",
      "playful",
      "micro-interaction"
    ],
    "adaptedFrom": "import source 'motion/react' -> 'framer-motion'",
    "upstreamCategory": "Micro",
    "sourceDir": "Micro/JellyRadio"
  },
  {
    "id": "squish-switch",
    "name": "SquishSwitch",
    "category": "Micro-interaction",
    "description": "Toggle switch with a satisfying squish animation.",
    "dependencies": [
      "framer-motion"
    ],
    "styling": "css-file",
    "kitFiles": [
      "SquishSwitch.tsx",
      "SquishSwitch.css"
    ],
    "tags": [
      "switch",
      "toggle",
      "micro-interaction"
    ],
    "adaptedFrom": "import source 'motion/react' -> 'framer-motion'",
    "upstreamCategory": "Micro",
    "sourceDir": "Micro/SquishSwitch"
  },
  {
    "id": "hold-button",
    "name": "HoldButton",
    "category": "Micro-interaction",
    "description": "Hold-to-confirm button with progress ring.",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "HoldButton.tsx",
      "HoldButton.css"
    ],
    "tags": [
      "button",
      "hold",
      "confirm",
      "micro-interaction"
    ],
    "upstreamCategory": "Micro",
    "sourceDir": "Micro/HoldButton"
  },
  {
    "id": "warm-tooltip",
    "name": "WarmTooltip",
    "category": "Micro-interaction",
    "description": "Tooltip that warms up (glows) before appearing.",
    "dependencies": [
      "framer-motion"
    ],
    "styling": "css-file",
    "kitFiles": [
      "WarmTooltip.tsx",
      "WarmTooltip.css"
    ],
    "tags": [
      "tooltip",
      "hover",
      "micro-interaction"
    ],
    "adaptedFrom": "import source 'motion/react' -> 'framer-motion'",
    "upstreamCategory": "Micro",
    "sourceDir": "Micro/WarmTooltip"
  },
  {
    "id": "rubber-segment",
    "name": "RubberSegment",
    "category": "Micro-interaction",
    "description": "Rubber-band segmented progress/control element.",
    "dependencies": [
      "framer-motion"
    ],
    "styling": "css-file",
    "kitFiles": [
      "RubberSegment.tsx",
      "RubberSegment.css"
    ],
    "tags": [
      "segment",
      "progress",
      "playful"
    ],
    "adaptedFrom": "import source 'motion/react' -> 'framer-motion'",
    "upstreamCategory": "Micro",
    "sourceDir": "Micro/RubberSegment"
  },
  {
    "id": "shredder",
    "name": "Shredder",
    "category": "Micro-interaction",
    "description": "Paper-shredder style card dismissal interaction.",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "Shredder.tsx",
      "Shredder.css"
    ],
    "tags": [
      "card",
      "dismiss",
      "micro-interaction",
      "playful"
    ],
    "upstreamCategory": "Micro",
    "sourceDir": "Micro/Shredder"
  },
  {
    "id": "status-mark",
    "name": "StatusMark",
    "category": "Micro-interaction",
    "description": "Animated status indicator (pulse, success, warning states).",
    "dependencies": [
      "framer-motion"
    ],
    "styling": "css-file",
    "kitFiles": [
      "StatusMark.tsx",
      "StatusMark.css"
    ],
    "tags": [
      "status",
      "indicator",
      "badge"
    ],
    "adaptedFrom": "import source 'motion/react' -> 'framer-motion'",
    "upstreamCategory": "Micro",
    "sourceDir": "Micro/StatusMark"
  },
  {
    "id": "slosh-gauge",
    "name": "SloshGauge",
    "category": "Micro-interaction",
    "description": "Liquid sloshing gauge for progress/loading states.",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "SloshGauge.tsx",
      "SloshGauge.css"
    ],
    "tags": [
      "gauge",
      "progress",
      "loading",
      "liquid"
    ],
    "upstreamCategory": "Micro",
    "sourceDir": "Micro/SloshGauge"
  },
  {
    "id": "decay-card",
    "name": "DecayCard",
    "category": "UI component",
    "description": "Image card with a decay/dissolve hover effect (image supplied via props).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "DecayCard.tsx",
      "DecayCard.css"
    ],
    "tags": [
      "card",
      "image",
      "hover",
      "gallery"
    ],
    "note": "Default image is a remote URL; supply your own image for offline preview.",
    "upstreamCategory": "Components",
    "sourceDir": "Components/DecayCard"
  },
  {
    "id": "line-sidebar",
    "name": "LineSidebar",
    "category": "UI component",
    "description": "Sidebar navigation with an animated active-line indicator.",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "LineSidebar.tsx",
      "LineSidebar.css"
    ],
    "tags": [
      "sidebar",
      "navigation",
      "nav"
    ],
    "upstreamCategory": "Components",
    "sourceDir": "Components/LineSidebar"
  },
  {
    "id": "infinite-spiral",
    "name": "InfiniteSpiral",
    "category": "UI component",
    "description": "Infinite spiral gallery/carousel of items.",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "InfiniteSpiral.tsx",
      "InfiniteSpiral.css"
    ],
    "tags": [
      "carousel",
      "gallery",
      "spiral"
    ],
    "upstreamCategory": "Components",
    "sourceDir": "Components/InfiniteSpiral"
  },
  {
    "id": "circular-carousel",
    "name": "CircularCarousel",
    "category": "UI component",
    "description": "Circular carousel with rotating item positions.",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "CircularCarousel.tsx",
      "CircularCarousel.css"
    ],
    "tags": [
      "carousel",
      "circular",
      "gallery"
    ],
    "upstreamCategory": "Components",
    "sourceDir": "Components/CircularCarousel"
  },
  {
    "id": "drift-wall",
    "name": "DriftWall",
    "category": "UI component",
    "description": "Image wall whose tiles drift slowly (images via props).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "DriftWall.tsx",
      "DriftWall.css"
    ],
    "tags": [
      "gallery",
      "wall",
      "background",
      "images"
    ],
    "note": "Default images are remote URLs; supply your own for offline preview.",
    "upstreamCategory": "Components",
    "sourceDir": "Components/DriftWall"
  },
  {
    "id": "border-glow",
    "name": "BorderGlow",
    "category": "UI component",
    "description": "Card/panel with an animated glowing border.",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "BorderGlow.tsx",
      "BorderGlow.css"
    ],
    "tags": [
      "card",
      "border",
      "glow"
    ],
    "upstreamCategory": "Components",
    "sourceDir": "Components/BorderGlow"
  },
  {
    "id": "curved-input",
    "name": "CurvedInput",
    "category": "UI component",
    "description": "Text input rendered along a curved path.",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "CurvedInput.tsx",
      "CurvedInput.css"
    ],
    "tags": [
      "input",
      "text",
      "form",
      "creative"
    ],
    "upstreamCategory": "Components",
    "sourceDir": "Components/CurvedInput"
  },
  {
    "id": "bounce-cards",
    "name": "BounceCards",
    "category": "UI component",
    "description": "Stacked cards that bounce apart on hover.",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "BounceCards.tsx",
      "BounceCards.css"
    ],
    "tags": [
      "cards",
      "stack",
      "hover",
      "gallery"
    ],
    "upstreamCategory": "Components",
    "sourceDir": "Components/BounceCards"
  },
  {
    "id": "scroll-stack",
    "name": "ScrollStack",
    "category": "UI component",
    "description": "Cards that stack/pin as the user scrolls.",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "ScrollStack.tsx",
      "ScrollStack.css"
    ],
    "tags": [
      "cards",
      "scroll",
      "stack"
    ],
    "upstreamCategory": "Components",
    "sourceDir": "Components/ScrollStack"
  },
  {
    "id": "option-wheel",
    "name": "OptionWheel",
    "category": "UI component",
    "description": "Scrollable option wheel (dial-style selector).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "OptionWheel.tsx",
      "OptionWheel.css"
    ],
    "tags": [
      "selector",
      "wheel",
      "options"
    ],
    "upstreamCategory": "Components",
    "sourceDir": "Components/OptionWheel"
  },
  {
    "id": "chroma-grid",
    "name": "ChromaGrid",
    "category": "UI component",
    "description": "Card grid with chromatic aberration hover effect.",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "ChromaGrid.tsx",
      "ChromaGrid.css"
    ],
    "tags": [
      "grid",
      "cards",
      "hover",
      "gallery"
    ],
    "adaptedFrom": "recorded TypeScript annotations (behavior-preserving)",
    "upstreamCategory": "Components",
    "sourceDir": "Components/ChromaGrid"
  },
  {
    "id": "folder",
    "name": "Folder",
    "category": "UI component",
    "description": "Interactive folder that opens to reveal items.",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "Folder.tsx",
      "Folder.css"
    ],
    "tags": [
      "folder",
      "files",
      "playful"
    ],
    "upstreamCategory": "Components",
    "sourceDir": "Components/Folder"
  },
  {
    "id": "fluid-glass",
    "name": "FluidGlass",
    "category": "UI component",
    "description": "Fluid glass refraction effect over content (zero-dep implementation).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "FluidGlass.tsx",
      "FluidGlass.css"
    ],
    "tags": [
      "glass",
      "fluid",
      "refraction",
      "hero"
    ],
    "upstreamCategory": "Components",
    "sourceDir": "Components/FluidGlass"
  },
  {
    "id": "gooey-nav",
    "name": "GooeyNav",
    "category": "UI component",
    "description": "Navigation with a gooey blob active indicator (SVG filter).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "GooeyNav.tsx",
      "GooeyNav.css"
    ],
    "tags": [
      "nav",
      "navigation",
      "gooey",
      "menu"
    ],
    "upstreamCategory": "Components",
    "sourceDir": "Components/GooeyNav"
  },
  {
    "id": "pixel-card",
    "name": "PixelCard",
    "category": "UI component",
    "description": "Card with pixel-dissolve hover transition.",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "PixelCard.tsx",
      "PixelCard.css"
    ],
    "tags": [
      "card",
      "pixel",
      "hover",
      "retro"
    ],
    "upstreamCategory": "Components",
    "sourceDir": "Components/PixelCard"
  },
  {
    "id": "infinite-menu",
    "name": "InfiniteMenu",
    "category": "UI component",
    "description": "Infinite draggable image menu (zero-dep implementation).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "InfiniteMenu.tsx",
      "InfiniteMenu.css"
    ],
    "tags": [
      "menu",
      "gallery",
      "interactive"
    ],
    "upstreamCategory": "Components",
    "sourceDir": "Components/InfiniteMenu"
  },
  {
    "id": "circular-gallery",
    "name": "CircularGallery",
    "category": "UI component",
    "description": "Bendable circular gallery of images (images via props).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "CircularGallery.tsx",
      "CircularGallery.css"
    ],
    "tags": [
      "gallery",
      "circular",
      "images"
    ],
    "note": "Default images are remote URLs; supply your own for offline preview.",
    "upstreamCategory": "Components",
    "sourceDir": "Components/CircularGallery"
  },
  {
    "id": "staggered-menu",
    "name": "StaggeredMenu",
    "category": "UI component",
    "description": "Full-screen staggered menu with GSAP-animated reveal.",
    "dependencies": [
      "gsap"
    ],
    "styling": "css-file",
    "kitFiles": [
      "StaggeredMenu.tsx",
      "StaggeredMenu.css"
    ],
    "tags": [
      "menu",
      "navigation",
      "gsap",
      "overlay"
    ],
    "upstreamCategory": "Components",
    "sourceDir": "Components/StaggeredMenu"
  },
  {
    "id": "stack",
    "name": "Stack",
    "category": "UI component",
    "description": "Card stack with drag-to-throw interaction (framer-motion).",
    "dependencies": [
      "framer-motion"
    ],
    "styling": "css-file",
    "kitFiles": [
      "Stack.tsx",
      "Stack.css"
    ],
    "tags": [
      "cards",
      "stack",
      "drag",
      "swipe"
    ],
    "adaptedFrom": "import source 'motion/react' -> 'framer-motion'",
    "upstreamCategory": "Components",
    "sourceDir": "Components/Stack"
  },
  {
    "id": "flying-posters",
    "name": "FlyingPosters",
    "category": "UI component",
    "description": "Posters that fly/scatter in 3D-ish perspective on pointer move (zero-dep implementation).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "FlyingPosters.tsx",
      "FlyingPosters.css"
    ],
    "tags": [
      "gallery",
      "posters",
      "interactive"
    ],
    "upstreamCategory": "Components",
    "sourceDir": "Components/FlyingPosters"
  },
  {
    "id": "glass-icons",
    "name": "GlassIcons",
    "category": "UI component",
    "description": "Glassmorphism icon buttons with hover effects.",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "GlassIcons.tsx",
      "GlassIcons.css"
    ],
    "tags": [
      "icons",
      "glass",
      "buttons"
    ],
    "upstreamCategory": "Components",
    "sourceDir": "Components/GlassIcons"
  },
  {
    "id": "accordion-gallery",
    "name": "AccordionGallery",
    "category": "UI component",
    "description": "Accordion-style expanding gallery (GSAP).",
    "dependencies": [
      "gsap"
    ],
    "styling": "css-file",
    "kitFiles": [
      "AccordionGallery.tsx",
      "AccordionGallery.css"
    ],
    "tags": [
      "accordion",
      "gallery",
      "gsap"
    ],
    "upstreamCategory": "Components",
    "sourceDir": "Components/AccordionGallery"
  },
  {
    "id": "specular-button",
    "name": "SpecularButton",
    "category": "UI component",
    "description": "Button with a specular highlight sweep.",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "SpecularButton.tsx",
      "SpecularButton.css"
    ],
    "tags": [
      "button",
      "cta",
      "highlight"
    ],
    "upstreamCategory": "Components",
    "sourceDir": "Components/SpecularButton"
  },
  {
    "id": "holo-card",
    "name": "HoloCard",
    "category": "UI component",
    "description": "Holographic trading-card effect that tilts with the pointer.",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "HoloCard.tsx",
      "HoloCard.css"
    ],
    "tags": [
      "card",
      "holographic",
      "tilt",
      "hover"
    ],
    "upstreamCategory": "Components",
    "sourceDir": "Components/HoloCard"
  },
  {
    "id": "pill-nav",
    "name": "PillNav",
    "category": "UI component",
    "description": "Pill-shaped navigation with sliding active indicator.",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "PillNav.tsx",
      "PillNav.css"
    ],
    "tags": [
      "nav",
      "navigation",
      "pill",
      "menu"
    ],
    "upstreamCategory": "Components",
    "sourceDir": "Components/PillNav"
  },
  {
    "id": "counter",
    "name": "Counter",
    "category": "UI component",
    "description": "Animated number counter with separators/suffixes (component).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "Counter.tsx",
      "Counter.css"
    ],
    "tags": [
      "counter",
      "stats",
      "number",
      "metrics"
    ],
    "upstreamCategory": "Components",
    "sourceDir": "Components/Counter"
  },
  {
    "id": "depth-carousel",
    "name": "DepthCarousel",
    "category": "UI component",
    "description": "Carousel with depth/parallax layering (GSAP).",
    "dependencies": [
      "gsap"
    ],
    "styling": "css-file",
    "kitFiles": [
      "DepthCarousel.tsx",
      "DepthCarousel.css"
    ],
    "tags": [
      "carousel",
      "depth",
      "parallax",
      "gsap"
    ],
    "upstreamCategory": "Components",
    "sourceDir": "Components/DepthCarousel"
  },
  {
    "id": "tilted-card",
    "name": "TiltedCard",
    "category": "UI component",
    "description": "Card that tilts in 3D following the pointer.",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "TiltedCard.tsx",
      "TiltedCard.css"
    ],
    "tags": [
      "card",
      "tilt",
      "3d",
      "hover"
    ],
    "upstreamCategory": "Components",
    "sourceDir": "Components/TiltedCard"
  },
  {
    "id": "bubble-menu",
    "name": "BubbleMenu",
    "category": "UI component",
    "description": "Expanding bubble menu with GSAP animation.",
    "dependencies": [
      "gsap"
    ],
    "styling": "css-file",
    "kitFiles": [
      "BubbleMenu.tsx",
      "BubbleMenu.css"
    ],
    "tags": [
      "menu",
      "bubble",
      "fab",
      "gsap"
    ],
    "upstreamCategory": "Components",
    "sourceDir": "Components/BubbleMenu"
  },
  {
    "id": "echo-text",
    "name": "EchoText",
    "category": "Text animation",
    "description": "Text with an echoing trail of copies behind it.",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "EchoText.tsx",
      "EchoText.css"
    ],
    "tags": [
      "text",
      "echo",
      "heading",
      "trippy"
    ],
    "upstreamCategory": "TextAnimations",
    "sourceDir": "TextAnimations/EchoText"
  },
  {
    "id": "rotating-text",
    "name": "RotatingText",
    "category": "Text animation",
    "description": "Word rotator with animated transitions (framer-motion).",
    "dependencies": [
      "framer-motion"
    ],
    "styling": "css-file",
    "kitFiles": [
      "RotatingText.tsx",
      "RotatingText.css"
    ],
    "tags": [
      "text",
      "rotating",
      "words",
      "hero"
    ],
    "adaptedFrom": "import source 'motion/react' -> 'framer-motion'",
    "upstreamCategory": "TextAnimations",
    "sourceDir": "TextAnimations/RotatingText"
  },
  {
    "id": "masked-heading",
    "name": "MaskedHeading",
    "category": "Text animation",
    "description": "Heading revealed through an animated mask (GSAP).",
    "dependencies": [
      "gsap"
    ],
    "styling": "css-file",
    "kitFiles": [
      "MaskedHeading.tsx",
      "MaskedHeading.css"
    ],
    "tags": [
      "heading",
      "mask",
      "reveal",
      "gsap"
    ],
    "upstreamCategory": "TextAnimations",
    "sourceDir": "TextAnimations/MaskedHeading"
  },
  {
    "id": "scrambled-text",
    "name": "ScrambledText",
    "category": "Text animation",
    "description": "Text that scrambles/decodes into place (GSAP).",
    "dependencies": [
      "gsap"
    ],
    "styling": "css-file",
    "kitFiles": [
      "ScrambledText.tsx",
      "ScrambledText.css"
    ],
    "tags": [
      "text",
      "scramble",
      "decode",
      "hacker"
    ],
    "upstreamCategory": "TextAnimations",
    "sourceDir": "TextAnimations/ScrambledText"
  },
  {
    "id": "circular-text",
    "name": "CircularText",
    "category": "Text animation",
    "description": "Text arranged in a circle, optionally spinning (framer-motion).",
    "dependencies": [
      "framer-motion"
    ],
    "styling": "css-file",
    "kitFiles": [
      "CircularText.tsx",
      "CircularText.css"
    ],
    "tags": [
      "text",
      "circular",
      "badge",
      "spin"
    ],
    "adaptedFrom": "import source 'motion/react' -> 'framer-motion'",
    "upstreamCategory": "TextAnimations",
    "sourceDir": "TextAnimations/CircularText"
  },
  {
    "id": "scroll-velocity",
    "name": "ScrollVelocity",
    "category": "Text animation",
    "description": "Scroll-velocity-reactive marquee text (framer-motion).",
    "dependencies": [
      "framer-motion"
    ],
    "styling": "css-file",
    "kitFiles": [
      "ScrollVelocity.tsx",
      "ScrollVelocity.css"
    ],
    "tags": [
      "text",
      "marquee",
      "scroll",
      "velocity"
    ],
    "adaptedFrom": "import source 'motion/react' -> 'framer-motion'; recorded TypeScript annotations (behavior-preserving)",
    "upstreamCategory": "TextAnimations",
    "sourceDir": "TextAnimations/ScrollVelocity"
  },
  {
    "id": "curved-loop",
    "name": "CurvedLoop",
    "category": "Text animation",
    "description": "Marquee text flowing along a curved SVG path.",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "CurvedLoop.tsx",
      "CurvedLoop.css"
    ],
    "tags": [
      "text",
      "marquee",
      "curved",
      "loop"
    ],
    "upstreamCategory": "TextAnimations",
    "sourceDir": "TextAnimations/CurvedLoop"
  },
  {
    "id": "fuzzy-text",
    "name": "FuzzyText",
    "category": "Text animation",
    "description": "Fuzzy/furry edged text effect (canvas).",
    "dependencies": [],
    "styling": "inline",
    "kitFiles": [
      "FuzzyText.tsx"
    ],
    "tags": [
      "text",
      "fuzzy",
      "heading"
    ],
    "upstreamCategory": "TextAnimations",
    "sourceDir": "TextAnimations/FuzzyText"
  },
  {
    "id": "split-flap-text",
    "name": "SplitFlapText",
    "category": "Text animation",
    "description": "Airport split-flap board style text animation.",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "SplitFlapText.tsx",
      "SplitFlapText.css"
    ],
    "tags": [
      "text",
      "split-flap",
      "airport",
      "retro"
    ],
    "upstreamCategory": "TextAnimations",
    "sourceDir": "TextAnimations/SplitFlapText"
  },
  {
    "id": "text-cursor",
    "name": "TextCursor",
    "category": "Text animation",
    "description": "Text with a demo typing cursor/pointer trail.",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "TextCursor.tsx",
      "TextCursor.css"
    ],
    "tags": [
      "text",
      "cursor",
      "typing"
    ],
    "upstreamCategory": "TextAnimations",
    "sourceDir": "TextAnimations/TextCursor"
  },
  {
    "id": "glitch-text",
    "name": "GlitchText",
    "category": "Text animation",
    "description": "Glitching text effect with RGB split.",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "GlitchText.tsx",
      "GlitchText.css"
    ],
    "tags": [
      "text",
      "glitch",
      "cyber"
    ],
    "upstreamCategory": "TextAnimations",
    "sourceDir": "TextAnimations/GlitchText"
  },
  {
    "id": "scroll-float",
    "name": "ScrollFloat",
    "category": "Text animation",
    "description": "Text that floats in per-character on scroll (GSAP).",
    "dependencies": [
      "gsap"
    ],
    "styling": "css-file",
    "kitFiles": [
      "ScrollFloat.tsx",
      "ScrollFloat.css"
    ],
    "tags": [
      "text",
      "scroll",
      "reveal",
      "gsap"
    ],
    "upstreamCategory": "TextAnimations",
    "sourceDir": "TextAnimations/ScrollFloat"
  },
  {
    "id": "fold-text",
    "name": "FoldText",
    "category": "Text animation",
    "description": "Text that folds/unfolds line by line (GSAP).",
    "dependencies": [
      "gsap"
    ],
    "styling": "css-file",
    "kitFiles": [
      "FoldText.tsx",
      "FoldText.css"
    ],
    "tags": [
      "text",
      "fold",
      "reveal",
      "gsap"
    ],
    "upstreamCategory": "TextAnimations",
    "sourceDir": "TextAnimations/FoldText"
  },
  {
    "id": "depth-text",
    "name": "DepthText",
    "category": "Text animation",
    "description": "Text with layered depth/parallax shadow.",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "DepthText.tsx",
      "DepthText.css"
    ],
    "tags": [
      "text",
      "depth",
      "3d",
      "shadow"
    ],
    "upstreamCategory": "TextAnimations",
    "sourceDir": "TextAnimations/DepthText"
  },
  {
    "id": "text-pressure",
    "name": "TextPressure",
    "category": "Text animation",
    "description": "Text whose glyphs flex with pointer proximity (variable font via prop).",
    "dependencies": [],
    "styling": "inline",
    "kitFiles": [
      "TextPressure.tsx"
    ],
    "tags": [
      "text",
      "variable font",
      "interactive",
      "hero"
    ],
    "note": "Uses a remote variable-font by default; falls back to system fonts offline.",
    "upstreamCategory": "TextAnimations",
    "sourceDir": "TextAnimations/TextPressure"
  },
  {
    "id": "particle-text",
    "name": "ParticleText",
    "category": "Text animation",
    "description": "Text rendered as interactive particles (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "ParticleText.tsx",
      "ParticleText.css"
    ],
    "tags": [
      "text",
      "particles",
      "interactive"
    ],
    "upstreamCategory": "TextAnimations",
    "sourceDir": "TextAnimations/ParticleText"
  },
  {
    "id": "true-focus",
    "name": "TrueFocus",
    "category": "Text animation",
    "description": "Focus-frame text effect that moves between words (framer-motion).",
    "dependencies": [
      "framer-motion"
    ],
    "styling": "css-file",
    "kitFiles": [
      "TrueFocus.tsx",
      "TrueFocus.css"
    ],
    "tags": [
      "text",
      "focus",
      "frame",
      "heading"
    ],
    "adaptedFrom": "import source 'motion/react' -> 'framer-motion'",
    "upstreamCategory": "TextAnimations",
    "sourceDir": "TextAnimations/TrueFocus"
  },
  {
    "id": "stroke-text",
    "name": "StrokeText",
    "category": "Text animation",
    "description": "Outlined stroke text that animates on scroll (GSAP).",
    "dependencies": [
      "gsap"
    ],
    "styling": "css-file",
    "kitFiles": [
      "StrokeText.tsx",
      "StrokeText.css"
    ],
    "tags": [
      "text",
      "stroke",
      "outline",
      "gsap"
    ],
    "upstreamCategory": "TextAnimations",
    "sourceDir": "TextAnimations/StrokeText"
  },
  {
    "id": "decrypted-text",
    "name": "DecryptedText",
    "category": "Text animation",
    "description": "Matrix-style decrypting text (framer-motion).",
    "dependencies": [
      "framer-motion"
    ],
    "styling": "inline",
    "kitFiles": [
      "DecryptedText.tsx"
    ],
    "tags": [
      "text",
      "decrypt",
      "matrix",
      "hacker"
    ],
    "adaptedFrom": "import source 'motion/react' -> 'framer-motion'",
    "upstreamCategory": "TextAnimations",
    "sourceDir": "TextAnimations/DecryptedText"
  },
  {
    "id": "shuffle",
    "name": "Shuffle",
    "category": "Text animation",
    "description": "Text that shuffles through characters into place (@gsap/react).",
    "dependencies": [
      "@gsap/react",
      "gsap"
    ],
    "styling": "css-file",
    "kitFiles": [
      "Shuffle.tsx",
      "Shuffle.css"
    ],
    "tags": [
      "text",
      "shuffle",
      "decode"
    ],
    "upstreamCategory": "TextAnimations",
    "sourceDir": "TextAnimations/Shuffle"
  },
  {
    "id": "ascii-text",
    "name": "ASCIIText",
    "category": "Text animation",
    "description": "Text rendered as animated ASCII glyphs (canvas).",
    "dependencies": [],
    "styling": "inline",
    "kitFiles": [
      "ASCIIText.tsx"
    ],
    "tags": [
      "text",
      "ascii",
      "terminal",
      "retro"
    ],
    "upstreamCategory": "TextAnimations",
    "sourceDir": "TextAnimations/ASCIIText"
  },
  {
    "id": "tech-text",
    "name": "TechText",
    "category": "Text animation",
    "description": "Hi-tech HUD style text effect (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "TechText.tsx",
      "TechText.css"
    ],
    "tags": [
      "text",
      "tech",
      "hud",
      "sci-fi"
    ],
    "upstreamCategory": "TextAnimations",
    "sourceDir": "TextAnimations/TechText"
  },
  {
    "id": "text-loop",
    "name": "TextLoop",
    "category": "Text animation",
    "description": "Looping rotating text phrases (GSAP).",
    "dependencies": [
      "gsap"
    ],
    "styling": "css-file",
    "kitFiles": [
      "TextLoop.tsx",
      "TextLoop.css"
    ],
    "tags": [
      "text",
      "loop",
      "rotating",
      "phrases"
    ],
    "upstreamCategory": "TextAnimations",
    "sourceDir": "TextAnimations/TextLoop"
  },
  {
    "id": "variable-proximity",
    "name": "VariableProximity",
    "category": "Text animation",
    "description": "Text whose weight shifts with pointer proximity (variable font via prop).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "VariableProximity.tsx",
      "VariableProximity.css"
    ],
    "tags": [
      "text",
      "variable font",
      "proximity",
      "heading"
    ],
    "note": "Uses a remote variable-font by default; falls back to system fonts offline.",
    "upstreamCategory": "TextAnimations",
    "sourceDir": "TextAnimations/VariableProximity"
  },
  {
    "id": "electric-border",
    "name": "ElectricBorder",
    "category": "General animation",
    "description": "Animated electric/lightning border for cards or panels.",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "ElectricBorder.tsx",
      "ElectricBorder.css"
    ],
    "tags": [
      "border",
      "electric",
      "card",
      "glow"
    ],
    "upstreamCategory": "Animations",
    "sourceDir": "Animations/ElectricBorder"
  },
  {
    "id": "magnet",
    "name": "Magnet",
    "category": "General animation",
    "description": "Element that magnetically follows the pointer within bounds.",
    "dependencies": [],
    "styling": "inline",
    "kitFiles": [
      "Magnet.tsx"
    ],
    "tags": [
      "magnet",
      "hover",
      "micro-interaction",
      "cta"
    ],
    "upstreamCategory": "Animations",
    "sourceDir": "Animations/Magnet"
  },
  {
    "id": "halftone-reveal",
    "name": "HalftoneReveal",
    "category": "General animation",
    "description": "Halftone-dot image reveal on scroll (image via props).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "HalftoneReveal.tsx",
      "HalftoneReveal.css"
    ],
    "tags": [
      "halftone",
      "image",
      "reveal",
      "retro"
    ],
    "note": "Default image is a remote URL; supply your own for offline preview.",
    "upstreamCategory": "Animations",
    "sourceDir": "Animations/HalftoneReveal"
  },
  {
    "id": "cubes",
    "name": "Cubes",
    "category": "General animation",
    "description": "Interactive grid of 3D-looking cubes reacting to the pointer.",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "Cubes.tsx",
      "Cubes.css"
    ],
    "tags": [
      "cubes",
      "grid",
      "interactive"
    ],
    "upstreamCategory": "Animations",
    "sourceDir": "Animations/Cubes"
  },
  {
    "id": "strands",
    "name": "Strands",
    "category": "General animation",
    "description": "Flowing strand-field animation (image/canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "Strands.tsx",
      "Strands.css"
    ],
    "tags": [
      "strands",
      "flow",
      "background"
    ],
    "upstreamCategory": "Animations",
    "sourceDir": "Animations/Strands"
  },
  {
    "id": "orbit-images",
    "name": "OrbitImages",
    "category": "General animation",
    "description": "Images orbiting a center point (images via props).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "OrbitImages.tsx",
      "OrbitImages.css"
    ],
    "tags": [
      "orbit",
      "images",
      "gallery"
    ],
    "upstreamCategory": "Animations",
    "sourceDir": "Animations/OrbitImages"
  },
  {
    "id": "shape-blur",
    "name": "ShapeBlur",
    "category": "General animation",
    "description": "SVG shape with animated gooey blur trail.",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "ShapeBlur.tsx",
      "ShapeBlur.css"
    ],
    "tags": [
      "shape",
      "blur",
      "gooey",
      "svg"
    ],
    "upstreamCategory": "Animations",
    "sourceDir": "Animations/ShapeBlur"
  },
  {
    "id": "laser-flow",
    "name": "LaserFlow",
    "category": "General animation",
    "description": "Laser-flow light animation across an image (image via props).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "LaserFlow.tsx",
      "LaserFlow.css"
    ],
    "tags": [
      "laser",
      "light",
      "image"
    ],
    "note": "Default image is a remote URL; supply your own for offline preview.",
    "upstreamCategory": "Animations",
    "sourceDir": "Animations/LaserFlow"
  },
  {
    "id": "ribbons",
    "name": "Ribbons",
    "category": "General animation",
    "description": "Flowing ribbon trails animation (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "Ribbons.tsx",
      "Ribbons.css"
    ],
    "tags": [
      "ribbons",
      "flow",
      "background"
    ],
    "upstreamCategory": "Animations",
    "sourceDir": "Animations/Ribbons"
  },
  {
    "id": "splash-cursor",
    "name": "SplashCursor",
    "category": "General animation",
    "description": "Fluid splash cursor that paints behind the pointer (WebGL fluid, zero-dep implementation).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "SplashCursor.tsx",
      "SplashCursor.css"
    ],
    "tags": [
      "cursor",
      "fluid",
      "splash",
      "playful"
    ],
    "upstreamCategory": "Animations",
    "sourceDir": "Animations/SplashCursor"
  },
  {
    "id": "logo-loop",
    "name": "LogoLoop",
    "category": "General animation",
    "description": "Infinite logo marquee loop.",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "LogoLoop.tsx",
      "LogoLoop.css"
    ],
    "tags": [
      "logo",
      "marquee",
      "loop",
      "social proof"
    ],
    "upstreamCategory": "Animations",
    "sourceDir": "Animations/LogoLoop"
  },
  {
    "id": "metallic-paint",
    "name": "MetallicPaint",
    "category": "General animation",
    "description": "Metallic-paint swirl that follows the pointer (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "MetallicPaint.tsx",
      "MetallicPaint.css"
    ],
    "tags": [
      "metallic",
      "paint",
      "interactive"
    ],
    "upstreamCategory": "Animations",
    "sourceDir": "Animations/MetallicPaint"
  },
  {
    "id": "pixel-transition",
    "name": "PixelTransition",
    "category": "General animation",
    "description": "Content revealed through a pixel-grid transition.",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "PixelTransition.tsx",
      "PixelTransition.css"
    ],
    "tags": [
      "pixel",
      "transition",
      "card",
      "retro"
    ],
    "upstreamCategory": "Animations",
    "sourceDir": "Animations/PixelTransition"
  },
  {
    "id": "sticker-peel",
    "name": "StickerPeel",
    "category": "General animation",
    "description": "Peelable sticker interaction over content (image via props).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "StickerPeel.tsx",
      "StickerPeel.css"
    ],
    "tags": [
      "sticker",
      "peel",
      "playful"
    ],
    "note": "Default image is a remote URL; supply your own for offline preview.",
    "upstreamCategory": "Animations",
    "sourceDir": "Animations/StickerPeel"
  },
  {
    "id": "crosshair",
    "name": "Crosshair",
    "category": "General animation",
    "description": "Crosshair lines that track the pointer across the page.",
    "dependencies": [],
    "styling": "inline",
    "kitFiles": [
      "Crosshair.tsx"
    ],
    "tags": [
      "cursor",
      "crosshair",
      "pointer"
    ],
    "upstreamCategory": "Animations",
    "sourceDir": "Animations/Crosshair"
  },
  {
    "id": "ghost-cursor",
    "name": "GhostCursor",
    "category": "General animation",
    "description": "Ghost-trail cursor effect (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "GhostCursor.tsx",
      "GhostCursor.css"
    ],
    "tags": [
      "cursor",
      "trail",
      "ghost"
    ],
    "upstreamCategory": "Animations",
    "sourceDir": "Animations/GhostCursor"
  },
  {
    "id": "glow-cursor",
    "name": "GlowCursor",
    "category": "General animation",
    "description": "Glowing cursor spotlight effect (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "GlowCursor.tsx",
      "GlowCursor.css"
    ],
    "tags": [
      "cursor",
      "glow",
      "spotlight"
    ],
    "adaptedFrom": "recorded TypeScript annotations (behavior-preserving)",
    "upstreamCategory": "Animations",
    "sourceDir": "Animations/GlowCursor"
  },
  {
    "id": "scroll-expand",
    "name": "ScrollExpand",
    "category": "General animation",
    "description": "Section that expands to full view as the user scrolls.",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "ScrollExpand.tsx",
      "ScrollExpand.css"
    ],
    "tags": [
      "scroll",
      "expand",
      "section"
    ],
    "upstreamCategory": "Animations",
    "sourceDir": "Animations/ScrollExpand"
  },
  {
    "id": "pixel-swap",
    "name": "PixelSwap",
    "category": "General animation",
    "description": "Pixelated image swap transition (images via props).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "PixelSwap.tsx",
      "PixelSwap.css"
    ],
    "tags": [
      "pixel",
      "image",
      "swap"
    ],
    "adaptedFrom": "recorded TypeScript annotations (behavior-preserving)",
    "note": "Default images are remote URLs; supply your own for offline preview.",
    "upstreamCategory": "Animations",
    "sourceDir": "Animations/PixelSwap"
  },
  {
    "id": "noise",
    "name": "Noise",
    "category": "General animation",
    "description": "Film-grain noise overlay with blend modes.",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "Noise.tsx",
      "Noise.css"
    ],
    "tags": [
      "noise",
      "grain",
      "overlay",
      "texture"
    ],
    "upstreamCategory": "Animations",
    "sourceDir": "Animations/Noise"
  },
  {
    "id": "gradual-blur",
    "name": "GradualBlur",
    "category": "General animation",
    "description": "Progressive edge blur overlay (top/bottom).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "GradualBlur.tsx",
      "GradualBlur.css"
    ],
    "tags": [
      "blur",
      "overlay",
      "scroll"
    ],
    "upstreamCategory": "Animations",
    "sourceDir": "Animations/GradualBlur"
  },
  {
    "id": "pixel-trail",
    "name": "PixelTrail",
    "category": "General animation",
    "description": "Pixel trail that follows the pointer (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "PixelTrail.tsx",
      "PixelTrail.css"
    ],
    "tags": [
      "cursor",
      "pixel",
      "trail",
      "playful"
    ],
    "upstreamCategory": "Animations",
    "sourceDir": "Animations/PixelTrail"
  },
  {
    "id": "fade-content",
    "name": "FadeContent",
    "category": "General animation",
    "description": "Simple fade-in wrapper when content enters the viewport (GSAP).",
    "dependencies": [
      "gsap"
    ],
    "styling": "inline",
    "kitFiles": [
      "FadeContent.tsx"
    ],
    "tags": [
      "fade",
      "reveal",
      "content",
      "gsap"
    ],
    "upstreamCategory": "Animations",
    "sourceDir": "Animations/FadeContent"
  },
  {
    "id": "target-cursor",
    "name": "TargetCursor",
    "category": "General animation",
    "description": "Target/crosshair cursor effect with trailing ring.",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "TargetCursor.tsx",
      "TargetCursor.css"
    ],
    "tags": [
      "cursor",
      "target",
      "crosshair"
    ],
    "upstreamCategory": "Animations",
    "sourceDir": "Animations/TargetCursor"
  },
  {
    "id": "cursor-grid",
    "name": "CursorGrid",
    "category": "General animation",
    "description": "Grid of cells that light up around the pointer.",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "CursorGrid.tsx",
      "CursorGrid.css"
    ],
    "tags": [
      "cursor",
      "grid",
      "interactive"
    ],
    "upstreamCategory": "Animations",
    "sourceDir": "Animations/CursorGrid"
  },
  {
    "id": "meta-balls",
    "name": "MetaBalls",
    "category": "General animation",
    "description": "Gooey metaballs that chase the pointer (SVG filter).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "MetaBalls.tsx",
      "MetaBalls.css"
    ],
    "tags": [
      "metaballs",
      "gooey",
      "pointer",
      "playful"
    ],
    "upstreamCategory": "Animations",
    "sourceDir": "Animations/MetaBalls"
  },
  {
    "id": "elastic-mesh",
    "name": "ElasticMesh",
    "category": "General animation",
    "description": "Elastic mesh deformation reacting to the pointer (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "ElasticMesh.tsx",
      "ElasticMesh.css"
    ],
    "tags": [
      "mesh",
      "elastic",
      "interactive"
    ],
    "upstreamCategory": "Animations",
    "sourceDir": "Animations/ElasticMesh"
  },
  {
    "id": "swarm-cursor",
    "name": "SwarmCursor",
    "category": "General animation",
    "description": "Swarm of dots that follows the pointer (canvas).",
    "dependencies": [],
    "styling": "css-file",
    "kitFiles": [
      "SwarmCursor.tsx",
      "SwarmCursor.css"
    ],
    "tags": [
      "cursor",
      "swarm",
      "dots",
      "playful"
    ],
    "upstreamCategory": "Animations",
    "sourceDir": "Animations/SwarmCursor"
  },
  {
    "id": "image-trail",
    "name": "ImageTrail",
    "category": "General animation",
    "description": "Image trail that follows the pointer (GSAP; images via props).",
    "dependencies": [
      "gsap"
    ],
    "styling": "css-file",
    "kitFiles": [
      "ImageTrail.tsx",
      "ImageTrail.css"
    ],
    "tags": [
      "cursor",
      "image",
      "trail",
      "gsap"
    ],
    "note": "Default images are remote URLs; supply your own for offline preview.",
    "upstreamCategory": "Animations",
    "sourceDir": "Animations/ImageTrail"
  }
]

export interface ExcludedEntry {
  id: string
  name: string
  category: string
  dependencies: string[]
  reason: string
  upstreamCategory: string
  sourceDir: string
}

export const EXPANSION_EXCLUSIONS: ExcludedEntry[] = [
  {
    "id": "aero-shards",
    "name": "AeroShards",
    "category": "Background effect",
    "dependencies": [
      "vgpu"
    ],
    "reason": "Requires React Bits' private `vgpu` WebGPU package (not published for standalone use) — cannot be vendored.",
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/AeroShards"
  },
  {
    "id": "grid-scan",
    "name": "GridScan",
    "category": "Background effect",
    "dependencies": [],
    "reason": "Loads face-api.js and its model weights from a CDN at runtime (remote script + model injection) — incompatible with the offline/CSP contract for generated projects.",
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/GridScan"
  },
  {
    "id": "shape-waves",
    "name": "ShapeWaves",
    "category": "Background effect",
    "dependencies": [
      "vgpu"
    ],
    "reason": "Requires React Bits' private `vgpu` WebGPU package (not published for standalone use) — cannot be vendored.",
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/ShapeWaves"
  },
  {
    "id": "color-bends",
    "name": "ColorBends",
    "category": "Background effect",
    "dependencies": [
      "three"
    ],
    "reason": "Requires a direct `three` dependency outside the approved Vanta contract — not approved.",
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/ColorBends"
  },
  {
    "id": "hyperspeed",
    "name": "Hyperspeed",
    "category": "Background effect",
    "dependencies": [
      "three"
    ],
    "reason": "Requires a direct `three` dependency outside the approved Vanta contract — not approved.",
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/Hyperspeed"
  },
  {
    "id": "evil-eye",
    "name": "EvilEye",
    "category": "Background effect",
    "dependencies": [
      "ogl"
    ],
    "reason": "Requires the extra `ogl` WebGL library — dependency not approved for BEAN generated projects.",
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/EvilEye"
  },
  {
    "id": "pattern-waves",
    "name": "PatternWaves",
    "category": "Background effect",
    "dependencies": [
      "ogl"
    ],
    "reason": "Requires the extra `ogl` WebGL library — dependency not approved for BEAN generated projects.",
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/PatternWaves"
  },
  {
    "id": "micro-slats",
    "name": "MicroSlats",
    "category": "Background effect",
    "dependencies": [
      "ogl"
    ],
    "reason": "Requires the extra `ogl` WebGL library — dependency not approved for BEAN generated projects.",
    "upstreamCategory": "Backgrounds",
    "sourceDir": "Backgrounds/MicroSlats"
  },
  {
    "id": "spring-check",
    "name": "SpringCheck",
    "category": "Micro-interaction",
    "dependencies": [
      "@hugeicons/core-free-icons",
      "motion"
    ],
    "reason": "Requires the @hugeicons icon packages (license/count not approved for generated projects) — not approved.",
    "upstreamCategory": "Micro",
    "sourceDir": "Micro/SpringCheck"
  },
  {
    "id": "voice-pill",
    "name": "VoicePill",
    "category": "Micro-interaction",
    "dependencies": [
      "@hugeicons/core-free-icons",
      "@hugeicons/react"
    ],
    "reason": "Requires the @hugeicons icon packages (license/count not approved for generated projects) — not approved.",
    "upstreamCategory": "Micro",
    "sourceDir": "Micro/VoicePill"
  },
  {
    "id": "peek-rating",
    "name": "PeekRating",
    "category": "Micro-interaction",
    "dependencies": [
      "@hugeicons/core-free-icons",
      "@hugeicons/react"
    ],
    "reason": "Requires the @hugeicons icon packages (license/count not approved for generated projects) — not approved.",
    "upstreamCategory": "Micro",
    "sourceDir": "Micro/PeekRating"
  },
  {
    "id": "prompt-bar",
    "name": "PromptBar",
    "category": "Micro-interaction",
    "dependencies": [
      "@hugeicons/core-free-icons",
      "@hugeicons/react",
      "motion"
    ],
    "reason": "Requires the @hugeicons icon packages (license/count not approved for generated projects) — not approved.",
    "upstreamCategory": "Micro",
    "sourceDir": "Micro/PromptBar"
  },
  {
    "id": "paper-crumple",
    "name": "PaperCrumple",
    "category": "Micro-interaction",
    "dependencies": [
      "three"
    ],
    "reason": "Requires a direct `three` dependency outside the approved Vanta contract — not approved.",
    "upstreamCategory": "Micro",
    "sourceDir": "Micro/PaperCrumple"
  },
  {
    "id": "branched-menu",
    "name": "BranchedMenu",
    "category": "Micro-interaction",
    "dependencies": [
      "@hugeicons/core-free-icons",
      "@hugeicons/react"
    ],
    "reason": "Requires the @hugeicons icon packages (license/count not approved for generated projects) — not approved.",
    "upstreamCategory": "Micro",
    "sourceDir": "Micro/BranchedMenu"
  },
  {
    "id": "code-slots",
    "name": "CodeSlots",
    "category": "Micro-interaction",
    "dependencies": [
      "@hugeicons/core-free-icons",
      "@hugeicons/react",
      "motion"
    ],
    "reason": "Requires the @hugeicons icon packages (license/count not approved for generated projects) — not approved.",
    "upstreamCategory": "Micro",
    "sourceDir": "Micro/CodeSlots"
  },
  {
    "id": "glide-select",
    "name": "GlideSelect",
    "category": "Micro-interaction",
    "dependencies": [
      "@hugeicons/core-free-icons",
      "@hugeicons/react"
    ],
    "reason": "Requires the @hugeicons icon packages (license/count not approved for generated projects) — not approved.",
    "upstreamCategory": "Micro",
    "sourceDir": "Micro/GlideSelect"
  },
  {
    "id": "refine-frame",
    "name": "RefineFrame",
    "category": "Micro-interaction",
    "dependencies": [
      "@hugeicons/core-free-icons",
      "@hugeicons/react"
    ],
    "reason": "Requires the @hugeicons icon packages (license/count not approved for generated projects) — not approved.",
    "upstreamCategory": "Micro",
    "sourceDir": "Micro/RefineFrame"
  },
  {
    "id": "pulse-heart",
    "name": "PulseHeart",
    "category": "Micro-interaction",
    "dependencies": [
      "@hugeicons/core-free-icons"
    ],
    "reason": "Requires the @hugeicons icon packages (license/count not approved for generated projects) — not approved.",
    "upstreamCategory": "Micro",
    "sourceDir": "Micro/PulseHeart"
  },
  {
    "id": "bell-toggle",
    "name": "BellToggle",
    "category": "Micro-interaction",
    "dependencies": [
      "@hugeicons/core-free-icons",
      "@hugeicons/react",
      "motion"
    ],
    "reason": "Requires the @hugeicons icon packages (license/count not approved for generated projects) — not approved.",
    "upstreamCategory": "Micro",
    "sourceDir": "Micro/BellToggle"
  },
  {
    "id": "call-chip",
    "name": "CallChip",
    "category": "Micro-interaction",
    "dependencies": [
      "@hugeicons/core-free-icons",
      "@hugeicons/react"
    ],
    "reason": "Requires the @hugeicons icon packages (license/count not approved for generated projects) — not approved.",
    "upstreamCategory": "Micro",
    "sourceDir": "Micro/CallChip"
  },
  {
    "id": "slide-commit",
    "name": "SlideCommit",
    "category": "Micro-interaction",
    "dependencies": [
      "@hugeicons/core-free-icons",
      "@hugeicons/react",
      "motion"
    ],
    "reason": "Requires the @hugeicons icon packages (license/count not approved for generated projects) — not approved.",
    "upstreamCategory": "Micro",
    "sourceDir": "Micro/SlideCommit"
  },
  {
    "id": "swipe-toast",
    "name": "SwipeToast",
    "category": "Micro-interaction",
    "dependencies": [
      "@hugeicons/core-free-icons",
      "@hugeicons/react",
      "motion"
    ],
    "reason": "Requires the @hugeicons icon packages (license/count not approved for generated projects) — not approved.",
    "upstreamCategory": "Micro",
    "sourceDir": "Micro/SwipeToast"
  },
  {
    "id": "sling-button",
    "name": "SlingButton",
    "category": "Micro-interaction",
    "dependencies": [
      "@hugeicons/core-free-icons",
      "@hugeicons/react",
      "motion"
    ],
    "reason": "Requires the @hugeicons icon packages (license/count not approved for generated projects) — not approved.",
    "upstreamCategory": "Micro",
    "sourceDir": "Micro/SlingButton"
  },
  {
    "id": "folder-float",
    "name": "FolderFloat",
    "category": "Micro-interaction",
    "dependencies": [
      "matter-js"
    ],
    "reason": "Requires the `matter-js` physics engine — dependency not approved.",
    "upstreamCategory": "Micro",
    "sourceDir": "Micro/FolderFloat"
  },
  {
    "id": "swipe-row",
    "name": "SwipeRow",
    "category": "Micro-interaction",
    "dependencies": [
      "@hugeicons/core-free-icons",
      "@hugeicons/react",
      "motion"
    ],
    "reason": "Requires the @hugeicons icon packages (license/count not approved for generated projects) — not approved.",
    "upstreamCategory": "Micro",
    "sourceDir": "Micro/SwipeRow"
  },
  {
    "id": "thought-line",
    "name": "ThoughtLine",
    "category": "Micro-interaction",
    "dependencies": [
      "@hugeicons/core-free-icons",
      "@hugeicons/react",
      "motion"
    ],
    "reason": "Requires the @hugeicons icon packages (license/count not approved for generated projects) — not approved.",
    "upstreamCategory": "Micro",
    "sourceDir": "Micro/ThoughtLine"
  },
  {
    "id": "fuse-button",
    "name": "FuseButton",
    "category": "Micro-interaction",
    "dependencies": [
      "@hugeicons/core-free-icons",
      "@hugeicons/react"
    ],
    "reason": "Requires the @hugeicons icon packages (license/count not approved for generated projects) — not approved.",
    "upstreamCategory": "Micro",
    "sourceDir": "Micro/FuseButton"
  },
  {
    "id": "elastic-slider",
    "name": "ElasticSlider",
    "category": "UI component",
    "dependencies": [
      "@hugeicons/core-free-icons",
      "@hugeicons/react"
    ],
    "reason": "Requires the @hugeicons icon packages (license/count not approved for generated projects) — not approved.",
    "upstreamCategory": "Components",
    "sourceDir": "Components/ElasticSlider"
  },
  {
    "id": "flowing-menu",
    "name": "FlowingMenu",
    "category": "UI component",
    "dependencies": [
      "@hugeicons/core-free-icons",
      "@hugeicons/react"
    ],
    "reason": "Requires the @hugeicons icon packages (license/count not approved for generated projects) — not approved.",
    "upstreamCategory": "Components",
    "sourceDir": "Components/FlowingMenu"
  },
  {
    "id": "profile-card",
    "name": "ProfileCard",
    "category": "UI component",
    "dependencies": [
      "@hugeicons/core-free-icons",
      "@hugeicons/react"
    ],
    "reason": "Requires the @hugeicons icon packages (license/count not approved for generated projects) — not approved.",
    "upstreamCategory": "Components",
    "sourceDir": "Components/ProfileCard"
  },
  {
    "id": "model-viewer",
    "name": "ModelViewer",
    "category": "UI component",
    "dependencies": [
      "@react-three/drei",
      "@react-three/fiber",
      "three"
    ],
    "reason": "Requires the @react-three/fiber + drei stack — not approved.",
    "upstreamCategory": "Components",
    "sourceDir": "Components/ModelViewer"
  },
  {
    "id": "animated-list",
    "name": "AnimatedList",
    "category": "UI component",
    "dependencies": [
      "@hugeicons/core-free-icons",
      "@hugeicons/react"
    ],
    "reason": "Requires the @hugeicons icon packages (license/count not approved for generated projects) — not approved.",
    "upstreamCategory": "Components",
    "sourceDir": "Components/AnimatedList"
  },
  {
    "id": "magic-bento",
    "name": "MagicBento",
    "category": "UI component",
    "dependencies": [
      "@hugeicons/core-free-icons",
      "@hugeicons/react"
    ],
    "reason": "Requires the @hugeicons icon packages (license/count not approved for generated projects) — not approved.",
    "upstreamCategory": "Components",
    "sourceDir": "Components/MagicBento"
  },
  {
    "id": "carousel",
    "name": "Carousel",
    "category": "UI component",
    "dependencies": [
      "@hugeicons/core-free-icons",
      "@hugeicons/react"
    ],
    "reason": "Requires the @hugeicons icon packages (license/count not approved for generated projects) — not approved.",
    "upstreamCategory": "Components",
    "sourceDir": "Components/Carousel"
  },
  {
    "id": "morph-slider",
    "name": "MorphSlider",
    "category": "UI component",
    "dependencies": [
      "gsap",
      "ogl"
    ],
    "reason": "Requires the extra `ogl` WebGL library — dependency not approved for BEAN generated projects.",
    "upstreamCategory": "Components",
    "sourceDir": "Components/MorphSlider"
  },
  {
    "id": "reflective-card",
    "name": "ReflectiveCard",
    "category": "UI component",
    "dependencies": [
      "@hugeicons/core-free-icons",
      "@hugeicons/react"
    ],
    "reason": "Requires the @hugeicons icon packages (license/count not approved for generated projects) — not approved.",
    "upstreamCategory": "Components",
    "sourceDir": "Components/ReflectiveCard"
  },
  {
    "id": "flex-carousel",
    "name": "FlexCarousel",
    "category": "UI component",
    "dependencies": [
      "ogl"
    ],
    "reason": "Requires the extra `ogl` WebGL library — dependency not approved for BEAN generated projects.",
    "upstreamCategory": "Components",
    "sourceDir": "Components/FlexCarousel"
  },
  {
    "id": "card-nav",
    "name": "CardNav",
    "category": "UI component",
    "dependencies": [
      "@hugeicons/core-free-icons",
      "@hugeicons/react"
    ],
    "reason": "Requires the @hugeicons icon packages (license/count not approved for generated projects) — not approved.",
    "upstreamCategory": "Components",
    "sourceDir": "Components/CardNav"
  },
  {
    "id": "stepper",
    "name": "Stepper",
    "category": "UI component",
    "dependencies": [
      "@hugeicons/core-free-icons",
      "@hugeicons/react"
    ],
    "reason": "Requires the @hugeicons icon packages (license/count not approved for generated projects) — not approved.",
    "upstreamCategory": "Components",
    "sourceDir": "Components/Stepper"
  },
  {
    "id": "masonry",
    "name": "Masonry",
    "category": "UI component",
    "dependencies": [
      "@hugeicons/core-free-icons",
      "@hugeicons/react"
    ],
    "reason": "Requires the @hugeicons icon packages (license/count not approved for generated projects) — not approved.",
    "upstreamCategory": "Components",
    "sourceDir": "Components/Masonry"
  },
  {
    "id": "dome-gallery",
    "name": "DomeGallery",
    "category": "UI component",
    "dependencies": [
      "@use-gesture/react"
    ],
    "reason": "Requires the `@use-gesture/react` package — dependency not approved.",
    "upstreamCategory": "Components",
    "sourceDir": "Components/DomeGallery"
  },
  {
    "id": "lanyard",
    "name": "Lanyard",
    "category": "UI component",
    "dependencies": [
      "three"
    ],
    "reason": "Requires a direct `three` dependency outside the approved Vanta contract — not approved.",
    "upstreamCategory": "Components",
    "sourceDir": "Components/Lanyard"
  },
  {
    "id": "card-swap",
    "name": "CardSwap",
    "category": "UI component",
    "dependencies": [
      "@hugeicons/core-free-icons",
      "@hugeicons/react"
    ],
    "reason": "Requires the @hugeicons icon packages (license/count not approved for generated projects) — not approved.",
    "upstreamCategory": "Components",
    "sourceDir": "Components/CardSwap"
  },
  {
    "id": "warp-text",
    "name": "WarpText",
    "category": "Text animation",
    "dependencies": [
      "ogl"
    ],
    "reason": "Requires the extra `ogl` WebGL library — dependency not approved for BEAN generated projects.",
    "upstreamCategory": "TextAnimations",
    "sourceDir": "TextAnimations/WarpText"
  },
  {
    "id": "falling-text",
    "name": "FallingText",
    "category": "Text animation",
    "dependencies": [
      "matter-js"
    ],
    "reason": "Requires the `matter-js` physics engine — dependency not approved.",
    "upstreamCategory": "TextAnimations",
    "sourceDir": "TextAnimations/FallingText"
  },
  {
    "id": "dither-veil",
    "name": "DitherVeil",
    "category": "General animation",
    "dependencies": [
      "ogl"
    ],
    "reason": "Requires the extra `ogl` WebGL library — dependency not approved for BEAN generated projects.",
    "upstreamCategory": "Animations",
    "sourceDir": "Animations/DitherVeil"
  },
  {
    "id": "ripple-distortion",
    "name": "RippleDistortion",
    "category": "General animation",
    "dependencies": [
      "ogl"
    ],
    "reason": "Requires the extra `ogl` WebGL library — dependency not approved for BEAN generated projects.",
    "upstreamCategory": "Animations",
    "sourceDir": "Animations/RippleDistortion"
  },
  {
    "id": "blob-cursor",
    "name": "BlobCursor",
    "category": "General animation",
    "dependencies": [
      "three"
    ],
    "reason": "Requires a direct `three` dependency outside the approved Vanta contract — not approved.",
    "upstreamCategory": "Animations",
    "sourceDir": "Animations/BlobCursor"
  },
  {
    "id": "electric-logo",
    "name": "ElectricLogo",
    "category": "General animation",
    "dependencies": [
      "ogl"
    ],
    "reason": "Requires the extra `ogl` WebGL library — dependency not approved for BEAN generated projects.",
    "upstreamCategory": "Animations",
    "sourceDir": "Animations/ElectricLogo"
  },
  {
    "id": "crystalized-ball",
    "name": "CrystalizedBall",
    "category": "General animation",
    "dependencies": [
      "ogl"
    ],
    "reason": "Requires the extra `ogl` WebGL library — dependency not approved for BEAN generated projects.",
    "upstreamCategory": "Animations",
    "sourceDir": "Animations/CrystalizedBall"
  }
]
