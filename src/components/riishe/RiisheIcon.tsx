'use client'

/**
 * RIISHE brand emblem — the custom robot-head mark for BEAN's conversational
 * AI product, drawn entirely as inline vector paths (no emoji, no icon-font
 * glyph, no CSS approximation, no external image asset).
 *
 * The artwork recreates the golden robot mascot: a flowing cloud of hair
 * swept across the top of the head, a symmetrical rounded face frame, two
 * glowing oval eyes and headphone-like side pieces — stroked in a
 * champagne-gold gradient (#FFE9A6 → #F5CB55 → #DDAA32) with a subtle,
 * controlled glow over a fully transparent background, so the emblem sits
 * cleanly on any BEAN dark surface.
 *
 * Usage:
 *   <RiisheIcon className="h-9 w-9" />        gradient emblem (default)
 *   <RiisheIcon mono className="h-4 w-4" />   flat currentColor glyph
 *   <RiisheIcon glow={false} ... />           disable the soft outer glow
 *
 * Every instance generates unique gradient/filter ids via useId, so any
 * number of emblems can safely coexist in one document. The mark is
 * decorative and renders aria-hidden next to visible "RIISHE" text; the
 * geometry is authored in a 64×64 viewBox so strokes stay crisp from 18px
 * header chips up to 96px hero tiles.
 */

import { useId } from 'react'

export interface RiisheIconProps {
  className?: string
  /** Flat single-color rendering (currentColor) instead of the gold gradient. */
  mono?: boolean
  /** Soft outer glow around the linework (on by default). */
  glow?: boolean
}

export function RiisheIcon({ className = 'h-6 w-6', mono = false, glow = true }: RiisheIconProps) {
  // Gradient/filter ids must be unique per instance — two emblems on one
  // page would otherwise alias to the first definition.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const hairId = `riishe-hair-${uid}`
  const frameId = `riishe-frame-${uid}`
  const eyeId = `riishe-eye-${uid}`
  const haloId = `riishe-halo-${uid}`
  const glowFilterId = `riishe-glow-${uid}`

  const hairStroke = mono ? 'currentColor' : `url(#${hairId})`
  const frameStroke = mono ? 'currentColor' : `url(#${frameId})`
  const eyeFill = mono ? 'currentColor' : `url(#${eyeId})`

  // One continuous cloud silhouette: seven outward arcs from the left temple
  // over the crown to the right temple. The stroke ends land on the face
  // frame's corner curves; the temple arcs sweep gently (larger radius) so
  // the crown stays the widest point of the hair.
  const hairArcs =
    'M20.6 33.2 ' +
    'A7 7 0 0 1 14.2 22.6 ' +
    'A4.4 4.4 0 0 1 16.6 15.2 ' +
    'A5.3 5.3 0 0 1 26 12.5 ' +
    'A7 7 0 0 1 38 12.5 ' +
    'A5.3 5.3 0 0 1 47.4 15.2 ' +
    'A4.4 4.4 0 0 1 49.8 22.6 ' +
    'A7 7 0 0 1 43.4 33.2'

  // Fill twin of the silhouette with its baseline raised to y=30.8 so the
  // champagne tint never washes into the face interior — the straight
  // baseline hides behind the face frame's top stroke (y ≈ 29.1–31.9).
  const hairFill =
    'M20.3 30.8 ' +
    'A6.2 6.2 0 0 1 14.2 22.6 ' +
    'A4.4 4.4 0 0 1 16.6 15.2 ' +
    'A5.3 5.3 0 0 1 26 12.5 ' +
    'A7 7 0 0 1 38 12.5 ' +
    'A5.3 5.3 0 0 1 47.4 15.2 ' +
    'A4.4 4.4 0 0 1 49.8 22.6 ' +
    'A6.2 6.2 0 0 1 43.7 30.8 Z'

  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      aria-hidden="true"
      focusable="false"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Gradients exist only for the gradient variant; mono mode carries
          no unused definitions. The glow filter is needed whenever glow is on. */}
      {!mono || glow ? (
        <defs>
          {!mono ? (
            <>
              <linearGradient id={hairId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#FFE9A6" />
                <stop offset="0.55" stopColor="#F5CB55" />
                <stop offset="1" stopColor="#DDAA32" />
              </linearGradient>
              <linearGradient id={frameId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#F5CB55" />
                <stop offset="1" stopColor="#DDAA32" />
              </linearGradient>
              <linearGradient id={eyeId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#FFE9A6" />
                <stop offset="1" stopColor="#F5CB55" />
              </linearGradient>
              <radialGradient id={haloId} cx="0.5" cy="0.5" r="0.5">
                <stop offset="0" stopColor="#E8B91E" stopOpacity="0.16" />
                <stop offset="1" stopColor="#E8B91E" stopOpacity="0" />
              </radialGradient>
            </>
          ) : null}
          {glow ? (
            <filter id={glowFilterId} x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="1.15" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          ) : null}
        </defs>
      ) : null}

      {/* Ambient champagne illumination behind the head */}
      {!mono ? <ellipse cx="32" cy="40" rx="25" ry="23" fill={`url(#${haloId})`} /> : null}

      <g
        transform="translate(0 1.2)"
        filter={glow ? `url(#${glowFilterId})` : undefined}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Flowing hair — subtle champagne tint inside the cloud */}
        <path
          d={hairFill}
          fill={mono ? 'currentColor' : `url(#${hairId})`}
          fillOpacity={0.14}
        />

        {/* Hair outline (open path — ends land on the face frame corners) */}
        <path d={hairArcs} stroke={hairStroke} strokeWidth={2.6} />

        {/* Swept strand details inside the hair */}
        <path
          d="M22.8 28.8 C25.4 21.8 31.8 17.6 40.2 18.6"
          stroke={hairStroke}
          strokeWidth={1.6}
          opacity={0.55}
        />
        <path
          d="M20.8 24.2 C23.2 19.2 27.8 16.4 33.4 16.6"
          stroke={hairStroke}
          strokeWidth={1.6}
          opacity={0.55}
        />

        {/* Symmetrical rounded face frame */}
        <rect
          x="19"
          y="30.5"
          width="26"
          height="22"
          rx="8"
          stroke={frameStroke}
          strokeWidth={2.75}
        />

        {/* Headphone-like side pieces */}
        <rect
          x="13.4"
          y="36.4"
          width="5.4"
          height="10.8"
          rx="2.7"
          stroke={frameStroke}
          strokeWidth={2.4}
        />
        <rect
          x="45.2"
          y="36.4"
          width="5.4"
          height="10.8"
          rx="2.7"
          stroke={frameStroke}
          strokeWidth={2.4}
        />
        <circle cx="16.1" cy="41.8" r="1.15" fill={eyeFill} />
        <circle cx="47.9" cy="41.8" r="1.15" fill={eyeFill} />

        {/* Oval eyes */}
        <ellipse cx="25.4" cy="41.8" rx="2.4" ry="3.5" fill={eyeFill} />
        <ellipse cx="38.6" cy="41.8" rx="2.4" ry="3.5" fill={eyeFill} />
      </g>
    </svg>
  )
}
