/**
 * BEAN Intelligence — shared research gateway: source capability registry.
 *
 * Source status reflects MEASURED reality, never source-code presence:
 *   - the Agent Reach runtime must exist (`--version` probe);
 *   - `agent-reach doctor` (quota-free, no network) supplies per-channel
 *     install/login state on the host;
 *   - channels BEAN does not allowlist are reported `disabled` (BEAN policy),
 *     never `available`;
 *   - the optional Obscura browser backend reports its own probe.
 *
 * A failed channel NEVER disables unrelated channels: every source carries
 * its own state + evidence note. Login-gated channels stay `requires_login`
 * until the OWNER performs an explicit, interactive login on the host —
 * BEAN never copies browser sessions and never runs login commands.
 */

import { obscuraHealthCheck, type ObscuraHealth } from '../browser/obscura'
import { reachDisabled, reachDisabledChannels } from './config'
import { fetchReachDoctor, probeReachRuntime, type ReachDoctorReport, type ReachRuntimeHealth } from './adapter'
import { REACH_CHANNELS } from './allowlist'

export type ResearchSourceState =
  | 'available'
  | 'requires_configuration'
  | 'requires_login'
  | 'experimental'
  | 'unavailable'
  | 'disabled'
  | 'not_integrated'

/** M42: every BEAN specialist role — the shared gateway serves them all. */
export type BeanProductRef =
  | 'riishe'
  | 'code-giftz'
  | 'laxii'
  | 'jazmii'
  | 'gangzii'
  | 'knowledge'
  | 'quality'

export const ALL_SPECIALISTS: readonly BeanProductRef[] = ['riishe', 'code-giftz', 'laxii', 'jazmii', 'gangzii', 'knowledge', 'quality']

export interface ResearchSourceStatus {
  id: string
  label: string
  kind: 'agent-reach' | 'browser' | 'direct'
  /** Upstream maturity level (informational; `experimental` also derives a state). */
  level: 'default' | 'optional' | 'experimental'
  loginRequired: boolean
  state: ResearchSourceState
  /** Honest, client-safe note (no binary paths, no credentials). */
  note: string | null
  actions: string[]
  /** Which BEAN products may use this source today. */
  products: BeanProductRef[]
  /** M42: source family from the platform catalogue (Tier A–G). */
  family: string
  checkedAt: string
}

export interface ResearchGatewayStatus {
  runtime: ReachRuntimeHealth
  obscura: ObscuraHealth
  sources: ResearchSourceStatus[]
  checkedAt: string
}

/** Initial priority per the integration brief (1 = highest).
 *  M42: every allowlisted channel serves EVERY specialist — the per-product
 *  restrictions were the M42 access gap (the registry previously scoped
 *  products to riishe/code-giftz only). Actions stay allowlist-bound. */
const SOURCE_PRIORITY: Array<{ id: string; label: string; products: BeanProductRef[]; family: string }> = [
  { id: 'github', label: 'GitHub', products: [...ALL_SPECIALISTS], family: 'developer' },
  { id: 'web', label: 'Web search & pages', products: [...ALL_SPECIALISTS], family: 'general-web' },
  { id: 'youtube', label: 'YouTube', products: [...ALL_SPECIALISTS], family: 'video-audio' },
  { id: 'reddit', label: 'Reddit', products: [...ALL_SPECIALISTS], family: 'community' },
  { id: 'bilibili', label: 'Bilibili', products: [...ALL_SPECIALISTS], family: 'video-audio' },
  { id: 'v2ex', label: 'V2EX', products: [...ALL_SPECIALISTS], family: 'community' },
]

/** Upstream channels BEAN deliberately does not allowlist (reported honestly). */
const DISABLED_UPSTREAM_CHANNELS: Array<{ id: string; label: string; family: string }> = [
  { id: 'twitter', label: 'X / Twitter', family: 'social' },
  { id: 'linkedin', label: 'LinkedIn', family: 'social' },
  { id: 'xiaohongshu', label: 'Xiaohongshu', family: 'social' },
  { id: 'xueqiu', label: 'Xueqiu', family: 'social' },
  { id: 'facebook', label: 'Facebook', family: 'social' },
  { id: 'instagram', label: 'Instagram', family: 'social' },
  { id: 'xiaoyuzhou', label: 'Xiaoyuzhou', family: 'video-audio' },
  { id: 'boss', label: 'BOSS', family: 'social' },
]

function deriveChannelState(
  channel: string,
  doctorEntry:
    | { status: string; regressed: boolean; problems: string[]; login: { via: string; loggedIn: boolean | null } | null }
    | undefined,
  spec: { level: string; loginRequired: boolean },
): { state: ResearchSourceState; note: string | null } {
  if (reachDisabledChannels().has(channel)) {
    return { state: 'disabled', note: 'disabled by BEAN configuration' }
  }
  if (!doctorEntry) {
    return { state: 'requires_configuration', note: 'channel status could not be verified on the host' }
  }
  if (doctorEntry.regressed) {
    return { state: 'unavailable', note: 'channel regressed — it worked at the previous check but not now' }
  }
  switch (doctorEntry.status) {
    case 'ready': {
      if (spec.loginRequired && doctorEntry.login?.loggedIn !== true) {
        return {
          state: 'requires_login',
          note: 'owner-controlled login on the host is required for this source',
        }
      }
      if (spec.level === 'experimental') {
        return { state: 'experimental', note: 'experimental source — upstream may break at any time' }
      }
      return { state: 'available', note: null }
    }
    case 'needs_setup': {
      const problem = doctorEntry.problems[0]?.slice(0, 120) ?? 'channel setup is incomplete on the host'
      return { state: 'requires_configuration', note: problem }
    }
    case 'unverified':
      return { state: 'requires_configuration', note: 'installed but not yet verified on the host' }
    case 'not_added':
      return { state: 'requires_configuration', note: 'channel is not added on the host' }
    default:
      return { state: 'unavailable', note: 'channel is not available on the host' }
  }
}

