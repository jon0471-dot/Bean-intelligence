/**
 * BEAN Intelligence — Vanta background engine for CODE GIFTZ frontend
 * generation (Phase 3 of the Frontend Intelligence Toolkit work order).
 *
 * Vanta 0.5.24 (MIT) renders WebGL background effects via three.js. Binding
 * contract for every generated project (static AND React):
 *   - initialize ONLY after the target element mounts / DOM is ready,
 *   - destroy the effect on unmount / page hide (single-renderer guard:
 *     never two renderers for the same instance),
 *   - lazy-load only the selected effect bundle,
 *   - fall back to a static gradient when WebGL, the bundles, or reduced-
 *     motion compliance make an animated background inappropriate,
 *   - foreground content stays above the canvas and fully accessible.
 *
 * The static template and the React component source below are injected into
 * the generation brief / emitted as engine files — the model never invents
 * its own Vanta lifecycle.
 */
import type { FrontendBackgroundMeta, FrontendTarget } from './types'

/** The seven effects the work order requires. All ship in vanta 0.5.24 dist. */
export const VANTA_EFFECTS: FrontendBackgroundMeta[] = [
  {
    id: 'birds',
    label: 'Birds',
    description: 'Flocking birds wheeling behind the content; reacts to pointer.',
    vendorFiles: ['vendor/three.min.js', 'vendor/vanta.birds.min.js'],
    note: 'Most performant of the seven; good hero default.',
  },
  {
    id: 'waves',
    label: 'Waves',
    description: 'Soft undulating wave surface; slow, calm motion.',
    vendorFiles: ['vendor/three.min.js', 'vendor/vanta.waves.min.js'],
    note: 'Reads well behind light text; keep waveHeight low for legibility.',
  },
  {
    id: 'net',
    label: 'Net',
    description: 'Interactive plexus network of points and connecting lines.',
    vendorFiles: ['vendor/three.min.js', 'vendor/vanta.net.min.js'],
    note: 'Points react to the mouse; strong tech feel.',
  },
  {
    id: 'globe',
    label: 'Globe',
    description: 'Wireframe globe of dots; heavier render — avoid on low-end mobile.',
    vendorFiles: ['vendor/three.min.js', 'vendor/vanta.globe.min.js'],
    note: 'Heaviest effect; the fallback path matters most here.',
  },
  {
    id: 'fog',
    label: 'Fog',
    description: 'Volumetric drifting fog layers in brand colors.',
    vendorFiles: ['vendor/three.min.js', 'vendor/vanta.fog.min.js'],
    note: 'Subtle; pair with high-contrast foreground text.',
  },
  {
    id: 'clouds',
    label: 'Clouds',
    description: 'Soft procedural cloudscape; slow drift.',
    vendorFiles: ['vendor/three.min.js', 'vendor/vanta.clouds.min.js'],
    note: 'Blur-heavy; test legibility on small screens.',
  },
  {
    id: 'rings',
    label: 'Rings',
    description: 'Concentric pulsing rings on a dark field.',
    vendorFiles: ['vendor/three.min.js', 'vendor/vanta.rings.min.js'],
    note: 'Cheap to render; good accent for CTAs.',
  },
]

const EFFECTS_BY_ID = new Map(VANTA_EFFECTS.map((e) => [e.id, e]))

export function getVantaEffect(id: string): FrontendBackgroundMeta | undefined {
  return EFFECTS_BY_ID.get(id)
}

/** Normalized background configuration shared by both targets. */
export interface VantaConfig {
  colors: string[]
  background: string
  /** 0.2 – 2 (1 = effect default). */
  speed: number
  /** 0.5 – 2 (1 = effect default). */
  zoom: number
  mouseControls: boolean
  touchControls: boolean
}

export const DEFAULT_VANTA_CONFIG: VantaConfig = {
  colors: ['#d4af37', '#8a6d1f'],
  background: '#0b0d12',
  speed: 1,
  zoom: 1,
  mouseControls: true,
  touchControls: true,
}

/**
 * Per-effect option names follow Vanta's documented API (effect option keys
 * differ between effects; unknown keys are ignored gracefully by Vanta at
 * runtime). Only whitelisted keys are ever emitted.
 */
const EFFECT_OPTION_KEYS: Record<string, { colors: string[]; supportsSpeed: boolean; supportsZoom: boolean }> = {
  birds: { colors: ['color1', 'color2'], supportsSpeed: true, supportsZoom: false },
  waves: { colors: ['color'], supportsSpeed: true, supportsZoom: true },
  net: { colors: ['color'], supportsSpeed: false, supportsZoom: false },
  globe: { colors: ['color', 'color2'], supportsSpeed: false, supportsZoom: false },
  fog: { colors: ['highlightColor', 'midtoneColor', 'lowlightColor'], supportsSpeed: true, supportsZoom: true },
  clouds: { colors: ['highlightColor', 'midtoneColor', 'lowlightColor'], supportsSpeed: true, supportsZoom: false },
  rings: { colors: ['color'], supportsSpeed: false, supportsZoom: false },
}

