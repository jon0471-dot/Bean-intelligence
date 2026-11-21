/**
 * BEAN Intelligence — GANGZII dynamic narration ducking (M28 Priority C).
 *
 * Timeline-aware, DETERMINISTIC music automation under narration. The curve
 * is generated from known narration regions (measured segment timing is the
 * primary guide — never inferred from waveform heuristics here), rendered as
 * one ffmpeg `volume` expression with eval=frame so a single invocation
 * produces the exact intended behavior in every composition path that uses
 * the module (GANGZII audio-production worker + JAZMII FFmpeg engine).
 *
 * Curve shape per narration region [s, e]:
 *   [a, s)  attack ramp  full → ducked     (a = s - attackMs, clamped ≥ 0)
 *   [s, e]  plateau      ducked
 *   (e, r]  release ramp ducked → full     (r = e + releaseMs)
 *   elsewhere            full level
 * Windows are evaluated as a NESTED if() chain in region order — the first
 * matching window wins, so a following region's attack may legitimately
 * overlap the previous region's release tail (the bed re-ducks smoothly
 * instead of pumping back up), and the result stays deterministic.
 *
 * Honesty rules:
 *  - this is NOT studio-grade sidechain compression: no compressor detects
 *    the narration envelope; the curve is time-driven from declared regions.
 *    Every consumer must say so in its notes/receipts.
 *  - the source music asset is NEVER modified: automation is applied at mix
 *    time only, and the plan (regions, config, breakpoints) is recorded as
 *    evidence alongside the output.
 *  - the curve is deterministic: identical inputs produce byte-identical
 *    expressions and breakpoint lists (unit-tested).
 *
 * Configurable (bounded here): duck depth, attack, release, transition
 * shape, minimum music level. Narration gain is the narration stream's own
 * volume (applied by the mix caller — the curve only shapes the music).
 * Manual volume automation stays available alongside this op (user override).
 */

// ---- contracts ----------------------------------------------------------------

export interface DuckRegion {
  /** Narration-active start on the timeline (seconds, >= 0). */
  startSec: number
  /** Narration-active end (seconds, > startSec). */
  endSec: number
}

export interface DynamicDuckConfig {
  /** Multiplier applied to the music level while narration is active (0.05–1). */
  duckTo: number
  /** Ramp-down time before narration starts, ms (0–2000). */
  attackMs: number
  /** Ramp-up time after narration ends, ms (0–2000). */
  releaseMs: number
  /** Transition shape between full and ducked level. */
  curve: 'linear' | 'cosine'
  /** Hard floor for the ducked level (0–1) — duckTo is clamped up to it. */
  minMusicLevel: number
}

export interface DuckBreakpoint {
  tSec: number
  level: number
}

export interface DuckPlan {
  /** Sorted, merged, clamped regions actually used. */
  regions: DuckRegion[]
  config: DynamicDuckConfig
  /** Deterministic ffmpeg volume expression (eval=frame) — multiplier on the stream. */
  expression: string
  /** Evidence/preview points: region boundaries + ramp midpoints. */
  breakpoints: DuckBreakpoint[]
  warnings: string[]
}

export const DUCK_DEFAULTS: DynamicDuckConfig = {
  duckTo: 0.35,
  attackMs: 150,
  releaseMs: 400,
  curve: 'cosine',
  minMusicLevel: 0.05,
}

export const DUCK_LIMITS = {
  duckTo: { min: 0.05, max: 1 },
  attackMs: { min: 0, max: 2000 },
  releaseMs: { min: 0, max: 2000 },
  minMusicLevel: { min: 0, max: 1 },
  maxRegions: 50,
}

// ---- validation + normalization ---------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000
}

/** Shape function on [0,1]; cosine gives smooth ease-in/out transitions. */
function shape(x: number, curve: 'linear' | 'cosine'): number {
  const t = clamp(x, 0, 1)
  return curve === 'linear' ? t : (1 - Math.cos(Math.PI * t)) / 2
}

/**
 * Validate raw regions: clamp to ≥ 0, drop inverted/ultra-short windows,
 * sort and merge overlaps/touches (a narration pause inside a region must
 * not pump the bed). Throws VALIDATION_ERROR beyond the region cap.
 */
export function normalizeDuckRegions(raw: DuckRegion[]): { regions: DuckRegion[]; warnings: string[] } {
  const warnings: string[] = []
  const valid: DuckRegion[] = []
  for (const r of raw) {
    const start = Number(r?.startSec)
    const end = Number(r?.endSec)
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      warnings.push('A ducking region with non-finite bounds was dropped.')
      continue
    }
    const s = Math.max(0, start)
    const e = end
    if (e - s < 0.05) {
      warnings.push(`A ducking region shorter than 50 ms was dropped (${s.toFixed(3)}–${e.toFixed(3)}s).`)
      continue
    }
    valid.push({ startSec: s, endSec: e })
  }
  valid.sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec)
  const merged: DuckRegion[] = []
  for (const r of valid) {
    const last = merged[merged.length - 1]
    if (last && r.startSec <= last.endSec) {
      last.endSec = Math.max(last.endSec, r.endSec)
    } else {
      merged.push({ ...r })
    }
  }
  if (merged.length > DUCK_LIMITS.maxRegions) {
    throw new Error(`VALIDATION_ERROR: ${merged.length} narration regions exceed the maximum of ${DUCK_LIMITS.maxRegions}. Split the production into smaller parts.`)
  }
  return { regions: merged, warnings }
}

