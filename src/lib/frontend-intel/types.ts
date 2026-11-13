/**
 * BEAN Intelligence — Frontend Intelligence Toolkit for CODE GIFTZ.
 *
 * Shared types for the frontend generation capability: the user selection
 * (UI), the resolved plan (engine), and the wire-safe summaries that ride in
 * the assistant message metadata and the SSE `done` frame. All wire shapes
 * are ADDITIVE — existing consumers ignore unknown fields.
 *
 * SERVER-ONLY (the client imports only the summary interfaces through the
 * catalog API route's JSON payload, never this module directly).
 */

/** Generation target of a frontend plan. `react` output is a code deliverable
 *  (multi-file React project with a pinned package.json); the sandbox cannot
 *  build it, so there is honest NO live preview for it. */
export type FrontendTarget = 'static' | 'react'

/** What the user picks in the Frontend toolkit panel. Absent fields mean
 *  "engine decides" (`auto`) — the engine never forces a library in. */
export interface FrontendSelection {
  target?: 'auto' | FrontendTarget
  /** Catalogue component ids (validated against the registry). */
  components?: string[]
  /** GSAP animation pattern ids, or 'auto' for a sensible minimal set. */
  animations?: Array<'auto' | string>
  /** Vanta background effect, 'auto' (keyword-detected) or 'none'. */
  background?: 'none' | 'auto' | string
  /** Mobile-first responsive layout — on unless explicitly disabled. */
  responsive?: boolean
}

/** One catalogue entry as exposed to the client (no file contents). */
export interface FrontendComponentMeta {
  id: string
  name: string
  category: string
  description: string
  sourceRepository: string
  sourceUrl: string
  /** npm packages this component needs (already pinned in BEAN). */
  dependencies: string[]
  /** Framework compatibility notes. */
  compatibility: string
  /** Styling approach: css-file (portable), inline, or tailwind. */
  styling: 'css-file' | 'inline' | 'tailwind'
  variants: string[]
  /** Registry truth: only `true` when the implementation exists in the BEAN
   *  kit and has passed validation (tsc + render smoke tests). */
  installed: boolean
  /** Why a component is NOT installed (honest registry entries). */
  notInstalledReason?: string
  license: string
  attribution: string
  /** Import-source adaptation applied to the upstream file (recorded). */
  adaptedFrom?: string
  /** Upstream commit the source was taken from. */
  upstreamCommit: string
  /** Files this component contributes to generated React projects. */
  kitFiles: string[]
  /** Keywords that trigger auto-selection. */
  tags: string[]
}

export interface FrontendAnimationMeta {
  id: string
  label: string
  description: string
  /** Which targets the pattern ships code for. */
  targets: FrontendTarget[]
  requires: string[]
  /** Keywords that trigger auto-selection. */
  tags: string[]
}

export interface FrontendBackgroundMeta {
  id: string
  label: string
  description: string
  /** Extra vendor files the effect requires (three.js UMD + effect bundle). */
  vendorFiles: string[]
  note: string
}

/** Pinned third-party dependency as recorded in the registry and emitted
 *  into generated React projects' package.json. */
export interface PinnedDependency {
  name: string
  version: string
  license: string
  licenseUrl: string
}

/** Wire-safe plan summary — rides in metaJson + SSE done frame + UI. */
export interface FrontendPlanSummary {
  enabled: true
  target: FrontendTarget
  /** Honest reason the plan exists (selection vs auto-detection). */
  reason: string
  components: Array<Pick<FrontendComponentMeta, 'id' | 'name' | 'category' | 'sourceUrl' | 'license'> & { installed: boolean }>
  animations: string[]
  background: { id: string; label: string; fallback: string } | null
  responsive: boolean
  /** Files the ENGINE attached (vendor/kit/package.json/notices) — these are
   *  real project files, listed so the UI never claims the model wrote them. */
  engineFiles: string[]
  dependencies: Array<{ name: string; version: string; license: string; reason: string }>
  /** One-line attribution footer for the UI. */
  notices: string
}

/** Deterministic generation check (Phase 5). */
export interface FrontendCheck {
  id: string
  severity: 'blocking' | 'warning'
  message: string
}

export interface FrontendCheckReport {
  passed: boolean
  blocking: number
  warnings: number
  issues: FrontendCheck[]
}

/** Full summary after generation: plan + check report. */
export type FrontendTurnResult = FrontendPlanSummary & { checks: FrontendCheckReport }

/** Library-internal resolved plan (brief text + engine files, no wire use). */
export interface FrontendPlan {
  enabled: boolean
  target: FrontendTarget
  reason: string
  componentIds: string[]
  animationIds: string[]
  vantaEffect: string | null
  responsive: boolean
  /** Bounded brief injected into the turn context (labeled, trusted BEAN
   *  capability context — never user instructions). */
  brief: string
  /** Files the engine attaches after the model turn (vendor builds, kit
   *  component sources, package.json, NOTICES). */
  engineFiles: Array<{ path: string; content: string }>
  summary: FrontendPlanSummary
}
