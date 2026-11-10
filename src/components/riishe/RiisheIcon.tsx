'use client'

/**
 * RIISHE official brand icon — the single centralized rendering point for
 * the approved robot-head artwork across BEAN Intelligence.
 *
 * The artwork is derived 1:1 from the authoritative reference image
 * (glossy black rounded-square tile, gold neon robot with the wave-shaped
 * flowing hair, rounded-rect face outline, two oval eyes and circular
 * headphone cups) and ships as two canonical derivatives in
 * /public/brand/riishe/ (regenerable via scripts/riishe-brand-assets.py):
 *
 *   riishe-tile.webp — full glossy rounded-square app icon for large
 *                      placements (welcome hero, profile-style cards)
 *   riishe-mark.webp — transparent gold robot-head mark for compact
 *                      placements (header, navigation, avatars, cards)
 *
 * Variants:
 *   <RiisheIcon />                          mark (default, compact, 24px)
 *   <RiisheIcon variant="tile" />           glossy app icon
 *   <RiisheIcon className="h-4 w-4" />      any Tailwind size
 *
 * The component never re-draws or restyles the artwork: colors, glow and
 * proportions are baked in the canonical assets, so every location shows
 * the identical official identity. Decorative — always rendered
 * aria-hidden beside visible "RIISHE" text. Plain <img> matches the
 * existing app convention (see laxii.tsx); files are static /public
 * assets, so no Next image-config surface is touched.
 */

import { cn } from '@/lib/utils'

export interface RiisheIconProps {
  className?: string
  /** "mark" (default): transparent gold head · "tile": glossy app icon. */
  variant?: 'mark' | 'tile'
}

const SOURCES = {
  mark: '/brand/riishe/riishe-mark.webp',
  tile: '/brand/riishe/riishe-tile.webp',
} as const

export function RiisheIcon({ className = 'h-6 w-6', variant = 'mark' }: RiisheIconProps) {
  return (
    <img
      src={SOURCES[variant]}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn('inline-block select-none', className)}
    />
  )
}