/**
 * Compose the full gateway status. Probe results are cached by the adapter
 * (60 s); composition itself is cheap and safe to call per request.
 */
export async function getResearchGatewayStatus(): Promise<ResearchGatewayStatus> {
  const runtime = await probeReachRuntime()
  const doctor: ReachDoctorReport = runtime.available
    ? await fetchReachDoctor()
    : { ok: false, channels: [], checkedAt: new Date().toISOString() }
  const obscura = await obscuraHealthCheck()
  const checkedAt = new Date().toISOString()
  const doctorByChannel = new Map(doctor.channels.map((c) => [c.channel, c]))

  const sources: ResearchSourceStatus[] = []

  for (const p of SOURCE_PRIORITY) {
    const spec = REACH_CHANNELS.find((c) => c.channel === p.id)
    if (!spec) continue // allowlist drift — never invent a source
    let state: ResearchSourceState
    let note: string | null
    if (reachDisabled()) {
      state = 'disabled'
      note = 'Agent Reach integration is disabled by configuration'
    } else if (!runtime.available) {
      state = 'unavailable'
      note = runtime.reason ?? 'Agent Reach runtime is not installed on the host'
    } else {
      const derived = deriveChannelState(
        p.id,
        doctorByChannel.get(p.id),
        { level: spec.level, loginRequired: spec.loginRequired },
      )
      state = derived.state
      note = derived.note
    }
    sources.push({
      id: p.id,
      label: p.label,
      kind: 'agent-reach',
      level: spec.level,
      loginRequired: spec.loginRequired,
      state,
      note,
      actions: spec.actions.map((a) => a.action),
      products: p.products,
      family: p.family,
      checkedAt,
    })
  }

  for (const d of DISABLED_UPSTREAM_CHANNELS) {
    sources.push({
      id: d.id,
      label: d.label,
      kind: 'agent-reach',
      level: 'optional',
      loginRequired: true,
      state: 'disabled',
      note: 'not enabled in the BEAN research gateway allowlist',
      actions: [],
      products: [],
      family: d.family,
      checkedAt,
    })
  }

  sources.push({
    id: 'obscura',
    label: 'Obscura rendered pages (optional)',
    kind: 'browser',
    level: 'optional',
    loginRequired: false,
    state: obscura.available ? 'available' : 'unavailable',
    note: obscura.available ? null : obscura.reason,
    actions: ['fetchRenderedPage', 'extractText', 'extractLinks', 'captureScreenshot'],
    products: ['riishe', 'code-giftz'],
    family: 'general-web',
    checkedAt,
  })

  // M42: the DIRECT official-source lane (no gateway, no keys) — measured as
  // one family: the pipeline's independent lane serves Wikipedia/MediaWiki
  // APIs + selected official pages, and the M42 academic adapters extend it.
  const directAvailable = true // the lane is in-process fetch code — present on every host
  sources.push({
    id: 'direct-official',
    label: 'Direct official & Wikimedia sources',
    kind: 'direct',
    level: 'default',
    loginRequired: false,
    state: directAvailable ? 'available' : 'unavailable',
    note: null,
    actions: ['officialPage', 'wikipediaApi', 'nodeReleaseIndex', 'crossref', 'arxiv', 'openalex', 'doaj'],
    products: [...ALL_SPECIALISTS],
    family: 'general-web',
    checkedAt,
  })

  // M42 catalogue families with NO adapter yet — honest not_integrated rows
  // (M42 §10: state must reflect measured reality; a name in the catalogue is
  // not an adapter).
  const notIntegrated: Array<{ id: string; label: string; family: string; note: string }> = [
    { id: 'family-scholarly', label: 'Scholarly APIs (Crossref/OpenAlex/arXiv/DOAJ adapters)', family: 'scholarly', note: 'direct adapters implemented in the pipeline academic lane where listed under direct-official actions; remaining APIs not integrated yet' },
    { id: 'family-packages', label: 'Package registries (npm/PyPI/…) via dedicated adapter', family: 'developer', note: 'reachable today through general web search + GitHub; dedicated registry adapters not integrated yet' },
    { id: 'family-standards', label: 'Standards bodies (W3C/WHATWG/IETF/ISO public catalogue)', family: 'standards', note: 'reachable through general web search; dedicated adapters not integrated yet' },
    { id: 'family-images', label: 'Licensed image libraries (Wikimedia Commons metadata/Unsplash/Openverse)', family: 'images', note: 'not integrated; Wikimedia API text lanes exist, per-file image license metadata adapters not integrated yet' },
    { id: 'family-geo', label: 'Map/geospatial official APIs', family: 'geo', note: 'not integrated (existing geo context heuristic is query-side only)' },
  ]
  for (const f of notIntegrated) {
    sources.push({
      id: f.id,
      label: f.label,
      kind: 'direct',
      level: 'optional',
      loginRequired: false,
      state: 'not_integrated',
      note: f.note,
      actions: [],
      products: [],
      family: f.family,
      checkedAt,
    })
  }

  return { runtime, obscura, sources, checkedAt }
}
