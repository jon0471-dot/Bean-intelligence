/**
 * VantaBackground — BEAN Frontend Intelligence Toolkit.
 * Lazy-loaded Vanta (MIT) effect over three.js (MIT). Init on mount, destroy
 * on unmount, single-renderer guard, static-gradient fallback when WebGL is
 * unavailable or the user prefers reduced motion. Foreground children render
 * above the canvas and remain fully accessible.
 */
'use client'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

export type VantaEffectName =
  | 'birds'
  | 'waves'
  | 'net'
  | 'globe'
  | 'fog'
  | 'clouds'
  | 'rings'
  | 'cells'
  | 'dots'
  | 'halo'
  | 'ripple'
  | 'trunk'
  | 'topology'

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
// only the selected bundle is fetched at runtime. trunk/topology are p5-based:
// their host app must import 'p5' BEFORE loading the effect bundle (Vanta
// reads the global p5); the engine pins p5@0.6.1 in package.json for them.
const EFFECT_LOADERS: Record<VantaEffectName, () => Promise<unknown>> = {
  birds: () => import('vanta/dist/vanta.birds.min.js'),
  waves: () => import('vanta/dist/vanta.waves.min.js'),
  net: () => import('vanta/dist/vanta.net.min.js'),
  globe: () => import('vanta/dist/vanta.globe.min.js'),
  fog: () => import('vanta/dist/vanta.fog.min.js'),
  clouds: () => import('vanta/dist/vanta.clouds.min.js'),
  rings: () => import('vanta/dist/vanta.rings.min.js'),
  cells: () => import('vanta/dist/vanta.cells.min.js'),
  dots: () => import('vanta/dist/vanta.dots.min.js'),
  halo: () => import('vanta/dist/vanta.halo.min.js'),
  ripple: () => import('vanta/dist/vanta.ripple.min.js'),
  trunk: () => import('vanta/dist/vanta.trunk.min.js'),
  topology: () => import('vanta/dist/vanta.topology.min.js'),
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
    // Runtime family: p5-based effects (trunk/topology) render through p5
    // (no WebGL probe needed); every other effect is a three.js WebGL effect
    // and falls back honestly when WebGL is unavailable.
    const isP5 = effect === 'trunk' || effect === 'topology'
    if (!isP5) {
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
    }

    void (async () => {
      try {
        const THREE = isP5 ? undefined : await import('three')
        // This project's effect is three-based (family-aware emission): the p5
        // module is never referenced here, so bundlers do not resolve it.
        const bundle = (await EFFECT_LOADERS[effect]()) as Record<string, unknown>
        // Bundler CJS interop can expose the effect factory in EITHER shape:
        // a default export holding the factory (webpack esModule namespace
        // under vite/rollup) or the VANTA registry object keyed by the global
        // effect name (VANTA.BIRDS, ... — the raw-namespace shape). Both are
        // supported; a missing constructor falls back honestly.
        // (M21 repair R-A2b — recorded in the validation report; unit-tested
        // by resolveVantaEffectCtor which mirrors this branch structure.)
        const VANTA = ((bundle as { default?: unknown }).default ?? bundle) as Record<string, unknown>
        const ctor = (
          typeof VANTA === 'function' ? VANTA : VANTA[effect.toUpperCase()]
        ) as ((options: Record<string, unknown>) => VantaInstance) | undefined
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
          // Vanta's p5 effects read the p5 constructor from options or the
          // global; bundlers do not set window.p5, so pass it explicitly.
          p5: undefined,
          mouseControls,
          touchControls,
          gyroControls: false,
          minHeight: 200,
          minWidth: 200,
          backgroundColor: background,
          speed,
          zoom,
          ...(effect === 'birds' || effect === 'cells' || effect === 'ripple'
            ? { color1: colors[0] ?? '#d4af37', color2: colors[1] ?? colors[0] ?? '#8a6d1f' }
            : {}),
          ...(effect !== 'birds' &&
          effect !== 'globe' &&
          effect !== 'fog' &&
          effect !== 'clouds' &&
          effect !== 'cells' &&
          effect !== 'ripple' &&
          effect !== 'halo'
            ? { color: colors[0] ?? '#d4af37' }
            : {}),
          ...(effect === 'globe' ? { color: colors[0] ?? '#d4af37', color2: colors[1] ?? colors[0] ?? '#8a6d1f' } : {}),
          ...(effect === 'halo' ? { baseColor: colors[0] ?? '#d4af37', color2: colors[1] ?? colors[0] ?? '#8a6d1f' } : {}),
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
