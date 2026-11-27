/**
 * BEAN Intelligence — M45 Phase 4: the deployment adapter (SERVER ONLY).
 *
 * Narrowly scoped deployment capabilities over the deployment that ACTUALLY
 * exists (a Caddy reverse proxy serving the Next.js standalone build on
 * localhost:3000). Inspection is real; staging execution requires a
 * configured infrastructure token (absent in this deployment → the typed
 * contract reports honest unavailability, never a simulated deploy).
 *
 * Boundaries encoded here:
 *   - staging and production are separate authorization scopes (env-gated);
 *   - production deployment requires explicit owner authorization upstream
 *     (the M44 gate) AND a configured token — confidence never deploys;
 *   - no secret extraction: log/config reads pass a redaction filter;
 *   - no DNS/domain/billing/infrastructure modification of any kind;
 *   - rollback is an explicit, approved, independently verified operation
 *     (never an automatic retry).
 */

import { readFile, stat } from 'node:fs/promises'
import { recordAudit } from '@/lib/observability/metering'

export const DEPLOYMENT_ADAPTER_LIMITS = {
  logTailBytes: 20_000,
  configBytes: 20_000,
  healthTimeoutMs: 8_000,
  maxHistoryEntries: 20,
} as const

export type DeployOutcome<T> =
  | { kind: 'executed'; data: T; evidence: Array<{ kind: string; ref: string; note: string }> }
  | { kind: 'failed'; reason: string }
  | { kind: 'honest-unavailable'; reason: string }

export interface DeploymentConfigView {
  caddyPresent: boolean
  caddySummary: string | null
  startCommand: string | null
  buildCommandPresent: boolean
  buildId: string | null
  standalonePresent: boolean
  scope: 'local-preview' | 'external-provider'
  provider: string | null
}

function deploymentRoot(): string {
  return process.env.BEAN_DEPLOY_ROOT?.trim() || process.cwd()
}

function baseUrl(): string {
  return process.env.BEAN_DEPLOY_BASE_URL?.trim() || 'http://localhost:3000'
}

/** Secret-safety filter for any file content that leaves the server. */
function redactSecrets(text: string): string {
  return text
    .replace(/(authorization|bearer|token|secret|password|api[_-]?key|DATABASE_URL)\s*[:=]\s*\S+/gi, '$1: <redacted>')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '<redacted>')
    .replace(/gh[pousr]_[A-Za-z0-9]{20,}/g, '<redacted>')
}

/** Inspect the deployment configuration and build state (read-only, real). */
export async function inspectDeploymentConfig(): Promise<DeployOutcome<DeploymentConfigView>> {
  const root = deploymentRoot()
  let caddySummary: string | null = null
  try {
    const caddy = await readFile(`${root}/Caddyfile`, 'utf8')
    caddySummary = `Caddyfile present — reverse_proxy ${caddy.includes('localhost:3000') ? 'localhost:3000' : 'custom upstream'}`
  } catch {
    caddySummary = null
  }
  let startCommand: string | null = null
  let buildCommandPresent = false
  try {
    const pkg = JSON.parse(await readFile(`${root}/package.json`, 'utf8')) as { scripts?: Record<string, string> }
    startCommand = pkg.scripts?.start ?? null
    buildCommandPresent = !!pkg.scripts?.build
  } catch {
    startCommand = null
  }
  let buildId: string | null = null
  try {
    buildId = (await readFile(`${root}/.next/BUILD_ID`, 'utf8')).trim().slice(0, 64) || null
  } catch {
    buildId = null
  }
  let standalonePresent = false
  try {
    standalonePresent = (await stat(`${root}/.next/standalone`)).isDirectory()
  } catch {
    standalonePresent = false
  }
  const provider = process.env.BEAN_DEPLOY_PROVIDER?.trim() || null
  const data: DeploymentConfigView = {
    caddyPresent: caddySummary !== null,
    caddySummary,
    startCommand: startCommand ? redactSecrets(startCommand).slice(0, 300) : null,
    buildCommandPresent,
    buildId,
    standalonePresent,
    scope: provider ? 'external-provider' : 'local-preview',
    provider,
  }
  return {
    kind: 'executed',
    data,
    evidence: [{ kind: 'deployment-config', ref: root.slice(0, 120), note: `build ${data.buildId ?? 'none'} / standalone ${data.standalonePresent ? 'present' : 'absent'}` }],
  }
}

