'use client'

/**
 * BEAN Intelligence — CODE GIFTZ Frontend toolkit panel (Phase 6).
 *
 * ADDITIVE UI for the Frontend Intelligence capability: target framework,
 * React Bits catalogue component selection, GSAP animation patterns, optional
 * Vanta background effect, responsive toggle — plus the summary strip that
 * renders a completed frontend turn's plan (dependencies, engine files,
 * license attribution, deterministic check results).
 *
 * This file deliberately does NOT redesign the existing CODE GIFTZ interface:
 * the panel mounts beside the Attach control and the summary renders inside
 * the existing assistant bubble, using the same visual system.
 */
import { useEffect, useState } from 'react'
import { Sparkles, ChevronDown, ChevronUp, CircleCheck, CircleAlert, X } from 'lucide-react'
import { Spinner } from './shared'
import { cn } from '@/lib/utils'

// ---- Wire-view types (mirror of the catalog API / summary shapes) ----------

export interface FrontendSelectionState {
  target: 'auto' | 'static' | 'react'
  components: string[]
  animations: Array<'auto' | string>
  background: 'none' | 'auto' | string
  responsive: boolean
}

export const DEFAULT_FRONTEND_SELECTION: FrontendSelectionState = {
  target: 'auto',
  components: [],
  animations: ['auto'],
  background: 'none',
  responsive: true,
}

/** True when the user actually engaged the toolkit (something non-default). */
export function isFrontendEngaged(sel: FrontendSelectionState): boolean {
  return (
    sel.target !== 'auto' ||
    sel.components.length > 0 ||
    !(sel.animations.length === 1 && sel.animations[0] === 'auto') ||
    sel.background !== 'none' ||
    sel.responsive === false
  )
}

interface CatalogData {
  components: Array<{
    id: string
    name: string
    category: string
    description: string
    sourceUrl: string
    dependencies: string[]
    compatibility: string
    styling: string
    variants: string[]
    installed: boolean
    license: string
    attribution: string
  }>
  notInstalled: Array<{ id: string; name: string; category: string; reason: string }>
  animations: Array<{ id: string; label: string; description: string; requires: string[] }>
  backgrounds: Array<{ id: string; label: string; description: string; note: string; vendorFiles: string[] }>
  dependencies: Array<{ name: string; version: string; license: string; licenseUrl: string }>
}

export interface FrontendSummaryView {
  enabled: true
  target: 'static' | 'react'
  reason: string
  components: Array<{ id: string; name: string; category: string; sourceUrl: string; license: string; installed: boolean }>
  animations: string[]
  background: { id: string; label: string; fallback: string } | null
  responsive: boolean
  engineFiles: string[]
  dependencies: Array<{ name: string; version: string; license: string; reason: string }>
  notices: string
  checks?: { passed: boolean; blocking: number; warnings: number; issues: Array<{ id: string; severity: 'blocking' | 'warning'; message: string }> }
}

// ---- Panel -----------------------------------------------------------------

function chipClasses(active: boolean): string {
  return cn(
    'inline-flex max-w-full items-center gap-1 truncate rounded-md border px-2 py-1 text-[11px] transition-colors',
    active
      ? 'border-[rgba(212,175,55,0.55)] bg-[rgba(212,175,55,0.12)] text-[#f0c75e]'
      : 'border-white/10 text-white/50 hover:border-[rgba(212,175,55,0.3)] hover:text-white/75',
  )
}