export function vantaOptionsFor(effectId: string, config: VantaConfig): Record<string, unknown> {
  const meta = EFFECT_OPTION_KEYS[effectId]
  const options: Record<string, unknown> = {
    backgroundColor: config.background,
    mouseControls: config.mouseControls,
    touchControls: config.touchControls,
    gyroControls: false,
    minHeight: 200,
    minWidth: 200,
  }
  if (meta) {
    meta.colors.forEach((key, i) => {
      const color = config.colors[i] ?? config.colors[config.colors.length - 1]
      if (color) options[key] = color
    })
    if (meta.supportsSpeed) options.speed = config.speed
    if (meta.supportsZoom) options.zoom = config.zoom
  }
  return options
}

/** Universal fallback CSS injected with the template (validator looks for
 *  the `.vanta-fallback` marker). */
export const VANTA_FALLBACK_CSS = `.vanta-fallback {
  background: linear-gradient(160deg, #0b0d12 0%, #16203a 55%, #0b0d12 100%);
}`

/** STATIC TARGET — complete guarded init for the generated app.js. */
export function buildStaticVantaTemplate(effectId: string, config: VantaConfig): string {
  const options = vantaOptionsFor(effectId, config)
  return `// Vanta background (BEAN pattern: vanta-static) — effect: ${effectId}
// Contract: init once after DOM ready, destroy before re-init and on pagehide,
// static gradient fallback when WebGL is unavailable or reduced motion is set.
(function () {
  var el = document.getElementById('vanta-bg')
  if (!el) return
  var armFallback = function () { el.classList.add('vanta-fallback') }
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduceMotion || !window.VANTA || !window.THREE) { armFallback(); return }
  var hasWebGL = false
  try {
    hasWebGL = !!window.WebGLRenderingContext && !!document.createElement('canvas').getContext('webgl')
  } catch (err) { hasWebGL = false }
  if (!hasWebGL) { armFallback(); return }
  if (window.__beanVanta) { window.__beanVanta.destroy(); window.__beanVanta = null }
  window.__beanVanta = VANTA.${effectId.toUpperCase()}(Object.assign({ el: el, THREE: window.THREE }, ${JSON.stringify(options)}))
  window.addEventListener('pagehide', function () {
    if (window.__beanVanta) { window.__beanVanta.destroy(); window.__beanVanta = null }
  })
})()`
}

/** REACT TARGET — complete component source emitted by the engine as
 * `components/kit/VantaBackground.tsx`. Lazy per-effect bundles, destroy on
 * unmount, WebGL + reduced-motion fallbacks, single-renderer guard. */
