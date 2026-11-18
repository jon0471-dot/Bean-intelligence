'use client'

/**
 * BEAN Intelligence — LAXII in-app image viewer (M26.3).
 *
 * Replaces the raw navigation to /api/laxii/assets/{id}: clicking a result
 * image now opens THIS lightbox on the current workspace route. Built on the
 * existing Radix dialog infrastructure (Escape closes, backdrop click
 * closes, focus is trapped while open) with the BEAN dark/gold design.
 *
 * Behavior contract (M26.3 §3):
 *  - full-resolution source rendered with object-contain (fit-to-screen);
 *  - zoom in/out buttons + wheel; pan by dragging when zoomed;
 *  - Escape / backdrop click / visible close button all close;
 *  - Download uses a blob fetch — the workspace state is never navigated
 *    away and the asset URL (ownership-checked) stays the source of bytes;
 *  - previous/next navigation across the conversation's generated images;
 *  - clicks inside the viewer never reach the underlying result card
 *    (portal + overlay absorb them).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { ChevronLeft, ChevronRight, Download, X, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'

export interface LightboxImage {
  src: string
  alt: string
  downloadName?: string
}

const MIN_SCALE = 1
const MAX_SCALE = 6

export function ImageLightbox({
  images,
  index,
  onIndexChange,
  open,
  onOpenChange,
}: {
  images: LightboxImage[]
  index: number
  onIndexChange: (i: number) => void
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)

  const current = images[index] ?? null

  // Any image switch (or reopen) resets the transform — each image starts
  // fitted to the screen, never inheriting the previous zoom state.
  useEffect(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [index, open])

  const clampOffset = useCallback((next: { x: number; y: number }, s: number) => {
    // Keep the image visually reachable: the pan span grows with the zoom.
    const span = 220 * (s - 1) + 40
    return {
      x: Math.max(-span, Math.min(span, next.x)),
      y: Math.max(-span, Math.min(span, next.y)),
    }
  }, [])

  const zoomBy = useCallback(
    (delta: number) => {
      setScale((s) => {
        const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, s + delta))
        if (next === 1) setOffset({ x: 0, y: 0 })
        else setOffset((o) => clampOffset(o, next))
        return next
      })
    },
    [clampOffset],
  )

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault()
      zoomBy(e.deltaY < 0 ? 0.35 : -0.35)
    },
    [zoomBy],
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (scale <= 1) return
      dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
      ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    },
    [scale, offset],
  )
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      setOffset(clampOffset({ x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) }, scale))
    },
    [scale, clampOffset],
  )
  const onPointerUp = useCallback(() => {
    dragRef.current = null
  }, [])

  // Keyboard navigation stays inside the dialog scope (Radix keeps focus
  // trapped, so these handlers only fire while the viewer is open).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && index > 0) onIndexChange(index - 1)
      if (e.key === 'ArrowRight' && index < images.length - 1) onIndexChange(index + 1)
      if (e.key === '+' || e.key === '=') zoomBy(0.5)
      if (e.key === '-') zoomBy(-0.5)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, index, images.length, onIndexChange, zoomBy])

  const download = useCallback(async (src: string, name?: string) => {
    // Fetch → blob → object URL: the SPA route is NEVER navigated away and
    // the authorized asset URL stays the only byte source.
    try {
      const res = await fetch(src)
      if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name ?? 'bean-image'
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
    } catch {
      window.open(src, '_blank', 'noopener')
    }
  }, [])

  if (!current) return null
  const multi = images.length > 1

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="h-[100dvh] w-screen max-w-[100vw] sm:max-w-[100vw] overflow-hidden border-0 bg-black/95 p-0 sm:rounded-none"
        onWheel={onWheel}
        aria-describedby={undefined}
      >
        {/* Accessible name for the dialog (the toolbar carries it visually). */}
        <DialogTitle className="sr-only">Image viewer</DialogTitle>
        <DialogDescription className="sr-only">
          Full-resolution image viewer with zoom and pan. Escape or the close button returns to the workspace.
        </DialogDescription>

        {/* Toolbar — BEAN dark/gold, always visible, thumb-reachable. */}
        <div className="absolute left-0 right-0 top-0 z-20 flex items-center justify-between gap-2 border-b border-[rgba(212,175,55,0.25)] bg-black/80 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[11px] text-[#f0c75e]">LAXII image viewer</span>
            {multi ? (
              <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-white/55">
                {index + 1} / {images.length}
              </span>
            ) : null}
            <span className="hidden rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-white/40 sm:inline">
              {Math.round(scale * 100)}%
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => zoomBy(-0.5)}
              disabled={scale <= MIN_SCALE}
              aria-label="Zoom out"
              className="rounded-md border border-white/15 p-1.5 text-white/70 hover:border-[rgba(212,175,55,0.5)] hover:text-[#f0c75e] disabled:opacity-30"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <button
              onClick={() => zoomBy(0.5)}
              disabled={scale >= MAX_SCALE}
              aria-label="Zoom in"
              className="rounded-md border border-white/15 p-1.5 text-white/70 hover:border-[rgba(212,175,55,0.5)] hover:text-[#f0c75e] disabled:opacity-30"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            <button
              onClick={() => {
                setScale(1)
                setOffset({ x: 0, y: 0 })
              }}
              aria-label="Fit to screen"
              className="rounded-md border border-white/15 p-1.5 text-white/70 hover:border-[rgba(212,175,55,0.5)] hover:text-[#f0c75e]"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
            <button
              onClick={() => download(current.src, current.downloadName)}
              aria-label="Download image"
              className="rounded-md border border-white/15 p-1.5 text-white/70 hover:border-[rgba(212,175,55,0.5)] hover:text-[#f0c75e]"
            >
              <Download className="h-4 w-4" />
            </button>
            <button
              onClick={() => onOpenChange(false)}
              aria-label="Close image viewer"
              className="rounded-md border border-[rgba(212,175,55,0.4)] bg-[rgba(212,175,55,0.12)] p-1.5 text-[#f0c75e] hover:bg-[rgba(212,175,55,0.2)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Viewer frame: the backdrop click closes via Radix outside-click;
            dragging pans when zoomed. Handlers stop at the frame so nothing
            underneath (result card actions) can ever activate. */}
        <div
          className="absolute inset-0 flex items-center justify-center overflow-hidden bg-black/95"
          style={{ paddingTop: 44 }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onDoubleClick={() => {
            setScale((s) => (s > 1 ? 1 : 2.5))
            setOffset({ x: 0, y: 0 })
          }}
        >
          {/* The asset route is an authenticated API URL, not a static file —
              next/image optimization does not apply to it. */}
          <img
            src={current.src}
            alt={current.alt}
            draggable={false}
            className="max-h-full max-w-full select-none object-contain transition-transform duration-100"
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
              cursor: scale > 1 ? (dragRef.current ? 'grabbing' : 'grab') : 'zoom-in',
            }}
          />
        </div>

        {/* Prev / next */}
        {multi && index > 0 ? (
          <button
            onClick={() => onIndexChange(index - 1)}
            aria-label="Previous image"
            className="absolute left-3 top-1/2 z-20 -translate-y-1/2 rounded-full border border-[rgba(212,175,55,0.4)] bg-black/70 p-2.5 text-[#f0c75e] hover:bg-[rgba(212,175,55,0.15)]"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        ) : null}
        {multi && index < images.length - 1 ? (
          <button
            onClick={() => onIndexChange(index + 1)}
            aria-label="Next image"
            className="absolute right-3 top-1/2 z-20 -translate-y-1/2 rounded-full border border-[rgba(212,175,55,0.4)] bg-black/70 p-2.5 text-[#f0c75e] hover:bg-[rgba(212,175,55,0.15)]"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