export interface DeploymentRevisionView {
  buildId: string | null
  servingCommitSha: string | null
  method: string
  intendedMatchesRunning: boolean | null
}

/**
 * Identify the deployed revision: the running build id plus, when available,
 * the git HEAD of the deployment root — obtained by a SEPARATE git query
 * (independent of any build receipt).
 */
export async function inspectDeployedRevision(): Promise<DeployOutcome<DeploymentRevisionView>> {
  const config = await inspectDeploymentConfig()
  if (config.kind !== 'executed') return config
  let sha: string | null = null
  let method = 'build-id only (no git query available)'
  try {
    const { execFile } = await import('node:child_process')
    sha = await new Promise<string | null>((resolve) => {
      execFile('git', ['-C', deploymentRoot(), 'rev-parse', 'HEAD'], { timeout: 5_000 }, (err, stdout) => {
        const v = String(stdout ?? '').trim()
        resolve(!err && /^[0-9a-f]{40}$/.test(v) ? v : null)
      })
    })
    if (sha) method = 'independent git rev-parse of the deployment root + build id'
  } catch {
    sha = null
  }
  return {
    kind: 'executed',
    data: { buildId: config.data.buildId, servingCommitSha: sha, method, intendedMatchesRunning: null },
    evidence: [{ kind: 'deployed-revision', ref: sha?.slice(0, 12) ?? config.data.buildId ?? 'unknown', note: method }],
  }
}

export interface RuntimeHealthView {
  url: string
  httpStatus: number | null
  healthy: boolean | null
  buildIdReported: string | null
}