export const VANTA_REACT_COMPONENT_SOURCE = `/**
 * VantaBackground — BEAN Frontend Intelligence Toolkit.
 * Lazy-loaded Vanta (MIT) effect over three.js (MIT). Init on mount, destroy
 * on unmount, single-renderer guard, static-gradient fallback when WebGL is
 * unavailable or the user prefers reduced motion. Foreground children render
 * above the canvas and remain fully accessible.
 */
'use client'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

export type VantaEffectName = 'birds' | 'waves' | 'net' | 'globe' | 'fog' | 'clouds' | 'rings'

export interface VantaBackgroundProps {
  effect: VantaEffectName
  colors?: string[]
  background?: string
  speed?: number
  zoom?: number
  mouseControls?: boolean
  touchControls?: boolean
  className?: string
  style?: CSSProperties
  children?: ReactNode
}

interface VantaInstance {
  destroy: () => void
}

// Bundler-friendly lazy loaders: ONE static import specifier per effect, so
// only the selected bundle is fetched at runtime.
const EFFECT_LOADERS: Record<VantaEffectName, () => Promise<unknown>> = {
  birds: () => import('vanta/dist/vanta.birds.min.js'),
  waves: () => import('vanta/dist/vanta.waves.min.js'),
  net: () => import('vanta/dist/vanta.net.min.js'),
  globe: () => import('vanta/dist/vanta.globe.min.js'),
  fog: () => import('vanta/dist/vanta.fog.min.js'),
  clouds: () => import('vanta/dist/vanta.clouds.min.js'),
  rings: () => import('vanta/dist/vanta.rings.min.js'),
}

const FALLBACK_STYLE: CSSProperties = {
  background: 'linear-gradient(160deg, #0b0d12 0%, #16203a 55%, #0b0d12 100%)',
}

export default function VantaBackground({
  effect,
  colors = ['#d4af37', '#8a6d1f'],
  background = '#0b0d12',
  speed = 1,
  zoom = 1,
  mouseControls = true,
  touchControls = true,
  className,
  style,
  children,
}: VantaBackgroundProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const instanceRef = useRef<VantaInstance | null>(null)
  const [fallback, setFallback] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false

    // Reduced motion: static fallback, never an animated renderer.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setFallback(true)
      return
    }
    // WebGL capability check with an honest fallback path.
    let hasWebGL = false
    try {
      hasWebGL = !!window.WebGLRenderingContext && !!document.createElement('canvas').getContext('webgl')
    } catch {
      hasWebGL = false
    }
    if (!hasWebGL) {
      setFallback(true)
      return
    }

    void (async () => {
      try {
        const THREE = await import('three')
        const bundle = (await EFFECT_LOADERS[effect]()) as Record<string, unknown>
        const VANTA = ((bundle as { default?: Record<string, unknown> }).default ?? bundle) as Record<string, unknown>
        const ctor = VANTA[effect.toUpperCase()] as
          | ((options: Record<string, unknown>) => VantaInstance)
          | undefined
        if (cancelled || !hostRef.current || typeof ctor !== 'function') {
          if (!cancelled) setFallback(true)
          return
        }
        // Single-renderer guard: destroy any previous instance first.
        if (instanceRef.current) {
          instanceRef.current.destroy()
          instanceRef.current = null
        }
        instanceRef.current = ctor({
          el: hostRef.current,
          THREE,
          mouseControls,
          touchControls,
          gyroControls: false,
          minHeight: 200,
          minWidth: 200,
          backgroundColor: background,
          speed,
          zoom,
          ...(effect === 'birds' ? { color1: colors[0] ?? '#d4af37', color2: colors[1] ?? colors[0] ?? '#8a6d1f' } : {}),
          ...(effect !== 'birds' && effect !== 'globe' && effect !== 'fog' && effect !== 'clouds' ? { color: colors[0] ?? '#d4af37' } : {}),
          ...(effect === 'globe' ? { color: colors[0] ?? '#d4af37', color2: colors[1] ?? colors[0] ?? '#8a6d1f' } : {}),
          ...(effect === 'fog' || effect === 'clouds'
            ? {
                highlightColor: colors[0] ?? '#d4af37',
                midtoneColor: colors[1] ?? colors[0] ?? '#8a6d1f',
                lowlightColor: colors[2] ?? colors[0] ?? '#3a3a3a',
              }
            : {}),
        })
      } catch {
        if (!cancelled) setFallback(true)
      }
    })()

    return () => {
      cancelled = true
      if (instanceRef.current) {
        instanceRef.current.destroy()
        instanceRef.current = null
      }
    }
  }, [effect, colors, background, speed, zoom, mouseControls, touchControls])

  return (
    <div className={className} style={{ position: 'relative', ...style }}>
      <div
        ref={hostRef}
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0, ...(fallback ? FALLBACK_STYLE : {}) }}
      />
      <div style={{ position: 'relative', zIndex: 1 }}>{children}</div>
    </div>
  )
}
`

/** Ambient type declaration emitted alongside the React component so user
 *  projects typecheck without shipping Vanta's own types. */
export const VANTA_AMBIENT_TYPES_SOURCE = `// Ambient module declaration for the Vanta UMD effect bundles (BEAN toolkit).
declare module 'vanta/dist/*' {
  const VantaBundle: Record<string, unknown> & { default?: Record<string, unknown> }
  export default VantaBundle
}
`

/** Brief section for the requested effect. */
export function buildVantaBrief(target: FrontendTarget, effectId: string, config: VantaConfig): string {
  const effect = getVantaEffect(effectId)
  if (!effect) return ''
  if (target === 'static') {
    return [
      `## VANTA BACKGROUND (${effect.label})`,
      `Reference the vendor bundles IN THIS ORDER in index.html, before app.js:`,
      '```html',
      `<script src="vendor/three.min.js"></script>`,
      `<script src="vendor/vanta.${effectId}.min.js"></script>`,
      '```',
      `Add <div id="vanta-bg" ...> behind the content (position fixed/absolute, full size) and ${VANTA_FALLBACK_CSS}`,
      'Initialize with this exact pattern in app.js:',
      '```js',
      buildStaticVantaTemplate(effectId, config),
      '```',
      `Note: ${effect.note}`,
    ].join('\n')
  }
  return [
    `## VANTA BACKGROUND (${effect.label})`,
    'The engine attaches `components/kit/VantaBackground.tsx` (and `types/vanta.d.ts`).',
    'Import and use it exactly like:',
    '```tsx',
    `import VantaBackground from './components/kit/VantaBackground'`,
    `export default function Hero() {\n  return <VantaBackground effect="${effectId}" style={{ minHeight: '100vh' }}>{/* page content */}</VantaBackground>\n}`,
    '```',
    `The component handles init/destroy, lazy loading, WebGL + reduced-motion fallbacks. Do NOT call VANTA.* yourself. Note: ${effect.note}`,
  ].join('\n')
}
