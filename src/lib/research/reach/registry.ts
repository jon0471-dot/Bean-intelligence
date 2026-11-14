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

export type BeanProductRef = 'riishe' | 'code-giftz'

export interface ResearchSourceStatus {
  id: string
  label: string
  kind: 'agent-reach' | 'browser'
  /** Upstream maturity level (informational; `experimental` also derives a state). */
  level: 'default' | 'optional' | 'experimental'
  loginRequired: boolean
  state: ResearchSourceState
  /** Honest, client-safe note (no binary paths, no credentials). */
  note: string | null
  actions: string[]
  /** Which BEAN products may use this source today. */
  products: BeanProductRef[]
  checkedAt: string
}

export interface ResearchGatewayStatus {
  runtime: ReachRuntimeHealth
  obscura: ObscuraHealth
  sources: ResearchSourceStatus[]
  checkedAt: string
}

/** Initial priority per the integration brief (1 = highest). */
const SOURCE_PRIORITY: Array<{ id: string; label: string; products: BeanProductRef[] }> = [
  { id: 'github', label: 'GitHub', products: ['riishe', 'code-giftz'] },
  { id: 'web', label: 'Web search & pages', products: ['riishe', 'code-giftz'] },
  { id: 'youtube', label: 'YouTube', products: ['riishe'] },
  { id: 'reddit', label: 'Reddit', products: ['riishe'] },
  { id: 'bilibili', label: 'Bilibili', products: ['riishe'] },
  { id: 'v2ex', label: 'V2EX', products: ['riishe', 'code-giftz'] },
]

/** Upstream channels BEAN deliberately does not allowlist (reported honestly). */
const DISABLED_UPSTREAM_CHANNELS: Array<{ id: string; label: string }> = [
  { id: 'twitter', label: 'X / Twitter' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'xiaohongshu', label: 'Xiaohongshu' },
  { id: 'xueqiu', label: 'Xueqiu' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'xiaoyuzhou', label: 'Xiaoyuzhou' },
  { id: 'boss', label: 'BOSS' },
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
    checkedAt,
  })

  return { runtime, obscura, sources, checkedAt }
}