/** Probe the RUNNING deployment's health endpoint (independent HTTP fetch). */
export async function probeRuntimeHealth(path = '/api/health'): Promise<DeployOutcome<RuntimeHealthView>> {
  const url = `${baseUrl()}${path.startsWith('/') ? path : `/${path}`}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DEPLOYMENT_ADAPTER_LIMITS.healthTimeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
    let buildId: string | null = null
    let healthy: boolean | null = res.status === 200 ? true : false
    try {
      const j = (await res.json()) as { buildId?: string; status?: string; ok?: boolean }
      buildId = j.buildId?.slice(0, 64) ?? null
      if (j.status && j.status !== 'ok') healthy = false
    } catch {
      /* non-JSON health body — status-based verdict stands */
    }
    return {
      kind: 'executed',
      data: { url, httpStatus: res.status, healthy, buildIdReported: buildId },
      evidence: [{ kind: 'runtime-health', ref: url.slice(0, 160), note: `HTTP ${res.status} ${healthy === true ? 'healthy' : healthy === false ? 'unhealthy' : 'unknown'}` }],
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // An unreachable runtime is an honest observation, not a hidden pass.
    return { kind: 'executed', data: { url, httpStatus: null, healthy: null, buildIdReported: null }, evidence: [{ kind: 'runtime-health', ref: url.slice(0, 160), note: `unreachable: ${msg.slice(0, 120)}` }] }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Deployment history — requires a configured external provider. None is
 * configured in this deployment, so the typed contract reports honest
 * unavailability. Local build records are NOT provider history and are
 * never dressed up as one.
 */
export async function inspectDeploymentHistory(): Promise<DeployOutcome<Array<{ id: string; createdAt: string; revision: string | null; state: string }>>> {
  const provider = process.env.BEAN_DEPLOY_PROVIDER?.trim()
  const token = process.env.BEAN_DEPLOY_TOKEN?.trim()
  if (!provider || !token) {
    return {
      kind: 'honest-unavailable',
      reason: 'No external deployment provider is configured (BEAN_DEPLOY_PROVIDER/BEAN_DEPLOY_TOKEN absent) — deployment history is unavailable. The current deployment serves through a local reverse proxy; no provider history exists to inspect.',
    }
  }
  return { kind: 'honest-unavailable', reason: `Provider "${provider}" is configured but no typed integration exists for it yet — history inspection is unavailable rather than approximated.` }
}

export interface StagingDeployInput {
  revision: string
  scope: 'staging' | 'production'
  requestedBy: string
}

/**
 * An APPROVED staging deployment. In this deployment there is no staging
 * infrastructure token, so the operation reports honest unavailability.
 * Production is refused outright unless BEAN_PRODUCTION_DEPLOY_ENABLED is
 * explicitly set AND a separate owner approval already gated the action
 * upstream (the M44 gate consumed the approval BEFORE this call).
 */
export async function executeApprovedDeployment(input: StagingDeployInput): Promise<DeployOutcome<{ deployed: boolean; revision: string; verified: boolean; method: string | null }>> {
  const token = process.env.BEAN_STAGING_DEPLOY_TOKEN?.trim()
  if (input.scope === 'production' && process.env.BEAN_PRODUCTION_DEPLOY_ENABLED?.trim() !== 'true') {
    return { kind: 'failed', reason: 'Production deployment is disabled in this deployment (BEAN_PRODUCTION_DEPLOY_ENABLED unset). Production releases are owner operations outside this adapter.' }
  }
  if (!token) {
    return {
      kind: 'honest-unavailable',
      reason: `No ${input.scope} deployment infrastructure is configured for this deployment — the approved ${input.scope} deployment cannot run and is never simulated. The typed contract exists; wiring a real provider requires the owner to configure credentials.`,
    }
  }
  return { kind: 'honest-unavailable', reason: 'A staging token is configured but no typed provider integration exists for it yet — refusing rather than improvising an unknown provider API.' }
}

/** Bounded, secret-filtered log tail (authorized scope: this deployment). */
export async function inspectDeploymentLogs(lines = 40): Promise<DeployOutcome<{ source: string; excerpt: string }>> {
  const root = deploymentRoot()
  for (const candidate of ['dev.log', 'server.log']) {
    try {
      const st = await stat(`${root}/${candidate}`)
      if (!st.isFile()) continue
      const handle = await readFile(`${root}/${candidate}`, 'utf8')
      const tail = handle.split('\n').slice(-Math.min(Math.max(lines, 1), 200)).join('\n')
      return {
        kind: 'executed',
        data: { source: candidate, excerpt: redactSecrets(tail).slice(-DEPLOYMENT_ADAPTER_LIMITS.logTailBytes) },
        evidence: [{ kind: 'deployment-log', ref: candidate, note: `last ${Math.min(lines, 200)} lines, secret-filtered` }],
      }
    } catch {
      continue
    }
  }
  return { kind: 'failed', reason: 'No deployment log file (dev.log/server.log) is present in the deployment root.' }
}

/** Audit hook (bounded; never throws). */
export async function auditDeploymentInspection(target: string, meta: Record<string, unknown>): Promise<void> {
  try {
    await recordAudit({ actorId: 'm45-deployment-adapter', action: 'm45.deployment_inspected', target: target.slice(0, 120), meta })
  } catch {
    /* ledger bounds are not execution failures */
  }
}

/** Test/ops seam: the deployment boundary vocabulary. */
export const DEPLOYMENT_BOUNDARY_SEAM = {
  stagingProductionSeparateScopes: true,
  productionRequiresOwnerApprovalUpstream: true,
  automaticProductionRetry: false,
  dnsDomainBillingChanges: false,
  rollbackRequiresExplicitApproval: true,
} as const