export function GiftzFrontendPanel({
  selection,
  onChange,
}: {
  selection: FrontendSelectionState
  onChange: (next: FrontendSelectionState) => void
}) {
  const [open, setOpen] = useState(false)
  const [catalog, setCatalog] = useState<CatalogData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || catalog || error) return
    void (async () => {
      try {
        const res = await fetch('/api/code-giftz/frontend/catalog')
        if (res.status === 401) window.dispatchEvent(new Event('bean:unauthorized'))
        if (!res.ok) throw new Error(`Catalog unavailable (${res.status})`)
        const data = (await res.json()) as CatalogData
        setCatalog(data)
      } catch (e) {
        setError((e as Error).message)
      }
    })()
  }, [open, catalog, error])

  const toggleComponent = (id: string) => {
    const next = selection.components.includes(id)
      ? selection.components.filter((c) => c !== id)
      : [...selection.components, id].slice(0, 12)
    onChange({ ...selection, components: next })
  }

  const toggleAnimation = (id: string) => {
    let next: Array<'auto' | string>
    if (id === 'auto') {
      next = selection.animations.includes('auto') && selection.animations.length === 1 ? [] : ['auto']
    } else {
      const withoutAuto = selection.animations.filter((a) => a !== 'auto')
      next = withoutAuto.includes(id) ? withoutAuto.filter((a) => a !== id) : [...withoutAuto, id].slice(0, 8)
    }
    onChange({ ...selection, animations: next.length > 0 ? next : ['auto'] })
  }

  const categories = catalog ? [...new Set(catalog.components.map((c) => c.category))] : []

  return (
    <div className="mb-2">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors',
            isFrontendEngaged(selection)
              ? 'border-[rgba(212,175,55,0.55)] bg-[rgba(212,175,55,0.12)] text-[#f0c75e]'
              : 'border-[rgba(212,175,55,0.25)] text-white/55 hover:bg-white/5 hover:text-white/80',
          )}
          title="Frontend toolkit: components, animations and background effects for website generation"
        >
          <Sparkles className="h-3.5 w-3.5" /> Frontend toolkit
          {isFrontendEngaged(selection) ? (
            <span className="rounded-full bg-[rgba(212,175,55,0.25)] px-1.5 text-[10px]">
              {selection.components.length > 0 ? `${selection.components.length} comp` : 'on'}
              {selection.background !== 'none' ? ' · bg' : ''}
            </span>
          ) : null}
          {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
        {isFrontendEngaged(selection) ? (
          <button
            onClick={() => onChange({ ...DEFAULT_FRONTEND_SELECTION })}
            className="text-[10px] text-white/35 hover:text-white/70"
          >
            reset
          </button>
        ) : null}
        <span className="hidden text-[10px] text-white/30 sm:inline">applies to the next request</span>
      </div>

      {open ? (
        <div className="mt-2 rounded-xl border border-[rgba(212,175,55,0.18)] bg-black/25 p-3">
          {error ? (
            <p className="text-[11px] text-amber-300">
              The component catalogue could not be loaded ({error}). Generation still works without it.
            </p>
          ) : !catalog ? (
            <p className="inline-flex items-center gap-2 text-[11px] text-white/40">
              <Spinner className="h-3 w-3" /> Loading catalogue…
            </p>
          ) : (
            <div className="space-y-3">
              {/* Target */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[10px] uppercase tracking-wider text-white/35">Target</span>
                {(['auto', 'static', 'react'] as const).map((t) => (
                  <button key={t} onClick={() => onChange({ ...selection, target: t })} className={chipClasses(selection.target === t)}>
                    {t === 'auto' ? 'Auto' : t === 'static' ? 'Static web' : 'React project'}
                  </button>
                ))}
              </div>

              {/* Components by category */}
              <div className="space-y-1.5">
                <span className="text-[10px] uppercase tracking-wider text-white/35">
                  Components — React Bits (free collection, MIT + Commons Clause, attribution preserved)
                </span>
                {categories.map((cat) => (
                  <div key={cat} className="flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 min-w-[92px] text-[10px] text-white/30">{cat}</span>
                    {catalog.components
                      .filter((c) => c.category === cat)
                      .map((c) => (
                        <button
                          key={c.id}
                          onClick={() => toggleComponent(c.id)}
                          className={chipClasses(selection.components.includes(c.id))}
                          title={`${c.description} · deps: ${c.dependencies.length > 0 ? c.dependencies.join(', ') : 'none'} · ${c.license}`}
                        >
                          {c.name}
                        </button>
                      ))}
                  </div>
                ))}
                {catalog.notInstalled.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="mr-1 min-w-[92px] text-[10px] text-white/25">Upstream only</span>
                    {catalog.notInstalled.map((c) => (
                      <span
                        key={c.id}
                        className="inline-flex items-center gap-1 rounded-md border border-white/5 px-2 py-1 text-[11px] text-white/25"
                        title={c.reason}
                      >
                        {c.name} · not installed
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>

              {/* Animations */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[10px] uppercase tracking-wider text-white/35">GSAP animations</span>
                <button
                  onClick={() => toggleAnimation('auto')}
                  className={chipClasses(selection.animations.length === 1 && selection.animations[0] === 'auto')}
                  title="Engine picks a minimal, useful set"
                >
                  Auto
                </button>
                {catalog.animations.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => toggleAnimation(a.id)}
                    className={chipClasses(selection.animations.includes(a.id))}
                    title={`${a.description} · requires: ${a.requires.join(', ')}`}
                  >
                    {a.label}
                  </button>
                ))}
              </div>

              {/* Background */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[10px] uppercase tracking-wider text-white/35">3D background</span>
                <button
                  onClick={() => onChange({ ...selection, background: 'none' })}
                  className={chipClasses(selection.background === 'none')}
                  title="No animated background"
                >
                  None
                </button>
                <button
                  onClick={() => onChange({ ...selection, background: 'auto' })}
                  className={chipClasses(selection.background === 'auto')}
                  title="Detect from the request; birds as a sensible default"
                >
                  Auto
                </button>
                {catalog.backgrounds.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => onChange({ ...selection, background: b.id })}
                    className={chipClasses(selection.background === b.id)}
                    title={`${b.description} · ${b.note} · adds ${b.vendorFiles.join(' + ')} (vendored, offline)`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>

              {/* Responsive + attribution footer */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[rgba(212,175,55,0.12)] pt-2">
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-white/55">
                  <input
                    type="checkbox"
                    checked={selection.responsive}
                    onChange={(e) => onChange({ ...selection, responsive: e.target.checked })}
                    className="accent-[#d4af37]"
                  />
                  Mobile-first responsive layout (checked by generation checks)
                </label>
                <span className="text-[9.5px] text-white/30" title={catalog.dependencies.map((d) => `${d.name}@${d.version} — ${d.license}`).join('\n')}>
                  Pinned: {catalog.dependencies.map((d) => `${d.name} ${d.version}`).join(' · ')}
                </span>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

// ---- Summary strip (assistant bubble) --------------------------------------

export function FrontendSummary({ data }: { data: FrontendSummaryView }) {
  const [openIssues, setOpenIssues] = useState(false)
  const checks = data.checks
  return (
    <div className="mt-2 rounded-lg border border-[rgba(212,175,55,0.2)] bg-black/20 px-3 py-2 text-[10.5px] text-white/55">
      <div className="mb-1 flex items-center gap-1.5 font-semibold text-[#f0c75e]">
        <Sparkles className="h-3 w-3" /> Frontend toolkit · {data.target === 'react' ? 'React project (code deliverable — no live preview)' : 'Static web (previewable)'}
      </div>
      {data.components.length > 0 ? (
        <p className="truncate" title={data.components.map((c) => `${c.name} (${c.category}) — ${c.sourceUrl}`).join('\n')}>
          Components: {data.components.map((c) => c.name).join(', ')}
        </p>
      ) : null}
      {data.animations.length > 0 ? <p className="truncate">GSAP: {data.animations.join(', ')}</p> : null}
      {data.background ? (
        <p className="truncate">
          Background: {data.background.label} · fallback: {data.background.fallback}
        </p>
      ) : null}
      {data.engineFiles.length > 0 ? (
        <p className="truncate" title={data.engineFiles.join('\n')}>
          Engine-attached: {data.engineFiles.join(', ')}
        </p>
      ) : null}
      {data.dependencies.length > 0 ? (
        <p className="truncate" title={data.dependencies.map((d) => `${d.name}@${d.version} — ${d.license}`).join('\n')}>
          Dependencies: {data.dependencies.map((d) => `${d.name} ${d.version} (${d.license.split(' ')[0]})`).join(' · ')}
        </p>
      ) : null}
      {checks ? (
        <p className={cn('mt-1 flex items-center gap-1.5 border-t border-[rgba(212,175,55,0.12)] pt-1', checks.passed ? 'text-emerald-300/80' : 'text-amber-300')}>
          {checks.passed ? <CircleCheck className="h-3 w-3" /> : <CircleAlert className="h-3 w-3" />}
          Generation checks: {checks.passed ? 'passed' : `${checks.blocking} blocking`} · {checks.warnings} warning{checks.warnings === 1 ? '' : 's'}
          {checks.issues.length > 0 ? (
            <button onClick={() => setOpenIssues((v) => !v)} className="underline decoration-dotted hover:text-white/80">
              {openIssues ? 'hide' : 'details'}
            </button>
          ) : null}
        </p>
      ) : null}
      {openIssues && checks ? (
        <ul className="mt-1 space-y-0.5 border-t border-[rgba(212,175,55,0.12)] pt-1">
          {checks.issues.map((i, idx) => (
            <li key={`${i.id}-${idx}`} className={i.severity === 'blocking' ? 'text-amber-300' : 'text-white/45'}>
              <span className="mr-1 inline-block w-2">{i.severity === 'blocking' ? '!' : '·'}</span>
              <span className="font-mono text-[9.5px]">{i.id}</span> — {i.message}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-1 border-t border-[rgba(212,175,55,0.12)] pt-1 text-[9.5px] text-white/35">{data.notices}</p>
    </div>
  )
}

/** Small helper reused by the workspace header to dismiss the toolkit hint. */
export function FrontendHintDismiss({ onDismiss }: { onDismiss: () => void }) {
  return (
    <button onClick={onDismiss} className="text-white/30 hover:text-white/70" aria-label="Dismiss frontend hint">
      <X className="h-3 w-3" />
    </button>
  )
}