export function resolveDuckConfig(partial: Partial<DynamicDuckConfig> | undefined): DynamicDuckConfig {
  const c = { ...DUCK_DEFAULTS, ...(partial ?? {}) }
  const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d)
  const duckTo = clamp(num(c.duckTo, DUCK_DEFAULTS.duckTo), DUCK_LIMITS.duckTo.min, DUCK_LIMITS.duckTo.max)
  const minMusicLevel = clamp(num(c.minMusicLevel, DUCK_DEFAULTS.minMusicLevel), DUCK_LIMITS.minMusicLevel.min, DUCK_LIMITS.minMusicLevel.max)
  return {
    duckTo: Math.max(duckTo, minMusicLevel),
    minMusicLevel,
    attackMs: clamp(Math.round(num(c.attackMs, DUCK_DEFAULTS.attackMs)), DUCK_LIMITS.attackMs.min, DUCK_LIMITS.attackMs.max),
    releaseMs: clamp(Math.round(num(c.releaseMs, DUCK_DEFAULTS.releaseMs)), DUCK_LIMITS.releaseMs.min, DUCK_LIMITS.releaseMs.max),
    curve: c.curve === 'linear' ? 'linear' : 'cosine',
  }
}

// ---- expression helpers ------------------------------------------------------------

/** ffmpeg expression for shape((t - start)/dur) with the given curve. */
function shapeExpr(startS: number, durS: number, curve: 'linear' | 'cosine'): string {
  const dt = `(t-${startS.toFixed(3)})`
  if (curve === 'linear') return `min(max(${dt}/${durS.toFixed(3)},0),1)`
  return `(1-cos(PI*min(max(${dt}/${durS.toFixed(3)},0),1)))/2`
}

// ---- the plan -----------------------------------------------------------------------

/**
 * Build the deterministic ducking plan. The expression is a nested if()
 * chain — a pure multiplier from 1 (full) down to duckTo and back — applied
 * on TOP of any base music gain the caller already configured.
 */
export function buildDynamicDuckPlan(
  rawRegions: DuckRegion[],
  configPartial?: Partial<DynamicDuckConfig>,
): DuckPlan {
  const config = resolveDuckConfig(configPartial)
  const { regions, warnings } = normalizeDuckRegions(rawRegions)
  const duck = config.duckTo
  const attackS = config.attackMs / 1000
  const releaseS = config.releaseMs / 1000

  if (regions.length === 0) {
    warnings.push('No valid narration regions — the ducking plan keeps the music at full level (nothing was ducked).')
    return { regions: [], config, expression: '1', breakpoints: [], warnings }
  }

  const breakpoints: DuckBreakpoint[] = []

  // Build innermost-first so we can nest without string surgery.
  let expr = '1'
  for (let i = regions.length - 1; i >= 0; i -= 1) {
    const r = regions[i]
    const s = round3(r.startSec)
    const e = round3(r.endSec)
    const a = round3(Math.max(0, s - attackS))
    const rl = round3(e + releaseS)

    const plateauVal = duck.toFixed(3)
    const attackVal =
      attackS > 0 && a < s
        ? `1+(${(duck - 1).toFixed(3)})*${shapeExpr(a, attackS, config.curve)}`
        : plateauVal
    const releaseVal =
      releaseS > 0
        ? `${duck.toFixed(3)}+${(1 - duck).toFixed(3)}*${shapeExpr(e, releaseS, config.curve)}`
        : '1'

    const chain = `if(between(t,${a},${s}),${attackVal},if(between(t,${s},${e}),${plateauVal},if(between(t,${e},${rl}),${releaseVal},${expr})))`
    expr = chain

    if (attackS > 0 && a < s) {
      breakpoints.push({ tSec: a, level: 1 })
      breakpoints.push({ tSec: round3((a + s) / 2), level: round3(1 + (duck - 1) * shape(0.5, config.curve)) })
    }
    breakpoints.push({ tSec: s, level: duck })
    breakpoints.push({ tSec: e, level: duck })
    if (releaseS > 0) {
      breakpoints.push({ tSec: round3((e + rl) / 2), level: round3(duck + (1 - duck) * shape(0.5, config.curve)) })
      breakpoints.push({ tSec: rl, level: 1 })
    }
  }

  breakpoints.sort((x, y) => x.tSec - y.tSec || x.level - y.level)
  return { regions, config, expression: expr, breakpoints, warnings }
}

/**
 * Render the plan as ONE ffmpeg volume filter argument. A base multiplier
 * (e.g. the configured music bed volume) can be baked in so a single filter
 * carries the full intended behavior. Regions are single-quoted inside the
 * filtergraph so the commas of the expression never need shell escaping
 * (all invocations go through execFile argument arrays — no shell).
 */
export function duckPlanToVolumeFilter(plan: DuckPlan, baseMultiplier?: number): string {
  if (plan.regions.length === 0) {
    return baseMultiplier !== undefined ? `volume=${round3(baseMultiplier)}` : 'volume=1'
  }
  const expr = plan.expression
  if (baseMultiplier !== undefined) {
    return `volume=volume='${round3(baseMultiplier)}*(${expr})':eval=frame`
  }
  return `volume=volume='${expr}':eval=frame`
}
